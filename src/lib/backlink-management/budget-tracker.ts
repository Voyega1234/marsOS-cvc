/**
 * สรุปงบจาก Google Sheet "Backlink Budget Tracker" แบบเดียวกับแท็บ Dashboard ของชีท (ไฟล์บริสุทธิ์ ไม่เรียก Google)
 * - Initial Budget มาจากแท็บ Project Budget
 * - Used Budget = ผลรวม Cost ในแท็บ Expense Log เฉพาะแถว Status = Published (ตามที่ชีทเขียนไว้)
 * - Remaining = Initial − Used (โปรเจกต์ที่ไม่มี Initial Budget ไม่มีคงเหลือ แต่ยอดใช้ยังนับในยอดรวม)
 * - แถว Planned ไม่หักงบ แต่แสดงแยกให้เห็นว่ามีอะไรรออยู่
 */
import { round2 } from "./budget";
import { MAP_ALIAS_PREFIX, expenseStatusKind, normName, parseBudgetTab, parseExpenseTab, type Grid } from "./sheet-import";
import { vendorRank, type VendorRank } from "./vendor-rank";

/** ชีทที่ทีมใช้จริง (เจ้าของระบุ 2026-11-16) — ต้องแชร์ให้ service account อ่านได้ */
export const BUDGET_TRACKER_SHEET_ID = "1VHekvZIxLZb5da_22IZeejDxtu0gJyya6G38GWEqvRM";
/** จำนวนรายการสูงสุดที่ส่งให้หน้าเว็บ */
export const MAX_TRACKER_ITEMS = 3000;
/** ลูกค้า Active = มีลิงก์ (Published/Planned) ภายในกี่วันล่าสุด — หรือยังมีงบเหลือ / มีลิงก์รอ */
export const ACTIVE_WINDOW_DAYS = 90;
/** ใช้งบเกินกี่ % ถือว่าใกล้หมด */
export const NEAR_LIMIT_PCT = 80;

export interface TrackerTypeCount { type: string; links: number; cost: number }
/** ลิงก์ Published แยกตามระดับราคา (General 0–7,999 / High Authority 8,000+ ตาม vendor-rank.ts) */
export interface TrackerRankCount { links: number; cost: number }
/** over = ใช้เกินงบ, near = ใช้เกิน NEAR_LIMIT_PCT%, ok = ปกติ, nobudget = ชีทยังไม่กรอก Initial Budget */
export type TrackerHealth = "over" | "near" | "ok" | "nobudget";

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
  general: TrackerRankCount;
  highAuthority: TrackerRankCount;
  /** วันที่ล่าสุดของรายการ Published/Planned (YYYY-MM-DD) */
  lastDate: string | null;
  active: boolean;
  health: TrackerHealth;
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
  /** ระดับตามราคาของแถวนี้ (null = ไม่มีราคา) */
  rank: VendorRank | null;
}

