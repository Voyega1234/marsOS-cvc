import Link from "next/link";
import { PageHeader } from "@/components/ds";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getFunnel, getChannelBreakdown, getChannelFunnel } from "@/lib/line-tracking/services/projectService";
import { SectionCard, StatusBadge, EmptyRow } from "@/components/line-tracking/ui";
import { DotPill, ShareBar, TintTile } from "@/components/ui/Widgets";
import { DonutChart, ChartLegend } from "@/components/line-tracking/Charts";
import { fmtMoney } from "@/lib/line-tracking/format";
import { DATE_RANGES, resolveRange, activeRangeKey } from "@/lib/line-tracking/date-range";
import { compareParams, delta, resolveCompare } from "@/lib/line-tracking/compare";
import { CompareFilter, DeltaBadge } from "@/components/line-tracking/CompareFilter";
import { guardProjectPage } from "@/lib/line-tracking/pageGuard";

export const dynamic = "force-dynamic";

// Warm funnel palette (top → bottom) matching the reference infographic.
// น้ำเงิน → ฟ้า → ฟ้าอ่อน (blue → sky → light sky)
const COLORS = ["#0618df", "#1d48f3", "#1d48f3", "#0ea5e9", "#38bdf8", "#7dd3fc", "#bae6fd"];
const ICONS = ["📢", "👉", "💬", "✍️", "⭐", "🧾", "💰"];
const DESC = [
  "คนเข้าเว็บ (นับ 1 ต่อคน ไม่ใช่ต่อครั้ง)",
  "กดปุ่ม Add LINE (ทุกช่องทาง)",
  "เพิ่มเพื่อนสำเร็จ",
  "เริ่มทักแชตกับเรา",
  "Lead คุณภาพผ่านเกณฑ์",
  "เสนอราคาแล้ว",
  "ปิดการขาย / จ่ายเงิน",
];

/** The comparison period's value under a table cell's own number. Nothing when no comparison is on. */
function Was({ cur, prev, text }: { cur: number; prev: number | undefined; text?: string }) {
  if (prev === undefined) return null;
  return (
    <div className="text-xs font-normal leading-tight text-gray-500">
      {text ?? prev.toLocaleString()} <DeltaBadge cur={cur} prev={prev} className="text-xs font-semibold" />
    </div>
  );
}

