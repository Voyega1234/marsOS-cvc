/**
 * ส่วนบริสุทธิ์ของคำสั่งเขียนโควต้า (ไม่ import prisma / googleapis — เทสได้ตรง ๆ)
 * ตัดสินใจว่า "ต้องเขียนเซลล์ไหน / ต้องเพิ่มแถวตรงไหน" ส่วนการยิง Google และการบันทึก DB อยู่ใน quota-server.ts
 */
import {
  QUOTA_FIELD_ORDER, QUOTA_HEADERS, QUOTA_PACKAGE_FIELDS,
  type ParsedPackage, type QuotaColumns, type QuotaField, type QuotaPackageInput,
  type QuotaOverwrite, type QuotaReservationInput, type QuotaSlotField, type QuotaSlotInput,
} from "./quota-types";
import { a1Range, columnLetter, formatQuotaDate, parseSheetDate } from "./quota-sheet";

export const MAX_TEXT = 2000;
export const MAX_UNITS = 2000;

export class QuotaError extends Error {
  status: number;
  /** ตารางโควต้ายังไม่ถูกสร้างในฐานข้อมูล — route จะส่ง tableMissing: true */
  tableMissing: boolean;
  /** มีเฉพาะ 409 ที่รอผู้ใช้ยืนยันการเขียนทับ */
  overwrites?: QuotaOverwrite[];
  constructor(status: number, message: string, opts: { tableMissing?: boolean; overwrites?: QuotaOverwrite[] } = {}) {
    super(message);
    this.name = "QuotaError";
    this.status = status;
    this.tableMissing = !!opts.tableMissing;
    if (opts.overwrites?.length) this.overwrites = opts.overwrites;
  }
}

export interface CellUpdate { range: string; values: (string | number)[][]; mode: "RAW" | "USER_ENTERED" }

// ───────────────────────── ตรวจ/ล้างค่าที่รับเข้ามา ─────────────────────────

export function cleanText(v: unknown, max = MAX_TEXT): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/** "" = ล้าง, YYYY-MM-DD = ตั้งค่า, อย่างอื่น 400 */
export function checkDate(v: string, label: string): string {
  if (v === "") return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(new Date(`${v}T12:00:00Z`).getTime())) {
    throw new QuotaError(400, `${label} ต้องเป็นรูปแบบ YYYY-MM-DD`);
  }
  return v;
}

function optText(b: Record<string, unknown>, key: string, out: Record<string, unknown>): void {
  if (b[key] === undefined) return;
  if (typeof b[key] !== "string") throw new QuotaError(400, `ข้อมูล ${key} ไม่ถูกต้อง`);
  out[key] = cleanText(b[key]);
}

export function readSlotInput(b: unknown): QuotaSlotInput {
  const src = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of ["linkUrl", "publishedDate", "client", "status", "remark"]) optText(src, k, out);
  return out as QuotaSlotInput;
}

export function readPackageInput(b: unknown): QuotaPackageInput {
  const src = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of ["sourceId", "tabTitle", "type", "websiteText", "priceText", "startDate", "expireDate"]) optText(src, k, out);
  if (src.units !== undefined) {
    if (src.units !== null && (typeof src.units !== "number" || !Number.isFinite(src.units))) {
      throw new QuotaError(400, "Unit ต้องเป็นตัวเลข");
    }
    out.units = src.units;
  }
  return out as QuotaPackageInput;
}

export function readReservationInput(b: unknown): QuotaReservationInput {
  const src = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of ["packageId", "reservedById", "website", "projectId", "client", "status", "remark", "note"]) optText(src, k, out);
  if (src.slotIndex !== undefined && src.slotIndex !== null) {
    if (typeof src.slotIndex !== "number" || !Number.isInteger(src.slotIndex) || src.slotIndex < 0) {
      throw new QuotaError(400, "ลำดับช่องไม่ถูกต้อง");
    }
    out.slotIndex = src.slotIndex;
  }
  return out as unknown as QuotaReservationInput;
}

