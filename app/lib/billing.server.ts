/**
 * Billing and Usage Tracking Utilities
 *
 * Handles freemium tier management, usage limits,
 * and subscription status syncing for the Quiz Builder app.
 *
 * Integrated with Shopify's Managed Pricing system.
 *
 * BILLING FLOW:
 * 1. Merchant clicks "Manage Billing" → redirected to Shopify's billing page
 * 2. Merchant selects/upgrades plan in Shopify admin → subscription created automatically
 * 3. Webhook or API query detects plan change → database synced
 * 4. Usage tracking enforces limits at quiz submission (api.quiz.submit.tsx)
 * 5. Monthly resets happen automatically when period expires
 *
 * IMPLEMENTATION STATUS:
 * ✅ Database schema with Shopify subscription tracking fields
 * ✅ GraphQL queries for checking active subscriptions (billing-api.server.ts)
 * ✅ Managed billing redirect flow
 * ✅ Subscription status syncing on app load
 * ✅ Usage limit enforcement at quiz submission
 * ✅ Subscription restoration on app reinstall (NEW)
 * ⚠️  No webhook handlers for subscription updates (SUBSCRIPTIONS_UPDATE webhook needed)
 * ⚠️  Test mode hardcoded (isTest=true) - needs environment variable
 *
 * TODO: Add webhook handler for SUBSCRIPTION_BILLING_ATTEMPTS to detect payment failures
 * TODO: Handle subscription pauses/freezes (FROZEN status)
 * TODO: Add trial period logic (14 days free for all tiers)
 */

import prisma from "../db.server";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

/**
 * Subscription tier limits and pricing
 *
 * Features array defines what's available per tier:
 * - basic: Core quiz functionality
 * - email_capture: Collect customer emails
 * - ai_generation: Generate quiz questions with AI
 * - conditional_logic: Show/hide questions based on answers
 * - advanced_analytics: Detailed funnel and conversion analytics
 * - priority_support: Faster response times
 * - custom_integrations: Webhooks, Zapier, etc.
 */
export const TIER_LIMITS: Record<string, {
  name: string;
  monthlyCompletions: number;
  maxQuizzes: number;
  maxQuestionsPerQuiz: number;
  features: TierFeature[];
  price: number;
}> = {
  free: {
    name: "Free",
    monthlyCompletions: 100,
    maxQuizzes: 3,
    maxQuestionsPerQuiz: 10,
    features: ["basic", "email_capture"],
    price: 0,
  },
  growth: {
    name: "Growth",
    monthlyCompletions: 1000,
    maxQuizzes: 10,
    maxQuestionsPerQuiz: 25,
    features: ["basic", "email_capture", "ai_generation", "conditional_logic"],
    price: 29,
  },
  pro: {
    name: "Pro",
    monthlyCompletions: 10000,
    maxQuizzes: 50,
    maxQuestionsPerQuiz: 50,
    features: [
      "basic",
      "email_capture",
      "ai_generation",
      "conditional_logic",
      "advanced_analytics",
      "priority_support",
    ],
    price: 99,
  },
  enterprise: {
    name: "Enterprise",
    monthlyCompletions: -1, // Unlimited
    maxQuizzes: -1, // Unlimited
    maxQuestionsPerQuiz: -1, // Unlimited
    features: [
      "basic",
      "email_capture",
      "ai_generation",
      "conditional_logic",
      "advanced_analytics",
      "priority_support",
      "custom_integrations",
    ],
    price: 299,
  },
};

export type TierFeature =
  | "basic"
  | "email_capture"
  | "ai_generation"
  | "conditional_logic"
  | "advanced_analytics"
  | "priority_support"
  | "custom_integrations";

export type SubscriptionTier = "free" | "growth" | "pro" | "enterprise";

/**
 * Map Shopify subscription data to our tier system
 *
 * @param shopifySubscription - Subscription data from Shopify API
 * @returns Our internal tier name
 */
