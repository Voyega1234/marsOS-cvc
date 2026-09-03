import { NextRequest, NextResponse } from 'next/server'
import { orChat, orChatStream, OR_MODELS } from '@/lib/openrouter'
import { clientSlugFromProject } from '@/lib/orClient'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { callGeminiImage } from '@/lib/geminiImage'
import { resolveContentEngine, type CEScope } from '@/lib/content-engine-resolve'
import { type ArticleElementStyles, resolveImagePalette } from '@/lib/articleTheme'
import { MARS_COMPONENT_SPEC, buildArticleCss, wrapArticleHtml, type ArticleStyleMode } from '@/lib/articleComponents'
import { buildAuthorCardHtml, DEFAULT_AUTHOR_CARD_STYLE, normalizeAuthorCardStyle, type AuthorCardStyle } from '@/lib/articleAuthorCard'
import { sanitizeArticleHtml } from '@/lib/articleSanitize'
import { buildArticleSchema, stripSchemaScripts } from '@/lib/articleSchema'

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
        modelProvider: 'OPENROUTER',
        modelName: opts.modelName,
        tokenUsed,
        estimatedCost,
        ...(opts.errorMessage && { errorMessage: opts.errorMessage }),
      },
    })
  } catch { /* non-fatal */ }
}

interface CtaChannel { type: string; label: string; value: string }
interface CtaSettings { enabled: boolean; headline: string; subtext: string; channels: CtaChannel[] }

function buildCtaBlock(cta: CtaSettings | null | undefined): string {
  // ไม่มี CTA ที่ตั้งไว้จริง → สั่งห้ามโมเดลแต่งช่องทางติดต่อเอง (กันก๊อปเบอร์ตัวอย่างจาก COMPONENT STANDARD)
  if (!cta?.enabled || !cta.channels.filter(c => c.value).length) return `
==================================================
CTA — โปรเจกต์นี้ยังไม่ได้ตั้งค่าช่องทางติดต่อ
==================================================
ห้ามใส่กล่อง .content-cta และห้ามใส่เบอร์โทร / LINE / อีเมล / ลิงก์ติดต่อใด ๆ ทั้งสิ้น
(เบอร์ในตัวอย่าง COMPONENT STANDARD เป็นเบอร์สมมติ ห้ามนำมาใช้เด็ดขาด)
`
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

INSTRUCTION: วาง CTA 3 จุด และทุกจุดต้องเขียนข้อความใหม่ให้ตรง pain point ของบทความนั้น (ห้ามใช้ headline/subtext ข้างบนแบบคำต่อคำซ้ำทุกจุด — ใช้เป็นวัตถุดิบ):
1. จุดที่ 1 หลังกล่อง Short Answer: ประโยคชวน 1 บรรทัดพร้อมลิงก์ช่องทางหลัก (ข้อความธรรมดา ไม่ใช่กล่อง)
2. จุดที่ 2 กลางบทความ: .content-cta แบบสั้น (headline + ปุ่มเดียว)
3. จุดที่ 3 ก่อน FAQ: .content-cta เต็ม (headline + subtext + ปุ่มครบทุกช่องทาง)
กติกา: ใช้โครง .content-cta จาก COMPONENT STANDARD เท่านั้น / URL → <a class="content-cta__button" href="..."> / phone → tel: / email → mailto: / ปุ่มแรก content-cta__button ปุ่มถัดไปเพิ่ม content-cta__button--secondary / ห้าม hard sell ห้ามใส่สีหรือ style เอง
`
}

function buildAuthorHtml(
  name: string, title: string, imageBase64: string,
  credentials: string[] = [], style: AuthorCardStyle = DEFAULT_AUTHOR_CARD_STYLE,
): string {
  return buildAuthorCardHtml({ name, title, image: imageBase64, credentials, style })
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
  colorTheme?: string; colorText?: string; colorBorder?: string; colorAccent?: string; colorBackground?: string
  elementStyles?: ArticleElementStyles | null
  typography?: { fontFamily?: string | null; fontSize?: string | null; lineHeight?: string | null; letterSpacing?: string | null; headingFont?: string | null; headingWeight?: string | null; paragraphMargin?: string | null } | null
  internalLinks: string; forbiddenWords: string
  websiteUrl: string; siteName: string; brandTone: string
  contentType: string; sampleArticle?: string
  /** Article Lab > บริบทโปรเจกต์ — ข้อเท็จจริงของธุรกิจที่บทความต้องอ้างอิงให้ถูก */
  projectContext?: string
  cta?: CtaSettings | null
  // Prompt ทั้งหมดมาจาก Content Engine เท่านั้น (เรียงลำดับ 4 layers)
  // ห้ามสร้าง prompt เอง — ดู src/lib/content-engine-resolve.ts
  ce: {
    businessSkill?: string
    masterPrompt: string
    articleBrief?: string
    validatorPack?: string
  }
}) {
  const effectiveThemeColor = opts.colorTheme || opts.accentColor || '#2563eb'
  const effectiveTextColor = opts.colorText || '#1c1c1c'
  const effectiveBorderColor = opts.colorBorder || '#e2e8f0'
  const effectiveAccentColor = opts.colorAccent || opts.accentColor || '#16a34a'
  const effectiveBackgroundColor = opts.colorBackground || '#ffffff'

  // Typography ไม่ส่งเข้า prompt แล้ว — ระบบใส่ให้เองผ่าน buildArticleCss

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

COLOR SYSTEM (ข้อมูลประกอบเท่านั้น — ระบบใส่สีทั้งหมดให้เองผ่าน CSS กลางหลังเขียนเสร็จ
ห้ามใส่ style attribute หรือแท็ก <style> ใด ๆ ในบทความ):
- Theme Color: ${effectiveThemeColor} · Text: ${effectiveTextColor} · Accent: ${effectiveAccentColor}
${MARS_COMPONENT_SPEC}
==================================================
SITE STYLE GUIDE
==================================================
${opts.styleGuide || '(ไม่มี — ใช้ tone และ color จาก SITE CONFIG ด้านบน)'}
${opts.projectContext?.trim() ? `
==================================================
PROJECT CONTEXT (ข้อเท็จจริงของธุรกิจนี้ — ห้ามเขียนขัดกับข้อมูลนี้)
==================================================
${opts.projectContext.trim()}
` : ''}
==================================================
INTERNAL LINKS
==================================================
${opts.internalLinks || '(ไม่มี)'}

==================================================
FORBIDDEN WORDS
==================================================
${opts.forbiddenWords || '(ไม่มี)'}

==================================================
SEO META BLOCK (REQUIRED — ระบบอ่านค่าเหล่านี้ไปใช้จริงตอน publish)
==================================================
ในส่วน CONVERT_CAKE_SEO_META comment block ให้ใส่ครบทั้ง 5 field นี้ (ห้ามขาด):
en_slug: [English URL slug, lowercase, hyphens only, ห้ามมีภาษาไทย เช่น "dental-implant-price-guide"]
meta_title: [SEO title ภาษาไทย ≤60 ตัวอักษร มี keyword หลัก]
meta_description: [meta description ภาษาไทย 120-155 ตัวอักษร สรุปเนื้อหาบทความ]
focus_keyword: ${opts.keyword}
cover_image_alt: [alt text ภาษาไทยของภาพหน้าปก ≤100 ตัวอักษร]

ห้ามใส่ field อื่นนอกเหนือจากนี้ในบล็อก META — prompt ของภาพมาจาก Content Engine
(Image Prompt) ไม่ได้มาจากบทความ
`

  const sampleBlock = opts.sampleArticle
    ? `\n==================================================\nEXAMPLE ARTICLE (ใช้เป็น pattern สำหรับโปรเจคนี้ — ทำตาม structure, tone, style ทุกอย่าง)\n==================================================\n${opts.sampleArticle.slice(0, 6000)}\n\n--- END OF EXAMPLE ---\n`
    : ''

  const ctaBlock = buildCtaBlock(opts.cta)

  // ── ประกอบตามลำดับ Content Engine: Business Skill → Master Prompt →
  //    Article Brief → (ข้อมูลโปรเจกต์/CTA/ตัวอย่าง) → Validator Pack ──
  const businessSkillBlock = opts.ce.businessSkill
    ? `==================================================
LAYER 1: BUSINESS SKILL (ความรู้เฉพาะของลูกค้ารายนี้ — ยึดเป็นข้อเท็จจริง ห้ามแต่งเพิ่ม)
==================================================
${opts.ce.businessSkill}
`
    : ''

  const articleBriefBlock = opts.ce.articleBrief
    ? `==================================================
LAYER 3: ARTICLE BRIEF TEMPLATE (โครง brief ของบทความ)
==================================================
${opts.ce.articleBrief}
`
    : ''

  const validatorBlock = opts.ce.validatorPack
    ? `==================================================
LAYER 4: VALIDATOR PACK (ตรวจก่อนส่งงาน — ข้อ BLOCKING ไม่ผ่านห้าม output)
==================================================
${opts.ce.validatorPack}
`
    : ''

  return `${businessSkillBlock}
==================================================
LAYER 2: MASTER PROMPT
==================================================
${opts.ce.masterPrompt}

${articleBriefBlock}
${siteBlock}
${ctaBlock}
${sampleBlock}
${validatorBlock}
---
OUTPUT: ส่ง HTML ชุดเดียวเท่านั้น ไม่มีคำอธิบาย ไม่มี Markdown ไม่มี diagnostic text
เริ่มด้วย <!-- CONVERT_CAKE_SEO_META หรือ <script type="application/ld+json">
ห้ามมีแท็ก <style> และห้ามมี style attribute ในทุก element
`
}


