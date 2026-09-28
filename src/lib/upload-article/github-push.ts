// ─── PBN Backlinks — ดันบทความขึ้นเว็บที่เก็บโค้ดบน GitHub (deploy ด้วย Vercel / Cloudflare Pages) ─────
// เขียนไฟล์บทความ (+ รูปปก) ลง repo เป็น commit เดียวผ่าน Git Data API
// → Vercel / Cloudflare ที่ผูก repo ไว้ build ใหม่ครั้งเดียวต่อการ push หนึ่งครั้ง
// ปลายทางเป็น api.github.com เท่านั้น (โฮสต์คงที่ ไม่ต้องกัน SSRF เพิ่ม) ส่วน Deploy Hook ยิงผ่าน safeFetch

import { safeFetch, checkCredentialUrl } from './safe-fetch'
import { cleanRepoPath, pbnArticleUrl, DEFAULT_GH_BRANCH, DEFAULT_GH_DIR, type PbnFileFormat } from './pbn'

const GH_API = 'https://api.github.com'
const TIMEOUT_MS = 20_000

export interface GithubTarget {
  owner: string
  repo: string
  branch?: string
  token: string
}

export interface GithubPublishInput extends GithubTarget {
  dir?: string
  format?: PbnFileFormat
  imageDir?: string
  imageUrl?: string
  siteUrl: string
  urlPattern?: string
  deployHook?: string
  title: string
  html: string
  slug: string
  metaTitle?: string
  metaDescription?: string
  coverBase64?: string
  coverMimeType?: string
  coverAlt?: string
  publishMode: 'draft' | 'publish'
  language?: string
  /** วันที่ในไฟล์ (ISO) — ไม่ส่ง = ตอนนี้ */
  date?: string
}

export interface GithubPublishResult {
  ok: boolean
  postUrl?: string
  /** path ของไฟล์บทความใน repo */
  postId?: string
  commitSha?: string
  deployHookError?: string
  error?: string
}

type FetchFn = typeof fetch

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'MarsOS-PBN/1.0',
    'Content-Type': 'application/json',
  }
}

async function gh<T>(fetchFn: FetchFn, token: string, method: string, path: string, body?: unknown): Promise<{ status: number; data: T | null; message: string }> {
  const res = await fetchFn(`${GH_API}${path}`, {
    method,
    headers: ghHeaders(token),
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'error',
  })
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  const message = data && typeof data === 'object' && typeof (data as { message?: unknown }).message === 'string'
    ? (data as { message: string }).message
    : ''
  return { status: res.status, data: res.ok ? (data as T) : null, message }
}

function repoPath(t: GithubTarget): string {
  return `/repos/${encodeURIComponent(t.owner)}/${encodeURIComponent(t.repo)}`
}

function ghError(status: number, message: string, what: string): string {
  if (status === 401) return 'GitHub Token ไม่ถูกต้องหรือหมดอายุ'
  if (status === 403) return `GitHub ไม่อนุญาต (${message || 'สิทธิ์ token ไม่พอ'}) — token ต้องมีสิทธิ์ Contents: Read and write`
  if (status === 404) return `ไม่พบ${what} — ตรวจชื่อ owner/repo/branch และสิทธิ์ของ token`
  return `GitHub ตอบ ${status}${message ? ` — ${message}` : ''}`
}