export function checkUnits(n: unknown): number {
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > MAX_UNITS) {
    throw new QuotaError(400, `Unit ต้องเป็นจำนวนเต็ม 1–${MAX_UNITS}`);
  }
  return n;
}

// ───────────────────────── สร้างคำสั่งเขียนเซลล์ ─────────────────────────

function colOf(columns: QuotaColumns, field: QuotaField): number {
  const c = columns[field];
  if (c === undefined) throw new QuotaError(400, `ชีทนี้ไม่มีคอลัมน์ ${QUOTA_HEADERS[field]}`);
  return c;
}

function cell(tab: string, columns: QuotaColumns, field: QuotaField, row: number, value: string | number, mode: "RAW" | "USER_ENTERED"): CellUpdate {
  const c = colOf(columns, field);
  return { range: a1Range(tab, c, row), values: [[value]], mode };
}

function dateCell(tab: string, columns: QuotaColumns, field: QuotaField, row: number, iso: string, style: "short" | "long", label: string): CellUpdate {
  const v = checkDate(iso, label);
  return cell(tab, columns, field, row, v === "" ? "" : formatQuotaDate(v, style), "USER_ENTERED");
}

/** เซลล์ที่ต้องเขียนเมื่อแก้ช่อง (เฉพาะ field ที่ส่งมา; "" = ล้าง) */
export function slotUpdates(tab: string, columns: QuotaColumns, row: number, input: QuotaSlotInput): CellUpdate[] {
  const out: CellUpdate[] = [];
  if (input.linkUrl !== undefined) out.push(cell(tab, columns, "linkUrl", row, cleanText(input.linkUrl), "RAW"));
  if (input.publishedDate !== undefined) out.push(dateCell(tab, columns, "publishedDate", row, cleanText(input.publishedDate), "long", "Published Date"));
  if (input.client !== undefined) out.push(cell(tab, columns, "client", row, cleanText(input.client), "RAW"));
  if (input.status !== undefined) out.push(cell(tab, columns, "status", row, cleanText(input.status), "RAW"));
  if (input.remark !== undefined) out.push(cell(tab, columns, "remark", row, cleanText(input.remark), "RAW"));
  return out;
}

/** ล้างช่อง Clients / Status / REMARK / Published Date ของแถว (ข้ามคอลัมน์ที่ชีทไม่มี) — ใช้ตอนยกเลิกการจอง */
export function reservationClearUpdates(tab: string, columns: QuotaColumns, row: number): CellUpdate[] {
  const out: CellUpdate[] = [];
  for (const f of ["client", "status", "remark", "publishedDate"] as QuotaSlotField[]) {
    const c = columns[f];
    if (c === undefined) continue;
    out.push({ range: a1Range(tab, c, row), values: [[""]], mode: f === "publishedDate" ? "USER_ENTERED" : "RAW" });
  }
  return out;
}

/** เซลล์ของแพ็กเกจที่แถวแรกของก้อน (เฉพาะ field ที่ส่งมา) */
export function packageUpdates(tab: string, columns: QuotaColumns, row: number, input: QuotaPackageInput): CellUpdate[] {
  const out: CellUpdate[] = [];
  if (input.type !== undefined) out.push(cell(tab, columns, "type", row, cleanText(input.type), "RAW"));
  if (input.websiteText !== undefined) out.push(cell(tab, columns, "website", row, cleanText(input.websiteText), "RAW"));
  if (input.priceText !== undefined) out.push(cell(tab, columns, "price", row, cleanText(input.priceText), "RAW"));
  if (input.units !== undefined) out.push(cell(tab, columns, "unit", row, input.units === null ? "" : checkUnits(input.units), "RAW"));
  if (input.startDate !== undefined) out.push(dateCell(tab, columns, "start", row, cleanText(input.startDate), "short", "Start"));
  if (input.expireDate !== undefined) out.push(dateCell(tab, columns, "expire", row, cleanText(input.expireDate), "short", "EXP."));
  return out;
}

