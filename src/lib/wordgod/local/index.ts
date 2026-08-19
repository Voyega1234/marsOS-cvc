/**
 * WordGod Local SME — ตัวประกอบร่างผลลัพธ์ (pure, ไม่มี I/O)
 *
 * แยก I/O ออกไปอยู่ที่ API route ทั้งหมด ไฟล์นี้จึงทดสอบได้โดยไม่ต้องมี
 * credential ของ Google Ads และไม่มีทางเผลอ "เดา" ตัวเลข metric ขึ้นมาเอง:
 * ค่า volume/competition/bid ที่ไม่ได้ถูกส่งเข้ามา จะออกไปเป็น null เสมอ (§32)
 */

import { buildClusters, clusterNameFor, suggestPage } from './clustering';
import { detectModifierGroups, detectModifierTags } from './intentModifiers';
import { dedupeKey } from './normalize';
import {
  computeKeywordScore,
  matchLocation,
  priorityLevel,
  relevanceScore,
  type ScoringContext,
} from './scoring';
import type { GeneratedCandidate } from './seedGeneration';
import type {
  KeywordResearchResult,
  LocalClusterSummary,
  LocalIntentTag,
  LocalKeywordSource,
  LocalResearchInput,
} from './types';

/** metric ดิบจากผู้ให้บริการข้อมูล — null หมายถึง "ไม่มีข้อมูล" ไม่ใช่ "เป็นศูนย์" */
export interface MetricRecord {
  volume: number | null;
  competition: string | null;
  competitionIndex: number | null;
  bidLow: number | null;
  bidHigh: number | null;
  /** ยอดค้นหารายเดือนย้อนหลัง (เก่า → ใหม่) */
  trend?: number[];
}

export interface LocalRawItem {
  keyword: string;
  sources: LocalKeywordSource[];
  metric?: MetricRecord | null;
  candidate?: GeneratedCandidate;
}

function attributeService(keyword: string, context: ScoringContext): string {
  let best = context.services[0] ?? '';
  let bestScore = -1;
  for (const service of context.services) {
    const score = relevanceScore(keyword, { ...context, services: [service] });
    if (score > bestScore) {
      bestScore = score;
      best = service;
    }
  }
  return best;
}

export function assembleResults(
  items: LocalRawItem[],
  input: LocalResearchInput
): { results: KeywordResearchResult[]; clusters: LocalClusterSummary[] } {
  const nearbyLocations = input.nearbyLocations ?? [];

  // normalize Volume ด้วย log1p เทียบกับค่าสูงสุดในชุดนี้ (§11)
  const maxLogVolume = items.reduce((max, item) => {
    const volume = item.metric?.volume;
    if (typeof volume !== 'number' || volume <= 0) return max;
    return Math.max(max, Math.log1p(volume));
  }, 0);

  const context: ScoringContext = {
    services: input.services.filter(Boolean),
    primaryLocation: input.primaryLocation,
    nearbyLocations,
    businessType: input.businessType ?? 'service_area',
    businessContext: input.businessContext,
    maxLogVolume,
  };

  const seen = new Set<string>();
  const results: KeywordResearchResult[] = [];

  for (const item of items) {
    const key = dedupeKey(item.keyword);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const locationMatch = matchLocation(item.keyword, context);
    const tags = detectModifierTags(item.keyword);
    const intents: LocalIntentTag[] = Array.from(new Set<LocalIntentTag>([
      ...tags,
      ...(locationMatch.role !== 'none' ? (['local'] as LocalIntentTag[]) : []),
    ]));

    const modifierGroups = item.candidate
      ? Array.from(new Set([...item.candidate.modifierGroups, ...detectModifierGroups(item.keyword)]))
      : detectModifierGroups(item.keyword);

    const service = item.candidate?.service ?? attributeService(item.keyword, context);
    const hasModifier = modifierGroups.some(
      g => g !== 'local_exact' && g !== 'nearby_location'
    );

    const score = computeKeywordScore(
      {
        keyword: item.keyword,
        volume: item.metric?.volume ?? null,
        competitionIndex: item.metric?.competitionIndex ?? null,
        intents,
        hasModifier,
        locationMatch,
      },
      context
    );

    const locationRole = locationMatch.role;
    const locationName = locationMatch.area?.name ?? null;
    const cluster = clusterNameFor({ service, location: locationName, locationRole, intents });

    results.push({
      keyword: item.keyword,
      volume: item.metric?.volume ?? null,
      trend: item.metric?.trend,
      adsCompetition: item.metric?.competition ?? null,
      competitionIndex: item.metric?.competitionIndex ?? null,
      bidLow: item.metric?.bidLow ?? null,
      bidHigh: item.metric?.bidHigh ?? null,
      intents,
      location: locationName,
      locationRole,
      service,
      score,
      priority: priorityLevel(score.total),
      cluster,
      suggestedPage: suggestPage(intents, locationRole),
      sources: Array.from(new Set(item.sources)),
      modifierGroups,
    });
  }

  // เรียงตาม Priority เป็นค่าเริ่มต้นเสมอ ไม่ใช่ Volume (§18)
  results.sort((a, b) => b.score.total - a.score.total || (b.volume ?? -1) - (a.volume ?? -1));

  return { results, clusters: buildClusters(results, nearbyLocations.length) };
}

export { generateLocalCandidates } from './seedGeneration';
export { LOCAL_KEYWORD_WEIGHTS, PRIORITY_THRESHOLDS, KP_LOOKUP_LIMIT } from './config';
export { scoreBreakdown } from './scoring';
export { SUGGESTED_PAGE_LABELS } from './clustering';
export { INTENT_TAG_LABELS, MODIFIER_GROUP_LABELS } from './intentModifiers';
export { dedupeKey, displayForm } from './normalize';
