/**
 * WordGod Local SME — SEO Opportunity Intelligence (pure, ไม่มี I/O)
 *
 * ชั้นนี้รับผล candidate ที่ "มีข้อมูลจริงจาก API แล้ว" (Google KP / DFS / SERP)
 * มาคำนวณเป็น SEO Opportunity ตามสเปก Local SEO Intelligence Engine:
 *
 *  - SalesScore   = LocalRelevance 25% + Intent 20% + ServiceProximity 20%
 *                 + CPC 15% + LocalSERPFit 10% + PaidCompetition 10%
 *  - TrafficScore = Demand 40% + LowKD 20% + Trend 15% + SERPOpportunity 15% + TopicalFit 10%
 *  - Final        = Sales×w_sales + Traffic×w_traffic − CannibalizationPenalty − ConfidencePenalty
 *                 (+ Local Opportunity Override สำหรับคำ volume 0 ที่มีหลักฐาน local จริง)
 *
 * กติกา: ตัวเลขทุกตัวในไฟล์นี้มาจากข้อมูล API ที่เก็บแยกแหล่งแล้วเท่านั้น —
 * ไม่มีการให้ AI เดา volume/CPC/KD และไม่มีการเฉลี่ย Google กับ DFS
 */

import {
  computeVolumeConfidence,
  confidencePenalty,
  resolveReferenceVolume,
  type DfsMetricData,
  type GoogleMetricData,
  type ReferenceSource,
  type SearchIntentData,
  type SerpSignals,
  type VolumeConfidence,
} from './metrics';
import { dedupeKey, orderFreeKey } from './normalize';
import { textSimilarity } from '../online/clustering';
import type { KeywordResearchResult } from './types';

// ── น้ำหนักคะแนน (สเปก §46, §48) ─────────────────────────────────────────────

export const SALES_SCORE_WEIGHTS = {
  localRelevance: 0.25,
  intent: 0.20,
  serviceProximity: 0.20,
  cpcValue: 0.15,
  localSerpFit: 0.10,
  paidCompetition: 0.10,
} as const;

export const TRAFFIC_SCORE_WEIGHTS = {
  demand: 0.40,
  lowDifficulty: 0.20,
  trend: 0.15,
  serpOpportunity: 0.15,
  topicalFit: 0.10,
} as const;

