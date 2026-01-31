import type { LoaderFunctionArgs } from "react-router";

export const loader = async () => {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pricing - QuizCraft</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      line-height: 1.6;
      margin: 0;
      padding: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #333;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 60px 20px;
    }
    .header {
      text-align: center;
      color: white;
      margin-bottom: 60px;
    }
    .header h1 {
      font-size: 3rem;
      margin-bottom: 20px;
      font-weight: 700;
    }
    .header p {
      font-size: 1.2rem;
      opacity: 0.9;
      max-width: 600px;
      margin: 0 auto;
    }
    .pricing-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 30px;
      margin-top: 40px;
    }
    .plan {
      background: white;
      border-radius: 12px;
      padding: 40px 30px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.1);
      position: relative;
      transition: transform 0.3s ease;
    }
    .plan:hover {
      transform: translateY(-5px);
    }
    .plan.popular {
      border: 3px solid #667eea;
      transform: scale(1.05);
    }
    .plan.popular::before {
      content: "Most Popular";
      position: absolute;
      top: -15px;
      left: 50%;
      transform: translateX(-50%);
      background: #667eea;
      color: white;
      padding: 8px 20px;
      border-radius: 20px;
      font-size: 0.9rem;
      font-weight: 600;
    }
    .plan-name {
      font-size: 1.5rem;
      font-weight: 700;
      margin-bottom: 10px;
      color: #2c3e50;
    }
    .plan-price {
      font-size: 3rem;
      font-weight: 700;
      color: #667eea;
      margin-bottom: 5px;
    }
    .plan-price .currency {
      font-size: 1.5rem;
    }
    .plan-price .period {
      font-size: 1rem;
      color: #7f8c8d;
      font-weight: 400;
    }
    .plan-description {
      color: #7f8c8d;
      margin-bottom: 30px;
      font-size: 1rem;
    }
    .features {
      list-style: none;
      padding: 0;
      margin-bottom: 30px;
    }
    .features li {
      padding: 8px 0;
      position: relative;
      padding-left: 25px;
    }
    .features li::before {
      content: "✓";
      position: absolute;
      left: 0;
      color: #27ae60;
      font-weight: bold;
    }
    .cta-button {
      width: 100%;
      padding: 15px;
      background: #667eea;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 1.1rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.3s ease;
      text-decoration: none;
      display: block;
      text-align: center;
    }
    .cta-button:hover {
      background: #5a6fd8;
    }
    .plan.free .cta-button {
      background: #27ae60;
    }
    .plan.free .cta-button:hover {
      background: #219a52;
    }
    .faq {
      margin-top: 80px;
      background: white;
      border-radius: 12px;
      padding: 40px;
    }
    .faq h2 {
      text-align: center;
      margin-bottom: 40px;
      color: #2c3e50;
    }
    .faq-item {
      margin-bottom: 25px;
      border-bottom: 1px solid #ecf0f1;
      padding-bottom: 20px;
    }
    .faq-question {
      font-weight: 600;
      color: #2c3e50;
      margin-bottom: 10px;
    }
    .faq-answer {
      color: #7f8c8d;
    }
    .contact {
      text-align: center;
      margin-top: 60px;
      color: white;
    }
    .contact a {
      color: #f39c12;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Simple, Transparent Pricing</h1>
      <p>Choose the perfect plan for your store. Start free and upgrade as you grow. All plans include our core quiz building features.</p>
    </div>

    <div class="pricing-grid">
      <!-- Starter Plan -->
      <div class="plan free">
        <div class="plan-name">Starter</div>
        <div class="plan-price">
          <span class="currency">$</span>0
          <span class="period">/month</span>
        </div>
        <div class="plan-description">Perfect for getting started with product quizzes</div>
        <ul class="features">
          <li>3 active quizzes</li>
          <li>Basic quiz builder</li>
          <li>Simple analytics</li>
          <li>100 monthly completions</li>
          <li>Email support</li>
        </ul>
        <a href="https://quiz-builder.duckdns.org" class="cta-button">Get Started Free</a>
      </div>

      <!-- Growth Plan -->
      <div class="plan popular">
        <div class="plan-name">Growth</div>
        <div class="plan-price">
          <span class="currency">$</span>29
          <span class="period">/month</span>
        </div>
        <div class="plan-description">Scale your quiz strategy with advanced features</div>
        <ul class="features">
          <li>10 active quizzes</li>
          <li>Advanced conditional logic</li>
          <li>Detailed analytics & insights</li>
          <li>1,000 monthly completions</li>
          <li>Custom styling options</li>
          <li>Priority email support</li>
        </ul>
        <a href="https://quiz-builder.duckdns.org" class="cta-button">Upgrade Now</a>
      </div>

      <!-- Professional Plan -->
      <div class="plan">
        <div class="plan-name">Professional</div>
        <div class="plan-price">
          <span class="currency">$</span>99
          <span class="period">/month</span>
        </div>
        <div class="plan-description">Complete quiz solution for established stores</div>
        <ul class="features">
          <li>50 active quizzes</li>
          <li>AI-powered recommendations</li>
          <li>Advanced analytics & reporting</li>
          <li>10,000 monthly completions</li>
          <li>Custom CSS & branding</li>
          <li>Webhook integrations</li>
          <li>Priority support + live chat</li>
        </ul>
        <a href="https://quiz-builder.duckdns.org" class="cta-button">Upgrade Now</a>
      </div>

      <!-- Enterprise Plan -->
      <div class="plan">
        <div class="plan-name">Enterprise</div>
        <div class="plan-price">
          <span class="currency">$</span>299
          <span class="period">/month</span>
        </div>
        <div class="plan-description">Enterprise-grade solution with unlimited everything</div>
        <ul class="features">
          <li>Unlimited quizzes & completions</li>
          <li>White-label options</li>
          <li>Custom integrations</li>
          <li>Dedicated account manager</li>
          <li>SLA guarantee</li>
          <li>Advanced API access</li>
          <li>Phone support</li>
        </ul>
        <a href="https://quiz-builder.duckdns.org" class="cta-button">Contact Sales</a>
      </div>
    </div>

    <div class="faq">
      <h2>Frequently Asked Questions</h2>
      
      <div class="faq-item">
        <div class="faq-question">Can I change plans at any time?</div>
        <div class="faq-answer">Yes! You can upgrade or downgrade your plan at any time. Changes take effect immediately, and billing is prorated.</div>
      </div>

      <div class="faq-item">
        <div class="faq-question">What happens if I exceed my plan limits?</div>
        <div class="faq-answer">Your quizzes will continue to work, but we'll notify you about upgrading. We never cut off service without warning.</div>
      </div>

      <div class="faq-item">
        <div class="faq-question">Do you offer yearly discounts?</div>
        <div class="faq-answer">Yes! Save 2 months when you pay annually. Yearly plans are available for all paid tiers.</div>
      </div>

      <div class="faq-item">
        <div class="faq-question">Is there a setup fee?</div>
        <div class="faq-answer">No setup fees, no hidden costs. You only pay the monthly subscription fee for your chosen plan.</div>
      </div>

      <div class="faq-item">
        <div class="faq-question">Can I cancel anytime?</div>
        <div class="faq-answer">Absolutely. Cancel anytime with no cancellation fees. Your service continues until the end of your billing period.</div>
      </div>
    </div>

    <div class="contact">
      <p>Have questions? <a href="mailto:atefm6@gmail.com">Contact our team</a> for personalized assistance.</p>
    </div>
  </div>
</body>
</html>
  `;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html",
    },
  });
};