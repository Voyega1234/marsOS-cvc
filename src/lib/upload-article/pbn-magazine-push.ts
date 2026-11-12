// ─── PBN Backlinks — push เข้าเว็บโครง magazine (ฝั่ง server: อ่าน repo + แปลงรูปด้วย sharp) ─────
// กติกาของไฟล์อยู่ใน pbn-magazine.ts — ไฟล์นี้ทำ 3 อย่าง: โหลดรายการหมวดจาก repo, ตรวจก่อน push, ประกอบไฟล์ + รูป
// Upload Article ไม่ใช้ไฟล์นี้

import sharp from 'sharp'
import { readRepoJson, repoFileExists, type GithubTarget } from './github-push'
import { cleanRepoPath, DEFAULT_GH_DIR, type PbnPushRecord, type PbnSite } from './pbn'
import {
  MAGAZINE_SLUG_RE,
  bangkokDate,
  buildMagazineFile,
  findMagazineCluster,
  magazineBody,
  magazineConfigPath,
  parseMagazineConfig,
  type MagazineClusters,
} from './pbn-magazine'

type FetchFn = typeof fetch

/** ปกของเว็บ magazine กว้าง 1600px + รูปย่อ 640px (ชื่อ <slug>-640.webp) ตามที่ธีมของเว็บอ่าน */
const COVER_W = 1600
const THUMB_W = 640
const INLINE_W = 1200
const IMAGE_DIR_RE = /(?:^|\/)public\/images$/
const RESERVED_SLUG_PREFIX = 'home-'
/** รูปแบบปกที่รับ: data URI แบบ base64 (แบบเดียวกับที่ระบบเก็บปกของบทความ) */
const COVER_DATA_RE = /^data:[^;,]+;base64,([\s\S]+)$/i

/** บทความมีปกที่ push เข้าเว็บ magazine ได้หรือไม่ */
export function hasMagazineCover(cover: string | null | undefined): boolean {
  return !!cover && COVER_DATA_RE.test(cover)
}

export async function loadMagazineClusters(
  site: PbnSite,
  target: GithubTarget,
  fetchFn: FetchFn = fetch,
): Promise<{ ok: true; clusters: MagazineClusters; configPath: string } | { ok: false; error: string }> {
  const configPath = magazineConfigPath(site)
  if (!configPath) {
    return { ok: false, error: 'หา site.config.json ไม่เจอ — ตั้งโฟลเดอร์บทความเป็น <เว็บ>/content/articles หรือใส่ path ของ site.config.json ในหน้า Setting' }
  }
  const cfg = await readRepoJson(target, configPath, fetchFn)
  if (!cfg.ok) return { ok: false, error: cfg.error }
  const clusters = parseMagazineConfig(cfg.data)
  if (!clusters) return { ok: false, error: `ไฟล์ ${configPath} ไม่มีรายการหมวด (clusters)` }
  return { ok: true, clusters, configPath }
}

/** โฟลเดอร์รูปของเว็บ magazine — บังคับ และต้องลงท้ายด้วย public/images (เว็บอ่านปกจาก /images/<slug>.webp เท่านั้น) */
export function magazineImageDir(site: Pick<PbnSite, 'name' | 'ghImageDir'>): { ok: true; dir: string } | { ok: false; error: string } {
  const dir = site.ghImageDir ? cleanRepoPath(site.ghImageDir) : ''
  if (!dir) {
    return { ok: false, error: `เว็บ ${site.name} ยังไม่ได้ตั้งโฟลเดอร์รูป — ใส่โฟลเดอร์รูป (เช่น general-1/public/images) ในหน้า Setting ก่อน เว็บนี้ไม่รับบทความที่ไม่มีปก` }
  }
  if (!IMAGE_DIR_RE.test(dir)) {
    return { ok: false, error: `โฟลเดอร์รูปของเว็บ ${site.name} ต้องลงท้ายด้วย public/images (เว็บอ่านปกจาก /images/<slug>.webp เท่านั้น)` }
  }
  return { ok: true, dir }
}

export interface MagazinePushCheck {
  slug: string
  cluster: string
  clusterLabel: string
  /** path ของไฟล์บทความใน repo */
  articlePath: string
  /** โฟลเดอร์รูปใน repo (ลงท้ายด้วย public/images) — บังคับ เพราะเว็บตรวจว่าทุกบทความต้องมีปก */
  imageDir: string
}

