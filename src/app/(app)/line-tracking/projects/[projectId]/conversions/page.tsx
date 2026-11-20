import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ds";
import { prisma } from "@/lib/prisma";
import {
  processQueueAction,
  retryEventAction,
  markSkippedAction,
} from "@/lib/line-tracking/actions";
import { syncRulePlatforms } from "@/lib/line-tracking/services/conversionRuleService";
import { StatusBadge, StatCard, EmptyRow, MockBadge } from "@/components/line-tracking/ui";
import { PayloadViewer } from "@/components/line-tracking/PayloadViewer";
import { platformLabel } from "@/lib/line-tracking/platforms";
import { fmtDate } from "@/lib/line-tracking/format";
import { ResizableTable } from "@/components/line-tracking/ResizableTable";
import { guardProjectPage } from "@/lib/line-tracking/pageGuard";

export const dynamic = "force-dynamic";

export default async function ConversionsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  await guardProjectPage(projectId, { clientAllowed: false });
  // ค่าเริ่มต้นของรูล (เช่น "ยิงตอนคนทัก") มีผลแค่ตอนสร้างโปรเจกต์ ตัวนี้ไล่อัปเกรด
  // โปรเจกต์เก่าให้ตรงรุ่นปัจจุบันโดยไม่ต้องรัน SQL — ทำครั้งเดียวต่อรูล และไม่แตะ
  // สวิตช์/ชื่อ event ที่ทีมตั้งเอง หน้านี้คือหน้าที่ทีมเปิดมาดูว่า "ทำไมไม่ส่ง"
  await syncRulePlatforms(projectId);
  // Single round-trip wave — `project.id` is just `projectId` from the URL, so the
  // project row no longer has to come back before the rest can be issued.
  const [project, events, eventRows] = await Promise.all([
    prisma.ltProject.findUnique({ where: { id: projectId }, select: { id: true, name: true } }),
    prisma.conversionEvent.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { lead: { select: { displayName: true } } },
    }),
    // Same grouping getProjectStats uses; only the three queue counts are needed here.
    prisma.conversionEvent.groupBy({ by: ["status"], where: { projectId }, _count: true }),
  ]);
  if (!project) notFound();
  const countOf = (status: string) => eventRows.reduce((n, r) => (r.status === status ? n + r._count : n), 0);
  const stats = { pending: countOf("PENDING"), sent: countOf("SENT"), failed: countOf("FAILED") };

  return (
    <div className="space-y-6">
      <PageHeader
        title={<>Conversion Queue · {project.name}</>}
        subtitle={<>คิวการส่ง event ไป GA4 / Google / Meta / TikTok พร้อม log และ retry</>}
        actions={<>
        <form action={processQueueAction}>
          <input type="hidden" name="projectId" value={project.id} />
          <button className="btn-primary" type="submit">⚡ Process pending queue</button>
        </form>
        </>}
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Pending" value={stats.pending} tone="warn" />
        <StatCard label="Sent" value={stats.sent} tone="good" />
        <StatCard label="Failed" value={stats.failed} tone="bad" />
        <StatCard label="Total events" value={events.length} />
      </div>

      <div className="card overflow-x-auto p-0">
        <ResizableTable storageKey="lt-conversions" className="min-w-full">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="th">Event</th>
              <th className="th">Lead</th>
              <th className="th">Platform</th>
              <th className="th">Mode</th>
              <th className="th">Status</th>
              <th className="th">Retry</th>
              <th className="th">Sent</th>
              <th className="th">Actions</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && <EmptyRow colSpan={8} text="ยังไม่มี conversion event ในคิว" />}
            {events.map((e) => {
              const isMock = (e.responsePayload ?? "").toLowerCase().includes("mock");
              return (
                <tr key={e.id} className="border-b border-slate-50 align-top">
                  <td className="td">
                    <div className="font-medium">{e.eventName}</div>
                    <div className="text-xs text-slate-400">{e.eventValue} {e.currency}</div>
                  </td>
                  <td className="td text-slate-500">{e.lead.displayName ?? "(no name)"}</td>
                  <td className="td">{platformLabel(e.platform)}</td>
                  <td className="td"><MockBadge mock={isMock} /></td>
                  <td className="td"><StatusBadge status={e.status} /></td>
                  <td className="td text-center">{e.retryCount}/3</td>
                  <td className="td text-xs text-slate-400">{e.sentAt ? fmtDate(e.sentAt) : "—"}</td>
                  <td className="td">
                    <div className="space-y-1">
                      <div className="flex flex-wrap gap-2">
                        {(e.status === "FAILED" || e.status === "PENDING") && (
                          <form action={retryEventAction}>
                            <input type="hidden" name="projectId" value={project.id} />
                            <input type="hidden" name="eventId" value={e.id} />
                            <button className="btn-secondary text-xs" type="submit">Retry</button>
                          </form>
                        )}
                        {e.status !== "SKIPPED" && e.status !== "SENT" && (
                          <form action={markSkippedAction}>
                            <input type="hidden" name="projectId" value={project.id} />
                            <input type="hidden" name="eventId" value={e.id} />
                            <button className="btn-secondary text-xs" type="submit">Skip</button>
                          </form>
                        )}
                      </div>
                      <PayloadViewer request={e.requestPayload} response={e.responsePayload} />
                      {e.lastError && (
                        <div className="max-w-xs truncate text-xs text-rose-500" title={e.lastError}>
                          {e.lastError}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </ResizableTable>
      </div>
    </div>
  );
}
