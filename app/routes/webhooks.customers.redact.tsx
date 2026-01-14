import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import crypto from "crypto";
import { logger } from "../lib/logger.server";

/**
 * GDPR Webhook: customers/redact
 * Triggered when a customer requests data deletion (48 hours after request)
 * 
 * REQUIREMENT: Delete all customer data within 30 days
 * For this app: Delete quiz results containing customer email
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  // Get HMAC header
  const hmacHeader = request.headers.get('x-shopify-hmac-sha256');
  
  if (!hmacHeader) {
    logger.error("GDPR Customer Redact: Missing HMAC header");
    return new Response("Bad Request", { status: 400 });
  }

  // Get raw body as text (this is critical for HMAC verification)
  const rawBody = await request.text();
  
  // Manual HMAC verification using client secret
  const clientSecret = process.env.SHOPIFY_API_SECRET || "";
  const calculatedHmac = crypto
    .createHmac('sha256', clientSecret)
    .update(rawBody, 'utf8')
    .digest('base64');
  
  // Timing-safe comparison
  let hmacValid = false;
  try {
    hmacValid = crypto.timingSafeEqual(
      Buffer.from(calculatedHmac, 'base64'),
      Buffer.from(hmacHeader, 'base64')
    );
  } catch (error) {
    logger.error("GDPR Customer Redact: HMAC comparison error", error);
    return new Response("Bad Request", { status: 400 });
  }

  if (!hmacValid) {
    logger.error("GDPR Customer Redact: Invalid HMAC signature");
    return new Response("Bad Request", { status: 400 });
  }

  // HMAC is valid, now use authenticate.webhook for additional processing
  // Create new request with the raw body
  const clonedRequest = new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: rawBody,
  });

  try {
    const { shop, payload } = await authenticate.webhook(clonedRequest);
    const customerId = payload.customer?.id;
    const customerEmail = payload.customer?.email;

    const log = logger.child({ shop: shop || "unknown", module: "gdpr-customer-redact" });
    log.info("Processing customer redaction", { customerId, hasEmail: !!customerEmail });

    if (!customerEmail) {
      log.info("No email provided, skipping deletion");
      return new Response(JSON.stringify({ success: true, message: "No email to redact" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Delete all quiz results for this customer (by email)
    // Delete all quiz results for this customer (by email)
    const deletedResults = await prisma.quizResult.deleteMany({
      where: {
        email: customerEmail,
        quiz: {
          shop: shop, // Only delete from this shop
        },
      },
    });

    log.info("Successfully deleted customer quiz results", { deletedCount: deletedResults.count });

    // NOTE: QuizAnalytics contains aggregated data without PII
    // We don't need to modify analytics as they don't contain customer-identifiable information

    return new Response(JSON.stringify({
      success: true,
      deleted_records: deletedResults.count,
      customer_email: customerEmail,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    logger.error("GDPR Customer Redact: Failed to process", error);
    return new Response(JSON.stringify({
      error: "Internal server error",
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

