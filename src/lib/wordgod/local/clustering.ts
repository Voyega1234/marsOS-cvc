/**
 * WordGod Local SME — จัดกลุ่มคีย์เวิร์ด + แนะนำหน้าเว็บ + แนะนำเนื้อหา
 *
 * กติกาที่ยึดตลอดไฟล์นี้ (§17):
 *   คำแนะนำทุกข้อเป็น "หัวข้อที่ควรมีในหน้า" ไม่ใช่คำโฆษณาที่เขียนแทนเจ้าของธุรกิจ
 *   ข้อไหนเป็นการอ้างศักยภาพ (มาถึงใน 1 ชม., รับประกัน 1 ปี) จะกำกับว่า "เฉพาะที่ทำได้จริง"
 *   ระบบไม่แต่งคำรับประกัน ไม่แต่งรีวิว ไม่แต่งตัวเลขให้
 */

import { LOCATION_PAGE_RULES } from './config';
import type {
  KeywordResearchResult,
  LocalClusterSummary,
  LocalIntentTag,
  SuggestedPageType,
} from './types';

export const SUGGESTED_PAGE_LABELS: Record<SuggestedPageType, string> = {
  main_service: 'หน้าบริการหลัก',
  location: 'หน้าบริการเฉพาะพื้นที่',
  service_area: 'หน้าพื้นที่ให้บริการ',
  pricing: 'หน้าราคา',
  faq: 'หน้าคำถามที่พบบ่อย',
  blog: 'บทความ / คู่มือ',
  gbp: 'Google Business Profile',
  existing: 'ใส่ในหน้าเดิมที่มีอยู่',
};

/** เลือกประเภทหน้าให้คีย์เวิร์ดหนึ่งคำ — ลำดับการตัดสินสำคัญ (§15) */
export function suggestPage(
  intents: LocalIntentTag[],
  locationRole: 'primary' | 'nearby' | 'none'
): SuggestedPageType {
  const has = (tag: LocalIntentTag) => intents.includes(tag);

  if (has('price')) return 'pricing';                       // ถามราคาชนะทุกอย่าง → หน้าราคา
  if (locationRole === 'nearby') return 'service_area';     // พื้นที่ใกล้เคียงรวมไว้หน้าเดียว
  if (has('near_me')) return 'gbp';                         // "ใกล้ฉัน" ชนะที่ Google Business Profile
  if (locationRole === 'primary') return 'location';        // พื้นที่หลัก → หน้าเฉพาะพื้นที่
  if (has('comparison') || has('commercial')) return 'faq';
  if (has('question') || has('informational')) return 'blog';
  if (has('urgency') || has('service_provider') || has('property_type')) return 'main_service';
  return 'main_service';
}

/** ชื่อคลัสเตอร์: บริการ · พื้นที่/เจตนา */
export function clusterNameFor(result: {
  service: string;
  location?: string | null;
  locationRole: 'primary' | 'nearby' | 'none';
  intents: LocalIntentTag[];
}): string {
  const { service, location, locationRole, intents } = result;
  const has = (tag: LocalIntentTag) => intents.includes(tag);

  if (has('price')) return `${service} · ราคา`;
  if (locationRole === 'nearby') return `${service} · พื้นที่ใกล้เคียง`;
  if (has('near_me')) return `${service} · ใกล้ฉัน`;
  if (locationRole === 'primary') return `${service} · ${location}`;
  if (has('comparison') || has('commercial')) return `${service} · เลือกผู้ให้บริการ`;
  if (has('urgency')) return `${service} · งานด่วน`;
  if (has('property_type')) return `${service} · ตามประเภทสถานที่`;
  if (has('question') || has('informational')) return `${service} · ความรู้`;
  return `${service} · ทั่วไป`;
}

