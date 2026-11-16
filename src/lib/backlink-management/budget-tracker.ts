/**
 * สรุปงบจาก Google Sheet "Backlink Budget Tracker" แบบเดียวกับแท็บ Dashboard ของชีท (ไฟล์บริสุทธิ์ ไม่เรียก Google)
 * - Initial Budget มาจากแท็บ Project Budget
 * - Used Budget = ผลรวม Cost ในแท็บ Expense Log เฉพาะแถว Status = Published (ตามที่ชีทเขียนไว้)
 * - Remaining = Initial − Used (โปรเจกต์ที่ไม่มี Initial Budget ไม่มีคงเหลือ แต่ยอดใช้ยังนับในยอดรวม)
 * - แถว Planned ไม่หักงบ แต่แสดงแยกให้เห็นว่ามีอะไรรออยู่
 */
import { round2 } from "./budget";
import { expenseStatusKind, normName, parseBudgetTab, parseExpenseTab, type Grid } from "./sheet-import";

/** ชีทที่ทีมใช้จริง (เจ้าของระบุ 2026-11-16) — ต้องแชร์ให้ service account อ่านได้ */
export const BUDGET_TRACKER_SHEET_ID = "1VHekvZIxLZb5da_22IZeejDxtu0gJyya6G38GWEqvRM";
/** จำนวนรายการสูงสุดที่ส่งให้หน้าเว็บ */
export const MAX_TRACKER_ITEMS = 3000;

export interface TrackerTypeCount { type: string; links: number; cost: number }

export interface TrackerRow {
  /** คีย์เทียบชื่อ (ใช้จับคู่กับ items) */
  key: string;
  client: string;
  project: string;
  initial: number | null;
  used: number;
  remaining: number | null;
  /** 0–100+, null เมื่อไม่มี Initial Budget */
  usedPct: number | null;
  /** จำนวนรายการ Published */
  links: number;
  /** รายการ Planned (ยังไม่หักงบ) */
  plannedLinks: number;
  plannedCost: number;
  /** Published แยกตามคอลัมน์ Type มากไปน้อย */
  byType: TrackerTypeCount[];
  /** คอลัมน์ Note ของแท็บงบ เช่น "25 Backlink" หรือ "5 Backlinks/5 High/100 Directory" */
  note: string;
}

export interface TrackerItem {
  key: string;
  row: number;
  date: string | null;
  dateRaw: string;
  client: string;
  project: string;
  site: string;
  url: string;
  type: string;
  cost: number | null;
  anchor: string;
  status: "published" | "planned";
  note: string;
}

export interface TrackerTotals {
  initial: number; used: number; remaining: number; usedPct: number | null;
  links: number; plannedLinks: number; plannedCost: number; byType: TrackerTypeCount[];
}

export interface TrackerSummary { rows: TrackerRow[]; items: TrackerItem[]; totals: TrackerTotals; warnings: string[] }

export const trackerKey = (client: string, project: string) => normName(project || client);
const pct = (used: number, base: number) => round2((used / base) * 100);
const UNTYPED = "ไม่ระบุประเภท";

function addType(map: Map<string, TrackerTypeCount>, type: string, cost: number) {
  const t = type || UNTYPED;
  const k = t.toLowerCase();
  const cur = map.get(k);
  if (cur) { cur.links++; cur.cost = round2(cur.cost + cost); } else map.set(k, { type: t, links: 1, cost: round2(cost) });
}
const sortTypes = (m: Map<string, TrackerTypeCount>) => Array.from(m.values()).sort((a, b) => b.links - a.links || b.cost - a.cost);

