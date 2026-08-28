/**
 * WordGod Local SME — /api/wordgod/local-research
 *
 * Local SEO Keyword Intelligence Engine (โหมด "มีหน้าร้าน" เท่านั้น)
 * เส้นทาง Standard (/api/wordgod-v2/pipeline) ไม่ถูกแตะต้อง
 *
 * สถาปัตยกรรม DATA → AI:
 *   สร้าง candidate (rule + problem-first + AI expand + DFS ideas + KP ideas)
 *   → ดึง metric จริงแยกแหล่ง (Google Keyword Planner / DataForSEO — ห้ามเฉลี่ยรวม)
 *   → search intent + KD + Local SERP (DataForSEO)
 *   → Sales/Traffic/Final score → กันคำชนกัน (location-swap + SERP overlap)
 *   → คัดตามโควตาคลัสเตอร์ → แบ่ง wave → เขียน SEO title (AI ทีหลังข้อมูลเสมอ)
 *   → บันทึกผลเป็น canonical run เดียว (UI/Excel อ่านชุดเดียวกัน)
 *
 * กติกา: ห้ามแต่งตัวเลข — AI ห้ามเป็นแหล่งของ volume/CPC/KD/competition (§32)
 * ZERO ≠ NULL ≠ API_ERROR และ reference volume = Google → DFS → NULL เสมอ
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logAIJob } from '@/lib/logAIJob';
import {
  assembleResults,
  generateLocalCandidates,
  KP_LOOKUP_LIMIT,
  LOCAL_KEYWORD_WEIGHTS,
  runLocalProblemDiscovery,
  type LocalRawItem,
  type MetricRecord,
} from '@/lib/wordgod/local';
import { runProblemToKeywordExpander } from '@/lib/skills/problemFirstSkill';
import { clusterKeywords, type PipelineKeyword } from '@/lib/skills/topicClusterSkill';
import type {
  KeywordResearchResult,
  LocalArea,
  LocalAreaType,
  LocalBusinessType,
  LocalKeywordSource,
  LocalLanguage,
  LocalResearchInput,
  LocalResearchResponse,
} from '@/lib/wordgod/local/types';
import { dedupeKey, hasForbiddenTerm, normalizeThaiSpacing, orderFreeKey } from '@/lib/wordgod/local/normalize';
import {
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
import {
  assignWaves,
  buildIntel,
  mergeBySerpOverlap,
  mergeByTextSimilarity,
  normalizeWeights,
  resolveLocationSwapGroups,
  selectWithClusterQuota,
  type CannibalizationAction,
  type ScoreContext,
} from '@/lib/wordgod/local/intelligence';
import {
  CLIENT_READY_COVERAGE_THRESHOLD,
  toSerpSignals,
  verifiedVolumeCoverage,
} from '@/lib/wordgod/local/enrichment';
import {
  getAccessToken,
  getHistoricalMetrics,
  getKeywordPlannerRows,
  loadGoogleAdsConfig,
  resolveGeoTargetChain,
  validateGoogleAdsConfig,
  type GeoTargetLevel,
  type MetricEntry,
  type ResolvedGeoTarget,
} from '@/lib/wordgod/services/googleKeywordPlannerService';
import {
  getDataForSeoKeywordDifficulty,
  getDataForSeoKeywordIdeas,
  getDataForSeoSearchIntents,
  getDataForSeoVolumes,
  getSerpLocalSignals,
  hasDataForSeoCreds,
  type DFSMetric,
} from '@/lib/wordgod/services/dataForSeoService';
import { callGemini, callGeminiWithGrounding } from '@/lib/wordgod/gemini';
import { buildRelevanceGuardPrompt, parseRelevanceGuardResponse, MAX_KEYWORDS_PER_CALL } from '@/lib/wordgod/local/relevanceGuard';
import { DFS_COST_PER_KEYWORD } from '@/lib/logAIJob';
import { KEYWORD_RESEARCH_PROMPT } from '@/lib/skills/keywordResearchSkill';

// โหมดมีหน้าร้าน generate หนักขึ้น (AI ขยาย pool + KP/DFS ดึง volume + SERP) เลยยืด
// timeout เท่าโหมดไม่มีหน้าร้าน (Vercel Pro สูงสุด) — กัน request ถูกตัดกลางคัน
export const maxDuration = 800;

const KP_UNAVAILABLE_MESSAGE =
  'ไม่สามารถดึงข้อมูล Search Volume ได้ในขณะนี้ แต่ยังสามารถวิเคราะห์ Local Intent และ Commercial Intent ได้';

const AREA_TYPES: LocalAreaType[] = [
  'district', 'subdistrict', 'province', 'road', 'bts', 'mrt', 'arl', 'landmark',
];

/** รับได้ทั้ง "บางแค" และ { name, type, parent } */
function parseArea(raw: unknown, fallbackType: LocalAreaType, index: number): LocalArea | null {
  if (typeof raw === 'string') {
    const name = normalizeThaiSpacing(raw);
    if (!name) return null;
    return { id: `${fallbackType}-${index}-${dedupeKey(name)}`, name, type: fallbackType };
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const name = normalizeThaiSpacing(String(obj.name ?? ''));
    if (!name) return null;
    const type = AREA_TYPES.includes(obj.type as LocalAreaType)
      ? (obj.type as LocalAreaType)
      : fallbackType;
    const parent = obj.parent ? String(obj.parent) : undefined;
    return {
      id: String(obj.id ?? `${type}-${index}-${dedupeKey(name)}`),
      name,
      type,
      parent,
      latitude: typeof obj.latitude === 'number' ? obj.latitude : undefined,
      longitude: typeof obj.longitude === 'number' ? obj.longitude : undefined,
    };
  }
  return null;
}

function toMetricRecord(entry: MetricEntry): MetricRecord {
  return {
    volume: typeof entry.volume === 'number' ? entry.volume : null,
    competition: entry.competition ?? null,
    competitionIndex: typeof entry.competition_index === 'number' ? entry.competition_index : null,
    bidLow: typeof entry.cpc_low === 'number' && entry.cpc_low > 0 ? entry.cpc_low : null,
    bidHigh: typeof entry.cpc_high === 'number' && entry.cpc_high > 0 ? entry.cpc_high : null,
    trend: Array.isArray(entry.monthly_trend) && entry.monthly_trend.length > 1 ? entry.monthly_trend : undefined,
  };
}