/** หัวตารางมาตรฐานสำหรับแท็บว่าง (แถว 1, คอลัมน์ A..K) */
export function standardHeaderUpdate(tab: string): { update: CellUpdate; columns: QuotaColumns } {
  const columns: QuotaColumns = {};
  QUOTA_FIELD_ORDER.forEach((f, i) => { columns[f] = i; });
  return {
    update: { range: a1Range(tab, 0, 1, QUOTA_FIELD_ORDER.length - 1), values: [QUOTA_FIELD_ORDER.map((f) => QUOTA_HEADERS[f])], mode: "RAW" },
    columns,
  };
}

// ───────────────────────── ตัวตนของแพ็กเกจ ─────────────────────────

const FP_SEP = "\u0001";

/**
 * ลายนิ้วมือของแพ็กเกจ = ข้อมูลที่บอกว่า "เป็นแพ็กเกจไหน" (Type / Website / Price / Start / EXP.)
 * ไม่รวมตำแหน่งแถวและ Unit — ใช้ยืนยันว่าแพ็กเกจลำดับเดิมในชีทยังเป็นก้อนเดียวกับที่หน้าจอแสดง
 * วันที่ที่อ่านเป็นวันไม่ได้ใช้ข้อความในช่องแทน
 */
export function packageFingerprint(pkg: unknown): string {
  const p = (pkg && typeof pkg === "object" ? pkg : {}) as Partial<ParsedPackage>;
  const txt = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  return [txt(p.type), txt(p.websiteText), txt(p.priceText), txt(p.startDate) || txt(p.startText), txt(p.expireDate) || txt(p.expireText)].join(FP_SEP);
}

export interface PackageMatchInput { key: string; fingerprint: string; stale?: boolean }
export interface PackageMatch {
  /** คู่ [ลำดับในรายการเก่า, ลำดับในรายการใหม่] */
  pairs: [number, number][];
  unmatchedOld: number[];
  unmatchedNew: number[];
}

/**
 * จับคู่แถว cache เดิม (เรียงตามลำดับในแท็บ) กับแพ็กเกจที่เพิ่งอ่านได้ — 3 รอบ:
 * 1) key เดิม + ลายนิ้วมือเดิม  2) ลายนิ้วมือเดิมแต่ย้ายตำแหน่ง (มีก้อนถูกแทรก/ลบด้านบน) เรียงตามลำดับ
 * 3) key เดิมแต่ข้อมูลถูกแก้ในที่เดิม — รอบนี้ไม่รับแถวที่ stale อยู่ (แพ็กเกจที่หายไปแล้วต้องไม่ถูกก้อนอื่นสวมแทน)
 */
export function matchPackages(old: PackageMatchInput[], fresh: PackageMatchInput[]): PackageMatch {
  const oldLeft = new Set(old.map((_, i) => i));
  const newLeft = new Set(fresh.map((_, i) => i));
  const pairs: [number, number][] = [];
  const pair = (o: number, n: number) => { pairs.push([o, n]); oldLeft.delete(o); newLeft.delete(n); };
  const pass = (ok: (o: PackageMatchInput, n: PackageMatchInput) => boolean) => {
    for (const n of Array.from(newLeft)) {
      const o = Array.from(oldLeft).find((i) => ok(old[i], fresh[n]));
      if (o !== undefined) pair(o, n);
    }
  };
  pass((o, n) => o.key === n.key && o.fingerprint === n.fingerprint);
  pass((o, n) => o.fingerprint === n.fingerprint);
  pass((o, n) => !o.stale && o.key === n.key);
  return { pairs, unmatchedOld: Array.from(oldLeft), unmatchedNew: Array.from(newLeft) };
}

// ───────────────────────── ตำแหน่งแถว ─────────────────────────

/** แถวสุดท้ายของก้อนแพ็กเกจ (เริ่มที่ 1) */
export function blockLastRow(pkg: Pick<ParsedPackage, "rowNumber" | "rowCount" | "slots">): number {
  // ก้อนที่ไม่รู้ Unit และยังไม่มีช่องถูกใช้ (rowCount 0, ไม่มี slot) ก็ยังกินแถวหัวของตัวเอง 1 แถว
  return pkg.rowNumber + Math.max(pkg.rowCount, pkg.slots.length, 1) - 1;
}

