import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
        <style>{`
          /* Mobile-first responsive design for better usability */
          @media (max-width: 768px) {
            /* Reduce padding to maximize content area */
            s-page {
              --p-space-400: 0.5rem !important;
              --p-space-500: 0.75rem !important;
            }
            s-section {
              --p-space-400: 0.5rem !important;
              padding: 0.5rem !important;
            }
            s-box {
              padding: 0.5rem !important;
            }

            /* Force inline stacks to become vertical on mobile for better layout */
            s-stack[direction="inline"] {
              flex-direction: column !important;
              align-items: stretch !important;
            }

            /* Make primary action buttons easier to tap on mobile */
            s-button[slot="primary-action"],
            s-button[variant="primary"] {
              min-width: 100% !important;
              justify-content: center !important;
            }

            /* Ensure other buttons are still accessible */
            s-button {
              min-height: 44px !important; /* Apple's minimum touch target */
              padding: 0.5rem 1rem !important;
            }

            /* Ensure text doesn't overflow */
            s-text {
              word-wrap: break-word !important;
              overflow-wrap: break-word !important;
            }

            /* Make form fields full width */
            s-text-field {
              width: 100% !important;
            }

            /* Hide data tables on mobile - they're unusable */
            s-data-table {
              display: none !important;
            }

            /* Show mobile card layout instead */
            .mobile-quiz-list {
              display: block !important;
            }
          }

          /* Portrait screens - maximize horizontal space */
          @media (orientation: portrait) {
            s-page {
              --p-space-400: 0.5rem !important;
              --p-space-500: 0.75rem !important;
            }
          }

          /* Very small screens (phones) - ultra compact */
          @media (max-width: 480px) {
            s-page {
              --p-space-400: 0.25rem !important;
              --p-space-500: 0.5rem !important;
            }
            s-section {
              padding: 0.25rem !important;
            }
            s-box {
              padding: 0.25rem !important;
            }

            /* Smaller text on very small screens */
            s-text {
              font-size: 0.9em !important;
            }
          }
          /* Desktop - hide mobile layout, show table */
          @media (min-width: 769px) {
            .mobile-quiz-list {
              display: none !important;
            }
          }
        `}</style>
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
