# AI Quiz Generation - Implementation Guide

## Overview
This app uses **OpenAI GPT-4o-mini** to automatically generate intelligent product quiz questions based on a merchant's actual product catalog. The AI analyzes products, tags, types, prices, and descriptions to create contextual, relevant questions that help customers find the perfect products.

## Features

### ✅ What's Implemented
1. **OpenAI GPT-4o-mini Integration** - Uses the most cost-efficient model (~$0.15 per 1M tokens)
2. **Intelligent Question Generation** - Analyzes product catalog to create relevant questions
3. **Budget-Aware Questions** - Automatically detects price ranges and creates budget questions
4. **Product Matching** - Maps quiz options to actual product tags and types
5. **Style Support** - Supports "fun", "professional", and "detailed" quiz styles
6. **Fallback System** - Gracefully falls back to rule-based generation if OpenAI fails
7. **Token Optimization** - Limits product data to save costs (first 20 products only)
8. **Error Handling** - Comprehensive error handling with detailed logging

### 🎯 How It Works

#### 1. Data Collection
```typescript
// Fetches up to 50 products from Shopify
const productsResponse = await admin.graphql(`
  query getProducts($first: Int!) {
    products(first: $first) {
      edges {
        node {
          id
          title
          description
          productType
          tags
          variants(first: 1) {
            edges {
              node { price }
            }
          }
        }
      }
    }
  }
`);
```

#### 2. AI Prompt Construction
```typescript
// Analyzes products and creates context
const productSummary = products.slice(0, 20).map(p => ({
  title: p.title,
  type: p.productType,
  tags: p.tags?.slice(0, 5),
  price: p.variants?.edges?.[0]?.node?.price,
}));

// Calculates price statistics
const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
const minPrice = Math.min(...prices);
const maxPrice = Math.max(...prices);
```

#### 3. GPT-4o-mini Generation
```typescript
const completion = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ],
  temperature: 0.7,
  max_tokens: 2000,
  response_format: { type: "json_object" },
});
```

#### 4. Response Validation
```typescript
// Ensures generated questions use valid tags/types
const questions = parsedResponse.map(q => ({
  text: q.text,
  type: q.type,
  options: q.options.map(opt => ({
    text: opt.text,
    matchingTags: opt.matchingTags.filter(tag => tags.includes(tag)),
    matchingTypes: opt.matchingTypes.filter(type => types.includes(type)),
  })),
}));
```

## Setup Instructions

