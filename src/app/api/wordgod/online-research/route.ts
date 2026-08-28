/**
 * WordGod Online — /api/wordgod/online-research
 *
 * Business-Centric SEO/AEO/GEO Keyword Intelligence Engine
 * (โหมด "ไม่มีหน้าร้าน / ขายออนไลน์" เท่านั้น — โหมด local /api/wordgod/local-research ไม่ถูกแตะ)
 *
 * สถาปัตยกรรม DATA → AI (ลำดับตายตัว):
 *   Business Input → Website Context → Business Blueprint (AI ตีความ ไม่มีตัวเลข)
 *   → Seeds/Taxonomy → Discovery (DFS ideas + คู่แข่ง + pattern) → pool 8–16× เป้า
 *   → Google Keyword Planner = Primary Reference Volume / DataForSEO = cross-check
 *     (เก็บแยกแหล่งเสมอ ห้ามเฉลี่ยรวม; reference = Google → DFS → NULL)
 *   → intent/KD/SERP จริงจาก DataForSEO → AI จัดหมวด journey 19 ขั้น
 *   → System Scores คำนวณในโค้ด → cluster + กันคำกินกันเอง → คัดแบบ cluster quota
 *   → AI เขียน title/slug/เหตุผล (ทีหลังข้อมูลเสมอ) → wave + sitemap → บันทึก canonical run
 *
 * Checkpoint/resume: แพทเทิร์นเดียวกับโหมด local — stage machine + phaseState ใน
 * LocalKeywordResearchRun (mode='online_business') + YieldSignal เมื่อใกล้หมดงบเวลา
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logAIJob, DFS_COST_PER_KEYWORD } from '@/lib/logAIJob';
import { dedupeKey, hasForbiddenTerm, normalizeThaiSpacing, orderFreeKey } from '@/lib/wordgod/local/normalize';
import {
  computeVolumeConfidence,
  emptyDfsMetric,
  emptyGoogleMetric,
  emptySearchIntent,
  emptySerpSignals,
  resolveReferenceVolume,
  type DfsMetricData,
  type GoogleMetricData,
  type SearchIntentData,
  type SerpSignals,
} from '@/lib/wordgod/local/metrics';
import { CLIENT_READY_COVERAGE_THRESHOLD, toSerpSignals } from '@/lib/wordgod/local/enrichment';
import {
  getAccessToken,
  getHistoricalMetrics,
  getKeywordPlannerRows,
  loadGoogleAdsConfig,
  resolveGeoTargetChain,
  THAILAND_GEO_TARGET,
  validateGoogleAdsConfig,
  type MetricEntry,
  type ResolvedGeoTarget,
} from '@/lib/wordgod/services/googleKeywordPlannerService';
import {
  getDataForSeoKeywordDifficulty,
  getDataForSeoKeywordIdeas,
  getDataForSeoSearchIntents,
  getDataForSeoVolumes,
  getRankedKeywordsForDomain,
  getSerpLocalSignals,
  hasDataForSeoCreds,
  type DFSMetric,
} from '@/lib/wordgod/services/dataForSeoService';
import {
  buildBusinessBlueprint,
  classifyCandidatesBatch,
  CLASSIFY_BATCH_SIZE,
  generateTitlesBatch,
  TITLE_BATCH_SIZE,
  type CandidateClassification,
  type TitleBatchRow,
} from '@/lib/wordgod/online/blueprint';
import { scanWebsiteContext } from '@/lib/wordgod/online/siteScan';
import { callGemini } from '@/lib/wordgod/gemini';
import { buildRelevanceGuardPrompt, parseRelevanceGuardResponse, MAX_KEYWORDS_PER_CALL } from '@/lib/wordgod/local/relevanceGuard';
import { KEYWORD_RESEARCH_PROMPT } from '@/lib/skills/keywordResearchSkill';
import {
  buildScoringContext,
  computeSystemScores,
  demandScore,
  recommendPageType,
  resolveFunnel,
  resolveObjective,
} from '@/lib/wordgod/online/scoring';
import {
  assignClusters,
  assignWaves,
  buildSitemapPlacement,
  detectCannibalization,
  resolveSlugStatus,
  selectWithClusterQuota,
  themeOfStage,
  type ClusterableRow,
} from '@/lib/wordgod/online/clustering';
import {
  BUSINESS_TYPE_LABELS,
  clampTargetCount,
  JOURNEY_STAGE_MAP,
  ONLINE_STEPS,
  POOL_MULTIPLIER_MIN,
  STRATEGY_PRESETS,
  type BusinessBlueprint,
  type OnlineBusinessType,
  type OnlineClusterSummary,
  type OnlineKeywordResult,
  type OnlineResearchInput,
  type OnlineResearchResponse,
  type StrategyGoal,
  type WebsiteContext,
} from '@/lib/wordgod/online/types';

export const maxDuration = 800;

const KP_UNAVAILABLE_MESSAGE =
  'ไม่สามารถดึงข้อมูล Search Volume จาก Google Keyword Planner ได้ในขณะนี้ — ใช้ DataForSEO เป็น reference แทนเฉพาะคำที่มีข้อมูล';

type ProgressEmit = (event: Record<string, unknown>) => void;

// ── Stage machine (แพทเทิร์นเดียวกับ local-research ที่พิสูจน์แล้ว) ─────────
const STAGES = [
  'init', 'site_scan', 'blueprint', 'discovery', 'expand', 'kp', 'dfs_volumes',
  'intent', 'kd', 'classify', 'serp', 'scoring', 'titles', 'finalize',
] as const;
type StageName = (typeof STAGES)[number];
const stageIdx = (s: string) => Math.max(0, STAGES.indexOf(s as StageName));

class YieldSignal extends Error {
  constructor(public stage: StageName) { super(`yield:${stage}`); }
}

const LOCK_STALE_MS = 5 * 60 * 1000;
const DEFAULT_STEP_BUDGET_MS = 240_000;

type RunFlags = {
  useSiteScan: boolean;
  useKeywordPlanner: boolean;
  useDataForSeo: boolean;
  useDfsIdeas: boolean;
  useCompetitors: boolean;
  checkSerp: boolean;
  projectId: string | null;
  stepBudgetMs: number;
};

/** candidate ใน pool — ไม่มี metric ใด ๆ จนกว่าจะผ่าน KP/DFS จริง */
type PoolItem = {
  keyword: string;
  raw: string;
  sources: string[];
  seed: string | null;
  product: string;
  heuristic: number;
  /** รูปเขียนอื่นของคำเดียวกัน (สลับตำแหน่งคำ/close variant ของ KP) ที่ถูกยุบเข้าคำนี้ */
  variants?: string[];
};

/** แถวที่ผ่านการคัดแล้ว (state ระหว่าง scoring → titles → finalize) */
type SelectedRow = Omit<
  OnlineKeywordResult,
  'recommendedTitle' | 'suggestedSlug' | 'slugStatus' | 'whyThisKeyword' | 'sitemap' | 'rank'
> & { title?: string; slug?: string; why?: string };

const mapToEntries = <V,>(m: Map<string, V>) => Array.from(m.entries());

const stepOf = (key: string) => {
  const def = ONLINE_STEPS.find(s => s.key === key);
  return def ? { step: def.index, stepTotal: ONLINE_STEPS.length } : {};
};

// pattern modifiers — สร้าง "วลีค้นจริง" จากสินค้า/บริการ (โค้ดสร้างได้ เพราะเป็นแค่
// candidate string — ตัวเลขทุกตัวต้องผ่าน KP/DFS ยืนยันเสมอ)
const MOD_BUY = ['ราคา', 'ราคาเท่าไหร่', 'ซื้อที่ไหน', 'โปรโมชั่น', 'ของแท้'];
const MOD_SERVICE = ['รับทำ', 'บริการ', 'จ้าง'];
const MOD_TRUST = ['รีวิว', 'ที่ไหนดี', 'เจ้าไหนดี', 'ยี่ห้อไหนดี', 'แนะนำ', 'pantip'];
const MOD_COMPARE = ['เทียบ', 'แบบไหนดี', 'ต่างกันยังไง'];
const MOD_AEO = ['คืออะไร', 'ทำไมต้อง', 'ดีไหม', 'จำเป็นไหม', 'ใช้ยังไง'];
const MOD_KNOW = ['วิธีเลือก', 'วิธีใช้', 'ข้อดีข้อเสีย'];

function dfsFromMetric(hit: DFSMetric, language: string): DfsMetricData {
  const vol = typeof hit.volume === 'number' ? hit.volume : null;
  return {
    searchVolume: vol,
    monthlySearches: null,
    cpc: hit.cpc_conversion_available && hit.cpc > 0 ? hit.cpc : null,
    competition: hit.competition ?? null,
    competitionIndex: typeof hit.competition_index === 'number' ? hit.competition_index : null,
    keywordDifficulty: null,
    locationCode: 2764,
    language,
    retrievedAt: new Date().toISOString(),
    status: vol === null ? 'no_data' : vol === 0 ? 'zero' : 'ok',
  };
}

function googleFromEntry(entry: MetricEntry, geo: { resolved: string; level: string }, language: string): GoogleMetricData {
  const vol = typeof entry.volume === 'number' ? entry.volume : null;
  return {
    avgMonthlySearches: vol,
    monthlySearchVolumes:
      Array.isArray(entry.monthly_trend) && entry.monthly_trend.length > 1 ? entry.monthly_trend : null,
    competition: entry.competition ?? null,
    competitionIndex: typeof entry.competition_index === 'number' ? entry.competition_index : null,
    bidLowMicros: typeof entry.cpc_low === 'number' && entry.cpc_low > 0 ? entry.cpc_low : null,
    bidHighMicros: typeof entry.cpc_high === 'number' && entry.cpc_high > 0 ? entry.cpc_high : null,
    plannerCanonical: entry.planner_canonical ?? null,
    geoTarget: geo.resolved,
    geoLevel: geo.level,
    language,
    retrievedAt: new Date().toISOString(),
    status: vol === null ? 'no_data' : vol === 0 ? 'zero' : 'ok',
  };
}

