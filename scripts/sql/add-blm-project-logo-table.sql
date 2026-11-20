-- Backlink Management: BlmProjectLogo (project logos uploaded on the budget list) — CREATE only, safe to re-run
-- ต้องรัน 1 ครั้งใน Supabase SQL editor ของโปรเจกต์ "SEO PROJECT" (ref falakbebwdnrbkvnamrs)

BEGIN;

CREATE TABLE IF NOT EXISTS "plans_seo_pipeline"."BlmProjectLogo" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "projectId" TEXT,
    "logo" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlmProjectLogo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BlmProjectLogo_organizationId_nameKey_key" ON "plans_seo_pipeline"."BlmProjectLogo"("organizationId", "nameKey");

CREATE INDEX IF NOT EXISTS "BlmProjectLogo_organizationId_idx" ON "plans_seo_pipeline"."BlmProjectLogo"("organizationId");

COMMIT;
