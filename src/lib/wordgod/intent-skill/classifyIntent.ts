/**
 * Keyword Intent Skill — จัด intent รายคีย์เวิร์ด (ขั้นที่ 1 ของ pipeline)
 *
 * ลำดับตัดสิน:
 *  1) แบรนด์ตัวเอง/คู่แข่งใน keyword → N
 *  2) cue (ตาราง cues.ts) + สัญญาณ SERP/DFS ผสมกัน
 *  3) ไม่มี cue ไม่มี SERP → เดาจากบริการที่ผูกไว้ (row.service / profile.servicesOffered)
 */
import type { BusinessProfile, IntentCode, IntentEvidence, IntentMix, IntentSkillInputRow, KeywordIntent } from './types';
import { normalizeThaiKey, containsTerm } from './thaiNormalize';
import { detectIntentCues, detectThaiProvince } from './cues';

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

interface SerpSignal {
  code: IntentCode | null;
  weight: number;
  evidence: IntentEvidence[];
}

const DFS_INTENT_MAP: Record<string, IntentCode> = {
  informational: 'I',
  commercial: 'C',
  transactional: 'T',
  navigational: 'N',
};

/** รวมสัญญาณ SERP/DFS ทั้งหมดเป็นโค้ดเดียว (น้ำหนักสูงสุดชนะ) */
function computeSerpSignal(row: IntentSkillInputRow): SerpSignal {
  const weights = new Map<IntentCode, number>();
  const evidence: IntentEvidence[] = [];
  const add = (code: IntentCode, weight: number, detail: string) => {
    weights.set(code, (weights.get(code) ?? 0) + weight);
    evidence.push({ source: weight >= 1 && detail.startsWith('dfs') ? 'dfs' : 'serp', detail });
  };

  if (row.dfsIntent && DFS_INTENT_MAP[row.dfsIntent]) {
    const w = row.dfsProbability ?? 0.5;
    add(DFS_INTENT_MAP[row.dfsIntent], w, `dfsIntent: ${row.dfsIntent} (${w})`);
  }
  if (row.serpIntent === 'service') add('T', 0.6, 'serpIntent: service');
  else if (row.serpIntent === 'informational') add('I', 0.6, 'serpIntent: informational');
  // 'mixed' = ไม่มีสัญญาณชัด — ไม่นับ

  if ((row.serpArticleCount ?? 0) >= 6) add('I', 0.5, `serpArticleCount: ${row.serpArticleCount}`);
  if ((row.serpServicePageCount ?? 0) >= 6) add('T', 0.5, `serpServicePageCount: ${row.serpServicePageCount}`);

  if (weights.size === 0) return { code: null, weight: 0, evidence: [] };

  let bestCode: IntentCode | null = null;
  let bestWeight = -1;
  for (const [code, w] of Array.from(weights)) {
    if (w > bestWeight) {
      bestCode = code;
      bestWeight = w;
    }
  }
  return { code: bestCode, weight: bestWeight, evidence };
}

/** ลำดับความสำคัญเริ่มต้นเมื่อผสม cue ได้ 2 โค้ด และ SERP ไม่ได้ช่วยตัดสิน */
function defaultMixPrimary(mix: 'I/C' | 'I/T' | 'C/T', keyword: string): IntentCode {
  if (mix === 'I/C') return 'C';
  if (mix === 'I/T') return 'T';
  // C/T
  const norm = normalizeThaiKey(keyword);
  const startsWithProviderCue = norm.startsWith(normalizeThaiKey('รับ')) || norm.startsWith(normalizeThaiKey('บริษัท'));
  return startsWithProviderCue ? 'T' : 'C';
}

function mixLabelFor(codes: Set<IntentCode>): 'I/C' | 'I/T' | 'C/T' | null {
  const hasI = codes.has('I');
  const hasC = codes.has('C');
  const hasT = codes.has('T');
  if (hasI && hasC && !hasT) return 'I/C';
  if (hasI && hasT && !hasC) return 'I/T';
  if (hasC && hasT) return hasI ? (codes.size === 3 ? 'C/T' : 'C/T') : 'C/T';
  return null;
}

/**
 * เดา intent จากบริการที่ผูกไว้เมื่อไม่มี cue/SERP เลย — คีย์เวิร์ด "แทบจะเป็นชื่อบริการ + พื้นที่"
 * เท่านั้นถือว่าสั้นพอจะเป็น T (บริการ+พื้นที่ = ต้องการหาผู้ให้บริการจริง)
 * "สั้น" คำนวณจาก ความยาว keyword ลบ ความยาวบริการ ลบ ความยาวพื้นที่ (ถ้ามี) ต้อง ≤ 6 ตัวอักษร
 */
