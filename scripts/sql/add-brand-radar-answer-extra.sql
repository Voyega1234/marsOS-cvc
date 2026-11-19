-- Brand Radar: other names the AI mentioned in an answer (run AFTER add-brand-radar-tables.sql).
-- Safe to run more than once, and safe to run once in the Supabase SQL editor of "SEO PROJECT".
-- Creates one new table and changes no existing table or row.
--   BrandRadarAnswerExtra  one row per answer: brands / products the AI platform itself tagged
--                          (DataForSEO ChatGPT / Gemini scraper brand_entities), as a JSON array
-- The app works without it: until this file is run, scans and reports keep working and the
-- "other names the AI mentioned" part of the answer viewer stays hidden.

BEGIN;

CREATE TABLE IF NOT EXISTS "plans_seo_pipeline"."BrandRadarAnswerExtra" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId"      TEXT NOT NULL,
  "runId"          TEXT NOT NULL,
  "responseId"     TEXT NOT NULL,
  "promptId"       TEXT NOT NULL,
  "provider"       TEXT NOT NULL,
  "entities"       TEXT NOT NULL DEFAULT '[]',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BrandRadarAnswerExtra_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BrandRadarAnswerExtra_responseId_key"
  ON "plans_seo_pipeline"."BrandRadarAnswerExtra"("responseId");
CREATE INDEX IF NOT EXISTS "BrandRadarAnswerExtra_organizationId_projectId_runId_idx"
  ON "plans_seo_pipeline"."BrandRadarAnswerExtra"("organizationId", "projectId", "runId");

COMMIT;
