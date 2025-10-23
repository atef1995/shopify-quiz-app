import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";

/**
 * Public API endpoint to fetch quiz data for storefront
 *
 * This endpoint is called by the quiz embed block on the storefront
 * to load quiz questions and settings.
 *
 * TODO: Add rate limiting per quiz ID to prevent scraping
 * TODO: Add conditional ETag support to reduce bandwidth
 * BUG: CORS wildcard allows any domain to fetch quiz data
 * TODO: Consider adding shop domain verification
 */
export const loader = async ({ params }: LoaderFunctionArgs) => {
  try {
    const quizId = params.id;

    if (!quizId) {
      return Response.json(
        { error: "Quiz ID is required" },
        { status: 400 }
      );
    }

    // Fetch quiz with questions and options
    const quiz = await prisma.quiz.findUnique({
      where: {
        id: quizId,
        status: "active", // Only return active quizzes
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
        { error: "Quiz not found or not active" },
        { status: 404 }
      );
    }

    // Track quiz view
    // TODO: Move analytics tracking to background job to improve response time
    // TODO: Add IP address tracking to prevent view count inflation
    // BUG: If analytics update fails, it throws error and quiz doesn't load
    //      Wrap in try-catch and log error instead of failing the request
    await prisma.quizAnalytics.update({
      where: { quizId: quiz.id },
      data: {
        totalViews: {
          increment: 1,
        },
      },
    });

    // Parse settings
    // BUG: JSON.parse can throw if settings is malformed - wrap in try-catch
    const settings = quiz.settings ? JSON.parse(quiz.settings) : {};

    // Format response
    // TODO: Don't expose internal productMatching data to frontend
    // TODO: Add response size limit check (very large quizzes could cause issues)
    const response = {
      id: quiz.id,
      title: quiz.title,
      description: quiz.description,
      settings,
      questions: quiz.questions.map((q) => ({
        id: q.id,
        text: q.text,
        type: q.type,
        // BUG: JSON.parse can throw - wrap in try-catch
        conditionalRules: q.conditionalRules
          ? JSON.parse(q.conditionalRules)
          : null,
        options: q.options.map((o) => ({
          id: o.id,
          text: o.text,
          imageUrl: o.imageUrl,
          // Note: productMatching is intentionally not included for security
        })),
      })),
    };

    return Response.json(response, {
      headers: {
        "Access-Control-Allow-Origin": "*", // Allow storefront access
        "Cache-Control": "public, max-age=300", // Cache for 5 minutes
        // TODO: Add Vary header for proper cache behavior
        // TODO: Add ETag for conditional requests
      },
    });
  } catch (error: any) {
    // TODO: Add error logging service integration
    // TODO: Track error rates per quiz for monitoring
    console.error("Error fetching quiz:", error);
    return Response.json(
      { error: "Failed to fetch quiz" },
      { status: 500 }
    );
  }
};
