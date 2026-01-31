/**
 * Billing Upgrade Route
 *
 * Handles subscription upgrades by redirecting to Shopify's managed billing page.
 * For managed pricing, Shopify handles all subscription creation and billing.
 */

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { TIER_LIMITS, type SubscriptionTier } from "../lib/billing.server";
import { logger } from "../lib/logger.server";

/**
 * Action handler for subscription upgrade
 *
 * Redirects merchant to Shopify's billing management page where they can select a plan.
 * Managed pricing apps cannot create subscriptions programmatically.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, redirect } = await authenticate.admin(request);
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
    log.info("Redirecting to Shopify billing page", { tier });

    // For managed pricing, redirect to the app settings page using the shop admin domain
    // Merchant will select plan and Shopify will handle subscription creation
    const clientId = "ccb95c69fbef7812f6a59699510890a1"; // From shopify.app.toml
    const billingUrl = `https://${session.shop}/admin/apps/${clientId}/settings`;

    // IMPORTANT: Use redirect from authenticate.admin to maintain session
    return redirect(billingUrl);
  } catch (error) {
    log.error("Failed to redirect to billing page", error);

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to redirect to billing page",
      },
      { status: 500 },
    );
  }
};
