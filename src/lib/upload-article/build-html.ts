// ─── Upload Article — ประกอบ semantic HTML ให้พร้อมขึ้นเว็บ (deterministic) ──────
// ห้าม เพิ่ม/ลบ/เรียบเรียงคำ ของผู้เขียนต้นฉบับเด็ดขาด — ฟังก์ชันนี้จัดโครง/แต่งหน้าเท่านั้น
// ไม่พึ่งพา prisma/session — เรียกตรงจาก unit test ได้

import { parse, HTMLElement, NodeType, TextNode, type Node } from 'node-html-parser'
import { wrapArticleHtml } from '@/lib/articleComponents'
import { buildArticleSchema, stripSchemaScripts } from '@/lib/articleSchema'
import { type UploadOutputMode, type UploadTheme } from './types'
import { buildUploadCss } from './theme-css'
import { decodeTextEntities } from './entities'
import { stripGoogleDocsCommentsHtml } from './clean-html'
import { resolveArticleLanguage } from '@/lib/keyword-language'
import type { UploadCtaSettings } from './cta'
import { buildAuthorCardHtml, type AuthorCardStyle } from '@/lib/articleAuthorCard'
import type { AuthorProfile } from './author'

export interface BuildUploadOptions {
  sourceHtml: string
  mode: UploadOutputMode
  theme: UploadTheme
  site: { name: string; url: string; language: 'th' | 'en' }
  meta: { title: string; seoTitle?: string; metaDescription?: string; slug?: string }
  cover?: { url: string; alt: string } | null
  breadcrumb?: boolean
  /** ตั้งค่า CTA ของลูกค้า (Project Setting > CTA) — ใช้สร้าง CSS ของกล่อง CTA ที่อยู่ในเนื้อหา */
  cta?: UploadCtaSettings
  /** ผู้เขียนที่เลือกให้บทความนี้แล้ว (Project Setting > Author Box) — ไม่ส่ง/null = ไม่ใส่กล่องผู้เขียน */
  author?: { profile: AuthorProfile; style: AuthorCardStyle } | null
}

export interface BuildUploadResult {
  html: string
  plainText: string
  faqCount: number
  h2Count: number
}

