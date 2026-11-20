// Bulk stage update from a customer list file (Excel / CSV) that the client sends us,
// e.g. MFactors' list of customers whose survey is booked or install is done. Each row
// is matched to a lead by LINE user id, then phone, then name; anything ambiguous or
// unmatched is reported, never guessed. Preview only — applying is a separate step.
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import type { LeadStatus } from "@/lib/line-tracking/enums";

export { isStatusImportProject } from "@/lib/line-tracking/services/statusImportProjects";
import { latestSurveyDates } from "@/lib/line-tracking/services/statusImportProjects";

export type ImportKind = "survey" | "install";

export const IMPORT_TARGET: Record<ImportKind, LeadStatus> = { survey: "QUALIFIED", install: "WON" };
export const IMPORT_LABEL: Record<ImportKind, string> = { survey: "รอพิจรณา", install: "ติดตั้ง" };

/** Statuses a stage may move a lead from; a lead already past it is left alone. */
const IMPORT_FROM: Record<ImportKind, readonly string[]> = {
  survey: ["NEW", "CONTACTED"],
  install: ["NEW", "CONTACTED", "QUALIFIED", "QUOTED", "BOOKED"],
};

export function importApplies(kind: ImportKind, status: string): boolean {
  return IMPORT_FROM[kind].includes(status);
}

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 2000;

export type ImportOutcome = "ready" | "nochange" | "duplicate" | "ambiguous" | "notfound" | "nostage";

export type ImportRow = {
  row: number; // 1-based row number in the file, for the team to find it
  key: string; // what identified the customer (shown in the preview)
  source: string; // "แหล่งที่มา" column, shown as-is
  matchedBy: "lineUserId" | "lineName" | "phone" | "name" | null;
  leadId: string | null;
  leadName: string | null;
  leadStatus: string | null;
  kind: ImportKind | null;
  outcome: ImportOutcome;
  /** Moves the lead to IMPORT_TARGET[kind] (false when it is already there or past it). */
  changeStatus: boolean;
  /**
   * Proposed updates, only when they differ from the lead (re-importing a newer file
   * updates again). value: "ยอด X+vat = Y บาท" → Y, or (QUALIFIED) the first quoted price.
   */
  value: number | null;
  fillName: string | null;
  fillPhone: string | null;
  /** Survey appointment ("วันที่นัดสำรวจ" + "เวลา"), when it differs from the latest one recorded. */
  survey: string | null;
  /** Current lead values, shown as "เดิม" in the preview. */
  leadValue: number | null;
  leadFullName: string | null;
  leadPhone: string | null;
  leadSurvey: string | null;
};

const LINE_USER_ID = /^U[0-9a-f]{32}$/i;
/** A LINE user id anywhere inside free text (follow-up notes). */
const LINE_USER_ID_IN_TEXT = /\bU[0-9a-f]{32}\b/i;
/** Sales notes tag the LINE display name as "Line@:<name>//". */
const LINE_NAME_IN_TEXT = /line\s*@?\s*[:：]\s*([^/\n]+?)\s*\/\//i;
const PHONE_IN_TEXT = /(?:\+?66|0)[\d\s-]{8,12}/g;
/** "ยอด 45,000 บาท" or "ยอด 42,056+vat = 45,000บาท": the amount after "=" (VAT included) wins. */
const DEAL_IN_TEXT = /ยอด\s*([\d,]+(?:\.\d+)?)(?:[^=\n]{0,15}=\s*([\d,]+(?:\.\d+)?))?/;
/** A quoted price: "เสนอราคา 1 ปี 12,500 บาทก่อนvat" / "12,500+ vat". The first one is used. */
const QUOTE_IN_TEXT = /(\d{1,3}(?:,\d{3})+|\d{4,})(?:\.\d+)?\s*(?:บาท|\+\s*(?:vat|แวต))/i;

// ── File parsing ───────────────────────────────────────────────────────────────

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function readTable(buf: Buffer, fileName: string): Promise<string[][]> {
  if (/\.csv$/i.test(fileName)) return parseCsv(buf.toString("utf8").replace(/^﻿/, ""));
  if (!/\.xlsx$/i.test(fileName)) throw new Error("รองรับเฉพาะไฟล์ .xlsx หรือ .csv");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: true }, (r) => {
    const out: string[] = [];
    r.eachCell({ includeEmpty: true }, (cell, col) => { out[col - 1] = (cell.text ?? "").toString(); });
    rows.push(Array.from(out, (v) => v ?? ""));
  });
  return rows;
}

