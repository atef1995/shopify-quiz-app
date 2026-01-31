import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
} from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";

/**
 * Loader to fetch webhook settings
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const webhookSettings = await prisma.webhookSettings.findUnique({
    where: { shop: session.shop },
  });

  return {
    webhookSettings: webhookSettings || {
      enabled: false,
      quizStartedUrl: '',
      questionAnsweredUrl: '',
      quizCompletedUrl: '',
      emailCapturedUrl: '',
      webhookSecret: '',
    },
  };
};

/**
 * Action to update webhook settings
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const formData = await request.formData();
  const enabled = formData.get('enabled') === 'on';
  const quizStartedUrl = formData.get('quizStartedUrl') as string || null;
  const questionAnsweredUrl = formData.get('questionAnsweredUrl') as string || null;
  const quizCompletedUrl = formData.get('quizCompletedUrl') as string || null;
  const emailCapturedUrl = formData.get('emailCapturedUrl') as string || null;
  const webhookSecret = formData.get('webhookSecret') as string || null;

  // Validate URLs if provided
  const urlFields = [quizStartedUrl, questionAnsweredUrl, quizCompletedUrl, emailCapturedUrl];
  for (const url of urlFields) {
    if (url && !isValidUrl(url)) {
      return Response.json(
        { error: "Invalid URL format" },
        { status: 400 }
      );
    }
  }

  await prisma.webhookSettings.upsert({
    where: { shop: session.shop },
    update: {
      enabled,
      quizStartedUrl,
      questionAnsweredUrl,
      quizCompletedUrl,
      emailCapturedUrl,
      webhookSecret,
    },
    create: {
      shop: session.shop,
      enabled,
      quizStartedUrl,
      questionAnsweredUrl,
      quizCompletedUrl,
      emailCapturedUrl,
      webhookSecret,
    },
  });

  return Response.json({ success: true });
};

/**
 * Validate URL format
 */
function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return url.startsWith('http://') || url.startsWith('https://');
  } catch {
    return false;
  }
}

