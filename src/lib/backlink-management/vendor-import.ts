/**
 * นำเข้าคลังเว็บจากไฟล์ (xlsx / csv) — ส่วนบริสุทธิ์: แปลงตารางเซลล์เป็นแถวที่บันทึกได้
 * ตัวอ่าน xlsx อยู่ที่ vendor-import-xlsx.ts (server เท่านั้น)
 */
import { looksLikeDomain, normalizeDomain, safeHttpUrl } from "./domain";
import { EMPTY_VENDOR_DETAIL, PRICE_TYPES, pickDefaultPrice, type PriceKey, type VendorDetail } from "./vendor-detail";

export interface ImportCell { text: string; link?: string }
export interface ImportSheet { name: string; grid: ImportCell[][] }

export interface VendorImportRow extends VendorDetail {
  domain: string;
  siteUrl: string;
  category: string;
  price: number;
  domainRating: number | null;
  traffic: number | null;
  contactName: string;
  contactChannel: string;
  notes: string;
  /** ชีตต้นทาง (ไว้แสดงในหน้าตรวจก่อนนำเข้า) */
  sheet: string;
  /** มีเฉพาะเมื่อไฟล์มีคอลัมน์นี้และค่าถูกต้อง (ไฟล์ที่ export จากระบบ) */
  status?: "ACTIVE" | "INACTIVE";
  linkType?: "dofollow" | "nofollow" | "sponsored";
  /** หมวดเดาจากชื่อชีต (ชีตไม่มีคอลัมน์หมวด) — โหมดอัปเดตจะไม่ทับหมวดที่มีอยู่แล้ว */
  categoryInferred?: boolean;
  /** ราคาเริ่มต้นคำนวณจากราคาแยกประเภท ไม่ได้มาจากคอลัมน์ราคา — โหมดอัปเดตจะไม่ทับราคาที่ตั้งเอง */
  priceInferred?: boolean;
}

export interface ImportSkip { sheet: string; row: number; text: string; reason: string }
export interface ImportConflict { domain: string; field: string; kept: string; other: string; sheet: string }

export const MAX_IMPORT_ROWS = 2000;
// เพดานเดียวกับตัวอ่าน xlsx: กันไฟล์ CSV ที่ตั้งใจทำให้ใหญ่ผิดปกติ
export const MAX_CSV_ROWS = 5000;
export const MAX_CSV_COLS = 60;
export const MAX_CSV_CELL = 5000;

/** ตัวอ่าน CSV ตาม RFC 4180: รองรับเซลล์ในเครื่องหมายคำพูดที่มี comma / ขึ้นบรรทัดใหม่ / "" */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  // ส่วนที่เกินเพดาน (ตัวอักษรต่อเซลล์ / คอลัมน์ต่อแถว / จำนวนแถว) ถูกทิ้ง ไม่ใช่ error
  const add = (ch: string) => { if (cell.length < MAX_CSV_CELL) cell += ch; };
  const endCell = () => { if (row.length < MAX_CSV_COLS) row.push(cell); cell = ""; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { add('"'); i++; } else quoted = false;
      } else add(ch);
      continue;
    }
    if (ch === '"' && cell === "") { quoted = true; continue; }
    if (ch === ",") { endCell(); continue; }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endCell();
      rows.push(row); row = [];
      if (rows.length >= MAX_CSV_ROWS) return rows;
      continue;
    }
    add(ch);
  }
  if (cell !== "" || row.length) { endCell(); rows.push(row); }
  return rows;
}

/**
 * ถอดรหัสไฟล์ CSV: UTF-8 ก่อน ถ้าไบต์ไม่ใช่ UTF-8 ที่ถูกต้อง (ไฟล์จาก Excel ภาษาไทยรุ่นเก่า) ใช้ windows-874
 */
export function decodeCsvBytes(data: ArrayBuffer | Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    try {
      return new TextDecoder("windows-874").decode(data);
    } catch {
      return new TextDecoder("utf-8").decode(data);
    }
  }
}

export function csvToSheet(text: string, name = ""): ImportSheet {
  return { name, grid: parseCsv(text).map((r) => r.map((c) => ({ text: c }))) };
}

