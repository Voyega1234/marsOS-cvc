// ─── PBN Backlinks — เว็บโครง "magazine" (monorepo PBN: khaoduan.com / roothan.com) ─────────────
// เว็บกลุ่มนี้อ่านบทความจาก <site>/content/articles/<slug>.md ด้วยกติกาของตัวเอง ไม่ใช่ frontmatter กลาง ๆ ของเรา:
//   - frontmatter: title, description, keyword, slug, cluster (หมวด), date "YYYY-MM-DD", format: html
//   - หมวดทั้งหมดอยู่ใน site.config.json (clusters = slug → ชื่อ, magazine.sections = หมวดใหญ่)
//   - ปก = public/images/<slug>.webp เท่านั้น (ไม่อ่าน field image), รูปในเนื้อหาต้องเป็น /images/... หรือ https://
//   - เนื้อหาผ่าน sanitizer: ไม่มี <style>/<script>/<nav>/<h1>, ลิงก์ออกเป็น nofollow เว้นแต่ rel มีคำว่า dofollow
// ไฟล์นี้ไม่แตะ network และไม่ใช้ sharp — แปลงรูปเป็น webp ทำที่ push route
// Upload Article ไม่ใช้ไฟล์นี้

import { parse, HTMLElement, Node, NodeType } from 'node-html-parser'
import { normalizeUrl } from './internal-links'
import { removeCoverFromHtml } from './article-images'
import { cleanRepoPath, DEFAULT_GH_DIR, type PbnSite } from './pbn'

const PARSE_OPTIONS = { blockTextElements: {} }
const SYSTEM_BLOCK_RE = /\bcontent-(?:cta|author|toc|breadcrumb)\b/
const CLUSTER_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,80}$/
/** slug ของเว็บ magazine = ชื่อไฟล์ + URL + ชื่อไฟล์รูป — ตัวพิมพ์เล็กอังกฤษ ตัวเลข ขีดกลางเท่านั้น */
export const MAGAZINE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const MAGAZINE_OTHER_SECTION = '_other'

export interface MagazineCluster {
  slug: string
  label: string
}

export interface MagazineSection {
  key: string
  label: string
  clusters: MagazineCluster[]
}

export interface MagazineClusters {
  sections: MagazineSection[]
  /** จำนวนหมวดย่อยทั้งหมด */
  count: number
}

export function isMagazineSite(site: Pick<PbnSite, 'platform' | 'ghLayout'> | null | undefined): boolean {
  return !!site && site.platform === 'github' && site.ghLayout === 'magazine'
}

/**
 * path ของ site.config.json ใน repo — ตั้งเองได้ (ghConfigPath)
 * ไม่ตั้ง = เดาจากโฟลเดอร์บทความ `<site>/content/articles` → `<site>/site.config.json` เดาไม่ได้ = null
 */