const FAQ_HEADING_RE = /FAQ|คำถามที่พบบ่อย|คำถามยอดฮิต|Q\s*&\s*A|ถาม.?ตอบ|frequently asked|คำถามที่(หลายคน|คน|ผู้อ่าน|ลูกค้า)?(มัก|ชอบ)?(ถาม|สงสัย)/i
// หัวข้อที่บอกว่า FAQ จบแล้ว (หัวข้อระดับเดียวกับคำถามแต่ไม่ใช่คำถาม)
const FAQ_END_RE = /อ้างอิง|แหล่งที่มา|แหล่งข้อมูล|^\s*(บท)?สรุป|บทความที่เกี่ยวข้อง|อ่านเพิ่มเติม|ติดต่อ|references?|sources?|related|conclusion|summary|contact/i

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function slugifyId(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/** parse เนื้อหาเป็น block ระดับบนสุด (HTMLElement[]) — ครอบ text node ที่หลุดให้เป็น <p> */
function parseTopLevelBlocks(html: string): HTMLElement[] {
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
  const root = parse(cleaned, { comment: false })
  const out: HTMLElement[] = []
  for (const child of root.childNodes) {
    if (child.nodeType === NodeType.ELEMENT_NODE) {
      out.push(child as HTMLElement)
    } else if (child.nodeType === NodeType.TEXT_NODE && !(child as TextNode).isWhitespace) {
      const wrapped = parse(`<p>${(child as TextNode).rawText}</p>`)
      out.push(wrapped.childNodes[0] as HTMLElement)
    }
  }
  return out
}

/** บังคับให้เหลือ H1 เดียว: คง H1 แรกของต้นฉบับ / โปรโมท heading แรก / แทรกใหม่จาก meta.title */
function normalizeH1(blocks: HTMLElement[], title: string): number {
  let h1Index = blocks.findIndex((b) => b.tagName.toLowerCase() === 'h1')
  if (h1Index === -1) {
    if (blocks.length > 0 && /^h[2-6]$/i.test(blocks[0].tagName)) {
      blocks[0].tagName = 'h1'
      h1Index = 0
    } else {
      const h1El = parseTopLevelBlocks(`<h1>${escapeHtml(title)}</h1>`)[0]
      blocks.unshift(h1El)
      h1Index = 0
    }
  } else {
    for (let i = h1Index + 1; i < blocks.length; i++) {
      if (blocks[i].tagName.toLowerCase() === 'h1') blocks[i].tagName = 'h2'
    }
  }
  return h1Index
}

/** ใส่ id ภาษาอังกฤษที่เสถียรให้ทุก H2 (สำหรับ TOC/anchor) คืนจำนวน H2 */
function assignH2Ids(blocks: HTMLElement[]): number {
  const usedIds = new Set<string>()
  let count = 0
  for (const b of blocks) {
    if (b.tagName.toLowerCase() !== 'h2') continue
    count++
    let base = slugifyId(b.text)
    if (!base) base = `section-${count}`
    let id = base
    let n = 2
    while (usedIds.has(id)) {
      id = `${base}-${n}`
      n++
    }
    usedIds.add(id)
    b.setAttribute('id', id)
  }
  return count
}

function isBoldOnlyParagraph(el: HTMLElement): boolean {
  const kids = el.childNodes.filter((n) => !(n.nodeType === NodeType.TEXT_NODE && (n as TextNode).isWhitespace))
  if (kids.length !== 1) return false
  const only = kids[0]
  if (only.nodeType !== NodeType.ELEMENT_NODE) return false
  const tag = (only as HTMLElement).tagName.toLowerCase()
  return tag === 'strong' || tag === 'b'
}

/** ย่อหน้าที่ขึ้นต้นด้วยตัวหนา เช่น <p><strong>Q2</strong> ต่อสัญญาได้ไหม</p> */
function startsWithBold(el: HTMLElement): boolean {
  const first = el.childNodes.find((n) => !(n.nodeType === NodeType.TEXT_NODE && (n as TextNode).isWhitespace))
  if (!first || first.nodeType !== NodeType.ELEMENT_NODE) return false
  const tag = (first as HTMLElement).tagName.toLowerCase()
  return tag === 'strong' || tag === 'b'
}

// ย่อหน้าคำถามต้องสั้น — กันย่อหน้าคำตอบที่บังเอิญลงท้ายด้วยคำถาม
const MAX_PARAGRAPH_QUESTION_LENGTH = 160
const Q_PREFIX_RE = /^(Q|ถาม)\s*\d*\s*[:：.)]/i

function isQuestionBlock(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase()
  if (tag === 'h3' || tag === 'h4') return true
  if (tag !== 'p') return false
  const text = el.text.trim()
  if (!text) return false
  if (isBoldOnlyParagraph(el)) return true
  if (Q_PREFIX_RE.test(text)) return true
  if (text.length > MAX_PARAGRAPH_QUESTION_LENGTH) return false
  if (/[?？؟]$/.test(text)) return true
  // คำถามภาษาไทยที่ไม่มี "?" (กฎ human voice ห้ามใส่ ? ถ้าไม่จำเป็น) — ลงท้ายคำถามชัด หรือขึ้นต้นตัวหนาและมีสัญญาณคำถาม
  return THAI_QUESTION_RE.test(text) || (startsWithBold(el) && hasQuestionSignal(el))
}

