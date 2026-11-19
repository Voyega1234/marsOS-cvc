"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip, Panel } from "@/components/ds";
import { METRIC_DEFINITIONS, type OverviewDTO, type PromptRowDTO } from "@/lib/brand-radar/types";
import { replaceUrlParams } from "@/lib/url-state";
import ReportDashboard from "./ReportDashboard";
import type { BrandOpt } from "./ReportDossier";
import { ProviderLogo } from "./ProviderLogo";
import { ColumnHelp } from "./ColumnHelp";
import { api, fmtNum, fmtPct, fmtRange, isSmallSample, providerShort, radarCacheGeneration, radarCacheGet, radarCacheSet, radarQuery, type TabProps } from "./shared";

const def = (key: string) => METRIC_DEFINITIONS.find((m) => m.key === key);

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
                {r.method !== undefined && <Chip>{r.method === "observed_serp" ? "Observed" : r.method === "observed_chat" ? "Real answer" : "API"}</Chip>}
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

/**
 * Overview = the card dashboard (ReportDashboard, one request) on top, then the extra detail
 * that the dashboard does not show: intent, topic x AI heat map, best / weakest prompts, estimated visibility.
 */
export default function OverviewTab({ projectId, filters, refreshKey, onGoTab, clientView, brands, onSwitchBrand }: TabProps & { brands?: BrandOpt[]; onSwitchBrand?: (id: string) => void }) {
  const query = radarQuery(projectId, filters);
  const [data, setData] = useState<OverviewDTO | null>(() => radarCacheGet<OverviewDTO>(`/api/brand-radar/overview?${query}`, refreshKey));
  const [loading, setLoading] = useState(() => data === null);
  const [defsOpen, setDefsOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const url = `/api/brand-radar/overview?${query}`;
    const cached = radarCacheGet<OverviewDTO>(url, refreshKey);
    const gen = radarCacheGeneration();
    // a repeat visit shows the last loaded detail at once and refreshes it in the background
    setLoading(cached === null);
    setData(cached);
    void (async () => {
      const res = await api<OverviewDTO>(url, { signal: controller.signal });
      if (cancelled) return;
      // a failed detail request just hides the detail section; the dashboard has its own error state
      if (res.ok) {
        radarCacheSet(url, refreshKey, res.data, gen);
        setData(res.data as OverviewDTO);
      } else if (cached === null) setData(null);
      setLoading(false);
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [query, refreshKey]);

  const showDetail = !!data && data.configured && data.hasData;
  const k = data?.kpis;
  const intentRows: RateBarRow[] = (data?.byIntent ?? []).map((x) => ({ key: x.intent, label: x.label, rate: x.mentionRate, n: x.responses }));
  const heat = data?.heat;
  const heatHasValue = !!heat && heat.values.some((r) => r.some((v) => v !== null));

  const openPrompt = (id: string) => {
    if (clientView) return;
    replaceUrlParams({ prompt: id });
    onGoTab("prompts");
  };

  const promptList = (rows: PromptRowDTO[]) =>
    rows.length === 0 ? <NoData /> : (
      <ul className="divide-y divide-gray-100">
        {rows.map((r) => (
          <li key={r.id}>
            {clientView ? (
              <div className="flex w-full items-start justify-between gap-3 py-2 text-left">
                <span className="min-w-0 break-words text-sm text-gray-700">{r.text}</span>
                <span className="shrink-0 text-right text-xs text-gray-500">
                  <span className="block font-semibold text-brand-navy">{fmtPct(r.stats.mentionRate)}</span>
                  {fmtNum(r.stats.responses)} คำตอบ
                </span>
              </div>
            ) : (
              <button type="button" onClick={() => openPrompt(r.id)} className="flex min-h-[36px] w-full items-start justify-between gap-3 py-2 text-left hover:bg-gray-50">
                <span className="min-w-0 break-words text-sm text-gray-700">{r.text}</span>
                <span className="shrink-0 text-right text-xs text-gray-500">
                  <span className="block font-semibold text-brand-navy">{fmtPct(r.stats.mentionRate)}</span>
                  {fmtNum(r.stats.responses)} คำตอบ
                </span>
              </button>
            )}
          </li>
        ))}
      </ul>
    );

  return (
    <div className="space-y-4">
      <ReportDashboard projectId={projectId} filters={filters} refreshKey={refreshKey} onGoTab={onGoTab} clientView={clientView} brands={brands} onSwitchBrand={onSwitchBrand} />

      {showDetail && data && (
        <>
          <h2 className="pt-2 text-base font-semibold text-brand-navy">รายละเอียดเพิ่มเติม</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="แยกตามประเภทคำถาม (intent)">
              {intentRows.length === 0 ? <NoData /> : <RateBars rows={intentRows} />}
            </Panel>

            <Panel title="หัวข้อ × AI" subtitle="AI พูดถึงเรากี่ % ในแต่ละหัวข้อ; – = ยังไม่มีข้อมูล">
              {!heat || heat.rows.length === 0 || heat.columns.length === 0 || !heatHasValue ? <NoData /> : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[420px] border-separate border-spacing-1 text-xs">
                      <thead>
                        <tr>
                          <th className="text-left font-medium text-gray-500" />
                          {heat.columns.map((c) => (
                            <th key={c} className="px-1 text-center font-medium text-gray-600"><ColumnHelp k="heatPlatform"><ProviderLogo provider={c} size={18} title={providerShort(c)} /></ColumnHelp></th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {heat.rows.map((row, ri) => (
                          <tr key={row}>
                            <th className="max-w-[10rem] break-words pr-2 text-left font-medium text-gray-700"><ColumnHelp k="heatTopic" align="start">{row}</ColumnHelp></th>
                            {heat.columns.map((c, ci) => {
                              const v = heat.values[ri]?.[ci] ?? null;
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

            <Panel title="Prompt ที่เราขึ้นบ่อยสุด" subtitle="AI พูดถึงเราสูงสุด">{promptList(data.topPrompts ?? [])}</Panel>
            <Panel title="Prompt ที่เราขึ้นน้อยสุด" subtitle="AI พูดถึงเราต่ำสุด">{promptList(data.weakPrompts ?? [])}</Panel>
          </div>

          {!clientView && k && k.estimatedVisibility !== null && (
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
                {METRIC_DEFINITIONS.filter((m) => !(clientView && m.key === "estimatedVisibility")).map((m) => (
                  <div key={m.key}>
                    <dt className="text-sm font-semibold text-brand-navy">{m.name}</dt>
                    <dd className="text-xs text-gray-700">{m.formula}</dd>
                    <dd className="text-xs text-gray-500">{m.note}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Panel>
        </>
      )}
      {loading && <Loader2 className="mx-auto h-4 w-4 animate-spin text-gray-400" />}
    </div>
  );
}