export function magazineConfigPath(site: Pick<PbnSite, 'ghDir' | 'ghConfigPath'>): string | null {
  if (site.ghConfigPath) return cleanRepoPath(site.ghConfigPath) || null
  const dir = cleanRepoPath(site.ghDir ?? DEFAULT_GH_DIR)
  if (dir === null) return null
  const m = /^(?:(.*)\/)?content\/articles$/.exec(dir)
  if (!m) return null
  return `${m[1] ? `${m[1]}/` : ''}site.config.json`
}

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** อ่านรายการหมวดจาก site.config.json — ไม่มีหมวดเลย/รูปแบบไม่ใช่ = null */
export function parseMagazineConfig(raw: unknown): MagazineClusters | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const cfg = raw as Record<string, unknown>
  const labels = new Map<string, string>()
  if (cfg.clusters && typeof cfg.clusters === 'object' && !Array.isArray(cfg.clusters)) {
    for (const [slug, label] of Object.entries(cfg.clusters as Record<string, unknown>)) {
      if (CLUSTER_SLUG_RE.test(slug)) labels.set(slug, text(label) || slug)
    }
  }
  const sections: MagazineSection[] = []
  const used = new Set<string>()
  const mag = cfg.magazine && typeof cfg.magazine === 'object' ? (cfg.magazine as Record<string, unknown>) : null
  if (mag && Array.isArray(mag.sections)) {
    for (const s of mag.sections as unknown[]) {
      if (!s || typeof s !== 'object') continue
      const sec = s as Record<string, unknown>
      const key = text(sec.key)
      if (!key || !Array.isArray(sec.clusters)) continue
      const clusters: MagazineCluster[] = []
      for (const c of sec.clusters as unknown[]) {
        if (typeof c !== 'string' || !CLUSTER_SLUG_RE.test(c) || used.has(c)) continue
        used.add(c)
        clusters.push({ slug: c, label: labels.get(c) || c })
      }
      if (clusters.length) sections.push({ key, label: text(sec.navLabel) || text(sec.label) || key, clusters })
    }
  }
  const rest: MagazineCluster[] = []
  for (const [slug, label] of Array.from(labels)) if (!used.has(slug)) rest.push({ slug, label })
  if (rest.length) sections.push({ key: MAGAZINE_OTHER_SECTION, label: sections.length ? 'อื่น ๆ' : 'หมวดทั้งหมด', clusters: rest })
  const count = sections.reduce((n, s) => n + s.clusters.length, 0)
  return count ? { sections, count } : null
}

export function findMagazineCluster(clusters: MagazineClusters, slug: string): MagazineCluster | null {
  for (const s of clusters.sections) {
    const hit = s.clusters.find((c) => c.slug === slug)
    if (hit) return hit
  }
  return null
}

/** วันที่แบบที่เว็บเทียบ (YYYY-MM-DD ตามเวลาไทย) — วันที่ผิด = วันนี้ */
export function bangkokDate(d: Date | string | number = new Date()): string {
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime()
  const ms = Number.isNaN(t) ? Date.now() : t
  return new Date(ms + 7 * 3600_000).toISOString().slice(0, 10)
}

export interface MagazineFileInput {
  title: string
  description: string
  keyword: string
  slug: string
  cluster: string
  /** YYYY-MM-DD */
  date: string
  /** YYYY-MM-DD — ใส่เมื่อ push ซ้ำคนละวันกับ date */
  updated?: string
  seoTitle?: string
  html: string
}

/** ไฟล์ .md ของเว็บ magazine — ค่าทุกตัวเป็น JSON string (ปลอดภัยกับ YAML), เนื้อหาเป็น HTML (format: html) */
export function buildMagazineFile(input: MagazineFileInput): string {
  const fm: Array<[string, string]> = [
    ['title', input.title],
    ['description', input.description],
    ['keyword', input.keyword],
    ['slug', input.slug],
    ['cluster', input.cluster],
    ['date', input.date],
  ]
  if (input.updated && input.updated !== input.date) fm.push(['updated', input.updated])
  if (input.seoTitle && input.seoTitle !== input.title) fm.push(['seoTitle', input.seoTitle])
  fm.push(['format', 'html'])
  // ป้ายบอกที่มา — เว็บไม่อ่าน field นี้ ใช้ให้ script ฝั่ง repo แยกไฟล์ของ MarsOS ออกจากไฟล์ที่ระบบอื่นสร้าง
  fm.push(['origin', 'marsos'])
  const head = fm.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')
  return `---\n${head}\n---\n\n${input.html.trim()}\n`
}

export interface MagazineInlineImage {
  /** ชื่อไฟล์ไม่มีนามสกุล เช่น `<slug>-1` — push route แปลงเป็น webp แล้วเขียนที่ <โฟลเดอร์รูป>/<name>.webp */
  name: string
  base64: string
  mime: string
}

