/**
 * Rate Limiting Utility for Public API Endpoints
 *
 * In-memory rate limiter to prevent API abuse.
 * Simple implementation suitable for single-instance deployments.
 *
 * NOTE: This resets on server restart. For distributed deployments,
 * consider using Redis or a database-backed solution.
 *
 * Usage:
 *   const allowed = checkRateLimit(`quiz:${quizId}:${ip}`, 10, 60000);
 *   if (!allowed) return Response.json({ error: "Rate limited" }, { status: 429 });
 */

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// In-memory store for rate limits
const rateLimits = new Map<string, RateLimitEntry>();

// Cleanup old entries periodically (every 5 minutes)
const CLEANUP_INTERVAL = 5 * 60 * 1000;
let lastCleanup = Date.now();

/**
 * Clean up expired rate limit entries to prevent memory leaks
 */
function cleanupExpiredEntries(): void {
  const now = Date.now();

  // Only cleanup every CLEANUP_INTERVAL
  if (now - lastCleanup < CLEANUP_INTERVAL) {
    return;
  }

  lastCleanup = now;

  for (const [key, entry] of rateLimits.entries()) {
    if (now > entry.resetTime) {
      rateLimits.delete(key);
    }
  }
}

/**
 * Check if a request is within rate limits
 *
 * @param key - Unique identifier for the rate limit (e.g., "quiz:123:192.168.1.1")
 * @param maxRequests - Maximum requests allowed in the time window
 * @param windowMs - Time window in milliseconds
 * @returns true if request is allowed, false if rate limited
 */
export function checkRateLimit(
  key: string,
  maxRequests: number = 10,
  windowMs: number = 60000,
): boolean {
  cleanupExpiredEntries();

  const now = Date.now();
  const entry = rateLimits.get(key);

  // No existing entry or window expired - allow and create new entry
  if (!entry || now > entry.resetTime) {
    rateLimits.set(key, {
      count: 1,
      resetTime: now + windowMs,
    });
    return true;
  }

  // Within window - check if under limit
  if (entry.count >= maxRequests) {
    return false; // Rate limited
  }

  // Under limit - increment and allow
  entry.count++;
  return true;
}

/**
 * Get remaining requests for a rate limit key
 *
 * @param key - Unique identifier for the rate limit
 * @param maxRequests - Maximum requests allowed
 * @returns Number of remaining requests, or maxRequests if no entry exists
 */
export function getRemainingRequests(
  key: string,
  maxRequests: number = 10,
): number {
  const entry = rateLimits.get(key);

  if (!entry || Date.now() > entry.resetTime) {
    return maxRequests;
  }

  return Math.max(0, maxRequests - entry.count);
}

/**
 * Get the reset time for a rate limit key
 *
 * @param key - Unique identifier for the rate limit
 * @returns Unix timestamp when the rate limit resets, or null if no entry
 */
export function getResetTime(key: string): number | null {
  const entry = rateLimits.get(key);

  if (!entry || Date.now() > entry.resetTime) {
    return null;
  }

  return entry.resetTime;
}

/**
 * Extract client IP from request headers
 * Handles various proxy headers used by Shopify and CDNs
 *
 * @param request - The incoming request
 * @returns Client IP address or "unknown"
 */
export function getClientIp(request: Request): string {
  // Check common proxy headers in order of preference
  const headers = [
    "cf-connecting-ip", // Cloudflare
    "x-real-ip", // Nginx
    "x-forwarded-for", // Standard proxy header
    "x-client-ip", // Some load balancers
  ];

  for (const header of headers) {
    const value = request.headers.get(header);
    if (value) {
      // x-forwarded-for can contain multiple IPs, take the first
      const ip = value.split(",")[0].trim();
      if (ip) {
        return ip;
      }
    }
  }

  return "unknown";
}

/**
 * Create rate limit headers for responses
 *
 * @param key - Rate limit key
 * @param maxRequests - Maximum requests allowed
 * @returns Headers object with rate limit info
 */
export function getRateLimitHeaders(
  key: string,
  maxRequests: number = 10,
): Record<string, string> {
  const remaining = getRemainingRequests(key, maxRequests);
  const resetTime = getResetTime(key);

  return {
    "X-RateLimit-Limit": maxRequests.toString(),
    "X-RateLimit-Remaining": remaining.toString(),
    ...(resetTime && { "X-RateLimit-Reset": resetTime.toString() }),
  };
}

/**
 * Create a rate limit exceeded response
 *
 * @param retryAfterSeconds - Seconds until the client can retry
 * @returns Response with 429 status
 */
export function createRateLimitResponse(
  retryAfterSeconds: number = 60,
): Response {
  return Response.json(
    {
      error: "Too many requests. Please try again later.",
      retryAfter: retryAfterSeconds,
    },
    {
      status: 429,
      headers: {
        "Retry-After": retryAfterSeconds.toString(),
      },
    },
  );
}
