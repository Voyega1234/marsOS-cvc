/**
 * ตรวจว่า CSS สไตล์บทความ (marker mars-article-css:<hash>) ถูกวางใน Webflow Custom Code และ Publish แล้ว
 * อ่านหน้าเว็บที่ Publish จริง (หน้าบทความที่ push แล้วถ้ามี ไม่งั้นหน้าแรก) — read-only
 */
import { DEFAULT_UPLOAD_THEME, type UploadTheme } from './types'
import { safeFetchHtml, type SafeFetchResult } from './safe-fetch'

export type WebflowCssStatus = 'ok' | 'outdated' | 'missing' | 'unreachable'

export interface WebflowCssCheck {
  status: WebflowCssStatus
  foundHash?: string
  checkedUrl: string
  message: string
}

const MSG = {
  ok: 'CSS ในเว็บเป็นเวอร์ชันล่าสุดแล้ว',
  outdated: 'CSS ในเว็บเป็นเวอร์ชันเก่า — ธีมถูกแก้หลังวาง ให้ Copy ใหม่ไปวางทับแล้ว Publish',
  missing: 'ยังไม่พบ CSS ในเว็บ — วางใน Site settings → Custom code → Head code แล้วกด Publish',
  unreachable: 'เปิดเว็บไม่ได้ — เว็บต้อง Publish แล้ว',
}

function findHash(html: string): string | undefined {
  const m = /mars-article-css:([0-9a-f]+)/i.exec(html) || /data-mars-css=["']([0-9a-f]+)["']/i.exec(html)
  return m ? m[1].toLowerCase() : undefined
}

/** safeFetchHtml (กัน SSRF ทุก hop) + เพดาน 8 วินาที */
function fetchWithin8s(url: string): Promise<SafeFetchResult> {
  const timeout = new Promise<SafeFetchResult>((resolve) =>
    setTimeout(() => resolve({ ok: false, status: 0, html: '', finalUrl: url, blocked: false, error: 'timeout' }), 8000))
  return Promise.race([safeFetchHtml(url), timeout])
}

export async function checkWebflowCss(siteUrl: string, expectedHash: string, sampleUrl?: string): Promise<WebflowCssCheck> {
  const home = /^https?:\/\//i.test(siteUrl.trim()) ? siteUrl.trim() : `https://${siteUrl.trim()}`
  const targets = sampleUrl && sampleUrl !== home ? [sampleUrl, home] : [home]
  let lastUrl = targets[0]
  for (const url of targets) {
    lastUrl = url
    const r = await fetchWithin8s(url)
    if (!r.ok) continue
    const found = findHash(r.html)
    if (!found) {
      // หน้าบทความอาจไม่มี CSS ถ้าเป็นคนละเทมเพลต — ลองหน้าถัดไปก่อนสรุปว่าไม่พบ
      if (url !== targets[targets.length - 1]) continue
      return { status: 'missing', checkedUrl: url, message: MSG.missing }
    }
    return found === expectedHash.toLowerCase()
      ? { status: 'ok', foundHash: found, checkedUrl: url, message: MSG.ok }
      : { status: 'outdated', foundHash: found, checkedUrl: url, message: MSG.outdated }
  }
  return { status: 'unreachable', checkedUrl: lastUrl, message: MSG.unreachable }
}

/** ธีมที่บันทึกไว้ — ผสมกับค่าตั้งต้นแบบเดียวกับ toUploadClientDTO (ให้แฮชตรงกับที่หน้า Setting สร้าง) */
export function savedUploadTheme(raw: string | null | undefined): UploadTheme {
  try {
    return { ...DEFAULT_UPLOAD_THEME, ...JSON.parse(raw || '{}') }
  } catch {
    return DEFAULT_UPLOAD_THEME
  }
}
