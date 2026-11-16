-- Backlink Management: นำเข้าจาก Google Sheet (Sheet → MarsOS) — CREATE only, รันซ้ำได้ปลอดภัย
-- ต้องรัน 1 ครั้งใน Supabase SQL editor ของโปรเจกต์ "SEO PROJECT" (ref falakbebwdnrbkvnamrs)
-- ไม่แก้และไม่ลบตารางเดิม เพิ่มแค่ 2 ตารางใหม่:
--   BlmSheetImportConfig = ชีทต้นทาง + เดือนของงบ + การจับคู่ชื่อโปรเจกต์ (1 แถวต่อองค์กร)
--   BlmSheetImportRow    = จำว่าแถวไหนของ Expense Log เป็นคำขอไหน (นำเข้าซ้ำไม่สร้างซ้ำ)

BEGIN;

CREATE TABLE IF NOT EXISTS "plans_seo_pipeline"."BlmSheetImportConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "spreadsheetId" TEXT NOT NULL,
    "spreadsheetUrl" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "budgetPeriod" TEXT NOT NULL DEFAULT '',
    "projectMap" JSONB,
    "lastImportedAt" TIMESTAMP(3),
    "lastImportedById" TEXT NOT NULL DEFAULT '',
    "lastSummary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BlmSheetImportConfig_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "BlmSheetImportConfig_organizationId_key"
    ON "plans_seo_pipeline"."BlmSheetImportConfig"("organizationId");

CREATE TABLE IF NOT EXISTS "plans_seo_pipeline"."BlmSheetImportRow" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "rowKey" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "lastStatus" TEXT NOT NULL DEFAULT '',
    "spreadsheetId" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BlmSheetImportRow_pkey" PRIMARY KEY ("id")
);
-- ตารางที่สร้างไว้ก่อนมีคอลัมน์นี้: เพิ่มให้ (มีอยู่แล้ว = ไม่ทำอะไร)
ALTER TABLE "plans_seo_pipeline"."BlmSheetImportRow"
    ADD COLUMN IF NOT EXISTS "spreadsheetId" TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS "BlmSheetImportRow_organizationId_rowKey_key"
    ON "plans_seo_pipeline"."BlmSheetImportRow"("organizationId", "rowKey");
CREATE INDEX IF NOT EXISTS "BlmSheetImportRow_organizationId_requestId_idx"
    ON "plans_seo_pipeline"."BlmSheetImportRow"("organizationId", "requestId");

COMMIT;
