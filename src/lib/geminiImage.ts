/**
 * Shared Gemini image generation logic.
 * Used by both /api/article/cover (HTTP handler) and /api/article/write (internal call).
 * Avoids internal HTTP fetches that would be blocked by auth middleware.
 */
import sharp from 'sharp'
import { orChat, orImage, OR_MODELS } from '@/lib/openrouter'
import { composeCoverOverlay } from '@/lib/coverOverlay'

// ปกโหมดใหม่ (คำสั่งเจ้าของ 2026-09-07): แบนเนอร์อินโฟกราฟิกที่โมเดลวาดตัวอักษรเอง
// ตามตัวอย่างที่เจ้าของส่งมา — headline บนแผงสีทึบ + ตรามุมขวาบน + การ์ดแถบล่าง
// ทดสอบกับ gpt-5-image แล้ว: ตัวใหญ่สะกดไทยถูก ตัวเล็กยังพลาดได้เป็นครั้งคราว
// กลับไปโหมดวาดตัวอักษรด้วยฟอนต์จริง (coverOverlay.ts, สะกดถูก 100%) ด้วย COVER_TEXT_OVERLAY=on
const COVER_TEXT_OVERLAY = process.env.COVER_TEXT_OVERLAY === 'on'

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

CRAFT — how to WRITE the prompt. These rules govern wording and level of detail only; they never introduce subject matter, style or colour of your own:
- Be specific, never generic. Name the concrete subject, the real place, and the real objects, materials and props the topic implies. Banned vague fillers: "modern setup", "professional scene", "technology background", "beautiful", "high quality", "stunning", "4k", "masterpiece".
- If the brief asks for a DESIGNED LAYOUT (panels, cards, badges, typography over a photograph), write the prompt as a layout specification: walk the zones in reading order and, for each zone, state what sits there, its exact shape, its exact fill colour (quote the hex codes given), and the exact text string it carries — copy every quoted string character-for-character, never translate, paraphrase, shorten, reorder or invent text.
- If the brief asks for a plain photograph, cover these facets in order, each with real information: (1) the main subject and what it is doing, (2) the environment and supporting props around it, (3) materials and surface texture, (4) lighting — direction, quality, colour temperature, how highlights roll off and how shadows fall, (5) camera angle and framing, (6) lens, focal length and depth of field, (7) overall mood.
- Use concrete photographic language ("85mm at f/2, soft window key light from camera left, warm practical rim light behind the subject, deep but open shadows") instead of adjectives.
- Photographic parts must survive close inspection: micro-texture, edge highlights, dust, fine grain, reflections, subtle wear and imperfection — a real commissioned photograph, not a clean CGI render and not an AI-smooth plastic look.
- Graphic parts must read as work by a senior designer: crisp geometry, consistent corner radii, deliberate hierarchy, generous padding, soft realistic drop shadows, everything inside the safe margin and nothing clipped by the frame.
- Length: 220–340 words for a designed layout, 120–200 words for a plain photograph. ONE dense paragraph. Every clause must add new information; no repetition, no filler.
Output ONLY the final English image-generation prompt as plain prose.
Never translate the brief itself, never explain your choices, never offer multiple options, never use markdown, headings, labels, or surrounding quotes.`

/** เรียก Claude แปลงบรีฟ (CE) เป็น prompt ภาษาอังกฤษ — ล้มเหลว = โยน error ไม่มี fallback */
async function compileImagePrompt(brief: string, client?: string): Promise<string> {
  const result = await orChat({
    trace: 'image_prompt_compile',
    client,
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
    // crop ให้ได้สัดส่วนเป้าหมายเสมอ (cover = 16:9 แนวนอน, mid = 1.9:1)
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
  /** คำโปรยใต้ headline บนปก (เช่น meta description) — ใช้เฉพาะ overlay ฟอนต์จริง */
  coverSubtitle?: string
  /** จุดขาย/หัวข้อเด่นบนปก (เช่น H2 จริงของบทความ) สูงสุด 3 ข้อ — ใช้เฉพาะ overlay ฟอนต์จริง */
  coverBullets?: string[]
  /** SOP §3: ลูกค้าเจ้าของงาน — ใช้ประกอบ generation_name mars_<client>_<action> */
  client?: string
}): Promise<GeminiImageResult> {
  const {
    keyword, title, type,
    siteName = '', brandTone = '', accentColor = '',
    themeColor = '', backgroundColor = '', textColor = '',
    width = type === 'cover' ? 1600 : 1200,
    height = type === 'cover' ? 900 : 630,
    promptTemplate,
    imageStyleGuide = '',
    coverSubtitle = '',
    coverBullets = [],
    client,
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

  // การ์ดแถบล่างของปกแบนเนอร์ — ใช้หัวข้อจริงในบทความ (H2) ไม่ให้โมเดลคิดข้อความเอง
  // ข้อความยาวจะถูกวาดเป็นตัวเล็กแล้วสะกดเพี้ยน จึงตัดที่ขอบคำให้สั้นก่อนเสมอ
  const bannerCards = coverBullets
    .map((b) => b.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((b) => (b.length <= 26 ? b : b.slice(0, 26).replace(/\s+\S*$/, '') || b.slice(0, 26)))
    .slice(0, 3)

  // ข้อความทุกชิ้นที่อนุญาตให้ปรากฏบนปกแบนเนอร์ — โมเดลคัดลอกได้อย่างเดียว ห้ามแต่งเพิ่ม
  const coverTextInventory = [
    `[ข้อบังคับเอาต์พุต — เหนือกว่าทุกบรรทัดในบรีฟ: ข้อความบนภาพต้องเป็นสตริงต่อไปนี้เท่านั้น คัดลอกทีละตัวอักษร ห้ามเพิ่มข้อความอื่นใดในภาพ`,
    `- หัวเรื่องหลัก (เด่นที่สุด ต้องแสดงครบทุกคำ): "${title}"`,
    keyword.trim() ? `- ป้ายคีย์เวิร์ดเล็ก 1 ชิ้นเหนือหัวเรื่อง: "${keyword.trim()}" — ถ้าคำนี้ปรากฏอยู่ในหัวเรื่องหลักแล้ว ให้ตัดป้ายนี้ทิ้งไปเลย ไม่ต้องวาด` : '',
    `- ตรามุมขวาบน: "อัปเดต ${CURRENT_YEAR}"`,
    bannerCards.length
      ? `- การ์ดแถบล่าง ${bannerCards.length} ใบ เรียงแถวเดียว ใบละ 1 ข้อความบรรทัดเดียว ตามลำดับนี้: ${bannerCards.map((c) => `"${c}"`).join(' | ')}`
      : `- ไม่มีการ์ดแถบล่าง ให้ตัดแถบการ์ดออกทั้งแถบ`,
    `ตัวอักษรทุกตัวในภาพต้องสูงอย่างน้อย 4% ของความสูงภาพ ถ้าข้อความไหนจะเล็กกว่านั้นให้ตัดข้อความนั้นทิ้งเหลือแต่ไอคอน ห้ามเติมคำอธิบายบรรทัดที่สองในการ์ด ห้ามตัดคำใดออกจากสตริงที่ให้ไว้ ห้ามใช้ข้อความเดียวกันซ้ำสองที่ในภาพ]`,
  ].filter(Boolean).join('\n')

  // ข้อเท็จจริงประกอบบรีฟ (ไม่ใช่ทิศทางงานภาพ — ทิศทางมาจาก Content Engine เท่านั้น)
  const briefFacts = [
    `[ประเภทภาพ: ${type === 'cover' ? 'ภาพหน้าปกบทความ (cover)' : 'ภาพประกอบกลางบทความ (in-article)'}]`,
    `[สัดส่วน: ${width}×${height}]`,
    `[ปีปัจจุบัน: ${CURRENT_YEAR}]`,
    ...(type === 'cover' ? [COVER_TEXT_OVERLAY
      ? `[ข้อบังคับเอาต์พุต — เหนือกว่าทุกบรรทัดในบรีฟ: ภาพนี้คือ "ภาพถ่ายพื้นหลังของปก" เท่านั้น ระบบจะวางหัวเรื่องและป้ายคีย์เวิร์ดทับด้วยฟอนต์จริงในขั้นตอนถัดไป จึงห้ามมีตัวอักษรใดๆ ในภาพเด็ดขาด — ไม่มี headline, ชื่อบทความ, ป้ายคำ, ชิป, แท็ก, คำบรรยาย, ตัวเลข, โลโก้, ลายน้ำ, บล็อกข้อความ, แถบสีสำหรับใส่ข้อความ หรือข้อความบนหน้าจอ/ป้าย/เอกสารในภาพ ถ้าบรีฟสั่งให้ใส่ headline บล็อกข้อความ หรือป้ายคำ ให้ตัดออกทั้งหมด; องค์ประกอบภาพ: เป็นภาพถ่ายจริงเต็มเฟรม วางตัวแบบหลักไว้ครึ่งบนของเฟรม และเว้นครึ่งล่างให้เป็นพื้นที่เรียบสงบ (พื้น ผนัง ท้องฟ้า ระยะเบลอ) ไม่มีรายละเอียดสำคัญ เพราะจะถูกแผงสีทับ]`
      : coverTextInventory] : []),
    ...(type === 'mid' ? [`[ข้อบังคับเอาต์พุต — เหนือกว่าทุกบรรทัดในบรีฟ: นี่คือภาพประกอบกลางบทความ ไม่ใช่ภาพปก ต้องเป็นภาพถ่ายจริง (photorealistic photography) เต็มเฟรม ไม่มีบล็อกข้อความ ไม่มีแถบสี และห้ามมีตัวอักษรใดๆ ในภาพเด็ดขาด — ไม่มี headline, ชื่อบทความ, ป้ายคำ, ชิป, แท็ก, คำบรรยาย, ตัวเลข, โลโก้, ลายน้ำ หรือ ข้อความบนหน้าจอ/ป้าย/เอกสารในภาพ ถ้าบรีฟสั่งให้ใส่ headline หรือป้ายคำ ให้ตัดออกทั้งหมดแล้วเล่าด้วยภาพล้วน โดยคงสไตล์และชุดสีตามบรีฟไว้]`] : []),
    ...(palette ? [(type === 'cover' && COVER_TEXT_OVERLAY)
      ? `[ข้อบังคับเอาต์พุต — เหนือกว่าทุกบรรทัดในบรีฟ: ภาพถ่ายต้องคุมสีแบบธรรมชาติสมจริง (natural true-to-life colours) — คน อาคาร ท้องฟ้า วัตถุ วัสดุ ให้เป็นสีจริงตามธรรมชาติทั้งหมด ห้ามย้อม ห้ามเกรด ห้าม wash ทั้งภาพให้เป็นสีธีม/สีแบรนด์ใด ๆ เด็ดขาด ถ้าบรีฟสั่งให้ใช้ชุดสีธีม (${palette}) กับภาพถ่าย ให้ตีความว่าใช้ได้แค่กับพร็อพชิ้นเล็กหรือเสื้อผ้าอย่างพอดีตามธรรมชาติเท่านั้น — สีธีมของแบรนด์จะถูกระบบใส่เองในแผงกราฟิกและตัวหนังสือขั้นตอนถัดไป]`
      : `[ข้อบังคับเอาต์พุต — เหนือกว่าทุกบรรทัดในบรีฟ: ชุดสีนี้ใช้กับ "ชั้นกราฟิก" เท่านั้น (แผงข้อความ การ์ด ไอคอน ตรา เส้นคั่น ไล่เฉดฝั่งซ้าย): ${palette} — สีธีมเป็นสีนำของแผงและแถบ, สี accent ใช้เน้นและใช้กับไอคอน, ขาวใช้เป็นพื้นการ์ดและตัวอักษรบนพื้นเข้ม, ห้ามใช้สีอื่นนอกชุดนี้เป็นสีหลักของกราฟิก; ส่วนที่เป็น "ภาพถ่าย" ต้องคงสีธรรมชาติสมจริงเสมอ ท้องฟ้าเป็นสีฟ้าหรือสีทองตอนเย็นตามจริง ผิวคนเป็นสีผิวจริง อาคารและวัสดุเป็นสีจริง ห้ามย้อม ห้ามเกรด ห้าม wash ภาพถ่ายให้เป็นสีธีมเด็ดขาด]`] : []),
    ...(imageStyleGuide.trim() ? [`[Image Style Guide ของโปรเจกต์: ${imageStyleGuide.trim()}]`] : []),
  ].join('\n')
  const compiled = await compileImagePrompt(`${rendered}\n\n${briefFacts}`, client)

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
  const coverTextLine = (type === 'cover' && COVER_TEXT_OVERLAY)
    ? `\n\nBACKGROUND PLATE FOR A COVER — NO TEXT (CRITICAL): The headline and keyword label are rendered afterwards by the system using a real font, directly on top of this image. Your job is ONLY the photograph underneath:
