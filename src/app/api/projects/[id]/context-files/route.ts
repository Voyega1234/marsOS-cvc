import { NextRequest, NextResponse } from "next/server";

import { CE_TYPES, tryParse } from "@/components/settings/content-engine/types";
import type { BusinessSkillData } from "@/components/settings/content-engine/types";
import { getSession } from "@/lib/auth";
import { stripCompiledKeys } from "@/lib/ce-compiled-fields";
import { analyzeContextFiles, businessSkillDraftToText, mergeBusinessSkill } from "@/lib/context-business-skill";
import { extractText, type ContextTextInput } from "@/lib/context-files";
import { logAIJob } from "@/lib/logAIJob";
import { OR_MODELS } from "@/lib/openrouter";
import { prisma } from "@/lib/prisma";
import { snapshotPrompt } from "@/services/prompts";

export const maxDuration = 300;

const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB ต่อไฟล์
const MAX_TOTAL_BYTES = 4 * 1024 * 1024; // 4MB รวม — กัน Vercel body limit 4.5MB (413 เงียบ)
const ALLOWED_EXT = [".csv", ".pdf"];

/**
 * อ่านไฟล์ CSV/PDF ที่ทีมลากมาวางใน Article Lab แล้ว
 * 1) สรุปเป็น Project Context (ข้อความ) ให้ทีมกดใส่ฟอร์มเอง
 * 2) เติมลง Business Skill ของโปรเจกต์นี้ — เติมช่องว่าง + ต่อท้ายช่องที่มีข้อมูลแล้ว
 *    (ไม่ลบของเดิม) แล้วบันทึกลง DB ทันที (มี snapshot เวอร์ชันเดิมเก็บไว้)
 * body: multipart/form-data
 *   - "texts": JSON [{name, kind: "pdf"|"csv", text, pages?}] ข้อความที่เบราว์เซอร์อ่านมาแล้ว (ทางหลัก ไฟล์ใหญ่แค่ไหนก็ได้)
 *   - "files": ไฟล์ดิบ (ทางสำรองเมื่อเบราว์เซอร์อ่านเองไม่ได้ — ไฟล์ละไม่เกิน 10MB รวมไม่เกิน 4MB)
 *   รวมกันสูงสุด 5 ไฟล์
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role === "CLIENT") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const project = await prisma.project.findFirst({
    where: { id: params.id, organizationId: session.user.organizationId! },
    select: { id: true, name: true },
  });
  if (!project) return NextResponse.json({ error: "ไม่พบโปรเจกต์" }, { status: 404 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "อ่านไฟล์ที่ส่งมาไม่ได้" }, { status: 400 });
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  // ข้อความที่เบราว์เซอร์อ่านจาก PDF/CSV มาให้แล้ว — ไฟล์ใหญ่ไม่ต้องส่งทั้งก้อน
  let texts: ContextTextInput[] = [];
  const rawTexts = form.get("texts");
  if (typeof rawTexts === "string" && rawTexts) {
    try {
      const parsed = JSON.parse(rawTexts);
      if (!Array.isArray(parsed)) throw new Error("not an array");
      texts = parsed
        .filter((t) => t && typeof t.name === "string" && typeof t.text === "string" && (t.kind === "pdf" || t.kind === "csv"))
        .map((t) => ({ name: t.name, kind: t.kind, text: t.text, pages: typeof t.pages === "number" ? t.pages : undefined }));
    } catch {
      return NextResponse.json({ error: "อ่านข้อความจากไฟล์ที่ส่งมาไม่ได้" }, { status: 400 });
    }
  }
  if (files.length + texts.length === 0) {
    return NextResponse.json({ error: "ยังไม่ได้เลือกไฟล์ — วางไฟล์ .csv หรือ .pdf ก่อน" }, { status: 400 });
  }
  if (files.length + texts.length > MAX_FILES) {
    return NextResponse.json({ error: `เลือกไฟล์ได้สูงสุด ${MAX_FILES} ไฟล์ต่อครั้ง` }, { status: 400 });
  }
  for (const t of texts) {
    const ext = "." + (t.name.split(".").pop()?.toLowerCase() ?? "");
    if (!ALLOWED_EXT.includes(ext)) {
      return NextResponse.json({ error: `ไฟล์ "${t.name}" ไม่รองรับ — ใช้ได้เฉพาะ .csv และ .pdf` }, { status: 400 });
    }
  }

  let totalBytes = 0;
  for (const f of files) {
    const ext = "." + (f.name.split(".").pop()?.toLowerCase() ?? "");
    if (!ALLOWED_EXT.includes(ext)) {
      return NextResponse.json({ error: `ไฟล์ "${f.name}" ไม่รองรับ — ใช้ได้เฉพาะ .csv และ .pdf` }, { status: 400 });
    }
    if (f.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: `ไฟล์ "${f.name}" ใหญ่เกินไป (สูงสุด 10MB ต่อไฟล์)` }, { status: 400 });
    }
    totalBytes += f.size;
  }
  if (totalBytes > MAX_TOTAL_BYTES) {
    return NextResponse.json(
      { error: `ไฟล์รวมกันใหญ่เกิน 4MB (ตอนนี้ ${(totalBytes / 1024 / 1024).toFixed(1)}MB) — ลดจำนวนไฟล์หรือบีบอัดก่อนอัปโหลด` },
      { status: 413 }
    );
  }

  const inputs = await Promise.all(
    files.map(async (f) => ({
      name: f.name,
      mime: f.type || "",
      buffer: Buffer.from(await f.arrayBuffer()),
    }))
  );

  const { combinedText, warnings: extractWarnings } = await extractText(inputs, texts);
  if (!combinedText.trim()) {
    return NextResponse.json({ error: "อ่านเนื้อหาจากไฟล์ที่ส่งมาไม่ได้เลย" }, { status: 422 });
  }

  let ai;
  try {
    ai = await analyzeContextFiles([...texts.map((t) => t.name), ...inputs.map((f) => f.name)], combinedText);
    logAIJob({
      organizationId: session.user.organizationId!,
      projectId: project.id,
      jobType: "CONTEXT_FILES_ANALYZE",
      modelProvider: "OPENROUTER",
      modelName: OR_MODELS.default(),
      status: "SUCCESS",
      tokenUsed: ai.usage.totalTokens,
      estimatedCost: ai.usage.costUsd,
      createdById: session.user.id,
    }).catch(() => {});
  } catch (err) {
    return NextResponse.json({ error: `สรุปข้อมูลจากไฟล์ไม่สำเร็จ: ${(err as Error).message}` }, { status: 502 });
  }

  const warnings = [...extractWarnings, ...ai.warnings];

  // ── บันทึกลง Business Skill ของโปรเจกต์นี้ ──────────────────────────────
  const existing = await prisma.promptTemplate.findFirst({
    where: {
      organizationId: session.user.organizationId!,
      projectId: project.id,
      type: CE_TYPES.BUSINESS_SKILL,
      isActive: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  const existingData = existing ? tryParse<BusinessSkillData>(existing.promptText) : null;
  // ชุด Active บางชุดเก็บเป็นข้อความอิสระ (โหมด raw ไม่ใช่ JSON ฟอร์ม) — ห้ามแปลงเป็น JSON ทับของเดิม
  // เจอกรณีนี้ให้ต่อท้ายข้อความแทน ไม่แตะเนื้อหาเดิมเลย
  const isRawExisting = Boolean(existing) && !existingData && Boolean(existing!.promptText.trim());
  let promptText: string;
  let merged: BusinessSkillData | null = null;
  if (isRawExisting) {
    const appendText = businessSkillDraftToText(ai.businessSkill);
    const today = new Date().toISOString().slice(0, 10);
    promptText = appendText
      ? `${existing!.promptText}\n\n--- เพิ่มจากไฟล์ลูกค้า (${today}) ---\n${appendText}`
      : existing!.promptText;
  } else {
    merged = mergeBusinessSkill(existingData, ai.businessSkill);
    // ผล compile รอบก่อน (_compiledPrompt) ผูกกับฟอร์มเก่า — ถ้าปล่อยติดไป resolver จะใช้ข้อความเก่า
    // และข้อมูลจากไฟล์จะไม่ถูกส่งเข้า prompt เลย จึงตัดออก ให้ทีมกด compile ใหม่จากฟอร์มที่รวมแล้ว
    promptText = JSON.stringify(stripCompiledKeys(merged as unknown as Record<string, unknown>));
  }

  let promptId: string;
  let promptName: string;
  let created: boolean;

  if (existing) {
    await snapshotPrompt(existing.id, session.user.id, "อัปเดตจากไฟล์ลูกค้า (Article Lab)");
    const updated = await prisma.promptTemplate.update({
      where: { id: existing.id },
      data: {
        promptText,
        version: existing.version + 1,
        updatedById: session.user.id,
      },
    });
    promptId = updated.id;
    promptName = existing.name;
    created = false;

    await prisma.activityLog.create({
      data: {
        organizationId: session.user.organizationId!,
        userId: session.user.id,
        action: "UPDATE_PROMPT",
        entityType: "PromptTemplate",
        entityId: updated.id,
        oldValue: JSON.stringify({ version: existing.version }),
        newValue: JSON.stringify({ version: updated.version, changeNote: "context-files" }),
      },
    });
  } else {
    const createdRow = await prisma.promptTemplate.create({
      data: {
        name: "Business Skill จากไฟล์ลูกค้า",
        type: CE_TYPES.BUSINESS_SKILL,
        description: ai.summary || "สร้างอัตโนมัติจากไฟล์ที่ทีมอัปโหลดใน Article Lab",
        promptText,
        variables: "[]",
        modelProvider: "CLAUDE",
        modelName: "claude-sonnet-4-6",
        temperature: 0.7,
        maxTokens: 4000,
        isActive: true,
        version: 1,
        organizationId: session.user.organizationId!,
        createdById: session.user.id,
        projectId: project.id,
      },
    });
    promptId = createdRow.id;
    promptName = createdRow.name;
    created = true;

    await prisma.activityLog.create({
      data: {
        organizationId: session.user.organizationId!,
        userId: session.user.id,
        action: "CREATE_PROMPT",
        entityType: "PromptTemplate",
        entityId: createdRow.id,
        newValue: JSON.stringify({ name: createdRow.name, type: createdRow.type }),
      },
    });
  }

  return NextResponse.json({
    projectContext: ai.projectContext,
    businessSkill: merged,
    promptId,
    promptName,
    created,
    summary: ai.summary,
    warnings,
  });
}
