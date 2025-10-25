import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

/**
 * API endpoint to fetch products for quiz option matching
 * 
 * Supports search by query, tags, and product types
 * Used by the quiz builder to select products for option matching
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  
  try {
    const url = new URL(request.url);
    const query = url.searchParams.get("query") || "";
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 50);
    
    // Build GraphQL query based on search parameters
    let searchQuery = "*";
    if (query.trim()) {
      searchQuery = `title:*${query}* OR tag:*${query}* OR product_type:*${query}*`;
    }
    
    const productsResponse = await admin.graphql(
      `#graphql
        query getProducts($query: String!, $first: Int!) {
          products(first: $first, query: $query) {
            edges {
              node {
                id
                title
                handle
                productType
                tags
                vendor
                totalInventory
                status
                featuredImage {
                  url
                  altText
                }
                priceRangeV2 {
                  minVariantPrice {
                    amount
                    currencyCode
                  }
                  maxVariantPrice {
                    amount
                    currencyCode
                  }
                }
                variants(first: 1) {
                  edges {
                    node {
                      id
                      price
                    }
                  }
                }
              }
            }
          }
        }
      `,
      {
        variables: { 
          query: searchQuery,
          first: limit 
        },
      }
    );

    const productsData = await productsResponse.json();
    
    if (productsData.errors) {
      console.error("GraphQL errors:", productsData.errors);
      return Response.json(
        { error: "Failed to fetch products" },
        { status: 500 }
      );
    }

    const products = productsData.data?.products?.edges?.map((edge: any) => ({
      id: edge.node.id,
      title: edge.node.title,
      handle: edge.node.handle,
      productType: edge.node.productType,
      tags: edge.node.tags,
      vendor: edge.node.vendor,
      status: edge.node.status,
      totalInventory: edge.node.totalInventory,
      imageUrl: edge.node.featuredImage?.url,
      imageAlt: edge.node.featuredImage?.altText,
      price: {
        min: parseFloat(edge.node.priceRangeV2.minVariantPrice.amount),
        max: parseFloat(edge.node.priceRangeV2.maxVariantPrice.amount),
        currency: edge.node.priceRangeV2.minVariantPrice.currencyCode,
      },
    })) || [];

    return Response.json({
      products,
      total: products.length,
      query: query,
    });

  } catch (error: any) {
    console.error("Error fetching products:", error);
    return Response.json(
      { error: error.message || "Failed to fetch products" },
      { status: 500 }
    );
  }
};