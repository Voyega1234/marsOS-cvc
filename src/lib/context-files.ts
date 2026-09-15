// ─────────────────────────────────────────────────────────────────────────────
//  แปลงไฟล์ CSV / PDF ที่ทีมลากมาวางใน Article Lab ให้เป็นข้อความอ่านได้
//
//  คำสั่งเจ้าของ (owner item 3): วางไฟล์ธุรกิจ (บทความ, ราคา, สาขา ฯลฯ) แล้วให้ระบบ
//  ดึงข้อความไปสรุปเป็น Project Context + Business Skill — ไฟล์นี้ทำหน้าที่แค่
//  "อ่านไฟล์ → ข้อความดิบ" เท่านั้น ไม่ยุ่งกับ AI หรือ DB
// ─────────────────────────────────────────────────────────────────────────────

import pdfParse from 'pdf-parse'

export interface ContextFileInput {
  name: string
  mime: string
  buffer: Buffer
}

export interface ExtractedFile {
  name: string
  /** จำนวนตัวอักษรก่อนตัด (ไว้เตือนถ้าไฟล์ยาวมากจนถูกตัดทิ้งบางส่วน) */
  originalChars: number
  text: string
  warning?: string
}

/** เพดานจำนวนแถว/คอลัมน์ของ CSV กันไฟล์ใหญ่มากจนกิน token โมเดล */
const CSV_MAX_ROWS = 300
const CSV_MAX_COLS = 40
const CSV_CELL_MAX_CHARS = 500
/** เพดานความยาวรวมของทุกไฟล์ที่ส่งเข้าโมเดล */
const TOTAL_MAX_CHARS = 60_000

/** ตัวแยกบรรทัด/คอลัมน์ CSV แบบมือ รองรับ , และ \t คั่น พร้อม quote-escape เหมือนไฟล์ backlink import */
function parseCsvRows(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0)
  if (lines.length === 0) return []
  const delimiter = lines[0].includes('\t') ? '\t' : ','

  function splitLine(line: string): string[] {
    const result: string[] = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
        else inQuotes = !inQuotes
      } else if (ch === delimiter && !inQuotes) {
        result.push(current.trim())
        current = ''
      } else {
        current += ch
      }
    }
    result.push(current.trim())
    return result
  }

  return lines.map(splitLine)
}

/** CSV → ตารางข้อความแบบ markdown ให้โมเดลอ่านง่าย ตัดแถว/คอลัมน์ที่เกินเพดาน */
function csvToText(name: string, raw: string): ExtractedFile {
  const rows = parseCsvRows(raw)
  const originalChars = raw.length
  if (rows.length === 0) {
    return { name, originalChars, text: '(ไฟล์ CSV ว่างหรืออ่านไม่ได้)', warning: 'อ่านแถวข้อมูลไม่ได้' }
  }

  const truncatedRows = rows.length > CSV_MAX_ROWS
  const truncatedCols = rows[0].length > CSV_MAX_COLS
  const limitedRows = rows.slice(0, CSV_MAX_ROWS + 1) // +1 กันเผื่อแถวหัวตาราง
  const clampCell = (c: string) => (c.length > CSV_CELL_MAX_CHARS ? c.slice(0, CSV_CELL_MAX_CHARS) + '…' : c)

  const lines: string[] = []
  lines.push(`ไฟล์: ${name} (CSV — ${rows.length - 1} แถวข้อมูล, ${rows[0].length} คอลัมน์)`)
  for (const row of limitedRows) {
    const cols = row.slice(0, CSV_MAX_COLS).map(clampCell)
    lines.push(cols.join(' | '))
  }
  if (truncatedRows) lines.push(`… (ตัดแถวที่เกิน ${CSV_MAX_ROWS} แถวออก)`)
  if (truncatedCols) lines.push(`… (ตัดคอลัมน์ที่เกิน ${CSV_MAX_COLS} คอลัมน์ออก)`)

  const warnings: string[] = []
  if (truncatedRows) warnings.push(`ตัดแถวเกิน ${CSV_MAX_ROWS} แถว`)
  if (truncatedCols) warnings.push(`ตัดคอลัมน์เกิน ${CSV_MAX_COLS} คอลัมน์`)

  return { name, originalChars, text: lines.join('\n'), warning: warnings.join(' · ') || undefined }
}

async function pdfToText(name: string, buffer: Buffer): Promise<ExtractedFile> {
  try {
    const data = await pdfParse(buffer)
    const text = (data.text ?? '').trim()
    if (!text) {
      return { name, originalChars: 0, text: '(ไฟล์ PDF นี้ไม่มีข้อความ อาจเป็นภาพสแกน)', warning: 'ไม่พบข้อความในไฟล์ (อาจเป็น PDF ภาพสแกน)' }
    }
    return { name, originalChars: text.length, text: `ไฟล์: ${name} (PDF — ${data.numpages} หน้า)\n${text}` }
  } catch (err) {
    return { name, originalChars: 0, text: `(อ่านไฟล์ ${name} ไม่สำเร็จ)`, warning: `อ่าน PDF ไม่สำเร็จ: ${(err as Error).message}` }
  }
}

/**
 * แปลงไฟล์ CSV/PDF ที่อัปโหลดมาเป็นข้อความรวม พร้อมคำเตือนต่อไฟล์
 * ความยาวรวมทุกไฟล์ถูกตัดไม่ให้เกิน TOTAL_MAX_CHARS กันโมเดลรับข้อมูลเกินเพดาน token
 */
export async function extractText(files: ContextFileInput[]): Promise<{ files: ExtractedFile[]; combinedText: string; warnings: string[] }> {
  const results: ExtractedFile[] = []
  for (const f of files) {
    const isPdf = f.mime === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    if (isPdf) {
      results.push(await pdfToText(f.name, f.buffer))
    } else {
      results.push(csvToText(f.name, f.buffer.toString('utf-8')))
    }
  }

  let combined = results.map((r) => r.text).join('\n\n---\n\n')
  let truncated = false
  if (combined.length > TOTAL_MAX_CHARS) {
    combined = combined.slice(0, TOTAL_MAX_CHARS)
    truncated = true
  }

  const warnings = results.filter((r) => r.warning).map((r) => `${r.name}: ${r.warning}`)
  if (truncated) warnings.push(`เนื้อหารวมยาวเกิน ${TOTAL_MAX_CHARS.toLocaleString()} ตัวอักษร — ตัดส่วนท้ายทิ้ง`)

  return { files: results, combinedText: combined, warnings }
}
