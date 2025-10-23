import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

/**
 * API endpoint to fetch unique product tags and types from the store
 * 
 * This helps users select from existing attributes when setting up
 * product matching rules for quiz options
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  
  try {
    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "250"), 250);
    
    // Fetch products to extract tags and types
    const productsResponse = await admin.graphql(
      `#graphql
        query getProductAttributes($first: Int!) {
          products(first: $first) {
            edges {
              node {
                id
                productType
                tags
              }
            }
          }
        }
      `,
      {
        variables: { first: limit },
      }
    );

    const productsData = await productsResponse.json();
    
    if (productsData.errors) {
      console.error("GraphQL errors:", productsData.errors);
      return Response.json(
        { error: "Failed to fetch product attributes" },
        { status: 500 }
      );
    }

    const products = productsData.data?.products?.edges?.map((edge: any) => edge.node) || [];
    
    // Extract unique tags and types
    const tagsSet = new Set<string>();
    const typesSet = new Set<string>();
    
    products.forEach((product: any) => {
      // Add tags
      if (product.tags && Array.isArray(product.tags)) {
        product.tags.forEach((tag: string) => {
          if (tag && tag.trim()) {
            tagsSet.add(tag.trim());
          }
        });
      }
      
      // Add product type
      if (product.productType && product.productType.trim()) {
        typesSet.add(product.productType.trim());
      }
    });

    // Convert to sorted arrays
    const tags = Array.from(tagsSet).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    const types = Array.from(typesSet).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

    return Response.json({
      tags,
      types,
      totalProducts: products.length,
    });

  } catch (error: any) {
    console.error("Error fetching product attributes:", error);
    return Response.json(
      { error: error.message || "Failed to fetch product attributes" },
      { status: 500 }
    );
  }
};
