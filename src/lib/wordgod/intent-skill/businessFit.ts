/**
 * Keyword Intent Skill — เช็คความเข้ากับธุรกิจจริง (ขั้นที่ 2)
 *
 * หมายเหตุการตีความสเปก: กติกาที่ "ไม่ต้องพึ่งข้อมูลโปรไฟล์" (คำแปล/สินค้าไม่มีร้าน)
 * ต้องเช็คได้แม้ยังไม่มีโปรไฟล์เลย (เช่น "termite ภาษาอังกฤษ" ต้องเป็น NOT_RECOMMENDED
 * ทันทีแม้ยังไม่กรอกโปรไฟล์） — ส่วน "ไม่มีโปรไฟล์ → FIT" ใช้เป็นค่าสำรองตอนท้ายเมื่อ
 * ไม่มีกติกาอื่นเข้าเงื่อนไขเลย
 */
import type { BusinessProfile, FitReasonCode, FitResult, KeywordIntent, IntentSkillInputRow } from './types';
import { containsTerm } from './thaiNormalize';
import { detectThaiProvince } from './cues';
import { isProductCue, isTranslationCue } from './cues';

export function isProfileEmpty(profile?: BusinessProfile): boolean {
  if (!profile) return true;
  return (
    (profile.servicesOffered?.length ?? 0) === 0 &&
    (profile.servicesNotOffered?.length ?? 0) === 0 &&
    (profile.shopProducts?.length ?? 0) === 0 &&
    (profile.branches?.length ?? 0) === 0 &&
    (profile.competitorBrands?.length ?? 0) === 0 &&
    !profile.ownBrand &&
    !profile.hasShop
  );
}

function fit(reasons: FitReasonCode[], remarkTh: string): FitResult {
  return { verdict: 'FIT', reasons, remarkTh };
}
function notRecommended(reason: FitReasonCode, remarkTh: string): FitResult {
  return { verdict: 'NOT_RECOMMENDED', reasons: [reason], remarkTh };
}
function articleOnly(reason: FitReasonCode, remarkTh: string): FitResult {
  return { verdict: 'ARTICLE_ONLY', reasons: [reason], remarkTh };
}

export function evaluateFit(row: IntentSkillInputRow, intent: KeywordIntent, profile?: BusinessProfile): FitResult {
  // ชื่อแบรนด์คู่แข่ง — ไม่แนะนำเสมอ ไม่ว่าโปรไฟล์จะครบแค่ไหน
  const competitorHit = profile?.competitorBrands?.find(b => containsTerm(row.keyword, b));
  if (competitorHit) {
    return notRecommended('competitor_brand', `มีชื่อแบรนด์คู่แข่ง (${competitorHit}) — ไม่แนะนำ`);
  }

  // คนหาคำแปล ไม่ใช่ลูกค้า — กติกาสากล ไม่ต้องพึ่งโปรไฟล์
  if (isTranslationCue(row.keyword)) {
    return notRecommended('translation_seeking', 'คนค้นหาคำแปล ไม่ใช่ลูกค้า — ไม่แนะนำ');
  }

  // คำค้นหาซื้อสินค้า แต่ไม่มีร้านขาย (hasShop default = false เมื่อไม่มีโปรไฟล์)
  const hasProductCue =
    isProductCue(row.keyword) ||
    !!profile?.shopProducts?.find(p => containsTerm(row.keyword, p) && isProductCue(row.keyword));
  if (hasProductCue && !profile?.hasShop) {
    return notRecommended('product_without_shop', 'เป็นคำค้นหาซื้อสินค้า แต่ธุรกิจไม่มีร้านขาย — ไม่แนะนำ');
  }

  // บริการที่ไม่ได้ทำ — ทำได้แค่บทความ
  const notOfferedHit = profile?.servicesNotOffered?.find(s => containsTerm(row.keyword, s));
  if (notOfferedHit) {
    return articleOnly('service_not_offered', `ไม่ได้ให้บริการ "${notOfferedHit}" — ทำได้แค่บทความ ห้ามทำหน้าบริการ`);
  }

  // มีพื้นที่ระบุ แต่ไม่ตรงสาขา/พื้นที่บริการที่มี
  const location = row.location ?? detectThaiProvince(row.keyword);
  if (location && (profile?.branches?.length ?? 0) > 0) {
    const branchMatch = profile!.branches.some(b => containsTerm(row.keyword, b) || containsTerm(location, b));
    if (!branchMatch) {
      return articleOnly('location_without_branch', `ไม่มีสาขา/พื้นที่บริการที่ ${location} — ไม่ทำหน้า Location`);
    }
  }

  // แบรนด์ตัวเอง
  if (profile?.ownBrand && containsTerm(row.keyword, profile.ownBrand)) {
    return fit(['own_brand'], 'คำค้นแบรนด์ของเรา');
  }

  // ตรงบริการที่ทำจริง
  const offeredHit = profile?.servicesOffered?.find(s => containsTerm(row.keyword, s));
  if (offeredHit) {
    return fit(['offered_service'], `ตรงบริการ "${offeredHit}"`);
  }

  // ไม่มีโปรไฟล์เลย — ให้คนตรวจเอง
  if (isProfileEmpty(profile)) {
    return fit(['no_profile'], 'ยังไม่ได้กรอกข้อมูลธุรกิจ — ตรวจความเข้ากับธุรกิจเอง');
  }

  // มีโปรไฟล์แต่ไม่เข้าเงื่อนไขไหนเลย
  const primaryIsCommercialOrTransactional = intent.primary === 'C' || intent.primary === 'T';
  const remark =
    (profile?.servicesOffered?.length ?? 0) > 0 && primaryIsCommercialOrTransactional
      ? 'ไม่ตรงบริการที่กรอกไว้ — ควรตรวจ'
      : '';
  return fit([], remark);
}
