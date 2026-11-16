-- Brand Radar: repeat samples per prompt (run AFTER add-brand-radar-tables.sql).
-- Safe to run more than once. Adds columns with defaults (existing rows keep working:
-- old responses become sampleIndex 0, old runs samplesPerPrompt 1) and widens the
-- response unique key so one run can ask the same prompt on the same provider N times.

BEGIN;

ALTER TABLE "plans_seo_pipeline"."BrandRadarProfile"
  ADD COLUMN IF NOT EXISTS "samplesPerPrompt" INTEGER NOT NULL DEFAULT 10;

ALTER TABLE "plans_seo_pipeline"."BrandRadarRun"
  ADD COLUMN IF NOT EXISTS "samplesPerPrompt" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "plans_seo_pipeline"."BrandRadarResponse"
  ADD COLUMN IF NOT EXISTS "sampleIndex" INTEGER NOT NULL DEFAULT 0;

-- New key first (existing rows are already unique on the narrower key), then drop the old one.
CREATE UNIQUE INDEX IF NOT EXISTS "BrandRadarResponse_runId_promptId_provider_sampleIndex_key"
  ON "plans_seo_pipeline"."BrandRadarResponse"("runId", "promptId", "provider", "sampleIndex");

DROP INDEX IF EXISTS "plans_seo_pipeline"."BrandRadarResponse_runId_promptId_provider_key";

COMMIT;
