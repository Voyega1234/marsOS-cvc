/**
 * Data Brain Files API
 * GET  — list files
 * POST — upload file (text extraction, AI summary)
 * DELETE /:id — remove file
 */
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAIJob } from "@/lib/logAIJob";

// Claude Opus 4.8 pricing: $5/1M input, $25/1M output
const CLAUDE_INPUT_COST  = 5 / 1_000_000
const CLAUDE_OUTPUT_COST = 25 / 1_000_000

async function generateAISummary(
  text: string, fileName: string, orgId: string, userId: string, projectId: string | null
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !text.trim()) return `ไฟล์: ${fileName} (${text.length} ตัวอักษร)`;
  try {
    const model = process.env.ANTHROPIC_MODEL || "claude-opus-4-8"
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model,
      max_tokens: 400,
      messages: [{
        role: "user",
        content: `สรุปเนื้อหาของไฟล์นี้เป็นภาษาไทย ใน 2-3 ประโยค บอกประเด็นหลักและประโยชน์ที่ใช้ได้:\n\n${text.slice(0, 4000)}`,
      }],
    });

    const inputTokens  = msg.usage?.input_tokens  ?? 0
    const outputTokens = msg.usage?.output_tokens ?? 0
    const cost = (inputTokens * CLAUDE_INPUT_COST) + (outputTokens * CLAUDE_OUTPUT_COST)
    logAIJob({
      organizationId: orgId, createdById: userId,
      projectId: projectId ?? null,
      jobType: 'DATA_BRAIN_SUMMARY', modelProvider: 'CLAUDE', modelName: model,
      status: 'SUCCESS', tokenUsed: inputTokens + outputTokens, estimatedCost: cost,
      inputSummary: `Data Brain summary — ${fileName}`,
    }).catch(() => {})

    return msg.content[0].type === "text" ? msg.content[0].text.trim() : `ไฟล์: ${fileName}`;
  } catch {
    return `ไฟล์: ${fileName} (${text.length} ตัวอักษร)`;
  }
}

export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const files = await prisma.dataBrainFile.findMany({
    where: { organizationId: session.user.organizationId, isActive: true },
    select: {
      id: true, name: true, originalName: true, mimeType: true,
      sizeBytes: true, summary: true, tags: true, projectId: true,
      isActive: true, createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(files);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId  = session.user.organizationId;
  const userId = session.user.id;

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const name = formData.get("name") as string | null;
  const projectId = formData.get("projectId") as string | null;
  const tagsRaw   = formData.get("tags") as string | null;

  if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });

  // Extract text (plain text / CSV / simple HTML support)
  let extractedText = "";
  const mime = file.type;
  if (mime === "text/plain" || mime === "text/csv" || file.name.endsWith(".txt") || file.name.endsWith(".csv")) {
    extractedText = await file.text();
  } else if (mime === "text/html" || file.name.endsWith(".html")) {
    const html = await file.text();
    extractedText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  } else {
    try {
      const raw = await file.text();
      const cleaned = raw.replace(/[^\x20-\x7E฀-๿\n\r\t]/g, " ").replace(/\s+/g, " ").trim();
      extractedText = cleaned.length > 100 ? cleaned : "";
    } catch { /* ignore */ }
    if (!extractedText) {
      extractedText = `ไฟล์ ${file.name} (${(file.size / 1024).toFixed(1)} KB) — ไม่สามารถ extract text จาก PDF/DOCX ได้โดยตรง กรุณาแปลงเป็น .txt หรือ copy-paste เนื้อหามาแทน`;
    }
  }

  const summary = await generateAISummary(extractedText, file.name, orgId, userId, projectId ?? null);

  const record = await prisma.dataBrainFile.create({
    data: {
      organizationId: orgId,
      projectId:      projectId || null,
      name:           name || file.name,
      originalName:   file.name,
      mimeType:       mime || "application/octet-stream",
      sizeBytes:      file.size,
      extractedText:  extractedText.slice(0, 50000),
      summary:        summary.slice(0, 1000),
      tags:           tagsRaw || "[]",
      uploadedById:   userId,
    },
    select: { id: true, name: true, originalName: true, mimeType: true, sizeBytes: true, summary: true, tags: true, createdAt: true },
  });

  return NextResponse.json(record, { status: 201 });
}
