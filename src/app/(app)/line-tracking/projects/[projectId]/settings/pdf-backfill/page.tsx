import Link from "next/link";
import { PageHeader } from "@/components/ds";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAuthSession } from "@/lib/session";
import { isLineTrackingAdmin } from "@/lib/line-tracking/access";
import { appliedPdfMessageIds, isAutoPaidProject, listLoggedPdfs } from "@/lib/line-tracking/services/salesDocumentService";
import PdfBackfillManager, { type BackfillRow } from "@/components/line-tracking/PdfBackfillManager";

export const dynamic = "force-dynamic";
// Each row's read/apply is one server action call: LINE download + Gemini (≤45s).
export const maxDuration = 60;

// Read PDFs that customers sent in LINE before PDF reading existed (from lt_webhook_log).
// Module admins only.
export default async function PdfBackfillPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const [project, session] = await Promise.all([
    prisma.ltProject.findUnique({ where: { id: projectId }, select: { id: true, name: true } }),
    getAuthSession(),
  ]);
  if (!project) notFound();
  if (!isLineTrackingAdmin(session?.user?.role)) notFound();

  const pdfs = await listLoggedPdfs(project.id);
  const lineUsers = await prisma.lineUser.findMany({
    where: { projectId: project.id, lineUserId: { in: Array.from(new Set(pdfs.map((p) => p.lineUserId))) } },
    select: {
      lineUserId: true,
      displayName: true,
      leads: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, fullName: true, status: true } },
    },
  });
  const byLineUser = new Map(lineUsers.map((u) => [u.lineUserId, u]));
  const applied = await appliedPdfMessageIds(
    pdfs.flatMap((p) => {
      const leadId = byLineUser.get(p.lineUserId)?.leads[0]?.id;
      return leadId ? [{ ...p, leadId }] : [];
    }),
  );

  const rows: BackfillRow[] = pdfs.map((p) => {
    const u = byLineUser.get(p.lineUserId);
    const lead = u?.leads[0];
    return {
      messageId: p.messageId,
      fileName: p.fileName,
      sentAt: p.sentAt,
      leadId: lead?.id ?? null,
      leadName: lead?.fullName || u?.displayName || null,
      leadStatus: lead?.status ?? null,
      applied: applied.has(p.messageId),
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={<>📄 อ่าน PDF ย้อนหลัง · {project.name}</>}
        subtitle={<>
            PDF ที่ลูกค้าเคยส่งเข้าแชท LINE (จาก webhook log ทั้งหมด) — กดอ่านเพื่อดูผลก่อน แล้วค่อยยืนยันบันทึกลง Lead
          </>}
        actions={<>
        <Link href={`/line-tracking/projects/${project.id}/settings`} className="btn-secondary text-sm">
          ← Settings
        </Link>
        </>}
      />

      <PdfBackfillManager projectId={project.id} autoPaid={isAutoPaidProject(project)} rows={rows} />
    </div>
  );
}
