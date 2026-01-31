import type {
  LoaderFunctionArgs,
  HeadersFunction,
} from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  getUsageStats,
  TIER_LIMITS,
} from "../lib/billing.server";
import { useEffect } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { Redirect } from "@shopify/app-bridge/actions";

/**
 * Loader to fetch billing and usage information
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const usageStats = await getUsageStats(session.shop, admin);

  // Get all tier information for comparison
  const tiers = Object.entries(TIER_LIMITS).map(([key, value]) => {
    const pricing = getTierPricing(key as keyof typeof TIER_LIMITS);
    return {
      key,
      name: value.name,
      ...pricing,
      limit: value.monthlyCompletions,
      features: getTierFeatures(key as keyof typeof TIER_LIMITS),
      isCurrent: key === usageStats.tier,
    };
  });

  return {
    usage: usageStats,
    tiers,
    shop: session.shop,
  };
};

/**
 * Get feature list for each tier
 */
function getTierFeatures(tier: keyof typeof TIER_LIMITS): string[] {
  const tierFeatures: Record<keyof typeof TIER_LIMITS, string[]> = {
    free: [
      "3 active quizzes",
      "Basic quiz builder",
      "Simple analytics",
      "100 monthly completions",
      "Email support"
    ],
    growth: [
      "10 active quizzes",
      "Advanced conditional logic",
      "Detailed analytics & insights",
      "1,000 monthly completions",
      "Custom styling options",
      "Priority email support"
    ],
    pro: [
      "50 active quizzes",
      "AI-powered recommendations",
      "Advanced analytics & reporting",
      "10,000 monthly completions",
      "Custom CSS & branding",
      "Webhook integrations",
      "Priority support + live chat"
    ],
    enterprise: [
      "Unlimited quizzes & completions",
      "White-label options",
      "Custom integrations",
      "Dedicated account manager",
      "SLA guarantee",
      "Advanced API access",
      "Phone support"
    ],
  };

  return tierFeatures[tier];
}

/**
 * Get pricing information for each tier
 */
function getTierPricing(tier: keyof typeof TIER_LIMITS) {
  const pricing: Record<keyof typeof TIER_LIMITS, {
    monthlyPrice: number;
    yearlyPrice: number;
    yearlySavings: number;
    trialDays: number;
  }> = {
    free: {
      monthlyPrice: 0,
      yearlyPrice: 0,
      yearlySavings: 0,
      trialDays: 0,
    },
    growth: {
      monthlyPrice: 29.99,
      yearlyPrice: 309.99,
      yearlySavings: 49,
      trialDays: 7,
    },
    pro: {
      monthlyPrice: 99,
      yearlyPrice: 999,
      yearlySavings: 189,
      trialDays: 14,
    },
    enterprise: {
      monthlyPrice: 299,
      yearlyPrice: 2600,
      yearlySavings: 988,
      trialDays: 14,
    },
  };

  return pricing[tier];
}