// คำถามภาษาไทยมักลงท้ายด้วยคำสร้อย (ครับ/คะ/ดี/บ้าง/กัน) หลังคำถาม เช่น "เลือกชั้นไหนดี" "คิดยังไงบ้าง"
const THAI_QUESTION_RE = /(ไหม|มั้ย|ไหน|หรือไม่|หรือเปล่า|หรือยัง|อย่างไร|ยังไง|เท่าไร|เท่าไหร่|อะไร|ทำไม|เมื่อไร|เมื่อไหร่|ที่ไหน|ใคร|บ้าง|กี่\S{0,8})(\s*(ครับ|คะ|ค่ะ|นะ|ดี|บ้าง|กัน|เลย|เหรอ|หรอ))*\s*$/
// \b ใช้กับอักษรไทยไม่ได้ (ไม่นับเป็น word char) — แยกคำขึ้นต้นไทยกับอังกฤษ
const QUESTION_START_RE = /^(ทำไม|อย่างไร|ยังไง|ใคร|เมื่อไร|เมื่อไหร่|ที่ไหน)|^(what|how|why|when|where|who|which|can|could|do|does|is|are|should|will)\b/i

/** มีสัญญาณว่าเป็นคำถามจริง (ลงท้าย ?, ขึ้นต้น Q:/ถาม:, หรือมีคำถามภาษาไทย) — ไว้แยกคำถามออกจากหัวข้อทั่วไปอย่าง "แหล่งอ้างอิง" */
function hasQuestionSignal(el: HTMLElement): boolean {
  const text = el.text.replace(/\s+/g, ' ').trim()
  if (/[?？؟]$/.test(text)) return true
  if (Q_PREFIX_RE.test(text)) return true
  if (QUESTION_START_RE.test(text)) return true
  return THAI_QUESTION_RE.test(text)
}

// ตาราง brief ของผู้เขียน (Keyword / Search Volume / Title Count / Slug ...) — ไม่ใช่เนื้อหาบทความ
const BRIEF_LABEL_RE = /^(main( keyword)?|long ?tail|keywords?|search volume|focus keyword|title( count)?|meta title|(meta )?description( count)?|slug|url)\b/i
// หัวข้อที่ผู้เขียนบอกเองว่าไม่ต้องขึ้นเว็บ เช่น "แหล่งอ้างอิง (ไม่ใส่ลงเว็บไซต์)"
const NOT_FOR_WEB_RE = /ไม่(ต้อง)?\s*(ใส่|ลง|เอา|นำ)(ลง|ขึ้น|ไป)?\s*(ใน)?\s*เว็บ|not for (the )?(web|website|publish)|do not publish/i

function isBriefTable(el: HTMLElement): boolean {
  if (el.tagName.toLowerCase() !== 'table') return false
  let hits = 0
  for (const row of el.querySelectorAll('tr')) {
    const first = row.querySelector('td, th')
    if (first && BRIEF_LABEL_RE.test(first.text.replace(/\s+/g, ' ').trim())) hits++
  }
  return hits >= 2
}

function headingLevel(el: HTMLElement): number {
  const m = /^h([1-6])$/.exec(el.tagName.toLowerCase())
  return m ? Number(m[1]) : 0
}

/** ตัดส่วนที่ไม่ใช่เนื้อหาบทความออก (ตาราง brief SEO + หัวข้อที่ระบุว่าไม่ใส่ลงเว็บพร้อมเนื้อหาใต้หัวข้อนั้น) */
function stripAuthorNotes(blocks: HTMLElement[]): HTMLElement[] {
  const out: HTMLElement[] = []
  for (let i = 0; i < blocks.length; i++) {
    const el = blocks[i]
    if (isBriefTable(el)) continue
    const level = headingLevel(el)
    const isMarker = (level > 0 || isBoldOnlyParagraph(el)) && NOT_FOR_WEB_RE.test(el.text)
    if (!isMarker) {
      out.push(el)
      continue
    }
    // ข้ามเนื้อหาใต้หัวข้อนี้จนถึงหัวข้อระดับเดียวกันหรือสูงกว่า (ย่อหน้าตัวหนา = จนถึงหัวข้อถัดไป)
    let j = i + 1
    while (j < blocks.length) {
      const l = headingLevel(blocks[j])
      if (l > 0 && (level === 0 || l <= level)) break
      j++
    }
    i = j - 1
  }
  return out
}

