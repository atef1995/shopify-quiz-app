import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import OpenAI from "openai";
import { logger } from "../lib/logger.server";

// Initialize OpenAI client
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })
  : null;

/**
 * AI Quiz Generation API Endpoint
 *
 * This endpoint analyzes a merchant's product catalog and generates
 * personalized quiz questions using OpenAI GPT-4o-mini.
 *
 * Features:
 * - Fetches products from Shopify GraphQL API
 * - Analyzes product tags, types, descriptions, and prices
 * - Uses GPT-4o-mini to generate 5-7 relevant quiz questions
 * - Creates question options mapped to product attributes
 * - Supports different quiz styles (fun, professional, detailed)
 * - Falls back to rule-based generation if OpenAI is unavailable
 *
 * Cost: ~$0.01-0.03 per quiz generation with gpt-4o-mini (cheapest model)
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const log = logger.child({ shop: session.shop, module: "quiz-generate" });

  try {
    const formData = await request.formData();
    const quizId = formData.get("quizId") as string;
    const rawStyle = formData.get("style") as string || "professional";
    
    // Validate style is one of allowed values
    const allowedStyles = ["fun", "professional", "detailed"];
    const style = allowedStyles.includes(rawStyle) ? rawStyle : "professional";
    
    // Validate and cap product limit to prevent timeouts and excessive API costs
    const rawLimit = parseInt(formData.get("productLimit") as string) || 50;
    const productLimit = Math.max(10, Math.min(rawLimit, 100)); // Between 10 and 100

    if (!quizId) {
      return Response.json(
        { error: "Quiz ID is required" },
        { status: 400 }
      );
    }

    // Verify quiz ownership
    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId, shop: session.shop },
    });

    if (!quiz) {
      return Response.json(
        { error: "Quiz not found" },
        { status: 404 }
      );
    }

    // Fetch products from Shopify
    const productsResponse = await admin.graphql(
      `#graphql
        query getProducts($first: Int!) {
          products(first: $first) {
            edges {
              node {
                id
                title
                description
                productType
                tags
                vendor
                variants(first: 1) {
                  edges {
                    node {
                      price
                    }
                  }
                }
              }
            }
          }
        }
      `,
      {
        variables: { first: productLimit },
      }
    );

    const productsData: any = await productsResponse.json();
    
    // Check for GraphQL errors before processing data
    if (productsData.errors && Array.isArray(productsData.errors)) {
      log.error("GraphQL errors fetching products", { errors: productsData.errors });
      return Response.json(
        { 
          error: "Failed to fetch products from Shopify", 
          details: productsData.errors[0]?.message || "Unknown GraphQL error"
        },
        { status: 500 }
      );
    }
    
    const products = productsData.data?.products?.edges?.map((edge: any) => edge.node) || [];

    if (products.length === 0) {
      return Response.json(
        { error: "No products found. Please add products to your store first." },
        { status: 400 }
      );
    }

    // Extract unique tags, types, and other attributes
    const productTags = new Set<string>();
    const productTypes = new Set<string>();

    products.forEach((product: any) => {
      product.tags?.forEach((tag: string) => productTags.add(tag));
      if (product.productType) productTypes.add(product.productType);
    });

    // Generate quiz questions based on product data
    // Use AI if available, otherwise fall back to rule-based generation
    let questions;
    
    if (openai) {
      log.info("Generating questions with OpenAI GPT-4o-mini");
      try {
        questions = await generateQuestionsWithAI(
          products,
          Array.from(productTags),
          Array.from(productTypes),
          style,
          quiz.title
        );
        log.info("AI generated questions", { count: questions.length });
      } catch (aiError: unknown) {
        const errorMessage = aiError instanceof Error ? aiError.message : "Unknown error";
        log.error("AI generation failed, falling back to rule-based", { error: errorMessage });
        questions = generateQuestionsFromProducts(
          products,
          Array.from(productTags),
          Array.from(productTypes),
          style
        );
      }
    } else {
      log.warn("OpenAI API key not configured, using rule-based generation");
      questions = generateQuestionsFromProducts(
        products,
        Array.from(productTags),
        Array.from(productTypes),
        style
      );
    }

    // Save generated questions to database
    for (let i = 0; i < questions.length; i++) {
      const questionData = questions[i];

      const createdQuestion = await prisma.question.create({
        data: {
          quizId,
          text: questionData.text,
          type: questionData.type,
          order: i + 1,
        },
      });

      // Create options for the question
      for (let j = 0; j < questionData.options.length; j++) {
        const option = questionData.options[j];

        await prisma.questionOption.create({
          data: {
            questionId: createdQuestion.id,
            text: option.text,
            order: j + 1,
            productMatching: JSON.stringify({
              tags: option.matchingTags,
              types: option.matchingTypes,
            }),
          },
        });
      }
    }

    return Response.json({
      success: true,
      message: `Generated ${questions.length} questions successfully`,
      questionsCount: questions.length,
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    log.error("AI generation error", error);
    return Response.json(
      { error: errorMessage || "Failed to generate quiz" },
      { status: 500 }
    );
  }
};

/**
 * AI-powered quiz question generation using OpenAI GPT-4o-mini
 *
 * This function uses GPT-4o-mini (cheapest model) to generate intelligent,
 * contextual quiz questions based on the merchant's actual product catalog.
 *
 * @param products - Array of Shopify products
 * @param tags - Unique product tags
 * @param types - Unique product types
 * @param style - Quiz style (fun, professional, detailed)
 * @param quizTitle - Title of the quiz for context
 * @returns Array of question objects with options and matching criteria
 */
