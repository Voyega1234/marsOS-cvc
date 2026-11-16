/**
 * ตัวอ่านแท็บโควต้า Backlink จาก Google Sheet (ไฟล์บริสุทธิ์ — ห้าม import prisma / googleapis / fetch / API เฉพาะ Node)
 * รับ rows ทั้งแท็บ (เริ่มแถว 1, UNFORMATTED_VALUE) แล้วคืนแพ็กเกจ + ช่อง (slot) ตามชนิดใน quota-types.ts
 */
import {
  QUOTA_PACKAGE_FIELDS,
  QUOTA_SLOT_FIELDS,
  type ParsedPackage,
  type ParsedSlot,
  type ParsedTab,
  type QuotaColumns,
  type QuotaField,
} from "./quota-types";

// ───────────────────────── ข้อความ / ตัวเลข ─────────────────────────

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function cellAt(row: unknown[] | undefined, col: number | undefined): unknown {
  if (col === undefined || !row) return undefined;
  return row[col];
}

/** จำนวนที่ซื้อ: เลข >= 1 ปัดลง; ข้อความ = จำนวนเต็มแรกที่เจอ (>= 1); อื่น ๆ = null */
export function parseUnits(v: unknown): number | null {
  if (typeof v === "number") {
    return Number.isFinite(v) && v >= 1 ? Math.floor(v) : null;
  }
  if (typeof v === "string") {
    const m = v.match(/\d+/);
    if (!m) return null;
    const n = parseInt(m[0], 10);
    return n >= 1 ? n : null;
  }
  return null;
}

const PER_LINK_SUFFIX = /^\s*(?:\/\s*link|per\s*link|ต่อลิงก์|\/\s*ลิงก์)/i;

/** อ่านราคาจากช่อง Price / Link เช่น "80,000 THB\n2,666/Link" */
export function parsePriceText(
  v: unknown,
  units: number | null,
): { text: string; totalPrice: number | null; pricePerLink: number | null } {
  const text = cellText(v);
  let totalPrice: number | null = null;
  let pricePerLink: number | null = null;
  const re = /\d[\d,]*(?:\.\d+)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const num = parseFloat(m[0].replace(/,/g, ""));
    if (!Number.isFinite(num)) continue;
    const after = text.slice(m.index + m[0].length);
    if (PER_LINK_SUFFIX.test(after)) {
      if (pricePerLink === null) pricePerLink = num;
    } else if (totalPrice === null) {
      totalPrice = num;
    }
  }
  if (units !== null && units > 0) {
    if (pricePerLink === null && totalPrice !== null) pricePerLink = Math.round(totalPrice / units);
    else if (totalPrice === null && pricePerLink !== null) totalPrice = pricePerLink * units;
  }
  return { text, totalPrice, pricePerLink };
}

/** แยกช่อง Website: บรรทัดโดเมน = websites, บรรทัดแรกที่ไม่ใช่โดเมน = vendorName */
export function parseWebsiteText(v: unknown): { text: string; vendorName: string; websites: string[] } {
  const text = cellText(v);
  const lines = text
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
  const domainRe = /([a-z0-9-]+\.)+[a-z]{2,}/i;
  const websites: string[] = [];
  let vendorName = "";
  for (const line of lines) {
    if (domainRe.test(line)) websites.push(line);
    else if (!vendorName) vendorName = line;
  }
  return { text, vendorName, websites };
}

// ───────────────────────── วันที่ ─────────────────────────

const EN_MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const EN_MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const TH_MONTHS_LONG = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];
const TH_MONTHS_SHORT = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

function monthKey(s: string): string {
  return s.toLowerCase().replace(/[\s.,]/g, "");
}

