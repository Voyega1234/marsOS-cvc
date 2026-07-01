import { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CalendarClient } from "@/components/calendar/CalendarClient";

export const metadata: Metadata = { title: "Content Calendar" };

interface TimelineEntry {
  date: string;
  keyword: string;
  title: string;
  articleStatus: string;
  funnel?: string;
  slug?: string;
}

// Map timeline articleStatus → CalendarClient status colors
const STATUS_MAP: Record<string, string> = {
  pending:  "NEW",
  writing:  "ARTICLE_GENERATING",
  done:     "ARTICLE_DONE",
  review:   "SEO_REVIEW",
  approved: "APPROVED",
  pushed:   "POSTED",
};

export default async function CalendarPage() {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return null;

  const projects = await prisma.project.findMany({
    where: { organizationId: orgId },
    select: { id: true, name: true, clientName: true, timeline: true },
    orderBy: { updatedAt: "desc" },
  });

  // Flatten timeline entries → CalendarClient article shape
  const articles = projects.flatMap((p) => {
    let entries: TimelineEntry[] = [];
    try { entries = JSON.parse((p as any).timeline || "[]"); } catch { /* ignore */ }
    return entries.map((e, idx) => ({
      id: `${p.id}-${idx}`,
      title: e.title || e.keyword,
      status: STATUS_MAP[e.articleStatus] ?? "NEW",
      funnelStage: e.funnel ?? "TOFU",
      scheduledAt: e.date ? new Date(e.date).toISOString() : null,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      project: { id: p.id, name: p.clientName ?? p.name },
      assignedTo: null,
    }));
  });

  const projectList = projects.map((p) => ({
    id: p.id,
    name: p.clientName ?? p.name,
  }));

  return <CalendarClient articles={articles as never} projects={projectList} />;
}
