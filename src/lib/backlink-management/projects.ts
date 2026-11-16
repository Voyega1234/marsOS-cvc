/** โปรเจกต์ของ Backlink Management = ตาราง Project เดิม + โปรเจกต์ที่เพิ่มเอง (BlmProject) */
import { prisma } from "@/lib/prisma";

export interface BlmProjectRef { id: string; name: string; clientName: string; manual: boolean }

/** ตาราง BlmProject ยังไม่ถูกสร้างในฐานข้อมูล (Prisma P2021) */
export function isMissingTable(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2021";
}

export async function listManualProjects(orgId: string) {
  try {
    return await prisma.blmProject.findMany({ where: { organizationId: orgId }, orderBy: { name: "asc" } });
  } catch (e) {
    if (isMissingTable(e)) return [];
    throw e;
  }
}

export async function listAllProjects(orgId: string): Promise<BlmProjectRef[]> {
  const [system, manual] = await Promise.all([
    prisma.project.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, clientName: true },
      orderBy: { name: "asc" },
    }),
    listManualProjects(orgId),
  ]);
  return [
    ...system.map((p) => ({ id: p.id, name: p.name, clientName: p.clientName ?? "", manual: false })),
    ...manual.map((p) => ({ id: p.id, name: p.name, clientName: p.clientName ?? "", manual: true })),
  ].sort((a, b) => a.name.localeCompare(b.name, "th"));
}

export async function findProject(orgId: string, id: string): Promise<BlmProjectRef | null> {
  if (!id) return null;
  const sys = await prisma.project.findFirst({ where: { id, organizationId: orgId }, select: { id: true, name: true, clientName: true } });
  if (sys) return { id: sys.id, name: sys.name, clientName: sys.clientName ?? "", manual: false };
  try {
    const m = await prisma.blmProject.findFirst({ where: { id, organizationId: orgId } });
    return m ? { id: m.id, name: m.name, clientName: m.clientName, manual: true } : null;
  } catch (e) {
    if (isMissingTable(e)) return null;
    throw e;
  }
}

export async function projectInfo(orgId: string, ids: string[]): Promise<Map<string, { name: string; clientName: string; manual: boolean }>> {
  const out = new Map<string, { name: string; clientName: string; manual: boolean }>();
  if (!ids.length) return out;
  const sys = await prisma.project.findMany({ where: { organizationId: orgId, id: { in: ids } }, select: { id: true, name: true, clientName: true } });
  for (const p of sys) out.set(p.id, { name: p.name, clientName: p.clientName ?? "", manual: false });
  const rest = ids.filter((id) => !out.has(id));
  if (rest.length) {
    try {
      const ms = await prisma.blmProject.findMany({ where: { organizationId: orgId, id: { in: rest } } });
      for (const p of ms) out.set(p.id, { name: p.name, clientName: p.clientName, manual: true });
    } catch (e) {
      if (!isMissingTable(e)) throw e;
    }
  }
  return out;
}
