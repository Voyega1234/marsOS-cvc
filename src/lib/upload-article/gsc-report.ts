// ─── Upload Article — Report (GSC เท่านั้น): คำนวณล้วน ไม่พึ่ง prisma/session ──────
// เรียกตรงจาก unit test ได้ — route.ts มีหน้าที่แค่ auth + เรียก GSC API แล้วส่งผลมาให้ฟังก์ชันพวกนี้คำนวณ

/** แถวดิบจาก searchanalytics.query (ทั้ง 0 มิติ = totals และหลายมิติ) */
export interface RawGscRow {
  keys?: string[] | null
  clicks?: number | null
  impressions?: number | null
  ctr?: number | null
  position?: number | null
}

export interface GscMetric {
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export function rowMetric(row: RawGscRow | undefined): GscMetric {
  return {
    clicks: row?.clicks ?? 0,
    impressions: row?.impressions ?? 0,
    ctr: row?.ctr ?? 0,
    position: row?.position ?? 0,
  }
}

// ── Overview (totals current vs previous) ──────────────────────────────────────

export interface GscOverview {
  current: GscMetric
  previous: GscMetric
  deltaAbs: GscMetric
  deltaPct: GscMetric
}

function pct(cur: number, prev: number): number {
  if (prev === 0) return cur === 0 ? 0 : 100
  return Math.round(((cur - prev) / prev) * 1000) / 10
}

export function buildOverview(curRows: RawGscRow[], prevRows: RawGscRow[]): GscOverview {
  const current = rowMetric(curRows[0])
  const previous = rowMetric(prevRows[0])
  const deltaAbs: GscMetric = {
    clicks: current.clicks - previous.clicks,
    impressions: current.impressions - previous.impressions,
    ctr: Math.round((current.ctr - previous.ctr) * 10000) / 10000,
    position: Math.round((current.position - previous.position) * 100) / 100,
  }
  const deltaPct: GscMetric = {
    clicks: pct(current.clicks, previous.clicks),
    impressions: pct(current.impressions, previous.impressions),
    ctr: pct(current.ctr, previous.ctr),
    position: pct(current.position, previous.position),
  }
  return { current, previous, deltaAbs, deltaPct }
}

// ── Daily series ─────────────────────────────────────────────────────────────

export interface GscDailyPoint extends GscMetric {
  date: string
}

export function buildDailySeries(rows: RawGscRow[]): GscDailyPoint[] {
  return rows
    .map((r) => ({ date: r.keys?.[0] ?? '', ...rowMetric(r) }))
    .filter((p) => p.date)
    .sort((a, b) => a.date.localeCompare(b.date))
}

// ── Query / page compare rows (current vs previous, new/lost flags) ───────────

export interface GscCompareRow extends GscMetric {
  key: string
  prevClicks: number
  prevImpressions: number
  prevCtr: number
  prevPosition: number
  changeClicks: number
  changeImpressions: number
  isNew: boolean
  isLost: boolean
}

export function mergeCompareRows(curRows: RawGscRow[], prevRows: RawGscRow[], opts: { lostLimit?: number } = {}): GscCompareRow[] {
  const prevMap = new Map<string, GscMetric>()
  for (const r of prevRows) {
    const key = r.keys?.[0] ?? ''
    if (!key) continue
    prevMap.set(key, rowMetric(r))
  }
  const curKeys = new Set<string>()
  const rows: GscCompareRow[] = []
  for (const r of curRows) {
    const key = r.keys?.[0] ?? ''
    if (!key) continue
    curKeys.add(key)
    const cur = rowMetric(r)
    const prev = prevMap.get(key)
    rows.push({
      key,
      ...cur,
      prevClicks: prev?.clicks ?? 0,
      prevImpressions: prev?.impressions ?? 0,
      prevCtr: prev?.ctr ?? 0,
      prevPosition: prev?.position ?? 0,
      changeClicks: cur.clicks - (prev?.clicks ?? 0),
      changeImpressions: cur.impressions - (prev?.impressions ?? 0),
      isNew: !prev,
      isLost: false,
    })
  }
  rows.sort((a, b) => b.clicks - a.clicks)

  const lostLimit = opts.lostLimit ?? 0
  if (lostLimit > 0) {
    const lost = prevRows
      .map((r) => ({ key: r.keys?.[0] ?? '', metric: rowMetric(r) }))
      .filter((r) => r.key && !curKeys.has(r.key))
      .sort((a, b) => b.metric.clicks - a.metric.clicks)
      .slice(0, lostLimit)
      .map((r) => ({
        key: r.key,
        clicks: 0,
        impressions: 0,
        ctr: 0,
        position: 0,
        prevClicks: r.metric.clicks,
        prevImpressions: r.metric.impressions,
        prevCtr: r.metric.ctr,
        prevPosition: r.metric.position,
        changeClicks: -r.metric.clicks,
        changeImpressions: -r.metric.impressions,
        isNew: false,
        isLost: true,
      }))
    return [...rows, ...lost]
  }
  return rows
}

export interface GscQueryRow extends Omit<GscCompareRow, 'key'> {
  query: string
}
export interface GscPageRow extends Omit<GscCompareRow, 'key'> {
  page: string
}

const LOST_LIMIT = 100

export function buildQueryRows(curRows: RawGscRow[], prevRows: RawGscRow[]): GscQueryRow[] {
  return mergeCompareRows(curRows, prevRows, { lostLimit: LOST_LIMIT }).map(({ key, ...rest }) => ({ query: key, ...rest }))
}

export function buildPageRows(curRows: RawGscRow[], prevRows: RawGscRow[]): GscPageRow[] {
  return mergeCompareRows(curRows, prevRows, { lostLimit: LOST_LIMIT }).map(({ key, ...rest }) => ({ page: key, ...rest }))
}

// ── query,page combo (current only) ────────────────────────────────────────────

export interface GscQueryPageRow {
  query: string
  page: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export function parseQueryPageRows(rows: RawGscRow[]): GscQueryPageRow[] {
  return rows
    .map((r) => ({ query: r.keys?.[0] ?? '', page: r.keys?.[1] ?? '', ...rowMetric(r) }))
    .filter((r) => r.query && r.page)
}

// ── Position buckets ───────────────────────────────────────────────────────────

export type PositionBucketLabel = '1-3' | '4-10' | '11-20' | '21-50' | '51+'
export const POSITION_BUCKET_ORDER: PositionBucketLabel[] = ['1-3', '4-10', '11-20', '21-50', '51+']

export function positionBucket(position: number): PositionBucketLabel {
  if (position <= 3) return '1-3'
  if (position <= 10) return '4-10'
  if (position <= 20) return '11-20'
  if (position <= 50) return '21-50'
  return '51+'
}

export interface PositionBucketRow {
  bucket: PositionBucketLabel
  count: number
  clicks: number
  impressions: number
}

function bucketize(rows: RawGscRow[]): PositionBucketRow[] {
  const map = new Map<PositionBucketLabel, PositionBucketRow>()
  for (const b of POSITION_BUCKET_ORDER) map.set(b, { bucket: b, count: 0, clicks: 0, impressions: 0 })
  for (const r of rows) {
    const m = rowMetric(r)
    const entry = map.get(positionBucket(m.position))!
    entry.count += 1
    entry.clicks += m.clicks
    entry.impressions += m.impressions
  }
  return POSITION_BUCKET_ORDER.map((b) => map.get(b)!)
}

export interface PositionBuckets {
  current: PositionBucketRow[]
  previous: PositionBucketRow[]
}

export function buildPositionBuckets(curQueryRows: RawGscRow[], prevQueryRows: RawGscRow[]): PositionBuckets {
  return { current: bucketize(curQueryRows), previous: bucketize(prevQueryRows) }
}

// ── Opportunities ───────────────────────────────────────────────────────────────

export interface StrikingDistanceRow extends GscMetric {
  query: string
}

export function buildStrikingDistance(curQueryRows: RawGscRow[], limit = 50): StrikingDistanceRow[] {
  return curQueryRows
    .map((r) => ({ query: r.keys?.[0] ?? '', ...rowMetric(r) }))
    .filter((r) => r.query && r.position >= 4 && r.position <= 20)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, limit)
}

export interface LowCtrRow extends GscMetric {
  query: string
  bucketAvgCtr: number
  bestPage: string | null
}

export function buildLowCtrOpportunities(curQueryRows: RawGscRow[], queryPageRows: GscQueryPageRow[], limit = 50): LowCtrRow[] {
  const parsed = curQueryRows.map((r) => ({ query: r.keys?.[0] ?? '', ...rowMetric(r) })).filter((r) => r.query)

  const bucketTotals = new Map<PositionBucketLabel, { clicks: number; impressions: number }>()
  for (const b of POSITION_BUCKET_ORDER) bucketTotals.set(b, { clicks: 0, impressions: 0 })
  for (const q of parsed) {
    const t = bucketTotals.get(positionBucket(q.position))!
    t.clicks += q.clicks
    t.impressions += q.impressions
  }
  const bucketAvg = new Map<PositionBucketLabel, number>()
  for (const b of POSITION_BUCKET_ORDER) {
    const t = bucketTotals.get(b)!
    bucketAvg.set(b, t.impressions > 0 ? t.clicks / t.impressions : 0)
  }

  const bestPageByQuery = new Map<string, { page: string; clicks: number }>()
  for (const qp of queryPageRows) {
    const existing = bestPageByQuery.get(qp.query)
    if (!existing || qp.clicks > existing.clicks) bestPageByQuery.set(qp.query, { page: qp.page, clicks: qp.clicks })
  }

  return parsed
    .filter((q) => q.impressions >= 100)
    .map((q) => {
      const avg = bucketAvg.get(positionBucket(q.position)) ?? 0
      return { ...q, bucketAvgCtr: avg, bestPage: bestPageByQuery.get(q.query)?.page ?? null, flagged: avg > 0 && q.ctr < avg * 0.5 }
    })
    .filter((q) => q.flagged)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, limit)
    .map(({ flagged, ...rest }) => rest)
}

