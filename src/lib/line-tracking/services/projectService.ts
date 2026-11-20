import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { CONNECTION_TYPES } from "@/lib/line-tracking/enums";
import type { ConnectionType, ProjectStatus } from "@/lib/line-tracking/enums";
import { createdAtWhere, type ResolvedRange } from "@/lib/line-tracking/date-range";
import { bucketDailyLeads, dailyWindow, EMPTY_DAILY, type DailySeries } from "@/lib/line-tracking/overview";
import { foldByProject, foldByStatus, foldClicks } from "@/lib/line-tracking/leadGroups";
import { getProjectHeader } from "@/lib/line-tracking/projectHeader";
import { isAutoPaidProject } from "./autoPaidProjects";
import { seedDefaultRules } from "./conversionRuleService";
import { ensureDefaultTrackingLinks } from "./trackingService";
import { saveOverviewSettings } from "./overviewSettingsStore";
import {
  OVERVIEW_SETTINGS_TYPE,
  parseOverviewSettings,
  settingsForDuplicate,
} from "@/lib/line-tracking/overviewMode";

export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9ก-๙]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "project";
}

async function uniqueSlug(desired: string): Promise<string> {
  let slug = desired;
  let n = 1;
  while (await prisma.ltProject.findUnique({ where: { slug } })) {
    n += 1;
    slug = `${desired}-${n}`;
  }
  return slug;
}

export interface CreateProjectInput {
  agencyId: string;
  name: string;
  clientName: string;
  businessType: string;
  websiteUrl?: string;
  currency?: string;
  timezone?: string;
  defaultConversionValue?: number;
  mainSalesChannel?: string;
  /** MarsOS: the staff member who created the project and their organization. */
  organizationId?: string | null;
  createdById?: string | null;
}

export async function createProject(input: CreateProjectInput) {
  const slug = await uniqueSlug(slugify(input.name));
  const project = await prisma.ltProject.create({
    data: {
      agencyId: input.agencyId,
      name: input.name,
      clientName: input.clientName,
      slug,
      businessType: input.businessType,
      websiteUrl: input.websiteUrl || null,
      currency: input.currency || "THB",
      timezone: input.timezone || "Asia/Bangkok",
      defaultConversionValue: input.defaultConversionValue ?? 0,
      mainSalesChannel: input.mainSalesChannel || "LINE",
      status: "SETUP",
      organizationId: input.organizationId ?? null,
      createdById: input.createdById ?? null,
    },
  });

  // Create a NOT_CONNECTED row for every connector type.
  await prisma.projectConnection.createMany({
    data: CONNECTION_TYPES.map((type) => ({
      projectId: project.id,
      type,
      status: "NOT_CONNECTED",
      configJson: "{}",
    })),
  });

  // Independent of each other (different tables) — run concurrently instead of
  // waiting for the rules to finish before the links even start.
  await Promise.all([
    seedDefaultRules(project.id, project.defaultConversionValue),
    ensureDefaultTrackingLinks(project.id, project.slug),
  ]);

  return project;
}

