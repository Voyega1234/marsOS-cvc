/**
 * Keyword Guard — ชั้นอ่านเจตนา (Search Intent) จากตัวคีย์เวิร์ดเอง
 *
 * ไม่เรียก AI และไม่เสียเงิน: ทุกอย่างมาจากคลังคำขยาย (modifier lexicon) ที่ตรวจแบบ
 * "วลีในสตริงที่ตัดช่องว่างแล้ว" เพราะภาษาไทยเขียนติดกันได้ ("seo คือ อะไร" กับ
 * "seoคืออะไร" คือคำเดียวกัน) การตัดคำอย่างเดียวจับวลีพวกนี้ไม่ครบ
 *
 * ผลลัพธ์ชั้นนี้เป็นตัวตัดสินหลักของ Keyword Guard: token ซ้ำกันแต่เจตนาต่างกัน
 * ("SEO คืออะไร" กับ "รับทำ SEO") ห้ามถูกรวมเป็นหน้าเดียวกันเด็ดขาด
 */

import { dedupeKey, displayForm } from '@/lib/wordgod/local/normalize';
import type { FunnelStage, IntentSignals, PrimaryIntent, SubIntent } from './types';

/** ป้ายกลุ่มความหมายที่ใช้แทนคำขยายทั้งกลุ่มตอนทำ semantic key */
export type ModifierTag =
  | '@price' | '@definition' | '@howto' | '@cause' | '@compare' | '@review'
  | '@recommend' | '@service' | '@buy' | '@contact' | '@nearby' | '@urgent'
  | '@cheap' | '@quality' | '@question';

interface ModifierDef {
  tag: ModifierTag;
  subIntent: SubIntent | null;
  /** วลีในรูป dedupeKey (ตัวพิมพ์เล็ก ไม่มีช่องว่าง/ขีด) */
  phrases: string[];
}

/**
 * คลังคำขยาย — วลียาวถูกจับก่อนเสมอ (ดู buildModifierList) เพื่อไม่ให้
 * "ค่าบริการ" ถูก "บริการ" แย่งไปเป็นคำกลุ่มบริการ ทั้งที่ความหมายคือราคา
 */
