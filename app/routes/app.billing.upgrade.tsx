import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import { upgradeSubscription, checkSubscriptionStatus, type SubscriptionTier } from "../lib/billing.server";

/**
 * Handle billing upgrade flow
 * This route creates a Shopify billing charge and redirects to approval page
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  try {
    const formData = await request.formData();
    const tier = formData.get("tier") as SubscriptionTier;

    if (!tier || !["growth", "pro", "enterprise"].includes(tier)) {
      return Response.json(
        { error: "Invalid subscription tier" },
        { status: 400 }
      );
    }

    // Create billing charge and get confirmation URL
    const { confirmationUrl } = await upgradeSubscription(
      session.shop,
      tier,
      admin
    );

    // Redirect to Shopify billing approval page
    return redirect(confirmationUrl);
  } catch (error) {
    console.error("Billing upgrade error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to upgrade subscription" },
      { status: 500 }
    );
  }
};

/**
 * Handle return from Shopify billing approval
 * Check subscription status and redirect to billing page
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  try {
    // Check if subscription was approved
    await checkSubscriptionStatus(session.shop, admin);

    // Redirect back to billing page with success message
    return redirect("/app/billing?status=success");
  } catch (error) {
    console.error("Billing status check error:", error);
    return redirect("/app/billing?status=error");
  }
};
