// ─── Upload Article — แทรกกล่อง CTA ลงบทความที่ AI เขียน (ฝั่ง server) ───────────
// ใช้เฉพาะตอนทีมติ๊ก "ใส่ CTA" ในแท็บเขียนบทความ — บทความที่ผู้เขียนอัปโหลดเองไม่ถูกแตะ

import { parse, HTMLElement, NodeType } from 'node-html-parser'
import {
  buildUploadCtaHtml, hasUploadCta, readyUploadCtaItems, usableUploadCtaBanners,
  type UploadCtaItem, type UploadCtaSettings,
} from './cta'

const FAQ_HEADING_RE = /FAQ|คำถามที่พบบ่อย|คำถามยอดฮิต|Q\s*&\s*A|ถาม.?ตอบ|frequently asked/i

/** เลือก `count` ตำแหน่งกระจายสม่ำเสมอจาก [0, total) — ใช้วาง CTA กลางบทความให้ห่างเท่า ๆ กัน */
function pickSpreadIndices(total: number, count: number): number[] {
  if (count <= 0 || total <= 0) return []
  if (count >= total) return Array.from({ length: total }, (_, i) => i)
  const idxs: number[] = []
  for (let i = 0; i < count; i++) {
    idxs.push(Math.floor(((i + 1) * total) / (count + 1)))
  }
  return Array.from(new Set(idxs))
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** สุ่มลำดับ CTA ที่จะใช้ n จุด: ไม่ซ้ำกันเท่าที่มีของพอ แล้วสุ่มวนซ้ำรอบใหม่ */
function pickItemSequence(items: UploadCtaItem[], n: number, rand: () => number): UploadCtaItem[] {
  const seq: UploadCtaItem[] = []
  let pool = shuffle(items, rand)
  let idx = 0
  for (let i = 0; i < n; i++) {
    if (idx >= pool.length) {
      pool = shuffle(items, rand)
      idx = 0
    }
    seq.push(pool[idx])
    idx++
  }
  return seq
}

/**
 * แทรก CTA ตามจำนวนที่ตั้งไว้ (perArticle) ใน HTML ระดับบนสุด: กระจายตาม H2 เนื้อหา + จุดสุดท้ายก่อนหัวข้อ FAQ
 * (ไม่มี FAQ = ท้ายบทความ) — สุ่มหยิบ CTA จาก items (ไม่ซ้ำเท่าที่มีของพอ) จุดสุดท้ายเป็นแบบเต็มเสมอ
 * บทความสั้น (H2 เนื้อหาน้อยกว่า 3) ใส่จุดเดียว (จุดสุดท้าย) — มี CTA อยู่แล้ว = ไม่แทรกซ้ำ
 * แบนเนอร์หลายรูป: สุ่มรูปใหม่ทุกจุดที่แทรก
 */
export function insertUploadCta(html: string, cta: UploadCtaSettings, rand: () => number = Math.random): { html: string; inserted: number } {
  const readyItems = readyUploadCtaItems(cta)
  if (!cta.enabled || readyItems.length === 0 || hasUploadCta(html)) return { html, inserted: 0 }

  const root = parse(html, { comment: true, blockTextElements: {} })
  const top = root.childNodes.filter((n) => n.nodeType === NodeType.ELEMENT_NODE) as HTMLElement[]
  const h2s = top.filter((el) => el.tagName?.toLowerCase() === 'h2')
  const faq = h2s.find((el) => FAQ_HEADING_RE.test(el.text))
  const contentH2s = h2s.filter((el) => el !== faq)

  const requestedN = Math.max(1, Math.min(5, Math.round(cta.perArticle)))
  const midSlotsAvailable = contentH2s.length >= 3
  const maxSlots = midSlotsAvailable ? contentH2s.length + 1 : 1
  const n = Math.min(requestedN, maxSlots)
  const midCount = n - 1

  const midIndices = midSlotsAvailable ? pickSpreadIndices(contentH2s.length, midCount) : []
  const midTargets = midIndices.map((i) => contentH2s[i])

  const items = pickItemSequence(readyItems, n, rand)

  const insertBefore = (target: HTMLElement | undefined, snippet: string): boolean => {
    if (!snippet) return false
    const node = parse(snippet).childNodes[0]
    if (!node) return false
    const idx = target ? root.childNodes.indexOf(target) : -1
    node.parentNode = root
    if (idx < 0) root.childNodes.push(node)
    else root.childNodes.splice(idx, 0, node)
    return true
  }

  let inserted = 0
  for (let i = 0; i < midTargets.length; i++) {
    const item = items[i]
    const banners = usableUploadCtaBanners(item)
    const bannerIndex = banners.length ? Math.floor(rand() * banners.length) : 0
    if (insertBefore(midTargets[i], buildUploadCtaHtml(item, 'short', bannerIndex))) inserted++
  }

  const lastItem = items[items.length - 1]
  if (lastItem) {
    const banners = usableUploadCtaBanners(lastItem)
    const bannerIndex = banners.length ? Math.floor(rand() * banners.length) : 0
    if (insertBefore(faq, buildUploadCtaHtml(lastItem, 'full', bannerIndex))) inserted++
  }

  return { html: root.toString(), inserted }
}
