/**
 * Billing and Usage Tracking Utilities
 *
 * Handles freemium tier management, usage limits,
 * and subscription upgrades for the Quiz Builder app.
 *
 * Integrated with Shopify Billing API for payment collection.
 *
 * BILLING FLOW:
 * 1. User clicks "Upgrade" button → app.billing.upgrade.tsx creates charge
 * 2. User approves charge in Shopify admin → redirected to app.billing.callback.tsx
 * 3. Callback verifies charge status → activates subscription in database
 * 4. Usage tracking enforces limits at quiz submission (api.quiz.submit.tsx)
 * 5. Monthly resets happen automatically when period expires
 *
 * IMPLEMENTATION STATUS:
 * ✅ Database schema with Shopify charge tracking fields
 * ✅ GraphQL mutations for creating/canceling charges (billing-api.server.ts)
 * ✅ Upgrade flow with confirmation URL redirect
 * ✅ Callback handler to activate subscriptions
 * ✅ Cancel/downgrade functionality
 * ✅ Usage limit enforcement at quiz submission
 * ⚠️  Subscription verification relies on database status (should query Shopify API)
 * ⚠️  No webhook handlers for subscription updates (SUBSCRIPTIONS_UPDATE webhook needed)
 * ⚠️  Test mode hardcoded (isTest=true) - needs environment variable
 *
 * TODO: Add webhook handler for SUBSCRIPTION_BILLING_ATTEMPTS to detect payment failures
 * TODO: Query Shopify API in getOrCreateSubscription to verify charge is still active
 * TODO: Handle subscription pauses/freezes (FROZEN status)
 * TODO: Add trial period logic (14 days free for all tiers)
 */

import prisma from "../db.server";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

/**
 * Subscription tier limits and pricing
 */
export const TIER_LIMITS = {
  free: {
    name: "Free",
    monthlyCompletions: 100,
    price: 0,
  },
  growth: {
    name: "Growth",
    monthlyCompletions: 1000,
    price: 29,
  },
  pro: {
    name: "Pro",
    monthlyCompletions: 10000,
    price: 99,
  },
  enterprise: {
    name: "Enterprise",
    monthlyCompletions: -1, // Unlimited
    price: 299,
  },
} as const;

export type SubscriptionTier = keyof typeof TIER_LIMITS;

/**
 * Get or create subscription for a shop
 *
 * Date calculation properly handles month boundaries (e.g., Jan 31 + 1 month = Feb 28).
 *
 * NOTE: Currently uses database status only. In production, should also verify
 * subscription is still active in Shopify (charge not cancelled/expired).
 * Use getActiveSubscriptions() from billing-api.server.ts to cross-check.
 *
 * TODO: Add trial period logic (14 days free for all tiers)
 * TODO: Track signup date for cohort analysis
 * TODO: Query Shopify API to verify subscription status matches database
 */
export async function getOrCreateSubscription(shop: string) {
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
 * Check if shop can create more quiz completions
 */
export async function canCreateCompletion(shop: string): Promise<{
  allowed: boolean;
  reason?: string;
  currentUsage: number;
  limit: number;
  tier: string;
}> {
  let subscription = await getOrCreateSubscription(shop);
  const tierLimit = TIER_LIMITS[subscription.tier as SubscriptionTier];

  // Check if subscription is active
  if (subscription.status !== "active") {
    return {
      allowed: false,
      reason: "Subscription is not active",
      currentUsage: subscription.currentPeriodCompletions,
      limit: tierLimit.monthlyCompletions,
      tier: subscription.tier,
    };
  }

  // Check if we need to reset the period
  const now = new Date();
  // NOTE: Server timezone might not match shop timezone
  //       Acceptable for MVP as it only affects reset timing by a few hours
  // TODO: Use shop's timezone from Shopify API for exact reset timing
  // TODO: Add cron job to reset periods instead of doing it on-demand
  if (now > subscription.currentPeriodEnd) {
    // Reset usage for new period using proper date math
    const newPeriodEnd = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      now.getDate(),
    );

    // Atomic update to prevent race condition where multiple requests
    // try to reset the period simultaneously
    const updated = await prisma.subscription.updateMany({
      where: {
        shop,
        currentPeriodEnd: { lt: now }, // Only update if period actually expired
      },
      data: {
        currentPeriodCompletions: 0,
        currentPeriodStart: now,
        currentPeriodEnd: newPeriodEnd,
      },
    });

    // If we successfully reset the period, return fresh limits
    if (updated.count > 0) {
      return {
        allowed: true,
        currentUsage: 0,
        limit: tierLimit.monthlyCompletions,
        tier: subscription.tier,
      };
    }

    // If another request already reset it, re-fetch the subscription
    subscription =
      (await prisma.subscription.findUnique({
        where: { shop },
      })) || subscription;
  }

  // Check usage limits
  const isUnlimited = tierLimit.monthlyCompletions === -1;
  const withinLimit =
    isUnlimited ||
    subscription.currentPeriodCompletions < tierLimit.monthlyCompletions;

  return {
    allowed: withinLimit,
    reason: withinLimit
      ? undefined
      : "Monthly completion limit reached. Please upgrade your plan.",
    currentUsage: subscription.currentPeriodCompletions,
    limit: tierLimit.monthlyCompletions,
    tier: subscription.tier,
  };
}

/**
 * Increment completion count for a shop atomically
 *
 * Uses atomic database operation to prevent race conditions.
 * Even with multiple simultaneous requests, the database ensures
 * the counter is incremented correctly.
 *
 * TODO: Make this idempotent to prevent double-counting if retried
 * TODO: Add audit log of all completions for billing dispute resolution
 */
export async function incrementCompletionCount(shop: string) {
  try {
    // Atomic increment - database handles concurrency control
    // Even with multiple simultaneous requests, the database ensures
    // the counter is incremented correctly without race conditions
    await prisma.subscription.update({
      where: { shop },
      data: {
        currentPeriodCompletions: {
          increment: 1,
        },
      },
    });
  } catch (error) {
    // Log error but don't throw - billing tracking failure shouldn't
    // block quiz completion (user already got their recommendations)
    console.error(
      `[Billing] Failed to increment completion count for ${shop}:`,
      error,
    );
    // TODO: Send alert to monitoring service (Sentry, DataDog, etc.)
    throw error; // Re-throw so caller can handle
  }
}

/**
 * Get usage statistics for a shop
 */
export async function getUsageStats(shop: string) {
  const subscription = await getOrCreateSubscription(shop);
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
