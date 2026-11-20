import { prisma } from "@/lib/prisma";
import type { SheetConfig } from "@/lib/line-tracking/connectors";
import { isRealMode } from "@/lib/line-tracking/connectors";
import type { LeadStatus } from "@/lib/line-tracking/enums";
import { getEffectiveConfig } from "./connectionStore";
import { getGoogleAccessToken, SHEETS_SCOPE } from "./googleAuth";
import { changeLeadStatus } from "./leadService";
import type { Lead } from "@prisma/client";

// Column order pushed to / read from the sheet (header row).
export const SHEET_COLUMNS = [
  "lead_id",
  "created_at",
  "project_name",
  "line_display_name",
  "source",
  "campaign",
  "adset",
  "content",
  "keyword",
  "status",
  "value",
  "currency",
  "sales_owner",
  "purchase_id",
  "conversion_state",
  "last_sync_at",
] as const;

function leadToRow(lead: Lead, projectName: string): string[] {
  const now = new Date().toISOString();
  return [
    lead.id,
    lead.createdAt.toISOString(),
    projectName,
    lead.displayName ?? "",
    lead.source ?? "",
    lead.campaign ?? "",
    lead.adset ?? "",
    lead.content ?? "",
    lead.keyword ?? "",
    lead.status,
    String(lead.value),
    lead.currency,
    lead.salesOwner ?? "",
    lead.purchaseId ?? "",
    lead.conversionState,
    now,
  ];
}

export interface SheetSyncResult {
  ok: boolean;
  mock: boolean;
  direction: "PUSH" | "PULL";
  details: string;
  error?: string;
  updated?: number;
}

function tabRange(config: SheetConfig, range = "A:P"): string {
  const tab = config.tabName || "Leads";
  return `${encodeURIComponent(tab)}!${range}`;
}

async function sheetsGet(config: SheetConfig, token: string): Promise<string[][]> {
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${config.sheetId}` +
    `/values/${tabRange(config)}`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets GET ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { values?: string[][] };
  return json.values ?? [];
}

async function sheetsAppend(config: SheetConfig, token: string, rows: string[][]) {
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${config.sheetId}` +
    `/values/${tabRange(config)}:append?valueInputOption=RAW`;
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ values: rows }),
  });
  if (!res.ok) throw new Error(`Sheets append ${res.status}: ${await res.text()}`);
}

async function ensureHeader(config: SheetConfig, token: string, existing: string[][]) {
  if (existing.length > 0) return;
  await sheetsAppend(config, token, [[...SHEET_COLUMNS]]);
}

async function log(
  projectId: string,
  r: SheetSyncResult
) {
  await prisma.sheetSyncLog.create({
    data: {
      projectId,
      direction: r.direction,
      status: r.ok ? "SUCCESS" : "FAILED",
      details: r.details,
      errorMessage: r.error,
    },
  });
}

/** PUSH: append new leads to the sheet (skip lead_ids already present). */
export async function pushLeads(projectId: string): Promise<SheetSyncResult> {
  const config = await getEffectiveConfig<SheetConfig>(projectId, "GOOGLE_SHEET");
  const project = await prisma.ltProject.findUniqueOrThrow({ where: { id: projectId } });
  const leads = await prisma.lead.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
  });

  const real = isRealMode("GOOGLE_SHEET", config as Record<string, unknown>);

  if (!real) {
    const result: SheetSyncResult = {
      ok: true,
      mock: true,
      direction: "PUSH",
      details: `Mock mode: would push ${leads.length} leads to sheet (no credentials).`,
      updated: leads.length,
    };
    await log(projectId, result);
    return result;
  }

  try {
    const token = await getGoogleAccessToken(config.serviceAccountJson!, SHEETS_SCOPE);
    const existing = await sheetsGet(config, token);
    await ensureHeader(config, token, existing);
    const existingIds = new Set(existing.slice(1).map((row) => row[0]));
    const newRows = leads
      .filter((l) => !existingIds.has(l.id))
      .map((l) => leadToRow(l, project.name));
    if (newRows.length > 0) await sheetsAppend(config, token, newRows);

    const result: SheetSyncResult = {
      ok: true,
      mock: false,
      direction: "PUSH",
      details: `Pushed ${newRows.length} new leads (skipped ${leads.length - newRows.length} existing).`,
      updated: newRows.length,
    };
    await log(projectId, result);
    return result;
  } catch (err) {
    const result: SheetSyncResult = {
      ok: false,
      mock: false,
      direction: "PUSH",
      details: "Push failed",
      error: err instanceof Error ? err.message : String(err),
    };
    await log(projectId, result);
    return result;
  }
}

/** PULL: read status column and update leads whose status changed. */
export async function pullStatuses(projectId: string): Promise<SheetSyncResult> {
  const config = await getEffectiveConfig<SheetConfig>(projectId, "GOOGLE_SHEET");
  const real = isRealMode("GOOGLE_SHEET", config as Record<string, unknown>);

  if (!real) {
    const result: SheetSyncResult = {
      ok: true,
      mock: true,
      direction: "PULL",
      details: "Mock mode: no sheet configured — nothing imported.",
      updated: 0,
    };
    await log(projectId, result);
    return result;
  }

  try {
    const token = await getGoogleAccessToken(config.serviceAccountJson!, SHEETS_SCOPE);
    const rows = await sheetsGet(config, token);
    if (rows.length < 2) {
      const result: SheetSyncResult = {
        ok: true, mock: false, direction: "PULL", details: "Sheet empty — nothing to import.", updated: 0,
      };
      await log(projectId, result);
      return result;
    }
    const header = rows[0];
    const idIdx = header.indexOf("lead_id");
    const statusIdx = header.indexOf("status");
    let updated = 0;
    const validStatuses = new Set([
      "NEW", "CONTACTED", "QUALIFIED", "QUOTED", "BOOKED", "WON", "PAID", "LOST",
    ]);

    for (const row of rows.slice(1)) {
      const leadId = row[idIdx];
      const status = (row[statusIdx] || "").toUpperCase().trim();
      if (!leadId || !validStatuses.has(status)) continue;
      const lead = await prisma.lead.findUnique({ where: { id: leadId } });
      if (!lead || lead.status === status) continue;
      // changeLeadStatus writes history + runs conversion rules.
      await changeLeadStatus(leadId, status as LeadStatus, {
        changedBy: "Sheet import",
        note: "Status imported from Google Sheet",
      });
      updated++;
    }

    const result: SheetSyncResult = {
      ok: true,
      mock: false,
      direction: "PULL",
      details: `Imported ${updated} status changes from sheet.`,
      updated,
    };
    await log(projectId, result);
    return result;
  } catch (err) {
    const result: SheetSyncResult = {
      ok: false,
      mock: false,
      direction: "PULL",
      details: "Pull failed",
      error: err instanceof Error ? err.message : String(err),
    };
    await log(projectId, result);
    return result;
  }
}

export async function pushSingleLead(leadId: string): Promise<SheetSyncResult> {
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
  return pushLeads(lead.projectId);
}

export function listSyncLogs(projectId: string) {
  return prisma.sheetSyncLog.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
}