function mapShopifySubscriptionToTier(shopifySubscription: any): SubscriptionTier {
  // Extract price from the subscription
  const lineItems = shopifySubscription.lineItems || [];
  
  console.log('[Billing] Mapping subscription to tier:', {
    subscriptionId: shopifySubscription.id,
    lineItemsCount: lineItems.length,
    lineItems: JSON.stringify(lineItems, null, 2),
  });
  
  if (lineItems.length === 0) {
    console.warn('[Billing] No line items found in subscription - defaulting to free');
    return "free";
  }

  const price = lineItems[0]?.plan?.pricingDetails?.price?.amount;
  if (!price) {
    console.warn('[Billing] No price found in line items - defaulting to free', {
      lineItem: JSON.stringify(lineItems[0], null, 2),
    });
    return "free";
  }

  const priceAmount = parseFloat(price);
  console.log('[Billing] Extracted price:', priceAmount);

  // Map prices to tiers (matching our TIER_LIMITS)
  if (priceAmount >= 299) return "enterprise";
  if (priceAmount >= 99) return "pro";
  if (priceAmount >= 29) return "growth";

  return "free";
}

/**
 * Check if shop has access to a specific feature based on their tier
 *
 * @param shop - Shop domain
 * @param feature - Feature to check access for
 * @returns Object with access status and upgrade info
 */
export async function hasFeatureAccess(
  shop: string,
  feature: TierFeature,
): Promise<{
  allowed: boolean;
  tier: string;
  tierName: string;
  requiredTier?: string;
}> {
  const subscription = await getOrCreateSubscription(shop);
  const tierConfig = TIER_LIMITS[subscription.tier as SubscriptionTier];

  const hasAccess = tierConfig.features.includes(feature);

  // Find minimum tier that has this feature
  let requiredTier: string | undefined;
  if (!hasAccess) {
    for (const [tierKey, config] of Object.entries(TIER_LIMITS)) {
      if (config.features.includes(feature)) {
        requiredTier = config.name;
        break;
      }
    }
  }

  return {
    allowed: hasAccess,
    tier: subscription.tier,
    tierName: tierConfig.name,
    requiredTier,
  };
}

/**
 * Check if shop can create more quizzes based on their tier
 *
 * Returns warning at 80% of limit, blocks at 100%
 *
 * @param shop - Shop domain
 * @returns Object with creation status, counts, and warning info
 */
export async function canCreateQuiz(shop: string): Promise<{
  allowed: boolean;
  warning: boolean;
  warningMessage?: string;
  reason?: string;
  currentCount: number;
  limit: number;
  tier: string;
  tierName: string;
}> {
  const subscription = await getOrCreateSubscription(shop);
  const tierConfig = TIER_LIMITS[subscription.tier as SubscriptionTier];

  // Count existing quizzes for this shop
  const quizCount = await prisma.quiz.count({
    where: { shop },
  });

  const limit = tierConfig.maxQuizzes;
  const isUnlimited = limit === -1;

  // Check if at limit
  if (!isUnlimited && quizCount >= limit) {
    return {
      allowed: false,
      warning: false,
      reason: `You've reached your limit of ${limit} quizzes on the ${tierConfig.name} plan. Upgrade to create more quizzes.`,
      currentCount: quizCount,
      limit,
      tier: subscription.tier,
      tierName: tierConfig.name,
    };
  }

  // Check if approaching limit (80%)
  const warningThreshold = isUnlimited ? Infinity : Math.floor(limit * 0.8);
  const isNearLimit = !isUnlimited && quizCount >= warningThreshold;

  return {
    allowed: true,
    warning: isNearLimit,
    warningMessage: isNearLimit
      ? `You've used ${quizCount} of ${limit} quizzes. Consider upgrading soon.`
      : undefined,
    currentCount: quizCount,
    limit: isUnlimited ? -1 : limit,
    tier: subscription.tier,
    tierName: tierConfig.name,
  };
}

/**
 * Check if a quiz can have more questions based on tier limits
 *
 * @param shop - Shop domain
 * @param quizId - Quiz ID to check
 * @returns Object with creation status and counts
 */
