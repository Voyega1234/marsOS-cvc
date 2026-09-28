// ─── PBN Backlinks — โปรเจกต์เดียวต่อองค์กร ใช้เครื่องมือชุดเดียวกับ Upload Article ─────────────
// เก็บเป็น UploadClient หนึ่งแถวที่ pushPrefs.kind = 'pbn' (ไม่แก้ schema)
// เว็บ PBN ทุกเว็บอยู่ใน pushPrefs.pbnSites (token เข้ารหัสด้วย encrypt() ห้ามส่งกลับหน้าเว็บ)
// ประวัติ push ต่อบทความต่อเว็บอยู่ใน pushPrefs.pbnPushes
// ไฟล์นี้ใช้ได้ทั้งฝั่งเซิร์ฟเวอร์และหน้าเว็บ — ห้าม import โมดูลของ Node (crypto/prisma) ที่นี่

export const PBN_KIND = 'pbn'
/** ข้อความที่ปรากฏใน pushPrefs (JSON.stringify ไม่มีช่องว่าง) ของแถว PBN — ใช้กรองด้วย contains ใน DB */
export const PBN_PREFS_MARK = '"kind":"pbn"'
export const PBN_CLIENT_NAME = 'PBN Backlinks'
/** จำนวนบทความต่อ keyword สูงสุดที่ให้เขียนได้ในรอบเดียว */
export const PBN_MAX_VARIANTS = 10

export type PbnPlatform = 'wordpress' | 'github'
export type PbnHost = 'vercel' | 'cloudflare' | 'other'
export type PbnFileFormat = 'md' | 'mdx' | 'html'

/** รูปแบบที่เก็บใน DB (มี secret เข้ารหัส) — ห้ามส่งออกนอกเซิร์ฟเวอร์ */
export interface PbnSite {
  id: string
  name: string
  siteUrl: string
  platform: PbnPlatform
  // WordPress
  wpUrl?: string
  wpUser?: string
  wpPassEnc?: string
  // GitHub (เว็บที่ deploy ผ่าน Vercel / Cloudflare Pages)
  host?: PbnHost
  ghOwner?: string
  ghRepo?: string
  ghBranch?: string
  ghDir?: string
  ghFormat?: PbnFileFormat
  ghImageDir?: string
  ghImageUrl?: string
  ghTokenEnc?: string
  urlPattern?: string
  deployHookEnc?: string
  // Report
  gscSiteUrl?: string
  ga4PropertyId?: string
  createdAt: string
  updatedAt?: string
}

/** รูปแบบที่ส่งให้หน้าเว็บ — ไม่มี secret มีแค่สถานะว่ามี/ไม่มี */
export interface PbnSiteDTO {
  id: string
  name: string
  siteUrl: string
  platform: PbnPlatform
  wpUrl: string
  wpUser: string
  hasWpPassword: boolean
  host: PbnHost
  ghOwner: string
  ghRepo: string
  ghBranch: string
  ghDir: string
  ghFormat: PbnFileFormat
  ghImageDir: string
  ghImageUrl: string
  hasGhToken: boolean
  urlPattern: string
  hasDeployHook: boolean
  gscSiteUrl: string
  ga4PropertyId: string
  createdAt: string
  updatedAt: string
}

export interface PbnPushRecord {
  url?: string
  postId?: string
  at: string
}

/** articleId → siteId → ผล push ล่าสุด */
export type PbnPushes = Record<string, Record<string, PbnPushRecord>>

export const DEFAULT_GH_BRANCH = 'main'
export const DEFAULT_GH_DIR = 'content/blog'
export const DEFAULT_URL_PATTERN = '{siteUrl}/blog/{slug}'

export function isPbnPrefs(prefs: Record<string, unknown> | null | undefined): boolean {
  return !!prefs && prefs.kind === PBN_KIND
}

export function isPbnPrefsRaw(raw: string | null | undefined): boolean {
  return typeof raw === 'string' && raw.includes(PBN_PREFS_MARK)
}