export default async function FunnelPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ range?: string; from?: string; to?: string; cmp?: string; cfrom?: string; cto?: string }>;
}) {
  const { projectId } = await params;
  await guardProjectPage(projectId, { clientAllowed: true });
  const query = await searchParams;
  const range = resolveRange(query);
  // "เทียบกับ": off until a comparison is picked. Then the same numbers are read for that window too.
  const compare = resolveCompare(query, range, { fallback: "off" });
  // Single round-trip wave — `project.id` is just `projectId` from the URL, so the
  // project row no longer has to come back before the rest can be issued.
  const [project, funnel, channels, channelFunnel, prevFunnel, prevChannelFunnel] = await Promise.all([
    prisma.ltProject.findUnique({ where: { id: projectId } }),
    getFunnel(projectId, range),
    getChannelBreakdown(projectId, range),
    getChannelFunnel(projectId, range),
    compare.window ? getFunnel(projectId, compare.window) : null,
    compare.window ? getChannelFunnel(projectId, compare.window) : null,
  ]);
  if (!project) notFound();

  const top = funnel.stages[0].count || 1;
  const purchase = funnel.stages[funnel.stages.length - 1];
  const cvr = top > 0 ? (purchase.count / top) * 100 : 0;
  const channelDonut = channels.map((c) => ({ name: c.channelGroup, value: c.leads }));
  const bestCvrChannel = [...channelFunnel]
    .filter((c) => c.visits > 0 && c.purchases > 0)
    .sort((a, b) => b.purchases / b.visits - a.purchases / a.visits)[0]?.channel;
  const activeRange = activeRangeKey(query);
  const N = funnel.stages.length;
  const widthAt = (k: number) => 100 - (k / N) * 62; // 100% → ~38%

  const base = `/line-tracking/projects/${project.id}/funnel`;

  // Comparison period (all of this is empty / undefined while no comparison is on).
  const cmpKeep = Object.entries(compareParams(query)).filter(([, v]) => v != null && v !== "") as [string, string][];
  const cmpQs = cmpKeep.length ? `&${new URLSearchParams(cmpKeep).toString()}` : "";
  const prevStage = (key: string) => prevFunnel?.stages.find((s) => s.key === key)?.count;
  const prevPurchase = prevFunnel ? prevFunnel.stages[prevFunnel.stages.length - 1].count : undefined;
  const prevCvr = prevFunnel && prevFunnel.stages[0].count > 0 ? ((prevPurchase ?? 0) / prevFunnel.stages[0].count) * 100 : 0;
  const was = (cur: number, prev: number | undefined, text?: string) =>
    prev === undefined ? undefined : `ช่วงเทียบ ${text ?? prev.toLocaleString()} · ${delta(cur, prev).text}`;
  const prevByChannel = new Map((prevChannelFunnel ?? []).map((c) => [c.channel, c]));
  // A channel that only had traffic in the comparison period still gets a row, with zeros for this period.
  const channelRows = prevChannelFunnel
    ? [
        ...channelFunnel,
        ...prevChannelFunnel
          .filter((p) => !channelFunnel.some((c) => c.channel === p.channel))
          .map((p) => ({ ...p, visits: 0, btnClicks: 0, leads: 0, contacted: 0, qualified: 0, quoted: 0, purchases: 0, revenue: 0 })),
      ]
    : channelFunnel;

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader eyebrow="LINE Tracking" title={<>Marketing Funnel · {project.name}</>} subtitle={<>เข้าเว็บ → กดปุ่ม LINE → แอด → ทัก → ปิดการขาย (ทุกช่องทาง)</>} />

      {/* Date range filter */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1 rounded-xl bg-gray-100 p-1">
        {DATE_RANGES.map((r) => (
          <Link
            key={r.key}
            href={`${base}?range=${r.key}${cmpQs}`}
            className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors sm:py-1.5 ${
              activeRange === r.key ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {r.label}
          </Link>
        ))}
        </div>
        <form action={base} method="get" className="flex w-full flex-wrap items-center gap-1 sm:w-auto">
          <input type="hidden" name="range" value="custom" />
          {cmpKeep.map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <input type="date" name="from" defaultValue={query.from} className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 sm:flex-none" />
          <span className="text-gray-500">–</span>
          <input type="date" name="to" defaultValue={query.to} className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 sm:flex-none" />
          <button type="submit" className={`rounded-xl px-3 py-1.5 text-sm font-medium ${activeRange === "custom" ? "bg-blue-600 text-white hover:bg-blue-700" : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"}`}>
            เลือกช่วง
          </button>
        </form>
      </div>

      {/* Compare with another period */}
      <CompareFilter base={base} query={query} info={compare} />

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <TintTile tint="blue" label="ผู้เข้าเว็บ (unique)" value={funnel.stages[0].count.toLocaleString()} sub={was(funnel.stages[0].count, prevFunnel?.stages[0].count)} />
        <TintTile label="กดปุ่ม Add LINE" value={funnel.stages[1].count.toLocaleString()} sub={was(funnel.stages[1].count, prevFunnel?.stages[1].count)} />
        <TintTile label="ปิดการขาย" value={purchase.count.toLocaleString()} sub={was(purchase.count, prevPurchase)} />
        <TintTile tint="mint" label="ยอดขายรวม" value={fmtMoney(funnel.revenue, project.currency)} sub={was(funnel.revenue, prevFunnel?.revenue, prevFunnel ? fmtMoney(prevFunnel.revenue, project.currency) : undefined)} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Trapezoid funnel */}
        <div className="lg:col-span-2">
          <div className="card p-4 sm:p-5">
            <div className="mx-auto mb-5 w-fit max-w-full rounded-2xl bg-blue-600 px-4 py-2 text-center sm:rounded-full sm:px-6 text-sm font-bold text-white">
              Marketing Funnel · conversion {cvr.toFixed(2)}%
              {prevFunnel && <span className="font-medium"> (ช่วงเทียบ {prevCvr.toFixed(2)}%)</span>}
            </div>
            <div>
              {funnel.stages.map((s, i) => {
                const topW = widthAt(i);
                const botW = widthAt(i + 1);
                const clip = `polygon(${(100 - topW) / 2}% 0, ${(100 + topW) / 2}% 0, ${(100 + botW) / 2}% 100%, ${(100 - botW) / 2}% 100%)`;
                const prev = i === 0 ? null : funnel.stages[i - 1].count;
                const stepRate = prev && prev > 0 ? (s.count / prev) * 100 : null;
                const before = prevStage(s.key);
                return (
                  <div key={s.key} className="flex items-stretch">
                    {/* funnel band */}
                    <div className="w-1/2">
                      <div
                        className={`-mt-px flex h-full min-h-[62px] items-center justify-center gap-1 sm:gap-2 ${i >= 4 ? "text-blue-950" : "text-white"}`}
                        style={{ background: COLORS[i], clipPath: clip }}
                      >
                        <span className="text-base sm:text-lg">{ICONS[i]}</span>
                        <span className="text-base font-extrabold sm:text-lg">{s.count.toLocaleString()}</span>
                      </div>
                    </div>
                    {/* label + desc */}
                    <div className="flex min-w-0 flex-1 flex-col justify-center pl-3 sm:pl-4">
                      <div className="break-words text-sm font-bold text-gray-800">
                        {s.label}
                        {stepRate !== null && (
                          <span className="ml-2 align-middle">
                            <DotPill tone={stepRate < 60 ? "red" : stepRate < 100 ? "amber" : "green"}>↓ {stepRate.toFixed(0)}%</DotPill>
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500">{DESC[i]}</div>
                      {before !== undefined && (
                        <div className="text-xs text-gray-400">
                          ช่วงเทียบ: {before.toLocaleString()}{" "}
                          <DeltaBadge cur={s.count} prev={before} className="text-xs font-semibold" />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Side */}
        <div className="min-w-0 space-y-6">
          <SectionCard title="Lead แยกช่องทาง">
            {channelDonut.length <= 6 ? (
              <div>
                <div className="mb-3 flex items-baseline gap-2">
                  <span className="text-2xl font-bold tracking-tight text-gray-900">{funnel.stages[2].count.toLocaleString()}</span>
                  <span className="text-xs text-gray-500">leads</span>
                </div>
                <ShareBar items={channelDonut.map((d) => ({ label: d.name, value: d.value }))} emptyText="ยังไม่มีข้อมูล" />
              </div>
            ) : (
              <>
                <DonutChart data={channelDonut} centerValue={funnel.stages[2].count.toLocaleString()} centerLabel="leads" />
                <div className="mt-3"><ChartLegend data={channelDonut} /></div>
              </>
            )}
          </SectionCard>

          <TintTile tint="red" label="🚫 บล็อก OA (Churn)" value={funnel.blocked.toLocaleString()} sub="แอดแล้วบล็อกทิ้ง — ยิง line_block เข้า GA4">
            {prevFunnel && (
              <div className="text-xs text-gray-500">
                ช่วงเทียบ: {prevFunnel.blocked.toLocaleString()}{" "}
                <DeltaBadge cur={funnel.blocked} prev={prevFunnel.blocked} lowerIsBetter className="text-xs font-semibold" />
              </div>
            )}
          </TintTile>
        </div>
      </div>

      {/* Full funnel by channel — เห็นลึกตั้งแต่เข้าเว็บ */}
      <SectionCard title="Funnel แยกตามช่องทาง (ตั้งแต่เข้าเว็บ → ปิดการขาย)">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] table-fixed border-separate border-spacing-0">
            <colgroup>
              <col className="w-[26%]" />
              {Array.from({ length: 9 }).map((_, i) => <col key={i} />)}
            </colgroup>
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-3 text-left font-semibold">Channel</th>
                <th className="px-1.5 py-3 text-right font-semibold" title="ผู้เข้าเว็บ นับ 1 ต่อคน">Visitors</th>
                <th className="px-1.5 py-3 text-right font-semibold">Click</th>
                <th className="px-1.5 py-3 text-right font-semibold">Add</th>
                <th className="px-1.5 py-3 text-right font-semibold">Chat</th>
                <th className="px-1.5 py-3 text-right font-semibold">Quality</th>
                <th className="px-1.5 py-3 text-right font-semibold">Offer</th>
                <th className="px-1.5 py-3 text-right font-semibold">Closed</th>
                <th className="px-1.5 py-3 text-right font-semibold">CVR</th>
                <th className="px-3 py-3 text-right font-semibold">Sales</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {channelRows.length === 0 && <EmptyRow colSpan={10} text="ยังไม่มีข้อมูลในช่วงนี้" />}
              {channelRows.map((c) => {
                const rate = c.visits > 0 ? (c.purchases / c.visits) * 100 : 0;
                // With a comparison on, a channel the other period does not have counts as zero there.
                const p = prevChannelFunnel ? prevByChannel.get(c.channel) : undefined;
                const z = prevChannelFunnel ? 0 : undefined;
                const best = bestCvrChannel === c.channel && rate > 0;
                return (
                  <tr key={c.channel} className={`hover:bg-gray-50 ${best ? "bg-blue-50/60" : ""}`}>
                    <td className="px-3 py-3 text-sm">
                      {best && <span title="CVR สูงสุด" className="mr-1">⭐</span>}
                      <StatusBadge status={c.channel} label={c.channel} />
                    </td>
                    <td className="px-1.5 py-3 text-right text-sm tabular-nums font-medium">{c.visits.toLocaleString()}<Was cur={c.visits} prev={p?.visits ?? z} /></td>
                    <td className="px-1.5 py-3 text-right text-sm tabular-nums text-gray-500">{c.btnClicks.toLocaleString()}<Was cur={c.btnClicks} prev={p?.btnClicks ?? z} /></td>
                    <td className="px-1.5 py-3 text-right text-sm tabular-nums">{c.leads.toLocaleString()}<Was cur={c.leads} prev={p?.leads ?? z} /></td>
                    <td className="px-1.5 py-3 text-right text-sm tabular-nums">{c.contacted.toLocaleString()}<Was cur={c.contacted} prev={p?.contacted ?? z} /></td>
                    <td className="px-1.5 py-3 text-right text-sm tabular-nums">{c.qualified.toLocaleString()}<Was cur={c.qualified} prev={p?.qualified ?? z} /></td>
                    <td className="px-1.5 py-3 text-right text-sm tabular-nums">{c.quoted.toLocaleString()}<Was cur={c.quoted} prev={p?.quoted ?? z} /></td>
                    <td className="px-1.5 py-3 text-right text-sm tabular-nums font-medium text-gray-900">{c.purchases.toLocaleString()}<Was cur={c.purchases} prev={p?.purchases ?? z} /></td>
                    <td className={`px-1.5 py-3 text-right text-sm tabular-nums ${best ? "font-bold text-blue-600" : "text-gray-500"}`}>{rate > 0 ? `${rate.toFixed(2)}%` : "—"}</td>
                    <td className="px-3 py-3 text-right text-sm font-medium tabular-nums text-gray-900">
                      {fmtMoney(c.revenue, project.currency)}
                      <Was cur={c.revenue} prev={p?.revenue ?? z} text={fmtMoney(p?.revenue ?? 0, project.currency)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
