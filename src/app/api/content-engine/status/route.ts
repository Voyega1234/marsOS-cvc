/**
 * Content Engine readiness — บอกว่า scope นี้เขียนบทความได้หรือยัง
 *
 * GET  /api/content-engine/status?projectId=X   (ไม่ใส่ projectId = scope Studio)
 *   → layer ครบไหม, layer ไหน active, ขาดอะไร, ต่อ AI ได้หรือยัง
 *
 * POST /api/content-engine/status  { projectId?, action: "auto-activate" }
 *   → layer ที่ "มีชุดแล้วแต่ไม่มีตัวไหน active" ให้เปิดตัวล่าสุดให้อัตโนมัติ
 *     (ไม่สร้าง prompt ใหม่ — ไม่มี fallback ตามกฎ Content Engine)
 */
import fs from "fs";
import os from "os";
import path from "path";

import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const CE_TYPES = [
  "CE_BUSINESS_SKILL",
  "CE_MASTER_PROMPT",
  "CE_ARTICLE_BRIEF",
  "CE_VALIDATOR_PACK",
  "CE_IMAGE_PROMPT",
] as const;

const LABELS: Record<string, string> = {
  CE_BUSINESS_SKILL: "Business Skill",
  CE_MASTER_PROMPT: "Master Prompt",
  CE_ARTICLE_BRIEF: "Article Brief",
  CE_VALIDATOR_PACK: "Validator Pack",
  CE_IMAGE_PROMPT: "Image Prompt",
};

/** Studio ไม่บังคับ Business Skill (เป็นความรู้เฉพาะลูกค้า) — project บังคับครบ 5 */
function isRequired(type: string, isStudio: boolean): boolean {
  return isStudio ? type !== "CE_BUSINESS_SKILL" : true;
}

interface LayerStatus {
  type: string;
  label: string;
  required: boolean;
  candidates: number;
  isActive: boolean;
  activeName: string | null;
  activeVersion: number | null;
  /** มีชุดอยู่แล้วแต่ไม่มีตัวไหนเปิดใช้งาน — ซ่อมได้ด้วย auto-activate */
  fixable: boolean;
}

function aiStatus() {
  const claude = Boolean(process.env.ANTHROPIC_API_KEY);
  let gemini = false;
  const mode = process.env.VERCEL ? "oidc" : "adc";
  if (process.env.VERCEL) {
    gemini = Boolean(
      process.env.GCP_PROJECT_ID &&
        process.env.GCP_PROJECT_NUMBER &&
        process.env.GCP_SERVICE_ACCOUNT_EMAIL &&
        process.env.GCP_WORKLOAD_IDENTITY_POOL_ID &&
        process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID
    );
  } else {
    const adcPath =
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      path.join(os.homedir(), ".config", "gcloud", "application_default_credentials.json");
    gemini = Boolean(process.env.GCP_PROJECT_ID) && fs.existsSync(adcPath);
  }
  return { claude, gemini, mode };
}

async function buildStatus(orgId: string, projectId: string | null) {
  const isStudio = projectId === null;

  const rows = await prisma.promptTemplate.findMany({
    where: { organizationId: orgId, projectId, type: { in: [...CE_TYPES] } },
    select: { id: true, name: true, type: true, version: true, isActive: true },
    orderBy: [{ version: "desc" }, { updatedAt: "desc" }],
  });

  const layers: LayerStatus[] = CE_TYPES.map((type) => {
    const ofType = rows.filter((r) => r.type === type);
    const active = ofType.find((r) => r.isActive) ?? null;
    return {
      type,
      label: LABELS[type],
      required: isRequired(type, isStudio),
      candidates: ofType.length,
      isActive: Boolean(active),
      activeName: active?.name ?? null,
      activeVersion: active?.version ?? null,
      fixable: !active && ofType.length > 0,
    };
  });

  const missing = layers.filter((l) => l.required && !l.isActive).map((l) => l.label);
  const fixable = layers.filter((l) => l.required && l.fixable).map((l) => l.label);

  return {
    scope: isStudio ? ("studio" as const) : ("project" as const),
    projectId,
    ready: missing.length === 0,
    missing,
    /** ขาดเพราะยังไม่เคยสร้างเลย (auto-activate ช่วยไม่ได้ ต้องไปตั้งค่าเอง) */
    needsSetup: layers.filter((l) => l.required && !l.isActive && l.candidates === 0).map((l) => l.label),
    fixable,
    layers,
    ai: aiStatus(),
  };
}

async function resolveScope(orgId: string, rawProjectId: string | null) {
  if (!rawProjectId) return { projectId: null as string | null };
  const project = await prisma.project.findFirst({
    where: { id: rawProjectId, organizationId: orgId },
    select: { id: true },
  });
  if (!project) return null;
  return { projectId: project.id };
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rawProjectId = new URL(req.url).searchParams.get("projectId");
  const scope = await resolveScope(orgId, rawProjectId);
  if (!scope) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  return NextResponse.json(await buildStatus(orgId, scope.projectId));
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session!.user.role === "CLIENT") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const scope = await resolveScope(orgId, body.projectId ?? null);
  if (!scope) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  if (body.action !== "auto-activate") {
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }

  const rows = await prisma.promptTemplate.findMany({
    where: { organizationId: orgId, projectId: scope.projectId, type: { in: [...CE_TYPES] } },
    select: { id: true, type: true, isActive: true, name: true },
    orderBy: [{ version: "desc" }, { updatedAt: "desc" }],
  });

  const activated: string[] = [];
  for (const type of CE_TYPES) {
    const ofType = rows.filter((r) => r.type === type);
    if (!ofType.length || ofType.some((r) => r.isActive)) continue;
    const pick = ofType[0]; // เรียง version desc, updatedAt desc มาแล้ว
    await prisma.promptTemplate.update({
      where: { id: pick.id },
      data: { isActive: true, updatedById: session!.user.id },
    });
    activated.push(`${LABELS[type]} — ${pick.name}`);
  }

  if (activated.length) {
    await prisma.activityLog.create({
      data: {
        organizationId: orgId,
        userId: session!.user.id,
        action: "ACTIVATE_PROMPT",
        entityType: "PromptTemplate",
        entityId: scope.projectId ?? "studio",
        newValue: JSON.stringify({ autoActivated: activated }),
      },
    });
  }

  return NextResponse.json({ activated, ...(await buildStatus(orgId, scope.projectId)) });
}
