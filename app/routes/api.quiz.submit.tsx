import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { canCreateCompletion, incrementCompletionCount } from "../lib/billing.server";
import { unauthenticated } from "../shopify.server";

/**
 * Public API endpoint to submit quiz results from storefront
 *
 * This endpoint:
 * 1. Validates input (quiz ID, answers, email format)
 * 2. Checks usage limits for the shop
 * 3. Saves quiz completion data (transactional)
 * 4. Generates product recommendations based on answers
 * 5. Updates analytics atomically
 * 6. Returns recommended products
 *
 * TODO: Add rate limiting to prevent abuse (e.g., 10 submissions per minute per IP)
 * TODO: Add request signature validation to verify requests come from authorized storefronts
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const body = await request.json();
    const { quizId, email, answers } = body;

    // Validate required fields
    if (!quizId || !answers || !Array.isArray(answers)) {
      return Response.json(
        { error: "Quiz ID and answers are required" },
        { status: 400 }
      );
    }

    // Validate answers array length to prevent abuse
    if (answers.length === 0 || answers.length > 50) {
      return Response.json(
        { error: "Invalid number of answers. Must be between 1 and 50." },
        { status: 400 }
      );
    }

    // Validate email format if provided
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return Response.json(
          { error: "Invalid email format" },
          { status: 400 }
        );
      }
      
      // Sanitize email - trim and lowercase
      const sanitizedEmail = email.trim().toLowerCase();
      
      // Additional validation: max length
      if (sanitizedEmail.length > 254) {
        return Response.json(
          { error: "Email address too long" },
          { status: 400 }
        );
      }
    }

    // Validate answer structure
    for (const answer of answers) {
      if (!answer.questionId || !answer.optionId) {
        return Response.json(
          { error: "Each answer must have questionId and optionId" },
          { status: 400 }
        );
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
      return Response.json(
        { error: "Quiz not found or not active" },
        { status: 404 }
      );
    }

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
        { status: 429 }
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
        },
      });

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

    // Increment completion count for billing tracking AFTER transaction
    // SQLite can't handle concurrent writes, so this must be outside the transaction
    try {
      await incrementCompletionCount(quiz.shop);
    } catch (billingError) {
      // Log but don't fail the quiz submission if billing update fails
      console.error("Failed to update billing count:", billingError);
    }

    // Get shop domain for CORS - restrict to actual shop only, not wildcard
    const shopDomain = `https://${quiz.shop}`;

    return Response.json(
      {
        success: true,
        resultId: result.id,
        recommendedProducts,
      },
      {
        headers: {
          "Access-Control-Allow-Origin": shopDomain,
          "Access-Control-Allow-Credentials": "true",
        },
      }
    );
  } catch (error: any) {
    console.error("Error submitting quiz:", error);
    return Response.json(
      { error: "Failed to submit quiz" },
      { 
        status: 500,
        headers: {
          "Access-Control-Allow-Origin": "*", // Allow error responses from any origin
        },
      }
    );
  }
};

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
async function generateRecommendations(quiz: any, answers: any[], shop: string) {
  // Collect all matching tags, types, and exact product IDs from selected options
  const matchingTags = new Set<string>();
  const matchingTypes = new Set<string>();
  const exactProductIds = new Set<string>();
  let maxPrice: number | null = null;
  let minPrice: number | null = null;

  console.log("=== RECOMMENDATION DEBUG ===");
  console.log("Quiz:", quiz.title);
  console.log("Total answers:", answers.length);

  answers.forEach((answer) => {
    // Find the selected option
    const question = quiz.questions.find((q: any) => q.id === answer.questionId);
    if (!question) {
      console.log("Question not found for answer:", answer);
      return;
    }

    const option = question.options.find((o: any) => o.id === answer.optionId);
    if (!option) {
      console.log("Option not found:", answer.optionId);
      return;
    }
    
    console.log("Processing option:", option.text, "productMatching:", option.productMatching);
    
    // Check if this is a budget/price question
    const isBudgetQuestion = /budget|price|spend|cost|afford|willing to pay/i.test(question.text);
    if (isBudgetQuestion) {
      console.log("💰 Detected budget question:", question.text);
      const priceRange = extractPriceRange(option.text);
      if (priceRange) {
        if (priceRange.min !== undefined) {
          minPrice = priceRange.min;
        }
        if (priceRange.max !== undefined) {
          maxPrice = priceRange.max;
        }
        console.log(`💵 Extracted price range from "${option.text}":`, { minPrice, maxPrice });
      }
    }
    
    if (!option.productMatching) {
      console.log("⚠️ No productMatching data for option:", option.text);
      return;
    }

    // Parse productMatching safely - wrapped in try-catch to prevent crashes
    try {
      const productMatching = JSON.parse(option.productMatching);
      console.log("Parsed productMatching:", productMatching);

      // Prioritize exact product IDs (Advanced Product Matching)
      if (productMatching.productIds && Array.isArray(productMatching.productIds)) {
        productMatching.productIds.forEach((id: string) => exactProductIds.add(id));
        console.log("✅ Added exact product IDs:", productMatching.productIds);
      }

      // Add tags and types to our sets
      if (productMatching.tags) {
        productMatching.tags.forEach((tag: string) => matchingTags.add(tag));
        console.log("Added tags:", productMatching.tags);
      }
      if (productMatching.types) {
        productMatching.types.forEach((type: string) => matchingTypes.add(type));
        console.log("Added types:", productMatching.types);
      }
    } catch (error) {
      console.error(
        "❌ Error parsing productMatching for option:",
        option.id,
        "Data:",
        option.productMatching,
        error
      );
      // Skip this option and continue with others
    }
  });

  console.log("Final exactProductIds:", Array.from(exactProductIds));
  console.log("Final matchingTags:", Array.from(matchingTags));
  console.log("Final matchingTypes:", Array.from(matchingTypes));
  console.log("Final price filter:", { minPrice, maxPrice });

  // If exact product IDs are specified, query those first
  if (exactProductIds.size > 0) {
    console.log("🎯 Using exact product ID matching (Advanced Product Matching)");
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
      const exactProducts = productsData.data?.products?.edges
        ?.map((edge: any) => edge.node)
        .filter((product: any) => product.status === 'ACTIVE') || [];

      if (exactProducts.length > 0) {
        console.log(`✅ Found ${exactProducts.length} exact product matches`);
        return exactProducts.map((product: any) => ({
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
          images: product.images?.edges?.map((edge: any) => ({
            url: edge.node.url,
            altText: edge.node.altText || product.title,
          })) || [],
          url: product.onlineStoreUrl || `/products/${product.handle}`,
        }));
      }
    } catch (error) {
      console.error("❌ Error fetching exact products:", error);
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
      console.log(`💰 Adding price filter: $${minPrice}-$${maxPrice}`);
    } else if (minPrice !== null) {
      queryParts.push(`variants.price:>=${minPrice}`);
      console.log(`💰 Adding min price filter: $${minPrice}+`);
    } else if (maxPrice !== null) {
      queryParts.push(`variants.price:<=${maxPrice}`);
      console.log(`💰 Adding max price filter: up to $${maxPrice}`);
    }

    const searchQuery = queryParts.length > 0 ? queryParts.join(" AND ") : "*";
    console.log("🔍 Final search query:", searchQuery);

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

    const productsData = await productsResponse.json();

    console.log("GraphQL Response:", JSON.stringify(productsData, null, 2));

    // Check for GraphQL errors
    if (productsData.errors) {
      console.error("GraphQL errors:", productsData.errors);
      throw new Error("Failed to fetch products from Shopify");
    }

    const products =
      productsData.data?.products?.edges?.map((edge: any) => edge.node) || [];

    console.log("Total products found:", products.length);

    // Filter to only active products (ACTIVE status means available for sale)
    let availableProducts = products.filter(
      (product: any) => product.status === 'ACTIVE'
    );

    console.log("Available products:", availableProducts.length);
    
    // Apply client-side price filtering as additional safety layer
    // This ensures accurate filtering even if Shopify search query doesn't work perfectly
    if (minPrice !== null || maxPrice !== null) {
      availableProducts = availableProducts.filter((product: any) => {
        const price = parseFloat(product.priceRangeV2.minVariantPrice.amount);
        
        if (minPrice !== null && price < minPrice) {
          console.log(`❌ Filtered out ${product.title} - price $${price} below min $${minPrice}`);
          return false;
        }
        
        if (maxPrice !== null && price > maxPrice) {
          console.log(`❌ Filtered out ${product.title} - price $${price} above max $${maxPrice}`);
          return false;
        }
        
        console.log(`✅ ${product.title} - price $${price} within range`);
        return true;
      });
      
      console.log("Products after price filtering:", availableProducts.length);
    }

    // If we have matching products, return them
    if (availableProducts.length > 0) {
      // Return top 3-6 products with full details for hover interactions
      return availableProducts.slice(0, 6).map((product: any) => ({
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
        images: product.images?.edges?.map((edge: any) => ({
          url: edge.node.url,
          altText: edge.node.altText || product.title,
        })) || [],
        url: product.onlineStoreUrl || `/products/${product.handle}`,
      }));
    }

    console.log("⚠️ No products matched criteria, fetching fallback products");

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

      const fallbackData = await fallbackResponse.json();
      
      if (fallbackData.errors) {
        console.error("GraphQL errors in fallback:", fallbackData.errors);
        throw new Error("Failed to fetch fallback products");
      }

      const fallbackProducts =
        fallbackData.data?.products?.edges
          ?.map((edge: any) => edge.node)
          .filter((product: any) => product.status === 'ACTIVE') || [];

      if (fallbackProducts.length > 0) {
        console.log(`✅ Returning ${fallbackProducts.length} fallback products`);
        return fallbackProducts.map((product: any) => ({
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
          images: product.images?.edges?.map((edge: any) => ({
            url: edge.node.url,
            altText: edge.node.altText || product.title,
          })) || [],
          url: product.onlineStoreUrl || `/products/${product.handle}`,
        }));
      }
    } catch (fallbackError) {
      console.error("❌ Fallback query failed:", fallbackError);
      // Continue to return empty array below
    }

    // Last resort: return empty array with helpful message
    console.log("⚠️ No products available to recommend - returning empty array");
    return [];
  } catch (error) {
    console.error("Error fetching product recommendations:", error);
    // Return empty array instead of crashing
    return [];
  }
}

// Handle CORS preflight
// NOTE: Preflight requests don't have quiz context, so we allow all origins for OPTIONS
// Actual POST requests are restricted to shop domain in the action handler
export const loader = async ({ request }: { request: Request }) => {
  const origin = request.headers.get("Origin") || "";
  
  // Check if origin is a valid Shopify shop domain
  const isShopifyDomain = origin.endsWith(".myshopify.com") || 
                          origin.includes("shopify.com");
  
  return Response.json(
    {},
    {
      headers: {
        "Access-Control-Allow-Origin": isShopifyDomain ? origin : "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Credentials": "true",
      },
    }
  );
};
