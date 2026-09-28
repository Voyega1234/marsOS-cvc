import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'
import { stripStyleTags, stripLeadingH1 } from '@/lib/articleComponents'
import { publishToSite, type SiteConnectionConfig, type SitePlatform } from '@/lib/sitePublishers'
import { pushArticleToWordPress } from '@/lib/upload-article/wp-push'
import { checkCredentialUrl } from '@/lib/upload-article/safe-fetch'
import { refreshUploadSchema, uploadSchemaOptions } from '@/lib/upload-article/build-html'
import { parseUploadCards, assembleUploadHtml, uploadHtmlVersion } from '@/lib/upload-article/cards'
import { computeClientCounts, toUploadClientDTO } from '@/lib/upload-article/serialize'
import type { UploadPushPrefs, UploadTheme } from '@/lib/upload-article/types'
import { updatePrefs, type PrefsObject } from '@/lib/upload-article/prefs-store'
import { isPbnPrefs, readPbnSites, readPbnPushes, type PbnSite } from '@/lib/upload-article/pbn'
import { publishToGithub } from '@/lib/upload-article/github-push'

export const maxDuration = 300

/** สถานะ PUSHING ค้างนานกว่านี้ถือว่าฟังก์ชันตายกลางทาง (maxDuration 300 วินาที + เผื่อ) */
const PUSH_LOCK_MS = 6 * 60 * 1000

function coverToBase64(dataUri: string | null): { base64?: string; mime?: string } {
  if (!dataUri) return {}
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUri)
  if (!m) return {}
  return { mime: m[1], base64: m[2] }
}

/**
 * ตัด wrapper เอกสารเต็มรูป (<!DOCTYPE>, <html>, <head>, <body>) ออกอย่างเดียว — ไม่แตะเนื้อหา
 * (ไม่ใช้ sanitizeArticleHtml ของส่วนกลางตรงนี้ เพราะขั้นตอนตัดย่อหน้าแรกที่ขึ้นต้นด้วย
 * "แน่นอน"/"ได้เลย"/"Sure" ของมันจะลบข้อความผู้เขียนจริงทิ้งได้)
 */
function stripDocumentWrapper(html: string): string {
  return html.replace(/<!DOCTYPE[^>]*>/gi, '').replace(/<\/?(?:html|head|body)\b[^>]*>/gi, '')
}

/** true/false ตรง ๆ เท่านั้นถึงยึดตามค่าที่ส่งมา ค่าอื่น (undefined/ผิดชนิด) ใช้ค่า default */
function boolPref(value: unknown, fallback: boolean): boolean {
  if (value === true) return true
  if (value === false) return false
  return fallback
}

