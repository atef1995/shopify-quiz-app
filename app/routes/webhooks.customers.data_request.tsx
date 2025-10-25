import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

/**
 * GDPR Webhook: customers/data_request
 * Triggered when a customer requests their data
 * 
 * REQUIREMENT: Return all customer data within 30 days
 * For this app: We store quiz completion data with optional customer emails
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);

  const customerId = payload.customer?.id;
  const customerEmail = payload.customer?.email;

  console.log(`[GDPR Data Request] Shop: ${shop}, Customer ID: ${customerId}, Email: ${customerEmail}`);

  if (!customerEmail) {
    console.log(`[GDPR Data Request] No email provided, cannot retrieve quiz data`);
    return new Response(null, { status: 200 });
  }

  try {
    // Retrieve all quiz results for this customer
    const quizResults = await prisma.quizResult.findMany({
      where: {
        email: customerEmail,
        quiz: {
          shop: shop,
        },
      },
      include: {
        quiz: {
          select: {
            title: true,
            description: true,
          },
        },
      },
    });

    // Format the data export
    const customerData = {
      customer_email: customerEmail,
      customer_id: customerId,
      shop: shop,
      data_requested_at: new Date().toISOString(),
      quiz_completions: quizResults.map(result => ({
        quiz_title: result.quiz.title,
        completed_at: result.completedAt,
        answers: result.answers, // JSON field containing quiz responses
        recommended_products: result.recommendedProducts, // Product IDs
      })),
    };

    console.log(`[GDPR Data Request] Found ${quizResults.length} quiz completions for ${customerEmail}`);
    console.log(`[GDPR Data Export]`, JSON.stringify(customerData, null, 2));

    // In production, you would:
    // 1. Store this export in a secure location
    // 2. Send email to customer with download link
    // 3. Automatically delete the export after 30 days
    // 4. Log the request for compliance audit trail

    return new Response(JSON.stringify({ success: true, records: quizResults.length }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(`[GDPR Data Request Error]`, error);
    return new Response(JSON.stringify({ error: "Failed to process data request" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

