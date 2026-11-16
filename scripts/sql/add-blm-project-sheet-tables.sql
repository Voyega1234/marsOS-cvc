-- Backlink Management: BlmProject (โปรเจกต์ที่เพิ่มเอง) + BlmSheetConfig (เชื่อม Google Sheet) — CREATE only, รันซ้ำได้ปลอดภัย
-- ต้องรัน 1 ครั้งใน Supabase SQL editor ของโปรเจกต์ "SEO PROJECT" (ref falakbebwdnrbkvnamrs)

BEGIN;

CREATE TABLE IF NOT EXISTS "plans_seo_pipeline"."BlmProject" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clientName" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlmProject_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BlmProject_organizationId_name_key" ON "plans_seo_pipeline"."BlmProject"("organizationId", "name");

CREATE TABLE IF NOT EXISTS "plans_seo_pipeline"."BlmSheetConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "spreadsheetId" TEXT NOT NULL,
    "spreadsheetUrl" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "dirtyAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT NOT NULL DEFAULT '',
    "connectedById" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlmSheetConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BlmSheetConfig_organizationId_key" ON "plans_seo_pipeline"."BlmSheetConfig"("organizationId");

COMMIT;
