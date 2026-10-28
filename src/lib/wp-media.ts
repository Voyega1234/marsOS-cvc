/**
 * WordPress Media Library — อัปรูปเฉพาะเมื่อไบต์เปลี่ยน
 * slug ของ media = hash ของไบต์รูป → push ซ้ำเจอรูปเดิมก็ใช้ต่อ ไม่อัปซ้ำ
 */
import { createHash } from 'node:crypto'

export type WpFetch = (url: string, init: RequestInit) => Promise<Response>

/** slug ของ media จาก hash ไบต์รูป — ไบต์เดิม = slug เดิม */
export function wpMediaSlug(base64: string): string {
  return 'mars-' + createHash('sha1').update(Buffer.from(base64, 'base64')).digest('hex').slice(0, 16)
}

/** หา media ตาม slug ก่อน เจอ = ใช้ต่อ ไม่เจอ/ผิดพลาด = อัปใหม่ (ไม่ throw) */
export async function findOrUploadWpMedia(opts: {
  wpUrl: string; creds: string; base64: string; mime: string; title: string; alt: string; fetchFn: WpFetch
}): Promise<{ id: number; url: string; reused: boolean } | null> {
  const { wpUrl, creds, base64, mime, title, alt, fetchFn } = opts
  const slug = wpMediaSlug(base64)

  // 1. ค้นหา media เดิม
  try {
    const res = await fetchFn(`${wpUrl}/wp-json/wp/v2/media?slug=${slug}&_fields=id,source_url,alt_text`, {
      headers: { Authorization: `Basic ${creds}` },
      signal: AbortSignal.timeout(15000),
    })
    if (res.ok) {
      const list = await res.json()
      const item = Array.isArray(list) ? list[0] : null
      if (item?.id && item?.source_url) {
        // alt ต่างจากเดิม → อัปเดต alt (best-effort)
        if (alt && alt !== item.alt_text) {
          try {
            await fetchFn(`${wpUrl}/wp-json/wp/v2/media/${item.id}`, {
              method: 'POST',
              headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ alt_text: alt }),
              signal: AbortSignal.timeout(15000),
            })
          } catch { /* ไม่ซีเรียส */ }
        }
        return { id: Number(item.id), url: String(item.source_url), reused: true }
      }
    }
  } catch { /* ค้นหาไม่ได้ → อัปใหม่ */ }

  // 2. อัปรูปใหม่ (multipart)
  try {
    const imageBuffer = Buffer.from(base64, 'base64')
    const ext = mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : 'webp'
    const boundary = `----WPUpload${Date.now()}`
    const filename = `${slug}.${ext}`

    const titleBuf = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n${title}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="alt_text"\r\n\r\n${alt}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="slug"\r\n\r\n${slug}\r\n`,
    )
    const header = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
    )
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`)
    const body = Buffer.concat([titleBuf, header, imageBuffer, footer])

    const res = await fetchFn(`${wpUrl}/wp-json/wp/v2/media`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${creds}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
      body,
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.id ? { id: Number(data.id), url: String(data.source_url || ''), reused: false } : null
  } catch {
    return null
  }
}

/** เรียก fn กับ items พร้อมกันไม่เกิน limit ตัว — คงลำดับผลลัพธ์ตาม items เดิม */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

/** alt ของแท็ก <img> ที่ครอบตำแหน่ง pos (ตำแหน่ง src ใน html) — ถอด entity พื้นฐาน, ไม่มี = '' */
function imgAltAt(html: string, pos: number): string {
  const start = html.lastIndexOf('<img', pos)
  const end = html.indexOf('>', pos)
  if (start < 0 || end < 0) return ''
  const tag = html.slice(start, end + 1)
  const alt = /\balt="([^"]*)"/i.exec(tag)?.[1] || ''
  return alt.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim()
}

/**
 * รูปที่ฝังเป็น data:image ในเนื้อหา → อัปขึ้น Media Library แล้วเปลี่ยน src เป็นลิงก์จริง
 * (HTML สั้นลงมาก และ WordPress บางเว็บตัด data: URI ทิ้ง) อัปไม่สำเร็จ = คงรูปเดิมไว้
 * อัปพร้อมกันไม่เกิน 3 รูป — data URI ซ้ำอัปครั้งเดียว
 */
export async function replaceInlineDataImages(opts: {
  wpUrl: string; creds: string; html: string; title: string; known: Map<string, string>; fetchFn: WpFetch
}): Promise<string> {
  const { wpUrl, creds, html, title, known, fetchFn } = opts
  const re = /src="(data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+))"/gi
  const found = new Map<string, { mime: string; base64: string; alt: string }>()
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    if (found.get(m[1])?.alt) continue
    found.set(m[1], { mime: m[2].toLowerCase(), base64: m[3], alt: imgAltAt(html, m.index) })
  }
  const toUpload = Array.from(found.entries()).filter(([dataUri]) => !known.has(dataUri))
  const uploadedNow = new Map<string, string>()
  await mapWithConcurrency(toUpload, 3, async ([dataUri, img]) => {
    // ชื่อรูปใน Media Library = alt ของรูปนั้น (ไม่มี alt = ชื่อบทความแบบเดิม)
    const name = img.alt || title
    const result = await findOrUploadWpMedia({ wpUrl, creds, base64: img.base64, mime: img.mime, title: name, alt: name, fetchFn })
    if (result?.url) uploadedNow.set(dataUri, result.url)
  })
  let out = html
  for (const [dataUri] of Array.from(found)) {
    const url = known.get(dataUri) ?? uploadedNow.get(dataUri)
    if (url) out = out.split(dataUri).join(url)
  }
  return out
}
