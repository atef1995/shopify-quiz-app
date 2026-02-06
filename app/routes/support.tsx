import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Support - QuizCraft</title>
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
    .contact-box {
      background: #f8f9fa;
      border-left: 4px solid #3498db;
      padding: 20px;
      margin: 20px 0;
    }
    .faq {
      background: #fff;
      border: 1px solid #e1e4e8;
      border-radius: 6px;
      padding: 15px;
      margin: 15px 0;
    }
    .faq h3 {
      margin-top: 0;
      color: #3498db;
    }
    a {
      color: #3498db;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    .email-link {
      font-size: 18px;
      font-weight: bold;
    }
  </style>
</head>
<body>
  <h1>QuizCraft Support</h1>
  
  <div class="contact-box">
    <h2>📧 Contact Support</h2>
    <p class="email-link">Email: <a href="mailto:atefm6@gmail.com">atefm6@gmail.com</a></p>
    <p><strong>Response Time:</strong> Within 24 hours (usually faster!)</p>
    <p><strong>Emergency Contact:</strong> atefm6@gmail.com</p>
  </div>
  
  <h2>📚 Frequently Asked Questions</h2>
  
  <div class="faq">
    <h3>How do I create my first quiz?</h3>
    <p>1. Open the app from your Shopify admin<br>
    2. Click "Create Quiz"<br>
    3. Add questions and answer options<br>
    4. Set product matching rules<br>
    5. Publish your quiz<br>
    6. Add the quiz block to your theme in Theme Editor</p>
  </div>
  
  <div class="faq">
    <h3>How do I add a quiz to my store?</h3>
    <p>1. Go to Online Store → Themes → Customize<br>
    2. Navigate to the page where you want the quiz<br>
    3. Add an App Block<br>
    4. Select "QuizCraft"<br>
    5. Choose your quiz from the dropdown<br>
    6. Save your changes</p>
  </div>
  
  <div class="faq">
    <h3>How does product matching work?</h3>
    <p>You can match products based on:<br>
    • Product tags<br>
    • Product type<br>
    • Vendor<br>
    • Collections<br>
    The app will recommend products that match the customer's answers.</p>
  </div>
  
  <div class="faq">
    <h3>Can I customize the quiz appearance?</h3>
    <p>Yes! You can customize:<br>
    • Colors and fonts (in theme settings)<br>
    • Button text<br>
    • Result page messaging<br>
    • Email capture settings</p>
  </div>
  
  <div class="faq">
    <h3>How do I upgrade my plan?</h3>
    <p>1. Open the app<br>
    2. Go to Billing section<br>
    3. Click "Upgrade" on your desired plan<br>
    4. Approve the charge in Shopify</p>
  </div>
  
  <div class="faq">
    <h3>What happens when I reach my quiz limit?</h3>
    <p>Your quizzes will continue to work, but you won't see new completions in analytics until you upgrade or the next billing cycle starts.</p>
  </div>
  
  <div class="faq">
    <h3>How do I export quiz results?</h3>
    <p>Go to the Analytics page for your quiz and click "Export Results" to download a CSV file with all responses.</p>
  </div>
  
  <div class="faq">
    <h3>Is my customer data safe?</h3>
    <p>Yes! We follow industry best practices:<br>
    • All data encrypted in transit and at rest<br>
    • GDPR compliant<br>
    • No data sold to third parties<br>
    • See our <a href="/privacy">Privacy Policy</a> for details</p>
  </div>
  
  <h2>🐛 Report a Bug</h2>
  <p>Found a bug? Please email us at <a href="mailto:atefm6@gmail.com">atefm6@gmail.com</a> with:</p>
  <ul>
    <li>Description of the issue</li>
    <li>Steps to reproduce</li>
    <li>Screenshots (if applicable)</li>
    <li>Your shop domain</li>
  </ul>
  
  <h2>💡 Feature Requests</h2>
  <p>Have an idea? We'd love to hear it! Send your suggestions to <a href="mailto:atefm6@gmail.com">atefm6@gmail.com</a></p>
  
  <h2>📖 Documentation</h2>
  <p>Looking for more detailed guides? Check out our documentation (coming soon) or contact support for step-by-step help.</p>
  
  <div class="contact-box">
    <h2>🚨 Emergency Support</h2>
    <p>For critical issues affecting your store:</p>
    <p><strong>Email:</strong> <a href="mailto:atefm6@gmail.com">atefm6@gmail.com</a></p>
    <p>Use subject line: <strong>[URGENT]</strong> for fastest response</p>
  </div>
</body>
</html>
  `;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
};