/** แถวเริ่มของแพ็กเกจใหม่ = ต่อท้ายก้อนสุดท้าย (หรือถัดจากหัวตารางเมื่อยังไม่มีแพ็กเกจ) */
export function newPackageStartRow(headerRow: number, packages: Pick<ParsedPackage, "rowNumber" | "rowCount" | "slots">[]): number {
  if (!packages.length) return headerRow + 1;
  return Math.max(...packages.map(blockLastRow)) + 1;
}

export function slotRow(pkg: Pick<ParsedPackage, "rowNumber">, index: number): number {
  return pkg.rowNumber + index;
}

/** แพ็กเกจนี้ขยายช่องเพิ่มได้ไหม: รู้ Unit = ยังไม่ถึง Unit; ไม่รู้ Unit = เฉพาะแพ็กเกจสุดท้าย */
export function mayGrow(pkg: Pick<ParsedPackage, "units" | "slots">, isLast: boolean): boolean {
  return pkg.units != null ? pkg.slots.length < pkg.units : isLast;
}

export interface SlotPlan {
  /** แถวในชีทที่ช่องนี้อยู่ (เริ่มที่ 1) */
  row: number;
  /** ต้องต่อท้ายตารางกี่แถวก่อนเขียน */
  appendRows: number;
  /** ต้องแทรก 1 แถวก่อนแถวนี้ (index เริ่มที่ 0 ของ API) — null = ไม่ต้องแทรก */
  insertAt0: number | null;
}

/** ตัดสินว่าช่อง index เขียนได้ที่ไหน (null = ไม่มีช่องนี้) */
export function planSlot(pkg: ParsedPackage, next: Pick<ParsedPackage, "rowNumber"> | null, index: number, gridRows: number): SlotPlan | null {
  if (!Number.isInteger(index) || index < 0) return null;
  const row = slotRow(pkg, index);
  if (index < pkg.slots.length) return { row, appendRows: Math.max(0, row - gridRows), insertAt0: null };
  if (index !== pkg.slots.length || !mayGrow(pkg, !next)) return null;
  if (!next) return { row, appendRows: Math.max(0, row - gridRows), insertAt0: null };
  // แพ็กเกจกลาง: ถ้ามีแถวว่างในก้อนอยู่แล้วใช้เลย ไม่งั้นแทรกก่อนแพ็กเกจถัดไป
  if (row < next.rowNumber) return { row, appendRows: 0, insertAt0: null };
  return { row, appendRows: 0, insertAt0: next.rowNumber - 1 };
}

export interface BlockPlan { appendRows: number; insertAt0: number | null; insertCount: number; newRowCount: number }

/** ขยายก้อนแพ็กเกจให้มีแถวเท่าจำนวน Unit ใหม่ (ไม่เคยลดแถว) */
export function planBlockGrowth(pkg: ParsedPackage, next: Pick<ParsedPackage, "rowNumber"> | null, gridRows: number, newUnits: number): BlockPlan {
  const have = Math.max(pkg.rowCount, pkg.slots.length, 1);
  if (newUnits <= have) return { appendRows: 0, insertAt0: null, insertCount: 0, newRowCount: have };
  if (!next) {
    return { appendRows: Math.max(0, pkg.rowNumber + newUnits - 1 - gridRows), insertAt0: null, insertCount: 0, newRowCount: newUnits };
  }
  return { appendRows: 0, insertAt0: next.rowNumber - 1, insertCount: newUnits - have, newRowCount: newUnits };
}

// ───────────────────────── คำสั่งเชิงโครงสร้าง ─────────────────────────

export function appendRowsRequest(sheetId: number, length: number): object {
  return { appendDimension: { sheetId, dimension: "ROWS", length } };
}

export function appendColumnsRequest(sheetId: number, length: number): object {
  return { appendDimension: { sheetId, dimension: "COLUMNS", length } };
}

