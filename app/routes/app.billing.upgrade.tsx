/**
 * Billing Upgrade Route
 *
 * Handles subscription upgrades by creating Shopify recurring application charges.
 * Merchant is redirected to Shopify's confirmation URL to approve the charge.
 */

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { createAppSubscription } from "../lib/billing-api.server";
import { TIER_LIMITS, type SubscriptionTier } from "../lib/billing.server";
import { logger } from "../lib/logger.server";

/**
 * Action handler for subscription upgrade
 *
 * Creates a Shopify recurring application charge and saves pending subscription
 * to database. Redirects merchant to Shopify confirmation page.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session, redirect } = await authenticate.admin(request);
  const log = logger.child({ shop: session.shop, module: "billing-upgrade" });

  const formData = await request.formData();
  const tier = formData.get("tier") as SubscriptionTier;

  // Validate tier
  if (!tier || tier === "free" || !TIER_LIMITS[tier]) {
    log.warn("Invalid subscription tier requested", { tier });
    return Response.json(
      { error: "Invalid subscription tier" },
      { status: 400 },
    );
  }

  try {
    // Build return URL for after merchant approves charge
    // NOTE: Must use absolute URL, Shopify redirects merchant to this after approval
    const appUrl = process.env.SHOPIFY_APP_URL || "";
    const returnUrl = `${appUrl}/app/billing/callback?tier=${tier}`;

    log.info("Creating subscription", { tier });

    // Create subscription charge in Shopify
    // NOTE: Using isTest=true for development, should be false in production
    const { subscription, confirmationUrl } = await createAppSubscription(
      admin,
      tier,
      returnUrl,
      true, // isTest - set to false in production
    );

    // Save pending subscription to database
    // Status is "pending" until merchant approves charge
    await prisma.subscription.upsert({
      where: { shop: session.shop },
      update: {
        tier,
        shopifySubscriptionId: subscription.id,
        returnUrl,
        status: "pending",
        updatedAt: new Date(),
      },
      create: {
        shop: session.shop,
        tier,
        shopifySubscriptionId: subscription.id,
        returnUrl,
        status: "pending",
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      },
    });

    log.info("Subscription created, redirecting to confirmation", { subscriptionId: subscription.id });

    // Redirect merchant to Shopify confirmation page
    // IMPORTANT: Use redirect from authenticate.admin to maintain session
    return redirect(confirmationUrl);
  } catch (error) {
    log.error("Failed to create subscription", error);

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to create subscription",
      },
      { status: 500 },
    );
  }
};