// ── Column detection ───────────────────────────────────────────────────────────

/** lineText = free-text follow-up columns that may carry the LINE user id. */
type Columns = {
  lineId: number; phone: number; name: number; stage: number; source: number; lineText: number[];
  surveyDate: number; surveyTime: number;
};

const HEADER = {
  lineId: /line.{0,3}(user)?.{0,3}id|userid|ไอดีไลน์|ไลน์ไอดี/i,
  phone: /เบอร์|โทร|phone|tel|mobile/i,
  name: /ชื่อ|name|ลูกค้า|customer/i,
  stage: /^(สถานะ|ขั้น|status|stage)/i,
  source: /แหล่งที่มา|source|ช่องทาง/i,
  lineText: /รายละเอียดการตาม/,
  surveyDate: /นัดสำรวจ|วันที่นัด|survey.?date/i,
  surveyTime: /^(เวลา|time)/i,
};

function findHeader(rows: string[][]): { headerRow: number; cols: Columns } {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const cells = rows[i].map((c) => c.trim());
    const pick = (re: RegExp, skip: number[] = []) => cells.findIndex((c, j) => !skip.includes(j) && c.length <= 40 && re.test(c));
    const lineText = cells.flatMap((c, j) => (HEADER.lineText.test(c) ? [j] : []));
    const source = pick(HEADER.source, lineText);
    const lineId = pick(HEADER.lineId, [...lineText, source]);
    const phone = pick(HEADER.phone, [...lineText, source, lineId]);
    const stage = pick(HEADER.stage, [...lineText, source, lineId, phone]);
    const name = pick(HEADER.name, [...lineText, source, lineId, phone, stage]);
    const surveyDate = pick(HEADER.surveyDate, [...lineText, source, lineId, phone, stage, name]);
    const surveyTime = pick(HEADER.surveyTime, [...lineText, source, lineId, phone, stage, name, surveyDate]);
    if ([lineId, phone, name].some((c) => c >= 0) || lineText.length) {
      return { headerRow: i, cols: { lineId, phone, name, stage, source, lineText, surveyDate, surveyTime } };
    }
  }
  // No header row: find the LINE user id / phone columns by their values.
  const sample = rows.slice(0, 20);
  const colBy = (test: (v: string) => boolean) => {
    const width = Math.max(0, ...sample.map((r) => r.length));
    for (let j = 0; j < width; j++) if (sample.some((r) => test((r[j] ?? "").trim()))) return j;
    return -1;
  };
  return {
    headerRow: -1,
    cols: { lineId: colBy((v) => LINE_USER_ID.test(v)), phone: colBy((v) => /^(\+?66|0)\d{8,9}$/.test(v.replace(/[\s-]/g, ""))), name: -1, stage: -1, source: -1, lineText: [], surveyDate: -1, surveyTime: -1 },
  };
}

const TH_MONTH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

/** "1/10/2569" + "10.30" → "1 ต.ค. 2569 10:30". Unrecognised dates are kept as written. */
export function surveyText(dateCell: string, timeCell: string): string {
  const d = dateCell.replace(/\s+/g, " ").trim();
  if (!d) return "";
  let out = d.slice(0, 40);
  const dmy = d.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  const ymd = d.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  const [day, month, year] = dmy ? [+dmy[1], +dmy[2], +dmy[3]] : ymd ? [+ymd[3], +ymd[2], +ymd[1]] : [0, 0, 0];
  if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
    out = `${day} ${TH_MONTH[month - 1]} ${year < 2400 ? year + 543 : year}`;
  }
  const t = timeCell.trim();
  const hm = t.match(/^(\d{1,2})[:.](\d{2})/);
  if (hm) out += ` ${hm[1].padStart(2, "0")}:${hm[2]}`;
  else if (t && t.length <= 20) out += ` ${t}`;
  return out.replace(/[\r\n]/g, " ");
}

