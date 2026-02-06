/**
 * Webhook Handler: App Subscriptions Update
 *
 * Handles subscription status changes from Shopify (approval, cancellation, expiry).
 * Updates local database to keep subscription status in sync.
 *
 * Webhook topics: app_subscriptions/update
 *
 * @see https://shopify.dev/docs/apps/build/billing/subscriptions/create-manage-subscriptions#step-5-listen-for-subscription-updates
 */

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../lib/logger.server";
import type { SubscriptionTier } from "../lib/billing.server";

/**
 * Map Shopify subscription status to our internal status
 *
 * Shopify statuses: PENDING, ACTIVE, DECLINED, EXPIRED, FROZEN, CANCELLED
 * Our statuses: active, pending, cancelled, expired
 */
function mapShopifyStatus(shopifyStatus: string): string {
  switch (shopifyStatus.toUpperCase()) {
    case "ACTIVE":
      return "active";
    case "PENDING":
      return "pending";
    case "DECLINED":
    case "CANCELLED":
      return "cancelled";
    case "EXPIRED":
      return "expired";
    case "FROZEN":
      // Frozen subscriptions had payment issues - treat as warning
      return "active"; // Still allow access but could show warning
    default:
      logger.warn("Unknown Shopify subscription status", { shopifyStatus });
      return "active";
  }
}

/**
 * Map subscription price to our tier system
 *
 * Extracts price from line items and maps to tier
 */