export interface TrackerTotals {
  initial: number; used: number; remaining: number; usedPct: number | null;
  links: number; plannedLinks: number; plannedCost: number; byType: TrackerTypeCount[];
  general: TrackerRankCount; highAuthority: TrackerRankCount;
  /** จำนวนโปรเจกต์ที่ Active / เกินงบ */
  active: number; over: number;
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

/**
 * ระดับของลิงก์: ถ้าคอลัมน์ Type ในชีทเขียนไว้ชัด (General / High / High Authority) ใช้ตามชีท
 * ไม่งั้นจัดตามราคาแบบเดียวกับคลังเว็บ (General 0–7,999 / High Authority 8,000+)
 */
export function trackerRank(type: string, cost: number | null): VendorRank | null {
  const t = type.trim().toLowerCase();
  if (/high|authority|^ha$/.test(t)) return "HIGH_AUTHORITY";
  if (/general|^gen$/.test(t)) return "GENERAL";
  return vendorRank(cost);
}

const addRank = (c: TrackerRankCount, cost: number) => { c.links++; c.cost = round2(c.cost + cost); };

function healthOf(r: TrackerRow): TrackerHealth {
  if (r.initial === null || r.initial <= 0) return "nobudget";
  if (r.used > r.initial) return "over";
  return (r.used / r.initial) * 100 > NEAR_LIMIT_PCT ? "near" : "ok";
}

function daysBefore(today: Date, days: number): string {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export function summarizeTracker(budgetGrid: Grid, expenseGrid: Grid, today: Date = new Date()): TrackerSummary {
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
    const r: TrackerRow = {
      key, client, project: project || client, initial, used: 0, remaining: null, usedPct: null, links: 0, plannedLinks: 0, plannedCost: 0, byType: [], note,
      general: { links: 0, cost: 0 }, highAuthority: { links: 0, cost: 0 }, lastDate: null, active: false, health: "nobudget",
    };
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
  const allGeneral: TrackerRankCount = { links: 0, cost: 0 };
  const allHigh: TrackerRankCount = { links: 0, cost: 0 };
  let badCost = 0;
  for (const e of expense.rows) {
    const kind = expenseStatusKind(e.status);
    if (kind !== "published" && kind !== "planned") continue;
    const k = trackerKey(e.client, e.project);
    if (!k) continue;
    const r = byKey.get(k) ?? newRow(k, e.client, e.project, null, "");
    const rank = trackerRank(e.type, e.cost);
    if (e.date && (!r.lastDate || e.date > r.lastDate)) r.lastDate = e.date;
    if (kind === "published") {
      if (e.cost === null) { if (e.costRaw) badCost++; }
      else {
        r.used = round2(r.used + e.cost);
        r.links++;
        addType(typeMaps.get(k)!, e.type, e.cost);
        addType(allTypes, e.type, e.cost);
        if (rank === "HIGH_AUTHORITY") { addRank(r.highAuthority, e.cost); addRank(allHigh, e.cost); }
        else if (rank === "GENERAL") { addRank(r.general, e.cost); addRank(allGeneral, e.cost); }
      }
    } else {
      r.plannedLinks++;
      if (e.cost !== null) r.plannedCost = round2(r.plannedCost + e.cost);
    }
    if (items.length < MAX_TRACKER_ITEMS) {
      items.push({
        key: k, row: e.row, date: e.date, dateRaw: e.dateRaw, client: e.client, project: e.project || e.client,
        site: e.site, url: e.url, type: e.type, cost: e.cost, anchor: e.anchor, status: kind, note: e.note, rank,
      });
    }
  }
  if (badCost) warnings.push(`มี ${badCost} แถว Published ที่อ่านค่า Cost ไม่ได้ จึงไม่นับในยอดใช้`);
  if (items.length >= MAX_TRACKER_ITEMS) warnings.push(`แสดงรายการได้สูงสุด ${MAX_TRACKER_ITEMS.toLocaleString("en-US")} แถว (ยอดรวมยังนับครบ)`);

  let initial = 0, used = 0, links = 0, plannedLinks = 0, plannedCost = 0, active = 0, over = 0;
  const activeSince = daysBefore(today, ACTIVE_WINDOW_DAYS);
  for (const r of rows) {
    if (r.initial !== null) {
      r.remaining = round2(r.initial - r.used);
      r.usedPct = r.initial > 0 ? pct(r.used, r.initial) : null;
      initial += r.initial;
    }
    r.byType = sortTypes(typeMaps.get(r.key)!);
    r.health = healthOf(r);
    r.active = (r.remaining !== null && r.remaining > 0) || r.plannedLinks > 0 || (r.lastDate !== null && r.lastDate >= activeSince);
    if (r.active) active++;
    if (r.health === "over") over++;
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
      general: allGeneral, highAuthority: allHigh, active, over,
    },
    warnings,
  };
}

// ───────────────────────── จับคู่โปรเจกต์ในชีทกับโปรเจกต์ใน MarsOS ─────────────────────────

export interface TrackerProjectRef { id: string; name: string; clientName: string }
export interface TrackerLink {
  /** โปรเจกต์ใน MarsOS ที่ชื่อนี้ในชีทชี้ไป (null = ยังไม่มีในระบบ) */
  projectId: string | null;
  projectName: string;
  /** ตอนยังไม่มีในระบบ: โปรเจกต์ที่ชื่อใกล้เคียง (เช่น "DXT Solutions" กับ "DXT Solution") ให้เลือกจับคู่แทนการสร้างใหม่ */
  suggestions: { id: string; name: string }[];
}

function editDistance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** ชื่อใกล้กันพอจะเสนอให้จับคู่: ชื่อหนึ่งขึ้นต้นด้วยอีกชื่อ (ยาว ≥ 3) หรือต่างกันไม่กี่ตัวอักษร */
export function similarNames(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 3 && long.startsWith(short)) return true;
  const cap = Math.max(1, Math.floor(long.length / 6));
  return long.length >= 4 && editDistance(a, b, cap) <= cap;
}

