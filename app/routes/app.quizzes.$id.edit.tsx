import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  HeadersFunction,
} from "react-router";
import { useLoaderData, useFetcher, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import prisma from "../db.server";
import OpenAI from "openai";

// Initialize OpenAI client
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })
  : null;

/**
 * Loader to fetch quiz details and questions for editing
 */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const quizId = params.id;

  if (!quizId) {
    throw new Response("Quiz ID is required", { status: 400 });
  }

  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId, shop: session.shop },
    include: {
      questions: {
        include: {
          options: {
            orderBy: { order: "asc" },
          },
        },
        orderBy: { order: "asc" },
      },
    },
  });

  if (!quiz) {
    throw new Response("Quiz not found", { status: 404 });
  }

  // Parse settings if they exist
  const settings = quiz.settings ? JSON.parse(quiz.settings) : {};

  return {
    quiz: {
      id: quiz.id,
      title: quiz.title,
      description: quiz.description,
      status: quiz.status,
      settings,
    },
    questions: quiz.questions.map((q) => ({
      id: q.id,
      text: q.text,
      type: q.type,
      order: q.order,
      conditionalRules: q.conditionalRules
        ? JSON.parse(q.conditionalRules)
        : null,
      options: q.options.map((o) => ({
        id: o.id,
        text: o.text,
        imageUrl: o.imageUrl,
        productMatching: o.productMatching
          ? (() => {
              try {
                return JSON.parse(o.productMatching);
              } catch (error) {
                console.error("Error parsing productMatching in loader:", error, "Data:", o.productMatching);
                return null;
              }
            })()
          : null,
        order: o.order,
      })),
    })),
  };
};

/**
 * Action handler for updating quiz and questions
 */
export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const quizId = params.id;
  const formData = await request.formData();
  const action = formData.get("action");

  if (!quizId) {
    throw new Response("Quiz ID is required", { status: 400 });
  }

  // Verify quiz ownership
  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId, shop: session.shop },
  });

  if (!quiz) {
    throw new Response("Quiz not found", { status: 404 });
  }

  if (action === "updateQuiz") {
    const title = formData.get("title") as string;
    const description = formData.get("description") as string;

    await prisma.quiz.update({
      where: { id: quizId },
      data: {
        title,
        description: description || null,
      },
    });

    return { success: true, message: "Quiz updated successfully" };
  }

  if (action === "addQuestion") {
    const questionText = formData.get("questionText") as string;
    const questionType = formData.get("questionType") as string;

    // Get the current max order
    const maxOrder = await prisma.question.aggregate({
      where: { quizId },
      _max: { order: true },
    });

    const newQuestion = await prisma.question.create({
      data: {
        quizId,
        text: questionText,
        type: questionType || "multiple_choice",
        order: (maxOrder._max.order || 0) + 1,
      },
    });

    return {
      success: true,
      message: "Question added",
      questionId: newQuestion.id,
    };
  }

  if (action === "deleteQuestion") {
    const questionId = formData.get("questionId") as string;

    await prisma.question.delete({
      where: { id: questionId },
    });

    return { success: true, message: "Question deleted" };
  }

  if (action === "addOption") {
    const questionId = formData.get("questionId") as string;
    const optionText = formData.get("optionText") as string;
    const imageUrl = formData.get("imageUrl") as string;
    const productTags = formData.get("productTags") as string;
    const productTypes = formData.get("productTypes") as string;
    const productIds = formData.get("productIds") as string;

    if (!optionText.trim()) {
      return { success: false, message: "Option text is required" };
    }

    // Get current max order for this question
    const maxOrder = await prisma.questionOption.aggregate({
      where: { questionId },
      _max: { order: true },
    });

    const productMatching = JSON.stringify({
      tags: productTags
        ? productTags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean)
        : [],
      types: productTypes
        ? productTypes
            .split(",")
            .map((type) => type.trim())
            .filter(Boolean)
        : [],
      productIds: productIds
        ? productIds
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean)
        : [],
    });

    await prisma.questionOption.create({
      data: {
        questionId,
        text: optionText,
        imageUrl: imageUrl || null,
        productMatching,
        order: (maxOrder._max.order || 0) + 1,
      },
    });

    return { success: true, message: "Option added" };
  }

  if (action === "updateOption") {
    const optionId = formData.get("optionId") as string;
    const optionText = formData.get("optionText") as string;
    const imageUrl = formData.get("imageUrl") as string;
    const productTags = formData.get("productTags") as string;
    const productTypes = formData.get("productTypes") as string;

    if (!optionText.trim()) {
      return { success: false, message: "Option text is required" };
    }

    const productMatching = JSON.stringify({
      tags: productTags
        ? productTags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean)
        : [],
      types: productTypes
        ? productTypes
            .split(",")
            .map((type) => type.trim())
            .filter(Boolean)
        : [],
    });

    await prisma.questionOption.update({
      where: { id: optionId },
      data: {
        text: optionText,
        imageUrl: imageUrl || null,
        productMatching,
      },
    });

    return { success: true, message: "Option updated" };
  }

  if (action === "deleteOption") {
    const optionId = formData.get("optionId") as string;

    await prisma.questionOption.delete({
      where: { id: optionId },
    });

    return { success: true, message: "Option deleted" };
  }

  if (action === "updateStatus") {
    const status = formData.get("status") as string;

    await prisma.quiz.update({
      where: { id: quizId },
      data: { status },
    });

    const message = status === "active" 
      ? "Quiz activated! It's now live on your storefront." 
      : "Quiz set to draft. It's no longer visible to customers.";

    return { success: true, message };
  }

  if (action === "generateAI") {
    // Generate quiz questions with AI or fallback to rule-based
    try {
      // Get quiz details for context
      const quiz = await prisma.quiz.findUnique({
        where: { id: quizId, shop: session.shop },
      });

      if (!quiz) {
        return { success: false, message: "Quiz not found" };
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
          variables: { first: 50 },
        }
      );

      const productsData = await productsResponse.json();
      const products = productsData.data?.products?.edges?.map((edge: any) => edge.node) || [];

      if (products.length === 0) {
        return {
          success: false,
          message: "No products found. Please add products to your store first.",
        };
      }

      // Extract unique tags and types
      const productTags = new Set<string>();
      const productTypes = new Set<string>();

      products.forEach((product: any) => {
        product.tags?.forEach((tag: string) => productTags.add(tag));
        if (product.productType) productTypes.add(product.productType);
      });

      // Try AI generation first, fall back to rule-based if unavailable
      let questions;
      let generationMethod = "rule-based";

      if (openai) {
        console.log("🤖 Generating questions with OpenAI GPT-4o-mini...");
        try {
          questions = await generateQuestionsWithAI(
            products,
            Array.from(productTags),
            Array.from(productTypes),
            "professional",
            quiz.title
          );
          generationMethod = "AI";
          console.log(`✅ AI generated ${questions.length} questions`);
        } catch (aiError: any) {
          console.error("❌ AI generation failed, falling back to rule-based:", aiError.message);
          questions = generateBasicQuestions(
            products,
            Array.from(productTags),
            Array.from(productTypes)
          );
        }
      } else {
        console.log("⚠️ OpenAI API key not configured, using rule-based generation");
        questions = generateBasicQuestions(
          products,
          Array.from(productTags),
          Array.from(productTypes)
        );
      }

      // Save generated questions to database
      for (let i = 0; i < questions.length; i++) {
        const questionData = questions[i];

        const createdQuestion = await prisma.question.create({
          data: {
            quizId,
            text: questionData.text,
            type: questionData.type || "multiple_choice",
            order: questionData.order !== undefined ? questionData.order : i + 1,
            // Store conditional rules for smart question flow
            conditionalRules: questionData.conditionalRules 
              ? JSON.stringify(questionData.conditionalRules)
              : null,
          },
        });

        // Create options for the question
        for (let j = 0; j < questionData.options.length; j++) {
          const option = questionData.options[j];

          // Build product matching data with budget metadata
          const productMatching: any = {
            tags: option.matchingTags || [],
            types: option.matchingTypes || [],
          };

          // Add budget constraints for conditional logic
          if (option.budgetMin !== undefined) productMatching.budgetMin = option.budgetMin;
          if (option.budgetMax !== undefined) productMatching.budgetMax = option.budgetMax;
          
          // Add price range for filtering
          if (option.priceRange) productMatching.priceRange = option.priceRange;

          await prisma.questionOption.create({
            data: {
              questionId: createdQuestion.id,
              text: option.text,
              order: j + 1,
              productMatching: JSON.stringify(productMatching),
            },
          });
        }
      }

      return {
        success: true,
        message: `Successfully generated ${questions.length} questions!`,
      };
    } catch (error) {
      console.error("Generate AI error:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Failed to generate questions";
      return {
        success: false,
        message: errorMessage,
      };
    }
  }

  return null;
};

