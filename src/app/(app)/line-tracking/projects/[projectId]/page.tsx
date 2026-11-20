import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  getProjectStats,
  setupProgress,
  connectionStatusMap,
  getChannelBreakdown,
  getStatusDistribution,
  getFunnel,
  getLineLifecycle,
  getPeriodComparison,
  getDailyLeads,
} from "@/lib/line-tracking/services/projectService";
import { saveOverviewAdSpendAction, setOverviewModeAction, setProjectStatusAction } from "@/lib/line-tracking/actions";
import { getAuthSession } from "@/lib/session";
import { SectionCard, StatusBadge, EmptyRow } from "@/components/line-tracking/ui";
import { Sparkline, TargetBar, TintTile } from "@/components/ui/Widgets";
import { statusColor } from "@/components/line-tracking/AgencyCharts";
import { DonutChart, ChartLegend } from "@/components/line-tracking/Charts";
import {
  ChannelLeadsTable,
  ChannelTable,
  DailyLeadsCard,
  LeadPeriodPerformance,
  PeriodPerformance,
  tileDelta,
} from "@/components/line-tracking/OverviewBlocks";
import {
  OVERVIEW_SETTINGS_TYPE,
  bkkMonthKey,
  costPerLead,
  monthLabel,
  parseOverviewSettings,
  spendForWindow,
} from "@/lib/line-tracking/overviewMode";
import { overviewQuery } from "@/lib/line-tracking/overview";
import {
  CONNECTION_TYPES,
  CONNECTION_LABEL,
  LEAD_STATUS_LABEL,
  PROJECT_STATUS_LABEL,
} from "@/lib/line-tracking/enums";
import type { LeadStatus, ProjectStatus } from "@/lib/line-tracking/enums";
import { platformLabel } from "@/lib/line-tracking/platforms";
import { fmtDate, fmtMoney } from "@/lib/line-tracking/format";
import { resolveRange, rangeLabel, createdAtWhere } from "@/lib/line-tracking/date-range";
import { DateRangeFilter } from "@/components/line-tracking/DateRangeFilter";
import { compareParams, resolveCompare, windowLabel } from "@/lib/line-tracking/compare";
import { CompareFilter } from "@/components/line-tracking/CompareFilter";
import { getLeadMetrics } from "@/lib/line-tracking/services/compareService";
import { ResizableTable } from "@/components/line-tracking/ResizableTable";
import { guardProjectPage } from "@/lib/line-tracking/pageGuard";

export const dynamic = "force-dynamic";

