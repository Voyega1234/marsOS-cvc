/**
 * Timeline generator — ported from WordGod /api/timeline.
 * POST { keywords: KeywordRow[], days: number, startDate?: string }
 */
import { NextRequest, NextResponse } from 'next/server'

const THAI_HOLIDAYS: Record<string, string> = {
  '01-01': 'วันขึ้นปีใหม่', '04-06': 'วันจักรี',
  '04-13': 'วันสงกรานต์', '04-14': 'วันสงกรานต์', '04-15': 'วันสงกรานต์',
  '05-01': 'วันแรงงานแห่งชาติ', '05-04': 'วันฉัตรมงคล',
  '06-03': 'วันเฉลิมพระชนมพรรษาสมเด็จพระราชินี',
  '07-28': 'วันเฉลิมพระชนมพรรษา ร.10', '08-12': 'วันแม่แห่งชาติ',
  '10-13': 'วันคล้ายวันสวรรคต ร.9', '10-23': 'วันปิยมหาราช',
  '12-05': 'วันพ่อแห่งชาติ', '12-10': 'วันรัฐธรรมนูญ', '12-31': 'วันสิ้นปี',
}
const LUNAR_HOLIDAYS: Record<number, Record<string, string>> = {
  2026: { '03-03': 'วันมาฆบูชา', '05-31': 'วันวิสาขบูชา', '07-29': 'วันอาสาฬหบูชา', '07-30': 'วันเข้าพรรษา', '10-25': 'วันออกพรรษา' },
  2027: { '02-20': 'วันมาฆบูชา', '05-20': 'วันวิสาขบูชา', '07-18': 'วันอาสาฬหบูชา', '07-19': 'วันเข้าพรรษา', '10-14': 'วันออกพรรษา' },
}
const THAI_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์']

function parseDate(s: string) { return new Date(s + 'T00:00:00') }
function formatDate(d: Date) { return d.toISOString().slice(0, 10) }
function addDays(s: string, n: number) { const d = parseDate(s); d.setDate(d.getDate() + n); return formatDate(d) }
function getHoliday(s: string) { return THAI_HOLIDAYS[s.slice(5)] ?? LUNAR_HOLIDAYS[Number(s.slice(0, 4))]?.[s.slice(5)] ?? null }
function isWeekend(s: string) { const d = parseDate(s).getDay(); return d === 0 || d === 6 }

function getISOWeek(s: string) {
  const d = parseDate(s)
  const dow = (d.getDay() + 6) % 7
  const thu = new Date(d); thu.setDate(d.getDate() - dow + 3)
  const ys = new Date(thu.getFullYear(), 0, 4)
  const ysdow = (ys.getDay() + 6) % 7
  const ws = new Date(ys); ws.setDate(ys.getDate() - ysdow)
  return Math.ceil(((thu.getTime() - ws.getTime()) / 86400000 + 1) / 7)
}

function getMondayOfWeek(week: number, year: number) {
  const jan4 = new Date(year, 0, 4)
  const jan4dow = (jan4.getDay() + 6) % 7
  const m = new Date(jan4); m.setDate(jan4.getDate() - jan4dow + (week - 1) * 7)
  return m
}

function getRelativeWeek(s: string, startWeek: number, startYear: number) {
  const thisMonday = getMondayOfWeek(getISOWeek(s), parseDate(s).getFullYear())
  const startMonday = getMondayOfWeek(startWeek, startYear)
  const diff = Math.round((thisMonday.getTime() - startMonday.getTime()) / 86400000)
  return `สัปดาห์ที่ ${Math.max(Math.floor(diff / 7) + 1, 1)}`
}

function thaiShortDate(s: string) {
  const d = parseDate(s)
  const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']
  const be = (d.getFullYear() + 543) % 100
  return `${d.getDate()} ${months[d.getMonth()]} ${be < 10 ? '0' + be : be}`
}

function seoScore(k: any) {
  const i: Record<string, number> = { transactional: 1000, commercial: 800, navigational: 400, informational: 200, update: 100 }
  return (i[k.intent] ?? 200) + (k.priority === 'high' ? 300 : k.priority === 'medium' ? 150 : 0) + Math.min((k.volume ?? 0) / 10, 100) + (k.opportunity_score ?? 0) * 2
}

