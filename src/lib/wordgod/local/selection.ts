/**
 * WordGod Local SME — คัดคำเข้าตารางผลลัพธ์สุดท้าย (pure, ไม่มี I/O)
 *
 * ไม่แตะสูตรคะแนน (score.total) หรือ badge High/Medium/Low — ไฟล์นี้แค่ "เลือก"
 * ว่าคำไหนได้เข้าไปอยู่ในตารางสุดท้าย เพื่อกันคำเชิงพาณิชย์ hyper-local
 * (localIntent 0.4 + commercialIntent 0.3 = 70% ของคะแนน) ยึดทุกช่องจนคำ
 * traffic สูง/หาความรู้ ไม่มีที่ยืนเลย
 *
 * กลยุทธ์: แบ่งเป็น 2 กลุ่ม (sales / traffic) → คัดสัดส่วน 50/50 →
 * กันคลัสเตอร์เดียวยึดตาราง (maxPerCluster) → เอียงลำดับในกลุ่มไปทาง volume สูง
 */
import { SELECTION_DEFAULTS } from './config';
import { dedupeKey } from './normalize';
import type { KeywordResearchResult, LocalIntentTag } from './types';

export interface SelectionOptions {
  targetCount: number;
  salesRatio?: number;
  maxPerCluster?: number;
}

type Bucket = 'sales' | 'traffic';

/** tag ที่บ่งชี้ "พร้อมจ้าง/พร้อมซื้อ" — ใช้แบ่งกลุ่มเท่านั้น ไม่กระทบคะแนน */
const SALES_TAGS: readonly LocalIntentTag[] = [
  'price',
  'service_provider',
  'urgency',
  'commercial',
  'comparison',
  'near_me',
];

function classifyBucket(r: KeywordResearchResult): Bucket {
  const isInformational = r.intents.includes('informational') || r.intents.includes('question');
  const hasSalesSignal =
    r.locationRole === 'primary' ||
    r.locationRole === 'nearby' ||
    r.intents.some(t => SALES_TAGS.includes(t));
  return isInformational ? 'traffic' : hasSalesSignal ? 'sales' : 'traffic';
}

/** เอียงลำดับไปทาง volume สูง โดยไม่แตะ score.total เดิม — ใช้แค่จัดลำดับการคัด */
function blendedRank(maxLog: number) {
  return (r: KeywordResearchResult): number => {
    const volScore =
      maxLog > 0 ? (100 * Math.log1p(Math.max(0, r.volume ?? 0))) / maxLog : 0;
    return r.score.total * 0.6 + volScore * 0.4;
  };
}

function sortBucket(list: KeywordResearchResult[], blended: (r: KeywordResearchResult) => number): KeywordResearchResult[] {
  return [...list].sort((a, b) => {
    const diff = blended(b) - blended(a);
    if (diff !== 0) return diff;
    const scoreDiff = b.score.total - a.score.total;
    if (scoreDiff !== 0) return scoreDiff;
    return (b.volume ?? -1) - (a.volume ?? -1);
  });
}

/** เดินตามลำดับที่จัดแล้ว คัดไม่เกิน maxPerCluster ต่อคลัสเตอร์ ที่เหลือไป overflow */
function applyDiversityCap(
  list: KeywordResearchResult[],
  maxPerCluster: number,
  clusterCounts: Map<string, number>,
  overflow: KeywordResearchResult[]
): KeywordResearchResult[] {
  const capped: KeywordResearchResult[] = [];
  for (const r of list) {
    const clusterKey = r.cluster ?? r.keyword;
    const count = clusterCounts.get(clusterKey) ?? 0;
    if (count < maxPerCluster) {
      clusterCounts.set(clusterKey, count + 1);
      capped.push(r);
    } else {
      overflow.push(r);
    }
  }
  return capped;
}

/**
 * คัดคำจากผล ranked เข้าตารางสุดท้าย: สัดส่วน sales/traffic ~50/50,
 * กันคลัสเตอร์เดียวยึดตาราง, เอียงไปทาง volume สูงในแต่ละกลุ่ม
 */
export function selectBalancedKeywords(
  results: KeywordResearchResult[],
  opts: SelectionOptions
): KeywordResearchResult[] {
  const targetCount = Math.max(0, opts.targetCount);
  const salesRatio = opts.salesRatio ?? SELECTION_DEFAULTS.salesRatio;
  const maxPerCluster = opts.maxPerCluster ?? SELECTION_DEFAULTS.maxPerCluster;

  if (targetCount === 0 || results.length === 0) return [];

  const maxLog = results.reduce(
    (max, r) => Math.max(max, Math.log1p(Math.max(0, r.volume ?? 0))),
    0
  );
  const blended = blendedRank(maxLog);

  const salesAll: KeywordResearchResult[] = [];
  const trafficAll: KeywordResearchResult[] = [];
  for (const r of results) {
    (classifyBucket(r) === 'sales' ? salesAll : trafficAll).push(r);
  }

  const salesSorted = sortBucket(salesAll, blended);
  const trafficSorted = sortBucket(trafficAll, blended);

  const clusterCounts = new Map<string, number>();
  const overflow: KeywordResearchResult[] = [];
  const cappedSales = applyDiversityCap(salesSorted, maxPerCluster, clusterCounts, overflow);
  const cappedTraffic = applyDiversityCap(trafficSorted, maxPerCluster, clusterCounts, overflow);
  // overflow เก็บตามลำดับที่เจอ (sales ก่อน traffic) — จัดให้ยังเรียงตาม blended รวมกัน
  overflow.sort((a, b) => blended(b) - blended(a));

  const salesQuota = Math.round(targetCount * salesRatio);
  const trafficQuota = targetCount - salesQuota;

  const chosen: KeywordResearchResult[] = [];
  const chosenKeys = new Set<string>();

  function take(pool: KeywordResearchResult[], limit: number): void {
    let taken = 0;
    for (const r of pool) {
      if (taken >= limit || chosen.length >= targetCount) break;
      const key = dedupeKey(r.keyword);
      if (!key || chosenKeys.has(key)) continue;
      chosenKeys.add(key);
      chosen.push(r);
      taken++;
    }
  }

  take(cappedSales, salesQuota);
  take(cappedTraffic, trafficQuota);

  // Backfill: ถ้าโควตา sales เต็มไม่ได้ (คำขายไม่พอ) ห้ามยัดคำขายคุณภาพต่ำ —
  // ให้ขยายไป "high-intent + traffic" ก่อน (คำ traffic ที่ยังพ่วงสัญญาณเชิงพาณิชย์
  // ราคา/เปรียบเทียบ/ด่วน ฯลฯ) แล้วค่อยตามด้วย traffic ล้วน (§ผู้ใช้ 2026-08-20)
  if (chosen.length < targetCount) {
    const highIntentTraffic = cappedTraffic.filter(r => r.intents.some(t => SALES_TAGS.includes(t)));
    const pureTraffic = cappedTraffic.filter(r => !r.intents.some(t => SALES_TAGS.includes(t)));
    take(highIntentTraffic, targetCount - chosen.length);
    if (chosen.length < targetCount) {
      take(pureTraffic, targetCount - chosen.length);
    }
  }
  // เหลือจริง ๆ ค่อยเติมด้วย sales ที่ยังไม่ถูกเลือก แล้วจึง overflow (ผ่อน cap คลัสเตอร์)
  if (chosen.length < targetCount) {
    take(cappedSales, targetCount - chosen.length);
  }
  if (chosen.length < targetCount) {
    take(overflow, targetCount - chosen.length);
  }

  return chosen;
}