export function summarizeTracker(budgetGrid: Grid, expenseGrid: Grid): TrackerSummary {
  const warnings: string[] = [];
  const budget = parseBudgetTab(budgetGrid);
  const expense = parseExpenseTab(expenseGrid);
  if (budgetGrid.length && !budget.ok) warnings.push(budget.error);
  if (expenseGrid.length && !expense.ok) warnings.push(expense.error);
  if (budget.truncated || expense.truncated) warnings.push("ชีทยาวเกินเพดาน อ่านได้ไม่ครบทุกแถว");

  const rows: TrackerRow[] = [];
  const byKey = new Map<string, TrackerRow>();
  const typeMaps = new Map<string, Map<string, TrackerTypeCount>>();
  const newRow = (key: string, client: string, project: string, initial: number | null, note: string): TrackerRow => {
    const r: TrackerRow = { key, client, project: project || client, initial, used: 0, remaining: null, usedPct: null, links: 0, plannedLinks: 0, plannedCost: 0, byType: [], note };
    byKey.set(key, r);
    typeMaps.set(key, new Map());
    rows.push(r);
    return r;
  };

  for (const b of budget.rows) {
    const k = trackerKey(b.client, b.project);
    if (!k) continue;
    const prev = byKey.get(k);
    if (prev) {
      // ชื่อซ้ำในแท็บงบ: รวมงบเข้าแถวเดียว
      if (b.amount !== null) prev.initial = round2((prev.initial ?? 0) + b.amount);
      if (b.note && !prev.note) prev.note = b.note;
      continue;
    }
    newRow(k, b.client, b.project, b.amount, b.note);
  }

  const items: TrackerItem[] = [];
  const allTypes = new Map<string, TrackerTypeCount>();
  let badCost = 0;
  for (const e of expense.rows) {
    const kind = expenseStatusKind(e.status);
    if (kind !== "published" && kind !== "planned") continue;
    const k = trackerKey(e.client, e.project);
    if (!k) continue;
    const r = byKey.get(k) ?? newRow(k, e.client, e.project, null, "");
    if (kind === "published") {
      if (e.cost === null) { if (e.costRaw) badCost++; }
      else {
        r.used = round2(r.used + e.cost);
        r.links++;
        addType(typeMaps.get(k)!, e.type, e.cost);
        addType(allTypes, e.type, e.cost);
      }
    } else {
      r.plannedLinks++;
      if (e.cost !== null) r.plannedCost = round2(r.plannedCost + e.cost);
    }
    if (items.length < MAX_TRACKER_ITEMS) {
      items.push({
        key: k, row: e.row, date: e.date, dateRaw: e.dateRaw, client: e.client, project: e.project || e.client,
        site: e.site, url: e.url, type: e.type, cost: e.cost, anchor: e.anchor, status: kind, note: e.note,
      });
    }
  }
  if (badCost) warnings.push(`มี ${badCost} แถว Published ที่อ่านค่า Cost ไม่ได้ จึงไม่นับในยอดใช้`);
  if (items.length >= MAX_TRACKER_ITEMS) warnings.push(`แสดงรายการได้สูงสุด ${MAX_TRACKER_ITEMS.toLocaleString("en-US")} แถว (ยอดรวมยังนับครบ)`);

  let initial = 0, used = 0, links = 0, plannedLinks = 0, plannedCost = 0;
  for (const r of rows) {
    if (r.initial !== null) {
      r.remaining = round2(r.initial - r.used);
      r.usedPct = r.initial > 0 ? pct(r.used, r.initial) : null;
      initial += r.initial;
    }
    r.byType = sortTypes(typeMaps.get(r.key)!);
    used += r.used;
    links += r.links;
    plannedLinks += r.plannedLinks;
    plannedCost += r.plannedCost;
  }
  // ใหม่สุดก่อน (ไม่มีวันที่ไว้ท้าย) แล้วตามลำดับแถวในชีท
  items.sort((a, b) => (a.date === b.date ? a.row - b.row : !a.date ? 1 : !b.date ? -1 : a.date < b.date ? 1 : -1));
  initial = round2(initial);
  used = round2(used);
  return {
    rows,
    items,
    totals: {
      initial, used, remaining: round2(initial - used), usedPct: initial > 0 ? pct(used, initial) : null,
      links, plannedLinks, plannedCost: round2(plannedCost), byType: sortTypes(allTypes),
    },
    warnings,
  };
}
