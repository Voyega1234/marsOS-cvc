-- Brand Radar: client logins that may view the Brand Radar report of chosen projects.
--
-- Safe to run more than once. Creates one new table and changes no existing table or row.
--
-- Until this file is run:
--   * staff use Brand Radar exactly as before;
--   * no client login can open Brand Radar (a missing table counts as "no access");
--   * creating a client login with Brand Radar projects answers an error that asks for this file to be run.
--
-- The table is separate from "ClientProjectAccess" (article portal). "projectId" has no foreign key
-- because a Brand Radar project can be one created inside Brand Radar, which has no "Project" row.

BEGIN;

CREATE TABLE IF NOT EXISTS "plans_seo_pipeline"."BrandRadarClientAccess" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BrandRadarClientAccess_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BrandRadarClientAccess_userId_projectId_key"
  ON "plans_seo_pipeline"."BrandRadarClientAccess"("userId", "projectId");

CREATE INDEX IF NOT EXISTS "BrandRadarClientAccess_organizationId_projectId_idx"
  ON "plans_seo_pipeline"."BrandRadarClientAccess"("organizationId", "projectId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BrandRadarClientAccess_userId_fkey'
  ) THEN
    ALTER TABLE "plans_seo_pipeline"."BrandRadarClientAccess"
      ADD CONSTRAINT "BrandRadarClientAccess_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "plans_seo_pipeline"."User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