/** Duplicate a project's settings (connections structure + rules), not its leads. */
export async function duplicateProject(
  sourceId: string,
  owner?: { organizationId: string | null; createdById: string | null },
) {
  const source = await prisma.ltProject.findUniqueOrThrow({
    where: { id: sourceId },
    include: { connections: true, conversionRules: true },
  });

  const created = await createProject({
    agencyId: source.agencyId,
    name: `${source.name} (Copy)`,
    clientName: source.clientName,
    businessType: source.businessType,
    currency: source.currency,
    timezone: source.timezone,
    defaultConversionValue: source.defaultConversionValue,
    mainSalesChannel: source.mainSalesChannel,
    organizationId: owner?.organizationId ?? source.organizationId,
    createdById: owner?.createdById ?? source.createdById,
  });

  // Copy connector configs (secrets carried over so the copy is usable) and the
  // conversion rule toggles. Every row is independent, so these all go out at once
  // instead of ~9 connections + 7 rules paid as sequential round-trips.
  // Only connector types have a row in the copy to update; the Overview view setting is
  // stored as a connection row too (OVERVIEW_SETTINGS) and is copied on its own, without
  // the original's ad spend.
  const overviewRow = source.connections.find((c) => c.type === OVERVIEW_SETTINGS_TYPE);
  await Promise.all([
    ...source.connections
      .filter((conn) => (CONNECTION_TYPES as readonly string[]).includes(conn.type))
      .map((conn) =>
        prisma.projectConnection.update({
          where: { projectId_type: { projectId: created.id, type: conn.type } },
          data: { configJson: conn.configJson, status: conn.status },
        })
      ),
    ...(overviewRow
      ? [
          saveOverviewSettings(
            created.id,
            settingsForDuplicate(parseOverviewSettings(overviewRow.configJson))
          ),
        ]
      : []),
    ...source.conversionRules.map((rule) =>
      prisma.conversionRule.update({
        where: { projectId_leadStatus: { projectId: created.id, leadStatus: rule.leadStatus } },
        data: {
          enabled: rule.enabled,
          platformsJson: rule.platformsJson,
          defaultValue: rule.defaultValue,
        },
      })
    ),
  ]);

  return created;
}

export function getProject(projectId: string) {
  return prisma.ltProject.findUnique({
    where: { id: projectId },
    include: { connections: true, trackingLinks: true },
  });
}

export function getProjectBySlug(slug: string) {
  return prisma.ltProject.findUnique({ where: { slug } });
}

export function listProjects() {
  return prisma.ltProject.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      connections: { select: { type: true, status: true } },
      _count: { select: { leads: true } },
    },
  });
}

export async function setProjectStatus(projectId: string, status: ProjectStatus) {
  return prisma.ltProject.update({ where: { id: projectId }, data: { status } });
}

/**
 * Changes the display name only. The slug stays as it is: tracking links already handed
 * out are built from it.
 */
export async function renameProject(projectId: string, name: string) {
  return prisma.ltProject.update({ where: { id: projectId }, data: { name } });
}

/** Changes only the website link. The slug, embed snippet and tracking links stay. */
export async function setProjectWebsite(projectId: string, websiteUrl: string | null) {
  return prisma.ltProject.update({ where: { id: projectId }, data: { websiteUrl } });
}

/** Setup progress = fraction of the 6 connectors that are CONNECTED. */
export function setupProgress(connections: { type: string; status: string }[]) {
  const total = CONNECTION_TYPES.length;
  const done = connections.filter((c) => c.status === "CONNECTED").length;
  return { done, total, percent: Math.round((done / total) * 100) };
}

export function connectionStatusMap(
  connections: { type: string; status: string }[]
): Record<ConnectionType, string> {
  const map = {} as Record<ConnectionType, string>;
  for (const t of CONNECTION_TYPES) {
    map[t] = connections.find((c) => c.type === t)?.status ?? "NOT_CONNECTED";
  }
  return map;
}

// ---- Dashboard aggregates -------------------------------------------------

/**
 * These pages are force-dynamic, so every query is a fresh round-trip to a remote
 * Postgres — and a serverless function only holds a handful of connections, so the
 * cost of a page is driven by HOW MANY queries it fires, not how much data it reads.
 * The helpers below collapse repeated counts over the same table into one grouped
 * query and do the (trivial) arithmetic in memory instead. Same numbers, fewer trips.
 */
type StatusRow<S extends string = string> = { status: S; _count: number };

/** Total across every status bucket. */
function sumAll(rows: StatusRow[]): number {
  return rows.reduce((n, r) => n + r._count, 0);
}

/** Total across the given statuses only. */
function sumOf(rows: StatusRow[], statuses: readonly string[]): number {
  return rows.reduce((n, r) => (statuses.includes(r.status) ? n + r._count : n), 0);
}

/*
 * Request-scoped shared reads. One page render used to group the same leads by status
 * four or five times (stats, status chart, funnel, channel table) and the funnel page read
 * clicks twice. Each table is now grouped once per (project, window) per render, at the
 * finest grain any panel needs, and the panels fold those rows (see leadGroups.ts).
 * React's `cache` lasts one request only and keys on the arguments, so the window is
 * passed as epoch milliseconds (Date objects would never match). Outside a render the
 * cache is a plain call.
 */
