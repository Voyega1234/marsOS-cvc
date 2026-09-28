// ─── Upload Article — แปลงต้นฉบับ (docx/txt/md/html/Google Doc) เป็น semantic HTML ──
// ห้ามพึ่งพา prisma/session — ฟังก์ชันล้วน (pure) เพื่อให้ unit test เรียกตรง ๆ ได้

import { parse, NodeType, TextNode, type HTMLElement } from 'node-html-parser'
import { cleanSemanticHtml, sanitizeHref, sanitizeImgSrc } from './clean-html'
import { DriveHttpError, safeGoogleFetch, shrinkImageToDataUrl } from './drive-folder'

export interface ImportResult {
  title: string
  html: string
  /** คำเตือนที่ไม่ทำให้ import ล้ม เช่น รูปในเอกสารถูกตัดเพราะข้อมูลรวมเกินเพดาน */
  warnings?: string[]
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** ดึงชื่อเรื่อง: H1 แรก || heading แรก || บรรทัด/ย่อหน้าแรกที่มีตัวอักษร (≤200 ตัว) || fallback */
export function extractTitleFromHtml(html: string, fallback = ''): string {
  const root = parse(html)
  const h1 = root.querySelector('h1')
  if (h1 && h1.text.trim()) return h1.text.trim().slice(0, 200)
  const heading = root.querySelector('h2, h3, h4, h5, h6')
  if (heading && heading.text.trim()) return heading.text.trim().slice(0, 200)
  for (const child of root.childNodes) {
    if (child.nodeType !== NodeType.ELEMENT_NODE) continue
    const t = (child as import('node-html-parser').HTMLElement).text.replace(/\s+/g, ' ').trim()
    if (t) return t.slice(0, 200)
  }
  return fallback
}

function cleanedResult(rawHtml: string, fallbackTitle = ''): ImportResult {
  const html = cleanSemanticHtml(rawHtml)
  return { title: extractTitleFromHtml(html, fallbackTitle), html }
}

/** นำเข้า HTML ดิบ (paste / .html / .htm) */
export function importFromHtml(html: string, fallbackTitle = ''): ImportResult {
  return cleanedResult(html, fallbackTitle)
}

function plainTextToHtml(text: string): string {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/)
  const out: string[] = []
  for (const block of blocks) {
    const trimmed = block.trim()
    if (!trimmed) continue
    const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean)
    if (lines.length === 0) continue

    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(lines[0])
    if (lines.length === 1 && headingMatch) {
      const level = headingMatch[1].length
      out.push(`<h${level}>${escapeHtml(headingMatch[2])}</h${level}>`)
      continue
    }

    if (lines.every((l) => /^[-•*]\s+/.test(l))) {
      const items = lines.map((l) => `<li>${escapeHtml(l.replace(/^[-•*]\s+/, ''))}</li>`).join('')
      out.push(`<ul>${items}</ul>`)
      continue
    }
    if (lines.every((l) => /^\d+\.\s+/.test(l))) {
      const items = lines.map((l) => `<li>${escapeHtml(l.replace(/^\d+\.\s+/, ''))}</li>`).join('')
      out.push(`<ol>${items}</ol>`)
      continue
    }

    out.push(`<p>${lines.map(escapeHtml).join('<br>')}</p>`)
  }
  return out.join('\n')
}

const COMMENT_LINE_RE = /^\[([a-z]{1,3})\]\S/

/**
 * ตัด marker คอมเมนต์ของ Google Docs ที่ export เป็น .txt ทิ้ง (ตัวเอกสารไม่มีทางลบคอมเมนต์ให้เองตอน export)
 * รูปแบบ: inline marker "[a]" ต่อท้ายข้อความที่ถูกคอมเมนต์ + บรรทัดคอมเมนต์ท้ายเอกสาร "[a]ข้อความคอมเมนต์"
 * ตัดเฉพาะ label ที่เจอเป็นบรรทัดคอมเมนต์จริง (ขึ้นต้นบรรทัด) — ไม่มีบรรทัดแบบนี้เลยแปลว่าไม่ใช่คอมเมนต์ ไม่แตะวงเล็บเหลี่ยมอื่น
 */
