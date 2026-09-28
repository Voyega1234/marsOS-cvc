// ─── Upload Article — นำเข้าจากโฟลเดอร์ Google Drive (แชร์แบบ Anyone with the link) ──
// ไม่ใช้ credential ใด ๆ: อ่านรายการไฟล์จากหน้า embeddedfolderview ของ Drive (HTML สาธารณะ)
// และดาวน์โหลดไฟล์ผ่าน uc?export=download — ทุก request จำกัดโดเมน Google (กัน SSRF)
//
// รูปแบบ HTML ของ embeddedfolderview (ตรวจจากโฟลเดอร์สาธารณะจริง 2026-09-28):
//   <title>ชื่อโฟลเดอร์</title> ... <div class="flip-entries">
//     <div class="flip-entry" id="entry-<ID>"><div class="flip-entry-info">
//       <a href="https://drive.google.com/drive/folders/<ID>">            ← โฟลเดอร์
//       <a href="https://docs.google.com/document/d/<ID>/edit?usp=drive_web"> ← Google Doc
//       <a href="https://drive.google.com/file/d/<ID>/view?usp=drive_web">     ← ไฟล์ทั่วไป
//         <div class="flip-entry-list-icon"><div aria-label="Folder" …/></div>   (โฟลเดอร์)
//         <div class="flip-entry-list-icon"><img src="https://drive-thirdparty.googleusercontent.com/16/type/<mime>"/></div>
//         <div class="flip-entry-title">ชื่อไฟล์</div>
//   โฟลเดอร์ที่ไม่มีอยู่/ไม่ได้แชร์ → HTTP 404 (หรือเด้งไปหน้า login)
//   หมายเหตุ: ชื่อไฟล์อาจลงท้าย .docx แต่เป็น Google Doc (mime vnd.google-apps.document) — ดู mime ก่อนนามสกุล

import { parse } from 'node-html-parser'
import sharp from 'sharp'

export type DriveEntryKind = 'folder' | 'gdoc' | 'docx' | 'image' | 'other'

export interface DriveEntry {
  id: string
  name: string
  kind: DriveEntryKind
  mimeType?: string
  /** resourcekey ของไฟล์/โฟลเดอร์ที่แชร์แบบเก่า (ถ้ามีในลิงก์) */
  resourceKey?: string
}

export interface DriveFolderListing {
  id: string
  title: string
  entries: DriveEntry[]
}

export interface DriveFolderRef {
  id: string
  resourceKey?: string
}

export const DRIVE_NOT_PUBLIC_MSG = 'เปิดโฟลเดอร์ไม่ได้ — ตั้งแชร์โฟลเดอร์เป็น Anyone with the link ก่อน'

const ID_RE = /^[A-Za-z0-9_-]{10,200}$/
const FETCH_TIMEOUT_MS = 15_000
const MAX_LISTING_BYTES = 5 * 1024 * 1024
export const MAX_DRIVE_FILE_BYTES = 15 * 1024 * 1024

const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|bmp|tiff?|avif|heic|heif)$/i
const COVER_NAME_RE = /ปก|หน้าปก|cover|thumb|thumbnail|featured/i

export function isValidDriveId(id: unknown): id is string {
  return typeof id === 'string' && ID_RE.test(id)
}

// ─── แยก ID จากลิงก์โฟลเดอร์ ─────────────────────────────────────────────────

/**
 * รับลิงก์โฟลเดอร์ Drive แล้วคืน { id, resourceKey } — โยน Error (ข้อความไทย) ถ้าไม่ใช่ลิงก์โฟลเดอร์ Google
 * รองรับ: /drive/folders/<id>, /drive/u/0/folders/<id>, /drive/mobile/folders/<id>,
 *         /open?id=<id>, /folderview?id=<id>, /embeddedfolderview?id=<id> (+ ?usp=… &resourcekey=…)
 *         หรือวาง ID เปล่า ๆ
 */
