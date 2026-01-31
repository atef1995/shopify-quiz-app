/*
  Warnings:

  - You are about to drop the column `insights` on the `QuizAnalytics` table. All the data in the column will be lost.
  - You are about to drop the column `metrics` on the `QuizAnalytics` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "QuizResult" ADD COLUMN "advancedTracking" TEXT;
ALTER TABLE "QuizResult" ADD COLUMN "completionTimeSeconds" REAL;
ALTER TABLE "QuizResult" ADD COLUMN "startedAt" DATETIME;

-- CreateTable
CREATE TABLE "QuestionAnalytics" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "questionId" TEXT NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "completions" INTEGER NOT NULL DEFAULT 0,
    "dropOffs" INTEGER NOT NULL DEFAULT 0,
    "averageTime" REAL,
    "answerDistribution" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QuestionAnalytics_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_QuizAnalytics" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "quizId" TEXT NOT NULL,
    "totalViews" INTEGER NOT NULL DEFAULT 0,
    "totalCompletions" INTEGER NOT NULL DEFAULT 0,
    "emailCaptureCount" INTEGER NOT NULL DEFAULT 0,
    "totalRevenue" REAL NOT NULL DEFAULT 0.0,
    "advancedMetrics" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QuizAnalytics_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_QuizAnalytics" ("emailCaptureCount", "id", "quizId", "totalCompletions", "totalRevenue", "totalViews", "updatedAt") SELECT "emailCaptureCount", "id", "quizId", "totalCompletions", "totalRevenue", "totalViews", "updatedAt" FROM "QuizAnalytics";
DROP TABLE "QuizAnalytics";
ALTER TABLE "new_QuizAnalytics" RENAME TO "QuizAnalytics";
CREATE UNIQUE INDEX "QuizAnalytics_quizId_key" ON "QuizAnalytics"("quizId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "QuestionAnalytics_questionId_key" ON "QuestionAnalytics"("questionId");
