/**
 * System Scores (0–100) ของโหมดออนไลน์ — คำนวณในโค้ดล้วน ๆ
 * วัตถุดิบ: ตัวเลขจริงจาก Google KP / DataForSEO / SERP + ผลจัดหมวดจาก AI
 * (AI ให้แค่ "หมวด" ไม่เคยให้ "ตัวเลข")
 */

import type {
  DfsMetricData,
  GoogleMetricData,
  ReferenceVolume,
  SearchIntentData,
  SerpSignals,
  VolumeConfidence,
} from '@/lib/wordgod/local/metrics';
import { confidencePenalty } from '@/lib/wordgod/local/metrics';
import type { CandidateClassification } from './blueprint';
import type {
  BusinessBlueprint,
  FunnelStage,
  Objective,
  OnlineResearchInput,
  PageType,
  StrategyPreset,
  SystemScores,
} from './types';
import { JOURNEY_STAGE_MAP } from './types';

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)));

export interface ScoringContext {
  input: OnlineResearchInput;
  blueprint: BusinessBlueprint;
  preset: StrategyPreset;
  /** token ของสินค้า/บริการ + แบรนด์ (lowercase) ใช้เช็คการชนตรง */
  productTokens: string[];
  problemPhrases: string[];
}

export function buildScoringContext(
  input: OnlineResearchInput,
  blueprint: BusinessBlueprint,
  preset: StrategyPreset
): ScoringContext {
  const productTokens = [
    ...input.products,
    ...(input.brandName ? [input.brandName] : []),
    ...blueprint.taxonomy.map(t => t.product),
  ]
    .map(t => t.trim().toLowerCase())
    .filter(t => t.length >= 2);
  const problemPhrases = [
    ...blueprint.problemMap.flatMap(p => [p.problem, ...p.searchBehaviors]),
    ...(input.customerProblems ?? []),
  ]
    .map(t => t.trim().toLowerCase())
    .filter(t => t.length >= 3);
  return { input, blueprint, preset, productTokens: Array.from(new Set(productTokens)), problemPhrases };
}

// ── องค์ประกอบย่อย ──────────────────────────────────────────────────────────

/** demand จาก reference volume (log scale): 0→0, 100→50, 10k→80, 100k→100 */
export function demandScore(reference: ReferenceVolume): number {
  if (reference.source === 'none' || reference.volume === null) return 0;
  if (reference.volume <= 0) return 5;
  return clamp((Math.log10(reference.volume + 1) / 5) * 100);
}

/** KD ต่ำ = โอกาสสูง; ไม่มีข้อมูล = กลาง 50 (ไม่แต่งเลข) */
export function lowKdScore(dfs: DfsMetricData): number {
  const kd = dfs.keywordDifficulty;
  if (kd === null || kd === undefined) return 50;
  return clamp(100 - kd);
}

/** โอกาสจาก SERP จริง: SERP อ่อน (UGC/forum/ไม่มีแบรนด์ใหญ่แน่น) = สูง; ไม่ได้ตรวจ = 50 */
export function serpOpportunityScore(serp: SerpSignals): number {
  if (serp.status !== 'ok' || !serp.topDomains.length) return 50;
  // ถ้า SERP layer คำนวณ opportunity ไว้แล้ว (สูตรเดียวกับโหมด local) ใช้ค่านั้น
  if (serp.serpOpportunityScore !== null) return clamp(serp.serpOpportunityScore);
  let score = 50;
  const domains = serp.topDomains.map(d => d.toLowerCase());
  const ugc = domains.filter(d => /pantip|facebook|youtube|tiktok|reddit|blogspot|medium|sanook|kapook/.test(d)).length;
  score += ugc * 8;
  if (serp.servicePageCount >= 6) score -= 15;
  else if (serp.servicePageCount >= 4) score -= 8;
  const bigBrands = domains.filter(d => /shopee|lazada|wikipedia|amazon/.test(d)).length;
  score -= bigBrands * 6;
  return clamp(score);
}

/** เทรนด์จาก monthly history ของ Google KP: 3 เดือนหลังเทียบก่อนหน้า; ไม่มีข้อมูล = 50 */
export function trendScore(google: GoogleMetricData): number {
  const hist = google.monthlySearchVolumes;
  if (!hist || hist.length < 6) return 50;
  const recent = hist.slice(-3);
  const prior = hist.slice(0, -3);
  const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  const prevAvg = avg(prior);
  if (prevAvg <= 0) return avg(recent) > 0 ? 70 : 50;
  const ratio = avg(recent) / prevAvg;
  if (ratio >= 1.5) return 90;
  if (ratio >= 1.15) return 75;
  if (ratio >= 0.85) return 55;
  if (ratio >= 0.6) return 35;
  return 20;
}

