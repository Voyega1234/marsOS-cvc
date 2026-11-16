/** ตารางข้อมูล Backlink Management สำหรับ Google Sheet / Excel (ไฟล์บริสุทธิ์ ไม่แตะ prisma / googleapis) */
import { summarizeBudget } from "./budget";
import { CHECK_LABEL, statusLabel, type CheckStatus } from "./types";

export interface SheetTable { title: string; header: string[]; rows: (string | number)[][] }

export const SHEET_TITLES = {
  requests: "MarsOS คำขอ Backlink",
  vendors: "MarsOS คลังเว็บ",
  budgets: "MarsOS งบประมาณ",
} as const;

const MAX_CELL = 5000;

/** ดึง spreadsheetId จากลิงก์ docs.google.com หรือ id เปล่า — ไม่ถูกต้องคืน "" */
export function parseSpreadsheetId(input: unknown): string {
  if (typeof input !== "string") return "";
  const v = input.trim();
  if (!v) return "";
  if (/^[A-Za-z0-9_-]{25,}$/.test(v)) return v;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" || u.hostname !== "docs.google.com") return "";
    const m = u.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:\/|$)/);
    return m && m[1].length >= 10 ? m[1] : "";
  } catch {
    return "";
  }
}

export interface SheetRequestInput {
  id: string;
  createdAt: Date;
  projectName: string;
  clientName: string;
  budgetPeriod: string;
  status: string;
  vendorDomain: string;
  targetUrl: string;
  anchorText: string;
  keyword: string;
  linkType: string;
  quotedPrice: number | null;
  actualPrice: number | null;
  requestedByName: string;
  assigneeName: string;
  dueDate: Date | null;
  liveUrl: string;
  publishedAt: Date | null;
  checkStatus: string;
  lastCheckedAt: Date | null;
  foundRel: string;
  rejectReason: string;
  notes: string;
  asanaTaskUrl: string;
  updatedAt: Date;
  projectId?: string;
}

export interface SheetVendorInput {
  domain: string;
  siteUrl: string;
  category: string;
  price: number | null;
  currency: string;
  domainRating: number | null;
  traffic: number | null;
  linkType: string;
  contactName: string;
  contactChannel: string;
  notes: string;
  status: string;
  updatedAt: Date;
  // ข้อมูลเสริม (BlmVendorDetail) — ไม่ส่งมา = ช่องว่าง
  language?: string;
  urlRating?: number | null;
  priceBacklink?: number | null;
  pricePublisherWeb?: number | null;
  pricePublisherWebFb?: number | null;
  priceCvcWeb?: number | null;
  priceCvcWebFb?: number | null;
  pricePr?: number | null;
  priceNote?: string;
  expiration?: string;
  rateCardUrl?: string;
  dataStatus?: string;
  refId?: string;
}

export interface SheetBudgetInput {
  projectId: string;
  projectName: string;
  clientName: string;
  period: string;
  approvedAmount: number;
  note: string;
}

export interface SheetTablesInput {
  requests: (SheetRequestInput & { projectId: string })[];
  vendors: SheetVendorInput[];
  budgets: SheetBudgetInput[];
}