/** "607K" → 607000, "23.3M" → 23300000, "1,234" → 1234 */
export function parseTraffic(raw: string): number | null {
  const s = raw.replace(/[,\s]/g, "").toUpperCase();
  const m = /^(\d+(?:\.\d+)?)([KMB])?$/.exec(s);
  if (!m) return null;
  const mult = m[2] === "K" ? 1e3 : m[2] === "M" ? 1e6 : m[2] === "B" ? 1e9 : 1;
  const n = Math.round(Number(m[1]) * mult);
  return Number.isFinite(n) && n <= 2_000_000_000 ? n : null;
}

/** ราคา: clean = เซลล์เป็นตัวเลขล้วน; ไม่ clean (เช่น "8000 - 15,000", "38000 FB Only") คืนเลขตัวแรก + ต้องเก็บข้อความเดิมไว้เป็นหมายเหตุ */
export function parsePrice(raw: string): { value: number | null; clean: boolean } {
  const s = raw.trim();
  if (!s || s === "-") return { value: null, clean: true };
  const bare = s.replace(/[,\s]/g, "").replace(/(บาท|thb|฿)/gi, "");
  if (/^\d+(\.\d+)?$/.test(bare)) return { value: Number(bare), clean: true };
  const m = /\d[\d,]*(?:\.\d+)?/.exec(s);
  if (!m) return { value: null, clean: false };
  const n = Number(m[0].replace(/,/g, ""));
  return { value: Number.isFinite(n) ? n : null, clean: false };
}

type Field =
  | "domain" | "siteUrl" | "category" | "language" | "dr" | "ur" | "traffic" | "price" | PriceKey
  | "expiration" | "notes" | "rateCard" | "contact" | "contactName" | "priceNote" | "remark" | "refId"
  | "status" | "linkType";

// key = หัวคอลัมน์ที่ตัดช่องว่างทั้งหมดและทำเป็นตัวพิมพ์เล็กแล้ว
const HEADER_ALIASES: Record<string, Field> = {
  domain: "domain", "โดเมน": "domain", domains: "domain",
  url: "siteUrl",
  industry: "category", category: "category", "หมวด": "category",
  lan: "language", language: "language", "ภาษา": "language",
  dr: "dr", domainrating: "dr",
  ur: "ur",
  traffic: "traffic",
  "ราคา": "price", price: "price", "ราคา(price)": "price", "ราคาเริ่มต้น": "price",
  "price(onlybacklink)": "priceBacklink", onlybacklink: "priceBacklink",
  publisherwriteweb: "pricePublisherWeb",
  "publisherwriteweb+fb": "pricePublisherWebFb",
  cvcwriteweb: "priceCvcWeb",
  "cvcwriteweb+fb": "priceCvcWebFb",
  pr: "pricePr",
  expiration: "expiration", "อายุลิงก์": "expiration",
  detail: "notes", note: "notes", notes: "notes", "หมายเหตุ": "notes", "รายละเอียด": "notes",
  ratecard: "rateCard",
  "contact/email": "contact", contact: "contact", "ช่องทางติดต่อ": "contact", "ข้อมูลติดต่อ": "contact",
  "ผู้ติดต่อ": "contactName", "ชื่อผู้ติดต่อ": "contactName", contactname: "contactName",
  "หมายเหตุราคา": "priceNote", pricenote: "priceNote",
  remark: "remark", "สถานะข้อมูล": "remark",
  id: "refId", "รหัสอ้างอิง": "refId",
  "สถานะ": "status", status: "status",
  "ประเภทลิงก์": "linkType", linktype: "linkType",
};
// หัวคอลัมน์ที่ "อาจ" เป็นโดเมน: ใช้เป็นโดเมนเฉพาะเมื่อชีตไม่มีคอลัมน์ Domain / โดเมน ตรง ๆ
// (กันคอลัมน์ Name หรือ Website ที่อยู่ก่อนหน้า แย่งคอลัมน์โดเมนจริง)
const WEBSITE_HEADERS = new Set(["website", "เว็บไซต์", "เว็บ"]);
const NAME_HEADERS = new Set(["name"]);

const headerKey = (s: string) => s.replace(/\s+/g, "").toLowerCase();