const ms = (d?: Date) => (d ? d.getTime() : null);
const windowOf = (fromMs: number | null, toMs: number | null): ResolvedRange =>
  fromMs == null && toMs == null
    ? undefined
    : { ...(fromMs != null ? { from: new Date(fromMs) } : {}), ...(toMs != null ? { to: new Date(toMs) } : {}) };

const leadGroupsCached = cache(async (projectId: string, fromMs: number | null, toMs: number | null) =>
  prisma.lead.groupBy({
    by: ["channelGroup", "status"],
    where: { projectId, ...createdAtWhere(windowOf(fromMs, toMs)) },
    _count: true,
    _sum: { value: true },
  }),
);
/** Leads in the window grouped by channel × status, with the sum of `value`. */
const leadGroups = (projectId: string, range?: ResolvedRange) =>
  leadGroupsCached(projectId, ms(range?.from), ms(range?.to));

const clickGroupsCached = cache(async (projectId: string, fromMs: number | null, toMs: number | null) =>
  prisma.adClick.groupBy({
    by: ["channelGroup"],
    where: { projectId, ...createdAtWhere(windowOf(fromMs, toMs)) },
    _count: { _all: true, lineClickedAt: true },
  }),
);
/** Clicks in the window by channel; `lineClickedAt` counts rows where it is non-null. */
const clickGroups = (projectId: string, range?: ResolvedRange) =>
  clickGroupsCached(projectId, ms(range?.from), ms(range?.to));

const lineUserGroupsCached = cache(async (projectId: string, fromMs: number | null, toMs: number | null) =>
  prisma.lineUser.groupBy({
    by: ["friendStatus"],
    where: { projectId, ...createdAtWhere(windowOf(fromMs, toMs)) },
    _count: { _all: true, lastMessageAt: true },
  }),
);
/** LINE users in the window by friend status. */
const lineUserGroups = (projectId: string, range?: ResolvedRange) =>
  lineUserGroupsCached(projectId, ms(range?.from), ms(range?.to));

/** Every lead in the agency by status (landing page: KPI tiles and the status donut). */
const agencyLeadStatus = cache(async () => prisma.lead.groupBy({ by: ["status"], _count: true }));

// Funnel stages are CUMULATIVE — a lead sitting in WON has already passed
// contacted/qualified/quoted, so each stage is the set of statuses at or beyond it.
// Exported so the Looker feed reports the same funnel as the dashboard. Duplicating
// these lists would let the two drift apart silently.
export const PURCHASED: readonly string[] = ["WON", "PAID"];
export const REACHED_BOOKED: readonly string[] = ["BOOKED", ...PURCHASED];
export const REACHED_QUOTED: readonly string[] = ["QUOTED", ...REACHED_BOOKED];
export const REACHED_QUALIFIED: readonly string[] = ["QUALIFIED", ...REACHED_QUOTED];
export const REACHED_CONTACTED: readonly string[] = ["CONTACTED", ...REACHED_QUALIFIED];

export async function getAgencyDashboardStats() {
  // Was 7 separate counts (2 project + 3 lead + 2 conversionEvent). Each table is now
  // asked once, grouped by status, and the buckets are summed here.
  const [projectRows, leadRows, eventRows] = await Promise.all([
    prisma.ltProject.groupBy({ by: ["status"], _count: true }),
    agencyLeadStatus(),
    prisma.conversionEvent.groupBy({ by: ["status"], _count: true }),
  ]);

  return {
    totalProjects: sumAll(projectRows),
    activeProjects: sumOf(projectRows, ["LIVE"]),
    totalLeads: sumAll(leadRows),
    qualifiedLeads: sumOf(leadRows, ["QUALIFIED"]),
    purchases: sumOf(leadRows, PURCHASED),
    conversionSent: sumOf(eventRows, ["SENT"]),
    conversionFailed: sumOf(eventRows, ["FAILED"]),
  };
}