/** แปลงคู่ Q/A ใน section ให้เป็น <details class="content-faq__item"> — คืน null ถ้าไม่เจอคู่เลย (ปล่อยผ่าน) */
function convertFaqSection(section: HTMLElement[]): { blocks: HTMLElement[]; count: number } | null {
  // มีคำถามเป็นหัวข้อ (H3/H4) → ยึดหัวข้อเป็นคำถาม ย่อหน้าก่อนหน้าเป็นบทนำ (กันย่อหน้าเกริ่นที่ลงท้าย "?" กลายเป็นคำถาม)
  const headingIdx = section.findIndex((b) => /^h[34]$/i.test(b.tagName))
  const leadIdx = headingIdx !== -1 ? headingIdx : section.findIndex(isQuestionBlock)
  if (leadIdx === -1) return null
  const lead = section.slice(0, leadIdx)
  const rest = section.slice(leadIdx)

  // รูปแบบคำถามยึดตามคำถามแรก: หัวข้อ (h3/h4) หรือย่อหน้า — คำถามข้อต่อ ๆ ไปต้องเป็นรูปแบบเดียวกัน
  // (เดิมเจอหัวข้อที่ไม่มี "?" หรือคำตอบตัวหนาแล้วตัด FAQ ทิ้งทันที → เหลือ 1 ข้อ)
  const qLevel = headingLevel(rest[0])
  /** มีหัวข้อระดับเดียวกันที่เป็นคำถามชัด ๆ ถัดจากตำแหน่ง i ไปไหม (ก่อนเจอหัวข้อที่ใหญ่กว่า) */
  const laterSignalHeading = (i: number): boolean => {
    for (let j = i + 1; j < rest.length; j++) {
      const l = headingLevel(rest[j])
      if (l > 0 && l < qLevel) return false
      if (l === qLevel && hasQuestionSignal(rest[j])) return true
    }
    return false
  }

  const groups: Array<{ q: HTMLElement; a: HTMLElement[] }> = []
  let current: { q: HTMLElement; a: HTMLElement[] } | null = null
  let sawSignal = false
  let tail: HTMLElement[] = []
  for (let i = 0; i < rest.length; i++) {
    const el = rest[i]
    const level = headingLevel(el)
    const signal = hasQuestionSignal(el)
    let isQuestion = false
    if (qLevel > 0) {
      // คำถามเป็นหัวข้อ: หัวข้อใหญ่กว่า = จบ FAQ, หัวข้อย่อยกว่า/ย่อหน้าตัวหนา = ส่วนของคำตอบ
      if (level > 0 && level < qLevel) {
        tail = rest.slice(i)
        break
      }
      if (level === qLevel && !signal) {
        // หัวข้อระดับเดียวกันที่ไม่ใช่คำถาม (เช่น "แหล่งอ้างอิง") → FAQ จบ
        // ยกเว้นยังมีคำถามชัด ๆ ตามมาอีก หรือทั้ง FAQ ไม่มีคำถามที่มีสัญญาณเลย
        if (FAQ_END_RE.test(el.text) || (sawSignal && !laterSignalHeading(i))) {
          tail = rest.slice(i)
          break
        }
      }
      isQuestion = level === qLevel
    } else if (level > 0) {
      // คำถามเป็นย่อหน้า แต่เจอหัวข้อ — เป็นคำถามต่อได้เฉพาะถ้าเป็นคำถามชัด ไม่งั้นจบ FAQ
      if (!signal || FAQ_END_RE.test(el.text)) {
        tail = rest.slice(i)
        break
      }
      isQuestion = true
    } else if (isQuestionBlock(el)) {
      // ย่อหน้าตัวหนาที่ไม่มีสัญญาณคำถามหลังเจอคำถามจริงแล้ว = คำตอบที่เน้นตัวหนา ไม่ใช่คำถามใหม่
      isQuestion = !(sawSignal && !signal)
    }

    if (isQuestion) {
      if (signal) sawSignal = true
      if (current) groups.push(current)
      current = { q: el, a: [] }
    } else if (current) {
      current.a.push(el)
    }
  }
  if (current) groups.push(current)
  if (groups.length === 0) return null

  const converted: HTMLElement[] = []
  for (const g of groups) {
    // ห่อคำถามด้วย span เดียว — summary เป็น flex ถ้ามีหลาย inline child (ตัวหนาแตกหลายก้อนจาก Google Docs) ข้อความจะถูกดันไปกลางกล่อง
    const qHtml = g.q.innerHTML.trim()
    const aHtml = g.a.map((b) => b.outerHTML).join('\n')
    const detailsHtml = `<details class="content-faq__item"><summary class="content-faq__question"><span class="content-faq__q">${qHtml}</span></summary><div class="content-faq__answer">${aHtml}</div></details>`
    converted.push(parseTopLevelBlocks(detailsHtml)[0])
  }
  return { blocks: [...lead, ...converted, ...tail], count: groups.length }
}

