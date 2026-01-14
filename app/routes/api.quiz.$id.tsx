import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import {
  getCorsHeaders,
  createCorsErrorResponse,
} from "../lib/cors.server";
import {
  checkRateLimit,
  getClientIp,
  createRateLimitResponse,
} from "../lib/rate-limit.server";

/**
 * Public API endpoint to fetch quiz data for storefront
 *
 * This endpoint is called by the quiz embed block on the storefront
 * to load quiz questions and settings.
 *
 * Security:
 * - CORS restricted to Shopify shop domains only
 * - Rate limited to 20 requests per minute per IP+quiz
 */
export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  try {
    const quizId = params.id;

    if (!quizId) {
      return Response.json(
        { error: "Quiz ID is required" },
        { status: 400 }
      );
    }

    // Rate limiting: 20 requests per minute per IP + quiz combination
    const clientIp = getClientIp(request);
    const rateLimitKey = `quiz-fetch:${quizId}:${clientIp}`;
    if (!checkRateLimit(rateLimitKey, 20, 60000)) {
      return createRateLimitResponse(60);
    }

    // Fetch quiz with questions and options
    // NOTE: This is a public API endpoint - no shop filtering for storefront access
    const quiz = await prisma.quiz.findUnique({
      where: {
        id: quizId,
      },
      include: {
        questions: {
          include: {
            options: {
              orderBy: { order: "asc" },
            },
          },
          orderBy: { order: "asc" },
        },
      },
    });

    if (!quiz) {
      return Response.json(
        { error: "Quiz not found" },
        { status: 404 }
      );
    }

    if (quiz.status !== "active") {
      return Response.json(
        { error: "Quiz is not currently active" },
        { status: 404 }
      );
    }

    // Track quiz view (non-blocking)
    try {
      await prisma.quizAnalytics.update({
        where: { quizId: quiz.id },
        data: {
          totalViews: {
            increment: 1,
          },
        },
      });
    } catch {
      // Don't fail the request if analytics fails - non-critical operation
    }

    // Parse settings safely
    let settings = {};
    try {
      settings = quiz.settings ? JSON.parse(quiz.settings) : {};
    } catch {
      settings = {};
    }

    // Format response
    const response = {
      id: quiz.id,
      title: quiz.title,
      description: quiz.description,
      settings,
      questions: quiz.questions.map((q) => {
        // Parse conditional rules safely
        let conditionalRules = null;
        try {
          conditionalRules = q.conditionalRules ? JSON.parse(q.conditionalRules) : null;
        } catch {
          // Silently ignore parse errors for conditional rules
        }

        return {
          id: q.id,
          text: q.text,
          type: q.type,
          conditionalRules,
          options: q.options.map((o) => {
            // Parse productMatching to extract budget/price metadata for conditional logic
            let budgetMin, budgetMax, priceRange;
            try {
              const matching = o.productMatching ? JSON.parse(o.productMatching) : {};
              budgetMin = matching.budgetMin;
              budgetMax = matching.budgetMax;
              priceRange = matching.priceRange;
            } catch {
              // Silently ignore parse errors
            }

            return {
              id: o.id,
              text: o.text,
              imageUrl: o.imageUrl,
              // Include budget/price metadata for conditional filtering (safe to expose)
              budgetMin,
              budgetMax,
              priceRange,
            };
          }),
        };
      }),
    };

    // Use secure CORS headers
    return Response.json(response, {
      headers: {
        ...getCorsHeaders(request, quiz.shop),
        "Cache-Control": "public, max-age=300", // Cache for 5 minutes
        "Vary": "Origin",
      },
    });
  } catch (error) {
    // Return error with safe CORS headers (no quiz context available)
    return createCorsErrorResponse(
      request,
      null,
      "Failed to fetch quiz",
      500,
    );
  }
};
