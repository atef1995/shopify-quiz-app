import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";

/**
 * Public API endpoint to fetch quiz data for storefront
 *
 * This endpoint is called by the quiz embed block on the storefront
 * to load quiz questions and settings.
 *
 * Security: CORS restricted to Shopify shop domains only
 * TODO: Add rate limiting per quiz ID to prevent scraping
 * TODO: Add conditional ETag support to reduce bandwidth
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

    console.log('Quiz fetch attempt:', { quizId, found: !!quiz, status: quiz?.status });

    if (!quiz) {
      console.error('Quiz not found in database:', quizId);
      return Response.json(
        { error: `Quiz not found with ID: ${quizId}` },
        { status: 404 }
      );
    }

    if (quiz.status !== "active") {
      console.error('Quiz exists but not active:', { quizId, status: quiz.status });
      return Response.json(
        { error: `Quiz exists but status is "${quiz.status}". Please activate it in the admin.` },
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
    } catch (analyticsError) {
      console.warn("Failed to update analytics for quiz", quiz.id, analyticsError);
      // Don't fail the request if analytics fails
    }

    // Parse settings safely
    let settings = {};
    try {
      settings = quiz.settings ? JSON.parse(quiz.settings) : {};
    } catch (settingsError) {
      console.warn("Failed to parse quiz settings for quiz", quiz.id, settingsError);
      settings = {};
    }

    // Format response
    // TODO: Don't expose internal productMatching data to frontend
    // TODO: Add response size limit check (very large quizzes could cause issues)
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
        } catch (rulesError) {
          console.warn("Failed to parse conditional rules for question", q.id, rulesError);
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
            } catch (e) {
              console.warn("Failed to parse productMatching for option", o.id);
            }

            return {
              id: o.id,
              text: o.text,
              imageUrl: o.imageUrl,
              // Include budget/price metadata for conditional filtering (safe to expose)
              budgetMin,
              budgetMax,
              priceRange,
              // Note: Full productMatching (tags/types) is intentionally not included for security
            };
          }),
        };
      }),
    };

    // Get origin for CORS - allow Shopify domains and custom domains from the same shop
    const origin = request.headers.get("Origin") || "";
    const shopDomain = quiz.shop;
    const isShopifyDomain = origin.endsWith(".myshopify.com") || 
                            origin.includes(shopDomain.replace(".myshopify.com", ""));
    
    return Response.json(response, {
      headers: {
        "Access-Control-Allow-Origin": isShopifyDomain ? origin : `https://${shopDomain}`,
        "Access-Control-Allow-Credentials": "true",
        "Cache-Control": "public, max-age=300", // Cache for 5 minutes
        "Vary": "Origin", // Proper cache behavior for CORS
        // TODO: Add ETag for conditional requests
      },
    });
  } catch (error) {
    console.error("Error fetching quiz:", error);
    
    // Return error with proper CORS headers
    const origin = request.headers.get("Origin") || "";
    const headers: HeadersInit = {
      "Access-Control-Allow-Origin": origin.endsWith(".myshopify.com") ? origin : "*",
      "Access-Control-Allow-Credentials": "true",
    };
    
    return Response.json(
      { error: "Failed to fetch quiz" },
      { status: 500, headers }
    );
  }
};
