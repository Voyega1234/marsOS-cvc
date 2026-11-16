/**
 * นำเข้าข้อมูลจาก Google Sheet "Backlink Budget Tracker" (แท็บ Project Budget + Expense Log) → Backlink Management
 * ไฟล์บริสุทธิ์: อ่านค่าเซลล์ + วางแผนว่าจะสร้าง/แก้อะไร ไม่แตะฐานข้อมูลและไม่เรียก Google
 *
 * กติกาหลัก
 * - นำเข้าเฉพาะแถว Expense Log ที่ Status = Published (Planned / Cancelled / ว่าง = ข้าม)
 * - ค่าใช้จ่ายแต่ละแถวตัดงบเดือนของวันที่ในแถวนั้น แถวที่ไม่มีวันที่ใช้ "เดือนของงบ"
 * - Initial Budget (ก้อนเดียวทั้งโปรเจกต์) ลงเป็นงบของ "เดือนของงบ" เดือนเดียว
 * - นำเข้าซ้ำได้: แต่ละแถวมี rowKey จำไว้ในตาราง BlmSheetImportRow จึงไม่สร้างซ้ำ
 */
import { isValidPeriod, round2 } from "./budget";
import { looksLikeDomain, normalizeDomain, safeHttpUrl } from "./domain";
import { cleanProjectName } from "./project-name";

export type Cell = string | number | boolean | null | undefined;
export type Grid = Cell[][];

export const MAX_BUDGET_ROWS = 1000;
export const MAX_EXPENSE_ROWS = 5000;
/** ค่าใน projectMap: สร้างโปรเจกต์ใหม่ */
export const MAP_NEW = "new";
/** ค่าใน projectMap: ใช้โปรเจกต์เดียวกับชื่ออื่นในชีท ("=<key ของชื่อนั้น>") */
export const MAP_ALIAS_PREFIX = "=";

// ───────────────────────── อ่านค่าเซลล์ ─────────────────────────

export function cellText(c: Cell): string {
  if (c === null || c === undefined) return "";
  if (typeof c === "number") return Number.isFinite(c) ? String(c) : "";
  if (typeof c === "boolean") return c ? "TRUE" : "FALSE";
  return String(c).replace(/\s+/g, " ").trim();
}