export default function WebhookSettings() {
  const { webhookSettings } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  const isSubmitting = fetcher.state === 'submitting';

  return (
    <s-page
      title="Webhook Settings"
      subtitle="Configure custom integrations to receive real-time quiz events"
    >
      <s-card>
        <fetcher.Form method="post">
          <s-block-stack gap="base">
            <s-box padding="base">
              <s-block-stack gap="tight">
                <s-text variant="heading-md">Webhook Configuration</s-text>
                <s-text variant="body-sm" color="subdued">
                  Receive real-time notifications when quiz events occur. Perfect for integrating with Zapier, custom CRM systems, or analytics platforms.
                </s-text>
              </s-block-stack>
            </s-box>

            <s-box padding="base">
              <s-block-stack gap="base">
                <s-checkbox
                  label="Enable webhooks"
                  name="enabled"
                  defaultChecked={webhookSettings.enabled}
                />

                <s-text-field
                  label="Quiz Started Webhook URL"
                  name="quizStartedUrl"
                  type="url"
                  placeholder="https://your-app.com/webhooks/quiz-started"
                  defaultValue={webhookSettings.quizStartedUrl || ''}
                  helpText="Called when a customer begins taking a quiz"
                />

                <s-text-field
                  label="Question Answered Webhook URL"
                  name="questionAnsweredUrl"
                  type="url"
                  placeholder="https://your-app.com/webhooks/question-answered"
                  defaultValue={webhookSettings.questionAnsweredUrl || ''}
                  helpText="Called when a customer answers a question"
                />

                <s-text-field
                  label="Quiz Completed Webhook URL"
                  name="quizCompletedUrl"
                  type="url"
                  placeholder="https://your-app.com/webhooks/quiz-completed"
                  defaultValue={webhookSettings.quizCompletedUrl || ''}
                  helpText="Called when a customer completes a quiz"
                />

                <s-text-field
                  label="Email Captured Webhook URL"
                  name="emailCapturedUrl"
                  type="url"
                  placeholder="https://your-app.com/webhooks/email-captured"
                  defaultValue={webhookSettings.emailCapturedUrl || ''}
                  helpText="Called when a customer provides their email"
                />

                <s-text-field
                  label="Webhook Secret"
                  name="webhookSecret"
                  type="password"
                  placeholder="your-webhook-secret"
                  defaultValue={webhookSettings.webhookSecret || ''}
                  helpText="Secret key for webhook signature verification (optional but recommended)"
                />
              </s-block-stack>
            </s-box>

            <s-box padding="base">
              <s-button
                type="submit"
                variant="primary"
                loading={isSubmitting}
              >
                Save Settings
              </s-button>
            </s-box>
          </s-block-stack>
        </fetcher.Form>
      </s-card>

      <s-card>
        <s-block-stack gap="base">
          <s-box padding="base">
            <s-text variant="heading-md">Webhook Events</s-text>
          </s-box>

          <s-box padding="base">
            <s-block-stack gap="base">
              <s-box padding="base" borderWidth="base" borderRadius="base" background="surface">
                <s-block-stack gap="tight">
                  <s-text variant="heading-sm">quiz_started</s-text>
                  <s-text variant="body-sm" color="subdued">
                    Triggered when a customer begins taking a quiz
                  </s-text>
                  <s-code>
                    {JSON.stringify({
                      event: "quiz_started",
                      shop: "your-store.myshopify.com",
                      quizId: "abc123",
                      quizTitle: "Skin Type Quiz",
                      timestamp: "2024-01-01T12:00:00Z",
                      data: {
                        totalQuestions: 5
                      }
                    }, null, 2)}
                  </s-code>
                </s-block-stack>
              </s-box>

              <s-box padding="base" borderWidth="base" borderRadius="base" background="surface">
                <s-block-stack gap="tight">
                  <s-text variant="heading-sm">question_answered</s-text>
                  <s-text variant="body-sm" color="subdued">
                    Triggered when a customer answers a question
                  </s-text>
                  <s-code>
                    {JSON.stringify({
                      event: "question_answered",
                      shop: "your-store.myshopify.com",
                      quizId: "abc123",
                      timestamp: "2024-01-01T12:00:30Z",
                      data: {
                        questionId: "q1",
                        questionText: "What's your skin type?",
                        answer: "Dry",
                        questionNumber: 1,
                        totalQuestions: 5
                      }
                    }, null, 2)}
                  </s-code>
                </s-block-stack>
              </s-box>

              <s-box padding="base" borderWidth="base" borderRadius="base" background="surface">
                <s-block-stack gap="tight">
                  <s-text variant="heading-sm">quiz_completed</s-text>
                  <s-text variant="body-sm" color="subdued">
                    Triggered when a customer completes a quiz
                  </s-text>
                  <s-code>
                    {JSON.stringify({
                      event: "quiz_completed",
                      shop: "your-store.myshopify.com",
                      quizId: "abc123",
                      timestamp: "2024-01-01T12:02:15Z",
                      data: {
                        email: "customer@example.com",
                        answersCount: 5,
                        recommendedProductsCount: 3,
                        totalTimeSeconds: 135.2,
                        quizTitle: "Skin Type Quiz"
                      }
                    }, null, 2)}
                  </s-code>
                </s-block-stack>
              </s-box>

              <s-box padding="base" borderWidth="base" borderRadius="base" background="surface">
                <s-block-stack gap="tight">
                  <s-text variant="heading-sm">email_captured</s-text>
                  <s-text variant="body-sm" color="subdued">
                    Triggered when a customer provides their email
                  </s-text>
                  <s-code>
                    {JSON.stringify({
                      event: "email_captured",
                      shop: "your-store.myshopify.com",
                      quizId: "abc123",
                      timestamp: "2024-01-01T12:01:45Z",
                      data: {
                        email: "customer@example.com",
                        quizTitle: "Skin Type Quiz",
                        totalQuestions: 5,
                        answersCount: 5
                      }
                    }, null, 2)}
                  </s-code>
                </s-block-stack>
              </s-box>
            </s-block-stack>
          </s-box>
        </s-block-stack>
      </s-card>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};