export function magazineArticlePath(site: Pick<PbnSite, 'ghDir'>, slug: string): string | null {
  const dir = cleanRepoPath(site.ghDir ?? DEFAULT_GH_DIR)
  if (dir === null) return null
  return `${dir ? `${dir}/` : ''}${slug}.md`
}

/** ตรวจทุกอย่างที่ทำให้ push เข้าเว็บ magazine แล้วพัง — เรียกก่อนจองสถานะ PUSHING */
export async function checkMagazinePush(
  args: {
    site: PbnSite
    target: GithubTarget
    articleSlug: string
    cluster: string
    publishMode: 'draft' | 'publish'
    /** ปกของบทความ (data URI) — เว็บ magazine ไม่รับบทความที่ไม่มีปก */
    cover: string | null | undefined
    prevPush?: PbnPushRecord
  },
  fetchFn: FetchFn = fetch,
): Promise<{ ok: true; check: MagazinePushCheck } | { ok: false; error: string }> {
  const { site } = args
  if (args.publishMode === 'draft') {
    return { ok: false, error: `เว็บ ${site.name} ไม่มีโหมด Draft — เลือก Publish (บทความจะขึ้นเว็บเมื่อรัน workflow เผยแพร่ของ repo, ตั้งวันเผยแพร่ล่วงหน้าได้)` }
  }
  const slug = (args.articleSlug || '').trim().toLowerCase()
  if (!MAGAZINE_SLUG_RE.test(slug) || slug.length > 120) {
    return { ok: false, error: `slug ของเว็บ ${site.name} ต้องเป็นตัวอังกฤษพิมพ์เล็ก ตัวเลข และขีดกลางเท่านั้น (เช่น best-coffee-2026) — แก้ slug ก่อน push` }
  }
  // ชื่อรูป home-*.webp เป็นรูปหน้าแรกของเว็บ — script merge ของ repo ไม่รับบทความที่ slug ขึ้นต้นแบบนี้
  if (slug.startsWith(RESERVED_SLUG_PREFIX)) {
    return { ok: false, error: `slug ของเว็บ ${site.name} ห้ามขึ้นต้นด้วย "${RESERVED_SLUG_PREFIX}" (เว็บจองชื่อนี้ไว้ให้รูปหน้าแรก) — แก้ slug ก่อน push` }
  }
  const articlePath = magazineArticlePath(site, slug)
  if (!articlePath) return { ok: false, error: 'โฟลเดอร์บทความใน repo ไม่ถูกต้อง' }
  const images = magazineImageDir(site)
  if (!images.ok) return { ok: false, error: images.error }
  const imageDir = images.dir
  if (!args.cover) {
    return { ok: false, error: `บทความนี้ยังไม่มีรูปปก — เว็บ ${site.name} ไม่รับบทความที่ไม่มีปก สร้างหรืออัปโหลดปกในหน้า Review ก่อน push` }
  }
  if (!hasMagazineCover(args.cover)) {
    return { ok: false, error: `รูปปกของบทความนี้เป็นลิงก์ภายนอก ระบบแปลงเป็นไฟล์รูปของเว็บ ${site.name} ไม่ได้ — สร้างหรืออัปโหลดปกใหม่ในหน้า Review ก่อน push` }
  }
  if (!args.cluster) return { ok: false, error: `เลือกหมวดของเว็บ ${site.name} ก่อน push` }

  const loaded = await loadMagazineClusters(site, args.target, fetchFn)
  if (!loaded.ok) return { ok: false, error: loaded.error }
  const hit = findMagazineCluster(loaded.clusters, args.cluster)
  if (!hit) return { ok: false, error: `ไม่พบหมวด "${args.cluster}" บนเว็บ ${site.name} — เลือกหมวดใหม่` }

  // ไฟล์ชื่อนี้มีอยู่แล้วและไม่ใช่ไฟล์ที่เรา push ไว้ = บทความของระบบอื่น ห้ามเขียนทับ
  if (args.prevPush?.postId !== articlePath) {
    const exists = await repoFileExists(args.target, articlePath, fetchFn)
    if (!exists.ok) return { ok: false, error: exists.error }
    if (exists.exists) return { ok: false, error: `เว็บ ${site.name} มีบทความ slug "${slug}" อยู่แล้ว — เปลี่ยน slug ก่อน (ไม่เขียนทับบทความเดิมของเว็บ)` }
  }
  return { ok: true, check: { slug, cluster: hit.slug, clusterLabel: hit.label, articlePath, imageDir } }
}