export interface MagazineBodyResult {
  html: string
  images: MagazineInlineImage[]
  /** จำนวนลิงก์ไป URL ปลายทางที่ใส่ rel="dofollow" (ปกติ 1) */
  dofollow: number
  /** รูป data: ที่ถูกตัดทิ้งเพราะเว็บไม่มีโฟลเดอร์รูปให้เขียน */
  droppedImages: number
}

function inSystemBlock(el: HTMLElement): boolean {
  let cur: Node | null = el.parentNode
  while (cur && cur.nodeType === NodeType.ELEMENT_NODE) {
    if (SYSTEM_BLOCK_RE.test((cur as HTMLElement).getAttribute('class') || '')) return true
    cur = cur.parentNode
  }
  return false
}

/**
 * แปลง HTML บทความของเราให้เข้ากับ sanitizer ของเว็บ magazine:
 * - ตัด <style>/<script>, สารบัญ + breadcrumb ของระบบ (เว็บสร้างสารบัญเอง), H1 ตัวแรก (เว็บแสดง title เอง), กล่องปก
 * - H1 ที่เหลือลดเป็น H2 (sanitizer ทิ้งแท็ก h1 เหลือข้อความลอย)
 * - ลิงก์ไป URL ปลายทาง (backlink) นอกกล่องของระบบ ใส่ rel="dofollow" — ไม่ใส่ = เว็บเติม nofollow ให้
 * - รูป data: ในเนื้อหา → ไฟล์ /images/<slug>-<n>.webp (sanitizer ทิ้งรูป data:) — keepImages=false = ตัดรูปทิ้ง
 */
export function magazineBody(
  html: string,
  opts: { slug: string; targetUrl?: string | null; coverSrc?: string | null; keepImages?: boolean },
): MagazineBodyResult {
  let src = (html || '')
    .replace(/<style\b[\s\S]*?<\/style>\s*/gi, '')
    .replace(/<script\b[\s\S]*?<\/script>\s*/gi, '')
  src = removeCoverFromHtml(src, opts.coverSrc)
  const root = parse(src, { comment: false, ...PARSE_OPTIONS })

  for (const nav of root.querySelectorAll('nav')) {
    if (/\bcontent-(?:toc|breadcrumb)\b/.test(nav.getAttribute('class') || '')) nav.remove()
  }
  const h1s = root.querySelectorAll('h1')
  h1s.forEach((h, i) => {
    if (i === 0) h.remove()
    else h.tagName = 'h2'
  })

  let dofollow = 0
  const target = opts.targetUrl ? normalizeUrl(opts.targetUrl) : ''
  if (target) {
    for (const a of root.querySelectorAll('a')) {
      if (inSystemBlock(a)) continue
      const href = (a.getAttribute('href') || '').trim()
      if (!/^https?:\/\//i.test(href) || normalizeUrl(href) !== target) continue
      a.setAttribute('rel', 'dofollow')
      dofollow++
    }
  }

  const images: MagazineInlineImage[] = []
  let droppedImages = 0
  const keep = opts.keepImages !== false
  for (const img of root.querySelectorAll('img')) {
    const s = (img.getAttribute('src') || '').trim()
    if (!/^data:/i.test(s)) continue
    const m = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(s)
    if (!m || !keep) {
      // รูปอยู่ใน figure เดี่ยว ๆ = ตัดทั้ง figure (ไม่ทิ้งคำบรรยายลอย)
      const fig = img.parentNode as HTMLElement | null
      if (fig && fig.tagName === 'FIGURE' && fig.querySelectorAll('img').length === 1) fig.remove()
      else img.remove()
      droppedImages++
      continue
    }
    const name = `${opts.slug}-${images.length + 1}`
    images.push({ name, mime: m[1].toLowerCase(), base64: m[2].replace(/\s+/g, '') })
    img.setAttribute('src', `/images/${name}.webp`)
    img.setAttribute('loading', 'lazy')
    img.removeAttribute('srcset')
  }

  return { html: root.toString().trim(), images, dofollow, droppedImages }
}
