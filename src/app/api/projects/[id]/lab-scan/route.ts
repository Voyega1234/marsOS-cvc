import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { runLabScan } from "@/lib/lab-scan";
import { logAIJob } from "@/lib/logAIJob";
import { OR_MODELS } from "@/lib/openrouter";
import { prisma } from "@/lib/prisma";
import { scanUploadSite } from "@/lib/upload-article/site-scan";

export const maxDuration = 300;

/** อ่าน pushPrefs (JSON string) แบบปลอดภัย — parse ไม่ได้ = ถือว่าว่าง */
function parsePrefs(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * สแกนเว็บไซต์ลูกค้าแล้วเสนอค่าตั้งต้นของหน้า Article Lab
 * body: { url?: string, sampleUrl?: string }  — url ไม่ส่งใช้ Project.website
 * รันสแกน 2 แบบพร้อมกัน:
 *  - runLabScan: เสนอธีม/บริบทธุรกิจ/style guide (ข้อเสนอ — ไม่บันทึกเอง)
 *  - scanUploadSite: สแกนละเอียด (สีจาก CSS จริง, platform/plugins, TOC/FAQ/CTA auto-insert)
 *    ผลนี้บันทึกลง Project.pushPrefs.siteScan + ตั้ง excludeCards ให้อัตโนมัติ
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role === "CLIENT") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const project = await prisma.project.findFirst({
    where: { id: params.id, organizationId: session.user.organizationId! },
    select: { id: true, website: true, name: true },
  });
  if (!project) return NextResponse.json({ error: "ไม่พบโปรเจกต์" }, { status: 404 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const raw = (typeof body.url === "string" && body.url.trim()) || project.website || "";
  if (!raw.trim()) {
    return NextResponse.json({ error: "ยังไม่มี URL เว็บไซต์ — กรอก URL ก่อนสแกน" }, { status: 400 });
  }
  const url = /^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
  const sampleUrl = typeof body.sampleUrl === "string" ? body.sampleUrl.trim().slice(0, 500) : "";

  const [labSettled, siteSettled] = await Promise.allSettled([
    runLabScan(url, project.id),
    scanUploadSite(url, sampleUrl || undefined),
  ]);

  if (labSettled.status === "rejected" && siteSettled.status === "rejected") {
    const labErr = (labSettled.reason as Error)?.message ?? String(labSettled.reason);
    const siteErr = (siteSettled.reason as Error)?.message ?? String(siteSettled.reason);
    return NextResponse.json({ error: `สแกนไม่สำเร็จ: ${labErr} / ${siteErr}` }, { status: 502 });
  }

  const warnings: string[] = [];
  let responseBody: Record<string, unknown>;
  if (labSettled.status === "fulfilled") {
    const result = labSettled.value;
    logAIJob({
      organizationId: session.user.organizationId!,
      projectId: project.id,
      jobType: "LAB_SITE_SCAN",
      modelProvider: "OPENROUTER",
      modelName: OR_MODELS.default(),
      status: "SUCCESS",
      tokenUsed: result.usage.totalTokens,
      estimatedCost: result.usage.costUsd,
      createdById: session.user.id,
    }).catch(() => {});
    responseBody = { ...result };
  } else {
    warnings.push(`สแกนเสนอค่า Article Lab ไม่สำเร็จ: ${(labSettled.reason as Error)?.message ?? String(labSettled.reason)}`);
    responseBody = { url, suggestion: null, evidence: null, warnings: [], usage: { totalTokens: 0, costUsd: 0 } };
  }
  // รวม warnings ของ lab scan ที่ล้มเหลว (ถ้ามี) เข้ากับ warnings เดิมของผลที่สำเร็จ
  const existingWarnings = Array.isArray(responseBody.warnings) ? (responseBody.warnings as string[]) : [];
  responseBody.warnings = [...existingWarnings, ...warnings];

  if (siteSettled.status === "fulfilled") {
    const site = siteSettled.value;
    if (site.usage) {
      logAIJob({
        organizationId: session.user.organizationId!,
        projectId: project.id,
        jobType: "LAB_SITE_SCAN",
        modelProvider: "OPENROUTER",
        modelName: OR_MODELS.default(),
        status: "SUCCESS",
        tokenUsed: site.usage.totalTokens,
        estimatedCost: site.usage.costUsd,
        createdById: session.user.id,
      }).catch(() => {});
    }

    // สแกนใช้เวลาหลายนาที — pushPrefs อาจถูกทีมแก้ระหว่างนี้ ต้องล็อกแถวแล้วอ่านค่าล่าสุดก่อนแก้
    // กันค่าที่แก้ไปหาย (lost update) — ธีม/หน้าตาไม่บันทึกเอง ทีมกดรับ+บันทึกเองในหน้า Article Lab
    const c = site.scan.components;
    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ pushPrefs: string }>>`
        SELECT "pushPrefs" FROM "plans_seo_pipeline"."Project"
        WHERE "id" = ${project.id}
        FOR UPDATE`;
      if (rows.length === 0) return;
      const current = parsePrefs(rows[0].pushPrefs);
      const next = {
        ...current,
        siteScan: { ...site.scan, suggestedTheme: site.suggestedTheme, detail: site.detail },
        excludeCards: {
          ...((current.excludeCards as Record<string, boolean> | undefined) ?? {}),
          toc: c.toc.where === "auto",
          faq: c.faq.where === "auto",
          cta: c.cta.where === "auto",
        },
      };
      await tx.project.update({ where: { id: project.id }, data: { pushPrefs: JSON.stringify(next) } });
    }, { timeout: 15_000 });

    responseBody.siteScan = { scan: site.scan, suggestedTheme: site.suggestedTheme, detail: site.detail };
  } else {
    responseBody.siteScan = null;
    responseBody.siteScanError = (siteSettled.reason as Error)?.message ?? String(siteSettled.reason);
  }

  return NextResponse.json(responseBody);
}

/** ผลสแกนละเอียดล่าสุด (สำหรับแสดง "ผลสแกนล่าสุด" ตอนเปิดหน้า) */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role === "CLIENT") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const project = await prisma.project.findFirst({
    where: { id: params.id, organizationId: session.user.organizationId! },
    select: { pushPrefs: true },
  });
  if (!project) return NextResponse.json({ error: "ไม่พบโปรเจกต์" }, { status: 404 });

  const prefs = parsePrefs(project.pushPrefs);
  return NextResponse.json({
    siteScan: prefs.siteScan ?? null,
    excludeCards: prefs.excludeCards ?? null,
  });
}
