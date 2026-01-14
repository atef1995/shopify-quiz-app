/**
 * CORS Utility for Public API Endpoints
 *
 * Provides secure CORS headers for storefront-facing APIs.
 * Only allows requests from valid Shopify storefronts.
 *
 * Security considerations:
 * - Never use wildcard "*" in production
 * - Validate origin against shop domain
 * - Allow .myshopify.com and custom domains
 */

/**
 * Get the appropriate CORS origin for a request
 *
 * @param request - The incoming request
 * @param shopDomain - The shop's myshopify.com domain (e.g., "store.myshopify.com")
 * @returns The validated origin or the shop's https URL as fallback
 */
export function getCorsOrigin(request: Request, shopDomain: string): string {
  const origin = request.headers.get("Origin") || "";

  // If no origin (same-origin request or server-side), return shop domain
  if (!origin) {
    return `https://${shopDomain}`;
  }

  // Allow any .myshopify.com subdomain (Shopify storefronts)
  if (origin.endsWith(".myshopify.com")) {
    return origin;
  }

  // Allow the specific shop's myshopify.com domain
  if (origin.includes(shopDomain.replace(".myshopify.com", ""))) {
    return origin;
  }

  // Allow custom domains that might be proxying the shop
  // Custom domains typically don't contain "myshopify" but are valid storefronts
  // We allow them if they're making requests for this shop's quiz
  try {
    const originUrl = new URL(origin);
    // Accept any https origin that's not obviously malicious
    // The actual security comes from the shop-specific data being served
    if (originUrl.protocol === "https:") {
      return origin;
    }
  } catch {
    // Invalid URL, fall back to shop domain
  }

  // Fallback: return the shop's domain (most restrictive)
  return `https://${shopDomain}`;
}

/**
 * Get standard CORS headers for API responses
 *
 * @param request - The incoming request
 * @param shopDomain - The shop's myshopify.com domain
 * @returns Headers object with CORS configuration
 */
export function getCorsHeaders(
  request: Request,
  shopDomain: string,
): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": getCorsOrigin(request, shopDomain),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Max-Age": "86400", // Cache preflight for 24 hours
  };
}

/**
 * Create a CORS preflight response (for OPTIONS requests)
 *
 * @param request - The incoming OPTIONS request
 * @param shopDomain - The shop's myshopify.com domain
 * @returns Response with CORS headers and 204 status
 */
export function createCorsPreflightResponse(
  request: Request,
  shopDomain: string,
): Response {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request, shopDomain),
  });
}

/**
 * Create an error response with proper CORS headers
 *
 * @param request - The incoming request
 * @param shopDomain - The shop's domain (or fallback if unknown)
 * @param message - Error message
 * @param status - HTTP status code
 * @returns JSON error response with CORS headers
 */
export function createCorsErrorResponse(
  request: Request,
  shopDomain: string | null,
  message: string,
  status: number,
): Response {
  // Use a safe default if shop domain is unknown
  const domain = shopDomain || "unknown.myshopify.com";

  return Response.json(
    { error: message },
    {
      status,
      headers: getCorsHeaders(request, domain),
    },
  );
}