/** หัวข้อเนื้อหาที่ควรมี แยกตามเจตนาที่เจอในคลัสเตอร์ (§17) */
export function contentRecommendations(
  intents: LocalIntentTag[],
  locationNames: string[]
): string[] {
  const out: string[] = [];
  const has = (tag: LocalIntentTag) => intents.includes(tag);
  const areaList = locationNames.filter(Boolean).slice(0, 6).join(', ');

  if (has('price')) {
    out.push('ตารางราคาแยกตามประเภทงาน/ขนาด');
    out.push('ราคาเริ่มต้น พร้อมระบุว่ารวมอะไรบ้าง');
    out.push('ปัจจัยที่ทำให้ราคาต่างกัน (ขนาด ความสูง จำนวนเครื่อง ฯลฯ)');
    out.push('ค่าเดินทาง/ค่าบริการนอกพื้นที่ — ระบุเฉพาะที่คิดจริง');
  }
  if (has('local') || has('near_me')) {
    out.push(areaList ? `รายชื่อพื้นที่ให้บริการ: ${areaList}` : 'รายชื่อพื้นที่ให้บริการทั้งหมด');
    out.push('แผนที่ + จุดสังเกตใกล้เคียงในพื้นที่');
    out.push('อัปเดต Google Business Profile ให้ตรงกับพื้นที่บริการจริง');
  }
  if (has('comparison') || has('commercial')) {
    out.push('รีวิวลูกค้าจริง — ใช้เฉพาะรีวิวที่มีอยู่จริง ห้ามแต่งขึ้น');
    out.push('ตัวอย่างผลงานที่เคยทำ (ภาพก่อน-หลัง ถ้ามี)');
    out.push('คำถามที่ลูกค้าถามบ่อยก่อนตัดสินใจ');
    out.push('เหตุผลที่ควรเลือก — อ้างเฉพาะสิ่งที่พิสูจน์ได้');
  }
  if (has('urgency')) {
    out.push('เวลาทำการจริง และช่วงที่รับงานด่วนได้');
    out.push('ระยะเวลาเดินทางโดยประมาณจากฐานที่ตั้ง');
    out.push('ช่องทางติดต่อด่วน (โทร / LINE) วางให้เห็นชัดบนมือถือ');
    out.push('บริการวันเดียวจบ — ใส่เฉพาะกรณีที่ทำได้จริง');
  }
  if (has('property_type')) {
    out.push('ขั้นตอนนัดหมายและการเข้าพื้นที่ (คอนโด/ออฟฟิศ)');
    out.push('การประสานนิติบุคคล/รปภ. ก่อนเข้าทำงาน');
    out.push('ข้อจำกัดของสถานที่ที่ลูกค้าควรรู้ล่วงหน้า');
  }
  if (has('service_provider')) {
    out.push('ข้อมูลทีมช่าง/ผู้ให้บริการ และประสบการณ์จริง');
    out.push('ขั้นตอนการจองงานตั้งแต่ติดต่อจนจบงาน');
    out.push('เงื่อนไขการรับประกันงาน — ระบุเฉพาะที่ให้จริง');
  }
  if (has('question') || has('informational')) {
    out.push('ตอบคำถามให้จบในหน้าเดียว พร้อมลิงก์กลับหน้าบริการ');
    out.push('เพิ่ม FAQ schema สำหรับคำถามที่ตอบไว้');
  }

  if (out.length === 0) {
    out.push('อธิบายบริการให้ครบ: ทำอะไร ใช้เวลาเท่าไร ราคาเริ่มต้นเท่าไร');
  }
  return Array.from(new Set(out));
}

/** คำแนะนำเรื่อง "ควรทำหน้าเฉพาะพื้นที่ไหม" (§16) */
export function locationPageAdvice(
  locationRole: 'primary' | 'nearby' | 'none',
  keywordCount: number,
  maxPriority: number,
  nearbyAreaCount: number
): string | undefined {
  if (locationRole === 'none') return undefined;

  if (locationRole === 'primary') {
    if (keywordCount >= LOCATION_PAGE_RULES.minKeywordsForDedicatedPage ||
        maxPriority >= LOCATION_PAGE_RULES.minPriorityForDedicatedPage) {
      return 'ควรมีหน้าเฉพาะพื้นที่นี้ เพราะเป็นพื้นที่หลักและมีคำค้นรองรับพอ';
    }
    return 'ยังไม่จำเป็นต้องแยกหน้า — ใส่พื้นที่นี้ในหน้าบริการหลักไปก่อน';
  }

  if (nearbyAreaCount > LOCATION_PAGE_RULES.doorwayWarningThreshold) {
    return `พื้นที่ใกล้เคียงมี ${nearbyAreaCount} แห่ง — รวมเป็นหน้า "พื้นที่ให้บริการ" หน้าเดียว ` +
      'อย่าสร้างหน้าแยกทุกพื้นที่ด้วยเนื้อหาซ้ำ (Google นับเป็น doorway page)';
  }
  return 'รวมไว้ในหน้า "พื้นที่ให้บริการ" หน้าเดียว จะแยกหน้าเมื่อมีเนื้อหาเฉพาะพื้นที่จริง ๆ เท่านั้น';
}

/** จัดคลัสเตอร์จากผลลัพธ์ที่ให้คะแนนแล้ว */
export function buildClusters(
  results: KeywordResearchResult[],
  nearbyAreaCount: number
): LocalClusterSummary[] {
  const groups = new Map<string, KeywordResearchResult[]>();
  for (const result of results) {
    const name = result.cluster ?? 'อื่น ๆ';
    const bucket = groups.get(name);
    if (bucket) bucket.push(result);
    else groups.set(name, [result]);
  }

  const clusters: LocalClusterSummary[] = [];
  for (const [name, members] of Array.from(groups.entries())) {
    const sorted = [...members].sort((a, b) => b.score.total - a.score.total);
    const withVolume = sorted.filter(m => typeof m.volume === 'number' && m.volume !== null);
    const priorities = sorted.map(m => m.score.total);
    const intents = Array.from(new Set(sorted.flatMap(m => m.intents)));
    const locationNames = Array.from(new Set(sorted.map(m => m.location).filter(Boolean) as string[]));
    const locationRole = sorted[0].locationRole;
    const maxPriority = Math.max(...priorities);

    clusters.push({
      name,
      mainKeyword: sorted[0].keyword,
      keywordCount: sorted.length,
      avgPriority: Math.round(priorities.reduce((s, p) => s + p, 0) / priorities.length),
      maxPriority,
      searchDemand: withVolume.length > 0
        ? withVolume.reduce((sum, m) => sum + (m.volume ?? 0), 0)
        : null,
      keywordsWithVolume: withVolume.length,
      intents,
      suggestedPage: sorted[0].suggestedPage ?? 'main_service',
      contentRecommendations: contentRecommendations(intents, locationNames),
      locationPageAdvice: locationPageAdvice(locationRole, sorted.length, maxPriority, nearbyAreaCount),
      keywords: sorted.map(m => m.keyword),
    });
  }

  return clusters.sort((a, b) => b.maxPriority - a.maxPriority || b.keywordCount - a.keywordCount);
}