// Call Gemini image generation directly (no internal HTTP — bypasses auth middleware)
// กันขั้นตอนสร้างรูปแขวนไม่จบ — ถ้าเกิน timeout ให้ทิ้งรูปแล้วไปต่อ
// (เดิมไม่มี timeout: Vertex ค้าง → stream ค้าง → โดน maxDuration ฆ่า → บทความค้างสถานะ WRITING)
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms)),
  ])
}

const IMAGE_TIMEOUT_MS = 75_000

async function generateGeminiImage(params: {
  keyword: string; title: string; type: 'cover' | 'mid'
  client?: string
  siteName?: string; brandTone?: string; accentColor?: string
  themeColor?: string; backgroundColor?: string; textColor?: string
  imagePromptTemplate: string
  imageStyleGuide?: string
  coverSubtitle?: string
  coverBullets?: string[]
}): Promise<{ imageBase64: string; mimeType: string; costUsd: number; totalTokens: number }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await withTimeout(callGeminiImage({
        client: params.client,
        keyword: params.keyword, title: params.title, type: params.type,
        siteName: params.siteName ?? '', brandTone: params.brandTone ?? '',
        accentColor: params.accentColor ?? '',
        themeColor: params.themeColor ?? '', backgroundColor: params.backgroundColor ?? '', textColor: params.textColor ?? '',
        promptTemplate: params.imagePromptTemplate,
        imageStyleGuide: params.imageStyleGuide ?? '',
        coverSubtitle: params.coverSubtitle ?? '',
        coverBullets: params.coverBullets ?? [],
      }), IMAGE_TIMEOUT_MS, `gemini-image-${params.type}`)
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

// AI ทั้งระบบวิ่งผ่าน OpenRouter — ตัวเขียนบทความใช้ OPENROUTER_MODEL_WRITER (gpt-5.6-sol)

// ── ข้อมูลจริงจากบทความสำหรับวางบนปก (overlay ฟอนต์จริง — ดู coverOverlay.ts) ──────
// bullet = หัวข้อ H2 จริง (ข้าม FAQ/สรุป) · คำโปรย = meta_description ที่ writer สร้าง
// ใช้ของจริงเท่านั้น ไม่ให้ AI แต่งคำใหม่ — ข้อความบนปกจึงตรงกับเนื้อหาเสมอ
function extractCoverExtras(html: string): { subtitle: string; bullets: string[] } {
  const stripTags = (t: string) => t.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim()
  const bullets: string[] = []
  for (const m of Array.from(html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi))) {
    const t = stripTags(m[1])
    if (!t) continue
    if (/คำถามที่พบบ่อย|FAQ|สรุป|บทส่งท้าย/i.test(t)) continue
    bullets.push(t)
    if (bullets.length >= 3) break
  }
  const metaBlock = html.match(/<!--\s*CONVERT_CAKE_SEO_META([\s\S]*?)-->/i)?.[1] ?? ''
  const subtitle = metaBlock.match(/meta_description\s*[:=]\s*([^\n]+)/i)?.[1]?.trim() ?? ''
  return { subtitle, bullets }
}

