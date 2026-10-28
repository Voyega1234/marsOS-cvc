import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { clientCanAccessProject } from "@/lib/client-access";
import { prisma } from "@/lib/prisma";
import { notifyArticleStatusChange } from "@/services/notify";
import { logActivity } from "@/lib/logActivity";
import { maskProjectSecrets, stripUserSecrets } from "@/lib/secret-mask";
import { loadTitleRestrictions } from "@/lib/ce-restrictions-server";
import { cleanArticlePatch } from "@/lib/ce-restrictions";
import { updateProjectPrefs } from "@/lib/project-prefs-store";
import { pruneArticleFromPrefs } from "@/lib/sme-articles/duplicates";
import { setCoverAltInHtml } from "@/lib/sme-articles/article-images";

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const article = await prisma.article.findFirst({
    where: { id: params.id, project: { organizationId: session.user.organizationId } },
    include: { project: true, keyword: true, assignedTo: true, reviewer: true, versions: true, reviews: true },
  });
  if (!article) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await clientCanAccessProject(session, article.projectId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // ตัดรหัสผ่านผู้ใช้ + ปิดบังรหัส WordPress ก่อนส่งให้ browser
  return NextResponse.json({
    ...article,
    project: maskProjectSecrets(article.project),
    assignedTo: stripUserSecrets(article.assignedTo),
    reviewer: stripUserSecrets(article.reviewer),
  });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = session.user.organizationId;

  // Verify org ownership before mutating
  const existing = await prisma.article.findFirst({
    where: { id: params.id, project: { organizationId: orgId } },
    select: { id: true, projectId: true, slug: true, wordpressUrl: true, status: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // CLIENT แก้ได้เฉพาะบทความในโปรเจกต์ที่ตัวเองมีสิทธิ์ (เหมือน GET)
  if (!(await clientCanAccessProject(session, existing.projectId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const allowed = [
    "status", "title", "slug", "brief", "outline", "htmlContent", "seoTitle", "metaDescription",
    "faqSchema", "imagePrompt", "assignedToId", "reviewerId", "wordpressUrl", "wordpressStatus",
    "competitorUrls", "dataBrainContext", "scheduledAt", "needsRefresh", "assignedAuthorId",
    "coverImageUrl",
  ];
  const data: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) data[key] = body[key];
  }

  // ปกต้องเป็น data URI หรือ https เท่านั้น ('' = ลบปก)
  if ("coverImageUrl" in data) {
    const c = data.coverImageUrl;
    if (c === null || c === "") data.coverImageUrl = null;
    else if (typeof c !== "string" || !(c.startsWith("data:image/") || c.startsWith("https://"))) {
      return NextResponse.json({ error: "coverImageUrl ต้องเป็น data:image/... หรือ https://" }, { status: 400 });
    }
  }

  // ปก/alt ห้ามแก้ระหว่าง writer/push ทำงาน — รอบนั้นจะเซฟทับของที่แก้
  if (("coverImageUrl" in data || typeof body.coverAlt === "string") && ["WRITING", "PUSHING", "PUBLISHING"].includes(existing.status)) {
    return NextResponse.json({ error: "บทความกำลังเขียนหรือ push อยู่ — รอให้เสร็จก่อนแก้ภาพปก" }, { status: 409 });
  }

  // alt ปกอยู่ในบล็อก CONVERT_CAKE_SEO_META ของ htmlContent (ไม่มีคอลัมน์ coverAlt)
  if (typeof body.coverAlt === "string") {
    let html = typeof data.htmlContent === "string" ? data.htmlContent : null;
    if (html === null) {
      const cur = await prisma.article.findUnique({ where: { id: params.id }, select: { htmlContent: true } });
      html = cur?.htmlContent ?? "";
    }
    data.htmlContent = setCoverAltInHtml(html, body.coverAlt);
  }

  // คำต้องห้ามของ Content Engine โปรเจกต์นี้ — ค่าที่แก้มือ (SEO title/meta/slug ในหน้า Review) ต้องผ่านกฎเดียวกับที่ AI เขียน
  const restrictionWarnings = ["title", "seoTitle", "metaDescription", "slug", "htmlContent"].some(k => typeof data[k] === "string" && data[k])
    ? cleanArticlePatch(await loadTitleRestrictions(orgId, { projectId: existing.projectId }), existing, data)
    : [];

  const article = await prisma.article.update({ where: { id: params.id }, data });

  await prisma.activityLog.create({
    data: {
      organizationId: orgId,
      userId: session.user.id,
      action: "UPDATE",
      entityType: "Article",
      entityId: params.id,
      // ปก data URI ใหญ่หลาย MB — เก็บแค่ความยาวใน log
      newValue: JSON.stringify(typeof data.coverImageUrl === "string" && data.coverImageUrl.startsWith("data:")
        ? { ...data, coverImageUrl: `[data URI ${data.coverImageUrl.length} chars]` }
        : data),
    },
  });

  // Notify on status changes that matter to team members
  if (typeof data.status === "string") {
    notifyArticleStatusChange({
      articleId: params.id,
      organizationId: orgId,
      newStatus: data.status,
      actorId: session.user.id,
      actorName: session.user.name,
    }).catch(() => {});
  }

  return NextResponse.json(restrictionWarnings.length ? { ...article, restrictionWarnings } : article);
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // ลูกค้า (CLIENT) ลบบทความไม่ได้ — ปุ่มลบซ่อนไว้ แต่ API ต้องกันอีกชั้น
  if (session.user.role === "CLIENT") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const orgId = session.user.organizationId;

  // Verify org ownership before deleting
  const existing = await prisma.article.findFirst({
    where: { id: params.id, project: { organizationId: orgId } },
    select: { id: true, title: true, projectId: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await clientCanAccessProject(session, existing.projectId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ลบเฉพาะแถวในระบบ (โพสต์บนเว็บไม่ถูกลบ) — ปลดลิงก์ตารางที่ชี้มาก่อน ไม่พึ่ง FK ของ DB จริง
  // ประวัติค่า AI (AIJob) / ไฟล์รูป (MediaAsset) / งานภายนอก / backlink ยังอยู่ แค่ไม่ผูกกับบทความนี้แล้ว
  // versions / comments / reviews / rank snapshots ลบตามแบบ cascade
  await prisma.$transaction([
    prisma.aIJob.updateMany({ where: { articleId: existing.id }, data: { articleId: null } }),
    prisma.mediaAsset.updateMany({ where: { articleId: existing.id }, data: { articleId: null } }),
    prisma.externalTask.updateMany({ where: { articleId: existing.id }, data: { articleId: null } }),
    prisma.backlinkEntry.updateMany({ where: { articleId: existing.id }, data: { articleId: null } }),
    prisma.article.delete({ where: { id: existing.id } }),
  ]);

  // ผล Request Index + ผู้ดูแลของบทความนี้ใน pushPrefs ไม่ใช้แล้ว — ตัดทิ้ง (พลาดไม่เป็นไร ค่าที่ค้างไม่ถูกแสดง)
  await updateProjectPrefs(existing.projectId, orgId, (current) => {
    const next = pruneArticleFromPrefs(current, existing.id);
    return next ? { prefs: next, result: true } : { result: false };
  }).catch(() => {});

  logActivity({ organizationId: orgId, userId: session.user.id, action: 'DELETE', entityType: 'Article', entityId: params.id, oldValue: existing.title ?? params.id }).catch(() => {})
  return NextResponse.json({ ok: true });
}
