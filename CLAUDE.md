# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI-Powered QuizCraft for Shopify - an embedded app that helps merchants create interactive product recommendation quizzes with AI-powered question generation. Built with React Router v7, Prisma ORM, Polaris web components, and theme app extensions.

## Key Commands

### Development
```bash
npm run dev              # Start Shopify CLI dev server with tunnel
npm run setup            # Run Prisma migrations + generate client (required after schema changes)
npm run build            # Build production bundle
npm start                # Start production server (requires build first)
```

### Database
```bash
npm run setup            # Shortcut: npx prisma generate && npx prisma db push
npx prisma migrate dev --name description_of_change    # Create new migration
npx prisma studio        # Open Prisma Studio GUI for database inspection
```

### Testing & Quality
```bash
npm run lint             # Run ESLint
npm run typecheck        # Type check without emitting (react-router typegen runs first)
shopify webhook trigger  # Test webhooks (admin object will be undefined - this is expected)
```

### Deployment
```bash
npm run deploy           # Deploy to Shopify (auto-updates webhooks defined in shopify.app.toml)
```

## Architecture Overview

### React Router v7 (NOT Remix)
This app uses React Router v7 with the Shopify-specific adapter. Key differences from standard React Router:

- **Route files** (`app/routes/*.tsx`) export `loader()`, `action()`, and default component
- **Authentication**: ALWAYS use `await authenticate.admin(request)` from `shopify.server.ts` in loaders/actions
- **Navigation**: Use `<Link>` from `react-router` (NOT `<a>` tags) to maintain embedded app session
- **Redirects**: Use `redirect` returned from `authenticate.admin()`, NOT from `react-router`
- **Forms**: Use `useFetcher()` for non-navigating forms, `useSubmit()` for form submissions

Example route pattern:
```typescript
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  // Always filter by session.shop for multi-tenancy
  const data = await prisma.quiz.findMany({ where: { shop: session.shop } });
  return { data };
};
```

### Route Structure
- `app/routes/app.*.tsx` - Admin UI routes (require authentication)
- `app/routes/api.*.tsx` - Public API routes (NO auth required, used by storefront)
- `app/routes/webhooks.*.tsx` - Webhook handlers
- `app/routes/auth.*.tsx` - OAuth flow handlers

### Database Schema (Prisma)
Main models: `Quiz`, `Question`, `QuestionOption`, `QuizResult`, `QuizAnalytics`, `Subscription`

**CRITICAL**: JSON fields require careful handling:
- `Quiz.settings`
- `Question.conditionalRules`
- `QuestionOption.productMatching`
- Always wrap `JSON.parse()` in try-catch blocks (see `app/routes/api.quiz.$id.tsx:66-72`)

**Multi-tenancy**: Always filter queries by `session.shop` to prevent data leaks between stores.

**Cascade deletes**: Questions and Options cascade delete when Quiz is deleted.

### UI Components (Polaris Web Components)
Uses Polaris web components (`<s-*>` tags), NOT React Polaris components.

Common patterns:
```tsx
<s-page title="Quiz Builder">
  <s-section>
    <s-stack direction="inline" gap="base" align="center">
      <s-button variant="primary">Save</s-button>
    </s-stack>
  </s-section>
</s-page>
```

**Important prop differences from React Polaris**:
- Gap values: Use spacing tokens ("base", "tight"), NOT strings like "tight"
- `size` prop: NOT supported on `<s-button>` - remove all `size="sm"` props
- Badge variants: Use strings like "success", "warning", "default"

### Billing & Usage Tracking
Location: `app/lib/billing.server.ts`

Tier system:
- Free: 100 completions/month ($0)
- Growth: 1,000 completions/month ($29)
- Pro: 10,000 completions/month ($99)
- Enterprise: Unlimited ($299)

Key functions:
- `getOrCreateSubscription(shop)` - Get/create subscription record
- `canCreateCompletion(shop)` - Check if shop can create more completions
- `incrementCompletionCount(shop)` - Atomically increment usage counter
- `upgradeSubscription(shop, tier, admin)` - Create Shopify billing charge

**Known issues**:
- Race conditions on concurrent requests can exceed limits (needs database-level locking)
- Period reset can happen multiple times if concurrent requests (uses `updateMany` with filter as mitigation)

### Theme App Extension
Location: `extensions/quiz-embed/`

**NO React** - Uses vanilla JavaScript for storefront performance.

Files:
- `blocks/quiz.liquid` - Block definition with settings schema
- `assets/quiz-embed.js` - Quiz rendering and submission logic
- `assets/quiz-embed.css` - Styles

Data passing: Use `data-quiz-id="{{ block.settings.quiz_id }}"` on container div.

**Local storage features**:
- Auto-saves progress on each answer
- Restores progress on page load
- Validates progress matches current quiz structure
- 7-day expiration for stale data

### API Routes (Public Endpoints)
`app/routes/api.*.tsx` routes are PUBLIC (no authentication required).

Key endpoints:
- `/api/quiz/:id` - Fetch quiz data for storefront (GET)
- `/api/quiz/submit` - Submit quiz results (POST)
- `/api/quiz/generate` - AI quiz generation (POST, requires auth)
- `/api/products` - Fetch shop products (GET, requires auth)

**CORS**: API routes use shop domain restriction. Always set proper CORS headers:
```typescript
headers.set("Access-Control-Allow-Origin", shopOrigin);
headers.set("Vary", "Origin");
```

## Common Patterns & Solutions

### Authentication Pattern
```typescript
// Admin routes (app.*.tsx)
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  // Use admin for GraphQL, session.shop for database queries
};

// Public API routes (api.*.tsx)
export const action = async ({ request }: ActionFunctionArgs) => {
  // No auth needed - validate input carefully
  const body = await request.json();
  // Always validate quiz.shop matches expected origin
};
```

