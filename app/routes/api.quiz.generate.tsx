import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

/**
 * AI Quiz Generation API Endpoint
 *
 * This endpoint analyzes a merchant's product catalog and generates
 * personalized quiz questions using AI (OpenAI/Claude).
 *
 * Features:
 * - Fetches products from Shopify GraphQL API
 * - Analyzes product tags, types, and descriptions
 * - Generates 5-7 relevant quiz questions
 * - Creates question options mapped to product tags
 * - Supports different quiz styles (fun, professional, detailed)
 *
 * TODO: CRITICAL - Integrate real AI API (OpenAI GPT-4 or Claude)
 * TODO: Add caching to avoid regenerating same questions for same products
 * TODO: Add generation limits based on subscription tier
 * TODO: Allow regeneration with different styles without deleting existing questions
 * BUG: Currently using rule-based generation instead of actual AI
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  try {
    const formData = await request.formData();
    const quizId = formData.get("quizId") as string;
    const style = formData.get("style") as string || "professional";
    // TODO: Validate style is one of: fun, professional, detailed
    const productLimit = parseInt(formData.get("productLimit") as string) || 50;
    // BUG: No validation on productLimit - could request 10000+ products and cause timeout
    // Add max limit validation: productLimit = Math.min(productLimit, 100)

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

    const productsData = await productsResponse.json();
    const products = productsData.data?.products?.edges?.map((edge: any) => edge.node) || [];

    // TODO: Handle GraphQL errors from productsResponse
    // BUG: Not checking for GraphQL errors - productsData.errors could exist

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
    // NOTE: For MVP, using rule-based generation.
    // TODO: Integrate OpenAI/Claude API for more intelligent generation
    const questions = generateQuestionsFromProducts(
      products,
      Array.from(productTags),
      Array.from(productTypes),
      style
    );

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

  } catch (error: any) {
    console.error("AI generation error:", error);
    return Response.json(
      { error: error.message || "Failed to generate quiz" },
      { status: 500 }
    );
  }
};

/**
 * Rule-based quiz question generation
 *
 * This is a simplified version for MVP. In production, this would
 * use OpenAI/Claude API for more intelligent question generation.
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
