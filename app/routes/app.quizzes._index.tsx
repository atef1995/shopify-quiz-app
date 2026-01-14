import { useState } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useFetcher, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import prisma from "../db.server";
import { getUsageStats, getQuizUsageStats } from "../lib/billing.server";

/**
 * Action handler for quick status toggle and quiz deletion
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("action") as string;
  const quizId = formData.get("quizId") as string;

  if (actionType === "delete") {
    // Delete quiz and all related data (cascade deletes questions, options, results, analytics)
    await prisma.quiz.delete({
      where: { id: quizId, shop: session.shop },
    });

    return { success: true, message: "Quiz deleted successfully!" };
  }

  if (actionType === "toggleStatus") {
    const newStatus = formData.get("status") as string;

    await prisma.quiz.update({
      where: { id: quizId, shop: session.shop },
      data: { status: newStatus },
    });

    const message =
      newStatus === "active"
        ? "Quiz activated successfully!"
        : "Quiz set to draft.";

    return { success: true, message };
  }

  return { success: false, message: "Invalid action" };
};

/**
 * Loader function to fetch all quizzes for the current shop
 * Includes basic analytics data for each quiz and usage stats
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // Get usage stats for billing banner (completions)
  const usageStats = await getUsageStats(session.shop);

  // Get quiz count usage stats
  const quizUsage = await getQuizUsageStats(session.shop);

  const quizzes = await prisma.quiz.findMany({
    where: {
      shop: session.shop,
    },
    include: {
      analytics: true,
      questions: {
        select: {
          id: true,
        },
      },
      results: {
        select: {
          id: true,
        },
      },
    },
    orderBy: {
      updatedAt: "desc",
    },
  });

  // Calculate completion count for each quiz
  const quizzesWithStats = quizzes.map((quiz) => ({
    id: quiz.id,
    title: quiz.title,
    description: quiz.description,
    status: quiz.status,
    questionCount: quiz.questions.length,
    completions: quiz.results.length,
    views: quiz.analytics?.totalViews || 0,
    completionRate:
      quiz.analytics && quiz.analytics.totalViews > 0
        ? Math.round(
            (quiz.analytics.totalCompletions / quiz.analytics.totalViews) * 100,
          )
        : 0,
    revenue: quiz.analytics?.totalRevenue || 0,
    createdAt: quiz.createdAt.toISOString(),
    updatedAt: quiz.updatedAt.toISOString(),
  }));

  return {
    quizzes: quizzesWithStats,
    usage: usageStats,
    quizUsage,
  };
};
export default function QuizzesIndex() {
  const { quizzes, usage, quizUsage } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    quizId: string;
    quizTitle: string;
  }>({
    isOpen: false,
    quizId: "",
    quizTitle: "",
  });

  // Completion usage
  const isNearLimit = usage.percentUsed >= 80;
  const isOverLimit = usage.percentUsed >= 100;

  // Quiz count usage
  const isNearQuizLimit = quizUsage.percentUsed >= 80;
  const isAtQuizLimit =
    !quizUsage.isUnlimited && quizUsage.currentCount >= quizUsage.limit;

  const copyQuizId = async (quizId: string) => {
    try {
      await navigator.clipboard.writeText(quizId);
      setCopiedId(quizId);
      setTimeout(() => setCopiedId(null), 3000);

      // Show helpful toast with instructions
      shopify.toast.show(
        "Quiz ID copied! Paste it into the Product Quiz block settings in your theme editor (Customize → Add Block → Product Quiz).",
        { duration: 6000 },
      );
    } catch (err) {
      console.error("Failed to copy:", err);
      shopify.toast.show("Failed to copy Quiz ID", { isError: true });
    }
  };

  const toggleQuizStatus = (quizId: string, currentStatus: string) => {
    const newStatus = currentStatus === "active" ? "draft" : "active";
    const formData = new FormData();
    formData.append("action", "toggleStatus");
    formData.append("quizId", quizId);
    formData.append("status", newStatus);
    fetcher.submit(formData, { method: "POST" });
  };

  const handleDeleteQuiz = (quizId: string, quizTitle: string) => {
    setConfirmModal({
      isOpen: true,
      quizId,
      quizTitle,
    });
  };

  const confirmDelete = () => {
    const formData = new FormData();
    formData.append("action", "delete");
    formData.append("quizId", confirmModal.quizId);
    fetcher.submit(formData, { method: "POST" });
    setConfirmModal({ isOpen: false, quizId: "", quizTitle: "" });
  };

  return (
    <s-page heading="Product Quiz Builder" max-width="full">
      {/* Primary Action - Create Quiz */}
      {!isAtQuizLimit && (
        <s-button
          slot="primary-action"
          variant="primary"
          onClick={() => navigate("/app/quizzes/new")}
        >
          Create Quiz
        </s-button>
      )}

      {/* Quiz Count Usage Banner */}
      {isAtQuizLimit && (
        <s-section>
          <s-banner variant="critical">
            <s-stack direction="inline" gap="base" align="center">
              <s-text variant="body-sm">
                You&apos;ve reached your limit of {quizUsage.limit} quizzes on the{" "}
                {quizUsage.tierName} plan.
              </s-text>
              <s-button
                variant="primary"
                onClick={() => navigate("/app/billing")}
              >
                Upgrade to Create More
              </s-button>
            </s-stack>
          </s-banner>
        </s-section>
      )}

      {isNearQuizLimit && !isAtQuizLimit && (
        <s-section>
          <s-banner variant="warning">
            <s-text variant="body-sm">
              You&apos;ve used {quizUsage.currentCount} of {quizUsage.limit} quizzes
              ({quizUsage.percentUsed}%).{" "}
              <s-link onClick={() => navigate("/app/billing")}>
                Upgrade your plan
              </s-link>{" "}
              to create more quizzes.
            </s-text>
          </s-banner>
        </s-section>
      )}

      {/* Completion Usage Banner */}
      {isOverLimit && (
        <s-section>
          <s-banner variant="critical">
            <s-text variant="body-sm">
              You&apos;ve reached your monthly limit of {usage.limit} completions.{" "}
              <s-link onClick={() => navigate("/app/billing")}>
                Upgrade your plan
              </s-link>{" "}
              to continue collecting quiz responses.
            </s-text>
          </s-banner>
        </s-section>
      )}

      {isNearLimit && !isOverLimit && (
        <s-section>
          <s-banner variant="warning">
            <s-text variant="body-sm">
              You&apos;ve used {usage.currentUsage} of {usage.limit} monthly
              completions ({usage.percentUsed}%).{" "}
              <s-link onClick={() => navigate("/app/billing")}>
                View billing
              </s-link>{" "}
              to upgrade before reaching your limit.
            </s-text>
          </s-banner>
        </s-section>
      )}

      {quizzes.length === 0 ? (
        <s-section>
          <s-empty-state
            heading="Create your first quiz"
            message="Guide customers to their perfect products with interactive quizzes. Boost conversions and collect valuable customer insights."
          >
            <s-stack direction="block" gap="base" align="center">
              <s-button
                onClick={() => navigate("/app/quizzes/new")}
                variant="primary"
                size="large"
              >
                Create Your First Quiz
              </s-button>

              {/* Benefits Section */}
              <s-box padding="large" borderRadius="base">
                <s-stack direction="block" gap="base">
                  <s-text variant="heading-md" alignment="center">
                    Why Use Product Quizzes?
                  </s-text>
                  <s-stack direction="inline" gap="large">
                    <s-stack direction="block" gap="tight" align="center">
                      <s-text variant="heading-sm">Increase Sales</s-text>
                      <s-text
                        variant="body-sm"
                        color="subdued"
                        alignment="center"
                      >
                        Personalized recommendations boost conversion rates by
                        up to 40%
                      </s-text>
                    </s-stack>
                    <s-stack direction="block" gap="tight" align="center">
                      <s-text variant="heading-sm">Better Targeting</s-text>
                      <s-text
                        variant="body-sm"
                        color="subdued"
                        alignment="center"
                      >
                        Understand customer preferences and optimize your
                        product catalog
                      </s-text>
                    </s-stack>
                    <s-stack direction="block" gap="tight" align="center">
                      <s-text variant="heading-sm">AI-Powered</s-text>
                      <s-text
                        variant="body-sm"
                        color="subdued"
                        alignment="center"
                      >
                        Generate quiz questions automatically from your products
                      </s-text>
                    </s-stack>
                  </s-stack>

                  {/* Quick Start Steps */}
                  <s-banner variant="info">
                    <s-stack direction="block" gap="tight">
                      <s-text variant="heading-sm">Quick Start Guide</s-text>
                      <s-ordered-list>
                        <s-list-item>
                          Click &quot;Create Your First Quiz&quot; above
                        </s-list-item>
                        <s-list-item>
                          Let AI generate questions or build from scratch
                        </s-list-item>
                        <s-list-item>
                          Customize questions and product matching
                        </s-list-item>
                        <s-list-item>
                          Copy Quiz ID and add to your theme
                        </s-list-item>
                        <s-list-item>
                          Activate and start collecting responses!
                        </s-list-item>
                      </s-ordered-list>
                    </s-stack>
                  </s-banner>
                </s-stack>
              </s-box>
            </s-stack>
          </s-empty-state>
        </s-section>
      ) : (
        <s-section>
          <s-stack direction="block" gap="base">
            <s-banner>
              <s-text>
                <strong>Quick Tip:</strong> To display a quiz on your
                storefront, copy its Quiz ID using the Copy button below, then
                paste it into the Product Quiz block settings in your theme
                editor (Online Store → Themes → Customize → Add Block → Product
                Quiz).
              </s-text>
            </s-banner>

            <s-paragraph>
              Manage your product recommendation quizzes. Track performance and
              optimize for better conversions.
            </s-paragraph>

            <s-data-table>
              <s-table>
                <s-table-head>
                  <s-table-row>
                    <s-table-header>Quiz Name</s-table-header>
                    <s-table-header>Status</s-table-header>
                    <s-table-header>Quiz ID</s-table-header>
                    <s-table-header>Questions</s-table-header>
                    <s-table-header>Completions</s-table-header>
                    <s-table-header>Conversion Rate</s-table-header>
                    <s-table-header>Revenue</s-table-header>
                    <s-table-header>Actions</s-table-header>
                  </s-table-row>
                </s-table-head>
                <s-table-body>
                  {quizzes.map((quiz) => (
                    <s-table-row key={quiz.id}>
                      <s-table-cell>
                        <s-stack direction="block" gap="tight">
                          <s-text variant="heading-sm">{quiz.title}</s-text>
                          {quiz.description && (
                            <s-text variant="body-sm" color="subdued">
                              {quiz.description}
                            </s-text>
                          )}
                        </s-stack>
                      </s-table-cell>
                      <s-table-cell>
                        <s-stack direction="inline" gap="tight" align="center">
                          <s-badge
                            variant={
                              quiz.status === "active"
                                ? "success"
                                : quiz.status === "draft"
                                  ? "warning"
                                  : "default"
                            }
                          >
                            {quiz.status === "active" ? "Active" : "Draft"}
                          </s-badge>
                          <s-button
                            variant="tertiary"
                            size="sm"
                            onClick={() =>
                              toggleQuizStatus(quiz.id, quiz.status)
                            }
                            title={
                              quiz.status === "active"
                                ? "Set to draft"
                                : "Activate quiz"
                            }
                            aria-label={
                              quiz.status === "active"
                                ? `Deactivate quiz ${quiz.title}`
                                : `Activate quiz ${quiz.title}`
                            }
                          >
                            {quiz.status === "active"
                              ? "Deactivate"
                              : "Activate"}
                          </s-button>
                        </s-stack>
                      </s-table-cell>
                      <s-table-cell>
                        <s-stack direction="inline" gap="tight" align="center">
                          <s-text
                            className="text-mono text-truncate"
                            title={quiz.id}
                          >
                            {quiz.id}
                          </s-text>
                          <s-button
                            onClick={() => copyQuizId(quiz.id)}
                            variant="tertiary"
                            size="sm"
                            title="Copy Quiz ID for theme block"
                            aria-label={`Copy Quiz ID for ${quiz.title}`}
                          >
                            {copiedId === quiz.id ? "Copied!" : "Copy"}
                          </s-button>
                        </s-stack>
                      </s-table-cell>
                      <s-table-cell>{quiz.questionCount}</s-table-cell>
                      <s-table-cell>
                        {quiz.completions} / {quiz.views} views
                      </s-table-cell>
                      <s-table-cell>{quiz.completionRate}%</s-table-cell>
                      <s-table-cell>${quiz.revenue.toFixed(2)}</s-table-cell>
                      <s-table-cell>
                        <s-stack direction="inline" gap="tight">
                          <s-button
                            onClick={() =>
                              navigate(`/app/quizzes/${quiz.id}/edit`)
                            }
                            variant="tertiary"
                            size="sm"
                            aria-label={`Edit quiz ${quiz.title}`}
                          >
                            Edit
                          </s-button>
                          <s-button
                            onClick={() =>
                              navigate(`/app/quizzes/${quiz.id}/analytics`)
                            }
                            variant="tertiary"
                            size="sm"
                            aria-label={`View analytics for ${quiz.title}`}
                          >
                            Analytics
                          </s-button>
                          <s-button
                            onClick={() =>
                              handleDeleteQuiz(quiz.id, quiz.title)
                            }
                            variant="tertiary"
                            size="sm"
                            aria-label={`Delete quiz ${quiz.title}`}
                          >
                            Delete
                          </s-button>
                        </s-stack>
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            </s-data-table>
                  <s-button
                onClick={() => navigate("/app/quizzes/new")}
                variant="primary"
                size="large"
              >
                Create Quiz
              </s-button>
            {/* Mobile-friendly card layout (hidden on desktop) */}
            <div className="mobile-quiz-list mobile-only">
              <s-stack direction="block" gap="base">
                {quizzes.map((quiz) => (
                  <s-box
                    key={quiz.id}
                    padding="base"
                    borderWidth="base"
                    borderRadius="base"
                    background="surface"
                    onClick={() => navigate(`/app/quizzes/${quiz.id}/edit`)}
                    className="selectable-item"
                  >
                    <s-stack direction="block" gap="base">
                      {/* Title and Status */}
                      <s-stack direction="block" gap="tight">
                        <s-text variant="heading-md">{quiz.title}</s-text>
                        {quiz.description && (
                          <s-text variant="body-sm" color="subdued">
                            {quiz.description}
                          </s-text>
                        )}
                        <s-badge
                          variant={
                            quiz.status === "active"
                              ? "success"
                              : quiz.status === "draft"
                                ? "warning"
                                : "default"
                          }
                        >
                          {quiz.status === "active" ? "Active" : "Draft"}
                        </s-badge>
                      </s-stack>

                      {/* Stats */}
                      <s-stack direction="block" gap="tight">
                        <s-text variant="body-sm">
                          {quiz.questionCount} questions • {quiz.completions}{" "}
                          completions • {quiz.completionRate}% conversion
                        </s-text>
                        <s-text variant="body-sm">
                          ${quiz.revenue.toFixed(2)} revenue
                        </s-text>
                      </s-stack>

                      {/* Action Buttons */}
                      <s-stack direction="block" gap="tight">
                        <s-button
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/app/quizzes/${quiz.id}/edit`);
                          }}
                          variant="primary"
                        >
                          Edit Quiz
                        </s-button>
                        <s-button
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/app/quizzes/${quiz.id}/analytics`);
                          }}
                          variant="secondary"
                        >
                          View Analytics
                        </s-button>
                        <s-button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleQuizStatus(quiz.id, quiz.status);
                          }}
                          variant="tertiary"
                        >
                          {quiz.status === "active"
                            ? "Set to Draft"
                            : "Activate"}
                        </s-button>
                        <s-button
                          onClick={(e) => {
                            e.stopPropagation();
                            copyQuizId(quiz.id);
                          }}
                          variant="tertiary"
                        >
                          {copiedId === quiz.id
                            ? "Copied Quiz ID"
                            : "Copy Quiz ID"}
                        </s-button>
                        <s-button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteQuiz(quiz.id, quiz.title);
                          }}
                          variant="tertiary"
                        >
                          Delete Quiz
                        </s-button>
                      </s-stack>
                    </s-stack>
                  </s-box>
                ))}
              </s-stack>
            </div>
          </s-stack>
        </s-section>
      )}

      <s-section slot="aside" heading="Tips for Success">
        <s-unordered-list>
          <s-list-item>
            Keep quizzes short (5-7 questions) for higher completion rates
          </s-list-item>
          <s-list-item>
            Use engaging images to make questions more interactive
          </s-list-item>
          <s-list-item>
            Enable email capture to build your marketing list
          </s-list-item>
          <s-list-item>
            Monitor analytics to optimize underperforming quizzes
          </s-list-item>
        </s-unordered-list>
      </s-section>

      {/* Delete Confirmation Modal */}
      {confirmModal.isOpen && (
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- Modal backdrop dismiss pattern
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-modal-title"
          onClick={() =>
            setConfirmModal({ isOpen: false, quizId: "", quizTitle: "" })
          }
        >
          <s-box
            padding="large"
            borderRadius="base"
            background="surface"
            className="modal-container"
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            <s-stack direction="block" gap="base">
              <s-text id="delete-modal-title" variant="heading-md">Delete Quiz?</s-text>
              <s-text variant="body-md">
                Are you sure you want to delete &quot;{confirmModal.quizTitle}
                &quot;? This action cannot be undone and will delete all
                questions, options, results, and analytics data associated with
                this quiz.
              </s-text>
              <s-stack direction="inline" gap="base">
                <s-button
                  onClick={() =>
                    setConfirmModal({
                      isOpen: false,
                      quizId: "",
                      quizTitle: "",
                    })
                  }
                  variant="secondary"
                >
                  Cancel
                </s-button>
                <s-button
                  onClick={confirmDelete}
                  variant="primary"
                  tone="critical"
                >
                  Delete Quiz
                </s-button>
              </s-stack>
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