/**
 * จัดโครง FAQ ที่ไม่ได้มาตรฐานให้เป็น H2 FAQ + คำถามใต้หัวข้อ ก่อนใส่ id/TOC (เฉพาะโหมด HTML)
 * - หัว FAQ เป็น H3/H4 หรือย่อหน้าตัวหนา (Google Docs) → เลื่อนเป็น H2 (ใช้ก็ต่อเมื่อไม่มี H2 FAQ อยู่แล้ว)
 * - คำถามเป็น H2 ต่อจากหัว FAQ ทันที (Docs ใช้ Heading 1 = หัวข้อ, Heading 2 = คำถาม) → ลดเป็น H3 จนเจอ H2 ที่ไม่ใช่คำถาม
 * ไม่แตะข้อความ — เปลี่ยนแค่ระดับหัวข้อ
 */
function normalizeFaqStructure(blocks: HTMLElement[]): void {
  let faqIdx = blocks.findIndex((b) => b.tagName.toLowerCase() === 'h2' && FAQ_HEADING_RE.test(b.text))
  if (faqIdx === -1) {
    faqIdx = blocks.findIndex((b) => {
      const tag = b.tagName.toLowerCase()
      const text = b.text.replace(/\s+/g, ' ').trim()
      const headingLike = tag === 'h3' || tag === 'h4' || (tag === 'p' && isBoldOnlyParagraph(b))
      return headingLike && text.length <= 80 && FAQ_HEADING_RE.test(text) && !/[?？؟]$/.test(text)
    })
    if (faqIdx === -1) return
    blocks[faqIdx].tagName = 'h2'
  }
  const next = blocks[faqIdx + 1]
  if (!next || next.tagName.toLowerCase() !== 'h2' || !hasQuestionSignal(next)) return
  for (let i = faqIdx + 1; i < blocks.length; i++) {
    const b = blocks[i]
    if (b.tagName.toLowerCase() !== 'h2') continue
    if (!hasQuestionSignal(b)) break
    b.tagName = 'h3'
  }
}

/** หา section H2 ที่เป็น FAQ แล้วแปลงคู่ Q/A ภายใน — คืนจำนวนคู่ที่แปลงได้ */
function convertFaqInPlace(blocks: HTMLElement[]): number {
  const faqIdx = blocks.findIndex((b) => b.tagName.toLowerCase() === 'h2' && FAQ_HEADING_RE.test(b.text))
  if (faqIdx === -1) return 0
  let endIdx = blocks.length
  for (let i = faqIdx + 1; i < blocks.length; i++) {
    if (blocks[i].tagName.toLowerCase() === 'h2') {
      endIdx = i
      break
    }
  }
  const section = blocks.slice(faqIdx + 1, endIdx)
  const converted = convertFaqSection(section)
  if (!converted) return 0
  blocks.splice(faqIdx + 1, endIdx - (faqIdx + 1), ...converted.blocks)
  return converted.count
}

