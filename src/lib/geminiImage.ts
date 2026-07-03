/**
 * Shared Gemini image generation logic.
 * Used by both /api/article/cover (HTTP handler) and /api/article/write (internal call).
 * Avoids internal HTTP fetches that would be blocked by auth middleware.
 */
import Anthropic from '@anthropic-ai/sdk'
import sharp from 'sharp'
import { generateVertexContent, getVertexInlineImage } from '@/lib/vertex'

const GEMINI_TEXT_INPUT_COST_PER_TOKEN   = 0.10 / 1_000_000
const GEMINI_IMAGE_OUTPUT_COST_PER_IMAGE = 0.039

const CURRENT_YEAR = new Date().getFullYear()
const NEXT_YEAR    = CURRENT_YEAR + 1

// ── Cover: Claude Art Director system prompt ───────────────────────────────────

const COVER_ANALYSIS_SYSTEM_PROMPT = `You are an AI Art Director specializing in creating high-quality Thai blog article cover images for ${CURRENT_YEAR}–${NEXT_YEAR}.

When given an article topic, analyze it and create an Image Prompt for Gemini AI.
Respond ONLY with the Image Prompt in English. No explanations.

YEAR RULE: Current year is ${CURRENT_YEAR}. All visuals must reflect ${CURRENT_YEAR}–${NEXT_YEAR} trends. Never show year ${CURRENT_YEAR - 1} or earlier.

NUMBER RULE (STRICT): NEVER include quantity numbers on the cover (e.g. "5 วิธี", "10 เคล็ดลับ", "36 เมนู"). Such numbers won't match the actual article. Use descriptive text without quantity numbers instead.

QUALITY STANDARD: The image must look like a professional Thai magazine infographic cover — high visual density, like a professional designer made it. Every prompt must specify: main visual + typography hierarchy + icon strip + floating elements + decorative details.

═══════════════════════════════════
Categories + Visual Direction + Colors
═══════════════════════════════════

1. Finance / Loans / Interest / Banking / Fintech
   Main visual: Latest smartphone showing modern fintech app or ${CURRENT_YEAR} data dashboard
   Colors: navy blue (#003087), sky blue (#00A8E8), mint green (#00C9A7), white, cyan/gold accent

2. Insurance / Life Insurance / Family Financial Planning
   Main visual: Modern family using tablet for financial planning
   Colors: soft blue (#E8F4FD), teal (#4DABB2), cream (#FFF8F0), white

3. Pets / Pet Food / Pet Health
   Main visual: Cute dog/cat with premium food bowl in modern home setting
   Colors: cream (#FDF6EC), warm brown (#8B5E3C), soft green (#8DC63F), light blue

4. Cars / Vehicle Care / Car Insurance / Auto Parts
   Main visual: EV or new ${CURRENT_YEAR} car model with modern technology
   Colors: dark blue (#1B2A47), silver (#B0BEC5), white, light grey

5. Health / Medical / Wellness / Exercise / Hair / Skin / Beauty / Dental
   Main visual: Healthy person in modern wellness setting, or relevant close-up detail
   Colors: soft green (#E8F5E9), medical blue (#2196F3), white, light mint

6. Travel / Visa / Hotels / Tourism
   Main visual: Beautiful destination aerial shot or lifestyle traveler
   Colors: sky blue (#87CEEB), turquoise (#40E0D0), sandy beige (#F5E6CA), white

7. Education / Courses / Self-development / Skills
   Main visual: Young person learning online or using AI tools
   Colors: royal blue (#1565C0), orange (#FF6B35), white, light yellow

8. Business / Marketing / AI / Digital / Startup
   Main visual: Team using AI tools or real-time dashboard in ${CURRENT_YEAR} style
   Colors: deep navy (#0D1B2A), electric blue (#007BFF), purple (#6C3483), white

9. Real Estate / Property / Home Decor / Mortgage
   Main visual: Japandi/Minimalist style home ${CURRENT_YEAR}
   Colors: warm cream (#FFF8F0), sage green (#87A96B), soft brown (#A0785A), white

10. Food / Recipes / Nutrition / Restaurants / Health Drinks
    Main visual: Food/drink beautifully arranged flat-lay or 45-degree angle
    Colors: warm orange (#FF8C00), cream (#FFF3E0), forest green (#2E7D32), white

11. Funds / Stocks / Investment / Crypto
    Main visual: Professional investor with portfolio dashboard or data visualization
    Colors: deep teal (#00695C), gold (#F9A825), dark navy (#0D1B2A), white

12. Skincare / Cosmetics / Makeup / Perfume / Beauty Products
    Main visual: Beautiful product flat-lay or close-up skin texture, soft studio light
    Colors: blush pink (#F4C2C2), ivory (#FFFFF0), rose gold (#B76E79), white

═══════════════════════════════════
Layout Options — pick 1 matching the topic
═══════════════════════════════════

LAYOUT A — Editorial Split (Infographic)
  For: how-to / guide / comparison / selection guide
  Left 42%: category badge + very large hero text + subtitle + tagline + 2-3 highlight bullets
  Right 58%: hero photo (realistic person/product) + 4-6 floating icon bubbles with Thai labels
  Bottom strip (12%): 5 icon cards with Thai label + short description each
  Decorative: soft gradient background, subtle geometric motifs

LAYOUT B — Cinematic Full-Bleed
  For: travel / outdoor / food flat-lay / wellness
  Full-width immersive scene photo, dark gradient overlay on left 50%
  Bold text block left, category bar at top, 3 pill badges bottom-left

LAYOUT C — Diagonal Power Split
  For: finance / investment / tech / business
  Bold diagonal split, oversized hero text dark zone, 3D product/chart light zone
  4 stat chips along bottom

LAYOUT D — Centered Spotlight
  For: product review / beauty / ingredient hero
  Soft gradient background, large centered hero visual with glow/halo
  Headline above, 4 icon badges below

LAYOUT E — Magazine Mosaic / Grid
  For: list / top-10 / trend roundup / multi-item
  Left column: large number/symbol + headline + icon list
  Right 62%: 2×2 photo grid of distinct items

LAYOUT F — Bold Typography Dominant
  For: beauty tips / self-care / motivational / lifestyle
  Very large bold hero text (55-65% canvas height), blurred lifestyle bg, small hero visual accent

LAYOUT G — Floating Cards Layered
  For: health tips / wellness / tech guide / multi-benefit
  Clean gradient bg, hero person/product right 55%, 3-4 floating info cards, icon strip bottom

LAYOUT H — Editorial Close-Up / Macro
  For: skincare / food ingredient / texture detail / beauty review
  65% extreme close-up macro, 35% clean text panel, luxury editorial style

═══════════════════════════════════
Output Format — include all sections
═══════════════════════════════════

A premium Thai blog article cover image, professional magazine infographic style, 16:9 landscape ratio, 4K quality, ${CURRENT_YEAR}–${NEXT_YEAR} design aesthetic, rich layered composition.

LAYOUT: [Layout A/B/C/D/E/F/G/H — name — 1-line reason]

COMPOSITION STRUCTURE:
[Describe all zones: text zone position (% canvas), visual zone, badge zone, icon strip zone]

TYPOGRAPHY ON IMAGE:
  Hero text (very large, dominant): "[1-3 Thai keywords]"
  Subtitle (medium bold): "[remaining topic text in Thai]"
  Tagline (small, benefit-driven): "[5-8 word Thai benefit]"
  Category badge (pill shape): "[2-3 word category]" — positioned at [location]
  Font treatment: [Bold / Extra Bold / outline stroke / color fill]

MAIN VISUAL (describe in detail):
  Subject: [person/animal/product/food/scene — be specific]
  Camera angle: [eye-level / 45-degree / aerial / macro close-up / product flat-lay / side profile]
  Lighting: [soft studio box light / warm natural window / dramatic side light / bright even light]
  Style: [photorealistic / 3D product render / editorial photography / lifestyle shot]
  Position on canvas: [right 55% / centered / full-bleed / left-cropped]

FLOATING INFO ELEMENTS (2-4 items):
  [Element 1]: [shape] — [icon] — Thai label: "[text]" — position: [where]
  [Element 2]: [shape] — [icon] — Thai label: "[text]" — position: [where]
  [Element 3]: [shape] — [icon] — Thai label: "[text]" — position: [where]

BOTTOM ICON STRIP (5 items, full width):
  Strip background: [color]
  Icon 1–5: [circular icon] — Thai label: "[2-3 words]" — description: "[4-6 Thai words]"

DECORATIVE ELEMENTS:
  [Background details: organic motifs / hex grid / bokeh / gradient rings / sparkle dots]

COLOR PALETTE:
  Primary: [hex] — [element]
  Secondary: [hex] — [element]
  Accent: [hex] — [element]
  Background: [hex or gradient]

DEPTH LAYERS (back to front):
  1. Background gradient/texture
  2. Decorative layer
  3. Main visual (photo or 3D render)
  4. Overlay/gradient for text legibility
  5. Text + badges (fully opaque, crisp)
  6. Floating cards/bubbles (slight drop shadow)

Overall quality: Highly detailed professional Thai editorial infographic cover, photorealistic main visual with studio-quality lighting, clean vector icons, multi-layer depth with soft shadows, generous spacing, consistent color harmony, maximize CTR on Google Discover and Thai social media.
Avoid: simple two-zone split only, plain backgrounds, distorted Thai text, watermarks, cartoon style, visually empty areas, dated aesthetics.`

