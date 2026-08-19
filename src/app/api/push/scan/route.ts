/**
 * POST /api/push/scan — สแกนเว็บปลายทาง "1 layer ก่อน push จริง"
 *
 * เช็คว่าเว็บมี component ซ้ำกับ card ของบทความอยู่แล้วหรือไม่
 * (TOC plugin / CTA block / FAQ) เพื่อให้หน้า Push ติ๊ก card ที่จะซ้ำออกก่อน publish
 *
 * Body: { projectId?, connectionId?, siteUrl? }
 * ลำดับการหา URL เป้าหมาย: siteUrl (ระบุเอง) > connection > project.wordpressConnection
 *   > project.wpUrl > project.website  (ตรรกะเดียวกับ /api/push/publish)
 *
 * อ่านอย่างเดียว: GET หน้าแรก + โพสต์ล่าสุดผ่าน WP REST (public) — ไม่แตะ credentials
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const maxDuration = 60

interface Signal {
  found: boolean
  /** เจอที่ไหน: template = ระบบเว็บใส่เองทุกโพสต์ (push ซ้ำแน่นอน) /
   *  content = บทความเดิมของเว็บมีอยู่ในเนื้อหา / site = โครงหน้าเว็บนอกบทความ */
  where: 'template' | 'content' | 'site' | null
  evidence: string
}
export interface ScanResult {
  target: string
  checked: string[]
  found: { toc: Signal; cta: Signal; faq: Signal }
}

