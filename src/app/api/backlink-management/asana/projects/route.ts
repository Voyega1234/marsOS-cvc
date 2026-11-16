import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaff, isCtx } from "@/lib/backlink-management/server";
import { listProjects, getProject, resolveToken, AsanaError, type AsanaProjectOption } from "@/lib/backlink-management/asana";
import { asanaProjectGidFromInput } from "@/lib/backlink-management/asana-link";
import { isMissingTable } from "@/lib/backlink-management/projects";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ProjectOut = AsanaProjectOption & { saved?: boolean };
const NO_TOKEN = "ยังไม่มี Asana token — กรอก token ก่อน หรือให้ผู้ดูแลตั้ง ASANA_ACCESS_TOKEN บนเซิร์ฟเวอร์";

export async function GET() {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    const config = await prisma.blmAsanaConfig.findUnique({ where: { organizationId: ctx.orgId } });
    const token = resolveToken(config);
    if (!token) return NextResponse.json({ error: NO_TOKEN }, { status: 400 });
    let projects: AsanaProjectOption[] = [];
    let truncated = false;
    let asanaError: string | undefined;
    try {
      ({ projects, truncated } = await listProjects(token));
    } catch (e) {
      console.error("[blm asana list projects]", e);
      asanaError = "ดึงรายการโปรเจกต์จาก Asana ไม่สำเร็จ — แสดงเฉพาะที่บันทึกไว้";
    }
    // โปรเจกต์ที่ผู้ใช้วางลิงก์บันทึกไว้ — ขึ้นก่อนเสมอ; ตารางยังไม่มี/อ่านพลาดไม่ทำให้รายการล่ม
    let saved: { projectGid: string; projectName: string; workspaceName: string }[] = [];
    try {
      saved = await prisma.blmAsanaSavedProject.findMany({ where: { organizationId: ctx.orgId }, orderBy: { createdAt: "desc" } });
    } catch (e) {
      if (!isMissingTable(e)) console.error("[blm asana saved projects]", e);
    }
    const byGid = new Map(projects.map((p) => [p.gid, p]));
    const seen = new Set<string>();
    const out: ProjectOut[] = [];
    for (const s of saved) {
      if (seen.has(s.projectGid)) continue;
      seen.add(s.projectGid);
      const p = byGid.get(s.projectGid);
      out.push(p ? { ...p, saved: true } : { gid: s.projectGid, name: s.projectName || s.projectGid, workspaceName: s.workspaceName, teamName: "", saved: true });
    }
    for (const p of projects) {
      if (seen.has(p.gid)) continue;
      seen.add(p.gid);
      out.push(p);
    }
    return NextResponse.json(asanaError ? { projects: out, truncated, asanaError } : { projects: out, truncated });
  } catch (e) {
    const msg = e instanceof AsanaError ? `Asana: ${e.message}` : "โหลดรายการโปรเจกต์ Asana ไม่สำเร็จ";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** วางลิงก์โปรเจกต์ Asana → ตรวจว่าเปิดได้จริง แล้วบันทึกให้ขึ้นในรายการทุกครั้ง */
export async function POST(req: Request) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  let link: unknown;
  try { link = ((await req.json()) as { link?: unknown })?.link; } catch { link = ""; }
  const gid = asanaProjectGidFromInput(String(link ?? ""));
  if (!gid) return NextResponse.json({ error: "ลิงก์โปรเจกต์ Asana ไม่ถูกต้อง — เปิดโปรเจกต์ใน Asana แล้วคัดลอกลิงก์มาวาง" }, { status: 400 });
  let token: string | null;
  try {
    const config = await prisma.blmAsanaConfig.findUnique({ where: { organizationId: ctx.orgId } });
    token = resolveToken(config);
  } catch {
    return NextResponse.json({ error: "โหลดการตั้งค่า Asana ไม่สำเร็จ" }, { status: 500 });
  }
  if (!token) return NextResponse.json({ error: NO_TOKEN }, { status: 400 });
  let p: { gid: string; name: string };
  try {
    p = await getProject(token, gid);
    if (!p?.gid) throw new Error("no project");
  } catch (e) {
    return NextResponse.json({ error: "เปิดโปรเจกต์นี้ใน Asana ไม่ได้ — ตรวจว่าบัญชี Asana ของระบบเข้าถึงโปรเจกต์นี้ได้" + (e instanceof AsanaError ? ` (${e.message})` : "") }, { status: 400 });
  }
  try {
    await prisma.blmAsanaSavedProject.upsert({
      where: { organizationId_projectGid: { organizationId: ctx.orgId, projectGid: p.gid } },
      create: { organizationId: ctx.orgId, projectGid: p.gid, projectName: p.name, addedById: ctx.userId },
      update: { projectName: p.name },
    });
  } catch (e) {
    if (isMissingTable(e)) return NextResponse.json({ error: "ยังไม่ได้สร้างตารางในฐานข้อมูล — ให้ผู้ดูแลรัน scripts/sql/add-blm-quota-asana-tables.sql ใน Supabase", tableMissing: true }, { status: 503 });
    return NextResponse.json({ error: "บันทึกโปรเจกต์ไม่สำเร็จ" }, { status: 500 });
  }
  const project: ProjectOut = { gid: p.gid, name: p.name, workspaceName: "", teamName: "", saved: true };
  return NextResponse.json({ project });
}
