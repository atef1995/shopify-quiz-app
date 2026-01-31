/**
 * Billing Callback Route
 *
 * Handles merchant return after selecting a plan in Shopify's managed billing.
 * Syncs the subscription status and shows success page for upgrades.
 */

import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getOrCreateSubscription } from "../lib/billing.server";
import { logger } from "../lib/logger.server";

/**
 * Loader handler for billing callback
 *
 * Syncs subscription status from Shopify's managed billing system.
 * Redirects to success page if merchant has a paid plan.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session, redirect } = await authenticate.admin(request);
  const log = logger.child({ shop: session.shop, module: "billing-callback" });

  try {
    // Sync subscription status from Shopify
    const subscription = await getOrCreateSubscription(session.shop, admin);

    log.info("Subscription synced from Shopify", { tier: subscription.tier });

    // If they have a paid plan, show success page
    if (subscription.tier !== "free") {
      return redirect("/app/billing/success");
    }

    // Otherwise, back to billing page
    return redirect("/app/billing?status=synced");
  } catch (error) {
    log.error("Billing callback sync error", error);
    return redirect("/app/billing?status=error");
  }
};
