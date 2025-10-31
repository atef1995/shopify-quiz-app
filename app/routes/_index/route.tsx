import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  // If shop is in query params, redirect to app
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  // Enhanced embedded app detection
  const referer = request.headers.get("referer") || "";
  const embedded = url.searchParams.get("embedded") === "1";
  const host = url.searchParams.get("host");
  const hmac = url.searchParams.get("hmac");
  
  // Log all relevant headers and params for debugging
  console.log("[DEBUG] Request details:", {
    url: url.href,
    referer,
    embedded,
    host,
    hmac: hmac ? "present" : "missing",
    userAgent: request.headers.get("user-agent")?.substring(0, 100),
    allParams: Object.fromEntries(url.searchParams.entries())
  });
  
  // Multiple ways to detect embedded context
  const isEmbedded = embedded || 
                    host !== null || // Shopify passes host parameter
                    hmac !== null || // Shopify passes HMAC for authentication
                    referer.includes("admin.shopify.com") ||
                    referer.includes(".myshopify.com/admin") ||
                    request.headers.get("sec-fetch-dest") === "iframe";
  
  if (isEmbedded) {
    // Extract shop from various sources
    let shop = "atef-7830.myshopify.com"; // Default fallback
    
    // Try to extract shop from URL params first
    const shopParam = url.searchParams.get("shop");
    if (shopParam) {
      shop = shopParam;
    } else {
      // Try to extract from referer URL
      if (referer.includes(".myshopify.com")) {
        const match = referer.match(/https?:\/\/([^.]+)\.myshopify\.com/);
        if (match) {
          shop = match[1] + ".myshopify.com";
        }
      }
      
      // Or from admin.shopify.com store path
      if (referer.includes("admin.shopify.com/store/")) {
        const match = referer.match(/admin\.shopify\.com\/store\/([^/]+)/);
        if (match) {
          shop = match[1] + ".myshopify.com";
        }
      }
    }
    
    console.log(`[EMBEDDED] Detected embedded context, redirecting to /app?shop=${shop}&embedded=1`);
    throw redirect(`/app?shop=${shop}&embedded=1${host ? `&host=${host}` : ''}${hmac ? `&hmac=${hmac}` : ''}`);
  }

  console.log("[DEBUG] Not embedded, showing login form");
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
