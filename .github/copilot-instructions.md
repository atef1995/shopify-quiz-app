# AI Agent Instructions - Shopify Product Quiz Builder

## Project Overview
A Shopify embedded app built with **React Router v7** (not Remix!) for creating interactive product recommendation quizzes. Uses Polaris web components (`<s-*>` tags), Prisma ORM with SQLite, and theme app extensions.

## Critical Architecture Patterns

### 1. React Router v7 (NOT Remix)
- **Route files**: `app/routes/*.tsx` export `loader()`, `action()`, and default component
- **Authentication**: Always use `await authenticate.admin(request)` from `shopify.server.ts` in loaders/actions
- **Navigation**: Use `<Link>` from `react-router` (NOT `<a>` tags) to maintain embedded app session
- **Redirects**: Use `redirect` from `authenticate.admin`, NOT from `react-router`
- **Forms**: Use `useFetcher()` for non-navigating forms, `useSubmit()` for form submissions

### 2. Shopify-Specific Patterns
```typescript
// Correct admin API query pattern
export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const response = await admin.graphql(`{ products(first: 10) { ... } }`);
  const data = await response.json();
}
```

### 3. Database Schema (Prisma)
- **Main models**: `Quiz`, `Question`, `QuestionOption`, `QuizResult`, `QuizAnalytics`, `Subscription`
- **JSON fields**: `Quiz.settings`, `Question.conditionalRules`, `QuestionOption.productMatching`
  - Always `JSON.parse()` these in try-catch blocks - see `app/routes/api.quiz.$id.tsx:66-72`
- **Cascade deletes**: Questions/Options cascade on Quiz deletion
- **Shop filtering**: Always filter by `session.shop` for multi-tenancy

### 4. UI Components (Polaris Web Components)
- Use `<s-page>`, `<s-section>`, `<s-stack>`, `<s-button>`, etc. (NOT React Polaris!)
- **Gap values**: Use actual spacing tokens, NOT "tight" - see TypeScript errors in routes
- **Size prop**: NOT supported on `<s-button>` - remove all `size="sm"` props
- **Badge variants**: Use strings like "success", "warning", "default"
- Example: `<s-stack direction="inline" gap="base" align="center">`

### 5. API Routes (Public Endpoints)
- **Pattern**: `app/routes/api.*.tsx` routes are PUBLIC (no auth required)
- **CORS**: Currently uses wildcard `"*"` - needs shop domain restriction (see DEVELOPMENT_ROADMAP.md)
- **Example**: `/api/quiz/:id` fetches quiz for storefront embedding
- Always return `Response.json()` with proper status codes

### 6. Theme App Extension
- **Location**: `extensions/quiz-embed/`
- **Files**: `blocks/quiz.liquid`, `assets/quiz-embed.js`, `assets/quiz-embed.css`
- **Data passing**: Use `data-quiz-id="{{ block.settings.quiz_id }}"` on container div
- **NO React**: Vanilla JavaScript only for storefront performance

## Development Workflows

### Setup & Database
```bash
npm run setup              # Run Prisma migrations + generate client
npm run dev               # Start Shopify CLI dev server (NOT vite!)
npm run deploy            # Deploy to Shopify (updates webhooks too)
```

### Database Changes
1. Edit `prisma/schema.prisma`
2. Run `npx prisma migrate dev --name description_of_change`
3. Prisma client auto-regenerates

### Testing Webhooks
- **CLI triggers**: `admin` object will be `undefined` (expected for CLI testing)
- **Real testing**: Manually trigger events in Shopify admin (e.g., update product)
- **Subscription location**: Define in `shopify.app.toml`, NOT in `afterAuth` hook

## Common Pitfalls & Solutions

### TypeScript Errors in Routes
- **Issue**: `variant`, `size`, `gap="tight"` props not recognized
- **Fix**: Polaris web components have different prop types than React Polaris
- See `app/routes/app.quizzes._index.tsx` for correct patterns

### JSON Parsing Errors
- **Pattern**: Always wrap JSON.parse in try-catch for `productMatching`, `settings`, `conditionalRules`
- **Example**: See `app/routes/api.quiz.$id.tsx:66-72` for safe parsing

### Embedded App Navigation
- **Issue**: Using `<a>` tags or wrong redirect breaks iframe session
- **Fix**: Always use React Router's `<Link>` and `authenticate.admin().redirect()`

