/**
 * Shared Gemini image generation logic.
 * Used by both /api/article/cover (HTTP handler) and /api/article/write (internal call).
 * Avoids internal HTTP fetches that would be blocked by auth middleware.
 */
import sharp from 'sharp'
import { orChat, orImage, OR_MODELS } from '@/lib/openrouter'

const CURRENT_YEAR = new Date().getFullYear()
const NEXT_YEAR    = CURRENT_YEAR + 1

// ── Art Director: บรีฟจาก Content Engine → prompt ภาษาอังกฤษสำหรับโมเดลภาพ ─────
//
// CE_IMAGE_PROMPT ที่ทีมเขียนไว้เป็น "บรีฟ" ภาษาไทย (ขึ้นต้นทำนอง "สร้าง prompt
// ภาษาอังกฤษสำหรับ Gemini เพื่อทำภาพประกอบ...") ถ้าส่งบรีฟเข้าโมเดลภาพตรงๆ
// Gemini จะทำตามตัวอักษร คือ *เขียน prompt* กลับมาเป็นข้อความ ไม่ใช่รูป
// จึงต้องให้ Claude คอมไพล์บรีฟเป็น prompt จริงก่อนเสมอ
//
// กติกา: ทิศทางงานภาพทั้งหมดมาจาก Content Engine เท่านั้น — system prompt ข้างล่าง
// เป็นแค่คำสั่งรูปแบบเอาต์พุต ไม่ใส่สไตล์/เนื้อหาใดๆ และไม่มี fallback prompt

const ART_DIRECTOR_SYSTEM = `You are a prompt compiler for an image generation model.
You receive a creative brief (usually written in Thai) describing the illustration to produce.
The brief is the ONLY source of style, subject, composition, and constraints — follow it exactly and carry every constraint through.
Output ONLY the final English image-generation prompt as plain prose.
Never translate the brief itself, never explain your choices, never offer multiple options, never use markdown, headings, labels, or surrounding quotes.`

/** เรียก Claude แปลงบรีฟ (CE) เป็น prompt ภาษาอังกฤษ — ล้มเหลว = โยน error ไม่มี fallback */
async function compileImagePrompt(brief: string): Promise<string> {
  const result = await orChat({
    model: OR_MODELS.default(),
    maxTokens: 1500,
    messages: [
      { role: 'system', content: ART_DIRECTOR_SYSTEM },
      { role: 'user', content: brief },
    ],
  })
  const text = result.text.trim()
  if (text.length < 40) {
    throw new Error('Art Director คืน prompt สั้นผิดปกติ — ตรวจ Image Prompt ใน Content Engine')
  }
  return text
}

// ── WebP compression ──────────────────────────────────────────────────────────

async function compressToWebP(
  base64: string, srcMime: string, type: 'cover' | 'mid',
  targetWidth?: number, targetHeight?: number
): Promise<{ base64: string; mimeType: string; originalKB: number; compressedKB: number }> {
  const inputBuf = Buffer.from(base64, 'base64')
  const originalKB = Math.round(inputBuf.length / 1024)
  const quality = type === 'cover' ? 82 : 78
  try {
    let img = sharp(inputBuf)
    // โมเดลภาพบางตัว (เช่น gpt-5-image) คืนสัดส่วนไม่ตรงที่สั่ง —
    // crop กลางภาพให้ได้สัดส่วนเป้าหมายเสมอ (cover = 16:9, mid = 1.9:1)
    if (targetWidth && targetHeight) {
      const meta = await img.metadata()
      const cur = (meta.width ?? 0) / (meta.height ?? 1)
      const want = targetWidth / targetHeight
      if (meta.width && meta.height && Math.abs(cur - want) / want > 0.05) {
        img = img.resize(targetWidth, targetHeight, { fit: 'cover', position: 'attention' })
      }
    }
    const outputBuf = await img.webp({ quality, effort: 4 }).toBuffer()
    const compressedKB = Math.round(outputBuf.length / 1024)
    return { base64: outputBuf.toString('base64'), mimeType: 'image/webp', originalKB, compressedKB }
  } catch {
    return { base64, mimeType: srcMime, originalKB, compressedKB: originalKB }
  }
}

// ── Core function — call Vertex Gemini image generation via Vercel OIDC ───────

export interface GeminiImageResult {
  imageBase64: string
  mimeType: string
  promptTokens: number
  totalTokens: number
  costUsd: number
}

// ── Content Engine image prompt template — placeholder substitution ───────────
// {{keyword}} {{title}} {{site_name}} {{brand_tone}} {{accent_color}}
function renderImagePromptTemplate(
  template: string,
  vars: { keyword: string; title: string; siteName: string; brandTone: string; accentColor: string }
): string {
  return template
    .replace(/\{\{\s*keyword\s*\}\}/gi, vars.keyword)
    .replace(/\{\{\s*title\s*\}\}/gi, vars.title)
    .replace(/\{\{\s*site_name\s*\}\}/gi, vars.siteName)
    .replace(/\{\{\s*brand_tone\s*\}\}/gi, vars.brandTone)
    .replace(/\{\{\s*accent_color\s*\}\}/gi, vars.accentColor)
}