export function readPbnSites(prefs: Record<string, unknown> | null | undefined): PbnSite[] {
  const raw = prefs?.pbnSites
  if (!Array.isArray(raw)) return []
  return raw.filter((s): s is PbnSite =>
    !!s && typeof s === 'object' && typeof (s as PbnSite).id === 'string' && typeof (s as PbnSite).name === 'string',
  )
}

export function readPbnPushes(prefs: Record<string, unknown> | null | undefined): PbnPushes {
  const raw = prefs?.pbnPushes
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: PbnPushes = {}
  for (const [articleId, bySite] of Object.entries(raw as Record<string, unknown>)) {
    if (!bySite || typeof bySite !== 'object') continue
    const sites: Record<string, PbnPushRecord> = {}
    for (const [siteId, rec] of Object.entries(bySite as Record<string, unknown>)) {
      if (!rec || typeof rec !== 'object') continue
      const r = rec as Record<string, unknown>
      if (typeof r.at !== 'string') continue
      sites[siteId] = {
        at: r.at,
        url: typeof r.url === 'string' ? r.url : undefined,
        postId: typeof r.postId === 'string' ? r.postId : undefined,
      }
    }
    if (Object.keys(sites).length) out[articleId] = sites
  }
  return out
}

export function toPbnSiteDTO(s: PbnSite): PbnSiteDTO {
  return {
    id: s.id,
    name: s.name,
    siteUrl: s.siteUrl || '',
    platform: s.platform === 'github' ? 'github' : 'wordpress',
    wpUrl: s.wpUrl || '',
    wpUser: s.wpUser || '',
    hasWpPassword: Boolean(s.wpPassEnc),
    host: s.host === 'cloudflare' ? 'cloudflare' : s.host === 'other' ? 'other' : 'vercel',
    ghOwner: s.ghOwner || '',
    ghRepo: s.ghRepo || '',
    ghBranch: s.ghBranch || DEFAULT_GH_BRANCH,
    ghDir: s.ghDir ?? DEFAULT_GH_DIR,
    ghFormat: s.ghFormat === 'html' ? 'html' : s.ghFormat === 'mdx' ? 'mdx' : 'md',
    ghImageDir: s.ghImageDir || '',
    ghImageUrl: s.ghImageUrl || '',
    hasGhToken: Boolean(s.ghTokenEnc),
    urlPattern: s.urlPattern || DEFAULT_URL_PATTERN,
    hasDeployHook: Boolean(s.deployHookEnc),
    gscSiteUrl: s.gscSiteUrl || '',
    ga4PropertyId: s.ga4PropertyId || '',
    createdAt: s.createdAt,
    updatedAt: s.updatedAt || s.createdAt,
  }
}

// ─── validate input จากหน้า Setting ─────────────────────────────────────────

const GH_NAME_RE = /^[A-Za-z0-9_.-]{1,100}$/
const GH_BRANCH_RE = /^[A-Za-z0-9._/-]{1,200}$/
const GH_PATH_RE = /^[A-Za-z0-9._/-]{0,300}$/

/** path ใน repo ต้องเป็น relative ไม่มี .. ไม่ขึ้นต้น/ลงท้ายด้วย / */
export function cleanRepoPath(p: string): string | null {
  const v = p.trim().replace(/^\/+|\/+$/g, '')
  if (!GH_PATH_RE.test(v)) return null
  if (v.split('/').some((seg) => seg === '..' || seg === '.')) return null
  return v
}

function str(v: unknown, max = 500): string | undefined {
  return typeof v === 'string' ? v.trim().slice(0, max) : undefined
}

function normalizeSiteUrl(v: string): string {
  if (!v) return ''
  const withProto = /^https?:\/\//i.test(v) ? v : `https://${v}`
  return withProto.replace(/\/+$/, '')
}

function hostOf(url: string | undefined): string {
  if (!url) return ''
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return url.trim().toLowerCase()
  }
}

export interface PbnSiteInputResult {
  site?: PbnSite
  error?: string
  /** secret ที่ถูกล้างเพราะเปลี่ยนเว็บ/repo โดยไม่ได้ใส่ secret ใหม่ */
  cleared: string[]
}