const DETECTORS: Record<'toc' | 'cta' | 'faq', Array<{ re: RegExp; label: string }>> = {
  toc: [
    { re: /ez-toc|ezTOC/i, label: 'Easy Table of Contents plugin' },
    { re: /lwptoc/i, label: 'LuckyWP TOC plugin' },
    { re: /id="toc_container"|class="toc_/i, label: 'TOC+ plugin' },
    { re: /class="[^"]*\btoc\b[^"]*"|<nav[^>]*aria-label="[^"]*สารบัญ/i, label: 'TOC element ใน theme' },
    { re: /สารบัญ(เนื้อหา|บทความ)?\s*<\/(strong|h[2-4]|span|p|div)/i, label: 'หัวข้อ "สารบัญ" ในหน้าเว็บ' },
  ],
  cta: [
    { re: /class="[^"]*\bcta\b[^"]*"/i, label: 'CTA block (class="cta")' },
    { re: /class="[^"]*call-?to-?action[^"]*"/i, label: 'call-to-action block' },
    { re: /href="https?:\/\/(line\.me|lin\.ee)\//i, label: 'ปุ่ม LINE' },
    { re: /href="tel:/i, label: 'ปุ่มโทรศัพท์' },
  ],
  faq: [
    { re: /"@type"\s*:\s*"FAQPage"/i, label: 'FAQ schema (FAQPage)' },
    { re: /class="[^"]*\bfaq[^"]*"/i, label: 'FAQ element ใน theme' },
    { re: /คำถามที่พบบ่อย/, label: 'หัวข้อ "คำถามที่พบบ่อย"' },
  ],
}

function findIn(docs: string[], key: 'toc' | 'cta' | 'faq'): string | null {
  for (const doc of docs) {
    for (const { re, label } of DETECTORS[key]) {
      if (re.test(doc)) return label
    }
  }
  return null
}

/**
 * จุดสำคัญคือบทความ: เทียบ "หน้าโพสต์ที่ render จริง" กับ "เนื้อดิบจาก REST"
 * เจอในหน้าจริงแต่ไม่อยู่ในเนื้อดิบ = template/plugin ใส่ให้ทุกโพสต์ → push ไปซ้ำแน่นอน
 * (ยกเว้น CTA: header/footer ของทุกเว็บมีปุ่มโทร/LINE อยู่แล้ว — เช็คเฉพาะเนื้อบทความ
 *  กับหน้าแรก ไม่งั้นจะเตือนมั่วทุกเว็บ)
 */
function detect(groups: { home: string[]; rawPosts: string[]; renderedPosts: string[] }): ScanResult['found'] {
  const result = {} as ScanResult['found']
  for (const key of ['toc', 'cta', 'faq'] as const) {
    const inRaw = findIn(groups.rawPosts, key)
    const inRendered = key === 'cta' ? null : findIn(groups.renderedPosts, key)
    const inHome = findIn(groups.home, key)
    let sig: Signal = { found: false, where: null, evidence: '' }
    if (inRaw) sig = { found: true, where: 'content', evidence: inRaw }
    else if (inRendered) {
      // ชี้ว่า template ได้ต่อเมื่อมีเนื้อดิบมาเทียบจริง (REST เปิด) — ไม่งั้นบอกแค่ว่าอยู่ในบทความ
      sig = { found: true, where: groups.rawPosts.length > 0 ? 'template' : 'content', evidence: inRendered }
    }
    else if (inHome) sig = { found: true, where: 'site', evidence: inHome }
    result[key] = sig
  }
  return result
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PlansSEO-PushScanner/1.0)' },
      signal: AbortSignal.timeout(12000),
      redirect: 'follow',
    })
    if (!res.ok) return null
    return (await res.text()).slice(0, 800_000)
  } catch { return null }
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  const orgId = session?.user?.organizationId
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { projectId, connectionId, siteUrl } = await req.json().catch(() => ({}))

  const normalize = (raw: string) =>
    raw.trim().replace(/\/(wp-admin|wp-login\.php)(\/.*)?$/, '').replace(/\/$/, '')

  let target = typeof siteUrl === 'string' && siteUrl.trim() ? normalize(siteUrl) : ''

  if (!target && connectionId) {
    const conn = await prisma.wordPressConnection.findFirst({ where: { id: connectionId, organizationId: orgId } })
    if (conn) target = normalize(conn.siteUrl)
  }
  if (!target && projectId) {
    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: orgId },
      include: { wordpressConnection: true },
    })
    target = normalize(project?.wordpressConnection?.siteUrl ?? (project as { wpUrl?: string } | null)?.wpUrl ?? project?.website ?? '')
  }
  if (!/^https?:\/\//i.test(target)) {
    return NextResponse.json({ error: 'ไม่พบ URL เว็บปลายทาง — เลือก Connection หรือใส่ Site URL ก่อนสแกน' }, { status: 400 })
  }

  const checked: string[] = []
  const groups = { home: [] as string[], rawPosts: [] as string[], renderedPosts: [] as string[] }

  const home = await fetchText(target)
  if (home) { groups.home.push(home); checked.push('หน้าแรก') }

  // บทความคือจุดสำคัญ: ดึงเนื้อดิบ 5 โพสต์ + หน้า render จริง 2 หน้า มาเทียบกัน
  const postsRaw = await fetchText(`${target}/wp-json/wp/v2/posts?per_page=5&_fields=link,content.rendered,title.rendered`)
  if (postsRaw) {
    try {
      const posts = JSON.parse(postsRaw) as Array<{ link?: string; content?: { rendered?: string } }>
      if (Array.isArray(posts) && posts.length) {
        for (const p of posts) if (p.content?.rendered) groups.rawPosts.push(p.content.rendered)
        checked.push(`เนื้อหาบทความล่าสุด ${groups.rawPosts.length} โพสต์`)
        const links = posts.map(p => p.link).filter((l): l is string => !!l && /^https?:\/\//i.test(l)).slice(0, 2)
        for (const link of links) {
          const rendered = await fetchText(link)
          if (rendered) groups.renderedPosts.push(rendered)
        }
        if (groups.renderedPosts.length) checked.push(`หน้าบทความจริง ${groups.renderedPosts.length} หน้า (เช็ค template)`)
      }
    } catch { /* ไม่ใช่ WP หรือ REST ปิด — ใช้เท่าที่มี */ }
  }

  // เว็บที่ปิด WP REST (หรือไม่ใช่ WP) — เดาลิงก์บทความจากหน้าแรกแล้วเปิดหน้าจริงแทน
  if (groups.renderedPosts.length === 0 && home) {
    try {
      const host = new URL(target).host
      const hrefs = Array.from(home.matchAll(/<a[^>]+href="(https?:\/\/[^"#?]+)"/gi), m => m[1])
      const candidates = Array.from(new Set(hrefs))
        .filter(u => { try { return new URL(u).host === host } catch { return false } })
        .map(u => u.replace(/\/$/, ''))
        .filter(u => {
          const path = u.slice(u.indexOf(host) + host.length)
          return path.length > 12 && !/\/(category|tag|author|page|about|contact|privacy|terms|shop|cart|login|wp-)/i.test(path)
        })
        .slice(0, 3)
      for (const link of candidates.slice(0, 2)) {
        const rendered = await fetchText(link)
        if (rendered) groups.renderedPosts.push(rendered)
      }
      if (groups.renderedPosts.length) checked.push(`หน้าบทความจากลิงก์ในหน้าแรก ${groups.renderedPosts.length} หน้า`)
    } catch { /* ใช้เท่าที่มี */ }
  }

  if (groups.home.length + groups.rawPosts.length + groups.renderedPosts.length === 0) {
    return NextResponse.json({ error: `เข้าเว็บ ${target} ไม่ได้ — เช็ค URL หรือเว็บอาจบล็อกบอท`, target }, { status: 502 })
  }

  const result: ScanResult = { target, checked, found: detect(groups) }
  return NextResponse.json(result)
}