export async function callGeminiImage(params: {
  keyword: string
  title: string
  type: 'cover' | 'mid'
  siteName?: string
  brandTone?: string
  accentColor?: string
  width?: number
  height?: number
  /** Content Engine CE_IMAGE_PROMPT text — บังคับ (กติกา: ห้ามมี fallback, ต้องมาจาก CE เท่านั้น) */
  promptTemplate: string
  /** Article Lab > Image Style Guide ของโปรเจกต์ — ข้อมูลประกอบบรีฟ ไม่ได้แทนที่ CE */
  imageStyleGuide?: string
}): Promise<GeminiImageResult> {
  const {
    keyword, title, type,
    siteName = '', brandTone = '', accentColor = '',
    width = type === 'cover' ? 1536 : 1200,
    height = type === 'cover' ? 864 : 630,
    promptTemplate,
    imageStyleGuide = '',
  } = params

  if (!promptTemplate?.trim()) {
    throw new Error('CONTENT_ENGINE_NOT_CONFIGURED: ต้องมี Image Prompt จาก Content Engine — ไม่มี fallback')
  }
  const rendered = renderImagePromptTemplate(promptTemplate, { keyword, title, siteName, brandTone, accentColor })
  const isSquare = width === height
  const orientationLine = isSquare
    ? `\n\nIMAGE ORIENTATION (CRITICAL): SQUARE 1:1 ratio. Width equals height.`
    : `\n\nIMAGE ORIENTATION (CRITICAL): HORIZONTAL LANDSCAPE ${width}×${height} (${(width / height).toFixed(2)}:1 ratio). Width must be greater than height. DO NOT generate portrait or square images.`

  // ข้อเท็จจริงประกอบบรีฟ (ไม่ใช่ทิศทางงานภาพ — ทิศทางมาจาก Content Engine เท่านั้น)
  const briefFacts = [
    `[ประเภทภาพ: ${type === 'cover' ? 'ภาพหน้าปกบทความ (cover)' : 'ภาพประกอบกลางบทความ (in-article)'}]`,
    `[สัดส่วน: ${width}×${height}]`,
    `[ปีปัจจุบัน: ${CURRENT_YEAR}]`,
    ...(imageStyleGuide.trim() ? [`[Image Style Guide ของโปรเจกต์: ${imageStyleGuide.trim()}]`] : []),
  ].join('\n')
  const compiled = await compileImagePrompt(`${rendered}\n\n${briefFacts}`)

  // รูปปกต้องมีตัวหนังสือไทยประกอบเสมอ (คำสั่งเจ้าของระบบ 2026-08-19) —
  // เป็นข้อบังคับรูปแบบเอาต์พุตแบบเดียวกับ orientation ไม่ใช่ทิศทางสไตล์ (สไตล์ยังมาจาก CE)
  const coverTextLine = type === 'cover'
    ? `\n\nCOVER TEXT OVERLAY (CRITICAL): This is a marketing cover banner — it MUST include Thai text rendered inside the image:
- Main headline (dominant focal element, large bold legible Thai typography): "${title}"
- Add 2-4 short supporting Thai callouts/badges derived from the brief (benefits, services, or trust marks)
- Professional Thai advertising-banner layout with clear text hierarchy; keep every character fully inside safe margins, never clipped
- Keep the headline and ALL text within the central vertical band — the top 10% and bottom 10% of the frame will be trimmed in post-processing
- Spell all Thai words EXACTLY as provided — do not invent, translate, or misspell Thai text`
    : ''
  const prompt = compiled + coverTextLine + orientationLine

  // เลือกสัดส่วนที่โมเดลรองรับให้ใกล้เป้าหมายที่สุด — crop ปลายทางจะเหลือน้อยลงมาก
  const aspectRatio = isSquare ? '1:1' as const : (width > height ? '3:2' as const : '2:3' as const)
  const result = await orImage({ prompt, aspectRatio })

  const promptTokens = result.usage.inputTokens
  const totalTokens = result.usage.totalTokens
  const costUsd = Number(result.usage.costUsd.toFixed(6))

  const { base64, mimeType, originalKB, compressedKB } =
    await compressToWebP(result.base64, result.mimeType, type, width, height)

  console.log(`[image] ${type} via ${OR_MODELS.image()} ${originalKB}KB → ${compressedKB}KB (${Math.round((1 - compressedKB / originalKB) * 100)}% saved)`)

  return { imageBase64: base64, mimeType, promptTokens, totalTokens, costUsd }
}