async function generateQuestionsWithAI(
  products: any[],
  tags: string[],
  types: string[],
  style: string,
  quizTitle: string
) {
  if (!openai) {
    throw new Error("OpenAI client not initialized");
  }

  // Calculate price ranges for budget questions
  const prices = products
    .map(p => parseFloat(p.variants?.edges?.[0]?.node?.price || 0))
    .filter(p => p > 0);
  
  const avgPrice = prices.length > 0 
    ? prices.reduce((a, b) => a + b, 0) / prices.length 
    : 50;
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);

  // Prepare product summary (truncate to save tokens)
  const productSummary = products.slice(0, 20).map(p => ({
    title: p.title,
    type: p.productType,
    tags: p.tags?.slice(0, 5),
    price: p.variants?.edges?.[0]?.node?.price,
  }));

  const systemPrompt = `You are an expert at creating engaging product recommendation quizzes for e-commerce stores. 
Your goal is to create 5-7 questions that help match customers with the perfect products.

Quiz Style: ${style}
- "fun": Use casual, playful language with emojis
- "professional": Use clear, business-appropriate language  
- "detailed": Use comprehensive, informative language

Guidelines:
1. Create questions that genuinely help narrow down product choices
2. Include a budget question with realistic price ranges
3. Ask about use case, preferences, style, and needs
4. Make options specific to the actual products available
5. Each option should map to relevant product tags or types
6. Return valid JSON only, no markdown formatting`;

  const userPrompt = `Create a product quiz titled "${quizTitle}" for a store with these products:

Product Types: ${types.join(", ")}
Common Tags: ${tags.slice(0, 20).join(", ")}
Price Range: $${minPrice.toFixed(2)} - $${maxPrice.toFixed(2)} (avg: $${avgPrice.toFixed(2)})

Sample Products:
${JSON.stringify(productSummary, null, 2)}

Return a JSON object with a "questions" array containing 5-7 questions in this format:
{
  "questions": [
    {
      "text": "Question text here?",
      "type": "multiple_choice",
      "options": [
        {
          "text": "Option text",
          "matchingTags": ["tag1", "tag2"],
          "matchingTypes": ["type1"]
        }
      ]
    }
  ]
}

Requirements:
- Include a budget question with 4 options covering the price range
- Use actual product tags and types from the data provided
- Make questions relevant to the products (e.g., if selling snowboards, ask about skill level)
- Use ${style} style throughout
- Return valid JSON only`;

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 2000,
      response_format: { type: "json_object" },
    });

    const responseText = completion.choices[0]?.message?.content;
    if (!responseText) {
      throw new Error("Empty response from OpenAI");
    }

    // Parse the response - OpenAI might wrap it in an object
    let parsedResponse = JSON.parse(responseText);
    
    // Handle different response formats
    if (parsedResponse.questions) {
      parsedResponse = parsedResponse.questions;
    } else if (!Array.isArray(parsedResponse)) {
      throw new Error("Invalid response format from OpenAI");
    }

    // Validate and sanitize the questions
    const questions = parsedResponse.map((q: any, idx: number) => ({
      text: q.text || `Question ${idx + 1}`,
      type: q.type || "multiple_choice",
      options: (q.options || []).map((opt: any) => ({
        text: opt.text || "Option",
        matchingTags: Array.isArray(opt.matchingTags) 
          ? opt.matchingTags.filter((tag: string) => tags.includes(tag))
          : [],
        matchingTypes: Array.isArray(opt.matchingTypes)
          ? opt.matchingTypes.filter((type: string) => types.includes(type))
          : [],
      })),
    }));

    logger.debug("AI generation stats", {
      model: completion.model,
      tokensUsed: completion.usage?.total_tokens,
      questionsGenerated: questions.length,
    });

    return questions;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("OpenAI API error", error);
    throw new Error(`AI generation failed: ${errorMessage}`);
  }
}

