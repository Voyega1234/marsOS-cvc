import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { callGeminiImage } from '@/lib/geminiImage'

// Allow up to 5 minutes for article generation (large prompt + long output)
export const maxDuration = 300

// Claude Opus 4.8 pricing (per 1M tokens)
const COST_PER_M_INPUT  = 5.00
const COST_PER_M_OUTPUT = 25.00

function calcCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * COST_PER_M_INPUT + (outputTokens / 1_000_000) * COST_PER_M_OUTPUT
}

async function logAIJob(opts: {
  orgId: string; userId: string; projectId?: string; articleId?: string
  jobType: string; modelName: string
  inputTokens: number; outputTokens: number; status: 'COMPLETED' | 'FAILED'
  errorMessage?: string
}) {
  const tokenUsed = opts.inputTokens + opts.outputTokens
  const estimatedCost = calcCost(opts.inputTokens, opts.outputTokens)
  try {
    await (prisma.aIJob as any).create({
      data: {
        organizationId: opts.orgId,
        createdById: opts.userId,
        ...(opts.projectId && { projectId: opts.projectId }),
        ...(opts.articleId && { articleId: opts.articleId }),
        jobType: opts.jobType,
        status: opts.status,
        modelProvider: 'CLAUDE',
        modelName: opts.modelName,
        tokenUsed,
        estimatedCost,
        ...(opts.errorMessage && { errorMessage: opts.errorMessage }),
      },
    })
  } catch { /* non-fatal */ }
}

const CC_ROOT = path.join(os.homedir(), 'Desktop', 'Mars', 'Convert-Cake-SEO-Project-FULL-20260623')

function readPromptFile(relPath: string): string {
  try { return fs.readFileSync(path.join(CC_ROOT, relPath), 'utf-8') } catch { return '' }
}

function loadConvertCakePrompts() {
  return {
    globalRules:  readPromptFile('prompts/global_rules.md'),
    masterPrompt: readPromptFile('prompts/convert_cake_seo_master.md'),
    validator:    readPromptFile('prompts/convert_cake_validator_10_10.md'),
    coverMaster:  readPromptFile('prompts/cover_master_prompt.md'),
  }
}

interface CtaChannel { type: string; label: string; value: string }
interface CtaSettings { enabled: boolean; headline: string; subtext: string; channels: CtaChannel[] }

function buildCtaBlock(cta: CtaSettings | null | undefined): string {
  if (!cta?.enabled || !cta.channels.filter(c => c.value).length) return ''
  const channelLines = cta.channels
    .filter(c => c.value)
    .map(c => `  - ${c.label || c.type}: ${c.value}`)
    .join('\n')
  return `
==================================================
CTA (Call-to-Action) — ต้องใส่ในบทความ
==================================================
Headline: ${cta.headline}
Subtext: ${cta.subtext}
ช่องทาง:
${channelLines}

INSTRUCTION: ใส่ CTA box ที่สวยงามในบทความ โดย:
1. วาง CTA หลักก่อน FAQ section (ปลายบทความ)
2. ใช้ Design: rounded box พร้อมสี Theme Color เป็น background, มีปุ่มแต่ละช่องทาง
3. ทุก channel ที่มี URL → ทำเป็น <a href="..."> ปุ่ม
4. ทุก channel ที่เป็น phone/email → ทำเป็น <a href="tel:..." หรือ "mailto:...">
5. Style ให้สอดคล้องกับ COLOR SYSTEM ทั้งหมด
`
}

function buildAuthorHtml(name: string, title: string, imageBase64: string): string {
  if (!name && !title) return ''
  const imgTag = imageBase64
    ? `<img src="${imageBase64}" alt="${name}" style="width:56px;height:56px;border-radius:50%;object-fit:cover;border:2px solid #e5e7eb;flex-shrink:0;">`
    : ''
  return `
<div class="author-box" style="display:flex;align-items:center;gap:16px;padding:20px 24px;margin-top:40px;border-top:2px solid #e5e7eb;background:#f9fafb;border-radius:12px;">
  ${imgTag}
  <div style="display:flex;flex-direction:column;gap:4px;">
    ${name ? `<span style="font-size:15px;font-weight:700;color:#111827;">${name}</span>` : ''}
    ${title ? `<span style="font-size:13px;color:#6b7280;">${title}</span>` : ''}
  </div>
</div>`
}

