// Convert Cake sheet status sync — the pure part: read the sheet's cells, match each row
// to a lead and decide what happens to it. No database or network here, so it is unit
// tested (convertCakeSheetPlan.test.ts); convertCakeSheetSync.ts does the I/O.
import { LEAD_STATUS, type LeadStatus } from "@/lib/line-tracking/enums";

/** Projects (name, letters and digits only, case-insensitive) that use this sync. */
const CC_PROJECT_KEYS = ["convertcake"];

export function isConvertCakeProject(project: { name: string }): boolean {
  return CC_PROJECT_KEYS.includes(project.name.toLowerCase().replace(/[^a-z0-9]/g, ""));
}

/** A lead already PAID is never moved by the sheet (its purchase conversion is out). */
const PROTECTED: ReadonlySet<string> = new Set(["PAID"]);
/** Status changes per run; the rest follow on the next run (keeps the cron well inside its limit). */
export const MAX_CHANGES_PER_RUN = 300;

export type CcStatusMap = Record<string, LeadStatus | "">;

/** Status name without the sheet's letter prefix: "G. Warm opportunity" → "Warm opportunity". */
export function ccStatusName(label: string): string {
  return label.replace(/^\s*[A-Za-z]\s*[.)]\s*/, "").trim() || label;
}

/** sheetLeadId of the row that holds a status picked in MarsOS (never a real sheet Lead ID). */
export const ccManualId = (leadId: string) => `marsos:${leadId}`;

export function parseStatusMap(json: string | null | undefined): CcStatusMap {
  try {
    const raw = JSON.parse(json || "{}") as Record<string, unknown>;
    const out: CcStatusMap = {};
    for (const [k, v] of Object.entries(raw)) {
      out[k] = (LEAD_STATUS as readonly string[]).includes(String(v)) ? (v as LeadStatus) : "";
    }
    return out;
  } catch {
    return {};
  }
}

/** Starting mapping for a sheet status ("J. Signed" → WON). Staff can change it. */
export function suggestStatus(label: string): LeadStatus | "" {
  const l = label.trim().toLowerCase();
  if (/spam|unqualified|no opportunity|lost|cancel/.test(l)) return "LOST";
  if (/signed|won|closed/.test(l)) return "WON";
  // BOOKED is hidden for this project (projectLeadStatuses), so late stages map to QUOTED.
  if (/commit|hot|warm/.test(l)) return "QUOTED";
  if (/cold opportunity/.test(l)) return "QUALIFIED";
  if (/cold/.test(l)) return "CONTACTED";
  if (/potential|qualified/.test(l)) return "QUALIFIED";
  if (/proposal|quot/.test(l)) return "QUOTED";
  return "";
}

