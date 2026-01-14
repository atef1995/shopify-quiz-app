import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import crypto from "crypto";
import { logger } from "../lib/logger.server";

/**
 * GDPR Webhook: customers/data_request
 * Triggered when a customer requests their data
 * 
 * REQUIREMENT: Return all customer data within 30 days
 * For this app: We store quiz completion data with optional customer emails
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  // Get HMAC header
  const hmacHeader = request.headers.get('x-shopify-hmac-sha256');
  
  if (!hmacHeader) {
    logger.error("GDPR Data Request: Missing HMAC header");
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
    logger.error("GDPR Data Request: HMAC comparison error", error);
    return new Response("Bad Request", { status: 400 });
  }

  if (!hmacValid) {
    logger.error("GDPR Data Request: Invalid HMAC signature");
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

    const log = logger.child({ shop: shop || "unknown", module: "gdpr-data-request" });
    log.info("Processing customer data request", { customerId, hasEmail: !!customerEmail });

    if (!customerEmail) {
      log.info("No email provided, cannot retrieve quiz data");
      return new Response(null, { status: 200 });
    }

    // Retrieve all quiz results for this customer
    const quizResults = await prisma.quizResult.findMany({
      where: {
        email: customerEmail,
        quiz: {
          shop: shop,
        },
      },
      include: {
        quiz: {
          select: {
            title: true,
            description: true,
          },
        },
      },
    });

    // Format the data export
    const customerData = {
      customer_email: customerEmail,
      customer_id: customerId,
      shop: shop,
      data_requested_at: new Date().toISOString(),
      quiz_completions: quizResults.map(result => ({
        quiz_title: result.quiz.title,
        completed_at: result.completedAt,
        answers: result.answers, // JSON field containing quiz responses
        recommended_products: result.recommendedProducts, // Product IDs
      })),
    };

    log.info("Data export prepared", { quizCompletions: quizResults.length });

    // In production, you would:
    // 1. Store this export in a secure location
    // 2. Send email to customer with download link
    // 3. Automatically delete the export after 30 days
    // 4. Log the request for compliance audit trail

    return new Response(JSON.stringify({ success: true, records: quizResults.length }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    logger.error("GDPR Data Request: Failed to process", error);
  }
};