export default async function ProjectOverview({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ days?: string; range?: string; from?: string; to?: string; cmp?: string; cfrom?: string; cto?: string }>;
}) {
  const { projectId } = await params;
  await guardProjectPage(projectId, { clientAllowed: true });
  const sp = await searchParams;
  // The page opens on the last 7 days, exactly as if the "7 วัน" chip had been clicked: with no
  // `range` in the URL the KPIs, breakdowns and tables used to show all-time numbers while the
  // comparison card looked at the last 7 days. Old `days=` bookmarks keep their window.
  const q = overviewQuery(sp);
  const range = resolveRange(q);
  const periodLabel = rangeLabel(q);
  // Every panel below reads the same window.
  const inRange = createdAtWhere(range);
  // What the period is compared with ("เทียบกับ"): the period right before (the default),
  // the same days one month earlier, or dates picked by hand.
  const compare = resolveCompare(q, range, { fallback: "prev" });
  // "ช่วงก่อนหน้า" keeps the numbers getPeriodComparison has always returned; the other two
  // read their own window.
  const ownCompareWindow = compare.mode === "month" || compare.mode === "custom" ? compare.window : null;
  // Everything on this page keys off `projectId` from the URL, so it all goes out in a
  // single round-trip wave — the project row and the session used to be awaited first,
  // holding back the rest. `project.id` is the same value as `projectId`.
  // Includes the period-over-period comparison (the window vs the same span before it).
  const [project, session, cmp, stats, channels, statusDist, funnel, lineLife, recentLeads, recentEvents, ownCompare, daily] =
    await Promise.all([
      prisma.ltProject.findUnique({
        where: { id: projectId },
        include: { connections: true },
      }),
      getAuthSession(),
      // Always the explicit-window form; an all-time window ({}) has nothing before it to compare.
      getPeriodComparison(projectId, 7, range ?? {}),
      getProjectStats(projectId, range),
      getChannelBreakdown(projectId, range),
      getStatusDistribution(projectId, range),
      getFunnel(projectId, range),
      getLineLifecycle(projectId, range),
      prisma.lead.findMany({ where: { projectId, ...inRange }, orderBy: { createdAt: "desc" }, take: 6, select: { id: true, fullName: true, displayName: true, channelGroup: true, status: true, value: true, currency: true } }),
      prisma.conversionEvent.findMany({ where: { projectId, ...inRange }, orderBy: { createdAt: "desc" }, take: 6, select: { id: true, eventName: true, platform: true, status: true, createdAt: true } }),
      ownCompareWindow ? getLeadMetrics(projectId, ownCompareWindow) : null,
      getDailyLeads(projectId, range),
    ]);
  if (!project) notFound();

  // Everyone who reaches this page is MarsOS staff (see guardProjectPage); the module has no client viewer.
  const isStaff = !!session?.user?.id;

  const progress = setupProgress(project.connections);
  const statusMap = connectionStatusMap(project.connections);

  const channelDonut = channels.map((c) => ({ name: c.channelGroup, value: c.leads }));
  const statusDonut = statusDist.map((s) => ({ name: LEAD_STATUS_LABEL[s.status as LeadStatus], value: s.count }));
  const purchaseStage = funnel.stages[funnel.stages.length - 1];
  const cvr = funnel.stages[0].count > 0 ? (purchaseStage.count / funnel.stages[0].count) * 100 : 0;
  // Use the cumulative funnel count so the KPI matches the funnel bar (not the exact-status count).
  const qualifiedReached = funnel.stages.find((s) => s.key === "qualified")?.count ?? stats.qualifiedLeads;

  // The comparison period's numbers. Null: nothing to compare with.
  const compared = ownCompare ?? (compare.mode === "prev" && cmp.comparable ? cmp.previous : null);
  const comparedLabel = ownCompareWindow ? windowLabel(ownCompareWindow) : "ก่อนหน้า";
  const compareTitle =
    compare.mode === "month"
      ? "เทียบกับเดือนก่อน (วันเดียวกัน)"
      : compare.mode === "custom"
        ? "เทียบกับช่วงที่เลือก"
        : compare.mode === "off"
          ? "สรุปช่วงที่เลือก"
          : "เทียบกับช่วงก่อนหน้า";
  const notCompared =
    compare.mode === "off"
      ? "ไม่เทียบ"
      : compare.mode === "custom"
        ? "ยังไม่ได้เลือกช่วงที่จะเทียบ"
        : "ทั้งหมด — ไม่มีช่วงก่อนหน้าให้เทียบ";

  // What the Overview shows: sales (the default) or Lead / LINE / CPA, saved per project by staff.
  const overview = parseOverviewSettings(project.connections.find((c) => c.type === OVERVIEW_SETTINGS_TYPE)?.configJson);
  const leadMode = overview.mode === "LEAD";
  const spend = spendForWindow(overview.adSpendByMonth, compare.current);
  const cpa = costPerLead(spend.amount, stats.totalLeads);
  const comparedSpend = compared && compare.window ? spendForWindow(overview.adSpendByMonth, compare.window) : null;
  const comparedCpa = compared && comparedSpend ? costPerLead(comparedSpend.amount, compared.leads) : null;
  const windowDays = compare.current
    ? Math.max(1, Math.round((compare.current.to.getTime() + 1 - compare.current.from.getTime()) / 86_400_000))
    : null;
  const missingText = spend.missingMonths.map(monthLabel).join(", ");
  const spendHint = spend.unbounded
    ? "เลือกช่วงวันที่ก่อน จึงจะเห็นงบโฆษณาและ CPA (ช่วง “ทั้งหมด” คำนวณไม่ได้)"
    : spend.missingMonths.length
      ? isStaff
        ? `ยังไม่ได้ใส่งบโฆษณาเดือน ${missingText} — ใส่ได้ที่ “งบโฆษณารายเดือน” ด้านบน`
        : `ยังไม่มีข้อมูลงบโฆษณาของเดือน ${missingText}`
      : null;
  // A cost: lower than the comparison period is the good direction.
  const cpaTileDelta = (() => {
    if (cpa == null || comparedCpa == null) return {};
    const t = tileDelta(cpa, comparedCpa);
    return t.deltaGood === null ? t : { delta: t.delta, deltaGood: (t.delta ?? 0) < 0 };
  })();
  const visitors = funnel.stages[0].count;
  const leadCvr = visitors > 0 ? (stats.totalLeads / visitors) * 100 : 0;
  const spendMonths = Object.entries(overview.adSpendByMonth).sort(([a], [b]) => b.localeCompare(a));
  const SEG = "rounded-lg px-3 py-1.5 text-sm font-medium";

  const BTN_SECONDARY =
    "inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50";
  const BTN_PRIMARY = "rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700";
  const base = `/line-tracking/projects/${project.id}`;
  // Tile trend lines: one value per day of the window. Under two days there is no line to draw.
  const spark = (pick: (p: (typeof daily.points)[number]) => number, color?: string) =>
    daily.points.length >= 2 ? <Sparkline values={daily.points.map(pick)} color={color} /> : undefined;
  const TH = "px-3 py-3 text-left font-semibold";
  const TD = "px-3 py-3 text-sm text-gray-700";
  const TABLE_BOX = "overflow-x-auto";
  // A status keeps its own colour whichever statuses are present in the window.
  const statusColors = statusDonut.map((d) => statusColor(d.name));
  const stageBars = ["bg-blue-800", "bg-blue-700", "bg-blue-600", "bg-blue-600", "bg-blue-500", "bg-blue-500", "bg-blue-500"];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">LINE Tracking</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="break-words text-2xl font-bold text-gray-900 sm:text-3xl">{project.name}</h1>
            <StatusBadge status={project.status} label={PROJECT_STATUS_LABEL[project.status as ProjectStatus]} />
            {isStaff && (
              <Link
                href={`${base}/settings#project-name`}
                className="text-xs font-medium text-blue-600 hover:underline"
                title="แก้ชื่อโปรเจกต์"
              >
                ✏️ แก้ชื่อ
              </Link>
            )}
          </div>
          <p className="mt-1 text-sm text-gray-500">
            {project.clientName} · {project.businessType} · {project.currency}
          </p>
        </div>
        {/* Staff-only controls — clients never see Funnel/Setup/Pause here (they use the sidebar). */}
        {isStaff && (
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`${base}/funnel`} className={BTN_SECONDARY}>🔻 Funnel</Link>
            <Link href={`${base}/setup`} className={BTN_SECONDARY}>🧩 Setup</Link>
            <form action={setProjectStatusAction}>
              <input type="hidden" name="projectId" value={project.id} />
              <input type="hidden" name="status" value={project.status === "LIVE" ? "PAUSED" : "LIVE"} />
              <button
                className={project.status === "LIVE" ? BTN_PRIMARY : `${BTN_PRIMARY} !bg-green-600 hover:!bg-green-700`}
                type="submit"
                title={project.status === "LIVE" ? "หยุดโปรเจกต์ = Looker Studio ดึงข้อมูลโปรเจกต์นี้ไม่ได้ (การเก็บ Lead ยังทำงานตามปกติ)" : "เปิดใช้งาน = Looker Studio ดึงข้อมูลโปรเจกต์นี้ได้"}
              >
                {project.status === "LIVE" ? "⏸ Pause" : "▶ Go Live"}
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Period and comparison pickers: they drive every panel below */}
      <div className="card p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-gray-900">ช่วงเวลา · {periodLabel}</h2>
          <DateRangeFilter base={base} query={q} extra={compareParams(q)} />
        </div>
        <CompareFilter base={base} query={q} info={compare} />
      </div>

      {/* What this Overview shows — staff only; clients see the saved choice. */}
      {isStaff && (
        <div className="card p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-gray-900">มุมมองหน้า Overview</h2>
              <p className="text-xs text-gray-500">ธุรกิจที่ไม่มียอดขายในระบบ เลือก Lead · LINE · CPA — บันทึกไว้ให้โปรเจกต์นี้ ลูกค้าเห็นแบบเดียวกัน</p>
            </div>
            <div className="inline-flex rounded-xl border border-gray-200 bg-gray-50 p-1" role="group" aria-label="มุมมองหน้า Overview">
              {([
                ["SALE", "ยอดขาย"],
                ["LEAD", "Lead · LINE · CPA"],
              ] as const).map(([mode, label]) => (
                <form key={mode} action={setOverviewModeAction}>
                  <input type="hidden" name="projectId" value={project.id} />
                  <input type="hidden" name="mode" value={mode} />
                  <button
                    type="submit"
                    aria-pressed={overview.mode === mode}
                    className={overview.mode === mode ? `${SEG} bg-white text-gray-900 shadow-sm` : `${SEG} text-gray-500 hover:text-gray-900`}
                  >
                    {label}
                  </button>
                </form>
              ))}
            </div>
          </div>
          {leadMode && (
            <details className="mt-4 border-t border-gray-100 pt-3" open={spendMonths.length === 0}>
              <summary className="cursor-pointer text-sm font-medium text-gray-700">
                งบโฆษณารายเดือน (ใช้คิด CPA){spendMonths.length ? ` · ใส่แล้ว ${spendMonths.length} เดือน` : ""}
              </summary>
              <form action={saveOverviewAdSpendAction} className="mt-3 flex flex-wrap items-end gap-2">
                <input type="hidden" name="projectId" value={project.id} />
                <label className="flex flex-col text-xs text-gray-500">
                  เดือน
                  <input
                    type="month"
                    name="month"
                    required
                    defaultValue={bkkMonthKey(new Date())}
                    placeholder="YYYY-MM"
                    className="mt-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900"
                  />
                </label>
                <label className="flex flex-col text-xs text-gray-500">
                  งบทั้งเดือน ({project.currency})
                  <input
                    type="text"
                    name="amount"
                    inputMode="decimal"
                    placeholder="เช่น 30,000"
                    className="mt-1 w-40 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900"
                  />
                </label>
                <button type="submit" className={BTN_PRIMARY}>บันทึก</button>
              </form>
              <p className="mt-2 text-xs text-gray-500">
                ใส่งบโฆษณาทั้งเดือน ระบบเฉลี่ยตามจำนวนวันของช่วงที่เลือก · เว้นว่างหรือใส่ 0 เพื่อลบเดือนนั้น
              </p>
              {spendMonths.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {spendMonths.map(([m, amt]) => (
                    <li key={m} className="rounded-lg bg-gray-50 px-3 py-1.5 text-xs text-gray-700">
                      {monthLabel(m)} · <span className="font-semibold tabular-nums">{fmtMoney(amt, project.currency)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </details>
          )}
        </div>
      )}

      {/* Headline KPI tiles */}
      <div>
        {/* The three results with a daily trend and a change against the comparison period come
            first; the funnel counts that have neither sit in the row under them. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <TintTile
            tint="blue"
            label="Leads (แอด LINE)"
            value={stats.totalLeads.toLocaleString()}
            {...tileDelta(stats.totalLeads, compared?.leads)}
          >
            {spark((p) => p.leads)}
          </TintTile>
          {leadMode ? (
            <>
              <TintTile
                label="เพื่อน LINE ตอนนี้"
                value={lineLife.friends.toLocaleString()}
                sub={`เคยทัก ${lineLife.engaged.toLocaleString()} · บล็อก ${lineLife.blocked.toLocaleString()}`}
              />
              <TintTile
                tint="mint"
                label="CPA (ต้นทุนต่อ Lead)"
                value={cpa != null ? fmtMoney(cpa, project.currency) : "—"}
                sub={cpa == null ? (spendHint ?? (stats.totalLeads === 0 ? "ยังไม่มี lead ในช่วงนี้" : undefined)) : undefined}
                {...cpaTileDelta}
              />
              <TintTile label="ผู้เข้าเว็บ (unique)" value={visitors.toLocaleString()} />
              <TintTile label="คุณภาพผ่าน (สะสม)" value={qualifiedReached.toLocaleString()} />
              <TintTile label="Conversion (คลิก→Lead)" value={`${leadCvr.toFixed(2)}%`} />
            </>
          ) : (
            <>
              <TintTile label="ปิดการขาย" value={stats.purchases.toLocaleString()} {...tileDelta(stats.purchases, compared?.purchases)}>
                {spark((p) => p.purchases, "#000E3F")}
              </TintTile>
              <TintTile
                tint="mint"
                label="ยอดขายรวม"
                value={fmtMoney(funnel.revenue, project.currency)}
                {...tileDelta(funnel.revenue, compared?.revenue)}
              >
                {spark((p) => p.revenue)}
              </TintTile>
              <TintTile label="ผู้เข้าเว็บ (unique)" value={funnel.stages[0].count.toLocaleString()} />
              <TintTile label="คุณภาพผ่าน (สะสม)" value={qualifiedReached.toLocaleString()} />
              <TintTile label="Conversion (คลิก→ซื้อ)" value={`${cvr.toFixed(2)}%`} />
            </>
          )}
        </div>
        {(daily.points.length >= 2 || compared) && (
          <p className="mt-2 text-xs text-gray-500">
            {[
              daily.points.length >= 2 ? "เส้นในการ์ด = แนวโน้มรายวัน นับตามวันที่ lead แอดเข้ามา" : null,
              compared ? `▲▼ = ${compareTitle}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
      </div>

      {/* The period against the comparison period: revenue bar, the figures under it, close-rate dial */}
      {leadMode ? (
        <LeadPeriodPerformance
          periodLabel={periodLabel}
          compareTitle={compareTitle}
          comparedLabel={comparedLabel}
          notCompared={notCompared}
          leads={stats.totalLeads}
          comparedLeads={compared ? compared.leads : null}
          qualified={qualifiedReached}
          spend={spend.amount}
          cpa={cpa}
          comparedCpa={comparedCpa}
          spendHint={spendHint}
          days={windowDays}
          currency={project.currency}
        />
      ) : (
        <PeriodPerformance
          periodLabel={periodLabel}
          compareTitle={compareTitle}
          comparedLabel={comparedLabel}
          notCompared={notCompared}
          current={cmp.current}
          compared={compared}
          currency={project.currency}
        />
      )}

      {/* Leads per day */}
      <DailyLeadsCard daily={daily} periodLabel={periodLabel} />

      {/* Breakdowns row */}
      <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-3">
        <SectionCard title="Lead แยกตามช่องทาง">
          <DonutChart data={channelDonut} centerValue={stats.totalLeads.toLocaleString()} centerLabel="leads" />
          <div className="mt-3"><ChartLegend data={channelDonut} decimals={1} /></div>
        </SectionCard>

        <SectionCard title="สถานะ Lead">
          <DonutChart data={statusDonut} colors={statusColors} centerValue={stats.totalLeads.toLocaleString()} centerLabel="ทั้งหมด" />
          <div className="mt-3"><ChartLegend data={statusDonut} colors={statusColors} decimals={1} /></div>
        </SectionCard>

        <SectionCard title="สถานะ LINE ตอนนี้">
          <p className="mb-3 text-xs text-gray-500">จำนวน ณ ปัจจุบัน (ไม่ใช่ยอดสะสม) — ต่างจาก funnel ด้านล่างที่นับแบบสะสม</p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { n: lineLife.friends, l: "เพื่อนตอนนี้" },
              { n: lineLife.engaged, l: "เคยทัก" },
              { n: lineLife.blocked, l: "บล็อก" },
            ].map((x) => (
              <div key={x.l} className="rounded-xl bg-gray-50 p-3 text-center">
                <div className="text-2xl font-bold tracking-tight text-gray-900">{x.n}</div>
                <div className="text-xs text-gray-500">{x.l}</div>
              </div>
            ))}
          </div>
          {/* mini funnel bars */}
          <div className="mt-4 space-y-1.5">
            {funnel.stages.map((s, i) => {
              const top = funnel.stages[0].count || 1;
              const w = Math.max((s.count / top) * 100, s.count > 0 ? 6 : 2);
              return (
                <div key={s.key} className="flex items-center gap-2 text-xs">
                  <span className="w-16 shrink-0 text-gray-500">{s.label}</span>
                  <div className="flex-1 rounded bg-gray-100">
                    <div className={`rounded py-1 text-right text-xs font-semibold text-white ${stageBars[i] ?? "bg-blue-500"}`} style={{ width: `${w}%`, paddingRight: 6, minWidth: 28 }}>
                      {s.count}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      </div>

      {/* Leads, closed sales, close rate and sales per channel */}
      {leadMode ? <ChannelLeadsTable channels={channels} /> : <ChannelTable channels={channels} currency={project.currency} />}

      {/* Setup progress — staff only (clients must not see connection/credential status) */}
      {isStaff && (
        <SectionCard title="Setup progress" action={<span className="text-sm font-semibold tabular-nums text-gray-900">{progress.percent}%</span>}>
          <TargetBar value={progress.percent} max={100} />
          <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
            {CONNECTION_TYPES.map((t) => (
              <div key={t} className="flex items-center justify-between gap-2 rounded-xl bg-gray-50 px-3 py-2">
                <span className="truncate text-sm text-gray-700">{CONNECTION_LABEL[t]}</span>
                <StatusBadge status={statusMap[t]} label={statusMap[t] === "CONNECTED" ? "✓" : statusMap[t] === "ERROR" ? "!" : "—"} />
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Recent tables */}
      <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-2">
        <SectionCard title="Leads ล่าสุด" action={<Link href={`${base}/leads`} className={`${BTN_SECONDARY} !px-3 !py-1.5 text-xs`}>ดูทั้งหมด</Link>}>
          <div className={TABLE_BOX}>
            <ResizableTable storageKey="lt-overview-2" className="min-w-full">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500"><tr><th className={TH}>Lead</th><th className={TH}>Channel</th><th className={TH}>Status</th><th className={`${TH} text-right`}>Value</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {recentLeads.length === 0 && <EmptyRow colSpan={4} text="ยังไม่มี lead" />}
                {recentLeads.map((l) => (
                  <tr key={l.id} className="hover:bg-gray-50">
                    <td className={`${TD} font-medium text-gray-900`}>{l.fullName ?? l.displayName ?? "(no name)"}</td>
                    <td className={TD}><StatusBadge status={l.channelGroup ?? "Direct"} label={l.channelGroup ?? "Direct"} /></td>
                    <td className={TD}><StatusBadge status={l.status} label={LEAD_STATUS_LABEL[l.status as LeadStatus]} /></td>
                    <td className={`${TD} text-right tabular-nums`}>{fmtMoney(l.value, l.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </ResizableTable>
          </div>
        </SectionCard>

        <SectionCard title="Conversion ล่าสุด" action={isStaff ? <Link href={`${base}/conversions`} className={`${BTN_SECONDARY} !px-3 !py-1.5 text-xs`}>Queue</Link> : undefined}>
          <div className={TABLE_BOX}>
            <ResizableTable storageKey="lt-overview-3" className="min-w-full">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500"><tr><th className={TH}>Event</th><th className={TH}>Platform</th><th className={TH}>Status</th><th className={TH}>Time</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {recentEvents.length === 0 && <EmptyRow colSpan={4} text="ยังไม่มี event" />}
                {recentEvents.map((e) => (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className={`${TD} font-medium text-gray-900`}>{e.eventName}</td>
                    <td className={TD}>{platformLabel(e.platform)}</td>
                    <td className={TD}><StatusBadge status={e.status} /></td>
                    <td className={`${TD} text-gray-500`}>{fmtDate(e.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </ResizableTable>
          </div>
        </SectionCard>
      </div>

      {/* การ์ด "Tracking links" ถูกถอดออกจากหน้านี้ (21 ส.ค. 2569 เจ้าของระบบสั่ง) —
          ทีมใช้งานได้ที่เมนู ตั้งค่า → Tracking Links */}
    </div>
  );
}