export function businessRelevanceScore(keyword: string, cls: CandidateClassification, ctx: ScoringContext): number {
  const kw = keyword.toLowerCase();
  let score = cls.relevanceTier * 22; // 0/22/44/66/88
  if (ctx.productTokens.some(t => kw.includes(t))) score += 12;
  if (cls.serviceOrProduct && kw.includes(cls.serviceOrProduct.toLowerCase())) score += 4;
  return clamp(score);
}

export function problemRelevanceScore(keyword: string, cls: CandidateClassification, ctx: ScoringContext): number {
  const kw = keyword.toLowerCase();
  const stage = JOURNEY_STAGE_MAP[cls.journeyStage];
  let score = 20;
  if (cls.problemGroup) {
    score = 65;
    const entry = ctx.blueprint.problemMap.find(p => p.problem === cls.problemGroup);
    if (entry?.severity === 'HIGH') score += 15;
    else if (entry?.severity === 'MEDIUM') score += 8;
  }
  if (ctx.problemPhrases.some(p => kw.includes(p) || p.includes(kw))) score += 12;
  if (['PROBLEM_AWARENESS', 'SYMPTOM_SEARCH', 'CAUSE_EXPLORATION'].includes(stage.stage)) score += 8;
  return clamp(score);
}

/**
 * Revenue Proximity: ช่วงตาม journey stage แล้วขยับในช่วงตาม business intent
 * + ความน่าจะเป็น transactional จาก DFS (ข้อมูลจริง)
 */
export function revenueProximityScore(cls: CandidateClassification, intent: SearchIntentData): number {
  const [lo, hi] = JOURNEY_STAGE_MAP[cls.journeyStage].revenueProximity;
  let t = 0.4;
  if (cls.businessIntent === 'TRANSACTIONAL') t = 0.85;
  else if (cls.businessIntent === 'EVALUATIVE') t = 0.6;
  if (intent.status === 'ok' && intent.intent === 'transactional') t = Math.max(t, 0.75 + (intent.probability ?? 0) * 0.25);
  else if (intent.status === 'ok' && intent.intent === 'commercial') t = Math.max(t, 0.6);
  return clamp(lo + (hi - lo) * t);
}

const QUESTION_WORDS = ['คือ', 'อะไร', 'ทำไม', 'ยังไง', 'อย่างไร', 'วิธี', 'ไหม', 'มั้ย', 'กี่', 'เมื่อไหร่', 'ที่ไหน', 'ใคร', 'what', 'why', 'how', 'when', 'is ', 'do ', 'does '];
const COMPARISON_WORDS = ['vs', 'เทียบ', 'เปรียบเทียบ', 'ต่างกัน', 'แบบไหนดี', 'อันไหนดี', 'ยี่ห้อไหนดี', 'เจ้าไหนดี', 'ดีกว่า'];
const AUTHORITY_WORDS = ['รีวิว', 'จัดอันดับ', 'ที่ดีที่สุด', 'แนะนำ', 'top', 'best', 'อันดับ', 'รวม', 'ลิสต์'];

/** AEO: สัญญาณคำถาม/นิยาม/เทียบ + PAA จริงใน SERP + intent informational จริง */
export function aeoOpportunityScore(keyword: string, cls: CandidateClassification, intent: SearchIntentData, serp: SerpSignals): number {
  const kw = keyword.toLowerCase();
  let score = 20;
  if (QUESTION_WORDS.some(q => kw.includes(q))) score += 30;
  if (COMPARISON_WORDS.some(q => kw.includes(q))) score += 15;
  if (cls.journeyStage === 'AEO_QUESTION') score += 20;
  if (intent.status === 'ok' && intent.intent === 'informational') score += 10;
  if (serp.status === 'ok' && serp.articleCount >= 5) score += 5; // SERP เป็นสนามคอนเทนต์ ตอบคำถามแทรกได้
  const wordCount = kw.split(/\s+/).length;
  if (wordCount >= 3) score += 5; // long-tail ตอบตรงคำถามได้กระชับ
  return clamp(score);
}

/** GEO (Generative Engine Optimization): สัญญาณ entity/citation/authority สำหรับ AI search */
export function geoOpportunityScore(keyword: string, cls: CandidateClassification, ctx: ScoringContext, serp: SerpSignals): number {
  const kw = keyword.toLowerCase();
  let score = 20;
  if (cls.journeyStage === 'GEO_AI_TOPIC') score += 25;
  if (AUTHORITY_WORDS.some(q => kw.includes(q))) score += 20;
  if (COMPARISON_WORDS.some(q => kw.includes(q))) score += 12;
  if (ctx.productTokens.some(t => kw.includes(t))) score += 10; // entity ตรงธุรกิจ
  if (['EDUCATION_BASICS', 'SOLUTION_AWARENESS', 'SOLUTION_COMPARISON', 'REVIEWS_PROOF'].includes(cls.journeyStage)) score += 10;
  if (serp.status === 'ok' && serp.topDomains.some(d => /wikipedia|wiki/.test(d))) score += 8; // SERP เชิง entity
  return clamp(score);
}

