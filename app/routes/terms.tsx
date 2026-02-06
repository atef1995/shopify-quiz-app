import type { LoaderFunctionArgs } from "react-router";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const loader = async (_args: LoaderFunctionArgs) => {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Terms of Service - QuizCraft</title>
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
    .important {
      background: #fff3cd;
      border-left: 4px solid #ffc107;
      padding: 15px;
      margin: 20px 0;
    }
  </style>
</head>
<body>
  <h1>Terms of Service</h1>
  <p class="last-updated">Last updated: January 14, 2026</p>
  
  <div class="important">
    <strong>Important:</strong> By installing or using QuizCraft, you agree to these Terms of Service. If you do not agree, please uninstall the app immediately.
  </div>
  
  <h2>1. Acceptance of Terms</h2>
  <p>These Terms of Service ("Terms") govern your use of QuizCraft ("the App", "we", "our", or "us"), a Shopify application that enables merchants to create interactive product recommendation quizzes.</p>
  <p>By installing, accessing, or using the App, you ("Merchant", "you", or "your") agree to be bound by these Terms and our <a href="/privacy">Privacy Policy</a>.</p>
  
  <h2>2. Description of Service</h2>
  <p>QuizCraft provides:</p>
  <ul>
    <li>Interactive quiz creation tools for product recommendations</li>
    <li>AI-powered quiz generation (on eligible plans)</li>
    <li>Storefront quiz embedding via theme app extensions</li>
    <li>Analytics and reporting on quiz performance</li>
    <li>Customer email capture functionality</li>
  </ul>
  
  <h2>3. Account and Eligibility</h2>
  <p>To use the App, you must:</p>
  <ul>
    <li>Have a valid Shopify store account in good standing</li>
    <li>Be at least 18 years old or the age of majority in your jurisdiction</li>
    <li>Have the authority to bind your business to these Terms</li>
    <li>Provide accurate and complete information during installation</li>
  </ul>
  
  <h2>4. Subscription Plans and Billing</h2>
  <h3>4.1 Free Plan</h3>
  <p>The free plan includes limited features with usage caps. We reserve the right to modify free plan limits at any time.</p>
  
  <h3>4.2 Paid Plans</h3>
  <ul>
    <li>Paid subscriptions are billed monthly through Shopify's billing system</li>
    <li>Charges appear on your Shopify invoice</li>
    <li>You may upgrade, downgrade, or cancel at any time</li>
    <li>Downgrades take effect at the end of your current billing cycle</li>
    <li>No refunds for partial months or unused features</li>
  </ul>
  
  <h3>4.3 Usage Limits</h3>
  <p>Each plan has specific limits on quiz completions, number of quizzes, and features. Exceeding limits may result in:</p>
  <ul>
    <li>Temporary restriction of quiz submissions</li>
    <li>Prompt to upgrade your plan</li>
    <li>Automatic upgrade with your consent</li>
  </ul>
  
  <h2>5. Acceptable Use</h2>
  <p>You agree NOT to use the App to:</p>
  <ul>
    <li>Violate any applicable laws or regulations</li>
    <li>Collect customer data without proper consent or disclosure</li>
    <li>Create deceptive, misleading, or fraudulent quizzes</li>
    <li>Distribute malware, spam, or harmful content</li>
    <li>Attempt to reverse engineer, hack, or exploit the App</li>
    <li>Interfere with the App's operation or other users' access</li>
    <li>Use the App for any illegal, harmful, or offensive purposes</li>
    <li>Violate Shopify's Acceptable Use Policy</li>
  </ul>
  
  <h2>6. Intellectual Property</h2>
  <h3>6.1 Our Rights</h3>
  <p>We retain all rights to the App, including its code, design, features, and documentation. The App is licensed, not sold.</p>
  
  <h3>6.2 Your Content</h3>
  <p>You retain ownership of quiz content you create (questions, images, text). By using the App, you grant us a limited license to display and process your content as necessary to provide the service.</p>
  
  <h3>6.3 Feedback</h3>
  <p>Any feedback, suggestions, or ideas you provide may be used by us without obligation or compensation.</p>
  
  <h2>7. Data and Privacy</h2>
  <p>Your use of the App is also governed by our <a href="/privacy">Privacy Policy</a>. By using the App, you:</p>
  <ul>
    <li>Consent to our data practices as described in the Privacy Policy</li>
    <li>Agree to comply with applicable data protection laws (including GDPR)</li>
    <li>Are responsible for obtaining proper consent from your customers</li>
    <li>Must have a privacy policy on your store if collecting customer data</li>
  </ul>
  
  <h2>8. Disclaimer of Warranties</h2>
  <div class="important">
    <p>THE APP IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO:</p>
    <ul>
      <li>MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE</li>
      <li>UNINTERRUPTED, SECURE, OR ERROR-FREE OPERATION</li>
      <li>ACCURACY OR RELIABILITY OF RESULTS</li>
      <li>COMPATIBILITY WITH YOUR SPECIFIC NEEDS</li>
    </ul>
  </div>
  
  <h2>9. Limitation of Liability</h2>
  <p>TO THE MAXIMUM EXTENT PERMITTED BY LAW:</p>
  <ul>
    <li>We are not liable for any indirect, incidental, special, consequential, or punitive damages</li>
    <li>We are not liable for loss of profits, revenue, data, or business opportunities</li>
    <li>Our total liability shall not exceed the amount you paid us in the 12 months preceding the claim</li>
    <li>These limitations apply regardless of the theory of liability (contract, tort, negligence, etc.)</li>
  </ul>
  
  <h2>10. Indemnification</h2>
  <p>You agree to indemnify and hold harmless QuizCraft, its owners, employees, and affiliates from any claims, damages, losses, or expenses (including legal fees) arising from:</p>
  <ul>
    <li>Your use of the App</li>
    <li>Your violation of these Terms</li>
    <li>Your violation of any third-party rights</li>
    <li>Content you create or actions you take using the App</li>
  </ul>
  
  <h2>11. Termination</h2>
  <h3>11.1 By You</h3>
  <p>You may uninstall the App at any time through your Shopify admin. Upon uninstallation:</p>
  <ul>
    <li>Your access to the App terminates immediately</li>
    <li>Your data will be deleted within 30 days</li>
    <li>Any remaining subscription charges may still apply through the billing cycle end</li>
  </ul>
  
  <h3>11.2 By Us</h3>
  <p>We may suspend or terminate your access if:</p>
  <ul>
    <li>You violate these Terms</li>
    <li>You fail to pay applicable fees</li>
    <li>Your Shopify store is suspended or closed</li>
    <li>We discontinue the App (with reasonable notice)</li>
  </ul>
  
  <h2>12. Changes to Terms</h2>
  <p>We may modify these Terms at any time. We will notify you of material changes via:</p>
  <ul>
    <li>Email to your Shopify store email</li>
    <li>In-app notification</li>
    <li>Updated date at the top of this page</li>
  </ul>
  <p>Continued use after changes constitutes acceptance of new Terms.</p>
  
  <h2>13. General Provisions</h2>
  <h3>13.1 Governing Law</h3>
  <p>These Terms are governed by the laws of the jurisdiction where the App operator resides, without regard to conflict of law principles.</p>
  
  <h3>13.2 Dispute Resolution</h3>
  <p>Any disputes shall first be attempted to be resolved through good-faith negotiation. If unsuccessful, disputes may be resolved through binding arbitration or the courts of the applicable jurisdiction.</p>
  
  <h3>13.3 Severability</h3>
  <p>If any provision is found unenforceable, the remaining provisions remain in full effect.</p>
  
  <h3>13.4 Entire Agreement</h3>
  <p>These Terms, together with our Privacy Policy, constitute the entire agreement between you and us regarding the App.</p>
  
  <h3>13.5 No Waiver</h3>
  <p>Failure to enforce any right does not waive our ability to enforce it later.</p>
  
  <h2>14. Contact Information</h2>
  <p>For questions about these Terms:</p>
  <ul>
    <li><strong>Email:</strong> <a href="mailto:atefm6@gmail.com">atefm6@gmail.com</a></li>
    <li><strong>Support:</strong> <a href="/support">Support Page</a></li>
  </ul>
  
  <p><em>By installing and using QuizCraft, you acknowledge that you have read, understood, and agree to these Terms of Service.</em></p>
</body>
</html>
  `;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
};
