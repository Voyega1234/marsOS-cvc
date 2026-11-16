"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Radar } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AreaChart, Chip, DonutChart, EmptyState, KpiTile, Panel, chartColor,
} from "@/components/ds";
import { METRIC_DEFINITIONS, type CitationOwner, type Kpis, type OverviewDTO, type PromptRowDTO } from "@/lib/brand-radar/types";
import { replaceUrlParams } from "@/lib/url-state";
import { api, fmtDateTime, fmtNum, fmtPct, fmtRange, INSUFFICIENT, isSmallSample, NO_DATA_MESSAGE, providerShort, radarQuery, type TabProps } from "./shared";

const def = (key: string) => METRIC_DEFINITIONS.find((m) => m.key === key);

/** percentage-point delta, only when both sides are known */
function pctDelta(cur: number | null | undefined, prev: number | null | undefined): number | null {
  if (cur === null || cur === undefined || prev === null || prev === undefined) return null;
  return (cur - prev) * 100;
}
function numDelta(cur: number | null | undefined, prev: number | null | undefined): number | null {
  if (cur === null || cur === undefined || prev === null || prev === undefined) return null;
  return cur - prev;
}

const pctAxis = (n: number) => `${Math.round(n * 100)}%`;

const OWNER_LABEL: Record<CitationOwner, string> = { own: "เว็บเรา", competitor: "เว็บคู่แข่ง", external: "เว็บอื่น" };
const OWNER_COLOR: Record<CitationOwner, string> = { own: "#1d48f3", competitor: "#e35336", external: "#98a3b6" };

function NoData({ text = "ยังไม่มีข้อมูล" }: { text?: string }) {
  return <div className="flex h-32 items-center justify-center text-center text-sm text-gray-500">{text}</div>;
}

interface RateBarRow { key: string; label: string; method?: string; rate: number | null; n: number }