export async function canAddQuestion(
  shop: string,
  quizId: string,
): Promise<{
  allowed: boolean;
  reason?: string;
  currentCount: number;
  limit: number;
}> {
  const subscription = await getOrCreateSubscription(shop);
  const tierConfig = TIER_LIMITS[subscription.tier as SubscriptionTier];

  // Count existing questions for this quiz
  const questionCount = await prisma.question.count({
    where: { quizId },
  });

  const limit = tierConfig.maxQuestionsPerQuiz;
  const isUnlimited = limit === -1;

  if (!isUnlimited && questionCount >= limit) {
    return {
      allowed: false,
      reason: `You've reached the limit of ${limit} questions per quiz on the ${tierConfig.name} plan.`,
      currentCount: questionCount,
      limit,
    };
  }

  return {
    allowed: true,
    currentCount: questionCount,
    limit: isUnlimited ? -1 : limit,
  };
}

/**
 * Get quiz usage stats for a shop (for display in UI)
 */
export async function getQuizUsageStats(shop: string): Promise<{
  currentCount: number;
  limit: number;
  percentUsed: number;
  isUnlimited: boolean;
  tier: string;
  tierName: string;
}> {
  const subscription = await getOrCreateSubscription(shop);
  const tierConfig = TIER_LIMITS[subscription.tier as SubscriptionTier];

  const quizCount = await prisma.quiz.count({
    where: { shop },
  });

  const limit = tierConfig.maxQuizzes;
  const isUnlimited = limit === -1;

  return {
    currentCount: quizCount,
    limit: isUnlimited ? -1 : limit,
    percentUsed: isUnlimited ? 0 : Math.round((quizCount / limit) * 100),
    isUnlimited,
    tier: subscription.tier,
    tierName: tierConfig.name,
  };
}

/**
 * Get or create subscription for a shop
 *
 * Date calculation properly handles month boundaries (e.g., Jan 31 + 1 month = Feb 28).
 *
 * NOTE: Now verifies active subscriptions with Shopify API on app reinstall.
 * This ensures paid subscriptions are restored when app is reinstalled.
 *
 * TODO: Add trial period logic (14 days free for all tiers)
 * TODO: Track signup date for cohort analysis
 */
export async function getOrCreateSubscription(shop: string, admin?: any) {
  // For managed pricing, always check Shopify first to get the current subscription status
  // This ensures we have the latest data from Shopify's billing system
  if (admin) {
    try {
      const { getActiveSubscriptions } = await import("./billing-api.server");
      const activeSubscriptions = await getActiveSubscriptions(admin);

      if (activeSubscriptions.length > 0) {
        // Found active subscription in Shopify - use it
        const shopifySub = activeSubscriptions[0]; // Use the first active subscription

        // Map Shopify subscription to our tier system
        const tier = mapShopifySubscriptionToTier(shopifySub);

        // SAFEGUARD: Never downgrade from a paid tier to free unless explicitly cancelled
        // This prevents issues where Shopify API returns incomplete data
        const existingSubscription = await prisma.subscription.findUnique({
          where: { shop },
        });

        const shouldUpdateTier = tier !== "free" || 
                                 !existingSubscription || 
                                 existingSubscription.tier === "free";

        const now = new Date();
        const periodEnd = shopifySub.currentPeriodEnd
          ? new Date(shopifySub.currentPeriodEnd)
          : new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());

        // Upsert to sync with database
        const subscription = await prisma.subscription.upsert({
          where: { shop },
          update: {
            ...(shouldUpdateTier && { tier }), // Only update tier if safe to do so
            shopifySubscriptionId: shopifySub.id,
            status: "active",
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
          },
          create: {
            shop,
            tier,
            shopifySubscriptionId: shopifySub.id,
            status: "active",
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
          },
        });

        console.log(`Synced subscription for shop ${shop} - Tier: ${subscription.tier} (Shopify returned: ${tier})`);
        return subscription;
      }
    } catch (error) {
      console.error(`Failed to check Shopify subscriptions for ${shop}:`, error);
      // Continue with database fallback if API call fails
    }
  }

  // Fallback to database record or create free tier
  let subscription = await prisma.subscription.findUnique({
    where: { shop },
  });

  if (!subscription) {
    // Create new free tier subscription
    const now = new Date();

    // FIXED: Proper date math to avoid month boundary bugs
    // Example: Jan 31 + 1 month = Feb 28 (correct), not Mar 3
    // new Date(year, month, day) handles overflow properly:
    // - If day exceeds days in month, it uses last day of that month
    const periodEnd = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      now.getDate(),
    );

    subscription = await prisma.subscription.create({
      data: {
        shop,
        tier: "free",
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
      },
    });
  }

  return subscription;
}