/** ห่อ table/img/blockquote ด้วย component class มาตรฐาน (ทำงานผ่าน reparse เดียวกันทั้งก้อน รองรับ FAQ ซ้อน) */
function wrapComponents(blocks: HTMLElement[], titleFallback: string): HTMLElement[] {
  const joined = blocks.map((b) => b.outerHTML).join('\n')
  const doc = parse(joined, { comment: false })

  for (const table of doc.querySelectorAll('table')) {
    const cls = table.getAttribute('class') || ''
    table.setAttribute('class', (cls ? `${cls} ` : '') + 'content-table')
    table.replaceWith(`<div class="content-table-wrap">${table.outerHTML}</div>`)
  }

  for (const bq of doc.querySelectorAll('blockquote')) {
    const cls = bq.getAttribute('class') || ''
    bq.setAttribute('class', (cls ? `${cls} ` : '') + 'content-quote')
  }

  for (const img of doc.querySelectorAll('img')) {
    if (!img.getAttribute('alt')) img.setAttribute('alt', titleFallback)
    const parentNode = img.parentNode
    if (!parentNode || parentNode.nodeType !== NodeType.ELEMENT_NODE) continue
    const parent = parentNode as HTMLElement
    const parentTag = parent.tagName?.toLowerCase()
    if (parentTag === 'figure') {
      const cls = parent.getAttribute('class') || ''
      parent.setAttribute('class', (cls ? `${cls} ` : '') + 'content-figure')
      continue
    }
    if (parentTag === 'p') {
      const meaningfulSiblings = parent.childNodes.filter((n: Node) => {
        if (n === img) return false
        if (n.nodeType === NodeType.TEXT_NODE) return !(n as TextNode).isWhitespace
        return true
      })
      if (meaningfulSiblings.length === 0) {
        parent.replaceWith(`<figure class="content-figure">${img.outerHTML}</figure>`)
      }
    }
  }

  return doc.children
}