// ── Cannibalization ─────────────────────────────────────────────────────────────

export interface CannibalPageEntry extends GscMetric {
  page: string
  share: number
}
export interface CannibalRow {
  query: string
  totalClicks: number
  totalImpressions: number
  pages: CannibalPageEntry[]
}

const CANNIBAL_SHARE_THRESHOLD = 0.1

export function buildCannibalization(queryPageRows: GscQueryPageRow[], limit = 50): CannibalRow[] {
  const byQuery = new Map<string, GscQueryPageRow[]>()
  for (const r of queryPageRows) {
    if (!byQuery.has(r.query)) byQuery.set(r.query, [])
    byQuery.get(r.query)!.push(r)
  }

  const out: CannibalRow[] = []
  for (const [query, rows] of Array.from(byQuery.entries())) {
    const totalImpressions = rows.reduce((s, r) => s + r.impressions, 0)
    if (totalImpressions <= 0) continue
    const withShare: CannibalPageEntry[] = rows.map((r) => ({
      page: r.page,
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
      share: r.impressions / totalImpressions,
    }))
    const heavy = withShare.filter((p) => p.share >= CANNIBAL_SHARE_THRESHOLD)
    if (heavy.length >= 2) {
      out.push({
        query,
        totalClicks: rows.reduce((s, r) => s + r.clicks, 0),
        totalImpressions,
        pages: heavy.sort((a, b) => b.impressions - a.impressions),
      })
    }
  }
  return out.sort((a, b) => b.totalImpressions - a.totalImpressions).slice(0, limit)
}