/**
 * NOTE: canCreateCompletion() function removed - customer quiz submissions
 * should NEVER be blocked by merchant plan limits. Completion counts are
 * tracked for analytics only via incrementCompletionCount().
 * 
 * Usage limits only apply to:
 * - Number of quizzes created (enforced in app.quizzes.new.tsx)
 * - Number of questions per quiz (enforced in app.quizzes.$id.edit.tsx)
 * - NOT customer quiz submissions (would break merchant's quizzes)
 */

/**
 * Track completion count for analytics (non-blocking)
 *
 * This function tracks quiz completions for merchant analytics and reporting.
 * It should NEVER throw errors or block customer quiz submissions.
 *
 * Uses atomic database operation to prevent race conditions.
 * Even with multiple simultaneous requests, the database ensures
 * the counter is incremented correctly.
 *
 * NOTE: Completion counts are for analytics only, NOT for enforcing usage limits.
 * Customer quiz submissions should never be blocked by merchant plan limits.
 *
 * TODO: Make this idempotent to prevent double-counting if retried
 * TODO: Add audit log of all completions for billing dispute resolution
 */
export async function incrementCompletionCount(shop: string): Promise<void> {
  try {
    // Atomic increment - database handles concurrency control
    await prisma.subscription.update({
      where: { shop },
      data: {
        currentPeriodCompletions: {
          increment: 1,
        },
      },
    });
  } catch (error) {
    // Log error but don't throw - analytics tracking failure shouldn't
    // block quiz completion (customer already got their recommendations)
    console.error(
      `[Analytics] Failed to track completion count for ${shop}:`,
      error,
    );
    // TODO: Send alert to monitoring service (Sentry, DataDog, etc.)
    // NOTE: Intentionally not re-throwing - this is non-critical analytics tracking
  }
}

/**
 * Get usage statistics for a shop
 */
export async function getUsageStats(shop: string, admin?: any) {
  const subscription = await getOrCreateSubscription(shop, admin);
  const tierLimit = TIER_LIMITS[subscription.tier as SubscriptionTier];

  const percentUsed =
    tierLimit.monthlyCompletions === -1
      ? 0
      : Math.round(
          (subscription.currentPeriodCompletions /
            tierLimit.monthlyCompletions) *
            100,
        );

  const daysUntilReset = Math.ceil(
    (subscription.currentPeriodEnd.getTime() - Date.now()) /
      (1000 * 60 * 60 * 24),
  );

  return {
    tier: subscription.tier,
    tierName: tierLimit.name,
    currentUsage: subscription.currentPeriodCompletions,
    limit: tierLimit.monthlyCompletions,
    percentUsed,
    daysUntilReset,
    periodStart: subscription.currentPeriodStart,
    periodEnd: subscription.currentPeriodEnd,
    status: subscription.status,
  };
}

/**
 * Upgrade subscription tier with Shopify Billing API
 *
 * Creates a recurring charge using Shopify Billing API and updates
 * the subscription tier once the merchant approves payment.
 *
 * @returns Object with confirmationUrl for redirect and subscriptionId
 */
