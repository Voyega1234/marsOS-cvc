/** ตัวช่วยฝั่งเซิร์ฟเวอร์สำหรับแถวคำขอและงบ */
import type { BlmRequest, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { projectInfo } from "./projects";
import { summarizeBudget, type BudgetSummary } from "./budget";

type Db = Prisma.TransactionClient | typeof prisma;

export async function enrichRows(orgId: string, rows: BlmRequest[]) {
  const projectIds = Array.from(new Set(rows.map((r) => r.projectId)));
  const userIds = Array.from(new Set(rows.flatMap((r) => [r.requestedById, r.assigneeId]).filter((x): x is string => !!x)));
  const [pm, users] = await Promise.all([
    projectInfo(orgId, projectIds),
    userIds.length
      ? prisma.user.findMany({ where: { organizationId: orgId, id: { in: userIds } }, select: { id: true, name: true, email: true } })
      : Promise.resolve([] as { id: string; name: string | null; email: string }[]),
  ]);
  const um = new Map(users.map((u) => [u.id, u.name ?? u.email]));
  return rows.map((r) => ({
    ...r,
    projectName: pm.get(r.projectId)?.name ?? "",
    assigneeName: r.assigneeId ? um.get(r.assigneeId) ?? "" : "",
    requestedByName: um.get(r.requestedById) ?? "",
  }));
}

export async function enrichOne(orgId: string, id: string) {
  const row = await prisma.blmRequest.findFirst({ where: { id, organizationId: orgId } });
  if (!row) return null;
  return (await enrichRows(orgId, [row]))[0];
}

/** สรุปงบของ (project, period); override = สมมติว่าคำขอนี้มีสถานะ/ราคาตามที่ระบุ */
export async function budgetFor(
  db: Db,
  orgId: string,
  projectId: string,
  period: string,
  override?: { id: string; status: string; quotedPrice: number; actualPrice: number | null },
): Promise<{ summary: BudgetSummary; hasBudgetRow: boolean }> {
  const [budget, rows] = await Promise.all([
    db.blmBudget.findUnique({ where: { organizationId_projectId_period: { organizationId: orgId, projectId, period } } }),
    db.blmRequest.findMany({
      where: { organizationId: orgId, projectId, budgetPeriod: period },
      select: { id: true, status: true, quotedPrice: true, actualPrice: true },
    }),
  ]);
  const list = rows.filter((r) => !override || r.id !== override.id);
  if (override) list.push(override);
  return { summary: summarizeBudget(budget?.approvedAmount ?? 0, list), hasBudgetRow: !!budget };
}