// MFactors' "สถานะ" column: "ติดตั้ง" = WON, "รอพิจรณา" (pending decision) = QUALIFIED.
function stageOf(text: string): ImportKind | null {
  if (/ติดตั้ง|install/i.test(text)) return "install";
  if (/พิจ(า)?รณา|สำรวจ|survey|นัด/i.test(text)) return "survey";
  return null;
}

const phoneKey = (v: string | null | undefined) => {
  let d = (v ?? "").replace(/\D/g, "");
  if (d.startsWith("66")) d = "0" + d.slice(2);
  return d.length >= 9 ? d.slice(-9) : "";
};
/**
 * Value from the newest notes column first: the closed amount ("ยอด …") for any stage,
 * else, for a survey-stage (QUALIFIED) row, the first quoted price.
 */
function dealValueOf(notes: string[], kind: ImportKind | null): number | null {
  const num = (s: string | undefined) => {
    const v = Number((s ?? "").replace(/,/g, ""));
    return Number.isFinite(v) && v >= 100 && v < 1e8 ? v : null;
  };
  const newest = [...notes].reverse();
  for (const t of newest) {
    const m = t.match(DEAL_IN_TEXT);
    const v = m && num(m[2] ?? m[1]);
    if (v) return v;
  }
  if (kind !== "survey") return null;
  for (const t of newest) {
    const v = num(t.match(QUOTE_IN_TEXT)?.[1]);
    if (v) return v;
  }
  return null;
}

/** Phone as stored on leads: digits only, +66 → 0. */
const phoneDigits = (v: string) => {
  const d = v.replace(/\D/g, "");
  return d.startsWith("66") ? "0" + d.slice(2) : d;
};

const nameKey = (v: string | null | undefined) => (v ?? "").toLowerCase().replace(/^\s*(คุณ|k\.|khun)\s*/i, "").replace(/\s+/g, "");

// ── Preview ────────────────────────────────────────────────────────────────────

