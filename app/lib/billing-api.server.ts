/**
 * Shopify Billing API Helper
 *
 * Provides functions to interact with Shopify's Billing API for managing
 * recurring application charges (subscriptions).
 *
 * @see https://shopify.dev/docs/apps/build/billing
 */

import { Session } from "@shopify/shopify-api";
import { TIER_LIMITS, type SubscriptionTier } from "./billing.server";

// GraphQL fragment for app subscription data
const APP_SUBSCRIPTION_FRAGMENT = `
  fragment AppSubscriptionFragment on AppSubscription {
    id
    name
    test
    status
    trialDays
    createdAt
    currentPeriodEnd
    lineItems {
      id
      plan {
        pricingDetails {
          ... on AppRecurringPricing {
            price {
              amount
              currencyCode
            }
            interval
          }
        }
      }
    }
  }
`;

/**
 * Create a recurring application charge (subscription) in Shopify
 *
 * @param admin - Shopify admin GraphQL client
 * @param tier - Subscription tier to create (growth, pro, enterprise)
 * @param returnUrl - URL to redirect merchant after approval
 * @param isTest - Whether this is a test charge (default: true for development)
 * @returns Object containing confirmation URL and subscription details
 */
export async function createAppSubscription(
  admin: any, // Shopify admin client from authenticate.admin()
  tier: Exclude<SubscriptionTier, "free">, // Can't create charge for free tier
  returnUrl: string,
  isTest: boolean = true,
) {
  const tierConfig = TIER_LIMITS[tier];

  if (!tierConfig) {
    throw new Error(`Invalid subscription tier: ${tier}`);
  }

  const mutation = `
    ${APP_SUBSCRIPTION_FRAGMENT}
    mutation AppSubscriptionCreate(
      $name: String!
      $returnUrl: URL!
      $test: Boolean
      $lineItems: [AppSubscriptionLineItemInput!]!
    ) {
      appSubscriptionCreate(
        name: $name
        returnUrl: $returnUrl
        test: $test
        lineItems: $lineItems
      ) {
        appSubscription {
          ...AppSubscriptionFragment
        }
        confirmationUrl
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    name: tierConfig.name,
    returnUrl,
    test: isTest,
    lineItems: [
      {
        plan: {
          appRecurringPricingDetails: {
            price: {
              amount: tierConfig.price,
              currencyCode: "USD",
            },
            interval: "EVERY_30_DAYS",
          },
        },
      },
    ],
  };

  const response = await admin.graphql(mutation, { variables });
  const data = await response.json();

  if (data.data?.appSubscriptionCreate?.userErrors?.length > 0) {
    const errors = data.data.appSubscriptionCreate.userErrors
      .map((e: any) => e.message)
      .join(", ");
    throw new Error(`Failed to create subscription: ${errors}`);
  }

  return {
    subscription: data.data.appSubscriptionCreate.appSubscription,
    confirmationUrl: data.data.appSubscriptionCreate.confirmationUrl,
  };
}

/**
 * Cancel an active app subscription
 *
 * @param admin - Shopify admin GraphQL client
 * @param subscriptionId - GraphQL ID of the subscription (e.g., gid://shopify/AppSubscription/123)
 * @param prorate - Whether to prorate the refund (default: true)
 * @returns Cancelled subscription details
 */
export async function cancelAppSubscription(
  admin: any,
  subscriptionId: string,
  prorate: boolean = true,
) {
  const mutation = `
    ${APP_SUBSCRIPTION_FRAGMENT}
    mutation AppSubscriptionCancel($id: ID!, $prorate: Boolean) {
      appSubscriptionCancel(id: $id, prorate: $prorate) {
        appSubscription {
          ...AppSubscriptionFragment
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const response = await admin.graphql(mutation, {
    variables: {
      id: subscriptionId,
      prorate,
    },
  });

  const data = await response.json();

  if (data.data?.appSubscriptionCancel?.userErrors?.length > 0) {
    const errors = data.data.appSubscriptionCancel.userErrors
      .map((e: any) => e.message)
      .join(", ");
    throw new Error(`Failed to cancel subscription: ${errors}`);
  }

  return data.data.appSubscriptionCancel.appSubscription;
}

/**
 * Check if a subscription is active in Shopify
 *
 * @param admin - Shopify admin GraphQL client
 * @param subscriptionId - GraphQL ID of the subscription
 * @returns Boolean indicating if subscription is active
 */
export async function checkSubscriptionStatus(
  admin: any,
  subscriptionId: string,
): Promise<boolean> {
  const query = `
    query GetSubscription($id: ID!) {
      node(id: $id) {
        ... on AppSubscription {
          id
          status
        }
      }
    }
  `;

  const response = await admin.graphql(query, {
    variables: { id: subscriptionId },
  });

  const data = await response.json();
  const status = data.data?.node?.status;

  // Status can be: PENDING, ACTIVE, DECLINED, EXPIRED, FROZEN, CANCELLED
  return status === "ACTIVE";
}

/**
 * Get all active subscriptions for the current app installation
 *
 * @param admin - Shopify admin GraphQL client
 * @returns Array of active subscriptions
 */
export async function getActiveSubscriptions(admin: any) {
  const query = `
    ${APP_SUBSCRIPTION_FRAGMENT}
    query GetActiveSubscriptions {
      currentAppInstallation {
        activeSubscriptions {
          ...AppSubscriptionFragment
        }
      }
    }
  `;

  const response = await admin.graphql(query);
  const data = await response.json();

  return data.data?.currentAppInstallation?.activeSubscriptions || [];
}