/**
 * แต่ละแถวในชีท (key = normName ของชื่อ) ตรงกับโปรเจกต์ไหนใน MarsOS
 * ลำดับเดียวกับตัวนำเข้าชีท: projectMap ที่จำไว้ → ชื่อตรงกันพอดี → ชื่อลูกค้าตรงกันพอดี (ต้องเจอแค่หนึ่ง)
 */
export function linkTrackerProjects(rows: { key: string }[], projects: TrackerProjectRef[], projectMap: Record<string, string>): Record<string, TrackerLink> {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const keyed = projects.map((p) => ({ p, name: normName(p.name), client: p.clientName ? normName(p.clientName) : "" }));
  const out: Record<string, TrackerLink> = {};
  for (const { key } of rows) {
    let mapped = projectMap[key];
    if (typeof mapped === "string" && mapped.startsWith(MAP_ALIAS_PREFIX)) mapped = projectMap[mapped.slice(MAP_ALIAS_PREFIX.length)];
    const hit = typeof mapped === "string" ? byId.get(mapped) : undefined;
    if (hit) { out[key] = { projectId: hit.id, projectName: hit.name, suggestions: [] }; continue; }
    const byName = keyed.filter((x) => x.name === key);
    const byClient = keyed.filter((x) => x.client === key && x.name !== key);
    const one = byName.length === 1 ? byName[0] : byName.length === 0 && byClient.length === 1 ? byClient[0] : null;
    if (one) { out[key] = { projectId: one.p.id, projectName: one.p.name, suggestions: [] }; continue; }
    const exact = [...byName, ...byClient];
    const near = exact.length ? exact : keyed.filter((x) => similarNames(x.name, key) || (x.client !== "" && similarNames(x.client, key)));
    out[key] = { projectId: null, projectName: "", suggestions: near.slice(0, 5).map((x) => ({ id: x.p.id, name: x.p.name })) };
  }
  return out;
}

export interface TrackerSyncPlan {
  /** key ในชีท → id โปรเจกต์ที่มีอยู่แล้ว (จับคู่จากชื่อคล้าย) ที่ควรจำไว้ใน projectMap */
  link: Record<string, string>;
  /** โปรเจกต์ในชีทที่ยังไม่มีในระบบ → สร้างใหม่ */
  create: { key: string; name: string; clientName: string }[];
}

/**
 * ชีท Backlink Budget Tracker = รายชื่อโปรเจกต์ล่าสุดของทีม (เจ้าของสั่ง 2026-11-16) — ทุกโปรเจกต์ในชีทต้องมีในระบบ
 * จับคู่ได้อยู่แล้ว = ไม่ทำอะไร · ชื่อตรงกันหลายตัว = ใช้ตัวแรก · ชื่อคล้ายตัวเดียว = จับคู่ · นอกนั้นสร้างใหม่
 */
export function planTrackerSync(
  rows: { key: string; project: string; client: string }[],
  projects: TrackerProjectRef[],
  projectMap: Record<string, string>,
): TrackerSyncPlan {
  const links = linkTrackerProjects(rows, projects, projectMap);
  const plan: TrackerSyncPlan = { link: {}, create: [] };
  const seen = new Set<string>();
  for (const r of rows) {
    const l = links[r.key];
    if (!l || l.projectId || seen.has(r.key)) continue;
    seen.add(r.key);
    const exact = l.suggestions.find((s) => normName(s.name) === r.key);
    const pick = exact ?? (l.suggestions.length === 1 ? l.suggestions[0] : null);
    if (pick) { plan.link[r.key] = pick.id; continue; }
    const name = (r.project || r.client).trim().replace(/\s+/g, " ").slice(0, 120);
    if (!name) continue;
    const client = r.client.trim().replace(/\s+/g, " ").slice(0, 200);
    plan.create.push({ key: r.key, name, clientName: normName(client) === normName(name) ? "" : client });
  }
  return plan;
}
