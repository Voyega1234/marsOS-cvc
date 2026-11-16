"use client";

import { useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AreaChart, BarChart, Chip, EmptyState, KpiTile, Panel } from "@/components/ds";
import {
  PROMPT_INTENT_LABEL, PROMPT_SOURCE_LABEL, type PromptDetailDTO, type RadarFilters, type ResponseDTO,
} from "@/lib/brand-radar/types";
import { fmtDateTime, fmtNum, fmtPct, fmtRange, isSmallSample, methodLabel, providerShort, radarQuery } from "./shared";
import { CitedDomainsTable, EntityTable, LoadState, exportCitedCsv, useApiData } from "./PromptDialogs";

function ResponseItem({ r }: { r: ResponseDTO }) {
  const [open, setOpen] = useState(false);
  const failed = r.status === "FAILED" || r.status === "SKIPPED";
  return (
    <li className="rounded-2xl border border-gray-100 bg-white/70">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-sm">
        {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        <span className="font-medium">{r.providerLabel || providerShort(r.provider)}</span>
        <span className="text-xs text-gray-500">{r.model || "-"}</span>
        <Chip tone="muted">{methodLabel(r.collectionMethod)}</Chip>
        <span className="text-xs text-gray-500">{fmtDateTime(r.collectedAt)}</span>
        <Chip tone={failed ? "bad" : r.status === "DONE" ? "ok" : "muted"}>{r.status}</Chip>
      </button>
      {open ? (
        <div className="space-y-3 border-t border-gray-100 px-3 py-3 text-sm">
          {failed ? <p className="rounded-xl bg-red-50 p-2 text-xs text-red-700">{r.error || "ไม่มีรายละเอียดข้อผิดพลาด"}</p> : null}
          {r.responseText ? <p className="whitespace-pre-wrap break-words">{r.responseText}</p> : null}
          {r.mentions.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {r.mentions.map((m) => (
                <Chip key={`${m.entityType}-${m.key}`} tone={m.entityType === "brand" ? "info" : "muted"}>
                  {m.name} ×{m.occurrences}{m.recommended ? " · recommended" : ""}
                </Chip>
              ))}
            </div>
          ) : null}
          {r.citations.length > 0 ? (
            <div>
              <p className="mb-1 text-xs font-medium text-gray-600">Citations ({r.citations.length})</p>
              <ol className="list-decimal space-y-0.5 pl-5 text-xs">
                {r.citations.map((c, i) => (
                  <li key={`${c.url}-${i}`} className="break-all">
                    {/^https?:\/\//i.test(c.url) ? (
                      <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-brand-blue hover:underline">{c.title || c.url}</a>
                    ) : <span>{c.url}</span>}
                    <span className="ml-1 text-gray-400">{c.domain} · {c.ownerType}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : r.status === "DONE" ? <p className="text-xs text-gray-500">คำตอบนี้ไม่มีลิงก์อ้างอิง</p> : null}
        </div>
      ) : null}
    </li>
  );
}

export default function PromptDetail({ projectId, filters, promptId, refreshKey, onBack }: {
  projectId: string;
  filters: RadarFilters;
  promptId: string;
  refreshKey: number;
  onBack: () => void;
}) {
  const url = `/api/brand-radar/prompts/${encodeURIComponent(promptId)}/detail?${radarQuery(projectId, filters)}`;
  const { data, loading, error, reload } = useApiData<PromptDetailDTO>(url, refreshKey);
  const [buyableOnly, setBuyableOnly] = useState(false);

  const back = (
    <Button size="sm" variant="outline" onClick={onBack}><ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> กลับไปรายการ Prompt</Button>
  );

  if (loading || error || !data) {
    return (
      <div className="space-y-4">
        {back}
        <Panel><LoadState loading={loading} error={error} onRetry={reload} /></Panel>
      </div>
    );
  }

  const { prompt } = data;
  const brand = data.entities.find((e) => e.entityType === "brand");
  const domains = buyableOnly ? data.citedDomains.filter((d) => d.vendor) : data.citedDomains;

  function exportDomains() {
    exportCitedCsv(`brand-radar-cited-websites-${promptId}.csv`, data!.citedDomains.filter((d) => d.ownerType !== "own"));
  }

  return (
    <div className="space-y-4">
      {back}
      <div className="space-y-2">
        <h2 className="break-words text-lg font-semibold text-brand-navy">{prompt.text}</h2>
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip tone="muted">{PROMPT_INTENT_LABEL[prompt.intent]}</Chip>
          <Chip tone={prompt.source === "ai_generated" ? "warn" : "muted"}>
            {prompt.source === "ai_generated" ? "AI generated (ไม่ใช่คำถามจริงของผู้ใช้)" : PROMPT_SOURCE_LABEL[prompt.source]}
          </Chip>
          <Chip tone={prompt.status === "ACTIVE" ? "ok" : "muted"}>{prompt.status}</Chip>
          <Chip tone="muted">Volume {fmtNum(prompt.searchVolume)}</Chip>
          {prompt.topic ? <Chip tone="muted">{prompt.topic}</Chip> : null}
        </div>
      </div>

      {data.responses === 0 ? (
        <Panel>
          <EmptyState title="ยังไม่มีคำตอบของ Prompt นี้ในช่วงที่เลือก" description="ลองขยายช่วงวันที่ หรือรันสแกนใหม่" />
        </Panel>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiTile label="Responses" value={fmtNum(data.responses)} hint="จำนวนคำตอบ AI ที่เก็บได้" />
            <KpiTile
              label="เราขึ้น" tone="blue" value={fmtPct(brand?.mentionRate ?? null)}
              hint={brand
                ? `${fmtNum(brand.mentions)} จาก ${fmtNum(data.responses)} คำตอบ${fmtRange(brand.mentionRate ?? null, data.responses) ? ` · ${fmtRange(brand.mentionRate ?? null, data.responses)} (n=${data.responses})` : ""}`
                : undefined}
            />
            <KpiTile label="ถูกแนะนำ" value={brand ? `${fmtNum(brand.recommended)} ครั้ง` : "N/A"} hint="ประมาณจากถ้อยคำรอบชื่อแบรนด์" />
            <KpiTile label="ถูกอ้างอิงเว็บเรา" value={brand ? `${fmtNum(brand.cited)} ครั้ง` : "N/A"} hint="คำตอบที่ใส่ลิงก์ไปเว็บของเรา" />
          </div>

          <Panel title="Brand vs competitors" subtitle="สัดส่วนคำตอบที่กล่าวถึงแต่ละแบรนด์ใน Prompt นี้" padded={false}>
            <EntityTable entities={data.entities} />
            <div className="px-4 pb-4 pt-2 md:px-5">
              <BarChart
                horizontal
                height={Math.max(120, data.entities.length * 34)}
                data={data.entities.filter((e) => e.mentionRate !== null).map((e) => ({ label: e.name, value: (e.mentionRate ?? 0) * 100 }))}
                formatValue={(n) => `${n.toFixed(1)}%`}
                showValues
                ariaLabel="Appearance % ของแต่ละแบรนด์"
              />
              <p className="mt-2 text-xs text-gray-500">Recommended ตรวจจากถ้อยคำรอบชื่อ เป็นการประมาณ</p>
            </div>
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="By AI platform" padded={false}>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>AI platform</TableHead>
                      <TableHead className="text-right">Responses</TableHead>
                      <TableHead className="text-right">เราขึ้น</TableHead>
                      <TableHead className="text-right">Recommended</TableHead>
                      <TableHead className="text-right">Cited</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.byProvider.map((p) => (
                      <TableRow key={p.provider}>
                        <TableCell className="whitespace-nowrap">{p.label || providerShort(p.provider)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtNum(p.responses)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtPct(p.mentionRate)}
                          {p.mentionRate !== null && fmtRange(p.mentionRate, p.responses) ? (
                            <div className="text-[11px] font-normal text-gray-500">
                              {fmtRange(p.mentionRate, p.responses)} · n={p.responses}
                              {isSmallSample(p.responses) ? (
                                <span title="ถามน้อยกว่า 10 รอบ ตัวเลขยังแกว่งมาก" className="ml-1 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">ตัวอย่างน้อย</span>
                              ) : null}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmtNum(p.brandRecommended)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtNum(p.ownedCited)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Panel>
            <Panel title="Trend" subtitle="เราเทียบคู่แข่งอันดับ 1 ในแต่ละสแกน">
              {data.trend.length < 2 ? (
                <p className="py-6 text-center text-sm text-gray-500">ต้องมีอย่างน้อย 2 สแกนจึงจะแสดงแนวโน้ม</p>
              ) : (
                <AreaChart
                  showLegend
                  height={220}
                  formatValue={(n) => `${(n * 100).toFixed(0)}%`}
                  series={[
                    { name: "เรา", points: data.trend.map((t) => ({ label: fmtDateTime(t.date).split(" ").slice(0, 2).join(" "), value: t.brandMentionRate })) },
                    { name: "คู่แข่งอันดับ 1", dashed: true, fill: false, points: data.trend.map((t) => ({ label: fmtDateTime(t.date).split(" ").slice(0, 2).join(" "), value: t.topCompetitorRate })) },
                  ]}
                  ariaLabel="แนวโน้มของ Prompt"
                />
              )}
            </Panel>
          </div>

          <Panel
            title="Cited websites"
            subtitle="เว็บไซต์ที่ AI ใส่ลิงก์อ้างอิงเมื่อตอบ Prompt นี้ — เว็บจะอยู่ในตารางนี้ก็ต่อเมื่อคำตอบของ AI มีลิงก์ไปหาเว็บนั้นจริง ๆ"
            actions={
              <>
                <label className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" checked={buyableOnly} onChange={(e) => setBuyableOnly(e.target.checked)} />
                  เฉพาะเว็บที่ซื้อ backlink ได้
                </label>
                <Button size="sm" variant="outline" onClick={exportDomains} disabled={data.citedDomains.length === 0}>
                  <Download className="mr-1.5 h-3.5 w-3.5" /> Export CSV
                </Button>
              </>
            }
            padded={false}
          >
            {domains.length === 0 ? (
              <EmptyState title={buyableOnly ? "ไม่มีเว็บในคลัง Backlink ที่ถูกอ้างอิง" : "ยังไม่มีเว็บที่ถูกอ้างอิง"} description={buyableOnly ? "ปิดตัวกรองเพื่อดูเว็บทั้งหมด" : undefined} />
            ) : <CitedDomainsTable rows={domains} />}
          </Panel>
        </>
      )}

      <Panel title="Response history" subtitle="คำตอบล่าสุดของ AI สำหรับ Prompt นี้ (ข้อความล้วน)">
        {data.history.length === 0 ? (
          <p className="py-4 text-center text-sm text-gray-500">ยังไม่มีประวัติคำตอบ</p>
        ) : (
          <ul className="space-y-2">{data.history.map((r) => <ResponseItem key={r.id} r={r} />)}</ul>
        )}
      </Panel>
    </div>
  );
}