### 1. Get an OpenAI API Key
1. Sign up at [platform.openai.com](https://platform.openai.com)
2. Navigate to **API Keys** section
3. Click **Create new secret key**
4. Copy the key (starts with `sk-`)

### 2. Configure Environment Variables
Create a `.env` file in the project root:
```env
# OpenAI Configuration
OPENAI_API_KEY=sk-your-api-key-here

# Optional: Override default model (defaults to gpt-4o-mini)
OPENAI_MODEL=gpt-4o-mini
```

**Supported Models:**
- `gpt-4o-mini` (recommended) - $0.15/$0.60 per 1M tokens (input/output)
- `gpt-4o` - $2.50/$10.00 per 1M tokens
- `gpt-4-turbo` - $10.00/$30.00 per 1M tokens
- `gpt-3.5-turbo` - $0.50/$1.50 per 1M tokens (less intelligent)

### 3. Restart Development Server
```bash
# Stop current server (Ctrl+C)
npm run dev
```

## Cost Analysis

### Per-Quiz Generation Cost (with gpt-4o-mini)
- **Input tokens**: ~800-1,200 tokens (product data + prompts)
- **Output tokens**: ~400-600 tokens (5-7 questions with options)
- **Total cost**: $0.01 - $0.03 per generation

### Monthly Cost Estimates
| Merchant Activity | Quizzes/Month | Estimated Cost |
|-------------------|---------------|----------------|
| Small merchant    | 10-20         | $0.20 - $0.60  |
| Medium merchant   | 50-100        | $0.50 - $3.00  |
| Large merchant    | 200-500       | $2.00 - $15.00 |

**Note**: Merchants typically generate quizzes once and reuse them, so costs are minimal.

## Usage in Admin UI

### From Quiz Edit Page
1. Navigate to **Quizzes** → Select quiz → **Edit**
2. Click **Generate with AI** button
3. Choose quiz style:
   - **Fun**: Casual, playful language with emojis
   - **Professional**: Clear, business-appropriate language
   - **Detailed**: Comprehensive, informative questions
4. Click **Generate** and wait 5-10 seconds
5. Review and edit generated questions as needed

### API Endpoint
```typescript
POST /api/quiz/generate
Content-Type: multipart/form-data

{
  quizId: "quiz_abc123",
  style: "professional",
  productLimit: 50
}
```

## Fallback Behavior

### When AI is Used
- ✅ OpenAI API key is configured in `.env`
- ✅ API key is valid and has credits
- ✅ Network connection is stable

### When Fallback is Used
- ⚠️ No `OPENAI_API_KEY` in environment variables
- ⚠️ Invalid or expired API key
- ⚠️ OpenAI API is down or rate-limited
- ⚠️ Network errors or timeouts

### Fallback Behavior
```typescript
if (openai) {
  try {
    questions = await generateQuestionsWithAI(...);
    console.log("✅ AI generated questions");
  } catch (aiError) {
    console.error("❌ AI failed, using fallback");
    questions = generateQuestionsFromProducts(...);
  }
} else {
  console.log("⚠️ OpenAI not configured, using fallback");
  questions = generateQuestionsFromProducts(...);
}
```

## Example AI Output

### Input
```json
{
  "quizTitle": "Find Your Perfect Snowboard",
  "productTypes": ["Snowboards", "Boots", "Bindings"],
  "tags": ["beginner", "advanced", "freestyle", "all-mountain"],
  "priceRange": "$199.99 - $899.99"
}
```

### Output (Professional Style)
```json
{
  "questions": [
    {
      "text": "What is your snowboarding skill level?",
      "type": "multiple_choice",
      "options": [
        {
          "text": "Beginner - Just starting out",
          "matchingTags": ["beginner", "easy"],
          "matchingTypes": []
        },
        {
          "text": "Intermediate - Comfortable on blue runs",
          "matchingTags": ["intermediate"],
          "matchingTypes": []
        },
        {
          "text": "Advanced - Tackle any terrain",
          "matchingTags": ["advanced", "expert"],
          "matchingTypes": []
        }
      ]
    },
    {
      "text": "What's your budget for a snowboard?",
      "type": "multiple_choice",
      "options": [
        {
          "text": "Under $300",
          "matchingTags": ["budget", "affordable"],
          "matchingTypes": []
        },
        {
          "text": "$300 - $500",
          "matchingTags": [],
          "matchingTypes": []
        },
        {
          "text": "$500 - $700",
          "matchingTags": ["premium"],
          "matchingTypes": []
        },
        {
          "text": "Over $700",
          "matchingTags": ["premium", "high-end"],
          "matchingTypes": []
        }
      ]
    },
    {
      "text": "What type of riding do you prefer?",
      "type": "multiple_choice",
      "options": [
        {
          "text": "All-mountain versatility",
          "matchingTags": ["all-mountain"],
          "matchingTypes": []
        },
        {
          "text": "Freestyle and park",
          "matchingTags": ["freestyle", "park"],
          "matchingTypes": []
        },
        {
          "text": "Powder and backcountry",
          "matchingTags": ["powder", "backcountry"],
          "matchingTypes": []
        }
      ]
    }
  ]
}
```

## Monitoring and Debugging

### Enable Debug Logging
The implementation includes extensive console logging:

```typescript
console.log("🤖 Generating questions with OpenAI GPT-4o-mini...");
console.log("✅ AI generated 5 questions");
console.log("AI generation stats:", {
  model: completion.model,
  tokensUsed: completion.usage?.total_tokens,
  questionsGenerated: questions.length,
});
```

### Common Issues

**Issue**: "OpenAI API error: Invalid API key"
- **Solution**: Check that your API key is correct in `.env`
- Verify the key starts with `sk-` and has no extra spaces

**Issue**: "AI generation failed: Rate limit exceeded"
- **Solution**: OpenAI free tier has rate limits
- Upgrade to paid tier or wait and retry

**Issue**: "Empty response from OpenAI"
- **Solution**: Check your OpenAI account has credits
- Verify model name is correct in environment variables

**Issue**: Questions don't match products
- **Solution**: AI validates tags/types against actual products
- If mismatch occurs, check product data has proper tags/types

## Best Practices

### 1. Product Data Quality
- ✅ Add descriptive tags to products (e.g., "beginner", "premium", "eco-friendly")
- ✅ Set accurate product types (e.g., "Snowboards", "Boots")
- ✅ Write clear product descriptions
- ❌ Avoid generic tags like "new" or "sale"

### 2. Quiz Style Selection
- **Fun**: For lifestyle, fashion, gift products
- **Professional**: For B2B, technical, enterprise products
- **Detailed**: For complex products needing education

### 3. Cost Optimization
- The app limits to first 20 products for AI analysis (saves tokens)
- Questions are cached in database (no regeneration needed)
- Fallback is free (no API cost)

### 4. Testing
```bash
# Test with OpenAI
OPENAI_API_KEY=sk-test... npm run dev

# Test fallback (no key)
npm run dev
```

## Future Enhancements

### Potential Improvements
- [ ] Cache generated questions to avoid regenerating for same products
- [ ] Add usage limits based on subscription tier (Free: 5 AI generations/month)
- [ ] Support for image-based questions (analyze product images)
- [ ] Multi-language quiz generation
- [ ] A/B testing different quiz styles automatically
- [ ] Integration with GPT-4o for higher quality (at higher cost)

## Security Considerations

### API Key Protection
- ✅ Never commit `.env` file to git (already in `.gitignore`)
- ✅ API key is server-side only (not exposed to client)
- ✅ Use environment variables, not hardcoded strings
- ⚠️ Rotate API keys periodically

### Rate Limiting
```typescript
// TODO: Add rate limiting to prevent abuse
// Limit merchants to X AI generations per day/month based on tier
```

### Input Sanitization
```typescript
// Already implemented: Validates generated tags/types
matchingTags: opt.matchingTags.filter(tag => tags.includes(tag))
```

## Support and Troubleshooting

### Need Help?
1. Check logs in terminal/console
2. Verify `.env` configuration
3. Test with fallback first (remove API key temporarily)
4. Check OpenAI account status and credits

### Reporting Issues
Include in bug reports:
- Error messages from console
- OpenAI model being used
- Number of products in catalog
- Quiz style selected
- Whether fallback works
