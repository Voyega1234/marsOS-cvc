// Numbers for the period comparison on the LINE Tracking pages. Read-only.
// Kept apart from projectService / leadService so those stay as they are; the status lists and the
// lead filter come from them, so both sides of a comparison count exactly like the rest of the page.
import { prisma } from "@/lib/prisma";
import { createdAtWhere, type ResolvedRange } from "@/lib/line-tracking/date-range";
import { leadWhere, type LeadFilter } from "./leadService";
import { PURCHASED, REACHED_QUALIFIED } from "./projectService";

export type LeadMetrics = { leads: number; purchases: number; revenue: number };

/** Leads created in the window, how many of them are closed, and the value of the closed ones. */
export async function getLeadMetrics(projectId: string, range: ResolvedRange): Promise<LeadMetrics> {
  const rows = await prisma.lead.groupBy({
    by: ["status"],
    where: { projectId, ...createdAtWhere(range) },
    _count: true,
    _sum: { value: true },
  });
  const out: LeadMetrics = { leads: 0, purchases: 0, revenue: 0 };
  for (const r of rows) {
    out.leads += r._count;
    if (PURCHASED.includes(r.status)) {
      out.purchases += r._count;
      out.revenue += r._sum.value ?? 0;
    }
  }
  return out;
}

export type LeadSummary = { leads: number; qualified: number; purchases: number; revenue: number };

/** `qualified` is cumulative, like the funnel: a closed lead has passed it too. */
export function summarizeLeads(rows: { status: string; value: number }[]): LeadSummary {
  const out: LeadSummary = { leads: 0, qualified: 0, purchases: 0, revenue: 0 };
  for (const r of rows) {
    out.leads += 1;
    if (REACHED_QUALIFIED.includes(r.status)) out.qualified += 1;
    if (PURCHASED.includes(r.status)) {
      out.purchases += 1;
      out.revenue += r.value ?? 0;
    }
  }
  return out;
}

/** The leads the Leads CRM filters select, reduced to what a summary needs. */
export function listLeadSummaryRows(projectId: string, opts: LeadFilter) {
  return prisma.lead.findMany({
    where: leadWhere(projectId, opts),
    select: { id: true, status: true, value: true },
  });
}
