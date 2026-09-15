// ─── Keyword / Article language helpers ────────────────────────────────────────
// ใช้ร่วมกันระหว่าง keyword research pipeline และ article writer เพื่อตัดสินใจว่า
// keyword หรือบทความควรเป็นภาษาไทยหรืออังกฤษ — เป็น pure function ทดสอบได้ด้วย tsx
// โดยไม่ต้องเรียก DB/AI
//
// project.language รับได้ 3 ค่า: 'th' | 'en' | 'both' (ไทย+อังกฤษ) — ค่านี้เป็นแค่ค่าเริ่มต้น
// ของโหมดภาษา ทุกโปรเจกต์เปลี่ยนโหมดทีหลังได้จาก LanguageModeSelect (เก็บใน pushPrefs)

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

/** แปลง project.language เป็นโหมดภาษาเริ่มต้น (ค่าที่ไม่รู้จัก เช่น 'zh' = ไทย) */
export function defaultModeForProject(projectLanguage?: string | null): LanguageMode {
  if (projectLanguage === 'en') return 'en';
  if (projectLanguage === 'both') return 'both';
  return 'th';
}

/**
 * ตัดสินใจภาษาที่แท้จริงของบทความ 1 ชิ้น
 * - mode 'th' → ไทยเสมอ, mode 'en' → อังกฤษเสมอ (บังคับ ไม่สนสคริปต์ของ title/keyword)
 * - mode 'both' (ไทย+อังกฤษ) → อิงจาก title ก่อน: title เป็นอังกฤษล้วน = เขียนอังกฤษ,
 *   title มีอักษรไทย = เขียนไทย; ไม่มี title ค่อยดูจากสคริปต์ของ keyword
 * - ยังไม่เลือก mode → ใช้โหมดเริ่มต้นตามภาษาของโปรเจกต์ (th/en/both)
 */
export function resolveArticleLanguage(opts: {
  projectLanguage?: string | null;
  mode?: LanguageMode | string | null;
  keyword?: string;
  title?: string;
}): 'th' | 'en' {
  const { projectLanguage, keyword, title } = opts;
  const mode: LanguageMode =
    opts.mode === 'th' || opts.mode === 'en' || opts.mode === 'both' ? opts.mode : defaultModeForProject(projectLanguage);
  if (mode === 'th') return 'th';
  if (mode === 'en') return 'en';
  const trimmedTitle = (title || '').trim();
  if (trimmedTitle) return detectKeywordLanguage(trimmedTitle);
  return detectKeywordLanguage(keyword || '');
}

export interface LanguagePrefs {
  keywordMode: LanguageMode;
  /** % ของจำนวน keyword ที่เป็นไทย เมื่อ keywordMode = 'both' */
  ratioThai: number;
}

/**
 * อ่าน languagePrefs จาก project.pushPrefs (JSON string หรือ object)
 * - ยังไม่เคยเลือก → โหมดเริ่มต้นตามภาษาที่เลือกตอนสร้างโปรเจกต์ (th/en/both), สัดส่วน 50/50
 * - เคยเลือกแล้ว → ใช้ค่าที่บันทึกไว้ ไม่ว่าโปรเจกต์จะเป็นภาษาอะไร
 */
export function readLanguagePrefs(pushPrefs: unknown, projectLanguage?: string | null): LanguagePrefs {
  const fallback: LanguagePrefs = { keywordMode: defaultModeForProject(projectLanguage), ratioThai: 50 };
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