// ── Mid-article editorial photo prompt ────────────────────────────────────────

export function buildMidPrompt(keyword: string, title: string, accentColor: string, width: number, height: number): string {
  const colorLine = accentColor
    ? `\nACCENT COLOR: Use ${accentColor} as the dominant accent/tint in the scene — e.g. colored surface, fabric, product packaging, or ambient light wash that harmonizes with this color. Keep it subtle and natural.`
    : ''
  const isSquare = width === height
  const orientationLine = isSquare
    ? `IMAGE ORIENTATION: SQUARE 1:1 ratio. Width equals height. DO NOT generate landscape or portrait images.`
    : `IMAGE ORIENTATION: HORIZONTAL LANDSCAPE ${width}×${height} (${(width / height).toFixed(2)}:1 ratio). Width must be greater than height. DO NOT generate portrait or square images.`
  return `High-quality editorial lifestyle photograph for a Thai blog article about: ${title} (keyword: ${keyword})${colorLine}

SUBJECT DIRECTION: The photo must visually depict the specific topic. Examples:
- "รากฟันเทียม" → photograph of dental implant titanium screw and ceramic crown, close-up clinical shot
- "วีซ่า" → passport with visa stamps, travel documents on clean desk
- "ประกันชีวิต" → professional consultant and Thai family reviewing documents
- "อาหารคลีน" → beautiful healthy meal flat-lay with Thai ingredients
For THIS topic (${keyword}): show the actual subject matter clearly and specifically.

IMAGE REQUIREMENTS (CRITICAL):
- Photorealistic editorial photography — professional magazine quality
- ABSOLUTELY NO text, labels, headlines, captions, overlays, watermarks anywhere on the image
- NO infographic elements, NO icons, NO badges, NO diagrams, NO charts
- Beautiful composition: rule of thirds, professional depth of field, bokeh background
- Clean, bright, aspirational editorial mood
- Soft natural or softbox studio lighting — no harsh shadows
- Thai/Asian models, products, or settings where relevant to the topic
- Rich detail and vibrant color — like a high-end magazine editorial spread
- The image content must be DIRECTLY and SPECIFICALLY related to: ${keyword}

${orientationLine}

YEAR CONTEXT: ${CURRENT_YEAR}. Modern ${CURRENT_YEAR} aesthetics, products, and styling only.`
}