/**
 * รวมค่าที่ส่งมากับค่าเดิม (existing) — secret: ว่าง = คงค่าเดิม, null = ลบ, ข้อความ = เข้ารหัสใหม่
 * encryptFn / newId ส่งเข้ามา (ไม่ import ตรง) เพื่อให้ไฟล์นี้ใช้ฝั่งหน้าเว็บได้ และ unit test เรียกได้โดยไม่ต้องมี env key
 */
export function mergePbnSiteInput(
  input: Record<string, unknown>,
  existing: PbnSite | null,
  encryptFn: (s: string) => string,
  newId: () => string,
  now: Date = new Date(),
): PbnSiteInputResult {
  const cleared: string[] = []
  const base: PbnSite = existing
    ? { ...existing }
    : { id: newId(), name: '', siteUrl: '', platform: 'wordpress', createdAt: now.toISOString() }

  const name = str(input.name, 120)
  if (name !== undefined) base.name = name
  const siteUrl = str(input.siteUrl, 300)
  if (siteUrl !== undefined) base.siteUrl = normalizeSiteUrl(siteUrl)
  if (input.platform === 'wordpress' || input.platform === 'github') base.platform = input.platform
  if (!base.name) base.name = hostOf(base.siteUrl) || ''
  if (!base.name) return { error: 'กรุณาใส่ชื่อเว็บหรือ URL', cleared }
  if (base.siteUrl) {
    try {
      const u = new URL(base.siteUrl)
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: 'URL เว็บไม่ถูกต้อง', cleared }
    } catch {
      return { error: 'URL เว็บไม่ถูกต้อง', cleared }
    }
  }

  // ── WordPress ──
  const prevWpHost = hostOf(existing?.wpUrl)
  const prevWpUser = existing?.wpUser || ''
  const wpUrl = str(input.wpUrl, 300)
  if (wpUrl !== undefined) base.wpUrl = wpUrl ? normalizeSiteUrl(wpUrl) : ''
  const wpUser = str(input.wpUser, 120)
  if (wpUser !== undefined) base.wpUser = wpUser
  if (input.wpPassword === null) {
    delete base.wpPassEnc
  } else if (typeof input.wpPassword === 'string' && input.wpPassword.trim()) {
    base.wpPassEnc = encryptFn(input.wpPassword.trim())
  } else if (base.wpPassEnc && (hostOf(base.wpUrl) !== prevWpHost || (base.wpUser || '') !== prevWpUser)) {
    // เปลี่ยนเว็บ/ผู้ใช้โดยไม่ได้ใส่รหัสใหม่ → ล้างรหัสเดิม กันรหัสหลุดไปเว็บอื่น
    delete base.wpPassEnc
    cleared.push('wpPassword')
  }

  // ── GitHub ──
  const prevRepo = `${existing?.ghOwner || ''}/${existing?.ghRepo || ''}`.toLowerCase()
  if (input.host === 'vercel' || input.host === 'cloudflare' || input.host === 'other') base.host = input.host
  const ghOwner = str(input.ghOwner, 100)
  if (ghOwner !== undefined) {
    if (ghOwner && !GH_NAME_RE.test(ghOwner)) return { error: 'GitHub owner ไม่ถูกต้อง', cleared }
    base.ghOwner = ghOwner
  }
  const ghRepo = str(input.ghRepo, 100)
  if (ghRepo !== undefined) {
    const repo = ghRepo.replace(/\.git$/i, '')
    if (repo && !GH_NAME_RE.test(repo)) return { error: 'ชื่อ GitHub repo ไม่ถูกต้อง', cleared }
    base.ghRepo = repo
  }
  const ghBranch = str(input.ghBranch, 200)
  if (ghBranch !== undefined) {
    const b = ghBranch || DEFAULT_GH_BRANCH
    if (!GH_BRANCH_RE.test(b) || b.includes('..')) return { error: 'ชื่อ branch ไม่ถูกต้อง', cleared }
    base.ghBranch = b
  }
  const ghDir = str(input.ghDir, 300)
  if (ghDir !== undefined) {
    const d = cleanRepoPath(ghDir)
    if (d === null) return { error: 'โฟลเดอร์บทความใน repo ไม่ถูกต้อง (ห้ามมี .. หรืออักขระพิเศษ)', cleared }
    base.ghDir = d
  }
  const ghImageDir = str(input.ghImageDir, 300)
  if (ghImageDir !== undefined) {
    const d = cleanRepoPath(ghImageDir)
    if (d === null) return { error: 'โฟลเดอร์รูปใน repo ไม่ถูกต้อง', cleared }
    base.ghImageDir = d
  }
  const ghImageUrl = str(input.ghImageUrl, 300)
  if (ghImageUrl !== undefined) base.ghImageUrl = ghImageUrl.replace(/\/+$/, '')
  if (input.ghFormat === 'md' || input.ghFormat === 'mdx' || input.ghFormat === 'html') base.ghFormat = input.ghFormat
  const urlPattern = str(input.urlPattern, 300)
  if (urlPattern !== undefined) base.urlPattern = urlPattern || DEFAULT_URL_PATTERN

  const nextRepo = `${base.ghOwner || ''}/${base.ghRepo || ''}`.toLowerCase()
  if (input.ghToken === null) {
    delete base.ghTokenEnc
  } else if (typeof input.ghToken === 'string' && input.ghToken.trim()) {
    base.ghTokenEnc = encryptFn(input.ghToken.trim())
  } else if (base.ghTokenEnc && existing && nextRepo !== prevRepo) {
    delete base.ghTokenEnc
    cleared.push('ghToken')
  }

  if (input.deployHook === null) {
    delete base.deployHookEnc
  } else if (typeof input.deployHook === 'string' && input.deployHook.trim()) {
    const hook = input.deployHook.trim()
    try {
      if (new URL(hook).protocol !== 'https:') return { error: 'Deploy Hook ต้องเป็น https://', cleared }
    } catch {
      return { error: 'Deploy Hook URL ไม่ถูกต้อง', cleared }
    }
    base.deployHookEnc = encryptFn(hook)
  }

  // ── Report ──
  const gsc = str(input.gscSiteUrl, 300)
  if (gsc !== undefined) base.gscSiteUrl = gsc
  const ga4 = str(input.ga4PropertyId, 60)
  if (ga4 !== undefined) {
    const id = ga4.replace(/^properties\//, '')
    if (id && !/^\d{1,20}$/.test(id)) return { error: 'GA4 Property ID ต้องเป็นตัวเลข', cleared }
    base.ga4PropertyId = id
  }

  if (existing) base.updatedAt = now.toISOString()
  return { site: base, cleared }
}