function stripEmptyParagraphs(html: string): string {
  return html.replace(/<p>(?:\s|&nbsp;|&#160;)*<\/p>/gi, '')
}

interface UploadSchemaOptions {
  site: BuildUploadOptions['site']
  meta: BuildUploadOptions['meta']
  cover?: BuildUploadOptions['cover']
  breadcrumb?: boolean
}

/** สร้าง JSON-LD (Article + BreadcrumbList + FAQPage) จาก HTML ที่ห่อแล้ว — ใช้ meta ล่าสุดเสมอ */
function buildUploadSchema(wrappedHtml: string, o: UploadSchemaOptions): string {
  const title = o.meta.seoTitle || o.meta.title
  const scriptHtml = buildArticleSchema({
    html: wrappedHtml,
    title,
    metaDescription: o.meta.metaDescription,
    slug: o.meta.slug,
    siteUrl: o.site.url,
    siteName: o.site.name,
  })
  const m = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(scriptHtml)
  if (!m) return scriptHtml
  try {
    const data = JSON.parse(m[1])
    const graph: Array<Record<string, unknown>> = Array.isArray(data['@graph']) ? data['@graph'] : []
    for (const node of graph) {
      if (o.site.language === 'en' && node.inLanguage === 'th-TH') node.inLanguage = 'en-US'
    }
    const article = graph.find((n) => n['@type'] === 'Article')
    if (article && o.cover?.url && /^https?:\/\//i.test(o.cover.url)) article.image = o.cover.url
    // ยังไม่มี slug → buildArticleSchema ข้าม BreadcrumbList; ใส่แบบไม่มี URL ในรายการสุดท้าย (Google รองรับ)
    const siteUrl = o.site.url.trim().replace(/\/+$/, '')
    if (o.breadcrumb !== false && siteUrl && !graph.some((n) => n['@type'] === 'BreadcrumbList')) {
      graph.push({
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: o.site.name || siteUrl, item: `${siteUrl}/` },
          { '@type': 'ListItem', position: 2, name: title },
        ],
      })
    }
    // escape '<' กัน URL ที่มี </script> หลุดออกจากแท็ก
    return `<script type="application/ld+json">\n${JSON.stringify(data, null, 2).replace(/</g, '\\u003c')}\n</script>`
  } catch {
    return scriptHtml
  }
}

/**
 * สร้าง schema ใหม่ให้ HTML ที่ generate/แก้ไขแล้ว (เช่นหลัง AI เขียน meta หรือแก้ slug)
 * ไม่แตะเนื้อหา — ถอด JSON-LD เดิมออกแล้วใส่ชุดใหม่ที่ใช้ meta ล่าสุด
 */
export function refreshUploadSchema(html: string, o: UploadSchemaOptions): string {
  if (!/application\/ld\+json/i.test(html)) return html
  const body = stripSchemaScripts(html).trim()
  return `${buildUploadSchema(body, o)}\n${body}`
}

function toPlainText(bodyHtml: string): string {
  const root = parse(bodyHtml, { comment: false })
  const lines: string[] = []
  const textOf = (el: HTMLElement) => el.text.replace(/\s+/g, ' ').trim()

  function walkBlock(el: HTMLElement) {
    const tag = el.tagName.toLowerCase()
    if (/^h[1-6]$/.test(tag)) {
      const t = textOf(el)
      if (t) lines.push(t, '')
      return
    }
    if (tag === 'ul' || tag === 'ol') {
      for (const li of el.querySelectorAll('li')) {
        const t = textOf(li)
        if (t) lines.push(`- ${t}`)
      }
      lines.push('')
      return
    }
    if (tag === 'table') {
      for (const tr of el.querySelectorAll('tr')) {
        const cells = tr.querySelectorAll('th, td').map((c) => textOf(c))
        if (cells.some(Boolean)) lines.push(cells.join(' | '))
      }
      lines.push('')
      return
    }
    if (tag === 'details') {
      const summary = el.querySelector('summary')
      const answer = el.querySelector('.content-faq__answer')
      if (summary) lines.push(textOf(summary))
      if (answer) lines.push(textOf(answer))
      lines.push('')
      return
    }
    const t = textOf(el)
    if (t) lines.push(t, '')
  }

  for (const child of root.children) walkBlock(child)

  const out: string[] = []
  for (const l of lines) {
    if (l === '' && out[out.length - 1] === '') continue
    out.push(l)
  }
  return out.join('\n').trim()
}

export function buildUploadArticleHtml(o: BuildUploadOptions): BuildUploadResult {
  const htmlMode = o.mode !== 'text'
  // บทความที่นำเข้าก่อนมีการถอด entity (Google Doc เก็บไทยเป็น &#NNNN;) — ถอดตอน Generate ด้วย ไม่ต้องนำเข้าใหม่
  // เช่นเดียวกับคอมเมนต์ Google Docs ([a]/[b] + ข้อความคอมเมนต์) ที่ค้างในต้นฉบับเก่า
  let blocks = stripAuthorNotes(parseTopLevelBlocks(stripGoogleDocsCommentsHtml(decodeTextEntities(o.sourceHtml))))

  let h1Index = normalizeH1(blocks, o.meta.title)
  if (htmlMode) normalizeFaqStructure(blocks)
  const h2Count = assignH2Ids(blocks)

  let faqCount = 0
  if (htmlMode) {
    faqCount = convertFaqInPlace(blocks)
  }

  if (htmlMode) {
    blocks = wrapComponents(blocks, o.meta.title)
    h1Index = blocks.findIndex((b) => b.tagName.toLowerCase() === 'h1')
  }

  if (htmlMode) {
    let cursor = h1Index + 1
    if (o.cover?.url) {
      const figHtml = `<figure class="content-figure content-cover"><img src="${escapeAttr(o.cover.url)}" alt="${escapeAttr(o.cover.alt || o.meta.title)}"></figure>`
      blocks.splice(cursor, 0, parseTopLevelBlocks(figHtml)[0])
      cursor++
    }
    if (blocks[cursor] && blocks[cursor].tagName.toLowerCase() === 'p') {
      cursor++
    }
    if (h2Count >= 3) {
      const h2Blocks = blocks.filter((b) => b.tagName.toLowerCase() === 'h2')
      const label = o.site.language === 'en' ? 'Contents' : 'สารบัญ'
      const items = h2Blocks.map((b) => `<li><a href="#${b.getAttribute('id')}">${escapeHtml(b.text.trim())}</a></li>`).join('')
      const tocHtml = `<nav class="content-toc" aria-label="${label}"><p class="content-toc__title">${label}</p><ol>${items}</ol></nav>`
      blocks.splice(cursor, 0, parseTopLevelBlocks(tocHtml)[0])
    }
    // breadcrumb ไม่แสดงในเนื้อหา (เจ้าของสั่ง 2026-09-28) — ใส่เฉพาะ BreadcrumbList ใน schema
  } else if (o.cover?.url) {
    const figHtml = `<figure><img src="${escapeAttr(o.cover.url)}" alt="${escapeAttr(o.cover.alt || o.meta.title)}"></figure>`
    blocks.splice(h1Index + 1, 0, parseTopLevelBlocks(figHtml)[0])
  }

  const bodyHtml = stripEmptyParagraphs(blocks.map((b) => b.outerHTML).join('\n'))
  const plainText = toPlainText(bodyHtml)

  if (!htmlMode) {
    return { html: bodyHtml, plainText, faqCount: 0, h2Count }
  }

  // Author Box ต่อท้ายบทความ (เฉพาะโหมด HTML) — CSS ของ .content-author มากับ buildArticleCss อยู่แล้ว
  const authorHtml = o.author
    ? buildAuthorCardHtml({
        name: o.author.profile.name,
        title: o.author.profile.title,
        image: o.author.profile.image,
        credentials: o.author.profile.credentials,
        style: o.author.style,
        heading: o.site.language === 'en' ? 'About the author' : undefined,
      })
    : ''
  const htmlBody = authorHtml ? `${bodyHtml}\n${authorHtml.trim()}` : bodyHtml

  const finalCss = buildUploadCss(o.theme, o.cta)
  const wrapped = o.theme.styleMode === 'clean' ? wrapArticleHtml(htmlBody, null) : wrapArticleHtml(htmlBody, finalCss)

  const schemaScript = buildUploadSchema(wrapped, o)

  return { html: `${schemaScript}\n${wrapped}`, plainText, faqCount, h2Count }
}

/** ค่าตั้งต้นสำหรับ refreshUploadSchema จากแถวบทความ + ลูกค้า (รับ plain object ไม่ผูก prisma) */
/** ภาษาของบทความ 1 ชิ้น จากโหมดภาษาของลูกค้า (th/en/both) — both = ดูจาก title ก่อนแล้วค่อย keyword */
export function uploadArticleLanguage(clientLanguage: string, title: string, keyword = ''): 'th' | 'en' {
  const mode = clientLanguage === 'en' || clientLanguage === 'both' ? clientLanguage : 'th'
  return resolveArticleLanguage({ projectLanguage: mode, mode, keyword, title })
}

export function uploadSchemaOptions(
  article: { title: string; seoTitle: string; metaDescription: string; slug: string; coverImageUrl: string | null; coverAlt: string },
  client: { name: string; website: string; language: string },
): UploadSchemaOptions {
  return {
    site: { name: client.name, url: client.website, language: uploadArticleLanguage(client.language, article.title) },
    meta: {
      title: article.title,
      seoTitle: article.seoTitle || undefined,
      metaDescription: article.metaDescription || undefined,
      slug: article.slug || undefined,
    },
    cover: article.coverImageUrl ? { url: article.coverImageUrl, alt: article.coverAlt || article.title } : null,
  }
}
