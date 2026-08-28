/**
 * WordGod Local SME — ชั้นกรองความเกี่ยวข้อง (Relevance Guard)
 *
 * ปัญหาที่แก้ (QA 2026-08): คำนอกพื้นที่ (ล้างแอร์นนทบุรี/พัทยา ทั้งที่ธุรกิจอยู่บางแค)
 * และคำนอกบริการ (ซ่อมพัดลมแอร์รถยนต์, แอร์ midea ดีไหม = เจตนาซื้อเครื่อง ไม่ใช่จ้างบริการ)
 * หลุดเข้าตารางสุดท้าย เพราะคะแนน relevance เป็น n-gram ไม่เข้าใจเจตนา
 *
 * ทำไมไม่ใช้ substring จังหวัด: ชื่อพื้นที่ไทยชนคำสามัญ ("เลย", "ตาก", "น่าน")
 * จะตัดคำดีทิ้ง — จึงใช้ LLM ตัดสิน แล้ว fail-open (LLM พัง = ไม่ตัดอะไร + แจ้ง warning)
 *
 * ไฟล์นี้ pure (สร้าง prompt + แปลผล) — การเรียก LLM จริงอยู่ที่ API route
 */

export type RelevanceVerdict = 'ok' | 'off_area' | 'off_service';

export interface RelevanceGuardInput {
  services: string[];
  businessContext?: string;
  /** พื้นที่หลัก + พื้นที่ใกล้เคียงที่ผู้ใช้เลือก — ว่าง = ธุรกิจไม่จำกัดพื้นที่ (โหมด online) */
  primaryLocation?: string;
  nearbyLocations?: string[];
}

export interface RelevanceGuardResult {
  verdicts: Map<string, { verdict: RelevanceVerdict; reason: string }>;
  /** คำที่โมเดลไม่ตอบกลับมา — ถือว่า ok (fail-open รายคำ) */
  unanswered: string[];
}

export const MAX_KEYWORDS_PER_CALL = 400;

export function buildRelevanceGuardPrompt(input: RelevanceGuardInput, keywords: string[]): string {
  const capped = keywords.slice(0, MAX_KEYWORDS_PER_CALL);
  const areaLines = input.primaryLocation
    ? `พื้นที่ให้บริการหลัก: ${input.primaryLocation}
พื้นที่ใกล้เคียงที่รับงาน: ${(input.nearbyLocations ?? []).join(', ') || '(ไม่ได้ระบุ)'}`
    : 'พื้นที่ให้บริการ: ไม่จำกัดพื้นที่ (ธุรกิจออนไลน์/ทั่วประเทศ) — ห้ามตอบ off_area';
  return `คุณเป็นผู้ตรวจคุณภาพคีย์เวิร์ด SEO ของธุรกิจ SME ไทย หน้าที่เดียวคือตัดคำที่ "ไม่ใช่ลูกค้าของธุรกิจนี้" ออก

ธุรกิจให้บริการ: ${input.services.join(', ')}
${input.businessContext ? `บริบทธุรกิจ: ${input.businessContext}` : ''}
${areaLines}

เกณฑ์ตัดสินต่อคำ (เลือกได้ค่าเดียว):
- "off_area" = คำระบุพื้นที่อื่นชัดเจนที่ไม่ใช่พื้นที่หลัก/ใกล้เคียงข้างบน (เช่นระบุจังหวัด/เขต/อำเภอ/เมืองอื่น) — คนค้นคำนี้อยู่นอกเขตให้บริการ
- "off_service" = เจตนาของคนค้นไม่ใช่ลูกค้าของสิ่งที่ธุรกิจขาย/ให้บริการ ได้แก่
  • ต้องการซื้อสินค้าแบรนด์/ยี่ห้ออื่นโดยเฉพาะ ทั้งที่ธุรกิจไม่ได้ขายแบรนด์นั้น (เช่นค้น "สปอร์ตบรา adidas" ทั้งที่ร้านขายแบรนด์ตัวเอง) — แต่ถ้าธุรกิจรับจ้างบริการ คำเรียกใช้บริการกับเครื่อง/ของยี่ห้อใดก็ตาม (เช่น "ล้างแอร์ daikin") ถือว่า ok เพราะเป็นลูกค้าบริการจริง
  • สินค้า/บริการคนละประเภทกับที่ธุรกิจทำ (เช่นของรถยนต์ทั้งที่ทำเฉพาะบ้าน, กางเกงใน/กางเกงทำงานทั้งที่ร้านขายชุดออกกำลังกาย)
  • เจตนาซื้อ/ผ่อน/เปรียบเทียบตัวเครื่อง-รุ่น-สเปค ทั้งที่ธุรกิจรับจ้างบริการอย่างเดียวไม่ได้ขายเครื่อง
  • ของมือสอง ทั้งที่ธุรกิจขายของใหม่
  • ชื่อแบรนด์/แพลตฟอร์ม/ร้านของผู้ให้บริการรายอื่น (คนค้นตั้งใจใช้เจ้านั้นโดยเฉพาะ เช่น "q chang ล้างแอร์")
  • หางาน/สมัครงาน, หาแฟรนไชส์
  • ค้นหาหน่วยงานราชการ/องค์กร/สถานที่อื่น (ที่อยู่ เบอร์โทร สาขา เวลาทำการ เช่น "สำนักงานสรรพากรพื้นที่...") ซึ่งไม่ใช่การหาผู้ให้บริการ
- "ok" = ลูกค้าเป้าหมายจริง รวมถึงคำหาความรู้/วิธีทำ/ราคา/รีวิวที่เกี่ยวกับบริการ (คำ DIY เช่น "วิธีล้างแอร์เอง" ถือว่า ok เพราะดึง traffic เข้าเว็บได้)
ก้ำกึ่งให้ตอบ ok — ตัดเฉพาะที่มั่นใจว่าหลุดจริง

ตอบเป็น JSON array ล้วน ไม่มีข้อความอื่น รูปแบบ:
[{"k":"<คำ>","v":"ok|off_area|off_service","r":"<เหตุผลสั้น เฉพาะคำที่ไม่ ok>"}]
ต้องตอบครบทุกคำตามรายการนี้ (${capped.length} คำ):
${capped.map(k => `- ${k}`).join('\n')}`;
}

export function parseRelevanceGuardResponse(text: string, keywords: string[]): RelevanceGuardResult {
  const verdicts = new Map<string, { verdict: RelevanceVerdict; reason: string }>();
  const m = text.match(/\[[\s\S]*\]/);
  if (m) {
    try {
      const arr = JSON.parse(m[0]) as Array<{ k?: string; v?: string; r?: string }>;
      for (const row of arr) {
        if (!row?.k) continue;
        const v = row.v === 'off_area' || row.v === 'off_service' ? row.v : 'ok';
        verdicts.set(row.k.trim(), { verdict: v, reason: (row.r ?? '').slice(0, 120) });
      }
    } catch { /* ตอบไม่เป็น JSON — ถือว่าไม่ได้ตรวจ (fail-open ทั้งชุด) */ }
  }
  const unanswered = keywords.filter(k => !verdicts.has(k.trim()));
  return { verdicts, unanswered };
}