export function insertRowsRequest(sheetId: number, startIndex0: number, count: number): object {
  return { insertDimension: { range: { sheetId, dimension: "ROWS", startIndex: startIndex0, endIndex: startIndex0 + count }, inheritFromBefore: true } };
}

/** รวมเซลล์คอลัมน์ข้อมูลแพ็กเกจ (Type..EXP.) ตลอดก้อน — คืน [] เมื่อก้อนมีแถวเดียว */
export function mergePackageRequests(sheetId: number, columns: QuotaColumns, firstRow: number, rows: number): object[] {
  if (rows <= 1) return [];
  const out: object[] = [];
  for (const f of QUOTA_PACKAGE_FIELDS) {
    const c = columns[f];
    if (c === undefined) continue;
    out.push({
      mergeCells: {
        range: { sheetId, startRowIndex: firstRow - 1, endRowIndex: firstRow - 1 + rows, startColumnIndex: c, endColumnIndex: c + 1 },
        mergeType: "MERGE_ALL",
      },
    });
  }
  return out;
}

export const MERGE_SKIPPED_MSG = "ไม่ได้รวมเซลล์ของแพ็กเกจเพราะมีข้อมูลอยู่ในแถวถัดไป — จัดในชีทเองได้";

/**
 * มีข้อมูลในคอลัมน์ข้อมูลแพ็กเกจ (Type..EXP.) ของแถว firstRow..lastRow ไหม (เลขแถวเริ่มที่ 1 ตามที่เพิ่งอ่านมา)
 * การรวมเซลล์จะทิ้งค่าของทุกเซลล์ยกเว้นเซลล์บนสุด — เจอข้อมูล (ค่า หรือสูตร) = ต้องไม่รวม
 */
export function packageCellsHaveData(columns: QuotaColumns, firstRow: number, lastRow: number, rows: unknown[][], formulas?: unknown[][]): boolean {
  const has = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== "";
  for (let r = firstRow; r <= lastRow; r++) {
    for (const f of QUOTA_PACKAGE_FIELDS) {
      const c = columns[f];
      if (c === undefined) continue;
      if (has(rows[r - 1]?.[c]) || has(formulas?.[r - 1]?.[c])) return true;
    }
  }
  return false;
}

/** คัดลอกรูปแบบ + dropdown ของช่อง (คอลัมน์ Link URL..REMARK) จากแถวต้นแบบไปทั้งก้อนใหม่ */
export function copySlotFormatRequests(sheetId: number, columns: QuotaColumns, fromRow: number, toFirstRow: number, toRows: number): object[] {
  const cols = (["linkUrl", "publishedDate", "client", "status", "remark"] as QuotaSlotField[])
    .map((f) => columns[f]).filter((c): c is number => c !== undefined);
  if (!cols.length) return [];
  const startColumnIndex = Math.min(...cols);
  const endColumnIndex = Math.max(...cols) + 1;
  const source = { sheetId, startRowIndex: fromRow - 1, endRowIndex: fromRow, startColumnIndex, endColumnIndex };
  const destination = { sheetId, startRowIndex: toFirstRow - 1, endRowIndex: toFirstRow - 1 + toRows, startColumnIndex, endColumnIndex };
  return ["PASTE_FORMAT", "PASTE_DATA_VALIDATION"].map((pasteType) => ({ copyPaste: { source, destination, pasteType } }));
}

/** แท็บว่างเปล่าทั้งหมดไหม */
export function isBlankGrid(rows: unknown[][]): boolean {
  return rows.every((r) => !Array.isArray(r) || r.every((c) => c == null || String(c).trim() === ""));
}

// ───────────────────────── เขียนทับข้อมูลเดิม ─────────────────────────

export const OVERWRITE_MSG = "การบันทึกนี้จะเขียนทับข้อมูลเดิมใน Google Sheet — ต้องยืนยันก่อน";

const DATE_FIELDS: ReadonlySet<QuotaField> = new Set<QuotaField>(["start", "expire", "publishedDate"]);

