# AI-Powered Product Quiz Builder - Development Roadmap

This document outlines all TODO items and known BUGs throughout the codebase, organized by priority and file location.

## 🚨 CRITICAL TODOs (Must implement for production)

### Product Recommendations (`app/routes/api.quiz.submit.tsx`)
- **Implement real AI-powered recommendations** - Currently using rule-based matching
- **Add price range filtering** - Extract budget from quiz answers and filter products
- **Add inventory checking** - Don't recommend out-of-stock products

### AI Quiz Generation (`app/routes/api.quiz.generate.tsx`)
- **Integrate OpenAI GPT-4 or Claude API** - Replace rule-based generation with actual AI
- **Add product limit validation** - Prevent requesting 10000+ products (max: 100)
- **Handle GraphQL errors properly** - Check for `productsData.errors`

### Billing Integration ✅ COMPLETED
- **COMPLETED**: Shopify Billing API integration for recurring charges
- **COMPLETED**: AppSubscriptionCreate mutation for paid tiers
- **COMPLETED**: Billing approval redirect flow
- **COMPLETED**: Subscription status checking after approval
- **COMPLETED**: Cancel/downgrade to free tier functionality
- **COMPLETED**: Test mode for development environment
- **COMPLETED**: UI upgrade buttons with loading states
- TODO: Add webhook handlers for subscription changes (cancel, upgrade, downgrade)
- TODO: Implement proration logic for mid-month upgrades
- TODO: Add grace period before blocking service when payment fails
- TODO: Send confirmation email on tier change

### Storefront API Connection (`extensions/quiz-embed/assets/quiz-embed.js`) ✅ MOSTLY COMPLETE
- **COMPLETED**: Configured proper API base URL using app proxy path
- **COMPLETED**: localStorage for quiz progress (auto-saves on each answer, restores on reload)
- **COMPLETED**: Progress validation (clears if quiz structure changed)
- **COMPLETED**: Visual notification when progress is restored
- TODO: Add loading states for API calls (spinner during submit)
- TODO: Implement retry logic - 3 retries with exponential backoff for failed requests

## ⚠️ Security & Performance Issues

### CORS Configuration ✅ COMPLETED
- **FIXED**: Restricted `api.quiz.$id.tsx` to Shopify shop domains only
- **FIXED**: Added proper error CORS headers
- **FIXED**: Added `Vary: Origin` header for proper caching
- `api.quiz.submit.tsx` already had proper CORS with shop domain restriction
- TODO: Add rate limiting per origin to prevent abuse

### Input Validation ✅ COMPLETED
- **FIXED**: Email format validation with regex
- **FIXED**: Max length check on answers array (limit of 50)
- **FIXED**: Answer structure validation (questionId and optionId required)
- **FIXED**: Email sanitization (trim and lowercase)
- **FIXED**: Product limit validation (capped at 100, min 10)
- **FIXED**: Quiz style validation (fun, professional, detailed)
- TODO: Add more robust JSON parsing with Zod schema validation

### Database Transactions (`api.quiz.submit.tsx`)
- **BUG**: Analytics update failure leaves inconsistent state
- **BUG**: Billing increment failure = free completion for merchant
- **Fix**: Wrap all database operations in Prisma transactions

### Race Conditions (`app/lib/billing.server.ts`)
- **BUG**: Multiple completions can exceed tier limit simultaneously
- **BUG**: Period reset can happen multiple times if concurrent requests
- **Fix**: Use database-level atomic operations or locks

## 📊 Analytics & Tracking

### Analytics Events (storefront)
- TODO: Send `quiz_started` event
- TODO: Send `quiz_question_answered` event
- TODO: Send `quiz_completed` event
- TODO: Send `quiz_results_viewed` event
- TODO: Track product clicks for conversion analysis

### Error Logging
- TODO: Integrate error tracking service (Sentry, LogRocket, etc.)
- TODO: Add error categorization (DB errors, API errors, validation errors)
- TODO: Track error rates per quiz for monitoring

## 🎨 User Experience Enhancements