const sumSales = Object.values(SALES_SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
const sumTraffic = Object.values(TRAFFIC_SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
if (Math.abs(sumSales - 1) > 1e-9 || Math.abs(sumTraffic - 1) > 1e-9) {
  throw new Error('intelligence.ts: score weights must sum to 1');
}

/** ตัวเลือกน้ำหนัก Sales/Traffic ที่ผู้ใช้เลือกได้ (default 60/40) */
export const WEIGHT_PRESETS: Array<{ sales: number; traffic: number }> = [
  { sales: 0.7, traffic: 0.3 },
  { sales: 0.6, traffic: 0.4 },
  { sales: 0.5, traffic: 0.5 },
  { sales: 0.4, traffic: 0.6 },
  { sales: 0.3, traffic: 0.7 },
];

export function normalizeWeights(sales?: number, traffic?: number): { sales: number; traffic: number } {
  let s = typeof sales === 'number' && isFinite(sales) ? sales : 0.6;
  let t = typeof traffic === 'number' && isFinite(traffic) ? traffic : 1 - s;
  if (s < 0) s = 0; if (t < 0) t = 0;
  const total = s + t;
  if (total <= 0) return { sales: 0.6, traffic: 0.4 };
  return { sales: s / total, traffic: t / total };
}

// ── โครงข้อมูล intel ต่อคีย์เวิร์ด ───────────────────────────────────────────

export type CannibalizationAction =
  | 'KEEP'
  | 'MERGE'
  | 'USE_AS_SECONDARY'
  | 'DROP';

export interface SalesScoreBreakdown {
  localRelevance: number;
  intent: number;
  serviceProximity: number;
  cpcValue: number;
  localSerpFit: number;
  paidCompetition: number;
  total: number;
}

export interface TrafficScoreBreakdown {
  demand: number;
  lowDifficulty: number;
  trend: number;
  serpOpportunity: number;
  topicalFit: number;
  total: number;
}

export interface KeywordIntel {
  canonicalKeyword: string;
  google: GoogleMetricData;
  dfs: DfsMetricData;
  referenceVolume: number | null;
  referenceSource: ReferenceSource;
  confidence: VolumeConfidence;
  searchIntent: SearchIntentData;
  serp: SerpSignals;
  zeroVolumeLocalOpportunity: boolean;
  salesScore: SalesScoreBreakdown;
  trafficScore: TrafficScoreBreakdown;
  finalScore: number;
  cannibalization: {
    score: number;
    action: CannibalizationAction;
    reason?: string;
    againstKeyword?: string;
  };
  /** คำรองที่ถูกรวมเข้า opportunity นี้ (SERP overlap / location-swap) */
  secondaryKeywords: string[];
  wave: 1 | 2 | 3 | null;
  /** ที่มาของ candidate เช่น rule_engine, ai_expansion, kp_ideas, dfs_suggestions */
  candidateSources: string[];
}

export type IntelResult = KeywordResearchResult & { intel: KeywordIntel };

// ── คะแนนย่อย ────────────────────────────────────────────────────────────────

const NEUTRAL = 50;

/** เจตนา 0–100 — อิง DFS search intent จริงก่อน แล้วค่อย fallback เป็น tag เดิม */
export function intentScore(intent: SearchIntentData, fallbackCommercial: number): number {
  if (intent.status === 'ok' && intent.intent) {
    const base: Record<string, number> = {
      transactional: 100,
      commercial: 85,
      navigational: 40,
      informational: 25,
    };
    const score = base[intent.intent] ?? fallbackCommercial;
    // ยิ่ง probability สูง ยิ่งมั่นใจ — ถ่วงเข้าหา neutral เมื่อ probability ต่ำ
    const p = intent.probability ?? 1;
    return Math.round(score * p + fallbackCommercial * (1 - p));
  }
  return fallbackCommercial;
}

/** มูลค่า CPC 0–100 — CPC สูง = คำที่ธุรกิจยอมจ่ายจริง; ไม่มีข้อมูล = กลาง */
export function cpcValueScore(cpc: number | null, maxCpc: number): number {
  if (cpc === null || cpc <= 0 || maxCpc <= 0) return NEUTRAL;
  return Math.round(Math.min(100, (Math.log1p(cpc) / Math.log1p(maxCpc)) * 100));
}

/** ความเข้ากับ SERP ท้องถิ่น 0–100 — ยังไม่เช็ค SERP = กลาง (ไม่แต่งข้อมูล) */
export function localSerpFitScore(serp: SerpSignals): number {
  if (serp.status !== 'ok') return NEUTRAL;
  let score = serp.hasLocalPack ? 55 : 20;
  score += Math.min(35, serp.servicePageCount * 7);
  score += Math.min(10, serp.directoryCount * 2);
  return Math.max(0, Math.min(100, score));
}

/** trend 0–100 จากซีรีส์รายเดือนจริง — เทียบ 3 เดือนท้าย/ก่อนหน้า, ไม่มีข้อมูล = กลาง */
export function trendScore(series: number[] | null): number {
  if (!series || series.length < 6) return NEUTRAL;
  const clean = series.filter(v => typeof v === 'number' && isFinite(v));
  if (clean.length < 6) return NEUTRAL;
  const last3 = clean.slice(-3).reduce((a, b) => a + b, 0) / 3;
  const prev3 = clean.slice(-6, -3).reduce((a, b) => a + b, 0) / 3;
  if (prev3 <= 0) return last3 > 0 ? 75 : NEUTRAL;
  const change = (last3 - prev3) / prev3; // -1..∞
  // -50% → 0, 0% → 50, +50% → 100
  return Math.round(Math.max(0, Math.min(100, 50 + change * 100)));
}

export interface ScoreContext {
  maxCpc: number;
  maxLogReferenceVolume: number;
}

export function computeSalesScoreBreakdown(r: KeywordResearchResult, intel: {
  searchIntent: SearchIntentData;
  serp: SerpSignals;
  google: GoogleMetricData;
  dfs: DfsMetricData;
}, ctx: ScoreContext): SalesScoreBreakdown {
  const cpc = intel.dfs.cpc ?? intel.google.bidHighMicros ?? null;
  const compIndex = intel.google.competitionIndex ?? intel.dfs.competitionIndex ?? null;
  const parts = {
    localRelevance: r.score.localIntent,
    intent: intentScore(intel.searchIntent, r.score.commercialIntent),
    serviceProximity: r.score.relevance,
    cpcValue: cpcValueScore(cpc, ctx.maxCpc),
    localSerpFit: localSerpFitScore(intel.serp),
    // Ads competition สูง = ตลาดพิสูจน์แล้วว่าคำนี้มีมูลค่าเชิงพาณิชย์
    paidCompetition: compIndex === null ? NEUTRAL : compIndex,
  };
  const total =
    parts.localRelevance * SALES_SCORE_WEIGHTS.localRelevance +
    parts.intent * SALES_SCORE_WEIGHTS.intent +
    parts.serviceProximity * SALES_SCORE_WEIGHTS.serviceProximity +
    parts.cpcValue * SALES_SCORE_WEIGHTS.cpcValue +
    parts.localSerpFit * SALES_SCORE_WEIGHTS.localSerpFit +
    parts.paidCompetition * SALES_SCORE_WEIGHTS.paidCompetition;
  return {
    localRelevance: Math.round(parts.localRelevance),
    intent: Math.round(parts.intent),
    serviceProximity: Math.round(parts.serviceProximity),
    cpcValue: Math.round(parts.cpcValue),
    localSerpFit: Math.round(parts.localSerpFit),
    paidCompetition: Math.round(parts.paidCompetition),
    total: Math.max(0, Math.min(100, Math.round(total))),
  };
}

export function computeTrafficScoreBreakdown(r: KeywordResearchResult, intel: {
  google: GoogleMetricData;
  dfs: DfsMetricData;
  serp: SerpSignals;
  referenceVolume: number | null;
}, ctx: ScoreContext): TrafficScoreBreakdown {
  const ref = intel.referenceVolume;
  const demand = ref !== null && ref > 0 && ctx.maxLogReferenceVolume > 0
    ? Math.min(100, (Math.log1p(ref) / ctx.maxLogReferenceVolume) * 100)
    : 0;
  const kd = intel.dfs.keywordDifficulty;
  const series = intel.google.monthlySearchVolumes ?? intel.dfs.monthlySearches ?? r.trend ?? null;
  const parts = {
    demand,
    lowDifficulty: kd === null ? NEUTRAL : Math.max(0, 100 - kd),
    trend: trendScore(series),
    serpOpportunity: intel.serp.serpOpportunityScore ?? NEUTRAL,
    topicalFit: r.score.relevance,
  };
  const total =
    parts.demand * TRAFFIC_SCORE_WEIGHTS.demand +
    parts.lowDifficulty * TRAFFIC_SCORE_WEIGHTS.lowDifficulty +
    parts.trend * TRAFFIC_SCORE_WEIGHTS.trend +
    parts.serpOpportunity * TRAFFIC_SCORE_WEIGHTS.serpOpportunity +
    parts.topicalFit * TRAFFIC_SCORE_WEIGHTS.topicalFit;
  return {
    demand: Math.round(parts.demand),
    lowDifficulty: Math.round(parts.lowDifficulty),
    trend: Math.round(parts.trend),
    serpOpportunity: Math.round(parts.serpOpportunity),
    topicalFit: Math.round(parts.topicalFit),
    total: Math.max(0, Math.min(100, Math.round(total))),
  };
}

/**
 * คำ volume 0/ไม่มีข้อมูล ที่ "มีหลักฐาน local จริง" — เก็บไว้เป็นโอกาสท้องถิ่น
 * เงื่อนไข: ระบุพื้นที่ที่ให้บริการจริง + เจตนาเชิงพาณิชย์ + (ถ้าเช็ค SERP แล้ว
 * ต้องมี local pack หรือหน้า service จริง; ถ้ายังไม่เช็ค ใช้สัญญาณ intent แรง)
 */
export function detectZeroVolumeLocalOpportunity(
  r: KeywordResearchResult,
  referenceVolume: number | null,
  serp: SerpSignals
): boolean {
  if (referenceVolume !== null && referenceVolume > 0) return false;
  const isLocal = r.locationRole === 'primary' || r.locationRole === 'nearby';
  if (!isLocal) return false;
  const commercial = r.intents.some(t =>
    t === 'commercial' || t === 'service_provider' || t === 'price' || t === 'urgency' || t === 'near_me');
  if (!commercial) return false;
  if (serp.status === 'ok') {
    return serp.hasLocalPack || serp.servicePageCount >= 2;
  }
  return r.score.commercialIntent >= 70;
}

export function computeFinalScore(
  sales: number,
  traffic: number,
  weights: { sales: number; traffic: number },
  confidence: VolumeConfidence,
  cannibalizationScore: number,
  zeroVolumeLocalOpportunity: boolean
): number {
  let score = sales * weights.sales + traffic * weights.traffic
    - confidencePenalty(confidence)
    - cannibalizationScore;
  // Local Opportunity Override — คำ local แท้ที่ volume เป็นศูนย์ไม่ถูกกดจนหลุดตาราง
  if (zeroVolumeLocalOpportunity) score += 5;
  return Math.max(0, Math.min(100, Math.round(score)));
}

// ── Doorway / location-swap protection (สเปก §45) ────────────────────────────

const NEAR_ME_KEYS = ['ใกล้ฉัน', 'ใกล้บ้าน', 'ใกล้ที่ทำงาน', 'nearme'];

/**
 * แกนของคีย์เวิร์ดเมื่อตัดชื่อพื้นที่ที่รู้จักออก — ใช้จับกลุ่มคำสลับพื้นที่
 * ("ล้างแอร์บางแค" / "ล้างแอร์ กรุงเทพ" / "ล้างแอร์ใกล้ฉัน" → แกน "ล้างแอร์")
 */
export function keywordCore(keyword: string, areaKeys: string[]): string {
  let core = dedupeKey(keyword);
  const sorted = [...areaKeys].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const key of sorted) {
    if (key.length >= 2) core = core.split(key).join('');
  }
  for (const near of NEAR_ME_KEYS) core = core.split(dedupeKey(near)).join('');
  return core;
}

export interface SwapGroupOutcome {
  /** dedupeKey ของคำที่ถูกลดชั้นเป็นคำรอง → dedupeKey ของคำหลักที่มันไปอยู่ด้วย */
  demoted: Map<string, { primaryKey: string; action: CannibalizationAction; reason: string }>;
}

/**
 * ภายในกลุ่มแกนเดียวกัน:
 *  - คำที่ระบุพื้นที่ให้บริการจริง (primary/nearby) → แยกกันได้ (ธุรกิจให้บริการจริง)
 *  - คำ "ใกล้ฉัน"/พื้นที่กว้าง (ไม่ผูกพื้นที่จำเพาะ) → รวมเป็นคำรองของ
 *    ตัวแทนที่คะแนนสูงสุดในแกนนั้น กันสร้างหน้า doorway ซ้ำเจตนา
 */
export function resolveLocationSwapGroups(
  results: Array<{ keyword: string; locationRole: string; finalScore: number }>,
  areaKeys: string[]
): SwapGroupOutcome {
  const groups = new Map<string, Array<{ keyword: string; locationRole: string; finalScore: number }>>();
  for (const r of results) {
    const core = keywordCore(r.keyword, areaKeys);
    if (!core) continue;
    const list = groups.get(core) ?? [];
    list.push(r);
    groups.set(core, list);
  }

  const demoted: SwapGroupOutcome['demoted'] = new Map();
  for (const list of Array.from(groups.values())) {
    if (list.length < 2) continue;
    const anchored = list.filter(r => r.locationRole === 'primary' || r.locationRole === 'nearby');
    const floating = list.filter(r => !(r.locationRole === 'primary' || r.locationRole === 'nearby'));
    if (anchored.length === 0 || floating.length === 0) continue;
    const primary = [...anchored].sort((a, b) => b.finalScore - a.finalScore)[0];
    for (const f of floating) {
      // คำกว้าง/ใกล้ฉัน แกนเดียวกับคำพื้นที่จริง → เป็นคำรองของหน้าเดียวกัน
      demoted.set(dedupeKey(f.keyword), {
        primaryKey: dedupeKey(primary.keyword),
        action: 'USE_AS_SECONDARY',
        reason: `เจตนาเดียวกับ "${primary.keyword}" (ต่างแค่รูปพื้นที่) — รวมเป็นคำรองกันหน้า doorway`,
      });
    }
  }
  return { demoted };
}

// ── SERP overlap clustering (สเปก §42) ───────────────────────────────────────

export function serpOverlapRatio(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  let shared = 0;
  for (const url of b) if (setA.has(url)) shared++;
  return shared / Math.min(a.length, b.length);
}

export interface SerpMergeOutcome {
  merged: Map<string, { primaryKey: string; overlap: number; reason: string }>;
}

/**
 * คำสองคำที่ SERP top10 ทับกันมาก = Google มองว่าเจตนาเดียวกัน → หน้าเดียวรับได้
 *  - ≥0.50 → รวมทันที
 *  - 0.35–0.49 → รวมเฉพาะเมื่อ search intent จาก DFS เป็นกลุ่มเดียวกัน
 */
export function mergeBySerpOverlap(
  items: Array<{
    keyword: string;
    finalScore: number;
    topUrls: string[];
    intent: string | null;
  }>
): SerpMergeOutcome {
  const merged: SerpMergeOutcome['merged'] = new Map();
  const eligible = items.filter(i => i.topUrls.length >= 5)
    .sort((a, b) => b.finalScore - a.finalScore);

  for (let i = 0; i < eligible.length; i++) {
    const primary = eligible[i];
    if (merged.has(dedupeKey(primary.keyword))) continue;
    for (let j = i + 1; j < eligible.length; j++) {
      const other = eligible[j];
      const otherKey = dedupeKey(other.keyword);
      if (merged.has(otherKey)) continue;
      const overlap = serpOverlapRatio(primary.topUrls, other.topUrls);
      const sameIntent = !primary.intent || !other.intent || primary.intent === other.intent;
      if (overlap >= 0.5 || (overlap >= 0.35 && sameIntent && primary.intent !== null)) {
        merged.set(otherKey, {
          primaryKey: dedupeKey(primary.keyword),
          overlap: Math.round(overlap * 100) / 100,
          reason: `SERP ทับกับ "${primary.keyword}" ${(overlap * 100).toFixed(0)}% — Google มองเป็นเจตนาเดียวกัน`,
        });
      }
    }
  }
  return { merged };
}

// ── Text-similarity merge (feedback HRC 2026-08) ────────────────────────────

export interface TextMergeOutcome {
  merged: Map<string, { primaryKey: string; reason: string }>;
}

/**
 * จับคำที่ "ข้อความแทบเป็นคำเดียวกัน" ให้รวมกันแม้ไม่มีข้อมูล SERP
 * (mergeBySerpOverlap ต้องมี topUrls ≥ 5 ซึ่งเช็กได้แค่บางคำ) — สองเงื่อนไข:
 *  - orderFreeKey ตรงกัน = token ชุดเดียวกันสลับตำแหน่ง/คำพ้อง ("ล้างแอร์ บางนา ราคาถูก"
 *    vs "บางนา ล้างแอร์ ราคาถูก") → รวมแน่นอน
 *  - char-bigram dice ≥ 0.9 = สะกดต่างนิดเดียว → รวม
 */
export function mergeByTextSimilarity(
  items: Array<{ keyword: string; finalScore: number }>
): TextMergeOutcome {
  const merged: TextMergeOutcome['merged'] = new Map();
  const sorted = [...items].sort((a, b) => b.finalScore - a.finalScore);
  const orderKeys = sorted.map(i => orderFreeKey(i.keyword));
  for (let i = 0; i < sorted.length; i++) {
    const hi = sorted[i];
    if (merged.has(dedupeKey(hi.keyword))) continue;
    for (let j = i + 1; j < sorted.length; j++) {
      const lo = sorted[j];
      const loKey = dedupeKey(lo.keyword);
      if (merged.has(loKey)) continue;
      const sameTokens = orderKeys[i] === orderKeys[j];
      if (!sameTokens && textSimilarity(hi.keyword, lo.keyword) < 0.9) continue;
      merged.set(loKey, {
        primaryKey: dedupeKey(hi.keyword),
        reason: sameTokens
          ? `คำเดียวกับ "${hi.keyword}" (สลับตำแหน่งคำ/คำพ้อง) — รวมเป็นคำรอง`
          : `ข้อความแทบเหมือน "${hi.keyword}" — รวมเป็นคำรองกันหน้าซ้ำ`,
      });
    }
  }
  return { merged };
}

// ── Cluster quota planner (สเปก §49) ─────────────────────────────────────────

const MAX_CLUSTER_SHARE = 0.35;

/**
 * แจกโควตาต่อคลัสเตอร์ตามน้ำหนักคุณภาพรวมของคลัสเตอร์ (ไม่ใช่ sort รวมอย่างเดียว)
 * — คลัสเตอร์เด่นได้ที่มากกว่า แต่ไม่เกิน 35% ของตาราง และทุกคลัสเตอร์ที่มีของดี
 * ได้อย่างน้อย 1 ที่ จากนั้นเติมที่เหลือด้วยคะแนนรวม
 */
export function selectWithClusterQuota<T extends { cluster?: string; keyword: string }>(
  results: T[],
  target: number,
  scoreOf: (r: T) => number
): T[] {
  if (target <= 0 || results.length === 0) return [];
  const byCluster = new Map<string, T[]>();
  for (const r of results) {
    const key = r.cluster ?? 'อื่น ๆ';
    const list = byCluster.get(key) ?? [];
    list.push(r);
    byCluster.set(key, list);
  }
  for (const list of Array.from(byCluster.values())) list.sort((a, b) => scoreOf(b) - scoreOf(a));

  // น้ำหนักคลัสเตอร์ = ผลรวมคะแนน top 5 ของคลัสเตอร์ (กันคลัสเตอร์ใหญ่ชนะเพราะจำนวน)
  const weights = new Map<string, number>();
  let totalWeight = 0;
  for (const [name, list] of Array.from(byCluster.entries())) {
    const w = list.slice(0, 5).reduce((sum, r) => sum + scoreOf(r), 0);
    weights.set(name, w);
    totalWeight += w;
  }

  const maxPerCluster = Math.max(1, Math.floor(target * MAX_CLUSTER_SHARE));
  const chosen: T[] = [];
  const chosenKeys = new Set<string>();
  const takenPerCluster = new Map<string, number>();

  const tryTake = (r: T, cluster: string): boolean => {
    const key = dedupeKey(r.keyword);
    if (!key || chosenKeys.has(key)) return false;
    const count = takenPerCluster.get(cluster) ?? 0;
    if (count >= maxPerCluster) return false;
    chosenKeys.add(key);
    chosen.push(r);
    takenPerCluster.set(cluster, count + 1);
    return true;
  };

  // รอบแรก: โควตาตามน้ำหนัก (ขั้นต่ำ 1 ต่อคลัสเตอร์ที่มีคะแนน)
  for (const [name, list] of Array.from(byCluster.entries()).sort((a, b) => (weights.get(b[0]) ?? 0) - (weights.get(a[0]) ?? 0))) {
    if (chosen.length >= target) break;
    const share = totalWeight > 0 ? (weights.get(name) ?? 0) / totalWeight : 0;
    const quota = Math.max(1, Math.min(maxPerCluster, Math.round(target * share)));
    let taken = 0;
    for (const r of list) {
      if (taken >= quota || chosen.length >= target) break;
      if (tryTake(r, name)) taken++;
    }
  }

  // รอบเติม: คะแนนรวมทั้งชุด (ยังเคารพเพดาน 35% ต่อคลัสเตอร์)
  if (chosen.length < target) {
    const rest = results
      .filter(r => !chosenKeys.has(dedupeKey(r.keyword)))
      .sort((a, b) => scoreOf(b) - scoreOf(a));
    for (const r of rest) {
      if (chosen.length >= target) break;
      tryTake(r, r.cluster ?? 'อื่น ๆ');
    }
  }
  // รอบสุดท้าย: ถ้ายังไม่ครบเพราะเพดานคลัสเตอร์ ให้ผ่อนเพดาน (คุณภาพ > เพดานเทียม)
  if (chosen.length < target) {
    const rest = results
      .filter(r => !chosenKeys.has(dedupeKey(r.keyword)))
      .sort((a, b) => scoreOf(b) - scoreOf(a));
    for (const r of rest) {
      if (chosen.length >= target) break;
      const key = dedupeKey(r.keyword);
      if (!key || chosenKeys.has(key)) continue;
      chosenKeys.add(key);
      chosen.push(r);
    }
  }

  return chosen.sort((a, b) => scoreOf(b) - scoreOf(a));
}

// ── Publish waves (สเปก §52) ─────────────────────────────────────────────────

/**
 * Wave 1 ≈ 15% แบบ portfolio สมดุล (ไล่หยิบข้ามคลัสเตอร์ตามคะแนน),
 * Wave 2 ≈ 30% ถัดไปตามคะแนน, ที่เหลือ Wave 3
 */
export function assignWaves<T extends { cluster?: string; keyword: string }>(
  selected: T[],
  scoreOf: (r: T) => number
): Map<string, 1 | 2 | 3> {
  const waves = new Map<string, 1 | 2 | 3>();
  if (selected.length === 0) return waves;
  const wave1Count = Math.max(1, Math.ceil(selected.length * 0.15));
  const wave2Count = Math.max(0, Math.ceil(selected.length * 0.30));

  // Wave 1: round-robin ข้ามคลัสเตอร์ เรียงในคลัสเตอร์ตามคะแนน — portfolio สมดุล
  const byCluster = new Map<string, T[]>();
  for (const r of [...selected].sort((a, b) => scoreOf(b) - scoreOf(a))) {
    const key = r.cluster ?? 'อื่น ๆ';
    const list = byCluster.get(key) ?? [];
    list.push(r);
    byCluster.set(key, list);
  }
  const queues = Array.from(byCluster.values());
  let assigned = 0;
  let qi = 0;
  let guard = selected.length * 2;
  while (assigned < wave1Count && guard-- > 0) {
    const queue = queues[qi % queues.length];
    qi++;
    const next = queue.shift();
    if (!next) continue;
    waves.set(dedupeKey(next.keyword), 1);
    assigned++;
  }

  // Wave 2/3: ที่เหลือเรียงตามคะแนน
  const rest = selected
    .filter(r => !waves.has(dedupeKey(r.keyword)))
    .sort((a, b) => scoreOf(b) - scoreOf(a));
  rest.forEach((r, i) => {
    waves.set(dedupeKey(r.keyword), i < wave2Count ? 2 : 3);
  });
  return waves;
}

// ── ตัวช่วยประกอบ intel ให้ครบหนึ่งคำ ────────────────────────────────────────

export function buildIntel(
  r: KeywordResearchResult,
  raw: {
    google: GoogleMetricData;
    dfs: DfsMetricData;
    searchIntent: SearchIntentData;
    serp: SerpSignals;
    candidateSources: string[];
  },
  weights: { sales: number; traffic: number },
  ctx: ScoreContext
): KeywordIntel {
  const ref = resolveReferenceVolume(raw.google, raw.dfs);
  const zeroLocal = detectZeroVolumeLocalOpportunity(r, ref.volume, raw.serp);
  const confidence = computeVolumeConfidence(raw.google, raw.dfs, { zeroVolumeLocalOpportunity: zeroLocal });
  const salesScore = computeSalesScoreBreakdown(r, raw, ctx);
  const trafficScore = computeTrafficScoreBreakdown(r, { ...raw, referenceVolume: ref.volume }, ctx);
  const finalScore = computeFinalScore(salesScore.total, trafficScore.total, weights, confidence, 0, zeroLocal);
  return {
    canonicalKeyword: dedupeKey(r.keyword),
    google: raw.google,
    dfs: raw.dfs,
    referenceVolume: ref.volume,
    referenceSource: ref.source,
    confidence,
    searchIntent: raw.searchIntent,
    serp: raw.serp,
    zeroVolumeLocalOpportunity: zeroLocal,
    salesScore,
    trafficScore,
    finalScore,
    cannibalization: { score: 0, action: 'KEEP' },
    secondaryKeywords: [],
    wave: null,
    candidateSources: raw.candidateSources,
  };
}
