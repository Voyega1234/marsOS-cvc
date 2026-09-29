/**
 * AI expansion แบบเบา — ใช้ร่วมกันใน online-research และ local-research
 *
 * ทำไมไม่ใช้ KEYWORD_RESEARCH_PROMPT: prompt นั้นให้โมเดลตอบ 12 ฟิลด์ต่อคำ (volume เดา, เหตุผล,
 * ปัญหาลูกค้า ฯลฯ) แต่ขั้น expansion ใช้แค่ "ตัวคำ" — ตัวเลขทุกตัวดึงจาก Keyword Planner/DataForSEO
 * อยู่แล้ว output ที่เกินทำให้แต่ละ call ช้ามาก (~90–115 วิ/รอบ) และได้คำต่อ call น้อย
 *
 * ทำไมต้องมีวงมุมมอง (angle ring): เดิมทุก batch ในรอบเดียวกันยิง prompt เดียวกัน/มุมน้อย
 * AI เลยตอบคำซ้ำกันเอง รอบถัดไปได้ +0 แล้วลูปหยุด pool เหลือ 0.4–0.9× ของเป้า
 * prompt ของ keyword research เขียนในโค้ดได้ (ข้อยกเว้นเฉพาะ keyword research ที่เจ้าของอนุญาต)
 */

export type ExpansionAngleKind =
  | 'core' | 'sub' | 'problem' | 'price' | 'compare' | 'howto' | 'buyer' | 'location';

export interface ExpansionAngle {
  kind: ExpansionAngleKind;
  /** หัวข้อ/บริการ/ปัญหา/พื้นที่ที่ batch นี้ต้องเจาะ */
  focus: string;
}

const TOPIC_KINDS: ExpansionAngleKind[] = ['core', 'sub', 'price', 'compare', 'howto', 'buyer'];

