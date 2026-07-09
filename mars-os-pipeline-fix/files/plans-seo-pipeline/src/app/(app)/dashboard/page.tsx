import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { HomeDashboard } from "@/components/dashboard/HomeDashboard";

export default async function DashboardPage() {
  const session = await getSession();
  if (session?.user?.role === "CLIENT") redirect("/client-portal");
  if (!session?.user?.organizationId) redirect("/login");
  const orgId = session.user.organizationId;

  // Fetch all projects with timeline JSON + recent activity.
  // Wrapped so a transient DB / schema error renders an empty dashboard instead
  // of crashing the whole page ("Server Components render error"). If this ever
  // hits, the real fix is the DB connection/schema — see PIPELINE-FIX-HANDOFF.md.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let projects: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let recentActivity: any[] = [];
  try {
    [projects, recentActivity] = await Promise.all([
      prisma.project.findMany({
        where: { organizationId: orgId },
        select: {
          id: true, name: true, clientName: true, website: true,
          status: true, updatedAt: true, timeline: true,
        },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.activityLog.findMany({
        where: { organizationId: orgId },
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
    ]);
  } catch (err) {
    console.error("[dashboard] DB query failed:", err);
  }

  // Parse timeline entries per project
  interface TimelineEntry {
    date: string;
    keyword: string;
    title: string;
    articleStatus: string;
    slug?: string;
  }

  const projectRows = projects.map((p) => {
    let timeline: TimelineEntry[] = [];
    try { timeline = JSON.parse((p as any).timeline || "[]"); } catch { /* ignore */ }

    const total    = timeline.length;
    const pending  = timeline.filter(e => !e.articleStatus || e.articleStatus === "pending").length;
    const writing  = timeline.filter(e => e.articleStatus === "writing").length;
    const review   = timeline.filter(e => e.articleStatus === "review").length;
    const approved = timeline.filter(e => e.articleStatus === "approved").length;
    const pushed   = timeline.filter(e => e.articleStatus === "pushed").length;
    const done     = approved + pushed;

    // Pending entries (not started yet or in review)
    const pendingEntries = timeline
      .map((e, idx) => ({ ...e, idx }))
      .filter(e => e.articleStatus === "pending" || e.articleStatus === "review" || e.articleStatus === "writing")
      .slice(0, 5);

    return {
      id: p.id,
      name: p.clientName ?? p.name,
      website: p.website,
      status: p.status,
      updatedAt: p.updatedAt,
      total,
      pending,
      writing,
      review,
      approved,
      pushed,
      done,
      progress: total > 0 ? Math.round((done / total) * 100) : 0,
      pendingEntries,
      hasPendingWork: pending > 0 || review > 0 || writing > 0,
    };
  });

  // Summary totals
  const summary = {
    totalProjects: projects.length,
    totalArticles: projectRows.reduce((s, p) => s + p.total, 0),
    totalPending:  projectRows.reduce((s, p) => s + p.pending, 0),
    totalWriting:  projectRows.reduce((s, p) => s + p.writing, 0),
    totalReview:   projectRows.reduce((s, p) => s + p.review, 0),
    totalPushed:   projectRows.reduce((s, p) => s + p.pushed, 0),
  };

  return (
    <HomeDashboard
      userName={session.user.name ?? ""}
      projectRows={projectRows}
      summary={summary}
      recentActivity={recentActivity.map(a => ({
        id: a.id,
        action: a.action,
        entityType: a.entityType,
        createdAt: a.createdAt,
        userName: a.user.name ?? "—",
        newValue: a.newValue ?? "",
      }))}
    />
  );
}
