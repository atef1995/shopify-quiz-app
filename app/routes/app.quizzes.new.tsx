import { useState } from "react";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  HeadersFunction,
} from "react-router";
import { redirect, Form, useNavigation, Link } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import prisma from "../db.server";

/**
 * Loader to prepare data for quiz creation
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

/**
 * Action handler for creating new quizzes
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get("action");

  console.log("Quiz creation action:", action);

  if (action === "create") {
    const title = formData.get("title") as string;
    const description = formData.get("description") as string;
    const useAI = formData.get("useAI") === "true";
    
    console.log("Creating quiz:", { title, description, useAI, shop: session.shop });

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

      console.log("Quiz created successfully:", quiz.id);

      // Create analytics record
      await prisma.quizAnalytics.create({
        data: {
          quizId: quiz.id,
        },
      });

      console.log("Analytics record created for quiz:", quiz.id);

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
            console.warn("AI generation API error:", generateResponse.status, errorText);
          } else {
            const result = await generateResponse.json();
            
            if (!result.success) {
              console.warn("AI generation failed:", result.error);
            } else {
              console.log("AI generation successful:", result);
            }
          }
        } catch (error) {
          console.warn("AI generation error:", error);
          // Continue to edit page even if AI generation fails
        }
      }

      console.log("Redirecting to edit page for quiz:", quiz.id);
      return redirect(`/app/quizzes/${quiz.id}/edit`);
      
    } catch (error) {
      console.error("Error creating quiz:", error);
      return Response.json(
        { error: "Failed to create quiz" },
        { status: 500 }
      );
    }
  }

  return null;
};

export default function NewQuiz() {
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const isSubmitting = navigation.state === "submitting";
  const [showAILoading, setShowAILoading] = useState(false);
  const [useAI, setUseAI] = useState(false);

  // Show loading modal when AI generation is in progress
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    const formData = new FormData(e.currentTarget);
    const useAIValue = formData.get("useAI") === "true";
    
    if (useAIValue) {
      setShowAILoading(true);
      shopify.toast.show(
        "Generating quiz with AI... This may take 10-15 seconds",
        { duration: 4000 }
      );
    }
  };

  return (
    <s-page heading="Create New Quiz" backAction={{ url: "/app/quizzes" }} max-width="full">
      <s-section>
        <s-stack direction="block" gap="base">
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
                      </s-text>
                      <s-text variant="body-sm" color="subdued">
                        AI will analyze your products and create personalized
                        quiz questions automatically. You can edit them after
                        creation.
                      </s-text>
                    </s-stack>
                  </s-stack>

                  <s-checkbox
                    name="useAI"
                    value="true"
                    label="Use AI to generate quiz questions from my product catalog"
                    onChange={(e) => setUseAI((e.target as HTMLInputElement).checked)}
                  />

                  <s-banner variant="info">
                    After creating the quiz, you&apos;ll be able to customize the
                    AI-generated questions, add images, and set up conditional
                    logic.
                  </s-banner>
                </s-stack>
              </s-box>

              {/* Submit Buttons */}
              <s-stack direction="inline" gap="base">
                <s-button
                  type="submit"
                  variant="primary"
                  loading={isSubmitting}
                >
                  Create Quiz
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
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <s-box
            padding="large"
            borderRadius="base"
            background="surface"
            style={{ maxWidth: "500px", width: "90%" }}
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