/** ชื่อเดือน (ตัดช่องว่าง/จุดออกแล้ว) → เลขเดือน 1..12 */
const MONTH_MAP: Map<string, number> = (() => {
  const m = new Map<string, number>();
  for (let i = 0; i < 12; i++) {
    m.set(monthKey(EN_MONTHS_LONG[i]), i + 1);
    m.set(monthKey(EN_MONTHS_SHORT[i]), i + 1);
    m.set(monthKey(TH_MONTHS_LONG[i]), i + 1);
    m.set(monthKey(TH_MONTHS_SHORT[i]), i + 1);
  }
  m.set("sept", 9);
  return m;
})();

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function normYear(y: number, digits: number): number {
  if (digits <= 2) return 2000 + y;
  if (y > 2400) return y - 543;
  return y;
}

/** สร้าง ISO จาก y/m/d — null เมื่อวันที่ไม่มีอยู่จริง */
function buildIso(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 1900 || y > 2999 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${pad2(m)}-${pad2(d)}`;
}

function isoFromText(s: string): string | null {
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s].*)?$/);
  if (m) {
    return buildIso(normYear(parseInt(m[1], 10), 4), parseInt(m[2], 10), parseInt(m[3], 10));
  }
  // D/M/YYYY, D-M-YYYY, D.M.YYYY (วันก่อน)
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4}|\d{2})$/);
  if (m) {
    return buildIso(normYear(parseInt(m[3], 10), m[3].length), parseInt(m[2], 10), parseInt(m[1], 10));
  }
  // D MMM YYYY (อังกฤษ/ไทย)
  m = s.match(/^(\d{1,2})\s*[-/]?\s*([^\d]+?)\s*[-/,]?\s*(\d{4}|\d{2})$/);
  if (m) {
    const month = MONTH_MAP.get(monthKey(m[2]));
    if (month) return buildIso(normYear(parseInt(m[3], 10), m[3].length), month, parseInt(m[1], 10));
  }
  return null;
}

/** อ่านวันที่จากเซลล์ชีท (เลข serial / ข้อความหลายรูปแบบ) */
export function parseSheetDate(v: unknown): { iso: string | null; text: string } {
  if (v === null || v === undefined || typeof v === "boolean") return { iso: null, text: "" };
  if (typeof v === "number") {
    if (Number.isFinite(v) && v >= 20000 && v <= 80000) {
      const ms = Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000;
      const dt = new Date(ms);
      const iso = `${String(dt.getUTCFullYear()).padStart(4, "0")}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
      return { iso, text: formatQuotaDate(iso, "short") };
    }
    return { iso: null, text: String(v) };
  }
  const text = String(v).trim();
  if (!text) return { iso: null, text: "" };
  return { iso: isoFromText(text), text };
}

/** "1 Nov 2026" (short) / "3 November 2026" (long) — ไม่ใช่ ISO ที่ถูกต้อง = คืนค่าเดิม */
export function formatQuotaDate(iso: string, style: "short" | "long"): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  if (buildIso(y, mo, d) === null) return iso;
  const name = style === "long" ? EN_MONTHS_LONG[mo - 1] : EN_MONTHS_SHORT[mo - 1];
  return `${d} ${name} ${y}`;
}

// ───────────────────────── A1 ─────────────────────────