### GraphQL Query Pattern
```typescript
const response = await admin.graphql(`
  query GetProducts {
    products(first: 10) {
      nodes {
        id
        title
        description
      }
    }
  }
`);

const data = await response.json();
if (data.errors) {
  // Handle GraphQL errors
}
```

### Status Toggle Pattern (Optimistic UI)
```typescript
// In component
const [localStatus, setLocalStatus] = useState(status);
const fetcher = useFetcher();

const toggleStatus = () => {
  const newStatus = localStatus === "active" ? "draft" : "active";
  setLocalStatus(newStatus); // Optimistic update
  fetcher.submit(
    { quizId, status: newStatus },
    { method: "POST" }
  );
};
```

### Safe JSON Parsing
```typescript
let parsedData;
try {
  parsedData = option.productMatching ? JSON.parse(option.productMatching) : {};
} catch (error) {
  console.error("Failed to parse productMatching:", error);
  parsedData = {};
}
```

## Critical TODOs & Known Bugs

### Production Blockers
1. **AI Integration** (`api.quiz.generate.tsx`)
   - Currently uses rule-based generation stub
   - Need OpenAI GPT-4o-mini integration (most cost-effective)
   - Set `OPENAI_API_KEY` in `.env`

2. **Product Recommendations** (`api.quiz.submit.tsx`)
   - Currently uses simple tag matching
   - Need ML/AI for better accuracy
   - Add price range and inventory filtering

3. **Database Transactions** (`api.quiz.submit.tsx`)
   - BUG: Analytics update can fail leaving inconsistent state
   - Wrap quiz result creation + analytics update + billing increment in Prisma transaction

### Security Issues
1. **Rate Limiting** - API routes need rate limiting (10 req/min per IP)
2. **Request Signature Validation** - Verify API requests come from authorized storefronts
3. **JSON Parsing** - Many places need try-catch wrappers (use Zod for validation)

### Race Conditions
1. **Billing** (`billing.server.ts`)
   - Multiple concurrent completions can exceed tier limits
   - Period reset can trigger multiple times
   - Solution: Use database-level locking or Redis distributed locks

## Environment Variables

Required:
- `SHOPIFY_API_KEY` - From Shopify Partner Dashboard
- `SHOPIFY_API_SECRET` - From Shopify Partner Dashboard
- `SHOPIFY_APP_URL` - Your app's public URL
- `SCOPES` - Comma-separated: `write_products,read_products,read_customers,write_customers`
- `DATABASE_URL` - SQLite: `file:./prisma/dev.db` or PostgreSQL connection string

Optional:
- `OPENAI_API_KEY` - For AI quiz generation (falls back to rule-based)
- `OPENAI_MODEL` - Default: `gpt-4o-mini`
- `NODE_ENV` - `development` or `production` (affects billing test mode)

## Testing Approach

No formal test suite yet. Manual testing checklist:
1. Quiz creation → Question/option management → Status toggle
2. Storefront display → Quiz completion → Results page
3. Analytics tracking → Usage limits → Billing flow
4. Webhook testing: `shopify webhook trigger app/uninstalled`

**Note**: CLI-triggered webhooks have `admin` object as `undefined` - this is expected behavior.

## Webhook Configuration

Defined in `shopify.app.toml` (NOT in afterAuth hook):
- `app/uninstalled` - Clean up shop data
- `app/scopes_update` - Handle scope changes
- `customers/data_request` - GDPR data request
- `customers/redact` - GDPR customer deletion
- `shop/redact` - GDPR shop deletion

Changes to webhook config are auto-deployed with `npm run deploy`.

## Deployment Notes

**Database**: Uses SQLite for local dev. For production, switch to PostgreSQL:
1. Update `datasource db` in `prisma/schema.prisma` to `provider = "postgresql"`
2. Set `DATABASE_URL` to PostgreSQL connection string
3. Run `npx prisma migrate deploy`

**Docker**: Use `npm run docker-start` (runs setup + start)

**VPS Deployment**: See `CONTABO_DEPLOYMENT.md` for detailed guide on deploying to VPS with Docker, Nginx, and SSL.

## Code Documentation Standards

Use specific comment tags:
- `// TODO:` - Feature to implement
- `// BUG:` - Known bug with explanation
- `// FIXME:` - Urgent issue needing immediate attention
- `// HACK:` - Temporary solution to refactor
- `// NOTE:` - Important context or explanation

Always explain WHY, not WHAT (code shows what).

Example:
```typescript
// Shop filtering required for multi-tenancy - prevents data leaks between stores
const quizzes = await prisma.quiz.findMany({
  where: { shop: session.shop },
});

// TODO: Replace rule-based matching with GPT-4o-mini API
// Current implementation has ~60% accuracy, AI would be 85%+
async function generateRecommendations(answers: Answer[]) {
  return products.filter(p => matchesTags(p, answers));
}

// BUG: No transaction wrapping - analytics can fail leaving inconsistent state
// FIXME: Wrap in Prisma transaction to ensure atomicity
await prisma.quizResult.create({ data: resultData });
await prisma.quizAnalytics.update({ data: { completions: { increment: 1 } } });
```

## Security Best Practices

1. **Never commit secrets** - Use `.env` (already in `.gitignore`)
2. **Validate all user input** - Especially in public API routes
3. **Sanitize data** - Trim/lowercase emails, validate string lengths
4. **Filter by shop** - Always scope database queries to `session.shop`
5. **CORS restrictions** - Only allow requests from shop domains
6. **Use HTTPS** - Required for Shopify embedded apps
7. **Escape user content** - When rendering user-generated text