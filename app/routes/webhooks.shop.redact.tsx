import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import crypto from "crypto";
import { logger } from "../lib/logger.server";

/**
 * GDPR Webhook: shop/redact
 * Triggered when a shop uninstalls the app and requests data deletion
 * 
 * REQUIREMENT: Delete all shop data within 30 days
 * For this app: Delete all quizzes, results, analytics, subscriptions
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  // Get HMAC header
  const hmacHeader = request.headers.get('x-shopify-hmac-sha256');
  
  if (!hmacHeader) {
    logger.error("GDPR Shop Redact: Missing HMAC header");
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
    logger.error("GDPR Shop Redact: HMAC comparison error", error);
    return new Response("Bad Request", { status: 400 });
  }

  if (!hmacValid) {
    logger.error("GDPR Shop Redact: Invalid HMAC signature");
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

    const log = logger.child({ shop: shop || "unknown", module: "gdpr-shop-redact" });
    log.info("Starting data deletion");

    // Track what we're deleting for audit log
    // Track what we're deleting for audit log
    const shopData = {
      quizzes: 0,
      questions: 0,
      options: 0,
      results: 0,
      analytics: 0,
      subscriptions: 0,
      sessions: 0,
    };

    // Count data before deletion for logging
    shopData.quizzes = await prisma.quiz.count({ where: { shop } });
    shopData.results = await prisma.quizResult.count({
      where: { quiz: { shop } },
    });
    shopData.subscriptions = await prisma.subscription.count({ where: { shop } });
    shopData.sessions = await prisma.session.count({ where: { shop } });

    // Delete all data for this shop
    // NOTE: Prisma cascade deletes will handle related records:
    // - Deleting Quiz cascades to Questions, QuestionOptions, QuizResults, QuizAnalytics
    
    // 1. Delete all quizzes (cascades to questions, options, results, analytics)
    const deletedQuizzes = await prisma.quiz.deleteMany({
      where: { shop },
    });

    // 2. Delete subscription data
    const deletedSubscription = await prisma.subscription.deleteMany({
      where: { shop },
    });

    // 3. Delete sessions
    const deletedSessions = await prisma.session.deleteMany({
      where: { shop },
    });

    log.info("Successfully deleted all shop data", {
      quizzes_deleted: deletedQuizzes.count,
      subscriptions_deleted: deletedSubscription.count,
      sessions_deleted: deletedSessions.count,
      estimated_total_records: shopData.quizzes + shopData.results + shopData.subscriptions + shopData.sessions,
    });

    return new Response(JSON.stringify({
      success: true,
      shop: shop,
      deleted: {
        quizzes: deletedQuizzes.count,
        subscriptions: deletedSubscription.count,
        sessions: deletedSessions.count,
      },
      message: "All shop data successfully redacted",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    logger.error("GDPR Shop Redact: Failed to delete data", error);
    return new Response(JSON.stringify({
      error: "Failed to redact shop data",
      message: error instanceof Error ? error.message : "Unknown error",
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