/** POST /api/upload-article/articles/[articleId]/push — ดันบทความขึ้นเว็บลูกค้า */
export async function POST(req: NextRequest, { params }: { params: { articleId: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const orgId = session.user.organizationId
  const article = await prisma.uploadArticle.findFirst({ where: { id: params.articleId, organizationId: orgId } })
  if (!article) return NextResponse.json({ error: 'ไม่พบบทความ' }, { status: 404 })

  const client = await prisma.uploadClient.findFirst({ where: { id: article.clientId, organizationId: orgId } })
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  const body = await req.json().catch(() => ({} as Record<string, unknown>))

  // กันแก้ทับ — ถ้าหน้าโหลด htmlContent เวอร์ชันเก่ากว่าปัจจุบัน (คนอื่น/แท็บอื่นแก้ไปแล้ว) ห้าม push ทับ
  if (typeof body.htmlVersion === 'string' && body.htmlVersion !== uploadHtmlVersion(article.htmlContent || '')) {
    return NextResponse.json({ error: 'บทความถูกแก้ไขหลังโหลดหน้านี้ — กดโหลดใหม่แล้วเลือก card อีกครั้ง' }, { status: 409 })
  }

  let theme: UploadTheme
  try {
    theme = JSON.parse(client.themeColors)
  } catch {
    theme = { theme: '#2563eb', text: '#1f2937', border: '#e5e7eb', accent: '#2563eb', background: '', styleMode: 'embed' }
  }
  let prevPrefs: UploadPushPrefs
  try {
    prevPrefs = JSON.parse(client.pushPrefs)
  } catch {
    prevPrefs = {}
  }

  const publishMode: 'draft' | 'publish' =
    body.publishMode === 'publish' ? 'publish' : body.publishMode === 'draft' ? 'draft' : (prevPrefs.publishMode ?? 'draft')
  const wpPostType: 'post' | 'page' =
    body.wpPostType === 'page' ? 'page' : body.wpPostType === 'post' ? 'post' : (prevPrefs.wpPostType ?? 'post')
  const useElementor = boolPref(body.useElementor, Boolean(prevPrefs.useElementor))
  const stripH1 = boolPref(body.stripH1, prevPrefs.stripH1 ?? true)

  // วัน-เวลาเผยแพร่ที่ตั้งไว้ในหน้า Review (pushPrefs.publishAt) — ส่งเฉพาะ WordPress
  const rawPublishAt = prevPrefs.publishAt?.[article.id]
  const publishAt = typeof rawPublishAt === 'string' && !Number.isNaN(Date.parse(rawPublishAt)) ? rawPublishAt : undefined

  const fullHtml = article.htmlContent || ''
  if (!fullHtml) return NextResponse.json({ error: 'ยังไม่มี HTML ให้ push — กด Generate ก่อน' }, { status: 400 })

  // client ส่งแค่รายการ card ที่เลือก (กันตัว request body เกินเพดาน 4.5MB ของ Vercel เวลามีรูป base64)
  // server ประกอบ HTML เองจาก htmlContent ที่บันทึกไว้แล้วเสมอ — ไม่รับ HTML ดิบจาก client อีกต่อไป
  let rawHtml = fullHtml
  if (Array.isArray(body.cardIds)) {
    const cardIds = (body.cardIds as unknown[]).filter((x): x is string => typeof x === 'string')
    const parsed = parseUploadCards(fullHtml)
    const selected = new Set(cardIds)
    if (!parsed.cards.some(c => selected.has(c.id))) {
      return NextResponse.json({ error: 'ยังไม่ได้เลือก card ที่จะ push — เลือกอย่างน้อย 1 ส่วน' }, { status: 400 })
    }
    rawHtml = assembleUploadHtml(parsed, selected)
  }

  // schema ต้องตรงกับ meta/slug ล่าสุดเสมอ (แก้ meta หลัง generate ได้)
  let processedHtml = stripDocumentWrapper(refreshUploadSchema(rawHtml, uploadSchemaOptions(article, client)))
  if (theme.styleMode === 'clean') processedHtml = stripStyleTags(processedHtml)
  if (stripH1) processedHtml = stripLeadingH1(processedHtml)
  // บทความที่ generate ก่อนเลิกแสดง breadcrumb ในเนื้อหา — ตัดทิ้งตอน push (schema ยังมี BreadcrumbList)
  processedHtml = processedHtml.replace(/<nav class="content-breadcrumb"[\s\S]*?<\/nav>\s*/g, '')

  // เก็บ preference ที่ใช้รอบนี้ไว้ใน client.pushPrefs (ไม่รอ push สำเร็จก่อน — ผู้ใช้ตั้งใจเลือกแล้ว)
  // เขียนผ่าน updatePrefs (ล็อกแถว อ่านค่าล่าสุดก่อนแก้) กัน prefs ที่เพิ่งถูกแก้จากที่อื่นระหว่างที่ request นี้กำลังทำงานหาย (lost update)
  const prefsResult = await updatePrefs(client.id, orgId, (current) => {
    const next: UploadPushPrefs = { ...(current as UploadPushPrefs), useElementor, wpPostType, publishMode, stripH1 }
    return { prefs: next as PrefsObject, result: next }
  })
  const updatedClientRow = prefsResult ? { ...client, pushPrefs: JSON.stringify(prefsResult.result) } : client

  // PBN Backlinks: เว็บปลายทางเลือกต่อการ push (body.siteId) จากรายการเว็บ PBN ที่ connect ไว้
  const isPbn = isPbnPrefs(prevPrefs as Record<string, unknown>)
  let pbnSite: PbnSite | null = null
  if (isPbn) {
    const siteId = typeof body.siteId === 'string' ? body.siteId : ''
    if (!siteId) return NextResponse.json({ error: 'เลือกเว็บ PBN ที่จะ push ก่อน' }, { status: 400 })
    pbnSite = readPbnSites(prevPrefs as Record<string, unknown>).find((s) => s.id === siteId) ?? null
    if (!pbnSite) return NextResponse.json({ error: 'ไม่พบเว็บ PBN นี้ — อาจถูกลบไปแล้ว' }, { status: 404 })
  }
  const prevPbnPush = pbnSite ? readPbnPushes(prevPrefs as Record<string, unknown>)[article.id]?.[pbnSite.id] : undefined

  const platform = pbnSite ? pbnSite.platform : client.websitePlatform || 'wordpress'
  // บทความที่ตั้งวันเผยแพร่ไว้ ขึ้น WordPress เป็น Draft พร้อมวันที่นั้นเสมอ (โหมด Publish ใช้กับบทความที่ไม่ได้ตั้งวัน)
  const isWordPress = platform === 'wordpress'
  const effectiveMode: 'draft' | 'publish' = publishAt && isWordPress ? 'draft' : publishMode

  // ตรวจการเชื่อมต่อให้ครบก่อนจองสถานะ — ทุก return ก่อนจุดจองจะไม่ทิ้งสถานะ PUSHING ค้าง
  let conn: SiteConnectionConfig = {}
  let wpPass = ''
  let wpUrl = client.wpUrl || ''
  let wpUser = client.wpUser || ''
  let ghToken = ''
  let deployHook = ''
  if (pbnSite && pbnSite.platform === 'github') {
    if (!pbnSite.ghOwner || !pbnSite.ghRepo || !pbnSite.ghTokenEnc) {
      return NextResponse.json({ error: `เว็บ ${pbnSite.name} ยังตั้งค่า GitHub repo / Token ไม่ครบ` }, { status: 400 })
    }
    try {
      ghToken = decrypt(pbnSite.ghTokenEnc)
      deployHook = pbnSite.deployHookEnc ? decrypt(pbnSite.deployHookEnc) : ''
    } catch {
      return NextResponse.json({ error: 'ถอดรหัส GitHub Token ไม่สำเร็จ — ใส่ Token ใหม่ในหน้า Setting' }, { status: 500 })
    }
  } else if (pbnSite) {
    wpUrl = pbnSite.wpUrl || pbnSite.siteUrl
    wpUser = pbnSite.wpUser || ''
    if (!wpUrl || !wpUser || !pbnSite.wpPassEnc) {
      return NextResponse.json({ error: `เว็บ ${pbnSite.name} ยังตั้งค่า WordPress URL / User / Application Password ไม่ครบ` }, { status: 400 })
    }
    const credErr = await checkCredentialUrl(wpUrl)
    if (credErr) return NextResponse.json({ error: credErr }, { status: 400 })
    try {
      wpPass = decrypt(pbnSite.wpPassEnc)
    } catch {
      return NextResponse.json({ error: 'ถอดรหัส Application Password ไม่สำเร็จ' }, { status: 500 })
    }
  } else if (platform !== 'wordpress') {
    try {
      conn = JSON.parse(client.siteConnection || '{}')
    } catch {
      conn = {}
    }
    const targetUrl = conn.custom?.webhookUrl
    if (targetUrl) {
      const credErr = await checkCredentialUrl(targetUrl)
      if (credErr) return NextResponse.json({ error: credErr }, { status: 400 })
    }
  } else {
    if (!client.wpUrl || !client.wpUser || !client.wpAppPasswordEnc) {
      return NextResponse.json({ error: 'ยังไม่ได้ตั้งค่า WordPress URL / User / Application Password' }, { status: 400 })
    }
    const credErr = await checkCredentialUrl(client.wpUrl)
    if (credErr) return NextResponse.json({ error: credErr }, { status: 400 })
    try {
      wpPass = decrypt(client.wpAppPasswordEnc)
    } catch {
      return NextResponse.json({ error: 'ถอดรหัส Application Password ไม่สำเร็จ' }, { status: 500 })
    }
  }

  // จองสถานะ PUSHING แบบ atomic กันกด push ซ้ำ/สองแท็บพร้อมกันจนได้โพสต์ซ้ำบนเว็บลูกค้า
  // ค้างเกิน 6 นาที (ฟังก์ชันถูกตัดกลางทาง) ถือว่าหมดอายุ จองใหม่ได้
  const claim = await prisma.uploadArticle.updateMany({
    where: {
      id: article.id,
      OR: [{ status: { not: 'PUSHING' } }, { updatedAt: { lt: new Date(Date.now() - PUSH_LOCK_MS) } }],
    },
    data: { status: 'PUSHING' },
  })
  if (claim.count === 0) {
    return NextResponse.json({ error: 'บทความนี้กำลัง push อยู่ — รอให้เสร็จก่อนแล้วค่อยลองใหม่' }, { status: 409 })
  }

  let ok = false
  let postUrl: string | undefined
  let postId: string | undefined
  let error: string | undefined

  try {
    const { base64, mime } = coverToBase64(article.coverImageUrl)
    if (pbnSite && pbnSite.platform === 'github') {
      const result = await publishToGithub({
        owner: pbnSite.ghOwner as string,
        repo: pbnSite.ghRepo as string,
        branch: pbnSite.ghBranch,
        token: ghToken,
        dir: pbnSite.ghDir,
        format: pbnSite.ghFormat,
        imageDir: pbnSite.ghImageDir,
        imageUrl: pbnSite.ghImageUrl,
        siteUrl: pbnSite.siteUrl,
        urlPattern: pbnSite.urlPattern,
        deployHook: deployHook || undefined,
        title: article.title,
        html: processedHtml,
        slug: article.slug || article.title,
        metaTitle: article.seoTitle || article.title,
        metaDescription: article.metaDescription || undefined,
        coverBase64: base64,
        coverMimeType: mime,
        coverAlt: article.coverAlt || article.title,
        publishMode,
        language: client.language === 'en' ? 'en' : 'th',
        date: publishAt,
      })
      ok = result.ok
      postUrl = result.postUrl
      postId = result.postId
      error = result.ok ? result.deployHookError : result.error
    } else if (platform !== 'wordpress') {
      const result = await publishToSite(platform as SitePlatform, conn, {
        title: article.title,
        html: processedHtml,
        slug: article.slug || undefined,
        excerpt: article.metaDescription || undefined,
        coverBase64: base64,
        coverMimeType: mime,
        publishMode,
      })
      ok = result.ok
      postUrl = result.postUrl
      postId = result.postId
      error = result.error
    } else {
      // PBN: แก้โพสต์เดิมเฉพาะเว็บเดียวกับที่เคย push บทความนี้ไป — เว็บอื่นสร้างโพสต์ใหม่
      const existingPostId = pbnSite
        ? (prevPbnPush?.postId && /^\d+$/.test(prevPbnPush.postId) ? Number(prevPbnPush.postId) : undefined)
        : article.wordpressPostId ? Number(article.wordpressPostId) : undefined
      const result = await pushArticleToWordPress({
        wpUrl,
        wpUser,
        wpPass,
        title: article.title,
        html: processedHtml,
        slug: article.slug || undefined,
        metaTitle: article.seoTitle || article.title,
        metaDescription: article.metaDescription || undefined,
        coverBase64: base64,
        coverMimeType: mime,
        coverAlt: article.coverAlt || article.title,
        publishMode: effectiveMode,
        publishAt,
        useElementor,
        wpPostType,
        existingPostId,
      })
      ok = result.ok
      postUrl = result.postUrl
      postId = result.postId ? String(result.postId) : undefined
      error = result.error
    }
  } catch (e) {
    ok = false
    error = e instanceof Error ? e.message : String(e)
  }

  // re-push ที่เคย push สำเร็จมาก่อนแล้วพังรอบนี้ ห้ามทับสถานะเดิมด้วย FAILED — คืน PUSHED แล้วเก็บแค่ pushError ไว้เตือน
  let wasPushed = Boolean(article.wordpressPostId)
  if (pbnSite) {
    // PBN: จดผล push ต่อเว็บไว้ใน pushPrefs.pbnPushes — บทความเดียวขึ้นได้หลายเว็บ
    wasPushed = Boolean(readPbnPushes(prevPrefs as Record<string, unknown>)[article.id])
    if (ok) {
      const site = pbnSite
      await updatePrefs(client.id, orgId, (current) => {
        const pushes = readPbnPushes(current)
        pushes[article.id] = { ...(pushes[article.id] || {}), [site.id]: { url: postUrl, postId, at: new Date().toISOString() } }
        return { prefs: { ...current, pbnPushes: pushes }, result: null }
      })
      await prisma.uploadArticle.update({
        where: { id: article.id },
        data: {
          status: 'PUSHED',
          wordpressUrl: postUrl || null,
          pushMode: effectiveMode,
          pushedAt: new Date(),
          // push สำเร็จแต่ Deploy Hook พัง — แจ้งไว้ ไม่นับเป็น push ล้มเหลว
          pushError: error ? `${site.name}: ${error}` : null,
        },
      })
    } else {
      await prisma.uploadArticle.update({
        where: { id: article.id },
        data: { status: wasPushed ? 'PUSHED' : 'FAILED', pushError: `${pbnSite.name}: ${error || 'push ไม่สำเร็จ'}` },
      })
    }
  } else if (ok) {
    await prisma.uploadArticle.update({
      where: { id: article.id },
      data: {
        status: 'PUSHED',
        wordpressUrl: postUrl || null,
        wordpressPostId: postId || null,
        pushMode: effectiveMode,
        pushedAt: new Date(),
        pushError: null,
      },
    })
  } else if (wasPushed) {
    await prisma.uploadArticle.update({
      where: { id: article.id },
      data: { status: 'PUSHED', pushError: error || 'push ไม่สำเร็จ' },
    })
  } else {
    await prisma.uploadArticle.update({
      where: { id: article.id },
      data: { status: 'FAILED', pushError: error || 'push ไม่สำเร็จ' },
    })
  }

  const articleRows = await prisma.uploadArticle.findMany({ where: { clientId: client.id, organizationId: orgId }, select: { status: true } })
  const clientDto = toUploadClientDTO(updatedClientRow, computeClientCounts(articleRows))

  return NextResponse.json({ ok, postUrl, postId, error, client: clientDto })
}
