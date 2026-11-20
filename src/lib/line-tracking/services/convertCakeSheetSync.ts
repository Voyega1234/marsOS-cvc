// Convert Cake only: keep LINE tracking lead statuses in step with Convert Cake's own lead
// sheet (Lead ID "LD-xxxx", Status "A. Spam" … "K. No opportunity"). Each sheet status is
// mapped by staff to a MarsOS LeadStatus; when a row's mapped status changes, the lead is
// moved through changeLeadStatus (history + conversion rules). Rows are matched to leads
// by LINE user id, then phone, then LINE name / name; anything ambiguous is reported,
// never guessed. Every function here refuses a project that is not Convert Cake.
import { prisma } from "@/lib/prisma";
import type { LeadStatus } from "@/lib/line-tracking/enums";
import { getGoogleAccessToken, SHEETS_SCOPE } from "./googleAuth";
import { getEffectiveConfig } from "./connectionStore";
import { changeLeadStatus } from "./leadService";
import {
  ccManualId, isConvertCakeProject, parseCcSheet, parseStatusMap, planCcSync, type CcColumns, type CcOutcome,
} from "./convertCakeSheetPlan";

export {
  ccManualId, ccStatusName, isConvertCakeProject, parseSheetUrl, parseStatusMap, suggestStatus,
  type CcOutcome, type CcStatusMap,
} from "./convertCakeSheetPlan";

/** Rows returned to the settings page. */
const MAX_REPORT_ROWS = 500;

// ── Sheet access ───────────────────────────────────────────────────────────────

/** The app-wide Sheets service account, else the project's own Google Sheet connector. */
async function serviceAccountJson(projectId: string): Promise<string> {
  const email = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const key = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
  if (email && key) return JSON.stringify({ client_email: email, private_key: key });
  const conn = await getEffectiveConfig<{ serviceAccountJson?: string }>(projectId, "GOOGLE_SHEET");
  if (conn.serviceAccountJson) return conn.serviceAccountJson;
  throw new Error("ยังไม่มี service account สำหรับอ่าน Google Sheet (GOOGLE_SHEETS_CLIENT_EMAIL / GOOGLE_SHEETS_PRIVATE_KEY)");
}

/** Email the sheet must be shared with (shown on the settings page). */
export async function serviceAccountEmail(projectId: string): Promise<string | null> {
  try {
    return (JSON.parse(await serviceAccountJson(projectId)) as { client_email?: string }).client_email ?? null;
  } catch {
    return null;
  }
}

async function sheetsFetch(url: string, token: string) {
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  if (res.status === 403 || res.status === 404) {
    throw new Error(`เปิดชีทไม่ได้ (${res.status}) — แชร์ชีทให้อีเมล service account แบบ Viewer แล้วลองใหม่`);
  }
  if (!res.ok) throw new Error(`Google Sheets ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/** Tab title for a gid from the sheet URL (null when the gid is not found). */
export async function resolveTabName(projectId: string, sheetId: string, gid: string): Promise<string | null> {
  const token = await getGoogleAccessToken(await serviceAccountJson(projectId), SHEETS_SCOPE);
  const json = (await sheetsFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties(sheetId,title)`,
    token,
  )) as { sheets?: { properties?: { sheetId?: number; title?: string } }[] };
  const hit = json.sheets?.find((s) => String(s.properties?.sheetId) === gid);
  return hit?.properties?.title ?? null;
}