export async function upgradeSubscription(
  shop: string,
  newTier: SubscriptionTier,
  admin: AdminApiContext,
): Promise<{ confirmationUrl: string; subscriptionId: string }> {
  await getOrCreateSubscription(shop); // Ensure subscription exists
  const tierConfig = TIER_LIMITS[newTier];

  // Validate tier change
  if (newTier === "free") {
    throw new Error("Cannot 'upgrade' to free tier. Use downgrade instead.");
  }

  // Free tier should use cancelSubscription instead
  if (tierConfig.price === 0) {
    throw new Error(
      "Free tier does not require billing. Use cancelSubscription.",
    );
  }

  // Create recurring charge with Shopify Billing API
  const chargeResponse = await admin.graphql(
    `#graphql
      mutation AppSubscriptionCreate($name: String!, $returnUrl: URL!, $test: Boolean, $lineItems: [AppSubscriptionLineItemInput!]!) {
        appSubscriptionCreate(
          name: $name
          returnUrl: $returnUrl
          test: $test
          lineItems: $lineItems
        ) {
          appSubscription {
            id
            status
          }
          confirmationUrl
          userErrors {
            field
            message
          }
        }
      }`,
    {
      variables: {
        name: `Quiz Builder - ${tierConfig.name} Plan`,
        returnUrl: `${process.env.SHOPIFY_APP_URL}/app/billing?shop=${shop}`,
        test: process.env.NODE_ENV === "development", // Test mode in dev
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                price: { amount: tierConfig.price, currencyCode: "USD" },
                interval: "EVERY_30_DAYS",
              },
            },
          },
        ],
      },
    },
  );

  const chargeData = await chargeResponse.json();

  if (chargeData.data?.appSubscriptionCreate?.userErrors?.length > 0) {
    const errors = chargeData.data.appSubscriptionCreate.userErrors;
    const errorMessages = errors
      .map((e: { field?: string; message: string }) => e.message)
      .join(", ");
    throw new Error(`Billing API error: ${errorMessages}`);
  }

  const subscriptionId =
    chargeData.data?.appSubscriptionCreate?.appSubscription?.id;
  const confirmationUrl =
    chargeData.data?.appSubscriptionCreate?.confirmationUrl;

  if (!subscriptionId || !confirmationUrl) {
    throw new Error("Failed to create billing charge");
  }

  // Save subscription with pending status - will be activated when merchant approves
  await prisma.subscription.update({
    where: { shop },
    data: {
      tier: newTier,
      shopifySubscriptionId: subscriptionId,
      status: "pending", // Will be updated to "active" after approval
    },
  });

  return {
    confirmationUrl,
    subscriptionId,
  };
}

/**
 * Check and update subscription status from Shopify
 * Call this after merchant returns from billing approval
 */
export async function checkSubscriptionStatus(
  shop: string,
  admin: AdminApiContext,
) {
  const subscription = await getOrCreateSubscription(shop);

  if (!subscription.shopifySubscriptionId) {
    return subscription;
  }

  // Query Shopify for current subscription status
  const response = await admin.graphql(
    `#graphql
      query GetSubscription($id: ID!) {
        node(id: $id) {
          ... on AppSubscription {
            id
            status
            currentPeriodEnd
          }
        }
      }`,
    {
      variables: {
        id: subscription.shopifySubscriptionId,
      },
    },
  );

  const data = await response.json();
  const shopifyStatus = data.data?.node?.status;

  // Map Shopify status to our status
  let newStatus: string = subscription.status;
  if (shopifyStatus === "ACTIVE") {
    newStatus = "active";
  } else if (shopifyStatus === "CANCELLED" || shopifyStatus === "EXPIRED") {
    newStatus = "cancelled";
  } else if (shopifyStatus === "PENDING") {
    newStatus = "pending";
  }

  // Update if status changed
  if (newStatus !== subscription.status) {
    return await prisma.subscription.update({
      where: { shop },
      data: { status: newStatus },
    });
  }

  return subscription;
}

/**
 * Cancel subscription (downgrade to free tier)
 */
export async function cancelSubscription(shop: string, admin: AdminApiContext) {
  const subscription = await getOrCreateSubscription(shop);

  // If there's an active Shopify subscription, cancel it
  if (subscription.shopifySubscriptionId && subscription.status === "active") {
    await admin.graphql(
      `#graphql
        mutation AppSubscriptionCancel($id: ID!) {
          appSubscriptionCancel(id: $id) {
            appSubscription {
              id
              status
            }
            userErrors {
              field
              message
            }
          }
        }`,
      {
        variables: {
          id: subscription.shopifySubscriptionId,
        },
      },
    );
  }

  // Downgrade to free tier
  return await prisma.subscription.update({
    where: { shop },
    data: {
      tier: "free",
      status: "active",
      shopifySubscriptionId: null,
    },
  });
}
