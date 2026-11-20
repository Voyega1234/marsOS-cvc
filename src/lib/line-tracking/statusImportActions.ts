"use server";

// Staff-only: preview and apply a customer list file that moves leads to the survey /
// install stage (MFactors only, see isStatusImportProject).
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAuthSession } from "@/lib/session";
import { changeLeadStatus } from "@/lib/line-tracking/services/leadService";
import { processQueue } from "@/lib/line-tracking/services/conversionQueueService";
import {
  IMPORT_LABEL, IMPORT_TARGET, MAX_IMPORT_BYTES, importApplies, isStatusImportProject, previewStatusImport,
  type ImportKind, type ImportRow,
} from "@/lib/line-tracking/services/statusImportService";
import { SURVEY_MARK, latestSurveyDates } from "@/lib/line-tracking/services/statusImportProjects";

const MAX_APPLY = 1000;

async function requireImportProject(projectId: string) {
  const session = await getAuthSession();
  if (!session?.user?.id) throw new Error("ไม่มีสิทธิ์ — เฉพาะทีมงาน");
  const project = await prisma.ltProject.findUnique({ where: { id: projectId }, select: { id: true, name: true } });
  if (!project || !isStatusImportProject(project)) throw new Error("โปรเจกต์นี้ไม่ได้เปิดใช้การนำเข้าสถานะ");
  return { project, email: session.user.email ?? "staff" };
}

const asKind = (v: unknown): ImportKind | null => (v === "survey" || v === "install" ? v : null);

export async function previewStatusImportAction(
  formData: FormData,
): Promise<{ ok: true; fileName: string; rows: ImportRow[] } | { ok: false; error: string }> {
  try {
    const { project } = await requireImportProject(String(formData.get("projectId") ?? ""));
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "กรุณาเลือกไฟล์" };
    if (file.size > MAX_IMPORT_BYTES) return { ok: false, error: "ไฟล์ใหญ่เกิน 5MB" };
    const rows = await previewStatusImport(
      project.id,
      { buf: Buffer.from(await file.arrayBuffer()), name: file.name },
      asKind(formData.get("defaultKind")),
    );
    return { ok: true, fileName: file.name, rows };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function applyStatusImportAction(
  projectId: string,
  fileName: string,
  items: {
    leadId: string;
    kind: string;
    row: number;
    value?: number | null;
    fillName?: string | null;
    fillPhone?: string | null;
    survey?: string | null;
  }[],
): Promise<{ ok: true; changed: number; updated: number; skipped: number } | { ok: false; error: string }> {
  try {
    const { project, email } = await requireImportProject(projectId);
    if (items.length > MAX_APPLY) return { ok: false, error: `นำเข้าได้ครั้งละไม่เกิน ${MAX_APPLY} รายการ` };
    // Re-check everything server-side: lead belongs to this project, stage still applies.
    const leads = await prisma.lead.findMany({
      where: { projectId: project.id, id: { in: items.map((i) => i.leadId) } },
      select: { id: true, status: true, fullName: true, phone: true, value: true, slipAmount: true, currency: true },
    });
    const byId = new Map(leads.map((l) => [l.id, l]));
    const surveys = await latestSurveyDates(project.id, leads.map((l) => l.id));
    const safeName = fileName.replace(/[\r\n]/g, " ").slice(0, 80);
    const changedBy = `นำเข้าไฟล์ (${email})`;
    let changed = 0;
    let updated = 0;
    const done = new Set<string>();
    for (const it of items) {
      const kind = asKind(it.kind);
      const lead = byId.get(it.leadId);
      if (!kind || !lead || done.has(it.leadId)) continue;
      const moveStatus = importApplies(kind, lead.status);
      // Name / phone / value from the file overwrite the lead (the team ticked these rows).
      // Value only at this row's stage and never over a slip amount. Written before the
      // status change so the conversion carries the value.
      const data: { fullName?: string; phone?: string; value?: number } = {};
      const name = typeof it.fillName === "string" ? it.fillName.trim().slice(0, 120) : "";
      const phone = typeof it.fillPhone === "string" ? it.fillPhone.replace(/\D/g, "").slice(0, 15) : "";
      const value = Number(it.value);
      const atStage = moveStatus || lead.status === IMPORT_TARGET[kind];
      if (name && name !== lead.fullName) data.fullName = name;
      if (phone.length >= 9 && phone !== lead.phone) data.phone = phone;
      if (atStage && Number.isFinite(value) && value >= 100 && value < 1e8 && value !== lead.value && lead.slipAmount == null && lead.currency === "THB") {
        data.value = value;
      }
      const surveyIn = typeof it.survey === "string" ? it.survey.replace(/\s+/g, " ").trim().slice(0, 60) : "";
      const survey = surveyIn && surveyIn !== surveys.get(lead.id) ? surveyIn : "";
      if (!moveStatus && !Object.keys(data).length && !survey) continue;
      done.add(it.leadId);
      if (Object.keys(data).length) await prisma.lead.update({ where: { id: lead.id }, data });
      const changes = [
        data.value != null && `ยอด ${data.value.toLocaleString()} บาท`,
        data.fullName && "ชื่อ",
        data.phone && "เบอร์",
        survey && "วันนัดสำรวจ",
      ].filter(Boolean).join(", ");
      // Survey date goes last in the note: latestSurveyDates reads it back from there.
      const surveyNote = survey ? ` · ${SURVEY_MARK} ${survey}` : "";
      const where = `จากไฟล์ ${safeName} แถว ${Number(it.row) || "?"}`;
      if (moveStatus) {
        await changeLeadStatus(lead.id, IMPORT_TARGET[kind], {
          changedBy,
          note: `📥 ${IMPORT_LABEL[kind]} — ${where}${changes ? ` · ${changes}` : ""}${surveyNote}`,
        });
        changed++;
      } else {
        await prisma.leadStatusHistory.create({
          data: { leadId: lead.id, newStatus: lead.status, changedBy, note: `📥 อัปเดต ${changes} — ${where}${surveyNote}` },
        });
        updated++;
      }
    }
    await processQueue({ projectId: project.id });
    revalidatePath(`/line-tracking/projects/${project.id}/leads`);
    return { ok: true, changed, updated, skipped: items.length - changed - updated };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