/** MetricEntry ของ KP → GoogleMetricData (เก็บแยกแหล่ง + geo + เวลา ตาม §26) */
function googleFromEntry(
  entry: MetricEntry,
  geo: { resolved: string; level: string },
  language: string
): GoogleMetricData {
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

/** แถว keyword ideas ของ KP → GoogleMetricData */
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

/** DFSMetric (search_volume/live) → DfsMetricData */
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

/** ไอเดียจาก KP ต้องเกี่ยวกับบริการหรือพื้นที่ที่ผู้ใช้ระบุ ไม่งั้นทิ้ง */
function isRelevantIdea(keyword: string, serviceKeys: string[], areaKeys: string[]): boolean {
  const key = dedupeKey(keyword);
  if (!key) return false;
  const hitsService = serviceKeys.some(s => s && key.includes(s));
  const hitsArea = areaKeys.some(a => a && key.includes(a));
  return hitsService && (areaKeys.length === 0 || hitsArea || /ใกล้ฉัน|ใกล้บ้าน/.test(keyword));
}

// กริยา/คำนำหน้าบริการที่พบบ่อย — ตัดออกเพื่อหา "คำแกน" ของบริการ
// เช่น "ล้างแอร์" → "แอร์" ทำให้คำโอกาสขายอย่าง "แอร์ไม่เย็น" ไม่ถูกทิ้ง
const SERVICE_VERB_PREFIXES = [
  'บริการ', 'รับจ้าง', 'รับ', 'ร้าน', 'ช่าง', 'ล้าง', 'ซ่อม', 'ติดตั้ง', 'เช่า',
  'ขาย', 'ทำความสะอาด', 'ทำ', 'ตรวจเช็ค', 'ตรวจ', 'เปลี่ยน', 'ย้าย', 'เติม', 'ดูแล', 'กำจัด',
];

/** สกัดคำแกนของบริการ (ตัดกริยานำหน้า + แตกคำตามช่องว่าง) ไว้จับคู่แบบกว้าง */
function buildServiceCoreKeys(services: string[]): string[] {
  const out = new Set<string>();
  for (const service of services) {
    for (const token of service.split(/\s+/)) {
      let core = dedupeKey(token);
      let stripped = true;
      while (stripped) {
        stripped = false;
        for (const prefix of SERVICE_VERB_PREFIXES) {
          if (core.length > prefix.length && core.startsWith(prefix)) {
            core = core.slice(prefix.length);
            stripped = true;
          }
        }
      }
      if (core.length >= 3) out.add(core);
    }
  }
  return Array.from(out);
}

type ProgressEmit = (event: Record<string, unknown>) => void;

// ── Step orchestration: pipeline ถูกซอยเป็น stage ตามลำดับนี้ ──────────────────
// โหมด resumable (จาก UI) จะ checkpoint state ลง DB ทุกจุดสำคัญ แล้ว "yield" เมื่อ
// ใกล้หมดงบเวลา/request — client ยิง request ใหม่พร้อม resumeRunId เพื่อทำต่อ
// ทำให้รัน 1000 คำบน Vercel (maxDuration 800s) ได้โดยไม่ถูกตัดกลางคัน
// โหมดเดิม (ไม่ส่ง resumable) พฤติกรรมเหมือนเดิมทุกอย่าง: รันรวดเดียวจบ
const STAGES = [
  'init', 'problem', 'expand', 'dfs_ideas', 'kp', 'dfs_volumes',
  'intent', 'kd', 'serp', 'intel', 'titles', 'clusters', 'finalize',
] as const;
type StageName = (typeof STAGES)[number];
const stageIdx = (s: string) => Math.max(0, STAGES.indexOf(s as StageName));

/** โยนเพื่อจบ request ปัจจุบันหลังบันทึก checkpoint แล้ว — ไม่ใช่ error จริง */
class YieldSignal extends Error {
  constructor(public stage: StageName) { super(`yield:${stage}`); }
}

const LOCK_STALE_MS = 5 * 60 * 1000; // lock ที่ไม่ถูก refresh เกิน 5 นาที = request ก่อนตายแล้ว
const DEFAULT_STEP_BUDGET_MS = 240_000; // งบเวลาทำงานต่อ request ในโหมด resumable (~4 นาที)

type RunFlags = {
  useProblemFirst: boolean;
  useAiExpand: boolean;
  useDfsIdeas: boolean;
  useKeywordPlanner: boolean;
  expandWithKp: boolean;
  useDataForSeo: boolean;
  checkSerp: boolean;
  buildTopicClusters: boolean;
  forceRefresh: boolean;
  projectId: string | null;
  stepBudgetMs: number;
};

const mapToEntries = <V,>(m: Map<string, V>) => Array.from(m.entries());

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

  let input: LocalResearchInput;
  let targetCount: number;
  let weights: { sales: number; traffic: number };
  let flags: RunFlags;
  let runId: string | null = null;
  let ckptData: any = null;
  let entryStage: StageName = 'init';

  if (resumeRunId) {
    // ── Resume: โหลด input + checkpoint จาก run เดิม (ไม่เชื่อ input จาก client ซ้ำ) ──
    const staleBefore = new Date(Date.now() - LOCK_STALE_MS);
    const locked = await prisma.localKeywordResearchRun.updateMany({
      where: {
        id: resumeRunId,
        organizationId: orgId,
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
        // run จบไปแล้ว (เช่น client retry ชนกับ request ที่เพิ่งเสร็จ) — คืนผลที่บันทึกไว้เลย
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
    input = saved.input as LocalResearchInput;
    targetCount = Number(saved.targetCount) || 50;
    weights = saved.weights;
    flags = saved.flags as RunFlags;
    if (Number(body.stepBudgetMs) > 0) flags.stepBudgetMs = Number(body.stepBudgetMs);
  } else {
    const services: string[] = Array.isArray(body.services)
      ? body.services.map((s: unknown) => normalizeThaiSpacing(String(s ?? ''))).filter(Boolean)
      : [];
    if (services.length === 0) {
      return NextResponse.json({ error: 'ต้องระบุบริการ / คำหลักอย่างน้อย 1 รายการ' }, { status: 400 });
    }

    const primaryLocation = parseArea(body.primaryLocation, 'district', 0);
    if (!primaryLocation) {
      return NextResponse.json({ error: 'ต้องระบุพื้นที่หลัก' }, { status: 400 });
    }

    const nearbyLocations = (Array.isArray(body.nearbyLocations) ? body.nearbyLocations : [])
      .map((raw: unknown, i: number) => parseArea(raw, 'district', i + 1))
      .filter(Boolean) as LocalArea[];

    const businessType: LocalBusinessType =
      body.businessType === 'storefront' || body.businessType === 'hybrid'
        ? body.businessType
        : 'service_area';
    // จำนวน Final Qualified SEO Opportunities ที่ต้องการ (candidate pool จะใหญ่กว่านี้มาก)
    targetCount = Math.min(Math.max(Math.round(Number(body.targetCount) || 50), 10), 1000);
    const language: LocalLanguage = body.language === 'th_en' ? 'th_en' : 'th';

    // น้ำหนัก Sales/Traffic (default 60/40) — รับได้ทั้งสัดส่วน (0.6) และเปอร์เซ็นต์ (60)
    const rawSalesW = Number(body.salesWeight);
    const rawTrafficW = Number(body.trafficWeight);
    weights = normalizeWeights(
      isFinite(rawSalesW) ? (rawSalesW > 1 ? rawSalesW / 100 : rawSalesW) : undefined,
      isFinite(rawTrafficW) ? (rawTrafficW > 1 ? rawTrafficW / 100 : rawTrafficW) : undefined
    );

    input = {
      services,
      primaryLocation,
      nearbyLocations,
      businessType,
      serviceRadiusKm: typeof body.serviceRadiusKm === 'number' ? body.serviceRadiusKm : null,
      language,
      businessContext: body.businessContext ? String(body.businessContext) : undefined,
    };
    flags = {
      useProblemFirst: body.useProblemFirst !== false,
      useAiExpand: body.useAiExpand !== false,
      useDfsIdeas: body.useDfsIdeas !== false,
      useKeywordPlanner: body.useKeywordPlanner !== false,
      expandWithKp: body.expandWithKeywordPlanner !== false,
      useDataForSeo: body.useDataForSeo !== false,
      checkSerp: body.checkSerp !== false,
      buildTopicClusters: body.buildTopicClusters !== false,
      forceRefresh: !!body.forceRefresh,
      projectId: body.projectId ? String(body.projectId) : null,
      stepBudgetMs: Number(body.stepBudgetMs) > 0
        ? Number(body.stepBudgetMs)
        : Number(process.env.LOCAL_RESEARCH_STEP_BUDGET_MS) > 0
          ? Number(process.env.LOCAL_RESEARCH_STEP_BUDGET_MS)
          : DEFAULT_STEP_BUDGET_MS,
    };
  }

  // resumable ต้องมี projectId (checkpoint เก็บใน run row ของโปรเจกต์) — ไม่มีก็รันรวดเดียวแบบเดิม
  const resumable = resumeRunId !== null || (body.resumable === true && !!flags.projectId);
  if (resumable && !runId) {
    const run = await prisma.localKeywordResearchRun.create({
      data: {
        organizationId: orgId,
        projectId: flags.projectId!,
        mode: 'local_storefront',
        services: JSON.stringify(input.services),
        primaryLocation: input.primaryLocation.name,
        targetCount,
        salesWeight: weights.sales,
        trafficWeight: weights.traffic,
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

    const { services, primaryLocation } = input;
    const nearbyLocations = input.nearbyLocations ?? [];
    const language = input.language ?? 'th';

    // ── State ทั้งหมดต่อไปนี้ serialize เป็น JSON checkpoint ได้ (โหมด resumable) ──
    const warnings: string[] = Array.isArray(ckptData?.warnings) ? ckptData.warnings : [];

    // ── ชั้นข้อมูลแยกแหล่งต่อคีย์เวิร์ด (key = dedupeKey) — ห้ามเฉลี่ยรวมข้ามแหล่ง ──
    const googleByKey = new Map<string, GoogleMetricData>(ckptData?.google ?? []);
    const dfsByKey = new Map<string, DfsMetricData>(ckptData?.dfs ?? []);
    const intentByKey = new Map<string, SearchIntentData>(ckptData?.intents ?? []);
    const serpByKey = new Map<string, SerpSignals>(ckptData?.serpSignals ?? []);
    let dfsExtraCostUsd = ckptData?.c?.dfsExtraCostUsd ?? 0; // intent + ideas + KD + SERP (คิดตาม task.cost จริงจาก API)
    let dfsExtraCalls = ckptData?.c?.dfsExtraCalls ?? 0;

    const items = new Map<string, LocalRawItem>();
    if (Array.isArray(ckptData?.items)) {
      for (const it of ckptData.items as LocalRawItem[]) items.set(dedupeKey(it.keyword), it);
    }
    // ดัชนีคีย์แบบไม่สนลำดับคำ → dedupeKey เจ้าของ ("ล้างแอร์ บางนา ราคาถูก" = "บางนา ล้างแอร์ ราคาถูก")
    const orderIndex = new Map<string, string>();
    for (const [key, it] of Array.from(items.entries())) {
      const ok = orderFreeKey(it.keyword);
      if (!orderIndex.has(ok)) orderIndex.set(ok, key);
    }
    /**
     * ขอสิทธิ์เพิ่มคำใหม่ลง items — คืน dedupeKey เมื่อเพิ่มได้จริง
     * คืน null เมื่อเป็นคำเดิม (ตรงตัว หรือสลับตำแหน่ง/คำพ้อง) โดยรวม source
     * เข้าเจ้าของเดิม และเก็บรูปเขียนนี้ไว้เป็น variant ของเจ้าของ
     */
    const claimKey = (keyword: string, source: LocalKeywordSource): string | null => {
      const key = dedupeKey(keyword);
      if (!key) return null;
      if (hasForbiddenTerm(keyword)) return null; // คำพ่วงเว็บบอร์ด (pantip ฯลฯ) — ไม่เอาเข้าตาราง

      const existing = items.get(key);
      if (existing) {
        if (!existing.sources.includes(source)) existing.sources.push(source);
        return null;
      }
      const oKey = orderFreeKey(keyword);
      const ownerKey = orderIndex.get(oKey);
      if (ownerKey && ownerKey !== key) {
        const owner = items.get(ownerKey);
        if (owner) {
          if (!owner.sources.includes(source)) owner.sources.push(source);
          const vars = owner.variants ?? (owner.variants = []);
          if (!vars.includes(keyword)) vars.push(keyword);
          return null;
        }
      }
      orderIndex.set(oKey, key);
      return key;
    };
    const generatedTrafficKeys = new Set<string>(ckptData?.trafficKeys ?? []);
    let generatedCount: number = ckptData?.c?.generatedCount ?? 0;

    // สถานะสะสมของแหล่งข้อมูล (ต้องรอดข้าม request ตอน resume)
    let kpStatus: 'ok' | 'partial' | 'unavailable' | 'skipped' = ckptData?.kp?.status ?? 'skipped';
    let kpMessage: string | undefined = ckptData?.kp?.message ?? undefined;
    let kpCalls: number = ckptData?.kp?.calls ?? 0;
    let enrichedCount: number = ckptData?.c?.enrichedCount ?? 0;
    let kpFetchedAt: string | null = ckptData?.kp?.fetchedAt ?? null;
    let geoTarget: { requested: string; resolved: string; level: GeoTargetLevel } =
      ckptData?.kp?.geoTarget ?? { requested: primaryLocation.name, resolved: 'Thailand', level: 'country' };
    let resolvedGeoLite: { name: string; level: GeoTargetLevel; resourceName: string } | null =
      ckptData?.kp?.resolvedGeo ?? null;
    let dfsCalls: number = ckptData?.c?.dfsCalls ?? 0;
    let dfsError: string | undefined = ckptData?.c?.dfsError ?? undefined;
    let dfsFetchedAt: string | null = ckptData?.c?.dfsFetchedAt ?? null;
    let serpChecked: number = ckptData?.c?.serpChecked ?? 0;
    let serpErrors: number = ckptData?.c?.serpErrors ?? 0;
    let candidateCount: number = ckptData?.c?.candidateCount ?? 0;
    let qualifiedCount: number = ckptData?.c?.qualifiedCount ?? 0;
    let titleFailures: number = ckptData?.c?.titleFailures ?? 0;

    // ผลหลัง stage intel (ตาราง canonical) + งาน AI ท้าย pipeline ที่ทำค้างไว้
    type ClusterMembership = { clusterId: number; clusterName: string; role: 'pillar' | 'supporting'; pillarSlug: string };
    let results: KeywordResearchResult[] = Array.isArray(ckptData?.results) ? ckptData.results : [];
    let clusters: ReturnType<typeof assembleResults>['clusters'] = Array.isArray(ckptData?.clusters) ? ckptData.clusters : [];
    const titleByKey = new Map<string, { title?: string; slug?: string }>(ckptData?.titles ?? []);
    const clusterByKey = new Map<string, ClusterMembership>(ckptData?.clusterMembers ?? []);
    let topicClusters: Array<{ clusterId: number; name: string; pillarSlug: string; memberSlugs: string[]; totalVolume: number }> =
      Array.isArray(ckptData?.topicClusters) ? ckptData.topicClusters : [];

    /** stage นี้ต้องรันใน request นี้ไหม (stage ก่อน entryStage ถูกทำ+checkpoint ไปแล้ว) */
    const needs = (s: StageName) => stageIdx(entryStage) <= stageIdx(s);
    /** cursor ภายใน stage — ใช้ค่าที่ checkpoint ไว้เฉพาะตอน resume เข้า stage เดียวกัน */
    const cursor = <T,>(stage: StageName, field: string, dflt: T): T =>
      entryStage === stage && ckptData && ckptData[field] !== undefined ? (ckptData[field] as T) : dflt;

    const snapshot = (nextStage: StageName, extra: Record<string, unknown>) => {
      // หลังผ่าน intel แล้ว pool/metric maps ไม่ถูกใช้อีก — ตัดทิ้งให้ checkpoint เบา
      const lean = stageIdx(nextStage) > stageIdx('intel');
      return JSON.stringify({
        v: 1,
        input, targetCount, weights, flags,
        warnings,
        items: lean ? [] : Array.from(items.values()),
        trafficKeys: Array.from(generatedTrafficKeys),
        google: lean ? [] : mapToEntries(googleByKey),
        dfs: lean ? [] : mapToEntries(dfsByKey),
        intents: lean ? [] : mapToEntries(intentByKey),
        serpSignals: lean ? [] : mapToEntries(serpByKey),
        kp: { status: kpStatus, message: kpMessage, calls: kpCalls, fetchedAt: kpFetchedAt, geoTarget, resolvedGeo: resolvedGeoLite },
        c: {
          dfsExtraCostUsd, dfsExtraCalls, enrichedCount, dfsCalls, dfsError, dfsFetchedAt,
          serpChecked, serpErrors, candidateCount, qualifiedCount, generatedCount, titleFailures,
        },
        results, clusters,
        titles: mapToEntries(titleByKey),
        clusterMembers: mapToEntries(clusterByKey),
        topicClusters,
        ...extra,
      });
    };

    /**
     * บันทึกความคืบหน้าลง run row แล้วเช็คงบเวลา — เกินงบ = โยน YieldSignal
     * ให้ driver ปิด request นี้ (client จะยิง resumeRunId มาทำต่อจากจุดนี้)
     * โหมดไม่ resumable: no-op ทั้งหมด — พฤติกรรมเดิมเป๊ะ
     */
    const checkpoint = async (nextStage: StageName, extra: Record<string, unknown> = {}) => {
      if (!resumable || !runId) return;
      await prisma.localKeywordResearchRun.update({
        where: { id: runId },
        data: {
          phase: nextStage,
          phaseState: snapshot(nextStage, extra),
          candidateCount: Math.max(items.size, candidateCount),
          lockedAt: new Date(),
        },
      });
      if (Date.now() - startedAt > budgetMs) throw new YieldSignal(nextStage);
    };

    if (entryStage !== 'init') {
      progress(`ทำต่อจาก checkpoint เดิม (ขั้น ${entryStage}) — pool ${items.size} คำ`);
    }

    if (needs('init')) {
      progress(`เริ่มวิเคราะห์: ${services.join(', ')} @ ${primaryLocation.name} — เป้า ${targetCount} SEO Opportunities (Sales ${Math.round(weights.sales * 100)}% / Traffic ${Math.round(weights.traffic * 100)}%)`);
      const candidates = generateLocalCandidates(input);
      for (const candidate of candidates) {
        const key = claimKey(candidate.keyword, 'generated');
        if (!key) continue;
        items.set(key, {
          keyword: candidate.keyword,
          sources: ['generated'] as LocalKeywordSource[],
          candidate,
          metric: null,
        });
      }
      generatedCount = candidates.length;
      progress(`สร้าง candidate จากโครงสร้างบริการ×พื้นที่ ${items.size} คำ`, { count: items.size });
      await checkpoint('problem');
    }

    // ── Problem-first: แตก topic universe → ปัญหาลูกค้า → คำ solution/วิธี/ความรู้ ──
    if (needs('problem') && flags.useProblemFirst) {
      try {
        progress('วิเคราะห์ปัญหาจริงของลูกค้า (problem-first) …');
        const niche = services.join(' / ');
        const excludeSet = new Set(Array.from(items.keys()));
        const groundedCb = (p: string) => callGeminiWithGrounding(p, true);
        const { problems } = await runLocalProblemDiscovery(
          { services, primaryLocation, nearbyLocations, businessContext: input.businessContext, language },
          { callGeminiWithGrounding: groundedCb }
        );
        if (problems.length > 0) {
          const expanded = await runProblemToKeywordExpander(problems, niche, excludeSet, () => {}, groundedCb);
          let addedPf = 0;
          for (const pk of expanded.keywords) {
            const keyword = normalizeThaiSpacing(pk.keyword);
            const key = claimKey(keyword, 'generated');
            if (!key) continue;
            items.set(key, { keyword, sources: ['generated'] as LocalKeywordSource[], metric: null });
            generatedTrafficKeys.add(key);
            addedPf++;
          }
          if (addedPf > 0) {
            warnings.push(`เพิ่มคำปัญหา/วิธี/ความรู้ (topic universe) ${addedPf} คำ จาก ${problems.length} ปัญหาจริงของลูกค้า — เป็นคำ traffic/บทความ จะดึง volume จริงต่อไป`);
            progress(`ได้คำปัญหา/บทความ ${addedPf} คำ จาก ${problems.length} ปัญหา`, { count: items.size });
          }
        }
      } catch (err) {
        warnings.push(`สร้างคำปัญหา/บทความอัตโนมัติไม่สำเร็จ: ${err instanceof Error ? err.message.slice(0, 80) : String(err)}`);
      }
    }
    if (needs('problem')) await checkpoint('expand');

    // ── AI expansion: ขยาย pool คำที่ "เกี่ยวกับธุรกิจ + มีโอกาสขาย" ให้ใหญ่กว่าเป้า ──
    // AI มีหน้าที่แค่ "เสนอ candidate" — ตัวเลขทุกตัวต้องผ่าน KP/DFS ยืนยันจริง (§32)
    if (needs('expand') && flags.useAiExpand) {
      const poolTarget = Math.min(Math.ceil(targetCount * 1.3), 900);
      const startWave = cursor('expand', 'expandWave', 0);
      if (items.size < poolTarget || startWave > 0) {
        if (startWave === 0) progress(`ขยาย candidate pool ด้วย AI (เป้า pool ~${poolTarget} คำ) …`);
        const salesRatio = { informational: 40, commercial: 35, transactional: 20, navigational: 5, update: 0 };
        const genNiche = `${services.join(' / ')}${input.businessContext ? ` — ${input.businessContext}` : ''}`;
        const genSeed = services[0];
        const BATCH = 50;
        const PARALLEL = targetCount <= 100 ? 2 : targetCount <= 400 ? 4 : 6;
        const MAX_WAVES = 6;
        let genAdded = cursor('expand', 'expandAdded', 0);
        let genFailed = cursor('expand', 'expandFailed', 0);
        for (let wave = startWave; wave < MAX_WAVES && items.size < poolTarget; wave++) {
          const need = poolTarget - items.size;
          const batches = Math.min(PARALLEL, Math.max(1, Math.ceil(need / BATCH)));
          const exclude = Array.from(items.values()).map(it => it.keyword);
          const prompts = Array.from({ length: batches }, () =>
            KEYWORD_RESEARCH_PROMPT(genNiche, genSeed, BATCH, exclude, [], salesRatio, false)
          );
          const settled = await Promise.allSettled(prompts.map(p => callGemini(p)));
          let waveAdded = 0;
          for (const s of settled) {
            if (s.status !== 'fulfilled') { genFailed++; continue; }
            const text = typeof s.value === 'string' ? s.value : JSON.stringify(s.value);
            const m = text.match(/\{[\s\S]*\}/);
            if (!m) continue;
            let parsed: { keywords?: Array<{ keyword?: string }> };
            try { parsed = JSON.parse(m[0]); } catch { continue; }
            for (const row of parsed.keywords ?? []) {
              const kw = normalizeThaiSpacing(String(row?.keyword ?? '').trim());
              const key = claimKey(kw, 'generated');
              if (!key) continue;
              items.set(key, { keyword: kw, sources: ['generated'] as LocalKeywordSource[], metric: null });
              generatedTrafficKeys.add(key);
              waveAdded++; genAdded++;
            }
          }
          progress(`AI expansion รอบ ${wave + 1}: +${waveAdded} คำ (pool ${items.size})`, { count: items.size });
          const stop = waveAdded === 0; // กันลูปเปล่า (AI ตอบซ้ำ/ล้มเหลวทั้งหมด)
          await checkpoint('expand', {
            expandWave: stop ? MAX_WAVES : wave + 1,
            expandAdded: genAdded,
            expandFailed: genFailed,
          });
          if (stop) break;
        }
        if (genAdded > 0) {
          warnings.push(`ขยายคำที่เกี่ยวกับธุรกิจ (เน้นโอกาสขาย) ด้วย AI อีก ${genAdded} คำ (pool รวม ${items.size} คำ) — จะดึง Search Volume จริงต่อไป`);
        } else if (genFailed > 0) {
          warnings.push('ขยายคำด้วย AI ไม่สำเร็จรอบนี้ — ใช้คำจาก seed/ปัญหาลูกค้าที่มีอยู่');
        }
      }
    }
    if (needs('expand')) await checkpoint('dfs_ideas');

    // ── DataForSEO keyword ideas: ขยาย candidate จากข้อมูลจริงของ DFS Labs ──
    // (volume ในผลนี้ถูกเก็บเข้า dfsByKey แยกแหล่งทันที — ไม่ปนกับ Google)
    if (needs('dfs_ideas') && hasDataForSeoCreds() && flags.useDfsIdeas) {
      try {
        progress('ขยาย candidate จาก DataForSEO keyword ideas …');
        const seeds = [
          ...services,
          ...services.map(s => `${s} ${primaryLocation.name}`),
        ].slice(0, 20);
        const ideaLimit = Math.min(1000, Math.max(200, targetCount));
        const dfsIdeas = await getDataForSeoKeywordIdeas(seeds, { limit: ideaLimit });
        dfsExtraCostUsd += dfsIdeas.costUsd;
        dfsExtraCalls += 1;
        if (dfsIdeas.error && dfsIdeas.ideas.length === 0) {
          warnings.push(`DataForSEO keyword ideas ไม่สำเร็จ: ${dfsIdeas.error}`);
        } else {
          const serviceKeys = services.map(dedupeKey);
          const coreKeys = buildServiceCoreKeys(services);
          let added = 0;
          for (const idea of dfsIdeas.ideas) {
            const keyword = normalizeThaiSpacing(idea.keyword);
            const key = dedupeKey(keyword);
            if (!key) continue;
            const relevant = serviceKeys.some(sv => sv && key.includes(sv)) || coreKeys.some(ck => key.includes(ck));
            const existing = items.get(key);
            if (!existing && (!relevant || added >= 200)) continue;
            // เก็บ metric ฝั่ง DFS แยกแหล่ง (ครั้งแรกเท่านั้น — ค่า search_volume/live ภายหลังทับได้)
            if (!dfsByKey.has(key)) {
              const vol = idea.searchVolume;
              dfsByKey.set(key, {
                searchVolume: vol,
                monthlySearches: null,
                cpc: idea.cpc,
                competition: null,
                competitionIndex: idea.competitionIndex,
                keywordDifficulty: idea.keywordDifficulty,
                locationCode: 2764,
                language: 'th',
                retrievedAt: new Date().toISOString(),
                status: vol === null ? 'no_data' : vol === 0 ? 'zero' : 'ok',
              });
            }
            if (existing) {
              existing.sources = Array.from(new Set([...existing.sources, 'dataforseo' as LocalKeywordSource]));
              continue;
            }
            const claimed = claimKey(keyword, 'dataforseo');
            if (!claimed) continue;
            items.set(claimed, { keyword, sources: ['dataforseo'] as LocalKeywordSource[], metric: null });
            added++;
          }
          if (added > 0) {
            warnings.push(`เพิ่ม candidate จาก DataForSEO keyword ideas อีก ${added} คำ (คัดเฉพาะที่ตรงบริการ)`);
            progress(`DataForSEO ideas: +${added} คำ (pool ${items.size})`, { count: items.size });
          }
        }
      } catch (err) {
        warnings.push(`DataForSEO keyword ideas ไม่สำเร็จ: ${err instanceof Error ? err.message.slice(0, 80) : String(err)}`);
      }
    }
    if (needs('dfs_ideas')) await checkpoint('kp');

    // ── Google Keyword Planner (Primary Client Reference Volume) ─────────────
    // ซอยเป็น 3 sub-step (kpStep) ให้ checkpoint/resume ระหว่างกลางได้:
    // 0 = geo + volume หลัก (+ระดับประเทศให้คำ traffic), 1 = ideas เจาะพื้นที่, 2 = ideas คำกว้าง
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
          let kpStep = cursor('kp', 'kpStep', 0);

          if (kpStep === 0) {
          // ลำดับพื้นที่: เขต/อำเภอ → จังหวัด → กรุงเทพฯ → ประเทศไทย (§8)
          // ห้าม AI เดา geo — เก็บทั้ง "ที่ขอ" และ "ที่ resolve ได้จริง" เสมอ
          const geoCandidates = [primaryLocation.name];
          if (primaryLocation.parent) geoCandidates.push(primaryLocation.parent);
          if (/กรุงเทพ|กทม|bangkok/i.test(`${primaryLocation.name} ${primaryLocation.parent ?? ''}`)) {
            geoCandidates.push('Bangkok');
          }
          let geoApiError: string | null = null;
          const resolvedGeo = await resolveGeoTargetChain(config, accessToken, geoCandidates, detail => {
            if (!geoApiError) geoApiError = detail;
            console.warn('[local-research] geo target lookup failed:', detail);
          });
          resolvedGeoLite = { name: resolvedGeo.name, level: resolvedGeo.level, resourceName: resolvedGeo.resourceName };
          geoTarget = {
            requested: primaryLocation.name,
            resolved: resolvedGeo.name,
            level: resolvedGeo.level,
          };
          progress(`Geo: ขอ "${geoTarget.requested}" → ใช้จริง "${geoTarget.resolved}" (ระดับ ${geoTarget.level})`);
          if (resolvedGeo.level === 'country') {
            warnings.push(
              geoApiError
                ? `เจาะจงพื้นที่ "${primaryLocation.name}" ไม่ได้เพราะเรียก Google Ads ไม่สำเร็จ — ใช้ข้อมูลระดับประเทศแทน (${geoApiError})`
                : `Keyword Planner ไม่มีพื้นที่ "${primaryLocation.name}" ให้เจาะจง — ใช้ข้อมูลระดับประเทศแทน`
            );
          }

          // ดึง volume "คำที่เกี่ยวข้อง/มีโอกาสขายสูงสุดก่อน" — ไม่ใช่ตามลำดับ insert
          const rankedForKp = assembleResults(Array.from(items.values()), input).results;
          const lookupKeywords = rankedForKp.slice(0, KP_LOOKUP_LIMIT).map(r => r.keyword);
          if (rankedForKp.length > KP_LOOKUP_LIMIT) {
            warnings.push(
              `ดึง Search Volume เฉพาะ ${KP_LOOKUP_LIMIT} คำที่เกี่ยวข้อง/มีโอกาสขายสูงสุด (ทั้งหมด ${rankedForKp.length} คำ)`
            );
          }

          progress(`ดึง Google Keyword Planner ${lookupKeywords.length} คำ @ ${geoTarget.resolved} …`);
          const metrics = await getHistoricalMetrics(
            lookupKeywords,
            config,
            accessToken,
            'th',
            'Thailand',
            warning => warnings.push(warning),
            resolvedGeo.resourceName
          );
          kpCalls = lookupKeywords.length;
          kpFetchedAt = new Date().toISOString();

          const geoInfo = { resolved: resolvedGeo.name, level: resolvedGeo.level };
          for (const item of Array.from(items.values())) {
            const entry = metrics.get(item.keyword.trim().toLowerCase());
            if (!entry) continue;
            item.metric = toMetricRecord(entry);
            item.sources = Array.from(new Set([...item.sources, 'keyword_planner' as LocalKeywordSource]));
            googleByKey.set(dedupeKey(item.keyword), googleFromEntry(entry, geoInfo, 'th'));
            enrichedCount++;
          }
          progress(`Google Keyword Planner ตอบ ${enrichedCount} คำ`, { count: enrichedCount });

          kpStatus = enrichedCount > 0
            ? (enrichedCount < lookupKeywords.length ? 'partial' : 'ok')
            : 'partial';
          if (enrichedCount === 0) {
            kpMessage = 'Keyword Planner ไม่มีข้อมูลปริมาณการค้นหาสำหรับคำในชุดนี้';
          }

          // ── volume ระดับประเทศสำหรับคำ problem/traffic (บทความ) ──
          // คำหาความรู้/วิธี แทบไม่มี volume ระดับเขต — ยิงซ้ำระดับประเทศเฉพาะที่ยังไม่มี metric
          if (generatedTrafficKeys.size > 0) {
            const pfKeywords = Array.from(items.values())
              .filter(it => generatedTrafficKeys.has(dedupeKey(it.keyword)) && !it.metric)
              .map(it => it.keyword)
              .slice(0, KP_LOOKUP_LIMIT);
            if (pfKeywords.length > 0) {
              progress(`ดึง volume ระดับประเทศให้คำ traffic/บทความ ${pfKeywords.length} คำ …`);
              const natMetrics = await getHistoricalMetrics(
                pfKeywords, config, accessToken, 'th', 'Thailand', warning => warnings.push(warning)
              );
              const natGeo = { resolved: 'Thailand', level: 'country' };
              let natEnriched = 0;
              for (const item of Array.from(items.values())) {
                if (item.metric) continue;
                const entry = natMetrics.get(item.keyword.trim().toLowerCase());
                if (!entry) continue;
                item.metric = toMetricRecord(entry);
                item.sources = Array.from(new Set([...item.sources, 'keyword_planner' as LocalKeywordSource]));
                googleByKey.set(dedupeKey(item.keyword), googleFromEntry(entry, natGeo, 'th'));
                enrichedCount++;
                natEnriched++;
              }
              kpCalls += pfKeywords.length;
              if (natEnriched > 0) warnings.push(`ดึง Search Volume ระดับประเทศให้คำ traffic/บทความ ${natEnriched} คำ`);
            }
          }

          // ── รวมกลุ่ม close variants ตามที่ Keyword Planner จัดให้ (planner_canonical) ──
          // หลายคำที่ KP ตอบ canonical เดียวกัน = คำเดียวกันในสายตา Google
          // เก็บตัวแทนเดียว ที่เหลือเป็น variant (จะโผล่เป็นคำรองตอนสรุปผล)
          const byCanonical = new Map<string, string[]>();
          for (const key of Array.from(items.keys())) {
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
            const keeperKey = keys.includes(cKey) ? cKey : keys[0];
            const keeper = items.get(keeperKey);
            if (!keeper) continue;
            for (const k of keys) {
              if (k === keeperKey) continue;
              const it = items.get(k);
              if (!it) continue;
              const vars = keeper.variants ?? (keeper.variants = []);
              if (!vars.includes(it.keyword)) vars.push(it.keyword);
              keeper.sources = Array.from(new Set([...keeper.sources, ...it.sources]));
              items.delete(k);
              orderIndex.set(orderFreeKey(it.keyword), keeperKey);
              variantMerged++;
            }
          }
          if (variantMerged > 0) {
            progress(`รวม close variants ตามการจัดกลุ่มของ Keyword Planner ${variantMerged} คำ`, { count: items.size });
            warnings.push(`Google Keyword Planner นับหลายรูปคำเป็นคำเดียวกัน — ยุบรวมแล้ว ${variantMerged} คำ (เก็บเป็นคำรองของตัวแทน)`);
          }

          kpStep = 1;
          await checkpoint('kp', { kpStep });
          } // จบ kpStep 0

          // ── ขยายผลด้วยไอเดียจริงจาก KP (ตัวเลือกเสริม) ────────────────────
          const ideaGeoInfo = { resolved: geoTarget.resolved, level: geoTarget.level };
          if (flags.expandWithKp && resolvedGeoLite) {
            if (kpStep === 1) {
            progress('ขยาย candidate จาก Keyword Planner ideas (เจาะพื้นที่) …');
            const ideas = await getKeywordPlannerRows({
              seed_keywords: services.slice(0, 5).map(s => `${s}${primaryLocation.name}`),
              target_language: 'th',
              target_country: 'Thailand',
              google_ads_geo_target_resources: [resolvedGeoLite.resourceName],
              number_of_results: 200,
              force_refresh: flags.forceRefresh,
            });
            if (ideas.warnings?.length) warnings.push(...ideas.warnings);
            if (ideas.success) {
              const serviceKeys = services.map(dedupeKey);
              const areaKeys = [primaryLocation, ...nearbyLocations].map(a => dedupeKey(a.name));
              let added = 0;
              for (const row of ideas.rows) {
                const keyword = normalizeThaiSpacing(row.keyword);
                const key = dedupeKey(keyword);
                if (!key) continue;
                const existing = items.get(key);
                if (existing) {
                  existing.sources = Array.from(new Set([...existing.sources, 'keyword_planner' as LocalKeywordSource]));
                  if (!googleByKey.has(key)) googleByKey.set(key, googleFromIdeaRow(row, ideaGeoInfo, 'th'));
                  if (!existing.metric) {
                    existing.metric = {
                      volume: row.volume,
                      competition: row.competition ?? null,
                      competitionIndex: typeof row.competition_index === 'number' ? row.competition_index : null,
                      bidLow: row.low_cpc > 0 ? row.low_cpc : null,
                      bidHigh: row.high_cpc > 0 ? row.high_cpc : null,
                      trend: Array.isArray(row.monthly_trend) ? row.monthly_trend : undefined,
                    };
                    enrichedCount++;
                  }
                  continue;
                }
                if (!isRelevantIdea(keyword, serviceKeys, areaKeys)) continue;
                if (added >= 150) break;
                if (claimKey(keyword, 'keyword_planner') !== key) continue;
                items.set(key, {
                  keyword,
                  sources: ['keyword_planner'],
                  metric: {
                    volume: row.volume,
                    competition: row.competition ?? null,
                    competitionIndex: typeof row.competition_index === 'number' ? row.competition_index : null,
                    bidLow: row.low_cpc > 0 ? row.low_cpc : null,
                    bidHigh: row.high_cpc > 0 ? row.high_cpc : null,
                    trend: Array.isArray(row.monthly_trend) ? row.monthly_trend : undefined,
                  },
                });
                googleByKey.set(key, googleFromIdeaRow(row, ideaGeoInfo, 'th'));
                added++;
                enrichedCount++;
              }
              kpCalls += ideas.rows.length;
              if (added > 0) progress(`KP ideas (เจาะพื้นที่): +${added} คำ`, { count: items.size });
            } else if (ideas.error) {
              warnings.push(`ขยายผลจาก Keyword Planner ไม่สำเร็จ: ${ideas.error}`);
            }
            kpStep = 2;
            await checkpoint('kp', { kpStep });
            } // จบ kpStep 1

            // ── รอบสอง: คำกว้างไม่ติดทำเล — ดึง traffic/โอกาสขาย (volume ระดับประเทศ) ──
            progress('ขยาย candidate จาก Keyword Planner ideas (คำกว้างระดับประเทศ) …');
            const broadIdeas = await getKeywordPlannerRows({
              seed_keywords: services.slice(0, 5),
              target_language: 'th',
              target_country: 'Thailand',
              number_of_results: Math.max(300, targetCount * 3),
              force_refresh: flags.forceRefresh,
            });
            if (broadIdeas.warnings?.length) warnings.push(...broadIdeas.warnings);
            if (broadIdeas.success) {
              const serviceKeys = services.map(dedupeKey);
              const coreKeys = buildServiceCoreKeys(services);
              type BroadRow = (typeof broadIdeas.rows)[number];
              const direct: BroadRow[] = [];
              const unsure: BroadRow[] = [];
              for (const row of broadIdeas.rows) {
                if (!row.volume || row.volume <= 0) continue;
                const key = dedupeKey(normalizeThaiSpacing(row.keyword));
                if (!key || items.has(key)) continue;
                if (serviceKeys.some(sv => sv && key.includes(sv)) || coreKeys.some(ck => key.includes(ck))) {
                  direct.push(row);
                } else {
                  unsure.push(row);
                }
              }

              // คำที่ไม่เข้าเกณฑ์สตริง ให้ AI คัดความเกี่ยวข้องเป็น batch เดียว
              // (คัดเฉพาะความเกี่ยวข้อง — ตัวเลข volume มาจาก KP จริงเสมอ ไม่มีการแต่ง)
              let approved: BroadRow[] = [];
              const unsureBatch = unsure.slice(0, 100);
              if (unsureBatch.length > 0) {
                try {
                  const relevancePrompt = `ธุรกิจ: ${services.join(', ')}${input.businessContext ? ` — ${input.businessContext}` : ''}
จากรายการ keyword ต่อไปนี้ เลือกเฉพาะคำที่เกี่ยวข้องกับธุรกิจนี้ ทั้งคำที่มีโอกาสสร้างยอดขาย/ดึงลูกค้า (ราคา อาการเสีย เปรียบเทียบ) และคำหาความรู้/วิธี/ข้อมูลที่ดึง traffic เข้าเว็บ (เช่น วิธี..., ...คืออะไร, ...บ่อยแค่ไหน) ตัดเฉพาะคำที่เป็นคนละธุรกิจทิ้ง
ตอบเป็น JSON array ของ keyword ที่เลือกเท่านั้น: ["...","..."]
Keywords:
${unsureBatch.map(r => `- ${r.keyword}`).join('\n')}`;
                  const raw = await callGemini(relevancePrompt);
                  const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
                  const jsonMatch = text.match(/\[[\s\S]*\]/);
                  if (jsonMatch) {
                    const picked = new Set(
                      (JSON.parse(jsonMatch[0]) as unknown[]).map(k => dedupeKey(String(k ?? '')))
                    );
                    approved = unsureBatch.filter(r => picked.has(dedupeKey(normalizeThaiSpacing(r.keyword))));
                  }
                } catch (err) {
                  warnings.push(`AI คัดคำโอกาสขายไม่สำเร็จ — ใช้เฉพาะคำที่ตรงบริการ (${err instanceof Error ? err.message.slice(0, 60) : String(err)})`);
                }
              }

              const natGeo = { resolved: 'Thailand', level: 'country' };
              let added = 0;
              for (const row of [...direct, ...approved]) {
                if (added >= targetCount * 2) break;
                const keyword = normalizeThaiSpacing(row.keyword);
                const key = dedupeKey(keyword);
                if (!key || items.has(key)) continue;
                if (claimKey(keyword, 'keyword_planner') !== key) continue;
                items.set(key, {
                  keyword,
                  sources: ['keyword_planner'],
                  metric: {
                    volume: row.volume,
                    competition: row.competition ?? null,
                    competitionIndex: typeof row.competition_index === 'number' ? row.competition_index : null,
                    bidLow: row.low_cpc > 0 ? row.low_cpc : null,
                    bidHigh: row.high_cpc > 0 ? row.high_cpc : null,
                    trend: Array.isArray(row.monthly_trend) ? row.monthly_trend : undefined,
                  },
                });
                googleByKey.set(key, googleFromIdeaRow(row, natGeo, 'th'));
                added++;
                enrichedCount++;
              }
              kpCalls += broadIdeas.rows.length;
              if (added > 0) {
                warnings.push(`เพิ่มคำโอกาสขาย/traffic จากบริการหลัก (ไม่ติดทำเล) อีก ${added} คำ — volume ระดับประเทศจาก Keyword Planner จริงทุกคำ`);
                progress(`KP ideas (คำกว้าง): +${added} คำ (pool ${items.size})`, { count: items.size });
              }
            } else if (broadIdeas.error) {
              warnings.push(`ดึงคำโอกาสขายจากบริการหลักไม่สำเร็จ: ${broadIdeas.error}`);
            }
          }
        } catch (err: any) {
          if (err instanceof YieldSignal) throw err;
          // KP ล้มเหลวต้องไม่ทำให้ทั้งหน้าพัง — คืนผลวิเคราะห์เจตนาต่อไป (§31)
          kpStatus = 'unavailable';
          kpMessage = KP_UNAVAILABLE_MESSAGE;
          warnings.push(`Google Keyword Planner: ${err?.message || String(err)}`);
        }
      }
    }
    if (needs('kp')) await checkpoint('dfs_volumes');

    // ── DataForSEO volumes: cross-check ทุกคำ top budget (ไม่ใช่แค่คำที่ KP ไม่มี) ──
    // เก็บเข้า dfsByKey แยกแหล่งเสมอ — ใช้ยืนยัน confidence (HIGH/MEDIUM/LOW)
    // item.metric (ตัวจัดอันดับ candidate) จะถูกเติมด้วย DFS เฉพาะคำที่ KP ไม่มี volume
    // และติดป้าย 'dataforseo' ตรงตามแหล่งจริง (แก้ของเดิมที่ติดป้าย keyword_planner ผิด)
    if (needs('dfs_volumes') && hasDataForSeoCreds() && flags.useDataForSeo) {
      const rankedForDfs = assembleResults(Array.from(items.values()), input).results;
      const dfsTargets = rankedForDfs.slice(0, 700).map(r => r.keyword);
      if (dfsTargets.length > 0) {
        try {
          progress(`Cross-check volume กับ DataForSEO ${dfsTargets.length} คำ …`);
          const dfsMap = await getDataForSeoVolumes(dfsTargets, 'th', 2764, w => warnings.push(w));
          dfsCalls = dfsTargets.length;
          dfsFetchedAt = new Date().toISOString();
          let dfsFilled = 0;
          for (const item of Array.from(items.values())) {
            const hit = dfsMap.get(item.keyword.trim().toLowerCase());
            if (!hit) continue;
            const key = dedupeKey(item.keyword);
            dfsByKey.set(key, { ...dfsFromMetric(hit, 'th'), keywordDifficulty: dfsByKey.get(key)?.keywordDifficulty ?? null });
            item.sources = Array.from(new Set([...item.sources, 'dataforseo' as LocalKeywordSource]));
            // เติมตัวจัดอันดับเฉพาะคำที่ KP ไม่มี volume (reference ยังคง Google-first)
            if ((item.metric?.volume ?? 0) <= 0 && hit.volume > 0) {
              item.metric = {
                volume: hit.volume,
                competition: hit.competition ?? null,
                competitionIndex: hit.competition_index ?? null,
                bidLow: null,
                bidHigh: hit.cpc > 0 ? hit.cpc : null,
              };
              dfsFilled++;
              enrichedCount++;
            }
          }
          progress(`DataForSEO ตอบ ${dfsMap.size} คำ (เติม volume ให้คำที่ KP ไม่มี ${dfsFilled} คำ)`);
        } catch (err) {
          dfsError = err instanceof Error ? err.message : String(err);
          warnings.push(`DataForSEO cross-check ไม่สำเร็จ: ${dfsError}`);
        }
      }
    }

    if (needs('dfs_volumes')) await checkpoint('intent');

    // ── จัดอันดับ candidate ทั้งชุด (rule-based score เดิม ใช้เป็นสัญญาณย่อยของ intel) ──
    // resume หลัง stage intel: checkpoint เป็นแบบ lean (ไม่มี items) — ข้าม rank เพราะตาราง canonical อยู่ใน results แล้ว
    let rankedAll: ReturnType<typeof assembleResults> | null = null;
    if (needs('intel')) {
      rankedAll = assembleResults(Array.from(items.values()), input);
      candidateCount = rankedAll.results.length;
      progress(`วิเคราะห์ candidate ทั้งหมด ${candidateCount} คำ — เริ่มชั้น intelligence`, { count: candidateCount });
    }

    // ── DataForSEO search intent (ข้อมูลจริง ไม่ใช่ AI เดา) ──
    if (needs('intent') && rankedAll && hasDataForSeoCreds() && flags.useDataForSeo) {
      const ranked = rankedAll;
      try {
        const intentTargets = ranked.results.slice(0, 1000).map(r => r.keyword);
        progress(`ตรวจ search intent ${intentTargets.length} คำ (DataForSEO) …`);
        const intentRes = await getDataForSeoSearchIntents(intentTargets, 'th');
        dfsExtraCostUsd += intentRes.costUsd;
        dfsExtraCalls += 1;
        const now = new Date().toISOString();
        for (const r of ranked.results) {
          const hit = intentRes.intents.get(r.keyword.trim().toLowerCase());
          if (!hit) continue;
          intentByKey.set(dedupeKey(r.keyword), {
            intent: hit.intent, probability: hit.probability, retrievedAt: now, status: 'ok',
          });
        }
        progress(`ได้ search intent ${intentByKey.size} คำ`);
        if (intentRes.error && intentByKey.size === 0) {
          warnings.push(`DataForSEO search intent ไม่สำเร็จ: ${intentRes.error}`);
        }
      } catch (err) {
        warnings.push(`DataForSEO search intent ไม่สำเร็จ: ${err instanceof Error ? err.message.slice(0, 80) : String(err)}`);
      }
    }
    if (needs('intent')) await checkpoint('kd');

    // ── Keyword Difficulty (bulk) — เฉพาะ top slice ที่มีสิทธิ์เข้าตาราง ──
    if (needs('kd') && rankedAll && hasDataForSeoCreds() && flags.useDataForSeo) {
      const ranked = rankedAll;
      try {
        const kdLimit = Math.min(800, Math.max(targetCount + 100, 300));
        const kdTargets = ranked.results.slice(0, kdLimit).map(r => r.keyword);
        progress(`ตรวจ Keyword Difficulty ${kdTargets.length} คำ (DataForSEO) …`);
        const kdRes = await getDataForSeoKeywordDifficulty(kdTargets, 'th', 2764);
        dfsExtraCostUsd += kdRes.costUsd;
        dfsExtraCalls += 1;
        let kdSet = 0;
        for (const r of ranked.results) {
          const kd = kdRes.metrics.get(r.keyword.trim().toLowerCase());
          if (typeof kd !== 'number') continue;
          const key = dedupeKey(r.keyword);
          const existing = dfsByKey.get(key) ?? emptyDfsMetric('th');
          dfsByKey.set(key, { ...existing, keywordDifficulty: kd, retrievedAt: existing.retrievedAt ?? new Date().toISOString() });
          kdSet++;
        }
        progress(`ได้ Keyword Difficulty ${kdSet} คำ`);
      } catch (err) {
        warnings.push(`DataForSEO Keyword Difficulty ไม่สำเร็จ: ${err instanceof Error ? err.message.slice(0, 80) : String(err)}`);
      }
    }

    if (needs('kd')) await checkpoint('serp');

    // ── Local SERP check แบบ tiered (คุมค่าใช้จ่าย): เฉพาะคำ local/commercial เด่นสุด ──
    if (needs('serp') && rankedAll && hasDataForSeoCreds() && flags.checkSerp) {
      const serpBudget = Math.min(60, Math.max(12, Math.round(targetCount * 0.12)));
      const serpTargets = rankedAll.results
        .filter(r => r.locationRole !== 'none' || r.score.commercialIntent >= 60)
        .slice()
        .sort((a, b) => (b.score.localIntent + b.score.commercialIntent) - (a.score.localIntent + a.score.commercialIntent))
        .slice(0, serpBudget)
        .map(r => r.keyword);
      const SERP_CONC = 6; // ขนาน 6 คำ/รอบ (จาก 3) — SERP คือคอขวดเวลาหลักของ run ใหญ่
      const serpStart = cursor('serp', 'serpCursor', 0);
      progress(`ตรวจ Local SERP ${serpTargets.length} คำ (Tier A — คำ local/commercial เด่นสุด) …`);
      for (let i = serpStart; i < serpTargets.length; i += SERP_CONC) {
        const batch = serpTargets.slice(i, i + SERP_CONC);
        const settled = await Promise.allSettled(batch.map(kw => getSerpLocalSignals(kw)));
        settled.forEach((s, idx) => {
          const kw = batch[idx];
          if (s.status === 'fulfilled') {
            dfsExtraCostUsd += s.value.costUsd;
            dfsExtraCalls += 1;
            const signals = toSerpSignals(s.value);
            serpByKey.set(dedupeKey(kw), signals);
            if (signals.status === 'ok') serpChecked++; else serpErrors++;
          } else {
            serpErrors++;
          }
        });
        if (((i - serpStart) / SERP_CONC) % 2 === 0 || i + SERP_CONC >= serpTargets.length) {
          progress(`Local SERP ${Math.min(i + SERP_CONC, serpTargets.length)}/${serpTargets.length} คำ`);
        }
        // checkpoint ทุก 2 batch — cursor ชี้ index ถัดไปใน serpTargets (ลำดับ deterministic จาก state เดิม)
        if (((i - serpStart) / SERP_CONC) % 2 === 1 || i + SERP_CONC >= serpTargets.length) {
          await checkpoint('serp', { serpCursor: i + SERP_CONC });
        }
      }
      if (serpErrors > 0) warnings.push(`ตรวจ Local SERP ไม่สำเร็จ ${serpErrors} คำ (ตรวจได้ ${serpChecked} คำ) — คำที่ไม่ได้ตรวจใช้คะแนนกลาง ไม่แต่งข้อมูล`);
    }

    if (needs('serp')) await checkpoint('intel');

    if (needs('intel') && rankedAll) {
      const ranked = rankedAll;
      // ── ประกอบ intel ต่อคำ: reference volume + confidence + Sales/Traffic/Final ──
      progress('คำนวณ Sales Score / Traffic Score / Final Opportunity Score …');
      const ctx: ScoreContext = { maxCpc: 0, maxLogReferenceVolume: 0 };
      for (const r of ranked.results) {
        const key = dedupeKey(r.keyword);
        const g = googleByKey.get(key) ?? emptyGoogleMetric('th');
        const d = dfsByKey.get(key) ?? emptyDfsMetric('th');
        const cpc = d.cpc ?? g.bidHighMicros;
        if (cpc && cpc > ctx.maxCpc) ctx.maxCpc = cpc;
        const ref = resolveReferenceVolume(g, d).volume;
        if (ref && ref > 0) ctx.maxLogReferenceVolume = Math.max(ctx.maxLogReferenceVolume, Math.log1p(ref));
      }
      const byKey = new Map<string, KeywordResearchResult>();
      for (const r of ranked.results) {
        const key = dedupeKey(r.keyword);
        const item = items.get(key);
        r.intel = buildIntel(r, {
          google: googleByKey.get(key) ?? emptyGoogleMetric('th'),
          dfs: dfsByKey.get(key) ?? emptyDfsMetric('th'),
          searchIntent: intentByKey.get(key) ?? emptySearchIntent(),
          serp: serpByKey.get(key) ?? emptySerpSignals(),
          candidateSources: item ? item.sources.slice() : ['generated'],
        }, weights, ctx);
        // รูปเขียนอื่นที่ถูกยุบเข้าคำนี้ (สลับตำแหน่ง/close variant) = คำรองของหน้าเดียวกัน
        if (item?.variants?.length) {
          for (const v of item.variants) {
            if (!r.intel!.secondaryKeywords.includes(v)) r.intel!.secondaryKeywords.push(v);
          }
        }
        byKey.set(key, r);
      }

      // ── กันคำชนกัน: location-swap (doorway protection) + SERP overlap merge ──
      const areaKeys = [primaryLocation, ...nearbyLocations].map(a => dedupeKey(a.name));
      const swap = resolveLocationSwapGroups(
        ranked.results.map(r => ({ keyword: r.keyword, locationRole: r.locationRole, finalScore: r.intel!.finalScore })),
        areaKeys
      );
      const serpMergeInput = ranked.results
        .filter(r => r.intel!.serp.status === 'ok' && r.intel!.serp.topUrls.length >= 5)
        .map(r => ({
          keyword: r.keyword,
          finalScore: r.intel!.finalScore,
          topUrls: r.intel!.serp.topUrls,
          intent: r.intel!.searchIntent.intent,
        }));
      const serpMerge = mergeBySerpOverlap(serpMergeInput);
      // ชั้นที่สาม: ข้อความแทบเป็นคำเดียวกัน (สลับตำแหน่ง/คำพ้อง/สะกดต่างนิดเดียว)
      // — ครอบคลุมคำที่ไม่มีข้อมูล SERP ให้ mergeBySerpOverlap เช็ก
      const textMerge = mergeByTextSimilarity(
        ranked.results.map(r => ({ keyword: r.keyword, finalScore: r.intel!.finalScore }))
      );

      const demotions = new Map<string, { primaryKey: string; action: CannibalizationAction; reason: string }>();
      for (const [key, info] of Array.from(swap.demoted.entries())) {
        demotions.set(key, { primaryKey: info.primaryKey, action: info.action, reason: info.reason });
      }
      for (const [key, info] of Array.from(serpMerge.merged.entries())) {
        if (!demotions.has(key)) {
          demotions.set(key, { primaryKey: info.primaryKey, action: 'MERGE', reason: info.reason });
        }
      }
      for (const [key, info] of Array.from(textMerge.merged.entries())) {
        if (!demotions.has(key)) {
          demotions.set(key, { primaryKey: info.primaryKey, action: 'MERGE', reason: info.reason });
        }
      }
      // แก้ลูกโซ่: ถ้าคำหลักของเราถูกลดชั้นไปแล้ว ให้ชี้ไปคำหลักตัวจริง (จำกัด 5 ชั้นกันวน)
      let demotedApplied = 0;
      for (const [key, info] of Array.from(demotions.entries())) {
        let primaryKey = info.primaryKey;
        let hops = 0;
        while (demotions.has(primaryKey) && hops < 5) {
          primaryKey = demotions.get(primaryKey)!.primaryKey;
          hops++;
        }
        if (primaryKey === key) continue;
        const primary = byKey.get(primaryKey);
        const demoted = byKey.get(key);
        if (!primary || !demoted) continue;
        primary.intel!.secondaryKeywords.push(demoted.keyword);
        demoted.intel!.cannibalization = {
          score: 0,
          action: info.action,
          reason: info.reason,
          againstKeyword: primary.keyword,
        };
        demotedApplied++;
      }
      if (demotedApplied > 0) {
        progress(`รวมคำเจตนาซ้ำเป็นคำรอง ${demotedApplied} คำ (location-swap + SERP overlap + คำสลับตำแหน่ง)`);
        warnings.push(`รวมคำที่เจตนาซ้ำกันเป็นคำรอง ${demotedApplied} คำ — กันหน้า doorway/คำกินกันเอง (ดูใน Detail ของแต่ละคำหลัก)`);
      }

      // ── คัดเลือก Final Qualified SEO Opportunities: คำ verified ก่อน + โควตาคลัสเตอร์ ──
      const demotedKeys = new Set(
        Array.from(demotions.keys()).filter(k => byKey.get(k)?.intel?.cannibalization.action !== 'KEEP' && byKey.get(k)?.intel?.cannibalization.againstKeyword)
      );
      let primaries = ranked.results.filter(r => !demotedKeys.has(dedupeKey(r.keyword)));
      const scoreOf = (r: KeywordResearchResult) => r.intel!.finalScore;

      // ── Relevance Guard: LLM ตัดคำนอกพื้นที่/นอกบริการ ก่อนคัดเข้าตารางสุดท้าย ──
      // (QA 2026-08: นนทบุรี/พัทยาหลุดเข้าผลของธุรกิจบางแค, คำซื้อเครื่อง/แอร์รถยนต์ปนคำจ้างบริการ)
      // fail-open: LLM พัง = ไม่ตัดอะไรเลย + แจ้ง warning — ห้ามทำ run ล่มเพราะชั้นกรองเสริม
      try {
        // ตรวจ "ทุกคำ" ที่มีสิทธิ์เข้าตารางสุดท้าย (แบ่งชุดละ 400 — cap 3 ชุดกัน prompt บวม)
        // QA รอบสอง: ตรวจแค่ top-200 แล้วคำคะแนนต่ำ (ล้างแอร์โชคชัย 4, ซ่อมแอร์นนทบุรี) หลุดเข้าผล
        const guardTargets = primaries
          .slice()
          .sort((a, b) => scoreOf(b) - scoreOf(a))
          .slice(0, MAX_KEYWORDS_PER_CALL * 3)
          .map(r => r.keyword);
        if (guardTargets.length > 0) {
          progress(`ตรวจคำนอกพื้นที่/นอกบริการ ${guardTargets.length} คำ (Relevance Guard) …`);
          const guardInput = {
            services: input.services.filter(Boolean),
            businessContext: input.businessContext,
            primaryLocation: primaryLocation.parent ? `${primaryLocation.name} (${primaryLocation.parent})` : primaryLocation.name,
            nearbyLocations: nearbyLocations.map(a => a.name),
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
          const dropped: Array<{ keyword: string; verdict: string; reason: string }> = [];
          const before = primaries.length;
          primaries = primaries.filter(r => {
            const hit = guard.verdicts.get(r.keyword.trim());
            if (!hit || hit.verdict === 'ok') return true;
            dropped.push({ keyword: r.keyword, verdict: hit.verdict, reason: hit.reason });
            return false;
          });
          if (dropped.length > 0) {
            const offArea = dropped.filter(d => d.verdict === 'off_area');
            const offService = dropped.filter(d => d.verdict === 'off_service');
            const sample = (list: typeof dropped) => list.slice(0, 6).map(d => d.keyword).join(', ');
            if (offArea.length > 0) warnings.push(`ตัดคำนอกพื้นที่ ${offArea.length} คำ (เช่น ${sample(offArea)}) — คนค้นอยู่นอกเขตให้บริการ`);
            if (offService.length > 0) warnings.push(`ตัดคำนอกบริการ ${offService.length} คำ (เช่น ${sample(offService)}) — เจตนาไม่ใช่จ้างบริการของธุรกิจนี้`);
            progress(`Relevance Guard ตัดออก ${dropped.length} คำ (เหลือ ${primaries.length} จาก ${before})`);
          } else {
            progress('Relevance Guard: ไม่พบคำหลุดพื้นที่/หลุดบริการ');
          }
          if (guard.unanswered.length > 0 && guard.verdicts.size === 0) {
            warnings.push('Relevance Guard ตรวจไม่สำเร็จ (โมเดลไม่ตอบเป็น JSON) — ไม่มีการตัดคำ รอบนี้ควรตรวจตาด้วยตัวเอง');
          }
        }
      } catch (err) {
        warnings.push(`Relevance Guard ไม่สำเร็จ: ${err instanceof Error ? err.message.slice(0, 80) : String(err)} — ไม่มีการตัดคำ`);
      }

      const verified = primaries.filter(r => r.intel!.referenceSource !== 'none' || r.intel!.zeroVolumeLocalOpportunity);
      const unverified = primaries.filter(r => r.intel!.referenceSource === 'none' && !r.intel!.zeroVolumeLocalOpportunity);

      let selected = selectWithClusterQuota(verified, targetCount, scoreOf);
      if (selected.length < targetCount && unverified.length > 0) {
        const chosenKeys = new Set(selected.map(r => dedupeKey(r.keyword)));
        const fill = selectWithClusterQuota(
          unverified.filter(r => !chosenKeys.has(dedupeKey(r.keyword))),
          targetCount - selected.length,
          scoreOf
        );
        if (fill.length > 0) {
          warnings.push(`คำที่มี volume ตรวจสอบแล้วมี ${selected.length} คำ — เติมคำที่เกี่ยวกับธุรกิจแต่ยังไม่ยืนยัน volume อีก ${fill.length} คำ (ติดป้าย NO VOLUME ให้ตรวจก่อนใช้)`);
          selected = [...selected, ...fill];
        }
      }
      if (selected.length < targetCount) {
        warnings.push(`ได้ ${selected.length}/${targetCount} SEO Opportunities — คุณภาพมาก่อนจำนวน: ไม่เติมคำที่ไม่เกี่ยวข้องเพื่อให้ครบตัวเลข ลองขยายบริการ/พื้นที่หรือเพิ่ม nearby locations`);
      }
      qualifiedCount = selected.length;
      progress(`คัดเหลือ ${qualifiedCount} SEO Opportunities (จาก candidate ${candidateCount} คำ)`, { count: qualifiedCount });

      // ── Publish waves: Wave 1 ≈15% (portfolio สมดุลข้ามคลัสเตอร์), Wave 2 ≈30%, ที่เหลือ Wave 3 ──
      const waves = assignWaves(selected, scoreOf);
      for (const r of selected) {
        r.intel!.wave = waves.get(dedupeKey(r.keyword)) ?? 3;
      }

      // เรียงตาม Final Opportunity Score + sync คอลัมน์เดิมกับ reference volume
      // (r.volume ที่ UI เดิมแสดง = reference volume พร้อมป้ายที่มาใน intel — ไม่มีการเฉลี่ย)
      results = [...selected].sort((a, b) => scoreOf(b) - scoreOf(a));
      for (const r of results) {
        const i = r.intel!;
        r.volume = i.referenceVolume;
        r.adsCompetition = i.google.competition ?? i.dfs.competition ?? r.adsCompetition ?? null;
        r.competitionIndex = i.google.competitionIndex ?? i.dfs.competitionIndex ?? r.competitionIndex ?? null;
        r.bidLow = i.google.bidLowMicros ?? r.bidLow ?? null;
        r.bidHigh = i.google.bidHighMicros ?? i.dfs.cpc ?? r.bidHigh ?? null;
        if (i.google.monthlySearchVolumes && i.google.monthlySearchVolumes.length > 1) {
          r.trend = i.google.monthlySearchVolumes;
        }
      }

      // cluster summary จากชุดที่คัดแล้ว (ให้ตรงกับตาราง)
      const selectedKeys = new Set(results.map(r => dedupeKey(r.keyword)));
      const finalItems = Array.from(items.values()).filter(item => selectedKeys.has(dedupeKey(item.keyword)));
      clusters = assembleResults(finalItems, input).clusters;
      await checkpoint('titles');
    }

    if (needs('titles')) {
      // ── เขียน SEO title + slug (AI ทำหลังข้อมูลจบแล้วเสมอ — batch ละ 100 คำ) ──
      progress(`เขียน SEO title + slug ให้ ${results.length} คำ …`);
      try {
        const titleBatches: string[][] = [];
        for (let i = 0; i < results.length; i += 100) {
          titleBatches.push(results.slice(i, i + 100).map(r => r.keyword));
        }
        const titlePromptFor = (kwList: string[]) => `คุณคือผู้เชี่ยวชาญ SEO ไทย เขียนหัวข้อบทความ/หน้าเพจ (SEO title) และ English slug ให้ keyword ของธุรกิจนี้:
  ธุรกิจ: ${services.join(', ')} ในพื้นที่ ${primaryLocation.name}${input.businessContext ? ` — ${input.businessContext}` : ''}
  กติกา: title ภาษาไทย ≤60 ตัวอักษร มี keyword อยู่ในหัวข้อ เน้นให้คนอยากคลิกและสื่อว่าให้บริการจริง / slug เป็นอังกฤษล้วน ตัวเล็ก คั่นด้วย hyphen สั้นกระชับ
  ตอบเป็น JSON array เท่านั้น: [{"keyword":"...","title":"...","slug":"..."}]
  Keywords:
  ${kwList.map(k => `- ${k}`).join('\n')}`;
        const titleStart = cursor('titles', 'titleCursor', 0);
        for (let i = titleStart; i < titleBatches.length; i += 3) {
          const wave = titleBatches.slice(i, i + 3);
          const settled = await Promise.allSettled(wave.map(batch => callGemini(titlePromptFor(batch))));
          for (const s of settled) {
            if (s.status !== 'fulfilled') { titleFailures++; continue; }
            const text = typeof s.value === 'string' ? s.value : JSON.stringify(s.value);
            const jsonMatch = text.match(/\[[\s\S]*\]/);
            if (!jsonMatch) { titleFailures++; continue; }
            try {
              const titled = JSON.parse(jsonMatch[0]) as Array<{ keyword?: string; title?: string; slug?: string }>;
              for (const t of titled) {
                titleByKey.set(dedupeKey(String(t.keyword ?? '')), { title: t.title, slug: t.slug });
              }
            } catch { titleFailures++; }
          }
          progress(`เขียน title แล้ว ${Math.min((i + 3) * 100, results.length)}/${results.length} คำ`);
          await checkpoint('titles', { titleCursor: i + 3 });
        }
        for (const r of results) {
          const hit = titleByKey.get(dedupeKey(r.keyword));
          if (hit?.title) r.suggestedTitle = String(hit.title).slice(0, 120);
          if (hit?.slug) r.slug = String(hit.slug).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
        }
        if (titleFailures > 0) warnings.push(`เขียน title ไม่สำเร็จ ${titleFailures} batch — คำที่ไม่มี title ใช้ keyword แทน`);
      } catch (err) {
        if (err instanceof YieldSignal) throw err;
        warnings.push(`เขียน title/slug อัตโนมัติไม่สำเร็จ: ${err instanceof Error ? err.message.slice(0, 80) : String(err)}`);
      }
    }
    if (needs('titles')) await checkpoint('clusters');

    // ── โครงสร้างเว็บทั้งไซต์: จัด pillar/cluster (degradable) ──
    // run ใหญ่ซอยเป็น chunk ละ 250 คำ (เรียงตามหมวด rule-based ให้คำใกล้กันอยู่ chunk เดียวกัน)
    // cluster_id ของ chunk ที่ ci ถูก offset ci*1000 กัน id ชนกันข้าม chunk
    if (needs('clusters') && flags.buildTopicClusters && results.length > 1) {
      try {
        progress('จัดโครงสร้าง pillar / topic cluster …');
        const CLUSTER_CHUNK = 250;
        const ordered = [...results].sort((a, b) =>
          String(a.cluster ?? a.service ?? '').localeCompare(String(b.cluster ?? b.service ?? ''), 'th'));
        const chunksArr: KeywordResearchResult[][] = [];
        for (let i = 0; i < ordered.length; i += CLUSTER_CHUNK) chunksArr.push(ordered.slice(i, i + CLUSTER_CHUNK));
        const niche = services.join(' / ');
        const clusterStart = cursor('clusters', 'clusterCursor', 0);
        for (let ci = clusterStart; ci < chunksArr.length; ci++) {
          const chunk = chunksArr[ci];
          const pipelineKws: PipelineKeyword[] = chunk.map(r => ({
            keyword: r.keyword,
            title: r.suggestedTitle || r.keyword,
            volume: r.volume ?? 0,
            opportunity_score: r.intel?.finalScore ?? r.score?.total ?? 0,
            priority: String(r.intel?.finalScore ?? r.score?.total ?? ''),
            intent: r.intents?.[0] ?? 'informational',
            aeo_question: '',
          }));
          const clusterResult = await clusterKeywords(pipelineKws, niche, (p: string) => callGemini(p));
          for (const c of clusterResult.clusters) {
            const clusterId = ci * 1000 + c.cluster_id;
            const pillarSlug = c.pillar.slug;
            clusterByKey.set(dedupeKey(c.pillar.keyword), { clusterId, clusterName: c.cluster_name, role: 'pillar', pillarSlug });
            for (const s of c.supporting) {
              clusterByKey.set(dedupeKey(s.keyword), { clusterId, clusterName: c.cluster_name, role: 'supporting', pillarSlug });
            }
            topicClusters.push({
              clusterId,
              name: c.cluster_name,
              pillarSlug,
              memberSlugs: [c.pillar.slug, ...c.supporting.map(s => s.slug)],
              totalVolume: c.total_volume,
            });
          }
          if (chunksArr.length > 1) {
            progress(`จัดโครงสร้าง cluster แล้ว ${Math.min((ci + 1) * CLUSTER_CHUNK, ordered.length)}/${ordered.length} คำ`);
          }
          await checkpoint('clusters', { clusterCursor: ci + 1 });
        }
      } catch (err) {
        if (err instanceof YieldSignal) throw err;
        warnings.push(`จัดโครงสร้าง pillar/cluster ไม่สำเร็จ — ใช้หมวดจาก local cluster แทน (${err instanceof Error ? err.message.slice(0, 60) : String(err)})`);
      }
    }
    if (needs('clusters')) await checkpoint('finalize');

    // ── sitemap: 1 keyword = 1 บทความ/หน้า (โมเดลของโปรเจกต์) ──
    const seenSitemapKey = new Set<string>();
    const sitemap = results
      .filter(r => {
        const k = dedupeKey(r.keyword);
        if (!k || seenSitemapKey.has(k)) return false;
        seenSitemapKey.add(k);
        return true;
      })
      .map(r => {
        const key = dedupeKey(r.keyword);
        const membership = clusterByKey.get(key);
        const isArticle = generatedTrafficKeys.has(key);
        const pageType = isArticle ? 'blog' : (r.suggestedPage ?? 'blog');
        const slug = r.slug || key.replace(/\s+/g, '-');
        return {
          page: r.suggestedTitle || r.keyword,
          pageType: String(pageType),
          slug,
          category: membership?.clusterName ?? r.cluster ?? r.service,
          clusterId: membership?.clusterId,
          pillarSlug: membership?.pillarSlug,
          role: membership?.role ?? 'standalone' as 'pillar' | 'supporting' | 'standalone',
          keywords: [{ keyword: r.keyword, volume: r.volume ?? null, title: r.suggestedTitle }],
        };
      })
      .sort((a, b) => (b.keywords[0].volume ?? 0) - (a.keywords[0].volume ?? 0));

    // ── Volume coverage + Client Ready gate (§85–§86) ──
    const coverage = verifiedVolumeCoverage(results.map(r => ({
      referenceVolume: r.intel!.referenceVolume,
      referenceSource: r.intel!.referenceSource,
      zeroVolumeLocalOpportunity: r.intel!.zeroVolumeLocalOpportunity,
    })));
    const clientReady = results.length > 0 && coverage >= CLIENT_READY_COVERAGE_THRESHOLD;
    if (!clientReady && results.length > 0) {
      warnings.push(`ยังไม่พร้อมส่งลูกค้า (Client Ready = ไม่ผ่าน): volume ที่ตรวจสอบแล้วครอบคลุม ${(coverage * 100).toFixed(0)}% ของตาราง (เกณฑ์ ≥${CLIENT_READY_COVERAGE_THRESHOLD * 100}%) — ตรวจแหล่งข้อมูลใน Data Sources แล้วรันซ้ำ`);
    }

    const googleCovered = results.filter(r => ['ok', 'zero'].includes(r.intel!.google.status)).length;
    const dfsCovered = results.filter(r => ['ok', 'zero'].includes(r.intel!.dfs.status)).length;

    const response: LocalResearchResponse & { sitemap: typeof sitemap; topicClusters: typeof topicClusters } = {
      results,
      clusters,
      sitemap,
      topicClusters,
      meta: {
        generatedCount,
        enrichedCount,
        keywordPlannerStatus: kpStatus,
        keywordPlannerMessage: kpMessage,
        locationTarget: geoTarget,
        weights: LOCAL_KEYWORD_WEIGHTS,
        warnings,
        generatedAt: new Date().toISOString(),
        researchId: null,
        candidateCount,
        qualifiedCount,
        opportunityWeights: weights,
        sourceStatus: {
          googleKeywordPlanner: {
            status: kpStatus,
            coverage: results.length > 0 ? Math.round((googleCovered / results.length) * 1000) / 1000 : 0,
            geo: `${geoTarget.resolved} (${geoTarget.level})`,
            message: kpMessage,
            fetchedAt: kpFetchedAt,
          },
          dataForSeo: {
            status: !hasDataForSeoCreds() || !flags.useDataForSeo
              ? 'skipped'
              : dfsError && dfsCovered === 0 ? 'error' : dfsCovered > 0 ? 'ok' : 'partial',
            coverage: results.length > 0 ? Math.round((dfsCovered / results.length) * 1000) / 1000 : 0,
            message: dfsError,
            fetchedAt: dfsFetchedAt,
          },
          localSerp: {
            status: !hasDataForSeoCreds() || !flags.checkSerp
              ? 'skipped'
              : serpChecked > 0 ? 'ok' : serpErrors > 0 ? 'error' : 'skipped',
            checkedCount: serpChecked,
            message: serpErrors > 0 ? `ตรวจไม่สำเร็จ ${serpErrors} คำ` : undefined,
            fetchedAt: serpChecked > 0 ? new Date().toISOString() : null,
          },
        },
        clientReady,
        verifiedVolumeCoverage: coverage,
      },
    };

    // ── บันทึก canonical run (UI + Excel export อ่านชุดเดียวกันจากที่นี่) ──
    // ตารางยังไม่มีใน DB → research ยังใช้ได้ (researchId=null + คำเตือน) ไม่พังทั้งงาน
    if (flags.projectId) {
      try {
        const summaryJson = JSON.stringify({
          services,
          primaryLocation: primaryLocation.name,
          nearbyLocations: nearbyLocations.map(a => a.name),
          targetCount,
          candidateCount,
          qualifiedCount,
          clientReady,
          verifiedVolumeCoverage: coverage,
          weights,
          locationTarget: geoTarget,
          generatedAt: response.meta.generatedAt,
        });
        if (runId) {
          // โหมด resumable: row ถูกสร้างตั้งแต่เริ่ม — ปิดงาน + ล้าง checkpoint/lock ในจังหวะเดียว
          response.meta.researchId = runId;
          await prisma.localKeywordResearchRun.update({
            where: { id: runId },
            data: {
              targetCount,
              candidateCount,
              qualifiedCount,
              salesWeight: weights.sales,
              trafficWeight: weights.traffic,
              status: 'completed',
              clientReady,
              summary: summaryJson,
              resultData: JSON.stringify(response),
              phase: null,
              phaseState: null,
              lockedAt: null,
            },
          });
          progress(`บันทึกผลการวิจัยแล้ว (run ${runId})`);
        } else {
          const run = await prisma.localKeywordResearchRun.create({
            data: {
              organizationId: orgId,
              projectId: flags.projectId,
              mode: 'local_storefront',
              services: JSON.stringify(services),
              primaryLocation: primaryLocation.name,
              targetCount,
              candidateCount,
              qualifiedCount,
              salesWeight: weights.sales,
              trafficWeight: weights.traffic,
              status: 'completed',
              clientReady,
              summary: summaryJson,
              resultData: JSON.stringify(response),
              createdById: userId,
            },
          });
          response.meta.researchId = run.id;
          progress(`บันทึกผลการวิจัยแล้ว (run ${run.id})`);
        }
      } catch (err) {
        response.meta.researchId = null;
        warnings.push(`บันทึก research run ไม่สำเร็จ (ผลลัพธ์ยังใช้ได้ แต่ export Excel จะสร้างจากข้อมูลชุดนี้ในหน้าเว็บแทน): ${err instanceof Error ? err.message.slice(0, 100) : String(err)}`);
      }
    }

    // ── บันทึกต้นทุน API ตามจริง ──
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
        inputSummary: `WordGod Local SME DFS cross-check — ${dfsCalls} lookups`,
      }).catch(() => {});
    }
    if (dfsExtraCalls > 0) {
      logAIJob({
        organizationId: orgId,
        projectId: flags.projectId,
        jobType: 'DFS_INTEL_LOOKUP',
        modelProvider: 'DATAFORSEO',
        modelName: 'dataforseo/labs+serp (intent, ideas, kd, local serp)',
        status: 'SUCCESS',
        externalCost: dfsExtraCostUsd,
        externalCalls: dfsExtraCalls,
        externalApi: 'DataForSEO',
        createdById: userId,
        inputSummary: `WordGod Local SME intelligence — intent/ideas/KD/SERP ${dfsExtraCalls} calls (SERP ${serpChecked} คำ)`,
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
        inputSummary: `WordGod Local SME — ${services.join(', ')} @ ${primaryLocation.name} · ${kpCalls} lookups`,
      }).catch(() => {});
    }

    progress(`เสร็จสิ้น — ${qualifiedCount} SEO Opportunities พร้อมใช้งาน`);
    return response;
  };

  // ── Streaming NDJSON (opt-in) — default ยังตอบ JSON ก้อนเดียวเหมือนเดิม ──
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
        // heartbeat: จังหวะ AI call ยาว (เช่น pillar/cluster ที่ 1000 คำ) อาจเงียบเกิน 5 นาที
        // จน proxy/undici ตัดสาย — ส่ง event เปล่าคั่นไว้ ฝั่ง client ไม่รู้จัก type นี้ก็ข้ามไปเอง
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
              // งบเวลาของ request นี้หมด — ปลดล็อกให้ request ถัดไปทำต่อ แล้วบอก client ว่ายังไม่จบ
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
      // งบเวลาหมด (โหมดไม่ stream): ตอบ 202 ให้ client ยิง resumeRunId มาทำต่อ
      return NextResponse.json({ resume: true, runId, phase: err.stage }, { status: 202 });
    }
    console.error('[local-research] pipeline failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Local research failed' },
      { status: 500 }
    );
  }
}