function guessFromService(row: IntentSkillInputRow, profile?: BusinessProfile): { code: IntentCode; confidence: number; needsReview: boolean; term: string | null } {
  const candidates = [row.service, ...(profile?.servicesOffered ?? [])].filter((s): s is string => !!s && s.trim().length > 0);
  const matched = candidates.find(term => containsTerm(row.keyword, term));
  if (!matched) return { code: 'I', confidence: 0.4, needsReview: true, term: null };

  const keywordLen = normalizeThaiKey(row.keyword).length;
  const termLen = normalizeThaiKey(matched).length;
  const location = row.location ?? detectThaiProvince(row.keyword);
  const locationLen = location ? normalizeThaiKey(location).length : 0;
  const extra = keywordLen - termLen - locationLen;

  if (extra <= 6) return { code: 'T', confidence: 0.5, needsReview: false, term: matched };
  return { code: 'I', confidence: 0.4, needsReview: true, term: matched };
}

export function classifyIntent(row: IntentSkillInputRow, profile?: BusinessProfile): KeywordIntent {
  const evidence: IntentEvidence[] = [];

  // 1) แบรนด์ตัวเอง / คู่แข่ง
  if (profile?.ownBrand && containsTerm(row.keyword, profile.ownBrand)) {
    return {
      primary: 'N',
      mix: 'N',
      confidence: 0.9,
      evidence: [{ source: 'profile', detail: `ownBrand: ${profile.ownBrand}` }],
      needsReview: false,
    };
  }
  const competitorHit = profile?.competitorBrands?.find(b => containsTerm(row.keyword, b));
  if (competitorHit) {
    return {
      primary: 'N',
      mix: 'N',
      confidence: 0.8,
      evidence: [{ source: 'profile', detail: `competitorBrand: ${competitorHit}` }],
      needsReview: false,
    };
  }

  // 2) cue + SERP
  const cueHits = detectIntentCues(row.keyword);
  const cueCodes = new Set(cueHits.map(h => h.code));
  cueHits.forEach(h => evidence.push({ source: 'cue', detail: `${h.cue} → ${h.code}` }));

  const serp = computeSerpSignal(row);
  serp.evidence.forEach(e => evidence.push(e));

  let primary: IntentCode;
  let mix: IntentMix;
  let confidence: number;
  let needsReview = false;

  if (cueCodes.size === 0) {
    if (serp.code) {
      primary = serp.code;
      mix = serp.code;
      confidence = clamp01(0.4 + serp.weight * 0.3);
      needsReview = false;
    } else {
      const guess = guessFromService(row, profile);
      primary = guess.code;
      mix = guess.code;
      confidence = guess.confidence;
      needsReview = guess.needsReview;
      if (guess.term) evidence.push({ source: 'profile', detail: `service term: ${guess.term}` });
    }
  } else if (cueCodes.size === 1) {
    const cueOnly = Array.from(cueCodes)[0];
    if (serp.code && serp.code !== cueOnly) {
      primary = serp.code;
      mix = serp.code;
      confidence = 0.6;
      needsReview = true;
    } else {
      primary = cueOnly;
      mix = cueOnly;
      confidence = serp.code === cueOnly ? 0.85 : 0.7;
      needsReview = false;
    }
  } else {
    // 2+ โค้ดจาก cue — ลดเหลือ mix label ที่นิยามไว้ (I/C, I/T, C/T)
    const mixLabel = mixLabelFor(cueCodes) ?? 'C/T';
    const defaultPrimary = defaultMixPrimary(mixLabel, row.keyword);
    const mixSet = new Set(mixLabel.split('/') as IntentCode[]);

    if (serp.code && mixSet.has(serp.code) && serp.code !== defaultPrimary) {
      // SERP เห็นด้วยกับอีกโค้ดหนึ่งใน mix — ใช้โค้ดนั้นแทน ไม่ถือว่าขัดกัน
      primary = serp.code;
      confidence = 0.75;
      needsReview = false;
    } else if (serp.code && !mixSet.has(serp.code)) {
      // SERP ขัดกับ cue ทั้งคู่ — SERP ชนะ ให้คนตรวจ
      primary = serp.code;
      confidence = 0.55;
      needsReview = true;
    } else {
      primary = defaultPrimary;
      confidence = 0.65;
      needsReview = false;
    }
    mix = mixLabel;
  }

  needsReview = needsReview || confidence < 0.5;

  return { primary, mix, confidence, evidence, needsReview };
}
