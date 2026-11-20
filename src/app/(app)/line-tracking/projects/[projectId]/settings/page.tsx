import Link from "next/link";
import { PageHeader } from "@/components/ds";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAuthSession } from "@/lib/session";
import { isLineTrackingAdmin } from "@/lib/line-tracking/access";
import { guardProjectPage } from "@/lib/line-tracking/pageGuard";
import { renameProjectAction } from "@/lib/line-tracking/actions";
import {
  PROJECT_NAME_FEATURE_LABEL,
  PROJECT_NAME_MAX,
  PROJECT_RENAME_ERROR_TEXT,
  planProjectRename,
  renameNeedsConfirm,
  type ProjectRenameError,
} from "@/lib/line-tracking/projectRename";
import { isConvertCakeProject } from "@/lib/line-tracking/services/convertCakeSheetSync";

export const dynamic = "force-dynamic";

// Project settings hub — Conversion Mapping moved here from the setup wizard so
// day-to-day configuration lives in one predictable place.
export default async function ProjectSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ renamed?: string; renameError?: string; pendingName?: string }>;
}) {
  const { projectId } = await params;
  const query = await searchParams;
  await guardProjectPage(projectId, { clientAllowed: false });
  const [project, session] = await Promise.all([
    prisma.ltProject.findUnique({ where: { id: projectId }, select: { id: true, name: true } }),
    getAuthSession(),
  ]);
  if (!project) notFound();
  const canManage = isLineTrackingAdmin(session?.user?.role);

  // Rename form feedback. A pending name comes back from renameProjectAction when the new
  // name would switch a name-keyed feature; the plan is recomputed here, never read from the URL.
  const pendingPlan = typeof query.pendingName === "string" ? planProjectRename(project.name, query.pendingName) : null;
  const pending = pendingPlan && pendingPlan.kind === "rename" && renameNeedsConfirm(pendingPlan) ? pendingPlan : null;
  const renameError =
    typeof query.renameError === "string" && query.renameError in PROJECT_RENAME_ERROR_TEXT
      ? PROJECT_RENAME_ERROR_TEXT[query.renameError as ProjectRenameError]
      : null;
  const settingsHref = `/line-tracking/projects/${project.id}/settings`;

  const items = [
    {
      href: `/line-tracking/projects/${project.id}/settings/conversion-mapping`,
      icon: "⚡",
      title: "Conversion Mapping",
      desc: "ตาราง event ทุกสถานะ Lead ต่อแพลตฟอร์ม · เปิด/ปิดกฎ · แก้ชื่อ event (standard/custom)",
      show: true,
    },
    {
      href: `/line-tracking/projects/${project.id}/settings/pdf-backfill`,
      icon: "📄",
      title: "อ่าน PDF ย้อนหลัง",
      desc: "อ่านใบเสนอราคา/ใบแจ้งหนี้/ใบเสร็จ PDF ที่ลูกค้าเคยส่งในแชท แล้วบันทึกลง Lead (เฉพาะแอดมิน)",
      show: canManage,
    },
    {
      href: `/line-tracking/projects/${project.id}/settings/sheet-status-sync`,
      icon: "📊",
      title: "ซิงก์สถานะจากชีท",
      desc: "อ่านสถานะ Lead จาก Google Sheet ของ Convert Cake ทุก 10 นาที แล้วอัปเดตสถานะในระบบตามตารางเทียบ",
      show: isConvertCakeProject(project),
    },
  ].filter((i) => i.show);

  return (
    <div className="space-y-6">
      <PageHeader title={<>⚙️ Settings · {project.name}</>} subtitle={<>ตั้งค่าโปรเจกต์ — แยกจาก Setup Wizard เพื่อให้แก้ทีหลังได้ง่าย</>} />

      <form action={renameProjectAction} className="card p-5 space-y-3">
        <input type="hidden" name="projectId" value={project.id} />
        {pending && <input type="hidden" name="confirmName" value={pending.name} />}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-600" htmlFor="project-name">
            ชื่อโปรเจกต์
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              key={pending?.name ?? project.name}
              id="project-name"
              name="name"
              required
              maxLength={PROJECT_NAME_MAX}
              defaultValue={pending?.name ?? project.name}
              readOnly={Boolean(pending)}
              className="field-input"
            />
            <button type="submit" className="btn-primary shrink-0">
              {pending ? "ยืนยันเปลี่ยนชื่อ" : "บันทึกชื่อ"}
            </button>
            {pending && (
              <Link href={settingsHref} className="btn-secondary shrink-0">
                ยกเลิก
              </Link>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            แก้ได้เฉพาะชื่อที่แสดง · ลิงก์ติดตาม (tracking link) และข้อมูล Lead เดิมไม่เปลี่ยน
          </p>
        </div>

        {pending && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <p className="font-semibold">
              เปลี่ยนชื่อจาก “{project.name}” เป็น “{pending.name}” จะเปลี่ยนการทำงานของโปรเจกต์นี้ด้วย
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {pending.turnsOn.map((f) => (
                <li key={f}>เปิด: {PROJECT_NAME_FEATURE_LABEL[f]}</li>
              ))}
              {pending.turnsOff.map((f) => (
                <li key={f}>ปิด: {PROJECT_NAME_FEATURE_LABEL[f]}</li>
              ))}
            </ul>
            <p className="mt-1">ถ้าตั้งใจแบบนี้ กด “ยืนยันเปลี่ยนชื่อ” · ถ้าไม่ใช่ กด “ยกเลิก”</p>
          </div>
        )}
        {!pending && renameError && <p className="rounded-lg bg-rose-50 p-2 text-xs text-rose-600">{renameError}</p>}
        {!pending && !renameError && query.renamed === "1" && (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-700">
            บันทึกชื่อโปรเจกต์แล้ว
          </p>
        )}
      </form>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {items.map((i) => (
          <Link
            key={i.href}
            href={i.href}
            className="card p-5 flex items-start gap-3 border border-slate-200 transition-colors hover:border-brand-blue/40 hover:bg-brand-blue/5"
          >
            <span className="text-2xl">{i.icon}</span>
            <span>
              <span className="block font-semibold text-slate-800">{i.title}</span>
              <span className="mt-0.5 block text-xs text-slate-500">{i.desc}</span>
            </span>
          </Link>
        ))}
      </div>

      <Link href={`/line-tracking/projects/${project.id}/setup`} className="btn-secondary text-sm">
        ← กลับไป Setup Wizard
      </Link>
    </div>
  );
}
