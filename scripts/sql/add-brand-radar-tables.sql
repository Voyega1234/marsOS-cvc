-- Brand Radar: AI visibility monitoring (brand setup, prompts, scans, responses, mentions, citations, opportunities)
-- 8 new tables: BrandRadarProfile, BrandRadarCompetitor, BrandRadarPrompt, BrandRadarRun,
--               BrandRadarResponse, BrandRadarMention, BrandRadarCitation, BrandRadarOpportunity
-- CREATE only, safe to run again. Touches no existing table.
-- Run once in the Supabase SQL editor of project "SEO PROJECT".

BEGIN;

CREATE TABLE IF NOT EXISTS "plans_seo_pipeline"."BrandRadarProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "brandName" TEXT NOT NULL DEFAULT '',
    "aliases" TEXT NOT NULL DEFAULT '[]',
    "contextTerms" TEXT NOT NULL DEFAULT '[]',
    "ambiguousAliases" TEXT NOT NULL DEFAULT '[]',
    "primaryDomain" TEXT NOT NULL DEFAULT '',
    "ownedDomains" TEXT NOT NULL DEFAULT '[]',
    "country" TEXT NOT NULL DEFAULT 'TH',
    "language" TEXT NOT NULL DEFAULT 'th',
    "industry" TEXT NOT NULL DEFAULT '',
    "products" TEXT NOT NULL DEFAULT '[]',
    "providers" TEXT NOT NULL DEFAULT '[]',
    "promptSources" TEXT NOT NULL DEFAULT '[]',
    "schedule" TEXT NOT NULL DEFAULT 'weekly',
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "monthlyBudgetUsd" DOUBLE PRECISION,
    "maxPromptsPerRun" INTEGER NOT NULL DEFAULT 50,
    "providerStatus" TEXT NOT NULL DEFAULT '{}',
    "createdById" TEXT NOT NULL DEFAULT '',
    "updatedById" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandRadarProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "plans_seo_pipeline"."BrandRadarCompetitor" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "aliases" TEXT NOT NULL DEFAULT '[]',
    "domains" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandRadarCompetitor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "plans_seo_pipeline"."BrandRadarPrompt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "textKey" TEXT NOT NULL,
    "topic" TEXT NOT NULL DEFAULT '',
    "intent" TEXT NOT NULL DEFAULT 'informational',
    "journeyStage" TEXT NOT NULL DEFAULT 'awareness',
    "country" TEXT NOT NULL DEFAULT 'TH',
    "language" TEXT NOT NULL DEFAULT 'th',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "keyword" TEXT NOT NULL DEFAULT '',
    "searchVolume" INTEGER,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'CANDIDATE',
    "note" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandRadarPrompt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "plans_seo_pipeline"."BrandRadarRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "providers" TEXT NOT NULL DEFAULT '[]',
    "promptCount" INTEGER NOT NULL DEFAULT 0,
    "promptSetHash" TEXT NOT NULL DEFAULT '',
    "totalTasks" INTEGER NOT NULL DEFAULT 0,
    "doneTasks" INTEGER NOT NULL DEFAULT 0,
    "failedTasks" INTEGER NOT NULL DEFAULT 0,
    "skippedTasks" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "estimatedCostUsd" DOUBLE PRECISION,
    "periodKey" TEXT,
    "error" TEXT NOT NULL DEFAULT '',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandRadarRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "plans_seo_pipeline"."BrandRadarResponse" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "error" TEXT NOT NULL DEFAULT '',
    "promptText" TEXT NOT NULL DEFAULT '',
    "country" TEXT NOT NULL DEFAULT '',
    "language" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT '',
    "collectionMethod" TEXT NOT NULL DEFAULT 'api_simulated',
    "responseText" TEXT NOT NULL DEFAULT '',
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "costUsd" DOUBLE PRECISION,
    "brandMentioned" BOOLEAN,
    "brandOccurrences" INTEGER,
    "brandRecommended" BOOLEAN,
    "ownedCited" BOOLEAN,
    "citationCount" INTEGER,
    "collectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandRadarResponse_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "plans_seo_pipeline"."BrandRadarMention" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "responseId" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityKey" TEXT NOT NULL,
    "competitorId" TEXT,
    "entityName" TEXT NOT NULL DEFAULT '',
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "matchedAliases" TEXT NOT NULL DEFAULT '[]',
    "recommended" BOOLEAN NOT NULL DEFAULT false,
    "compared" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER,
    "snippet" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrandRadarMention_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "plans_seo_pipeline"."BrandRadarCitation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "responseId" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "normalizedUrl" TEXT NOT NULL,
    "host" TEXT NOT NULL DEFAULT '',
    "domain" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "ownerType" TEXT NOT NULL DEFAULT 'external',
    "competitorId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrandRadarCitation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "plans_seo_pipeline"."BrandRadarOpportunity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "detail" TEXT NOT NULL DEFAULT '',
    "evidence" TEXT NOT NULL DEFAULT '{}',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "confidence" TEXT NOT NULL DEFAULT 'low',
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "suggestedAction" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "promptId" TEXT,
    "domain" TEXT,
    "competitorId" TEXT,
    "lastSeenRunId" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandRadarOpportunity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BrandRadarProfile_projectId_key" ON "plans_seo_pipeline"."BrandRadarProfile"("projectId");

