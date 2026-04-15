-- AlterTable
ALTER TABLE "AiMetadata" ADD COLUMN "promptAnalysis" JSONB;
ALTER TABLE "AiMetadata" ADD COLUMN "promptAnalysisPromptHash" VARCHAR(64);
