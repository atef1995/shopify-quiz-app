import type {
  LoaderFunctionArgs,
  HeadersFunction,
} from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";

/**
 * Loader to fetch quiz analytics and completion data
 */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const quizId = params.id;

  if (!quizId) {
    throw new Response("Quiz ID is required", { status: 400 });
  }

  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId, shop: session.shop },
    include: {
      analytics: true,
      questions: {
        select: {
          id: true,
          text: true,
        },
      },
      results: {
        orderBy: {
          completedAt: "desc",
        },
        take: 10,
      },
    },
  });

  if (!quiz) {
    throw new Response("Quiz not found", { status: 404 });
  }

  const analytics = quiz.analytics || {
    totalViews: 0,
    totalCompletions: 0,
    emailCaptureCount: 0,
    totalRevenue: 0,
  };

  const completionRate =
    analytics.totalViews > 0
      ? ((analytics.totalCompletions / analytics.totalViews) * 100).toFixed(1)
      : "0";

  const emailCaptureRate =
    analytics.totalCompletions > 0
      ? (
          (analytics.emailCaptureCount / analytics.totalCompletions) *
          100
        ).toFixed(1)
      : "0";

  const averageRevenue =
    analytics.totalCompletions > 0
      ? (analytics.totalRevenue / analytics.totalCompletions).toFixed(2)
      : "0.00";

  // Format recent results
  const recentResults = quiz.results.map((result) => {
    const answers = result.answers ? JSON.parse(result.answers) : [];
    const recommendedProducts = result.recommendedProducts
      ? JSON.parse(result.recommendedProducts)
      : [];

    return {
      id: result.id,
      email: result.email || "Anonymous",
      completedAt: new Date(result.completedAt).toLocaleDateString(),
      answerCount: answers.length,
      productCount: recommendedProducts.length,
      revenue: result.revenue || 0,
      converted: !!result.convertedAt,
    };
  });

  return {
    quiz: {
      id: quiz.id,
      title: quiz.title,
      status: quiz.status,
    },
    analytics: {
      totalViews: analytics.totalViews,
      totalCompletions: analytics.totalCompletions,
      emailCaptureCount: analytics.emailCaptureCount,
      totalRevenue: analytics.totalRevenue,
      completionRate,
      emailCaptureRate,
      averageRevenue,
    },
    recentResults,
  };
};

export default function QuizAnalytics() {
  const { quiz, analytics, recentResults } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <s-page
      heading={`Analytics: ${quiz.title}`}
      backAction={{ onAction: () => navigate(`/app/quizzes/${quiz.id}/edit`) }}
    >
      {/* Key Metrics */}
      <s-section heading="Performance Overview">
        <s-stack direction="block" gap="base">
          <s-grid columns={4}>
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="surface"
            >
              <s-stack direction="block" gap="tight">
                <s-text variant="body-sm" color="subdued">
                  Total Views
                </s-text>
                <s-text variant="heading-lg">{analytics.totalViews}</s-text>
              </s-stack>
            </s-box>

            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="surface"
            >
              <s-stack direction="block" gap="tight">
                <s-text variant="body-sm" color="subdued">
                  Completions
                </s-text>
                <s-text variant="heading-lg">
                  {analytics.totalCompletions}
                </s-text>
                <s-text variant="body-sm" color="success">
                  {analytics.completionRate}% completion rate
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
                <s-text variant="body-sm" color="subdued">
                  Email Captures
                </s-text>
                <s-text variant="heading-lg">
                  {analytics.emailCaptureCount}
                </s-text>
                <s-text variant="body-sm" color="success">
                  {analytics.emailCaptureRate}% capture rate
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
                <s-text variant="body-sm" color="subdued">
                  Total Revenue
                </s-text>
                <s-text variant="heading-lg">
                  ${analytics.totalRevenue.toFixed(2)}
                </s-text>
                <s-text variant="body-sm" color="subdued">
                  ${analytics.averageRevenue} avg per completion
                </s-text>
              </s-stack>
            </s-box>
          </s-grid>

          {analytics.totalViews === 0 && (
            <s-banner variant="info">
              No data yet. Share your quiz with customers to start collecting
              analytics.
            </s-banner>
          )}
        </s-stack>
      </s-section>

      {/* Recent Completions */}
      <s-section heading="Recent Completions">
        {recentResults.length === 0 ? (
          <s-banner variant="info">
            No completions yet. Once customers start taking your quiz, their
            results will appear here.
          </s-banner>
        ) : (
          <s-data-table>
            <s-table>
              <s-table-head>
                <s-table-row>
                  <s-table-header>Email</s-table-header>
                  <s-table-header>Completed</s-table-header>
                  <s-table-header>Answers</s-table-header>
                  <s-table-header>Products Recommended</s-table-header>
                  <s-table-header>Revenue</s-table-header>
                  <s-table-header>Status</s-table-header>
                </s-table-row>
              </s-table-head>
              <s-table-body>
                {recentResults.map((result) => (
                  <s-table-row key={result.id}>
                    <s-table-cell>{result.email}</s-table-cell>
                    <s-table-cell>{result.completedAt}</s-table-cell>
                    <s-table-cell>{result.answerCount}</s-table-cell>
                    <s-table-cell>{result.productCount}</s-table-cell>
                    <s-table-cell>${result.revenue.toFixed(2)}</s-table-cell>
                    <s-table-cell>
                      {result.converted ? (
                        <s-badge variant="success">Converted</s-badge>
                      ) : (
                        <s-badge variant="default">Pending</s-badge>
                      )}
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </s-data-table>
        )}
      </s-section>

      {/* Insights & Tips */}
      <s-section slot="aside" heading="Optimization Tips">
        <s-stack direction="block" gap="base">
          {parseFloat(analytics.completionRate) < 50 && (
            <s-banner variant="warning">
              <s-text variant="body-sm">
                Your completion rate is below 50%. Consider reducing the number
                of questions or making them more engaging.
              </s-text>
            </s-banner>
          )}

          {parseFloat(analytics.emailCaptureRate) < 60 && (
            <s-banner variant="info">
              <s-text variant="body-sm">
                Improve email capture by offering an incentive (discount,
                exclusive content) before showing results.
              </s-text>
            </s-banner>
          )}

          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="surface"
          >
            <s-stack direction="block" gap="tight">
              <s-text variant="heading-sm">Benchmark Goals</s-text>
              <s-unordered-list>
                <s-list-item>Completion rate: 60-80%</s-list-item>
                <s-list-item>Email capture: 70-90%</s-list-item>
                <s-list-item>Conversion rate: 15-25%</s-list-item>
              </s-unordered-list>
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
