import { useState } from "react";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  HeadersFunction,
} from "react-router";
import { redirect, Form, useNavigation, Link, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import prisma from "../db.server";
import {
  canCreateQuiz,
  hasFeatureAccess,
  getQuizUsageStats,
} from "../lib/billing.server";
import { logger } from "../lib/logger.server";

/**
 * Loader to prepare data for quiz creation
 * Checks if user can create more quizzes and has AI access
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // Check quiz creation limits
  const quizLimits = await canCreateQuiz(session.shop);
  const aiAccess = await hasFeatureAccess(session.shop, "ai_generation");
  const quizUsage = await getQuizUsageStats(session.shop);

  return {
    canCreate: quizLimits.allowed,
    createWarning: quizLimits.warning,
    createWarningMessage: quizLimits.warningMessage,
    createBlockedReason: quizLimits.reason,
    quizUsage,
    canUseAI: aiAccess.allowed,
    aiRequiredTier: aiAccess.requiredTier,
    tier: quizLimits.tier,
    tierName: quizLimits.tierName,
  };
};

/**
 * Action handler for creating new quizzes
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get("action");
  const log = logger.child({ shop: session.shop, module: "quiz-create" });

  log.debug("Quiz creation action received", { action });

  if (action === "create") {
    // Check if user can create more quizzes
    const quizLimits = await canCreateQuiz(session.shop);
    if (!quizLimits.allowed) {
      return Response.json(
        {
          error: quizLimits.reason,
          upgradeRequired: true,
        },
        { status: 403 },
      );
    }

    const title = formData.get("title") as string;
    const description = formData.get("description") as string;
    const useAI = formData.get("useAI") === "true";

    // Check AI access if trying to use AI
    if (useAI) {
      const aiAccess = await hasFeatureAccess(session.shop, "ai_generation");
      if (!aiAccess.allowed) {
        return Response.json(
          {
            error: `AI quiz generation requires ${aiAccess.requiredTier} plan or higher.`,
            upgradeRequired: true,
          },
          { status: 403 },
        );
      }
    }

    log.info("Creating quiz", { title, useAI });

    try {
      // Create quiz with default settings
      const quiz = await prisma.quiz.create({
        data: {
          shop: session.shop,
          title,
          description: description || null,
          status: "draft",
          settings: JSON.stringify({
            emailCapture: true,
            resultPageTitle: "Your Perfect Products",
            showPrices: true,
            enableSharing: false,
          }),
        },
      });

      log.info("Quiz created successfully", { quizId: quiz.id });

      // Create analytics record
      await prisma.quizAnalytics.create({
        data: {
          quizId: quiz.id,
        },
      });

      log.debug("Analytics record created", { quizId: quiz.id });

      // If AI generation is requested, generate questions automatically
      if (useAI) {
        try {
          // Build absolute URL for API call - extract origin from request
          const requestUrl = new URL(request.url);
          const apiUrl = `${requestUrl.origin}/api/quiz/generate`;
          
          const generateResponse = await fetch(apiUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              quizId: quiz.id,
              style: "professional",
            }),
          });

          if (!generateResponse.ok) {
            const errorText = await generateResponse.text();
            log.warn("AI generation API error", { status: generateResponse.status, error: errorText, quizId: quiz.id });
          } else {
            const result = await generateResponse.json();
            
            if (!result.success) {
              log.warn("AI generation failed", { error: result.error, quizId: quiz.id });
            } else {
              log.info("AI generation successful", { quizId: quiz.id, questionsGenerated: result.questionsGenerated });
            }
          }
        } catch (error) {
          log.warn("AI generation error", { quizId: quiz.id, error: String(error) });
          // Continue to edit page even if AI generation fails
        }
      }

      log.debug("Redirecting to edit page", { quizId: quiz.id });
      return redirect(`/app/quizzes/${quiz.id}/edit`);
      
    } catch (error) {
      log.error("Error creating quiz", error);
      return Response.json(
        { error: "Failed to create quiz" },
        { status: 500 }
      );
    }
  }

  return null;
};

export default function NewQuiz() {
  const loaderData = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const isSubmitting = navigation.state === "submitting";
  const [showAILoading, setShowAILoading] = useState(false);
  // Track AI checkbox state for controlled component behavior
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_useAI, setUseAI] = useState(false);

  const {
    canCreate,
    createWarning,
    createWarningMessage,
    createBlockedReason,
    quizUsage,
    canUseAI,
    aiRequiredTier,
    tierName,
  } = loaderData;

  // Show loading modal when AI generation is in progress
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    // Block submission if at limit
    if (!canCreate) {
      e.preventDefault();
      shopify.toast.show(createBlockedReason || "Quiz limit reached", {
        isError: true,
      });
      return;
    }

    const formData = new FormData(e.currentTarget);
    const useAIValue = formData.get("useAI") === "true";

    // Block AI usage if not allowed
    if (useAIValue && !canUseAI) {
      e.preventDefault();
      shopify.toast.show(
        `AI quiz generation requires ${aiRequiredTier} plan or higher.`,
        { isError: true },
      );
      return;
    }

    if (useAIValue) {
      setShowAILoading(true);
      shopify.toast.show(
        "Generating quiz with AI... This may take 10-15 seconds",
        { duration: 4000 },
      );
    }
  };

  return (
    <s-page
      heading="Create New Quiz"
      backAction={{ url: "/app/quizzes" }}
      max-width="full"
    >
      <s-section>
        <s-stack direction="block" gap="base">
          {/* Quiz limit warning/block banner */}
          {!canCreate && (
            <s-banner variant="critical">
              <s-stack direction="block" gap="tight">
                <s-text variant="body-md">
                  <strong>Quiz Limit Reached</strong>
                </s-text>
                <s-text variant="body-sm">{createBlockedReason}</s-text>
                <Link to="/app/billing">
                  <s-button variant="primary">Upgrade Plan</s-button>
                </Link>
              </s-stack>
            </s-banner>
          )}

          {canCreate && createWarning && (
            <s-banner variant="warning">
              <s-stack direction="inline" gap="base" align="center">
                <s-text variant="body-sm">{createWarningMessage}</s-text>
                <Link to="/app/billing">
                  <s-button variant="tertiary">View Plans</s-button>
                </Link>
              </s-stack>
            </s-banner>
          )}

          {/* Quiz usage indicator */}
          {!quizUsage.isUnlimited && (
            <s-text variant="body-sm" color="subdued">
              Quiz Usage: {quizUsage.currentCount} of {quizUsage.limit} (
              {tierName} Plan)
            </s-text>
          )}

          <s-paragraph>
            Create an interactive quiz to help customers discover products
            tailored to their needs. Use AI to generate quiz questions
            automatically or build from scratch.
          </s-paragraph>

          <Form method="post" onSubmit={handleSubmit}>
            <input type="hidden" name="action" value="create" />
            <s-stack direction="block" gap="base">
              {/* Basic Quiz Info */}
              <s-text-field
                label="Quiz Title"
                name="title"
                placeholder="e.g., Find Your Perfect Skincare Routine"
                required
              />

              <s-text-field
                label="Description (Optional)"
                name="description"
                placeholder="Help customers understand what this quiz is about"
              />

              {/* AI Generation Toggle */}
              <s-box
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="block" gap="base">
                  <s-stack direction="inline" gap="base" align="center">
                    <s-icon source="magic" />
                    <s-stack direction="block" gap="tight">
                      <s-text variant="heading-sm">
                        Generate Quiz with AI
                        {!canUseAI && (
                          <s-badge variant="attention" className="badge-margin-left">
                            {aiRequiredTier}+ Plan
                          </s-badge>
                        )}
                      </s-text>
                      <s-text variant="body-sm" color="subdued">
                        AI will analyze your products and create personalized
                        quiz questions automatically. You can edit them after
                        creation.
                      </s-text>
                    </s-stack>
                  </s-stack>

                  {canUseAI ? (
                    <s-checkbox
                      name="useAI"
                      value="true"
                      label="Use AI to generate quiz questions from my product catalog"
                      onChange={(e) =>
                        setUseAI((e.target as HTMLInputElement).checked)
                      }
                    />
                  ) : (
                    <s-banner variant="warning">
                      <s-stack direction="inline" gap="base" align="center">
                        <s-text variant="body-sm">
                          AI quiz generation requires the {aiRequiredTier} plan
                          or higher.
                        </s-text>
                        <Link to="/app/billing">
                          <s-button variant="tertiary">
                            Upgrade to {aiRequiredTier}
                          </s-button>
                        </Link>
                      </s-stack>
                    </s-banner>
                  )}

                  {canUseAI && (
                    <s-banner variant="info">
                      After creating the quiz, you&apos;ll be able to customize
                      the AI-generated questions, add images, and set up
                      conditional logic.
                    </s-banner>
                  )}
                </s-stack>
              </s-box>

              {/* Submit Buttons */}
              <s-stack direction="inline" gap="base">
                <s-button
                  type="submit"
                  variant="primary"
                  loading={isSubmitting}
                  disabled={!canCreate || isSubmitting}
                >
                  {canCreate ? "Create Quiz" : "Upgrade to Create"}
                </s-button>
                <Link to="/app/quizzes">
                  <s-button type="button" variant="secondary">
                    Cancel
                  </s-button>
                </Link>
              </s-stack>
            </s-stack>
          </Form>
        </s-stack>
      </s-section>

      {/* Info Cards */}
      <s-section slot="aside" heading="Quiz Best Practices">
        <s-stack direction="block" gap="base">
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="surface"
          >
            <s-stack direction="block" gap="tight">
              <s-text variant="heading-sm">Optimal Length</s-text>
              <s-text variant="body-sm" color="subdued">
                5-7 questions achieve the best balance between gathering
                insights and maintaining engagement.
              </s-text>
            </s-stack>
          </s-box>

          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="surface"
          >
            <s-stack direction="block" gap="tight">
              <s-text variant="heading-sm">Question Types</s-text>
              <s-text variant="body-sm" color="subdued">
                Mix multiple choice and image-based questions for visual
                engagement.
              </s-text>
            </s-stack>
          </s-box>

          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="surface"
          >
            <s-stack direction="block" gap="tight">
              <s-text variant="heading-sm">Email Capture</s-text>
              <s-text variant="body-sm" color="subdued">
                Collect emails before showing results to build your marketing
                list with engaged leads.
              </s-text>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      {/* AI Generation Loading Modal */}
      {showAILoading && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ai-loading-title"
        >
          <s-box
            padding="large"
            borderRadius="base"
            background="surface"
            className="modal-container"
          >
            <s-stack direction="block" gap="base" align="center">
              <s-spinner size="large" />
              <s-text variant="heading-lg">Generating Your Quiz with AI</s-text>
              <s-text variant="body-md" alignment="center">
                Our AI is analyzing your product catalog and creating personalized quiz questions.
                This typically takes 10-15 seconds.
              </s-text>
              <s-banner variant="info">
                <s-text variant="body-sm">
                  💡 Tip: You&apos;ll be able to customize all AI-generated questions after creation.
                </s-text>
              </s-banner>
            </s-stack>
          </s-box>
        </div>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