/** Lead counts grouped by channelGroup, with purchases per channel. */
export async function getChannelBreakdown(projectId: string, range?: ResolvedRange) {
  // Was a findMany of every lead row for the project, aggregated in JS. Postgres can
  // do the same fold itself — one grouped query, a handful of rows back instead of all.
  const rows = await leadGroups(projectId, range);
  const map = new Map<string, { leads: number; purchases: number; revenue: number }>();
  for (const r of rows) {
    const key = r.channelGroup ?? "Direct";
    const row = map.get(key) ?? { leads: 0, purchases: 0, revenue: 0 };
    row.leads += r._count;
    if (r.status === "WON" || r.status === "PAID") {
      row.purchases += r._count;
      row.revenue += r._sum.value ?? 0;
    }
    map.set(key, row);
  }
  return Array.from(map.entries())
    .map(([channelGroup, v]) => ({ channelGroup, ...v }))
    .sort((a, b) => b.leads - a.leads);
}

/** LINE lifecycle funnel counts: friends / engaged (messaged) / blocked. */
export async function getLineLifecycle(projectId: string, range?: ResolvedRange) {
  // Was 3 counts over the same table. One grouped read gives all three: `_all` per
  // friendStatus covers friends/blocked, and the non-null `lastMessageAt` count summed
  // across every group is the old unfiltered "has messaged us" count.
  const rows = await lineUserGroups(projectId, range);
  const totalFor = (s: string) => rows.find((r) => r.friendStatus === s)?._count._all ?? 0;
  return {
    friends: totalFor("FRIEND"),
    engaged: rows.reduce((n, r) => n + r._count.lastMessageAt, 0),
    blocked: totalFor("BLOCKED"),
  };
}

/** Full funnel broken down by channel: visit → button click → lead → purchase. */
export async function getChannelFunnel(
  projectId: string,
  range?: { from?: Date; to?: Date }
) {
  // Was 7 queries: 2 over adClick and 5 over lead, one per cumulative funnel stage.
  // Both tables are now read once, grouped, and the cumulative stages are derived here
  // — a lead in WON counts toward contacted/qualified/quoted/purchases exactly as before.
  // adClick uses a field-level count: `_all` is every click, `lineClickedAt` counts only
  // the rows where that column is non-null, i.e. the old `{ not: null }` filter.
  // Both reads are shared with the other panels of the same render.
  const [clickRows, leadRows] = await Promise.all([clickGroups(projectId, range), leadGroups(projectId, range)]);

  type Row = { channel: string; visits: number; btnClicks: number; leads: number; contacted: number; qualified: number; quoted: number; purchases: number; revenue: number };
  const map = new Map<string, Row>();
  const row = (ch: string | null) => {
    const key = ch ?? "Direct";
    if (!map.has(key)) map.set(key, { channel: key, visits: 0, btnClicks: 0, leads: 0, contacted: 0, qualified: 0, quoted: 0, purchases: 0, revenue: 0 });
    return map.get(key)!;
  };
  for (const c of clickRows) {
    const r = row(c.channelGroup);
    r.visits += c._count._all;
    r.btnClicks += c._count.lineClickedAt;
  }
  for (const l of leadRows) {
    const r = row(l.channelGroup);
    r.leads += l._count;
    if (REACHED_CONTACTED.includes(l.status)) r.contacted += l._count;
    if (REACHED_QUALIFIED.includes(l.status)) r.qualified += l._count;
    if (REACHED_QUOTED.includes(l.status)) r.quoted += l._count;
    if (PURCHASED.includes(l.status)) {
      r.purchases += l._count;
      r.revenue += l._sum.value ?? 0;
    }
  }
  // Best performers first: revenue → purchases → visits.
  return Array.from(map.values()).sort(
    (a, b) => b.revenue - a.revenue || b.purchases - a.purchases || b.visits - a.visits
  );
}

/** Lead count grouped by status (for a distribution chart). */
export async function getStatusDistribution(projectId: string, range?: ResolvedRange) {
  const rows = foldByStatus(await leadGroups(projectId, range));
  const order = ["NEW", "CONTACTED", "QUALIFIED", "QUOTED", "BOOKED", "WON", "PAID", "LOST"];
  return rows
    .map((r) => ({ status: r.status, count: r._count }))
    .sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
}

