/**
 * WordGod Local SME — Business Category Templates
 *
 * จุดต่อขยาย (§34): เพิ่มหมวดธุรกิจใหม่ = เพิ่ม entry ในไฟล์นี้ไฟล์เดียว
 * ระบบไม่ผูกกับธุรกิจใดธุรกิจหนึ่ง — ถ้าไม่ match template ใดเลย
 * ตัวสร้างคีย์เวิร์ดจะถอยไปใช้กติกาทั่วไปจาก intentModifiers
 */

import type { ModifierDefinition, ServiceShape } from './intentModifiers';

export interface BusinessTemplate {
  id: string;
  label: string;
  /** ใช้จับว่าคำบริการที่ผู้ใช้พิมพ์เข้าหมวดนี้ไหม */
  match: RegExp;
  /** บริการย่อยที่พบบ่อยในหมวดนี้ — ใช้เป็นตัวช่วยเสนอ ไม่ได้บังคับ */
  relatedServices: string[];
  /** modifier ที่ต้อง "ปิด" สำหรับหมวดนี้ (ภาษาไม่เป็นธรรมชาติ) */
  suppressModifierIds?: string[];
  /** modifier เฉพาะหมวด */
  extraModifiers?: ModifierDefinition[];
  /** บังคับ shape ของคำบริการ ถ้าหมวดนี้รู้ดีกว่าตัว heuristic */
  forceShape?: ServiceShape;
}

export const BUSINESS_TEMPLATES: BusinessTemplate[] = [
  {
    id: 'aircon',
    label: 'แอร์ / เครื่องปรับอากาศ',
    match: /แอร์|เครื่องปรับอากาศ|air ?con/i,
    relatedServices: ['ล้างแอร์', 'ซ่อมแอร์', 'เติมน้ำยาแอร์', 'ติดตั้งแอร์', 'ย้ายแอร์', 'ถอดแอร์'],
    forceShape: 'action',
  },
  {
    id: 'plumbing',
    label: 'ประปา / ท่อ',
    match: /ท่อ|ประปา|ส้วม|ชักโครก|ปั๊มน้ำ/,
    relatedServices: ['ท่อตัน', 'ท่อรั่ว', 'สูบส้วม', 'ช่างประปา', 'ซ่อมปั๊มน้ำ'],
    forceShape: 'action',
  },
  {
    id: 'clinic',
    label: 'คลินิก / สถานพยาบาล',
    match: /คลินิก|ทันตกรรม|ทำฟัน|จัดฟัน|ผิวหนัง|เสริมความงาม|โรงพยาบาล/,
    relatedServices: ['ราคา', 'รีวิว', 'ใกล้ฉัน', 'เปิดวันนี้', 'นัดหมาย'],
    // "รับคลินิกทันตกรรม" / "ช่างคลินิก" ไม่ใช่ภาษาไทยที่ใช้จริง
    suppressModifierIds: ['accept_job', 'technician', 'shop', 'company', 'service_of'],
    forceShape: 'entity',
    extraModifiers: [
      { id: 'clinic_open_today', group: 'urgency', tag: 'urgency', label: 'เปิดวันนี้',
        render: base => `${base}เปิดวันนี้`, detect: /เปิดวันนี้|เปิดวันอาทิตย์|เปิดเสาร์/, weight: 84 },
      { id: 'clinic_appointment', group: 'commercial', tag: 'commercial', label: 'นัดหมาย',
        render: base => `${base}นัดหมาย`, detect: /นัดหมาย|จองคิว|ทำนัด/, weight: 80 },
      { id: 'clinic_doctor', group: 'commercial', tag: 'commercial', label: 'หมอดี',
        render: base => `${base}หมอดี`, detect: /หมอดี|หมอเก่ง/, weight: 72 },
    ],
  },
  {
    id: 'cleaning',
    label: 'ทำความสะอาด / แม่บ้าน',
    match: /ทำความสะอาด|แม่บ้าน|ซักผ้า|ซักรีด|พรม|โซฟา|กำจัดปลวก|กำจัดแมลง/,
    relatedServices: ['ทำความสะอาดบ้าน', 'ซักโซฟา', 'ซักพรม', 'กำจัดปลวก'],
    forceShape: 'action',
  },
  {
    id: 'auto',
    label: 'รถยนต์ / อู่ซ่อม',
    match: /รถยนต์|อู่|ยางรถ|เปลี่ยนน้ำมันเครื่อง|ซ่อมรถ|ทำสีรถ|ฟิล์มรถ/,
    relatedServices: ['ซ่อมรถ', 'เปลี่ยนยาง', 'ทำสีรถ', 'ติดฟิล์มรถ'],
  },
];

export function resolveBusinessTemplate(service: string): BusinessTemplate | null {
  return BUSINESS_TEMPLATES.find(t => t.match.test(service)) ?? null;
}
