/**
 * WordGod Local SME — Priority Score
 *
 * สูตร (§11):
 *   priorityScore = localIntent×0.40 + commercialIntent×0.30 + volume×0.15
 *                 + competitionOpportunity×0.10 + relevance×0.05
 *
 * กติกาสำคัญ:
 *  - Volume = 0 หรือไม่มีข้อมูล ไม่ได้แปลว่าคีย์เวิร์ดไร้ค่า (§12)
 *    คำที่ระบุพื้นที่ตรง + เจตนาซื้อชัด ยังขึ้น High ได้ด้วยน้ำหนัก 70% แรก
 *  - Competition ที่ใช้คือ "Ads Competition" ของ Google Ads — ไม่ใช่ SEO Difficulty
 *  - ทุกคะแนนย่อย normalize 0–100 ก่อนถ่วงน้ำหนัก, คะแนนรวมปัดเป็นจำนวนเต็ม 0–100
 */

import {
  BARE_SERVICE_COMMERCIAL_SCORE,
  COMMERCIAL_INTENT_SCORES,
  COMMERCIAL_STACK_BONUS,
  HYPER_LOCAL_BONUS,
  INFORMATIONAL_INTENT_TAGS,
  LOCAL_EXACT_COMMERCIAL_SCORE,
  LOCAL_INTENT_SCORES,
  LOCAL_KEYWORD_WEIGHTS,
  NEUTRAL_COMPETITION_OPPORTUNITY,
  PRIORITY_THRESHOLDS,
} from './config';
import { detectModifierTags } from './intentModifiers';
import { dedupeKey } from './normalize';
import { keywordTokens } from '../text/thai';
import type {
  KeywordScore,
  LocalArea,
  LocalBusinessType,
  LocalIntentTag,
  PriorityLevel,
} from './types';

export interface ScoringContext {
  services: string[];
  primaryLocation: LocalArea;
  nearbyLocations: LocalArea[];
  businessType: LocalBusinessType;
  businessContext?: string;
  /** log1p(volume) สูงสุดในชุดผลลัพธ์ ใช้ normalize คะแนน Volume */
  maxLogVolume: number;
}

export interface LocationMatch {
  area: LocalArea | null;
  role: 'primary' | 'nearby' | 'none';
  /** จับได้จากคำว่า "ใกล้ฉัน/ใกล้บ้าน" แทนชื่อพื้นที่ */
  viaNearMe: boolean;
  /** จับได้แค่ระดับกว้าง เช่น ชื่อจังหวัด / กรุงเทพฯ */
  viaBroaderArea: boolean;
}

const NEAR_ME_PATTERN = /ใกล้ฉัน|ใกล้บ้าน|ใกล้ที่ทำงาน|ใกล้ๆ|near me/i;
const BROAD_AREA_PATTERN = /กรุงเทพ|กทม|bangkok/i;

/** หาว่าคีย์เวิร์ดอ้างถึงพื้นที่ไหน — เทียบแบบตัดช่องว่างเพราะไทยเขียนติดกัน */
export function matchLocation(keyword: string, context: ScoringContext): LocationMatch {
  const key = dedupeKey(keyword);
  const primaryKey = dedupeKey(context.primaryLocation.name);
  if (primaryKey && key.includes(primaryKey)) {
    return { area: context.primaryLocation, role: 'primary', viaNearMe: false, viaBroaderArea: false };
  }
  for (const area of context.nearbyLocations) {
    const areaKey = dedupeKey(area.name);
    if (areaKey && key.includes(areaKey)) {
      return { area, role: 'nearby', viaNearMe: false, viaBroaderArea: false };
    }
  }
  if (NEAR_ME_PATTERN.test(keyword)) {
    return { area: null, role: 'none', viaNearMe: true, viaBroaderArea: false };
  }
  const parentKey = dedupeKey(context.primaryLocation.parent ?? '');
  const broader = (parentKey && key.includes(parentKey)) || BROAD_AREA_PATTERN.test(keyword);
  return { area: null, role: 'none', viaNearMe: false, viaBroaderArea: !!broader };
}

