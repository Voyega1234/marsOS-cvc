// ดึงแหล่งอ้างอิงจากบทความที่เผยแพร่แล้วทั้งเว็บ (WordPress REST) — ทีมกดเอง ไม่รันอัตโนมัติ
// เก็บเฉพาะรายการใต้หัวข้อ "อ้างอิง" ของแต่ละบทความ (ตัวอ่านเดียวกับตอนสแกน) ไม่เดาจากลิงก์ทั่วไปในเนื้อหา
// ข้ามบทความที่ระบบเราเขียนเอง (มี content-article) เพราะอ้างอิงในนั้นมาจากคลังเดิม ไม่ใช่ของเว็บ

import { extractReferencesFromHtml } from './article-style-scan'
import { isReferenceBlocked, referenceDomain, refKey } from './references'
import { safeFetchText } from './safe-fetch'
import type { UploadReference } from './types'

// 20 บทความต่อหน้า ให้แต่ละคำขอไม่เกินเพดานขนาดของ safe-fetch
const PER_PAGE = 20
const MAX_PAGES = 10
export const SITE_REFERENCES_MAX = 200

export interface SiteReferencesResult {
  references: UploadReference[]
  /** บทความที่อ่านได้ทั้งหมด (ไม่นับที่ระบบเราเขียน) */
  posts: number
  postsWithReferences: number
  skippedBlocked: number
  skippedOwn: number
  /** เกินเพดานจำนวนบทความหรือจำนวนรายการ */
  truncated: boolean
}

export async function collectSiteReferences(params: {
  site: string
  blocked?: string[]
  fetchText?: (url: string) => Promise<string | null>
  maxPages?: number
}): Promise<SiteReferencesResult> {
  const origin = new URL(/^https?:\/\//i.test(params.site.trim()) ? params.site.trim() : `https://${params.site.trim()}`).origin
  const own = referenceDomain(origin)
  const fetchText = params.fetchText ?? safeFetchText
  const maxPages = params.maxPages ?? MAX_PAGES
  const seen = new Set<string>()
  const references: UploadReference[] = []
  let posts = 0
  let postsWithReferences = 0
  let skippedBlocked = 0
  let skippedOwn = 0
  let truncated = false

  for (let page = 1; page <= maxPages; page++) {
    const raw = await fetchText(`${origin}/wp-json/wp/v2/posts?per_page=${PER_PAGE}&page=${page}&_fields=link,content.rendered`)
    let arr: unknown = null
    try {
      arr = raw ? JSON.parse(raw) : null
    } catch {
      arr = null
    }
    if (!Array.isArray(arr)) {
      // หน้าแรกอ่านไม่ได้ = เว็บไม่เปิด REST · หน้าถัดไปอ่านไม่ได้ = เกินจำนวนบทความที่มี (WordPress ตอบ 400)
      if (page === 1) throw new Error('อ่านบทความผ่าน WordPress REST ไม่ได้')
      break
    }
    for (const item of arr) {
      const content = (item as { content?: { rendered?: unknown } })?.content?.rendered
      if (typeof content !== 'string' || !content.trim()) continue
      if (content.includes('content-article')) {
        skippedOwn++
        continue
      }
      posts++
      const found = extractReferencesFromHtml(content)
      if (!found) continue
      postsWithReferences++
      for (const r of found.items) {
        const key = refKey(r.url)
        const host = referenceDomain(r.url)
        if (!key || !host || seen.has(key)) continue
        if (own && (host === own || host.endsWith(`.${own}`))) continue
        seen.add(key)
        if (isReferenceBlocked(r.url, params.blocked)) {
          skippedBlocked++
          continue
        }
        if (references.length >= SITE_REFERENCES_MAX) {
          truncated = true
          continue
        }
        references.push({ title: r.title, url: r.url, from: 'import' })
      }
    }
    if (arr.length < PER_PAGE) break
    if (page === maxPages) truncated = true
  }
  return { references, posts, postsWithReferences, skippedBlocked, skippedOwn, truncated }
}
