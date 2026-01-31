import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { canCreateCompletion, incrementCompletionCount } from "../lib/billing.server";
import { unauthenticated } from "../shopify.server";
import {
  getCorsHeaders,
  createCorsErrorResponse,
} from "../lib/cors.server";
import {
  checkRateLimit,
  getClientIp,
  createRateLimitResponse,
} from "../lib/rate-limit.server";
import { logger } from "../lib/logger.server";
import { sendWebhook } from "../lib/webhooks.server";

/**
 * Type definitions for quiz submission
 */
interface QuestionOption {
  id: string;
  text: string;
  imageUrl: string | null;
  productMatching: string | null;
  order: number;
}

interface Question {
  id: string;
  text: string;
  type: string;
  order: number;
  options: QuestionOption[];
}

interface QuizWithQuestions {
  id: string;
  shop: string;
  title: string;
  description: string | null;
  status: string;
  settings: string | null;
  questions: Question[];
}

interface Answer {
  questionId: string;
  optionId: string;
}

interface ShopifyProductNode {
  id: string;
  title: string;
  handle: string;
  description: string | null;
  descriptionHtml: string | null;
  onlineStoreUrl: string | null;
  status: string;
  featuredImage: { url: string } | null;
  images: {
    edges: Array<{
      node: {
        url: string;
        altText: string | null;
      };
    }>;
  };
  priceRangeV2: {
    minVariantPrice: {
      amount: string;
      currencyCode: string;
    };
  };
  variants: {
    edges: Array<{
      node: {
        id: string;
      };
    }>;
  };
}

interface GraphQLResponse {
  data?: {
    products?: {
      edges?: Array<{
        node: ShopifyProductNode;
      }>;
    };
  };
  errors?: Array<{ message: string }>;
}