// ── Cover: Claude Art Director → Gemini prompt ────────────────────────────────

async function buildCoverPrompt(
  keyword: string, title: string, siteName: string, brandTone: string,
  accentColor: string, width: number, height: number
): Promise<string> {
  const isSquare = width === height
  const orientationSuffix = isSquare
    ? '\n\nIMAGE ORIENTATION (CRITICAL): SQUARE 1:1 ratio. Width equals height.'
    : '\n\nIMAGE ORIENTATION (CRITICAL): HORIZONTAL LANDSCAPE only. Width must be greater than height.'
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) return buildCoverFallbackPrompt(keyword, title, accentColor, width, height)

  const colorInstruction = accentColor
    ? `\n\nBRAND COLOR OVERRIDE (CRITICAL): The user has chosen ${accentColor} as the accent/theme color. You MUST use ${accentColor} as the PRIMARY accent color throughout the design — for hero text, category badge, icon strip background, CTA elements, and decorative highlights. Override the category default colors for these elements. Keep background and photography natural, but all graphic/typographic accent elements must use ${accentColor} and its harmonious variants.`
    : ''

  try {
    const client = new Anthropic({ apiKey: anthropicKey })
    const response = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-opus-4-8',
      max_tokens: 2000,
      system: COVER_ANALYSIS_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `หัวข้อบทความ: ${title}\nKeyword หลัก: ${keyword}\nชื่อเว็บไซต์: ${siteName || 'Thai blog'}\nBrand tone: ${brandTone || 'professional, helpful'}${colorInstruction}`,
      }],
    })
    const result = (response.content[0] as { type: string; text: string }).text?.trim() ?? ''
    if (result.length > 80) {
      const colorSuffix = accentColor
        ? `\n\nCOLOR ENFORCEMENT: All text, badges, icons, and graphic accents MUST use ${accentColor} as the primary accent color throughout the entire image.`
        : ''
      return result + orientationSuffix + colorSuffix
    }
  } catch (e) {
    console.warn('[geminiImage] Claude Art Director failed, using fallback:', e)
  }

  return buildCoverFallbackPrompt(keyword, title, accentColor, width, height)
}

