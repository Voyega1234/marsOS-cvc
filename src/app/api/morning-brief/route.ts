import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { MorningBrief, BriefAlert } from "@/lib/mock-data/morning-brief";
import { getGSCAuth } from "@/lib/google-auth";
import { google } from "googleapis";

export async function GET() {
  const session = await getSession();
  const orgId = session!.user.organizationId ?? "";

  try {
    // Pull real data from DB to generate a live brief
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [articles, aiJobs, reviews, wpConns] = await Promise.all([
      // Articles stuck in review / SEO_REVIEW
      prisma.article.findMany({
        where: {
          project: { organizationId: orgId },
          status: { in: ["SEO_REVIEW", "REVIEW", "DRAFT"] },
        },
        include: { project: { select: { id: true, name: true } } },
        orderBy: { updatedAt: "asc" },
        take: 20,
      }),
      // AI jobs in last 7 days
      prisma.aIJob.findMany({
        where: {
          article: { project: { organizationId: orgId } },
          createdAt: { gte: new Date(Date.now() - 7 * 86400000) },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      // Reviews pending
      prisma.review.findMany({
        where: {
          article: { project: { organizationId: orgId } },
          status: { in: ["PENDING", "CHANGES_REQUESTED"] },
        },
        select: { id: true, status: true, article: { select: { id: true, title: true, projectId: true } } },
        take: 10,
      }),
      // WordPress connections
      prisma.wordPressConnection.findMany({
        where: { organizationId: orgId },
      }),
    ]);

    const alerts: BriefAlert[] = [];

    // Critical: articles stuck in SEO_REVIEW > 2 days
    const stuckSeoReview = articles.filter(a => {
      if (a.status !== "SEO_REVIEW") return false;
      const daysSince = (Date.now() - new Date(a.updatedAt).getTime()) / 86400000;
      return daysSince > 2;
    });
    if (stuckSeoReview.length > 0) {
      const a = stuckSeoReview[0];
      const days = Math.floor((Date.now() - new Date(a.updatedAt).getTime()) / 86400000);
      alerts.push({
        id: `seo-review-${a.id}`,
        level: "critical",
        project: a.project.name,
        projectId: a.project.id,
        title: `"${a.title}" ค้าง SEO Review ${days} วัน`,
        detail: `บทความนี้อยู่ขั้นตอน SEO Review นานผิดปกติ ควรรีวิวด่วน`,
        metric: `${days} วัน`,
        metricDelta: "ค้าง SEO Review",
        action: "รีวิวทันที",
        href: "/review",
      });
    }
    if (stuckSeoReview.length > 1) {
      for (const a of stuckSeoReview.slice(1, 3)) {
        alerts.push({
          id: `seo-review-extra-${a.id}`,
          level: "critical",
          project: a.project.name,
          projectId: a.project.id,
          title: `"${a.title}" ค้าง SEO Review`,
          detail: `ต้องการการรีวิว`,
          action: "รีวิว",
          href: "/review",
        });
      }
    }

    // Warning: pending reviews
    if (reviews.length > 0) {
      alerts.push({
        id: "pending-reviews",
        level: "warning",
        project: "All Projects",
        projectId: "all",
        title: `${reviews.length} บทความรอ Approve`,
        detail: `บทความที่รอ: ${reviews.slice(0, 3).map(r => `"${r.article.title}"`).join(", ")}`,
        metric: `${reviews.length}`,
        metricDelta: "Pending approval",
        action: "ดู Review Queue",
        href: "/review",
      });
    }

    // Warning: AI jobs failed recently
    const failedJobs = aiJobs.filter(j => j.status === "FAILED");
    if (failedJobs.length > 0) {
      alerts.push({
        id: "failed-ai-jobs",
        level: "warning",
        project: "AI System",
        projectId: "system",
        title: `${failedJobs.length} AI Job ล้มเหลวใน 7 วันที่ผ่านมา`,
        detail: `ตรวจสอบ AI Jobs และ API key ให้แน่ใจว่ายังทำงานได้`,
        metric: `${failedJobs.length} failed`,
        metricDelta: "AI Jobs",
        action: "ดู AI Jobs",
        href: "/ai-jobs",
      });
    }

    // Warning: WordPress connections without encrypted password
    const wpFailed = wpConns.filter(w => !w.siteUrl || !w.appPasswordEncrypted);
    if (wpFailed.length > 0) {
      alerts.push({
        id: "wp-failed",
        level: "warning",
        project: wpFailed[0].name,
        projectId: "wp",
        title: `WordPress ยังไม่ได้เชื่อมต่อ — ${wpFailed[0].name}`,
        detail: `ต้องตั้งค่า Application Password ก่อนจึงจะ Publish ได้`,
        metric: `${wpFailed.length} site`,
        metricDelta: "WP not configured",
        action: "ตั้งค่า WordPress",
        href: "/website-connect",
      });
    }

    // OK: articles published this month
    const publishedThisMonth = await prisma.article.count({
      where: {
        project: { organizationId: orgId },
        status: "PUBLISHED",
        updatedAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
      },
    });
    if (publishedThisMonth > 0) {
      alerts.push({
        id: "published-ok",
        level: "ok",
        project: "All Projects",
        projectId: "all",
        title: `${publishedThisMonth} บทความ Published เดือนนี้`,
        detail: `ระบบทำงานปกติ บทความถูก publish สำเร็จ`,
        metric: `${publishedThisMonth}`,
        metricDelta: "Published this month",
        action: "ดูบทความ",
        href: "/articles",
      });
    }

    // GSC traffic drop check — for projects that have gscSiteUrl set
    try {
      const gscProjects = await prisma.project.findMany({
        where: { organizationId: orgId, gscSiteUrl: { not: null } },
        select: { id: true, name: true, gscSiteUrl: true },
        take: 5,
      });
      if (gscProjects.length > 0) {
        const auth = getGSCAuth();
        const sc = google.searchconsole({ version: "v1", auth });
        const now = new Date();
        const fmt = (d: Date) => d.toISOString().slice(0, 10);
        const cur_end   = fmt(new Date(now.getTime() - 2 * 86400000));
        const cur_start = fmt(new Date(now.getTime() - 29 * 86400000));
        const prev_end  = fmt(new Date(now.getTime() - 30 * 86400000));
        const prev_start = fmt(new Date(now.getTime() - 57 * 86400000));

        for (const proj of gscProjects) {
          try {
            const [cur, prev] = await Promise.all([
              sc.searchanalytics.query({ siteUrl: proj.gscSiteUrl!, requestBody: { startDate: cur_start, endDate: cur_end, dimensions: [] } as never }),
              sc.searchanalytics.query({ siteUrl: proj.gscSiteUrl!, requestBody: { startDate: prev_start, endDate: prev_end, dimensions: [] } as never }),
            ]);
            const curClicks  = cur.data.rows?.[0]?.clicks  ?? 0;
            const prevClicks = prev.data.rows?.[0]?.clicks ?? 0;
            if (prevClicks > 50 && curClicks < prevClicks * 0.8) {
              const drop = Math.round((1 - curClicks / prevClicks) * 100);
              alerts.push({
                id: `gsc-drop-${proj.id}`,
                level: drop >= 40 ? "critical" : "warning",
                project: proj.name,
                projectId: proj.id,
                title: `GSC Traffic ลดลง ${drop}% — ${proj.name}`,
                detail: `28 วันที่ผ่านมา: ${curClicks.toLocaleString()} clicks (เดิม ${prevClicks.toLocaleString()}) ควรตรวจสอบ ranking และ content`,
                metric: `-${drop}%`,
                metricDelta: "GSC Clicks",
                action: "ดู Report",
                href: `/report/${proj.id}`,
              });
            }
          } catch { /* skip if GSC not accessible for this site */ }
        }
      }
    } catch { /* GSC block optional — skip if credentials not set up */ }

    const criticalCount = alerts.filter(a => a.level === "critical").length;
    const warningCount = alerts.filter(a => a.level === "warning").length;

    const brief: MorningBrief = {
      generatedAt: new Date().toISOString(),
      date: new Date().toISOString().slice(0, 10),
      totalAlerts: alerts.length,
      criticalCount,
      warningCount,
      alerts,
      aiSummary: criticalCount > 0
        ? `มี ${criticalCount} critical ที่ต้องดูก่อน${warningCount > 0 ? ` และ ${warningCount} warning` : ""} — ตรวจสอบบทความที่ค้างและ AI jobs ที่ล้มเหลว`
        : warningCount > 0
        ? `ไม่มี critical วันนี้ แต่มี ${warningCount} warning ที่ควรดู — ${alerts.filter(a => a.level === "warning").map(a => a.title).join(" · ")}`
        : `ระบบทำงานปกติ ${publishedThisMonth} บทความ Published เดือนนี้`,
      source: `Mars DB · ${new Date().toLocaleDateString("th-TH")} ${new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}`,
    };

    return NextResponse.json(brief);
  } catch (e) {
    return NextResponse.json({ error: String(e), alerts: [], totalAlerts: 0, criticalCount: 0, warningCount: 0 }, { status: 500 });
  }
}
