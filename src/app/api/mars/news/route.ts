/**
 * Mars SEO News — รายการหัวข้อข่าว (cache in-memory 30 นาที)
 * ส่วนสรุปรายวันอยู่ที่ /api/mars/news/digest
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { buildNewsResponse, CACHE_TTL_MS, type MarsNewsResponse } from '@/lib/marsNews'

let cache: { data: MarsNewsResponse; expiresAt: number } | null = null

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const forceRefresh = searchParams.get('refresh') === '1'

  if (!forceRefresh && cache && cache.expiresAt > Date.now()) {
    return NextResponse.json(cache.data)
  }

  const built = await buildNewsResponse()
  const data: MarsNewsResponse = {
    ...built,
    items: built.items.map(item => ({ ...item, excerpt: item.excerpt?.slice(0, 220) })),
  }
  cache = { data, expiresAt: Date.now() + CACHE_TTL_MS }

  return NextResponse.json(data)
}
