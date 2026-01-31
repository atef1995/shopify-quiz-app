/**
 * Billing Manage Route
 *
 * Handles redirect to Shopify's managed billing page for managing existing subscriptions.
 */

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { logger } from "../lib/logger.server";

/**
 * Action handler for managing billing
 *
 * Redirects merchant to Shopify's billing management page where they can view/change their plan.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, redirect } = await authenticate.admin(request);
  const log = logger.child({ shop: session.shop, module: "billing-manage" });

  try {
    log.info("Redirecting to Shopify billing management page");

    // For managed pricing, redirect to the app settings page using the shop admin domain
    const clientId = "ccb95c69fbef7812f6a59699510890a1"; // From shopify.app.toml
    const billingUrl = `https://${session.shop}/admin/apps/${clientId}/settings`;

    // IMPORTANT: Use redirect from authenticate.admin to maintain session
    return redirect(billingUrl);
  } catch (error) {
    log.error("Failed to redirect to billing management page", error);

    return Response.json(
      {
        error: "Failed to redirect to billing page",
      },
      { status: 500 },
    );
  }
};