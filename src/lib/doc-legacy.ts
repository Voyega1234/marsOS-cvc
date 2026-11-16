/**
 * อ่านข้อความจากไฟล์ Word รุ่นเก่า (.doc, Word 97–2003) — ไม่ต้องเพิ่ม dependency
 *
 * .doc เป็น OLE compound file: ข้อความอยู่ใน stream "WordDocument" และตำแหน่งของแต่ละท่อน
 * (piece table) อยู่ใน stream "0Table" / "1Table" ตามโครงสร้าง [MS-DOC]
 * ตัวแกะ OLE ใช้ CFB ที่มากับแพ็กเกจ xlsx ซึ่งโปรเจกต์มีอยู่แล้ว
 */

const FIB_MAGIC = 0xa5ec
const OFFSET_FLAGS = 0x000a
const OFFSET_CCP_TEXT = 0x004c
const OFFSET_FC_CLX = 0x01a2
const OFFSET_LCB_CLX = 0x01a6
const MAX_CHARS = 2_000_000

/**
 * แกะข้อความจาก stream ของ .doc (pure — เทสได้โดยไม่ต้องมีไฟล์จริง)
 * table0 / table1 = stream "0Table" / "1Table" (ไฟล์หนึ่งมีอันใดอันหนึ่ง หรือทั้งคู่)
 */
export function extractDocText(wordDocument: Uint8Array, table0: Uint8Array | null, table1: Uint8Array | null): string {
  if (wordDocument.length < OFFSET_LCB_CLX + 4) throw new Error('ไฟล์ .doc เสียหายหรือไม่ใช่ไฟล์ Word')
  const wd = new DataView(wordDocument.buffer, wordDocument.byteOffset, wordDocument.byteLength)
  if (wd.getUint16(0, true) !== FIB_MAGIC) throw new Error('ไฟล์นี้ไม่ใช่ Word .doc')
  const flags = wd.getUint16(OFFSET_FLAGS, true)
  if (flags & 0x0100) throw new Error('ไฟล์ .doc นี้ตั้งรหัสผ่านไว้ อ่านไม่ได้ — ปลดรหัสแล้วลองใหม่')
  const table = flags & 0x0200 ? table1 : table0
  if (!table) throw new Error('ไฟล์ .doc เสียหาย (ไม่พบตารางข้อความ)')
  const tb = new DataView(table.buffer, table.byteOffset, table.byteLength)

  const ccpText = wd.getUint32(OFFSET_CCP_TEXT, true)
  const fcClx = wd.getUint32(OFFSET_FC_CLX, true)
  const lcbClx = wd.getUint32(OFFSET_LCB_CLX, true)
  const end = Math.min(table.length, fcClx + lcbClx)

  // CLX = Prc (0x01) หลายก้อน ตามด้วย Pcdt (0x02) ที่เก็บ piece table
  let pos = fcClx
  let plcStart = -1
  let plcLength = 0
  while (pos < end) {
    const kind = table[pos]
    if (kind === 0x01) {
      if (pos + 3 > end) break
      pos += 3 + tb.getUint16(pos + 1, true)
    } else if (kind === 0x02) {
      if (pos + 5 > end) break
      plcLength = tb.getUint32(pos + 1, true)
      plcStart = pos + 5
      break
    } else break
  }
  if (plcStart < 0 || plcLength < 16 || plcStart + plcLength > table.length) throw new Error('ไฟล์ .doc เสียหาย (อ่านตารางข้อความไม่ได้)')

  const pieces = Math.floor((plcLength - 4) / 12)
  const limit = Math.min(ccpText > 0 ? ccpText : MAX_CHARS, MAX_CHARS)
  const utf16 = new TextDecoder('utf-16le')
  let cp1252: TextDecoder
  try { cp1252 = new TextDecoder('windows-1252') } catch { cp1252 = new TextDecoder('latin1') }

  let out = ''
  for (let i = 0; i < pieces; i++) {
    const cpStart = tb.getUint32(plcStart + i * 4, true)
    const cpEnd = tb.getUint32(plcStart + (i + 1) * 4, true)
    // out.length guards a piece table whose ranges overlap, which would otherwise repeat text without bound
    if (cpEnd <= cpStart || cpStart >= limit || out.length >= MAX_CHARS) break
    const count = Math.min(cpEnd, limit) - cpStart
    const fcField = tb.getUint32(plcStart + (pieces + 1) * 4 + i * 8 + 2, true)
    const compressed = (fcField & 0x40000000) !== 0
    const fc = fcField & 0x3fffffff
    const start = compressed ? fc >>> 1 : fc
    const bytes = compressed ? count : count * 2
    if (start + bytes > wordDocument.length) break
    const chunk = wordDocument.subarray(start, start + bytes)
    out += compressed ? cp1252.decode(chunk) : utf16.decode(chunk)
  }
  return cleanDocText(out)
}

