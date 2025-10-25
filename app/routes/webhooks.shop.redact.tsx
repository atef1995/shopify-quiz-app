import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

/**
 * GDPR Webhook: shop/redact
 * Triggered when a shop uninstalls the app and requests data deletion
 * 
 * REQUIREMENT: Delete all shop data within 30 days
 * For this app: Delete all quizzes, results, analytics, subscriptions
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);

  console.log(`[GDPR Shop Redact] Starting data deletion for shop: ${shop}`);
  console.log(`[GDPR Shop Redact] Payload:`, payload);

  try {
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

    console.log(`[GDPR Shop Redact] Successfully deleted all data for ${shop}:`, {
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
    console.error(`[GDPR Shop Redact Error] Failed to delete data for ${shop}:`, error);
    return new Response(JSON.stringify({
      error: "Failed to redact shop data",
      shop: shop,
      message: error instanceof Error ? error.message : "Unknown error",
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