// ── จำนวนรูปประกอบกลางบทความ — ตั้งใน Image Prompt layer ด้วยบรรทัด "จำนวนรูปประกอบ: N" ──
//  default 1 (พฤติกรรมเดิม), เลือกได้ 1-7 · บรรทัด directive ถูกตัดออกก่อนส่งเป็น brief ให้ตัววาดภาพ
const MID_IMAGE_DIRECTIVE = /^\s*จำนวนรูปประกอบ\s*[:：]\s*(\d+)\s*$/m

function parseMidImageCount(imagePromptTemplate: string): { count: number; cleanTemplate: string } {
  const m = imagePromptTemplate.match(MID_IMAGE_DIRECTIVE)
  if (!m) return { count: 1, cleanTemplate: imagePromptTemplate }
  const count = Math.min(7, Math.max(1, parseInt(m[1], 10) || 1))
  return { count, cleanTemplate: imagePromptTemplate.replace(MID_IMAGE_DIRECTIVE, '').trim() }
}

// นับจุดแทรกรูปที่มีจริงในบทความ (ท้ายย่อหน้าแรกใต้ H2, เลี่ยงหัวท้ายสุด)
// ใช้ cap จำนวนรูปก่อน generate — จะได้ไม่เสียค่ารูปที่ไม่มีที่ลง
function countMidImageSpots(html: string): number {
  const h2s = Array.from(html.matchAll(/<h2[\s>]/gi))
  let spots = 0
  for (const h of h2s) {
    const pEnd = html.indexOf('</p>', h.index!)
    if (pEnd !== -1 && pEnd - h.index! < 2000) spots++
  }
  return Math.max(1, spots - 1) // กันจุดท้ายสุด (FAQ/สรุป)
}

