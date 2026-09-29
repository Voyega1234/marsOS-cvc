import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getGSCServiceAuth, getServiceIdentity } from '@/lib/google-auth'
import { parsePrefs } from '@/lib/upload-article/prefs-store'
import { suggestGscSite, type GscSiteEntry } from '@/lib/upload-article/gsc-report'
import type { UploadGscReportPrefs, UploadInternalLinks } from '@/lib/upload-article/types'

/** GET /api/upload-article/clients/[id]/report/sites — เว็บที่ service account เข้าถึงได้ + property ที่เลือกไว้/แนะนำ */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const client = await prisma.uploadClient.findFirst({ where: { id: params.id, organizationId: session.user.organizationId } })
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  const identity = await getServiceIdentity()
  const prefs = parsePrefs(client.pushPrefs)
  const gscReport = prefs.gscReport as UploadGscReportPrefs | undefined
  const selected = gscReport?.siteUrl || null
  const internalLinks = prefs.internalLinks as Partial<UploadInternalLinks> | undefined

  try {
    const auth = await getGSCServiceAuth()
    const sc = google.searchconsole({ version: 'v1', auth })
    const res = await sc.sites.list()
    const sites: GscSiteEntry[] = (res.data.siteEntry ?? [])
      .map((s) => ({ siteUrl: s.siteUrl ?? '', permissionLevel: s.permissionLevel ?? '' }))
      .filter((s) => s.siteUrl)

    let suggested = suggestGscSite(sites, [client.website, client.wpUrl])
    if (!suggested && internalLinks?.gscSiteUrl && sites.some((s) => s.siteUrl === internalLinks.gscSiteUrl)) {
      suggested = internalLinks.gscSiteUrl
    }

    return NextResponse.json({ serviceEmail: identity.email, serviceReady: identity.ready, sites, selected, suggested })
  } catch (e) {
    return NextResponse.json({
      serviceEmail: identity.email,
      serviceReady: identity.ready,
      sites: [],
      selected,
      suggested: null,
      error: `ดึงรายชื่อเว็บจาก GSC ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}${identity.email ? ` — ตรวจสอบว่าเพิ่ม ${identity.email} เป็นผู้ใช้ในเว็บที่ต้องการแล้ว` : ''}`,
    })
  }
}

export const dynamic = 'force-dynamic'
export const maxDuration = 60