### Storefront Quiz (`extensions/quiz-embed/assets/quiz-embed.js`) ✅ COMPLETED
- **COMPLETED**: localStorage saves progress (auto-save on each answer, navigation, email capture)
- **COMPLETED**: Progress validation (ensures saved data matches current quiz structure)  
- **COMPLETED**: Auto-restore on page load with visual notification
- **COMPLETED**: Progress clears after successful quiz completion
- **COMPLETED**: 7-day expiration for stale progress data
- **COMPLETED**: Keyboard navigation (users can click options)
- TODO: Add animations for option selection
- TODO: Add loading timeout (don't show spinner forever)
- TODO: Show specific error messages based on error type

### Quiz Builder (`app/routes/app.quizzes.$id.edit.tsx`)
- TODO: Add image upload functionality for questions/options
- TODO: Add duplicate quiz feature
- TODO: Add conditional logic validation
- TODO: Add bulk question import (CSV/JSON)
- TODO: Validate quiz has ≥1 question before activation
- TODO: Validate questions have ≥2 options

### Results Page (storefront)
- TODO: Add "Add to Cart" functionality for each product
- TODO: Add social sharing buttons
- TODO: Track which products are clicked

## 🔧 Code Quality & Maintenance

### Error Handling
- Add specific error messages instead of generic "Failed to..."
- Show user-friendly messages for different error types
- Handle rate limit errors (429) gracefully
- Handle usage limit exceeded errors with upgrade prompts

### Caching & Performance
- TODO: Cache quiz data to reduce database queries
- TODO: Cache product data to reduce GraphQL API calls
- TODO: Move analytics tracking to background job
- TODO: Add ETag support for conditional requests
- TODO: Add response size limit check (large quizzes)

### Timezone Issues
- **BUG**: Server timezone might not match shop timezone
- **Fix**: Use shop's timezone from Shopify API
- TODO: Add cron job to reset billing periods instead of on-demand

## 💰 Monetization Features

### Billing Enhancements
- TODO: Add 14-day free trial for all tiers
- TODO: Implement proration logic for mid-month upgrades
- TODO: Send confirmation email on tier change
- TODO: Add grace period before blocking service (payment fails)
- TODO: Add audit log of all completions for billing disputes
- TODO: Make completion increment idempotent (prevent double-counting)

### Upgrade Flow
- TODO: Validate tier change is allowed (prevent "upgrades" to free)
- TODO: Calculate and charge prorated amount
- TODO: Reset usage limits immediately on tier change
- TODO: Update shopifySubscriptionId with new charge ID

## 🚀 Feature Additions

### Quiz Features
- TODO: Add A/B testing for different quiz versions
- TODO: Add product ranking algorithm (match strength, popularity, margin)
- TODO: Implement fallback logic if no products match
- TODO: Add conditional logic for questions (show Q2 if answer to Q1 = X)

### AI Features
- TODO: Add caching to avoid regenerating same questions
- TODO: Add generation limits based on subscription tier
- TODO: Allow regeneration with different styles
- TODO: Support multiple quiz styles (fun, professional, detailed)

### Analytics Dashboard
- TODO: Add drop-off points visualization
- TODO: Add popular answer paths analysis
- TODO: Add revenue attribution tracking
- TODO: Add cohort analysis for signup dates

## 📱 Mobile & Accessibility
- TODO: Test keyboard navigation on mobile
- TODO: Add ARIA labels for screen readers
- TODO: Test on various mobile browsers
- TODO: Optimize image sizes for mobile

## 🐛 Known Bugs to Fix

1. **Global event object** (`quiz-embed.js:188`) - Not reliable in all browsers
2. **Date boundary issues** (`billing.server.ts:64`) - Jan 31 + 1 month = Mar 3
3. **No productMatching validation** (`api.quiz.submit.tsx:162`) - Could crash if malformed
4. **No error handling on DB ops** - Silent failures possible
5. **Hardcoded button text** - Should use data attributes for i18n

## 📝 Documentation Needed

- TODO: Add JSDoc comments to all public functions
- TODO: Document GraphQL schema for quiz recommendations
- TODO: Create merchant onboarding guide
- TODO: Create API documentation for third-party integrations
- TODO: Add inline examples for complex functions

## 🎯 Next Sprint Priorities

### Week 1: Critical Production Blockers
1. Integrate Shopify Billing API
2. Fix CORS security issues
3. Add proper error handling and transactions
4. Implement email validation

### Week 2: UX & Performance
1. Add loading states throughout UI
2. Implement localStorage for quiz progress
3. Add retry logic for failed API calls
4. Optimize database queries with indexes

### Week 3: Analytics & Testing
1. Integrate error tracking service
2. Add analytics events
3. Test on development store thoroughly
4. Fix known bugs

### Week 4: Polish & Launch
1. Add merchant onboarding flow
2. Create app listing materials
3. Submit to Shopify App Store
4. Launch marketing campaign

---

## 💡 Nice-to-Have Features (Post-Launch)

- Multi-language support for quiz content
- Custom CSS themes for quiz appearance
- Integration with email marketing platforms (Klaviyo, Mailchimp)
- Advanced analytics dashboard
- Quiz templates library
- Import quiz from competitors
- Export quiz results to CSV
- Shopify Flow integration
- Custom webhooks for quiz events

---

**Last Updated**: 2025-01-23
**Status**: MVP Complete - Ready for Production Hardening
