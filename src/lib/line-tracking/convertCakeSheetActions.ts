"use server";

// Staff-only: set up and run the Convert Cake sheet status sync (Convert Cake only,
// see isConvertCakeProject).
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAuthSession } from "@/lib/session";
import { processQueue } from "@/lib/line-tracking/services/conversionQueueService";
import { LEAD_STATUS } from "@/lib/line-tracking/enums";
import {
  isConvertCakeProject, parseSheetUrl, parseStatusMap, recordCcSyncError, resolveTabName, runCcSheetSync,
  suggestStatus, type CcStatusMap, type CcSyncReport,
} from "@/lib/line-tracking/services/convertCakeSheetSync";

type Fail = { ok: false; error: string };
const fail = (err: unknown): Fail => ({ ok: false, error: err instanceof Error ? err.message : String(err) });

async function requireCc(projectId: string) {
  const session = await getAuthSession();
  if (!session?.user?.id) throw new Error("ไม่มีสิทธิ์ — เฉพาะทีมงาน");
  const project = await prisma.ltProject.findUnique({ where: { id: projectId }, select: { id: true, name: true } });
  if (!project || !isConvertCakeProject(project)) throw new Error("ใช้ได้เฉพาะโปรเจกต์ Convert Cake");
  return { project, email: session.user.email ?? "staff" };
}

const settingsPath = (projectId: string) => `/line-tracking/projects/${projectId}/settings/sheet-status-sync`;

/** Save the sheet link (and tab), then dry-run it so the page can show the statuses found. */
export async function saveCcSheetAction(
  projectId: string,
  sheetUrl: string,
  tabName: string,
): Promise<CcSyncReport | Fail> {
  try {
    const { project } = await requireCc(projectId);
    const parsed = parseSheetUrl(sheetUrl);
    if (!parsed) return { ok: false, error: "ลิงก์ Google Sheet ไม่ถูกต้อง" };
    let tab = tabName.trim() || null;
    if (!tab && parsed.gid) tab = await resolveTabName(project.id, parsed.sheetId, parsed.gid);
    await prisma.ccSheetSync.upsert({
      where: { projectId: project.id },
      create: { projectId: project.id, sheetId: parsed.sheetId, tabName: tab },
      update: { sheetId: parsed.sheetId, tabName: tab },
    });
    const report = await runCcSheetSync(project.id, { apply: false });
    // Fill a starting mapping for statuses seen for the first time; existing choices stay.
    const cfg = await prisma.ccSheetSync.findUniqueOrThrow({ where: { projectId: project.id } });
    const map = parseStatusMap(cfg.statusMap);
    let added = false;
    for (const s of report.statuses) {
      if (!(s.label in map)) { map[s.label] = suggestStatus(s.label); added = true; }
    }
    if (added) {
      await prisma.ccSheetSync.update({ where: { projectId: project.id }, data: { statusMap: JSON.stringify(map) } });
      revalidatePath(settingsPath(project.id));
      return runCcSheetSync(project.id, { apply: false });
    }
    revalidatePath(settingsPath(project.id));
    return report;
  } catch (err) {
    return fail(err);
  }
}

/** Save the sheet status → MarsOS status table, then dry-run with it. */
export async function saveCcMappingAction(projectId: string, mapping: Record<string, string>): Promise<CcSyncReport | Fail> {
  try {
    const { project } = await requireCc(projectId);
    const clean: CcStatusMap = {};
    for (const [label, v] of Object.entries(mapping).slice(0, 200)) {
      const key = label.trim().slice(0, 80);
      if (!key) continue;
      clean[key] = (LEAD_STATUS as readonly string[]).includes(v) ? (v as CcStatusMap[string]) : "";
    }
    await prisma.ccSheetSync.update({ where: { projectId: project.id }, data: { statusMap: JSON.stringify(clean) } });
    revalidatePath(settingsPath(project.id));
    return runCcSheetSync(project.id, { apply: false });
  } catch (err) {
    return fail(err);
  }
}

export async function previewCcSyncAction(projectId: string): Promise<CcSyncReport | Fail> {
  try {
    const { project } = await requireCc(projectId);
    return await runCcSheetSync(project.id, { apply: false });
  } catch (err) {
    return fail(err);
  }
}

/** Apply now and turn the 10-minute automatic sync on. */
export async function applyCcSyncAction(projectId: string): Promise<CcSyncReport | Fail> {
  // Set only after the auth check: a caller without access must not be able to write
  // an error line onto a project's sync status.
  let id: string | null = null;
  try {
    const { project, email } = await requireCc(projectId);
    id = project.id;
    const report = await runCcSheetSync(project.id, { apply: true, changedBy: `ชีท Convert Cake (${email})` });
    await prisma.ccSheetSync.update({ where: { projectId: project.id }, data: { enabled: true } });
    if (report.counts.change) await processQueue({ projectId: project.id }).catch(() => {});
    revalidatePath(settingsPath(project.id));
    revalidatePath(`/line-tracking/projects/${project.id}/leads`);
    return report;
  } catch (err) {
    if (id) await recordCcSyncError(id, err);
    return fail(err);
  }
}

export async function setCcSyncEnabledAction(projectId: string, enabled: boolean): Promise<{ ok: true } | Fail> {
  try {
    const { project } = await requireCc(projectId);
    await prisma.ccSheetSync.update({ where: { projectId: project.id }, data: { enabled } });
    revalidatePath(settingsPath(project.id));
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