/** คะแนน Local Intent 0–100 พร้อมโบนัส Hyper-Local ตามรูปแบบธุรกิจ (§25) */
export function localIntentScore(match: LocationMatch, businessType: LocalBusinessType): number {
  let base: number;
  if (match.role === 'primary') base = LOCAL_INTENT_SCORES.primaryLocationExact;
  else if (match.role === 'nearby') base = LOCAL_INTENT_SCORES.nearbyLocation;
  else if (match.viaNearMe) base = LOCAL_INTENT_SCORES.nearMe;
  else if (match.viaBroaderArea) base = LOCAL_INTENT_SCORES.broaderArea;
  else base = LOCAL_INTENT_SCORES.none;

  // พื้นที่ระดับถนน/รถไฟฟ้า/แลนด์มาร์กจำเพาะกว่าระดับเขต จึงยกพื้นให้
  const type = match.area?.type;
  if (type === 'road' || type === 'bts' || type === 'mrt' || type === 'arl') {
    base = Math.max(base, LOCAL_INTENT_SCORES.transitOrRoad);
  } else if (type === 'landmark') {
    base = Math.max(base, LOCAL_INTENT_SCORES.landmark);
  }

  const bonusTable = HYPER_LOCAL_BONUS[businessType] ?? {};
  const bonusKey = match.viaNearMe ? 'near_me' : type;
  const bonus = bonusKey ? (bonusTable[bonusKey] ?? 0) : 0;

  return Math.max(0, Math.min(100, base + bonus));
}

/** คะแนน Commercial Intent 0–100 จาก tag ที่ตรวจพบ */
export function commercialIntentScore(tags: LocalIntentTag[], hasModifier: boolean): number {
  const commercialTags = tags.filter(t => t !== 'local' && COMMERCIAL_INTENT_SCORES[t] !== undefined);

  // คำที่ระบุพื้นที่ตรง ("ล้างแอร์บางแค") มีพื้นเจตนาซื้อสูงกว่าคำบริการลอย ๆ
  // แต่ถ้าสัญญาณที่เจอทั้งหมดเป็นแนวหาความรู้ ("วิธีล้างแอร์บางแค") ไม่ยกพื้นให้
  const allInformational =
    commercialTags.length > 0 && commercialTags.every(t => INFORMATIONAL_INTENT_TAGS.includes(t));
  const floor = tags.includes('local') && !allInformational
    ? LOCAL_EXACT_COMMERCIAL_SCORE
    : hasModifier ? 40 : BARE_SERVICE_COMMERCIAL_SCORE;

  if (commercialTags.length === 0) return floor;

  const scores = commercialTags.map(t => COMMERCIAL_INTENT_SCORES[t]).sort((a, b) => b - a);
  // นับเฉพาะ tag ที่ "ตั้งใจซื้อ" จริง ๆ ในการบวกโบนัสซ้อน
  const strong = commercialTags.filter(t => COMMERCIAL_INTENT_SCORES[t] >= 70).length;
  const stack = Math.max(0, strong - 1) * COMMERCIAL_STACK_BONUS;
  return Math.max(0, Math.min(100, Math.max(scores[0] + stack, floor)));
}

/** Volume → 0–100 ด้วย log1p แล้ว normalize กับค่าสูงสุดในชุด (§11) */
export function volumeScore(volume: number | null | undefined, maxLogVolume: number): number {
  if (volume === null || volume === undefined || volume <= 0) return 0;
  if (maxLogVolume <= 0) return 0;
  return Math.max(0, Math.min(100, (Math.log1p(volume) / maxLogVolume) * 100));
}

/** โอกาสจากการแข่งขันโฆษณา = 100 − Ads Competition Index */
export function competitionOpportunityScore(competitionIndex: number | null | undefined): number {
  if (competitionIndex === null || competitionIndex === undefined) return NEUTRAL_COMPETITION_OPPORTUNITY;
  return Math.max(0, Math.min(100, 100 - competitionIndex));
}

