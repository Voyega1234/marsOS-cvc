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

function readSiteReportsForDate(date: string) {
  const dir = path.join(MARS_DATA_ROOT, date)
  if (!fs.existsSync(dir)) return []

  const files = fs.readdirSync(dir).filter(f => f.startsWith('site_') && f.endsWith('_report.json'))
  return files.map(f => {
    const raw = fs.readFileSync(path.join(dir, f), 'utf-8')
    return JSON.parse(raw)
  })
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const requestedDate = searchParams.get('date')

  const availableDates = getAvailableDates()

  if (availableDates.length === 0) {
    return NextResponse.json({
      error: 'ไม่พบข้อมูล Mars Intelligence',
      sites: [],
      available_dates: [],
    })
  }

  const targetDate = requestedDate && availableDates.includes(requestedDate)
    ? requestedDate
    : availableDates[0]

  const sites = readSiteReportsForDate(targetDate)

  return NextResponse.json({
    date: targetDate,
    sites,
    available_dates: availableDates,
  })
}
