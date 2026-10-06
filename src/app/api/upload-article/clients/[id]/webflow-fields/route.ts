import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/** GET /api/upload-article/clients/[id]/webflow-fields?collectionId=... — รายการฟิลด์ของ Webflow Collection (ใช้ map ฟิลด์ตอนตั้งค่า) */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const client = await prisma.uploadClient.findFirst({ where: { id: params.id, organizationId: session.user.organizationId } })
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  const collectionId = req.nextUrl.searchParams.get('collectionId') ?? ''
  if (!/^[a-f0-9]{24}$/i.test(collectionId)) return NextResponse.json({ error: 'Collection ID ไม่ถูกต้อง' }, { status: 400 })

  let apiToken = ''
  try {
    apiToken = JSON.parse(client.siteConnection || '{}')?.webflow?.apiToken ?? ''
  } catch {
    apiToken = ''
  }
  if (!apiToken) return NextResponse.json({ error: 'ยังไม่ได้บันทึก Webflow API token' }, { status: 400 })

  try {
    const res = await fetch(`https://api.webflow.com/v2/collections/${collectionId}`, {
      headers: { Authorization: `Bearer ${apiToken}` },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return NextResponse.json({ error: `ดึงฟิลด์ของ Collection ไม่สำเร็จ — HTTP ${res.status}: ${text.slice(0, 200)}` }, { status: 400 })
    }
    const data = await res.json()
    const fields = (Array.isArray(data.fields) ? data.fields : []).map((f: { slug: string; displayName?: string; type: string }) => ({
      slug: f.slug, displayName: f.displayName ?? f.slug, type: f.type,
    }))
    return NextResponse.json({ fields, collectionSlug: data.slug ?? '' })
  } catch (e) {
    return NextResponse.json({ error: `ดึงฟิลด์ของ Collection ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}` }, { status: 400 })
  }
}