/**
 * Rule-based quiz question generation (fallback)
 *
 * This is used when OpenAI is unavailable or fails.
 * Creates basic questions based on product attributes.
 *
 * @param products - Array of Shopify products
 * @param tags - Unique product tags
 * @param types - Unique product types
 * @param style - Quiz style (fun, professional, detailed)
 */
function generateQuestionsFromProducts(
  products: any[],
  tags: string[],
  types: string[],
  style: string
) {
  const questions: any[] = [];

  // Question 1: Purpose/Use Case
  questions.push({
    text: style === "fun"
      ? "What's your vibe today?"
      : "What are you looking for?",
    type: "multiple_choice",
    options: [
      { text: "Something for everyday use", matchingTags: ["daily", "essential", "basic"], matchingTypes: [] },
      { text: "A special occasion item", matchingTags: ["luxury", "premium", "special"], matchingTypes: [] },
      { text: "A gift for someone", matchingTags: ["gift", "present"], matchingTypes: [] },
      { text: "Something to treat myself", matchingTags: ["indulgent", "premium", "luxury"], matchingTypes: [] },
    ],
  });

  // Question 2: Budget (if products have varying prices)
  const prices = products
    .map(p => parseFloat(p.variants?.edges?.[0]?.node?.price || 0))
    .filter(p => p > 0);

  if (prices.length > 0) {
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;

    questions.push({
      text: "What's your budget?",
      type: "multiple_choice",
      options: [
        { text: `Under $${Math.round(avgPrice * 0.5)}`, matchingTags: ["budget", "affordable"], matchingTypes: [] },
        { text: `$${Math.round(avgPrice * 0.5)} - $${Math.round(avgPrice)}`, matchingTags: [], matchingTypes: [] },
        { text: `$${Math.round(avgPrice)} - $${Math.round(avgPrice * 1.5)}`, matchingTags: ["premium"], matchingTypes: [] },
        { text: `Over $${Math.round(avgPrice * 1.5)}`, matchingTags: ["luxury", "premium", "high-end"], matchingTypes: [] },
      ],
    });
  }

  // Question 3: Product Type (if multiple types exist)
  if (types.length > 1) {
    const typeOptions = types.slice(0, 4).map(type => ({
      text: type,
      matchingTags: [],
      matchingTypes: [type],
    }));

    questions.push({
      text: "Which category interests you most?",
      type: "multiple_choice",
      options: typeOptions,
    });
  }

  // Question 4: Style/Preference (based on common tags)
  const styleKeywords = ["modern", "classic", "vintage", "minimal", "bold", "natural", "organic"];
  const availableStyles = tags.filter(tag =>
    styleKeywords.some(keyword => tag.toLowerCase().includes(keyword))
  );

  if (availableStyles.length >= 2) {
    questions.push({
      text: style === "fun"
        ? "Pick your aesthetic!"
        : "What style appeals to you?",
      type: "multiple_choice",
      options: availableStyles.slice(0, 4).map(styleTag => ({
        text: styleTag.charAt(0).toUpperCase() + styleTag.slice(1),
        matchingTags: [styleTag],
        matchingTypes: [],
      })),
    });
  }

  // Question 5: Features/Benefits
  questions.push({
    text: "What's most important to you?",
    type: "multiple_choice",
    options: [
      { text: "Quality and durability", matchingTags: ["durable", "quality", "premium"], matchingTypes: [] },
      { text: "Eco-friendly and sustainable", matchingTags: ["eco", "sustainable", "organic", "natural"], matchingTypes: [] },
      { text: "Latest trends and styles", matchingTags: ["trending", "new", "modern"], matchingTypes: [] },
      { text: "Best value for money", matchingTags: ["value", "affordable", "budget"], matchingTypes: [] },
    ],
  });

  return questions.slice(0, 7); // Return max 7 questions
}
