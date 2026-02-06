import { useState, useEffect } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import prisma from "../db.server";
import { getUsageStats, getQuizUsageStats } from "../lib/billing.server";

/**
 * Action handler for quick status toggle and quiz deletion
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("action") as string;
  const quizId = formData.get("quizId") as string;

  if (actionType === "delete") {
    // Delete quiz and all related data (cascade deletes questions, options, results, analytics)
    await prisma.quiz.delete({
      where: { id: quizId, shop: session.shop },
    });

    return { success: true, message: "Quiz deleted successfully!" };
  }

  if (actionType === "bulkDelete") {
    // Delete multiple quizzes at once
    const quizIds = formData.get("quizIds") as string;
    const idsArray = quizIds.split(",").filter(id => id.trim());

    // Delete all selected quizzes
    await prisma.quiz.deleteMany({
      where: {
        id: { in: idsArray },
        shop: session.shop, // Security: only delete quizzes owned by this shop
      },
    });

    const count = idsArray.length;
    return { success: true, message: `${count} quiz${count > 1 ? 'es' : ''} deleted successfully!` };
  }

  if (actionType === "toggleStatus") {
    const newStatus = formData.get("status") as string;

    await prisma.quiz.update({
      where: { id: quizId, shop: session.shop },
      data: { status: newStatus },
    });

    const message =
      newStatus === "active"
        ? "Quiz activated successfully!"
        : "Quiz set to draft.";

    return { success: true, message };
  }

  return { success: false, message: "Invalid action" };
};

/**
 * Loader function to fetch all quizzes for the current shop
 * Includes basic analytics data for each quiz and usage stats
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // Get usage stats for billing banner (completions)
  const usageStats = await getUsageStats(session.shop);

  // Get quiz count usage stats
  const quizUsage = await getQuizUsageStats(session.shop);

  const quizzes = await prisma.quiz.findMany({
    where: {
      shop: session.shop,
    },
    include: {
      analytics: true,
      questions: {
        select: {
          id: true,
        },
      },
      results: {
        select: {
          id: true,
        },
      },
    },
    orderBy: {
      updatedAt: "desc",
    },
  });

  // Calculate completion count for each quiz
  const quizzesWithStats = quizzes.map((quiz) => ({
    id: quiz.id,
    title: quiz.title,
    description: quiz.description,
    status: quiz.status,
    questionCount: quiz.questions.length,
    completions: quiz.results.length,
    views: quiz.analytics?.totalViews || 0,
    completionRate:
      quiz.analytics && quiz.analytics.totalViews > 0
        ? Math.round(
            (quiz.analytics.totalCompletions / quiz.analytics.totalViews) * 100,
          )
        : 0,
    revenue: quiz.analytics?.totalRevenue || 0,
    createdAt: quiz.createdAt.toISOString(),
    updatedAt: quiz.updatedAt.toISOString(),
  }));

  return {
    quizzes: quizzesWithStats,
    usage: usageStats,
    quizUsage,
  };
};
export default function QuizzesIndex() {
  const { quizzes, usage, quizUsage } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"title" | "questions" | "created" | "status">("title");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [selectedQuizzes, setSelectedQuizzes] = useState<Set<string>>(new Set());
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    quizId: string;
    quizTitle: string;
  }>({
    isOpen: false,
    quizId: "",
    quizTitle: "",
  });
  const [bulkDeleteModal, setBulkDeleteModal] = useState<{
    isOpen: boolean;
    count: number;
  }>({
    isOpen: false,
    count: 0,
  });

  // Show toast notifications when fetcher completes
  useEffect(() => {
    if (fetcher.data && fetcher.state === "idle") {
      if (fetcher.data.success) {
        shopify.toast.show(fetcher.data.message);
      } else {
        shopify.toast.show(fetcher.data.message || "Action failed", {
          isError: true,
        });
      }
    }
  }, [fetcher.data, fetcher.state, shopify]);

  // Completion usage
  const isNearLimit = usage.percentUsed >= 80;
  const isOverLimit = usage.percentUsed >= 100;

  // Quiz count usage
  const isNearQuizLimit = quizUsage.percentUsed >= 80;
  const isAtQuizLimit =
    !quizUsage.isUnlimited && quizUsage.currentCount >= quizUsage.limit;

  // Filter and sort quizzes
  const filteredAndSortedQuizzes = quizzes
    .filter((quiz) =>
      quiz.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      quiz.description?.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case "title":
          comparison = a.title.localeCompare(b.title);
          break;
        case "questions":
          comparison = a.questionCount - b.questionCount;
          break;
        case "created":
          comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        case "status":
          comparison = a.status.localeCompare(b.status);
          break;
      }
      return sortOrder === "asc" ? comparison : -comparison;
    });

  const copyQuizId = async (quizId: string) => {
    try {
      await navigator.clipboard.writeText(quizId);
      setCopiedId(quizId);
      setTimeout(() => setCopiedId(null), 3000);

      // Show helpful toast with instructions
      shopify.toast.show(
        "Quiz ID copied! Paste it into the Product Quiz block settings in your theme editor (Customize → Add Block → Product Quiz).",
        { duration: 6000 },
      );
    } catch (err) {
      console.error("Failed to copy:", err);
      shopify.toast.show("Failed to copy Quiz ID", { isError: true });
    }
  };

  // TODO: Re-enable when status toggle buttons are added back to UI
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const toggleQuizStatus = (quizId: string, currentStatus: string) => {
    const newStatus = currentStatus === "active" ? "draft" : "active";
    const formData = new FormData();
    formData.append("action", "toggleStatus");
    formData.append("quizId", quizId);
    formData.append("status", newStatus);
    fetcher.submit(formData, { method: "POST" });
  };

  const handleDeleteQuiz = (quizId: string, quizTitle: string) => {
    setConfirmModal({
      isOpen: true,
      quizId,
      quizTitle,
    });
  };

  const confirmDelete = () => {
    const formData = new FormData();
    formData.append("action", "delete");
    formData.append("quizId", confirmModal.quizId);
    fetcher.submit(formData, { method: "POST" });
    setConfirmModal({ isOpen: false, quizId: "", quizTitle: "" });
  };

  const handleBulkDelete = () => {
    if (selectedQuizzes.size === 0) return;
    
    setBulkDeleteModal({
      isOpen: true,
      count: selectedQuizzes.size,
    });
  };

  const confirmBulkDelete = () => {
    const formData = new FormData();
    formData.append("action", "bulkDelete");
    formData.append("quizIds", Array.from(selectedQuizzes).join(","));
    fetcher.submit(formData, { method: "POST" });
    setBulkDeleteModal({ isOpen: false, count: 0 });
    setSelectedQuizzes(new Set()); // Clear selection after deletion
  };

  const toggleQuizSelection = (quizId: string) => {
    const newSelection = new Set(selectedQuizzes);
    if (newSelection.has(quizId)) {
      newSelection.delete(quizId);
    } else {
      newSelection.add(quizId);
    }
    setSelectedQuizzes(newSelection);
  };

  const toggleAllQuizzes = () => {
    if (selectedQuizzes.size === filteredAndSortedQuizzes.length) {
      setSelectedQuizzes(new Set());
    } else {
      setSelectedQuizzes(new Set(filteredAndSortedQuizzes.map(q => q.id)));
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffInDays === 0) return "Today";
    if (diffInDays === 1) return "Yesterday";
    if (diffInDays < 7) return `${diffInDays} days ago`;
    if (diffInDays < 30) return `${Math.floor(diffInDays / 7)} weeks ago`;
    return date.toLocaleDateString();
  };
  return (
    <s-page heading="QuizCraft" max-width="full">
      {/* Primary Action - Create Quiz */}

      {/* Quiz Count Usage Banner */}
      {isAtQuizLimit && (
        <s-section>
          <s-banner variant="critical">
            <s-stack direction="inline" gap="base" align="center">
              <s-text variant="body-sm">
                You&apos;ve reached your limit of {quizUsage.limit} quizzes on the{" "}
                {quizUsage.tierName} plan.
              </s-text>
              <s-button
                variant="primary"
                href="/app/billing"
              >
                Upgrade to Create More
              </s-button>
            </s-stack>
          </s-banner>
        </s-section>
      )}

      {isNearQuizLimit && !isAtQuizLimit && (
        <s-section>
          <s-banner variant="warning">
            <s-text variant="body-sm">
              You&apos;ve used {quizUsage.currentCount} of {quizUsage.limit} quizzes
              ({quizUsage.percentUsed}%).{" "}
              <s-link href="/app/billing">
                Upgrade your plan
              </s-link>{" "}
              to create more quizzes.
            </s-text>
          </s-banner>
        </s-section>
      )}

      {/* Completion Usage Banner */}
      {isOverLimit && (
        <s-section>
          <s-banner variant="critical">
            <s-text variant="body-sm">
              You&apos;ve reached your monthly limit of {usage.limit} completions.{" "}
              <s-link href="/app/billing">
                Upgrade your plan
              </s-link>{" "}
              to continue collecting quiz responses.
            </s-text>
          </s-banner>
        </s-section>
      )}

      {isNearLimit && !isOverLimit && (
        <s-section>
          <s-banner variant="warning">
            <s-text variant="body-sm">
              You&apos;ve used {usage.currentUsage} of {usage.limit} monthly
              completions ({usage.percentUsed}%).{" "}
              <s-link href="/app/billing">
                View billing
              </s-link>{" "}
              to upgrade before reaching your limit.
            </s-text>
          </s-banner>
        </s-section>
      )}

      {quizzes.length === 0 ? (
        <s-section>
          <s-empty-state
            heading="Create your first quiz"
            message="Guide customers to their perfect products with interactive quizzes. Boost conversions and collect valuable customer insights."
          >
            <s-stack direction="block" gap="base" align="center">
              <s-button
                href="/app/quizzes/new"
                variant="primary"
                size="large"
              >
                Create Your First Quiz
              </s-button>

              {/* Benefits Section */}
              <s-box padding="large" borderRadius="base" border="base" background="subdued">
                <s-stack direction="block" gap="base">
                  <s-text variant="heading-md" alignment="center">
                    Why Use Product Quizzes?
                  </s-text>
                  <s-stack direction="inline" gap="large">
                    <s-stack direction="block" gap="tight" align="center">
                      <s-text variant="heading-sm">Increase Sales</s-text>
                      <s-text
                        variant="body-sm"
                        color="subdued"
                        alignment="center"
                      >
                        Personalized recommendations boost conversion rates by
                        up to 40%
                      </s-text>
                    </s-stack>
                    <s-stack direction="block" gap="tight" align="center">
                      <s-text variant="heading-sm">Better Targeting</s-text>
                      <s-text
                        variant="body-sm"
                        color="subdued"
                        alignment="center"
                      >
                        Understand customer preferences and optimize your
                        product catalog
                      </s-text>
                    </s-stack>
                    <s-stack direction="block" gap="tight" align="center">
                      <s-text variant="heading-sm">AI-Powered</s-text>
                      <s-text
                        variant="body-sm"
                        color="subdued"
                        alignment="center"
                      >
                        Generate quiz questions automatically from your products
                      </s-text>
                    </s-stack>
                  </s-stack>

                  {/* Quick Start Steps */}
                  <s-banner variant="info">
                    <s-stack direction="block" gap="tight">
                      <s-text variant="heading-sm">Quick Start Guide</s-text>
                      <s-ordered-list>
                        <s-list-item>
                          Click &quot;Create Your First Quiz&quot; above
                        </s-list-item>
                        <s-list-item>
                          Let AI generate questions or build from scratch
                        </s-list-item>
                        <s-list-item>
                          Customize questions and product matching
                        </s-list-item>
                        <s-list-item>
                          Copy Quiz ID and add to your theme
                        </s-list-item>
                        <s-list-item>
                          Activate and start collecting responses!
                        </s-list-item>
                      </s-ordered-list>
                    </s-stack>
                  </s-banner>
                </s-stack>
              </s-box>
            </s-stack>
          </s-empty-state>
        </s-section>
      ) : (
        <>
          {/* Desktop Table View */}
          <s-section padding="none" accessibilityLabel="Quizzes table section">
            <s-table>
              <s-grid slot="filters" gap="small-200" gridTemplateColumns="1fr auto">
                <s-text-field
                  label="Search quizzes"
                  labelAccessibilityVisibility="exclusive"
                  icon="search"
                  placeholder="Search all quizzes"
                  value={searchQuery}
                  onInput={(e: React.FormEvent<HTMLElement>) => {
                    const target = e.target as HTMLInputElement;
                    setSearchQuery(target.value);
                  }}
                />
                <s-button
                  icon="sort"
                  variant="secondary"
                  accessibilityLabel="Sort"
                  interestFor="sort-tooltip"
                  commandFor="sort-actions"
                />
                <s-tooltip id="sort-tooltip">
                  <s-text>Sort</s-text>
                </s-tooltip>
                <s-popover id="sort-actions">
                  <s-stack gap="none">
                    <s-box padding="small">
                      <s-choice-list label="Sort by" name="Sort by">
                        <s-choice 
                          value="title" 
                          selected={sortBy === "title"}
                          onChange={() => setSortBy("title")}
                        >
                          Quiz name
                        </s-choice>
                        <s-choice 
                          value="questions"
                          selected={sortBy === "questions"}
                          onChange={() => setSortBy("questions")}
                        >
                          Questions
                        </s-choice>
                        <s-choice 
                          value="created"
                          selected={sortBy === "created"}
                          onChange={() => setSortBy("created")}
                        >
                          Created
                        </s-choice>
                        <s-choice 
                          value="status"
                          selected={sortBy === "status"}
                          onChange={() => setSortBy("status")}
                        >
                          Status
                        </s-choice>
                      </s-choice-list>
                    </s-box>
                    <s-divider />
                    <s-box padding="small">
                      <s-choice-list label="Order by" name="Order by">
                        <s-choice 
                          value="asc" 
                          selected={sortOrder === "asc"}
                          onChange={() => setSortOrder("asc")}
                        >
                          A-Z
                        </s-choice>
                        <s-choice 
                          value="desc"
                          selected={sortOrder === "desc"}
                          onChange={() => setSortOrder("desc")}
                        >
                          Z-A
                        </s-choice>
                      </s-choice-list>
                    </s-box>
                  </s-stack>
                </s-popover>
              </s-grid>
              <s-table-header-row>
                <s-table-header listSlot="primary">
                  <s-stack direction="inline" gap="small" alignItems="center">
                    <s-checkbox
                      checked={selectedQuizzes.size === filteredAndSortedQuizzes.length && filteredAndSortedQuizzes.length > 0}
                      onChange={toggleAllQuizzes}
                      accessibilityLabel="Select all quizzes"
                    />
                  </s-stack>
                </s-table-header>
                <s-table-header>Quiz</s-table-header>
                <s-table-header format="numeric">Questions</s-table-header>
                <s-table-header format="numeric">Completions</s-table-header>
                <s-table-header>Created</s-table-header>
                <s-table-header listSlot="secondary">Status</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {filteredAndSortedQuizzes.map((quiz) => (
                  <s-table-row 
                    key={quiz.id} 
                    clickDelegate={`quiz-${quiz.id}-checkbox`}
                  >
                    <s-table-cell listSlot="primary">
                      <s-stack direction="inline" gap="small" alignItems="center">
                        <s-checkbox 
                          id={`quiz-${quiz.id}-checkbox`}
                          checked={selectedQuizzes.has(quiz.id)}
                          onChange={() => toggleQuizSelection(quiz.id)}
                        />
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      <s-clickable
                        href={`/app/quizzes/${quiz.id}/edit`}
                        accessibilityLabel={`Edit ${quiz.title}`}
                      >
                        <s-stack direction="block" gap="tight">
                          <s-text variant="heading-sm">{quiz.title}</s-text>
                          {quiz.description && (
                            <s-text variant="body-sm" color="subdued">
                              {quiz.description}
                            </s-text>
                          )}
                        </s-stack>
                      </s-clickable>
                    </s-table-cell>
                    <s-table-cell format="numeric">{quiz.questionCount}</s-table-cell>
                    <s-table-cell format="numeric">
                      <s-stack direction="block" gap="tight">
                        <s-text>{quiz.completions}</s-text>
                        <s-text variant="body-sm" color="subdued">
                          {quiz.completionRate}% rate
                        </s-text>
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>{formatDate(quiz.createdAt)}</s-table-cell>
                    <s-table-cell listSlot="secondary">
                      <s-stack direction="block" gap="small">
                        <s-badge 
                          color="base" 
                          tone={quiz.status === "active" ? "success" : "neutral"}
                        >
                          {quiz.status === "active" ? "Active" : "Draft"}
                        </s-badge>
                        <s-stack direction="inline" gap="small">
                          <s-button
                            href={`/app/quizzes/${quiz.id}/edit`}
                            variant="secondary"
                            size="micro"
                            accessibilityLabel={`Edit ${quiz.title}`}
                            icon="edit"
                          />
                          <s-button-group variant="segmented">
                            <s-button
                              href={`/app/quizzes/${quiz.id}/analytics`}
                              variant="tertiary"
                              size="micro"
                              accessibilityLabel={`Analytics for ${quiz.title}`}
                              icon="analytics"
                            />
                          <s-button
                            onClick={() => copyQuizId(quiz.id)}
                            variant="tertiary"
                            size="micro"
                            accessibilityLabel={`Copy ID for ${quiz.title}`}
                            icon="duplicate"
                            title={copiedId === quiz.id ? "Copied!" : "Copy ID"}
                          />
                          <s-button
                            onClick={() => handleDeleteQuiz(quiz.id, quiz.title)}
                            variant="tertiary"
                            size="micro"
                            accessibilityLabel={`Delete ${quiz.title}`}
                            icon="delete"
                            tone="critical"
                          />
                        </s-button-group>
                        </s-stack>
                      </s-stack>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </s-section>

          <s-section>
            <s-stack direction="inline" gap="base" align="center">
              <s-button
                href="/app/quizzes/new"
                variant="primary"
              >
                Create New Quiz
              </s-button>
              {selectedQuizzes.size > 0 && (
                <>
                  <s-button
                    onClick={handleBulkDelete}
                    variant="primary"
                    tone="critical"
                  >
                    Delete {selectedQuizzes.size} Selected
                  </s-button>
                  <s-button
                    onClick={() => setSelectedQuizzes(new Set())}
                    variant="secondary"
                  >
                    Cancel Selection
                  </s-button>
                  <s-text variant="body-sm" color="subdued">
                    {selectedQuizzes.size} quiz{selectedQuizzes.size > 1 ? 'es' : ''} selected
                  </s-text>
                </>
              )}
            </s-stack>
          </s-section>
        </>
      )}

      <s-section slot="aside" heading="Tips for Success">
        <s-unordered-list>
          <s-list-item>
            Keep quizzes short (5-7 questions) for higher completion rates
          </s-list-item>
          <s-list-item>
            Use engaging images to make questions more interactive
          </s-list-item>
          <s-list-item>
            Enable email capture to build your marketing list
          </s-list-item>
          <s-list-item>
            Monitor analytics to optimize underperforming quizzes
          </s-list-item>
        </s-unordered-list>
      </s-section>

      {/* Delete Confirmation Modal */}
      {confirmModal.isOpen && (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events -- Modal backdrop dismiss pattern
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-modal-title"
          onClick={() =>
            setConfirmModal({ isOpen: false, quizId: "", quizTitle: "" })
          }
        >
          <s-box
            padding="large"
            borderRadius="base"
            background="subdued"
            border="base"
            className="modal-container"
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            <s-stack direction="block" gap="base">
              <s-text id="delete-modal-title" variant="heading-md">Delete Quiz?</s-text>
              <s-text variant="body-md">
                Are you sure you want to delete &quot;{confirmModal.quizTitle}
                &quot;? This action cannot be undone and will delete all
                questions, options, results, and analytics data associated with
                this quiz.
              </s-text>
              <s-stack direction="inline" gap="base">
                <s-button
                  onClick={() =>
                    setConfirmModal({
                      isOpen: false,
                      quizId: "",
                      quizTitle: "",
                    })
                  }
                  variant="secondary"
                >
                  Cancel
                </s-button>
                <s-button
                  onClick={confirmDelete}
                  variant="primary"
                  tone="critical"
                >
                  Delete Quiz
                </s-button>
              </s-stack>
            </s-stack>
          </s-box>
        </div>
      )}

      {/* Bulk Delete Confirmation Modal */}
      {bulkDeleteModal.isOpen && (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events -- Modal backdrop dismiss pattern
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bulk-delete-modal-title"
          onClick={() => setBulkDeleteModal({ isOpen: false, count: 0 })}
        >
          <s-box
            padding="large"
            borderRadius="base"
            border="base"
            background="subdued"
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            <s-stack direction="block" gap="base">
              <s-text id="bulk-delete-modal-title" variant="heading-md">Delete {bulkDeleteModal.count} Quiz{bulkDeleteModal.count > 1 ? 'es' : ''}?</s-text>
              <s-text variant="body-md">
                Are you sure you want to delete {bulkDeleteModal.count} quiz{bulkDeleteModal.count > 1 ? 'es' : ''}? This action cannot be undone and will delete all
                questions, options, results, and analytics data associated with
                {bulkDeleteModal.count > 1 ? ' these quizzes' : ' this quiz'}.
              </s-text>
              <s-stack direction="inline" gap="base">
                <s-button
                  onClick={() => setBulkDeleteModal({ isOpen: false, count: 0 })}
                  variant="secondary"
                >
                  Cancel
                </s-button>
                <s-button
                  onClick={confirmBulkDelete}
                  variant="primary"
                  tone="critical"
                >
                  Delete {bulkDeleteModal.count} Quiz{bulkDeleteModal.count > 1 ? 'es' : ''}
                </s-button>
              </s-stack>
            </s-stack>
          </s-box>
        </div>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
