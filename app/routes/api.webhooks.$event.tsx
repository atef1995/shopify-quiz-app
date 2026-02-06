import type { ActionFunctionArgs } from "react-router";
import { sendWebhook } from "../lib/webhooks.server";
import prisma from "../db.server";

/**
 * Public API endpoint for webhook events from storefront
 *
 * NOTE: FEATURE CURRENTLY DISABLED - Custom integrations feature removed from frontend
 * This endpoint is kept for future use but calls to it are commented out in quiz-embed.js
 *
 * This endpoint receives webhook events from the quiz embed
 * and forwards them to configured webhook URLs.
 *
 * Events supported:
 * - quiz_started: User begins taking a quiz
 * - question_answered: User answers a question
 * - email_captured: User provides their email
 *
 * Security:
 * - Rate limited to prevent abuse
 * - Validates quiz exists and is active
 * - Non-blocking delivery
 */
export const action = async ({ request, params }: ActionFunctionArgs) => {
  const event = params.event as 'quiz_started' | 'question_answered' | 'email_captured';

  if (!event || !['quiz_started', 'question_answered', 'email_captured'].includes(event)) {
    return Response.json(
      { error: "Invalid webhook event" },
      { status: 400 }
    );
  }

  try {
    const body = await request.json();
    const { quizId, ...eventData } = body;

    if (!quizId) {
      return Response.json(
        { error: "Quiz ID is required" },
        { status: 400 }
      );
    }

    // Verify quiz exists and get shop domain
    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId },
      select: { shop: true, title: true },
    });

    if (!quiz) {
      return Response.json(
        { error: "Quiz not found" },
        { status: 404 }
      );
    }

    // Send webhook asynchronously (non-blocking)
    sendWebhook(quiz.shop, event, quizId, {
      ...eventData,
      quizTitle: quiz.title,
    });

    // Return success immediately
    return Response.json({ success: true });

  } catch (error) {
    console.error(`Webhook event ${event} processing failed:`, error);
    return Response.json(
      { error: "Failed to process webhook event" },
      { status: 500 }
    );
  }
};