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

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

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

    log.info("Processing subscription update", { shopifySubscriptionId, status });

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

    await prisma.subscription.update({
      where: { shop },
      data: {
        status: newStatus,
        shopifySubscriptionId: shopifySubscriptionId,
        // Downgrade to free tier if subscription ended
        ...(shouldDowngrade && {
          tier: "free",
          shopifySubscriptionId: null,
        }),
        updatedAt: new Date(),
      },
    });

    log.info("Updated subscription", { newStatus, downgraded: shouldDowngrade });

    return new Response("OK", { status: 200 });
  } catch (error) {
    log.error("Error processing subscription update", error);
    // Return 200 to prevent Shopify from retrying (we logged the error)
    return new Response("Error logged", { status: 200 });
  }
};
