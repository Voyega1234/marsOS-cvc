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
