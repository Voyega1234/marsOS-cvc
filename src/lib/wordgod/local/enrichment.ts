/**
 * WordGod Local SME — แปลงข้อมูลดิบจาก API เป็นสัญญาณที่ชั้น intelligence ใช้
 * (pure function ล้วน — I/O อยู่ที่ route; ตัวเลขทุกตัวมาจากข้อมูล API จริง)
 */

import type { SerpLocalSignalsResult } from '../services/dataForSeoService';
import { emptySerpSignals, type SerpSignals } from './metrics';

// ── จำแนกผล organic ใน SERP (สเปก §40) ──────────────────────────────────────

const DIRECTORY_DOMAINS = [
  'yellowpages.co.th', 'wongnai.com', 'ryoii.com', 'thaifranchisecenter.com',
  'brandex.co.th', 'thailandservicedir.com', 'expertdir.com',
];
const FORUM_DOMAINS = ['pantip.com', 'reddit.com', 'dek-d.com'];
const ARTICLE_PATTERNS = /วิธี|ทำไม|คืออะไร|กี่บาท.*\?|ข้อดี|ข้อเสีย|รีวิว|เปรียบเทียบ|แนะนำ|รวม\s*\d+|10 อันดับ|\/blog\/|\/article\/|\/knowledge\//i;
const SERVICE_PATTERNS = /บริการ|รับ(ล้าง|ซ่อม|ติดตั้ง|ทำ|จ้าง|เหมา)|โทร|ราคาเริ่ม|โปรโมชั่น|ครบวงจร|มืออาชีพ/i;

export interface OrganicClassification {
  servicePageCount: number;
  articleCount: number;
  directoryCount: number;
  forumCount: number;
}

export function classifyOrganicResults(
  organic: Array<{ url: string; domain: string; title: string }>
): OrganicClassification {
  let servicePageCount = 0;
  let articleCount = 0;
  let directoryCount = 0;
  let forumCount = 0;
  for (const item of organic.slice(0, 10)) {
    const domain = item.domain.toLowerCase();
    if (DIRECTORY_DOMAINS.some(d => domain === d || domain.endsWith(`.${d}`))) { directoryCount++; continue; }
    if (FORUM_DOMAINS.some(d => domain === d || domain.endsWith(`.${d}`))) { forumCount++; continue; }
    const text = `${item.title} ${item.url}`;
    if (ARTICLE_PATTERNS.test(text)) { articleCount++; continue; }
    if (SERVICE_PATTERNS.test(text)) { servicePageCount++; continue; }
    // ไม่ชัด — ไม่นับเข้าฝั่งไหน (ไม่เดา)
  }
  return { servicePageCount, articleCount, directoryCount, forumCount };
}

/**
 * แปลงผล SERP ดิบเป็น SerpSignals ของชั้น intelligence
 * serpOpportunityScore = โอกาสที่ "หน้าใหม่ของธุรกิจท้องถิ่น" จะแทรกได้:
 * SERP ที่เต็มไปด้วย directory/forum + มี local pack = แทรกง่าย,
 * SERP ที่อัดแน่นด้วยหน้า service ของคู่แข่งตรง = แทรกยาก
 */
export function toSerpSignals(raw: SerpLocalSignalsResult): SerpSignals {
  if (!raw.ok) {
    return { ...emptySerpSignals(), status: raw.note.includes('credential') ? 'not_requested' : 'api_error' };
  }
  const counts = classifyOrganicResults(raw.organic);
  const serpIntent =
    counts.servicePageCount >= 4 ? 'service'
      : counts.articleCount >= 5 ? 'informational'
        : 'mixed';
  const opportunity = Math.max(0, Math.min(100,
    30
    + counts.directoryCount * 10
    + counts.forumCount * 8
    + (raw.hasLocalPack ? 15 : 0)
    + Math.max(0, 5 - counts.servicePageCount) * 4
  ));
  return {
    hasLocalPack: raw.hasLocalPack,
    localPackPosition: raw.localPackPosition,
    servicePageCount: counts.servicePageCount,
    articleCount: counts.articleCount,
    directoryCount: counts.directoryCount,
    topUrls: raw.organic.slice(0, 10).map(o => o.url),
    topDomains: raw.organic.slice(0, 10).map(o => o.domain),
    serpIntent,
    serpOpportunityScore: opportunity,
    serpCheckedAt: raw.fetchedAt,
    status: 'ok',
  };
}

// ── Client Ready gate + coverage (สเปก §85–§86) ─────────────────────────────

export interface CoverageInput {
  referenceVolume: number | null;
  referenceSource: string;
  zeroVolumeLocalOpportunity: boolean;
}

/**
 * สัดส่วนคำที่ "volume ผ่านการตรวจสอบแล้ว" — มีตัวเลขจากแหล่งจริง (รวม 0 จริง)
 * หรือเป็น LOCAL zero-volume ที่มีหลักฐาน (ไม่นับว่าขาด)
 */
export function verifiedVolumeCoverage(items: CoverageInput[]): number {
  if (items.length === 0) return 0;
  const verified = items.filter(i =>
    i.referenceSource !== 'none' || i.zeroVolumeLocalOpportunity
  ).length;
  return Math.round((verified / items.length) * 1000) / 1000;
}

export const CLIENT_READY_COVERAGE_THRESHOLD = 0.9;