function uniq(list: Array<string | null | undefined>, max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/** hash แบบคงที่ — สลับลำดับวงมุมมองให้เหมือนเดิมทุกครั้ง (resume แล้วได้มุมเดิม) */
function stableHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * วงมุมมองสำหรับ expansion: หัวข้อ × ประเภทมุม + ปัญหาลูกค้า + พื้นที่
 * สลับลำดับแบบคงที่ให้ batch ติดกันได้หัวข้อ/มุมต่างกัน
 */
export function buildAngleRing(opts: {
  topics: Array<string | null | undefined>;
  problems?: Array<string | null | undefined>;
  locations?: Array<string | null | undefined>;
  maxTopics?: number;
}): ExpansionAngle[] {
  const topics = uniq(opts.topics, opts.maxTopics ?? 24);
  const problems = uniq(opts.problems ?? [], 24);
  const locations = uniq(opts.locations ?? [], 12);
  const ring: ExpansionAngle[] = [];
  for (const focus of topics) for (const kind of TOPIC_KINDS) ring.push({ kind, focus });
  for (const focus of problems) ring.push({ kind: 'problem', focus });
  for (const focus of locations) ring.push({ kind: 'location', focus });
  return ring
    .map(a => ({ a, h: stableHash(`${a.kind}|${a.focus}`) }))
    .sort((x, y) => x.h - y.h)
    .map(x => x.a);
}

/** มุมของ batch ที่ bi ในรอบที่ wave — ไม่ซ้ำกันจนกว่าจะวนครบวง */
export function angleAt(ring: ExpansionAngle[], wave: number, bi: number, perWave: number): ExpansionAngle | null {
  if (!ring.length) return null;
  return ring[(wave * perWave + bi) % ring.length];
}

/**
 * รายการห้ามซ้ำแบบย่อ: ต้น pool (seed/คำจาก KP ที่เป็นแกนธุรกิจ) + ท้าย pool (คำล่าสุด)
 * ส่งทั้ง pool ทำให้ prompt บวมและโมเดลตอบสั้นลง — คำซ้ำจริงถูกกันด้วย dedup ของ route อยู่แล้ว
 */
export function pickExcludeSample(keywords: string[], max = 150): string[] {
  if (keywords.length <= max) return keywords.slice();
  const half = Math.floor(max / 2);
  return uniq([...keywords.slice(0, half), ...keywords.slice(-(max - half))], max);
}

const KIND_TH: Record<ExpansionAngleKind, (f: string) => string> = {
  core: f => `คำค้นหลักของ "${f}" ทั้งคำสั้น 1–3 คำและคำยาวที่เจาะจง`,
  sub: f => `บริการย่อย/ประเภท/รุ่น/วัสดุ/ขนาดที่แตกออกมาจาก "${f}"`,
  price: f => `ราคา ค่าใช้จ่าย โปรโมชั่น แพ็กเกจ ความคุ้มค่า ของ "${f}"`,
  compare: f => `การเปรียบเทียบ ข้อดีข้อเสีย ยี่ห้อ/แบบไหนดี รีวิว ของ "${f}"`,
  howto: f => `วิธีทำ ขั้นตอน วิธีเลือก วิธีดูแล ความรู้ที่เกี่ยวกับ "${f}"`,
  buyer: f => `คำที่คนพร้อมซื้อ/พร้อมจ้างพิมพ์ เช่น รับทำ ใกล้ฉัน ที่ไหนดี สั่งซื้อ ติดต่อ สำหรับ "${f}"`,
  problem: f => `ปัญหา/อาการ/สาเหตุ/คำถามของลูกค้าเรื่อง "${f}" ที่นำไปสู่การใช้บริการของเรา`,
  location: f => `คำค้นที่ผูกกับพื้นที่ "${f}" (บริการ + ชื่อพื้นที่ ใกล้ ${f})`,
};

const KIND_EN: Record<ExpansionAngleKind, (f: string) => string> = {
  core: f => `core search terms for "${f}" — both short 1–3 word head terms and specific long-tail`,
  sub: f => `sub-services, types, models, materials or sizes that branch out of "${f}"`,
  price: f => `price, cost, deals, packages and value questions about "${f}"`,
  compare: f => `comparisons, pros and cons, which brand/type is best, reviews of "${f}"`,
  howto: f => `how-to, steps, how to choose, maintenance and know-how around "${f}"`,
  buyer: f => `ready-to-buy / ready-to-hire queries for "${f}" (service, near me, where to buy, order, contact)`,
  problem: f => `customer problems, symptoms, causes and questions about "${f}" that lead to our service`,
  location: f => `queries tied to the area "${f}" (service + area name, near ${f})`,
};

/**
 * prompt ขยายคำแบบเบา — ตอบแค่ {"keywords":["..."]}
 * ภาษา 'en' = คำภาษาอังกฤษล้วน, 'th_en' = ไทยเป็นหลักผสมคำอังกฤษที่คนไทยพิมพ์จริง
 */
export function buildExpansionPrompt(opts: {
  niche: string;
  angle: ExpansionAngle | null;
  count: number;
  exclude: string[];
  language?: 'th' | 'en' | 'th_en';
  /** โหมด local: พื้นที่หลักของธุรกิจ */
  area?: string;
}): string {
  const lang = opts.language ?? 'th';
  const en = lang === 'en';
  const focus = opts.angle ? (en ? KIND_EN : KIND_TH)[opts.angle.kind](opts.angle.focus) : '';
  const excludeBlock = opts.exclude.length
    ? `${en ? 'Do NOT return these (or trivial variants of them):' : 'ห้ามตอบคำเหล่านี้ (รวมถึงคำที่ต่างแค่เว้นวรรค/สลับคำ):'}\n${opts.exclude.map(k => `- ${k}`).join('\n')}\n`
    : '';
  if (en) {
    return `You are a senior SEO keyword researcher.
Business: ${opts.niche}${opts.area ? `\nMain service area: ${opts.area}` : ''}
Focus of this batch: ${focus || 'the core products/services of this business'}

Return ${opts.count} real Google search queries in ENGLISH that people actually type, all clearly relevant to this business.
Rules:
- Every query must be something this business can rank for with a service/product page or a helpful article.
- Mix intent: about 40% informational, 35% commercial investigation, 20% transactional, 5% navigational.
- Mix length: some short head terms (1–3 words) and many specific long-tail queries (3–7 words).
- No competitor brand names, no forum/site names, no numbering, no duplicates.
${excludeBlock}
Output JSON only, no markdown: {"keywords":["query 1","query 2"]}`;
  }
  const langRule = lang === 'th_en'
    ? '- ภาษาไทยเป็นหลัก ผสมคำภาษาอังกฤษ/คำทับศัพท์ที่คนไทยพิมพ์ค้นจริงได้ประมาณ 20%'
    : '- ภาษาไทยเท่านั้น เขียนแบบที่คนไทยพิมพ์ในช่องค้นหาจริง (ทับศัพท์ได้ถ้าคนนิยมพิมพ์แบบนั้น)';
  return `คุณคือผู้เชี่ยวชาญ SEO keyword research ตลาดไทย
ธุรกิจ: ${opts.niche}${opts.area ? `\nพื้นที่ให้บริการหลัก: ${opts.area}` : ''}
โฟกัสของชุดนี้: ${focus || 'สินค้า/บริการหลักของธุรกิจ'}

ตอบคำค้น Google จริง ${opts.count} คำ ที่คนพิมพ์ค้นจริงและเกี่ยวกับธุรกิจนี้ชัดเจน
กฎ:
- ทุกคำต้องเป็นคำที่ธุรกิจนี้ทำหน้าเว็บ (หน้าบริการ/สินค้า หรือบทความ) ไปติดอันดับได้จริง
- ผสม intent: ความรู้ ~40% เปรียบเทียบ/พิจารณา ~35% พร้อมซื้อ/จ้าง ~20% ค้นหาแบรนด์ ~5%
- ผสมความยาว: คำสั้น 1–3 คำบ้าง และคำยาวเจาะจง 3–7 คำเป็นส่วนใหญ่
${langRule}
- ห้ามชื่อแบรนด์คู่แข่ง ห้ามชื่อเว็บบอร์ด/pantip ห้ามใส่เลขลำดับ ห้ามคำซ้ำ
${excludeBlock}
ตอบเป็น JSON เท่านั้น ไม่มี markdown: {"keywords":["คำที่ 1","คำที่ 2"]}`;
}

/**
 * ดึงรายการคีย์เวิร์ด (string[]) จากผลลัพธ์ AI ที่รูปแบบไม่แน่นอน — รองรับ:
 *  - object ที่มี field "keywords" เป็น array ของ string หรือ {keyword}
 *  - object ที่มี array-valued property อื่น (กันโมเดลตั้งชื่อ field เพี้ยน)
 *  - array ราก, และ string ที่มี JSON ฝังอยู่
 * ไม่โยน error แม้ input จะพัง
 */
export function extractKeywordList(value: unknown): string[] {
  let v: unknown = value;
  if (typeof v === 'string') {
    const text = v;
    const objMatch = text.match(/\{[\s\S]*\}/);
    const arrMatch = text.match(/\[[\s\S]*\]/);
    const objIdx = objMatch ? text.indexOf(objMatch[0]) : -1;
    const arrIdx = arrMatch ? text.indexOf(arrMatch[0]) : -1;
    const pick = objIdx >= 0 && (arrIdx < 0 || objIdx <= arrIdx) ? objMatch?.[0] : arrMatch?.[0];
    if (!pick) return [];
    try { v = JSON.parse(pick); } catch { return []; }
  }
  const toStrings = (arr: unknown[]): string[] =>
    arr.map(x => (typeof x === 'string' ? x : typeof x === 'object' && x && 'keyword' in x ? String((x as { keyword?: unknown }).keyword ?? '') : ''))
      .map(s => s.replace(/^\s*\d+[.)]\s*/, '').trim())
      .filter(Boolean);
  if (Array.isArray(v)) return toStrings(v);
  if (v && typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    if (Array.isArray(obj.keywords)) return toStrings(obj.keywords);
    for (const val of Object.values(obj)) {
      if (Array.isArray(val)) return toStrings(val);
    }
  }
  return [];
}