export default function EditQuiz() {
  const { quiz, questions } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const navigate = useNavigate();

  const [title, setTitle] = useState(quiz.title);
  const [description, setDescription] = useState(quiz.description || "");
  const [newQuestionText, setNewQuestionText] = useState("");
  const [newQuestionType, setNewQuestionType] = useState("multiple_choice");

  // Option management state
  const [newOptionText, setNewOptionText] = useState<{ [key: string]: string }>(
    {},
  );
  const [newOptionImageUrl, setNewOptionImageUrl] = useState<{
    [key: string]: string;
  }>({});
  const [newOptionTags, setNewOptionTags] = useState<{ [key: string]: string }>(
    {},
  );
  const [newOptionTypes, setNewOptionTypes] = useState<{
    [key: string]: string;
  }>({});

  // Product matching state
  const [showProductBrowser, setShowProductBrowser] = useState<{
    [key: string]: boolean;
  }>({});
  const [productSearchQuery, setProductSearchQuery] = useState<{
    [key: string]: string;
  }>({});

  interface Product {
    id: string;
    title: string;
    imageUrl?: string;
    imageAlt?: string;
    productType?: string;
    tags: string[];
    price: { min: number; max: number };
    featuredImage?: { url: string };
    priceRangeV2: { minVariantPrice: { amount: string; currencyCode: string } };
  }

  const [searchResults, setSearchResults] = useState<{
    [key: string]: Product[];
  }>({});
  const [selectedProducts, setSelectedProducts] = useState<{
    [key: string]: string[];
  }>({});
  const [searchLoading, setSearchLoading] = useState<{
    [key: string]: boolean;
  }>({});
  const [searchDebounceTimeout, setSearchDebounceTimeout] = useState<{
    [key: string]: NodeJS.Timeout | null;
  }>({});
  
  // Track selected product IDs per question for advanced matching
  const [selectedProductIds, setSelectedProductIds] = useState<{
    [key: string]: string[];
  }>({});

  // Product attributes state
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [availableTypes, setAvailableTypes] = useState<string[]>([]);
  const [attributesLoading, setAttributesLoading] = useState(false);
  const [showAllTags, setShowAllTags] = useState<{ [key: string]: boolean }>(
    {},
  );
  const [showAllTypes, setShowAllTypes] = useState<{ [key: string]: boolean }>(
    {},
  );
  const [currentStatus, setCurrentStatus] = useState(quiz.status);

  // Cleanup debounce timeouts on unmount
  useEffect(() => {
    return () => {
      Object.values(searchDebounceTimeout).forEach((timeout) => {
        if (timeout) clearTimeout(timeout);
      });
    };
  }, [searchDebounceTimeout]);

  // Show toast on action completion
  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast.show(fetcher.data.message);
      // Sync status with server response
      if (fetcher.data.message?.includes("activated")) {
        setCurrentStatus("active");
      } else if (fetcher.data.message?.includes("draft")) {
        setCurrentStatus("draft");
      }
    } else if (fetcher.data?.success === false) {
      shopify.toast.show(fetcher.data.message, { isError: true });
    }
  }, [fetcher.data, shopify]);

  // Load available product tags and types
  useEffect(() => {
    const loadProductAttributes = async () => {
      setAttributesLoading(true);
      try {
        const response = await fetch("/api/product-attributes");
        const data = await response.json();

        if (response.ok) {
          setAvailableTags(data.tags || []);
          setAvailableTypes(data.types || []);
        }
      } catch (error) {
        console.error("Failed to load product attributes:", error);
      } finally {
        setAttributesLoading(false);
      }
    };

    loadProductAttributes();
  }, []);

  const handleUpdateQuiz = () => {
    const formData = new FormData();
    formData.append("action", "updateQuiz");
    formData.append("title", title);
    formData.append("description", description);
    fetcher.submit(formData, { method: "POST" });
  };

  const handleAddQuestion = () => {
    if (!newQuestionText.trim()) {
      shopify.toast.show("Please enter a question", { isError: true });
      return;
    }

    const formData = new FormData();
    formData.append("action", "addQuestion");
    formData.append("questionText", newQuestionText);
    formData.append("questionType", newQuestionType);
    fetcher.submit(formData, { method: "POST" });

    setNewQuestionText("");
  };

  const handleDeleteQuestion = (questionId: string) => {
    if (confirm("Are you sure you want to delete this question?")) {
      const formData = new FormData();
      formData.append("action", "deleteQuestion");
      formData.append("questionId", questionId);
      fetcher.submit(formData, { method: "POST" });
    }
  };

  const handleStatusChange = (status: string) => {
    const formData = new FormData();
    formData.append("action", "updateStatus");
    formData.append("status", status);
    fetcher.submit(formData, { method: "POST" });
  };

  const handleGenerateAI = () => {
    const formData = new FormData();
    formData.append("action", "generateAI");
    fetcher.submit(formData, { method: "POST" });
  };

  const handleAddOption = (questionId: string) => {
    const optionText = newOptionText[questionId];
    const imageUrl = newOptionImageUrl[questionId];
    const tags = newOptionTags[questionId];
    const types = newOptionTypes[questionId];
    const productIds = selectedProductIds[questionId] || [];

    if (!optionText?.trim()) {
      shopify.toast.show("Please enter option text", { isError: true });
      return;
    }

    const formData = new FormData();
    formData.append("action", "addOption");
    formData.append("questionId", questionId);
    formData.append("optionText", optionText);
    formData.append("imageUrl", imageUrl || "");
    formData.append("productTags", tags || "");
    formData.append("productTypes", types || "");
    formData.append("productIds", productIds.join(","));
    fetcher.submit(formData, { method: "POST" });

    // Clear form
    setNewOptionText((prev) => ({ ...prev, [questionId]: "" }));
    setNewOptionImageUrl((prev) => ({ ...prev, [questionId]: "" }));
    setNewOptionTags((prev) => ({ ...prev, [questionId]: "" }));
    setNewOptionTypes((prev) => ({ ...prev, [questionId]: "" }));
    setSelectedProductIds((prev) => ({ ...prev, [questionId]: [] }));
    setSelectedProducts((prev) => ({ ...prev, [questionId]: [] }));
  };

  const handleDeleteOption = (optionId: string) => {
    if (confirm("Are you sure you want to delete this option?")) {
      const formData = new FormData();
      formData.append("action", "deleteOption");
      formData.append("optionId", optionId);
      fetcher.submit(formData, { method: "POST" });
    }
  };

  const searchProducts = async (questionId: string, query: string) => {
    // Clear any existing timeout for this question
    if (searchDebounceTimeout[questionId]) {
      clearTimeout(searchDebounceTimeout[questionId]!);
    }

    if (!query.trim()) {
      setSearchResults((prev) => ({ ...prev, [questionId]: [] }));
      setSearchDebounceTimeout((prev) => ({ ...prev, [questionId]: null }));
      return;
    }

    // Set loading state immediately for UX feedback
    setSearchLoading((prev) => ({ ...prev, [questionId]: true }));

    // Debounce the actual API call
    const timeout = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/products?query=${encodeURIComponent(query)}&limit=20`,
        );
        const data = await response.json();

        if (response.ok) {
          setSearchResults((prev) => ({
            ...prev,
            [questionId]: data.products || [],
          }));
        } else {
          shopify.toast.show(data.error || "Failed to search products", {
            isError: true,
          });
        }
      } catch (error) {
        shopify.toast.show("Failed to search products", { isError: true });
      } finally {
        setSearchLoading((prev) => ({ ...prev, [questionId]: false }));
        setSearchDebounceTimeout((prev) => ({ ...prev, [questionId]: null }));
      }
    }, 300); // 300ms debounce delay

    setSearchDebounceTimeout((prev) => ({ ...prev, [questionId]: timeout }));
  };

  const toggleProductSelection = (questionId: string, productId: string) => {
    setSelectedProducts((prev) => {
      const current = prev[questionId] || [];
      const isSelected = current.includes(productId);

      if (isSelected) {
        return {
          ...prev,
          [questionId]: current.filter((id) => id !== productId),
        };
      } else {
        return { ...prev, [questionId]: [...current, productId] };
      }
    });
  };

  const handleAdvancedProductMatching = (questionId: string) => {
    const selected = selectedProducts[questionId] || [];
    
    // Store the selected product IDs for this question
    setSelectedProductIds((prev) => ({
      ...prev,
      [questionId]: selected,
    }));

    setShowProductBrowser((prev) => ({ ...prev, [questionId]: false }));
    shopify.toast.show(`${selected.length} product(s) selected for this option`);
  };

  const addTagToOption = (questionId: string, tag: string) => {
    setNewOptionTags((prev) => {
      const current = prev[questionId] || "";
      const tags = current
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      if (!tags.includes(tag)) {
        tags.push(tag);
      }

      return { ...prev, [questionId]: tags.join(", ") };
    });
  };

  const addTypeToOption = (questionId: string, type: string) => {
    setNewOptionTypes((prev) => {
      const current = prev[questionId] || "";
      const types = current
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      if (!types.includes(type)) {
        types.push(type);
      }

      return { ...prev, [questionId]: types.join(", ") };
    });
  };

  return (
    <>
      <style>{`
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }
      `}</style>
      <s-page
        heading={quiz.title}
        backAction={{ onAction: () => navigate("/app/quizzes") }}
      >
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={handleUpdateQuiz}
      >
        Save Changes
      </s-button>

      {/* Quiz Status Banner */}
      <s-banner>
        <s-stack direction="inline" gap="base" align="space-between">
          <s-stack direction="inline" gap="base" align="center">
            <s-text>
              <strong>Quiz Status:</strong>
            </s-text>
            <s-badge
              variant={currentStatus === "active" ? "success" : "warning"}
            >
              {currentStatus === "active" ? "🟢 Active" : "🟡 Draft"}
            </s-badge>
            {currentStatus === "active" && (
              <s-text color="subdued">
                This quiz is live and visible to customers on your storefront
              </s-text>
            )}
            {currentStatus === "draft" && (
              <s-text color="subdued">
                This quiz is not visible to customers. Activate it to make it live.
              </s-text>
            )}
          </s-stack>
          <s-button
            variant={currentStatus === "active" ? "secondary" : "primary"}
            onClick={() => {
              const newStatus = currentStatus === "active" ? "draft" : "active";
              setCurrentStatus(newStatus); // Optimistic update
              handleStatusChange(newStatus);
            }}
            disabled={fetcher.state !== "idle"}
          >
            {fetcher.state !== "idle" ? "Updating..." : currentStatus === "active" ? "Set to Draft" : "Activate Quiz"}
          </s-button>
        </s-stack>
      </s-banner>

      {/* Quiz Basic Info */}
      <s-section heading="Quiz Details">
        <s-stack direction="block" gap="base">
          <s-text-field
            label="Quiz Title"
            value={title}
            onChange={(e) => setTitle((e.target as HTMLInputElement).value)}
          />
          <s-text-field
            label="Quiz Description"
            value={description}
            onChange={(e) =>
              setDescription((e.target as HTMLInputElement).value)
            }
            multiline
            rows={3}
          />
        </s-stack>
      </s-section>

      {/* Questions Section */}
      <s-section heading="Questions">
        <s-stack direction="block" gap="base">
          {questions.length > 0 && (
            <>
              {(() => {
                // Check if any options are missing product matching data
                const optionsWithoutMatching = questions.flatMap(q => 
                  q.options.filter(o => {
                    if (!o.productMatching) return true;
                    try {
                      const matching = typeof o.productMatching === 'string' 
                        ? JSON.parse(o.productMatching) 
                        : o.productMatching;
                      return (!matching.tags || matching.tags.length === 0) && 
                             (!matching.types || matching.types.length === 0);
                    } catch {
                      return true;
                    }
                  })
                );
                
                if (optionsWithoutMatching.length > 0) {
                  return (
                    <s-banner variant="warning">
                      <s-stack direction="block" gap="tight">
                        <s-text>
                          ⚠️ {optionsWithoutMatching.length} option(s) don&apos;t have product matching configured!
                        </s-text>
                        <s-text variant="body-sm">
                          To get personalized product recommendations, add <strong>Tags</strong> and <strong>Product Types</strong> 
                          to your quiz options. These should match the tags and types of your Shopify products.
                        </s-text>
                        <s-text variant="body-sm">
                          Example: For &quot;Casual Style&quot; option, add tags like &quot;casual, comfortable&quot; and types like &quot;t-shirt, hoodie&quot;
                        </s-text>
                      </s-stack>
                    </s-banner>
                  );
                }
              })()}
            </>
          )}
          {questions.length === 0 ? (
            <s-banner variant="info">
              No questions yet. Add your first question below or use AI to
              generate questions automatically.
            </s-banner>
          ) : (
            <s-stack direction="block" gap="base">
              {questions.map((question, index) => (
                <s-box
                  key={question.id}
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                  background="surface"
                >
                  <s-stack direction="block" gap="base">
                    <s-stack
                      direction="inline"
                      gap="base"
                      align="space-between"
                    >
                      <s-stack direction="inline" gap="base" align="center">
                        <s-badge>Q{index + 1}</s-badge>
                        <s-text variant="heading-sm">{question.text}</s-text>
                      </s-stack>
                      <s-button
                        variant="tertiary"
                        size="sm"
                        onClick={() => handleDeleteQuestion(question.id)}
                      >
                        Delete
                      </s-button>
                    </s-stack>

                    <s-text variant="body-sm" color="subdued">
                      Type: {question.type.replace("_", " ")}
                    </s-text>

                    {question.options.length > 0 && (
                      <s-stack direction="block" gap="tight">
                        <s-text variant="body-sm">Options:</s-text>
                        <s-stack direction="block" gap="tight">
                          {question.options.map((option) => (
                            <s-box
                              key={option.id}
                              padding="auto"
                              borderWidth="base"
                              borderRadius="base"
                              background="subdued"
                            >
                              <s-stack
                                direction="inline"
                                gap="base"
                                align="space-between"
                              >
                                <s-stack direction="block" gap="tight">
                                  <s-text>{option.text}</s-text>
                                  {option.imageUrl && (
                                    <s-text variant="body-sm" color="subdued">
                                      Image: {option.imageUrl}
                                    </s-text>
                                  )}
                                  {option.productMatching && (
                                    <s-text variant="body-sm" color="subdued">
                                      Matches:{" "}
                                      {(() => {
                                        try {
                                          // Handle both string and object cases
                                          const matching = typeof option.productMatching === 'string' 
                                            ? JSON.parse(option.productMatching)
                                            : option.productMatching;
                                          
                                          const parts = [];
                                          if (matching?.tags?.length)
                                            parts.push(
                                              `Tags: ${matching.tags.join(", ")}`,
                                            );
                                          if (matching?.types?.length)
                                            parts.push(
                                              `Types: ${matching.types.join(", ")}`,
                                            );
                                            
                                          return (
                                            parts.join(" | ") ||
                                            "No matching rules"
                                          );
                                        } catch (error) {
                                          console.error("Error parsing productMatching:", error, "Data:", option.productMatching);
                                          return `Invalid matching data: ${typeof option.productMatching}`;
                                        }
                                      })()}
                                    </s-text>
                                  )}
                                </s-stack>
                                <s-button
                                  variant="tertiary"
                                  size="sm"
                                  onClick={() => handleDeleteOption(option.id)}
                                >
                                  Delete
                                </s-button>
                              </s-stack>
                            </s-box>
                          ))}
                        </s-stack>
                      </s-stack>
                    )}

                    {/* Add Option Form */}
                    <s-box
                      padding="base"
                      borderWidth="base"
                      borderRadius="base"
                      background="subdued"
                    >
                      <s-stack direction="block" gap="base">
                        <s-text variant="heading-sm">Add Option</s-text>
                        <s-text-field
                          label="Option Text"
                          value={newOptionText[question.id] || ""}
                          onChange={(e) =>
                            setNewOptionText((prev) => ({
                              ...prev,
                              [question.id]: (e.target as HTMLInputElement)
                                .value,
                            }))
                          }
                          placeholder="e.g., Casual everyday wear"
                        />
                        {question.type === "image_choice" && (
                          <s-text-field
                            label="Image URL (Optional)"
                            value={newOptionImageUrl[question.id] || ""}
                            onChange={(e) =>
                              setNewOptionImageUrl((prev) => ({
                                ...prev,
                                [question.id]: (e.target as HTMLInputElement)
                                  .value,
                              }))
                            }
                            placeholder="https://example.com/image.jpg"
                          />
                        )}
                        <s-text-field
                          label="Product Tags (comma-separated)"
                          value={newOptionTags[question.id] || ""}
                          onChange={(e) =>
                            setNewOptionTags((prev) => ({
                              ...prev,
                              [question.id]: (e.target as HTMLInputElement)
                                .value,
                            }))
                          }
                          placeholder="casual, everyday, comfortable"
                          helpText={
                            availableTags.length > 0
                              ? `Available tags: ${availableTags.slice(0, 10).join(", ")}${availableTags.length > 10 ? "..." : ""}`
                              : "Products with these tags will be recommended for this option"
                          }
                        />
                        {availableTags.length > 0 && (
                          <s-inline-stack gap="100" wrap>
                            {(showAllTags[question.id]
                              ? availableTags
                              : availableTags.slice(0, 6)
                            ).map((tag) => (
                              <s-button
                                key={tag}
                                size="micro"
                                variant="plain"
                                onClick={() => addTagToOption(question.id, tag)}
                              >
                                + {tag}
                              </s-button>
                            ))}
                            {availableTags.length > 6 && (
                              <s-button
                                size="micro"
                                variant="plain"
                                onClick={() =>
                                  setShowAllTags((prev) => ({
                                    ...prev,
                                    [question.id]: !prev[question.id],
                                  }))
                                }
                              >
                                {showAllTags[question.id]
                                  ? "- Show less"
                                  : `+ Show ${availableTags.length - 6} more`}
                              </s-button>
                            )}
                          </s-inline-stack>
                        )}
                        <s-text-field
                          label="Product Types (comma-separated)"
                          value={newOptionTypes[question.id] || ""}
                          onChange={(e) =>
                            setNewOptionTypes((prev) => ({
                              ...prev,
                              [question.id]: (e.target as HTMLInputElement)
                                .value,
                            }))
                          }
                          placeholder="t-shirt, jeans, sneakers"
                          helpText={
                            availableTypes.length > 0
                              ? `Available types: ${availableTypes.slice(0, 10).join(", ")}${availableTypes.length > 10 ? "..." : ""}`
                              : "Products of these types will be recommended for this option"
                          }
                        />
                        {availableTypes.length > 0 && (
                          <s-inline-stack gap="100" wrap>
                            {(showAllTypes[question.id]
                              ? availableTypes
                              : availableTypes.slice(0, 6)
                            ).map((type) => (
                              <s-button
                                key={type}
                                size="micro"
                                variant="plain"
                                onClick={() =>
                                  addTypeToOption(question.id, type)
                                }
                              >
                                + {type}
                              </s-button>
                            ))}
                            {availableTypes.length > 6 && (
                              <s-button
                                size="micro"
                                variant="plain"
                                onClick={() =>
                                  setShowAllTypes((prev) => ({
                                    ...prev,
                                    [question.id]: !prev[question.id],
                                  }))
                                }
                              >
                                {showAllTypes[question.id]
                                  ? "- Show less"
                                  : `+ Show ${availableTypes.length - 6} more`}
                              </s-button>
                            )}
                          </s-inline-stack>
                        )}

                        {/* Advanced Product Matching */}
                        <s-box
                          padding="base"
                          borderWidth="base"
                          borderRadius="base"
                          background="surface"
                        >
                          <s-stack direction="block" gap="base">
                            <s-text variant="heading-sm">
                              Advanced Product Matching
                            </s-text>
                            <s-text variant="body-sm" color="subdued">
                              Search and select specific products to recommend
                              for this option
                            </s-text>

                            <s-button
                              onClick={() =>
                                setShowProductBrowser((prev) => ({
                                  ...prev,
                                  [question.id]: !prev[question.id],
                                }))
                              }
                              variant="secondary"
                              size="sm"
                            >
                              {showProductBrowser[question.id]
                                ? "Hide"
                                : "Browse"}{" "}
                              Products
                            </s-button>

                            {showProductBrowser[question.id] && (
                              <s-stack direction="block" gap="base">
                                <s-text-field
                                  label="Search Products"
                                  value={productSearchQuery[question.id] || ""}
                                  onChange={(e) => {
                                    const query = (e.target as HTMLInputElement)
                                      .value;
                                    setProductSearchQuery((prev) => ({
                                      ...prev,
                                      [question.id]: query,
                                    }));
                                    if (query.length > 2) {
                                      searchProducts(question.id, query);
                                    }
                                  }}
                                  placeholder="Search by product name, tag, or type..."
                                />

                                {searchLoading[question.id] && (
                                  <s-stack direction="block" gap="base">
                                    <s-text variant="body-sm" color="subdued">
                                      Searching products...
                                    </s-text>
                                    {/* Loading skeletons */}
                                    {[1, 2, 3].map((i) => (
                                      <s-box
                                        key={i}
                                        padding="base"
                                        borderWidth="base"
                                        borderRadius="base"
                                        background="subdued"
                                      >
                                        <s-stack direction="inline" gap="base">
                                          <s-box
                                            style={{
                                              width: "40px",
                                              height: "40px",
                                              backgroundColor: "#e3e3e3",
                                              borderRadius: "4px",
                                              animation: "pulse 1.5s ease-in-out infinite",
                                            }}
                                          />
                                          <s-stack direction="block" gap="tight" style={{ flex: 1 }}>
                                            <s-box
                                              style={{
                                                width: "60%",
                                                height: "16px",
                                                backgroundColor: "#e3e3e3",
                                                borderRadius: "4px",
                                                animation: "pulse 1.5s ease-in-out infinite",
                                              }}
                                            />
                                            <s-box
                                              style={{
                                                width: "40%",
                                                height: "14px",
                                                backgroundColor: "#e3e3e3",
                                                borderRadius: "4px",
                                                animation: "pulse 1.5s ease-in-out infinite",
                                              }}
                                            />
                                          </s-stack>
                                        </s-stack>
                                      </s-box>
                                    ))}
                                  </s-stack>
                                )}

                                {!searchLoading[question.id] &&
                                  searchResults[question.id] &&
                                  searchResults[question.id].length > 0 && (
                                    <s-stack direction="block" gap="tight">
                                      <s-text variant="body-sm">
                                        Select products to recommend:
                                      </s-text>
                                      <s-stack
                                        direction="block"
                                        gap="tight"
                                        style={{
                                          maxHeight: "300px",
                                          overflowY: "auto",
                                        }}
                                      >
                                        {searchResults[question.id].map(
                                          (product) => {
                                            const isSelected = selectedProducts[
                                              question.id
                                            ]?.includes(product.id);
                                            
                                            return (
                                            <s-box
                                              key={product.id}
                                              padding="base"
                                              borderWidth="base"
                                              borderRadius="base"
                                              background={
                                                isSelected
                                                  ? "success-subdued"
                                                  : "surface"
                                              }
                                              style={{ 
                                                cursor: "pointer",
                                                border: isSelected ? "2px solid #008060" : "1px solid #c9cccf",
                                                transition: "all 0.2s ease",
                                                position: "relative"
                                              }}
                                              onClick={() =>
                                                toggleProductSelection(
                                                  question.id,
                                                  product.id,
                                                )
                                              }
                                            >
                                              <s-stack
                                                direction="inline"
                                                gap="base"
                                                align="center"
                                              >
                                                {/* Checkbox indicator */}
                                                <div
                                                  style={{
                                                    width: "20px",
                                                    height: "20px",
                                                    borderRadius: "4px",
                                                    border: isSelected ? "2px solid #008060" : "2px solid #c9cccf",
                                                    backgroundColor: isSelected ? "#008060" : "white",
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    flexShrink: 0,
                                                    transition: "all 0.2s ease"
                                                  }}
                                                >
                                                  {isSelected && (
                                                    <svg
                                                      width="14"
                                                      height="14"
                                                      viewBox="0 0 20 20"
                                                      fill="none"
                                                      xmlns="http://www.w3.org/2000/svg"
                                                    >
                                                      <path
                                                        d="M16 6L8.5 13.5L4 9"
                                                        stroke="white"
                                                        strokeWidth="2.5"
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                      />
                                                    </svg>
                                                  )}
                                                </div>
                                                
                                                {product.imageUrl && (
                                                  <img
                                                    src={product.imageUrl}
                                                    alt={
                                                      product.imageAlt ||
                                                      product.title
                                                    }
                                                    style={{
                                                      width: "40px",
                                                      height: "40px",
                                                      objectFit: "cover",
                                                      borderRadius: "4px",
                                                    }}
                                                  />
                                                )}
                                                <s-stack
                                                  direction="block"
                                                  gap="tight"
                                                  style={{ flex: 1 }}
                                                >
                                                  <s-stack direction="inline" gap="tight" align="center">
                                                    <s-text variant="heading-sm">
                                                      {product.title}
                                                    </s-text>
                                                    {/* Status badge */}
                                                    <s-badge
                                                      tone={
                                                        product.status === "ACTIVE"
                                                          ? "success"
                                                          : product.status === "DRAFT"
                                                          ? "attention"
                                                          : "subdued"
                                                      }
                                                    >
                                                      {product.status === "ACTIVE"
                                                        ? "Active"
                                                        : product.status === "DRAFT"
                                                        ? "Draft"
                                                        : "Archived"}
                                                    </s-badge>
                                                  </s-stack>
                                                  <s-text
                                                    variant="body-sm"
                                                    color="subdued"
                                                  >
                                                    {product.productType} • $
                                                    {product.price.min.toFixed(
                                                      2,
                                                    )}
                                                    {/* Inventory indicator */}
                                                    {product.totalInventory !== undefined && (
                                                      <>
                                                        {" • "}
                                                        <span
                                                          style={{
                                                            color:
                                                              product.totalInventory === 0
                                                                ? "#bf0711"
                                                                : product.totalInventory < 10
                                                                ? "#b98900"
                                                                : "#008060",
                                                          }}
                                                        >
                                                          {product.totalInventory === 0
                                                            ? "Out of stock"
                                                            : product.totalInventory < 10
                                                            ? `Low stock: ${product.totalInventory}`
                                                            : `${product.totalInventory} in stock`}
                                                        </span>
                                                      </>
                                                    )}
                                                    {product.tags.length > 0 &&
                                                      ` • Tags: ${product.tags.slice(0, 3).join(", ")}`}
                                                  </s-text>
                                                </s-stack>
                                              </s-stack>
                                            </s-box>
                                            );
                                          }
                                        )}
                                      </s-stack>

                                      {selectedProducts[question.id] &&
                                        selectedProducts[question.id].length >
                                          0 && (
                                          <s-box
                                            padding="base"
                                            borderWidth="base"
                                            borderRadius="base"
                                            style={{
                                              backgroundColor: "#e0f5ef",
                                              borderColor: "#008060"
                                            }}
                                          >
                                            <s-stack
                                              direction="inline"
                                              gap="base"
                                              align="center"
                                            >
                                              <s-icon source="checkmark-circle" color="success" />
                                              <s-text variant="body-sm" style={{ fontWeight: "500", flex: 1 }}>
                                                {selectedProducts[question.id].length}{" "}
                                                product{selectedProducts[question.id].length > 1 ? "s" : ""} selected
                                              </s-text>
                                              <s-button
                                                onClick={() =>
                                                  handleAdvancedProductMatching(
                                                    question.id,
                                                  )
                                                }
                                                variant="primary"
                                              >
                                                Use Selected Products
                                              </s-button>
                                            </s-stack>
                                          </s-box>
                                        )}
                                    </s-stack>
                                  )}

                                {!searchLoading[question.id] &&
                                  searchResults[question.id] &&
                                  searchResults[question.id].length === 0 &&
                                  productSearchQuery[question.id] && (
                                    <s-box
                                      padding="base"
                                      borderWidth="base"
                                      borderRadius="base"
                                      background="subdued"
                                    >
                                      <s-stack direction="block" gap="tight">
                                        <s-text variant="body-sm" color="subdued">
                                          No products found for &quot;
                                          {productSearchQuery[question.id]}&quot;
                                        </s-text>
                                        <s-text variant="body-sm" color="subdued">
                                          Try searching by:
                                        </s-text>
                                        <s-stack direction="block" gap="tight">
                                          <s-text variant="body-sm" color="subdued">
                                            • Product name (e.g., &quot;Snowboard&quot;)
                                          </s-text>
                                          <s-text variant="body-sm" color="subdued">
                                            • Product type (e.g., &quot;Apparel&quot;, &quot;Sports&quot;)
                                          </s-text>
                                          <s-text variant="body-sm" color="subdued">
                                            • Product tag (e.g., &quot;Winter&quot;, &quot;Sale&quot;)
                                          </s-text>
                                        </s-stack>
                                      </s-stack>
                                    </s-box>
                                  )}
                              </s-stack>
                            )}
                          </s-stack>
                        </s-box>
                        <s-button
                          onClick={() => handleAddOption(question.id)}
                          variant="primary"
                          size="sm"
                        >
                          Add Option
                        </s-button>
                      </s-stack>
                    </s-box>
                  </s-stack>
                </s-box>
              ))}
            </s-stack>
          )}

          {/* Add New Question */}
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <s-stack direction="block" gap="base">
              <s-text variant="heading-sm">Add New Question</s-text>
              <s-text-field
                label="Question Text"
                value={newQuestionText}
                onChange={(e) =>
                  setNewQuestionText((e.target as HTMLInputElement).value)
                }
                placeholder="e.g., What's your style preference?"
              />
              <s-select
                label="Question Type"
                value={newQuestionType}
                onChange={(e) =>
                  setNewQuestionType((e.target as HTMLSelectElement).value)
                }
                options={[
                  { label: "Multiple Choice", value: "multiple_choice" },
                  { label: "Image Choice", value: "image_choice" },
                  { label: "Text Input", value: "text_input" },
                ]}
              />
              <s-button onClick={handleAddQuestion} variant="primary">
                Add Question
              </s-button>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      {/* AI Generation */}
      <s-section heading="AI Tools">
        <s-stack direction="block" gap="base">
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="surface"
          >
            <s-stack direction="block" gap="base">
              <s-stack direction="inline" gap="base" align="center">
                <s-icon source="magic" />
                <s-text variant="heading-sm">Generate Questions with AI</s-text>
              </s-stack>
              <s-text variant="body-sm" color="subdued">
                AI will analyze your product catalog and create personalized
                quiz questions. This feature is coming soon!
              </s-text>
              <s-button
                onClick={handleGenerateAI}
                variant="primary"
                loading={fetcher.state === "submitting"}
              >
                Generate with AI
              </s-button>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      {/* Sidebar - Quiz Status */}
      <s-section slot="aside" heading="Quiz Status">
        <s-stack direction="block" gap="base">
          <s-badge
            variant={
              quiz.status === "active"
                ? "success"
                : quiz.status === "draft"
                  ? "warning"
                  : "default"
            }
          >
            {quiz.status.toUpperCase()}
          </s-badge>

          <s-text variant="body-sm" color="subdued">
            {quiz.status === "active"
              ? "This quiz is live and visible to customers"
              : "This quiz is in draft mode and not visible to customers"}
          </s-text>

          <s-button
            onclick={() => navigate(`/app/quizzes/${quiz.id}/analytics`)}
            variant="secondary"
            fullWidth
          >
            View Analytics
          </s-button>
        </s-stack>
      </s-section>
    </s-page>
    </>
  );
}

/**
 * AI-powered quiz question generation using OpenAI GPT-4o-mini
 * Analyzes actual product prices to create budget-aware questions
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
  const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : 100;

  // Analyze price distribution by product type
  // This ensures we only ask about categories that have products at various price points
  const priceByType: Record<string, number[]> = {};
  products.forEach(p => {
    const type = p.productType;
    const price = parseFloat(p.variants?.edges?.[0]?.node?.price || 0);
    if (type && price > 0) {
      if (!priceByType[type]) priceByType[type] = [];
      priceByType[type].push(price);
    }
  });

  // Calculate price stats per type
  const typeStats = Object.entries(priceByType).map(([type, prices]) => ({
    type,
    count: prices.length,
    minPrice: Math.min(...prices),
    maxPrice: Math.max(...prices),
    avgPrice: prices.reduce((a, b) => a + b, 0) / prices.length,
  }));

  const systemPrompt = `You are an expert at creating engaging product recommendation quizzes for e-commerce stores. 