- Render ZERO text: no headline, no article title, no labels, captions, chips, tags, numbers, units, logos, watermarks, signatures, no text panels or coloured text bars, and no text on screens, signs, packaging or documents inside the scene. Any letterform you draw will be covered or will clash with the real typography
- Photorealistic photography, full frame, single clear subject — editorial/commercial quality, natural depth of field
- DETAIL (hard requirement): tack-sharp focus on the subject with rich micro-texture — material grain, brushed or machined metal, dust, fabric weave, condensation, fingerprints, fine edge highlights. Deliberate lighting with a clear key direction, soft fill and a separating rim or practical light; no flat on-camera flash, no muddy crushed blacks, no blown highlights
- Shoot it like a commissioned editorial photograph: considered camera angle, one dominant subject, supporting props that make the topic obvious at a glance, uncluttered background, believable lens character (natural bokeh, mild corner falloff, fine sensor grain) — never a CGI render, a stock cliché, or an AI-smooth plastic surface
- NATURAL COLOUR (hard requirement): true-to-life photographic colour grading. Do NOT tint, wash, duotone, or colour-grade the frame toward any brand or theme colour — skies stay sky-coloured, skin stays natural, buildings and objects keep their real material colours. A brand colour may appear only on a small prop or garment where it would occur naturally, never as an overall cast
- COMPOSITION (hard requirement): keep the subject and every important detail in the UPPER TWO THIRDS of the frame. The BOTTOM HALF must be calm, simple, uncluttered negative space (floor, wall, sky, water, blurred background, plain gradient) because a solid colour panel is composited over it. Nothing important may sit in the bottom half
- Leave the frame edges clean: no borders, frames, vignette text, collage panels or split-screen layouts`
    : type === 'cover'
    ? `\n\nDESIGNED BANNER COVER (CRITICAL): This is a WIDE 16:9 LANDSCAPE article cover designed like an agency service banner — a real full-bleed PHOTOGRAPH with flat graphic panels, cards and typography composited on top. It MUST include readable text rendered inside the image:
- TEXT INVENTORY (hard limit — these are the ONLY strings allowed anywhere in the image, copy them character-for-character):
  · headline, the dominant element: "${title}"
  · top-right circular badge: "อัปเดต ${CURRENT_YEAR}"${keyword.trim() ? `\n  · small keyword pill above the headline: "${keyword.trim()}" — but if that phrase already appears inside the headline, DROP the pill entirely and never draw it twice` : ''}${bannerCards.length ? `\n  · bottom card row, one single-line string per card, in this exact order: ${bannerCards.map((c) => `"${c}"`).join(' | ')}` : `\n  · no bottom card row at all — omit that band`}
- Do NOT invent, translate, shorten, reorder or repeat any string, and never write a phrase twice in the image. No phone numbers, LINE ids, emails, URLs, company names, slogans, benefit lines, prices or filler words. Copy digits, decimal points and punctuation exactly
- LAYOUT: left ~58% carries the headline stacked over 2–4 short lines, each line on its own opaque rounded-rectangle plate with a soft drop shadow, plates alternating between the theme colour with white type, white with dark type, and one accent-coloured plate for the line worth emphasising. Right ~35% carries a photorealistic cut-out person (or, if the topic has no people, the topic's hero object) lit to match the background. Bottom ~26% carries the card row: one single row only, never a second row, equal width, equal height, equal gaps, one flat icon in a coloured circle plus one short bold line of text per card, white rounded cards with soft shadows
- LAYERING: the card row sits in front of everything, including the person — nothing may cover a card or any part of a card's text; every card must show its full string
- MINIMUM TEXT SIZE (hard limit): every glyph in the image must be at least 4% of the image height. Small text is ALWAYS rendered as broken, misspelled glyphs, so if any label, caption, footer strip, chip or icon caption would end up smaller than that, DROP THE TEXT COMPLETELY and leave the icon with no label. An unlabelled icon is always better than small broken text
- TEXT PLATE (hard limit): every text element sits on its own opaque solid-colour plate, band, pill or card, never directly over busy photographic detail — contrast stays high and letterforms stay crisp
- THAI TYPOGRAPHY (when any Thai character appears): a plain, heavy, modern Thai sans-serif (Kanit / IBM Plex Sans Thai / Noto Sans Thai style). NO condensed, handwritten, script, outlined, 3D, distressed or decorative faces. No extra letter-spacing. Line height at least 1.6 so tone marks (วรรณยุกต์) and upper/lower vowels (สระบน/สระล่าง) have room and are never cut, merged or collided
- Render every character as clean, correctly-formed glyphs — keep every Thai tone mark and vowel attached to its own base letter in the correct position, spell every Latin word correctly; never split, merge, duplicate, mirror, warp or drop characters, and never swap look-alike Thai consonants (ด/ต, ป/บ, ภ/ท)
- Keep each Thai phrase on ONE unbroken line; never hyphenate Thai and never break a Thai word across lines. Break the headline into short lines of about 2–4 words each — short lines are rendered far more accurately than long ones
- NATURAL PHOTOGRAPHIC COLOUR (hard requirement): the photographic layer keeps true-to-life colour — sky stays blue (or a real golden-hour sky), skin stays natural, buildings and materials keep their real colours. The theme colour appears ONLY in the graphic layer and as a soft translucent gradient down the left side for legibility; never tint, duotone or colour-grade the whole frame toward the theme colour
- SAFE MARGIN (hard requirement): every panel, card, badge and glyph sits fully inside a margin of at least 4% from all four edges — nothing clipped by the frame, no borders, no vignette text, no collage or split-screen layout, no watermark
- Spell every word EXACTLY as provided — do not invent, translate, or misspell any text`
    : `\n\nNO TEXT (CRITICAL): This is an in-article illustration, not a cover. Render ZERO text: no headline, no article title, no labels, captions, chips, tags, numbers, units, logos, watermarks, signatures, and no text on screens, signs, or documents inside the scene. Tell the story with visuals only — objects, people, scenes, icons, graphic elements — keeping the style and colour palette from the brief. DETAIL (hard requirement): tack-sharp focus on the subject, rich micro-texture and real material surfaces, deliberate directional lighting with soft fill and a separating rim light, believable lens character (natural bokeh, fine grain) — editorial photography, never a CGI render, a stock cliché, or an AI-smooth plastic look. If the brief asks for a headline or captions, ignore that part.`
  const prompt = compiled + coverTextLine + orientationLine

  // เลือกสัดส่วนที่โมเดลรองรับให้ใกล้เป้าหมายที่สุด — crop ปลายทางจะเหลือน้อยลงมาก
  const aspectRatio = isSquare ? '1:1' as const : (width > height ? '3:2' as const : '2:3' as const)
  const result = await orImage({ trace: type === 'cover' ? 'image_cover' : 'image_inline', client, prompt, aspectRatio })

  const promptTokens = result.usage.inputTokens
  const totalTokens = result.usage.totalTokens
  const costUsd = Number(result.usage.costUsd.toFixed(6))

  // วางตัวหนังสือปกด้วยฟอนต์จริงทับภาพถ่าย ก่อนบีบอัด — โมเดลภาพสะกดไทยผิดเป็นประจำ
  // (ป→บ, ภ→ท, วรรณยุกต์หลุด) ส่วนฟอนต์จริงสะกดถูก 100% เสมอ
  let plateBase64 = result.base64
  let plateMime = result.mimeType
  if (type === 'cover' && COVER_TEXT_OVERLAY) {
    try {
      const composed = await composeCoverOverlay({
        image: Buffer.from(result.base64, 'base64'),
        title, keyword, width, height,
        subtitle: coverSubtitle,
        bullets: coverBullets,
        themeColor: themeColor.trim() || accentColor.trim(),
        accentColor: accentColor.trim(),
      })
      plateBase64 = composed.toString('base64')
      plateMime = 'image/png'
    } catch (err) {
      // overlay พังไม่ควรทำให้บทความไม่มีภาพ — ใช้ภาพถ่ายเปล่าไปก่อนแล้วรายงานไว้ใน log
      console.error('[image] cover overlay failed — ใช้ภาพถ่ายเปล่าแทน:', err)
    }
  }

  const { base64, mimeType, originalKB, compressedKB } =
    await compressToWebP(plateBase64, plateMime, type, width, height)

  console.log(`[image] ${type} via ${OR_MODELS.image()} ${originalKB}KB → ${compressedKB}KB (${Math.round((1 - compressedKB / originalKB) * 100)}% saved)`)

  return { imageBase64: base64, mimeType, promptTokens, totalTokens, costUsd }
}
