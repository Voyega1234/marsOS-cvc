// ธีมบทความของโปรเจกต์ (Project.themeColors) ↔ UploadTheme — ให้ SEO SME ใช้ CSS builder ตัวเดียวกับ Upload Article
// (buildUploadCss) เพื่อให้พรีวิวสไตล์ของ Upload ตรงกับบทความจริงของ SME
import { normalizeCtaItems, type ArticleCssOptions } from '@/lib/articleComponents'
import type { UploadTheme } from '@/lib/upload-article/types'
import { buildUploadCss, sanitizeThemeDetail, sanitizeThemeDraft } from '@/lib/upload-article/theme-css'

function parseObj(raw: string | null | undefined): Record<string, unknown> {
  try {
    const v = raw ? JSON.parse(raw) : {}
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export function projectThemeToUpload(themeColorsRaw: string | null | undefined, accentColor: string | null | undefined): UploadTheme {
  const tc = parseObj(themeColorsRaw)
  const accentFallback = accentColor || ''
  const theme = str(tc.theme) || accentFallback || '#2563eb'
  const els = (tc.elements && typeof tc.elements === 'object' ? tc.elements : {}) as Record<string, { font?: string } | undefined>
  let fontFamily = str(tc.fontFamily) || undefined
  let headingFont = str(tc.headingFont) || undefined
  const bodyFont = str(els.body?.font)
  const hFont = str(els.h2?.font) || str(els.h1?.font)
  if (!fontFamily && bodyFont) fontFamily = `'${bodyFont}', sans-serif`
  if (!headingFont && hFont) headingFont = `'${hFont}', sans-serif`
  const out: UploadTheme = {
    theme,
    text: str(tc.text) || '#000000',
    border: str(tc.border) || '#e2e8f0',
    accent: str(tc.accent) || accentFallback || theme,
    background: str(tc.background) || '',
    styleMode: tc.styleMode === 'clean' ? 'clean' : 'embed',
    pageBackground: str(tc.pageBackground) || undefined,
    fontFamily,
    headingFont,
    detail: sanitizeThemeDetail(tc.detail),
  }
  return sanitizeThemeDraft(out)
}

export function mergeUploadThemeIntoThemeColors(themeColorsRaw: string | null | undefined, theme: UploadTheme): string {
  const tc = parseObj(themeColorsRaw)
  const t = sanitizeThemeDraft(theme)
  tc.theme = t.theme
  tc.text = t.text
  tc.border = t.border
  tc.accent = t.accent
  tc.background = t.background
  tc.styleMode = t.styleMode === 'clean' ? 'clean' : 'embed'
  tc.pageBackground = t.pageBackground ?? ''
  tc.fontFamily = t.fontFamily ?? ''
  tc.headingFont = t.headingFont ?? ''
  if (t.detail) tc.detail = t.detail
  else delete tc.detail
  return JSON.stringify(tc)
}

/** ตัวเลือก cta ของ buildArticleCss จาก Project.ctaSetting (ไม่สน enabled — เหมือนไฟล์ CSS กลาง) */
export function projectCtaForCss(ctaSettingRaw: string | null | undefined): ArticleCssOptions['cta'] {
  try {
    const parsed = ctaSettingRaw ? JSON.parse(ctaSettingRaw) : null
    if (!parsed) return null
    const normalized = normalizeCtaItems(parsed)
    return {
      mode: normalized.items[0]?.mode,
      custom: normalized.items[0]?.custom,
      items: normalized.items.length > 1 ? normalized.items.map(it => ({ id: it.id, mode: it.mode, custom: it.custom })) : undefined,
    }
  } catch {
    return null
  }
}

export function buildProjectArticleCss(p: { themeColors?: string | null; accentColor?: string | null; ctaSetting?: string | null }): string {
  return buildUploadCss(projectThemeToUpload(p.themeColors, p.accentColor), undefined, { articleCta: projectCtaForCss(p.ctaSetting) })
}