/** Marketing funnel: Click → Add LINE → Message → Qualified → Quote → Purchase. */
export async function getFunnel(
  projectId: string,
  range?: { from?: Date; to?: Date }
) {
  // Was 9 queries: 2 adClick counts, 5 lead counts (one per cumulative stage), a
  // lineUser count and a revenue aggregate. Each table is read once now, through the
  // grouped reads the other panels of the same render share; the totals are folded here.
  const [clickRows, leadGroupRows, lineRows, project] = await Promise.all([
    clickGroups(projectId, range),
    leadGroups(projectId, range),
    lineUserGroups(projectId, range),
    getProjectHeader(projectId),
  ]);
  const clickAgg = foldClicks(clickRows);
  const leadRows = foldByStatus(leadGroupRows);
  const blocked = lineRows.find((r) => r.friendStatus === "BLOCKED")?._count._all ?? 0;

  const clicks = clickAgg._all;
  const lineClicks = clickAgg.lineClickedAt;
  const added = sumAll(leadRows);
  const contacted = sumOf(leadRows, REACHED_CONTACTED);
  const qualified = sumOf(leadRows, REACHED_QUALIFIED);
  const quoted = sumOf(leadRows, REACHED_QUOTED);
  const booked = sumOf(leadRows, REACHED_BOOKED);
  // ขั้น "จองสำเร็จ" แสดงเฉพาะโปรเจกต์ KOWA เท่านั้น
  const showBooked = project != null && isAutoPaidProject(project);
  const purchased = sumOf(leadRows, PURCHASED);
  const revenue = leadRows.reduce(
    (n, r) => (PURCHASED.includes(r.status) ? n + (r._sum.value ?? 0) : n),
    0
  );

  return {
    stages: [
      // Counts AdClick rows, and embed.js records ONE per browser (it reuses the
      // clickId it stashed in localStorage on every later visit that arrives with no
      // utm/gclid). So a visitor who returns direct ten times is still 1 — which is
      // what we want for attribution, but "เข้าเว็บ/คลิก" read as a visit counter and
      // looked broken. Labelled as unique visitors to match what the number is.
      { key: "click", label: "ผู้เข้าเว็บ (unique)", sub: "Unique visitors", count: clicks },
      { key: "lineclick", label: "กดปุ่ม LINE", sub: "Clicked Add-LINE", count: lineClicks },
      { key: "add", label: "แอด LINE", sub: "Added friend", count: added },
      { key: "contact", label: "ทักแชต", sub: "Messaged", count: contacted },
      { key: "qualified", label: "คุณภาพผ่าน", sub: "Qualified", count: qualified },
      { key: "quote", label: "เสนอราคา", sub: "Quoted", count: quoted },
      ...(showBooked ? [{ key: "booked", label: "จองสำเร็จ", sub: "Booked", count: booked }] : []),
      { key: "purchase", label: "ปิดการขาย", sub: showBooked ? "Paid" : "Won / Paid", count: purchased },
    ],
    blocked,
    revenue,
  };
}

/** Agency-wide: leads + purchases per project (for a bar chart). */
export async function getAgencyLeadsByProject() {
  // Was an N+1 loop (1 + 2×projects queries, sequential over a remote DB). Now 2 fixed
  // queries: all projects + leads per project × status, folded in memory into leads and
  // purchases (WON/PAID) per project. Output is identical — projects with 0 leads are kept
  // (groupBy omits them, so we start from the full project list and default to 0).
  const [projects, leadsByProjectStatus] = await Promise.all([
    prisma.ltProject.findMany({ select: { id: true, name: true } }),
    prisma.lead.groupBy({ by: ["projectId", "status"], _count: true }),
  ]);
  const { leads: leadMap, purchases: purchaseMap } = foldByProject(leadsByProjectStatus, ["WON", "PAID"]);
  return projects
    .map((p) => ({ name: p.name, leads: leadMap.get(p.id) ?? 0, purchases: purchaseMap.get(p.id) ?? 0 }))
    .sort((a, b) => b.leads - a.leads);
}