export function parseDriveFolderLink(input: string): DriveFolderRef {
  const raw = (input || '').trim()
  if (ID_RE.test(raw)) return { id: raw }

  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new Error('ลิงก์โฟลเดอร์ Google Drive ไม่ถูกต้อง')
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('ลิงก์โฟลเดอร์ Google Drive ไม่ถูกต้อง')
  if (u.hostname !== 'drive.google.com' && u.hostname !== 'docs.google.com') {
    throw new Error('รองรับเฉพาะลิงก์ drive.google.com เท่านั้น')
  }

  const resourceKey = u.searchParams.get('resourcekey') || undefined
  const m = /\/folders\/([A-Za-z0-9_-]+)/.exec(u.pathname)
  let id = m?.[1]
  if (!id && /^\/(open|folderview|embeddedfolderview)\/?$/.test(u.pathname)) {
    id = u.searchParams.get('id') || undefined
  }
  if (!id || !ID_RE.test(id)) {
    throw new Error('ไม่พบ ID โฟลเดอร์ในลิงก์ — ต้องเป็นลิงก์แบบ drive.google.com/drive/folders/<ID>')
  }
  return resourceKey && /^[A-Za-z0-9_-]+$/.test(resourceKey) ? { id, resourceKey } : { id }
}

export function parseDriveFolderId(url: string): string {
  return parseDriveFolderLink(url).id
}

/** ลิงก์มาตรฐานของโฟลเดอร์ (ใช้เก็บใน sourceName) */
export function driveFolderUrl(ref: DriveFolderRef): string {
  const base = `https://drive.google.com/drive/folders/${ref.id}`
  return ref.resourceKey ? `${base}?resourcekey=${ref.resourceKey}` : base
}

// ─── แยกรายการไฟล์จาก HTML ของ embeddedfolderview ───────────────────────────

function classify(href: string, mime: string | undefined, isFolderIcon: boolean, name: string): DriveEntryKind {
  if (isFolderIcon || /\/drive\/(?:u\/\d+\/)?folders\//.test(href) || mime === 'application/vnd.google-apps.folder') return 'folder'
  if (mime === 'application/vnd.google-apps.document' || /docs\.google\.com\/document\/d\//.test(href)) return 'gdoc'
  if (mime?.startsWith('application/vnd.google-apps.')) return 'other' // Sheets/Slides/shortcut ฯลฯ
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx'
  if (mime?.startsWith('image/')) return 'image'
  if (!mime || mime === 'application/octet-stream') {
    if (/\.docx$/i.test(name)) return 'docx'
    if (IMAGE_EXT_RE.test(name)) return 'image'
  }
  return 'other'
}

/** แยกรายการจาก HTML หน้า embeddedfolderview — pure function (unit test ได้) */
export function parseEmbeddedFolderHtml(html: string, folderId = ''): DriveFolderListing {
  const root = parse(html)
  const title = (root.querySelector('title')?.text || '').trim()
  const entries: DriveEntry[] = []
  const seen = new Set<string>()

  for (const el of root.querySelectorAll('.flip-entry')) {
    const a = el.querySelector('a')
    const href = a?.getAttribute('href') || ''
    const idFromHref = /\/(?:folders|d)\/([A-Za-z0-9_-]+)/.exec(href)?.[1]
    const idFromAttr = (el.getAttribute('id') || '').replace(/^entry-/, '')
    const id = idFromHref || idFromAttr
    if (!id || !ID_RE.test(id) || seen.has(id)) continue
    seen.add(id)

    const name = (el.querySelector('.flip-entry-title')?.text || '').trim() || id
    const iconBox = el.querySelector('.flip-entry-list-icon')
    const iconSrc = iconBox?.querySelector('img')?.getAttribute('src') || ''
    const mimeMatch = /\/type\/([^?#"]+)/.exec(iconSrc)
    const mimeType = mimeMatch ? decodeURIComponent(mimeMatch[1]) : undefined
    const isFolderIcon = /^folder$/i.test(iconBox?.querySelector('[aria-label]')?.getAttribute('aria-label') || '')

    let resourceKey: string | undefined
    try {
      resourceKey = new URL(href).searchParams.get('resourcekey') || undefined
    } catch {
      /* href ไม่ใช่ URL เต็ม — ข้าม */
    }

    const entry: DriveEntry = { id, name, kind: classify(href, mimeType, isFolderIcon, name) }
    if (mimeType) entry.mimeType = mimeType
    if (resourceKey && /^[A-Za-z0-9_-]+$/.test(resourceKey)) entry.resourceKey = resourceKey
    entries.push(entry)
  }

  return { id: folderId, title, entries }
}

// ─── เรียงชื่อ / เลือกเอกสาร / เลือกปก ───────────────────────────────────────

export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, 'th', { numeric: true, sensitivity: 'base' })
}

export interface ArticleFolderParts {
  doc: DriveEntry | null
  images: DriveEntry[]
  cover: DriveEntry | null
  subFolders: DriveEntry[]
}

/** แยกส่วนของโฟลเดอร์บทความ: เอกสาร (Google Doc ก่อน .docx), รูป (เรียงตามชื่อ), ปก */
export function splitArticleFolder(entries: DriveEntry[]): ArticleFolderParts {
  const byName = [...entries].sort((x, y) => naturalCompare(x.name, y.name))
  const doc = byName.find((e) => e.kind === 'gdoc') || byName.find((e) => e.kind === 'docx') || null
  const images = byName.filter((e) => e.kind === 'image')
  const cover = images.find((e) => COVER_NAME_RE.test(e.name)) || images[0] || null
  const subFolders = byName.filter((e) => e.kind === 'folder')
  return { doc, images, cover, subFolders }
}

// ─── Network (จำกัดโดเมน Google + timeout + จำกัดขนาด) ─────────────────────────

function isAllowedGoogleHost(hostname: string): boolean {
  return (
    hostname === 'drive.google.com' ||
    hostname === 'docs.google.com' ||
    hostname === 'drive.usercontent.google.com' ||
    hostname.endsWith('.googleusercontent.com')
  )
}

class DriveHttpError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

/** fetch แบบตาม redirect เอง ทีละ hop — ตรวจโดเมนทุก hop ก่อนยิง (กัน SSRF) */
async function safeGoogleFetch(url: string, signal: AbortSignal): Promise<Response> {
  let current = url
  for (let hop = 0; hop < 6; hop++) {
    const u = new URL(current)
    if (u.protocol !== 'https:' || !isAllowedGoogleHost(u.hostname)) {
      if (u.hostname === 'accounts.google.com') throw new DriveHttpError(DRIVE_NOT_PUBLIC_MSG, 401)
      throw new DriveHttpError('Drive พาไปที่โดเมนอื่น — ปฏิเสธเพื่อความปลอดภัย', 400)
    }
    const res = await fetch(current, { redirect: 'manual', signal, headers: { 'User-Agent': 'Mozilla/5.0 (MarsOS Upload Article)' } })
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) return res
      current = new URL(loc, current).toString()
      continue
    }
    return res
  }
  throw new DriveHttpError('Drive redirect วนซ้ำเกินไป', 508)
}