const MODIFIERS: ModifierDef[] = [
  {
    tag: '@price', subIntent: 'PRICE',
    phrases: [
      'ค่าบริการ', 'ค่าใช้จ่าย', 'ค่าจ้าง', 'ค่าทำ', 'ราคาเท่าไหร่', 'ราคาเท่าไร', 'กี่บาท', 'เท่าไหร่', 'เท่าไร',
      'แพ็กเกจ', 'แพ็คเกจ', 'แพคเกจ', 'ราคา', 'เรทราคา', 'เรต', 'งบประมาณ', 'ค่าเช่า',
      'price', 'pricing', 'cost', 'package', 'packages', 'rate', 'rates', 'quotation', 'quote', 'budget', 'howmuch',
    ],
  },
  {
    tag: '@definition', subIntent: 'DEFINITION',
    phrases: ['คืออะไร', 'คือะไร', 'หมายถึงอะไร', 'หมายความว่า', 'ความหมาย', 'นิยาม', 'whatis', 'meaning', 'definition'],
  },
  {
    tag: '@howto', subIntent: 'HOW_TO',
    phrases: ['วิธีการ', 'วิธี', 'ทำยังไง', 'ทำอย่างไร', 'อย่างไร', 'ยังไง', 'ขั้นตอน', 'สอน', 'ทำเอง', 'คู่มือ', 'howto', 'guide', 'tutorial', 'stepbystep', 'diy'],
  },
  {
    tag: '@cause', subIntent: 'CAUSE',
    phrases: ['สาเหตุ', 'ทำไม', 'เพราะอะไร', 'why', 'cause'],
  },
  {
    tag: '@compare', subIntent: 'COMPARISON',
    phrases: ['เปรียบเทียบ', 'เทียบกับ', 'ต่างกันอย่างไร', 'ต่างกัน', 'ดีกว่า', 'vs', 'versus', 'compare', 'comparison', 'difference'],
  },
  {
    tag: '@review', subIntent: 'REVIEW',
    phrases: ['รีวิว', 'ดีไหม', 'ดีมั้ย', 'ดีป่าว', 'น่าเชื่อถือไหม', 'ประสบการณ์', 'review', 'reviews', 'testimonial'],
  },
  {
    tag: '@recommend', subIntent: 'RECOMMENDATION',
    phrases: ['ที่ไหนดี', 'เจ้าไหนดี', 'ยี่ห้อไหนดี', 'แนะนำ', 'ยอดนิยม', 'อันดับ', 'top10', 'best', 'top', 'ranking', 'recommended'],
  },
  {
    tag: '@service', subIntent: 'HIRE_SERVICE',
    phrases: ['รับทำ', 'รับจ้าง', 'รับติดตั้ง', 'รับซ่อม', 'ให้บริการ', 'บริการ', 'จ้างทำ', 'จ้าง', 'ผู้รับเหมา', 'ช่าง', 'ทีมงาน', 'บริษัท', 'เอเจนซี่', 'agency', 'service', 'services', 'freelance', 'outsource', 'hire'],
  },
  {
    tag: '@buy', subIntent: 'BUY',
    phrases: ['สั่งซื้อ', 'ซื้อ', 'ขาย', 'สั่งทำ', 'สมัคร', 'buy', 'order', 'shop', 'purchase', 'subscribe'],
  },
  {
    tag: '@contact', subIntent: 'CONTACT',
    phrases: ['ติดต่อ', 'เบอร์โทร', 'เบอร์', 'ไลน์', 'contact', 'lineid'],
  },
  {
    tag: '@nearby', subIntent: 'LOCATION',
    phrases: ['ใกล้ฉัน', 'ใกล้บ้าน', 'แถวนี้', 'nearme', 'nearby', 'ในพื้นที่'],
  },
  { tag: '@urgent', subIntent: null, phrases: ['ด่วน', 'วันนี้', '24ชั่วโมง', '24ชม', 'เร่งด่วน', 'urgent', 'emergency'] },
  { tag: '@cheap', subIntent: null, phrases: ['ราคาถูก', 'ถูกที่สุด', 'ประหยัด', 'cheap', 'affordable', 'budgetfriendly'] },
  { tag: '@quality', subIntent: null, phrases: ['คุณภาพ', 'มืออาชีพ', 'ครบวงจร', 'มาตรฐาน', 'professional', 'quality'] },
  { tag: '@question', subIntent: null, phrases: ['ควรทำ', 'จําเป็นไหม', 'จำเป็นไหม', 'ต้องทำไหม'] },
];

/** วลีทั้งหมดเรียงจากยาวไปสั้น — วลียาวชนะเสมอ */
const MODIFIER_LIST: Array<{ phrase: string; tag: ModifierTag; subIntent: SubIntent | null }> = MODIFIERS
  .flatMap(def => def.phrases.map(phrase => ({ phrase, tag: def.tag, subIntent: def.subIntent })))
  .sort((a, b) => b.phrase.length - a.phrase.length);

/** ลำดับความสำคัญตอนคำเดียวมีหลายเจตนา — เจตนาที่เปลี่ยน "ประเภทหน้า" มาก่อน */
const SUB_INTENT_PRIORITY: SubIntent[] = [
  'DEFINITION', 'HOW_TO', 'CAUSE', 'COMPARISON', 'REVIEW', 'RECOMMENDATION',
  'PRICE', 'CONTACT', 'BUY', 'HIRE_SERVICE', 'LOCATION', 'BRAND', 'GENERAL_INFO',
];

const PRIMARY_OF: Record<SubIntent, PrimaryIntent> = {
  DEFINITION: 'INFORMATIONAL', HOW_TO: 'INFORMATIONAL', CAUSE: 'INFORMATIONAL', GENERAL_INFO: 'INFORMATIONAL',
  COMPARISON: 'COMMERCIAL', REVIEW: 'COMMERCIAL', RECOMMENDATION: 'COMMERCIAL', PRICE: 'COMMERCIAL', LOCATION: 'COMMERCIAL',
  HIRE_SERVICE: 'TRANSACTIONAL', BUY: 'TRANSACTIONAL', CONTACT: 'TRANSACTIONAL',
  BRAND: 'NAVIGATIONAL',
};