function shuffleSeed<T>(arr: T[], seed: string): T[] {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.abs((h * (i + 1)) % (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function buildArticlePrompt(opts: {
  keyword: string; title: string; language: string
  styleGuide: string; accentColor: string; theme: string
  colorTheme?: string; colorText?: string; colorBorder?: string; colorAccent?: string
  typography?: { fontFamily?: string | null; fontSize?: string | null; lineHeight?: string | null; letterSpacing?: string | null; headingFont?: string | null; headingWeight?: string | null; paragraphMargin?: string | null } | null
  internalLinks: string; forbiddenWords: string
  websiteUrl: string; siteName: string; brandTone: string
  contentType: string; sampleArticle?: string
  cta?: CtaSettings | null
  promptOverrides?: Record<string, string>
}) {
  const base = loadConvertCakePrompts()
  const overrides = opts.promptOverrides ?? {}
  const globalRules  = overrides['global_rules']  || base.globalRules
  const masterPrompt = overrides['master_prompt']  || base.masterPrompt
  const validator    = overrides['validator']      || base.validator

  const effectiveThemeColor = opts.colorTheme || opts.accentColor || '#2563eb'
  const effectiveTextColor = opts.colorText || '#1c1c1c'
  const effectiveBorderColor = opts.colorBorder || '#e2e8f0'
  const effectiveAccentColor = opts.colorAccent || opts.accentColor || '#16a34a'

  const typo = opts.typography
  const typographyBlock = typo ? `
==================================================
TYPOGRAPHY SYSTEM (แกะจาก URL ตัวอย่าง — ใช้ใน inline CSS ให้ตรงทุก element)
==================================================
Body Font Family: ${typo.fontFamily || 'inherit'}
Body Font Size: ${typo.fontSize || '16px'}
Body Line Height: ${typo.lineHeight || '1.7'}
Letter Spacing: ${typo.letterSpacing || 'normal'}
Heading Font: ${typo.headingFont || typo.fontFamily || 'inherit'}
Heading Weight: ${typo.headingWeight || '700'}
Paragraph Margin Bottom: ${typo.paragraphMargin || '1.2em'}
` : ''

  const siteBlock = `
==================================================
SITE CONFIG
==================================================
Site Name: ${opts.siteName || 'ไม่ระบุ'}
Website URL: ${opts.websiteUrl || 'ไม่ระบุ'}
Brand Tone: ${opts.brandTone || 'professional, helpful, practical'}
Language: ${opts.language || 'th'}
Content Type: ${opts.contentType || 'seo_article'}
หัวข้อ (H1): ${opts.title}
Keyword หลัก: ${opts.keyword}
Theme: ${opts.theme || 'professional'}

COLOR SYSTEM:
- Theme Color (headings, CTA backgrounds, highlights): ${effectiveThemeColor}
- Text Color (body text): ${effectiveTextColor}
- Border Color (dividers, callout boxes): ${effectiveBorderColor}
- Accent Color (links, buttons, badges): ${effectiveAccentColor}
${typographyBlock}
==================================================
SITE STYLE GUIDE
==================================================
${opts.styleGuide || '(ไม่มี — ใช้ tone และ color จาก SITE CONFIG ด้านบน)'}

==================================================
INTERNAL LINKS
==================================================
${opts.internalLinks || '(ไม่มี)'}

==================================================
FORBIDDEN WORDS
==================================================
${opts.forbiddenWords || '(ไม่มี)'}

==================================================
COVER IMAGE PROMPT INSTRUCTION
==================================================
ในส่วน CONVERT_CAKE_SEO_META comment block ให้ใส่ข้อมูลดังนี้ (REQUIRED ทุก field):
en_slug: [English URL slug for this article, lowercase, hyphens only, no Thai, e.g. "dental-implant-price-guide"]
meta_description: [Thai meta description 120-155 characters สรุปเนื้อหาบทความ]
cover_headline: ชื่อบทความสั้น ≤30 ตัว
cover_subtitle: คำอธิบายสั้น ≤55 ตัว
benefit_1 ถึง benefit_4: ประโยชน์สั้น 6-12 ตัว
highlight_text: callout สั้น ≤50 ตัว
cover_image_prompt: [English prompt for Gemini AI. STYLE: premium dark-background infographic. Describe: (1) 1 photorealistic 3D hero element relevant to "${opts.keyword}" floating center-right, (2) 4-6 small 3D accent icons floating around it with electric cyan/gold glow halos, (3) deep navy gradient background with scattered neon particles, (4) dramatic studio lighting. Left 40% open dark area for headline text overlay. NO text/letters/numbers on image. 3-5 sentences, English only.]
mid_image_prompt: [English prompt for in-body image. High-quality editorial lifestyle photograph about "${opts.title}". ABSOLUTELY NO text, labels, or overlays. Beautiful composition, professional lighting, 16:9 horizontal landscape.]
`

  const sampleBlock = opts.sampleArticle
    ? `\n==================================================\nEXAMPLE ARTICLE (ใช้เป็น pattern สำหรับโปรเจคนี้ — ทำตาม structure, tone, style ทุกอย่าง)\n==================================================\n${opts.sampleArticle.slice(0, 6000)}\n\n--- END OF EXAMPLE ---\n`
    : ''

  const ctaBlock = buildCtaBlock(opts.cta)

  if (globalRules && masterPrompt && validator) {
    return `${globalRules}

${masterPrompt}

${siteBlock}
${ctaBlock}
${sampleBlock}
==================================================
VALIDATOR
==================================================
${validator}

---
OUTPUT: ส่ง HTML ชุดเดียวเท่านั้น ไม่มีคำอธิบาย ไม่มี Markdown ไม่มี diagnostic text
เริ่มด้วย <!-- CONVERT_CAKE_SEO_META หรือ <script type="application/ld+json"> หรือ <style>
`
  }

  // Fallback
  return `คุณคือ SEO Content Writer ผู้เชี่ยวชาญ เขียนบทความ HTML คุณภาพสูง

${siteBlock}
${ctaBlock}
${sampleBlock}
สิ่งที่ต้องมีในบทความ:
- <!-- CONVERT_CAKE_SEO_META ... --> block พร้อม cover_headline, cover_subtitle, benefit_1-4, highlight_text, cover_image_prompt, mid_image_prompt
- JSON-LD schema: Article, FAQPage, BreadcrumbList
- H1 เพียง 1 จุด
- Short Answer 2-3 บรรทัด
- TOC
- H2/H3 ตาม search intent
- ตาราง หรือ Checklist
- FAQ (details/summary)
- CTA
- <!-- COVER_IMAGE --> และ <!-- MID_IMAGE --> comment marks

ก่อน output: Auto Validate และแก้ให้ผ่านก่อน
OUTPUT: HTML เท่านั้น ไม่มีคำอธิบาย
`
}


// Call Gemini image generation directly (no internal HTTP — bypasses auth middleware)
async function generateGeminiImage(params: {
  keyword: string; title: string; type: 'cover' | 'mid'
  siteName?: string; brandTone?: string; accentColor?: string
}): Promise<{ imageBase64: string; mimeType: string; costUsd: number; totalTokens: number }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await callGeminiImage({
        keyword: params.keyword, title: params.title, type: params.type,
        siteName: params.siteName ?? '', brandTone: params.brandTone ?? '',
        accentColor: params.accentColor ?? '',
      })
      if (!result.imageBase64) {
        console.error(`[write] generateGeminiImage ${params.type} returned no image`)
        if (attempt === 0) { await new Promise(r => setTimeout(r, 3000)); continue }
      }
      return { imageBase64: result.imageBase64, mimeType: result.mimeType, costUsd: result.costUsd ?? 0, totalTokens: result.totalTokens ?? 0 }
    } catch (e) {
      console.error(`[write] generateGeminiImage ${params.type} attempt ${attempt + 1} error:`, e)
      if (attempt === 0) await new Promise(r => setTimeout(r, 3000))
    }
  }
  return { imageBase64: '', mimeType: 'image/webp', costUsd: 0, totalTokens: 0 }
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Inject mid-article image into the middle of the HTML body (never at the end)
function injectMidImage(html: string, imageBase64: string, mimeType: string): string {
  if (!imageBase64) return html

  const imgTag = `\n<figure style="margin:2.5rem 0;text-align:center;">
  <img src="data:${mimeType};base64,${imageBase64}"
       alt="รูปประกอบบทความ"
       style="width:100%;max-width:800px;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.10);display:inline-block;" />
</figure>\n`

  // 1. If Claude left a <!-- MID_IMAGE --> marker, replace it
  if (html.includes('<!-- MID_IMAGE -->')) {
    return html.replace('<!-- MID_IMAGE -->', imgTag)
  }

  // 2. Find the midpoint by counting <h2> tags — inject after the 2nd <h2>
  const h2matches = Array.from(html.matchAll(/<h2[\s>]/gi))
  if (h2matches.length >= 2) {
    const insertAt = h2matches[1].index! + h2matches[1][0].length
    // Find the end of the paragraph/section after this H2
    const afterH2 = html.indexOf('</p>', insertAt)
    if (afterH2 !== -1 && afterH2 - insertAt < 1500) {
      return html.slice(0, afterH2 + 4) + imgTag + html.slice(afterH2 + 4)
    }
  }

  // 3. Fallback: inject at 40–50% of content length (never at the end)
  const safeEnd = Math.floor(html.length * 0.55)
  const safeStart = Math.floor(html.length * 0.35)
  // Find a </p> tag near the midpoint
  const midIdx = Math.floor((safeStart + safeEnd) / 2)
  const pEnd = html.lastIndexOf('</p>', midIdx)
  if (pEnd > safeStart) {
    return html.slice(0, pEnd + 4) + imgTag + html.slice(pEnd + 4)
  }

  // 4. Last resort: insert before the last 3 block elements
  const lastH2 = html.lastIndexOf('<h2')
  if (lastH2 > 0) {
    // find </p> or </ul> before last H2
    const beforeLast = html.lastIndexOf('</p>', lastH2)
    if (beforeLast > 0) {
      return html.slice(0, beforeLast + 4) + imgTag + html.slice(beforeLast + 4)
    }
  }

  return html
}

function extractEnSlugFromHtml(html: string): string {
  const blockMatch = html.match(/<!--\s*CONVERT_CAKE_SEO_META([\s\S]*?)-->/i)
  const block = blockMatch?.[1] ?? ''
  const m = block.match(/en_slug\s*[:=]\s*([^\n]+)/i)
  let slug = m?.[1]?.trim().replace(/^["']|["']$/g, '') ?? ''
  return slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80)
}

function extractMetaDescFromHtml(html: string): string {
  const blockMatch = html.match(/<!--\s*CONVERT_CAKE_SEO_META([\s\S]*?)-->/i)
  const block = blockMatch?.[1] ?? ''
  const m = block.match(/meta_description\s*[:=]\s*([^\n]+)/i)
  if (m?.[1]) return m[1].trim().replace(/^["']|["']$/g, '').slice(0, 160)
  const tag = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i)
           ?? html.match(/<meta\s+content=["']([^"']+)["']\s+name=["']description["']/i)
  return tag?.[1]?.trim().slice(0, 160) ?? ''
}

async function saveArticleHtml(opts: {
  orgId: string; userId: string; projectId: string; keyword: string; title: string; html: string; keywordId?: string
}) {
  if (!opts.projectId || !opts.html) return
  try {
    const enSlug      = extractEnSlugFromHtml(opts.html)
    const metaDesc    = extractMetaDescFromHtml(opts.html)
    const existing = await prisma.article.findFirst({
      where: { projectId: opts.projectId, title: opts.title, project: { organizationId: opts.orgId } },
      select: { id: true },
    })
    // Always have a non-empty slug (DB requires NOT NULL)
    const safeSlug = enSlug || `article-${Date.now()}`
    if (existing) {
      await prisma.article.update({
        where: { id: existing.id },
        data: {
          htmlContent: opts.html,
          status: 'REVIEW',
          ...(enSlug   && { slug: enSlug }),
          ...(metaDesc && { metaDescription: metaDesc }),
          ...(opts.keywordId && { keywordId: opts.keywordId }),
        },
      })
    } else {
      await prisma.article.create({
        data: {
          projectId:   opts.projectId,
          title:       opts.title,
          slug:        safeSlug,
          htmlContent: opts.html,
          status:      'REVIEW',
          createdById: opts.userId,
          ...(metaDesc && { metaDescription: metaDesc }),
          ...(opts.keywordId && { keywordId: opts.keywordId }),
        },
      })
    }
  } catch (e) { console.log('[saveArticleHtml] error:', e) }
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  const orgId  = session?.user?.organizationId ?? ''
  const userId = session?.user?.id ?? ''

  const body = await req.json()
  const {
    keyword, title,
    contentType = 'seo_article',
    styleGuide = '',
    internalLinks: rawInternalLinks = '',
    linksPerArticle: linksPerArticleBody = null,
    forbiddenWords: rawForbiddenWords = '',
    websiteUrl = '',
    siteName = '',
    brandTone = '',
    language = 'th',
    accentColor = '#2563eb',
    theme = 'professional',
    colorTheme = '',
    colorText = '',
    colorBorder = '',
    colorAccent = '',
    typography = null,
    sampleArticle = '',
    stream: doStream = false,
    projectId = '',
    articleId = '',
    keywordId = '',
    adjustNote = '',
    cta: ctaFromBody = null,
  } = body

  // Resolve CTA + author + project prompt overrides from DB
  // studio overrides (studioPrompt) take priority over per-client writing overrides for studio keys
  let cta = ctaFromBody
  let resolvedAuthorName = ''
  let resolvedAuthorTitle = ''
  let resolvedAuthorImage = ''
  let resolvedAuthorGender: string = 'none'
  let projectPromptOverrides: Record<string, string> = {}
  let _dbProj: Record<string, unknown> | null = null
  if (projectId && orgId) {
    try {
      const proj = await (prisma.project as any).findFirst({
        where: { id: projectId, organizationId: orgId },
        select: { ctaSetting: true, writingPrompt: true, authorEnabled: true, authorName: true, authorTitle: true, authorImage: true, authors: true, styleGuide: true, internalLinks: true, linksPerArticle: true },
      })
      if (!cta && proj?.ctaSetting) {
        const parsed = JSON.parse(proj.ctaSetting)
        if (parsed?.enabled) cta = parsed
      }
      if (proj?.authorEnabled) {
        // Try assignedAuthorId from article first, fallback to first author, fallback to legacy fields
        let pickedAuthor: { name: string; title: string; image: string; gender: string } | null = null
        if (articleId) {
          try {
            const art = await (prisma.article as any).findUnique({ where: { id: articleId }, select: { assignedAuthorId: true } })
            if (art?.assignedAuthorId && proj?.authors) {
              const authorsList = JSON.parse(proj.authors || '[]')
              pickedAuthor = authorsList.find((a: { id: string }) => a.id === art.assignedAuthorId) ?? null
            }
          } catch { /* non-fatal */ }
        }
        if (!pickedAuthor && proj?.authors) {
          const authorsList = JSON.parse(proj.authors || '[]')
          if (authorsList.length > 0) pickedAuthor = authorsList[0]
        }
        if (pickedAuthor) {
          resolvedAuthorName = pickedAuthor.name ?? ''
          resolvedAuthorTitle = pickedAuthor.title ?? ''
          resolvedAuthorImage = pickedAuthor.image ?? ''
          resolvedAuthorGender = pickedAuthor.gender ?? 'none'
        } else {
          resolvedAuthorName = proj?.authorName ?? ''
          resolvedAuthorTitle = proj?.authorTitle ?? ''
          resolvedAuthorImage = proj?.authorImage ?? ''
        }
      }
      if (proj?.writingPrompt) {
        projectPromptOverrides = JSON.parse(proj.writingPrompt)
      }
      _dbProj = proj ?? null
    } catch { /* non-fatal */ }
    // Studio overrides from org take priority for studio-specific keys
    try {
      const org = await (prisma.organization as any).findUnique({
        where: { id: orgId },
        select: { studioPrompt: true },
      })
      if (org?.studioPrompt) {
        const studioOverrides: Record<string, string> = JSON.parse(org.studioPrompt)
        projectPromptOverrides = { ...projectPromptOverrides, ...studioOverrides }
      }
    } catch { /* non-fatal */ }
  }

  // Resolve styleGuide from DB if not provided in body
  let resolvedStyleGuide = styleGuide
  // Resolve internalLinks + linksPerArticle from DB
  let resolvedLinksPerArticleRaw: string = linksPerArticleBody != null ? String(linksPerArticleBody) : '3'
  let resolvedRawInternalLinks = rawInternalLinks
  if (_dbProj) {
    const dbP = _dbProj as { styleGuide?: string | null; internalLinks?: string | null; linksPerArticle?: number | string | null }
    if (!resolvedStyleGuide && dbP?.styleGuide) resolvedStyleGuide = dbP.styleGuide
    if (!rawInternalLinks || rawInternalLinks === '[]') resolvedRawInternalLinks = dbP?.internalLinks ?? '[]'
    if (linksPerArticleBody == null && dbP?.linksPerArticle != null) resolvedLinksPerArticleRaw = String(dbP.linksPerArticle)
  }
  // Parse "3" or "3-10" range into min/max, pick a count deterministically
  function parseLinksRange(raw: string): { min: number; max: number } {
    const m = raw.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/)
    if (!m) return { min: 3, max: 3 }
    const a = parseInt(m[1]); const b = m[2] ? parseInt(m[2]) : a
    return { min: Math.min(a, b), max: Math.max(a, b) }
  }
  const { min: lpaMin, max: lpaMax } = parseLinksRange(resolvedLinksPerArticleRaw)
  const resolvedLinksPerArticle = lpaMax === lpaMin ? lpaMin : lpaMin + (Math.abs(keyword.charCodeAt(0) ?? 0) % (lpaMax - lpaMin + 1))
  const lpaDisplay = lpaMax === lpaMin ? String(lpaMin) : `${lpaMin}-${lpaMax}`

  // Parse internalLinks JSON array → readable lines (sample linksPerArticle from list)
  let internalLinks = ''
  try {
    const parsed = typeof resolvedRawInternalLinks === 'string' ? JSON.parse(resolvedRawInternalLinks || '[]') : resolvedRawInternalLinks
    if (Array.isArray(parsed) && parsed.length > 0) {
      const clean = parsed.filter((l: { keyword: string; url: string }) => l.url?.trim())
      const sampled = clean.length <= resolvedLinksPerArticle ? clean : shuffleSeed(clean, keyword).slice(0, resolvedLinksPerArticle)
      internalLinks = `ใส่ internal link ประมาณ ${lpaDisplay} links จากรายการต่อไปนี้ (เลือก links ที่เกี่ยวข้องกับเนื้อหาที่กำลังเขียนมากที่สุด):\n`
        + sampled.map((l: { keyword: string; url: string }) => `- anchor: "${l.keyword}" → url: ${l.url}`).join('\n')
    }
  } catch { internalLinks = resolvedRawInternalLinks }

  // Parse forbiddenWords JSON array → readable list
  let forbiddenWords = ''
  try {
    const parsed = typeof rawForbiddenWords === 'string' ? JSON.parse(rawForbiddenWords || '[]') : rawForbiddenWords
    if (Array.isArray(parsed)) forbiddenWords = parsed.join(', ')
    else forbiddenWords = rawForbiddenWords
  } catch { forbiddenWords = rawForbiddenWords }

  if (!keyword || !title) {
    return NextResponse.json({ error: 'keyword and title are required' }, { status: 400 })
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  let articlePrompt = buildArticlePrompt({
    keyword, title, language, styleGuide: resolvedStyleGuide, accentColor, theme,
    colorTheme, colorText, colorBorder, colorAccent, typography,
    internalLinks, forbiddenWords, websiteUrl, siteName, brandTone, contentType, sampleArticle,
    cta,
    promptOverrides: projectPromptOverrides,
  })

  // Inject author persona into prompt so writing tone/pronouns match
  if (resolvedAuthorName || resolvedAuthorTitle) {
    const genderInstruction = resolvedAuthorGender === 'male'
      ? 'ใช้สรรพนาม "ผม" และลงท้ายด้วย "ครับ" ให้เหมาะกับเพศชาย'
      : resolvedAuthorGender === 'female'
      ? 'ใช้สรรพนาม "ฉัน/ดิฉัน" และลงท้ายด้วย "ค่ะ/คะ" ให้เหมาะกับเพศหญิง'
      : 'ใช้ภาษากลาง ไม่เน้นสรรพนามเพศ'
    articlePrompt += `\n\n==================================================\nAUTHOR PERSONA (เขียนในนามผู้เขียนนี้ — ปรับโทนภาษาให้สอดคล้อง)\n==================================================\nชื่อผู้เขียน: ${resolvedAuthorName}\nตำแหน่ง/ความเชี่ยวชาญ: ${resolvedAuthorTitle || 'ผู้เชี่ยวชาญ'}\nเพศ: ${resolvedAuthorGender === 'male' ? 'ชาย' : resolvedAuthorGender === 'female' ? 'หญิง' : 'ไม่ระบุ'}\n\nกฎการใช้ภาษา: ${genderInstruction}\nเขียนให้สะท้อนความเชี่ยวชาญและบุคลิกของผู้เขียน ใช้มุมมองจากประสบการณ์จริงของ ${resolvedAuthorTitle || 'ผู้เชี่ยวชาญ'} ชื่อ ${resolvedAuthorName}\n`
  }

  if (adjustNote?.trim()) {
    articlePrompt += `\n\n==================================================\nADJUST INSTRUCTION (บทความถูกส่ง Adjust — เขียนใหม่ตาม instruction นี้)\n==================================================\n${adjustNote.trim()}\n\nให้เขียนบทความใหม่ทั้งหมด โดยแก้ไขตาม Adjust instruction ด้านบนอย่างเคร่งครัด\n`
  }

  const model = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8'

  if (!doStream) {
    const msg = await client.messages.create({
      model, max_tokens: 20000,
      messages: [{ role: 'user', content: articlePrompt }],
    })
    let html = msg.content.filter(b => b.type === 'text').map(b => (b as { type: 'text'; text: string }).text).join('')
    html = html.trim().replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim()

    if (orgId && userId) {
      await logAIJob({ orgId, userId, projectId: projectId || undefined, articleId: articleId || undefined,
        jobType: 'ARTICLE_WRITE', modelName: model,
        inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, status: 'COMPLETED' })
    }

    const [coverResult, midResult] = await Promise.all([
      generateGeminiImage({ keyword, title, type: 'cover', siteName, brandTone, accentColor }),
      generateGeminiImage({ keyword, title, type: 'mid', siteName, brandTone, accentColor }),
    ])

    // Log Gemini image costs
    if (orgId && userId) {
      const geminiModel = process.env.VERTEX_GEMINI_IMAGE_MODEL || process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image'
      if (coverResult.totalTokens || coverResult.costUsd) {
        await prisma.aIJob.create({ data: {
          organizationId: orgId, createdById: userId,
          projectId: projectId ?? null, articleId: articleId ?? null,
          jobType: 'IMAGE_COVER', status: 'SUCCESS',
          modelProvider: 'GEMINI', modelName: geminiModel,
          tokenUsed: coverResult.totalTokens, estimatedCost: coverResult.costUsd,
        }}).catch(() => {})
      }
      if (midResult.totalTokens || midResult.costUsd) {
        await prisma.aIJob.create({ data: {
          organizationId: orgId, createdById: userId,
          projectId: projectId ?? null, articleId: articleId ?? null,
          jobType: 'IMAGE_MID', status: 'SUCCESS',
          modelProvider: 'GEMINI', modelName: geminiModel,
          tokenUsed: midResult.totalTokens, estimatedCost: midResult.costUsd,
        }}).catch(() => {})
      }
    }

    // Inject mid image into the middle of the article HTML (never at the end)
    if (midResult.imageBase64) {
      html = injectMidImage(html, midResult.imageBase64, midResult.mimeType)
    }

    // Append author box at the very end
    const authorHtml = buildAuthorHtml(resolvedAuthorName, resolvedAuthorTitle, resolvedAuthorImage)
    if (authorHtml) html = html + authorHtml

    await saveArticleHtml({ orgId, userId, projectId, keyword, title, html, keywordId: keywordId || undefined })

    return NextResponse.json({
      html, keyword, title,
      coverImage: coverResult.imageBase64, coverMimeType: coverResult.mimeType,
      midImage: midResult.imageBase64, midMimeType: midResult.mimeType,
    })
  }

  // ── SSE Streaming Pipeline ────────────────────────────────────────────────────
  const encoder = new TextEncoder()
  const transform = new TransformStream()
  const writer = transform.writable.getWriter()
  const send = (data: object) => writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))

  // Mark article as WRITING in DB immediately so client can poll status after tab switch
  if (orgId && projectId) {
    prisma.article.findFirst({
      where: { projectId, title, project: { organizationId: orgId } },
      select: { id: true },
    }).then(existing => {
      if (existing) {
        prisma.article.update({ where: { id: existing.id }, data: { status: 'WRITING' } }).catch(() => {})
      } else {
        prisma.article.create({
          data: {
            projectId, title,
            slug: keyword.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60),
            htmlContent: '', status: 'WRITING', createdById: userId,
            ...(keywordId ? { keywordId } : {}),
          },
        }).catch(() => {})
      }
    }).catch(() => {})
  }

  ;(async () => {
    let fullHtml = ''
    try {
      // Step 1: Write article (streaming)
      send({ type: 'status', step: 'writing', message: '✍️ Claude กำลังเขียนบทความ...' })
      const s = client.messages.stream({ model, max_tokens: 20000, messages: [{ role: 'user', content: articlePrompt }] })
      for await (const chunk of s) {
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          fullHtml += chunk.delta.text
          send({ type: 'chunk', content: chunk.delta.text })
        }
      }
      fullHtml = fullHtml.trim().replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim()

      // Log article write job
      const finalMsg = await s.finalMessage()
      if (orgId && userId) {
        await logAIJob({ orgId, userId, projectId: projectId || undefined, articleId: articleId || undefined,
          jobType: 'ARTICLE_WRITE', modelName: model,
          inputTokens: finalMsg.usage.input_tokens, outputTokens: finalMsg.usage.output_tokens, status: 'COMPLETED' })
        // Activity log for tracking
        try {
          await prisma.activityLog.create({
            data: {
              organizationId: orgId, userId,
              action: 'ARTICLE_WRITE',
              entityType: 'Article',
              entityId: projectId || 'unknown',
              newValue: JSON.stringify({ keyword, title, model, tokens: finalMsg.usage.input_tokens + finalMsg.usage.output_tokens }),
            },
          })
        } catch { /* non-fatal */ }
      }

      // Step 2: Generate cover + mid images via Gemini in parallel
      send({ type: 'status', step: 'cover', message: '🖼️ Gemini กำลังสร้างรูปปกและรูปประกอบ...' })
      const [coverResult, midResult] = await Promise.all([
        generateGeminiImage({ keyword, title, type: 'cover', siteName, brandTone, accentColor }),
        generateGeminiImage({ keyword, title, type: 'mid', siteName, brandTone, accentColor }),
      ])
      if (!coverResult.imageBase64) send({ type: 'status', step: 'cover', message: '⚠️ สร้างรูปปกไม่สำเร็จ (Gemini quota หรือ key หมด) — บทความยังใช้ได้' })
      if (!midResult.imageBase64) send({ type: 'status', step: 'cover', message: '⚠️ สร้างรูปประกอบไม่สำเร็จ — ดำเนินการต่อโดยไม่มีรูปประกอบ' })

      // Log Gemini image costs (streaming path)
      if (orgId && userId) {
        const geminiModel = process.env.VERTEX_GEMINI_IMAGE_MODEL || process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image'
        if (coverResult.totalTokens || coverResult.costUsd) {
          prisma.aIJob.create({ data: {
            organizationId: orgId, createdById: userId,
            projectId: projectId ?? null, articleId: articleId ?? null,
            jobType: 'IMAGE_COVER', status: 'SUCCESS',
            modelProvider: 'GEMINI', modelName: geminiModel,
            tokenUsed: coverResult.totalTokens, estimatedCost: coverResult.costUsd,
          }}).catch(() => {})
        }
        if (midResult.totalTokens || midResult.costUsd) {
          prisma.aIJob.create({ data: {
            organizationId: orgId, createdById: userId,
            projectId: projectId ?? null, articleId: articleId ?? null,
            jobType: 'IMAGE_MID', status: 'SUCCESS',
            modelProvider: 'GEMINI', modelName: geminiModel,
            tokenUsed: midResult.totalTokens, estimatedCost: midResult.costUsd,
          }}).catch(() => {})
        }
      }

      // Inject mid image into the middle of the article HTML (never at the end)
      if (midResult.imageBase64) {
        fullHtml = injectMidImage(fullHtml, midResult.imageBase64, midResult.mimeType)
      }

      // Append author box at the very end
      const authorHtmlBlock = buildAuthorHtml(resolvedAuthorName, resolvedAuthorTitle, resolvedAuthorImage)
      if (authorHtmlBlock) fullHtml = fullHtml + authorHtmlBlock

      await saveArticleHtml({ orgId, userId, projectId, keyword, title, html: fullHtml, keywordId: keywordId || undefined })

      send({ type: 'status', step: 'done', message: '✅ เสร็จสมบูรณ์' })
      send({
        type: 'done', html: fullHtml, keyword, title,
        coverImage: coverResult.imageBase64, coverMimeType: coverResult.mimeType,
        midImage: midResult.imageBase64, midMimeType: midResult.mimeType,
      })

    } catch (e: unknown) {
      send({ type: 'error', error: String(e) })
    } finally {
      writer.close()
    }
  })()

  return new NextResponse(transform.readable, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  })
}
