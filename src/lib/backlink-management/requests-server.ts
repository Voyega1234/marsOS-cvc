/** ตัวช่วยฝั่งเซิร์ฟเวอร์สำหรับแถวคำขอและงบ */
import type { BlmRequest, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { summarizeBudget, type BudgetSummary } from "./budget";

type Db = Prisma.TransactionClient | typeof prisma;

export async function enrichRows(orgId: string, rows: BlmRequest[]) {
  const projectIds = Array.from(new Set(rows.map((r) => r.projectId)));
  const userIds = Array.from(new Set(rows.flatMap((r) => [r.requestedById, r.assigneeId]).filter((x): x is string => !!x)));
  const [projects, users] = await Promise.all([
    projectIds.length
      ? prisma.project.findMany({ where: { organizationId: orgId, id: { in: projectIds } }, select: { id: true, name: true } })
      : Promise.resolve([] as { id: string; name: string }[]),
    userIds.length
      ? prisma.user.findMany({ where: { organizationId: orgId, id: { in: userIds } }, select: { id: true, name: true, email: true } })
      : Promise.resolve([] as { id: string; name: string | null; email: string }[]),
  ]);
  const pm = new Map(projects.map((p) => [p.id, p.name]));
  const um = new Map(users.map((u) => [u.id, u.name ?? u.email]));
  return rows.map((r) => ({
    ...r,
    projectName: pm.get(r.projectId) ?? "",
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