/**
 * Public API endpoint to submit quiz results from storefront
 *
 * This endpoint:
 * 1. Validates input (quiz ID, answers, email format)
 * 2. Applies rate limiting (5 submissions per minute per IP+quiz)
 * 3. Checks usage limits for the shop
 * 4. Saves quiz completion data (transactional)
 * 5. Generates product recommendations based on answers
 * 6. Updates analytics atomically
 * 7. Returns recommended products
 *
 * Security:
 * - Rate limited to prevent abuse
 * - CORS restricted to shop domain
 * - Input validation and sanitization
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  // Store shop domain for error responses (null until we load quiz)
  let shopDomain: string | null = null;

  try {
    const body = await request.json();
    const { quizId, email, answers, timing } = body;

    // Validate required fields
    if (!quizId || !answers || !Array.isArray(answers)) {
      return createCorsErrorResponse(request, null, "Quiz ID and answers are required", 400);
    }

    // Rate limiting: 5 submissions per minute per IP + quiz combination
    const clientIp = getClientIp(request);
    const rateLimitKey = `quiz-submit:${quizId}:${clientIp}`;
    if (!checkRateLimit(rateLimitKey, 5, 60000)) {
      return createRateLimitResponse(60);
    }

    // Validate answers array length to prevent abuse
    if (answers.length === 0 || answers.length > 50) {
      return createCorsErrorResponse(request, null, "Invalid number of answers. Must be between 1 and 50.", 400);
    }

    // Validate email format if provided
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return createCorsErrorResponse(request, null, "Invalid email format", 400);
      }
      
      // Sanitize email - trim and lowercase
      const sanitizedEmail = email.trim().toLowerCase();
      
      // Additional validation: max length
      if (sanitizedEmail.length > 254) {
        return createCorsErrorResponse(request, null, "Email address too long", 400);
      }
    }

    // Validate answer structure
    for (const answer of answers) {
      if (!answer.questionId || !answer.optionId) {
        return createCorsErrorResponse(request, null, "Each answer must have questionId and optionId", 400);
      }
    }

    // Verify quiz exists and is active
    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId, status: "active" },
      include: {
        questions: {
          include: {
            options: true,
          },
        },
      },
    });

    if (!quiz) {
      return createCorsErrorResponse(request, null, "Quiz not found or not active", 404);
    }

    // Store shop domain for CORS headers
    shopDomain = quiz.shop;

    // Check usage limits for this shop
    const usageCheck = await canCreateCompletion(quiz.shop);
    if (!usageCheck.allowed) {
      return Response.json(
        {
          error: "Usage limit reached",
          message: usageCheck.reason,
          currentUsage: usageCheck.currentUsage,
          limit: usageCheck.limit,
        },
        { 
          status: 429,
          headers: getCorsHeaders(request, shopDomain),
        }
      );
    }

    // Generate product recommendations based on answers
    const recommendedProducts = await generateRecommendations(quiz, answers, quiz.shop);

    // Use sanitized email if provided
    const finalEmail = email ? email.trim().toLowerCase() : null;

    // Save quiz result and update analytics in a transaction for atomicity
    // This ensures both operations succeed or both fail - prevents inconsistent state
    // Timeout increased to 10s to handle slow operations (default 5s was too short)
    const result = await prisma.$transaction(async (tx) => {
      // Create quiz result
      const quizResult = await tx.quizResult.create({
        data: {
          quizId,
          email: finalEmail,
          answers: JSON.stringify(answers),
          recommendedProducts: JSON.stringify(recommendedProducts),
          startedAt: timing?.quizStartTime ? new Date(timing.quizStartTime) : null,
          completionTimeSeconds: timing?.totalTimeSeconds || null,
          advancedTracking: timing ? JSON.stringify({
            questionTiming: timing.questionTiming || {},
            totalTimeSeconds: timing.totalTimeSeconds,
          }) : null,
        },
      });

      // Update question-level analytics
      if (timing?.questionTiming) {
        for (const [questionId, timeSpent] of Object.entries(timing.questionTiming)) {
          await tx.questionAnalytics.upsert({
            where: { questionId },
            update: {
              views: { increment: 1 },
              completions: { increment: 1 },
              averageTime: {
                set: await tx.questionAnalytics.findUnique({
                  where: { questionId },
                  select: { averageTime: true, completions: true }
                }).then(existing => {
                  if (!existing) return timeSpent as number;
                  const currentAvg = existing.averageTime || 0;
                  const newCount = existing.completions + 1;
                  return ((currentAvg * existing.completions) + (timeSpent as number)) / newCount;
                })
              }
            },
            create: {
              questionId,
              views: 1,
              completions: 1,
              averageTime: timeSpent as number,
            },
          });
        }
      }

      // Update analytics atomically
      await tx.quizAnalytics.update({
        where: { quizId },
        data: {
          totalCompletions: {
            increment: 1,
          },
          emailCaptureCount: finalEmail ? {
            increment: 1,
          } : undefined,
        },
      });

      return quizResult;
    }, {
      timeout: 10000, // 10 seconds (default is 5s)
    });

    // Update advanced analytics after transaction
    try {
      await updateAdvancedAnalytics(quizId, timing);
    } catch (error) {
      // Advanced analytics failure is non-critical - don't fail the submission
      console.error('Failed to update advanced analytics:', error);
    }

    // Increment completion count for billing tracking AFTER transaction
    // SQLite can't handle concurrent writes, so this must be outside the transaction
    try {
      await incrementCompletionCount(quiz.shop);
    } catch {
      // Billing update failure is non-critical - don't fail the submission
    }

    // Send quiz completed webhook (non-blocking)
    sendWebhook(quiz.shop, 'quiz_completed', quizId, {
      email: finalEmail,
      answersCount: answers.length,
      recommendedProductsCount: recommendedProducts.length,
      totalTimeSeconds: timing?.totalTimeSeconds,
      quizTitle: quiz.title,
    });

    return Response.json(
      {
        success: true,
        resultId: result.id,
        recommendedProducts,
      },
      {
        headers: getCorsHeaders(request, shopDomain!),
      }
    );
  } catch (error) {
    // Return error with safe CORS headers
    return createCorsErrorResponse(request, shopDomain, "Failed to submit quiz", 500);
  }
};

/**
 * Update advanced analytics metrics after quiz completion
 */
