/** งบจากชีท Backlink Budget Tracker ↔ โปรเจกต์ใน MarsOS (ฝั่งเซิร์ฟเวอร์) */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BUDGET_TRACKER_SHEET_ID, linkTrackerProjects, planTrackerSync, type TrackerLink } from "./budget-tracker";
import { isMissingTable, listAllProjects } from "./projects";
import { normName } from "./sheet-import";
import { spreadsheetUrl } from "./sheet-import-server";

/** projectMap ที่จำไว้ (ใช้ร่วมกับตัวนำเข้าชีท) — ยังไม่มีตาราง/ยังไม่มี config = {} */
export async function loadTrackerProjectMap(orgId: string): Promise<Record<string, string>> {
  try {
    const cfg = await prisma.blmSheetImportConfig.findUnique({ where: { organizationId: orgId }, select: { projectMap: true } });
    const raw = cfg?.projectMap;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === "string") out[k] = v;
    return out;
  } catch (e) {
    if (isMissingTable(e)) return {};
    throw e;
  }
}

export interface TrackerSyncResult {
  links: Record<string, TrackerLink>;
  /** ชื่อโปรเจกต์ที่เพิ่งสร้างในรอบนี้ */
  created: string[];
  /** ตาราง BlmProject / BlmSheetImportConfig ยังไม่มี = ซิงก์ไม่ได้ (แสดงผลได้ตามปกติ) */
  skipped: boolean;
}

/**
 * ทำให้ทุกโปรเจกต์ในชีทมีในระบบ: สร้าง BlmProject ที่ยังไม่มี + จำการจับคู่ไว้ใน BlmSheetImportConfig.projectMap
 * ไม่ลบ/ไม่เปลี่ยนชื่อโปรเจกต์ที่มีอยู่ และไม่เขียนอะไรลงชีท · เรียกซ้ำได้ (ชื่อซ้ำถูกข้ามด้วย unique organizationId+name)
 */
export async function syncTrackerProjects(orgId: string, userId: string, rows: { key: string; project: string; client: string }[]): Promise<TrackerSyncResult> {
  const [projects, projectMap] = await Promise.all([listAllProjects(orgId), loadTrackerProjectMap(orgId)]);
  const plan = planTrackerSync(rows, projects, projectMap);
  if (!plan.create.length && !Object.keys(plan.link).length) {
    return { links: linkTrackerProjects(rows, projects, projectMap), created: [], skipped: false };
  }
  try {
    let created: string[] = [];
    if (plan.create.length) {
      const before = new Set(projects.map((p) => p.name));
      await prisma.blmProject.createMany({
        data: plan.create.map((c) => ({ organizationId: orgId, name: c.name, clientName: c.clientName, note: "นำเข้าจาก Google Sheet", createdById: userId })),
        skipDuplicates: true,
      });
      // อ่าน id จริงกลับมา (อีกคำขอหนึ่งอาจสร้างชื่อเดียวกันไปก่อน)
      const rowsNow = await prisma.blmProject.findMany({ where: { organizationId: orgId, name: { in: plan.create.map((c) => c.name) } }, select: { id: true, name: true } });
      const byNorm = new Map(rowsNow.map((p) => [normName(p.name), p.id]));
      for (const c of plan.create) {
        const id = byNorm.get(normName(c.name));
        if (id) plan.link[c.key] = id;
      }
      created = plan.create.map((c) => c.name).filter((n) => !before.has(n) && byNorm.has(normName(n)));
    }
    const map = { ...projectMap, ...plan.link };
    const configData = { projectMap: map as Prisma.InputJsonValue };
    await prisma.blmSheetImportConfig.upsert({
      where: { organizationId: orgId },
      create: { organizationId: orgId, spreadsheetId: BUDGET_TRACKER_SHEET_ID, spreadsheetUrl: spreadsheetUrl(BUDGET_TRACKER_SHEET_ID), ...configData },
      update: configData,
    });
    const after = await listAllProjects(orgId);
    return { links: linkTrackerProjects(rows, after, map), created, skipped: false };
  } catch (e) {
    if (isMissingTable(e)) return { links: linkTrackerProjects(rows, projects, projectMap), created: [], skipped: true };
    throw e;
  }
}