export async function POST(req: NextRequest) {
  const { keywords, days, startDate: rawStart } = await req.json()
  if (!keywords?.length || !days) return NextResponse.json({ error: 'keywords[] and days required' }, { status: 400 })

  const totalDays = Math.min(Math.max(Number(days), 7), 365)
  const today = new Date().toISOString().slice(0, 10)
  const startDate = rawStart && /^\d{4}-\d{2}-\d{2}$/.test(rawStart) ? rawStart : today
  const startWeek = getISOWeek(startDate)
  const startYear = parseDate(startDate).getFullYear()

  const sorted = [...keywords].sort((a, b) => seoScore(b) - seoScore(a))
  const totalKws = sorted.length
  const coreCount = Math.ceil(totalKws * 0.8)
  const coreKws = sorted.slice(0, coreCount).map(k => ({ ...k, isCore: true }))
  const supportKws = sorted.slice(coreCount).map(k => ({ ...k, isCore: false }))

  const publishEntries: any[] = []
  const offEntries: any[] = []
  const workingDays: any[] = []

  for (let d = 0; d < totalDays + 180; d++) {
    const dateStr = addDays(startDate, d)
    const weekend = isWeekend(dateStr)
    const holidayName = getHoliday(dateStr)
    const weekLabel = getRelativeWeek(dateStr, startWeek, startYear)
    const weekIso = getISOWeek(dateStr)
    const dayObj = parseDate(dateStr)

    if (weekend || holidayName) {
      offEntries.push({ date: dateStr, thaiDate: thaiShortDate(dateStr), dayOfWeek: THAI_DAYS[dayObj.getDay()], isWeekend: weekend, holidayName: holidayName ?? null, weekLabel, weekIso })
    } else {
      workingDays.push({ dateStr, thaiDate: thaiShortDate(dateStr), dayOfWeek: THAI_DAYS[dayObj.getDay()], weekLabel, weekIso })
    }
    if (workingDays.length >= totalKws && d >= totalDays) break
  }

  const phase1Days = Math.max(1, Math.round(workingDays.length * 0.2))
  const phase2Days = Math.max(1, workingDays.length - phase1Days)
  const phase1Wd = workingDays.slice(0, phase1Days)
  const phase2Wd = workingDays.slice(phase1Days)

  const articlesPerDayP1 = Math.ceil(coreKws.length / phase1Days)
  let coreIdx = 0
  for (const wd of phase1Wd) {
    const batch = Math.min(articlesPerDayP1, coreKws.length - coreIdx)
    for (let b = 0; b < batch; b++) {
      if (coreIdx >= coreKws.length) break
      const kw = coreKws[coreIdx++]
      publishEntries.push({ date: wd.dateStr, thaiDate: wd.thaiDate, dayOfWeek: wd.dayOfWeek, isHoliday: false, keyword: kw.keyword, title: kw.title ?? kw.keyword, priority: kw.priority ?? 'medium', volume: kw.volume ?? 0, intent: kw.intent ?? '', opportunity_score: kw.opportunity_score ?? 0, isCore: true, phase: 1, weekLabel: wd.weekLabel, weekIso: wd.weekIso, articleStatus: 'pending' })
    }
    if (coreIdx >= coreKws.length) break
  }

  const supportSpread = supportKws.length > 0 && phase2Wd.length > 0 ? Math.max(1, Math.floor(phase2Wd.length / supportKws.length)) : 1
  let supportIdx = 0
  for (let i = 0; i < phase2Wd.length && supportIdx < supportKws.length; i++) {
    if (i % supportSpread === 0) {
      const wd = phase2Wd[i]
      const kw = supportKws[supportIdx++]
      publishEntries.push({ date: wd.dateStr, thaiDate: wd.thaiDate, dayOfWeek: wd.dayOfWeek, isHoliday: false, keyword: kw.keyword, title: kw.title ?? kw.keyword, priority: kw.priority ?? 'medium', volume: kw.volume ?? 0, intent: kw.intent ?? '', opportunity_score: kw.opportunity_score ?? 0, isCore: false, phase: 2, weekLabel: wd.weekLabel, weekIso: wd.weekIso, articleStatus: 'pending' })
    }
  }

  publishEntries.sort((a, b) => a.date.localeCompare(b.date))

  const weekMap: Record<string, any> = {}
  for (const e of publishEntries) {
    if (!weekMap[e.weekLabel]) {
      const d = parseDate(e.date); const dow = (d.getDay() + 6) % 7; const monday = new Date(d); monday.setDate(d.getDate() - dow)
      weekMap[e.weekLabel] = { label: e.weekLabel, weekIso: e.weekIso, mondayDate: formatDate(monday), core: 0, support: 0, holidays: [], weekendDays: 0 }
    }
    if (e.isCore) weekMap[e.weekLabel].core++; else weekMap[e.weekLabel].support++
  }
  for (const o of offEntries) {
    if (!weekMap[o.weekLabel]) {
      const d = parseDate(o.date); const dow = (d.getDay() + 6) % 7; const monday = new Date(d); monday.setDate(d.getDate() - dow)
      weekMap[o.weekLabel] = { label: o.weekLabel, weekIso: o.weekIso, mondayDate: formatDate(monday), core: 0, support: 0, holidays: [], weekendDays: 0 }
    }
    if (o.isWeekend) weekMap[o.weekLabel].weekendDays++
    if (o.holidayName) weekMap[o.weekLabel].holidays.push(o.holidayName)
  }

  const weeks = Object.values(weekMap).sort((a: any, b: any) => a.mondayDate.localeCompare(b.mondayDate))
  const endDate = publishEntries.length > 0 ? publishEntries[publishEntries.length - 1].date : startDate

  return NextResponse.json({ days: totalDays, startDate, endDate, publishDays: publishEntries.length, skippedDays: offEntries.length, phase1Days, phase2Days, coreCount, supportCount: supportKws.length, supportSpread, entries: publishEntries, weeks })
}
