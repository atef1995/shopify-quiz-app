import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { canCreateCompletion, incrementCompletionCount } from "../lib/billing.server";
import { unauthenticated } from "../shopify.server";

/**
 * Public API endpoint to submit quiz results from storefront
 *
 * This endpoint:
 * 1. Checks usage limits for the shop
 * 2. Saves quiz completion data
 * 3. Generates product recommendations based on answers
 * 4. Updates analytics
 * 5. Returns recommended products
 *
 * TODO: Add rate limiting to prevent abuse (e.g., 10 submissions per minute per IP)
 * TODO: Add request signature validation to verify requests come from authorized storefronts
 * BUG: CORS is set to "*" which could allow unauthorized domains to call this API
 *      Consider restricting to shop domains only or using shop-specific tokens
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

      // Increment completion count for billing tracking (atomic)
      await incrementCompletionCount(quiz.shop);

      return quizResult;
    });

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
 * TODO: Add price range filtering based on budget question answers
 * TODO: Add inventory checking - don't recommend out-of-stock products
 * TODO: Add product ranking/scoring algorithm (match strength, popularity, margin)
 * TODO: Cache product data to reduce GraphQL API calls (Redis/in-memory)
 * TODO: Add A/B testing for different recommendation algorithms
 */
async function generateRecommendations(quiz: any, answers: any[], shop: string) {
  // Collect all matching tags and types from selected options
  const matchingTags = new Set<string>();
  const matchingTypes = new Set<string>();
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
    
    if (!option.productMatching) {
      console.log("⚠️ No productMatching data for option:", option.text);
      return;
    }

    // Parse productMatching safely - wrapped in try-catch to prevent crashes
    try {
      const productMatching = JSON.parse(option.productMatching);
      console.log("Parsed productMatching:", productMatching);

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

    // TODO: Extract price range from budget question answers
    // Example: if answer.optionText === "Under $50", set maxPrice = 50
    // This requires identifying which question is the budget question
  });

  console.log("Final matchingTags:", Array.from(matchingTags));
  console.log("Final matchingTypes:", Array.from(matchingTypes));

  // Query Shopify for products matching the collected criteria
  try {
    // FIXME: Use unauthenticated.admin() with offline session token for public API
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
    // TODO: Extract price from budget question answer
    // For now, we'll fetch products without price filter

    const searchQuery = queryParts.length > 0 ? queryParts.join(" AND ") : "*";

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
                onlineStoreUrl
                featuredImage {
                  url
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
    const availableProducts = products.filter(
      (product: any) => product.status === 'ACTIVE'
    );

    console.log("Available products:", availableProducts.length);

    // If we have matching products, return them
    if (availableProducts.length > 0) {
      // Return top 3-6 products with variant ID for cart functionality
      return availableProducts.slice(0, 6).map((product: any) => ({
        id: product.id,
        variantId: product.variants?.edges?.[0]?.node?.id || null,
        title: product.title,
        handle: product.handle,
        price: `${product.priceRangeV2.minVariantPrice.currencyCode} ${parseFloat(
          product.priceRangeV2.minVariantPrice.amount
        ).toFixed(2)}`,
        imageUrl: product.featuredImage?.url || "https://via.placeholder.com/200",
        url: product.onlineStoreUrl || `/products/${product.handle}`,
      }));
    }

    // Fallback: If no products match, get some popular products
    // TODO: Define what "popular" means (most sold, highest rated, etc.)
    const fallbackResponse = await admin.graphql(
      `#graphql
        query getFallbackProducts {
          products(first: 6, sortKey: BEST_SELLING) {
            edges {
              node {
                id
                title
                handle
                onlineStoreUrl
                featuredImage {
                  url
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
    const fallbackProducts =
      fallbackData.data?.products?.edges
        ?.map((edge: any) => edge.node)
        .filter((product: any) => product.status === 'ACTIVE') || [];

    if (fallbackProducts.length > 0) {
      return fallbackProducts.map((product: any) => ({
        id: product.id,
        variantId: product.variants?.edges?.[0]?.node?.id || null,
        title: product.title,
        handle: product.handle,
        price: `${product.priceRangeV2.minVariantPrice.currencyCode} ${parseFloat(
          product.priceRangeV2.minVariantPrice.amount
        ).toFixed(2)}`,
        imageUrl: product.featuredImage?.url || "https://via.placeholder.com/200",
        url: product.onlineStoreUrl || `/products/${product.handle}`,
      }));
    }

    // Last resort: return empty array
    // TODO: Show a friendly message to merchant to add products
    return [];
  } catch (error) {
    console.error("Error fetching product recommendations:", error);
    // TODO: Log this error to monitoring service
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
