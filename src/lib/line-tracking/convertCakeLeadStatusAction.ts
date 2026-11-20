"use server";

// Convert Cake only: set a lead's status by its sheet status name from the Leads page.
// The name is mapped to a MarsOS status through the sheet sync's mapping table, so
// conversions run exactly as with the normal status select. Nothing is written to the sheet.
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAuthSession } from "@/lib/session";
import { changedByLabel } from "@/lib/line-tracking/leadChangeDiff";
import type { LeadActor } from "@/lib/line-tracking/leadChangeDiff";
import { recordLeadChanges } from "@/lib/line-tracking/leadChangeLog";
import { changeLeadStatus } from "@/lib/line-tracking/services/leadService";
import { processQueue } from "@/lib/line-tracking/services/conversionQueueService";
import {
  ccManualId, ccStatusName, isConvertCakeProject, parseStatusMap,
} from "@/lib/line-tracking/services/convertCakeSheetSync";

const DENIED = "ไม่มีสิทธิ์";

/** Staff only. */
async function requireAccess(_projectId: string): Promise<LeadActor> {
  const session = await getAuthSession();
  if (session?.user?.id) return { type: "staff", name: session.user.email ?? session.user.id };
  throw new Error(DENIED);
}

export async function setCcLeadStatusAction(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "");
  const leadId = String(formData.get("leadId") ?? "");
  const label = String(formData.get("label") ?? "");
  if (!projectId || !leadId || !label) throw new Error(DENIED);
  const actor = await requireAccess(projectId);

  const [project, lead, cfg] = await Promise.all([
    prisma.ltProject.findUnique({ where: { id: projectId }, select: { name: true } }),
    prisma.lead.findUnique({ where: { id: leadId }, select: { projectId: true, status: true } }),
    prisma.ccSheetSync.findUnique({ where: { projectId }, select: { statusMap: true } }),
  ]);
  if (!project || !isConvertCakeProject(project)) throw new Error("ใช้ได้เฉพาะโปรเจกต์ Convert Cake");
  if (!lead || lead.projectId !== projectId) throw new Error(DENIED);
  const target = parseStatusMap(cfg?.statusMap)[label];
  if (!target) throw new Error("สถานะนี้ยังไม่ได้เทียบกับสถานะ MarsOS");

  const id = ccManualId(leadId);
  await prisma.ccSheetLead.upsert({
    where: { projectId_sheetLeadId: { projectId, sheetLeadId: id } },
    create: { projectId, sheetLeadId: id, leadId, matchedBy: "manual", sheetStatus: label, appliedStatus: target },
    update: { leadId, sheetStatus: label, appliedStatus: target },
  });
  // PAID is never moved, same as the sheet sync.
  if (lead.status !== target && lead.status !== "PAID") {
    const updated = await changeLeadStatus(leadId, target, { changedBy: changedByLabel(actor), note: `สถานะ Convert Cake: ${ccStatusName(label)}` });
    // Log the status the lead ended with: changeLeadStatus may store PAID where WON was asked.
    if (updated.status !== lead.status) {
      await recordLeadChanges(projectId, leadId, actor, [{ field: "status", oldValue: lead.status, newValue: updated.status }]);
    }
    await processQueue({ projectId });
  }
  revalidatePath(`/line-tracking/projects/${projectId}/leads`);
  revalidatePath(`/line-tracking/projects/${projectId}/conversions`);
  revalidatePath(`/line-tracking/projects/${projectId}`);
}
