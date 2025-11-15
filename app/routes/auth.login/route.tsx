import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));

  return {
    errors,
    apiKey: process.env.SHOPIFY_API_KEY || "",
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));

  return {
    errors,
    apiKey: process.env.SHOPIFY_API_KEY || "",
  };
};

export default function Auth() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [shop, setShop] = useState("");
  const { errors, apiKey } = actionData || loaderData;

  // Check if we have a host parameter (indicates embedded context)
  // If embedded, use App Bridge for OAuth to avoid iframe redirect issues
  const url = typeof window !== 'undefined' ? new URL(window.location.href) : null;
  const isEmbedded = url ? (url.searchParams.get('host') !== null || url.searchParams.get('embedded') === '1') : false;

  console.log('[AUTH LOGIN] Rendering auth form', { isEmbedded, hasErrors: !!errors.shop });

  return (
    <AppProvider embedded={isEmbedded} apiKey={apiKey}>
      <s-page>
        <Form method="post">
        <s-section heading="Log in">
          <s-text-field
            name="shop"
            label="Shop domain"
            details="example.myshopify.com"
            value={shop}
            onChange={(e) => setShop(e.currentTarget.value)}
            autocomplete="on"
            error={errors.shop}
          ></s-text-field>
          <s-button type="submit">Log in</s-button>
        </s-section>
        </Form>
      </s-page>
    </AppProvider>
  );
}