/** slug ที่ใช้เป็นชื่อไฟล์ — เก็บตัวอักษรไทยได้ ตัดอักขระที่ใช้ใน path ไม่ได้ */
export function safeFileSlug(slug: string, fallback: string): string {
  const base = (slug || fallback || 'article')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\\/:*?"<>|#%{}^~[\]`'\s]+/g, '-')
    .replace(/\.+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return base.slice(0, 120) || 'article'
}

function extFromMime(mime: string | undefined): string {
  const m = (mime || '').toLowerCase()
  if (m.includes('png')) return 'png'
  if (m.includes('webp')) return 'webp'
  if (m.includes('gif')) return 'gif'
  return 'jpg'
}

/** ไฟล์บทความ — md/mdx = frontmatter (ค่าทุกตัวเป็น JSON string ปลอดภัยกับ YAML) + HTML, html = หน้าเต็ม */
export function buildArticleFile(input: {
  format: PbnFileFormat
  title: string
  html: string
  slug: string
  metaTitle?: string
  metaDescription?: string
  image?: string
  imageAlt?: string
  draft: boolean
  date: string
  language?: string
}): string {
  if (input.format === 'html') {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    const lines = [
      '<!DOCTYPE html>',
      `<html lang="${esc(input.language || 'th')}">`,
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      `<title>${esc(input.metaTitle || input.title)}</title>`,
    ]
    if (input.metaDescription) lines.push(`<meta name="description" content="${esc(input.metaDescription)}">`)
    if (input.image) lines.push(`<meta property="og:image" content="${esc(input.image)}">`)
    if (input.draft) lines.push('<meta name="robots" content="noindex">')
    lines.push('</head>', '<body>', input.html, '</body>', '</html>', '')
    return lines.join('\n')
  }
  const fm: Array<[string, string | boolean]> = [
    ['title', input.title],
    ['metaTitle', input.metaTitle || input.title],
    ['description', input.metaDescription || ''],
    ['date', input.date],
    ['slug', input.slug],
    ['draft', input.draft],
  ]
  if (input.image) fm.push(['image', input.image])
  if (input.image) fm.push(['imageAlt', input.imageAlt || input.title])
  const head = fm.map(([k, v]) => `${k}: ${typeof v === 'boolean' ? String(v) : JSON.stringify(v)}`).join('\n')
  return `---\n${head}\n---\n\n${input.html}\n`
}

function validateTarget(t: GithubTarget): string | null {
  if (!t.owner || !t.repo) return 'ยังไม่ได้ใส่ GitHub owner / repo'
  if (!/^[A-Za-z0-9_.-]+$/.test(t.owner) || !/^[A-Za-z0-9_.-]+$/.test(t.repo)) return 'ชื่อ GitHub owner / repo ไม่ถูกต้อง'
  const branch = t.branch || DEFAULT_GH_BRANCH
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.includes('..')) return 'ชื่อ branch ไม่ถูกต้อง'
  if (!t.token) return 'ยังไม่ได้ใส่ GitHub Token'
  return null
}

/** ทดสอบว่า token เข้าถึง repo + branch และมีสิทธิ์เขียนไฟล์ */
export async function testGithubConnection(t: GithubTarget, fetchFn: FetchFn = fetch): Promise<{ ok: boolean; name?: string; error?: string }> {
  const bad = validateTarget(t)
  if (bad) return { ok: false, error: bad }
  const branch = t.branch || DEFAULT_GH_BRANCH
  try {
    const repo = await gh<{ full_name: string; permissions?: { push?: boolean } }>(fetchFn, t.token, 'GET', repoPath(t))
    if (!repo.data) return { ok: false, error: ghError(repo.status, repo.message, ' repo') }
    if (repo.data.permissions && repo.data.permissions.push === false) {
      return { ok: false, error: 'Token อ่าน repo ได้แต่ไม่มีสิทธิ์เขียน — ต้องให้สิทธิ์ Contents: Read and write' }
    }
    const br = await gh<{ name: string }>(fetchFn, t.token, 'GET', `${repoPath(t)}/branches/${encodeURIComponent(branch)}`)
    if (!br.data) return { ok: false, error: ghError(br.status, br.message, ` branch "${branch}"`) }
    return { ok: true, name: `${repo.data.full_name}@${branch}` }
  } catch (e) {
    return { ok: false, error: `เชื่อมต่อ GitHub ไม่ได้: ${e instanceof Error ? e.message : String(e)}` }
  }
}

/** ยิง Deploy Hook (Vercel / Cloudflare Pages) — ใช้เฉพาะเว็บที่ไม่ได้ผูก auto-deploy กับ git */
export async function triggerDeployHook(url: string): Promise<string | null> {
  const bad = await checkCredentialUrl(url)
  if (bad) return bad
  try {
    const res = await safeFetch(url, { method: 'POST', signal: AbortSignal.timeout(15_000) }, { requireHttps: true, sameHostOnly: true })
    if (!res.ok) return `Deploy Hook ตอบ ${res.status}`
    return null
  } catch (e) {
    return `ยิง Deploy Hook ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`
  }
}