/** ตัวเลขเงิน: รับทั้งตัวเลขจริงและข้อความ "2,666.00" / "฿ 15,000" — ติดลบหรืออ่านไม่ได้ = null */
export function parseAmount(c: Cell): number | null {
  if (typeof c === "number") return Number.isFinite(c) && c >= 0 ? round2(c) : null;
  if (typeof c !== "string") return null;
  const s = c.replace(/[,\s฿]/g, "").replace(/thb|บาท/gi, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? round2(n) : null;
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  มกราคม: 1, กุมภาพันธ์: 2, มีนาคม: 3, เมษายน: 4, พฤษภาคม: 5, มิถุนายน: 6, กรกฎาคม: 7, สิงหาคม: 8, กันยายน: 9, ตุลาคม: 10, พฤศจิกายน: 11, ธันวาคม: 12,
  "ม.ค.": 1, "ก.พ.": 2, "มี.ค.": 3, "เม.ย.": 4, "พ.ค.": 5, "มิ.ย.": 6, "ก.ค.": 7, "ส.ค.": 8, "ก.ย.": 9, "ต.ค.": 10, "พ.ย.": 11, "ธ.ค.": 12,
};

function ymd(y: number, m: number, d: number): string | null {
  if (y > 2400) y -= 543; // พ.ศ.
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * วันที่ในชีท → "YYYY-MM-DD"
 * รับเลขลำดับวันของ Google Sheets (นับจาก 1899-12-30), "2026-02-05", "5/2/2026" (วัน/เดือน/ปี), "5 February 2026", "5 ก.พ. 2569"
 */
export function parseSheetDate(c: Cell): string | null {
  if (typeof c === "number") {
    if (!Number.isFinite(c) || c < 36526 || c > 73415) return null; // 2000-01-01 … 2100-12-31
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(c) * 86_400_000);
    return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  if (typeof c !== "string") return null;
  const s = c.replace(/\s+/g, " ").trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/.exec(s);
  if (m) return ymd(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{1,2}) ([^\d\s,]+),? (\d{4})$/.exec(s);
  if (m) {
    const mon = MONTHS[m[2].toLowerCase()];
    return mon ? ymd(Number(m[3]), mon, Number(m[1])) : null;
  }
  m = /^([^\d\s,]+) (\d{1,2}),? (\d{4})$/.exec(s);
  if (m) {
    const mon = MONTHS[m[1].toLowerCase()];
    return mon ? ymd(Number(m[3]), mon, Number(m[2])) : null;
  }
  return null;
}

// new RegExp: ตัว tsconfig ไม่ได้ตั้ง target จึงใช้ literal /u ไม่ได้
const NAME_STRIP = new RegExp("[^\\p{L}\\p{N}\\p{M}]+", "gu");

/** ชื่อสำหรับเทียบ: NFKC, ตัวพิมพ์เล็ก, เหลือเฉพาะตัวอักษร/ตัวเลข (สระและวรรณยุกต์ไทยยังอยู่) */
export function normName(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(NAME_STRIP, "");
}

const TOTAL_LABELS = new Set(["total", "totals", "grandtotal", "subtotal", "รวม", "ยอดรวม", "รวมทั้งหมด", "รวมทั้งสิ้น"]);

/** แถวสรุปยอดท้ายตาราง ("Total", "รวม") — ไม่ใช่โปรเจกต์ ห้ามนำเข้าเป็นงบหรือรายการ */
export function isTotalRow(client: string, project: string): boolean {
  const labels = [client, project].filter(Boolean);
  return labels.length > 0 && labels.every((l) => TOTAL_LABELS.has(normName(l)));
}

/** ดึง URL จากช่อง Website / Media: http(s) ตัวแรก หรือโดเมนเปล่าที่ไม่มี scheme */
export function coerceUrl(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  const m = /https?:\/\/\S+/i.exec(s);
  if (m) return safeHttpUrl(m[0]);
  if (/\s/.test(s)) return "";
  return looksLikeDomain(normalizeDomain(s)) ? safeHttpUrl(`https://${s}`) : "";
}

/** URL สำหรับเทียบว่าเป็นหน้าเดียวกัน: ไม่สน protocol / www / ตัวพิมพ์ของโดเมน / "/" ท้าย / #hash */
export function urlKey(url: string): string {
  const s = url.trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    return `${host}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch {
    return s.toLowerCase();
  }
}

// ───────────────────────── อ่านแท็บ ─────────────────────────

function headerKey(c: Cell): string {
  return cellText(c).toLowerCase().replace(/\(.*?\)/g, "").replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ").trim();
}

type ColumnSpec<K extends string> = Record<K, string[]>;

function findHeader<K extends string>(grid: Grid, spec: ColumnSpec<K>, need: (cols: Partial<Record<K, number>>) => boolean):
  { headerIndex: number; cols: Partial<Record<K, number>> } | null {
  const limit = Math.min(grid.length, 15);
  for (let i = 0; i < limit; i++) {
    const row = grid[i] ?? [];
    const cols: Partial<Record<K, number>> = {};
    for (let c = 0; c < row.length; c++) {
      const h = headerKey(row[c]);
      if (!h) continue;
      for (const k of Object.keys(spec) as K[]) {
        if (cols[k] === undefined && spec[k].includes(h)) { cols[k] = c; break; }
      }
    }
    if (need(cols)) return { headerIndex: i, cols };
  }
  return null;
}

export interface SheetBudgetRow { row: number; client: string; project: string; amount: number | null; note: string }
export interface SheetExpenseRow {
  row: number; date: string | null; dateRaw: string; client: string; project: string;
  url: string; site: string; type: string; cost: number | null; costRaw: string; anchor: string; status: string; note: string;
}
export interface ParsedTab<T> { ok: boolean; error: string; headerRow: number; rows: T[]; truncated: boolean }

const BUDGET_COLS: ColumnSpec<"client" | "project" | "amount" | "note"> = {
  client: ["client", "ลูกค้า", "client name"],
  project: ["project", "โปรเจกต์", "โปรเจค", "project name"],
  amount: ["initial budget", "budget", "approved budget", "total budget", "งบ", "งบประมาณ", "งบเริ่มต้น", "งบที่อนุมัติ"],
  note: ["note", "notes", "หมายเหตุ"],
};

const EXPENSE_COLS: ColumnSpec<"date" | "client" | "project" | "site" | "type" | "cost" | "anchor" | "status" | "note"> = {
  date: ["date", "วันที่", "publish date", "published date"],
  client: ["client", "ลูกค้า", "client name"],
  project: ["project", "โปรเจกต์", "โปรเจค", "project name"],
  site: ["website/media", "website", "media", "url", "live url", "link", "เว็บไซต์", "เว็บ", "ลิงก์"],
  type: ["type", "ประเภท"],
  cost: ["cost", "price", "amount", "ราคา", "ค่าใช้จ่าย"],
  anchor: ["anchor text", "anchor"],
  status: ["status", "สถานะ"],
  note: ["note", "notes", "หมายเหตุ"],
};

const at = (row: Cell[], i: number | undefined): Cell => (i === undefined ? "" : row[i]);

/** แท็บ Project Budget: Client | Project | Initial Budget (THB) | … | Note */
export function parseBudgetTab(grid: Grid): ParsedTab<SheetBudgetRow> {
  const h = findHeader(grid, BUDGET_COLS, (c) => c.amount !== undefined && (c.project !== undefined || c.client !== undefined));
  if (!h) return { ok: false, error: "ไม่พบแถวหัวตารางของแท็บงบ (ต้องมีคอลัมน์ Project และ Initial Budget)", headerRow: 0, rows: [], truncated: false };
  const rows: SheetBudgetRow[] = [];
  let truncated = false;
  for (let i = h.headerIndex + 1; i < grid.length; i++) {
    const r = grid[i] ?? [];
    const client = cellText(at(r, h.cols.client));
    const project = cellText(at(r, h.cols.project));
    if (!client && !project) continue;
    if (isTotalRow(client, project)) continue;
    if (rows.length >= MAX_BUDGET_ROWS) { truncated = true; break; }
    rows.push({ row: i + 1, client, project, amount: parseAmount(at(r, h.cols.amount)), note: cellText(at(r, h.cols.note)).slice(0, 500) });
  }
  return { ok: true, error: "", headerRow: h.headerIndex + 1, rows, truncated };
}

/** แท็บ Expense Log: Date | Client | Project | Website / Media | Type | Cost (THB) | Anchor Text | Status | Note */
export function parseExpenseTab(grid: Grid): ParsedTab<SheetExpenseRow> {
  const h = findHeader(grid, EXPENSE_COLS, (c) => c.cost !== undefined && c.status !== undefined && (c.project !== undefined || c.client !== undefined));
  if (!h) return { ok: false, error: "ไม่พบแถวหัวตารางของแท็บค่าใช้จ่าย (ต้องมีคอลัมน์ Project, Cost และ Status)", headerRow: 0, rows: [], truncated: false };
  const rows: SheetExpenseRow[] = [];
  let truncated = false;
  for (let i = h.headerIndex + 1; i < grid.length; i++) {
    const r = grid[i] ?? [];
    const client = cellText(at(r, h.cols.client));
    const project = cellText(at(r, h.cols.project));
    const site = cellText(at(r, h.cols.site));
    const costCell = at(r, h.cols.cost);
    const status = cellText(at(r, h.cols.status));
    const dateCell = at(r, h.cols.date);
    if (!client && !project && !site && !status && cellText(costCell) === "") continue;
    if (!site && !status && isTotalRow(client, project)) continue;
    if (rows.length >= MAX_EXPENSE_ROWS) { truncated = true; break; }
    rows.push({
      row: i + 1,
      date: parseSheetDate(dateCell), dateRaw: cellText(dateCell),
      client, project, url: coerceUrl(site), site: site.slice(0, 1000),
      type: cellText(at(r, h.cols.type)).slice(0, 60),
      cost: parseAmount(costCell), costRaw: cellText(costCell),
      anchor: cellText(at(r, h.cols.anchor)).slice(0, 300),
      status, note: cellText(at(r, h.cols.note)).slice(0, 1000),
    });
  }
  return { ok: true, error: "", headerRow: h.headerIndex + 1, rows, truncated };
}

/** หาแท็บจากชื่อ: ตรงเป๊ะก่อน แล้วค่อยดูว่ามีคำนั้นอยู่ในชื่อ */
export function pickTab(titles: string[], exact: string[], contains: string[]): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  for (const e of exact) {
    const hit = titles.find((t) => norm(t) === e);
    if (hit) return hit;
  }
  for (const c of contains) {
    const hit = titles.find((t) => norm(t).includes(c) && !norm(t).startsWith("marsos"));
    if (hit) return hit;
  }
  return null;
}
export const pickBudgetTab = (titles: string[]) => pickTab(titles, ["project budget", "budget", "งบประมาณ"], ["project budget", "budget", "งบ"]);
export const pickExpenseTab = (titles: string[]) => pickTab(titles, ["expense log", "expenses", "expense"], ["expense", "ค่าใช้จ่าย"]);

export type ExpenseStatusKind = "published" | "planned" | "cancelled" | "blank" | "other";
export function expenseStatusKind(status: string): ExpenseStatusKind {
  const s = status.toLowerCase().trim();
  if (!s) return "blank";
  if (["published", "publish", "live", "done", "paid", "เผยแพร่แล้ว", "เผยแพร่", "ลงแล้ว"].includes(s)) return "published";
  if (["planned", "plan", "pending", "วางแผน", "รอลง"].includes(s)) return "planned";
  if (["cancelled", "canceled", "cancel", "ยกเลิก"].includes(s)) return "cancelled";
  return "other";
}

// ───────────────────────── วางแผนนำเข้า ─────────────────────────

export interface ExistingProject { id: string; name: string; clientName: string; manual: boolean }
export interface ExistingBudget { id: string; projectId: string; period: string; approvedAmount: number; note: string }
export interface ExistingRequest {
  id: string; projectId: string; liveUrl: string; status: string; quotedPrice: number; actualPrice: number | null;
  anchorText: string; publishedAt: string | null; budgetPeriod: string;
}
export interface ExistingImportRow {
  rowKey: string; requestId: string; lastStatus: string;
  /** ชีทที่แถวจำนี้มาจาก ("" = จำไว้ก่อนมีคอลัมน์นี้ ถือเป็นของชีทที่กำลังอ่าน) */
  spreadsheetId?: string;
}

export interface PlanInput {
  budgets: SheetBudgetRow[];
  expenses: SheetExpenseRow[];
  projects: ExistingProject[];
  existingBudgets: ExistingBudget[];
  requests: ExistingRequest[];
  importRows: ExistingImportRow[];
  /** key ของชื่อในชีท → Project.id | "new" | "=<key อื่น>" */
  projectMap: Record<string, string>;
  /** เดือนของงบ "YYYY-MM" */
  budgetPeriod: string;
  /** แก้รายการที่เคยนำเข้าให้ตรงกับชีท */
  update: boolean;
  /** ยกเลิกรายการที่เคยนำเข้าแต่ไม่อยู่ในชีทแล้ว */
  cancelMissing: boolean;
  /** id ของชีทที่กำลังอ่าน — แถวจำของชีทอื่นไม่ถูกนับว่า "หายจากชีท" */
  spreadsheetId?: string;
  /** มีเหตุให้ห้ามยกเลิกรายการเดิมรอบนี้ (เช่น อ่านชีทมาไม่ครบ) — ข้อความนี้แสดงเป็นคำเตือน */
  noCancelReason?: string;
}

export type ProjectResolution = "mapped" | "matched" | "alias" | "new" | "ambiguous";
export interface ProjectPlan {
  key: string;
  sheetName: string;
  clientName: string;
  resolution: ProjectResolution;
  /** id ของโปรเจกต์ที่มีอยู่ (null = ต้องสร้างใหม่ หรือยังต้องเลือก) */
  projectId: string | null;
  /** key ของรายการที่โปรเจกต์ใหม่จะถูกสร้างจริง (ตัวเอง หรือปลายทางของ alias) */
  targetKey: string;
  candidates: { id: string; name: string }[];
  inBudget: boolean;
  expenseRows: number;
}

export type BudgetAction = "create" | "update" | "same" | "keep" | "conflict" | "blank" | "unresolved";
export interface BudgetPlan {
  rows: number[];
  projectKey: string;
  sheetName: string;
  amount: number | null;
  note: string;
  action: BudgetAction;
  budgetId: string | null;
  current: number | null;
  otherPeriods: string[];
}

export type ExpenseAction = "create" | "update" | "same" | "keep" | "link" | "revive" | "skip";
export type SkipReason = "planned" | "cancelled" | "blank_status" | "other_status" | "placeholder" | "no_project" | "unresolved" | "cancelled_in_app" | "deleted_in_app";
export interface ExpenseData {
  liveUrl: string; vendorDomain: string; anchorText: string; cost: number; publishedAt: string | null; budgetPeriod: string;
  type: string; note: string; site: string;
}
export interface ExpensePlan {
  row: number;
  rowKey: string;
  projectKey: string;
  sheetName: string;
  action: ExpenseAction;
  skipReason: SkipReason | "";
  requestId: string | null;
  /** มีแถวจำ (BlmSheetImportRow) ของ rowKey นี้อยู่แล้ว */
  hasImportRow: boolean;
  /** รอบนี้จับคู่กับคำขอที่คนสร้างเอง — ต้องจำ requestId ลงแถวจำ */
  linked: boolean;
  /** แถวนี้ถูกแก้ในชีทจน rowKey เปลี่ยน: rowKey เดิมของแถวจำที่ต้องย้ายมาเป็น rowKey นี้ */
  rekeyFrom: string | null;
  /** แถวจำเป็นของชีทอื่น (หรือยังไม่ระบุชีท) — ต้องติดป้ายเป็นชีทนี้ */
  retag: boolean;
  /** แถวจำยังบอกว่า "ตัวนำเข้ายกเลิก" แต่คำขอถูกเปิดกลับแล้ว — ต้องล้างเครื่องหมาย */
  resetMark: boolean;
  data: ExpenseData | null;
  changes: string[];
  warnings: string[];
}
export interface MissingPlan {
  rowKey: string; requestId: string; status: string; liveUrl: string; cost: number; projectId: string;
  /** คำขอที่คนสร้างเองแล้วถูกจับคู่ — ตัวนำเข้าไม่ยกเลิกให้ */
  manual: boolean;
  action: "cancel" | "report";
}

export interface ImportSummary {
  projectsNew: number;
  budgetsCreate: number; budgetsUpdate: number; budgetsSame: number; budgetsConflict: number; budgetsBlank: number;
  expensesCreate: number; expensesUpdate: number; expensesSame: number; expensesKeep: number; expensesLink: number; expensesRevive: number;
  /** แถวที่ถูกแก้ในชีทแล้วจับคู่กลับกับรายการเดิม (ไม่สร้างซ้ำ) */
  expensesRekey: number;
  /** แถวจำที่ต้องปรับ (ย้าย key / ติดป้ายชีท / ล้างเครื่องหมาย) — ไม่กระทบคำขอ */
  rowFixes: number;
  skipped: Partial<Record<SkipReason, number>>;
  missing: number; missingCancel: number;
  /** รายการที่นำเข้าจากชีทอื่นและไม่มีในชีทนี้ — ไม่แตะ */
  otherSheetRows: number;
  budgetTotal: number;
  publishedRows: number; publishedTotal: number;
  importTotal: number;
}
export interface ImportPlan {
  budgetPeriod: string;
  projects: ProjectPlan[];
  budgets: BudgetPlan[];
  expenses: ExpensePlan[];
  missing: MissingPlan[];
  summary: ImportSummary;
  warnings: string[];
  /** ยังนำเข้าไม่ได้จนกว่าจะแก้ (เช่น ยังไม่ได้เลือกโปรเจกต์) */
  blockers: string[];
}

const ACTIVE_FOR_LINK = ["PUBLISHED", "VERIFIED", "LOST", "IN_PROGRESS", "APPROVED"];
const DEAD = ["CANCELLED", "REJECTED"];
/** rowKey ยาวสุด — ยาวกว่านี้ตัดแล้วต่อท้ายด้วย hash ของข้อความเต็ม (สองแถวที่ต่างกันแค่ตอนท้ายยังได้ key ต่างกัน) */
const KEY_MAX = 400;
const KEY_HEAD = 360;
const WARN_NAMES = 10;

/** hash 53 บิต (cyrb53) เป็น base36 — ใช้ย่อ rowKey ที่ยาวเกิน ไม่ใช่เพื่อความปลอดภัย */
export function shortHash(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function capKey(keyBase: string): string {
  return keyBase.length > KEY_MAX ? `${keyBase.slice(0, KEY_HEAD)}~${shortHash(keyBase)}` : keyBase;
}

function nameList(items: string[]): string {
  const more = items.length - WARN_NAMES;
  return items.slice(0, WARN_NAMES).join(", ") + (more > 0 ? ` และอีก ${more} โปรเจกต์` : "");
}

function costOf(r: ExistingRequest): number {
  return round2(r.actualPrice ?? r.quotedPrice);
}

/** สิ่งที่ต่างกันระหว่างคำขอใน MarsOS กับแถวในชีท (เฉพาะฟิลด์ที่ชีทเป็นเจ้าของ) */
function diffRequest(existing: ExistingRequest, data: ExpenseData, target: string): string[] {
  const changes: string[] = [];
  if (target !== `id:${existing.projectId}`) changes.push("โปรเจกต์");
  if (costOf(existing) !== data.cost) changes.push(`ราคา ${costOf(existing)} → ${data.cost}`);
  if ((existing.publishedAt ?? null) !== data.publishedAt) changes.push(`วันที่ ${existing.publishedAt ?? "-"} → ${data.publishedAt ?? "-"}`);
  if (existing.budgetPeriod !== data.budgetPeriod) changes.push(`เดือนตัดงบ ${existing.budgetPeriod} → ${data.budgetPeriod}`);
  if (existing.anchorText !== data.anchorText) changes.push("Anchor");
  if (data.liveUrl && existing.liveUrl !== data.liveUrl) changes.push("URL");
  return changes;
}

function sheetProjectName(r: { project: string; client: string }): string {
  return r.project || r.client;
}

function resolveProjects(input: PlanInput): Map<string, ProjectPlan> {
  const out = new Map<string, ProjectPlan>();
  const add = (name: string, client: string, from: "budget" | "expense") => {
    const key = normName(name);
    if (!key) return;
    let p = out.get(key);
    if (!p) {
      p = { key, sheetName: cleanProjectName(name), clientName: cleanProjectName(client), resolution: "new", projectId: null, targetKey: key, candidates: [], inBudget: false, expenseRows: 0 };
      out.set(key, p);
    }
    if (!p.clientName && client) p.clientName = cleanProjectName(client);
    if (from === "budget") p.inBudget = true; else p.expenseRows++;
  };
  for (const b of input.budgets) add(sheetProjectName(b), b.client, "budget");
  for (const e of input.expenses) {
    if (expenseStatusKind(e.status) === "published") add(sheetProjectName(e), e.client, "expense");
  }

  const byId = new Map(input.projects.map((p) => [p.id, p]));
  for (const p of Array.from(out.values())) {
    const mapped = input.projectMap[p.key];
    if (typeof mapped === "string" && byId.has(mapped)) { p.resolution = "mapped"; p.projectId = mapped; continue; }
    if (typeof mapped === "string" && mapped.startsWith(MAP_ALIAS_PREFIX)) { p.resolution = "alias"; p.targetKey = mapped.slice(MAP_ALIAS_PREFIX.length); continue; }
    if (mapped === MAP_NEW) { p.resolution = "new"; continue; }
    const byName = input.projects.filter((x) => normName(x.name) === p.key);
    const byClient = input.projects.filter((x) => x.clientName && normName(x.clientName) === p.key && !byName.includes(x));
    if (byName.length === 1) { p.resolution = "matched"; p.projectId = byName[0].id; continue; }
    if (byName.length === 0 && byClient.length === 1) { p.resolution = "matched"; p.projectId = byClient[0].id; continue; }
    if (byName.length + byClient.length > 1) {
      p.resolution = "ambiguous";
      p.candidates = [...byName, ...byClient].map((x) => ({ id: x.id, name: x.name }));
    }
  }
  // alias: ชี้ไปชื่ออื่นในชีท — ตามต่อไม่เกิน 3 ชั้น ชี้ไม่เจอหรือวนกลับ = สร้างใหม่ของตัวเอง
  for (const p of Array.from(out.values())) {
    if (p.resolution !== "alias") continue;
    let target = out.get(p.targetKey);
    const seen = new Set([p.key]);
    let hops = 0;
    while (target && target.resolution === "alias" && !seen.has(target.key) && hops < 3) {
      seen.add(target.key);
      target = out.get(target.targetKey);
      hops++;
    }
    if (!target || target === p || target.resolution === "alias") { p.resolution = "new"; p.targetKey = p.key; continue; }
    p.targetKey = target.key;
    p.projectId = target.projectId;
    if (target.resolution === "ambiguous") { p.resolution = "ambiguous"; p.candidates = target.candidates; }
  }
  return out;
}

/** ตัวตนของโปรเจกต์ปลายทาง: "id:<Project.id>" หรือ "new:<key>" — ใช้เทียบว่าสองแถวลงโปรเจกต์เดียวกันไหม */
function targetOf(p: ProjectPlan): string {
  return p.projectId ? `id:${p.projectId}` : `new:${p.targetKey}`;
}

export function expenseBudgetPeriod(date: string | null, fallback: string): string {
  return date ? date.slice(0, 7) : fallback;
}

export function planImport(input: PlanInput): ImportPlan {
  const M = input.budgetPeriod;
  const warnings: string[] = [];
  const blockers: string[] = [];
  if (!isValidPeriod(M)) blockers.push("เดือนของงบไม่ถูกต้อง");

  const projects = resolveProjects(input);
  const planOf = (name: string) => projects.get(normName(name)) ?? null;

  // ───── งบ ─────
  const budgetByTarget = new Map<string, BudgetPlan & { target: string }>();
  for (const b of input.budgets) {
    const p = planOf(sheetProjectName(b));
    if (!p) continue;
    const target = targetOf(p);
    const cur = budgetByTarget.get(target);
    if (cur) {
      cur.rows.push(b.row);
      if (b.amount !== null) cur.amount = round2((cur.amount ?? 0) + b.amount);
      if (b.note && !cur.note.includes(b.note)) cur.note = [cur.note, b.note].filter(Boolean).join(" · ").slice(0, 500);
      warnings.push(`แท็บงบ แถว ${b.row}: "${sheetProjectName(b)}" ลงโปรเจกต์เดียวกับแถว ${cur.rows[0]} — รวมงบเข้าด้วยกัน`);
      continue;
    }
    budgetByTarget.set(target, {
      target, rows: [b.row], projectKey: p.key, sheetName: p.sheetName, amount: b.amount, note: b.note,
      action: "blank", budgetId: null, current: null, otherPeriods: [],
    });
  }
  const budgets: BudgetPlan[] = [];
  for (const bp of Array.from(budgetByTarget.values())) {
    const p = projects.get(bp.projectKey)!;
    if (p.resolution === "ambiguous") bp.action = "unresolved";
    else if (bp.amount === null) bp.action = "blank";
    else if (!p.projectId) bp.action = "create";
    else {
      const mine = input.existingBudgets.filter((x) => x.projectId === p.projectId);
      const atM = mine.find((x) => x.period === M);
      bp.otherPeriods = mine.filter((x) => x.period !== M && x.approvedAmount > 0).map((x) => x.period).sort();
      if (atM) {
        bp.budgetId = atM.id;
        bp.current = round2(atM.approvedAmount);
        const same = round2(atM.approvedAmount) === bp.amount && (atM.note ?? "") === bp.note;
        bp.action = same ? "same" : input.update ? "update" : "keep";
      } else if (bp.otherPeriods.length) {
        bp.action = "conflict";
        warnings.push(`"${p.sheetName}" มีงบใน MarsOS อยู่แล้วที่เดือน ${bp.otherPeriods.join(", ")} — ไม่ตั้งงบเดือน ${M} ซ้ำ (เปลี่ยน "เดือนของงบ" ให้ตรง หรือแก้งบเองในแท็บงบประมาณ)`);
      } else bp.action = "create";
    }
    const { target: _t, ...rest } = bp;
    void _t;
    budgets.push(rest);
  }
  const overwrite = budgets.filter((b) => b.action === "update");
  if (overwrite.length) {
    warnings.push(`งบเดือน ${M} ใน MarsOS จะถูกแก้ตามชีท ${overwrite.length} โปรเจกต์: ${nameList(overwrite.map((b) => `${b.sheetName} ${b.current ?? 0} → ${b.amount ?? 0}`))}`);
  }
  const multiMonth = budgets.filter((b) => b.budgetId && b.otherPeriods.length);
  if (multiMonth.length) {
    warnings.push(`โปรเจกต์ที่มีงบเดือนอื่นอยู่ด้วย (มุมมอง "ทุกเดือน" จะรวมทุกเดือนเข้าด้วยกัน): ${nameList(multiMonth.map((b) => `${b.sheetName} (${b.otherPeriods.join(", ")})`))}`);
  }

  // ───── ค่าใช้จ่าย ─────
  const importByKey = new Map(input.importRows.map((r) => [r.rowKey, r]));
  const reqById = new Map(input.requests.map((r) => [r.id, r]));
  const linkedIds = new Set(input.importRows.map((r) => r.requestId));
  const claimed = new Set<string>();
  const expenses: ExpensePlan[] = [];

  // ───── rowKey ของแต่ละแถว ─────
  // แถวที่ key ฐานเดียวกัน (เช่น URL เดียวกันในสองโปรเจกต์) ต่างกันแค่เลขลำดับท้าย key ถ้านับตามตำแหน่งอย่างเดียว
  // พอแถวบนถูกแก้หรือลบ แถวล่างจะเลื่อนขึ้นไปทับคำขอของแถวบน จึงจับคู่กับแถวจำเดิมจากเนื้อหาก่อน แล้วค่อยตามลำดับ
  const keyBaseOf = (e: SheetExpenseRow, p: ProjectPlan) =>
    capKey(e.url ? `u|${urlKey(e.url)}` : e.site ? `s|${p.key}|${normName(e.site)}` : `n|${p.key}|${normName(e.type)}`);
  const rememberedByBase = new Map<string, { occ: number; row: ExistingImportRow }[]>();
  for (const r of input.importRows) {
    const cut = r.rowKey.lastIndexOf("#");
    const occ = cut > 0 ? Number(r.rowKey.slice(cut + 1)) : NaN;
    if (!Number.isInteger(occ) || occ < 0) continue;
    const keyBase = r.rowKey.slice(0, cut);
    const list = rememberedByBase.get(keyBase);
    if (list) list.push({ occ, row: r }); else rememberedByBase.set(keyBase, [{ occ, row: r }]);
  }
  interface KeyCandidate { e: SheetExpenseRow; projectId: string | null; cost: number; date: string | null }
  const keyGroups = new Map<string, KeyCandidate[]>();
  for (const e of input.expenses) {
    if (expenseStatusKind(e.status) !== "published") continue;
    const p = planOf(sheetProjectName(e));
    if (!p || p.resolution === "ambiguous") continue;
    const keyBase = keyBaseOf(e, p);
    const cand: KeyCandidate = { e, projectId: p.projectId, cost: round2(e.cost ?? 0), date: e.date };
    const list = keyGroups.get(keyBase);
    if (list) list.push(cand); else keyGroups.set(keyBase, [cand]);
  }
  const keyOf = new Map<SheetExpenseRow, string>();
  keyGroups.forEach((rows, keyBase) => {
    const remembered = (rememberedByBase.get(keyBase) ?? []).slice().sort((a, b) => a.occ - b.occ);
    const used = new Set<number>();
    let pending = rows;
    const take = (match: (row: KeyCandidate, req: ExistingRequest | null) => boolean) => {
      const rest: KeyCandidate[] = [];
      for (const row of pending) {
        const hit = remembered.find((m) => !used.has(m.occ) && match(row, reqById.get(m.row.requestId) ?? null));
        if (hit) { used.add(hit.occ); keyOf.set(row.e, hit.row.rowKey); } else rest.push(row);
      }
      pending = rest;
    };
    // 1) โปรเจกต์ ราคา วันที่ตรงกับคำขอของแถวจำ  2) โปรเจกต์ตรง  3) ที่เหลือตามลำดับ
    take((row, req) => !!req && !!row.projectId && req.projectId === row.projectId && costOf(req) === row.cost && (req.publishedAt ?? null) === row.date);
    take((row, req) => !!req && !!row.projectId && req.projectId === row.projectId);
    take(() => true);
    // แถวที่ไม่มีแถวจำให้จับ: ใช้เลขที่ยังไม่มีแถวจำไหนใช้ (แถวจำที่ไม่ถูกจับยังอยู่ในฐานข้อมูล ห้ามชน)
    const taken = new Set(remembered.map((m) => m.occ));
    let next = 0;
    for (const row of pending) {
      while (taken.has(next)) next++;
      taken.add(next);
      keyOf.set(row.e, `${keyBase}#${next}`);
    }
  });

  const skipped: Partial<Record<SkipReason, number>> = {};
  let publishedRows = 0;
  let publishedTotal = 0;
  let importTotal = 0;

  for (const e of input.expenses) {
    const name = sheetProjectName(e);
    const base: ExpensePlan = {
      row: e.row, rowKey: "", projectKey: normName(name), sheetName: cleanProjectName(name), action: "skip", skipReason: "",
      requestId: null, hasImportRow: false, linked: false, rekeyFrom: null, retag: false, resetMark: false,
      data: null, changes: [], warnings: [],
    };
    const skip = (reason: SkipReason) => {
      base.skipReason = reason;
      skipped[reason] = (skipped[reason] ?? 0) + 1;
      expenses.push(base);
    };
    const kind = expenseStatusKind(e.status);
    if (kind !== "published") {
      if (kind === "planned") skip("planned");
      else if (kind === "cancelled") skip("cancelled");
      else if (kind === "other") { base.warnings.push(`ไม่รู้จัก Status "${e.status}"`); skip("other_status"); }
      else if (e.cost === null && !e.site) skip("placeholder");
      else skip("blank_status");
      continue;
    }
    publishedRows++;
    publishedTotal = round2(publishedTotal + (e.cost ?? 0));
    const p = planOf(name);
    if (!p) { skip("no_project"); continue; }
    if (p.resolution === "ambiguous") { skip("unresolved"); continue; }

    if (e.cost === null) base.warnings.push(e.costRaw ? `อ่านราคา "${e.costRaw}" ไม่ได้ — นำเข้าเป็น 0` : "ไม่มีราคา — นำเข้าเป็น 0");
    if (!e.date) base.warnings.push(e.dateRaw ? `อ่านวันที่ "${e.dateRaw}" ไม่ได้ — ตัดงบเดือน ${M}` : `ไม่มีวันที่ — ตัดงบเดือน ${M}`);
    if (!e.url && e.site) base.warnings.push("ช่อง Website / Media ไม่ใช่ URL — เก็บข้อความไว้ในหมายเหตุ");
    if (!e.url && !e.site) base.warnings.push("ไม่มี URL — ตรวจลิงก์อัตโนมัติไม่ได้");

    base.rowKey = keyOf.get(e) ?? `${keyBaseOf(e, p)}#0`;

    const siteDomain = e.url ? normalizeDomain(e.url) : looksLikeDomain(normalizeDomain(e.site)) ? normalizeDomain(e.site) : "";
    const data: ExpenseData = {
      liveUrl: e.url, vendorDomain: siteDomain.slice(0, 200), anchorText: e.anchor, cost: e.cost ?? 0,
      publishedAt: e.date, budgetPeriod: isValidPeriod(expenseBudgetPeriod(e.date, M)) ? expenseBudgetPeriod(e.date, M) : M,
      type: e.type, note: e.note, site: e.url ? "" : e.site,
    };
    base.data = data;
    const target = targetOf(p);

    const remembered = importByKey.get(base.rowKey);
    let existing = remembered ? reqById.get(remembered.requestId) ?? null : null;
    base.hasImportRow = !!remembered;
    base.retag = !!remembered && !!input.spreadsheetId && (remembered.spreadsheetId ?? "") !== input.spreadsheetId;
    // คำขอของแถวจำถูกลบใน MarsOS ไปแล้ว: ตัวนำเข้ายกเลิกเอง (แถวเคยหายจากชีท) = สร้างกลับได้, นอกนั้นคือคนตั้งใจลบ
    const orphan = !!remembered && !existing;
    const recreate = orphan && remembered!.lastStatus === "CANCELLED";
    let linking = false;
    if ((!remembered || (orphan && !recreate)) && e.url && p.projectId) {
      const k = urlKey(e.url);
      const hit = input.requests.find((r) => r.projectId === p.projectId && !linkedIds.has(r.id) && !claimed.has(r.id)
        && ACTIVE_FOR_LINK.includes(r.status) && r.liveUrl && urlKey(r.liveUrl) === k);
      if (hit) { existing = hit; linking = true; }
    }

    if (!existing) {
      if (orphan && !recreate) {
        base.warnings.push("รายการนี้ถูกลบใน MarsOS — ไม่สร้างใหม่ให้เอง (ต้องการกลับมา ให้สร้างคำขอใน MarsOS ด้วย URL เดียวกันแล้วนำเข้าอีกครั้ง)");
        skip("deleted_in_app");
        continue;
      }
      base.action = "create";
      importTotal = round2(importTotal + data.cost);
      expenses.push(base);
      continue;
    }
    claimed.add(existing.id);
    base.requestId = existing.id;
    base.linked = linking;

    if (DEAD.includes(existing.status)) {
      if (remembered?.lastStatus === "CANCELLED" && existing.status === "CANCELLED") {
        base.action = "revive";
        importTotal = round2(importTotal + data.cost);
        expenses.push(base);
      } else {
        base.warnings.push("รายการนี้ถูกยกเลิก/ไม่อนุมัติใน MarsOS — ไม่เปิดกลับให้เอง");
        skip("cancelled_in_app");
      }
      continue;
    }
    // คำขอยังใช้อยู่ แต่แถวจำบอกว่าตัวนำเข้ายกเลิก = มีคนเปิดกลับเอง ล้างเครื่องหมายไว้ ไม่งั้นถ้าคนยกเลิกเองอีกรอบ ตัวนำเข้าจะเปิดกลับผิด
    base.resetMark = !linking && remembered?.lastStatus === "CANCELLED";

    const changes = diffRequest(existing, data, target);
    base.changes = changes;
    if (!changes.length) base.action = linking ? "link" : "same";
    else if (input.update) base.action = "update";
    else base.action = linking ? "link" : "keep";
    if (linking && base.action === "update") base.changes = ["จับคู่กับรายการที่มีอยู่", ...changes];
    importTotal = round2(importTotal + (base.action === "update" ? data.cost : costOf(existing)));
    expenses.push(base);
  }

  // ───── รายการที่เคยนำเข้าแต่ไม่อยู่ในชีทแล้ว ─────
  const keysNow = new Set(expenses.filter((x) => x.rowKey).map((x) => x.rowKey));
  const canCancel = input.cancelMissing && publishedRows > 0 && !input.noCancelReason;
  if (input.cancelMissing && publishedRows === 0) warnings.push("ไม่พบแถว Published ในชีทเลย — ไม่ยกเลิกรายการเดิมให้ (กันชีทว่างแล้วล้างข้อมูล)");
  if (input.cancelMissing && input.noCancelReason) warnings.push(input.noCancelReason);
  let missing: MissingPlan[] = [];
  let otherSheetRows = 0;
  for (const r of input.importRows) {
    if (keysNow.has(r.rowKey)) continue;
    const req = reqById.get(r.requestId);
    if (!req || DEAD.includes(req.status)) continue;
    // แถวจำของชีทอื่น: ไม่ใช่ "หายจากชีทนี้" — ไม่รายงานและไม่ยกเลิก
    if (input.spreadsheetId && r.spreadsheetId && r.spreadsheetId !== input.spreadsheetId) { otherSheetRows++; continue; }
    const manual = r.lastStatus === "";
    missing.push({
      rowKey: r.rowKey, requestId: req.id, status: req.status, liveUrl: req.liveUrl,
      cost: costOf(req), projectId: req.projectId, manual, action: canCancel && !manual ? "cancel" : "report",
    });
  }

  // ───── แถวที่ถูกแก้ในชีทจน rowKey เปลี่ยน (แก้ URL / ชื่อเว็บ / ประเภท) ─────
  // ถ้าปล่อยไว้จะกลายเป็น "สร้างใหม่ 1 + หายจากชีท 1" = ยอดซ้ำ จึงจับคู่แถวใหม่กับรายการเดิมที่โปรเจกต์ ราคา และวันที่ตรงกัน
  if (missing.length) {
    const sig = (target: string, cost: number, date: string | null) => `${target}|${round2(cost)}|${date ?? ""}`;
    const pool = new Map<string, MissingPlan[]>();
    for (const m of missing.slice().sort((a, b) => (a.rowKey < b.rowKey ? -1 : a.rowKey > b.rowKey ? 1 : 0))) {
      const req = reqById.get(m.requestId)!;
      const k = sig(`id:${req.projectId}`, m.cost, req.publishedAt);
      const list = pool.get(k);
      if (list) list.push(m); else pool.set(k, [m]);
    }
    const fresh: { plan: ExpensePlan; key: string }[] = [];
    for (const x of expenses) {
      if (x.action !== "create" || x.hasImportRow || !x.data) continue;
      const p = projects.get(x.projectKey);
      if (!p?.projectId) continue;
      const k = sig(`id:${p.projectId}`, x.data.cost, x.data.publishedAt);
      if (pool.has(k)) fresh.push({ plan: x, key: k });
    }
    const paired = new Set<string>();
    const pair = (x: ExpensePlan, m: MissingPlan) => {
      const req = reqById.get(m.requestId)!;
      const data = x.data!;
      paired.add(m.rowKey);
      x.requestId = req.id;
      x.rekeyFrom = m.rowKey;
      x.resetMark = importByKey.get(m.rowKey)?.lastStatus === "CANCELLED";
      const changes = diffRequest(req, data, `id:${req.projectId}`);
      x.changes = changes;
      x.action = !changes.length ? "same" : input.update ? "update" : "keep";
      x.warnings.push("แถวนี้ถูกแก้ในชีท — จับคู่กับรายการเดิมแทนการสร้างใหม่");
    };
    // รอบ 1: มีสิ่งยืนยันว่าเป็นแถวเดียวกัน (Anchor เดิม หรือโดเมนเดิม) รอบ 2: ที่เหลือตามลำดับ
    for (const round of [1, 2]) {
      for (const f of fresh) {
        if (f.plan.rekeyFrom) continue;
        const list = (pool.get(f.key) ?? []).filter((m) => !paired.has(m.rowKey));
        if (!list.length) continue;
        const data = f.plan.data!;
        const hit = round === 2 ? list[0] : list.find((m) => {
          const req = reqById.get(m.requestId)!;
          return (!!data.anchorText && req.anchorText === data.anchorText)
            || (!!data.vendorDomain && !!req.liveUrl && normalizeDomain(req.liveUrl) === data.vendorDomain);
        });
        if (hit) pair(f.plan, hit);
      }
    }
    if (paired.size) missing = missing.filter((m) => !paired.has(m.rowKey));
  }
  if (input.cancelMissing) {
    const manualMissing = missing.filter((m) => m.manual).length;
    if (manualMissing) warnings.push(`${manualMissing} รายการที่ไม่อยู่ในชีทเป็นคำขอที่สร้างเองใน MarsOS แล้วถูกจับคู่ไว้ — ไม่ยกเลิกให้ ถ้าต้องการยกเลิกให้ทำเองในหน้าคำขอ`);
  }

  // ───── คำเตือนเรื่องชื่อโปรเจกต์ ─────
  const projectList = Array.from(projects.values()).sort((a, b) => a.sheetName.localeCompare(b.sheetName, "th"));
  for (const p of projectList) {
    if (p.resolution === "ambiguous") blockers.push(`"${p.sheetName}" ตรงกับหลายโปรเจกต์ใน MarsOS — เลือกโปรเจกต์ก่อน`);
    if (!p.inBudget && p.expenseRows > 0 && p.resolution === "new") {
      warnings.push(`"${p.sheetName}" มีใน Expense Log ${p.expenseRows} แถว แต่ไม่มีในแท็บงบ — ถ้าเป็นโปรเจกต์เดียวกับชื่ออื่น ให้เลือกจับคู่ก่อนนำเข้า ไม่อย่างนั้นจะสร้างโปรเจกต์ใหม่`);
    }
  }
  const newTargets = new Set(projectList.filter((p) => !p.projectId && p.resolution !== "ambiguous").map((p) => p.targetKey));

  const count = (a: ExpenseAction) => expenses.filter((x) => x.action === a).length;
  const bcount = (a: BudgetAction) => budgets.filter((x) => x.action === a).length;
  const summary: ImportSummary = {
    projectsNew: newTargets.size,
    budgetsCreate: bcount("create"), budgetsUpdate: bcount("update"), budgetsSame: bcount("same") + bcount("keep"),
    budgetsConflict: bcount("conflict"), budgetsBlank: bcount("blank"),
    expensesCreate: count("create"), expensesUpdate: count("update"), expensesSame: count("same"), expensesKeep: count("keep"),
    expensesLink: count("link"), expensesRevive: count("revive"),
    expensesRekey: expenses.filter((x) => x.rekeyFrom).length,
    rowFixes: expenses.filter((x) => x.rekeyFrom || x.retag || x.resetMark).length,
    skipped,
    missing: missing.length, missingCancel: missing.filter((m) => m.action === "cancel").length,
    otherSheetRows,
    budgetTotal: round2(input.budgets.reduce((a, b) => a + (b.amount ?? 0), 0)),
    publishedRows, publishedTotal, importTotal,
  };
  return { budgetPeriod: M, projects: projectList, budgets, expenses, missing, summary, warnings, blockers };
}

/** เดือนของงบที่เสนอ: เดือนแรกสุดที่มีค่าใช้จ่าย Published ในชีท ไม่มีเลย = fallback */
export function suggestBudgetPeriod(expenses: SheetExpenseRow[], fallback: string): string {
  let first = "";
  for (const e of expenses) {
    if (!e.date || expenseStatusKind(e.status) !== "published") continue;
    const p = e.date.slice(0, 7);
    if (!first || p < first) first = p;
  }
  return isValidPeriod(first) ? first : fallback;
}

/** ทำความสะอาด projectMap ที่มาจาก client: เก็บเฉพาะ key/ค่าที่เป็นข้อความสั้น ๆ */
export function sanitizeProjectMap(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  let n = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= 500) break;
    if (typeof v !== "string" || !k || k.length > 200 || !v || v.length > 200) continue;
    out[k] = v;
    n++;
  }
  return out;
}