/** 0 → "A", 25 → "Z", 26 → "AA" */
export function columnLetter(index0: number): string {
  let n = Math.floor(index0) + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** ช่วง A1 พร้อมชื่อแท็บ (ครอบด้วย ' และเบิล ' ในชื่อ) */
export function a1Range(tabTitle: string, col0: number, row: number, col0End?: number, rowEnd?: number): string {
  const sheet = `'${tabTitle.replace(/'/g, "''")}'`;
  const endCol = col0End ?? col0;
  const endRow = rowEnd ?? row;
  const start = `${columnLetter(col0)}${row}`;
  const end = `${columnLetter(endCol)}${endRow}`;
  return start === end ? `${sheet}!${start}` : `${sheet}!${start}:${end}`;
}

// ───────────────────────── หัวตาราง ─────────────────────────

// ตัวอักษร/ตัวเลขทุกภาษา (รวมสระ/วรรณยุกต์ไทย) — สร้างผ่าน RegExp เพื่อไม่ให้ tsc target เก่าฟ้องแฟลก u
const NON_ALNUM = new RegExp("[^\\p{L}\\p{M}\\p{N}]", "gu");

function normHeader(v: unknown): string {
  return cellText(v).toLowerCase().replace(NON_ALNUM, "");
}

const HEADER_TESTS: Array<[QuotaField, (h: string) => boolean]> = [
  ["price", (h) => h.includes("price") || h.includes("ราคา")],
  ["linkUrl", (h) => h.includes("url") || h === "link" || h === "links" || h === "ลิงก์"],
  [
    "publishedDate",
    (h) => (h.includes("publish") && h.includes("date")) || h === "date" || h === "publisheddate" || h === "วันที่ลง",
  ],
  ["client", (h) => h.startsWith("client") || h === "ลูกค้า"],
  ["status", (h) => h.includes("status") || h.includes("สถานะ")],
  ["remark", (h) => h.startsWith("remark") || h.startsWith("note") || h === "หมายเหตุ"],
  ["expire", (h) => h.startsWith("exp") || h.includes("หมดอายุ")],
  ["start", (h) => h.startsWith("start") || h === "เริ่ม"],
  ["unit", (h) => h.startsWith("unit") || h === "qty" || h === "จำนวน"],
  ["website", (h) => h.includes("web") || h.includes("site")],
  ["type", (h) => h === "type" || h === "ประเภท"],
];

/** หาแถวหัวตารางใน 10 แถวแรก (headerRow เริ่มที่ 1) — ต้องเจออย่างน้อย 6 จาก 11 ช่อง */
export function findQuotaHeader(rows: unknown[][]): { headerRow: number; columns: QuotaColumns } | null {
  const limit = Math.min(rows.length, 10);
  for (let r = 0; r < limit; r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;
    const heads = row.map(normHeader);
    const columns: QuotaColumns = {};
    const taken = new Set<number>();
    for (const [field, test] of HEADER_TESTS) {
      for (let c = 0; c < heads.length; c++) {
        if (taken.has(c) || !heads[c]) continue;
        if (test(heads[c])) {
          columns[field] = c;
          taken.add(c);
          break;
        }
      }
    }
    if (Object.keys(columns).length >= 6) return { headerRow: r + 1, columns };
  }
  return null;
}

// ───────────────────────── อ่านทั้งแท็บ ─────────────────────────

function buildSlot(row: unknown[] | undefined, columns: QuotaColumns, index: number, sheetRow: number): ParsedSlot {
  const linkUrl = cellText(cellAt(row, columns.linkUrl));
  const pub = parseSheetDate(cellAt(row, columns.publishedDate));
  const client = cellText(cellAt(row, columns.client));
  const status = cellText(cellAt(row, columns.status));
  const remark = cellText(cellAt(row, columns.remark));
  const used = !!(linkUrl || pub.text || client || status || remark);
  return {
    index,
    row: sheetRow,
    linkUrl,
    publishedDate: pub.iso,
    publishedText: pub.text,
    client,
    status,
    remark,
    used,
    published: used && /publish/i.test(status),
  };
}

function hasAny(row: unknown[] | undefined, columns: QuotaColumns, fields: readonly QuotaField[]): boolean {
  for (const f of fields) {
    if (cellText(cellAt(row, columns[f])) !== "") return true;
  }
  return false;
}

export function parseQuotaTab(tabTitle: string, rows: unknown[][]): ParsedTab | null {
  const header = findQuotaHeader(rows);
  if (!header) return null;
  const { headerRow, columns } = header;
  const data: Array<unknown[] | undefined> = rows.slice(headerRow).map((r) => (Array.isArray(r) ? r : undefined));

  const starts: number[] = [];
  data.forEach((row, i) => {
    if (hasAny(row, columns, QUOTA_PACKAGE_FIELDS)) starts.push(i);
  });
  const implicit = starts.length === 0 ? data.length : starts[0];
  let hasImplicit = false;
  for (let i = 0; i < implicit; i++) {
    if (hasAny(data[i], columns, QUOTA_SLOT_FIELDS)) {
      hasImplicit = true;
      break;
    }
  }
  if (hasImplicit) starts.unshift(0);

  const packages: ParsedPackage[] = [];
  starts.forEach((s, p) => {
    const next = p + 1 < starts.length ? starts[p + 1] : null;
    const blockEnd = next ?? data.length;
    const first = data[s];
    const isImplicitPkg = hasImplicit && p === 0;

    const rowSlots: ParsedSlot[] = [];
    for (let i = s; i < blockEnd; i++) rowSlots.push(buildSlot(data[i], columns, i - s, headerRow + 1 + i));
    let lastUsed = -1;
    rowSlots.forEach((sl, i) => {
      if (sl.used) lastUsed = i;
    });

    const unitCell = isImplicitPkg ? undefined : cellAt(first, columns.unit);
    const unitText = cellText(unitCell);
    let units = parseUnits(unitCell);

    let slots: ParsedSlot[];
    let rowCount: number;
    if (next !== null) {
      const rowsUntilNext = next - s;
      if (unitText === "") units = rowsUntilNext;
      const count = units === null ? rowsUntilNext : Math.min(Math.max(units, lastUsed + 1), rowsUntilNext);
      slots = rowSlots.slice(0, count);
      rowCount = rowsUntilNext;
    } else {
      const count = units !== null ? Math.max(units, lastUsed + 1) : lastUsed + 1;
      slots = rowSlots.slice(0, count);
      for (let i = slots.length; i < count; i++) slots.push(buildSlot(undefined, columns, i, headerRow + 1 + s + i));
      rowCount = slots.length;
    }

    const web = parseWebsiteText(isImplicitPkg ? undefined : cellAt(first, columns.website));
    const price = parsePriceText(isImplicitPkg ? undefined : cellAt(first, columns.price), units);
    const start = parseSheetDate(isImplicitPkg ? undefined : cellAt(first, columns.start));
    const expire = parseSheetDate(isImplicitPkg ? undefined : cellAt(first, columns.expire));
    const ordinal = p + 1;
    packages.push({
      ordinal,
      key: `${tabTitle}#${ordinal}`,
      tabTitle,
      rowNumber: headerRow + 1 + s,
      rowCount,
      type: isImplicitPkg ? "" : cellText(cellAt(first, columns.type)),
      websiteText: web.text,
      vendorName: web.vendorName,
      websites: web.websites,
      priceText: price.text,
      totalPrice: price.totalPrice,
      pricePerLink: price.pricePerLink,
      unitText,
      units,
      startDate: start.iso,
      startText: start.text,
      expireDate: expire.iso,
      expireText: expire.text,
      slots,
    });
  });

  return { tabTitle, headerRow, columns, packages };
}

// ───────────────────────── สถิติ ─────────────────────────

export function packageStats(
  pkg: ParsedPackage,
  todayIso: string,
  reservedSlots?: ReadonlySet<number>,
): {
  expired: boolean;
  used: number;
  published: number;
  inProcess: number;
  reserved: number;
  remaining: number | null;
  usable: number | null;
} {
  let used = 0;
  let published = 0;
  let reserved = 0;
  for (const s of pkg.slots) {
    if (!s.used) continue;
    used++;
    if (s.published) published++;
    if (!s.linkUrl && reservedSlots?.has(s.index)) reserved++;
  }
  const expired = pkg.expireDate != null && pkg.expireDate < todayIso;
  const remaining = pkg.units == null ? null : Math.max(0, pkg.units - used);
  const usable = remaining == null ? null : expired ? 0 : remaining;
  return { expired, used, published, inProcess: used - published, reserved, remaining, usable };
}

/** แท็บที่เป็นของ MarsOS เอง (เช่น MarsOS Log) หรือชื่อว่าง ไม่ใช่แท็บโควต้า */
export function isQuotaTabCandidate(tabTitle: string): boolean {
  const t = tabTitle.trim();
  if (!t) return false;
  return !/^marsos/i.test(t);
}
