-- Backlink Management + Compliance Checker: 9 new tables (CREATE only, no change to existing tables).
-- Generated 2026-11-13 with: prisma migrate diff --from-schema-datamodel <HEAD schema> --to-schema-datamodel prisma/schema.prisma --script
-- Apply to production ONLY after owner approval, BEFORE deploying the code:
--   prisma db execute --file scripts/sql/add-blm-compliance-tables.sql --url <DIRECT_URL>
-- Never use prisma db push on production.

BEGIN;

-- CreateTable
CREATE TABLE "plans_seo_pipeline"."BlmVendorSite" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "siteUrl" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "domainRating" INTEGER,
    "traffic" INTEGER,
    "linkType" TEXT NOT NULL DEFAULT 'dofollow',
    "contactName" TEXT NOT NULL DEFAULT '',
    "contactChannel" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlmVendorSite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans_seo_pipeline"."BlmBudget" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "approvedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "setById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlmBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans_seo_pipeline"."BlmRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "vendorSiteId" TEXT,
    "vendorDomain" TEXT NOT NULL DEFAULT '',
    "targetUrl" TEXT NOT NULL,
    "anchorText" TEXT NOT NULL DEFAULT '',
    "keyword" TEXT NOT NULL DEFAULT '',
    "linkType" TEXT NOT NULL DEFAULT 'dofollow',
    "quotedPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "actualPrice" DOUBLE PRECISION,
    "budgetPeriod" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "requestedById" TEXT NOT NULL,
    "assigneeId" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectReason" TEXT NOT NULL DEFAULT '',
    "dueDate" TIMESTAMP(3),
    "notes" TEXT NOT NULL DEFAULT '',
    "liveUrl" TEXT NOT NULL DEFAULT '',
    "publishedAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "checkStatus" TEXT NOT NULL DEFAULT '',
    "checkDetail" TEXT NOT NULL DEFAULT '',
    "foundRel" TEXT NOT NULL DEFAULT '',
    "asanaTaskGid" TEXT,
    "asanaTaskUrl" TEXT NOT NULL DEFAULT '',
    "asanaCompleted" BOOLEAN NOT NULL DEFAULT false,
    "asanaSyncedAt" TIMESTAMP(3),
    "asanaSyncError" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlmRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans_seo_pipeline"."BlmRequestEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromStatus" TEXT NOT NULL DEFAULT '',
    "toStatus" TEXT NOT NULL DEFAULT '',
    "amount" DOUBLE PRECISION,
    "note" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT 'user',
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlmRequestEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans_seo_pipeline"."BlmAsanaConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tokenEnc" TEXT NOT NULL DEFAULT '',
    "projectGid" TEXT NOT NULL DEFAULT '',
    "projectName" TEXT NOT NULL DEFAULT '',
    "hookToken" TEXT,
    "webhookGid" TEXT NOT NULL DEFAULT '',
    "webhookSecretEnc" TEXT NOT NULL DEFAULT '',
    "webhookState" TEXT NOT NULL DEFAULT 'NONE',
    "pendingUntil" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "lastEventAt" TIMESTAMP(3),
    "lastError" TEXT NOT NULL DEFAULT '',
    "updatedById" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlmAsanaConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans_seo_pipeline"."ComplianceRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "ruleType" TEXT NOT NULL DEFAULT 'PROHIBITED_TERM',
    "terms" TEXT NOT NULL DEFAULT '[]',
    "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "guidance" TEXT NOT NULL DEFAULT '',
    "sourceName" TEXT NOT NULL DEFAULT '',
    "sourceUrl" TEXT NOT NULL DEFAULT '',
    "sourceRef" TEXT NOT NULL DEFAULT '',
    "effectiveDate" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans_seo_pipeline"."ComplianceRuleVersion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" TEXT NOT NULL,
    "changeNote" TEXT NOT NULL DEFAULT '',
    "changedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceRuleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans_seo_pipeline"."ComplianceCheck" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "articleSource" TEXT NOT NULL DEFAULT 'manual',
    "articleId" TEXT,
    "ownerLabel" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "contentHash" TEXT NOT NULL DEFAULT '',
    "contentSnapshot" TEXT NOT NULL DEFAULT '',
    "riskLevel" TEXT NOT NULL DEFAULT 'NONE',
    "riskScore" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT NOT NULL DEFAULT '',
    "findings" TEXT NOT NULL DEFAULT '[]',
    "rulesSnapshot" TEXT NOT NULL DEFAULT '[]',
    "aiUsed" BOOLEAN NOT NULL DEFAULT false,
    "aiModel" TEXT NOT NULL DEFAULT '',
    "aiError" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans_seo_pipeline"."ComplianceAuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "checkId" TEXT,
    "ruleId" TEXT,
    "action" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '{}',
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BlmVendorSite_organizationId_status_idx" ON "plans_seo_pipeline"."BlmVendorSite"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BlmVendorSite_organizationId_domain_key" ON "plans_seo_pipeline"."BlmVendorSite"("organizationId", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "BlmBudget_organizationId_projectId_period_key" ON "plans_seo_pipeline"."BlmBudget"("organizationId", "projectId", "period");

-- CreateIndex
CREATE INDEX "BlmRequest_organizationId_projectId_budgetPeriod_idx" ON "plans_seo_pipeline"."BlmRequest"("organizationId", "projectId", "budgetPeriod");

-- CreateIndex
CREATE INDEX "BlmRequest_organizationId_status_idx" ON "plans_seo_pipeline"."BlmRequest"("organizationId", "status");

-- CreateIndex
CREATE INDEX "BlmRequest_organizationId_asanaTaskGid_idx" ON "plans_seo_pipeline"."BlmRequest"("organizationId", "asanaTaskGid");

-- CreateIndex
CREATE INDEX "BlmRequestEvent_organizationId_requestId_idx" ON "plans_seo_pipeline"."BlmRequestEvent"("organizationId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "BlmAsanaConfig_organizationId_key" ON "plans_seo_pipeline"."BlmAsanaConfig"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "BlmAsanaConfig_hookToken_key" ON "plans_seo_pipeline"."BlmAsanaConfig"("hookToken");

-- CreateIndex
CREATE INDEX "ComplianceRule_organizationId_industry_status_idx" ON "plans_seo_pipeline"."ComplianceRule"("organizationId", "industry", "status");

-- CreateIndex
CREATE INDEX "ComplianceRuleVersion_organizationId_ruleId_idx" ON "plans_seo_pipeline"."ComplianceRuleVersion"("organizationId", "ruleId");

-- CreateIndex
CREATE INDEX "ComplianceCheck_organizationId_createdAt_idx" ON "plans_seo_pipeline"."ComplianceCheck"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ComplianceCheck_organizationId_articleSource_articleId_idx" ON "plans_seo_pipeline"."ComplianceCheck"("organizationId", "articleSource", "articleId");

-- CreateIndex
CREATE INDEX "ComplianceAuditLog_organizationId_createdAt_idx" ON "plans_seo_pipeline"."ComplianceAuditLog"("organizationId", "createdAt");


COMMIT;