async function toWebp(base64: string, width: number): Promise<string | null> {
  try {
    const buf = await sharp(Buffer.from(base64, 'base64'))
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer()
    return buf.toString('base64')
  } catch {
    return null
  }
}

export interface MagazinePushFiles {
  fileContent: string
  extraFiles: Array<{ path: string; contentBase64: string }>
  /** YYYY-MM-DD ที่เขียนลงไฟล์ */
  date: string
  warnings: string[]
}

/** ประกอบไฟล์ .md + รูป webp ทั้งหมดของบทความ 1 ชิ้น — โยน Error เมื่อไม่มีปก หรือรูปแปลงเป็น webp ไม่ได้ */
export async function buildMagazinePush(args: {
  check: MagazinePushCheck
  title: string
  seoTitle?: string | null
  description?: string | null
  html: string
  /** data URI ของปก */
  cover?: string | null
  /** keyword ของบทความ — ไม่มี = ใช้ชื่อบทความ */
  keyword?: string | null
  /** URL ปลายทางของ backlink */
  targetUrl?: string | null
  /** วัน-เวลาเผยแพร่ที่ตั้งไว้ (ISO) */
  publishAt?: string
  prevPush?: PbnPushRecord
}): Promise<MagazinePushFiles> {
  const { check } = args
  const warnings: string[] = []
  const today = bangkokDate()
  const date = args.publishAt
    ? bangkokDate(args.publishAt)
    : args.prevPush?.date ?? (args.prevPush?.at ? bangkokDate(args.prevPush.at) : today)
  const updated = args.prevPush && date < today ? today : undefined

  const body = magazineBody(args.html, {
    slug: check.slug,
    targetUrl: args.targetUrl,
    coverSrc: args.cover,
    keepImages: !!check.imageDir,
  })
  if (!args.targetUrl) warnings.push('keyword ของบทความนี้ไม่มี URL ปลายทาง — ลิงก์ออกทุกตัวจะเป็น nofollow')
  else if (!body.dofollow) warnings.push('ไม่พบลิงก์ไป URL ปลายทางในบทความ — บทความนี้ยังไม่มี backlink')
  if (body.droppedImages) warnings.push(`ตัดรูปในเนื้อหา ${body.droppedImages} รูป (ข้อมูลรูปไม่ถูกต้อง อ่านไม่ได้)`)

  const extraFiles: MagazinePushFiles['extraFiles'] = []
  for (const img of body.images) {
    const webp = await toWebp(img.base64, INLINE_W)
    if (!webp) throw new Error('แปลงรูปในเนื้อหาเป็น webp ไม่สำเร็จ — ลบรูปนั้นหรือสร้างรูปใหม่แล้ว push อีกครั้ง')
    extraFiles.push({ path: `${check.imageDir}/${img.name}.webp`, contentBase64: webp })
  }

  // ปกบังคับ: ตัวตรวจของ repo (check_articles.py) ตีตกบทความที่ไม่มี public/images/<slug>.webp
  const coverMatch = args.cover ? COVER_DATA_RE.exec(args.cover) : null
  if (!check.imageDir) throw new Error('เว็บนี้ไม่ได้ตั้งโฟลเดอร์รูป — ใส่โฟลเดอร์รูปในหน้า Setting ก่อน push')
  if (!coverMatch) throw new Error('บทความนี้ยังไม่มีรูปปก — สร้างหรืออัปโหลดปกในหน้า Review ก่อน push')
  const raw = coverMatch[1].replace(/\s+/g, '')
  const [full, thumb] = await Promise.all([toWebp(raw, COVER_W), toWebp(raw, THUMB_W)])
  if (!full || !thumb) throw new Error('แปลงรูปปกเป็น webp ไม่สำเร็จ — สร้างปกใหม่ในหน้า Review แล้ว push อีกครั้ง')
  extraFiles.push({ path: `${check.imageDir}/${check.slug}.webp`, contentBase64: full })
  extraFiles.push({ path: `${check.imageDir}/${check.slug}-${THUMB_W}.webp`, contentBase64: thumb })

  const title = args.title.trim()
  const fileContent = buildMagazineFile({
    title,
    description: (args.description || '').trim() || title,
    keyword: (args.keyword || '').trim() || title,
    slug: check.slug,
    cluster: check.cluster,
    date,
    updated,
    seoTitle: (args.seoTitle || '').trim() || undefined,
    html: body.html,
  })
  return { fileContent, extraFiles, date, warnings }
}