/** "https://docs.google.com/spreadsheets/d/<id>/edit#gid=123" or a bare id. */
export function parseSheetUrl(input: string): { sheetId: string; gid: string | null } | null {
  const s = input.trim();
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/);
  const sheetId = m?.[1] ?? (/^[a-zA-Z0-9_-]{20,}$/.test(s) ? s : null);
  if (!sheetId) return null;
  const gid = s.match(/[#?&]gid=(\d+)/)?.[1] ?? null;
  return { sheetId, gid };
}

// ── Sheet cells ────────────────────────────────────────────────────────────────

export type CcColumns = { leadId: number; status: number; lineUserId: number; lineName: number; phone: number; name: number };

const HEADER = {
  leadId: /^lead\s*id$/i,
  status: /^(status|สถานะ)$/i,
  lineUserId: /line.{0,3}user.{0,3}id|^userid$|^line\s*id$|ไอดีไลน์|ไลน์ไอดี/i,
  lineName: /line.{0,3}(display)?.{0,3}name|ชื่อ\s*line|ชื่อไลน์|display\s*name/i,
  phone: /เบอร์|โทร|phone|tel|mobile/i,
  name: /^(ชื่อ|name|customer|ลูกค้า|contact|full\s*name)/i,
};

const LINE_USER_ID_IN_TEXT = /\bU[0-9a-f]{32}\b/i;

export type SheetRow = {
  row: number; // 1-based sheet row
  sheetLeadId: string;
  status: string;
  lineUserId: string;
  lineName: string;
  phone: string;
  name: string;
};

export type ParsedSheet = { rows: SheetRow[]; columns: Record<keyof CcColumns, string | null> };

/**
 * The header row is the first of the top 10 rows with both "Lead ID" and "Status"
 * (Convert Cake's sheet has a group-heading row above it). Null when not found.
 */
export function parseCcSheet(raw: string[][]): ParsedSheet | null {
  let headerRow = -1;
  let cols: CcColumns | null = null;
  for (let i = 0; i < Math.min(raw.length, 10) && !cols; i++) {
    const cells = (raw[i] ?? []).map((c) => (c ?? "").trim());
    const pick = (re: RegExp, skip: number[] = []) => cells.findIndex((c, j) => !skip.includes(j) && c.length <= 40 && re.test(c));
    const leadId = pick(HEADER.leadId);
    const status = pick(HEADER.status);
    if (leadId < 0 || status < 0) continue;
    const lineUserId = pick(HEADER.lineUserId, [leadId, status]);
    const lineName = pick(HEADER.lineName, [leadId, status, lineUserId]);
    const phone = pick(HEADER.phone, [leadId, status, lineUserId, lineName]);
    const name = pick(HEADER.name, [leadId, status, lineUserId, lineName, phone]);
    headerRow = i;
    cols = { leadId, status, lineUserId, lineName, phone, name };
  }
  if (!cols) return null;

  const headerCells = raw[headerRow] ?? [];
  const columns = Object.fromEntries(
    Object.entries(cols).map(([k, j]) => [k, j >= 0 ? (headerCells[j] ?? "").trim() || null : null]),
  ) as Record<keyof CcColumns, string | null>;

  const at = (r: string[], j: number) => (j >= 0 ? (r[j] ?? "").trim() : "");
  const rows: SheetRow[] = [];
  for (let i = headerRow + 1; i < raw.length; i++) {
    const r = raw[i] ?? [];
    const sheetLeadId = at(r, cols.leadId);
    if (!sheetLeadId) continue;
    // A LINE user id may sit in any cell (notes), not only a LINE id column.
    const lineUserId = at(r, cols.lineUserId).match(LINE_USER_ID_IN_TEXT)?.[0]
      ?? r.map((c) => (c ?? "").match(LINE_USER_ID_IN_TEXT)?.[0]).find(Boolean) ?? "";
    rows.push({
      row: i + 1,
      sheetLeadId: sheetLeadId.slice(0, 64),
      status: at(r, cols.status).slice(0, 80),
      lineUserId,
      lineName: at(r, cols.lineName),
      phone: at(r, cols.phone),
      name: at(r, cols.name),
    });
  }
  return { rows, columns };
}

// ── Matching and decisions ─────────────────────────────────────────────────────

export const phoneKey = (v: string | null | undefined) => {
  let d = (v ?? "").replace(/\D/g, "");
  if (d.startsWith("66")) d = "0" + d.slice(2);
  return d.length >= 9 ? d.slice(-9) : "";
};
const nameKey = (v: string | null | undefined) => (v ?? "").normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();

export type CcOutcome =
  | "change" // lead status will move / moved
  | "same" // lead already at the mapped status
  | "kept" // mapped status already applied before; a manual change in MarsOS is kept
  | "paid" // lead is PAID, not touched
  | "unmapped" // sheet status has no MarsOS status yet
  | "nostatus" // empty status cell
  | "notfound"
  | "ambiguous"
  | "duplicate" // several sheet rows matched the same lead
  | "older" // the same customer has a newer row in the sheet; that row is used
  | "deferred"; // over MAX_CHANGES_PER_RUN, next run

export type LeadLite = {
  id: string;
  status: string;
  phone: string | null;
  fullName: string | null;
  displayName: string | null;
  lineUser: { lineUserId: string; displayName: string | null } | null;
};

export type LinkLite = {
  sheetLeadId: string;
  leadId: string | null;
  matchedBy: string | null;
  sheetStatus: string;
  appliedStatus: string | null;
  note: string | null;
};

export type PlannedRow = {
  r: SheetRow;
  lead: LeadLite | null;
  matchedBy: string | null;
  target: LeadStatus | null;
  outcome: CcOutcome;
  /** The link row as it should be stored after this run (when the run applies). */
  next: LinkLite;
  /** True when `next` differs from what is stored (or nothing is stored yet). */
  dirty: boolean;
  isNew: boolean;
};

/** "LD-0387" → 387 (0 when there is no number). */
function ldNumber(id: string): number {
  const m = id.match(/(\d+)\s*$/);
  return m ? Number(m[1]) : 0;
}

function indexBy(leads: LeadLite[], key: (l: LeadLite) => string[]) {
  const map = new Map<string, LeadLite[]>();
  for (const l of leads) {
    for (const k of Array.from(new Set(key(l).filter(Boolean)))) {
      const list = map.get(k);
      if (list) list.push(l);
      else map.set(k, [l]);
    }
  }
  return map;
}

/**
 * Match every sheet row to a lead (stored link first, then LINE user id, phone, LINE
 * name, name — a key that hits more than one lead is ambiguous, never guessed) and decide
 * the outcome. A row's mapped status is applied once; it is applied again only when the
 * sheet moves it to a different mapped status, so a manual change in MarsOS is kept.
 */
export function planCcSync(input: {
  rows: SheetRow[];
  leads: LeadLite[];
  links: LinkLite[];
  map: CcStatusMap;
  maxChanges?: number;
}): PlannedRow[] {
  const maxChanges = input.maxChanges ?? MAX_CHANGES_PER_RUN;
  const linkBySheetId = new Map(input.links.map((l) => [l.sheetLeadId, l]));
  const leadById = new Map(input.leads.map((l) => [l.id, l]));
  const byLineUid = indexBy(input.leads, (l) => [l.lineUser?.lineUserId ?? ""]);
  const byPhone = indexBy(input.leads, (l) => [phoneKey(l.phone)]);
  const byLineName = indexBy(input.leads, (l) => [nameKey(l.lineUser?.displayName), nameKey(l.displayName)]);
  const byName = indexBy(input.leads, (l) => [nameKey(l.fullName)]);

  // Match every row first, so a lead claimed by several rows can be resolved.
  const matched = input.rows.map((r) => {
    const linked = linkBySheetId.get(r.sheetLeadId);
    const linkedLead = linked?.leadId ? leadById.get(linked.leadId) : undefined;
    if (linkedLead) return { r, lead: linkedLead as LeadLite | null, matchedBy: linked!.matchedBy ?? "link", miss: null };
    let ambiguous = false;
    const tries: [string, LeadLite[] | undefined][] = [
      ["lineUserId", r.lineUserId ? byLineUid.get(r.lineUserId) : undefined],
      ["phone", phoneKey(r.phone) ? byPhone.get(phoneKey(r.phone)) : undefined],
      ["lineName", nameKey(r.lineName) ? byLineName.get(nameKey(r.lineName)) : undefined],
      ["name", nameKey(r.name) ? byName.get(nameKey(r.name)) : undefined],
    ];
    for (const [by, list] of tries) {
      if (!list?.length) continue;
      if (list.length === 1) return { r, lead: list[0] as LeadLite | null, matchedBy: by as string | null, miss: null };
      ambiguous = true;
    }
    return { r, lead: null, matchedBy: null, miss: (ambiguous ? "ambiguous" : "notfound") as CcOutcome };
  });
  // A customer who came back has several rows: the newest one (highest Lead ID number,
  // then lowest in the sheet) is the one that drives the lead. Rows sharing that same
  // Lead ID cannot be told apart and stay duplicate.
  const winner = new Map<string, SheetRow>();
  const newer = (a: SheetRow, b: SheetRow) => ldNumber(a.sheetLeadId) - ldNumber(b.sheetLeadId) || a.row - b.row;
  for (const m of matched) {
    if (!m.lead) continue;
    const cur = winner.get(m.lead.id);
    if (!cur || newer(m.r, cur) > 0) winner.set(m.lead.id, m.r);
  }
  const winnerIdCount = new Map<string, number>();
  for (const m of matched) {
    if (m.lead && winner.get(m.lead.id)!.sheetLeadId === m.r.sheetLeadId) {
      winnerIdCount.set(m.lead.id, (winnerIdCount.get(m.lead.id) ?? 0) + 1);
    }
  }

  let changes = 0;
  return matched.map((m) => {
    const { r, lead } = m;
    const link = linkBySheetId.get(r.sheetLeadId);
    const target = r.status ? input.map[r.status] || null : null;
    let appliedStatus = link?.appliedStatus ?? null;
    let outcome: CcOutcome;
    if (!lead) outcome = m.miss!;
    else if (winner.get(lead.id)!.sheetLeadId !== r.sheetLeadId) outcome = "older";
    else if ((winnerIdCount.get(lead.id) ?? 0) > 1) outcome = "duplicate";
    else if (!r.status) outcome = "nostatus";
    else if (!target) outcome = "unmapped";
    else if (target === appliedStatus) outcome = "kept";
    else if (lead.status === target) { outcome = "same"; appliedStatus = target; }
    else if (PROTECTED.has(lead.status)) outcome = "paid";
    else if (changes >= maxChanges) outcome = "deferred";
    else { outcome = "change"; changes++; appliedStatus = target; }

    // An older or duplicate row keeps no link, so only one row is ever tied to a lead.
    const leadId = lead && outcome !== "duplicate" && outcome !== "older" ? lead.id : null;
    const next: LinkLite = {
      sheetLeadId: r.sheetLeadId,
      leadId,
      matchedBy: leadId ? m.matchedBy : null,
      sheetStatus: r.status,
      appliedStatus,
      note: outcome === "change" || outcome === "same" || outcome === "kept" ? null : outcome,
    };
    const dirty = !link || link.leadId !== next.leadId || link.matchedBy !== next.matchedBy ||
      link.sheetStatus !== next.sheetStatus || link.appliedStatus !== next.appliedStatus || link.note !== next.note;
    return { r, lead, matchedBy: m.matchedBy, target, outcome, next, dirty, isNew: !link };
  });
}
