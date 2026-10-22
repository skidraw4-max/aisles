-- CreateEnum
CREATE TYPE "PromptAnalysisJobStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "AiMetadata" ADD COLUMN "promptAnalysisStatus" "PromptAnalysisJobStatus";
