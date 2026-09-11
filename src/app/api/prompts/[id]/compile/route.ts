import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import {
  compileCePrompt,
  isCompilableType,
  stripCompiledKeys,
  withCompiled,
} from "@/lib/ce-compile";
import { prisma } from "@/lib/prisma";
import { canEditPrompts } from "@/services/prompts";

export const maxDuration = 300;

/**
 * เรียบเรียงคำตอบจากฟอร์มเป็น prompt เต็ม แล้วเก็บลงแถวเดิม
 * body: { promptText?: string }  — ส่ง draft ปัจจุบันมาได้ ไม่ส่งใช้ค่าที่บันทึกไว้
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canEditPrompts(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const orgId = session.user.organizationId!;
  const row = await prisma.promptTemplate.findFirst({
    where: { id: params.id, organizationId: orgId },
    select: { id: true, name: true, type: true, promptText: true, projectId: true },
  });
  if (!row) return NextResponse.json({ error: "ไม่พบ prompt" }, { status: 404 });

  if (!isCompilableType(row.type)) {
    return NextResponse.json({ error: "ชั้นนี้ไม่รองรับการ compile" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const source = typeof body.promptText === "string" && body.promptText.trim()
    ? body.promptText
    : row.promptText;

  let data: Record<string, unknown>;
  try {
    const parsed = JSON.parse(source);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not object");
    data = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "compile ได้เฉพาะชั้นที่กรอกด้วยฟอร์ม (โหมดวาง Prompt ดิบใช้ข้อความที่วางไว้ตรง ๆ อยู่แล้ว)" },
      { status: 400 },
    );
  }

  if (!Object.keys(stripCompiledKeys(data)).length) {
    return NextResponse.json({ error: "ฟอร์มยังว่าง ไม่มีอะไรให้ compile" }, { status: 400 });
  }

  let compiled: string;
  try {
    const res = await compileCePrompt({
      type: row.type,
      data,
      name: row.name,
      client: row.projectId ?? undefined,
    });
    compiled = res.text;
  } catch (err) {
    return NextResponse.json(
      { error: `compile ไม่สำเร็จ: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  const nextText = JSON.stringify(withCompiled(data, compiled));
  await prisma.promptTemplate.update({
    where: { id: row.id },
    data: { promptText: nextText, updatedById: session.user.id },
  });

  await prisma.activityLog.create({
    data: {
      organizationId: orgId,
      userId: session.user.id,
      action: "COMPILE_PROMPT",
      entityType: "PromptTemplate",
      entityId: row.id,
      newValue: JSON.stringify({ name: row.name, type: row.type, chars: compiled.length }),
    },
  });

  return NextResponse.json({ compiled, promptText: nextText });
}
