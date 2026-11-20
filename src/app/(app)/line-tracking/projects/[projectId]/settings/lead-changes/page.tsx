import Link from "next/link";
import { PageHeader } from "@/components/ds";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { guardProjectPage } from "@/lib/line-tracking/pageGuard";
import { recentLeadChanges } from "@/lib/line-tracking/leadChangeLog";
import { LEAD_CONTACT_FIELDS, canRevert } from "@/lib/line-tracking/leadChangeDiff";
import { revertLeadChangeAction } from "@/lib/line-tracking/actions";

export const dynamic = "force-dynamic";

const FIELD_LABEL: Record<string, string> = {
  status: "สถานะ",
  fullName: "ชื่อ",
  phone: "เบอร์โทร",
  salesOwner: "เซลส์",
  value: "มูลค่า",
};

// Lead change log — who changed a lead's status or contact fields,
// with a one-click revert for contact fields. Staff only.
export default async function LeadChangesPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ by?: string }>;
}) {
  const { projectId } = await params;
  await guardProjectPage(projectId, { clientAllowed: false });
  const { by } = await searchParams;
  const clientOnly = by === "client";

  const project = await prisma.ltProject.findUnique({ where: { id: projectId }, select: { id: true, name: true } });
  if (!project) notFound();

  const changes = await recentLeadChanges(projectId, { actorType: clientOnly ? "client" : undefined });
  const leadIds = Array.from(new Set((changes ?? []).map((c) => c.leadId)));
  const leads = leadIds.length
    ? await prisma.lead.findMany({
        where: { id: { in: leadIds }, projectId },
        select: { id: true, fullName: true, displayName: true, phone: true, salesOwner: true, value: true },
      })
    : [];
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const base = `/line-tracking/projects/${project.id}/settings/lead-changes`;

  return (
    <div className="space-y-6">
      <PageHeader
        title={<>ประวัติการแก้ไข Lead · {project.name}</>}
        subtitle={<>ใครเปลี่ยนสถานะ / แก้ข้อมูลติดต่อของ Lead (ลูกค้าหรือทีมงาน)</>}
        actions={<>
        <Link href={`/line-tracking/projects/${project.id}/settings`} className="btn-secondary text-sm">
          ← Settings
        </Link>
        </>}
      />

      <div className="flex gap-3 text-sm">
        <Link href={base} className={clientOnly ? "text-slate-500 hover:underline" : "font-semibold text-slate-900"}>
          ทั้งหมด
        </Link>
        <Link href={`${base}?by=client`} className={clientOnly ? "font-semibold text-slate-900" : "text-slate-500 hover:underline"}>
          เฉพาะลูกค้า
        </Link>
      </div>

      <div className="card p-5 space-y-3">
        {changes === null ? (
          <p className="text-sm text-slate-500">
            ยังไม่เปิดใช้ — ต้องสร้างตาราง lt_lead_change ก่อน (scripts/lead-change-migrate.sql)
          </p>
        ) : changes.length === 0 ? (
          <p className="text-sm text-slate-500">ยังไม่มีการแก้ไข</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="th">เวลา</th>
                    <th className="th">Lead</th>
                    <th className="th">ช่อง</th>
                    <th className="th">ค่าเดิม</th>
                    <th className="th">ค่าใหม่</th>
                    <th className="th">โดย</th>
                    <th className="th"></th>
                  </tr>
                </thead>
                <tbody>
                  {changes.map((c) => {
                    const lead = leadById.get(c.leadId);
                    const revertable =
                      !!lead &&
                      (LEAD_CONTACT_FIELDS as readonly string[]).includes(c.field) &&
                      canRevert(c, lead);
                    return (
                      <tr key={c.id}>
                        <td className="td whitespace-nowrap">{c.createdAt.toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}</td>
                        <td className="td">{lead ? (lead.fullName ?? lead.displayName ?? c.leadId) : c.leadId}</td>
                        <td className="td">{FIELD_LABEL[c.field] ?? c.field}</td>
                        <td className="td">{c.oldValue ?? "—"}</td>
                        <td className="td">{c.newValue ?? "—"}</td>
                        <td className="td">
                          {c.actor}{" "}
                          <span
                            className={
                              "rounded px-1.5 py-0.5 text-xs " +
                              (c.actorType === "client" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600")
                            }
                          >
                            {c.actorType === "client" ? "ลูกค้า" : "ทีมงาน"}
                          </span>
                        </td>
                        <td className="td">
                          {revertable && (
                            <form action={revertLeadChangeAction}>
                              <input type="hidden" name="projectId" value={project.id} />
                              <input type="hidden" name="changeId" value={c.id} />
                              <button type="submit" className="btn-secondary text-xs">
                                คืนค่าเดิม
                              </button>
                            </form>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-500">
              การเปลี่ยนสถานะคืนค่าที่นี่ไม่ได้ ให้เปลี่ยนกลับที่หน้า Leads (Conversion ที่ส่งไปแล้วเรียกคืนไม่ได้)
            </p>
          </>
        )}
      </div>
    </div>
  );
}
