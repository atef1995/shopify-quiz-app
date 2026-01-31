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
          order: true,
          analytics: true,
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

  // Parse advanced metrics
  let advancedMetrics = null;
  try {
    advancedMetrics = analytics.advancedMetrics ? JSON.parse(analytics.advancedMetrics) : null;
  } catch (error) {
    console.error('Failed to parse advanced metrics:', error);
  }

  // Format question analytics
  const questionAnalytics = quiz.questions.map(question => ({
    id: question.id,
    text: question.text,
    order: question.order,
    views: question.analytics?.views || 0,
    completions: question.analytics?.completions || 0,
    dropOffs: advancedMetrics?.dropOffPoints?.[question.id] || 0,
    averageTime: question.analytics?.averageTime || 0,
    completionRate: question.analytics?.views > 0
      ? ((question.analytics.completions / question.analytics.views) * 100).toFixed(1)
      : "0",
  }));

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
      advancedMetrics,
    },
    questionAnalytics,
    recentResults,
  };
};

export default function QuizAnalytics() {
  const { quiz, analytics, questionAnalytics, recentResults } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <s-page
      heading={`Analytics: ${quiz.title}`}
      backAction={{ onAction: () => navigate(`/app/quizzes/${quiz.id}/edit`) }}
      max-width="full"
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

      {/* Advanced Analytics */}
      {analytics.advancedMetrics && (
        <>
          {/* Average Completion Time */}
          <s-section heading="Quiz Performance">
            <s-grid columns={2}>
              <s-box
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="surface"
              >
                <s-stack direction="block" gap="tight">
                  <s-text variant="body-sm" color="subdued">
                    Average Completion Time
                  </s-text>
                  <s-text variant="heading-lg">
                    {analytics.advancedMetrics.averageCompletionTime
                      ? `${Math.round(analytics.advancedMetrics.averageCompletionTime)}s`
                      : "N/A"}
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
                    Conversion Rate
                  </s-text>
                  <s-text variant="heading-lg">
                    {analytics.advancedMetrics.conversionFunnel?.completionRate?.toFixed(1) || 0}%
                  </s-text>
                </s-stack>
              </s-box>
            </s-grid>
          </s-section>

          {/* Question-by-Question Analysis */}
          {questionAnalytics.length > 0 && (
            <s-section heading="Question Analysis">
              <s-data-table>
                <s-table>
                  <s-table-head>
                    <s-table-row>
                      <s-table-header>Question</s-table-header>
                      <s-table-header>Views</s-table-header>
                      <s-table-header>Completions</s-table-header>
                      <s-table-header>Drop-offs</s-table-header>
                      <s-table-header>Avg Time</s-table-header>
                      <s-table-header>Completion Rate</s-table-header>
                    </s-table-row>
                  </s-table-head>
                  <s-table-body>
                    {questionAnalytics.map((question) => (
                      <s-table-row key={question.id}>
                        <s-table-cell>
                          <s-text variant="body-sm" fontWeight="medium">
                            {question.order + 1}. {question.text}
                          </s-text>
                        </s-table-cell>
                        <s-table-cell>{question.views}</s-table-cell>
                        <s-table-cell>{question.completions}</s-table-cell>
                        <s-table-cell>
                          <s-text variant={question.dropOffs > 0 ? "body-sm" : undefined} color={question.dropOffs > 0 ? "critical" : undefined}>
                            {question.dropOffs}
                          </s-text>
                        </s-table-cell>
                        <s-table-cell>
                          {question.averageTime > 0 ? `${Math.round(question.averageTime)}s` : "N/A"}
                        </s-table-cell>
                        <s-table-cell>
                          <s-text variant="body-sm" color={parseFloat(question.completionRate) < 80 ? "critical" : "success"}>
                            {question.completionRate}%
                          </s-text>
                        </s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>
              </s-data-table>
            </s-section>
          )}
        </>
      )}

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
