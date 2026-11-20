import Link from "next/link";
import { PageHeader } from "@/components/ds";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { guardProjectPage } from "@/lib/line-tracking/pageGuard";
import {
  getCcConfig, isConvertCakeProject, parseStatusMap, serviceAccountEmail,
} from "@/lib/line-tracking/services/convertCakeSheetSync";
import ConvertCakeSheetSyncManager from "@/components/line-tracking/ConvertCakeSheetSyncManager";

export const dynamic = "force-dynamic";
// Sheet read + dry run happen inside server actions.
export const maxDuration = 60;

export default async function SheetStatusSyncPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  await guardProjectPage(projectId, { clientAllowed: false });
  const project = await prisma.ltProject.findUnique({ where: { id: projectId }, select: { id: true, name: true } });
  if (!project || !isConvertCakeProject(project)) notFound();

  const cfg = await getCcConfig(project.id);
  const saEmail = await serviceAccountEmail(project.id);

  return (
    <div className="space-y-6">
      <PageHeader title={<>📊 ซิงก์สถานะจากชีท · {project.name}</>} subtitle={<>
          อ่านสถานะ Lead จาก Google Sheet ของ Convert Cake ทุก 10 นาที แล้วอัปเดตสถานะ Lead ในระบบตามตารางเทียบสถานะ
        </>} />

      <ConvertCakeSheetSyncManager
        projectId={project.id}
        sheetId={cfg?.sheetId ?? null}
        tabName={cfg?.tabName ?? null}
        enabled={cfg?.enabled ?? false}
        lastRunAt={cfg?.lastRunAt?.toISOString() ?? null}
        lastResult={cfg?.lastResult ?? null}
        statusMap={parseStatusMap(cfg?.statusMap)}
        saEmail={saEmail}
      />

      <Link href={`/line-tracking/projects/${project.id}/settings`} className="btn-secondary text-sm">
        ← กลับไป Settings
      </Link>
    </div>
  );
}