/** URL ของบทความบนเว็บ GitHub-based ตาม pattern ของเว็บนั้น */
export function pbnArticleUrl(site: Pick<PbnSite, 'siteUrl' | 'urlPattern'>, slug: string): string {
  const pattern = site.urlPattern || DEFAULT_URL_PATTERN
  const siteUrl = (site.siteUrl || '').replace(/\/+$/, '')
  return pattern.replace(/\{siteUrl\}/g, siteUrl).replace(/\{slug\}/g, encodeURIComponent(slug))
}

// ─── เวอร์ชันของบทความ (เขียนหลายบทความจาก keyword เดียว) ────────────────────

/** sourceName ของบทความที่เขียนจาก keyword — เวอร์ชัน 1 ใช้รูปแบบเดิม `kw:<id>` */
export function writerSourceName(keywordId: string, variant = 1): string {
  return variant > 1 ? `kw:${keywordId}#v${variant}` : `kw:${keywordId}`
}

/** แยก keywordId + เวอร์ชันจาก sourceName (null = ไม่ได้เขียนจาก keyword) */
export function parseWriterSourceName(sourceName: string | null | undefined): { keywordId: string; variant: number } | null {
  if (!sourceName || !sourceName.startsWith('kw:')) return null
  const rest = sourceName.slice(3)
  const m = /^(.*)#v(\d+)$/.exec(rest)
  if (m) return { keywordId: m[1], variant: Number(m[2]) }
  return { keywordId: rest, variant: 1 }
}
