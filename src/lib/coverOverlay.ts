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
 *
 * กติกาสี (คำสั่งเจ้าของระบบ 2026-08-25): ภาพถ่ายต้องสีธรรมชาติ ห้ามย้อมสีธีมทับ —
 * สีธีมอยู่ได้เฉพาะกราฟิกที่วาดทับ (แผง/ตัวหนังสือ/ป้าย/ไอคอน) เท่านั้น
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

/** แตกข้อความเป็น token คำ พร้อมผูกสระหน้า/วรรณยุกต์ให้ติดคำข้างเคียง — ใช้ร่วมกันทุกตัวตัดบรรทัด */
function tokenize(text: string): string[] {
  const tokens: string[] = []
  for (const seg of wordSegments(text.trim())) {
    if (!seg) continue
    if (/^\s+$/.test(seg) && tokens.length) tokens[tokens.length - 1] += seg
    else tokens.push(seg)
  }
  for (let i = tokens.length - 1; i > 0; i--) {
    if (THAI_COMBINING.test(tokens[i][0]) || THAI_LEADING_VOWEL.test(tokens[i - 1].trimEnd().slice(-1))) {
      tokens[i - 1] += tokens[i]
      tokens.splice(i, 1)
    }
  }
  return tokens
}

/**
 * ตัดบรรทัดแบบ "ถ่วงให้สมดุล" (Knuth-style DP) ไม่ใช่ greedy —
 * greedy อัดบรรทัดแรกจนเต็มแล้วทิ้งคำสองสามคำไว้บรรทัดสุดท้าย ซึ่งดูเป็นข้อความ
 * ที่ล้นมามากกว่าเป็นงานออกแบบ  DP นี้เลือกจุดตัดที่ทำให้ทุกบรรทัดยาวใกล้กัน
 * คืน null เมื่อมีคำเดี่ยวที่ยาวเกินความกว้างที่ให้ (ให้ผู้เรียกลดขนาดฟอนต์แล้วลองใหม่)
 * midBreaks = จำนวนบรรทัดที่ต้องตัดกลางวลี ใช้เป็นคะแนนคุณภาพตอนเลือกขนาดฟอนต์
 */
