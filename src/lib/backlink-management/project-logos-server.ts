/** โลโก้โปรเจกต์ของ Backlink Management ฝั่งเซิร์ฟเวอร์ (อ่าน/บันทึก) */
import { prisma } from "@/lib/prisma";
import { isMissingTable } from "./projects";
import { normName } from "./sheet-import";

export async function listStoredLogos(orgId: string): Promise<Array<{ name: string; projectId: string | null; logo: string }>> {
  try {
    const rows = await prisma.blmProjectLogo.findMany({
      where: { organizationId: orgId },
      select: { name: true, projectId: true, logo: true },
    });
    return rows;
  } catch (e) {
    if (isMissingTable(e)) return [];
    throw e;
  }
}

const MISSING_LOGO_TABLE =
  "ยังเก็บโลโก้ของโปรเจกต์นี้ไม่ได้ ต้องรัน scripts/sql/add-blm-project-logo-table.sql ใน Supabase 1 ครั้งก่อน";

/**
 * Saves (or clears, when logo is null) a project logo.
 * NOTE: the caller must pass an already validated logo; this function does not validate the format.
 */
export async function saveProjectLogo(
  orgId: string,
  userId: string,
  input: { projectId?: string | null; name?: string | null; logo: string | null },
): Promise<{ ok: true; target: "project" | "blm" } | { ok: false; status: number; error: string }> {
  let name = "";
  let projectId: string | null = null;

  if (typeof input.projectId === "string" && input.projectId) {
    const sys = await prisma.project.findFirst({
      where: { id: input.projectId, organizationId: orgId },
      select: { id: true },
    });
    if (sys) {
      await prisma.project.update({ where: { id: sys.id }, data: { logoUrl: input.logo } });
      return { ok: true, target: "project" };
    }
    let manual: { id: string; name: string } | null = null;
    try {
      manual = await prisma.blmProject.findFirst({
        where: { id: input.projectId, organizationId: orgId },
        select: { id: true, name: true },
      });
    } catch (e) {
      if (!isMissingTable(e)) throw e;
    }
    if (!manual) return { ok: false, status: 404, error: "ไม่พบโปรเจกต์" };
    name = manual.name;
    projectId = manual.id;
  } else {
    name = String(input.name ?? "").trim().slice(0, 200);
  }

  const nameKey = normName(name);
  if (!nameKey) return { ok: false, status: 400, error: "ไม่พบชื่อโปรเจกต์" };

  try {
    if (input.logo === null) {
      await prisma.blmProjectLogo.deleteMany({ where: { organizationId: orgId, nameKey } });
    } else {
      await prisma.blmProjectLogo.upsert({
        where: { organizationId_nameKey: { organizationId: orgId, nameKey } },
        create: { organizationId: orgId, nameKey, name, projectId, logo: input.logo, updatedById: userId },
        update: { name, projectId, logo: input.logo, updatedById: userId },
      });
    }
  } catch (e) {
    if (isMissingTable(e)) return { ok: false, status: 409, error: MISSING_LOGO_TABLE };
    throw e;
  }
  return { ok: true, target: "blm" };
}
