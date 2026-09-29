// ─── ตั้งค่ารูปภาพ / CTA / Author Box ของ SEO SME (Article Lab) และ Content Studio ─────────
// หน้าตั้งค่าใช้ editor ชุดเดียวกับ Upload Article (components/upload-article/settings/*)
// SEO SME: รูปภาพ → Project.themeColors.imageSettings, ผู้เขียน → authors/authorEnabled + themeColors.authorCard/authorPick,
//          CTA → Project.ctaSetting (โครง UploadCtaSettings — normalizeCtaItems อ่านได้ตรง ๆ)
// Content Studio: AppSetting key STUDIO_ARTICLE_SETTINGS_KEY เก็บ {images, cta, author} (ระดับ studio เหมือน studio_article_theme)
// ไฟล์นี้ pure (ใช้ได้ทั้งหน้า UI และ server)

import { readUploadAuthor, type UploadAuthorSettings } from '@/lib/upload-article/author'
import { readUploadCta, type UploadCtaSettings } from '@/lib/upload-article/cta'

export const ARTICLE_MAX_INLINE_IMAGES = 5

/** inlineCount null = ตามบรรทัด "จำนวนรูปประกอบ: N" ใน Image Prompt (พฤติกรรมเดิมก่อนมีหน้าตั้งค่านี้) */
export interface ArticleImageSettings {
  cover: boolean
  coverWithText: boolean
  inlineCount: number | null
  inlineWithText: boolean
}

/** ค่าเริ่มต้น = พฤติกรรมเดิมของ SEO SME / Studio: ปกมีตัวหนังสือ + รูปประกอบตาม Image Prompt แบบไม่มีตัวหนังสือ */
export const DEFAULT_ARTICLE_IMAGE_SETTINGS: ArticleImageSettings = {
  cover: true,
  coverWithText: true,
  inlineCount: null,
  inlineWithText: false,
}

export function readArticleImageSettings(raw: unknown): ArticleImageSettings {
  const d = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const count = typeof d.inlineCount === 'number' && Number.isFinite(d.inlineCount)
    ? Math.max(0, Math.min(ARTICLE_MAX_INLINE_IMAGES, Math.floor(d.inlineCount)))
    : null
  return {
    cover: typeof d.cover === 'boolean' ? d.cover : DEFAULT_ARTICLE_IMAGE_SETTINGS.cover,
    coverWithText: typeof d.coverWithText === 'boolean' ? d.coverWithText : DEFAULT_ARTICLE_IMAGE_SETTINGS.coverWithText,
    inlineCount: count,
    inlineWithText: typeof d.inlineWithText === 'boolean' ? d.inlineWithText : DEFAULT_ARTICLE_IMAGE_SETTINGS.inlineWithText,
  }
}

export type ArticleAuthorPick = 'first' | 'random'

export function readArticleAuthorPick(raw: unknown): ArticleAuthorPick {
  return raw === 'random' ? 'random' : 'first'
}

/** djb2 — seed เดิมได้คนเดิมเสมอ (สุ่มแบบคงที่ต่อบทความ เหมือน Upload Article) */
function hashString(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h
}

/** index ผู้เขียนที่จะใช้ — 'first' = 0, 'random' = hash(seed) % count */
export function pickAuthorIndex(count: number, pick: ArticleAuthorPick, seed: string): number {
  if (count <= 1 || pick === 'first' || !seed) return 0
  return hashString(seed) % count
}

export const STUDIO_ARTICLE_SETTINGS_KEY = 'studio_article_settings'

export interface StudioArticleSettings {
  images: ArticleImageSettings
  cta: UploadCtaSettings
  author: UploadAuthorSettings
}

export function readStudioArticleSettings(raw: unknown): StudioArticleSettings {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    images: readArticleImageSettings(r.images),
    cta: readUploadCta(r.cta),
    author: readUploadAuthor(r.author),
  }
}

/** key ใน Project.themeColors ที่หน้า รูปภาพ / Author Box ของ Article Lab เป็นเจ้าของ (บันทึกผ่าน /article-settings) */
export const LAB_MANAGED_THEME_KEYS = ['authorCard', 'authorPick', 'imageSettings'] as const

/**
 * ตอนบันทึก themeColors ทั้งก้อน (ปุ่ม "บันทึกทั้งหมด" ของ Article Lab) ให้คง key ที่หน้าอื่นเป็นเจ้าของไว้ตามค่าใน DB
 * — ค่าใน state ของหน้า Lab อาจเก่ากว่าที่เพิ่งบันทึกจากหน้า รูปภาพ / Author Box
 */
export function preserveLabManagedThemeKeys(incoming: string, existing: string | null | undefined): string {
  let next: Record<string, unknown>
  try {
    const parsed = JSON.parse(incoming)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return incoming
    next = parsed as Record<string, unknown>
  } catch {
    return incoming
  }
  let prev: Record<string, unknown> = {}
  try {
    const parsed = existing ? JSON.parse(existing) : {}
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) prev = parsed as Record<string, unknown>
  } catch { /* ค่าเดิมเสีย — ไม่มีอะไรให้คง */ }
  for (const key of LAB_MANAGED_THEME_KEYS) {
    if (key in prev) next[key] = prev[key]
    else delete next[key]
  }
  return JSON.stringify(next)
}
