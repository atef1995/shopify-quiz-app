/**
 * Billing Success Route
 *
 * Shows a success page after merchant successfully subscribes to a plan.
 * Provides next steps and celebrates the upgrade.
 */

import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import { getUsageStats } from "../lib/billing.server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useEffect } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  // Get updated usage stats after subscription
  const usageStats = await getUsageStats(session.shop, admin);

  return {
    shop: session.shop,
    usage: usageStats,
  };
};

export default function BillingSuccess() {
  const { usage } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const shopify = useAppBridge();

  useEffect(() => {
    // Show success toast
    shopify.toast.show("Welcome to the " + usage.tierName + " plan! 🎉");
  }, [shopify, usage.tierName]);

  const handleCreateQuiz = () => {
    navigate("/app/quizzes/new");
  };

  const handleViewDashboard = () => {
    navigate("/app/quizzes");
  };

  const handleViewBilling = () => {
    navigate("/app/billing");
  };

  return (
    <s-page heading="Welcome to your new plan! 🎉" max-width="full">
      <s-section>
        <s-stack direction="block" gap="large">
          <s-banner variant="success">
            <s-text variant="body-md">
              Congratulations! You've successfully upgraded to the <strong>{usage.tierName} Plan</strong>.
              Your new features are now available.
            </s-text>
          </s-banner>

          <s-card>
            <s-stack direction="block" gap="base">
              <s-heading>Your {usage.tierName} Plan Benefits</s-heading>
              <s-stack direction="block" gap="tight">
                {usage.tier === "growth" && (
                  <>
                    <s-stack direction="inline" gap="tight" align="start">
                      <s-icon source="checkmark" />
                      <s-text variant="body-sm">Up to 10 active quizzes</s-text>
                    </s-stack>
                    <s-stack direction="inline" gap="tight" align="start">
                      <s-icon source="checkmark" />
                      <s-text variant="body-sm">1,000 monthly quiz completions</s-text>
                    </s-stack>
                    <s-stack direction="inline" gap="tight" align="start">
                      <s-icon source="checkmark" />
                      <s-text variant="body-sm">AI-powered quiz generation</s-text>
                    </s-stack>
                    <s-stack direction="inline" gap="tight" align="start">
                      <s-icon source="checkmark" />
                      <s-text variant="body-sm">Advanced conditional logic</s-text>
                    </s-stack>
                  </>
                )}
                {usage.tier === "pro" && (
                  <>
                    <s-stack direction="inline" gap="tight" align="start">
                      <s-icon source="checkmark" />
                      <s-text variant="body-sm">Up to 50 active quizzes</s-text>
                    </s-stack>
                    <s-stack direction="inline" gap="tight" align="start">
                      <s-icon source="checkmark" />
                      <s-text variant="body-sm">10,000 monthly quiz completions</s-text>
                    </s-stack>
                    <s-stack direction="inline" gap="tight" align="start">
                      <s-icon source="checkmark" />
                      <s-text variant="body-sm">AI-powered recommendations</s-text>
                    </s-stack>
                    <s-stack direction="inline" gap="tight" align="start">
                      <s-icon source="checkmark" />
                      <s-text variant="body-sm">Advanced analytics & reporting</s-text>
                    </s-stack>
                    <s-stack direction="inline" gap="tight" align="start">
                      <s-icon source="checkmark" />
                      <s-text variant="body-sm">Priority support</s-text>
                    </s-stack>
                  </>
                )}
                {usage.tier === "enterprise" && (
                  <>
                    <s-stack direction="inline" gap="tight" align="start">
                      <s-icon source="checkmark" />
                      <s-text variant="body-sm">Unlimited active quizzes</s-text>
                    </s-stack>
                    <s-stack direction="inline" gap="tight" align="start">
                      <s-icon source="checkmark" />
                      <s-text variant="body-sm">Unlimited monthly completions</s-text>
                    </s-stack>
                    <s-stack direction="inline" gap="tight" align="start">
                      <s-icon source="checkmark" />
                      <s-text variant="body-sm">All premium features</s-text>
                    </s-stack>
                    <s-stack direction="inline" gap="tight" align="start">
                      <s-icon source="checkmark" />
                      <s-text variant="body-sm">Dedicated account manager</s-text>
                    </s-stack>
                  </>
                )}
              </s-stack>
            </s-stack>
          </s-card>

          <s-card>
            <s-stack direction="block" gap="base">
              <s-heading>What's Next?</s-heading>
              <s-stack direction="block" gap="base">
                <s-stack direction="inline" gap="tight" align="start">
                  <s-icon source="quiz" />
                  <s-text variant="body-sm">
                    <strong>Create your first quiz</strong> - Use your new AI generation features to build engaging quizzes
                  </s-text>
                </s-stack>
                <s-stack direction="inline" gap="tight" align="start">
                  <s-icon source="products" />
                  <s-text variant="body-sm">
                    <strong>Connect your products</strong> - Set up product recommendations for better conversions
                  </s-text>
                </s-stack>
                <s-stack direction="inline" gap="tight" align="start">
                  <s-icon source="analytics" />
                  <s-text variant="body-sm">
                    <strong>Track performance</strong> - Monitor quiz completion rates and conversion metrics
                  </s-text>
                </s-stack>
              </s-stack>
            </s-stack>
          </s-card>

          <s-stack direction="inline" gap="base">
            <s-button variant="primary" onClick={handleCreateQuiz}>
              Create Your First Quiz
            </s-button>
            <s-button variant="secondary" onClick={handleViewDashboard}>
              View Dashboard
            </s-button>
            <s-button variant="tertiary" onClick={handleViewBilling}>
              View Billing Details
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Need Help Getting Started?">
        <s-paragraph>
          Check out our comprehensive guides and tutorials to make the most of your new plan.
          Our support team is also here to help you succeed.
        </s-paragraph>
        <s-stack direction="inline" gap="base">
          <s-link href="/app/support">Help Center</s-link>
          <s-link href="mailto:atefm6@gmail.com">Contact Support</s-link>
        </s-stack>
      </s-section>
    </s-page>
  );
}