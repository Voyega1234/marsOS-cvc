/**
 * Cover text overlay — วางตัวหนังสือบนภาพปกด้วย "ฟอนต์จริง" ไม่ให้โมเดลภาพวาดตัวอักษรเอง
 *
 * ทำไมต้องมี: gpt-5-image วาดตัวอักษรไทยผิดเป็นประจำ (ป→บ, ภ→ท, สระ/วรรณยุกต์หลุด)
 * เพราะโมเดลวาดจากพิกเซล ไม่ได้ประกอบจากฟอนต์ วิธีเดียวที่สะกดถูก 100% คือเรา
 * วาดเอง: โมเดลสร้าง "ภาพถ่ายเปล่า" (ห้ามมีตัวอักษร) แล้วโค้ดวางบล็อกข้อความทับ
 *
 * เทคนิค: fontkit shape ข้อความ (GSUB/GPOS ครบ วรรณยุกต์ลอยถูกตำแหน่ง) → แปลงเป็น
 * <path> ใน SVG → sharp composite ทับภาพ  ไม่พึ่งฟอนต์ของเครื่องเลย จึงได้ผลเหมือนกัน
 * ทั้งบนเครื่องและบน Vercel (ฟอนต์อยู่ใน assets/fonts, IBM Plex Sans Thai — OFL)
 */
import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import * as fontkit from 'fontkit'

const FONT_DIR = path.join(process.cwd(), 'assets', 'fonts')
const FONT_FILES = {
  bold: 'IBMPlexSansThai-Bold.ttf',
  medium: 'IBMPlexSansThai-Medium.ttf',
} as const

type Weight = keyof typeof FONT_FILES
/* eslint-disable @typescript-eslint/no-explicit-any */
const fontCache = new Map<Weight, any>()

function loadFont(weight: Weight): any {
  const cached = fontCache.get(weight)
  if (cached) return cached
  const font = (fontkit as any).openSync(path.join(FONT_DIR, FONT_FILES[weight]))
  fontCache.set(weight, font)
  return font
}

// ── สี ────────────────────────────────────────────────────────────────────────

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const h = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1]
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

const toHex = (rgb: [number, number, number]) =>
  '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')