const FUNNEL_OF: Record<SubIntent, FunnelStage> = {
  DEFINITION: 'TOFU', HOW_TO: 'TOFU', CAUSE: 'TOFU', GENERAL_INFO: 'TOFU',
  COMPARISON: 'MOFU', REVIEW: 'MOFU', RECOMMENDATION: 'MOFU', LOCATION: 'MOFU',
  PRICE: 'BOFU', HIRE_SERVICE: 'BOFU', BUY: 'BOFU', CONTACT: 'BOFU', BRAND: 'BOFU',
};

const CONTENT_TYPE_OF: Record<SubIntent, string> = {
  DEFINITION: 'บทความให้ความรู้ / คำอธิบายศัพท์',
  HOW_TO: 'บทความ How-to / คู่มือ',
  CAUSE: 'บทความวิเคราะห์สาเหตุ',
  GENERAL_INFO: 'บทความ',
  COMPARISON: 'หน้าเปรียบเทียบ',
  REVIEW: 'รีวิว / กรณีศึกษา',
  RECOMMENDATION: 'บทความจัดอันดับ / แนะนำ',
  PRICE: 'หน้าราคา / แพ็กเกจ',
  HIRE_SERVICE: 'หน้าบริการ (Landing Page)',
  BUY: 'หน้าสินค้า / สั่งซื้อ',
  CONTACT: 'หน้าติดต่อ',
  LOCATION: 'หน้าพื้นที่ให้บริการ',
  BRAND: 'หน้าแบรนด์',
};

const PROBLEM_OF: Record<SubIntent, string | null> = {
  DEFINITION: 'ยังไม่เข้าใจว่าสิ่งนี้คืออะไร',
  HOW_TO: 'อยากลงมือทำเองแต่ไม่รู้ขั้นตอน',
  CAUSE: 'เจอปัญหาแล้วยังไม่รู้สาเหตุ',
  GENERAL_INFO: null,
  COMPARISON: 'เลือกไม่ถูกว่าทางไหนเหมาะกับตัวเอง',
  REVIEW: 'ยังไม่มั่นใจว่าเจ้านี้เชื่อถือได้ไหม',
  RECOMMENDATION: 'ไม่รู้ว่าควรเลือกเจ้าไหน',
  PRICE: 'ยังไม่รู้ว่าต้องเตรียมงบเท่าไหร่',
  HIRE_SERVICE: 'อยากจ้างคนทำให้แต่ยังไม่มีผู้ให้บริการ',
  BUY: 'พร้อมซื้อแล้วแต่ยังไม่มีช่องทาง',
  CONTACT: 'ต้องการติดต่อผู้ให้บริการโดยตรง',
  LOCATION: 'ต้องการผู้ให้บริการที่อยู่ใกล้',
  BRAND: null,
};

const OUTCOME_OF: Record<SubIntent, string | null> = {
  DEFINITION: 'เข้าใจนิยามและภาพรวมได้ในหน้าเดียว',
  HOW_TO: 'ได้ขั้นตอนที่ทำตามได้จริง',
  CAUSE: 'รู้สาเหตุและวิธีแก้ที่ตรงจุด',
  GENERAL_INFO: null,
  COMPARISON: 'เห็นข้อดีข้อเสียเทียบกันชัด ๆ',
  REVIEW: 'เห็นหลักฐาน/ผลงานจริงก่อนตัดสินใจ',
  RECOMMENDATION: 'ได้ตัวเลือกที่คัดมาแล้วพร้อมเหตุผล',
  PRICE: 'เห็นช่วงราคาและสิ่งที่ได้รับชัดเจน',
  HIRE_SERVICE: 'ติดต่อผู้ให้บริการได้ทันที',
  BUY: 'สั่งซื้อได้ทันที',
  CONTACT: 'ได้ช่องทางติดต่อที่ใช้งานได้',
  LOCATION: 'เจอบริการในพื้นที่ของตัวเอง',
  BRAND: null,
};

