/**
 * อ่านไฟล์ .xlsx เป็นตารางเซลล์ (ข้อความ + ลิงก์) สำหรับตัวนำเข้าคลังเว็บ — server เท่านั้น
 * อ่านเฉพาะชีตที่มองเห็น (ชีตที่ซ่อนไว้มักเป็นงานร่าง/แพ็กเกจ รูปแบบไม่ตรง)
 * เนื้อหาไฟล์เป็นข้อมูลอย่างเดียว: ไม่รันสูตร ใช้ค่าที่ไฟล์คำนวณมาแล้ว
 */
import { inflateRawSync } from "node:zlib";
import ExcelJS from "exceljs";
import type { ImportCell, ImportSheet } from "./vendor-import";

const MAX_ROWS_PER_SHEET = 5000;
const MAX_ROW_NUMBER = 20000;
const MAX_COLS = 60;
const MAX_CELL_TEXT = 5000;

function text(v: unknown, depth = 0): string {
  if (v === null || v === undefined || depth > 3) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return ""; // checkbox
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) return o.richText.map((r) => text((r as { text?: unknown })?.text, depth + 1)).join("");
    if (o.text !== undefined) return text(o.text, depth + 1); // hyperlink
    if (o.result !== undefined) return text(o.result, depth + 1); // formula
  }
  return "";
}

function link(v: unknown): string | undefined {
  if (typeof v === "object" && v !== null) {
    const h = (v as { hyperlink?: unknown }).hyperlink;
    if (typeof h === "string" && h) return h;
  }
  return undefined;
}

/** ไฟล์ .xlsx (zip) ที่แตกออกมาแล้วใหญ่เกินเพดาน — ปฏิเสธก่อนส่งให้ตัวอ่าน */
export class XlsxTooLargeError extends Error {
  constructor() { super("xlsx unpacked size over limit"); this.name = "XlsxTooLargeError"; }
}

// ไฟล์จริงของทีม ~1.5 MB แตกแล้ว ~12 MB; เพดานอัปโหลด 4 MB ของไฟล์ปกติแตกแล้วราว 32 MB
export const MAX_XLSX_UNPACKED_BYTES = 40 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 2000;

/**
 * วัดขนาดจริงหลังแตกไฟล์ของ zip ก่อนให้ ExcelJS อ่าน (เพดาน 4 MB ของไฟล์อัปโหลดวัดได้แค่ขนาดที่บีบอัดแล้ว)
 * ไม่เชื่อขนาดที่ไฟล์ประกาศไว้ใน header: แตกแต่ละ entry จริงโดยจำกัดผลลัพธ์รวมไม่เกินเพดาน
 * โยน XlsxTooLargeError เมื่อเกินเพดาน (รวม zip64 และจำนวน entry มากผิดปกติ), Error ธรรมดาเมื่อไม่ใช่ zip ที่อ่านได้
 */
export function checkXlsxArchive(data: ArrayBuffer | Uint8Array, maxBytes = MAX_XLSX_UNPACKED_BYTES): number {
  const buf = data instanceof Uint8Array ? Buffer.from(data.buffer, data.byteOffset, data.byteLength) : Buffer.from(data);
  const bad = () => new Error("not a readable zip archive");
  // End of central directory: 22 ไบต์ + comment ไม่เกิน 65535 ไบต์ อยู่ท้ายไฟล์
  let eocd = -1;
  for (let i = buf.length - 22, min = Math.max(0, buf.length - 22 - 0xffff); i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw bad();
  const count = buf.readUInt16LE(eocd + 10);
  const dirOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || dirOffset === 0xffffffff) throw new XlsxTooLargeError(); // zip64
  if (count > MAX_ZIP_ENTRIES) throw new XlsxTooLargeError();

  let total = 0;
  let p = dirOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw bad();
    const method = buf.readUInt16LE(p + 10);
    const packed = buf.readUInt32LE(p + 20);
    const local = buf.readUInt32LE(p + 42);
    if (packed === 0xffffffff || local === 0xffffffff) throw new XlsxTooLargeError(); // zip64
    if (method === 0) {
      total += packed;
    } else if (method === 8) {
      if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw bad();
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      if (start + packed > buf.length) throw bad();
      try {
        total += inflateRawSync(buf.subarray(start, start + packed), { maxOutputLength: maxBytes - total + 1 }).length;
      } catch (e) {
        if ((e as { code?: string })?.code === "ERR_BUFFER_TOO_LARGE") throw new XlsxTooLargeError();
        throw bad();
      }
    } else {
      throw bad(); // xlsx ใช้แค่ stored / deflate
    }
    if (total > maxBytes) throw new XlsxTooLargeError();
    p += 46 + buf.readUInt16LE(p + 28) + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return total;
}

export interface XlsxReadResult { sheets: ImportSheet[]; hiddenSheets: string[] }

export async function readXlsxSheets(data: ArrayBuffer): Promise<XlsxReadResult> {
  checkXlsxArchive(data);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  const sheets: ImportSheet[] = [];
  const hiddenSheets: string[] = [];
  for (const ws of wb.worksheets) {
    if (ws.state !== "visible") { hiddenSheets.push(ws.name); continue; }
    const grid: ImportCell[][] = [];
    let kept = 0;
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      if (kept >= MAX_ROWS_PER_SHEET || n > MAX_ROW_NUMBER) return;
      const cells: ImportCell[] = [];
      let any = false;
      row.eachCell({ includeEmpty: false }, (cell, col) => {
        if (col > MAX_COLS) return;
        const t = text(cell.value).slice(0, MAX_CELL_TEXT);
        const l = link(cell.value) ?? (typeof cell.hyperlink === "string" && cell.hyperlink ? cell.hyperlink : undefined);
        if (!t && !l) return;
        cells[col - 1] = l ? { text: t, link: l } : { text: t };
        any = true;
      });
      if (!any) return;
      for (let i = 0; i < cells.length; i++) if (!cells[i]) cells[i] = { text: "" };
      grid[n - 1] = cells;
      kept++;
    });
    for (let i = 0; i < grid.length; i++) if (!grid[i]) grid[i] = [];
    sheets.push({ name: ws.name, grid });
  }
  return { sheets, hiddenSheets };
}