### Status Updates
- **Pattern**: Optimistic UI updates with server confirmation
- **Example**: See `app/routes/app.quizzes.$id.edit.tsx:364-378` for status toggle pattern
  - Set local state immediately
  - Submit to server
  - Toast notification on success

## Key Files Reference

### Core Config
- `app/shopify.server.ts` - Shopify app config, auth exports
- `prisma/schema.prisma` - Database schema
- `shopify.app.toml` - App metadata, webhooks, scopes

### Route Patterns
- `app/routes/app.*.tsx` - Admin UI (requires auth)
- `app/routes/api.*.tsx` - Public APIs (no auth)
- `app/routes/webhooks.*.tsx` - Webhook handlers

### Critical TODOs (from DEVELOPMENT_ROADMAP.md)
- AI quiz generation is stub code - needs OpenAI GPT-4o-mini integration (cheapest option)
- Product recommendations are rule-based - needs ML/AI
- Billing is mock - needs Shopify Billing API integration
- CORS wildcard security risk - restrict to shop domains
- JSON.parse throughout codebase needs try-catch wrappers

## Code Documentation Standards

### Comment Tags (Shopify Best Practice)
Use specific comment tags for maintainability:

```typescript
// TODO: Description of what needs to be implemented
// Example: TODO: Add image upload functionality for quiz questions

// BUG: Description of the bug and why it's problematic
// Example: BUG: JSON.parse can throw if settings is malformed - wrap in try-catch

// FIXME: Known issue that needs immediate attention
// Example: FIXME: Race condition when multiple users complete quiz simultaneously

// HACK: Temporary solution that should be refactored
// Example: HACK: Using setTimeout to avoid race condition - needs proper locking

// NOTE: Important context or explanation
// Example: NOTE: Shopify CLI triggers webhooks with undefined admin object - this is expected
```

### Comment Placement Examples
```typescript
// Good - explains WHY, not WHAT
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  
  // Shop filtering required for multi-tenancy - prevents data leaks between stores
  const quizzes = await prisma.quiz.findMany({
    where: { shop: session.shop },
  });
}

// TODO: Replace mock recommendations with GPT-4o-mini API
// Current implementation uses rule-based matching which has ~60% accuracy
async function generateRecommendations(answers: Answer[]) {
  // HACK: Using simple tag matching until AI integration
  return products.filter(p => p.tags.some(tag => answers.includes(tag)));
}

// BUG: No transaction wrapping - analytics update can fail leaving inconsistent state
// FIXME: Wrap in Prisma transaction to ensure atomicity
await prisma.quizResult.create({ data: resultData });
await prisma.quizAnalytics.update({ data: { completions: { increment: 1 } } });
```

### AI Integration Guidelines
- **Provider**: OpenAI GPT-4o-mini (most cost-effective for quiz generation)
- **Use cases**: 
  - Generate quiz questions from product catalog (`api.quiz.generate.tsx`)
  - Enhance product recommendations (`api.quiz.submit.tsx`)
- **Pattern**: Always include error handling and fallback to rule-based logic
- **Cost control**: Limit prompt size (max 100 products, truncate descriptions)

## Billing & Usage Tracking
- **Location**: `app/lib/billing.server.ts`
- **Pattern**: Check usage with `getUsageStats()`, increment with `incrementUsage()`
- **Tiers**: Free (100), Growth (1000), Pro (10000), Enterprise (unlimited)
- **Known bug**: Race conditions on concurrent requests can exceed limits

## Extension Best Practices
- **Quiz embed JS**: Updates in `extensions/quiz-embed/assets/quiz-embed.js` require theme reinstall
- **Schema changes**: Don't use `presets` in block schema (not supported for app blocks)
- **Quiz ID**: Copy button pattern in `app/routes/app.quizzes._index.tsx:108-115` for UX

## When Making Changes
1. Check `DEVELOPMENT_ROADMAP.md` for known issues in that area
2. Use `fetcher.submit()` for form actions, not plain `<form>`
3. Always filter database queries by `session.shop`
4. Test in embedded app context (via `npm run dev`, not standalone)
5. Check for TypeScript errors specific to Polaris web components
6. Add TODO/BUG/FIXME comments for future maintenance
7. Explain WHY in comments, not WHAT (code shows what)
8. use security best practices

## Testing Approach
- **No formal test suite yet** - focus on manual testing in Shopify admin
- **Test checklist**: Quiz creation → Question/option management → Status toggle → Storefront display → Analytics
- **Shopify CLI testing**: Use `shopify webhook trigger` for webhook testing
- **Future**: Add integration tests for billing logic and API endpoints
