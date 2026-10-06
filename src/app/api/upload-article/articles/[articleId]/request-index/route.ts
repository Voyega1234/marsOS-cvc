import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'
import { getWordPressPostStatus } from '@/lib/upload-article/wp-push'
import { checkCredentialUrl } from '@/lib/upload-article/safe-fetch'
import { isIndexableUrl, requestIndexForArticle } from '@/lib/upload-article/request-index'
import { isPbnPrefs } from '@/lib/upload-article/pbn'
import { parsePrefs } from '@/lib/upload-article/prefs-store'
import { computeClientCounts, toUploadClientDTO } from '@/lib/upload-article/serialize'
import type { UploadPushPrefs } from '@/lib/upload-article/types'

export const maxDuration = 60

/**
 * POST /api/upload-article/articles/[articleId]/request-index
 * กด Request Index เองจากหน้า Push — สำหรับบทความที่ขึ้นเว็บแล้ว
 * WordPress: เช็คสถานะจริงก่อน (บทความตั้งวันเผยแพร่ขึ้นไปเป็น Draft แล้วทีมกด Publish ใน WordPress เอง)
 * ถ้า Publish แล้ว อัปเดตลิงก์จริง + pushMode = publish ในระบบให้ด้วย
 */
export async function POST(_req: NextRequest, { params }: { params: { articleId: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const orgId = session.user.organizationId
  const article = await prisma.uploadArticle.findFirst({ where: { id: params.articleId, organizationId: orgId } })
  if (!article) return NextResponse.json({ error: 'ไม่พบบทความ' }, { status: 404 })
  const client = await prisma.uploadClient.findFirst({ where: { id: article.clientId, organizationId: orgId } })
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  const prefs = parsePrefs(client.pushPrefs) as UploadPushPrefs
  if (isPbnPrefs(prefs as Record<string, unknown>)) {
    return NextResponse.json({ error: 'Request Index ใช้กับลูกค้า Upload Article เท่านั้น' }, { status: 400 })
  }
  if (article.status !== 'PUSHED' || (!article.wordpressPostId && !article.wordpressUrl)) {
    return NextResponse.json({ error: 'บทความนี้ยังไม่ได้ขึ้นเว็บ — Push ก่อน' }, { status: 400 })
  }

  let url = article.wordpressUrl || ''
  const platform = client.websitePlatform || 'wordpress'

  if (platform === 'wordpress') {
    if (!client.wpUrl || !client.wpUser || !client.wpAppPasswordEnc || !article.wordpressPostId) {
      return NextResponse.json({ error: 'ยังไม่ได้ตั้งค่า WordPress / ไม่พบ ID โพสต์' }, { status: 400 })
    }
    const credErr = await checkCredentialUrl(client.wpUrl)
    if (credErr) return NextResponse.json({ error: credErr }, { status: 400 })
    let wpPass: string
    try {
      wpPass = decrypt(client.wpAppPasswordEnc)
    } catch {
      return NextResponse.json({ error: 'ถอดรหัส Application Password ไม่สำเร็จ' }, { status: 500 })
    }
    const st = await getWordPressPostStatus(client.wpUrl, client.wpUser, wpPass, article.wordpressPostId, prefs.wpPostType ?? 'post')
    if (!st.ok) return NextResponse.json({ error: `เช็คสถานะโพสต์ใน WordPress ไม่สำเร็จ: ${st.error}` }, { status: 502 })
    if (st.status !== 'publish') {
      const label = st.status === 'future' ? 'ตั้งเวลาเผยแพร่ไว้ (ยังไม่ถึงเวลา)' : `ยังเป็น ${st.status || 'Draft'}`
      return NextResponse.json({ error: `โพสต์ใน WordPress ${label} — กด Publish ใน WordPress ก่อน แล้วค่อย Request Index` }, { status: 400 })
    }
    if (st.link) url = st.link
    // ทีมกด Publish ใน WordPress เอง → ให้ระบบรู้ว่าบทความนี้ขึ้นเว็บจริงแล้ว (ใช้กับ Internal Link ของบทความถัดไป)
    if (url !== article.wordpressUrl || article.pushMode !== 'publish') {
      await prisma.uploadArticle.update({ where: { id: article.id }, data: { wordpressUrl: url, pushMode: 'publish' } })
    }
  } else if (article.pushMode !== 'publish') {
    return NextResponse.json({ error: 'บทความนี้ขึ้นเว็บเป็น Draft — Push แบบ Publish ก่อน แล้วค่อย Request Index' }, { status: 400 })
  }

  if (!isIndexableUrl(url)) {
    return NextResponse.json({ error: 'ไม่พบลิงก์ https ของบทความที่เผยแพร่แล้ว' }, { status: 400 })
  }

  const { record, prefs: nextPrefs } = await requestIndexForArticle(client.id, orgId, article.id, url)
  const clientRow = nextPrefs ? { ...client, pushPrefs: JSON.stringify(nextPrefs) } : client
  const articleRows = await prisma.uploadArticle.findMany({ where: { clientId: client.id, organizationId: orgId }, select: { status: true } })
  return NextResponse.json({
    ok: record.ok,
    error: record.error,
    indexRequest: record,
    client: toUploadClientDTO(clientRow, computeClientCounts(articleRows)),
  }, { status: record.ok ? 200 : 502 })
}