CREATE INDEX IF NOT EXISTS "BrandRadarProfile_organizationId_idx" ON "plans_seo_pipeline"."BrandRadarProfile"("organizationId");

CREATE INDEX IF NOT EXISTS "BrandRadarProfile_schedule_nextRunAt_idx" ON "plans_seo_pipeline"."BrandRadarProfile"("schedule", "nextRunAt");

CREATE INDEX IF NOT EXISTS "BrandRadarCompetitor_organizationId_projectId_idx" ON "plans_seo_pipeline"."BrandRadarCompetitor"("organizationId", "projectId");

CREATE UNIQUE INDEX IF NOT EXISTS "BrandRadarCompetitor_projectId_nameKey_key" ON "plans_seo_pipeline"."BrandRadarCompetitor"("projectId", "nameKey");

CREATE INDEX IF NOT EXISTS "BrandRadarPrompt_organizationId_projectId_status_idx" ON "plans_seo_pipeline"."BrandRadarPrompt"("organizationId", "projectId", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "BrandRadarPrompt_projectId_textKey_key" ON "plans_seo_pipeline"."BrandRadarPrompt"("projectId", "textKey");

CREATE INDEX IF NOT EXISTS "BrandRadarRun_organizationId_projectId_createdAt_idx" ON "plans_seo_pipeline"."BrandRadarRun"("organizationId", "projectId", "createdAt");

CREATE INDEX IF NOT EXISTS "BrandRadarRun_status_idx" ON "plans_seo_pipeline"."BrandRadarRun"("status");

CREATE UNIQUE INDEX IF NOT EXISTS "BrandRadarRun_projectId_periodKey_key" ON "plans_seo_pipeline"."BrandRadarRun"("projectId", "periodKey");

CREATE INDEX IF NOT EXISTS "BrandRadarResponse_organizationId_projectId_status_collecte_idx" ON "plans_seo_pipeline"."BrandRadarResponse"("organizationId", "projectId", "status", "collectedAt");

CREATE INDEX IF NOT EXISTS "BrandRadarResponse_runId_status_idx" ON "plans_seo_pipeline"."BrandRadarResponse"("runId", "status");

CREATE INDEX IF NOT EXISTS "BrandRadarResponse_promptId_collectedAt_idx" ON "plans_seo_pipeline"."BrandRadarResponse"("promptId", "collectedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "BrandRadarResponse_runId_promptId_provider_key" ON "plans_seo_pipeline"."BrandRadarResponse"("runId", "promptId", "provider");

CREATE INDEX IF NOT EXISTS "BrandRadarMention_organizationId_projectId_runId_idx" ON "plans_seo_pipeline"."BrandRadarMention"("organizationId", "projectId", "runId");

CREATE INDEX IF NOT EXISTS "BrandRadarMention_promptId_idx" ON "plans_seo_pipeline"."BrandRadarMention"("promptId");

CREATE UNIQUE INDEX IF NOT EXISTS "BrandRadarMention_responseId_entityKey_key" ON "plans_seo_pipeline"."BrandRadarMention"("responseId", "entityKey");

CREATE INDEX IF NOT EXISTS "BrandRadarCitation_organizationId_projectId_runId_idx" ON "plans_seo_pipeline"."BrandRadarCitation"("organizationId", "projectId", "runId");

CREATE INDEX IF NOT EXISTS "BrandRadarCitation_projectId_domain_idx" ON "plans_seo_pipeline"."BrandRadarCitation"("projectId", "domain");

CREATE INDEX IF NOT EXISTS "BrandRadarCitation_promptId_idx" ON "plans_seo_pipeline"."BrandRadarCitation"("promptId");

CREATE UNIQUE INDEX IF NOT EXISTS "BrandRadarCitation_responseId_normalizedUrl_key" ON "plans_seo_pipeline"."BrandRadarCitation"("responseId", "normalizedUrl");

CREATE INDEX IF NOT EXISTS "BrandRadarOpportunity_organizationId_projectId_status_idx" ON "plans_seo_pipeline"."BrandRadarOpportunity"("organizationId", "projectId", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "BrandRadarOpportunity_projectId_type_key_key" ON "plans_seo_pipeline"."BrandRadarOpportunity"("projectId", "type", "key");


COMMIT;
