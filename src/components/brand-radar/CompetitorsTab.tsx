"use client";

import { AreaChart, EmptyState, HeatGrid, Panel, StackedBar } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ColumnHelp } from "./ColumnHelp";
import type { CompetitorInsightsDTO } from "@/lib/brand-radar/types";
import { NO_DATA_MESSAGE, domainHref, fmtNum, fmtPct, radarQuery, type TabProps } from "./shared";
import { EntityTable, LoadState, useApiData } from "./PromptDialogs";
import UntrackedBrandsSection from "./UntrackedBrandsSection";

export default function CompetitorsTab({ projectId, filters, refreshKey, profile, onGoTab, clientView, focus }: TabProps) {
  // Deep link from the Overview: highlight one competitor row (EntityTable handles the mark and the scroll)
  const focusName = focus && focus.tab === "competitors" ? focus.competitor : undefined;
  const focusSeq = focus && focus.tab === "competitors" ? focus.seq : undefined;
  const url = `/api/brand-radar/competitors/insights?${radarQuery(projectId, filters)}`;
  const { data, loading, error, reload } = useApiData<CompetitorInsightsDTO>(profile ? url : "", refreshKey, true);

  if (!profile) {
    return (
      <Panel>
        <EmptyState title={clientView ? "ยังไม่มีข้อมูลรายงานสำหรับแบรนด์นี้" : "ยังไม่ได้ตั้งค่า Brand Radar"} description={clientView ? undefined : "ตั้งค่าแบรนด์และคู่แข่งที่ปุ่ม Settings มุมขวาบน ก่อน"}
          action={clientView ? undefined : <Button size="sm" onClick={() => onGoTab("settings")}>ไปที่ Settings</Button>} />
      </Panel>
    );
  }
  if (loading || error || !data) {
    return <Panel><LoadState loading={loading} error={error} onRetry={reload} clientView={clientView} /></Panel>;
  }
  const competitors = data.entities.filter((e) => e.entityType === "competitor");
  if (competitors.length === 0) {
    return (
      <Panel>
        <EmptyState title={clientView ? "ยังไม่มีข้อมูลคู่แข่ง" : "ยังไม่ได้เพิ่มคู่แข่ง"} description={clientView ? "ยังไม่มีข้อมูลเปรียบเทียบคู่แข่งในช่วงเวลานี้" : "เพิ่มคู่แข่งที่ปุ่ม Settings มุมขวาบน เพื่อเทียบว่าใครถูก AI พูดถึงบ่อยกว่า"}
          action={clientView ? undefined : <Button size="sm" onClick={() => onGoTab("settings")}>ไปที่ Settings</Button>} />
      </Panel>
    );
  }
  if (data.responses === 0) {
    return <Panel><EmptyState title="ยังไม่มีข้อมูล" description={clientView ? "ยังไม่มีข้อมูลในช่วงเวลานี้" : NO_DATA_MESSAGE} /></Panel>;
  }

  return (
    <div className="space-y-4">
      <Panel title="Brand vs competitors" subtitle={`อ้างอิงจาก ${fmtNum(data.responses)} คำตอบ — Recommended ตรวจจากถ้อยคำรอบชื่อ เป็นการประมาณ`} padded={false}>
        <EntityTable entities={data.entities} focusName={focusName} focusSeq={focusSeq} />
      </Panel>

      {data.mentionSplit && data.mentionSplit.total > 0 ? (() => {
        const sp = data.mentionSplit;
        const pct = (n: number) => `${((n / sp.total) * 100).toFixed(1)}%`;
        const parts = [
          { label: "เฉพาะแบรนด์เรา", value: sp.onlyBrand, color: "#16a34a" },
          { label: "แบรนด์เรา + คู่แข่ง", value: sp.brandAndCompetitor, color: "#2563eb" },
          { label: "เฉพาะคู่แข่ง", value: sp.onlyCompetitor, color: "#f59e0b" },
          { label: "ไม่มีใครที่ติดตามเลย", value: sp.nobody, color: "#9ca3af" },
        ];
        return (
          <Panel title="ใครถูกพูดถึงในคำตอบ" subtitle={`แบ่งตามคำตอบทั้งหมด ${fmtNum(sp.total)} คำตอบในตัวกรองปัจจุบัน`}>
            <StackedBar
              segments={parts}
              formatValue={(n) => `${fmtNum(n)} (${pct(n)})`}
              ariaLabel="สัดส่วนคำตอบตามแบรนด์ที่ถูกพูดถึง"
            />
          </Panel>
        );
      })() : null}

      {!clientView && <UntrackedBrandsSection data={data.untracked} />}

      <Panel title="Mention rate trend" subtitle="สัดส่วนคำตอบที่กล่าวถึงแต่ละแบรนด์ในแต่ละสแกน (แบรนด์เราก่อน)">
        {data.trend.length === 0 || (data.trend[0]?.points.length ?? 0) < 2 ? (
          <p className="py-6 text-center text-sm text-gray-500">ต้องมีอย่างน้อย 2 สแกนจึงจะแสดงแนวโน้ม</p>
        ) : (
          <AreaChart
            showLegend
            height={260}
            formatValue={(n) => `${(n * 100).toFixed(0)}%`}
            series={data.trend.map((s, i) => ({
              name: s.name, fill: i === 0, dashed: i > 0 && false,
              points: s.points.map((p) => ({ label: p.label, value: p.mentionRate })),
            }))}
            ariaLabel="แนวโน้ม mention rate"
          />
        )}
      </Panel>

      <Panel title="Head-to-head" subtitle="นับเป็นจำนวน Prompt" padded={false}>
        <div className="overflow-x-auto">
          <Table className="min-w-[520px]">
            <TableHeader>
              <TableRow>
                <TableHead><ColumnHelp k="h2hCompetitor" align="start">Competitor</ColumnHelp></TableHead>
                <TableHead className="text-right"><ColumnHelp k="h2hBoth" align="end">ถูกพูดถึงทั้งคู่</ColumnHelp></TableHead>
                <TableHead className="text-right"><ColumnHelp k="h2hOnlyCompetitor" align="end">เฉพาะคู่แข่ง</ColumnHelp></TableHead>
                <TableHead className="text-right"><ColumnHelp k="h2hOnlyBrand" align="end">เฉพาะเรา</ColumnHelp></TableHead>
                <TableHead className="text-right"><ColumnHelp k="h2hNeither" align="end">ไม่มีใครเลย</ColumnHelp></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.headToHead.map((h) => (
                <TableRow key={h.competitorId}>
                  <TableCell>{h.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtNum(h.bothMentioned)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtNum(h.onlyCompetitor)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtNum(h.onlyBrand)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtNum(h.neither)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Panel>

      <Panel title="Entity × topic" subtitle="Mention rate ตามหัวข้อ — ช่องว่าง = ไม่มีข้อมูลพอ (Insufficient Data)">
        {data.byTopic.rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">ยังไม่มีข้อมูลหัวข้อ</p>
        ) : (
          <HeatGrid
            rows={data.byTopic.rows}
            columns={data.byTopic.columns}
            values={data.byTopic.values}
            formatValue={(n) => fmtPct(n, 0)}
            ariaLabel="Mention rate ตามหัวข้อ"
          />
        )}
      </Panel>

      <Panel title="Top cited domains per competitor" subtitle="เว็บที่ AI ใส่ลิงก์อ้างอิงเมื่อพูดถึงคู่แข่งแต่ละราย">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.domains.map((c) => (
            <div key={c.competitorId} className="rounded-2xl border border-gray-100 bg-white/70 p-3">
              <p className="mb-2 break-words text-sm font-semibold text-brand-navy">{c.name}</p>
              {c.domains.length === 0 ? (
                <p className="text-xs text-gray-500">ยังไม่มีเว็บที่ถูกอ้างอิง</p>
              ) : (
                <ul className="space-y-1 text-xs">
                  {c.domains.map((d) => (
                    <li key={d.domain} className="flex min-w-0 items-center justify-between gap-2">
                      {domainHref(d.domain) ? (
                        <a href={domainHref(d.domain) ?? undefined} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate text-brand-blue hover:underline">{d.domain}</a>
                      ) : (
                        <span className="min-w-0 truncate">{d.domain}</span>
                      )}
                      <span className="shrink-0 tabular-nums text-gray-500">{fmtNum(d.citations)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
