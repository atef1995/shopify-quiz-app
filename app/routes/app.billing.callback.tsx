/**
 * Billing Callback Route
 *
 * Handles merchant return after approving Shopify billing charge.
 * Activates the subscription in database and redirects to billing page.
 */

import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { checkSubscriptionStatus } from "../lib/billing-api.server";
import { logger } from "../lib/logger.server";

/**
 * Loader handler for billing callback
 *
 * Verifies subscription was approved in Shopify and activates it in database.
 * Redirects back to billing page with status message.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session, redirect } = await authenticate.admin(request);
  const log = logger.child({ shop: session.shop, module: "billing-callback" });

  try {
    // Get tier from query params (passed from upgrade route)
    const url = new URL(request.url);
    const tier = url.searchParams.get("tier");

    if (!tier) {
      log.error("Missing tier parameter in callback URL");
      return redirect("/app/billing?status=error");
    }

    // Fetch subscription from database
    const subscription = await prisma.subscription.findUnique({
      where: { shop: session.shop },
    });

    if (!subscription || !subscription.shopifySubscriptionId) {
      log.error("No pending subscription found");
      return redirect("/app/billing?status=error");
    }

    // Check if subscription was approved in Shopify
    // NOTE: This queries Shopify's GraphQL API to verify charge status
    const isActive = await checkSubscriptionStatus(
      admin,
      subscription.shopifySubscriptionId,
    );

    if (isActive) {
      // Activate subscription in database
      await prisma.subscription.update({
        where: { shop: session.shop },
        data: {
          status: "active",
          tier,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
          currentPeriodCompletions: 0, // Reset usage for new period
          updatedAt: new Date(),
        },
      });

      log.info("Subscription activated", { tier });
      return redirect("/app/billing?status=success");
    } else {
      // Subscription not approved or declined
      await prisma.subscription.update({
        where: { shop: session.shop },
        data: {
          status: "cancelled",
          updatedAt: new Date(),
        },
      });

      log.info("Subscription declined");
      return redirect("/app/billing?status=declined");
    }
  } catch (error) {
    log.error("Billing callback error", error);
    return redirect("/app/billing?status=error");
  }
};