async function readCapped(res: Response, max: number, tooBigMsg: string): Promise<Buffer> {
  const len = Number(res.headers.get('content-length') || 0)
  if (len && len > max) throw new Error(tooBigMsg)
  const reader = res.body?.getReader()
  const chunks: Buffer[] = []
  let received = 0
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > max) {
        await reader.cancel().catch(() => undefined)
        throw new Error(tooBigMsg)
      }
      chunks.push(Buffer.from(value))
    }
  }
  return Buffer.concat(chunks)
}

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, label: string): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fn(controller.signal)
  } catch (e) {
    if (controller.signal.aborted) throw new Error(`${label} ใช้เวลานานเกิน ${FETCH_TIMEOUT_MS / 1000} วินาที`)
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/** อ่านรายการไฟล์ในโฟลเดอร์ (ไม่ลงโฟลเดอร์ย่อย) — โฟลเดอร์ต้องแชร์แบบ Anyone with the link */
export async function listDriveFolder(folderId: string, resourceKey?: string): Promise<DriveFolderListing> {
  if (!isValidDriveId(folderId)) throw new Error('ID โฟลเดอร์ไม่ถูกต้อง')
  const qs = new URLSearchParams({ id: folderId })
  if (resourceKey) qs.set('resourcekey', resourceKey)
  const url = `https://drive.google.com/embeddedfolderview?${qs.toString()}`

  return withTimeout(async (signal) => {
    let res: Response
    try {
      res = await safeGoogleFetch(url, signal)
    } catch (e) {
      if (e instanceof DriveHttpError) throw new Error(e.message)
      throw e
    }
    if (res.status === 401 || res.status === 403 || res.status === 404) throw new Error(DRIVE_NOT_PUBLIC_MSG)
    if (!res.ok) throw new Error(`อ่านโฟลเดอร์ Drive ไม่สำเร็จ (HTTP ${res.status})`)
    const html = (await readCapped(res, MAX_LISTING_BYTES, 'หน้ารายการโฟลเดอร์ใหญ่เกินไป')).toString('utf-8')
    if (!/flip-entries/.test(html)) {
      if (/accounts\.google\.com|ServiceLogin/i.test(html)) throw new Error(DRIVE_NOT_PUBLIC_MSG)
      throw new Error('อ่านรายการไฟล์ในโฟลเดอร์ไม่ได้ — Drive อาจเปลี่ยนรูปแบบหน้า')
    }
    return parseEmbeddedFolderHtml(html, folderId)
  }, 'อ่านโฟลเดอร์ Drive')
}

export interface DriveDownload {
  buffer: Buffer
  contentType: string
}

/** ดาวน์โหลดไฟล์จาก Drive (สูงสุด 15MB) — ไฟล์ต้องแชร์แบบ Anyone with the link */
export async function downloadDriveFile(fileId: string, resourceKey?: string): Promise<DriveDownload> {
  if (!isValidDriveId(fileId)) throw new Error('ID ไฟล์ไม่ถูกต้อง')
  const qs = new URLSearchParams({ export: 'download', id: fileId })
  if (resourceKey) qs.set('resourcekey', resourceKey)
  const url = `https://drive.google.com/uc?${qs.toString()}`

  return withTimeout(async (signal) => {
    let res: Response
    try {
      res = await safeGoogleFetch(url, signal)
    } catch (e) {
      if (e instanceof DriveHttpError) throw new Error(e.message)
      throw e
    }
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      throw new Error('ดาวน์โหลดไฟล์ไม่ได้ — ตั้งแชร์โฟลเดอร์เป็น Anyone with the link ก่อน')
    }
    if (!res.ok) throw new Error(`ดาวน์โหลดไฟล์จาก Drive ไม่สำเร็จ (HTTP ${res.status})`)
    const contentType = (res.headers.get('content-type') || '').toLowerCase()
    if (contentType.startsWith('text/html')) {
      // หน้า HTML = ไม่ได้แชร์ หรือหน้าเตือนสแกนไวรัส (ไฟล์ใหญ่มาก) — ไม่รองรับ
      await res.body?.cancel().catch(() => undefined)
      throw new Error('ดาวน์โหลดไฟล์ไม่ได้ — ไฟล์อาจไม่ได้แชร์แบบ Anyone with the link หรือใหญ่เกินไป')
    }
    const buffer = await readCapped(res, MAX_DRIVE_FILE_BYTES, 'ไฟล์ใหญ่เกิน 15MB')
    return { buffer, contentType }
  }, 'ดาวน์โหลดไฟล์จาก Drive')
}

