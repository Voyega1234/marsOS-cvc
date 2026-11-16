-- Backlink Management: โควต้า (BlmSheetSource, BlmQuotaPackage, BlmQuotaReservation) + โปรเจกต์ Asana ต่อคำขอ (BlmRequestAsana)
--   + โปรเจกต์ Asana ที่วางลิงก์บันทึกไว้ (BlmAsanaSavedProject)
-- CREATE only, รันซ้ำได้ปลอดภัย ไม่แตะตารางเดิม
-- ต้องรัน 1 ครั้งใน Supabase SQL editor ของโปรเจกต์ "SEO PROJECT" (ref falakbebwdnrbkvnamrs)

BEGIN;

CREATE TABLE IF NOT EXISTS "plans_seo_pipeline"."BlmRequestAsana" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "projectGid" TEXT NOT NULL,
    "projectName" TEXT NOT NULL DEFAULT '',
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlmRequestAsana_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BlmRequestAsana_requestId_key" ON "plans_seo_pipeline"."BlmRequestAsana"("requestId");

CREATE TABLE IF NOT EXISTS "plans_seo_pipeline"."BlmSheetSource" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "spreadsheetId" TEXT NOT NULL,
    "spreadsheetUrl" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "label" TEXT NOT NULL DEFAULT '',
    "tabs" JSONB,
    "lastPulledAt" TIMESTAMP(3),
    "lastError" TEXT NOT NULL DEFAULT '',
    "addedById" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlmSheetSource_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BlmSheetSource_organizationId_spreadsheetId_key" ON "plans_seo_pipeline"."BlmSheetSource"("organizationId", "spreadsheetId");

CREATE TABLE IF NOT EXISTS "plans_seo_pipeline"."BlmQuotaPackage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "packageKey" TEXT NOT NULL,
    "tabTitle" TEXT NOT NULL DEFAULT '',
    "ordinal" INTEGER NOT NULL DEFAULT 0,
    "headerRow" INTEGER NOT NULL DEFAULT 1,
    "columns" JSONB NOT NULL,
    "data" JSONB NOT NULL,
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlmQuotaPackage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BlmQuotaPackage_sourceId_packageKey_key" ON "plans_seo_pipeline"."BlmQuotaPackage"("sourceId", "packageKey");

CREATE TABLE IF NOT EXISTS "plans_seo_pipeline"."BlmQuotaReservation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "slotIndex" INTEGER NOT NULL,
    "reservedById" TEXT NOT NULL,
    "website" TEXT NOT NULL DEFAULT '',
    "projectId" TEXT NOT NULL DEFAULT '',
    "projectName" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlmQuotaReservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BlmQuotaReservation_packageId_slotIndex_key" ON "plans_seo_pipeline"."BlmQuotaReservation"("packageId", "slotIndex");

CREATE TABLE IF NOT EXISTS "plans_seo_pipeline"."BlmAsanaSavedProject" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectGid" TEXT NOT NULL,
    "projectName" TEXT NOT NULL DEFAULT '',
    "workspaceName" TEXT NOT NULL DEFAULT '',
    "addedById" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlmAsanaSavedProject_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BlmAsanaSavedProject_organizationId_projectGid_key" ON "plans_seo_pipeline"."BlmAsanaSavedProject"("organizationId", "projectGid");

COMMIT;
