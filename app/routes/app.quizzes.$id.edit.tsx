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
    // Generate quiz questions directly (no need for separate API call)
    try {
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

      // Generate questions using rule-based approach (AI integration can be added later)
      const questions = generateBasicQuestions(
        products,
        Array.from(productTags),
        Array.from(productTypes)
      );

      // Save generated questions to database
      for (let i = 0; i < questions.length; i++) {
        const questionData = questions[i];

        const createdQuestion = await prisma.question.create({
          data: {
            quizId,
            text: questionData.text,
            type: questionData.type || "multiple_choice",
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
                tags: option.matchingTags || [],
                types: option.matchingTypes || [],
              }),
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
    fetcher.submit(formData, { method: "POST" });

    // Clear form
    setNewOptionText((prev) => ({ ...prev, [questionId]: "" }));
    setNewOptionImageUrl((prev) => ({ ...prev, [questionId]: "" }));
    setNewOptionTags((prev) => ({ ...prev, [questionId]: "" }));
    setNewOptionTypes((prev) => ({ ...prev, [questionId]: "" }));
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
    if (!query.trim()) {
      setSearchResults((prev) => ({ ...prev, [questionId]: [] }));
      return;
    }

    setSearchLoading((prev) => ({ ...prev, [questionId]: true }));

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
    }
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
    const productIds = selected.join(",");

    // Update the form fields with selected product IDs
    setNewOptionTags((prev) => ({
      ...prev,
      [questionId]:
        prev[questionId] +
        (prev[questionId] ? "," : "") +
        "selected_products:" +
        productIds,
    }));

    setShowProductBrowser((prev) => ({ ...prev, [questionId]: false }));
    shopify.toast.show(`Selected ${selected.length} products for matching`);
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
                                  <s-text variant="body-sm" color="subdued">
                                    Searching...
                                  </s-text>
                                )}

                                {searchResults[question.id] &&
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
                                          (product) => (
                                            <s-box
                                              key={product.id}
                                              padding="tight"
                                              borderWidth="base"
                                              borderRadius="base"
                                              background={
                                                selectedProducts[
                                                  question.id
                                                ]?.includes(product.id)
                                                  ? "success-subdued"
                                                  : "subdued"
                                              }
                                              style={{ cursor: "pointer" }}
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
                                                >
                                                  <s-text variant="heading-sm">
                                                    {product.title}
                                                  </s-text>
                                                  <s-text
                                                    variant="body-sm"
                                                    color="subdued"
                                                  >
                                                    {product.productType} • $
                                                    {product.price.min.toFixed(
                                                      2,
                                                    )}
                                                    {product.tags.length > 0 &&
                                                      ` • Tags: ${product.tags.slice(0, 3).join(", ")}`}
                                                  </s-text>
                                                </s-stack>
                                                {selectedProducts[
                                                  question.id
                                                ]?.includes(product.id) && (
                                                  <s-icon source="checkmark" />
                                                )}
                                              </s-stack>
                                            </s-box>
                                          ),
                                        )}
                                      </s-stack>

                                      {selectedProducts[question.id] &&
                                        selectedProducts[question.id].length >
                                          0 && (
                                          <s-stack
                                            direction="inline"
                                            gap="base"
                                          >
                                            <s-text variant="body-sm">
                                              {
                                                selectedProducts[question.id]
                                                  .length
                                              }{" "}
                                              products selected
                                            </s-text>
                                            <s-button
                                              onClick={() =>
                                                handleAdvancedProductMatching(
                                                  question.id,
                                                )
                                              }
                                              variant="primary"
                                              size="sm"
                                            >
                                              Use Selected Products
                                            </s-button>
                                          </s-stack>
                                        )}
                                    </s-stack>
                                  )}

                                {searchResults[question.id] &&
                                  searchResults[question.id].length === 0 &&
                                  productSearchQuery[question.id] && (
                                    <s-text variant="body-sm" color="subdued">
                                      No products found for "
                                      {productSearchQuery[question.id]}"
                                    </s-text>
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
  );
}

/**
 * Generate basic quiz questions from product catalog
 * This is a simplified version that creates questions based on product attributes
 */
function generateBasicQuestions(
  products: any[],
  tags: string[],
  types: string[]
) {
  const questions: any[] = [];

  // Question 1: Purpose/Use Case
  questions.push({
    text: "What are you looking for?",
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
      text: "What style appeals to you?",
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

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
