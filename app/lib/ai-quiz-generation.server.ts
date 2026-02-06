import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { logger } from "./logger.server";

/**
 * GraphQL query for fetching products from Shopify
 */
const PRODUCTS_QUERY = `#graphql
  query getProducts($first: Int!) {
    products(first: $first) {
      edges {
        node {
          id
          title
          description
          productType
          tags
          vendor
          variants(first: 1) {
            edges {
              node {
                price
              }
            }
          }
        }
      }
    }
  }
`;

export interface ProductNode {
  id: string;
  title: string;
  description?: string;
  productType?: string;
  tags?: string[];
  vendor?: string;
  variants?: {
    edges?: Array<{
      node?: {
        price?: string;
      };
    }>;
  };
}

export interface FetchProductsResult {
  success: boolean;
  products: ProductNode[];
  error?: string;
}

/**
 * Fetch products from Shopify for AI quiz generation
 * 
 * @param admin - Shopify Admin API context
 * @param shop - Shop domain for logging
 * @param productLimit - Maximum number of products to fetch (default: 50, max: 100)
 * @returns Products array or error
 */
export async function fetchProductsForAI(
  admin: AdminApiContext,
  shop: string,
  productLimit: number = 50
): Promise<FetchProductsResult> {
  const log = logger.child({ shop, module: "ai-quiz-generation" });
  
  try {
    // Cap product limit between 10 and 100
    const limit = Math.max(10, Math.min(productLimit, 100));
    
    log.debug("Fetching products from Shopify", { limit });
    
    const productsResponse = await admin.graphql(PRODUCTS_QUERY, {
      variables: { first: limit },
    });

    const productsData = await productsResponse.json() as {
      errors?: Array<{ message: string }>;
      data?: {
        products?: {
          edges?: Array<{ node: ProductNode }>;
        };
      };
    };

    if (productsData.errors) {
      log.error("GraphQL errors fetching products", { errors: productsData.errors });
      return {
        success: false,
        products: [],
        error: productsData.errors[0]?.message || "Failed to fetch products",
      };
    }

    const products: ProductNode[] =
      productsData.data?.products?.edges?.map((edge) => edge.node) || [];

    log.info("Products fetched successfully", { count: products.length });

    if (products.length === 0) {
      return {
        success: false,
        products: [],
        error: "No products found. Please add products to your store first.",
      };
    }

    return {
      success: true,
      products,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error("Error fetching products", { error: errorMessage });
    
    return {
      success: false,
      products: [],
      error: errorMessage,
    };
  }
}

/**
 * Trigger AI quiz generation via API endpoint (fire-and-forget)
 * 
 * @param requestOrigin - Request origin URL (e.g., https://app.example.com)
 * @param quizId - Quiz ID to generate questions for
 * @param shop - Shop domain
 * @param style - Quiz style (fun, professional, detailed)
 */
export async function triggerAIGeneration(
  requestOrigin: string,
  quizId: string,
  shop: string,
  style: "fun" | "professional" | "detailed" = "professional"
): Promise<void> {
  const log = logger.child({ shop, module: "ai-quiz-generation", quizId });
  
  try {
    const apiUrl = `${requestOrigin}/api/quiz/generate`;
    
    log.info("Triggering AI generation", { style });
    
    // Fire-and-forget request - don't await
    fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Shopify-Shop-Domain": shop,
        "X-Quiz-Id": quizId,
      },
      body: new URLSearchParams({
        quizId,
        style,
      }),
    }).catch((err) => {
      log.error("AI generation API call failed", { error: String(err) });
    });
    
    log.info("AI generation triggered successfully");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error("Error triggering AI generation", { error: errorMessage });
  }
}

/**
 * Generate quiz questions with AI (with product fetching)
 * Combines product fetching and AI generation trigger
 * 
 * @param admin - Shopify Admin API context
 * @param requestOrigin - Request origin URL
 * @param quizId - Quiz ID
 * @param shop - Shop domain
 * @param style - Quiz style
 * @param productLimit - Max products to fetch
 * @returns Success status and message
 */
export async function generateQuizWithAI(
  admin: AdminApiContext,
  requestOrigin: string,
  quizId: string,
  shop: string,
  style: "fun" | "professional" | "detailed" = "professional",
  productLimit: number = 50
): Promise<{ success: boolean; message: string }> {
  const log = logger.child({ shop, module: "ai-quiz-generation", quizId });
  
  // Fetch products
  const productsResult = await fetchProductsForAI(admin, shop, productLimit);
  
  if (!productsResult.success) {
    log.warn("Failed to fetch products", { error: productsResult.error });
    return {
      success: false,
      message: productsResult.error || "Failed to fetch products",
    };
  }
  
  if (productsResult.products.length === 0) {
    return {
      success: false,
      message: "No products found. Please add products to your store first.",
    };
  }
  
  // Trigger AI generation
  await triggerAIGeneration(requestOrigin, quizId, shop, style);
  
  return {
    success: true,
    message: `AI generation started with ${productsResult.products.length} products`,
  };
}