function stripGoogleDocsCommentMarkers(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const labels = new Set<string>()
  for (const line of lines) {
    const m = COMMENT_LINE_RE.exec(line)
    if (m) labels.add(m[1])
  }
  if (labels.size === 0) return text

  const keptLines = lines.filter((line) => !COMMENT_LINE_RE.test(line))
  let out = keptLines.join('\n')
  for (const label of Array.from(labels)) {
    out = out.replace(new RegExp(`\\[${label}\\]`, 'g'), '')
  }
  return out
}

/** นำเข้าข้อความล้วน (.txt) — เดา heading เฉพาะบรรทัดที่ขึ้นด้วย # เท่านั้น */
export function importFromText(text: string, fallbackTitle = ''): ImportResult {
  const html = plainTextToHtml(stripGoogleDocsCommentMarkers(text))
  return cleanedResult(html, fallbackTitle)
}

function mdInline(s: string): string {
  let out = escapeHtml(s)
  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, url) => {
    const src = sanitizeImgSrc(url)
    return src ? `<img src="${src}" alt="${alt}">` : ''
  })
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, txt, url) => {
    const href = sanitizeHref(url)
    return href ? `<a href="${href}">${txt}</a>` : txt
  })
  out = out.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_m, a, b) => `<strong>${a ?? b}</strong>`)
  out = out.replace(/\*([^*]+)\*|_([^_]+)_/g, (_m, a, b) => `<em>${a ?? b}</em>`)
  return out
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line) && line.includes('-')
}

function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      out.push(`<h${h[1].length}>${mdInline(h[2].trim())}</h${h[1].length}>`)
      i++
      continue
    }

    if (/^>\s?/.test(line)) {
      const buf: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''))
        i++
      }
      out.push(`<blockquote><p>${mdInline(buf.join(' ').trim())}</p></blockquote>`)
      continue
    }

    if (line.includes('|') && lines[i + 1] && isTableSeparator(lines[i + 1])) {
      const parseRow = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
      const headerCells = parseRow(line)
      i += 2
      const bodyRows: string[][] = []
      while (i < lines.length && lines[i].includes('|')) {
        bodyRows.push(parseRow(lines[i]))
        i++
      }
      const thead = `<tr>${headerCells.map((c) => `<th>${mdInline(c)}</th>`).join('')}</tr>`
      const tbody = bodyRows.map((r) => `<tr>${r.map((c) => `<td>${mdInline(c)}</td>`).join('')}</tr>`).join('')
      out.push(`<table><thead>${thead}</thead><tbody>${tbody}</tbody></table>`)
      continue
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''))
        i++
      }
      out.push(`<ul>${items.map((it) => `<li>${mdInline(it.trim())}</li>`).join('')}</ul>`)
      continue
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''))
        i++
      }
      out.push(`<ol>${items.map((it) => `<li>${mdInline(it.trim())}</li>`).join('')}</ol>`)
      continue
    }

    const buf: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i])
    ) {
      buf.push(lines[i])
      i++
    }
    out.push(`<p>${mdInline(buf.join(' ').trim())}</p>`)
  }
  return out.join('\n')
}

/** นำเข้า Markdown (.md/.markdown) */
export function importFromMarkdown(md: string, fallbackTitle = ''): ImportResult {
  const html = markdownToHtml(md)
  return cleanedResult(html, fallbackTitle)
}

/** เพดานรวมของรูปที่ฝังเป็น data URI ในเอกสารเดียว (กัน response เกิน 4.5MB ของ Vercel) */
const MAX_TOTAL_DOCX_IMAGE_BYTES = 2.5 * 1024 * 1024