function RateBars({ rows }: { rows: RateBarRow[] }) {
  return (
    <ul className="space-y-3">
      {rows.map((r) => {
        const k = r.rate === null ? 0 : Math.round(r.rate * r.n);
        const range = fmtRange(r.rate, r.n);
        return (
          <li key={r.key}>
            <div className="flex items-start justify-between gap-3">
              <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm text-gray-700">
                <span>{r.label}</span>
                {r.method !== undefined && <Chip>{r.method === "observed_serp" ? "Observed" : "API"}</Chip>}
              </span>
              {r.rate === null ? (
                <span className="shrink-0 text-xs text-gray-500">ยังไม่มีข้อมูล</span>
              ) : (
                <span className="shrink-0 text-right">
                  <span className="block text-sm font-bold tabular-nums text-brand-navy">{fmtPct(r.rate)}</span>
                  <span className="block text-[11px] text-gray-500">
                    {fmtNum(k)} จาก {fmtNum(r.n)} คำตอบ{range ? ` · ช่วง ${range}` : ""}
                  </span>
                  {isSmallSample(r.n) ? (
                    <span title="ถามน้อยกว่า 10 รอบ ตัวเลขยังแกว่งมาก" className="mt-0.5 inline-block rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">ตัวอย่างน้อย</span>
                  ) : null}
                </span>
              )}
            </div>
            {r.rate !== null && (
              <div className="mt-1.5 h-2 rounded-full bg-gray-100">
                <div className="h-2 rounded-full bg-brand-blue" style={{ width: `${r.rate * 100}%`, minWidth: r.rate > 0 ? 2 : 0 }} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function OverviewTab({ projectId, filters, refreshKey, onGoTab }: TabProps) {
  const [data, setData] = useState<OverviewDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [defsOpen, setDefsOpen] = useState(false);

  const query = radarQuery(projectId, filters);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void (async () => {
      const res = await api<OverviewDTO>(`/api/brand-radar/overview?${query}`);
      if (cancelled) return;
      if (!res.ok) setError(res.data.error || "โหลดข้อมูลภาพรวมไม่สำเร็จ");
      else setData(res.data as OverviewDTO);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [query, refreshKey, retry]);

  if (loading && !data) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-gray-100" />)}
        </div>
        <div className="h-64 animate-pulse rounded-3xl bg-gray-100" />
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        {error}
        <Button size="sm" variant="outline" className="ml-3" onClick={() => setRetry((n) => n + 1)}>ลองใหม่</Button>
      </div>
    );
  }
  if (!data) return null;

  if (!data.configured) {
    return (
      <Panel>
        <EmptyState
          icon={<Radar className="h-6 w-6" />}
          title="ยังไม่ได้ตั้งค่าแบรนด์"
          description="ตั้งชื่อแบรนด์ โดเมน และ AI platform ที่จะติดตามที่แท็บ Settings ก่อน"
          action={<Button onClick={() => onGoTab("settings")}>ไปที่ Settings</Button>}
        />
      </Panel>
    );
  }
  if (!data.hasData) {
    return (
      <Panel>
        <EmptyState
          icon={<Radar className="h-6 w-6" />}
          title={NO_DATA_MESSAGE}
          description="ตรวจว่าเชื่อมต่อ AI platform แล้วและมี Prompt ที่ใช้งาน จากนั้นกด Run scan now"
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => onGoTab("settings")}>Settings</Button>
              <Button variant="outline" onClick={() => onGoTab("prompts")}>AI Prompts</Button>
            </div>
          }
        />
      </Panel>
    );
  }

  const k: Kpis = data.kpis;
  const p: Kpis | null = data.previous;
  const trendRows = data.trend;
  const notComparable = trendRows.filter((t) => !t.comparable).length;
  const trendHasValue = trendRows.some((t) => t.mentionRate !== null || t.citationRate !== null || t.shareOfVoice !== null);

  const sovEntities = data.entities.filter((e) => e.mentions > 0);
  const sovTotal = sovEntities.reduce((s, e) => s + e.mentions, 0);

  const providerRows: RateBarRow[] = data.byProvider.map((x) => ({ key: x.provider, label: x.label || providerShort(x.provider), method: x.method, rate: x.mentionRate, n: x.responses }));
  const intentRows: RateBarRow[] = data.byIntent.map((x) => ({ key: x.intent, label: x.label, rate: x.mentionRate, n: x.responses }));
  const rated = data.byProvider.filter((x) => x.mentionRate !== null);
  const bestP = rated.reduce<(typeof rated)[number] | null>((a, x) => (a === null || (x.mentionRate ?? 0) > (a.mentionRate ?? 0) ? x : a), null);
  const worstP = rated.reduce<(typeof rated)[number] | null>((a, x) => (a === null || (x.mentionRate ?? 0) < (a.mentionRate ?? 0) ? x : a), null);
  const topComp = data.entities
    .filter((e) => e.entityType === "competitor" && e.mentions > 0)
    .reduce<(typeof data.entities)[number] | null>((a, e) => (a === null || e.mentions > a.mentions ? e : a), null);
  const trendMaxPoints = trendRows.length;
  const summaryRange = fmtRange(k.mentionRate, k.responses);
  const ownerSegs = data.citationOwners.filter((o) => o.citations > 0);
  const heatHasValue = data.heat.values.some((r) => r.some((v) => v !== null));

  const openPrompt = (id: string) => {
    replaceUrlParams({ prompt: id });
    onGoTab("prompts");
  };

  const promptList = (rows: PromptRowDTO[]) =>
    rows.length === 0 ? <NoData /> : (
      <ul className="divide-y divide-gray-100">
        {rows.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => openPrompt(r.id)} className="flex w-full items-start justify-between gap-3 py-2 text-left hover:bg-gray-50">
              <span className="min-w-0 text-sm text-gray-700">{r.text}</span>
              <span className="shrink-0 text-right text-xs text-gray-500">
                <span className="block font-semibold text-brand-navy">{fmtPct(r.stats.mentionRate)}</span>
                {fmtNum(r.stats.responses)} คำตอบ
              </span>
            </button>
          </li>
        ))}
      </ul>
    );

  return (
    <div className="space-y-4">
      <Panel title="สรุปสั้น ๆ">
        <ul className="space-y-1.5 text-sm text-gray-700">
          <li>
            จาก {fmtNum(k.responses)} คำตอบ AI พูดถึงแบรนด์เรา {fmtNum(k.brandMentions)} ครั้ง ({fmtPct(k.mentionRate)})
            {summaryRange ? ` ช่วงที่น่าจะเป็น ${summaryRange}` : ""}
          </li>
          {bestP && <li>AI ที่พูดถึงเรามากสุด: {providerShort(bestP.provider)} ({fmtPct(bestP.mentionRate)})</li>}
          {worstP && rated.length > 1 && <li>AI ที่พูดถึงเราน้อยสุด: {providerShort(worstP.provider)} ({fmtPct(worstP.mentionRate)})</li>}
          <li>{topComp ? `คู่แข่งที่ถูกพูดถึงมากสุด: ${topComp.name} ${fmtNum(topComp.mentions)} ครั้ง` : "ยังไม่มีคู่แข่งถูกพูดถึงในคำตอบ"}</li>
        </ul>
        {isSmallSample(k.responses) && (
          <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">ตัวอย่างยังน้อย ตัวเลขอาจแกว่ง ควรสแกนเพิ่ม</p>
        )}
      </Panel>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <KpiTile label="AI พูดถึงเรา" value={fmtPct(k.mentionRate)} delta={pctDelta(k.mentionRate, p?.mentionRate)} deltaSuffix=" pt" tone="blue" hint={`Mention Rate: ${def("mentionRate")?.formula ?? ""}`} footer={<span className="text-xs text-gray-500">{fmtNum(k.brandMentions)} จาก {fmtNum(k.responses)} คำตอบ</span>} />
        <KpiTile label="จำนวนครั้งที่ถูกพูดถึง" value={fmtNum(k.brandMentions)} delta={numDelta(k.brandMentions, p?.brandMentions)} deltaSuffix="" hint={def("brandMentions")?.formula} />
        <KpiTile label="เว็บเราถูกอ้างอิง" value={fmtPct(k.citationRate)} delta={pctDelta(k.citationRate, p?.citationRate)} deltaSuffix=" pt" tone="sky" hint={def("citationRate")?.formula} />
        <KpiTile label="Share of Voice" value={fmtPct(k.shareOfVoice)} delta={pctDelta(k.shareOfVoice, p?.shareOfVoice)} deltaSuffix=" pt" tone="mist" hint={def("shareOfVoice")?.formula} />
        <KpiTile label="Prompt ที่ติดตาม" value={fmtNum(k.monitoringPrompts)} delta={numDelta(k.monitoringPrompts, p?.monitoringPrompts)} deltaSuffix="" hint="Prompts with status ACTIVE" />
        <KpiTile label="สแกนล่าสุด" value={k.lastScanAt ? fmtDateTime(k.lastScanAt) : INSUFFICIENT} hint="Date of the newest scan" />
      </div>

      <Panel title="Visibility Trend" subtitle="เปลี่ยนไปอย่างไรในแต่ละสแกน">
        {trendRows.length === 0 || !trendHasValue ? <NoData /> : trendMaxPoints < 2 ? (
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
            <p>ต้องสแกนอย่างน้อย 2 ครั้งจึงเห็นแนวโน้ม — ตอนนี้มี {trendMaxPoints} ครั้ง</p>
            <p className="mt-1 text-xs text-gray-500">
              Mention rate {fmtPct(k.mentionRate)} · Citation rate {fmtPct(k.citationRate)} · Share of Voice {fmtPct(k.shareOfVoice)}
            </p>
          </div>
        ) : (
          <>
            <AreaChart
              height={260}
              showLegend
              formatValue={pctAxis}
              ariaLabel="Visibility trend"
              series={[
                { name: "AI Mention Rate", color: chartColor(0), points: trendRows.map((t) => ({ label: t.label, value: t.mentionRate })) },
                { name: "Domain Citation Rate", color: chartColor(1), fill: false, points: trendRows.map((t) => ({ label: t.label, value: t.citationRate })) },
                { name: "Share of Voice", color: chartColor(5), fill: false, dashed: true, points: trendRows.map((t) => ({ label: t.label, value: t.shareOfVoice })) },
              ]}
            />
            {notComparable > 0 && (
              <p className="mt-2 text-xs text-amber-700">
                {notComparable} scan ไม่ comparable (ชุด prompt หรือ AI platform ต่างจากสแกนล่าสุด) ควรเทียบด้วยความระวัง
              </p>
            )}
          </>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Share of Voice" subtitle="Brand vs competitors">
          {sovTotal === 0 || !topComp ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center text-sm text-gray-600">
              <p>ยังไม่มีคู่แข่งถูกพูดถึงในคำตอบ จึงยังเทียบสัดส่วนไม่ได้</p>
              <Button variant="outline" size="sm" onClick={() => onGoTab("settings")}>เพิ่มคู่แข่งใน Settings</Button>
            </div>
          ) : (
            <>
              <DonutChart
                segments={sovEntities.map((e, i) => ({ label: e.name, value: e.mentions, color: e.entityType === "brand" ? chartColor(0) : chartColor(i + 1) }))}
                centerValue={fmtPct(k.shareOfVoice)}
                centerLabel="Share of Voice"
                ariaLabel="Share of voice"
              />
              <p className="mt-3 text-xs text-gray-500">สัดส่วนการถูกพูดถึงของเราเทียบกับคู่แข่งที่ติดตาม</p>
            </>
          )}
        </Panel>

        <Panel title="AI แต่ละตัวพูดถึงเรากี่ %" subtitle="แยกตามวิธีเก็บคำตอบ ไม่ปนกัน">
          {providerRows.length === 0 ? <NoData /> : (
            <>
              <RateBars rows={providerRows} />
              <p className="mt-3 text-xs text-gray-500">
                API = ถามผ่าน API พร้อมค้นเว็บ (ใกล้เคียงแอปจริง) · Observed = อ่านจากหน้า Google จริง
              </p>
            </>
          )}
        </Panel>

        <Panel title="แยกตามประเภทคำถาม (intent)">
          {intentRows.length === 0 ? <NoData /> : <RateBars rows={intentRows} />}
        </Panel>

        <Panel title="หัวข้อ × AI" subtitle="AI พูดถึงเรากี่ % ในแต่ละหัวข้อ; – = ยังไม่มีข้อมูล">
          {data.heat.rows.length === 0 || data.heat.columns.length === 0 || !heatHasValue ? <NoData /> : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full border-separate border-spacing-1 text-xs">
                  <thead>
                    <tr>
                      <th className="text-left font-medium text-gray-500" />
                      {data.heat.columns.map((c) => (
                        <th key={c} className="px-1 text-center font-medium text-gray-600">{providerShort(c)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.heat.rows.map((row, ri) => (
                      <tr key={row}>
                        <th className="pr-2 text-left font-medium text-gray-700">{row}</th>
                        {data.heat.columns.map((c, ci) => {
                          const v = data.heat.values[ri]?.[ci] ?? null;
                          return v === null ? (
                            <td key={c} className="rounded-md bg-gray-50 px-2 py-1.5 text-center text-gray-400">–</td>
                          ) : (
                            <td
                              key={c}
                              className={`rounded-md px-2 py-1.5 text-center tabular-nums ${v >= 0.5 ? "text-white" : "text-gray-800"}`}
                              style={{ backgroundColor: `rgba(29,72,243,${0.08 + 0.72 * v})` }}
                            >
                              {fmtPct(v, 0)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-gray-500">สีเข้ม = AI พูดถึงเราบ่อย (0% ถึง 100%)</p>
            </>
          )}
        </Panel>

        <Panel title="เว็บที่ AI อ้างอิง (แยกเจ้าของ)" subtitle="ลิงก์ที่ AI อ้างอิง แยกตามเจ้าของโดเมน">
          {ownerSegs.length === 0 ? <NoData /> : (
            <DonutChart
              segments={ownerSegs.map((o) => ({ label: OWNER_LABEL[o.ownerType], value: o.citations, color: OWNER_COLOR[o.ownerType] }))}
              centerValue={fmtNum(ownerSegs.reduce((s, o) => s + o.citations, 0))}
              centerLabel="ลิงก์อ้างอิง"
              ariaLabel="Citation sources by owner"
            />
          )}
        </Panel>

        <Panel title="โดเมนที่ถูกอ้างอิงมากสุด">
          {data.topCitedDomains.length === 0 ? <NoData /> : (
            <div className="space-y-1.5">
              {(() => {
                const max = Math.max(...data.topCitedDomains.map((d) => d.citations), 1);
                return data.topCitedDomains.map((d) => (
                  <div key={d.domain} className="text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className="truncate font-medium text-gray-700">{d.domain}</span>
                        {d.vendor && <Chip tone="info">อยู่ในคลัง Backlink</Chip>}
                        {d.isOwnPbn && <Chip tone="ok">PBN ของเรา</Chip>}
                        {d.ownerType === "own" && <Chip tone="ok">Own</Chip>}
                        {d.ownerType === "competitor" && <Chip tone="bad">{d.competitorName || "Competitor"}</Chip>}
                      </span>
                      <span className="text-xs tabular-nums text-gray-500">{fmtNum(d.citations)}</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-gray-100">
                      <div className="h-1.5 rounded-full bg-brand-blue" style={{ width: `${(d.citations / max) * 100}%` }} />
                    </div>
                  </div>
                ));
              })()}
            </div>
          )}
        </Panel>

        <Panel title="Prompt ที่เราขึ้นบ่อยสุด" subtitle="AI พูดถึงเราสูงสุด">{promptList(data.topPrompts)}</Panel>
        <Panel title="Prompt ที่เราขึ้นน้อยสุด" subtitle="AI พูดถึงเราต่ำสุด">{promptList(data.weakPrompts)}</Panel>
      </div>

      {k.estimatedVisibility !== null && (
        <Panel title="Estimated Visibility (estimate, not impressions)" subtitle={def("estimatedVisibility")?.formula}>
          <div className="text-2xl font-semibold text-brand-navy">{fmtPct(k.estimatedVisibility)}</div>
          <p className="mt-1 text-xs text-gray-500">
            คำนวณจาก {fmtNum(k.estimatedVisibilityPrompts)} prompts ที่ทราบ search volume — {def("estimatedVisibility")?.note}
          </p>
        </Panel>
      )}

      <Panel
        title={
          <button type="button" className="flex items-center gap-1.5" onClick={() => setDefsOpen((o) => !o)} aria-expanded={defsOpen}>
            {defsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            Metric definitions
          </button>
        }
      >
        {defsOpen && (
          <dl className="space-y-3">
            {METRIC_DEFINITIONS.map((m) => (
              <div key={m.key}>
                <dt className="text-sm font-semibold text-brand-navy">{m.name}</dt>
                <dd className="text-xs text-gray-700">{m.formula}</dd>
                <dd className="text-xs text-gray-500">{m.note}</dd>
              </div>
            ))}
          </dl>
        )}
      </Panel>
      {loading && <Loader2 className="mx-auto h-4 w-4 animate-spin text-gray-400" />}
    </div>
  );
}
