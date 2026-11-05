// โหลดข้อมูลให้ Run Test — อ่าน DB อย่างเดียว ไม่เรียก AI ไม่เขียน DB
import { prisma } from "@/lib/prisma";
import { CE_RESTRICTION_FILE, parseRestrictionFileMeta, type RestrictionsContext } from "@/lib/ce-restrictions";
import type { ClientCommentsContext } from "@/lib/ce-client-comments";
import { loadClientComments, loadRestrictions } from "@/lib/ce-restrictions-server";
import { resolveContentEngine, type CEScope } from "@/lib/content-engine-resolve";
import { OR_MODELS } from "@/lib/openrouter";
import { buildWriterDryRun, type WriterDryRun, type WriterDryRunInput } from "@/lib/ce-writer-dry-run";

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** ไฟล์ที่อัปไว้ทั้ง scope แยกตาม layer — นับเป็นไฟล์ ไม่ใช่แถว (ไฟล์ใหญ่แบ่งหลายแถว) */
async function countUploadedFiles(orgId: string, scope: CEScope): Promise<{ restrictions: number; comments: number }> {
  const rows = await prisma.promptTemplate.findMany({
    where: { organizationId: orgId, projectId: scope === "studio" ? null : scope.projectId, type: CE_RESTRICTION_FILE },
    select: { id: true, description: true },
  });
  const restrictions = new Set<string>();
  const comments = new Set<string>();
  for (const r of rows) {
    const meta = parseRestrictionFileMeta(r.description);
    (meta.kind === "comment" ? comments : restrictions).add(meta.group ?? r.id);
  }
  return { restrictions: restrictions.size, comments: comments.size };
}

export async function runWriterDryRun(
  orgId: string,
  scope: CEScope,
  task: Pick<WriterDryRunInput, "target" | "keyword" | "links" | "language" | "brandNames" | "pbn" | "structure">,
): Promise<WriterDryRun> {
  const loadErrors: NonNullable<WriterDryRunInput["loadErrors"]> = {};
  const [ce, restrictions, clientComments, uploadedFiles] = await Promise.all([
    resolveContentEngine(orgId, scope),
    loadRestrictions(orgId, scope).catch((e): RestrictionsContext | null => {
      loadErrors.restrictions = errorText(e);
      return null;
    }),
    loadClientComments(orgId, scope).catch((e): ClientCommentsContext | null => {
      loadErrors.comments = errorText(e);
      return null;
    }),
    countUploadedFiles(orgId, scope),
  ]);
  return buildWriterDryRun({ ...task, ce, restrictions, clientComments, uploadedFiles, loadErrors, model: OR_MODELS.writer() });
}
