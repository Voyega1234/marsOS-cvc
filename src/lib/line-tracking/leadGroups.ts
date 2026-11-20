// Pure folds over grouped Prisma rows. A page asks the database for the finest grouping
// once (leads by channel × status, clicks by channel) and every panel derives its own
// numbers from those rows, instead of each panel running its own coarser groupBy over
// the same table and window. The folds return exactly what the coarser groupBy would.

export type LeadGroupRow = {
  channelGroup: string | null;
  status: string;
  _count: number;
  _sum: { value: number | null };
};

export type StatusGroupRow = { status: string; _count: number; _sum: { value: number | null } };

export type ClickGroupRow = { _count: { _all: number; lineClickedAt: number } };

/**
 * Leads by status, as `groupBy({ by: ["status"], _count: true, _sum: { value: true } })`
 * returns them. A status whose values are all null keeps a null sum, as in SQL.
 * Statuses come out in first-seen order; callers that care sort them.
 */
export function foldByStatus(rows: readonly LeadGroupRow[]): StatusGroupRow[] {
  const map = new Map<string, StatusGroupRow>();
  for (const r of rows) {
    const cur = map.get(r.status);
    if (!cur) {
      map.set(r.status, { status: r.status, _count: r._count, _sum: { value: r._sum.value } });
      continue;
    }
    cur._count += r._count;
    if (r._sum.value != null) cur._sum.value = (cur._sum.value ?? 0) + r._sum.value;
  }
  return Array.from(map.values());
}

/** Totals across channels, as `adClick.aggregate({ _count: { _all, lineClickedAt } })`. */
export function foldClicks(rows: readonly ClickGroupRow[]): { _all: number; lineClickedAt: number } {
  return rows.reduce(
    (t, r) => ({ _all: t._all + r._count._all, lineClickedAt: t.lineClickedAt + r._count.lineClickedAt }),
    { _all: 0, lineClickedAt: 0 },
  );
}

/**
 * Leads and purchases per project from one `groupBy(["projectId", "status"])`, as the two
 * former `groupBy(["projectId"])` reads (all leads, and leads in a purchased status).
 */
export function foldByProject(
  rows: readonly { projectId: string; status: string; _count: number }[],
  purchased: readonly string[],
): { leads: Map<string, number>; purchases: Map<string, number> } {
  const leads = new Map<string, number>();
  const purchases = new Map<string, number>();
  for (const r of rows) {
    leads.set(r.projectId, (leads.get(r.projectId) ?? 0) + r._count);
    if (purchased.includes(r.status)) purchases.set(r.projectId, (purchases.get(r.projectId) ?? 0) + r._count);
  }
  return { leads, purchases };
}