/** ความสว่างเชิงสายตา (0 = ดำ, 1 = ขาว) — ใช้เลือกสีตัวอักษรให้คอนทราสต์พอ */
function luminance(hex: string): number {
  const rgb = parseHex(hex)
  if (!rgb) return 0
  const [r, g, b] = rgb.map(v => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** amount > 0 = สว่างขึ้น, < 0 = เข้มลง */
function shade(hex: string, amount: number): string {
  const rgb = parseHex(hex)
  if (!rgb) return hex
  const target = amount > 0 ? 255 : 0
  return toHex(rgb.map(v => v + (target - v) * Math.abs(amount)) as [number, number, number])
}

// ── การจัดวางตัวอักษร ────────────────────────────────────────────────────────

/** สระ/วรรณยุกต์ที่ลอยอยู่กับพยัญชนะตัวหน้า — ห้ามขึ้นบรรทัดใหม่ด้วยตัวพวกนี้ */
const THAI_COMBINING = /[ัิ-ฺ็-๎]/
/** สระหน้า — ต้องอยู่ติดกับพยัญชนะตัวถัดไป ห้ามค้างท้ายบรรทัด */
const THAI_LEADING_VOWEL = /[เ-ไ]/

function measure(font: any, text: string, size: number): number {
  if (!text) return 0
  const run = font.layout(text)
  return (run.advanceWidth * size) / font.unitsPerEm
}

/** ตัดคำไทยด้วย ICU (Intl.Segmenter) — ไทยไม่มีช่องว่างระหว่างคำ ตัดตามช่องว่างอย่างเดียวไม่พอ */
function wordSegments(text: string): string[] {
  try {
    const seg = new Intl.Segmenter('th', { granularity: 'word' })
    return Array.from(seg.segment(text), (s: { segment: string }) => s.segment)
  } catch {
    return text.split(/(\s+)/).filter(Boolean)
  }
}

/**
 * ตัดบรรทัดแบบ "ถ่วงให้สมดุล" (Knuth-style DP) ไม่ใช่ greedy —
 * greedy อัดบรรทัดแรกจนเต็มแล้วทิ้งคำสองสามคำไว้บรรทัดสุดท้าย ซึ่งดูเป็นข้อความ
 * ที่ล้นมามากกว่าเป็นงานออกแบบ  DP นี้เลือกจุดตัดที่ทำให้ทุกบรรทัดยาวใกล้กัน
 * คืน null เมื่อมีคำเดี่ยวที่ยาวเกินความกว้างที่ให้ (ให้ผู้เรียกลดขนาดฟอนต์แล้วลองใหม่)
 * midBreaks = จำนวนบรรทัดที่ต้องตัดกลางวลี ใช้เป็นคะแนนคุณภาพตอนเลือกขนาดฟอนต์
 */
function balancedWrap(font: any, text: string, size: number, maxW: number): { lines: string[]; midBreaks: number } | null {
  // รวมช่องว่างเข้ากับคำหน้า — วัดความกว้างจากข้อความที่ trim แล้ว
  const tokens: string[] = []
  for (const seg of wordSegments(text.trim())) {
    if (!seg) continue
    if (/^\s+$/.test(seg) && tokens.length) tokens[tokens.length - 1] += seg
    else tokens.push(seg)
  }
  if (!tokens.length) return { lines: [], midBreaks: 0 }

  // กันสระหน้า/วรรณยุกต์หลุดข้ามบรรทัด: ผูกติดกับ token ข้างเคียงตั้งแต่ตอนนี้
  for (let i = tokens.length - 1; i > 0; i--) {
    if (THAI_COMBINING.test(tokens[i][0]) || THAI_LEADING_VOWEL.test(tokens[i - 1].trimEnd().slice(-1))) {
      tokens[i - 1] += tokens[i]
      tokens.splice(i, 1)
    }
  }

  const n = tokens.length
  const widthOf: number[][] = []
  for (let i = 0; i < n; i++) {
    widthOf[i] = []
    for (let j = i + 1; j <= n; j++) {
      widthOf[i][j] = measure(font, tokens.slice(i, j).join('').trim(), size)
    }
    if (widthOf[i][i + 1] > maxW) return null // คำเดี่ยวยาวเกิน — ต้องลดขนาดฟอนต์
  }

  // ขึ้นบรรทัดกลางวลี (ไม่ใช่ตรงเว้นวรรค) อ่านสะดุดมาก — ปรับให้แพงกว่าบรรทัดสั้นเสมอ
  const midPhrasePenalty = (maxW * 0.55) ** 2
  const extraLinePenalty = (maxW * 0.12) ** 2

  const cost = new Array<number>(n + 1).fill(Infinity)
  const from = new Array<number>(n + 1).fill(0)
  cost[0] = 0
  for (let j = 1; j <= n; j++) {
    for (let i = 0; i < j; i++) {
      const w = widthOf[i][j]
      if (w > maxW || cost[i] === Infinity) continue
      const slack = maxW - w
      // บรรทัดสุดท้ายสั้นได้เป็นเรื่องปกติ — ให้น้ำหนักน้อยกว่า ไม่งั้น DP จะยอมอัดบรรทัดอื่นแน่นเกิน
      const c = cost[i] + slack * slack * (j === n ? 0.32 : 1) + extraLinePenalty
        + (j < n && !/\s$/.test(tokens[j - 1]) ? midPhrasePenalty : 0)
      if (c < cost[j]) { cost[j] = c; from[j] = i }
    }
  }
  if (cost[n] === Infinity) return null

  const lines: string[] = []
  let midBreaks = 0
  for (let j = n; j > 0; j = from[j]) {
    lines.unshift(tokens.slice(from[j], j).join('').trim())
    if (j < n && !/\s$/.test(tokens[j - 1])) midBreaks++
  }
  return { lines: lines.filter(Boolean), midBreaks }
}

/** แปลงข้อความเป็น <path> ทีละตัวอักษร (shape แล้ว) — ไม่ต้องมีฟอนต์ตอน render */
function textPaths(font: any, text: string, size: number, x: number, baselineY: number): string {
  const run = font.layout(text)
  const s = size / font.unitsPerEm
  let pen = 0
  const out: string[] = []
  run.glyphs.forEach((glyph: any, i: number) => {
    const pos = run.positions[i]
    const d = glyph.path?.toSVG?.() ?? ''
    if (d) {
      const gx = x + (pen + (pos.xOffset || 0)) * s
      const gy = baselineY - (pos.yOffset || 0) * s
      out.push(`<path d="${d}" transform="translate(${gx.toFixed(2)} ${gy.toFixed(2)}) scale(${s.toFixed(5)} ${(-s).toFixed(5)})"/>`)
    }
    pen += pos.xAdvance || 0
  })
  return out.join('')
}

// ── ประกอบภาพปก ──────────────────────────────────────────────────────────────

export interface CoverOverlayInput {
  /** ภาพถ่ายจาก image model (ยังไม่มีตัวอักษร) */
  image: Buffer
  title: string
  keyword?: string
  width: number
  height: number
  /** ชุดสีธีมบทความจาก Article Lab */
  themeColor?: string
  accentColor?: string
}

/**
 * วางบล็อกข้อความสไตล์โปสเตอร์ทับภาพถ่าย:
 * แผงสีธีมฝั่งซ้ายขอบเฉียง + เส้น accent ตามรอยต่อ + headline + ป้ายคีย์เวิร์ด
 * คืน PNG buffer (ยังไม่บีบอัด — ให้ขั้นตอน compress ทำต่อ)
 */
export async function composeCoverOverlay(input: CoverOverlayInput): Promise<Buffer> {
  const { image, width: W, height: H } = input
  const title = input.title.trim()
  // คีย์เวิร์ดที่ซ้ำกับหัวเรื่องทั้งดุ้นไม่ได้เพิ่มข้อมูลอะไร มีแต่ทำให้ปกดูซ้ำซ้อน
  const keyword = (input.keyword ?? '').trim() === title ? '' : (input.keyword ?? '').trim()

  const theme = parseHex(input.themeColor || '') ? input.themeColor!.trim() : '#123A6B'
  const themeLum = luminance(theme)
  const ink = themeLum > 0.58 ? '#0B1220' : '#FFFFFF'
  let accent = parseHex(input.accentColor || '') ? input.accentColor!.trim() : shade(theme, 0.45)
  // accent ที่กลืนไปกับพื้นแผงใช้ไม่ได้ — สลับไปใช้เฉดที่ต่างพอ
  if (Math.abs(luminance(accent) - themeLum) < 0.14) accent = themeLum > 0.5 ? shade(theme, -0.5) : shade(theme, 0.55)
  // ป้ายคีย์เวิร์ดต้องแยกตัวจากพื้นแผงให้เห็น — ธีมเข้ามากอยู่แล้วต้องทำให้ "สว่างขึ้น" แทน
  const pillBg = themeLum > 0.58 ? shade(theme, -0.62)
    : themeLum < 0.1 ? shade(theme, 0.22)
    : shade(theme, -0.42)
  const pillInk = luminance(pillBg) > 0.58 ? '#0B1220' : '#FFFFFF'

  // ── โครงหน้า: ภาพถ่ายเต็มเฟรมเป็นพระเอก + แผงข้อความสีธีมที่ก้นภาพ ──
  // แผงสูงเท่าที่เนื้อหาต้องใช้จริง (ไม่ใช่ครึ่งภาพตายตัว) ภาพจึงได้พื้นที่มากที่สุด
  // และไม่มีพื้นสีโล่ง ๆ ที่อ่านเหมือนวางเลย์เอาต์ไม่เสร็จ  ขอบบนของแผงเฉียงเล็กน้อย
  // ให้รอยต่อมีจังหวะ ไม่ใช่แถบสี่เหลี่ยมทื่อ ๆ
  const padX = W * 0.072
  const textMaxW = W - padX * 2
  const tiltH = H * 0.035          // ความเฉียงของขอบบนแผง
  const padTop = H * 0.062
  const padBottom = H * 0.068

  const bold = loadFont('bold')
  const medium = loadFont('medium')

  // ไทยต้องการที่ให้วรรณยุกต์/สระบน-ล่าง ละตินไม่ต้อง — ใช้ระยะบรรทัดคนละค่า
  const lineRatio = /[\u0E00-\u0E7F]/.test(title) ? 1.4 : 1.24
  const kwGap = H * 0.032
  const minSize = Math.round(H * 0.052)
  const maxPanelH = H * 0.52

  const kwSizeFor = (s: number) => Math.max(20, Math.min(s * 0.36, H * 0.034))
  const pillHFor = (s: number) => kwSizeFor(s) * 2.15

  // เลือกขนาดที่ "ดีที่สุด" ไม่ใช่ "ใหญ่ที่สุดที่ลง": ตัวใหญ่แต่ต้องตัดคำกลางวลีทุกบรรทัด
  // อ่านยากกว่าตัวเล็กลงหน่อยแต่ขึ้นบรรทัดตรงเว้นวรรค — ให้คะแนนทั้งสองอย่างแล้วเทียบ
  const panelHFor = (s: number, lineCount: number) =>
    padTop + lineCount * s * lineRatio + (keyword.trim() ? kwGap + pillHFor(s) : 0) + padBottom

  let size = minSize
  let lines: string[] = []
  let bestScore = -1
  for (let s = Math.round(H * 0.1); s >= minSize; s -= 2) {
    const attempt = balancedWrap(bold, title.trim(), s, textMaxW)
    if (!attempt || attempt.lines.length > 4) continue
    if (panelHFor(s, attempt.lines.length) > maxPanelH) continue
    const score = s * Math.pow(0.62, attempt.midBreaks)
    if (score > bestScore) { bestScore = score; size = s; lines = attempt.lines }
  }
  // เผื่อ title ยาวผิดปกติจนไม่มีขนาดไหนลงเลย — ยอมให้ล้นที่ขนาดเล็กสุด ดีกว่าไม่มีหัวเรื่อง
  if (!lines.length) {
    size = minSize
    lines = balancedWrap(bold, title.trim(), size, textMaxW)?.lines ?? [title.trim()]
  }
  const lh = size * lineRatio
  const kwSize = kwSizeFor(size)
  const pillH = pillHFor(size)

  const panelH = panelHFor(size, lines.length)
  const panelTopL = H - panelH          // ขอบบนแผงฝั่งซ้าย
  const panelTopR = panelTopL + tiltH   // ฝั่งขวาต่ำลงเล็กน้อย

  // ── ป้ายคีย์เวิร์ด (eyebrow): แถบสีเข้ม + ขีด accent ด้านซ้าย วางนำหัวเรื่อง ──
  let pillSvg = ''
  let contentTop = panelTopL + padTop
  if (keyword.trim()) {
    const kw = keyword.trim()
    const stripe = Math.max(5, kwSize * 0.17)
    const padPill = kwSize * 0.8
    const maxTextW = textMaxW - stripe - padPill * 2
    // คีย์เวิร์ดยาวเกินป้าย: ย่อขนาดตัวอักษรให้พอดี ดีกว่าปล่อยให้ล้นออกนอกแถบ
    const fitSize = Math.min(kwSize, kwSize * (maxTextW / Math.max(1, measure(medium, kw, kwSize))))
    const pillW = measure(medium, kw, fitSize) + padPill * 2 + stripe
    const pillY = contentTop
    const r = Math.round(pillH * 0.26)
    pillSvg = `
    <g>
      <rect x="${padX.toFixed(1)}" y="${pillY.toFixed(1)}" width="${pillW.toFixed(1)}" height="${pillH.toFixed(1)}" rx="${r}" fill="${pillBg}" fill-opacity="0.94"/>
      <rect x="${padX.toFixed(1)}" y="${(pillY + r * 0.35).toFixed(1)}" width="${stripe}" height="${(pillH - r * 0.7).toFixed(1)}" rx="${(stripe / 2).toFixed(1)}" fill="${accent}"/>
      <g fill="${pillInk}">${textPaths(medium, kw, fitSize, padX + stripe + padPill, pillY + pillH / 2 + fitSize * 0.34)}</g>
    </g>`
    contentTop += pillH + kwGap
  }

  // ── headline ──
  let headlineSvg = ''
  lines.forEach((line, i) => {
    headlineSvg += textPaths(bold, line, size, padX, contentTop + lh * i + size * 0.84)
  })

  const seamW = Math.max(4, W * 0.005)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="panel" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0" stop-color="${shade(theme, themeLum > 0.58 ? -0.06 : 0.1)}"/>
      <stop offset="1" stop-color="${shade(theme, themeLum > 0.58 ? 0.14 : -0.24)}"/>
    </linearGradient>
    <linearGradient id="blend" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${theme}" stop-opacity="0"/>
      <stop offset="1" stop-color="${theme}" stop-opacity="0.42"/>
    </linearGradient>
  </defs>

  <!-- ไล่สีธีมจาง ๆ เหนือแผง ให้ภาพถ่ายกับแผงต่อกันเนียน ไม่ใช่แปะทับ -->
  <rect x="0" y="${(panelTopL - H * 0.26).toFixed(1)}" width="${W}" height="${(H * 0.26 + tiltH).toFixed(1)}" fill="url(#blend)"/>

  <!-- แผงข้อความ ขอบบนเฉียง -->
  <path d="M 0 ${panelTopL.toFixed(1)} L ${W} ${panelTopR.toFixed(1)} L ${W} ${H} L 0 ${H} Z" fill="url(#panel)"/>
  <!-- เส้น accent ตามรอยต่อ — คมและบางเพื่อคั่นภาพกับแผงให้ชัด -->
  <path d="M 0 ${panelTopL.toFixed(1)} L ${W} ${panelTopR.toFixed(1)}" stroke="${accent}" stroke-width="${seamW.toFixed(1)}" fill="none"/>

  ${pillSvg}
  <g fill="${ink}">${headlineSvg}</g>
</svg>`

  const themeRgb = parseHex(theme) ?? [18, 58, 107]
  return sharp(image)
    // ครอปจากกึ่งกลางเสมอ — saliency ('attention') ชอบเลื่อนกรอบไปตัดตัวแบบหลักทิ้ง
    .resize(W, H, { fit: 'cover', position: 'centre' })
    .composite([
      // เกรดโทนภาพถ่ายให้เข้ากับสีธีมนิดหน่อย — ภาพกับแผงจะดูเป็นชุดเดียวกัน
      { input: { create: { width: W, height: H, channels: 4, background: { r: themeRgb[0], g: themeRgb[1], b: themeRgb[2], alpha: 0.07 } } }, blend: 'soft-light' },
      { input: Buffer.from(svg), top: 0, left: 0 },
    ])
    .png()
    .toBuffer()
}
