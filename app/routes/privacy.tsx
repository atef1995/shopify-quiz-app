import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Privacy Policy - Product Quiz Builder</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      line-height: 1.6;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 20px;
      color: #333;
    }
    h1 {
      color: #2c3e50;
      border-bottom: 3px solid #3498db;
      padding-bottom: 10px;
    }
    h2 {
      color: #34495e;
      margin-top: 30px;
    }
    .last-updated {
      color: #7f8c8d;
      font-style: italic;
    }
    a {
      color: #3498db;
    }
  </style>
</head>
<body>
  <h1>Privacy Policy</h1>
  <p class="last-updated">Last updated: October 24, 2025</p>
  
  <h2>1. Introduction</h2>
  <p>Product Quiz Builder ("we", "our", or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, and protect information when you use our Shopify app.</p>
  
  <h2>2. Information We Collect</h2>
  <h3>2.1 Shop Information</h3>
  <ul>
    <li>Shop domain and name</li>
    <li>Shop owner email</li>
    <li>Access tokens for API authentication</li>
  </ul>
  
  <h3>2.2 Quiz Data</h3>
  <ul>
    <li>Quiz questions and answers created by merchants</li>
    <li>Product associations and recommendations</li>
    <li>Quiz completion statistics</li>
  </ul>
  
  <h3>2.3 Customer Data (Optional)</h3>
  <ul>
    <li>Email addresses (only if merchant enables email capture)</li>
    <li>Quiz responses (non-personally identifiable)</li>
    <li>Quiz completion timestamps</li>
  </ul>
  
  <h2>3. How We Use Your Information</h2>
  <ul>
    <li><strong>Provide Core Functionality:</strong> To operate the quiz builder and display quizzes on your storefront</li>
    <li><strong>Analytics:</strong> To show quiz performance metrics to merchants</li>
    <li><strong>Support:</strong> To troubleshoot issues and provide customer support</li>
    <li><strong>Service Improvement:</strong> To enhance app features and user experience</li>
  </ul>
  
  <h2>4. Data Retention</h2>
  <ul>
    <li><strong>Active Installations:</strong> Data is retained while the app is installed</li>
    <li><strong>After Uninstall:</strong> Shop data is deleted within 30 days per GDPR requirements</li>
    <li><strong>Customer Data:</strong> Deleted immediately upon customer request or shop uninstall</li>
  </ul>
  
  <h2>5. Data Sharing and Disclosure</h2>
  <p>We do NOT sell, trade, or rent your data to third parties. We only share data:</p>
  <ul>
    <li>With Shopify, as required for app functionality</li>
    <li>When required by law or legal process</li>
    <li>To protect our rights or safety</li>
  </ul>
  
  <h2>6. Data Security</h2>
  <p>We implement industry-standard security measures:</p>
  <ul>
    <li>Data encrypted in transit (HTTPS/TLS)</li>
    <li>Data encrypted at rest (database encryption)</li>
    <li>Secure authentication using Shopify OAuth</li>
    <li>Regular security updates and monitoring</li>
  </ul>
  
  <h2>7. GDPR Compliance</h2>
  <p>We fully comply with GDPR requirements:</p>
  <ul>
    <li><strong>Right to Access:</strong> Request your data via customers/data_request webhook</li>
    <li><strong>Right to Deletion:</strong> Request deletion via customers/redact webhook</li>
    <li><strong>Right to Portability:</strong> Export your data in JSON format</li>
    <li><strong>Shop Deletion:</strong> All shop data deleted via shop/redact webhook</li>
  </ul>
  
  <h2>8. Cookies and Tracking</h2>
  <p>We use minimal tracking:</p>
  <ul>
    <li>Session cookies for authentication (required for app to function)</li>
    <li>No third-party tracking cookies</li>
    <li>No advertising or marketing pixels</li>
  </ul>
  
  <h2>9. Children's Privacy</h2>
  <p>Our app is designed for merchants (business users) and is not intended for children under 13. We do not knowingly collect data from children.</p>
  
  <h2>10. Changes to This Policy</h2>
  <p>We may update this privacy policy periodically. We will notify you of significant changes via:</p>
  <ul>
    <li>Email to the shop owner</li>
    <li>In-app notification</li>
    <li>Updated "Last Modified" date at the top of this policy</li>
  </ul>
  
  <h2>11. Contact Us</h2>
  <p>For privacy-related questions or requests:</p>
  <ul>
    <li><strong>Email:</strong> <a href="mailto:atefm6@gmail.com">atefm6@gmail.com</a></li>
    <li><strong>GDPR Requests:</strong> Submit via Shopify's data request system</li>
  </ul>
  
  <h2>12. Third-Party Services</h2>
  <p>We use the following third-party services:</p>
  <ul>
    <li><strong>Fly.io:</strong> Application hosting (see <a href="https://fly.io/legal/privacy-policy/">Fly.io Privacy Policy</a>)</li>
    <li><strong>Shopify:</strong> Platform and authentication (see <a href="https://www.shopify.com/legal/privacy">Shopify Privacy Policy</a>)</li>
  </ul>
  
  <p><em>By using Product Quiz Builder, you agree to this Privacy Policy.</em></p>
</body>
</html>
  `;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
};
