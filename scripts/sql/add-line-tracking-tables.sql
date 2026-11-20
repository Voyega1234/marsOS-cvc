-- LINE Tracking: all tables of the module, in their own Postgres schema "line_tracking".
-- 17 new tables (lt_*): lt_workspace, lt_project, lt_short_link, lt_project_connection, lt_tracking_link,
--   lt_ad_click, lt_line_user, lt_lead, lt_lead_status_history, lt_conversion_rule, lt_conversion_event,
--   lt_sheet_sync_log, lt_webhook_log, lt_lead_change, lt_cc_sheet_sync, lt_cc_sheet_lead, lt_webhook_dedupe
-- Touches no existing table and nothing in "plans_seo_pipeline". Starts empty: no data is copied from anywhere.
-- Generated offline from prisma/schema.prisma (prisma migrate diff --script); never run by the app.
--
-- Run once in the Supabase SQL editor of project "SEO PROJECT" (the MarsOS database).
-- Plain CREATE TABLE on purpose: if any of these tables already exists the whole script stops and
-- rolls back, instead of silently reusing a table that belongs to something else.
--
-- Check first — this must return 0 rows. If it returns rows, stop and do not run the script:
--   SELECT table_schema, table_name FROM information_schema.tables
--   WHERE table_schema = 'line_tracking' OR (table_schema = 'plans_seo_pipeline' AND table_name LIKE 'lt\_%');
--
-- To remove the module again (deletes every LINE Tracking row): DROP SCHEMA "line_tracking" CASCADE;

BEGIN;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "line_tracking";