/** นำเข้าไฟล์ตามนามสกุล — docx ใช้ mammoth, อื่น ๆ ใช้ตัวแปลงข้างต้น */
export async function importFromFile(name: string, buffer: Buffer): Promise<ImportResult> {
  const ext = (name.split('.').pop() || '').toLowerCase()
  const baseTitle = name.replace(/\.[^.]+$/, '')

  if (ext === 'docx') {
    const mammoth = await import('mammoth')
    let usedBytes = 0
    let droppedCount = 0
    // ล้น alt ของรูปที่ตัดทิ้งให้ว่างเปล่า (ไม่ใช่ literal ตรง ๆ กัน TS excess-property check กับ type ของ mammoth
    // ที่ประกาศแค่ { src: string } แต่ runtime merge attribute เพิ่มได้จริง)
    const droppedAttrs: { src: string; alt: string } = { src: '', alt: '' }
    const convertImage = mammoth.images.imgElement(async (image) => {
      if (usedBytes >= MAX_TOTAL_DOCX_IMAGE_BYTES) {
        droppedCount++
        return droppedAttrs
      }
      try {
        const raw = Buffer.from(await image.readAsBase64String(), 'base64')
        const dataUrl = await shrinkImageToDataUrl(raw)
        const bytes = Buffer.byteLength(dataUrl, 'utf-8')
        if (usedBytes + bytes > MAX_TOTAL_DOCX_IMAGE_BYTES) {
          droppedCount++
          return droppedAttrs
        }
        usedBytes += bytes
        return { src: dataUrl }
      } catch {
        droppedCount++
        return droppedAttrs
      }
    })
    const result = await mammoth.convertToHtml({ buffer }, { convertImage })
    const out = cleanedResult(result.value, baseTitle)
    if (droppedCount > 0) {
      out.warnings = [
        ...(out.warnings ?? []),
        `ตัดรูปในเอกสารออก ${droppedCount} รูป (ข้อมูลรูปรวมเกิน ~2.5MB ต่อบทความ)`,
      ]
    }
    return out
  }
  if (ext === 'txt') {
    return importFromText(buffer.toString('utf-8'), baseTitle)
  }
  if (ext === 'md' || ext === 'markdown') {
    return importFromMarkdown(buffer.toString('utf-8'), baseTitle)
  }
  if (ext === 'html' || ext === 'htm') {
    return importFromHtml(buffer.toString('utf-8'), baseTitle)
  }
  throw new Error(`ไม่รองรับไฟล์นามสกุล .${ext || '?'}`)
}

const GOOGLE_DOC_ID_RE = /\/document\/d\/([a-zA-Z0-9_-]+)/

/** ดึงเนื้อหาจาก Google Doc ที่แชร์แบบ Anyone with the link (SSRF guard: เฉพาะ docs.google.com) */
export async function fetchGoogleDoc(url: string): Promise<ImportResult> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('ลิงก์ Google Doc ไม่ถูกต้อง')
  }
  if (parsed.hostname !== 'docs.google.com') {
    throw new Error('รองรับเฉพาะลิงก์ docs.google.com เท่านั้น')
  }
  const m = GOOGLE_DOC_ID_RE.exec(parsed.pathname)
  if (!m) {
    throw new Error('ลิงก์ Google Doc ไม่ถูกต้อง — ต้องมีรูปแบบ /document/d/<ID>/')
  }
  const id = m[1]
  const exportUrl = `https://docs.google.com/document/d/${id}/export?format=html`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
  let res: Response
  try {
    // ตาม redirect เองทีละ hop ตรวจโดเมนทุก hop (กัน SSRF) — redirect ไป accounts.google.com = ยังไม่แชร์สาธารณะ
    res = await safeGoogleFetch(exportUrl, controller.signal)
  } catch (e) {
    if (e instanceof DriveHttpError && e.status === 401) {
      throw new Error('เอกสารต้องแชร์แบบ Anyone with the link')
    }
    throw new Error(`ดึง Google Doc ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    clearTimeout(timeout)
  }

  if (res.status === 401 || res.status === 403) {
    throw new Error('เอกสารต้องแชร์แบบ Anyone with the link')
  }
  if (!res.ok) {
    throw new Error(`ดึง Google Doc ไม่สำเร็จ (HTTP ${res.status})`)
  }

  const contentType = res.headers.get('content-type') || ''
  const MAX = 10 * 1024 * 1024
  const reader = res.body?.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > MAX) throw new Error('เอกสารใหญ่เกินไป (จำกัด 10MB)')
      chunks.push(value)
    }
  }
  const html = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf-8')

  if (!contentType.includes('text/html') || /accounts\.google\.com|ServiceLogin|"Sign in"/i.test(html.slice(0, 3000))) {
    throw new Error('เอกสารต้องแชร์แบบ Anyone with the link')
  }

  return cleanedResult(html)
}
