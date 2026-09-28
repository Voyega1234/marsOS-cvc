/**
 * อ่านไฟล์/ข้อความ keyword ที่ทีมวางเข้าแท็บ Keyword — หาแถวหัวตารางเอง (ไฟล์จาก Google Sheets มักมีชื่อชีตอยู่บรรทัดแรก)
 * แล้วจับคอลัมน์ Keyword / Title(Topic) / Volume / Slug / Intent / ประเภทบทความ / Note ตามชื่อหัวคอลัมน์
 * ไม่มีหัวตาราง = แบบเดิม: คอลัมน์แรก keyword, คอลัมน์ที่สองเป็นตัวเลข = volume
 */

export interface ParsedKeywordRow {
  keyword: string
  volume?: number
  title?: string
  slug?: string
  intent?: string
  articleType?: string
  note?: string
}

export type KeywordImportField = 'keyword' | 'title' | 'volume' | 'slug' | 'intent' | 'articleType' | 'note'

export interface KeywordTableParse {
  rows: ParsedKeywordRow[]
  /** คอลัมน์ที่จับได้ (ชื่อหัวคอลัมน์ในไฟล์) — ว่าง = ไม่เจอหัวตาราง ใช้แบบเดิม */
  columns: { field: KeywordImportField; header: string }[]
}

const HEADER_PATTERNS: [KeywordImportField, RegExp][] = [
  ['keyword', /^(focus |main |target |primary |seo )?(keywords?|kw|คีย์เวิร์ด|คีย์เวิร์ดหลัก|คำค้น|คำค้นหา|search terms?|query)$/],
  ['title', /^(topics?|title|h1|article title|blog title|seo title|หัวข้อ|หัวข้อบทความ|ชื่อบทความ|ชื่อเรื่อง|ไตเติ้ล|ไตเติล)$/],
  ['volume', /^(search )?(volume|vol|sv|msv|avg\.? monthly searches)$|^(ปริมาณ|ยอดค้นหา)/],
  ['slug', /^(url )?slug$/],
  ['intent', /^(search )?intent$/],
  ['articleType', /^(article type|content type|ประเภท|ประเภทบทความ)$/],
  ['note', /^(notes?|brief|หมายเหตุ|โน้ต|คำแนะนำ)$/],
]

/** แถวสรุปท้ายตาราง เช่น ",Total,40" — ไม่ใช่ keyword */
const TOTAL_CELL_RE = /^(total|grand total|sum|รวม|รวมทั้งหมด)$/i

const HEADER_SCAN_ROWS = 15

function normHeader(s: string): string {
  return s.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[:*_]/g, ' ').replace(/\s+/g, ' ').trim()
}

function fieldOf(cell: string): KeywordImportField | null {
  const h = normHeader(cell)
  if (!h) return null
  for (const [field, re] of HEADER_PATTERNS) if (re.test(h)) return field
  return null
}

/** แยกข้อความเป็นตาราง ทีละบรรทัด — tab ก่อน, ไม่มีค่อย comma, แล้วค่อย |
 *  เคารพเครื่องหมายคำพูดแบบ CSV (หัวข้อที่มี comma อยู่ในเครื่องหมายคำพูด) */
export function splitDelimited(text: string): string[][] {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim())
  return lines.map((line) => {
    const delim = line.includes('\t') ? '\t' : line.includes(',') ? ',' : line.includes('|') ? '|' : '\t'
    const row: string[] = []
    let cell = ''
    let quoted = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (quoted) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cell += '"'; i++ } else quoted = false
        } else cell += ch
        continue
      }
      if (ch === '"' && cell.trim() === '') { quoted = true; cell = ''; continue }
      if (ch === delim) { row.push(cell.trim()); cell = ''; continue }
      cell += ch
    }
    row.push(cell.trim())
    return row
  })
}

function parseVolume(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const m = raw.replace(/,/g, '').trim().match(/^(\d+(?:\.\d+)?)\s*([kKmM])?$/)
  if (!m) return undefined
  const n = Number(m[1]) * (m[2] ? (m[2].toLowerCase() === 'k' ? 1_000 : 1_000_000) : 1)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined
}

/** ตาราง (จาก CSV/XLSX/ข้อความที่วาง) → รายการ keyword */
export function parseKeywordTable(grid: string[][]): KeywordTableParse {
  const cells = grid.map((r) => r.map((c) => String(c ?? '').trim()))

  // หาแถวหัวตาราง: แถวแรก (ใน 15 แถวแรก) ที่มีคอลัมน์ keyword
  let headerIdx = -1
  let colMap = new Map<KeywordImportField, number>()
  for (let i = 0; i < Math.min(cells.length, HEADER_SCAN_ROWS); i++) {
    const map = new Map<KeywordImportField, number>()
    cells[i].forEach((c, j) => {
      const f = fieldOf(c)
      if (f && !map.has(f)) map.set(f, j)
    })
    if (map.has('keyword')) { headerIdx = i; colMap = map; break }
  }

  if (headerIdx < 0) {
    const rows: ParsedKeywordRow[] = []
    for (const r of cells) {
      const parts = r.filter(Boolean)
      const keyword = parts[0] ?? ''
      if (!keyword || fieldOf(keyword) === 'keyword' || TOTAL_CELL_RE.test(keyword)) continue
      rows.push({ keyword, volume: parseVolume(parts[1]) })
    }
    return { rows, columns: [] }
  }

  const header = cells[headerIdx]
  const pick = (r: string[], f: KeywordImportField) => {
    const j = colMap.get(f)
    return j === undefined ? '' : (r[j] ?? '').trim()
  }
  const rows: ParsedKeywordRow[] = []
  for (const r of cells.slice(headerIdx + 1)) {
    if (r.some((c) => TOTAL_CELL_RE.test(c))) continue
    const keyword = pick(r, 'keyword')
    if (!keyword || fieldOf(keyword) === 'keyword') continue
    const row: ParsedKeywordRow = { keyword }
    const volume = parseVolume(pick(r, 'volume'))
    if (volume !== undefined) row.volume = volume
    for (const f of ['title', 'slug', 'intent', 'articleType', 'note'] as const) {
      const v = pick(r, f)
      if (v) row[f] = v
    }
    rows.push(row)
  }
  const columns = Array.from(colMap.entries())
    .sort((a, b) => a[1] - b[1])
    .map(([field, j]) => ({ field, header: header[j] }))
  return { rows, columns }
}

export function parseKeywordText(text: string): KeywordTableParse {
  return parseKeywordTable(splitDelimited(text))
}