function balancedWrap(font: any, text: string, size: number, maxW: number): { lines: string[]; midBreaks: number } | null {
  const tokens = tokenize(text)
  if (!tokens.length) return { lines: [], midBreaks: 0 }

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

/** ข้อความบรรทัดเดียว ยาวเกินให้จบด้วย … — ใช้กับ bullet ที่พื้นที่ตายตัว */
function ellipsisFit(font: any, text: string, size: number, maxW: number): string {
  if (measure(font, text, size) <= maxW) return text
  let t = text
  while (t.length > 1 && measure(font, t.trimEnd() + '…', size) > maxW) t = t.slice(0, -1)
  return t.trimEnd() + '…'
}

/** ตัดบรรทัดแบบ greedy จำกัดจำนวนบรรทัด เกินโควตาให้จบบรรทัดสุดท้ายด้วย … — ใช้กับคำโปรย */
function clampWrap(font: any, text: string, size: number, maxW: number, maxLines: number): string[] {
  const tokens = tokenize(text)
  const lines: string[] = []
  let cur = ''
  for (let i = 0; i < tokens.length; i++) {
    const next = cur + tokens[i]
    if (cur && measure(font, next.trim(), size) > maxW) {
      lines.push(cur.trim())
      cur = tokens[i]
      if (lines.length === maxLines) {
        // มีของเหลือแต่โควตาบรรทัดหมด — ยุบส่วนเกินเข้าบรรทัดสุดท้ายแล้วเติม …
        const rest = lines[maxLines - 1] + ' ' + tokens.slice(i).join('')
        lines[maxLines - 1] = ellipsisFit(font, rest.trim(), size, maxW)
        return lines
      }
    } else {
      cur = next
    }
  }
  if (cur.trim()) lines.push(cur.trim())
  return lines.slice(0, maxLines)
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
  /** คำโปรยสั้น (เช่น meta description) — แสดงใต้ headline ไม่เกิน 2 บรรทัด ถ้าที่พอ */
  subtitle?: string
  /** จุดขาย/หัวข้อเด่นของบทความ (เช่น H2 จริง) — แถวไอคอนติ๊กถูก สูงสุด 3 ข้อ */
  bullets?: string[]
  width: number
  height: number
  /** ชุดสีธีมบทความจาก Article Lab */
  themeColor?: string
  accentColor?: string
}

/**
 * วางบล็อกข้อความสไตล์โปสเตอร์ทับภาพถ่าย:
 * แผงสีธีมก้นภาพขอบเฉียง + เส้น accent + ป้ายคีย์เวิร์ด + headline + คำโปรย + bullet
 * คืน PNG buffer (ยังไม่บีบอัด — ให้ขั้นตอน compress ทำต่อ)
 */
export async function composeCoverOverlay(input: CoverOverlayInput): Promise<Buffer> {
  const { image, width: W, height: H } = input
  const title = input.title.trim()
  // คีย์เวิร์ด/คำโปรย/bullet ที่ซ้ำกับหัวเรื่องทั้งดุ้นไม่ได้เพิ่มข้อมูล มีแต่ทำให้ปกดูซ้ำซ้อน
  const keyword = (input.keyword ?? '').trim() === title ? '' : (input.keyword ?? '').trim()
  const subtitleRaw = (input.subtitle ?? '').trim() === title ? '' : (input.subtitle ?? '').trim()
  const bulletsAll = (input.bullets ?? [])
    .map(b => b.trim())
    .filter(b => b && b !== title && b !== keyword)
    .slice(0, 3)

  const theme = parseHex(input.themeColor || '') ? input.themeColor!.trim() : '#123A6B'
  const themeLum = luminance(theme)
  const ink = themeLum > 0.58 ? '#0B1220' : '#FFFFFF'
  let accent = parseHex(input.accentColor || '') ? input.accentColor!.trim() : shade(theme, 0.45)
  // accent ที่กลืนไปกับพื้นแผงใช้ไม่ได้ — สลับไปใช้เฉดที่ต่างพอ
  if (Math.abs(luminance(accent) - themeLum) < 0.14) accent = themeLum > 0.5 ? shade(theme, -0.5) : shade(theme, 0.55)
  // ป้ายคีย์เวิร์ดต้องแยกตัวจากพื้นแผงให้เห็น — ธีมเข้มมากอยู่แล้วต้องทำให้ "สว่างขึ้น" แทน
  const pillBg = themeLum > 0.58 ? shade(theme, -0.62)
    : themeLum < 0.1 ? shade(theme, 0.22)
    : shade(theme, -0.42)
  const pillInk = luminance(pillBg) > 0.58 ? '#0B1220' : '#FFFFFF'
  const checkInk = luminance(accent) > 0.58 ? '#0B1220' : '#FFFFFF'

  // ── โครงหน้า: ภาพถ่ายเต็มเฟรมเป็นพระเอก + แผงข้อความสีธีมที่ก้นภาพ ──
  // แผงสูงเท่าที่เนื้อหาต้องใช้จริง (ไม่ใช่ครึ่งภาพตายตัว) ภาพจึงได้พื้นที่มากที่สุด
  // ขอบบนของแผงเฉียงเล็กน้อยให้รอยต่อมีจังหวะ ไม่ใช่แถบสี่เหลี่ยมทื่อ ๆ
  const padX = W * 0.072
  const textMaxW = W - padX * 2
  const tiltH = H * 0.035          // ความเฉียงของขอบบนแผง
  const padTop = H * 0.055
  const padBottom = H * 0.06

  const bold = loadFont('bold')
  const medium = loadFont('medium')

  // ไทยต้องการที่ให้วรรณยุกต์/สระบน-ล่าง ละตินไม่ต้อง — ใช้ระยะบรรทัดคนละค่า
  const lineRatio = /[฀-๿]/.test(title) ? 1.4 : 1.24
  const kwGap = H * 0.028
  const minSize = Math.round(H * 0.052)

  const kwSizeFor = (s: number) => Math.max(20, Math.min(s * 0.36, H * 0.034))
  const pillHFor = (s: number) => kwSizeFor(s) * 2.15

  // ขนาดส่วนข้อมูลรอง — ตายตัวไม่ผูกกับขนาด headline เพื่อให้คำนวณความสูงแผงตรงไปตรงมา
  const subSize = Math.max(19, Math.round(H * 0.027))
  const subLineH = subSize * 1.62
  const subGap = H * 0.024
  const bulletSize = Math.max(19, Math.round(H * 0.028))
  const bulletRowH = bulletSize * 2.0
  const bulletGap = H * 0.026
  const iconR = bulletSize * 0.68

  const subLinesAll = subtitleRaw ? clampWrap(medium, subtitleRaw, subSize, textMaxW, 2) : []

  const panelHFor = (s: number, lineCount: number, nBullets: number, nSubLines: number) =>
    padTop
    + (keyword ? pillHFor(s) + kwGap : 0)
    + lineCount * s * lineRatio
    + (nSubLines ? subGap + nSubLines * subLineH : 0)
    + (nBullets ? bulletGap + nBullets * bulletRowH : 0)
    + padBottom

  // เลือกขนาดที่ "ดีที่สุด" ไม่ใช่ "ใหญ่ที่สุดที่ลง": ตัวใหญ่แต่ต้องตัดคำกลางวลีทุกบรรทัด
  // อ่านยากกว่าตัวเล็กลงหน่อยแต่ขึ้นบรรทัดตรงเว้นวรรค — ให้คะแนนทั้งสองอย่างแล้วเทียบ
  const pickSize = (nBullets: number, nSubLines: number, maxPanelH: number) => {
    let best: { size: number; lines: string[]; score: number } | null = null
    for (let s = Math.round(H * 0.1); s >= minSize; s -= 2) {
      const attempt = balancedWrap(bold, title, s, textMaxW)
      if (!attempt || attempt.lines.length > 4) continue
      if (panelHFor(s, attempt.lines.length, nBullets, nSubLines) > maxPanelH) continue
      const score = s * Math.pow(0.62, attempt.midBreaks)
      if (!best || score > best.score) best = { size: s, lines: attempt.lines, score }
    }
    return best
  }

  // ข้อมูลรองใส่ได้เท่าที่ headline ยังมีที่หายใจ — ที่ไม่พอให้สละคำโปรยก่อน แล้วค่อยลด bullet
  const hasExtras = bulletsAll.length > 0 || subLinesAll.length > 0
  const maxPanelH = hasExtras ? H * 0.62 : H * 0.52
  let bullets = [...bulletsAll]
  let subLines = [...subLinesAll]
  let picked = pickSize(bullets.length, subLines.length, maxPanelH)
  while (!picked) {
    if (subLines.length) subLines = []
    else if (bullets.length) bullets.pop()
    else break
    picked = pickSize(bullets.length, subLines.length, bullets.length || subLines.length ? maxPanelH : H * 0.52)
  }

  let size = picked?.size ?? minSize
  let lines = picked?.lines ?? []
  // เผื่อ title ยาวผิดปกติจนไม่มีขนาดไหนลงเลย — ยอมให้ล้นที่ขนาดเล็กสุด ดีกว่าไม่มีหัวเรื่อง
  if (!lines.length) {
    size = minSize
    lines = balancedWrap(bold, title, size, textMaxW)?.lines ?? [title]
  }
  const lh = size * lineRatio
  const kwSize = kwSizeFor(size)
  const pillH = pillHFor(size)

  const panelH = panelHFor(size, lines.length, bullets.length, subLines.length)
  const panelTopL = H - panelH          // ขอบบนแผงฝั่งซ้าย
  const panelTopR = panelTopL + tiltH   // ฝั่งขวาต่ำลงเล็กน้อย

  // ── ป้ายคีย์เวิร์ด (eyebrow): แถบสีเข้ม + ขีด accent ด้านซ้าย วางนำหัวเรื่อง ──
  let pillSvg = ''
  let contentTop = panelTopL + padTop
  if (keyword) {
    const stripe = Math.max(5, kwSize * 0.17)
    const padPill = kwSize * 0.8
    const maxTextW = textMaxW - stripe - padPill * 2
    // คีย์เวิร์ดยาวเกินป้าย: ย่อขนาดตัวอักษรให้พอดี ดีกว่าปล่อยให้ล้นออกนอกแถบ
    const fitSize = Math.min(kwSize, kwSize * (maxTextW / Math.max(1, measure(medium, keyword, kwSize))))
    const pillW = measure(medium, keyword, fitSize) + padPill * 2 + stripe
    const pillY = contentTop
    const r = Math.round(pillH * 0.26)
    pillSvg = `
    <g>
      <rect x="${padX.toFixed(1)}" y="${pillY.toFixed(1)}" width="${pillW.toFixed(1)}" height="${pillH.toFixed(1)}" rx="${r}" fill="${pillBg}" fill-opacity="0.94"/>
      <rect x="${padX.toFixed(1)}" y="${(pillY + r * 0.35).toFixed(1)}" width="${stripe}" height="${(pillH - r * 0.7).toFixed(1)}" rx="${(stripe / 2).toFixed(1)}" fill="${accent}"/>
      <g fill="${pillInk}">${textPaths(medium, keyword, fitSize, padX + stripe + padPill, pillY + pillH / 2 + fitSize * 0.34)}</g>
    </g>`
    contentTop += pillH + kwGap
  }

  // ── headline ──
  let headlineSvg = ''
  lines.forEach((line, i) => {
    headlineSvg += textPaths(bold, line, size, padX, contentTop + lh * i + size * 0.84)
  })
  contentTop += lines.length * lh

  // ── คำโปรย (subtitle) — น้ำหนักกลาง จางกว่า headline นิดหน่อยให้ลำดับอ่านชัด ──
  let subSvg = ''
  if (subLines.length) {
    contentTop += subGap
    subLines.forEach((line, i) => {
      subSvg += textPaths(medium, line, subSize, padX, contentTop + subLineH * i + subSize * 0.84)
    })
    contentTop += subLines.length * subLineH
  }

  // ── bullet จุดขาย: วงกลม accent + เครื่องหมายถูก + ข้อความ (แบบโปสเตอร์การตลาด) ──
  let bulletsSvg = ''
  if (bullets.length) {
    contentTop += bulletGap
    const textX = padX + iconR * 2 + bulletSize * 0.62
    const bulletMaxW = W - padX - textX
    bullets.forEach((b, i) => {
      const rowMid = contentTop + bulletRowH * i + bulletRowH / 2
      const text = ellipsisFit(medium, b, bulletSize, bulletMaxW)
      bulletsSvg += `
    <g>
      <circle cx="${(padX + iconR).toFixed(1)}" cy="${rowMid.toFixed(1)}" r="${iconR.toFixed(1)}" fill="${accent}"/>
      <path d="M ${(padX + iconR * 0.55).toFixed(1)} ${rowMid.toFixed(1)} L ${(padX + iconR * 0.9).toFixed(1)} ${(rowMid + iconR * 0.34).toFixed(1)} L ${(padX + iconR * 1.5).toFixed(1)} ${(rowMid - iconR * 0.34).toFixed(1)}"
        stroke="${checkInk}" stroke-width="${(iconR * 0.26).toFixed(1)}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <g fill="${ink}" fill-opacity="0.96">${textPaths(medium, text, bulletSize, textX, rowMid + bulletSize * 0.34)}</g>
    </g>`
    })
    contentTop += bullets.length * bulletRowH
  }

  const seamW = Math.max(4, W * 0.005)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="panel" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0" stop-color="${shade(theme, themeLum > 0.58 ? -0.06 : 0.1)}"/>
      <stop offset="1" stop-color="${shade(theme, themeLum > 0.58 ? 0.14 : -0.24)}"/>
    </linearGradient>
    <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.22"/>
    </linearGradient>
  </defs>

  <!-- เงากลาง ๆ เหนือแผงให้รอยต่อนุ่มลง — จงใจไม่ใช้สีธีม: ภาพถ่ายต้องคงสีธรรมชาติ -->
  <rect x="0" y="${(panelTopL - H * 0.14).toFixed(1)}" width="${W}" height="${(H * 0.14 + tiltH).toFixed(1)}" fill="url(#ground)"/>

  <!-- แผงข้อความ ขอบบนเฉียง -->
  <path d="M 0 ${panelTopL.toFixed(1)} L ${W} ${panelTopR.toFixed(1)} L ${W} ${H} L 0 ${H} Z" fill="url(#panel)"/>
  <!-- เส้น accent ตามรอยต่อ — คมและบางเพื่อคั่นภาพกับแผงให้ชัด -->
  <path d="M 0 ${panelTopL.toFixed(1)} L ${W} ${panelTopR.toFixed(1)}" stroke="${accent}" stroke-width="${seamW.toFixed(1)}" fill="none"/>

  ${pillSvg}
  <g fill="${ink}">${headlineSvg}</g>
  <g fill="${ink}" fill-opacity="0.82">${subSvg}</g>
  ${bulletsSvg}
</svg>`

  return sharp(image)
    // ครอปจากกึ่งกลางเสมอ — saliency ('attention') ชอบเลื่อนกรอบไปตัดตัวแบบหลักทิ้ง
    .resize(W, H, { fit: 'cover', position: 'centre' })
    // ไม่มีเลเยอร์ย้อมสีธีมทับภาพถ่ายอีกแล้ว (คำสั่งเจ้าของ 2026-08-25: สีภาพต้องธรรมชาติ)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer()
}
