/**
 * Webhook Delivery Utilities
 *
 * TODO: FEATURE CURRENTLY DISABLED - Custom integrations feature removed from frontend
 * This implementation is kept for future use when Zapier/webhook integration setup is ready.
 * To re-enable:
 * 1. Uncomment sendWebhook() calls in api.quiz.submit.tsx and quiz-embed.js
 * 2. Restore navigation link in app.tsx
 * 3. Add back to pricing materials
 *
 * Handles delivery of webhook events for custom integrations.
 * Supports quiz events like started, question answered, completed, and email captured.
 *
 * Security:
 * - HMAC-SHA256 signatures for webhook verification
 * - Retry logic with exponential backoff
 * - Timeout protection
 * - Non-blocking delivery (doesn't affect quiz flow)
 */

import crypto from 'crypto';
import prisma from '../db.server';

/**
 * Webhook event types
 */
export type WebhookEvent =
  | 'quiz_started'
  | 'question_answered'
  | 'quiz_completed'
  | 'email_captured';

/**
 * Webhook payload structure
 */
export interface WebhookPayload {
  event: WebhookEvent;
  shop: string;
  quizId: string;
  quizTitle?: string;
  timestamp: string;
  data: Record<string, any>;
}

/**
 * Send webhook for a specific event
 */
export async function sendWebhook(
  shop: string,
  event: WebhookEvent,
  quizId: string,
  data: Record<string, any>
): Promise<void> {
  try {
    // Get webhook settings for this shop
    const webhookSettings = await prisma.webhookSettings.findUnique({
      where: { shop },
    });

    if (!webhookSettings?.enabled) {
      return; // Webhooks not enabled for this shop
    }

    // Get quiz title for payload
    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId, shop },
      select: { title: true },
    });

    // Determine webhook URL based on event
    let webhookUrl: string | null = null;
    switch (event) {
      case 'quiz_started':
        webhookUrl = webhookSettings.quizStartedUrl;
        break;
      case 'question_answered':
        webhookUrl = webhookSettings.questionAnsweredUrl;
        break;
      case 'quiz_completed':
        webhookUrl = webhookSettings.quizCompletedUrl;
        break;
      case 'email_captured':
        webhookUrl = webhookSettings.emailCapturedUrl;
        break;
    }

    if (!webhookUrl) {
      return; // No URL configured for this event
    }

    // Create payload
    const payload: WebhookPayload = {
      event,
      shop,
      quizId,
      quizTitle: quiz?.title,
      timestamp: new Date().toISOString(),
      data,
    };

    // Send webhook (non-blocking)
    deliverWebhook(webhookUrl, payload, webhookSettings.webhookSecret).catch(error => {
      console.error(`Webhook delivery failed for ${event}:`, error);
    });

  } catch (error) {
    console.error(`Error sending webhook for ${event}:`, error);
    // Don't throw - webhooks are non-critical
  }
}

/**
 * Deliver webhook with retry logic
 */
async function deliverWebhook(
  url: string,
  payload: WebhookPayload,
  secret?: string | null
): Promise<void> {
  const maxRetries = 3;
  const baseDelay = 1000; // 1 second

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Create signature if secret is provided
      const signature = secret ? createSignature(payload, secret) : null;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'QuizCraft-Webhook/1.0',
          ...(signature && { 'X-QuizCraft-Signature': signature }),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });

      if (response.ok) {
        console.log(`Webhook delivered successfully to ${url} on attempt ${attempt}`);
        return;
      }

      // Log non-2xx responses
      console.warn(`Webhook delivery attempt ${attempt} failed with status ${response.status}: ${response.statusText}`);

      // Don't retry on client errors (4xx)
      if (response.status >= 400 && response.status < 500) {
        return;
      }

    } catch (error) {
      console.warn(`Webhook delivery attempt ${attempt} failed:`, error);
    }

    // Wait before retry (exponential backoff)
    if (attempt < maxRetries) {
      const delay = baseDelay * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  console.error(`Webhook delivery failed after ${maxRetries} attempts to ${url}`);
}

/**
 * Create HMAC-SHA256 signature for webhook verification
 */
function createSignature(payload: WebhookPayload, secret: string): string {
  const payloadString = JSON.stringify(payload);
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payloadString);
  return `sha256=${hmac.digest('hex')}`;
}

/**
 * Verify webhook signature (for incoming webhooks if needed)
 */
export function verifySignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expectedSignature = createSignature(JSON.parse(payload), secret);
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}