/** ความเกี่ยวข้องกับบริการที่ทำจริง 0–100 */
export function relevanceScore(keyword: string, context: ScoringContext): number {
  const key = dedupeKey(keyword);
  let best = 0;

  for (const service of context.services) {
    const serviceKey = dedupeKey(service);
    if (serviceKey && key.includes(serviceKey)) {
      best = Math.max(best, 100);
      continue;
    }
    const serviceTokens = Array.from(keywordTokens(service, 'th'));
    if (serviceTokens.length === 0) continue;
    const hit = serviceTokens.filter(token => key.includes(dedupeKey(token))).length;
    best = Math.max(best, (hit / serviceTokens.length) * 90);
  }

  if (best < 60 && context.businessContext) {
    const contextTokens = Array.from(keywordTokens(context.businessContext, 'th'));
    const hit = contextTokens.filter(token => token.length > 1 && key.includes(dedupeKey(token))).length;
    if (contextTokens.length > 0) best = Math.max(best, (hit / contextTokens.length) * 60);
  }

  return Math.max(0, Math.min(100, Math.round(best)));
}

export interface ScoreInput {
  keyword: string;
  volume: number | null | undefined;
  competitionIndex: number | null | undefined;
  intents: LocalIntentTag[];
  hasModifier: boolean;
  locationMatch: LocationMatch;
}

export function computeKeywordScore(input: ScoreInput, context: ScoringContext): KeywordScore {
  const parts = {
    localIntent: localIntentScore(input.locationMatch, context.businessType),
    commercialIntent: commercialIntentScore(input.intents, input.hasModifier),
    volume: volumeScore(input.volume, context.maxLogVolume),
    competitionOpportunity: competitionOpportunityScore(input.competitionIndex),
    relevance: relevanceScore(input.keyword, context),
  };

  const total =
    parts.localIntent * LOCAL_KEYWORD_WEIGHTS.localIntent +
    parts.commercialIntent * LOCAL_KEYWORD_WEIGHTS.commercialIntent +
    parts.volume * LOCAL_KEYWORD_WEIGHTS.volume +
    parts.competitionOpportunity * LOCAL_KEYWORD_WEIGHTS.competitionOpportunity +
    parts.relevance * LOCAL_KEYWORD_WEIGHTS.relevance;

  return {
    total: Math.max(0, Math.min(100, Math.round(total))),
    localIntent: Math.round(parts.localIntent),
    commercialIntent: Math.round(parts.commercialIntent),
    volume: Math.round(parts.volume),
    competitionOpportunity: Math.round(parts.competitionOpportunity),
    relevance: Math.round(parts.relevance),
  };
}

export function priorityLevel(total: number): PriorityLevel {
  if (total >= PRIORITY_THRESHOLDS.high) return 'high';
  if (total >= PRIORITY_THRESHOLDS.medium) return 'medium';
  return 'low';
}

/** คะแนนที่ "ได้จริง" ของแต่ละมิติ เทียบกับเพดานของมิตินั้น — ใช้แสดง breakdown (§19) */
export function scoreBreakdown(score: KeywordScore): Array<{
  key: keyof Omit<KeywordScore, 'total'>;
  label: string;
  earned: number;
  max: number;
}> {
  const labels: Record<keyof Omit<KeywordScore, 'total'>, string> = {
    localIntent: 'ตรงพื้นที่',
    commercialIntent: 'เจตนาจะใช้บริการ',
    volume: 'ปริมาณการค้นหา',
    competitionOpportunity: 'โอกาสจากการแข่งขัน',
    relevance: 'ตรงกับบริการที่ทำ',
  };
  return (Object.keys(labels) as Array<keyof Omit<KeywordScore, 'total'>>).map(key => {
    const max = LOCAL_KEYWORD_WEIGHTS[key] * 100;
    return {
      key,
      label: labels[key],
      earned: Math.round(score[key] * LOCAL_KEYWORD_WEIGHTS[key] * 10) / 10,
      max: Math.round(max * 10) / 10,
    };
  });
}

export { detectModifierTags };