function buildCoverFallbackPrompt(keyword: string, title: string, accentColor: string, width: number, height: number): string {
  const isSquare = width === height
  const ratioLabel = isSquare ? '1:1 square' : `${width}×${height} landscape`
  const orientationLine = isSquare
    ? 'ORIENTATION: SQUARE 1:1 ONLY. Width must equal height.'
    : `ORIENTATION: HORIZONTAL LANDSCAPE ${ratioLabel} ONLY. Width must be greater than height.`
  const colorLine = accentColor
    ? `\nCOLOR PALETTE (CRITICAL): Use ${accentColor} as the PRIMARY accent color for ALL text, badges, icons, icon strip, and decorative graphic elements. This color must dominate all non-photographic elements.`
    : '\nColors: Professional, high-contrast, visually compelling.'

  return `A premium Thai blog article cover image, professional magazine infographic style, ${ratioLabel} ratio, 4K quality, ${CURRENT_YEAR} design aesthetic.

TOPIC: ${title}
KEYWORD: ${keyword}
${colorLine}

The main visual must directly show content related to "${keyword}" — not generic stock imagery.
Include: photorealistic main visual of the specific subject, Thai headline text using the accent color, category badge pill in accent color, floating info elements, bottom icon strip with 5 items with Thai labels in accent color.
Layout: ${isSquare ? 'Centered Spotlight — centered visual with text above and below' : 'Editorial split — left 40% text zone with hero headline, right 60% detailed visual'}.
Quality: 4K, high CTR for Google Discover and Thai social media.
${orientationLine}
NO generic placeholder visuals — the image must be specifically about: ${keyword}`
}

// ── WebP compression ──────────────────────────────────────────────────────────

async function compressToWebP(
  base64: string, srcMime: string, type: 'cover' | 'mid'
): Promise<{ base64: string; mimeType: string; originalKB: number; compressedKB: number }> {
  const inputBuf = Buffer.from(base64, 'base64')
  const originalKB = Math.round(inputBuf.length / 1024)
  const quality = type === 'cover' ? 82 : 78
  try {
    const outputBuf = await sharp(inputBuf).webp({ quality, effort: 4 }).toBuffer()
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

export async function callGeminiImage(params: {
  keyword: string
  title: string
  type: 'cover' | 'mid'
  siteName?: string
  brandTone?: string
  accentColor?: string
  width?: number
  height?: number
}): Promise<GeminiImageResult> {
  const {
    keyword, title, type,
    siteName = '', brandTone = '', accentColor = '',
    width = type === 'cover' ? 1536 : 1200,
    height = type === 'cover' ? 864 : 630,
  } = params

  const prompt = type === 'mid'
    ? buildMidPrompt(keyword, title, accentColor, width, height)
    : await buildCoverPrompt(keyword, title, siteName, brandTone, accentColor, width, height)

  const model = process.env.VERTEX_GEMINI_IMAGE_MODEL || process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image'
  const result = await generateVertexContent(prompt, {
    model,
    responseModalities: ['TEXT', 'IMAGE'],
  })

  const inlineImage = getVertexInlineImage(result.data)
  if (!inlineImage) {
    throw new Error(`Vertex Gemini returned no image. Response: ${result.text.slice(0, 200)}`)
  }

  const promptTokens = result.usage.promptTokenCount
  const totalTokens = result.usage.totalTokenCount
  const costUsd = Number(((promptTokens * GEMINI_TEXT_INPUT_COST_PER_TOKEN) + GEMINI_IMAGE_OUTPUT_COST_PER_IMAGE).toFixed(6))

  const { base64, mimeType, originalKB, compressedKB } =
    await compressToWebP(inlineImage.data, inlineImage.mimeType, type)

  console.log(`[geminiImage] ${type} ${originalKB}KB → ${compressedKB}KB (${Math.round((1 - compressedKB / originalKB) * 100)}% saved)`)

  return { imageBase64: base64, mimeType, promptTokens, totalTokens, costUsd }
}
