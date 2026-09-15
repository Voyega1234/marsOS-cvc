// ─── Keyword / Article language helpers ────────────────────────────────────────
// ใช้ร่วมกันระหว่าง keyword research pipeline และ article writer เพื่อตัดสินใจว่า
// keyword หรือบทความควรเป็นภาษาไทยหรืออังกฤษ เมื่อ project.language === 'en' และ
// ผู้ใช้เลือกโหมด "ไทย+อังกฤษ" (both) — เป็น pure function ทดสอบได้ด้วย tsx โดยไม่ต้อง
// เรียก DB/AI

export type LanguageMode = 'th' | 'en' | 'both';

const THAI_CHAR_RANGE = /[฀-๿]/;

/**
 * ตรวจภาษาของ keyword จากตัวอักษร — มีอักษรไทยแม้แต่ตัวเดียว = 'th',
 * เป็นอักษรละติน/ตัวเลข/สัญลักษณ์ล้วน (ไม่มีไทย) = 'en'
 */
export function detectKeywordLanguage(keyword: string): 'th' | 'en' {
  const trimmed = (keyword || '').trim();
  if (!trimmed) return 'en';
  return THAI_CHAR_RANGE.test(trimmed) ? 'th' : 'en';
}

/**
 * ตัดสินใจภาษาที่แท้จริงของบทความ 1 ชิ้น
 * - project.language !== 'en' → ไทยเสมอ (พฤติกรรมเดิม ไม่มี UI เลือกโหมด)
 * - mode 'th' → ไทยเสมอ, mode 'en' → อังกฤษเสมอ (บังคับ ไม่สนสคริปต์ของ keyword)
 * - mode 'both' → ตรวจจากสคริปต์ของ keyword ต่อคำ
 * - ยังไม่เลือก mode → fallback เป็นภาษาของโปรเจกต์ (พฤติกรรมเดิมก่อนมี selector)
 */
export function resolveArticleLanguage(opts: {
  projectLanguage?: string | null;
  mode?: LanguageMode | string | null;
  keyword?: string;
}): 'th' | 'en' {
  const { projectLanguage, mode, keyword } = opts;
  if (projectLanguage !== 'en') return 'th';
  if (mode === 'th') return 'th';
  if (mode === 'en') return 'en';
  if (mode === 'both') return detectKeywordLanguage(keyword || '');
  return 'en';
}

export interface LanguagePrefs {
  keywordMode: LanguageMode;
  /** % ของจำนวน keyword ที่เป็นไทย เมื่อ keywordMode = 'both' */
  ratioThai: number;
}

/**
 * อ่าน languagePrefs จาก project.pushPrefs (JSON string หรือ object)
 * - โปรเจกต์ th → 'th' เสมอ (ไม่มีให้เลือก)
 * - โปรเจกต์ en ยังไม่เคยเลือก → 'en' (ตามภาษาที่เลือกตอนสร้างโปรเจกต์), สัดส่วน 50/50
 */
export function readLanguagePrefs(pushPrefs: unknown, projectLanguage?: string | null): LanguagePrefs {
  const fallback: LanguagePrefs = { keywordMode: projectLanguage === 'en' ? 'en' : 'th', ratioThai: 50 };
  if (projectLanguage !== 'en') return fallback;
  let obj: any = pushPrefs;
  if (typeof pushPrefs === 'string') {
    try { obj = JSON.parse(pushPrefs); } catch { return fallback; }
  }
  const prefs = obj?.languagePrefs;
  if (!prefs || typeof prefs !== 'object') return fallback;
  const mode = prefs.keywordMode;
  const ratio = Number(prefs.ratioThai);
  return {
    keywordMode: mode === 'th' || mode === 'en' || mode === 'both' ? mode : fallback.keywordMode,
    ratioThai: Number.isFinite(ratio) ? Math.min(100, Math.max(0, Math.round(ratio))) : 50,
  };
}

/** แบ่งจำนวน keyword ตามสัดส่วนไทย/อังกฤษ (โหมด both) */
export function splitCountByRatio(total: number, ratioThai: number): { th: number; en: number } {
  const th = Math.round((Math.max(0, total) * Math.min(100, Math.max(0, ratioThai))) / 100);
  return { th, en: Math.max(0, total - th) };
}
