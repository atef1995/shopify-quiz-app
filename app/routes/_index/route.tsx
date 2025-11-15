import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  // When opened from Shopify admin, the URL will have shop parameter
  // Redirect to /app which will handle OAuth using App Bridge (embedded context)
  // or regular OAuth redirect (non-embedded context)
  //
  // IMPORTANT: Must pass ALL parameters including 'host' and 'embedded'
  // The 'host' parameter tells the Shopify library this is embedded
  // and it will use App Bridge for OAuth instead of regular HTTP redirect
  const shop = url.searchParams.get("shop");
  if (shop) {
    console.log(`[AUTH] Shop parameter detected: ${shop}`);
    console.log(`[AUTH] Redirecting to /app with all params: ${url.searchParams.toString()}`);
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  // No shop parameter - show login form for manual shop entry
  console.log("[AUTH] No shop parameter, showing login form for manual entry");
  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>A short heading about [your app]</h1>
        <p className={styles.text}>
          A tagline about [your app] that describes your value proposition.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Product feature</strong>. Some detail about your feature and
            its benefit to your customer.
          </li>
          <li>
            <strong>Product feature</strong>. Some detail about your feature and
            its benefit to your customer.
          </li>
          <li>
            <strong>Product feature</strong>. Some detail about your feature and
            its benefit to your customer.
          </li>
        </ul>
      </div>
    </div>
  );
}