async function readSheet(projectId: string, sheetId: string, tabName: string | null): Promise<string[][]> {
  const token = await getGoogleAccessToken(await serviceAccountJson(projectId), SHEETS_SCOPE);
  // No tab name: the range alone reads the first tab.
  const range = tabName ? `'${tabName.replace(/'/g, "''")}'!A:ZZ` : "A:ZZ";
  const json = (await sheetsFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`,
    token,
  )) as { values?: string[][] };
  return json.values ?? [];
}

// ── Sync ───────────────────────────────────────────────────────────────────────

export type CcReportRow = {
  row: number;
  sheetLeadId: string;
  sheetStatus: string;
  matchedBy: string | null;
  leadId: string | null;
  leadName: string | null;
  leadStatus: string | null;
  target: LeadStatus | null;
  outcome: CcOutcome;
};

export type CcSyncReport = {
  ok: true;
  applied: boolean;
  totalRows: number;
  counts: Partial<Record<CcOutcome, number>>;
  /** Every status seen in the sheet with its row count, for the mapping table. */
  statuses: { label: string; count: number; mapped: LeadStatus | "" }[];
  columns: Record<keyof CcColumns, string | null>;
  rows: CcReportRow[];
};

async function requireCcProject(projectId: string) {
  const project = await prisma.ltProject.findUnique({ where: { id: projectId }, select: { id: true, name: true } });
  if (!project || !isConvertCakeProject(project)) throw new Error("ใช้ได้เฉพาะโปรเจกต์ Convert Cake");
  return project;
}

export async function getCcConfig(projectId: string) {
  await requireCcProject(projectId);
  return prisma.ccSheetSync.findUnique({ where: { projectId } });
}

/**
 * Read the sheet and work out, per row, which lead it is and what would change.
 * apply=false is a dry run (nothing written). apply=true links rows, records sheet
 * statuses and moves lead statuses.
 */
export async function runCcSheetSync(projectId: string, opts: { apply: boolean; changedBy?: string }): Promise<CcSyncReport> {
  const project = await requireCcProject(projectId);
  const cfg = await prisma.ccSheetSync.findUnique({ where: { projectId: project.id } });
  if (!cfg) throw new Error("ยังไม่ได้ตั้งค่าชีท");

  const raw = await readSheet(project.id, cfg.sheetId, cfg.tabName);
  const parsed = parseCcSheet(raw);
  if (!parsed) throw new Error("ไม่พบหัวคอลัมน์ “Lead ID” และ “Status” ใน 10 แถวแรกของชีท");
  const { rows, columns } = parsed;
  const map = parseStatusMap(cfg.statusMap);

  const [links, leads] = await Promise.all([
    prisma.ccSheetLead.findMany({
      where: { projectId: project.id },
      select: { sheetLeadId: true, leadId: true, matchedBy: true, sheetStatus: true, appliedStatus: true, note: true },
    }),
    prisma.lead.findMany({
      where: { projectId: project.id },
      select: {
        id: true, status: true, phone: true, fullName: true, displayName: true,
        lineUser: { select: { lineUserId: true, displayName: true } },
      },
    }),
  ]);
  const plan = planCcSync({ rows, leads, links, map });

  const report: CcReportRow[] = [];
  const counts: Partial<Record<CcOutcome, number>> = {};
  for (const p of plan) {
    counts[p.outcome] = (counts[p.outcome] ?? 0) + 1;
    if (p.outcome === "kept" || p.outcome === "same" || report.length >= MAX_REPORT_ROWS) continue;
    report.push({
      row: p.r.row, sheetLeadId: p.r.sheetLeadId, sheetStatus: p.r.status, matchedBy: p.matchedBy,
      leadId: p.lead?.id ?? null,
      leadName: p.lead ? p.lead.fullName || p.lead.lineUser?.displayName || p.lead.displayName || null : null,
      leadStatus: p.lead?.status ?? null, target: p.target, outcome: p.outcome,
    });
  }

  if (opts.apply) {
    for (const p of plan) {
      if (p.outcome !== "change") continue;
      await changeLeadStatus(p.lead!.id, p.target!, {
        changedBy: opts.changedBy ?? "Convert Cake Sheet",
        note: `ชีท Convert Cake: ${p.r.status} (${p.r.sheetLeadId})`,
      });
    }
    const fresh = plan.filter((p) => p.isNew);
    if (fresh.length) {
      await prisma.ccSheetLead.createMany({
        data: fresh.map((p) => ({ projectId: project.id, ...p.next })),
        skipDuplicates: true,
      });
    }
    for (const p of plan.filter((p) => !p.isNew && p.dirty)) {
      const { sheetLeadId, ...data } = p.next;
      await prisma.ccSheetLead.update({
        where: { projectId_sheetLeadId: { projectId: project.id, sheetLeadId } },
        data,
      });
    }
  }

  const statusCount = new Map<string, number>();
  for (const r of rows) if (r.status) statusCount.set(r.status, (statusCount.get(r.status) ?? 0) + 1);
  const statuses = Array.from(statusCount.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, count]) => ({ label, count, mapped: map[label] ?? "" }));

  if (opts.apply) {
    const summary = Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(" ");
    await prisma.ccSheetSync.update({
      where: { projectId: project.id },
      data: { lastRunAt: new Date(), lastResult: `OK ${rows.length} rows · ${summary}` },
    });
  }

  return { ok: true, applied: opts.apply, totalRows: rows.length, counts, statuses, columns, rows: report };
}

/** Record a failed run on the config row (the cron has nobody to show the error to). */
export async function recordCcSyncError(projectId: string, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  await prisma.ccSheetSync.update({
    where: { projectId },
    data: { lastRunAt: new Date(), lastResult: `ERROR ${msg}`.slice(0, 1000) },
  }).catch(() => {});
}

export type CcLeadStatus = { status: string; sheetLeadId: string | null };

/**
 * Status name per lead for the Leads page (Convert Cake only). A lead can have its sheet
 * row and a status picked in MarsOS (row "marsos:<leadId>"); the one written last wins, so
 * a pick in MarsOS shows until the sheet row changes again.
 */
export async function sheetStatusByLead(projectId: string, leadIds: string[]): Promise<Map<string, CcLeadStatus>> {
  if (!leadIds.length) return new Map();
  const rows = await prisma.ccSheetLead.findMany({
    where: { projectId, leadId: { in: leadIds } },
    select: { leadId: true, sheetStatus: true, sheetLeadId: true, updatedAt: true },
  });
  const out = new Map<string, CcLeadStatus & { at: number }>();
  for (const r of rows) {
    if (!r.leadId) continue;
    const manual = r.sheetLeadId === ccManualId(r.leadId);
    const cur = out.get(r.leadId);
    const at = r.updatedAt.getTime();
    const sheetLeadId = manual ? cur?.sheetLeadId ?? null : r.sheetLeadId;
    if (!cur || at > cur.at) out.set(r.leadId, { status: r.sheetStatus, sheetLeadId, at });
    else if (!manual) cur.sheetLeadId = r.sheetLeadId;
  }
  return new Map(Array.from(out).map(([id, v]) => [id, { status: v.status, sheetLeadId: v.sheetLeadId }]));
}

/** Sheet statuses that have a MarsOS status, in sheet order, for the status picker. */
export async function ccStatusOptions(projectId: string): Promise<string[]> {
  const cfg = await prisma.ccSheetSync.findUnique({ where: { projectId }, select: { statusMap: true } });
  const map = parseStatusMap(cfg?.statusMap);
  return Object.keys(map).filter((k) => map[k]).sort((a, b) => a.localeCompare(b));
}