Your goal is to create 5-7 GENERAL questions that work for ALL product categories.

Quiz Style: ${style}
- "fun": Use casual, playful language with emojis
- "professional": Use clear, business-appropriate language  
- "detailed": Use comprehensive, informative language

CRITICAL RULES:
1. DO NOT create category-specific questions (e.g., "What type of snowboard?")
2. ALL questions must be GENERAL and work for ANY product type
3. Ask about: budget, use case, experience level, style preferences, features, occasion
4. Include ONE product category question with ALL available types as options
5. Each option MUST have matchingTags or matchingTypes arrays filled with relevant values
6. Ensure every question text is unique and general (not tied to one category)
7. Return valid JSON only, no markdown formatting

Good examples:
- "What's your budget?"
- "Which category interests you?" (with all types as options)
- "What's your experience level?" (beginner/intermediate/advanced)
- "What's your preferred style?" (casual/professional/sporty/etc)
- "What will you use this for?" (daily use/special occasions/gifts)

Bad examples (TOO SPECIFIC):
- "What type of snowboard?" ❌
- "What snowboard features?" ❌
- "What snowboard brand?" ❌`;

  const userPrompt = `Create a product quiz titled "${quizTitle}" for a store with these products:

Product Types Available: ${types.join(", ")}
Common Tags: ${tags.slice(0, 20).join(", ")}
Overall Price Range: $${minPrice.toFixed(2)} - $${maxPrice.toFixed(2)} (avg: $${avgPrice.toFixed(2)})