/** ตัดรหัสควบคุมของ Word: คำสั่ง field (เหลือแต่ผลลัพธ์), เครื่องหมายเซลล์/ย่อหน้า, วัตถุฝัง */
export function cleanDocText(raw: string): string {
  let out = ''
  // field = 0x13 คำสั่ง 0x14 ผลลัพธ์ 0x15 · เก็บเฉพาะผลลัพธ์ (ซ้อนกันได้)
  const inInstruction: boolean[] = []
  // จำนวน field ที่ยังอยู่ในช่วงคำสั่ง — นับไว้แทนการไล่ดูทั้ง stack ทุกตัวอักษร
  let instructions = 0
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    if (code === 0x13) { inInstruction.push(true); instructions++; continue }
    if (code === 0x14) {
      if (inInstruction.length && inInstruction[inInstruction.length - 1]) {
        inInstruction[inInstruction.length - 1] = false
        instructions--
      }
      continue
    }
    if (code === 0x15) { if (inInstruction.pop()) instructions--; continue }
    if (instructions > 0) continue
    if (code === 0x0d || code === 0x0b || code === 0x0c) out += '\n'
    else if (code === 0x07) out += '\t'
    else if (code === 0x09 || code === 0x0a) out += raw[i]
    else if (code === 0x1e) out += '-'
    else if (code === 0xa0) out += ' '
    else if (code < 0x20 || code === 0x1f) continue
    else out += raw[i]
  }
  return stripBlanksBeforeNewline(out)
    .replace(/\t+/g, ' | ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** ผลเท่ากับ replace(/[ \t]+\n/g, '\n') แต่ไล่รอบเดียว (regex นั้นช้าแบบกำลังสองเมื่อเจอช่องว่างยาว ๆ ที่ไม่ได้ลงท้ายด้วยขึ้นบรรทัด) */
function stripBlanksBeforeNewline(text: string): string {
  const lines = text.split('\n')
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i]
    let end = line.length
    while (end > 0 && (line.charCodeAt(end - 1) === 0x20 || line.charCodeAt(end - 1) === 0x09)) end--
    if (end < line.length) lines[i] = line.slice(0, end)
  }
  return lines.join('\n')
}

type CfbEntry = { content?: ArrayLike<number> }
type CfbApi = { read: (data: Uint8Array, opts: { type: string }) => unknown; find: (cfb: unknown, path: string) => CfbEntry | null }

function streamOf(cfb: CfbApi, container: unknown, name: string): Uint8Array | null {
  const entry = cfb.find(container, name)
  if (!entry?.content || !entry.content.length) return null
  return entry.content instanceof Uint8Array ? entry.content : Uint8Array.from(entry.content)
}

/** อ่านข้อความจากไบต์ของไฟล์ .doc (ใช้ได้ทั้งเบราว์เซอร์และเซิร์ฟเวอร์) */
export async function readLegacyDocText(bytes: Uint8Array): Promise<string> {
  const mod = await import('xlsx')
  // CommonJS interop (tsx/Node): CFB อาจอยู่ใต้ .default แทนที่จะอยู่บน namespace
  const xlsx = ((mod as unknown as { CFB?: CfbApi }).CFB ? mod : (mod as unknown as { default: unknown }).default) as unknown as { CFB: CfbApi }
  const cfb = xlsx.CFB
  let container: unknown
  try {
    container = cfb.read(bytes, { type: 'array' })
  } catch {
    throw new Error('ไฟล์นี้ไม่ใช่ Word .doc (ถ้าเป็นไฟล์ที่เปลี่ยนนามสกุลมา ลองเปิดแล้ว Save As เป็น .docx)')
  }
  const wordDocument = streamOf(cfb, container, 'WordDocument')
  if (!wordDocument) throw new Error('ไฟล์นี้ไม่ใช่ Word .doc (ไม่พบเนื้อหาเอกสาร)')
  return extractDocText(wordDocument, streamOf(cfb, container, '0Table'), streamOf(cfb, container, '1Table'))
}