// ── Device / Country / Search Appearance ────────────────────────────────────────

export interface GscDimensionRow {
  label: string
  clicks: number
  impressions: number
  ctr: number
  position: number
  prevClicks: number
  prevImpressions: number
  prevCtr: number
  prevPosition: number
  changeClicks: number
  changeImpressions: number
}

export function buildDimensionRows(curRows: RawGscRow[], prevRows: RawGscRow[]): GscDimensionRow[] {
  return mergeCompareRows(curRows, prevRows, { lostLimit: 0 }).map(({ key, isNew, isLost, ...rest }) => ({ label: key, ...rest }))
}

const COUNTRY_NAMES: Record<string, string> = {
  tha: 'ไทย', usa: 'สหรัฐอเมริกา', gbr: 'สหราชอาณาจักร', sgp: 'สิงคโปร์', jpn: 'ญี่ปุ่น',
  chn: 'จีน', kor: 'เกาหลีใต้', aus: 'ออสเตรเลีย', deu: 'เยอรมนี', fra: 'ฝรั่งเศส',
  ind: 'อินเดีย', idn: 'อินโดนีเซีย', mys: 'มาเลเซีย', vnm: 'เวียดนาม', phl: 'ฟิลิปปินส์',
  twn: 'ไต้หวัน', hkg: 'ฮ่องกง', can: 'แคนาดา', are: 'สหรัฐอาหรับเอมิเรตส์', nld: 'เนเธอร์แลนด์',
  che: 'สวิตเซอร์แลนด์', esp: 'สเปน', ita: 'อิตาลี', rus: 'รัสเซีย', bra: 'บราซิล',
  mmr: 'เมียนมา', khm: 'กัมพูชา', lao: 'ลาว', nzl: 'นิวซีแลนด์', swe: 'สวีเดน',
  bel: 'เบลเยียม', dnk: 'เดนมาร์ก', fin: 'ฟินแลนด์', nor: 'นอร์เวย์', pol: 'โปแลนด์',
  mex: 'เม็กซิโก', arg: 'อาร์เจนตินา', zaf: 'แอฟริกาใต้', sau: 'ซาอุดีอาระเบีย', isr: 'อิสราเอล',
  pak: 'ปากีสถาน', bgd: 'บังกลาเทศ', npl: 'เนปาล',
}

