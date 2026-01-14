-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN "chargeId" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "confirmationUrl" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "returnUrl" TEXT;

-- CreateIndex
CREATE INDEX "Subscription_shopifySubscriptionId_idx" ON "Subscription"("shopifySubscriptionId");
