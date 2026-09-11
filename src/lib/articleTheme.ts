/**
 * ธีมบทความราย element (สี + ฟอนต์) — ใช้ร่วมกันระหว่าง
 * Article Lab (ต่อ client, เก็บใน Project.themeColors.elements) และ
 * Content Studio (ระดับ studio, เก็บใน AppSetting 'studio_article_theme')
 */

export interface ElementStyle {
  color?: string;
  /** สีพื้นหลังของ element — ไม่ตั้ง = โปร่งใส (ค่าเริ่มต้น) */
  background?: string;
  font?: string;
}

/** element ที่ให้ปรับแต่งได้ — ตรงกับโครงบทความที่ระบบเขียนจริง */
export const THEME_ELEMENTS: Array<{ key: string; label: string; hasFont: boolean }> = [
  { key: 'h1', label: 'H1 — หัวเรื่องหลัก', hasFont: true },
  { key: 'h2', label: 'H2 — หัวข้อใหญ่', hasFont: true },
  { key: 'h3', label: 'H3 — หัวข้อย่อย', hasFont: true },
  { key: 'h4', label: 'H4', hasFont: true },
  { key: 'h5', label: 'H5', hasFont: true },
  { key: 'h6', label: 'H6', hasFont: true },
  { key: 'body', label: 'Text — เนื้อความ', hasFont: true },
  { key: 'link', label: 'URL / ลิงก์', hasFont: false },
  { key: 'author', label: 'Author — กล่องผู้เขียน', hasFont: true },
  { key: 'faq', label: 'FAQ — คำถามท้ายบทความ', hasFont: true },
];

/** ฟอนต์ไทยยอดนิยมจาก Google Fonts — โหลดผ่าน @import ใน <style> ของบทความได้เลย */
export const THAI_FONTS = [
  'Sarabun', 'Prompt', 'Kanit', 'Noto Sans Thai', 'Mitr',
  'Bai Jamjuree', 'IBM Plex Sans Thai', 'Chakra Petch', 'Anuphan', 'Pridi',
] as const;

export type ArticleElementStyles = Record<string, ElementStyle>;

/**
 * ชุดสีสำหรับ "ภาพปก/ภาพประกอบ" ที่อิงตามธีมบทความใน Article Lab
 * ลำดับ fallback: ค่าสีระดับธีม → สีของ element ที่ตั้งไว้ (H1/เนื้อความ/ลิงก์) → accentColor ของโปรเจกต์
 * เหตุผล: ลูกค้าบางรายปรับเฉพาะสี H1/เนื้อความในหน้า Article Lab ไม่ได้แตะสีระดับธีม
 * ถ้าไม่ไล่ fallback ให้ ปกจะไม่เปลี่ยนสีตามที่ปรับ
 */
export function resolveImagePalette(
  themeColorsJson: string | null | undefined,
  projectAccent?: string | null,
): { themeColor: string; accentColor: string; backgroundColor: string; textColor: string } {
  let parsed: Record<string, unknown> = {}
  try { parsed = JSON.parse(themeColorsJson || '{}') } catch { /* ค่าเสีย — ใช้ default */ }
  const els = (parsed.elements ?? {}) as ArticleElementStyles
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const el = (key: string, field: 'color' | 'background') => str(els?.[key]?.[field])
  return {
    themeColor: str(parsed.theme) || el('h1', 'color') || str(projectAccent),
    accentColor: str(parsed.accent) || el('link', 'color') || el('h2', 'color') || str(projectAccent),
    backgroundColor: str(parsed.background) || el('body', 'background'),
    textColor: str(parsed.text) || el('body', 'color'),
  }
}