Price by Category:
${typeStats.map(s => `- ${s.type}: $${s.minPrice.toFixed(2)}-$${s.maxPrice.toFixed(2)} (${s.count} items)`).join('\n')}

REQUIREMENTS:
1. Start with a BUDGET question that has 4 price range options
2. Include ONE category selection question with ALL product types as options: ${types.join(", ")}
3. Add 3-5 GENERAL questions about: experience level, style, use case, occasion, features
4. DO NOT ask category-specific questions (no "what type of snowboard", "snowboard features", etc)
5. ALL questions must work for ANY category the user might choose

For the budget question, use this structure:
- Divide the price range into 4 brackets based on the overall min/max
- For EACH budget option, fill matchingTypes with ONLY categories that have products in that price range
- Example: If Snowboards cost $600+, DO NOT include "Snowboards" in the "$0-$100" option's matchingTypes

For the category question:
- Include ALL product types as separate options
- Each option should have matchingTypes: ["CategoryName"]

For other questions (experience, style, use case):
- Use matchingTags based on common tags available
- These should be applicable regardless of which category user picks

Return a JSON object with a "questions" array containing 5-7 questions in this format:
{
  "questions": [
    {
      "text": "What's your budget?",
      "type": "multiple_choice",
      "order": 0,
      "conditionalRules": null,
      "options": [
        {
          "text": "$0-$100",
          "matchingTags": ["budget", "affordable"],
          "matchingTypes": ["Accessories", "T-Shirts"],
          "budgetMax": 100
        },
        {
          "text": "$500+",
          "matchingTags": ["premium"],
          "matchingTypes": ["Snowboards", "Skis"],
          "budgetMin": 500
        }
      ]
    },
    {
      "text": "Which category interests you?",
      "type": "multiple_choice", 
      "order": 1,
      "conditionalRules": null,
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

IMPORTANT: Every option MUST have either matchingTags or matchingTypes with actual values from the product data.
Use the tags and types provided above. For example:
- If you see "Snowboards" in types, use it: "matchingTypes": ["Snowboards"]
- If you see "beginner" in tags, use it: "matchingTags": ["beginner"]

Requirements:
- Include a budget question with 4 options covering the price range
- Use actual product tags and types from the data provided
- Make questions relevant to the products
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

    // Parse the response
    let parsedResponse = JSON.parse(responseText);
    
    // Handle different response formats
    if (parsedResponse.questions) {
      parsedResponse = parsedResponse.questions;
    } else if (!Array.isArray(parsedResponse)) {
      throw new Error("Invalid response format from OpenAI");
    }

    // Validate and sanitize the questions (initial pass)
    const rawQuestions = parsedResponse.map((q: any, idx: number) => ({
      text: (q.text || `Question ${idx + 1}`).trim(),
      type: q.type || "multiple_choice",
      order: typeof q.order === 'number' ? q.order : idx,
      conditionalRules: q.conditionalRules || null,
      options: (q.options || []).map((opt: any) => ({
        text: (opt.text || "Option").trim(),
        matchingTags: Array.isArray(opt.matchingTags)
          ? opt.matchingTags.filter((tag: string) => tags.includes(tag))
          : [],
        matchingTypes: Array.isArray(opt.matchingTypes)
          ? opt.matchingTypes.filter((type: string) => types.includes(type))
          : [],
        // Preserve budget metadata for conditional logic
        budgetMin: opt.budgetMin,
        budgetMax: opt.budgetMax,
      })),
    }));

    // Deduplicate questions by normalized text and merge options when duplicates occur
    const questionMap = new Map<string, any>();

    for (const q of rawQuestions) {
      const key = (q.text || '').toLowerCase().replace(/\s+/g, ' ').trim();

      // normalize options and dedupe them by text
      const normalizedOpts = (q.options || []).map((o: any) => ({
        text: (o.text || '').trim(),
        matchingTags: Array.isArray(o.matchingTags) ? o.matchingTags : [],
        matchingTypes: Array.isArray(o.matchingTypes) ? o.matchingTypes : [],
        budgetMin: o.budgetMin,
        budgetMax: o.budgetMax,
      }));

      if (!questionMap.has(key)) {
        const optMap = new Map<string, any>();
        for (const o of normalizedOpts) {
          const ok = (o.text || '').toLowerCase();
          if (!optMap.has(ok)) {
            optMap.set(ok, o);
          } else {
            const ex = optMap.get(ok);
            ex.matchingTags = Array.from(new Set([...(ex.matchingTags || []), ...(o.matchingTags || [])]));
            ex.matchingTypes = Array.from(new Set([...(ex.matchingTypes || []), ...(o.matchingTypes || [])]));
            ex.budgetMin = ex.budgetMin ?? o.budgetMin;
            ex.budgetMax = ex.budgetMax ?? o.budgetMax;
          }
        }

        questionMap.set(key, {
          ...q,
          text: q.text,
          options: Array.from(optMap.values()),
        });
      } else {
        // merge options into existing question
        const existing = questionMap.get(key);
        const existingOptMap = new Map((existing.options || []).map((o: any) => [ (o.text||'').toLowerCase(), o ]));
        for (const o of normalizedOpts) {
          const ok = (o.text || '').toLowerCase();
          if (!existingOptMap.has(ok)) {
            existing.options.push(o);
            existingOptMap.set(ok, o);
          } else {
            const ex = existingOptMap.get(ok);
            ex.matchingTags = Array.from(new Set([...(ex.matchingTags || []), ...(o.matchingTags || [])]));
            ex.matchingTypes = Array.from(new Set([...(ex.matchingTypes || []), ...(o.matchingTypes || [])]));
            ex.budgetMin = ex.budgetMin ?? o.budgetMin;
            ex.budgetMax = ex.budgetMax ?? o.budgetMax;
          }
        }
      }
    }

    let finalQuestions = Array.from(questionMap.values()).sort((a, b) => (a.order || 0) - (b.order || 0));

    // If deduplication reduced the count below 5, supplement with basic generated questions
    if (finalQuestions.length < 5) {
      const supplement = generateBasicQuestions(products, tags, types);
      for (const s of supplement) {
        const sk = (s.text || '').toLowerCase().replace(/\s+/g, ' ').trim();
        if (!questionMap.has(sk)) {
          finalQuestions.push(s);
          questionMap.set(sk, s);
        }
        if (finalQuestions.length >= 5) break;
      }
    }

    console.log("AI generation stats:", {
      model: completion.model,
      tokensUsed: completion.usage?.total_tokens,
      questionsGenerated: finalQuestions.length,
    });

    return finalQuestions;
  } catch (error: any) {
    console.error("OpenAI API error:", error);
    throw new Error(`AI generation failed: ${error.message}`);
  }
}

/**
 * Generate basic quiz questions from product catalog
 * Budget-aware fallback - analyzes price distribution by product type
 */
function generateBasicQuestions(
  products: any[],
  tags: string[],
  types: string[]
) {
  const questions: any[] = [];

  // Analyze price distribution by product type for smart budget questions
  const priceByType: Record<string, number[]> = {};
  products.forEach(p => {
    const type = p.productType;
    const price = parseFloat(p.variants?.edges?.[0]?.node?.price || 0);
    if (type && price > 0) {
      if (!priceByType[type]) priceByType[type] = [];
      priceByType[type].push(price);
    }
  });

  // Question 1: Purpose/Use Case
  questions.push({
    text: "What are you looking for?",
    type: "multiple_choice",
    order: 0,
    conditionalRules: null,
    options: [
      { text: "Something for everyday use", matchingTags: ["daily", "essential", "basic"], matchingTypes: [] },
      { text: "A special occasion item", matchingTags: ["luxury", "premium", "special"], matchingTypes: [] },
      { text: "A gift for someone", matchingTags: ["gift", "present"], matchingTypes: [] },
      { text: "Something to treat myself", matchingTags: ["indulgent", "premium", "luxury"], matchingTypes: [] },
    ],
  });

  // Question 2: Budget (FIRST filter - most important for conditional logic)
  const prices = products
    .map(p => parseFloat(p.variants?.edges?.[0]?.node?.price || 0))
    .filter(p => p > 0);

  if (prices.length > 0) {
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    const budgetRanges = [
      { max: avgPrice * 0.5, label: `Under $${Math.round(avgPrice * 0.5)}`, tags: ["budget", "affordable"] },
      { min: avgPrice * 0.5, max: avgPrice, label: `$${Math.round(avgPrice * 0.5)} - $${Math.round(avgPrice)}`, tags: [] },
      { min: avgPrice, max: avgPrice * 1.5, label: `$${Math.round(avgPrice)} - $${Math.round(avgPrice * 1.5)}`, tags: ["premium"] },
      { min: avgPrice * 1.5, label: `Over $${Math.round(avgPrice * 1.5)}`, tags: ["luxury", "premium", "high-end"] },
    ];

    // For each budget range, find product types that actually exist at that price
    const budgetOptions = budgetRanges.map(range => {
      const affordableTypes = Object.entries(priceByType)
        .filter(([, prices]) => {
          const minPrice = Math.min(...prices);
          const maxPrice = Math.max(...prices);
          
          // Check if this type has products in this price range
          if (range.max && !range.min) return minPrice <= range.max;
          if (range.min && !range.max) return maxPrice >= range.min;
          if (range.min && range.max) return !(maxPrice < range.min || minPrice > range.max);
          return true;
        })
        .map(([type]) => type);

      return {
        text: range.label,
        matchingTags: range.tags,
        matchingTypes: affordableTypes.slice(0, 3), // Limit to top 3 types per budget
        budgetMin: range.min,
        budgetMax: range.max,
      };
    });

    questions.push({
      text: "What's your budget?",
      type: "multiple_choice",
      order: 1,
      conditionalRules: null, // Budget question has no conditions (it's first)
      options: budgetOptions,
    });
  }

  // Question 3: Product Type (budget-aware using conditional logic)
  if (types.length > 1) {
    // Create budget-aware type options
    const typeOptions = types.slice(0, 6).map(type => {
      const typePrices = priceByType[type] || [];
      const minTypePrice = typePrices.length > 0 ? Math.min(...typePrices) : 0;
      const maxTypePrice = typePrices.length > 0 ? Math.max(...typePrices) : 0;

      return {
        text: type,
        matchingTags: [],
        matchingTypes: [type],
        // Add price metadata for conditional logic
        priceRange: { min: minTypePrice, max: maxTypePrice },
      };
    });

    questions.push({
      text: "Which category interests you most?",
      type: "multiple_choice",
      order: 2,
      // Note: Actual filtering happens client-side based on budget answer
      conditionalRules: { filterByBudget: true },
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
      text: "What style appeals to you?",
      type: "multiple_choice",
      order: 3,
      conditionalRules: null,
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
    order: 4,
    conditionalRules: null,
    options: [
      { text: "Quality and durability", matchingTags: ["durable", "quality", "premium"], matchingTypes: [] },
      { text: "Eco-friendly and sustainable", matchingTags: ["eco", "sustainable", "organic", "natural"], matchingTypes: [] },
      { text: "Latest trends and styles", matchingTags: ["trending", "new", "modern"], matchingTypes: [] },
      { text: "Best value for money", matchingTags: ["value", "affordable", "budget"], matchingTypes: [] },
    ],
  });

  return questions.slice(0, 7); // Return max 7 questions
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