async function updateAdvancedAnalytics(quizId: string, timing?: any) {
  try {
    // Get current analytics
    const currentAnalytics = await prisma.quizAnalytics.findUnique({
      where: { quizId },
    });

    if (!currentAnalytics) return;

    // Calculate advanced metrics
    const results = await prisma.quizResult.findMany({
      where: { quizId },
      select: {
        completionTimeSeconds: true,
        advancedTracking: true,
        answers: true,
      },
      orderBy: { completedAt: 'desc' },
      take: 1000, // Analyze last 1000 completions for performance
    });

    // Calculate average completion time
    const completionTimes = results
      .map(r => r.completionTimeSeconds)
      .filter(t => t !== null) as number[];
    const averageCompletionTime = completionTimes.length > 0
      ? completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length
      : null;

    // Calculate drop-off analysis
    const questionIds = await prisma.question.findMany({
      where: { quizId },
      select: { id: true, order: true },
      orderBy: { order: 'asc' },
    });

    const dropOffPoints: Record<string, number> = {};
    questionIds.forEach(q => {
      dropOffPoints[q.id] = 0;
    });

    // Count completions that stopped at each question
    results.forEach(result => {
      const answers = JSON.parse(result.answers);
      if (answers.length < questionIds.length) {
        // User didn't complete all questions
        const lastQuestionIndex = answers.length - 1;
        if (lastQuestionIndex >= 0 && questionIds[lastQuestionIndex]) {
          dropOffPoints[questionIds[lastQuestionIndex].id]++;
        }
      }
    });

    // Calculate conversion funnel (simplified)
    const totalViews = currentAnalytics.totalViews;
    const totalCompletions = currentAnalytics.totalCompletions;
    const conversionFunnel = {
      started: totalViews,
      completed: totalCompletions,
      completionRate: totalViews > 0 ? (totalCompletions / totalViews) * 100 : 0,
    };

    // Update advanced metrics
    await prisma.quizAnalytics.update({
      where: { quizId },
      data: {
        advancedMetrics: JSON.stringify({
          averageCompletionTime,
          dropOffPoints,
          conversionFunnel,
          questionMetrics: {}, // Will be populated from QuestionAnalytics
          timeBasedMetrics: {}, // TODO: Add time-based analysis
          userSegments: {}, // TODO: Add user segmentation
          lastUpdated: new Date().toISOString(),
        }),
      },
    });

  } catch (error) {
    console.error('Error updating advanced analytics:', error);
    // Don't throw - advanced analytics failure shouldn't break quiz submission
  }
}

/**
 * Extract price range from option text
 * Supports formats like:
 * - "Under $50" -> { max: 50 }
 * - "$50-$100" -> { min: 50, max: 100 }
 * - "Over $200" -> { min: 200 }
 * - "Less than $75" -> { max: 75 }
 * - "$100+" -> { min: 100 }
 * 
 * @param text - Option text to parse
 * @returns Object with min/max price or null if no price found
 */
function extractPriceRange(text: string): { min?: number; max?: number } | null {
  // Remove currency symbols and normalize
  const normalized = text.toLowerCase().trim();
  
  // Pattern: "Under $50", "Under 50", "< $50", "Less than $50"
  const underMatch = normalized.match(/(?:under|less than|below|<)\s*\$?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/);
  if (underMatch) {
    const max = parseFloat(underMatch[1].replace(/,/g, ''));
    return { max };
  }
  
  // Pattern: "Over $200", "Above $200", "> $200", "$200+"
  const overMatch = normalized.match(/(?:over|above|more than|>)\s*\$?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/);
  if (overMatch) {
    const min = parseFloat(overMatch[1].replace(/,/g, ''));
    return { min };
  }
  
  // Pattern: "$50+" or "50+"
  const plusMatch = normalized.match(/\$?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)\s*\+/);
  if (plusMatch) {
    const min = parseFloat(plusMatch[1].replace(/,/g, ''));
    return { min };
  }
  
  // Pattern: "$50-$100", "$50 - $100", "50-100"
  const rangeMatch = normalized.match(/\$?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)\s*[-–—]\s*\$?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/);
  if (rangeMatch) {
    const min = parseFloat(rangeMatch[1].replace(/,/g, ''));
    const max = parseFloat(rangeMatch[2].replace(/,/g, ''));
    return { min, max };
  }
  
  return null;
}

/**
 * Generate product recommendations based on quiz answers
 *
 * This analyzes the user's answers and matches them against
 * product tags/types defined in the question options.
 *
 * @param quiz - The quiz object with questions and options
 * @param answers - Array of user answers
 * @param shop - Shop domain for unauthenticated API access
 * @returns Array of recommended products with details
 *
 * NOTE: Uses unauthenticated.admin() because this is called from PUBLIC storefront API
 *       Cannot use authenticate.admin(request) as there's no admin session from storefront
 * TODO: Add inventory checking - don't recommend out-of-stock products
 * TODO: Add product ranking/scoring algorithm (match strength, popularity, margin)
 * TODO: Cache product data to reduce GraphQL API calls (Redis/in-memory)
 * TODO: Add A/B testing for different recommendation algorithms
 */