export interface ModifierScan {
  /** ข้อความที่เหลือหลังตัดคำขยายออก (รูป dedupeKey) — ใช้เป็น "แก่น" ของคีย์เวิร์ด */
  residual: string;
  tags: ModifierTag[];
  subIntents: SubIntent[];
  /** วลีคำขยายที่เจอจริง (ไว้แสดงเป็น Modifier ในตาราง) */
  phrases: string[];
}

/** ตัดคำขยายออกจากคีย์เวิร์ด แล้วบอกว่าเจอกลุ่มความหมายอะไรบ้าง */
export function scanModifiers(keyword: string): ModifierScan {
  let rest = dedupeKey(keyword);
  const tags: ModifierTag[] = [];
  const subIntents: SubIntent[] = [];
  const phrases: string[] = [];
  for (const m of MODIFIER_LIST) {
    if (!rest.includes(m.phrase)) continue;
    // ตัดทุกครั้งที่เจอ ไม่ใช่ครั้งแรกครั้งเดียว
    rest = rest.split(m.phrase).join('');
    if (!tags.includes(m.tag)) tags.push(m.tag);
    if (m.subIntent && !subIntents.includes(m.subIntent)) subIntents.push(m.subIntent);
    phrases.push(m.phrase);
  }
  return { residual: rest.trim(), tags, subIntents, phrases };
}

export function pickSubIntent(subIntents: SubIntent[]): SubIntent {
  for (const s of SUB_INTENT_PRIORITY) {
    if (subIntents.includes(s)) return s;
  }
  return 'GENERAL_INFO';
}

/** อ่านเจตนาทั้งชุดจากคีย์เวิร์ดหนึ่งคำ (ใช้ scan เดิมได้ถ้ามีแล้ว — กันคำนวณซ้ำ) */
export function readIntent(keyword: string, scan?: ModifierScan, entity?: string | null): IntentSignals {
  const s = scan ?? scanModifiers(keyword);
  const subIntent = pickSubIntent(s.subIntents);
  const mainEntity = entity !== undefined ? entity : (s.residual ? displayForm(s.residual) : null);
  return {
    primaryIntent: PRIMARY_OF[subIntent],
    subIntent,
    mainEntity,
    topic: `${mainEntity ?? displayForm(keyword)} · ${subIntent}`,
    modifiers: s.phrases,
    customerProblem: PROBLEM_OF[subIntent],
    desiredOutcome: OUTCOME_OF[subIntent],
    funnelStage: FUNNEL_OF[subIntent],
    recommendedContentType: CONTENT_TYPE_OF[subIntent],
  };
}

export const SUB_INTENT_LABEL_TH: Record<SubIntent, string> = {
  DEFINITION: 'อยากรู้ว่าคืออะไร',
  HOW_TO: 'อยากรู้วิธีทำ',
  CAUSE: 'หาสาเหตุ',
  GENERAL_INFO: 'หาข้อมูลทั่วไป',
  COMPARISON: 'เปรียบเทียบทางเลือก',
  REVIEW: 'หารีวิว/หลักฐาน',
  RECOMMENDATION: 'หาคำแนะนำว่าเจ้าไหนดี',
  PRICE: 'เช็คราคา',
  HIRE_SERVICE: 'หาคนรับทำ/จ้างบริการ',
  BUY: 'พร้อมซื้อ',
  CONTACT: 'ขอช่องทางติดต่อ',
  LOCATION: 'หาบริการใกล้ตัว',
  BRAND: 'ค้นหาแบรนด์',
};

export const PRIMARY_INTENT_LABEL_TH: Record<PrimaryIntent, string> = {
  INFORMATIONAL: 'หาข้อมูล',
  COMMERCIAL: 'เทียบก่อนตัดสินใจ',
  TRANSACTIONAL: 'พร้อมจ้าง/ซื้อ',
  NAVIGATIONAL: 'หาแบรนด์เฉพาะ',
};