/** ค่าของเซลล์ในรูปที่เทียบกันได้ + ข้อความที่แสดงให้ผู้ใช้ (ชีทคืนวันที่เป็นเลข serial, Unit เป็นตัวเลข) */
function comparable(field: QuotaField | undefined, v: unknown): { cmp: string; text: string } {
  if (v === null || v === undefined) return { cmp: "", text: "" };
  if (field && DATE_FIELDS.has(field)) {
    const d = parseSheetDate(v);
    return { cmp: d.iso ?? d.text, text: d.text };
  }
  const text = String(v).trim();
  if (field === "unit" && text !== "" && Number.isFinite(Number(text))) return { cmp: String(Number(text)), text };
  return { cmp: text, text };
}

/**
 * เทียบเซลล์ที่จะเขียนกับค่าปัจจุบันในแท็บ (rows = ตารางดิบที่เพิ่งอ่านมา) — คืนเฉพาะเซลล์ที่มีข้อมูลอยู่แล้ว
 * และค่าใหม่ต่างจากเดิม (รวมการล้างช่อง) เซลล์ว่าง / ค่าเท่าเดิม / ช่วงหลายเซลล์ ไม่นับ
 * formulas = ตารางเดียวกันที่อ่านแบบ FORMULA (ไม่ส่ง = ไม่ตรวจสูตร): เซลล์ที่เป็นสูตร ("=...") นับว่ามีข้อมูลเสมอ
 * แม้ผลของสูตรจะว่างหรือเท่ากับค่าใหม่ เพราะการเขียนค่าทับจะทำให้สูตรหาย
 */
export function findOverwrites(tabTitle: string, columns: QuotaColumns, rows: unknown[][], updates: CellUpdate[], formulas?: unknown[][]): QuotaOverwrite[] {
  const fieldAt = new Map<string, QuotaField>();
  for (const f of QUOTA_FIELD_ORDER) {
    const c = columns[f];
    if (c !== undefined) fieldAt.set(columnLetter(c), f);
  }
  const out: QuotaOverwrite[] = [];
  for (const u of updates) {
    const m = /!([A-Z]+)(\d+)$/.exec(u.range);
    if (!m) continue; // ช่วงหลายเซลล์ (เช่น หัวตารางของแท็บว่าง)
    const letter = m[1];
    const row = parseInt(m[2], 10);
    let col = 0;
    for (const ch of letter) col = col * 26 + (ch.charCodeAt(0) - 64);
    const field = fieldAt.get(letter);
    const cell = `${letter}${row}`;
    const after = comparable(field, u.values[0]?.[0]);
    const formula = formulas?.[row - 1]?.[col - 1];
    if (typeof formula === "string" && formula.trim().startsWith("=")) {
      const text = formula.trim();
      out.push({
        tabTitle, cell, header: field ? QUOTA_HEADERS[field] : letter,
        oldValue: text, newValue: after.text,
        key: [tabTitle, cell, text, after.cmp].join("\u0001"),
      });
      continue;
    }
    const before = comparable(field, rows[row - 1]?.[col - 1]);
    if (before.cmp === "") continue;
    if (before.cmp === after.cmp) continue;
    out.push({
      tabTitle, cell, header: field ? QUOTA_HEADERS[field] : letter,
      oldValue: before.text, newValue: after.text,
      key: [tabTitle, cell, before.cmp, after.cmp].join("\u0001"),
    });
  }
  return out;
}

/** ไม่มีการเขียนทับ หรือผู้ใช้ยืนยันครบทุกเซลล์แล้ว = ผ่าน; ไม่งั้น throw 409 พร้อมรายการ (ยังไม่มีอะไรถูกเขียน) */
export function assertOverwritesApproved(overwrites: QuotaOverwrite[], approved: readonly string[] | undefined): void {
  if (!overwrites.length) return;
  const ok = new Set(approved ?? []);
  if (overwrites.every((o) => ok.has(o.key))) return;
  throw new QuotaError(409, OVERWRITE_MSG, { overwrites });
}

/** อ่านรายการ key ที่ผู้ใช้ยืนยันจาก body (ไม่ใช่ array ของ string = ไม่ยืนยันอะไร) */
export function readConfirmOverwrite(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string").slice(0, 500);
}
