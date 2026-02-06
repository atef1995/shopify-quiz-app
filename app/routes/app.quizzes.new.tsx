import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  HeadersFunction,
} from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import prisma from "../db.server";
import { canCreateQuiz, getQuizUsageStats } from "../lib/billing.server";
import { logger } from "../lib/logger.server";

/**
 * Loader to prepare data for quiz creation
 * Checks if user can create more quizzes
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // Check quiz creation limits
  const quizLimits = await canCreateQuiz(session.shop);
  const quizUsage = await getQuizUsageStats(session.shop);

  return {
    canCreate: quizLimits.allowed,
    createWarning: quizLimits.warning,
    createWarningMessage: quizLimits.warningMessage,
    createBlockedReason: quizLimits.reason,
    quizUsage,
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

    // Validate required fields
    if (!title || title.trim() === "") {
      return Response.json(
        { error: "Quiz title is required" },
        { status: 400 },
      );
    }

    log.info("Creating quiz", { title, hasTitle: !!title });

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

      log.debug("Redirecting to edit page", { quizId: quiz.id });
      return redirect(`/app/quizzes/${quiz.id}/edit`);
    } catch (error) {
      log.error("Error creating quiz", error);
      return Response.json({ error: "Failed to create quiz" }, { status: 500 });
    }
  }

  return null;
};

export default function NewQuiz() {
  const loaderData = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const isSubmitting = fetcher.state === "submitting";

  const {
    canCreate,
    createWarning,
    createWarningMessage,
    createBlockedReason,
    quizUsage,
    tierName,
  } = loaderData;

  // Show error toasts from server responses
  useEffect(() => {
    if (fetcher.data && fetcher.state === "idle") {
      if (fetcher.data.error) {
        shopify.toast.show(fetcher.data.error, { isError: true });
      }
    }
  }, [fetcher.data, fetcher.state, shopify]);

  // Form submission handler
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
    const title = formData.get("title") as string;

    // Validate title is not empty
    if (!title || title.trim() === "") {
      e.preventDefault();
      shopify.toast.show("Quiz title is required", {
        isError: true,
      });
      return;
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
                <s-button href="/app/billing" variant="primary">
                  Upgrade Plan
                </s-button>
              </s-stack>
            </s-banner>
          )}

          {canCreate && createWarning && (
            <s-banner variant="warning">
              <s-stack direction="inline" gap="base" align="center">
                <s-text variant="body-sm">{createWarningMessage}</s-text>
                <s-button href="/app/billing" variant="tertiary">
                  View Plans
                </s-button>
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

          <fetcher.Form method="post" onSubmit={handleSubmit}>
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
                <s-button href="/app/quizzes" variant="secondary">
                  Cancel
                </s-button>
              </s-stack>
            </s-stack>
          </fetcher.Form>
        </s-stack>
      </s-section>

      {/* Info Cards */}
      <s-section slot="aside" heading="Quiz Best Practices">
        <s-stack direction="block" gap="base">
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            border="base"
            background="subdued"
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
            border="base"
            background="subdued"
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
            border="base"
            background="subdued"
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
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
