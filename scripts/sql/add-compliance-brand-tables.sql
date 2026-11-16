-- Compliance Checker: Brand Rule (โปรไฟล์แบรนด์รายลูกค้า + กฎของแบรนด์ + ข้อความจากไฟล์ Brand voice)
-- 3 ตารางใหม่: ComplianceBrand, ComplianceBrandRule, ComplianceBrandFile
-- CREATE only, รันซ้ำได้ปลอดภัย — ไม่แตะตาราง Compliance เดิม (ComplianceRule / ComplianceCheck / ComplianceAuditLog)
-- ต้องรัน 1 ครั้งใน Supabase SQL editor ของโปรเจกต์ "SEO PROJECT" (ref falakbebwdnrbkvnamrs)

BEGIN;

CREATE TABLE IF NOT EXISTS "plans_seo_pipeline"."ComplianceBrand" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "industry" TEXT NOT NULL DEFAULT '',
    "voice" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceBrand_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ComplianceBrand_organizationId_status_idx" ON "plans_seo_pipeline"."ComplianceBrand"("organizationId", "status");

CREATE TABLE IF NOT EXISTS "plans_seo_pipeline"."ComplianceBrandRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "libraryRuleId" TEXT,
    "code" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "ruleType" TEXT NOT NULL DEFAULT 'PROHIBITED_TERM',
    "terms" TEXT NOT NULL DEFAULT '[]',
    "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "guidance" TEXT NOT NULL DEFAULT '',
    "sourceName" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceBrandRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ComplianceBrandRule_brandId_libraryRuleId_key" ON "plans_seo_pipeline"."ComplianceBrandRule"("brandId", "libraryRuleId");
CREATE INDEX IF NOT EXISTS "ComplianceBrandRule_organizationId_brandId_idx" ON "plans_seo_pipeline"."ComplianceBrandRule"("organizationId", "brandId");

CREATE TABLE IF NOT EXISTS "plans_seo_pipeline"."ComplianceBrandFile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "chars" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceBrandFile_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ComplianceBrandFile_organizationId_brandId_idx" ON "plans_seo_pipeline"."ComplianceBrandFile"("organizationId", "brandId");

COMMIT;