function cut(s: string): string {
  return s.length > MAX_CELL ? s.slice(0, MAX_CELL) : s;
}
function str(v: string | null | undefined): string {
  return cut(typeof v === "string" ? v : "");
}
function num(v: number | null | undefined): number | string {
  return typeof v === "number" && Number.isFinite(v) ? v : "";
}
/** YYYY-MM-DD HH:mm ตามเวลา Asia/Bangkok */
function dt(d: Date | null | undefined): string {
  if (!d || Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")} ${g("hour")}:${g("minute")}`;
}
/** วันที่ล้วน (เก็บเป็น UTC เที่ยงวัน) */
function dOnly(d: Date | null | undefined): string {
  return d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : "";
}
function time(d: Date | null | undefined): number {
  return d && !Number.isNaN(d.getTime()) ? d.getTime() : 0;
}

export function buildSheetTables(input: SheetTablesInput): [SheetTable, SheetTable, SheetTable] {
  // คำขอ
  const reqHeader = [
    "รหัส", "วันที่สร้าง", "โปรเจกต์", "ลูกค้า", "เดือนงบ", "สถานะ", "เว็บที่ลง", "URL หน้าลูกค้า", "Anchor text", "Keyword",
    "ประเภทลิงก์", "ราคาที่ขอ", "ราคาจ่ายจริง", "ผู้ขอ", "ผู้รับผิดชอบ", "กำหนดส่ง", "URL ที่ลิงก์อยู่", "วันที่เผยแพร่",
    "ผลตรวจลิงก์", "ตรวจล่าสุด", "rel ที่พบ", "เหตุผลที่ไม่อนุมัติ", "หมายเหตุ", "Asana", "อัปเดตล่าสุด",
  ];
  const reqs = [...input.requests].sort((a, b) => time(b.createdAt) - time(a.createdAt));
  const reqRows = reqs.map((r) => [
    str(r.id), dt(r.createdAt), str(r.projectName), str(r.clientName), str(r.budgetPeriod), str(statusLabel(r.status)),
    str(r.vendorDomain), str(r.targetUrl), str(r.anchorText), str(r.keyword), str(r.linkType),
    num(r.quotedPrice), num(r.actualPrice), str(r.requestedByName), str(r.assigneeName), dOnly(r.dueDate),
    str(r.liveUrl), dt(r.publishedAt), r.checkStatus ? str(CHECK_LABEL[r.checkStatus as CheckStatus] ?? r.checkStatus) : "",
    dt(r.lastCheckedAt), str(r.foundRel), str(r.rejectReason), str(r.notes), str(r.asanaTaskUrl), dt(r.updatedAt),
  ]);

  // คลังเว็บ
  const venHeader = [
    "โดเมน", "URL", "หมวด", "ราคา", "สกุลเงิน", "DR", "Traffic", "ประเภทลิงก์", "ผู้ติดต่อ", "ช่องทางติดต่อ", "หมายเหตุ", "สถานะ", "อัปเดตล่าสุด",
    // คอลัมน์เสริมต่อท้ายเสมอ (ไม่แทรกกลาง) — ชื่อหัวตรงกับที่ตัวนำเข้าไฟล์อ่านได้ ส่งออกแล้วนำเข้ากลับได้
    "ภาษา", "UR", "Only Backlink", "Publisher write WEB", "Publisher write WEB+FB", "CVC write WEB", "CVC write WEB+FB", "PR",
    "หมายเหตุราคา", "อายุลิงก์", "Rate Card", "สถานะข้อมูล", "รหัสอ้างอิง",
  ];
  const vens = [...input.vendors].sort((a, b) => a.domain.localeCompare(b.domain));
  const venRows = vens.map((v) => [
    str(v.domain), str(v.siteUrl), str(v.category), num(v.price), str(v.currency), num(v.domainRating), num(v.traffic),
    str(v.linkType), str(v.contactName), str(v.contactChannel), str(v.notes), str(v.status), dt(v.updatedAt),
    str(v.language), num(v.urlRating), num(v.priceBacklink), num(v.pricePublisherWeb), num(v.pricePublisherWebFb), num(v.priceCvcWeb),
    num(v.priceCvcWebFb), num(v.pricePr), str(v.priceNote), str(v.expiration), str(v.rateCardUrl),
    v.dataStatus === "UPDATED" ? "Updated" : v.dataStatus === "OUTDATED" ? "Outdated" : "", str(v.refId),
  ]);

  // งบประมาณ: 1 แถวต่อ (เดือน, โปรเจกต์) ที่มีแถวงบหรือมีคำขออย่างน้อย 1
  interface Group { projectId: string; period: string; projectName: string; clientName: string; approved: number; note: string; reqs: SheetRequestInput[] }
  const groups = new Map<string, Group>();
  const keyOf = (pid: string, period: string) => `${period}\u0000${pid}`;
  for (const b of input.budgets) {
    groups.set(keyOf(b.projectId, b.period), {
      projectId: b.projectId, period: b.period, projectName: b.projectName, clientName: b.clientName,
      approved: b.approvedAmount, note: b.note, reqs: [],
    });
  }
  for (const r of input.requests) {
    const k = keyOf(r.projectId, r.budgetPeriod);
    let g = groups.get(k);
    if (!g) {
      g = { projectId: r.projectId, period: r.budgetPeriod, projectName: r.projectName, clientName: r.clientName, approved: 0, note: "", reqs: [] };
      groups.set(k, g);
    }
    if (!g.projectName) g.projectName = r.projectName;
    if (!g.clientName) g.clientName = r.clientName;
    g.reqs.push(r);
  }
  const budHeader = ["เดือน", "โปรเจกต์", "ลูกค้า", "งบอนุมัติ", "รออนุมัติ", "กันงบ", "ใช้จริง", "คงเหลือ", "หมายเหตุ"];
  const gl = Array.from(groups.values()).sort((a, b) =>
    a.period < b.period ? 1 : a.period > b.period ? -1 : a.projectName.localeCompare(b.projectName, "th"));
  const budRows = gl.map((g) => {
    const s = summarizeBudget(g.approved, g.reqs.map((r) => ({ status: r.status, quotedPrice: r.quotedPrice ?? 0, actualPrice: r.actualPrice })));
    return [str(g.period), str(g.projectName), str(g.clientName), s.approved, s.pending, s.reserved, s.actual, s.remaining, str(g.note)];
  });

  return [
    { title: SHEET_TITLES.requests, header: reqHeader, rows: reqRows },
    { title: SHEET_TITLES.vendors, header: venHeader, rows: venRows },
    { title: SHEET_TITLES.budgets, header: budHeader, rows: budRows },
  ];
}