function googleFromIdeaRow(
  row: { volume: number | null; competition?: string | null; competition_index?: number; low_cpc: number; high_cpc: number; monthly_trend?: number[] },
  geo: { resolved: string; level: string },
  language: string
): GoogleMetricData {
  const vol = typeof row.volume === 'number' ? row.volume : null;
  return {
    avgMonthlySearches: vol,
    monthlySearchVolumes:
      Array.isArray(row.monthly_trend) && row.monthly_trend.length > 1 ? row.monthly_trend : null,
    competition: row.competition ?? null,
    competitionIndex: typeof row.competition_index === 'number' ? row.competition_index : null,
    bidLowMicros: row.low_cpc > 0 ? row.low_cpc : null,
    bidHighMicros: row.high_cpc > 0 ? row.high_cpc : null,
    geoTarget: geo.resolved,
    geoLevel: geo.level,
    language,
    retrievedAt: new Date().toISOString(),
    status: vol === null ? 'no_data' : vol === 0 ? 'zero' : 'ok',
  };
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const researchId = req.nextUrl.searchParams.get('researchId');
  const projectId = req.nextUrl.searchParams.get('projectId');
  const row = researchId
    ? await prisma.localKeywordResearchRun.findFirst({ where: { id: researchId, organizationId: orgId, mode: 'online_business' } })
    : projectId
      ? await prisma.localKeywordResearchRun.findFirst({
          where: { projectId, organizationId: orgId, mode: 'online_business', status: 'completed' },
          orderBy: { createdAt: 'desc' },
        })
      : null;
  if (!row) return NextResponse.json({ error: 'ไม่พบผลการวิจัย' }, { status: 404 });
  if (row.status === 'running') {
    return NextResponse.json({ running: true, runId: row.id, phase: row.phase }, { status: 202 });
  }
  try {
    return NextResponse.json(JSON.parse(row.resultData));
  } catch {
    return NextResponse.json({ error: 'ข้อมูลผลการวิจัยเสียหาย' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session!.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const userId = session!.user.id;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const resumeRunId = typeof body.resumeRunId === 'string' && body.resumeRunId ? String(body.resumeRunId) : null;

  let input: OnlineResearchInput;
  let targetCount: number;
  let flags: RunFlags;
  let runId: string | null = null;
  let ckptData: any = null;
  let entryStage: StageName = 'init';

  if (resumeRunId) {
    const staleBefore = new Date(Date.now() - LOCK_STALE_MS);
    const locked = await prisma.localKeywordResearchRun.updateMany({
      where: {
        id: resumeRunId,
        organizationId: orgId,
        mode: 'online_business',
        status: 'running',
        OR: [{ lockedAt: null }, { lockedAt: { lt: staleBefore } }],
      },
      data: { lockedAt: new Date() },
    });
    if (locked.count === 0) {
      const row = await prisma.localKeywordResearchRun.findUnique({ where: { id: resumeRunId } });
      if (!row || row.organizationId !== orgId) {
        return NextResponse.json({ error: 'ไม่พบ run ที่จะทำต่อ' }, { status: 404 });
      }
      if (row.status !== 'running') {
        try {
          return NextResponse.json(JSON.parse(row.resultData));
        } catch {
          return NextResponse.json({ error: 'ข้อมูลผลการวิจัยเสียหาย' }, { status: 500 });
        }
      }
      return NextResponse.json(
        { error: 'ยังมีการประมวลผลรอบก่อนของ run นี้ทำงานอยู่ — รอสักครู่แล้วลองใหม่', locked: true },
        { status: 409 }
      );
    }
    const row = await prisma.localKeywordResearchRun.findUnique({ where: { id: resumeRunId } });
    let saved: any = null;
    try { saved = row?.phaseState ? JSON.parse(row.phaseState) : null; } catch { saved = null; }
    if (!saved?.input || !saved?.flags) {
      await prisma.localKeywordResearchRun.update({
        where: { id: resumeRunId }, data: { lockedAt: null },
      }).catch(() => {});
      return NextResponse.json({ error: 'checkpoint ของ run นี้เสียหาย — กรุณาเริ่มรันใหม่' }, { status: 409 });
    }
    runId = resumeRunId;
    ckptData = saved;
    entryStage = STAGES.includes(row!.phase as StageName) ? (row!.phase as StageName) : 'init';
    input = saved.input as OnlineResearchInput;
    targetCount = Number(saved.targetCount) || 300;
    flags = saved.flags as RunFlags;
    if (Number(body.stepBudgetMs) > 0) flags.stepBudgetMs = Number(body.stepBudgetMs);
  } else {
    const products: string[] = Array.isArray(body.products)
      ? body.products.map((s: unknown) => normalizeThaiSpacing(String(s ?? ''))).filter(Boolean)
      : [];
    if (products.length === 0) {
      return NextResponse.json({ error: 'ต้องระบุสินค้า/บริการหลักอย่างน้อย 1 รายการ' }, { status: 400 });
    }
    const businessType: OnlineBusinessType = (Object.keys(BUSINESS_TYPE_LABELS) as OnlineBusinessType[])
      .includes(body.businessType) ? body.businessType : 'OTHER';
    const strategyGoal: StrategyGoal = (Object.keys(STRATEGY_PRESETS) as StrategyGoal[])
      .includes(body.strategyGoal) ? body.strategyGoal : 'BALANCED';
    targetCount = clampTargetCount(Number(body.targetCount) || 300);

    input = {
      businessType,
      businessTypeOther: body.businessTypeOther ? String(body.businessTypeOther).slice(0, 100) : undefined,
      websiteUrl: body.websiteUrl ? String(body.websiteUrl).trim() : undefined,
      brandName: body.brandName ? normalizeThaiSpacing(String(body.brandName)) : undefined,
      products,
      targetCustomer: body.targetCustomer ? String(body.targetCustomer).slice(0, 500) : undefined,
      customerProblems: Array.isArray(body.customerProblems)
        ? body.customerProblems.map((s: unknown) => String(s ?? '').trim()).filter(Boolean).slice(0, 20)
        : undefined,
      country: body.country ? String(body.country) : 'Thailand',
      language: body.language === 'en' ? 'en' : 'th',
      strategyGoal,
      targetCount,
      competitorDomains: Array.isArray(body.competitorDomains)
        ? body.competitorDomains.map((s: unknown) => String(s ?? '').trim()).filter(Boolean).slice(0, 10)
        : undefined,
      existingPages: Array.isArray(body.existingPages)
        ? body.existingPages.map((s: unknown) => String(s ?? '').trim()).filter(Boolean).slice(0, 50)
        : undefined,
      includeBrandKeywords: body.includeBrandKeywords !== false,
      includeComparisonKeywords: body.includeComparisonKeywords !== false,
      includeProblemKeywords: body.includeProblemKeywords !== false,
      businessContext: body.businessContext ? String(body.businessContext).slice(0, 1000) : undefined,
    };
    flags = {
      useSiteScan: !!input.websiteUrl && body.useSiteScan !== false,
      useKeywordPlanner: body.useKeywordPlanner !== false,
      useDataForSeo: body.useDataForSeo !== false,
      useDfsIdeas: body.useDfsIdeas !== false,
      useCompetitors: (input.competitorDomains?.length ?? 0) > 0,
      checkSerp: body.checkSerp !== false,
      projectId: body.projectId ? String(body.projectId) : null,
      stepBudgetMs: Number(body.stepBudgetMs) > 0
        ? Number(body.stepBudgetMs)
        : Number(process.env.LOCAL_RESEARCH_STEP_BUDGET_MS) > 0
          ? Number(process.env.LOCAL_RESEARCH_STEP_BUDGET_MS)
          : DEFAULT_STEP_BUDGET_MS,
    };
  }

  const preset = STRATEGY_PRESETS[input.strategyGoal];
  const language = input.language ?? 'th';

  const resumable = resumeRunId !== null || (body.resumable === true && !!flags.projectId);
  if (resumable && !runId) {
    const run = await prisma.localKeywordResearchRun.create({
      data: {
        organizationId: orgId,
        projectId: flags.projectId!,
        mode: 'online_business',
        services: JSON.stringify(input.products),
        primaryLocation: input.country ?? 'Thailand',
        targetCount,
        salesWeight: preset.sales / 100,
        trafficWeight: preset.traffic / 100,
        status: 'running',
        phase: 'init',
        lockedAt: new Date(),
        createdById: userId,
      },
    });
    runId = run.id;
  }

  const startedAt = Date.now();
  const budgetMs = resumable ? Math.min(600_000, Math.max(30_000, flags.stepBudgetMs)) : Infinity;

  const runPipeline = async (emit: ProgressEmit) => {
    const progress = (message: string, extra?: Record<string, unknown>) =>
      emit({ type: 'progress', at: new Date().toISOString(), message, ...(extra ?? {}) });

    const warnings: string[] = Array.isArray(ckptData?.warnings) ? ckptData.warnings : [];

    // ── State (ทุกอย่าง serialize เป็น checkpoint ได้) ──────────────────────
    let siteContext: WebsiteContext | null = ckptData?.site ?? null;
    let blueprint: BusinessBlueprint | null = ckptData?.blueprint ?? null;

    const pool = new Map<string, PoolItem>();
    if (Array.isArray(ckptData?.pool)) for (const it of ckptData.pool as PoolItem[]) pool.set(dedupeKey(it.keyword), it);
    // ดัชนีคีย์แบบไม่สนลำดับคำ → dedupeKey เจ้าของ (จับ "ล้างแอร์ บางนา ราคาถูก" = "บางนา ล้างแอร์ ราคาถูก")
    const orderIndex = new Map<string, string>();
    for (const [key, it] of Array.from(pool.entries())) {
      const ok = orderFreeKey(it.keyword);
      if (!orderIndex.has(ok)) orderIndex.set(ok, key);
    }

    const googleByKey = new Map<string, GoogleMetricData>(ckptData?.google ?? []);
    const dfsByKey = new Map<string, DfsMetricData>(ckptData?.dfs ?? []);
    const intentByKey = new Map<string, SearchIntentData>(ckptData?.intents ?? []);
    const serpByKey = new Map<string, SerpSignals>(ckptData?.serpSignals ?? []);
    const classByKey = new Map<string, CandidateClassification>(ckptData?.classes ?? []);
    let shortlistKeys: string[] = Array.isArray(ckptData?.shortlist) ? ckptData.shortlist : [];

    let kpStatus: 'ok' | 'partial' | 'unavailable' | 'skipped' = ckptData?.kp?.status ?? 'skipped';
    let kpMessage: string | undefined = ckptData?.kp?.message ?? undefined;
    let kpCalls: number = ckptData?.kp?.calls ?? 0;
    let kpFetchedAt: string | null = ckptData?.kp?.fetchedAt ?? null;
    let kpEnriched: number = ckptData?.kp?.enriched ?? 0;
    let resolvedGeoLite: { name: string; level: string; resourceName: string } | null = ckptData?.kp?.resolvedGeo ?? null;

    let dfsCalls: number = ckptData?.c?.dfsCalls ?? 0;
    let dfsError: string | undefined = ckptData?.c?.dfsError ?? undefined;
    let dfsFetchedAt: string | null = ckptData?.c?.dfsFetchedAt ?? null;
    let dfsExtraCostUsd: number = ckptData?.c?.dfsExtraCostUsd ?? 0;
    let dfsExtraCalls: number = ckptData?.c?.dfsExtraCalls ?? 0;
    let serpChecked: number = ckptData?.c?.serpChecked ?? 0;
    let serpErrors: number = ckptData?.c?.serpErrors ?? 0;
    let candidateCount: number = ckptData?.c?.candidateCount ?? 0;
    let qualifiedCount: number = ckptData?.c?.qualifiedCount ?? 0;
    let titleFailures: number = ckptData?.c?.titleFailures ?? 0;

    let selected: SelectedRow[] = Array.isArray(ckptData?.selected) ? ckptData.selected : [];

    const needs = (s: StageName) => stageIdx(entryStage) <= stageIdx(s);
    const cursor = <T,>(stage: StageName, field: string, dflt: T): T =>
      entryStage === stage && ckptData && ckptData[field] !== undefined ? (ckptData[field] as T) : dflt;

    const snapshot = (nextStage: StageName, extra: Record<string, unknown>) => {
      // หลัง scoring แล้ว pool/metric maps ถูกฝังใน selected แล้ว — ตัดให้ checkpoint เบา
      const lean = stageIdx(nextStage) > stageIdx('scoring');
      return JSON.stringify({
        v: 1,
        input, targetCount, flags,
        warnings,
        site: siteContext,
        blueprint,
        pool: lean ? [] : Array.from(pool.values()),
        google: lean ? [] : mapToEntries(googleByKey),
        dfs: lean ? [] : mapToEntries(dfsByKey),
        intents: lean ? [] : mapToEntries(intentByKey),
        serpSignals: lean ? [] : mapToEntries(serpByKey),
        classes: lean ? [] : mapToEntries(classByKey),
        shortlist: lean ? [] : shortlistKeys,
        kp: { status: kpStatus, message: kpMessage, calls: kpCalls, fetchedAt: kpFetchedAt, enriched: kpEnriched, resolvedGeo: resolvedGeoLite },
        c: {
          dfsCalls, dfsError, dfsFetchedAt, dfsExtraCostUsd, dfsExtraCalls,
          serpChecked, serpErrors, candidateCount, qualifiedCount, titleFailures,
        },
        selected,
        ...extra,
      });
    };

    const checkpoint = async (nextStage: StageName, extra: Record<string, unknown> = {}) => {
      if (!resumable || !runId) return;
      await prisma.localKeywordResearchRun.update({
        where: { id: runId },
        data: {
          phase: nextStage,
          phaseState: snapshot(nextStage, extra),
          candidateCount: Math.max(pool.size, candidateCount),
          lockedAt: new Date(),
        },
      });
      if (Date.now() - startedAt > budgetMs) throw new YieldSignal(nextStage);
    };

    if (entryStage !== 'init') {
      progress(`ทำต่อจาก checkpoint เดิม (ขั้น ${entryStage}) — pool ${pool.size} คำ`);
    }

    const addToPool = (keyword: string, source: string, seed: string | null, product: string, heuristic: number) => {
      const kw = normalizeThaiSpacing(keyword);
      const key = dedupeKey(kw);
      if (!key || kw.length < 2 || kw.length > 80) return false;
      if (hasForbiddenTerm(kw)) return false; // คำพ่วงเว็บบอร์ด (pantip ฯลฯ) — ไม่เอาเข้าตาราง

      const existing = pool.get(key);
      if (existing) {
        if (!existing.sources.includes(source)) existing.sources.push(source);
        existing.heuristic = Math.max(existing.heuristic, heuristic);
        return false;
      }
      // คำเดิมในรูปสลับตำแหน่ง/คำพ้อง → ยุบเข้าเจ้าของเดิม เก็บรูปนี้ไว้เป็น variant
      const oKey = orderFreeKey(kw);
      const ownerKey = orderIndex.get(oKey);
      if (ownerKey && ownerKey !== key) {
        const owner = pool.get(ownerKey);
        if (owner) {
          if (!owner.sources.includes(source)) owner.sources.push(source);
          owner.heuristic = Math.max(owner.heuristic, heuristic);
          const vars = owner.variants ?? (owner.variants = []);
          if (!vars.includes(kw)) vars.push(kw);
          return false;
        }
      }
      pool.set(key, { keyword: kw, raw: keyword, sources: [source], seed, product, heuristic });
      orderIndex.set(oKey, key);
      return true;
    };

    // core token ของสินค้า (ใช้กรองความเกี่ยวข้องแบบหยาบก่อนถึงชั้น AI)
    const productKeys = input.products.map(dedupeKey).filter(Boolean);
    const brandKey = input.brandName ? dedupeKey(input.brandName) : '';
    // token ระดับคำ — แตกจากสินค้า/brand/seed taxonomy เพื่อไม่ให้ filter แบบ
    // containment ทั้งวลีเข้มเกินไป (เช่น "seo คือ" ต้องผ่านเมื่อสินค้าคือ "รับทำ seo")
    const GENERIC_TOKENS = new Set([
      'ราคา', 'รีวิว', 'วิธี', 'ซื้อ', 'ขาย', 'ดีไหม', 'คือ', 'อะไร', 'ที่ไหน',
      'เท่าไหร่', 'ออนไลน์', 'ฟรี', 'ของแท้', 'โปรโมชั่น', 'เปรียบเทียบ', 'บริการ',
      'รับทำ', 'รับจ้าง', 'the', 'and', 'for', 'with', 'best', 'top', 'ไหน', 'ยังไง',
    ]);
    type RelevanceToken = { token: string; latin: RegExp | null };
    let relevanceTokenCache: RelevanceToken[] | null = null;
    const relevanceTokens = (): RelevanceToken[] => {
      if (relevanceTokenCache) return relevanceTokenCache;
      const toks = new Map<string, RelevanceToken>();
      const collect = (phrase: string) => {
        for (const w of normalizeThaiSpacing(phrase).split(/\s+/)) {
          const t = dedupeKey(w);
          if (t.length < 3 || GENERIC_TOKENS.has(t) || toks.has(t)) continue;
          // token ละติน/ตัวเลขล้วน ต้อง match แบบมีขอบเขตคำ — กัน "seo" ไปติด "seoul"
          const latin = /^[a-z0-9]+$/.test(t)
            ? new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`)
            : null;
          toks.set(t, { token: t, latin });
        }
      };
      input.products.forEach(collect);
      if (input.brandName) collect(input.brandName);
      for (const node of blueprint?.taxonomy ?? []) node.seedKeywords.forEach(collect);
      relevanceTokenCache = Array.from(toks.values());
      return relevanceTokenCache;
    };
    // คำนอกธุรกิจ/แบรนด์คู่แข่งจาก blueprint (checkpoint เก่าไม่มี field นี้ → [])
    let negativeCache: string[] | null = null;
    const negativeKeys = (): string[] => {
      if (!negativeCache) negativeCache = (blueprint?.negativeEntities ?? []).map(dedupeKey).filter(k => k.length >= 3);
      return negativeCache;
    };
    let competitorCache: string[] | null = null;
    const competitorKeys = (): string[] => {
      if (!competitorCache) competitorCache = (blueprint?.competitorBrands ?? []).map(dedupeKey).filter(k => k.length >= 3);
      return competitorCache;
    };
    const competitorHits: string[] = [];
    const offBusinessHits: string[] = [];
    const relevantToBusiness = (keyword: string): boolean => {
      const key = dedupeKey(keyword);
      if (!key) return false;
      // แบรนด์คู่แข่ง → ตัดทิ้ง (เว้นแต่คำนั้นมีแบรนด์เราเองอยู่ด้วย)
      if (!(brandKey && key.includes(brandKey)) && competitorKeys().some(c => key.includes(c))) {
        if (competitorHits.length < 200) competitorHits.push(keyword);
        return false;
      }
      if (productKeys.some(p => key.includes(p) || p.includes(key))) return true;
      if (brandKey && key.includes(brandKey)) return true;
      // มี entity นอกธุรกิจ (ไม่ได้ขาย/ไม่ได้ให้บริการ) → ตัด แม้จะมี token ทั่วไปร่วมกับธุรกิจ
      // เช่น ธุรกิจซ่อม wifi: "ไอโฟน เชื่อม wifi ไม่ได้" มี token wifi แต่เป็นคำของสินค้าอื่น
      if (negativeKeys().some(n => key.includes(n))) {
        if (offBusinessHits.length < 200) offBusinessHits.push(keyword);
        return false;
      }
      // เทียบกับ seed ของ taxonomy (คำที่ AI ผูกกับธุรกิจแล้ว)
      if ((blueprint?.taxonomy ?? []).some(t =>
        t.seedKeywords.some(s => {
          const sk = dedupeKey(s);
          return sk.length >= 4 && (key.includes(sk) || sk.includes(key));
        })
      )) return true;
      // token-level: คำค้นที่มีคำหลักของธุรกิจอยู่ข้างใน
      const raw = normalizeThaiSpacing(keyword).toLowerCase();
      return relevanceTokens().some(t => (t.latin ? t.latin.test(raw) : key.includes(t.token)));
    };

    // ── init ────────────────────────────────────────────────────────────────
    if (needs('init')) {
      const bizLabel = input.businessType === 'OTHER' && input.businessTypeOther
        ? input.businessTypeOther : BUSINESS_TYPE_LABELS[input.businessType];
      progress(
        `เริ่มวิเคราะห์ธุรกิจ ${bizLabel}: ${input.products.join(', ')} — เป้า ${targetCount} คีย์เวิร์ด (${preset.label}: Traffic ${preset.traffic}% / Sales ${preset.sales}%)`,
        stepOf('validate')
      );
      await checkpoint('site_scan');
    }

    // ── site_scan ───────────────────────────────────────────────────────────
    if (needs('site_scan')) {
      if (flags.useSiteScan && input.websiteUrl) {
        progress(`สแกนบริบทจากเว็บไซต์ ${input.websiteUrl} …`, stepOf('site_scan'));
        siteContext = await scanWebsiteContext(input.websiteUrl);
        if (siteContext.status === 'ok') {
          progress(
            `อ่านบริบทเว็บไซต์สำเร็จ — H1 ${siteContext.h1.length}, เมนู ${siteContext.navLabels.length}, path เดิม ${siteContext.existingPaths.length} (slug แบบ ${siteContext.slugConvention})`,
            stepOf('site_scan')
          );
        } else {
          warnings.push(`สแกนเว็บไซต์ไม่สำเร็จ (${siteContext.error ?? 'unknown'}) — วิเคราะห์จากข้อมูลที่กรอกแทน`);
          progress('สแกนเว็บไซต์ไม่สำเร็จ — ใช้ข้อมูลที่กรอกแทน', stepOf('site_scan'));
        }
      } else {
        siteContext = null;
        progress('ไม่ได้ระบุเว็บไซต์ — ข้ามการสแกนบริบท', stepOf('site_scan'));
      }
      await checkpoint('blueprint');
    }

    // ── blueprint (AI ตีความ — ครอบคลุม step 3–11) ──────────────────────────
    if (needs('blueprint')) {
      progress('สร้าง Business Map + วิเคราะห์ลูกค้า/ปัญหา/JTBD/Journey/Taxonomy (AI ตีความ ไม่มีตัวเลข) …', stepOf('business_map'));
      blueprint = await buildBusinessBlueprint(input, siteContext);
      progress(`กลุ่มลูกค้า ${blueprint.segments.length} กลุ่ม${blueprint.customerSource === 'AI_INFERRED' ? ' (AI วิเคราะห์เอง — ไม่ได้ระบุมา)' : ''}`, stepOf('segments'));
      progress(`Problem Map ${blueprint.problemMap.length} ปัญหา`, stepOf('problem_map'));
      progress(`Jobs-to-be-Done ${blueprint.jtbd.length} ข้อ`, stepOf('jtbd'));
      progress(`Solution Map ${blueprint.solutionMap.length} ข้อ`, stepOf('solution_map'));
      progress(`Purchase Factors ${blueprint.purchaseFactors.length} ปัจจัย`, stepOf('purchase'));
      progress('วาง Customer Journey 19 ขั้นครอบคลุม SEO/AEO/GEO', stepOf('journey'));
      progress(`Keyword Taxonomy ${blueprint.taxonomy.length} กิ่ง`, stepOf('taxonomy'));

      // seeds → pool (source: ai_taxonomy) + pattern candidates จากโค้ด
      for (const node of blueprint.taxonomy) {
        for (const seedKw of node.seedKeywords) addToPool(seedKw, 'ai_taxonomy', seedKw, node.product, 55);
      }
      for (const p of blueprint.problemMap) {
        if (input.includeProblemKeywords === false) break;
        for (const sb of p.searchBehaviors) addToPool(sb, 'ai_taxonomy', sb, p.relatedProduct, 50);
      }
      for (const f of blueprint.purchaseFactors) {
        for (const angle of f.keywordAngles) addToPool(angle, 'ai_taxonomy', angle, input.products[0] ?? '', 45);
      }
      const isService = input.businessType === 'ONLINE_SERVICE' || input.businessType === 'SAAS';
      for (const product of input.products) {
        addToPool(product, 'pattern', null, product, 60);
        const mods = [
          ...MOD_BUY, ...MOD_TRUST, ...MOD_KNOW, ...MOD_AEO,
          ...(input.includeComparisonKeywords !== false ? MOD_COMPARE : []),
        ];
        for (const m of mods) addToPool(`${product} ${m}`, 'pattern', null, product, 40);
        if (isService) for (const m of MOD_SERVICE) addToPool(`${m}${product}`, 'pattern', null, product, 45);
        if (input.brandName && input.includeBrandKeywords !== false) {
          addToPool(`${input.brandName} ${product}`, 'pattern', null, product, 35);
          addToPool(`${input.brandName} รีวิว`, 'pattern', null, product, 35);
        }
      }
      progress(`สร้าง Seed Keywords + pattern candidates ${pool.size} คำ`, { ...stepOf('seeds'), count: pool.size });
      await checkpoint('discovery');
    }

    if (!blueprint) throw new Error('blueprint หายจาก checkpoint — กรุณาเริ่มรันใหม่');
    const poolTarget = Math.min(targetCount * POOL_MULTIPLIER_MIN, 12_000);

    // ── discovery: DFS ideas + คู่แข่ง ──────────────────────────────────────
    if (needs('discovery')) {
      let discStep = cursor('discovery', 'discStep', 0);

      if (discStep === 0 && flags.useDfsIdeas && flags.useDataForSeo && hasDataForSeoCreds()) {
        const seedGroups: string[][] = [];
        const allSeeds = [
          ...blueprint.taxonomy.flatMap(t => t.seedKeywords),
          ...blueprint.problemMap.flatMap(pm => pm.searchBehaviors),
        ];
        for (let i = 0; i < allSeeds.length; i += 20) seedGroups.push(allSeeds.slice(i, i + 20));
        let groupIdx = cursor('discovery', 'ideaGroupIdx', 0);
        if (groupIdx === 0) progress(`ขยายคำจาก DataForSEO keyword ideas (${seedGroups.length} ชุด seed) …`, stepOf('discovery_dfs'));
        while (groupIdx < seedGroups.length && pool.size < poolTarget && groupIdx < 8) {
          const ideasRes = await getDataForSeoKeywordIdeas(seedGroups[groupIdx], {
            limit: 1000, locationCode: 2764, languageCode: language,
          });
          dfsExtraCostUsd += ideasRes.costUsd;
          dfsExtraCalls += 1;
          if (ideasRes.error) {
            warnings.push(`DataForSEO keyword ideas ชุดที่ ${groupIdx + 1} ไม่สำเร็จ: ${ideasRes.error.slice(0, 80)}`);
          }
          let added = 0;
          for (const idea of ideasRes.ideas) {
            if (!relevantToBusiness(idea.keyword)) continue;
            if (addToPool(idea.keyword, 'dfs_ideas', seedGroups[groupIdx][0] ?? null, input.products[0] ?? '', 42)) added++;
          }
          groupIdx++;
          if (added > 0) progress(`DataForSEO ideas ชุด ${groupIdx}/${seedGroups.length}: +${added} คำ (pool ${pool.size})`, { ...stepOf('discovery_dfs'), count: pool.size });
          await checkpoint('discovery', { discStep: 0, ideaGroupIdx: groupIdx });
        }
        discStep = 1;
        await checkpoint('discovery', { discStep });
      } else if (discStep === 0) {
        if (flags.useDfsIdeas && !hasDataForSeoCreds()) warnings.push('ไม่มี DataForSEO credentials — ข้ามการขยายคำจาก keyword ideas');
        discStep = 1;
      }

      if (discStep === 1 && flags.useCompetitors && flags.useDataForSeo && hasDataForSeoCreds()) {
        const domains = input.competitorDomains ?? [];
        let compIdx = cursor('discovery', 'compIdx', 0);
        if (compIdx === 0) progress(`ขุดคำจากคู่แข่ง ${domains.length} โดเมน …`, stepOf('discovery_comp'));
        while (compIdx < domains.length && pool.size < poolTarget + 2000) {
          const domain = domains[compIdx];
          const ranked = await getRankedKeywordsForDomain(domain, { limit: 1000, locationCode: 2764, languageCode: language });
          dfsExtraCalls += 1;
          let added = 0;
          for (const rk of ranked.keywords) {
            if (!relevantToBusiness(rk.keyword)) continue;
            if (addToPool(rk.keyword, `competitor:${domain}`, null, input.products[0] ?? '', 48)) added++;
          }
          if (!ranked.keywords.length && ranked.note) {
            warnings.push(`ขุดคำจากคู่แข่ง ${domain} ไม่ได้: ${ranked.note.slice(0, 80)}`);
          }
          compIdx++;
          progress(`คู่แข่ง ${domain}: +${added} คำ (pool ${pool.size})`, { ...stepOf('discovery_comp'), count: pool.size });
          await checkpoint('discovery', { discStep: 1, compIdx });
        }
      }

      candidateCount = pool.size;
      await checkpoint('expand');
    }

    // ── expand: AI ขยาย pool คำที่เกี่ยวกับธุรกิจ (แพทเทิร์นเดียวกับ local ที่พิสูจน์แล้ว)
    // AI มีหน้าที่แค่ "เสนอ candidate string" — ตัวเลขทุกตัวต้องผ่าน KP/DFS จริงเสมอ ──
    if (needs('expand')) {
      const startWave = cursor('expand', 'expandWave', 0);
      if (pool.size < poolTarget || startWave > 0) {
        if (startWave === 0) progress(`ขยาย candidate pool ด้วย AI (เป้า pool ~${poolTarget} คำ) …`, stepOf('normalize'));
        const salesRatio = { informational: 40, commercial: 35, transactional: 20, navigational: 5, update: 0 };
        const genNiche = `${input.products.join(' / ')}${input.targetCustomer ? ` — ลูกค้า: ${input.targetCustomer}` : ''}${input.businessContext ? ` — ${input.businessContext}` : ''}`;
        const genSeed = input.products[0] ?? '';
        // มุมมองสลับต่อ batch (กิ่ง taxonomy + พฤติกรรมค้นจากปัญหา) — แต่ละ prompt ได้
        // seed ต่างกัน ลดคำซ้ำระหว่าง batch/wave ให้ pool โตต่อได้จริง
        const angleRing = [
          ...blueprint.taxonomy.map(t => t.seedKeywords[0]).filter(Boolean),
          ...blueprint.problemMap.map(pm => pm.searchBehaviors[0]).filter(Boolean),
        ];
        const BATCH = 50;
        const PARALLEL = targetCount <= 100 ? 2 : targetCount <= 400 ? 4 : 6;
        const MAX_WAVES = 6;
        let genAdded = cursor('expand', 'expandAdded', 0);
        let genFailed = cursor('expand', 'expandFailed', 0);
        for (let wave = startWave; wave < MAX_WAVES && pool.size < poolTarget; wave++) {
          const need = poolTarget - pool.size;
          const batches = Math.min(PARALLEL, Math.max(1, Math.ceil(need / BATCH)));
          // exclude เฉพาะชุดล่าสุด — กัน prompt บวมเมื่อ pool ใหญ่ (คำซ้ำถูกกันด้วย addToPool อยู่แล้ว)
          const exclude = Array.from(pool.values()).map(it => it.keyword).slice(-400);
          const prompts = Array.from({ length: batches }, (_, bi) => {
            const angle = angleRing.length ? angleRing[(wave * PARALLEL + bi) % angleRing.length] : genSeed;
            return KEYWORD_RESEARCH_PROMPT(genNiche, angle || genSeed, BATCH, exclude, [], salesRatio, false);
          });
          const settled = await Promise.allSettled(prompts.map(pr => callGemini(pr)));
          let waveAdded = 0;
          for (const st of settled) {
            if (st.status !== 'fulfilled') { genFailed++; continue; }
            const text = typeof st.value === 'string' ? st.value : JSON.stringify(st.value);
            const m = text.match(/\{[\s\S]*\}/);
            if (!m) continue;
            let parsed: { keywords?: Array<{ keyword?: string }> };
            try { parsed = JSON.parse(m[0]); } catch { continue; }
            for (const row of parsed.keywords ?? []) {
              const kw = String(row?.keyword ?? '').trim();
              if (!kw) continue;
              if (addToPool(kw, 'ai_expand', genSeed || null, input.products[0] ?? '', 44)) { waveAdded++; genAdded++; }
            }
          }
          progress(`AI expansion รอบ ${wave + 1}: +${waveAdded} คำ (pool ${pool.size})`, { ...stepOf('normalize'), count: pool.size });
          const stop = waveAdded === 0; // กันลูปเปล่า (AI ตอบซ้ำ/ล้มเหลวทั้งหมด)
          await checkpoint('expand', { expandWave: stop ? MAX_WAVES : wave + 1, expandAdded: genAdded, expandFailed: genFailed });
          if (stop) break;
        }
        if (genAdded > 0) {
          warnings.push(`ขยายคำที่เกี่ยวกับธุรกิจด้วย AI อีก ${genAdded} คำ (pool รวม ${pool.size} คำ) — AI เสนอเฉพาะ "คำ" ตัวเลขทุกตัวจะดึงจาก Keyword Planner/DataForSEO จริงต่อไป`);
        } else if (genFailed > 0) {
          warnings.push('ขยายคำด้วย AI ไม่สำเร็จรอบนี้ — ใช้คำจาก seed/discovery ที่มีอยู่');
        }
      }
      candidateCount = pool.size;
      const mult = targetCount > 0 ? pool.size / targetCount : 0;
      progress(`ทำความสะอาด/รวมคำซ้ำแล้ว — candidate pool ${pool.size} คำ (${mult.toFixed(1)}× ของเป้า)`, { ...stepOf('normalize'), count: pool.size });
      if (mult < POOL_MULTIPLIER_MIN) {
        warnings.push(`Candidate pool ได้ ${pool.size} คำ (${mult.toFixed(1)}× ของเป้า ${targetCount}) ต่ำกว่ามาตรฐาน ${POOL_MULTIPLIER_MIN}× — ผลลัพธ์ยังใช้ได้แต่ความหลากหลายอาจน้อยลง`);
      }
      await checkpoint('kp');
    }

    // ── kp: Google Keyword Planner (Primary Reference Volume) ───────────────
    if (needs('kp') && flags.useKeywordPlanner) {
      const config = loadGoogleAdsConfig();
      const { valid, errors } = validateGoogleAdsConfig(config);
      if (!valid || !config) {
        kpStatus = 'unavailable';
        kpMessage = KP_UNAVAILABLE_MESSAGE;
        warnings.push(`Google Keyword Planner ไม่พร้อมใช้งาน: ${errors.join('; ')}`);
      } else {
        try {
          const accessToken = await getAccessToken(config);
          if (!resolvedGeoLite) {
            let geo: ResolvedGeoTarget = THAILAND_GEO_TARGET;
            if (input.country && input.country !== 'Thailand') {
              geo = await resolveGeoTargetChain(config, accessToken, [input.country], () => {});
            }
            resolvedGeoLite = { name: geo.name, level: geo.level, resourceName: geo.resourceName };
          }
          const ranked = Array.from(pool.values()).sort((a, b) => b.heuristic - a.heuristic);
          const kpLimit = Math.min(ranked.length, Math.max(1500, targetCount * 3));
          const lookup = ranked.slice(0, kpLimit).map(r => r.keyword);
          const CHUNK = 500;
          let kpChunk = cursor('kp', 'kpChunk', 0);
          if (ranked.length > kpLimit && kpChunk === 0) {
            warnings.push(`ดึง Search Volume เฉพาะ ${kpLimit} คำที่เกี่ยวข้องกับธุรกิจสูงสุด (ทั้งหมด ${ranked.length} คำ)`);
          }
          const totalChunks = Math.ceil(lookup.length / CHUNK);
          if (kpChunk === 0) progress(`ดึง Google Keyword Planner ${lookup.length} คำ @ ${resolvedGeoLite.name} …`, stepOf('kp_volume'));
          const geoInfo = { resolved: resolvedGeoLite.name, level: resolvedGeoLite.level };
          while (kpChunk < totalChunks) {
            const chunk = lookup.slice(kpChunk * CHUNK, (kpChunk + 1) * CHUNK);
            const metrics = await getHistoricalMetrics(
              chunk, config, accessToken, language, input.country ?? 'Thailand',
              w => warnings.push(w), resolvedGeoLite.resourceName
            );
            kpCalls += chunk.length;
            for (const kw of chunk) {
              const entry = metrics.get(kw.trim().toLowerCase());
              if (!entry) continue;
              googleByKey.set(dedupeKey(kw), googleFromEntry(entry, geoInfo, language));
              kpEnriched++;
            }
            kpChunk++;
            progress(`Google Keyword Planner ตอบแล้ว ${kpEnriched} คำ (ชุด ${kpChunk}/${totalChunks})`, { ...stepOf('kp_volume'), count: kpEnriched });
            await checkpoint('kp', { kpChunk });
          }
          // ── KP ideas: ขยาย pool จากคำที่คนค้นจริงใน Keyword Planner
          // (volume ติดมากับ idea แถวต่อแถว — เป็นตัวเลขจริงจาก Google ไม่ใช่ AI) ──
          if (cursor('kp', 'kpIdeasDone', 0) === 0) {
            progress('ขยาย candidate จาก Keyword Planner ideas (คำที่คนค้นจริง) …', stepOf('kp_volume'));
            const ideas = await getKeywordPlannerRows({
              seed_keywords: input.products.slice(0, 5),
              target_language: language === 'en' ? 'en' : 'th',
              target_country: input.country ?? 'Thailand',
              number_of_results: Math.max(300, targetCount * 3),
              force_refresh: false,
            });
            if (ideas.warnings?.length) warnings.push(...ideas.warnings);
            let ideasAdded = 0;
            if (ideas.success) {
              for (const row of ideas.rows) {
                if (ideasAdded >= targetCount * 2) break;
                if (!row.volume || row.volume <= 0) continue;
                if (!relevantToBusiness(row.keyword)) continue;
                if (!addToPool(row.keyword, 'kp_ideas', null, input.products[0] ?? '', 46)) continue;
                const ideaKey = dedupeKey(normalizeThaiSpacing(row.keyword));
                if (!googleByKey.has(ideaKey)) {
                  googleByKey.set(ideaKey, googleFromIdeaRow(row, geoInfo, language));
                  kpEnriched++;
                }
                ideasAdded++;
              }
              kpCalls += ideas.rows.length;
            } else if (ideas.error) {
              warnings.push(`Keyword Planner ideas ไม่สำเร็จ: ${ideas.error.slice(0, 100)}`);
            }
            if (ideasAdded > 0) {
              candidateCount = pool.size;
              warnings.push(`เพิ่ม candidate จาก Keyword Planner ideas อีก ${ideasAdded} คำ — volume จริงจาก Google ทุกคำ`);
              progress(`KP ideas: +${ideasAdded} คำ (pool ${pool.size})`, { ...stepOf('kp_volume'), count: pool.size });
            }
            await checkpoint('kp', { kpChunk: totalChunks, kpIdeasDone: 1 });
          }
          // ── รวมกลุ่ม close variants ตามที่ Google จัดให้ (planner_canonical) ──
          // หลายคำใน pool ที่ KP ตอบ canonical เดียวกัน = คำเดียวกันในสายตา Google
          // เก็บไว้แค่ตัวแทนเดียว ที่เหลือเป็น variant (โผล่เป็นคำรองตอน finalize)
          const byCanonical = new Map<string, string[]>();
          for (const key of Array.from(pool.keys())) {
            const canon = googleByKey.get(key)?.plannerCanonical;
            if (!canon) continue;
            const cKey = dedupeKey(canon);
            const list = byCanonical.get(cKey) ?? [];
            list.push(key);
            byCanonical.set(cKey, list);
          }
          let variantMerged = 0;
          for (const [cKey, keys] of Array.from(byCanonical.entries())) {
            if (keys.length < 2) continue;
            const keeperKey = keys.includes(cKey)
              ? cKey
              : keys.reduce((a, b) => ((pool.get(a)?.heuristic ?? 0) >= (pool.get(b)?.heuristic ?? 0) ? a : b));
            const keeper = pool.get(keeperKey);
            if (!keeper) continue;
            for (const k of keys) {
              if (k === keeperKey) continue;
              const item = pool.get(k);
              if (!item) continue;
              const vars = keeper.variants ?? (keeper.variants = []);
              if (!vars.includes(item.keyword)) vars.push(item.keyword);
              for (const src of item.sources) if (!keeper.sources.includes(src)) keeper.sources.push(src);
              keeper.heuristic = Math.max(keeper.heuristic, item.heuristic);
              pool.delete(k);
              orderIndex.set(orderFreeKey(item.keyword), keeperKey);
              variantMerged++;
            }
          }
          if (variantMerged > 0) {
            progress(`รวม close variants ตามการจัดกลุ่มของ Keyword Planner ${variantMerged} คำ`, stepOf('kp_volume'));
            warnings.push(`Google Keyword Planner นับหลายรูปคำเป็นคำเดียวกัน — ยุบรวมแล้ว ${variantMerged} คำ (เก็บไว้เป็นคำรองของตัวแทน)`);
          }
          kpFetchedAt = new Date().toISOString();
          kpStatus = kpEnriched > 0 ? (kpEnriched < lookup.length ? 'partial' : 'ok') : 'partial';
          if (kpEnriched === 0) kpMessage = 'Keyword Planner ไม่มีข้อมูลปริมาณการค้นหาสำหรับคำในชุดนี้';
        } catch (err) {
          if (err instanceof YieldSignal) throw err; // checkpoint yield — ไม่ใช่ความล้มเหลวของ KP
          kpStatus = 'unavailable';
          kpMessage = KP_UNAVAILABLE_MESSAGE;
          warnings.push(`Google Keyword Planner ล้มเหลว: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`);
        }
      }
    }
    if (needs('kp')) {
      if (competitorHits.length > 0) {
        warnings.push(`ตัดคำค้นที่เป็นแบรนด์คู่แข่ง ${competitorHits.length} คำ เช่น ${competitorHits.slice(0, 5).join(', ')}`);
      }
      if (offBusinessHits.length > 0) {
        warnings.push(`ตัดคำที่เป็นสินค้า/อุปกรณ์นอกธุรกิจ ${offBusinessHits.length} คำ เช่น ${offBusinessHits.slice(0, 5).join(', ')}`);
      }
      await checkpoint('dfs_volumes');
    }

    // ── dfs_volumes: cross-check (เก็บแยกแหล่ง — ไม่เฉลี่ยรวมกับ Google เด็ดขาด) ──
    if (needs('dfs_volumes') && flags.useDataForSeo && hasDataForSeoCreds()) {
      // แบ่งงบ DFS สองก้อน: ครึ่งหนึ่งให้คำที่ Google ไม่มีข้อมูล (DFS = reference fallback)
      // อีกครึ่งให้คำ volume สูงสุด (cross-check → confidence HIGH) — ห้ามให้ก้อนใดกินหมด
      const withGoogle: PoolItem[] = [];
      const noGoogle: PoolItem[] = [];
      for (const it of Array.from(pool.values())) {
        const g = googleByKey.get(dedupeKey(it.keyword))?.avgMonthlySearches ?? null;
        (g === null ? noGoogle : withGoogle).push(it);
      }
      withGoogle.sort((a, b) =>
        (googleByKey.get(dedupeKey(b.keyword))?.avgMonthlySearches ?? 0) -
        (googleByKey.get(dedupeKey(a.keyword))?.avgMonthlySearches ?? 0));
      noGoogle.sort((a, b) => b.heuristic - a.heuristic);
      const dfsLimit = Math.min(pool.size, Math.max(1000, Math.round(targetCount * 2)));
      const nullShare = Math.min(noGoogle.length, Math.floor(dfsLimit / 2));
      const targets = [
        ...noGoogle.slice(0, nullShare),
        ...withGoogle.slice(0, dfsLimit - nullShare),
      ].map(r => r.keyword);
      const CHUNK = 700;
      let dfsChunk = cursor('dfs_volumes', 'dfsChunk', 0);
      const totalChunks = Math.ceil(targets.length / CHUNK);
      if (dfsChunk === 0) progress(`Cross-check volume กับ DataForSEO ${targets.length} คำ …`, stepOf('dfs_volume'));
      try {
        while (dfsChunk < totalChunks) {
          const chunk = targets.slice(dfsChunk * CHUNK, (dfsChunk + 1) * CHUNK);
          const dfsMap = await getDataForSeoVolumes(chunk, language, 2764, w => warnings.push(w));
          dfsCalls += chunk.length;
          for (const kw of chunk) {
            const hit = dfsMap.get(kw.trim().toLowerCase());
            if (!hit) continue;
            const key = dedupeKey(kw);
            dfsByKey.set(key, { ...dfsFromMetric(hit, language), keywordDifficulty: dfsByKey.get(key)?.keywordDifficulty ?? null });
          }
          dfsChunk++;
          progress(`DataForSEO ตอบแล้ว ${dfsByKey.size} คำ (ชุด ${dfsChunk}/${totalChunks})`, { ...stepOf('dfs_volume'), count: dfsByKey.size });
          await checkpoint('dfs_volumes', { dfsChunk });
        }
        dfsFetchedAt = new Date().toISOString();
      } catch (err) {
        if (err instanceof YieldSignal) throw err; // checkpoint yield — ไม่ใช่ความล้มเหลวของ DFS
        dfsError = err instanceof Error ? err.message.slice(0, 120) : String(err);
        warnings.push(`DataForSEO volume cross-check ไม่สำเร็จ: ${dfsError}`);
      }
    } else if (needs('dfs_volumes') && flags.useDataForSeo && !hasDataForSeoCreds()) {
      warnings.push('ไม่มี DataForSEO credentials — ไม่มี volume cross-check (ใช้ Google Keyword Planner แหล่งเดียว)');
    }
    if (needs('dfs_volumes')) await checkpoint('intent');

    // shortlist สำหรับชั้น intelligence (intent/kd/classify/serp)
    const computeShortlist = () => {
      const scored = Array.from(pool.values()).map(it => {
        const key = dedupeKey(it.keyword);
        const ref = resolveReferenceVolume(
          googleByKey.get(key) ?? emptyGoogleMetric(language),
          dfsByKey.get(key) ?? emptyDfsMetric(language)
        );
        return { key, prelim: demandScore(ref) * 0.55 + it.heuristic * 0.45 };
      });
      scored.sort((a, b) => b.prelim - a.prelim);
      return scored.slice(0, Math.min(scored.length, Math.min(3000, targetCount * 3))).map(s => s.key);
    };

    // ── intent (DataForSEO — search intent จริง) ────────────────────────────
    if (needs('intent') && flags.useDataForSeo && hasDataForSeoCreds()) {
      if (!shortlistKeys.length) shortlistKeys = computeShortlist();
      const targets = shortlistKeys
        .map(k => pool.get(k)?.keyword)
        .filter((k): k is string => !!k);
      const CHUNK = 1000;
      let intentChunk = cursor('intent', 'intentChunk', 0);
      const totalChunks = Math.ceil(targets.length / CHUNK);
      if (intentChunk === 0) progress(`ตรวจ Search Intent ${targets.length} คำ (DataForSEO) …`, stepOf('intent'));
      while (intentChunk < totalChunks) {
        const chunk = targets.slice(intentChunk * CHUNK, (intentChunk + 1) * CHUNK);
        const res = await getDataForSeoSearchIntents(chunk, language);
        dfsExtraCostUsd += res.costUsd;
        dfsExtraCalls += 1;
        if (res.error) warnings.push(`ตรวจ search intent ไม่สำเร็จบางส่วน: ${res.error.slice(0, 80)}`);
        const now = new Date().toISOString();
        for (const kw of chunk) {
          const hit = res.intents.get(kw.trim().toLowerCase());
          if (!hit) continue;
          intentByKey.set(dedupeKey(kw), { intent: hit.intent, probability: hit.probability, retrievedAt: now, status: 'ok' });
        }
        intentChunk++;
        progress(`ได้ search intent ${intentByKey.size} คำ`, { ...stepOf('intent'), count: intentByKey.size });
        await checkpoint('intent', { intentChunk });
      }
    }
    if (needs('intent')) await checkpoint('kd');

    // ── kd: Keyword Difficulty ──────────────────────────────────────────────
    if (needs('kd') && flags.useDataForSeo && hasDataForSeoCreds()) {
      if (!shortlistKeys.length) shortlistKeys = computeShortlist();
      const kdLimit = Math.min(shortlistKeys.length, Math.max(300, Math.min(1000, Math.round(targetCount * 0.8))));
      const targets = shortlistKeys.slice(0, kdLimit)
        .map(k => pool.get(k)?.keyword)
        .filter((k): k is string => !!k);
      if (targets.length) {
        progress(`ตรวจ Keyword Difficulty ${targets.length} คำ (DataForSEO) …`, stepOf('kd'));
        const res = await getDataForSeoKeywordDifficulty(targets, language, 2764);
        dfsExtraCostUsd += res.costUsd;
        dfsExtraCalls += 1;
        let kdSet = 0;
        for (const kw of targets) {
          const kd = res.metrics.get(kw.trim().toLowerCase());
          if (kd === undefined) continue;
          const key = dedupeKey(kw);
          const existing = dfsByKey.get(key) ?? emptyDfsMetric(language);
          dfsByKey.set(key, { ...existing, keywordDifficulty: kd });
          kdSet++;
        }
        progress(`ได้ Keyword Difficulty ${kdSet} คำ`, { ...stepOf('kd'), count: kdSet });
      }
    }
    if (needs('kd')) await checkpoint('classify');

    // ── classify: AI จัด journey/funnel/objective/relevance (ไม่มีตัวเลข) ────
    if (needs('classify')) {
      if (!shortlistKeys.length) shortlistKeys = computeShortlist();
      const targets = shortlistKeys
        .filter(k => !classByKey.has(k))
        .map(k => pool.get(k)?.keyword)
        .filter((k): k is string => !!k);
      const batches: string[][] = [];
      for (let i = 0; i < targets.length; i += CLASSIFY_BATCH_SIZE) batches.push(targets.slice(i, i + CLASSIFY_BATCH_SIZE));
      let classIdx = cursor('classify', 'classIdx', 0);
      if (classIdx === 0 && batches.length) {
        progress(`จัด Journey 19 ขั้น / Funnel / Objective ให้ ${targets.length} คำ (${batches.length} ชุด) …`, stepOf('classify'));
      }
      const PARALLEL = 3;
      while (classIdx < batches.length) {
        const wave = batches.slice(classIdx, classIdx + PARALLEL);
        const settled = await Promise.allSettled(
          wave.map(batch => classifyCandidatesBatch(batch, input, blueprint!))
        );
        for (const res of settled) {
          if (res.status !== 'fulfilled') {
            warnings.push(`จัดหมวดคีย์เวิร์ดชุดหนึ่งไม่สำเร็จ: ${res.reason instanceof Error ? res.reason.message.slice(0, 80) : String(res.reason)}`);
            continue;
          }
          for (const [kw, cls] of mapToEntries(res.value)) classByKey.set(dedupeKey(kw), cls);
        }
        classIdx += wave.length;
        progress(`จัดหมวดแล้ว ${classByKey.size}/${targets.length} คำ`, { ...stepOf('classify'), count: classByKey.size });
        await checkpoint('classify', { classIdx });
      }
    }
    if (needs('classify')) await checkpoint('serp');

    // ── serp: ตรวจเฉพาะคำสำคัญ (Tier A) ─────────────────────────────────────
    if (needs('serp') && flags.checkSerp && flags.useDataForSeo && hasDataForSeoCreds()) {
      const tierA = shortlistKeys
        .filter(k => {
          if (serpByKey.has(k)) return false;
          const cls = classByKey.get(k);
          if (!cls || cls.relevanceTier < 3) return false;
          const g = googleByKey.get(k);
          const intent = intentByKey.get(k);
          const commercial = cls.businessIntent !== 'INFORMATIONAL'
            || intent?.intent === 'commercial' || intent?.intent === 'transactional';
          const highVolume = (g?.avgMonthlySearches ?? 0) >= 200;
          return commercial || highVolume;
        })
        .slice(0, Math.max(12, Math.min(80, Math.round(targetCount * 0.08))));
      let serpDone = cursor('serp', 'serpDone', 0);
      if (serpDone === 0 && tierA.length) {
        progress(`ตรวจ SERP ${tierA.length} คำ (Tier A — เกี่ยวข้องสูง/เชิงพาณิชย์/volume สูง) …`, stepOf('serp'));
      }
      const CONCURRENCY = 6;
      while (serpDone < tierA.length) {
        const wave = tierA.slice(serpDone, serpDone + CONCURRENCY)
          .map(k => pool.get(k)?.keyword)
          .filter((k): k is string => !!k);
        const settled = await Promise.allSettled(
          wave.map(kw => getSerpLocalSignals(kw, { depth: 10, locationCode: 2764, languageCode: language }))
        );
        for (let i = 0; i < settled.length; i++) {
          const res = settled[i];
          if (res.status === 'fulfilled') {
            dfsExtraCostUsd += res.value.costUsd;
            dfsExtraCalls += 1;
            const signals = toSerpSignals(res.value);
            serpByKey.set(dedupeKey(wave[i]), signals);
            if (signals.status === 'ok') serpChecked++;
            else serpErrors++;
          } else {
            serpErrors++;
          }
        }
        serpDone += CONCURRENCY;
        progress(`ตรวจ SERP แล้ว ${Math.min(serpDone, tierA.length)}/${tierA.length} คำ`, { ...stepOf('serp'), count: serpChecked });
        await checkpoint('serp', { serpDone });
      }
      if (serpErrors > 0) warnings.push(`ตรวจ SERP ไม่สำเร็จ ${serpErrors} คำ — คำที่ไม่ได้ตรวจใช้คะแนนกลาง ไม่แต่งข้อมูล`);
    }
    if (needs('serp')) await checkpoint('scoring');

    // ── scoring: System Scores + cannibalization + คัดแบบ cluster quota ─────
    if (needs('scoring')) {
      progress('คำนวณ System Scores (Business / SEO / AEO / GEO) จากข้อมูลจริง …', stepOf('scoring'));
      const ctx = buildScoringContext(input, blueprint, preset);
      if (!shortlistKeys.length) shortlistKeys = computeShortlist();

      type WorkRow = { item: PoolItem; key: string; cls: CandidateClassification; clusterable: ClusterableRow };
      const work: WorkRow[] = [];
      for (const key of shortlistKeys) {
        const item = pool.get(key);
        const cls = classByKey.get(key);
        if (!item || !cls) continue;
        if (cls.relevanceTier === 0) continue; // ไม่เกี่ยวกับธุรกิจ — ตัดทิ้ง
        if (input.includeBrandKeywords === false && brandKey && key.includes(brandKey)) continue;
        if (input.includeProblemKeywords === false && themeOfStage(cls.journeyStage).key === 'problem') continue;
        if (input.includeComparisonKeywords === false && ['VENDOR_COMPARISON', 'SOLUTION_COMPARISON'].includes(cls.journeyStage)) continue;

        const google = googleByKey.get(key) ?? emptyGoogleMetric(language);
        const dfs = dfsByKey.get(key) ?? emptyDfsMetric(language);
        const reference = resolveReferenceVolume(google, dfs);
        const confidence = computeVolumeConfidence(google, dfs);
        const intent = intentByKey.get(key) ?? emptySearchIntent();
        const serp = serpByKey.get(key) ?? emptySerpSignals();
        const funnel = resolveFunnel(cls, intent);
        const objective = resolveObjective(cls, funnel);
        const pageType = recommendPageType(item.keyword, cls, funnel, input.businessType);
        const scores = computeSystemScores(
          { keyword: item.keyword, cls, google, dfs, reference, confidence, intent, serp, cannibalizationPenalty: 0 },
          ctx
        );
        work.push({
          item, key, cls,
          clusterable: {
            keyword: item.keyword,
            serviceOrProduct: cls.serviceOrProduct || item.product || input.products[0] || '',
            journeyStage: cls.journeyStage,
            funnelStage: funnel,
            objective,
            finalScore: scores.finalScore,
            referenceVolume: reference.volume,
            topUrls: serp.topUrls,
            pageType,
          },
        });
      }

      // Relevance Guard: ตัดคำที่ไม่ใช่ลูกค้าของธุรกิจ (เช่น คำค้นหาหน่วยงานราชการ/สถานที่)
      // ที่รอดชั้นกรอง n-gram มาได้ — LLM ตัดสินเจตนา, fail-open (พัง = ไม่ตัดอะไร + warning)
      let guardedWork = work;
      try {
        // ตรวจ "ทุกคำ" ที่มีสิทธิ์ถูกคัด (แบ่งชุดละ 400 — cap 3 ชุด) ไม่ใช่แค่ top คะแนน
        const guardTargets = work.slice().sort((a, b) => b.clusterable.finalScore - a.clusterable.finalScore)
          .slice(0, MAX_KEYWORDS_PER_CALL * 3).map(w => w.item.keyword);
        if (guardTargets.length > 0) {
          progress(`ตรวจคำนอกธุรกิจ ${guardTargets.length} คำ (Relevance Guard) …`, stepOf('scoring'));
          const guardInput = {
            services: input.products.filter(Boolean),
            businessContext: [input.brandName, input.targetCustomer].filter(Boolean).join(' — '),
          };
          const chunks: string[][] = [];
          for (let i = 0; i < guardTargets.length; i += MAX_KEYWORDS_PER_CALL) chunks.push(guardTargets.slice(i, i + MAX_KEYWORDS_PER_CALL));
          const settledGuard = await Promise.allSettled(chunks.map(async chunk => {
            const raw = await callGemini(buildRelevanceGuardPrompt(guardInput, chunk));
            return parseRelevanceGuardResponse(typeof raw === 'string' ? raw : JSON.stringify(raw), chunk);
          }));
          const guard = { verdicts: new Map<string, { verdict: string; reason: string }>(), unanswered: [] as string[] };
          let guardFailedChunks = 0;
          for (const g of settledGuard) {
            if (g.status === 'fulfilled') {
              g.value.verdicts.forEach((v, k) => guard.verdicts.set(k, v));
              guard.unanswered.push(...g.value.unanswered);
            } else guardFailedChunks++;
          }
          if (guardFailedChunks > 0) warnings.push(`Relevance Guard ตรวจไม่ครบ (${guardFailedChunks}/${chunks.length} ชุดล้มเหลว) — ชุดที่ล้มเหลวไม่ถูกตัดคำ`);
          const dropped: string[] = [];
          guard.verdicts.forEach((v, kw) => { if (v.verdict !== 'ok') dropped.push(kw); });
          if (dropped.length > 0) {
            const dropSet = new Set(dropped);
            guardedWork = work.filter(w => !dropSet.has(w.item.keyword));
            warnings.push(`ตัดคำที่ไม่ใช่ลูกค้าของธุรกิจ ${dropped.length} คำ (เช่น ${dropped.slice(0, 5).join(', ')}) — Relevance Guard`);
          }
          if (guard.unanswered.length > 0 && guard.verdicts.size === 0) {
            warnings.push('Relevance Guard ตรวจไม่สำเร็จ (โมเดลไม่ตอบเป็น JSON) — ไม่มีการตัดคำ');
          }
        }
      } catch (err) {
        warnings.push(`Relevance Guard ไม่สำเร็จ: ${err instanceof Error ? err.message.slice(0, 100) : String(err)} — ไม่มีการตัดคำ`);
      }

      // กันคำกินกันเอง: ยุบคำซ้ำเจตนาเป็นคำรอง + โทษคะแนนคำเสี่ยง
      const cann = detectCannibalization(guardedWork.map(w => w.clusterable));
      const absorbedBy = new Map<string, string>();
      for (const [primaryKw, secs] of mapToEntries(cann.absorbed)) {
        for (const s of secs) absorbedBy.set(s, primaryKw);
      }
      if (absorbedBy.size > 0) {
        warnings.push(`รวมคำที่เจตนาซ้ำกันเป็นคำรอง ${absorbedBy.size} คำ — กันหน้า doorway/คำกินกันเอง (ดูใน Detail ของแต่ละคำหลัก)`);
        progress(`รวมคำเจตนาซ้ำเป็นคำรอง ${absorbedBy.size} คำ`, stepOf('clusters'));
      }

      const survivors = guardedWork.filter(w => !absorbedBy.has(w.clusterable.keyword));
      // ใส่ penalty แล้วคิด final ใหม่เฉพาะคำที่โดน
      const rowByKeyword = new Map(survivors.map(w => [w.clusterable.keyword, w]));
      for (const [kw, penalty] of mapToEntries(cann.penalties)) {
        const w = rowByKeyword.get(kw);
        if (!w) continue;
        const google = googleByKey.get(w.key) ?? emptyGoogleMetric(language);
        const dfs = dfsByKey.get(w.key) ?? emptyDfsMetric(language);
        const reference = resolveReferenceVolume(google, dfs);
        const scores = computeSystemScores(
          {
            keyword: w.item.keyword, cls: w.cls, google, dfs, reference,
            confidence: computeVolumeConfidence(google, dfs),
            intent: intentByKey.get(w.key) ?? emptySearchIntent(),
            serp: serpByKey.get(w.key) ?? emptySerpSignals(),
            cannibalizationPenalty: penalty,
          },
          ctx
        );
        w.clusterable.finalScore = scores.finalScore;
      }

      const picked = selectWithClusterQuota(survivors.map(w => w.clusterable), targetCount);
      const pickedSet = new Set(picked.map(p => p.keyword));
      qualifiedCount = picked.length;
      progress(`คัดเหลือ ${picked.length} คีย์เวิร์ด (จาก candidate ${pool.size} คำ) — cluster quota ไม่ใช่ top-N ล้วน`, { ...stepOf('scoring'), count: picked.length });

      const clusterAssign = assignClusters(picked);
      const waves = assignWaves(picked, targetCount);
      progress(`จัด Cluster แล้ว ${new Set(Array.from(clusterAssign.values()).map(a => a.clusterId)).size} กลุ่ม`, stepOf('clusters'));

      selected = [];
      for (const w of survivors) {
        if (!pickedSet.has(w.clusterable.keyword)) continue;
        const key = w.key;
        const google = googleByKey.get(key) ?? emptyGoogleMetric(language);
        const dfs = dfsByKey.get(key) ?? emptyDfsMetric(language);
        const reference = resolveReferenceVolume(google, dfs);
        const confidence = computeVolumeConfidence(google, dfs);
        const intent = intentByKey.get(key) ?? emptySearchIntent();
        const serp = serpByKey.get(key) ?? emptySerpSignals();
        const assign = clusterAssign.get(w.clusterable.keyword)!;
        const penalty = cann.penalties.get(w.clusterable.keyword) ?? 0;
        const scores = computeSystemScores(
          { keyword: w.item.keyword, cls: w.cls, google, dfs, reference, confidence, intent, serp, cannibalizationPenalty: penalty },
          ctx
        );
        selected.push({
          keyword: w.item.keyword,
          rawKeyword: w.item.raw,
          seedKeyword: w.item.seed,
          sources: w.item.sources,
          serviceOrProduct: w.clusterable.serviceOrProduct,
          cluster: assign.clusterName,
          clusterId: assign.clusterId,
          clusterRole: assign.clusterRole,
          secondaryKeywords: Array.from(new Set([...(cann.absorbed.get(w.clusterable.keyword) ?? []), ...(w.item.variants ?? [])])),
          problemGroup: w.cls.problemGroup,
          google, dfs, reference, confidence,
          searchIntent: intent,
          businessIntent: w.cls.businessIntent,
          journeyStage: w.cls.journeyStage,
          journeyOrder: JOURNEY_STAGE_MAP[w.cls.journeyStage].order,
          funnelStage: w.clusterable.funnelStage,
          objective: w.clusterable.objective,
          serp,
          scores,
          pageType: w.clusterable.pageType,
          cannibalizationAction: 'KEEP',
          cannibalizationTarget: null,
          priorityWave: waves.get(w.clusterable.keyword) ?? 3,
          handoffStatus: 'RESEARCHED',
        });
      }
      selected.sort((a, b) => b.scores.finalScore - a.scores.finalScore);
      await checkpoint('titles');
    }

    // ── titles: AI เขียน title/slug/why (ทีหลังข้อมูลจริงเสมอ) ──────────────
    if (needs('titles')) {
      const slugConvention = siteContext?.slugConvention ?? 'latin';
      const pending = selected.filter(r => !r.title);
      const batches: SelectedRow[][] = [];
      for (let i = 0; i < pending.length; i += TITLE_BATCH_SIZE) batches.push(pending.slice(i, i + TITLE_BATCH_SIZE));
      // ไม่ restore titleIdx จาก checkpoint — pending ถูกกรองจากคำที่มี title แล้ว
      // (คำที่เขียนเสร็จถูก serialize ใน selected) จึงเริ่ม 0 กับ list ใหม่เสมอ
      let titleIdx = 0;
      if (pending.length) progress(`เขียน Title / Slug / เหตุผล ให้ ${pending.length} คำ …`, stepOf('titles'));
      const PARALLEL = 3;
      let written = selected.length - pending.length;
      while (titleIdx < batches.length) {
        const wave = batches.slice(titleIdx, titleIdx + PARALLEL);
        const settled = await Promise.allSettled(
          wave.map(batch => {
            const rows: TitleBatchRow[] = batch.map(r => ({
              keyword: r.keyword,
              journeyStage: r.journeyStage,
              pageType: r.pageType,
              facts: [
                r.reference.source === 'none'
                  ? 'ไม่มี volume ยืนยันจากทั้งสองแหล่ง'
                  : `reference volume ${r.reference.volume} (${r.reference.source === 'google_keyword_planner' ? 'Google' : 'DFS'})`,
                `cluster: ${r.cluster}`,
                r.problemGroup ? `ปัญหาลูกค้า: ${r.problemGroup}` : '',
                r.searchIntent.intent ? `intent: ${r.searchIntent.intent}` : '',
                `objective: ${r.objective}`,
              ].filter(Boolean).join(', '),
            }));
            return generateTitlesBatch(rows, input, slugConvention);
          })
        );
        for (let i = 0; i < settled.length; i++) {
          const res = settled[i];
          if (res.status !== 'fulfilled') {
            titleFailures += wave[i].length;
            continue;
          }
          for (const row of wave[i]) {
            const hit = res.value.get(row.keyword);
            if (!hit) { titleFailures++; continue; }
            row.title = hit.title;
            row.slug = hit.slug || undefined;
            row.why = hit.why || undefined;
            written++;
          }
        }
        titleIdx += wave.length;
        progress(`เขียน title แล้ว ${written}/${selected.length} คำ`, { ...stepOf('titles'), count: written });
        await checkpoint('titles', { titleIdx });
      }
      if (titleFailures > 0) warnings.push(`เขียน title ไม่สำเร็จ ${titleFailures} คำ — คำเหล่านั้นถูกตั้งสถานะ REVIEW (ไม่แต่งข้อมูลแทน)`);
      await checkpoint('finalize');
    }

    // ── finalize: slug status + sitemap + response + save ───────────────────
    progress('จัด Wave + Sitemap + สรุปผล …', stepOf('finalize'));
    const existingPaths = [
      ...(siteContext?.existingPaths ?? []),
      ...(input.existingPages ?? []),
    ];
    const productTokensLower = input.products.map(p => p.trim().toLowerCase()).filter(Boolean);
    const seenSlugs = new Set<string>();
    const primaryByCluster = new Map<number, string>();
    for (const r of selected) {
      if (r.clusterRole === 'PRIMARY') primaryByCluster.set(r.clusterId, r.keyword);
    }

    const results: OnlineKeywordResult[] = selected.map((r, idx) => {
      const slug = r.slug ?? null;
      const slugStatus = resolveSlugStatus(slug, existingPaths, seenSlugs);
      const clusterable: ClusterableRow = {
        keyword: r.keyword,
        serviceOrProduct: r.serviceOrProduct,
        journeyStage: r.journeyStage,
        funnelStage: r.funnelStage,
        objective: r.objective,
        finalScore: r.scores.finalScore,
        referenceVolume: r.reference.volume,
        topUrls: r.serp.topUrls,
        pageType: r.pageType,
      };
      const assign = {
        clusterId: r.clusterId,
        clusterName: r.cluster,
        clusterRole: r.clusterRole,
        themeKey: themeOfStage(r.journeyStage).key,
        section: themeOfStage(r.journeyStage).section,
      };
      const sitemap = buildSitemapPlacement(
        clusterable, assign, primaryByCluster.get(r.clusterId) ?? r.keyword,
        slug, existingPaths, productTokensLower
      );
      return {
        rank: idx + 1,
        keyword: r.keyword,
        rawKeyword: r.rawKeyword,
        seedKeyword: r.seedKeyword,
        sources: r.sources,
        serviceOrProduct: r.serviceOrProduct,
        cluster: r.cluster,
        clusterId: r.clusterId,
        clusterRole: r.clusterRole,
        secondaryKeywords: r.secondaryKeywords,
        problemGroup: r.problemGroup,
        google: r.google,
        dfs: r.dfs,
        reference: r.reference,
        confidence: r.confidence,
        searchIntent: r.searchIntent,
        businessIntent: r.businessIntent,
        journeyStage: r.journeyStage,
        journeyOrder: r.journeyOrder,
        funnelStage: r.funnelStage,
        objective: r.objective,
        serp: r.serp,
        scores: r.scores,
        pageType: r.pageType,
        cannibalizationAction: slugStatus === 'EXISTING' ? 'OPTIMIZE_EXISTING' : r.cannibalizationAction,
        cannibalizationTarget: r.cannibalizationTarget,
        recommendedTitle: r.title ?? null,
        suggestedSlug: slug,
        slugStatus: r.title ? slugStatus : 'REVIEW',
        whyThisKeyword: r.why ?? null,
        sitemap,
        priorityWave: r.priorityWave,
        handoffStatus: r.handoffStatus,
      };
    });

    // cluster summaries
    const clusterMap = new Map<number, OnlineClusterSummary>();
    for (const r of results) {
      const existing = clusterMap.get(r.clusterId);
      if (existing) {
        existing.keywordCount++;
        existing.totalReferenceVolume += r.reference.volume ?? 0;
      } else {
        clusterMap.set(r.clusterId, {
          clusterId: r.clusterId,
          name: r.cluster,
          primaryKeyword: primaryByCluster.get(r.clusterId) ?? r.keyword,
          keywordCount: 1,
          totalReferenceVolume: r.reference.volume ?? 0,
          topicRole: r.sitemap.topicRole,
          section: r.sitemap.section,
        });
      }
    }
    const clusters = Array.from(clusterMap.values()).sort((a, b) => b.totalReferenceVolume - a.totalReferenceVolume);

    const verified = results.filter(r => r.reference.source !== 'none').length;
    const coverage = results.length > 0 ? Math.round((verified / results.length) * 1000) / 1000 : 0;
    const clientReady = results.length > 0 && coverage >= CLIENT_READY_COVERAGE_THRESHOLD;
    if (!clientReady && results.length > 0) {
      warnings.push(
        `Volume ยืนยันได้ ${(coverage * 100).toFixed(0)}% (เกณฑ์ Client Ready ${CLIENT_READY_COVERAGE_THRESHOLD * 100}%) — คำที่ไม่มี volume แสดง N/A ตามจริง ไม่แต่งตัวเลข`
      );
    }
    const shortfallReason = results.length < targetCount
      ? `ได้ ${results.length} จากเป้า ${targetCount} คำ — candidate ที่ผ่านเกณฑ์ความเกี่ยวข้องกับธุรกิจมีเท่านี้ (ไม่เติมคำไม่เกี่ยวเพื่อให้ครบเป้า)`
      : null;
    if (shortfallReason) warnings.push(shortfallReason);

    const response: OnlineResearchResponse = {
      meta: {
        mode: 'online_business',
        researchId: null,
        generatedAt: new Date().toISOString(),
        businessType: input.businessType,
        businessTypeOther: input.businessTypeOther ?? null,
        brandName: input.brandName ?? null,
        websiteUrl: input.websiteUrl ?? null,
        strategyGoal: input.strategyGoal,
        weights: { traffic: preset.traffic, sales: preset.sales },
        finalWeights: preset.finalWeights,
        country: input.country ?? 'Thailand',
        language,
        targetCount,
        candidateCount: Math.max(pool.size, candidateCount),
        qualifiedCount: results.length,
        clientReady,
        verifiedVolumeCoverage: coverage,
        customerSource: blueprint.customerSource,
        warnings,
        shortfallReason,
      },
      blueprint,
      websiteContext: siteContext,
      results,
      clusters,
      sourceStatus: {
        googleKeywordPlanner: {
          status: !flags.useKeywordPlanner ? 'skipped' : kpStatus,
          coverage: results.length > 0
            ? Math.round((results.filter(r => r.google.status === 'ok' || r.google.status === 'zero').length / results.length) * 1000) / 1000
            : 0,
          geo: resolvedGeoLite ? `${resolvedGeoLite.name} (${resolvedGeoLite.level})` : 'Thailand (country)',
          fetchedAt: kpFetchedAt,
          message: kpMessage,
        },
        dataForSeo: {
          status: !hasDataForSeoCreds() || !flags.useDataForSeo
            ? 'skipped'
            : dfsError && dfsByKey.size === 0 ? 'error' : dfsByKey.size > 0 ? 'ok' : 'partial',
          coverage: results.length > 0
            ? Math.round((results.filter(r => r.dfs.status === 'ok' || r.dfs.status === 'zero').length / results.length) * 1000) / 1000
            : 0,
          fetchedAt: dfsFetchedAt,
          message: dfsError,
        },
        serp: {
          status: !hasDataForSeoCreds() || !flags.checkSerp
            ? 'skipped'
            : serpChecked > 0 ? 'ok' : serpErrors > 0 ? 'error' : 'skipped',
          checkedCount: serpChecked,
          fetchedAt: serpChecked > 0 ? new Date().toISOString() : null,
          message: serpErrors > 0 ? `ตรวจไม่สำเร็จ ${serpErrors} คำ` : undefined,
        },
        ai: {
          provider: 'openrouter/gemini',
          role: 'ตีความ/จัดหมวด/ตั้งชื่อเท่านั้น — ไม่ใช่แหล่งของตัวเลข volume/CPC/KD ใด ๆ',
        },
      },
    };

    // ── save canonical run ──────────────────────────────────────────────────
    if (flags.projectId) {
      try {
        const summaryJson = JSON.stringify({
          products: input.products,
          businessType: input.businessType,
          brandName: input.brandName ?? null,
          strategyGoal: input.strategyGoal,
          country: input.country ?? 'Thailand',
          targetCount,
          candidateCount: response.meta.candidateCount,
          qualifiedCount: results.length,
          clientReady,
          verifiedVolumeCoverage: coverage,
          generatedAt: response.meta.generatedAt,
        });
        if (runId) {
          response.meta.researchId = runId;
          await prisma.localKeywordResearchRun.update({
            where: { id: runId },
            data: {
              targetCount,
              candidateCount: response.meta.candidateCount,
              qualifiedCount: results.length,
              status: 'completed',
              clientReady,
              summary: summaryJson,
              resultData: JSON.stringify(response),
              phase: null,
              phaseState: null,
              lockedAt: null,
            },
          });
          progress(`บันทึกผลการวิจัยแล้ว (run ${runId})`, stepOf('finalize'));
        } else {
          const run = await prisma.localKeywordResearchRun.create({
            data: {
              organizationId: orgId,
              projectId: flags.projectId,
              mode: 'online_business',
              services: JSON.stringify(input.products),
              primaryLocation: input.country ?? 'Thailand',
              targetCount,
              candidateCount: response.meta.candidateCount,
              qualifiedCount: results.length,
              salesWeight: preset.sales / 100,
              trafficWeight: preset.traffic / 100,
              status: 'completed',
              clientReady,
              summary: summaryJson,
              resultData: JSON.stringify(response),
              createdById: userId,
            },
          });
          response.meta.researchId = run.id;
          progress(`บันทึกผลการวิจัยแล้ว (run ${run.id})`, stepOf('finalize'));
        }
      } catch (err) {
        response.meta.researchId = null;
        warnings.push(`บันทึก research run ไม่สำเร็จ (ผลลัพธ์ยังใช้ได้ แต่ export Excel ต้องรันใหม่): ${err instanceof Error ? err.message.slice(0, 100) : String(err)}`);
      }
    }

    // ── log ต้นทุน API ตามจริง ──
    if (dfsCalls > 0) {
      logAIJob({
        organizationId: orgId,
        projectId: flags.projectId,
        jobType: 'DFS_VOLUME_LOOKUP',
        modelProvider: 'DATAFORSEO',
        modelName: 'dataforseo/search_volume/live',
        status: 'SUCCESS',
        externalCost: dfsCalls * DFS_COST_PER_KEYWORD,
        externalCalls: dfsCalls,
        externalApi: 'DataForSEO',
        createdById: userId,
        inputSummary: `WordGod Online DFS cross-check — ${dfsCalls} lookups`,
      }).catch(() => {});
    }
    if (dfsExtraCalls > 0) {
      logAIJob({
        organizationId: orgId,
        projectId: flags.projectId,
        jobType: 'DFS_INTEL_LOOKUP',
        modelProvider: 'DATAFORSEO',
        modelName: 'dataforseo/labs+serp (ideas, ranked, intent, kd, serp)',
        status: 'SUCCESS',
        externalCost: dfsExtraCostUsd,
        externalCalls: dfsExtraCalls,
        externalApi: 'DataForSEO',
        createdById: userId,
        inputSummary: `WordGod Online intelligence — ${dfsExtraCalls} calls (SERP ${serpChecked} คำ)`,
      }).catch(() => {});
    }
    if (kpCalls > 0) {
      logAIJob({
        organizationId: orgId,
        projectId: flags.projectId,
        jobType: 'KP_VOLUME_LOOKUP',
        modelProvider: 'GOOGLE',
        modelName: 'google_ads/keyword_planner',
        status: kpStatus === 'unavailable' ? 'FAILED' : 'SUCCESS',
        externalCost: 0,
        externalCalls: kpCalls,
        externalApi: 'GoogleKeywordPlanner',
        createdById: userId,
        inputSummary: `WordGod Online — ${input.products.join(', ')} · ${kpCalls} lookups`,
      }).catch(() => {});
    }

    progress(`เสร็จสิ้น — ${results.length} คีย์เวิร์ดพร้อมใช้งาน (Client Ready: ${clientReady ? '✓' : '✗'})`, stepOf('finalize'));
    return response;
  };

  // ── Streaming NDJSON (แพทเทิร์นเดียวกับ local) ────────────────────────────
  const wantStream = body.stream === true || req.nextUrl.searchParams.get('stream') === '1';
  if (wantStream) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        let lastEmitAt = Date.now();
        const emit = (event: Record<string, unknown>) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
            lastEmitAt = Date.now();
          } catch {
            closed = true;
          }
        };
        const heartbeat = setInterval(() => {
          if (!closed && Date.now() - lastEmitAt >= 20_000) {
            emit({ type: 'heartbeat', at: new Date().toISOString() });
          }
        }, 20_000);
        if (resumable && runId) emit({ type: 'run', runId });
        runPipeline(emit)
          .then(response => {
            emit({ type: 'result', data: response });
            closed = true;
            clearInterval(heartbeat);
            try { controller.close(); } catch {}
          })
          .catch(async err => {
            if (err instanceof YieldSignal && runId) {
              try {
                await prisma.localKeywordResearchRun.update({ where: { id: runId }, data: { lockedAt: null } });
              } catch {}
              emit({ type: 'yield', runId, phase: err.stage });
            } else {
              if (resumable && runId) {
                try {
                  await prisma.localKeywordResearchRun.update({ where: { id: runId }, data: { lockedAt: null } });
                } catch {}
              }
              emit({ type: 'error', error: err instanceof Error ? err.message : String(err) });
            }
            closed = true;
            clearInterval(heartbeat);
            try { controller.close(); } catch {}
          });
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  try {
    const response = await runPipeline(() => {});
    return NextResponse.json(response);
  } catch (err) {
    if (resumable && runId) {
      try {
        await prisma.localKeywordResearchRun.update({ where: { id: runId }, data: { lockedAt: null } });
      } catch {}
    }
    if (err instanceof YieldSignal && runId) {
      return NextResponse.json({ resume: true, runId, phase: err.stage }, { status: 202 });
    }
    console.error('[online-research] pipeline failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Online research failed' },
      { status: 500 }
    );
  }
}
