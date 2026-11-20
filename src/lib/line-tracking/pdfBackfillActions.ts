"use server";

// Staff-only backfill for sales-document PDFs that customers sent in LINE before PDF
// reading existed. Message ids always come from lt_webhook_log on the server, never
// trusted from the client: the client only names which logged message to process.
import { prisma } from "@/lib/prisma";
import { getAuthSession } from "@/lib/session";
import { isLineTrackingAdmin } from "@/lib/line-tracking/access";
import { processQueue } from "@/lib/line-tracking/services/conversionQueueService";
import {
  applySalesDocument,
  appliedPdfMessageIds,
  findLeadForLineUser,
  listLoggedPdfs,
  readLoggedPdf,
} from "@/lib/line-tracking/services/salesDocumentService";

export type BackfillReadResult =
  | {
      ok: true;
      docType: string;
      docNumber: string | null;
      amount: number | null;
      isDeposit: boolean;
      buyer: string | null;
      salesContactName: string | null;
    }
  | { ok: false; error: string };

export type BackfillApplyResult = { ok: true; autoPaid: boolean } | { ok: false; error: string };

async function loadContext(projectId: string, messageId: string) {
  const session = await getAuthSession();
  if (!isLineTrackingAdmin(session?.user?.role)) throw new Error("ไม่มีสิทธิ์ — เฉพาะผู้ดูแลระบบเท่านั้น");
  const project = await prisma.ltProject.findUnique({ where: { id: projectId }, select: { id: true, name: true } });
  if (!project) throw new Error("ไม่พบโปรเจกต์");
  const pdf = (await listLoggedPdfs(project.id)).find((p) => p.messageId === messageId);
  if (!pdf) throw new Error("ไม่พบไฟล์นี้ใน webhook log ของโปรเจกต์");
  return { project, pdf };
}

export async function backfillReadPdf(projectId: string, messageId: string): Promise<BackfillReadResult> {
  try {
    const { project, pdf } = await loadContext(projectId, messageId);
    const r = await readLoggedPdf(project.id, pdf);
    if (!r.ok) return r;
    const q = r.q;
    return {
      ok: true,
      docType: q.docType,
      docNumber: q.docNumber ?? null,
      amount: q.amountPaid ?? q.total,
      isDeposit: q.isDeposit,
      buyer: q.customerContactName ?? q.customerCompany ?? null,
      salesContactName: q.salesContactName ?? null,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function backfillApplyPdf(projectId: string, messageId: string): Promise<BackfillApplyResult> {
  try {
    const { project, pdf } = await loadContext(projectId, messageId);
    const lead = await findLeadForLineUser(project.id, pdf.lineUserId);
    if (!lead) return { ok: false, error: "ไม่พบ Lead ของลูกค้าคนนี้" };
    if ((await appliedPdfMessageIds([{ ...pdf, leadId: lead.id }])).size) return { ok: false, error: "ไฟล์นี้ถูกบันทึกไปแล้ว" };
    const r = await readLoggedPdf(project.id, pdf);
    if (!r.ok) return r;
    if (r.q.docType === "other") return { ok: false, error: "ไม่ใช่ใบเสนอราคา/ใบแจ้งหนี้/ใบเสร็จ" };
    const out = await applySalesDocument({
      project, lead, q: r.q, fileName: pdf.fileName, messageId: pdf.messageId,
      origin: `ย้อนหลัง ส่งเมื่อ ${new Date(pdf.sentAt).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok" })}`,
    });
    // Send the queued conversions (Purchase) now instead of waiting for the next webhook/cron.
    await processQueue({ projectId: project.id });
    return { ok: true, autoPaid: out.autoPaid };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