/** แปลง elements ที่ตั้งไว้เป็นบล็อกข้อความใน prompt (คืน '' ถ้าไม่ได้ตั้งอะไรเลย) */
export function buildElementStyleSpec(elements: ArticleElementStyles | undefined | null): string {
  if (!elements) return '';
  const LABEL: Record<string, string> = {
    h1: 'H1', h2: 'H2', h3: 'H3', h4: 'H4', h5: 'H5', h6: 'H6',
    body: 'Body text (p, li)', link: 'Links (a)', author: 'Author box', faq: 'FAQ section',
  };
  const lines: string[] = [];
  const fonts = new Set<string>();
  for (const [key, st] of Object.entries(elements)) {
    if (!st || (!st.color && !st.background && !st.font)) continue;
    const parts: string[] = [];
    if (st.color) parts.push(`color: ${st.color}`);
    if (st.background) parts.push(`background-color: ${st.background}`);
    if (st.font) { parts.push(`font-family: '${st.font}', sans-serif`); fonts.add(st.font); }
    lines.push(`- ${LABEL[key] ?? key}: ${parts.join(' · ')}`);
  }
  if (lines.length === 0) return '';
  const importLine = fonts.size > 0
    ? `\nFONTS: ใส่ใน <style> — @import url('https://fonts.googleapis.com/css2?${Array.from(fonts).map(f => `family=${f.replace(/ /g, '+')}:wght@400;500;700`).join('&')}&display=swap');`
    : '';
  return `
ELEMENT STYLES (ผู้ใช้กำหนดเอง — บังคับใช้ใน inline CSS/style ของ element เหล่านี้ให้ตรงทุกจุด):
${lines.join('\n')}${importLine}`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  ธีม/ฟอนต์/สี → ทิศทางการ "เขียน" (คำสั่งเจ้าของ 2026-09-11)
//
//  หน้า Article Lab ต้องมีผลกับตัวบทความ ไม่ใช่แค่ CSS ที่ครอบทีหลัง
//  บล็อกนี้แปลงตัวเลือกภาพลักษณ์เป็นคำสั่งเรื่องโทนเสียงและโครงสร้าง
//  (ยังคงกฎเดิม: ห้ามให้โมเดลใส่ style/<style> เอง สีจริงใส่ผ่าน buildArticleCss)
// ─────────────────────────────────────────────────────────────────────────────

const THEME_VOICE: Record<string, string> = {
  professional: 'เป็นทางการพอประมาณ น้ำเสียงผู้เชี่ยวชาญ อ้างเหตุผลและตัวเลขมากกว่าอารมณ์ ย่อหน้า 3-5 บรรทัด',
  modern: 'กระชับ ประโยคสั้น ตัดคำฟุ่มเฟือย ใช้หัวข้อย่อยถี่ และ bullet มากกว่าย่อหน้ายาว',
  warm: 'เป็นกันเอง เหมือนคุยกับคนอ่านตรง ๆ ใช้สรรพนามที่อบอุ่น ยกตัวอย่างสถานการณ์จริงบ่อย ๆ',
  bold: 'มั่นใจ ชี้ชัด ขึ้นต้นหัวข้อด้วยข้อสรุปก่อนเหตุผล กล้าฟันธงเมื่อมีข้อมูลรองรับ',
  minimal: 'เรียบ ตรงประเด็น ไม่มีคำขยายเกินจำเป็น หนึ่งหัวข้อหนึ่งประเด็น ตัดบทนำยาว ๆ ทิ้ง',
  editorial: 'เชิงบทความนิตยสาร มีบทนำดึงความสนใจ ร้อยเรียงเป็นเรื่องเล่า มีบทสรุปปิดที่ให้มุมมอง',
};

const FONT_VOICE: Record<string, string> = {
  Sarabun: 'ฟอนต์ราชการ/อ่านง่าย — เขียนให้อ่านสบาย ประโยคไม่ซับซ้อน',
  Prompt: 'ฟอนต์เรขาคณิตสมัยใหม่ — เขียนกระชับ ทันสมัย ไม่เยิ่นเย้อ',
  Kanit: 'ฟอนต์หนักแน่นทันสมัย — หัวข้อต้องคมและชัด ใช้ประโยคบอกเล่าเด็ดขาด',
  Mitr: 'ฟอนต์เป็นมิตร — โทนสุภาพเข้าถึงง่าย เหมาะกับการอธิบายทีละขั้น',
  Pridi: 'ฟอนต์มีเชิง อ่านยาวสบาย — เขียนเชิงบทความ ร้อยเรียงต่อเนื่อง',
  'Noto Sans Thai': 'ฟอนต์กลาง อ่านง่ายทุกอุปกรณ์ — เขียนให้เป็นกลางและชัดเจน',
  'IBM Plex Sans Thai': 'ฟอนต์สายเทคโนโลยี — อธิบายเชิงระบบ มีลำดับขั้นชัด',
  'Bai Jamjuree': 'ฟอนต์คมสมัยใหม่ — โทนมืออาชีพ กระชับ',
  'Chakra Petch': 'ฟอนต์เหลี่ยมคม — โทนเฉียบขาด เหมาะกับหัวข้อเชิงเทคนิค',
  Anuphan: 'ฟอนต์สะอาดร่วมสมัย — เขียนเรียบแต่ดูพรีเมียม',
};

/**
 * แปลงธีม ฟอนต์ และสีหลัก เป็นคำสั่งเรื่องโทนการเขียน
 * คืน '' เมื่อไม่มีข้อมูลพอ
 */
export function buildBrandIdentityBlock(opts: {
  theme?: string | null;
  elements?: ArticleElementStyles | null;
  themeColor?: string | null;
  accentColor?: string | null;
  backgroundColor?: string | null;
}): string {
  const lines: string[] = [];

  const voice = opts.theme ? THEME_VOICE[opts.theme] : '';
  if (voice) lines.push(`- ธีมที่ทีมเลือก: ${opts.theme} → ${voice}`);

  const els = opts.elements ?? {};
  const headingFont = els.h1?.font || els.h2?.font || '';
  const bodyFont = els.body?.font || '';
  const fontNote = (f: string) => FONT_VOICE[f] ?? 'ให้โทนการเขียนสอดคล้องกับบุคลิกของฟอนต์นี้';
  if (headingFont) lines.push(`- ฟอนต์หัวข้อ: ${headingFont} → ${fontNote(headingFont)}`);
  if (bodyFont && bodyFont !== headingFont) lines.push(`- ฟอนต์เนื้อความ: ${bodyFont} → ${fontNote(bodyFont)}`);

  const dark = isDarkColor(opts.backgroundColor);
  if (opts.backgroundColor && dark) {
    lines.push('- พื้นหลังบทความเป็นโทนเข้ม → ย่อหน้าสั้นลง เว้นจังหวะถี่ขึ้น อ่านบนพื้นเข้มแล้วไม่ล้าตา');
  }
  if (opts.themeColor) {
    lines.push(`- สีหลักของแบรนด์: ${opts.themeColor} → เลือกคำและตัวอย่างให้เข้ากับอารมณ์ของสีนี้ ไม่ขัดกับภาพลักษณ์แบรนด์`);
  }

  if (!lines.length) return '';
  return `
==================================================
BRAND IDENTITY (มีผลกับ "วิธีเขียน" — ไม่ใช่ให้ใส่ CSS)
==================================================
${lines.join('\n')}
หมายเหตุ: ยังห้ามใส่ style attribute หรือแท็ก <style> ในบทความเด็ดขาด ระบบใส่สี/ฟอนต์จริงให้เองหลังเขียนเสร็จ
`;
}

/** สีเข้มหรือไม่ (ใช้ตัดสินจังหวะย่อหน้า) — รองรับ hex 3/6 หลัก */
function isDarkColor(hex?: string | null): boolean {
  if (!hex) return false;
  const m = hex.trim().replace('#', '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return false;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) < 128;
}