// กระจายรูปประกอบหลายรูปตามหัวข้อ H2 แบบเฉลี่ยระยะ (1 รูป = ตำแหน่งกลางแบบเดิม)
function injectMidImages(html: string, images: Array<{ imageBase64: string; mimeType: string }>, altText = ''): string {
  const usable = images.filter(im => im.imageBase64)
  if (!usable.length) return html
  if (usable.length === 1) return injectMidImage(html, usable[0].imageBase64, usable[0].mimeType, altText)

  const alt = (altText.trim() || 'รูปประกอบบทความ').replace(/"/g, '&quot;')
  const tag = (im: { imageBase64: string; mimeType: string }) =>
    `\n<figure class="content-figure">\n  <img src="data:${im.mimeType};base64,${im.imageBase64}" alt="${alt}" />\n</figure>\n`

  // จุดแทรก = ท้ายย่อหน้าแรกใต้ H2 ที่เลือกแบบเฉลี่ยระยะ (ข้าม H2 แรกกับ H2 ท้ายสุด เช่น FAQ/สรุป)
  const h2s = Array.from(html.matchAll(/<h2[\s>]/gi))
  const candidates: number[] = []
  for (const h of h2s) {
    const pEnd = html.indexOf('</p>', h.index! )
    if (pEnd !== -1 && pEnd - h.index! < 2000) candidates.push(pEnd + 4)
  }
  if (candidates.length < 2) {
    // โครงหัวข้อน้อยเกิน — ถอยไปวางแบบรูปเดียวตามลำดับ
    let out = html
    for (const im of usable) out = injectMidImage(out, im.imageBase64, im.mimeType, altText)
    return out
  }
  const usableSpots = candidates.slice(0, Math.max(2, candidates.length - 1)) // เลี่ยงท้ายบทความ
  const picks: number[] = []
  for (let i = 0; i < usable.length; i++) {
    const idx = Math.min(usableSpots.length - 1, Math.round(((i + 1) * usableSpots.length) / (usable.length + 1)))
    if (!picks.includes(usableSpots[idx])) picks.push(usableSpots[idx])
  }
  // แทรกจากท้ายไปหน้า กัน offset เลื่อน
  let out = html
  const ordered = picks.sort((a, b) => b - a)
  const imgs = [...usable].reverse()
  ordered.forEach((pos, i) => {
    const im = imgs[i % imgs.length]
    out = out.slice(0, pos) + tag(im) + out.slice(pos)
  })
  return out
}


// Inject mid-article image into the middle of the HTML body (never at the end)
function injectMidImage(html: string, imageBase64: string, mimeType: string, altText = ''): string {
  if (!imageBase64) return html

  // alt ต้องบรรยายภาพจริง ไม่ใช่คำกลาง ๆ — Validator ข้อ Image Alt Text ตรวจจุดนี้
  const alt = (altText.trim() || 'รูปประกอบบทความ').replace(/"/g, '&quot;')

  const imgTag = `\n<figure class="content-figure">
  <img src="data:${mimeType};base64,${imageBase64}" alt="${alt}" />
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
    colorBackground = '',
    elementStyles: elementStylesBody = null,
    typography = null,
    sampleArticle = '',
    stream: doStream = false,
    projectId = '',
    articleId = '',
    keywordId = '',
    adjustNote = '',
    cta: ctaFromBody = null,
  } = body

  // ดึง CTA + ผู้เขียน + ค่า Article Lab ของโปรเจกต์จาก DB
  let cta = ctaFromBody
  let resolvedAuthorName = ''
  let resolvedAuthorTitle = ''
  let resolvedAuthorImage = ''
  let resolvedAuthorGender: string = 'none'
  let resolvedAuthorCredentials: string[] = []
  // สไตล์การ์ดผู้เขียน — ไม่ได้ตั้งใน Article Lab = ค่า default ของระบบ
  let resolvedAuthorCardStyle: AuthorCardStyle = DEFAULT_AUTHOR_CARD_STYLE
  let _dbProj: Record<string, unknown> | null = null
  if (projectId && orgId) {
    try {
      const proj = await (prisma.project as any).findFirst({
        where: { id: projectId, organizationId: orgId },
        // ค่าจาก Article Lab ทั้งหมดที่ prompt ใช้ — ดึงมาเป็น fallback ให้ผู้เรียกที่ส่งมาแค่ projectId
        // (writingPrompt ไม่ได้ select เพราะเลิกใช้แล้ว — prompt มาจาก Content Engine เท่านั้น)
        select: {
          ctaSetting: true, authorEnabled: true, authorName: true, authorTitle: true, authorImage: true, authors: true,
          styleGuide: true, internalLinks: true, linksPerArticle: true,
          forbiddenWords: true, sampleArticle: true, projectContext: true,
          brandTone: true, website: true, name: true, clientName: true, imageStyleGuide: true,
        themeColors: true, accentColor: true, articleTheme: true, businessType: true,
        },
      })
      if (!cta && proj?.ctaSetting) {
        const parsed = JSON.parse(proj.ctaSetting)
        if (parsed?.enabled) cta = parsed
      }
      if (proj?.authorEnabled) {
        // Try assignedAuthorId from article first, fallback to first author, fallback to legacy fields
        let pickedAuthor: { name: string; title: string; image: string; gender: string; credentials?: string[] } | null = null
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
          resolvedAuthorCredentials = Array.isArray(pickedAuthor.credentials) ? pickedAuthor.credentials : []
        } else {
          resolvedAuthorName = proj?.authorName ?? ''
          resolvedAuthorTitle = proj?.authorTitle ?? ''
          resolvedAuthorImage = proj?.authorImage ?? ''
        }
      }
      _dbProj = proj ?? null
    } catch { /* non-fatal */ }
  }
  // SOP §3: ป้ายกำกับทุก call ของ request นี้เป็น mars_<client>_<action>
  const orClient = clientSlugFromProject({
    id: projectId || null,
    name: (_dbProj as { name?: string | null } | null)?.name ?? null,
    clientName: (_dbProj as { clientName?: string | null } | null)?.clientName ?? null,
  })
  // หน้า Settings > Prompts ถูกลบทิ้งแล้ว (2026-08-10) พร้อม override จาก
  // project.writingPrompt / org.studioPrompt — prompt มาจาก Content Engine เท่านั้น
  // ส่วนค่าเฉพาะโปรเจกต์ (style, forbidden words, บริบท ฯลฯ) มาจาก Article Lab

  // ค่าจาก Article Lab: body ชนะ DB เสมอ (ผู้เรียกอาจ override รายครั้ง)
  // แต่ถ้า body ไม่ส่งมา ต้องดึงจาก DB ไม่ใช่ปล่อยว่าง — ไม่งั้นค่าที่ทีมตั้งไว้ถูกทิ้งเงียบ ๆ
  let resolvedStyleGuide = styleGuide
  let resolvedLinksPerArticleRaw: string = linksPerArticleBody != null ? String(linksPerArticleBody) : '3'
  let resolvedRawInternalLinks = rawInternalLinks
  let resolvedForbiddenWordsRaw = rawForbiddenWords
  let resolvedSampleArticle = sampleArticle
  let resolvedProjectContext = ''
  let resolvedBrandTone = brandTone
  let resolvedWebsiteUrl = websiteUrl
  let resolvedSiteName = siteName
  let resolvedImageStyleGuide = ''
  // ชุดสีของ client (Article Lab > Article Colors) — ตั้งครั้งเดียวใช้กับทุกบทความของเว็บนั้น
  let resolvedColorTheme = colorTheme
  let resolvedColorText = colorText
  let resolvedColorBorder = colorBorder
  let resolvedColorAccent = colorAccent
  let resolvedColorBackground = colorBackground
  let resolvedAccentColor = accentColor
  let resolvedTheme = theme
  let resolvedElementStyles: ArticleElementStyles | null = elementStylesBody
  // โหมดสไตล์ของ client: 'embed' = แนบ <style> ในบทความ (default) / 'clean' = HTML ล้วน
  let resolvedStyleMode: ArticleStyleMode = 'embed'
  if (_dbProj) {
    const dbP = _dbProj as {
      styleGuide?: string | null; internalLinks?: string | null; linksPerArticle?: number | string | null
      forbiddenWords?: string | null; sampleArticle?: string | null; projectContext?: string | null
      brandTone?: string | null; website?: string | null; name?: string | null; clientName?: string | null
      imageStyleGuide?: string | null; themeColors?: string | null; accentColor?: string | null; articleTheme?: string | null
    }
    let projColors: Record<string, string> = {}
    try { projColors = JSON.parse(dbP?.themeColors || '{}') } catch { /* ค่าเสีย — ใช้ default */ }
    if (!resolvedColorTheme && projColors.theme) resolvedColorTheme = projColors.theme
    if (!resolvedColorText && projColors.text) resolvedColorText = projColors.text
    if (!resolvedColorBorder && projColors.border) resolvedColorBorder = projColors.border
    if (!resolvedColorAccent && projColors.accent) resolvedColorAccent = projColors.accent
    if (!resolvedColorBackground && projColors.background) resolvedColorBackground = projColors.background
    if (!resolvedElementStyles && projColors.elements && typeof projColors.elements === 'object') {
      resolvedElementStyles = projColors.elements as unknown as ArticleElementStyles
    }
    // สีที่ปรับในหน้า Article Lab ต้องมีผลกับภาพปกด้วย — ถ้าลูกค้าปรับเฉพาะสี element
    // (H1 / เนื้อความ / ลิงก์) ไม่ได้แตะสีระดับธีม ให้ใช้สีของ element เป็นชุดสีของภาพแทน
    const labPalette = resolveImagePalette(dbP?.themeColors, dbP?.accentColor)
    if (!resolvedColorTheme) resolvedColorTheme = labPalette.themeColor
    if (!resolvedColorText) resolvedColorText = labPalette.textColor
    if (!resolvedColorAccent) resolvedColorAccent = labPalette.accentColor
    if (!resolvedColorBackground) resolvedColorBackground = labPalette.backgroundColor
    if ((projColors as Record<string, unknown>).styleMode === 'clean') resolvedStyleMode = 'clean'
    if ((projColors as Record<string, unknown>).authorCard) {
      resolvedAuthorCardStyle = normalizeAuthorCardStyle((projColors as Record<string, unknown>).authorCard)
    }
    // accentColor/theme ใน body มี default — ใช้ค่าโปรเจกต์เมื่อผู้เรียกไม่ได้ตั้งใจส่งมา
    if (accentColor === '#2563eb' && dbP?.accentColor) resolvedAccentColor = dbP.accentColor
    if (theme === 'professional' && dbP?.articleTheme) resolvedTheme = dbP.articleTheme
    if (!resolvedStyleGuide && dbP?.styleGuide) resolvedStyleGuide = dbP.styleGuide
    if (!rawInternalLinks || rawInternalLinks === '[]') resolvedRawInternalLinks = dbP?.internalLinks ?? '[]'
    if (linksPerArticleBody == null && dbP?.linksPerArticle != null) resolvedLinksPerArticleRaw = String(dbP.linksPerArticle)
    if (!resolvedForbiddenWordsRaw || resolvedForbiddenWordsRaw === '[]') resolvedForbiddenWordsRaw = dbP?.forbiddenWords ?? ''
    if (!resolvedSampleArticle && dbP?.sampleArticle) resolvedSampleArticle = dbP.sampleArticle
    if (dbP?.projectContext) resolvedProjectContext = dbP.projectContext
    if (!resolvedBrandTone && dbP?.brandTone) resolvedBrandTone = dbP.brandTone
    if (!resolvedWebsiteUrl && dbP?.website) resolvedWebsiteUrl = dbP.website
    if (!resolvedSiteName) resolvedSiteName = dbP?.clientName || dbP?.name || ''
    if (dbP?.imageStyleGuide) resolvedImageStyleGuide = dbP.imageStyleGuide
  }
  // Studio (ไม่ผูก client): ใช้ธีมของ Content Studio ที่ตั้งไว้ใน AppSetting
  if (!projectId && orgId) {
    try {
      const row = await prisma.appSetting.findUnique({ where: { key: 'studio_article_theme' } })
      if (row) {
        const st = JSON.parse(row.value) as Record<string, unknown>
        if (!resolvedColorTheme && typeof st.theme === 'string') resolvedColorTheme = st.theme
        if (!resolvedColorText && typeof st.text === 'string') resolvedColorText = st.text
        if (!resolvedColorBorder && typeof st.border === 'string') resolvedColorBorder = st.border
        if (!resolvedColorAccent && typeof st.accent === 'string') resolvedColorAccent = st.accent
        if (!resolvedColorBackground && typeof st.background === 'string') resolvedColorBackground = st.background
        if (!resolvedElementStyles && st.elements && typeof st.elements === 'object') {
          resolvedElementStyles = st.elements as ArticleElementStyles
        }
        if (st.styleMode === 'clean') resolvedStyleMode = 'clean'
      }
    } catch { /* ไม่มีธีม studio — ใช้ default */ }
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
    const parsed = typeof resolvedForbiddenWordsRaw === 'string' ? JSON.parse(resolvedForbiddenWordsRaw || '[]') : resolvedForbiddenWordsRaw
    if (Array.isArray(parsed)) forbiddenWords = parsed.join(', ')
    else forbiddenWords = resolvedForbiddenWordsRaw
  } catch { forbiddenWords = resolvedForbiddenWordsRaw }

  if (!keyword || !title) {
    return NextResponse.json({ error: 'keyword and title are required' }, { status: 400 })
  }
  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json({ error: 'OPENROUTER_API_KEY not configured' }, { status: 500 })
  }

  // ── Prompt ทั้งหมดจาก Content Engine เท่านั้น (scope: project หรือ studio — ห้าม cross-scope) ──
  if (!orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const ceScope: CEScope = projectId ? { projectId } : 'studio'
  const ce = await resolveContentEngine(orgId, ceScope)
  if (ce.missing.length > 0) {
    return NextResponse.json({
      error: 'CONTENT_ENGINE_NOT_CONFIGURED',
      missing: ce.missing,
      message: `ยังไม่ได้ตั้งค่า Content Engine (${ce.scope === 'studio' ? 'ของ Studio' : 'ของโปรเจกต์นี้'}) — ขาด: ${ce.missing.join(', ')} · ตั้งค่าที่${ce.scope === 'studio' ? ' Studio > Content Engine' : ' ฟันเฟือง > Content Engine ของโปรเจกต์'}`,
    }, { status: 400 })
  }

  // resolver รับประกันแล้วว่า masterPrompt/imagePrompt ไม่ null (ผ่าน missing check ด้านบน)
  const imagePromptTemplate = ce.imagePrompt?.text ?? ''
  if (!imagePromptTemplate.trim()) {
    return NextResponse.json({
      error: 'CONTENT_ENGINE_NOT_CONFIGURED',
      missing: ['Image Prompt'],
      message: `ยังไม่ได้ตั้งค่า Content Engine (${ce.scope === 'studio' ? 'ของ Studio' : 'ของโปรเจกต์นี้'}) — ขาด: Image Prompt · ตั้งค่าที่${ce.scope === 'studio' ? ' Studio > Content Engine' : ' ฟันเฟือง > Content Engine ของโปรเจกต์'}`,
    }, { status: 400 })
  }

  let articlePrompt = buildArticlePrompt({
    keyword, title, language, styleGuide: resolvedStyleGuide, accentColor: resolvedAccentColor, theme: resolvedTheme,
    colorTheme: resolvedColorTheme, colorText: resolvedColorText, colorBorder: resolvedColorBorder,
    colorAccent: resolvedColorAccent, colorBackground: resolvedColorBackground,
    elementStyles: resolvedElementStyles, typography,
    internalLinks, forbiddenWords,
    websiteUrl: resolvedWebsiteUrl, siteName: resolvedSiteName, brandTone: resolvedBrandTone,
    contentType, sampleArticle: resolvedSampleArticle, projectContext: resolvedProjectContext,
    cta,
    ce: {
      businessSkill: ce.businessSkill?.text,
      masterPrompt: ce.masterPrompt!.text,
      articleBrief: ce.articleBrief?.text,
      validatorPack: ce.validatorPack?.text,
    },
  })

  // Inject author persona into prompt so writing tone/pronouns match
  // (รวมกรณีมีแค่เพศอย่างเดียวด้วย — เดิมถ้าชื่อ/ตำแหน่งว่าง กฎครับ/ค่ะ จะหายทั้งบล็อก)
  if (resolvedAuthorName || resolvedAuthorTitle || resolvedAuthorGender === 'male' || resolvedAuthorGender === 'female') {
    const genderInstruction = resolvedAuthorGender === 'male'
      ? 'ใช้สรรพนาม "ผม" และลงท้ายด้วย "ครับ" ให้เหมาะกับเพศชาย สม่ำเสมอทั้งบทความ (รวม intro, สรุป, FAQ)'
      : resolvedAuthorGender === 'female'
      ? 'ใช้สรรพนาม "ฉัน/ดิฉัน" และลงท้ายด้วย "ค่ะ/คะ" ให้เหมาะกับเพศหญิง สม่ำเสมอทั้งบทความ (รวม intro, สรุป, FAQ)'
      : 'ใช้ภาษากลาง ไม่เน้นสรรพนามเพศ'
    const roleLabel = resolvedAuthorTitle || 'ผู้เชี่ยวชาญ'
    articlePrompt += `\n\n==================================================\nAUTHOR PERSONA (เขียนในนามผู้เขียนนี้ — ปรับโทนภาษาให้สอดคล้อง)\n==================================================\nชื่อผู้เขียน: ${resolvedAuthorName || '-'}\nตำแหน่ง/ความเชี่ยวชาญ: ${roleLabel}\nเพศ: ${resolvedAuthorGender === 'male' ? 'ชาย' : resolvedAuthorGender === 'female' ? 'หญิง' : 'ไม่ระบุ'}\n\nกฎการใช้ภาษา: ${genderInstruction}\n\nกฎการสวมบทบาท — เขียนเหมือน ${roleLabel} ตัวจริงเป็นคนเขียนเอง:\n- ความลึกของเนื้อหาต้องสมกับความรู้ของ ${roleLabel}: ใช้ศัพท์เฉพาะทางของสายอาชีพนี้อย่างถูกต้อง แล้วอธิบายต่อให้คนทั่วไปเข้าใจ\n- เล่าจากมุมประสบการณ์ตรงของอาชีพนี้ เช่น เคสที่เจอบ่อย ข้อผิดพลาดที่ลูกค้า/ผู้ใช้มักทำ เคล็ดลับจากหน้างานจริง — ไม่ใช่สรุปข้อมูลลอย ๆ แบบคนนอกสายงาน\n- ห้ามฟันธงเกินขอบเขตวิชาชีพของ ${roleLabel} — ประเด็นที่ต้องวินิจฉัยเฉพาะราย ให้แนะนำผู้อ่านไปปรึกษาผู้เชี่ยวชาญโดยตรงแทน\n- สายวิชาชีพที่กระทบสุขภาพ/การเงิน/กฎหมาย (เช่น แพทย์ เภสัชกร ทนายความ ที่ปรึกษาการเงิน): ข้อเท็จจริงต้องแม่นตามหลักวิชาชีพนั้น ห้ามเคลมผลลัพธ์เกินจริง\n`
  }

  if (adjustNote?.trim()) {
    articlePrompt += `\n\n==================================================\nADJUST INSTRUCTION (บทความถูกส่ง Adjust — เขียนใหม่ตาม instruction นี้)\n==================================================\n${adjustNote.trim()}\n\nให้เขียนบทความใหม่ทั้งหมด โดยแก้ไขตาม Adjust instruction ด้านบนอย่างเคร่งครัด\n`
  }

  const model = OR_MODELS.writer()

  // CSS กลางของบทความ — compile จากค่า Article Lab แบบ deterministic (AI ไม่ทาสีเอง)
  const articleCss = buildArticleCss({
    themeColor: resolvedColorTheme || resolvedAccentColor || '#2563eb',
    textColor: resolvedColorText || '#000000',
    borderColor: resolvedColorBorder || '#e2e8f0',
    accentColor: resolvedColorAccent || resolvedAccentColor || '#2563eb',
    backgroundColor: resolvedColorBackground || '',
    elementStyles: resolvedElementStyles,
    typography,
  })
  /** sanitize → ครอบ wrapper มาตรฐาน (+CSS ตามโหมด) → แปะ Schema JSON-LD ที่ generate
   *  จากข้อมูลจริง — โครงสุดท้าย: <script ld+json> → <style> → <div class="content-article">
   *  (schema ของ AI/รอบก่อนถูกถอดทิ้งเสมอ กัน URL มั่วและกัน FAQPage ไม่ตรงเนื้อหา) */
  const finalizeArticleHtml = (raw: string): string => {
    const body = wrapArticleHtml(stripSchemaScripts(sanitizeArticleHtml(raw)), resolvedStyleMode === 'embed' ? articleCss : null)
    const metaBlock = body.match(/<!--\s*CONVERT_CAKE_SEO_META([\s\S]*?)-->/i)?.[1] ?? ''
    const metaOf = (k: string) => metaBlock.match(new RegExp(`${k}\\s*:\\s*(.+)`, 'i'))?.[1]?.trim() ?? ''
    type CtaChan = { type?: string; label?: string; value?: string }
    const ctaChannels = ((cta?.channels ?? []) as CtaChan[]).filter((c): c is CtaChan & { value: string } => !!c.value)
    const schema = buildArticleSchema({
      html: body,
      title,
      metaDescription: metaOf('meta_description') || undefined,
      slug: metaOf('en_slug') || undefined,
      siteUrl: resolvedWebsiteUrl || undefined,
      siteName: resolvedSiteName || undefined,
      authorName: resolvedAuthorName || undefined,
      authorTitle: resolvedAuthorTitle || undefined,
      contact: {
        phones: ctaChannels.filter(c => /phone|tel|โทร/i.test(`${c.type} ${c.label}`) || /^0\d{8,9}$/.test(c.value.replace(/[\s-]/g, ''))).map(c => c.value),
        email: ctaChannels.find(c => /mail/i.test(`${c.type} ${c.label}`) || c.value.includes('@'))?.value,
      },
      serviceName: ((_dbProj as { businessType?: string | null } | null)?.businessType ?? '').trim() || undefined,
    })
    return `${schema}\n${body}`
  }

  if (!doStream) {
    const msg = await orChat({
      trace: 'article_write',
      client: orClient,
      model, maxTokens: 20000, timeoutMs: 600_000,
      messages: [{ role: 'user', content: articlePrompt }],
    })
    let html = sanitizeArticleHtml(msg.text)

    if (orgId && userId) {
      await logAIJob({ orgId, userId, projectId: projectId || undefined, articleId: articleId || undefined,
        jobType: 'ARTICLE_WRITE', modelName: model,
        inputTokens: msg.usage.inputTokens, outputTokens: msg.usage.outputTokens, status: 'COMPLETED' })
    }

    const { count: midCountRaw, cleanTemplate: midTemplate } = parseMidImageCount(imagePromptTemplate)
    const midCount = Math.min(midCountRaw, countMidImageSpots(html))
    const coverExtras = extractCoverExtras(html)
    const [coverResult, ...midResults] = await Promise.all([
      generateGeminiImage({ client: orClient, keyword, title, type: 'cover', siteName: resolvedSiteName, brandTone: resolvedBrandTone, accentColor: resolvedColorAccent || resolvedAccentColor, themeColor: resolvedColorTheme, backgroundColor: resolvedColorBackground, textColor: resolvedColorText, imagePromptTemplate: midTemplate, imageStyleGuide: resolvedImageStyleGuide, coverSubtitle: coverExtras.subtitle, coverBullets: coverExtras.bullets }),
      ...Array.from({ length: midCount }, () =>
        generateGeminiImage({ client: orClient, keyword, title, type: 'mid', siteName: resolvedSiteName, brandTone: resolvedBrandTone, accentColor: resolvedColorAccent || resolvedAccentColor, themeColor: resolvedColorTheme, backgroundColor: resolvedColorBackground, textColor: resolvedColorText, imagePromptTemplate: midTemplate, imageStyleGuide: resolvedImageStyleGuide })),
    ])
    const midResult = midResults[0]

    // Log image generation costs
    if (orgId && userId) {
      const imageModel = OR_MODELS.image()
      if (coverResult.totalTokens || coverResult.costUsd) {
        await prisma.aIJob.create({ data: {
          organizationId: orgId, createdById: userId,
          projectId: projectId ?? null, articleId: articleId ?? null,
          jobType: 'IMAGE_COVER', status: 'SUCCESS',
          modelProvider: 'OPENROUTER', modelName: imageModel,
          tokenUsed: coverResult.totalTokens, estimatedCost: coverResult.costUsd,
        }}).catch(() => {})
      }
      if (midResult.totalTokens || midResult.costUsd) {
        await prisma.aIJob.create({ data: {
          organizationId: orgId, createdById: userId,
          projectId: projectId ?? null, articleId: articleId ?? null,
          jobType: 'IMAGE_MID', status: 'SUCCESS',
          modelProvider: 'OPENROUTER', modelName: imageModel,
          tokenUsed: midResult.totalTokens, estimatedCost: midResult.costUsd,
        }}).catch(() => {})
      }
    }

    // Inject mid images — กระจายตามหัวข้อ (1 รูป = ตำแหน่งกลางแบบเดิม)
    html = injectMidImages(html, midResults, title || keyword)

    // Append author box at the very end
    const authorHtml = buildAuthorHtml(resolvedAuthorName, resolvedAuthorTitle, resolvedAuthorImage, resolvedAuthorCredentials, resolvedAuthorCardStyle)
    if (authorHtml) html = html + authorHtml

    // ครอบ wrapper มาตรฐาน + CSS ตามโหมดของ client (ทำหลังใส่รูป/author ให้สไตล์คลุมถึง)
    html = finalizeArticleHtml(html)

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
      const ceInfo = [
        ce.businessSkill && `Business Skill: ${ce.businessSkill.name} v${ce.businessSkill.version}`,
        `Master Prompt: ${ce.masterPrompt!.name} v${ce.masterPrompt!.version}`,
        ce.articleBrief && `Brief: ${ce.articleBrief.name} v${ce.articleBrief.version}`,
        ce.validatorPack && `Validator: ${ce.validatorPack.name} v${ce.validatorPack.version}`,
        ce.imagePrompt && `Image Prompt: ${ce.imagePrompt.name} v${ce.imagePrompt.version}`,
      ].filter(Boolean).join(' · ')
      send({ type: 'status', step: 'writing', message: `📚 Content Engine (${ce.scope === 'studio' ? 'ของ Studio' : 'ของโปรเจกต์นี้'}): ${ceInfo}` })
      send({ type: 'status', step: 'writing', message: `✍️ ${model} กำลังเขียนบทความ...` })
      const streamed = await orChatStream({
        trace: 'article_write_stream',
        client: orClient,
        model, maxTokens: 20000,
        messages: [{ role: 'user', content: articlePrompt }],
        onDelta: (text) => { fullHtml += text; send({ type: 'chunk', content: text }) },
      })
      fullHtml = sanitizeArticleHtml(streamed.text)
      // Guard: writer ต้องคืนเนื้อหาจริง — เนื้อว่าง/สั้นผิดปกติ = ล้มเหลว
      // ห้ามเดินหน้าทำรูป/บันทึกบทความเปล่า (เคยเกิด: OpenRouter ล้มเงียบ แล้วระบบประกาศสำเร็จ)
      if (fullHtml.replace(/<[^>]+>/g, '').trim().length < 500) {
        throw new Error(`Writer คืนเนื้อหาสั้นผิดปกติ (${fullHtml.length} ตัวอักษรหลัง sanitize) — ตรวจ OpenRouter key/เครดิต แล้วลองใหม่`)
      }

      // Log article write job
      if (orgId && userId) {
        await logAIJob({ orgId, userId, projectId: projectId || undefined, articleId: articleId || undefined,
          jobType: 'ARTICLE_WRITE', modelName: model,
          inputTokens: streamed.usage.inputTokens, outputTokens: streamed.usage.outputTokens, status: 'COMPLETED' })
        // Activity log for tracking
        try {
          await prisma.activityLog.create({
            data: {
              organizationId: orgId, userId,
              action: 'ARTICLE_WRITE',
              entityType: 'Article',
              entityId: projectId || 'unknown',
              newValue: JSON.stringify({ keyword, title, model, tokens: streamed.usage.totalTokens }),
            },
          })
        } catch { /* non-fatal */ }
      }

      // Step 2: Generate cover + mid images via Gemini in parallel
      const { count: midCountRaw, cleanTemplate: midTemplate } = parseMidImageCount(imagePromptTemplate)
      const midCount = Math.min(midCountRaw, countMidImageSpots(fullHtml))
      const coverExtras = extractCoverExtras(fullHtml)
      send({ type: 'status', step: 'cover', message: `🖼️ กำลังสร้างรูปปกและรูปประกอบ ${midCount} รูป${midCount < midCountRaw ? ` (ขอ ${midCountRaw} แต่โครงบทความมีที่ลงรูป ${midCount} จุด)` : ''}...` })
      const [coverResult, ...midResults] = await Promise.all([
        generateGeminiImage({ client: orClient, keyword, title, type: 'cover', siteName: resolvedSiteName, brandTone: resolvedBrandTone, accentColor: resolvedColorAccent || resolvedAccentColor, themeColor: resolvedColorTheme, backgroundColor: resolvedColorBackground, textColor: resolvedColorText, imagePromptTemplate: midTemplate, imageStyleGuide: resolvedImageStyleGuide, coverSubtitle: coverExtras.subtitle, coverBullets: coverExtras.bullets }),
        ...Array.from({ length: midCount }, () =>
          generateGeminiImage({ client: orClient, keyword, title, type: 'mid', siteName: resolvedSiteName, brandTone: resolvedBrandTone, accentColor: resolvedColorAccent || resolvedAccentColor, themeColor: resolvedColorTheme, backgroundColor: resolvedColorBackground, textColor: resolvedColorText, imagePromptTemplate: midTemplate, imageStyleGuide: resolvedImageStyleGuide })),
      ])
      const midResult = midResults[0]
      const midOk = midResults.filter(r => r.imageBase64).length
      if (!coverResult.imageBase64) send({ type: 'status', step: 'cover', message: '⚠️ สร้างรูปปกไม่สำเร็จ (Gemini quota หรือ key หมด) — บทความยังใช้ได้' })
      if (midOk < midCount) send({ type: 'status', step: 'cover', message: `⚠️ รูปประกอบสำเร็จ ${midOk}/${midCount} รูป — ดำเนินการต่อ` })

      // Log image generation costs (streaming path)
      if (orgId && userId) {
        const imageModel = OR_MODELS.image()
        if (coverResult.totalTokens || coverResult.costUsd) {
          prisma.aIJob.create({ data: {
            organizationId: orgId, createdById: userId,
            projectId: projectId ?? null, articleId: articleId ?? null,
            jobType: 'IMAGE_COVER', status: 'SUCCESS',
            modelProvider: 'OPENROUTER', modelName: imageModel,
            tokenUsed: coverResult.totalTokens, estimatedCost: coverResult.costUsd,
          }}).catch(() => {})
        }
        if (midResult.totalTokens || midResult.costUsd) {
          prisma.aIJob.create({ data: {
            organizationId: orgId, createdById: userId,
            projectId: projectId ?? null, articleId: articleId ?? null,
            jobType: 'IMAGE_MID', status: 'SUCCESS',
            modelProvider: 'OPENROUTER', modelName: imageModel,
            tokenUsed: midResult.totalTokens, estimatedCost: midResult.costUsd,
          }}).catch(() => {})
        }
      }

      // Inject mid images — กระจายตามหัวข้อ (1 รูป = ตำแหน่งกลางแบบเดิม)
      fullHtml = injectMidImages(fullHtml, midResults, title || keyword)

      // Append author box at the very end
      const authorHtmlBlock = buildAuthorHtml(resolvedAuthorName, resolvedAuthorTitle, resolvedAuthorImage, resolvedAuthorCredentials, resolvedAuthorCardStyle)
      if (authorHtmlBlock) fullHtml = fullHtml + authorHtmlBlock

      // ครอบ wrapper มาตรฐาน + CSS ตามโหมดของ client
      fullHtml = finalizeArticleHtml(fullHtml)

      await saveArticleHtml({ orgId, userId, projectId, keyword, title, html: fullHtml, keywordId: keywordId || undefined })

      send({ type: 'status', step: 'done', message: '✅ เสร็จสมบูรณ์' })
      send({
        type: 'done', html: fullHtml, keyword, title,
        coverImage: coverResult.imageBase64, coverMimeType: coverResult.mimeType,
        midImage: midResult.imageBase64, midMimeType: midResult.mimeType,
      })

    } catch (e: unknown) {
      send({ type: 'error', error: String(e) })
      // สำคัญ: อย่าปล่อยบทความค้างสถานะ WRITING ใน DB — client จะได้รู้ว่าพังและสั่งเขียนใหม่ได้
      if (orgId && projectId) {
        prisma.article.updateMany({
          where: { projectId, title, status: 'WRITING', project: { organizationId: orgId } },
          data: { status: 'ERROR' },
        }).catch(() => {})
      }
    } finally {
      try { await writer.close() } catch { /* client อาจปิด connection ไปแล้ว */ }
    }
  })()

  return new NextResponse(transform.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disable proxy/CDN buffering so SSE chunks reach the browser immediately
      // (otherwise the UI shows "กำลังเขียน" the whole time then dumps at the end).
      'X-Accel-Buffering': 'no',
    },
  })
}
