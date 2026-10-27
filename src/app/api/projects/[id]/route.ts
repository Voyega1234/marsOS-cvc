import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { clientCanAccessProject } from "@/lib/client-access";
import { prisma } from "@/lib/prisma";
import { SECRET_MASK, domainBoundSecretMissing, maskProjectSecrets, mergeSiteConnectionSecrets } from "@/lib/secret-mask";
import { encryptProjectWpPassword } from "@/lib/project-wp-credentials";
import { mergeTimelineWrite } from "@/lib/project-timeline";
import { logActivity } from "@/lib/logActivity";
import { stripServerOwnedPrefs, updateProjectPrefs } from "@/lib/project-prefs-store";
import { checkCredentialUrl } from "@/lib/upload-article/safe-fetch";
import { normalizeSavedWpUrl } from "@/lib/upload-article/wp-push";

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  // CLIENT อ่านได้เฉพาะโปรเจกต์ที่ถูก assign เท่านั้น (role อื่นไม่เปลี่ยน)
  if (!(await clientCanAccessProject(session, params.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  

  const project = await prisma.project.findFirst({
    where: { id: params.id, organizationId: session!.user.organizationId ?? "" },
    include: {
      defaultTemplate: true,
      wordpressConnection: true,
      owner: { select: { id: true, name: true } },
      members: { include: { user: { select: { id: true, name: true, role: true } } } },
      _count: { select: { articles: true, keywords: true } },
    },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // ปิดบังรหัส WordPress — UI ใช้แค่เช็คว่ามีรหัสเก็บไว้แล้ว (รหัสใน wordpressConnection ก็ไม่ส่งออก)
  const { wordpressConnection, ...rest } = maskProjectSecrets(project);
  return NextResponse.json({
    ...rest,
    wordpressConnection: wordpressConnection
      ? { ...wordpressConnection, appPasswordEncrypted: undefined }
      : wordpressConnection,
  });
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = session!.user.organizationId;
  const existing = await prisma.project.findFirst({ where: { id: params.id, organizationId: orgId }, select: { id: true, timeline: true, pushPrefs: true, wpUrl: true, siteConnection: true } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  // Allowlist — prevent overwriting organizationId or sensitive relations
  const allowed = ["name", "website", "businessType", "targetAudience", "language", "industry", "market",
    // writingPrompt ถูกถอดออกจาก allowlist — ไม่มีใครอ่านค่านี้แล้ว (prompt มาจาก Content Engine)
    "status", "notes", "projectContext", "imageStyleGuide", "automationMode",
    "gtmContainerId", "ga4MeasurementId", "ga4PropertyId", "gscSiteUrl", "internalLinks", "themeColors",
    "wordpressConnectionId", "defaultTemplateId", "ownerId", "clientName",
    "monthlyTarget", "aiCostLimit", "slackWebhookUrl", "defaultWriterId", "defaultReviewerId",
    "wpUrl", "wpUser", "wpAppPassword", "websitePlatform", "pushPrefs", "siteConnection",
    "timeline", "autoSchedule",
    "styleGuide", "accentColor", "articleTheme", "forbiddenWords", "sampleArticle"];
  const data: Record<string, unknown> = {};
  for (const key of allowed) { if (key in body) data[key] = body[key]; }
  // wpUrl ที่บันทึกต้องเป็น https + โฮสต์สาธารณะ (กัน SSRF) — ค่าว่างยังอนุญาต
  if ("wpUrl" in data) {
    const normalized = typeof data.wpUrl === "string" ? normalizeSavedWpUrl(data.wpUrl) : "";
    // ตรวจเฉพาะตอนเปลี่ยน URL — ค่าเดิมที่บันทึกไว้แล้วไม่บล็อกการบันทึกช่องอื่น
    if (normalized && normalized !== existing.wpUrl) {
      const err = await checkCredentialUrl(normalized);
      if (err) return NextResponse.json({ error: err }, { status: 400 });
    }
    data.wpUrl = normalized || (data.wpUrl === null ? null : "");
  }
  // ค่าปิดบังจาก GET ถูกส่งกลับมา = ไม่ได้แก้รหัส — ห้ามทับรหัสจริง
  if (data.wpAppPassword === SECRET_MASK) delete data.wpAppPassword;
  // รหัสใหม่เก็บแบบเข้ารหัสเสมอ — ค่าว่าง/null = ล้างรหัส
  if ("wpAppPassword" in data) {
    try {
      data.wpAppPassword = encryptProjectWpPassword(typeof data.wpAppPassword === "string" ? data.wpAppPassword : "");
    } catch {
      return NextResponse.json({ error: "เข้ารหัส Application Password ไม่สำเร็จ (ไม่มี WP_ENCRYPTION_KEY)" }, { status: 500 });
    }
  }
  // secret ใน siteConnection ที่ส่งกลับมาเป็นค่าปิดบัง/ว่าง = คงค่าเดิม
  if ("siteConnection" in data) {
    const missing = domainBoundSecretMissing(existing.siteConnection, data.siteConnection);
    if (missing) return NextResponse.json({ error: missing }, { status: 400 });
    data.siteConnection = mergeSiteConnectionSecrets(existing.siteConnection, data.siteConnection);
  }
  // timeline เก็บทั้งช่วงเวลาโปรเจกต์ (plan) และรายการบทความ — normalize ให้อยู่รูปเดียวเสมอ
  // และถ้าผู้เรียกส่งมาแค่ array ให้คง plan เดิมไว้ (ดู src/lib/project-timeline.ts)
  if ("timeline" in data) data.timeline = mergeTimelineWrite(existing.timeline, data.timeline);
  // pushPrefs เก็บ preference หลายชนิดปนกัน (manualChecks, excludeCards, stripH1, languagePrefs ฯลฯ)
  // — merge เฉพาะ top-level key ที่ส่งมา ห้ามทับ key อื่นที่ agent/แท็บอื่นเขียนไว้
  const changedKeys = Object.keys(data);
  if ("pushPrefs" in data) {
    const parseJson = (v: unknown): Record<string, unknown> => {
      if (!v) return {};
      if (typeof v === "string") { try { return JSON.parse(v) || {}; } catch { return {}; } }
      if (typeof v === "object") return v as Record<string, unknown>;
      return {};
    };
    // indexRequests / siteScan / ownerTags / articleOwners / wpPostIds เขียนฝั่งเซิร์ฟเวอร์เท่านั้น (route เฉพาะของมัน)
    // — ทิ้งค่าที่ client ส่งมา (สำเนาเก่าในแท็บ Push/Article Lab) กันทับผลจริง
    const incomingPrefs = stripServerOwnedPrefs(parseJson(data.pushPrefs));
    delete data.pushPrefs;
    // merge ใต้ row lock เดียวกับ push/index — ค่าที่ push เพิ่งจดระหว่างนี้ไม่ถูกทับ
    await updateProjectPrefs(params.id, orgId, (cur) => ({ prefs: { ...cur, ...incomingPrefs }, result: null }));
  }

  const project = await prisma.project.update({ where: { id: params.id }, data });
  const skipLog = changedKeys.length === 1 && ('timeline' in data || 'autoSchedule' in data)
  if (!skipLog) {
    logActivity({ organizationId: orgId, userId: session!.user.id, action: 'UPDATE', entityType: 'Project', entityId: params.id, newValue: JSON.stringify(changedKeys) })
  }
  return NextResponse.json(maskProjectSecrets(project));
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = session!.user.organizationId;
  const existing = await prisma.project.findFirst({ where: { id: params.id, organizationId: orgId }, select: { id: true, name: true } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.project.delete({ where: { id: params.id } });
  logActivity({ organizationId: orgId, userId: session!.user.id, action: 'DELETE', entityType: 'Project', entityId: params.id, oldValue: existing.name })
  return NextResponse.json({ ok: true });
}
