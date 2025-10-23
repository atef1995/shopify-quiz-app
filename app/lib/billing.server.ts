/**
 * Billing and Usage Tracking Utilities
 *
 * Handles freemium tier management, usage limits,
 * and subscription upgrades for the Quiz Builder app.
 *
 * TODO: CRITICAL - Integrate Shopify Billing API for actual payment collection
 * TODO: Add webhook handlers for subscription changes (cancel, upgrade, downgrade)
 * TODO: Add grace period before blocking service when payment fails
 * TODO: Implement proration logic for mid-month upgrades/downgrades
 * BUG: Currently no actual payment integration - merchants can use free tier indefinitely
 */

import prisma from "../db.server";

/**
 * Subscription tier limits
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
 * TODO: Add trial period logic (14 days free for all tiers)
 * TODO: Track signup date for cohort analysis
 * BUG: Month calculation could fail on edge case dates (e.g., Jan 31 + 1 month)
 *      Consider using a date library like date-fns or luxon
 */
export async function getOrCreateSubscription(shop: string) {
  let subscription = await prisma.subscription.findUnique({
    where: { shop },
  });

  if (!subscription) {
    // Create new free tier subscription
    const now = new Date();
    const periodEnd = new Date(now);
    // BUG: setMonth can cause unexpected behavior near month boundaries
    // Example: Jan 31 -> Feb 31 becomes Mar 3
    // Use proper date library or manual day counting
    periodEnd.setMonth(periodEnd.getMonth() + 1);

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
  const subscription = await getOrCreateSubscription(shop);
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
  // BUG: Timezone issues - server timezone might not match shop timezone
  //      Should use shop's timezone from Shopify API
  // TODO: Add cron job to reset periods instead of doing it on-demand
  //       This prevents race conditions where multiple requests reset simultaneously
  if (now > subscription.currentPeriodEnd) {
    // Reset usage for new period
    const newPeriodEnd = new Date(now);
    // BUG: Same month boundary issue as in getOrCreateSubscription
    newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);

    // TODO: Wrap this in a transaction with upsert to prevent race conditions
    await prisma.subscription.update({
      where: { shop },
      data: {
        currentPeriodCompletions: 0,
        currentPeriodStart: now,
        currentPeriodEnd: newPeriodEnd,
      },
    });

    return {
      allowed: true,
      currentUsage: 0,
      limit: tierLimit.monthlyCompletions,
      tier: subscription.tier,
    };
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
 * Increment completion count for a shop
 *
 * TODO: Make this idempotent to prevent double-counting if retried
 * TODO: Add audit log of all completions for billing dispute resolution
 * BUG: Race condition - if two completions happen simultaneously, both might succeed
 *      even if only one slot remains. Use database transactions or atomic operations
 */
export async function incrementCompletionCount(shop: string) {
  // BUG: No error handling - if this fails silently, merchant gets free completion
  await prisma.subscription.update({
    where: { shop },
    data: {
      currentPeriodCompletions: {
        increment: 1,
      },
    },
  });
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
            100
        );

  const daysUntilReset = Math.ceil(
    (subscription.currentPeriodEnd.getTime() - Date.now()) /
      (1000 * 60 * 60 * 24)
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
 * Upgrade subscription tier
 *
 * TODO: CRITICAL - Integrate with Shopify Billing API
 * TODO: Add validation that newTier is higher than current tier (prevent "upgrades" to free)
 * TODO: Calculate and charge prorated amount for mid-month upgrades
 * TODO: Send confirmation email to merchant
 * TODO: Log tier change in audit trail
 * BUG: No payment processing - just changes tier without charging
 * BUG: Doesn't reset usage limits immediately - merchant could exceed new tier's limits
 */
export async function upgradeSubscription(
  shop: string,
  newTier: SubscriptionTier
) {
  // TODO: Validate tier change is allowed
  // TODO: Create charge using Shopify Billing API
  // TODO: Only update tier after payment succeeds
  return await prisma.subscription.update({
    where: { shop },
    data: {
      tier: newTier,
      // TODO: Consider resetting currentPeriodCompletions on tier change
      // TODO: Update shopifySubscriptionId with new charge ID
    },
  });
}
