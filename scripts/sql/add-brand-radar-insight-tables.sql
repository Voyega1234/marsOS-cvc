-- Brand Radar: answer insight (run AFTER add-brand-radar-tables.sql and add-brand-radar-samples.sql).
-- Safe to run more than once. Creates two new tables and changes no existing table or row.
--   BrandRadarInsight     one row per answer: the queries the AI searched with + brand sentiment
--   BrandRadarQueryGroup  topic group of each AI search query, per project
-- Until this file is run, scans and reports keep working; the sentiment and
-- Search Query Groups sections of the report stay empty.

BEGIN;

CREATE TABLE IF NOT EXISTS "plans_seo_pipeline"."BrandRadarInsight" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId"      TEXT NOT NULL,
  "runId"          TEXT NOT NULL,
  "responseId"     TEXT NOT NULL,
  "promptId"       TEXT NOT NULL,
  "provider"       TEXT NOT NULL,
  "searchQueries"  TEXT NOT NULL DEFAULT '[]',
  "sentiment"      TEXT,
  "sentimentModel" TEXT NOT NULL DEFAULT '',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BrandRadarInsight_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BrandRadarInsight_responseId_key"
  ON "plans_seo_pipeline"."BrandRadarInsight"("responseId");
CREATE INDEX IF NOT EXISTS "BrandRadarInsight_organizationId_projectId_runId_idx"
  ON "plans_seo_pipeline"."BrandRadarInsight"("organizationId", "projectId", "runId");
CREATE INDEX IF NOT EXISTS "BrandRadarInsight_promptId_idx"
  ON "plans_seo_pipeline"."BrandRadarInsight"("promptId");

CREATE TABLE IF NOT EXISTS "plans_seo_pipeline"."BrandRadarQueryGroup" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId"      TEXT NOT NULL,
  "queryKey"       TEXT NOT NULL,
  "query"          TEXT NOT NULL DEFAULT '',
  "groupName"      TEXT NOT NULL DEFAULT '',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BrandRadarQueryGroup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BrandRadarQueryGroup_projectId_queryKey_key"
  ON "plans_seo_pipeline"."BrandRadarQueryGroup"("projectId", "queryKey");
CREATE INDEX IF NOT EXISTS "BrandRadarQueryGroup_organizationId_projectId_idx"
  ON "plans_seo_pipeline"."BrandRadarQueryGroup"("organizationId", "projectId");

COMMIT;

-- Where in the answer the first mention starts (0 = start, 1 = end); NULL for rows scanned earlier.
ALTER TABLE "plans_seo_pipeline"."BrandRadarMention" ADD COLUMN IF NOT EXISTS "positionPct" DOUBLE PRECISION;

-- Pages the AI found while searching but did not cite (JSON array); only platforms that expose their search results fill it.
ALTER TABLE "plans_seo_pipeline"."BrandRadarInsight" ADD COLUMN IF NOT EXISTS "foundSources" TEXT NOT NULL DEFAULT '[]';
