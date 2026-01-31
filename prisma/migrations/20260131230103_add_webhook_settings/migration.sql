-- CreateTable
CREATE TABLE "WebhookSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "quizStartedUrl" TEXT,
    "questionAnsweredUrl" TEXT,
    "quizCompletedUrl" TEXT,
    "emailCapturedUrl" TEXT,
    "webhookSecret" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "WebhookSettings_shop_key" ON "WebhookSettings"("shop");

-- CreateIndex
CREATE INDEX "WebhookSettings_shop_idx" ON "WebhookSettings"("shop");
