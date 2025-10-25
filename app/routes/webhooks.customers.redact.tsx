import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

/**
 * GDPR Webhook: customers/redact
 * Triggered when a customer requests data deletion (48 hours after request)
 * 
 * REQUIREMENT: Delete all customer data within 30 days
 * For this app: Delete quiz results containing customer email
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);

  const customerId = payload.customer?.id;
  const customerEmail = payload.customer?.email;

  console.log(`[GDPR Customer Redact] Shop: ${shop}, Customer ID: ${customerId}, Email: ${customerEmail}`);

  if (!customerEmail) {
    console.log(`[GDPR Customer Redact] No email provided, skipping deletion`);
    return new Response(JSON.stringify({ success: true, message: "No email to redact" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    // Delete all quiz results for this customer (by email)
    const deletedResults = await prisma.quizResult.deleteMany({
      where: {
        email: customerEmail,
        quiz: {
          shop: shop, // Only delete from this shop
        },
      },
    });

    console.log(`[GDPR Customer Redact] Successfully deleted ${deletedResults.count} quiz results for ${customerEmail}`);

    // NOTE: QuizAnalytics contains aggregated data without PII
    // We don't need to modify analytics as they don't contain customer-identifiable information

    return new Response(JSON.stringify({
      success: true,
      deleted_records: deletedResults.count,
      customer_email: customerEmail,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(`[GDPR Customer Redact Error]`, error);
    return new Response(JSON.stringify({
      error: "Failed to redact customer data",
      message: error instanceof Error ? error.message : "Unknown error",
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