/** เขียนบทความ (+ รูปปก) ลง repo เป็น commit เดียว — ชนกับ commit อื่นพร้อมกัน (422) ลองใหม่ 1 ครั้ง */
export async function publishToGithub(input: GithubPublishInput, fetchFn: FetchFn = fetch): Promise<GithubPublishResult> {
  const bad = validateTarget(input)
  if (bad) return { ok: false, error: bad }
  const branch = input.branch || DEFAULT_GH_BRANCH
  const dir = cleanRepoPath(input.dir ?? DEFAULT_GH_DIR)
  if (dir === null) return { ok: false, error: 'โฟลเดอร์บทความใน repo ไม่ถูกต้อง' }
  const imageDir = input.imageDir ? cleanRepoPath(input.imageDir) : ''
  if (imageDir === null) return { ok: false, error: 'โฟลเดอร์รูปใน repo ไม่ถูกต้อง' }

  const format: PbnFileFormat = input.format === 'html' ? 'html' : input.format === 'mdx' ? 'mdx' : 'md'
  const fileSlug = safeFileSlug(input.slug, input.title)
  const articlePath = `${dir ? `${dir}/` : ''}${fileSlug}.${format}`

  // รูปปก — เขียนลง repo เฉพาะเมื่อตั้งโฟลเดอร์รูปไว้
  let imagePath = ''
  let imagePublicUrl = ''
  if (input.coverBase64 && imageDir) {
    imagePath = `${imageDir}/${fileSlug}.${extFromMime(input.coverMimeType)}`
    const publicPath = imagePath.replace(/^public\//, '')
    imagePublicUrl = input.imageUrl
      ? `${input.imageUrl.replace(/\/+$/, '')}/${publicPath.split('/').pop()}`
      : `/${publicPath}`
  }

  const content = buildArticleFile({
    format,
    title: input.title,
    html: input.html,
    slug: fileSlug,
    metaTitle: input.metaTitle,
    metaDescription: input.metaDescription,
    image: imagePublicUrl || undefined,
    imageAlt: input.coverAlt,
    draft: input.publishMode === 'draft',
    date: input.date || new Date().toISOString(),
    language: input.language,
  })

  const token = input.token
  const base = repoPath(input)
  const refPath = `${base}/git/ref/heads/${branch.split('/').map(encodeURIComponent).join('/')}`
  const refsPath = `${base}/git/refs/heads/${branch.split('/').map(encodeURIComponent).join('/')}`

  try {
    // blob ไม่ขึ้นกับ commit ล่าสุด — สร้างครั้งเดียวพอ แม้ต้องลองใหม่
    const files: Array<{ path: string; content: string }> = [{ path: articlePath, content: Buffer.from(content, 'utf8').toString('base64') }]
    if (imagePath && input.coverBase64) files.push({ path: imagePath, content: input.coverBase64 })
    const blobs: Array<{ path: string; sha: string }> = []
    for (const f of files) {
      const blob = await gh<{ sha: string }>(fetchFn, token, 'POST', `${base}/git/blobs`, { content: f.content, encoding: 'base64' })
      if (!blob.data) return { ok: false, error: ghError(blob.status, blob.message, ' repo') }
      blobs.push({ path: f.path, sha: blob.data.sha })
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      const ref = await gh<{ object: { sha: string } }>(fetchFn, token, 'GET', refPath)
      if (!ref.data) return { ok: false, error: ghError(ref.status, ref.message, ` branch "${branch}"`) }
      const headSha = ref.data.object.sha
      const head = await gh<{ tree: { sha: string } }>(fetchFn, token, 'GET', `${base}/git/commits/${headSha}`)
      if (!head.data) return { ok: false, error: ghError(head.status, head.message, ' commit ล่าสุด') }

      const tree = await gh<{ sha: string }>(fetchFn, token, 'POST', `${base}/git/trees`, {
        base_tree: head.data.tree.sha,
        tree: blobs.map((b) => ({ path: b.path, mode: '100644', type: 'blob', sha: b.sha })),
      })
      if (!tree.data) return { ok: false, error: ghError(tree.status, tree.message, ' repo') }

      const commit = await gh<{ sha: string }>(fetchFn, token, 'POST', `${base}/git/commits`, {
        message: `PBN: ${input.title.slice(0, 80)}`,
        tree: tree.data.sha,
        parents: [headSha],
      })
      if (!commit.data) return { ok: false, error: ghError(commit.status, commit.message, ' repo') }

      const upd = await gh<{ object: { sha: string } }>(fetchFn, token, 'PATCH', refsPath, { sha: commit.data.sha, force: false })
      if (upd.data) {
        let deployHookError: string | undefined
        if (input.deployHook) deployHookError = (await triggerDeployHook(input.deployHook)) || undefined
        return {
          ok: true,
          postUrl: pbnArticleUrl({ siteUrl: input.siteUrl, urlPattern: input.urlPattern }, fileSlug),
          postId: articlePath,
          commitSha: commit.data.sha,
          deployHookError,
        }
      }
      // 422 = branch ขยับระหว่างทาง (มี commit อื่นเข้ามา) — อ่าน head ใหม่แล้วลองอีกครั้ง
      if (upd.status !== 422 || attempt === 1) return { ok: false, error: ghError(upd.status, upd.message, ` branch "${branch}"`) }
    }
    return { ok: false, error: 'อัปเดต branch ไม่สำเร็จ' }
  } catch (e) {
    return { ok: false, error: `push ขึ้น GitHub ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}` }
  }
}