/** ความเข้ากันระหว่าง journey stage กับเป้ากลยุทธ์ (Sales/Traffic weights) */
export function journeyFitScore(cls: CandidateClassification, preset: StrategyPreset): number {
  const stage = JOURNEY_STAGE_MAP[cls.journeyStage];
  const salesFit = stage.funnel === 'BOFU' ? 100 : stage.funnel === 'MOFU' ? 70 : 35;
  const trafficFit = stage.funnel === 'TOFU' ? 100 : stage.funnel === 'MOFU' ? 70 : 45;
  return clamp((salesFit * preset.sales + trafficFit * preset.traffic) / 100);
}

// ── รวมคะแนน ────────────────────────────────────────────────────────────────

export interface ScoreInputs {
  keyword: string;
  cls: CandidateClassification;
  google: GoogleMetricData;
  dfs: DfsMetricData;
  reference: ReferenceVolume;
  confidence: VolumeConfidence;
  intent: SearchIntentData;
  serp: SerpSignals;
  cannibalizationPenalty: number;
}

export function computeSystemScores(si: ScoreInputs, ctx: ScoringContext): SystemScores {
  const businessRelevance = businessRelevanceScore(si.keyword, si.cls, ctx);
  const problemRelevance = problemRelevanceScore(si.keyword, si.cls, ctx);
  const revenueProximity = revenueProximityScore(si.cls, si.intent);
  const seoOpportunity = clamp(
    demandScore(si.reference) * 0.3 +
    lowKdScore(si.dfs) * 0.2 +
    serpOpportunityScore(si.serp) * 0.2 +
    businessRelevance * 0.2 +
    trendScore(si.google) * 0.1
  );
  const aeoOpportunity = aeoOpportunityScore(si.keyword, si.cls, si.intent, si.serp);
  const geoOpportunity = geoOpportunityScore(si.keyword, si.cls, ctx, si.serp);
  const journeyFit = journeyFitScore(si.cls, ctx.preset);
  const businessScore = clamp(
    businessRelevance * 0.3 + revenueProximity * 0.3 + problemRelevance * 0.2 + journeyFit * 0.2
  );
  const w = ctx.preset.finalWeights;
  const finalScore = clamp(
    businessScore * w.business +
    seoOpportunity * w.seo +
    ((aeoOpportunity + geoOpportunity) / 2) * w.aeoGeo -
    si.cannibalizationPenalty -
    confidencePenalty(si.confidence)
  );
  return {
    businessRelevance,
    problemRelevance,
    revenueProximity,
    seoOpportunity,
    aeoOpportunity,
    geoOpportunity,
    businessScore,
    finalScore,
    cannibalizationPenalty: si.cannibalizationPenalty,
  };
}

// ── Funnel / Objective / Page type (deterministic) ──────────────────────────

export function resolveFunnel(cls: CandidateClassification, intent: SearchIntentData): FunnelStage {
  const base = JOURNEY_STAGE_MAP[cls.journeyStage].funnel;
  if (intent.status === 'ok') {
    if (intent.intent === 'transactional' && base === 'TOFU') return 'MOFU';
    if (intent.intent === 'informational' && base === 'BOFU' && cls.businessIntent !== 'TRANSACTIONAL') return 'MOFU';
  }
  return base;
}

export function resolveObjective(cls: CandidateClassification, funnel: FunnelStage): Objective {
  if (funnel === 'BOFU' || cls.businessIntent === 'TRANSACTIONAL') return 'SALE';
  if (funnel === 'MOFU') return 'LEAD';
  return JOURNEY_STAGE_MAP[cls.journeyStage].objective;
}

export function recommendPageType(keyword: string, cls: CandidateClassification, funnel: FunnelStage, businessType: OnlineResearchInput['businessType']): PageType {
  const kw = keyword.toLowerCase();
  if (COMPARISON_WORDS.some(q => kw.includes(q))) return 'COMPARISON_PAGE';
  if (cls.journeyStage === 'AEO_QUESTION') return 'FAQ_PAGE';
  if (cls.journeyStage === 'REVIEWS_PROOF') return 'CASE_STUDY';
  if (funnel === 'BOFU') {
    if (businessType === 'ECOMMERCE') return kw.includes('ยี่ห้อ') || kw.includes('รุ่น') ? 'PRODUCT_PAGE' : 'CATEGORY_PAGE';
    return 'LANDING_PAGE';
  }
  if (funnel === 'MOFU' && ['PRODUCT_DISCOVERY', 'FEATURE_EXPLORATION'].includes(cls.journeyStage)) {
    return businessType === 'ECOMMERCE' ? 'CATEGORY_PAGE' : 'LANDING_PAGE';
  }
  return 'ARTICLE';
}