function mapPriceToTier(lineItems: any[]): SubscriptionTier {
  if (!lineItems || lineItems.length === 0) return "free";

  const priceAmount = parseFloat(lineItems[0]?.plan?.pricing_details?.price?.amount || "0");

  if (priceAmount >= 299) return "enterprise";
  if (priceAmount >= 99) return "pro";
  if (priceAmount >= 29) return "growth";

  return "free";
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload, admin } = await authenticate.webhook(request);

  logger.webhook(topic, shop || "unknown", "Received subscription update");

  if (!shop) {
    logger.error("Missing shop in webhook payload");
    return new Response("Missing shop", { status: 400 });
  }

  const log = logger.child({ shop, module: "webhook-subscription" });

  try {
    // Extract subscription details from payload
    const subscriptionData = payload.app_subscription;

    if (!subscriptionData) {
      log.error("Missing app_subscription in payload");
      return new Response("Invalid payload", { status: 400 });
    }

    const shopifySubscriptionId = subscriptionData.admin_graphql_api_id;
    const status = subscriptionData.status;
    const lineItems = subscriptionData.line_items || [];

    log.info("Processing subscription update", { shopifySubscriptionId, status, lineItems });

    // Find existing subscription by shop
    const existingSubscription = await prisma.subscription.findUnique({
      where: { shop },
    });

    if (!existingSubscription) {
      log.info("No subscription found for shop, skipping");
      return new Response("OK", { status: 200 });
    }

    // Only update if this is the subscription we're tracking
    if (
      existingSubscription.shopifySubscriptionId !== shopifySubscriptionId &&
      existingSubscription.shopifySubscriptionId !== null
    ) {
      log.info("Subscription ID mismatch, skipping", {
        expected: existingSubscription.shopifySubscriptionId,
        received: shopifySubscriptionId,
      });
      return new Response("OK", { status: 200 });
    }

    // Map status and update database
    const newStatus = mapShopifyStatus(status);

    // If subscription was cancelled/declined/expired, downgrade to free
    const shouldDowngrade = ["cancelled", "expired"].includes(newStatus);

    // If subscription is active but lineItems are empty, keep existing tier
    // Shopify webhooks don't include pricing details, so we can't determine tier from webhook
    let updateData: any = {
      status: newStatus,
      shopifySubscriptionId: shopifySubscriptionId,
      updatedAt: new Date(),
    };

    if (shouldDowngrade) {
      // Before downgrading, check if there's another active subscription (upgrade scenario)
      // When upgrading plans, Shopify cancels old subscription and creates new one
      // We don't want to downgrade if a new subscription is already active
      if (admin) {
        try {
          const { getActiveSubscriptions } = await import("../lib/billing-api.server");
          const activeSubscriptions = await getActiveSubscriptions(admin);
          
          if (activeSubscriptions.length > 0) {
            // There's another active subscription - this is an upgrade, not a real cancellation
            // Extract tier from the active subscription
            const activeSub = activeSubscriptions[0];
            if (activeSub.lineItems?.length > 0) {
              const priceAmount = parseFloat(activeSub.lineItems[0]?.plan?.pricingDetails?.price?.amount || "0");
              let newTier: SubscriptionTier = "free";
              if (priceAmount >= 299) newTier = "enterprise";
              else if (priceAmount >= 99) newTier = "pro";
              else if (priceAmount >= 29) newTier = "growth";
              
              updateData.tier = newTier;
              updateData.shopifySubscriptionId = activeSub.id;
              log.info("Detected plan upgrade - syncing new active subscription", { 
                oldSubscriptionId: shopifySubscriptionId,
                newSubscriptionId: activeSub.id,
                newTier,
              });
            }
          } else {
            // No other active subscription - this is a real cancellation
            updateData.tier = "free";
            updateData.shopifySubscriptionId = null;
            log.info("Real cancellation detected - downgrading to free");
          }
        } catch (error) {
          log.error("Failed to check for active subscriptions", error);
          // Fall back to downgrade
          updateData.tier = "free";
          updateData.shopifySubscriptionId = null;
        }
      } else {
        // No admin context - fall back to downgrade
        updateData.tier = "free";
        updateData.shopifySubscriptionId = null;
      }
    } else if (lineItems.length > 0) {
      // Webhook includes pricing - extract tier
      const newTier = mapPriceToTier(lineItems);
      updateData.tier = newTier;
      log.info("Extracted tier from webhook pricing", { newTier, price: lineItems[0]?.plan?.pricing_details?.price?.amount });
    } else if (newStatus === "active" && admin) {
      // Active subscription but no pricing in webhook - query Shopify API for current tier
      log.info("Webhook has no pricing data - querying Shopify API for active subscriptions");
      try {
        const { getActiveSubscriptions } = await import("../lib/billing-api.server");
        const activeSubscriptions = await getActiveSubscriptions(admin);
        
        if (activeSubscriptions.length > 0) {
          // Find the subscription that matches this webhook
          const matchingSub = activeSubscriptions.find((sub: any) => sub.id === shopifySubscriptionId);
          if (matchingSub && matchingSub.lineItems?.length > 0) {
            const { TIER_LIMITS } = await import("../lib/billing.server");
            // Extract price from API response
            const priceAmount = parseFloat(matchingSub.lineItems[0]?.plan?.pricingDetails?.price?.amount || "0");
            let apiTier: SubscriptionTier = "free";
            if (priceAmount >= 299) apiTier = "enterprise";
            else if (priceAmount >= 99) apiTier = "pro";
            else if (priceAmount >= 29) apiTier = "growth";
            
            updateData.tier = apiTier;
            log.info("Extracted tier from Shopify API", { tier: apiTier, price: priceAmount });
          }
        }
      } catch (error) {
        log.error("Failed to query Shopify API for tier", error);
        // Keep existing tier as fallback
      }
    } else {
      // Active subscription but no pricing in webhook and no admin - keep existing tier
      log.info("Webhook has no pricing data - keeping existing tier");
    }

    await prisma.subscription.update({
      where: { shop },
      data: updateData,
    });

    log.info("Updated subscription", { 
      newStatus, 
      tier: updateData.tier || "(unchanged)", 
      downgraded: shouldDowngrade 
    });

    return new Response("OK", { status: 200 });
  } catch (error) {
    log.error("Error processing subscription update", error);
    // Return 200 to prevent Shopify from retrying (we logged the error)
    return new Response("Error logged", { status: 200 });
  }
};
