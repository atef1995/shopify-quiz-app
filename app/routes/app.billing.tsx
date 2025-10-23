import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getUsageStats, TIER_LIMITS } from "../lib/billing.server";

/**
 * Loader to fetch billing and usage information
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const usageStats = await getUsageStats(session.shop);

  // Get all tier information for comparison
  const tiers = Object.entries(TIER_LIMITS).map(([key, value]) => ({
    key,
    name: value.name,
    price: value.price,
    limit: value.monthlyCompletions,
    features: getTierFeatures(key as keyof typeof TIER_LIMITS),
    isCurrent: key === usageStats.tier,
  }));

  return {
    usage: usageStats,
    tiers,
  };
};

/**
 * Get feature list for each tier
 */
function getTierFeatures(tier: keyof typeof TIER_LIMITS) {
  const baseFeatures = [
    "Unlimited quizzes",
    "Email capture",
    "Basic analytics",
    "Product recommendations",
  ];

  const tierFeatures = {
    free: [...baseFeatures, "100 completions/month"],
    growth: [
      ...baseFeatures,
      "1,000 completions/month",
      "AI quiz generation",
      "Conditional logic",
    ],
    pro: [
      ...baseFeatures,
      "10,000 completions/month",
      "AI quiz generation",
      "Conditional logic",
      "Advanced analytics",
      "Priority support",
    ],
    enterprise: [
      ...baseFeatures,
      "Unlimited completions",
      "AI quiz generation",
      "Conditional logic",
      "Advanced analytics",
      "Priority support",
      "Custom integrations",
      "Dedicated account manager",
    ],
  };

  return tierFeatures[tier];
}

export default function Billing() {
  const { usage, tiers } = useLoaderData<typeof loader>();

  const isNearLimit = usage.percentUsed >= 80;
  const isOverLimit = usage.percentUsed >= 100;

  return (
    <s-page heading="Billing & Usage">
      {/* Current Usage */}
      <s-section heading="Current Usage">
        <s-stack direction="block" gap="base">
          {isOverLimit && (
            <s-banner variant="critical">
              <s-text variant="body-sm">
                You've reached your monthly limit. Upgrade your plan to continue
                collecting quiz completions.
              </s-text>
            </s-banner>
          )}

          {isNearLimit && !isOverLimit && (
            <s-banner variant="warning">
              <s-text variant="body-sm">
                You've used {usage.percentUsed}% of your monthly limit. Consider
                upgrading to avoid service interruption.
              </s-text>
            </s-banner>
          )}

          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="surface"
          >
            <s-stack direction="block" gap="base">
              <s-stack
                direction="inline"
                gap="base"
                align="space-between"
              >
                <s-stack direction="block" gap="tight">
                  <s-text variant="heading-lg">
                    {usage.tierName} Plan
                  </s-text>
                  <s-text variant="body-sm" color="subdued">
                    Current billing period ends in {usage.daysUntilReset} days
                  </s-text>
                </s-stack>
                <s-badge
                  variant={
                    usage.status === "active"
                      ? "success"
                      : "critical"
                  }
                >
                  {usage.status}
                </s-badge>
              </s-stack>

              <s-stack direction="block" gap="tight">
                <s-stack
                  direction="inline"
                  gap="base"
                  align="space-between"
                >
                  <s-text variant="body-sm">Quiz Completions</s-text>
                  <s-text variant="body-sm">
                    {usage.currentUsage} /{" "}
                    {usage.limit === -1 ? "Unlimited" : usage.limit}
                  </s-text>
                </s-stack>

                {usage.limit !== -1 && (
                  <>
                    <div
                      style={{
                        width: "100%",
                        height: "8px",
                        backgroundColor: "#e5e7eb",
                        borderRadius: "999px",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.min(usage.percentUsed, 100)}%`,
                          height: "100%",
                          backgroundColor:
                            usage.percentUsed >= 100
                              ? "#dc2626"
                              : usage.percentUsed >= 80
                                ? "#f59e0b"
                                : "#3b82f6",
                          transition: "width 0.3s ease",
                        }}
                      />
                    </div>
                    <s-text variant="body-sm" color="subdued">
                      {usage.percentUsed}% used
                    </s-text>
                  </>
                )}
              </s-stack>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      {/* Pricing Plans */}
      <s-section heading="Pricing Plans">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Choose the plan that fits your business needs. Upgrade or downgrade
            anytime.
          </s-paragraph>

          <s-grid columns={tiers.length === 4 ? 4 : 3}>
            {tiers.map((tier) => (
              <s-box
                key={tier.key}
                padding="base"
                borderWidth={tier.isCurrent ? "thick" : "base"}
                borderRadius="base"
                background={tier.isCurrent ? "subdued" : "surface"}
                style={{
                  borderColor: tier.isCurrent ? "#3b82f6" : undefined,
                }}
              >
                <s-stack direction="block" gap="base">
                  {tier.isCurrent && (
                    <s-badge variant="info">Current Plan</s-badge>
                  )}

                  <s-stack direction="block" gap="tight">
                    <s-text variant="heading-md">{tier.name}</s-text>
                    <s-text variant="heading-xl">
                      ${tier.price}
                      <s-text variant="body-sm" color="subdued">
                        /month
                      </s-text>
                    </s-text>
                  </s-stack>

                  <s-stack direction="block" gap="tight">
                    {tier.features.map((feature, index) => (
                      <s-stack
                        key={index}
                        direction="inline"
                        gap="tight"
                        align="center"
                      >
                        <s-icon source="checkmark" />
                        <s-text variant="body-sm">{feature}</s-text>
                      </s-stack>
                    ))}
                  </s-stack>

                  {!tier.isCurrent && (
                    <s-button variant="primary" fullWidth disabled>
                      Upgrade (Coming Soon)
                    </s-button>
                  )}
                </s-stack>
              </s-box>
            ))}
          </s-grid>
        </s-stack>
      </s-section>

      {/* FAQ */}
      <s-section slot="aside" heading="Billing FAQ">
        <s-stack direction="block" gap="base">
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="surface"
          >
            <s-stack direction="block" gap="tight">
              <s-text variant="heading-sm">When does my usage reset?</s-text>
              <s-text variant="body-sm" color="subdued">
                Your usage resets monthly on your subscription anniversary
                date.
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
              <s-text variant="heading-sm">Can I change plans?</s-text>
              <s-text variant="body-sm" color="subdued">
                Yes! You can upgrade or downgrade your plan at any time. Changes
                take effect immediately.
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
              <s-text variant="heading-sm">What happens if I exceed my limit?</s-text>
              <s-text variant="body-sm" color="subdued">
                Once you reach your limit, new quiz completions will be blocked
                until you upgrade or your usage resets.
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