export default function Billing() {
  const { usage, tiers, shop } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const shopify = useAppBridge();

  // Determine current tier price for UI conditional logic
  const currentTier = tiers.find((t) => t.isCurrent);
  const currentPrice = currentTier?.monthlyPrice ?? 0;

  const isNearLimit = usage.percentUsed >= 80;
  const isOverLimit = usage.percentUsed >= 100;

  // Show toast on billing status return
  // NOTE: Uses React Router navigate instead of window.history for proper embedded app navigation
  useEffect(() => {
    const url = new URL(window.location.href);
    const status = url.searchParams.get("status");

    if (status === "success") {
      shopify.toast.show("Subscription updated successfully!");
      // Clean URL using React Router navigate with replace option
      navigate("/app/billing", { replace: true });
    } else if (status === "error") {
      shopify.toast.show("Failed to update subscription", { isError: true });
      // Clean URL using React Router navigate with replace option
      navigate("/app/billing", { replace: true });
    }
  }, [shopify, navigate]);

  const handleManageBilling = () => {
    // Use App Bridge Redirect action to navigate to the shop admin app settings (better UX)
    const clientId = "ccb95c69fbef7812f6a59699510890a1"; // From shopify.app.toml
    try {
      const redirect = Redirect.create(shopify as any);
      redirect.dispatch(Redirect.Action.ADMIN_PATH, `/apps/${clientId}/settings`);
    } catch (err) {
      // Fallback: open app settings in new tab if App Bridge redirect fails
      const url = `https://${shop}/admin/apps/${clientId}/settings`;
      const opened = window.open(url, '_blank', 'noopener');

      if (!opened) {
        shopify.toast.show("Unable to open App settings. Please ensure popups are allowed and that you're logged into the Shopify admin.", { isError: true });
      }
    }
  };

  return (
    <s-page heading="Billing & Usage" max-width="full">
      <s-text slot="primary-action" variant="body-sm" color="subdued">
        In your Shopify admin, click the ••• menu (top-right) → &quot;Manage app&quot; → &quot;Manage billing and usage&quot; to upgrade your plan.
      </s-text>

      {/* Current Usage */}
      <s-section heading="Current Usage">
        <s-stack direction="block" gap="base">
          {isOverLimit && (
            <s-banner variant="critical">
              <s-text variant="body-sm">
                You&apos;ve reached your monthly limit. Upgrade your plan to continue
                collecting quiz completions.
              </s-text>
            </s-banner>
          )}

          {isNearLimit && !isOverLimit && (
            <s-banner variant="warning">
              <s-text variant="body-sm">
                You&apos;ve used {usage.percentUsed}% of your monthly limit. Consider
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
              <s-stack direction="inline" gap="base" align="space-between">
                <s-stack direction="block" gap="tight">
                  <s-text variant="heading-lg">{usage.tierName} Plan</s-text>
                  <s-text variant="body-sm" color="subdued">
                    Current billing period ends in {usage.daysUntilReset} days
                  </s-text>
                </s-stack>
                <s-badge
                  variant={usage.status === "active" ? "success" : "critical"}
                >
                  {usage.status}
                </s-badge>
              </s-stack>

              <s-stack direction="block" gap="tight">
                <s-stack direction="inline" gap="base" align="space-between">
                  <s-text variant="body-sm">Quiz Completions</s-text>
                  <s-text variant="body-sm">
                    {usage.currentUsage} /{" "}
                    {usage.limit === -1 ? "Unlimited" : usage.limit}
                  </s-text>
                </s-stack>

                {usage.limit !== -1 && (
                  <>
                    <div className="progress-bar-container">
                      {/* eslint-disable-next-line react/forbid-dom-props -- Dynamic width requires inline style */}
                      <div
                        className="progress-bar-fill"
                        style={{ width: `${Math.min(usage.percentUsed, 100)}%` }}
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
            Choose the plan that fits your business needs. Manage your billing
            directly through Shopify.
          </s-paragraph>

          <s-grid columns={tiers.length === 4 ? 4 : 3}>
            {tiers.map((tier) => (
              <s-box
                key={tier.key}
                padding="base"
                borderWidth={tier.isCurrent ? "thick" : "base"}
                borderRadius="base"
                background={tier.isCurrent ? "subdued" : "surface"}
                className={tier.isCurrent ? "card-highlighted" : ""}
              >
                <s-stack direction="block" gap="base">
                  {tier.isCurrent && (
                    <s-badge variant="info">Current</s-badge>
                  )}

                  <s-stack direction="block" gap="tight">
                    <s-text variant="heading-md">{tier.name}</s-text>
                    {tier.key !== 'free' && (
                      <>
                        <s-text variant="heading-xl">
                          ${tier.monthlyPrice} / 30 days
                        </s-text>
                        <s-text variant="body-sm" color="subdued">
                          ${tier.yearlyPrice} $/year ({tier.yearlySavings} $ off)
                        </s-text>
                        <s-text variant="body-sm" color="success">
                          {tier.trialDays} trial days remaining
                        </s-text>
                      </>
                    )}
                    {tier.key === 'free' && (
                      <s-text variant="heading-xl">
                        $0 /month
                      </s-text>
                    )}
                  </s-stack>

                  <s-stack direction="block" gap="tight">
                    {tier.features.map((feature: string, index: number) => (
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

                  {!tier.isCurrent && tier.key !== "free" && (
                    <s-text variant="body-sm" color="subdued">
                      {tier.monthlyPrice > currentPrice ? (
                        <>To upgrade to this plan, open the ••• menu (top-right) → &quot;Manage app&quot; → &quot;Manage billing and usage&quot;.</>
                      ) : (
                        <>To downgrade to this plan, please open the ••• menu (top-right) → &quot;Manage app&quot; → &quot;Manage billing and usage&quot;.</>
                      )}
                    </s-text>
                  )}

                  {tier.isCurrent && (
                    <s-stack direction="block" gap="tight">
                      <s-button variant="primary" fullWidth disabled>
                        Current Plan
                      </s-button>
                      <s-text variant="body-sm" color="subdued">
                        To change plans, open the ••• menu (top-right) → &quot;Manage app&quot; → &quot;Manage billing and usage&quot; in your Shopify admin.
                      </s-text>
                    </s-stack>
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
                Your usage resets monthly on your subscription anniversary date.
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
              <s-text variant="heading-sm">
                What happens if I exceed my limit?
              </s-text>
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