async function generateRecommendations(quiz: QuizWithQuestions, answers: Answer[], shop: string) {
  const log = logger.child({ shop, quizId: quiz.id, module: "recommendations" });
  
  // Collect all matching tags, types, and exact product IDs from selected options
  const matchingTags = new Set<string>();
  const matchingTypes = new Set<string>();
  const exactProductIds = new Set<string>();
  let maxPrice: number | null = null;
  let minPrice: number | null = null;

  log.debug("Starting recommendation generation", { quizTitle: quiz.title, answersCount: answers.length });

  answers.forEach((answer) => {
    // Find the selected option
    const question = quiz.questions.find((q: Question) => q.id === answer.questionId);
    if (!question) {
      log.debug("Question not found for answer", { answer });
      return;
    }

    const option = question.options.find((o: QuestionOption) => o.id === answer.optionId);
    if (!option) {
      log.debug("Option not found", { optionId: answer.optionId });
      return;
    }
    
    log.debug("Processing option", { optionText: option.text, hasProductMatching: !!option.productMatching });
    
    // Check if this is a budget/price question
    const isBudgetQuestion = /budget|price|spend|cost|afford|willing to pay/i.test(question.text);
    if (isBudgetQuestion) {
      log.debug("Detected budget question", { questionText: question.text });
      const priceRange = extractPriceRange(option.text);
      if (priceRange) {
        if (priceRange.min !== undefined) {
          minPrice = priceRange.min;
        }
        if (priceRange.max !== undefined) {
          maxPrice = priceRange.max;
        }
        log.debug("Extracted price range", { optionText: option.text, minPrice, maxPrice });
      }
    }
    
    if (!option.productMatching) {
      log.debug("No productMatching data for option", { optionText: option.text });
      return;
    }

    // Parse productMatching safely - wrapped in try-catch to prevent crashes
    try {
      const productMatching = JSON.parse(option.productMatching);

      // Prioritize exact product IDs (Advanced Product Matching)
      if (productMatching.productIds && Array.isArray(productMatching.productIds)) {
        productMatching.productIds.forEach((id: string) => exactProductIds.add(id));
        log.debug("Added exact product IDs", { count: productMatching.productIds.length });
      }

      // Add tags and types to our sets
      if (productMatching.tags) {
        productMatching.tags.forEach((tag: string) => matchingTags.add(tag));
      }
      if (productMatching.types) {
        productMatching.types.forEach((type: string) => matchingTypes.add(type));
      }
    } catch (error) {
      log.error("Error parsing productMatching", error, { optionId: option.id });
      // Skip this option and continue with others
    }
  });

  log.debug("Final matching criteria", {
    exactProductIds: exactProductIds.size,
    matchingTags: matchingTags.size,
    matchingTypes: matchingTypes.size,
    priceFilter: { minPrice, maxPrice },
  });

  // If exact product IDs are specified, query those first
  if (exactProductIds.size > 0) {
    log.debug("Using exact product ID matching");
    try {
      const { admin } = await unauthenticated.admin(shop);
      
      // Query by exact product IDs
      const productIdQuery = Array.from(exactProductIds)
        .map(id => `id:${id}`)
        .join(" OR ");

      const response = await admin.graphql(
        `#graphql
          query getExactProducts($query: String!) {
            products(first: 10, query: $query) {
              edges {
                node {
                  id
                  title
                  handle
                  description
                  descriptionHtml
                  onlineStoreUrl
                  featuredImage {
                    url
                  }
                  images(first: 5) {
                    edges {
                      node {
                        url
                        altText
                      }
                    }
                  }
                  priceRangeV2 {
                    minVariantPrice {
                      amount
                      currencyCode
                    }
                  }
                  status
                  variants(first: 1) {
                    edges {
                      node {
                        id
                      }
                    }
                  }
                }
              }
            }
          }
        `,
        {
          variables: { query: productIdQuery },
        }
      );

      const productsData = await response.json();
      const exactProducts = (productsData.data?.products?.edges
        ?.map((edge: { node: ShopifyProductNode }) => edge.node)
        .filter((product: ShopifyProductNode) => product.status === 'ACTIVE') || []) as ShopifyProductNode[];

      if (exactProducts.length > 0) {
        log.info("Found exact product matches", { count: exactProducts.length });
        return exactProducts.map((product: ShopifyProductNode) => ({
          id: product.id,
          variantId: product.variants?.edges?.[0]?.node?.id || null,
          title: product.title,
          handle: product.handle,
          description: product.description || '',
          descriptionHtml: product.descriptionHtml || '',
          price: `${product.priceRangeV2.minVariantPrice.currencyCode} ${parseFloat(
            product.priceRangeV2.minVariantPrice.amount
          ).toFixed(2)}`,
          imageUrl: product.featuredImage?.url || "https://via.placeholder.com/200",
          images: product.images?.edges?.map((edge: { node: { url: string; altText: string | null } }) => ({
            url: edge.node.url,
            altText: edge.node.altText || product.title,
          })) || [],
          url: product.onlineStoreUrl || `/products/${product.handle}`,
        }));
      }
    } catch (error) {
      log.error("Error fetching exact products", error);
      // Fall through to tag/type matching
    }
  }

  // Query Shopify for products matching the collected criteria
  try {
    // Using unauthenticated.admin() for public API access
    // This is a PUBLIC endpoint called from storefront, not an authenticated admin session
    const { admin } = await unauthenticated.admin(shop);

    // Build search query
    const queryParts: string[] = [];

    // Add tag-based filtering
    if (matchingTags.size > 0) {
      const tagQuery = Array.from(matchingTags)
        .map((tag) => `tag:'${tag}'`)
        .join(" OR ");
      if (tagQuery) queryParts.push(`(${tagQuery})`);
    }

    // Add product type filtering
    if (matchingTypes.size > 0) {
      const typeQuery = Array.from(matchingTypes)
        .map((type) => `product_type:'${type}'`)
        .join(" OR ");
      if (typeQuery) queryParts.push(`(${typeQuery})`);
    }

    // Add price filtering if available
    // Shopify search query syntax: variants.price:>=50 variants.price:<=100
    if (minPrice !== null && maxPrice !== null) {
      queryParts.push(`variants.price:>=${minPrice} variants.price:<=${maxPrice}`);
      log.debug("Adding price filter range", { minPrice, maxPrice });
    } else if (minPrice !== null) {
      queryParts.push(`variants.price:>=${minPrice}`);
      log.debug("Adding min price filter", { minPrice });
    } else if (maxPrice !== null) {
      queryParts.push(`variants.price:<=${maxPrice}`);
      log.debug("Adding max price filter", { maxPrice });
    }

    const searchQuery = queryParts.length > 0 ? queryParts.join(" AND ") : "*";
    log.debug("Final search query", { searchQuery });

    // Query products from Shopify
    const productsResponse = await admin.graphql(
      `#graphql
        query getRecommendedProducts($query: String!) {
          products(first: 10, query: $query) {
            edges {
              node {
                id
                title
                handle
                description
                descriptionHtml
                onlineStoreUrl
                featuredImage {
                  url
                }
                images(first: 5) {
                  edges {
                    node {
                      url
                      altText
                    }
                  }
                }
                priceRangeV2 {
                  minVariantPrice {
                    amount
                    currencyCode
                  }
                }
                status
                variants(first: 1) {
                  edges {
                    node {
                      id
                    }
                  }
                }
              }
            }
          }
        }
      `,
      {
        variables: { query: searchQuery },
      }
    );

    const productsData = await productsResponse.json() as GraphQLResponse;

    log.debug("GraphQL response received", { hasData: !!productsData.data });

    // Check for GraphQL errors
    if (productsData.errors) {
      log.error("GraphQL errors", { errors: productsData.errors });
      throw new Error("Failed to fetch products from Shopify");
    }

    const products =
      (productsData.data?.products?.edges?.map((edge: { node: ShopifyProductNode }) => edge.node) || []) as ShopifyProductNode[];

    log.debug("Products found", { total: products.length });

    // Filter to only active products (ACTIVE status means available for sale)
    let availableProducts = products.filter(
      (product: ShopifyProductNode) => product.status === 'ACTIVE'
    );

    log.debug("Available products after status filter", { count: availableProducts.length });
    
    // Apply client-side price filtering as additional safety layer
    // This ensures accurate filtering even if Shopify search query doesn't work perfectly
    if (minPrice !== null || maxPrice !== null) {
      availableProducts = availableProducts.filter((product: ShopifyProductNode) => {
        const price = parseFloat(product.priceRangeV2.minVariantPrice.amount);
        
        if (minPrice !== null && price < minPrice) {
          log.debug("Filtered out product - below min price", { title: product.title, price, minPrice });
          return false;
        }
        
        if (maxPrice !== null && price > maxPrice) {
          log.debug("Filtered out product - above max price", { title: product.title, price, maxPrice });
          return false;
        }
        
        log.debug("Product passed price filter", { title: product.title, price });
        return true;
      });
      
      log.debug("Products after price filtering", { count: availableProducts.length });
    }

    // If we have matching products, return them
    if (availableProducts.length > 0) {
      // Return top 3-6 products with full details for hover interactions
      return availableProducts.slice(0, 6).map((product: ShopifyProductNode) => ({
        id: product.id,
        variantId: product.variants?.edges?.[0]?.node?.id || null,
        title: product.title,
        handle: product.handle,
        description: product.description || '',
        descriptionHtml: product.descriptionHtml || '',
        price: `${product.priceRangeV2.minVariantPrice.currencyCode} ${parseFloat(
          product.priceRangeV2.minVariantPrice.amount
        ).toFixed(2)}`,
        imageUrl: product.featuredImage?.url || "https://via.placeholder.com/200",
        images: product.images?.edges?.map((edge: { node: { url: string; altText: string | null } }) => ({
          url: edge.node.url,
          altText: edge.node.altText || product.title,
        })) || [],
        url: product.onlineStoreUrl || `/products/${product.handle}`,
      }));
    }

    log.info("No products matched criteria, fetching fallback products");

    // Fallback: If no products match, get some products without strict filtering
    // Remove price filter and try with just tags/types, or get any active products
    try {
      const fallbackResponse = await admin.graphql(
        `#graphql
          query getFallbackProducts {
            products(first: 6, query: "status:active") {
              edges {
                node {
                  id
                  title
                  handle
                  description
                  descriptionHtml
                  onlineStoreUrl
                  featuredImage {
                    url
                  }
                  images(first: 5) {
                    edges {
                      node {
                        url
                        altText
                      }
                    }
                  }
                  priceRangeV2 {
                    minVariantPrice {
                      amount
                      currencyCode
                    }
                  }
                  status
                  variants(first: 1) {
                    edges {
                      node {
                        id
                      }
                    }
                  }
                }
              }
            }
          }
        `
      );

      const fallbackData = await fallbackResponse.json() as GraphQLResponse;
      
      if (fallbackData.errors) {
        log.error("GraphQL errors in fallback query", { errors: fallbackData.errors });
        throw new Error("Failed to fetch fallback products");
      }

      const fallbackProducts =
        (fallbackData.data?.products?.edges
          ?.map((edge: { node: ShopifyProductNode }) => edge.node)
          .filter((product: ShopifyProductNode) => product.status === 'ACTIVE') || []) as ShopifyProductNode[];

      if (fallbackProducts.length > 0) {
        log.info("Returning fallback products", { count: fallbackProducts.length });
        return fallbackProducts.map((product: ShopifyProductNode) => ({
          id: product.id,
          variantId: product.variants?.edges?.[0]?.node?.id || null,
          title: product.title,
          handle: product.handle,
          description: product.description || '',
          descriptionHtml: product.descriptionHtml || '',
          price: `${product.priceRangeV2.minVariantPrice.currencyCode} ${parseFloat(
            product.priceRangeV2.minVariantPrice.amount
          ).toFixed(2)}`,
          imageUrl: product.featuredImage?.url || "https://via.placeholder.com/200",
          images: product.images?.edges?.map((edge: { node: { url: string; altText: string | null } }) => ({
            url: edge.node.url,
            altText: edge.node.altText || product.title,
          })) || [],
          url: product.onlineStoreUrl || `/products/${product.handle}`,
        }));
      }
    } catch (fallbackError) {
      // Continue to return empty array below
    }

    // Last resort: return empty array
    return [];
  } catch {
    // Return empty array instead of crashing
    return [];
  }
}

// Handle CORS preflight
// NOTE: For preflight, we allow myshopify.com domains broadly since we don't know the quiz yet.
// The actual POST request has stricter shop-specific CORS validation.
export const loader = async ({ request }: { request: Request }) => {
  const origin = request.headers.get("Origin") || "";
  
  // Only allow Shopify storefront origins for preflight
  const isShopifyDomain = origin.endsWith(".myshopify.com");
  
  // For preflight, be more permissive but still exclude non-https origins
  let allowOrigin = origin;
  if (!isShopifyDomain) {
    try {
      const originUrl = new URL(origin);
      // Allow https custom domains (could be custom storefront domains)
      if (originUrl.protocol !== "https:") {
        allowOrigin = "https://example.myshopify.com"; // Safe fallback
      }
    } catch {
      allowOrigin = "https://example.myshopify.com"; // Invalid origin
    }
  }
  
  return Response.json(
    {},
    {
      headers: {
        "Access-Control-Allow-Origin": allowOrigin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Credentials": "true",
      },
    }
  );
};