/** หาแถวหัวตาราง (ใน 5 แถวแรก) ที่มีคอลัมน์โดเมน แล้วคืนตำแหน่งคอลัมน์ของแต่ละฟิลด์ */
export function mapHeader(grid: ImportCell[][]): { headerRow: number; cols: Partial<Record<Field, number>> } | null {
  for (let r = 0; r < Math.min(5, grid.length); r++) {
    const cols: Partial<Record<Field, number>> = {};
    let websiteCol: number | undefined;
    let nameCol: number | undefined;
    (grid[r] ?? []).forEach((c, i) => {
      const key = headerKey(c?.text ?? "");
      if (WEBSITE_HEADERS.has(key)) { websiteCol ??= i; return; }
      if (NAME_HEADERS.has(key)) { nameCol ??= i; return; }
      const f = HEADER_ALIASES[key];
      if (f && cols[f] === undefined) cols[f] = i;
    });
    if (cols.domain === undefined) cols.domain = websiteCol ?? nameCol;
    else if (cols.siteUrl === undefined && websiteCol !== undefined) cols.siteUrl = websiteCol;
    if (cols.domain !== undefined) return { headerRow: r, cols };
  }
  return null;
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const blank = (s: string) => { const t = s.trim(); return t === "" || t === "-" || t === "—"; };

function withLink(text: string, link: string | undefined): string {
  const url = safeHttpUrl(link ?? "");
  if (!url) return text;
  return text.includes(url) ? text : text ? `${text}\n${url}` : url;
}

/** แปลง 1 ชีตเป็นแถวนำเข้า — ชีตที่ไม่มีคอลัมน์โดเมนคืน null (ข้ามทั้งชีต) */
export function rowsFromSheet(sheet: ImportSheet): { rows: VendorImportRow[]; skipped: ImportSkip[] } | null {
  const head = mapHeader(sheet.grid);
  if (!head) return null;
  const { cols, headerRow } = head;
  const rows: VendorImportRow[] = [];
  const skipped: ImportSkip[] = [];
  const at = (cells: ImportCell[], f: Field): ImportCell => (cols[f] === undefined ? { text: "" } : cells[cols[f]!] ?? { text: "" });

  for (let r = headerRow + 1; r < sheet.grid.length; r++) {
    const cells = sheet.grid[r] ?? [];
    const dc = at(cells, "domain");
    const raw = (dc.text ?? "").trim();
    if (!raw) continue; // แถวว่าง (รวมแถวที่มีแต่ checkbox)

    let domain = normalizeDomain(raw);
    const linkUrl = safeHttpUrl(dc.link ?? "");
    if (!looksLikeDomain(domain)) domain = linkUrl ? normalizeDomain(linkUrl) : "";
    if (!looksLikeDomain(domain)) {
      skipped.push({ sheet: sheet.name, row: r + 1, text: oneLine(raw).slice(0, 80), reason: "ไม่ใช่โดเมน" });
      continue;
    }
    const hasPath = /[\/?#]/.test(raw.replace(/^[a-z]+:\/\//i, "").replace(/\/$/, ""));
    const urlCell = safeHttpUrl(at(cells, "siteUrl").text);
    const siteUrl = urlCell || linkUrl || (hasPath ? safeHttpUrl(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`) : "");

    const detail: VendorDetail = { ...EMPTY_VENDOR_DETAIL };
    const priceNotes: string[] = [];
    const noteCell = (at(cells, "priceNote").text ?? "").trim();
    if (!blank(noteCell)) priceNotes.push(noteCell);
    for (const { key, label } of PRICE_TYPES) {
      const t = at(cells, key).text ?? "";
      const p = parsePrice(t);
      detail[key] = p.value;
      if (!p.clean) priceNotes.push(`${label}: ${oneLine(t)}`);
    }
    const generic = parsePrice(at(cells, "price").text ?? "");
    if (!generic.clean) priceNotes.push(`ราคา: ${oneLine(at(cells, "price").text)}`);
    detail.priceNote = priceNotes.join(" | ").slice(0, 500);

    const urText = (at(cells, "ur").text ?? "").trim();
    detail.urlRating = /^\d+(\.\d+)?$/.test(urText) ? Math.min(100, Number(urText)) : null;
    detail.language = oneLine(at(cells, "language").text ?? "").toUpperCase().slice(0, 20);
    const exp = (at(cells, "expiration").text ?? "").trim();
    detail.expiration = blank(exp) ? "" : exp.slice(0, 300);
    const rc = at(cells, "rateCard");
    detail.rateCardUrl = safeHttpUrl(rc.link ?? "") || safeHttpUrl(rc.text ?? "");
    const remark = (at(cells, "remark").text ?? "").toLowerCase();
    detail.dataStatus = remark.includes("outdated") ? "OUTDATED" : remark.includes("updated") ? "UPDATED" : "";
    detail.refId = oneLine(at(cells, "refId").text ?? "").slice(0, 50);

    const drText = (at(cells, "dr").text ?? "").trim();
    const dr = /^\d+(\.\d+)?$/.test(drText) ? Math.round(Number(drText)) : null;
    const nc = at(cells, "notes");
    const notesText = blank(nc.text ?? "") ? "" : (nc.text ?? "").trim();
    const cc = at(cells, "contact");
    const contactText = blank(cc.text ?? "") ? "" : (cc.text ?? "").trim();
    const catText = oneLine(at(cells, "category").text ?? "");
    const categoryInferred = !catText && cols.category === undefined && !!sheet.name;
    const hasPrice = !!generic.value && generic.value > 0;
    const price = hasPrice ? generic.value! : pickDefaultPrice(detail);
    const statusText = oneLine(at(cells, "status").text ?? "").toUpperCase();
    const linkText = oneLine(at(cells, "linkType").text ?? "").toLowerCase();

    rows.push({
      ...detail,
      domain,
      siteUrl,
      category: (catText || (categoryInferred ? sheet.name : "")).slice(0, 100),
      price,
      ...(categoryInferred ? { categoryInferred: true } : {}),
      ...(!hasPrice && price > 0 ? { priceInferred: true } : {}),
      ...(statusText === "ACTIVE" || statusText === "INACTIVE" ? { status: statusText } : {}),
      ...(linkText === "dofollow" || linkText === "nofollow" || linkText === "sponsored" ? { linkType: linkText } : {}),
      domainRating: dr !== null && dr >= 0 && dr <= 100 ? dr : null,
      traffic: parseTraffic(at(cells, "traffic").text ?? ""),
      contactName: oneLine(at(cells, "contactName").text ?? "").slice(0, 200),
      contactChannel: withLink(contactText, cc.link?.startsWith("mailto:") ? undefined : cc.link).slice(0, 1000),
      notes: withLink(notesText, nc.link).slice(0, 2000),
      sheet: sheet.name,
    });
  }
  return { rows, skipped };
}

const MERGE_FIELDS: (keyof VendorImportRow)[] = [
  "siteUrl", "category", "price", "domainRating", "traffic", "contactName", "contactChannel", "notes",
  "language", "urlRating", "priceBacklink", "pricePublisherWeb", "pricePublisherWebFb", "priceCvcWeb", "priceCvcWebFb", "pricePr",
  "priceNote", "expiration", "rateCardUrl", "dataStatus", "refId", "status", "linkType",
];
// ช่องที่ค่าต่างกันระหว่างชีตถือว่าปกติ ไม่ต้องรายงาน (URL เขียนต่างรูปแบบ, ราคาเริ่มต้นคำนวณจากราคาแยกประเภท)
const NO_CONFLICT_REPORT = new Set<keyof VendorImportRow>(["siteUrl", "price"]);
const isEmpty = (v: unknown) => v === "" || v === null || v === undefined || v === 0;

/** รวมแถวโดเมนซ้ำข้ามชีต: แถวแรกเป็นหลัก แถวถัดไปเติมเฉพาะช่องที่ยังว่าง; ค่าที่ชนกันรายงานใน conflicts */
export function mergeImportRows(input: VendorImportRow[]): { rows: VendorImportRow[]; conflicts: ImportConflict[] } {
  const map = new Map<string, VendorImportRow>();
  const conflicts: ImportConflict[] = [];
  for (const row of input) {
    const cur = map.get(row.domain);
    if (!cur) { map.set(row.domain, { ...row }); continue; }
    const rec = cur as unknown as Record<string, unknown>;
    for (const f of MERGE_FIELDS) {
      const a = cur[f];
      const b = row[f];
      if (isEmpty(b)) continue;
      if (isEmpty(a)) {
        rec[f] = b;
        // ธง "เดามา" ตามค่าที่เพิ่งรับเข้ามา
        if (f === "category") { if (row.categoryInferred) cur.categoryInferred = true; else delete cur.categoryInferred; }
        if (f === "price") { if (row.priceInferred) cur.priceInferred = true; else delete cur.priceInferred; }
        continue;
      }
      // ข้อความเดียวกันแต่อีกชีตมีต่อท้ายเพิ่ม (เช่น ลิงก์ที่แนบในเซลล์) = ใช้ตัวที่ครบกว่า ไม่นับว่าชนกัน
      if (typeof a === "string" && typeof b === "string" && a !== b && (b.startsWith(a) || a.startsWith(b))) {
        if (b.length > a.length) rec[f] = b;
        continue;
      }
      if (a !== b && !NO_CONFLICT_REPORT.has(f)) {
        conflicts.push({ domain: row.domain, field: f, kept: String(a).slice(0, 80), other: String(b).slice(0, 80), sheet: row.sheet });
      }
    }
    if (!cur.price) {
      cur.price = pickDefaultPrice(cur);
      if (cur.price > 0) cur.priceInferred = true;
    }
  }
  return { rows: Array.from(map.values()), conflicts };
}

export interface ImportSheetInfo {
  name: string;
  /** จำนวนเว็บที่อ่านได้จากชีตนี้ */
  count: number;
  /** จำนวนเว็บที่ชีตนี้เป็นต้นทางหลัก (ชีตก่อนหน้าตามลำดับความสำคัญยังไม่มี) */
  added: number;
  /** ชีตรวม = มีมากกว่า 1 หมวดในชีตเดียว */
  rollup: boolean;
}

export interface ImportParseResult {
  rows: VendorImportRow[];
  sheets: ImportSheetInfo[];
  ignoredSheets: string[];
  skipped: ImportSkip[];
  conflicts: ImportConflict[];
  truncated: boolean;
}

/**
 * อ่านทุกชีตแล้วรวมเป็นรายการเดียว
 * ลำดับความสำคัญ: ชีตย่อย (หมวดเดียว) มาก่อน ชีตรวม (หลายหมวด) มาทีหลัง — ชีตย่อยคือข้อมูลที่ทีมอัปเดตจริง
 * ชีตรวมใช้เติมช่องที่ชีตย่อยว่าง และเพิ่มเว็บที่ไม่มีในชีตย่อยใดเลย
 */
export function parseImportSheets(sheets: ImportSheet[]): ImportParseResult {
  const parsed: { name: string; rows: VendorImportRow[]; rollup: boolean; order: number }[] = [];
  const ignoredSheets: string[] = [];
  const skipped: ImportSkip[] = [];
  sheets.forEach((s, order) => {
    const res = rowsFromSheet(s);
    if (!res) { ignoredSheets.push(s.name); return; }
    skipped.push(...res.skipped);
    if (res.rows.length === 0) return;
    const cats = new Set(res.rows.map((r) => r.category).filter(Boolean));
    parsed.push({ name: s.name, rows: res.rows, rollup: cats.size > 1, order });
  });
  const byPriority = [...parsed.filter((p) => !p.rollup), ...parsed.filter((p) => p.rollup)];
  const seen = new Set<string>();
  const added = new Map<number, number>();
  const all: VendorImportRow[] = [];
  for (const p of byPriority) {
    let n = 0;
    for (const r of p.rows) {
      if (!seen.has(r.domain)) { seen.add(r.domain); n++; }
      all.push(r);
    }
    added.set(p.order, n);
  }
  const merged = mergeImportRows(all);
  const truncated = merged.rows.length > MAX_IMPORT_ROWS;
  return {
    rows: truncated ? merged.rows.slice(0, MAX_IMPORT_ROWS) : merged.rows,
    sheets: parsed.map((p) => ({ name: p.name, count: new Set(p.rows.map((r) => r.domain)).size, added: added.get(p.order) ?? 0, rollup: p.rollup })),
    ignoredSheets, skipped: skipped.slice(0, 200), conflicts: merged.conflicts.slice(0, 200), truncated,
  };
}