-- CreateTable
CREATE TABLE "line_tracking"."lt_workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sharedConfigJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lt_workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "line_tracking"."lt_project" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "businessType" TEXT NOT NULL,
    "websiteUrl" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Bangkok',
    "defaultConversionValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "mainSalesChannel" TEXT NOT NULL DEFAULT 'LINE',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "lookerTokenHash" TEXT,
    "lookerTokenSetAt" TIMESTAMP(3),
    "lookerIncludePii" BOOLEAN NOT NULL DEFAULT false,
    "organizationId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lt_project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "line_tracking"."lt_short_link" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lt_short_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "line_tracking"."lt_project_connection" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_CONNECTED',
    "configJson" TEXT NOT NULL DEFAULT '{}',
    "lastTestStatus" TEXT,
    "lastTestAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lt_project_connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "line_tracking"."lt_tracking_link" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lt_tracking_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "line_tracking"."lt_ad_click" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "clickId" TEXT NOT NULL,
    "source" TEXT,
    "medium" TEXT,
    "campaign" TEXT,
    "adset" TEXT,
    "content" TEXT,
    "keyword" TEXT,
    "gclid" TEXT,
    "fbclid" TEXT,
    "ttclid" TEXT,
    "msclkid" TEXT,
    "twclid" TEXT,
    "scclid" TEXT,
    "gaClientId" TEXT,
    "channel" TEXT,
    "channelGroup" TEXT,
    "lineClickedAt" TIMESTAMP(3),
    "landingUrl" TEXT,
    "referrer" TEXT,
    "userAgent" TEXT,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lt_ad_click_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "line_tracking"."lt_line_user" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "lineUserId" TEXT NOT NULL,
    "displayName" TEXT,
    "pictureUrl" TEXT,
    "firstClickId" TEXT,
    "latestClickId" TEXT,
    "friendStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "lastMessageAt" TIMESTAMP(3),
    "blockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lt_line_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "line_tracking"."lt_lead" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "lineUserId" TEXT,
    "clickId" TEXT,
    "displayName" TEXT,
    "fullName" TEXT,
    "phone" TEXT,
    "source" TEXT,
    "campaign" TEXT,
    "adset" TEXT,
    "content" TEXT,
    "keyword" TEXT,
    "gclid" TEXT,
    "fbclid" TEXT,
    "ttclid" TEXT,
    "msclkid" TEXT,
    "twclid" TEXT,
    "scclid" TEXT,
    "gaClientId" TEXT,
    "channel" TEXT,
    "channelGroup" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "slipAmount" DOUBLE PRECISION,
    "slipCheckedAt" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "salesOwner" TEXT,
    "purchaseId" TEXT,
    "purchasedAt" TIMESTAMP(3),
    "conversionState" TEXT NOT NULL DEFAULT 'NOT_READY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lt_lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "line_tracking"."lt_lead_status_history" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "oldStatus" TEXT,
    "newStatus" TEXT NOT NULL,
    "changedBy" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lt_lead_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "line_tracking"."lt_conversion_rule" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "leadStatus" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "platformsJson" TEXT NOT NULL DEFAULT '{}',
    "defaultValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lt_conversion_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "line_tracking"."lt_conversion_event" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "eventValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestPayload" TEXT,
    "responsePayload" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lt_conversion_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "line_tracking"."lt_sheet_sync_log" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "details" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lt_sheet_sync_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "line_tracking"."lt_webhook_log" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "payload" TEXT,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lt_webhook_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "line_tracking"."lt_lead_change" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "actorType" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lt_lead_change_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "line_tracking"."lt_cc_sheet_sync" (
    "projectId" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "tabName" TEXT,
    "statusMap" TEXT NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "lastRunAt" TIMESTAMP(3),
    "lastResult" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lt_cc_sheet_sync_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "line_tracking"."lt_cc_sheet_lead" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sheetLeadId" TEXT NOT NULL,
    "leadId" TEXT,
    "matchedBy" TEXT,
    "sheetStatus" TEXT NOT NULL DEFAULT '',
    "appliedStatus" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lt_cc_sheet_lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "line_tracking"."lt_webhook_dedupe" (
    "key" TEXT NOT NULL,
    "seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lt_webhook_dedupe_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "lt_project_slug_key" ON "line_tracking"."lt_project"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "lt_project_lookerTokenHash_key" ON "line_tracking"."lt_project"("lookerTokenHash");

-- CreateIndex
CREATE INDEX "lt_project_agencyId_idx" ON "line_tracking"."lt_project"("agencyId");

-- CreateIndex
CREATE UNIQUE INDEX "lt_short_link_code_key" ON "line_tracking"."lt_short_link"("code");

-- CreateIndex
CREATE INDEX "lt_short_link_projectId_idx" ON "line_tracking"."lt_short_link"("projectId");

-- CreateIndex
CREATE INDEX "lt_project_connection_projectId_idx" ON "line_tracking"."lt_project_connection"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "lt_project_connection_projectId_type_key" ON "line_tracking"."lt_project_connection"("projectId", "type");

-- CreateIndex
CREATE INDEX "lt_tracking_link_projectId_idx" ON "line_tracking"."lt_tracking_link"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "lt_ad_click_clickId_key" ON "line_tracking"."lt_ad_click"("clickId");

-- CreateIndex
CREATE INDEX "lt_ad_click_projectId_idx" ON "line_tracking"."lt_ad_click"("projectId");

-- CreateIndex
CREATE INDEX "lt_ad_click_projectId_createdAt_idx" ON "line_tracking"."lt_ad_click"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "lt_ad_click_projectId_lineClickedAt_idx" ON "line_tracking"."lt_ad_click"("projectId", "lineClickedAt");

-- CreateIndex
CREATE INDEX "lt_line_user_projectId_idx" ON "line_tracking"."lt_line_user"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "lt_line_user_projectId_lineUserId_key" ON "line_tracking"."lt_line_user"("projectId", "lineUserId");

-- CreateIndex
CREATE INDEX "lt_lead_projectId_idx" ON "line_tracking"."lt_lead"("projectId");

-- CreateIndex
CREATE INDEX "lt_lead_projectId_status_idx" ON "line_tracking"."lt_lead"("projectId", "status");

-- CreateIndex
CREATE INDEX "lt_lead_projectId_createdAt_idx" ON "line_tracking"."lt_lead"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "lt_lead_projectId_lineUserId_idx" ON "line_tracking"."lt_lead"("projectId", "lineUserId");

-- CreateIndex
CREATE INDEX "lt_lead_projectId_clickId_idx" ON "line_tracking"."lt_lead"("projectId", "clickId");

-- CreateIndex
CREATE INDEX "lt_lead_status_history_leadId_idx" ON "line_tracking"."lt_lead_status_history"("leadId");

-- CreateIndex
CREATE INDEX "lt_conversion_rule_projectId_idx" ON "line_tracking"."lt_conversion_rule"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "lt_conversion_rule_projectId_leadStatus_key" ON "line_tracking"."lt_conversion_rule"("projectId", "leadStatus");

-- CreateIndex
CREATE INDEX "lt_conversion_event_projectId_idx" ON "line_tracking"."lt_conversion_event"("projectId");

-- CreateIndex
CREATE INDEX "lt_conversion_event_projectId_status_idx" ON "line_tracking"."lt_conversion_event"("projectId", "status");

-- CreateIndex
CREATE INDEX "lt_conversion_event_leadId_idx" ON "line_tracking"."lt_conversion_event"("leadId");

-- CreateIndex
CREATE INDEX "lt_conversion_event_projectId_createdAt_idx" ON "line_tracking"."lt_conversion_event"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "lt_conversion_event_status_createdAt_idx" ON "line_tracking"."lt_conversion_event"("status", "createdAt");

-- CreateIndex
CREATE INDEX "lt_sheet_sync_log_projectId_idx" ON "line_tracking"."lt_sheet_sync_log"("projectId");

-- CreateIndex
CREATE INDEX "lt_webhook_log_projectId_idx" ON "line_tracking"."lt_webhook_log"("projectId");

-- CreateIndex
CREATE INDEX "lt_webhook_log_projectId_createdAt_idx" ON "line_tracking"."lt_webhook_log"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "lt_lead_change_projectId_createdAt_idx" ON "line_tracking"."lt_lead_change"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "lt_lead_change_leadId_createdAt_idx" ON "line_tracking"."lt_lead_change"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "lt_cc_sheet_lead_leadId_idx" ON "line_tracking"."lt_cc_sheet_lead"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "lt_cc_sheet_lead_projectId_sheetLeadId_key" ON "line_tracking"."lt_cc_sheet_lead"("projectId", "sheetLeadId");

-- AddForeignKey
ALTER TABLE "line_tracking"."lt_project" ADD CONSTRAINT "lt_project_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "line_tracking"."lt_workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_tracking"."lt_short_link" ADD CONSTRAINT "lt_short_link_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "line_tracking"."lt_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_tracking"."lt_project_connection" ADD CONSTRAINT "lt_project_connection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "line_tracking"."lt_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_tracking"."lt_tracking_link" ADD CONSTRAINT "lt_tracking_link_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "line_tracking"."lt_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_tracking"."lt_ad_click" ADD CONSTRAINT "lt_ad_click_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "line_tracking"."lt_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_tracking"."lt_line_user" ADD CONSTRAINT "lt_line_user_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "line_tracking"."lt_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_tracking"."lt_line_user" ADD CONSTRAINT "lt_line_user_latestClickId_fkey" FOREIGN KEY ("latestClickId") REFERENCES "line_tracking"."lt_ad_click"("clickId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_tracking"."lt_lead" ADD CONSTRAINT "lt_lead_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "line_tracking"."lt_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_tracking"."lt_lead" ADD CONSTRAINT "lt_lead_lineUserId_fkey" FOREIGN KEY ("lineUserId") REFERENCES "line_tracking"."lt_line_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_tracking"."lt_lead_status_history" ADD CONSTRAINT "lt_lead_status_history_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "line_tracking"."lt_lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_tracking"."lt_conversion_rule" ADD CONSTRAINT "lt_conversion_rule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "line_tracking"."lt_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_tracking"."lt_conversion_event" ADD CONSTRAINT "lt_conversion_event_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "line_tracking"."lt_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_tracking"."lt_conversion_event" ADD CONSTRAINT "lt_conversion_event_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "line_tracking"."lt_lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_tracking"."lt_sheet_sync_log" ADD CONSTRAINT "lt_sheet_sync_log_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "line_tracking"."lt_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_tracking"."lt_webhook_log" ADD CONSTRAINT "lt_webhook_log_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "line_tracking"."lt_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_tracking"."lt_cc_sheet_sync" ADD CONSTRAINT "lt_cc_sheet_sync_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "line_tracking"."lt_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_tracking"."lt_cc_sheet_lead" ADD CONSTRAINT "lt_cc_sheet_lead_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "line_tracking"."lt_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_tracking"."lt_cc_sheet_lead" ADD CONSTRAINT "lt_cc_sheet_lead_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "line_tracking"."lt_lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