export async function previewStatusImport(
  projectId: string,
  file: { buf: Buffer; name: string },
  defaultKind: ImportKind | null,
): Promise<ImportRow[]> {
  const rows = await readTable(file.buf, file.name);
  const { headerRow, cols } = findHeader(rows);
  if (cols.lineId < 0 && cols.phone < 0 && cols.name < 0 && !cols.lineText.length) {
    throw new Error("ไม่พบคอลัมน์ LINE user ID, เบอร์โทร หรือชื่อ — ใส่หัวคอลัมน์ เช่น “ชื่อ”, “เบอร์โทร”, “LINE user ID”");
  }

  const leads = await prisma.lead.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, status: true, fullName: true, displayName: true, phone: true, value: true, slipAmount: true, currency: true,
      lineUser: { select: { lineUserId: true, displayName: true } },
    },
  });
  // Newest lead per key wins for LINE id (one friend, latest lead); phone/name keep all to spot duplicates.
  const byLineId = new Map<string, (typeof leads)[number]>();
  const byPhone = new Map<string, (typeof leads)[number][]>();
  const byName = new Map<string, (typeof leads)[number][]>();
  const push = <T,>(m: Map<string, T[]>, k: string, v: T) => { if (k) m.set(k, [...(m.get(k) ?? []), v]); };
  for (const l of leads) {
    const lid = l.lineUser?.lineUserId;
    if (lid && !byLineId.has(lid)) byLineId.set(lid, l);
    push(byPhone, phoneKey(l.phone), l);
    for (const n of Array.from(new Set([nameKey(l.fullName), nameKey(l.displayName), nameKey(l.lineUser?.displayName)]))) push(byName, n, l);
  }

  const surveys = await latestSurveyDates(projectId);
  const out: ImportRow[] = [];
  const cell = (r: string[], c: number) => (c >= 0 ? (r[c] ?? "").trim() : "");
  for (let i = headerRow + 1; i < rows.length && out.length < MAX_ROWS; i++) {
    const r = rows[i];
    // LINE user id: its own column, else the first one found in the follow-up notes.
    const lineId = cell(r, cols.lineId) || (cols.lineText.map((c) => cell(r, c).match(LINE_USER_ID_IN_TEXT)?.[0]).find(Boolean) ?? "");
    const phoneCell = cell(r, cols.phone);
    const rawPhones = (phoneCell.match(PHONE_IN_TEXT) ?? []).map(phoneDigits).filter((p) => phoneKey(p));
    const phones = Array.from(new Set(rawPhones.map(phoneKey)));
    const notes = cols.lineText.map((c) => cell(r, c));
    const lineName = notes.map((t) => t.match(LINE_NAME_IN_TEXT)?.[1]?.trim()).find(Boolean) ?? "";
    const name = cell(r, cols.name);
    if (!lineId && !lineName && !phones.length && !name) continue;
    const source = cell(r, cols.source);
    const kind = cols.stage >= 0 ? stageOf(cell(r, cols.stage)) ?? defaultKind : defaultKind;

    let matches: (typeof leads)[number][] = [];
    let matchedBy: ImportRow["matchedBy"] = null;
    const byPhones = Array.from(new Set(phones.flatMap((k) => byPhone.get(k) ?? [])));
    if (LINE_USER_ID.test(lineId) && byLineId.has(lineId)) { matches = [byLineId.get(lineId)!]; matchedBy = "lineUserId"; }
    else if (nameKey(lineName) && byName.has(nameKey(lineName))) { matches = byName.get(nameKey(lineName))!; matchedBy = "lineName"; }
    else if (byPhones.length) { matches = byPhones; matchedBy = "phone"; }
    else if (nameKey(name) && byName.has(nameKey(name))) { matches = byName.get(nameKey(name))!; matchedBy = "name"; }

    const lead = matches.length === 1 ? matches[0] : null;
    const changeStatus = Boolean(lead && kind && importApplies(kind, lead.status));
    // Value only for a lead at (or moving to) this row's stage — a survey quote must not
    // overwrite the deal value of a lead that is already WON. A slip amount (OCR) or a
    // non-THB lead keeps its own value.
    const atStage = Boolean(lead && kind && (changeStatus || lead.status === IMPORT_TARGET[kind]));
    const fileValue = lead && atStage && lead.slipAmount == null && lead.currency === "THB" ? dealValueOf(notes, kind) : null;
    const fileName = name.slice(0, 120);
    const filePhone = rawPhones[0] ?? "";
    const value = lead && fileValue != null && fileValue !== lead.value ? fileValue : null;
    const fillName = lead && fileName && nameKey(fileName) !== nameKey(lead.fullName) ? fileName : null;
    const fileSurvey = surveyText(cell(r, cols.surveyDate), cell(r, cols.surveyTime));
    const survey = lead && fileSurvey && fileSurvey !== surveys.get(lead.id) ? fileSurvey : null;
    const fillPhone = lead && filePhone && phoneKey(filePhone) !== phoneKey(lead.phone) ? filePhone : null;
    const outcome: ImportOutcome =
      matches.length > 1 ? "ambiguous"
        : !lead ? "notfound"
          : !kind ? "nostage"
            : changeStatus || value != null || fillName || fillPhone || survey ? "ready" : "nochange";
    out.push({
      row: i + 1,
      key: [name, lineName && `LINE: ${lineName}`, phoneCell, lineId].filter(Boolean).join(" · "),
      source,
      matchedBy: lead ? matchedBy : null,
      leadId: lead?.id ?? null,
      leadName: lead ? lead.fullName ?? lead.displayName ?? lead.lineUser?.displayName ?? null : null,
      leadStatus: lead?.status ?? null,
      kind,
      outcome,
      changeStatus,
      value,
      fillName,
      fillPhone,
      survey,
      leadValue: lead?.value ?? null,
      leadFullName: lead?.fullName ?? null,
      leadPhone: lead?.phone ?? null,
      leadSurvey: lead ? surveys.get(lead.id) ?? null : null,
    });
  }

  // The same lead listed twice: keep the furthest stage, mark the other row as a duplicate.
  const best = new Map<string, ImportRow>();
  for (const row of out) {
    if (row.outcome !== "ready" || !row.leadId) continue;
    const prev = best.get(row.leadId);
    if (!prev) best.set(row.leadId, row);
    else if (row.kind === "install" && prev.kind !== "install") { prev.outcome = "duplicate"; best.set(row.leadId, row); }
    else row.outcome = "duplicate";
  }
  return out;
}
