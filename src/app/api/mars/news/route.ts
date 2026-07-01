import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const MARS_DATA_ROOT = path.join(os.homedir(), 'Desktop', 'Mars', 'mars-seo-intelligence-free-trends', 'data', 'reports', 'json')

function getAvailableDates(): string[] {
  try {
    return fs.readdirSync(MARS_DATA_ROOT)
      .filter(f => /^\d{4}-\d{2}-\d{2}$/.test(f))
      .sort()
      .reverse()
  } catch {
    return []
  }
}

function readNewsForDate(date: string) {
  const filePath = path.join(MARS_DATA_ROOT, date, 'category_news_intelligence.json')
  if (!fs.existsSync(filePath)) return null
  const raw = fs.readFileSync(filePath, 'utf-8')
  return JSON.parse(raw)
}

function readSiteReportsForDate(date: string): Record<string, unknown>[] {
  try {
    const dir = path.join(MARS_DATA_ROOT, date)
    return fs.readdirSync(dir)
      .filter(f => f.startsWith('site_') && f.endsWith('_report.json'))
      .map(f => {
        try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) } catch { return null }
      })
      .filter(Boolean) as Record<string, unknown>[]
  } catch {
    return []
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const requestedDate = searchParams.get('date')

  const availableDates = getAvailableDates()

  if (availableDates.length === 0) {
    return NextResponse.json({
      error: 'ไม่พบข้อมูล Mars Intelligence — ตรวจสอบว่า mars-seo-intelligence-free-trends รัน run_morning.py แล้ว',
      categories: [],
      seo_updates: { items: [], has_meaningful: false },
      available_dates: [],
    }, { status: 200 })
  }

  const targetDate = requestedDate && availableDates.includes(requestedDate)
    ? requestedDate
    : availableDates[0]

  const data = readNewsForDate(targetDate)
  if (!data) {
    return NextResponse.json({
      error: `ไม่พบไฟล์ข้อมูลสำหรับวันที่ ${targetDate}`,
      categories: [],
      seo_updates: { items: [], has_meaningful: false },
      available_dates: availableDates,
    }, { status: 200 })
  }

  // Build refresh_opportunity categories from site reports
  const siteReports = readSiteReportsForDate(targetDate)
  const refreshCategories: unknown[] = []

  for (const report of siteReports) {
    const items = (report.content_refresh as Record<string, unknown>[]) ?? []
    const clientName = (report.client_name as string) ?? (report.site_key as string) ?? 'Unknown'
    const siteUrl = (report.url as string) ?? ''

    for (const item of items) {
      const url = item.url as string ?? ''
      const slug = url.replace(siteUrl, '').replace(/\/$/, '') || url
      const priority = (item.priority as string) ?? 'medium'
      const reasons = (item.reasons as string[]) ?? []
      const rec = (item.recommendation as string) ?? ''
      const daysOld = (item.days_old as number) ?? 0
      const clicksNow = (item.clicks_now as number) ?? 0

      refreshCategories.push({
        category_id: `refresh_${slug.replace(/\W+/g, '_')}`,
        category_name: slug,
        category_name_th: `${clientName}: ${slug}`,
        status: 'refresh_opportunity',
        priority: priority === 'high' ? 'P1' : priority === 'medium' ? 'P2' : 'P3',
        news_title: rec || reasons[0] || 'ควร Refresh บทความนี้',
        source: clientName,
        reference_url: url,
        published: `ค้างมา ${daysOld} วัน · Clicks: ${clicksNow}`,
        trend_signal: reasons.join(' · '),
        why_it_matters: reasons.join(' · '),
        content_angle: rec ? [rec] : reasons,
        suitable_sites: [],
        recommended_usage: 'Content Refresh',
        // extra fields for display
        days_old: daysOld,
        clicks_now: clicksNow,
        site_key: report.site_key,
      })
    }
  }

  // Merge refresh categories into the categories array (prepend high priority)
  const mergedCategories = [
    ...refreshCategories,
    ...(data.categories ?? []),
  ]

  return NextResponse.json({
    ...data,
    categories: mergedCategories,
    available_dates: availableDates,
  })
}