export function countryLabel(code: string): string {
  const c = (code || '').toLowerCase()
  return COUNTRY_NAMES[c] ?? (code || '').toUpperCase()
}

// ── URL normalization (matching GSC page rows กับบทความที่ push ในระบบ) ──────────

/** normalize URL สำหรับเทียบ: lowercase host, ตัด query/hash/trailing slash, decode percent-encoding (slug ไทย) */
export function normalizeReportUrl(raw: string): string {
  if (!raw) return ''
  const s = raw.trim()
  try {
    const u = new URL(s)
    const host = u.hostname.toLowerCase()
    let path = u.pathname
    try { path = decodeURIComponent(path) } catch { /* เก็บ path เดิมถ้า decode ไม่ได้ (encode เพี้ยน) */ }
    path = path.replace(/\/+$/, '') || ''
    return `${host}${path}`
  } catch {
    let rest = s.split('#')[0].split('?')[0].replace(/^https?:\/\//i, '')
    const slashIdx = rest.indexOf('/')
    let host = slashIdx === -1 ? rest : rest.slice(0, slashIdx)
    let path = slashIdx === -1 ? '' : rest.slice(slashIdx)
    host = host.toLowerCase()
    try { path = decodeURIComponent(path) } catch { /* เก็บ path เดิมถ้า decode ไม่ได้ */ }
    return `${host}${path.replace(/\/+$/, '')}`
  }
}

// ── บทความที่อัปโหลด (PUSHED) เทียบกับ GSC page rows ────────────────────────────

export interface UploadedArticleReportInput {
  id: string
  title: string
  wordpressUrl: string | null
  slug: string
  pushedAt: string | null
}

export interface UploadedArticleTopQuery {
  query: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export interface UploadedArticleReportRow {
  id: string
  title: string
  url: string
  pushedAt: string | null
  clicks: number
  impressions: number
  ctr: number
  position: number
  prevClicks: number
  prevImpressions: number
  prevCtr: number
  prevPosition: number
  changeClicks: number
  changeImpressions: number
  topQueries: UploadedArticleTopQuery[]
}

export function buildUploadedArticleRows(
  articles: UploadedArticleReportInput[],
  websiteFallback: string,
  pageCurRows: RawGscRow[],
  pagePrevRows: RawGscRow[],
  queryPageRows: GscQueryPageRow[],
): UploadedArticleReportRow[] {
  const curByNorm = new Map<string, GscMetric>()
  for (const r of pageCurRows) {
    const url = r.keys?.[0] ?? ''
    if (!url) continue
    curByNorm.set(normalizeReportUrl(url), rowMetric(r))
  }
  const prevByNorm = new Map<string, GscMetric>()
  for (const r of pagePrevRows) {
    const url = r.keys?.[0] ?? ''
    if (!url) continue
    prevByNorm.set(normalizeReportUrl(url), rowMetric(r))
  }
  const queriesByNorm = new Map<string, UploadedArticleTopQuery[]>()
  for (const qp of queryPageRows) {
    const norm = normalizeReportUrl(qp.page)
    if (!queriesByNorm.has(norm)) queriesByNorm.set(norm, [])
    queriesByNorm.get(norm)!.push({ query: qp.query, clicks: qp.clicks, impressions: qp.impressions, ctr: qp.ctr, position: qp.position })
  }

  const zero: GscMetric = { clicks: 0, impressions: 0, ctr: 0, position: 0 }
  const fallbackBase = websiteFallback.replace(/\/+$/, '')

  return articles.map((a) => {
    const url = a.wordpressUrl || `${fallbackBase}/${a.slug}`
    const norm = normalizeReportUrl(url)
    const cur = curByNorm.get(norm) ?? zero
    const prev = prevByNorm.get(norm) ?? zero
    const topQueries = (queriesByNorm.get(norm) ?? []).sort((x, y) => y.clicks - x.clicks).slice(0, 10)
    return {
      id: a.id,
      title: a.title,
      url,
      pushedAt: a.pushedAt,
      clicks: cur.clicks,
      impressions: cur.impressions,
      ctr: cur.ctr,
      position: cur.position,
      prevClicks: prev.clicks,
      prevImpressions: prev.impressions,
      prevCtr: prev.ctr,
      prevPosition: prev.position,
      changeClicks: cur.clicks - prev.clicks,
      changeImpressions: cur.impressions - prev.impressions,
      topQueries,
    }
  })
}

// ── Property suggestion (GET /report/sites) ─────────────────────────────────────

export interface GscSiteEntry {
  siteUrl: string
  permissionLevel?: string
}

function hostOf(candidate: string): string {
  try {
    const withScheme = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`
    return new URL(withScheme).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** เดา GSC property ที่ตรงกับเว็บของลูกค้า (sc-domain:host ก่อน แล้วค่อย https://host/ variants) */
export function suggestGscSite(sites: GscSiteEntry[], candidates: string[]): string | null {
  const hosts = candidates.map(hostOf).filter(Boolean)
  for (const host of hosts) {
    const domainMatch = sites.find((s) => s.siteUrl.toLowerCase() === `sc-domain:${host}`)
    if (domainMatch) return domainMatch.siteUrl
    const urlMatch = sites.find((s) => hostOf(s.siteUrl) === host)
    if (urlMatch) return urlMatch.siteUrl
  }
  return null
}

// ── Report period (ช่วงวันที่ + ช่วงเทียบ) ───────────────────────────────────────

export const REPORT_DAY_OPTIONS = [7, 28, 90, 180, 365] as const
export type ReportDayOption = (typeof REPORT_DAY_OPTIONS)[number]
export type ReportCompareMode = 'previous' | 'yoy'
export type ReportSearchType = 'web' | 'image' | 'video' | 'news' | 'discover'

export interface ReportPeriodInput {
  days?: number
  startDate?: string
  endDate?: string
  compare?: ReportCompareMode
}

export interface ReportPeriod {
  start: string
  end: string
  compareStart: string
  compareEnd: string
}

const DAY_MS = 86400000
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function toDate(s: string): Date {
  return new Date(`${s}T00:00:00Z`)
}
function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS)
}

/** "วันนี้" ตามเวลา Asia/Bangkok (UTC+7) — ใช้กำหนด endDate ตั้งต้น */
export function bangkokToday(): Date {
  const shifted = new Date(Date.now() + 7 * 3600 * 1000)
  return toDate(shifted.toISOString().slice(0, 10))
}

export function resolveReportPeriod(input: ReportPeriodInput): ReportPeriod {
  let end: Date
  let start: Date
  if (input.startDate && DATE_RE.test(input.startDate) && input.endDate && DATE_RE.test(input.endDate)) {
    start = toDate(input.startDate)
    end = toDate(input.endDate)
    if (start.getTime() > end.getTime()) { const t = start; start = end; end = t }
  } else {
    const days = (REPORT_DAY_OPTIONS as readonly number[]).includes(input.days ?? 28) ? (input.days as number) : 28
    end = addDays(bangkokToday(), -3)
    start = addDays(end, -(days - 1))
  }
  const lengthDays = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1

  let compareStart: Date
  let compareEnd: Date
  if (input.compare === 'yoy') {
    compareEnd = new Date(Date.UTC(end.getUTCFullYear() - 1, end.getUTCMonth(), end.getUTCDate()))
    compareStart = new Date(Date.UTC(start.getUTCFullYear() - 1, start.getUTCMonth(), start.getUTCDate()))
  } else {
    compareEnd = addDays(start, -1)
    compareStart = addDays(compareEnd, -(lengthDays - 1))
  }

  return { start: fmtDate(start), end: fmtDate(end), compareStart: fmtDate(compareStart), compareEnd: fmtDate(compareEnd) }
}
