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
The one exception: lines wrapped in brackets and marked ข้อบังคับเอาต์พุต are hard platform output constraints — they OVERRIDE any conflicting line in the brief, and the compiled prompt must never ask for anything they forbid.
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
    // crop ให้ได้สัดส่วนเป้าหมายเสมอ (cover = 1:1 จัตุรัส, mid = 1.9:1)
    // ปกครอปจากกึ่งกลางเสมอ — saliency ('attention') ชอบเลื่อนกรอบไปตัดตัวหนังสือทิ้ง
    if (targetWidth && targetHeight) {
      const meta = await img.metadata()
      const cur = (meta.width ?? 0) / (meta.height ?? 1)
      const want = targetWidth / targetHeight
      if (meta.width && meta.height && Math.abs(cur - want) / want > 0.05) {
        img = img.resize(targetWidth, targetHeight, { fit: 'cover', position: type === 'cover' ? 'centre' : 'attention' })
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
// {{keyword}} {{title}} {{site_name}} {{brand_tone}} {{accent_color}} {{theme_color}} {{background_color}} {{text_color}}
function renderImagePromptTemplate(
  template: string,
  vars: { keyword: string; title: string; siteName: string; brandTone: string; accentColor: string; themeColor: string; backgroundColor: string; textColor: string }
): string {
  return template
    .replace(/\{\{\s*keyword\s*\}\}/gi, vars.keyword)
    .replace(/\{\{\s*title\s*\}\}/gi, vars.title)
    .replace(/\{\{\s*site_name\s*\}\}/gi, vars.siteName)
    .replace(/\{\{\s*brand_tone\s*\}\}/gi, vars.brandTone)
    .replace(/\{\{\s*accent_color\s*\}\}/gi, vars.accentColor)
    .replace(/\{\{\s*theme_color\s*\}\}/gi, vars.themeColor)
    .replace(/\{\{\s*background_color\s*\}\}/gi, vars.backgroundColor)
    .replace(/\{\{\s*text_color\s*\}\}/gi, vars.textColor)
}

export async function callGeminiImage(params: {
  keyword: string
  title: string
  type: 'cover' | 'mid'
  siteName?: string
  brandTone?: string
  accentColor?: string
  /** ชุดสีธีมเว็บลูกค้า (Article Lab > Article Colors) — ให้ภาพเป็นชุดเดียวกับเว็บไซต์ */
  themeColor?: string
  backgroundColor?: string
  textColor?: string
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
    themeColor = '', backgroundColor = '', textColor = '',
    width = type === 'cover' ? 1024 : 1200,
    height = type === 'cover' ? 1024 : 630,
    promptTemplate,
    imageStyleGuide = '',
  } = params

  if (!promptTemplate?.trim()) {
    throw new Error('CONTENT_ENGINE_NOT_CONFIGURED: ต้องมี Image Prompt จาก Content Engine — ไม่มี fallback')
  }
  const rendered = renderImagePromptTemplate(promptTemplate, { keyword, title, siteName, brandTone, accentColor, themeColor, backgroundColor, textColor })
  const isSquare = width === height
  const orientationLine = isSquare
    ? `\n\nIMAGE ORIENTATION (CRITICAL): SQUARE 1:1 ratio, ${width}×${height}. Width equals height. DO NOT generate landscape or portrait images.`
    : `\n\nIMAGE ORIENTATION (CRITICAL): HORIZONTAL LANDSCAPE ${width}×${height} (${(width / height).toFixed(2)}:1 ratio). Width must be greater than height. DO NOT generate portrait or square images.`

  // ชุดสีธีมเว็บลูกค้า (Article Lab) — ข้อเท็จจริงประกอบบรีฟ ให้ภาพเป็นชุดสีเดียวกับเว็บไซต์
  const palette = [
    themeColor.trim() && `สีธีม/สีหลัก ${themeColor.trim()}`,
    accentColor.trim() && `สี accent ${accentColor.trim()}`,
    backgroundColor.trim() && `สีพื้นหลัง ${backgroundColor.trim()}`,
    textColor.trim() && `สีตัวอักษร ${textColor.trim()}`,
  ].filter(Boolean).join(', ')

  // ข้อเท็จจริงประกอบบรีฟ (ไม่ใช่ทิศทางงานภาพ — ทิศทางมาจาก Content Engine เท่านั้น)
  const briefFacts = [
    `[ประเภทภาพ: ${type === 'cover' ? 'ภาพหน้าปกบทความ (cover)' : 'ภาพประกอบกลางบทความ (in-article)'}]`,
    `[สัดส่วน: ${width}×${height}]`,
    `[ปีปัจจุบัน: ${CURRENT_YEAR}]`,
    ...(type === 'cover' ? [`[ข้อบังคับเอาต์พุต — เหนือกว่าทุกบรรทัดในบรีฟ: ตัวอักษรบนภาพมีได้ไม่เกิน 2 ชุด (headline + sub-headline สั้น 1 บรรทัด) ทั้งสองชุดต้องวางบนบล็อก/แถบสีทึบเพื่อคอนทราสต์ และทุกตัวอักษรต้องสูงอย่างน้อย 5% ของความสูงภาพ — ถ้าบรีฟสั่งให้มีป้ายคำใต้ไอคอน แถบข้อความล่าง ชิป แท็ก หรือคำบรรยายย่อย ให้เปลี่ยนเป็นไอคอน/กราฟิกล้วนไม่มีตัวอักษร ห้าม prompt ที่คอมไพล์ออกมามีคำสั่งให้ใส่ข้อความเล็ก]`] : []),
    ...(type === 'mid' ? [`[ข้อบังคับเอาต์พุต — เหนือกว่าทุกบรรทัดในบรีฟ: นี่คือภาพประกอบกลางบทความ ไม่ใช่ภาพปก ต้องเป็นภาพถ่ายจริง (photorealistic photography) เต็มเฟรม ไม่มีบล็อกข้อความ ไม่มีแถบสี และห้ามมีตัวอักษรใดๆ ในภาพเด็ดขาด — ไม่มี headline, ชื่อบทความ, ป้ายคำ, ชิป, แท็ก, คำบรรยาย, ตัวเลข, โลโก้, ลายน้ำ หรือ ข้อความบนหน้าจอ/ป้าย/เอกสารในภาพ ถ้าบรีฟสั่งให้ใส่ headline หรือป้ายคำ ให้ตัดออกทั้งหมดแล้วเล่าด้วยภาพล้วน โดยคงสไตล์และชุดสีตามบรีฟไว้]`] : []),
    ...(palette ? [`[ชุดสีธีมเว็บลูกค้า (Article Lab) — ใช้เป็นชุดสีหลักของภาพให้เข้ากับเว็บไซต์: ${palette}]`] : []),
    ...(imageStyleGuide.trim() ? [`[Image Style Guide ของโปรเจกต์: ${imageStyleGuide.trim()}]`] : []),
  ].join('\n')
  const compiled = await compileImagePrompt(`${rendered}\n\n${briefFacts}`)

  // รูปปกต้องมีตัวหนังสือประกอบเสมอ (คำสั่งเจ้าของระบบ 2026-08-19, ปรับ 2026-08-21:
  // ไม่จำกัดภาษาไทย — ใช้ภาษาเดียวกับ title ไทย/อังกฤษ/ผสม) — เป็นข้อบังคับรูปแบบ
  // เอาต์พุตแบบเดียวกับ orientation ไม่ใช่ทิศทางสไตล์ (สไตล์ยังมาจาก CE)
  // ปรับ 2026-08-24: ปกเป็นจัตุรัส 1:1 + กฎตัวอักษรไทยให้เข้มขึ้น — ตัวหนังสือน้อยลงแต่ใหญ่ขึ้น,
  // บังคับฟอนต์ไทยสายงาน UI, เว้นบรรทัดให้วรรณยุกต์/สระบน-ล่าง, ห้ามตัดคำไทยข้ามบรรทัด
  //
  // ทำไมต้องมีเพดานจำนวน/ขนาดตัวอักษร: ทดสอบจริงกับ gpt-5-image พบว่า headline ตัวใหญ่
  // สะกดไทยถูกทั้งประโยค แต่ป้ายเล็กใต้ไอคอน/แถบล่างออกมาเป็นตัวมั่วแทบทุกครั้ง
  // ("ตรวจสุขภาพ" → "ตรวอ ลุอกาพ") จึงบังคับว่าอะไรที่เล็กกว่า 4% ของความสูงภาพ
  // ให้ตัดข้อความทิ้งเหลือแต่ไอคอน — กฎนี้ทับบรีฟจาก CE ที่สั่งให้มีป้ายใต้ไอคอน
  const coverTextLine = type === 'cover'
    ? `\n\nCOVER TEXT OVERLAY (CRITICAL): This is a SQUARE 1:1 marketing cover built on a REAL PHOTOGRAPH with flat graphic panels on top — it MUST include readable text rendered inside the image:
- Main headline (dominant focal element, large bold legible typography): "${title}"
- Use the SAME language(s) as the headline above — Thai, English, or a mix, exactly as written. Do NOT force one language and do NOT translate the title
- TEXT BUDGET (hard limit): the whole image contains AT MOST 2 text elements — the headline, plus at most ONE short single-line sub-headline (max ~8 words) derived from the brief, in the same language(s). Nothing else carries text
- TEXT PLATE (hard limit): every text element sits on its own opaque solid-colour panel, band or pill (theme colour or dark navy), never directly on top of busy photographic detail — contrast must stay high and the letterforms must stay crisp
- MINIMUM TEXT SIZE (hard limit): every single glyph in the image must be at least 5% of the image height (about 50px at 1024×1024). Small text is ALWAYS rendered as broken, misspelled glyphs, so if a label, badge, caption, footer strip, chip, or icon caption would end up smaller than that, DROP THE TEXT COMPLETELY and leave the icon or graphic element with no label at all. An unlabelled icon is always better than small broken text. This overrides any instruction above that asks for labelled icon rows, medallion captions, footer text bars, chips, tags, or body copy
- THAI TYPOGRAPHY (when any Thai character appears): use a plain, modern Thai UI sans-serif (Noto Sans Thai / IBM Plex Sans Thai / Sarabun style). NO condensed, handwritten, script, outlined, 3D, distressed or decorative faces. No extra letter-spacing. Line height at least 1.6 so tone marks (วรรณยุกต์) and upper/lower vowels (สระบน/สระล่าง) have room and are never cut, merged, or collided
- Render every character as clean, correctly-formed glyphs in whatever script is used — for Thai keep every tone mark and vowel attached to its own base letter in the correct position, for Latin spell every word correctly; never split, merge, duplicate, mirror, warp, or drop characters
- Keep each Thai phrase on ONE unbroken line; never hyphenate Thai and never break a Thai word across lines
- Do NOT invent text of your own: no phone numbers, LINE ids, emails, URLs, company names, or filler words — only the headline and the callouts from the brief
- Clean layout with clear hierarchy, text sitting on a calm uncluttered area; keep every character fully inside a safe margin of at least 8% from all four edges, never clipped by the frame or covered by graphic elements
- Spell every word EXACTLY as provided — do not invent, translate, or misspell any text`
    : `\n\nNO TEXT (CRITICAL): This is an in-article illustration, not a cover. Render ZERO text: no headline, no article title, no labels, captions, chips, tags, numbers, units, logos, watermarks, signatures, and no text on screens, signs, or documents inside the scene. Tell the story with visuals only — objects, people, scenes, icons, graphic elements — keeping the style and colour palette from the brief. If the brief asks for a headline or captions, ignore that part.`
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
