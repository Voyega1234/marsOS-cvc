import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getGSCServiceAuth, getServiceIdentity } from '@/lib/google-auth'
import { updatePrefs } from '@/lib/upload-article/prefs-store'
import type { UploadGscReportPrefs } from '@/lib/upload-article/types'

/** PUT /api/upload-article/clients/[id]/report/site body {siteUrl} — เลือกเว็บ GSC สำหรับแท็บ Report (ต้องอยู่ในสิทธิ์ service account) */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const client = await prisma.uploadClient.findFirst({ where: { id: params.id, organizationId: session.user.organizationId } })
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const siteUrl = typeof body?.siteUrl === 'string' ? body.siteUrl.trim() : ''
  if (!siteUrl) return NextResponse.json({ error: 'ต้องระบุ siteUrl' }, { status: 400 })

  try {
    const auth = await getGSCServiceAuth()
    const sc = google.searchconsole({ version: 'v1', auth })
    const res = await sc.sites.list()
    const known = new Set((res.data.siteEntry ?? []).map((s) => s.siteUrl ?? '').filter(Boolean))
    if (!known.has(siteUrl)) {
      const identity = await getServiceIdentity()
      return NextResponse.json({
        error: `ไม่พบเว็บนี้ในสิทธิ์ของ Service Account${identity.email ? ` — เพิ่ม ${identity.email} เป็นผู้ใช้ในเว็บนี้ที่ Search Console ก่อน` : ''}`,
      }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: `ตรวจสอบสิทธิ์ GSC ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
  }

  const nextGscReport: UploadGscReportPrefs = { siteUrl }
  const result = await updatePrefs(params.id, session.user.organizationId, (current) => ({
    prefs: { ...current, gscReport: nextGscReport },
    result: nextGscReport,
  }))
  if (!result) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })
  return NextResponse.json(result.result)
}

export const dynamic = 'force-dynamic'
export const maxDuration = 60