// ─── ย่อรูปเป็น data URI (เก็บลง DB แล้วตอน push ระบบอัปขึ้น Media Library เอง) ────────

const MAX_IMAGE_EDGE = 1600
/** ขนาดไฟล์จริงไม่เกิน ~300KB → data URI (base64) ไม่เกิน ~400KB */
const MAX_IMAGE_BYTES = 300 * 1024

/** ย่อรูปให้ด้านยาวไม่เกิน 1600px เป็น JPEG แล้วคืน data URI (ลดคุณภาพ/ขนาดจนต่ำกว่า ~400KB) */
export async function shrinkImageToDataUrl(input: Buffer): Promise<string> {
  const attempts: Array<{ edge: number; quality: number }> = [
    { edge: MAX_IMAGE_EDGE, quality: 80 },
    { edge: MAX_IMAGE_EDGE, quality: 70 },
    { edge: MAX_IMAGE_EDGE, quality: 60 },
    { edge: 1280, quality: 65 },
    { edge: 1024, quality: 60 },
    { edge: 800, quality: 55 },
  ]
  let out: Buffer | null = null
  for (const { edge, quality } of attempts) {
    out = await sharp(input, { failOn: 'none', limitInputPixels: 100_000_000 })
      .rotate()
      .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer()
    if (out.byteLength <= MAX_IMAGE_BYTES) break
  }
  if (!out) throw new Error('ย่อรูปไม่สำเร็จ')
  return `data:image/jpeg;base64,${out.toString('base64')}`
}

/** ดาวน์โหลดรูปจาก Drive แล้วย่อเป็น data URI */
export async function driveImageToDataUrl(fileId: string, resourceKey?: string): Promise<string> {
  const { buffer } = await downloadDriveFile(fileId, resourceKey)
  try {
    return await shrinkImageToDataUrl(buffer)
  } catch {
    throw new Error('อ่านไฟล์รูปไม่ได้ — รองรับ JPG/PNG/WebP/GIF')
  }
}

/** ลิงก์ภาพย่อสาธารณะของ Drive (ใช้แสดงในหน้า Review เท่านั้น) */
export function driveThumbUrl(fileId: string): string {
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w400`
}

/** รันงานแบบจำกัดจำนวนพร้อมกัน (ใช้ตอนเปิดโฟลเดอร์ย่อยหลายอัน) */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}