/** Agency-wide lead status distribution (donut). */
export async function getAgencyStatusDistribution() {
  const rows = await agencyLeadStatus();
  const order = ["NEW", "CONTACTED", "QUALIFIED", "QUOTED", "BOOKED", "WON", "PAID", "LOST"];
  return rows
    .map((r) => ({ status: r.status, count: r._count }))
    .sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
}

export async function getProjectStats(projectId: string, range?: ResolvedRange) {
  // Was 6 counts (3 lead + 3 conversionEvent); now one grouped read per table, the lead
  // one shared with the other panels of the same render.
  const where = { projectId, ...createdAtWhere(range) };
  const [leadGroupRows, eventRows] = await Promise.all([
    leadGroups(projectId, range),
    prisma.conversionEvent.groupBy({ by: ["status"], where, _count: true }),
  ]);
  const leadRows = foldByStatus(leadGroupRows);
  return {
    totalLeads: sumAll(leadRows),
    qualifiedLeads: sumOf(leadRows, ["QUALIFIED"]),
    purchases: sumOf(leadRows, PURCHASED),
    sent: sumOf(eventRows, ["SENT"]),
    failed: sumOf(eventRows, ["FAILED"]),
    pending: sumOf(eventRows, ["PENDING"]),
  };
}

/**
 * Leads per Bangkok day for the Overview's "Leads รายวัน" chart and tile sparklines.
 * Reads the same window as the rest of the page, limited to its last DAILY_MAX_DAYS days.
 */
export async function getDailyLeads(projectId: string, range?: ResolvedRange): Promise<DailySeries> {
  const window = dailyWindow(range);
  if (!window) return EMPTY_DAILY;
  const rows = await prisma.lead.findMany({
    where: { projectId, createdAt: { gte: window.from, lte: window.to } },
    select: { createdAt: true, status: true, value: true },
  });
  return bucketDailyLeads(rows, window, PURCHASED);
}

/**
 * Compare the last N days against the previous N days — so you see at a glance
 * whether things improved or got worse. Metrics: leads, purchases, revenue.
 */
export async function getPeriodComparison(
  projectId: string,
  days: number,
  range?: { from?: Date; to?: Date },
) {
  const DAY = 24 * 60 * 60 * 1000;
  const now = new Date();
  // Two modes: the legacy "last N days" (no `range`), and an explicit window picked
  // from the date-range chips. An all-time window has nothing to compare against.
  const curFrom = range ? (range.from ?? new Date(0)) : new Date(now.getTime() - days * DAY);
  const curTo = range ? (range.to ?? now) : now;
  const span = curTo.getTime() - curFrom.getTime();
  const prevFrom = range ? new Date(curFrom.getTime() - span) : new Date(now.getTime() - 2 * days * DAY);
  const comparable = range ? Boolean(range.from) : true;

  // One grouped read per window (was 3: a count, a filtered count and a sum over the
  // very same rows). Leads/purchases/revenue all fall out of the status buckets.
  const metrics = async (from: Date, to: Date) => {
    const rows = await prisma.lead.groupBy({
      by: ["status"],
      where: { projectId, createdAt: { gte: from, lt: to } },
      _count: true,
      _sum: { value: true },
    });
    return {
      leads: sumAll(rows),
      purchases: sumOf(rows, PURCHASED),
      revenue: rows.reduce((n, r) => (PURCHASED.includes(r.status) ? n + (r._sum.value ?? 0) : n), 0),
    };
  };

  // The two windows are independent — run them concurrently (was 2 sequential waves).
  const [current, previous] = await Promise.all([
    metrics(curFrom, curTo),
    comparable ? metrics(prevFrom, curFrom) : Promise.resolve({ leads: 0, purchases: 0, revenue: 0 }),
  ]);
  const pct = (c: number, p: number) => (p === 0 ? (c > 0 ? 100 : 0) : ((c - p) / p) * 100);

  return {
    days: range ? Math.max(1, Math.round(span / DAY)) : days,
    comparable,
    current,
    previous,
    delta: {
      leads: pct(current.leads, previous.leads),
      purchases: pct(current.purchases, previous.purchases),
      revenue: pct(current.revenue, previous.revenue),
    },
  };
}
