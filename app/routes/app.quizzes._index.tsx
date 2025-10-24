import { useEffect, useState } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, Link, useFetcher, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { HeadersFunction } from "react-router";
import prisma from "../db.server";
import { getUsageStats } from "../lib/billing.server";

/**
 * Action handler for quick status toggle
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const quizId = formData.get("quizId") as string;
  const newStatus = formData.get("status") as string;

  await prisma.quiz.update({
    where: { id: quizId, shop: session.shop },
    data: { status: newStatus },
  });

  const message = newStatus === "active" 
    ? "Quiz activated successfully!" 
    : "Quiz set to draft.";

  return { success: true, message };
};

/**
 * Loader function to fetch all quizzes for the current shop
 * Includes basic analytics data for each quiz and usage stats
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // Get usage stats for billing banner
  const usageStats = await getUsageStats(session.shop);

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
            (quiz.analytics.totalCompletions / quiz.analytics.totalViews) * 100
          )
        : 0,
    revenue: quiz.analytics?.totalRevenue || 0,
    createdAt: quiz.createdAt.toISOString(),
    updatedAt: quiz.updatedAt.toISOString(),
  }));

  return {
    quizzes: quizzesWithStats,
    usage: usageStats,
  };
};

export default function QuizzesIndex() {
  const { quizzes, usage } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const isNearLimit = usage.percentUsed >= 80;
  const isOverLimit = usage.percentUsed >= 100;

  const copyQuizId = async (quizId: string) => {
    try {
      await navigator.clipboard.writeText(quizId);
      setCopiedId(quizId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const toggleQuizStatus = (quizId: string, currentStatus: string) => {
    const newStatus = currentStatus === "active" ? "draft" : "active";
    const formData = new FormData();
    formData.append("quizId", quizId);
    formData.append("status", newStatus);
    fetcher.submit(formData, { method: "POST" });
  };

  return (
    <s-page heading="Product Quiz Builder">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => navigate("/app/quizzes/new")}
      >
        Create Quiz
      </s-button>

      {/* Usage Banner */}
      {isOverLimit && (
        <s-section>
          <s-banner variant="critical">
            <s-text variant="body-sm">
              You've reached your monthly limit of {usage.limit} completions.{" "}
              <s-link onClick={() => navigate("/app/billing")}>Upgrade your plan</s-link> to continue
              collecting quiz responses.
            </s-text>
          </s-banner>
        </s-section>
      )}

      {isNearLimit && !isOverLimit && (
        <s-section>
          <s-banner variant="warning">
            <s-text variant="body-sm">
              You've used {usage.currentUsage} of {usage.limit} monthly
              completions ({usage.percentUsed}%).{" "}
              <s-link onClick={() => navigate("/app/billing")}>View billing</s-link> to upgrade before
              reaching your limit.
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
            <s-button onClick={() => navigate("/app/quizzes/new")} variant="primary">
              Create Quiz
            </s-button>
          </s-empty-state>
        </s-section>
      ) : (
        <s-section>
          <s-stack direction="block" gap="base">
            <s-banner>
              <s-text>
                💡 <strong>Quick Tip:</strong> To display a quiz on your storefront, copy its Quiz ID using the 📋 Copy button below, 
                then paste it into the Product Quiz block settings in your theme editor 
                (Online Store → Themes → Customize → Add Block → Product Quiz).
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
                            {quiz.status === "active" ? "🟢 Active" : "🟡 Draft"}
                          </s-badge>
                          <s-button
                            variant="tertiary"
                            size="sm"
                            onClick={() => toggleQuizStatus(quiz.id, quiz.status)}
                            title={quiz.status === "active" ? "Set to draft" : "Activate quiz"}
                          >
                            {quiz.status === "active" ? "Deactivate" : "Activate"}
                          </s-button>
                        </s-stack>
                      </s-table-cell>
                      <s-table-cell>
                        <s-stack direction="inline" gap="tight" align="center">
                          <s-text 
                            style={{ 
                              fontFamily: 'monospace', 
                              fontSize: '12px',
                              maxWidth: '120px',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap'
                            }}
                            title={quiz.id}
                          >
                            {quiz.id}
                          </s-text>
                          <s-button
                            onClick={() => copyQuizId(quiz.id)}
                            variant="tertiary"
                            size="sm"
                            title="Copy Quiz ID for theme block"
                          >
                            {copiedId === quiz.id ? '✓ Copied!' : '📋 Copy'}
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
                            onClick={() => navigate(`/app/quizzes/${quiz.id}/edit`)}
                            variant="tertiary"
                            size="sm"
                          >
                            Edit
                          </s-button>
                          <s-button
                            onClick={() => navigate(`/app/quizzes/${quiz.id}/analytics`)}
                            variant="tertiary"
                            size="sm"
                          >
                            Analytics
                          </s-button>
                        </s-stack>
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            </s-data-table>
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
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
