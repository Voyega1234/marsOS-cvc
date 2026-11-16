"use client";

import { AreaChart, EmptyState, HeatGrid, Panel } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CompetitorInsightsDTO } from "@/lib/brand-radar/types";
import { NO_DATA_MESSAGE, fmtNum, fmtPct, radarQuery, type TabProps } from "./shared";
import { EntityTable, LoadState, useApiData } from "./PromptDialogs";

export default function CompetitorsTab({ projectId, filters, refreshKey, profile, onGoTab }: TabProps) {
  const url = `/api/brand-radar/competitors/insights?${radarQuery(projectId, filters)}`;
  const { data, loading, error, reload } = useApiData<CompetitorInsightsDTO>(profile ? url : "", refreshKey);

  if (!profile) {
    return (
      <Panel>
        <EmptyState title="ยังไม่ได้ตั้งค่า Brand Radar" description="ตั้งค่าแบรนด์และคู่แข่งที่แท็บ Settings ก่อน"
          action={<Button size="sm" onClick={() => onGoTab("settings")}>ไปที่ Settings</Button>} />
      </Panel>
    );
  }
  if (loading || error || !data) {
    return <Panel><LoadState loading={loading} error={error} onRetry={reload} /></Panel>;
  }
  const competitors = data.entities.filter((e) => e.entityType === "competitor");
  if (competitors.length === 0) {
    return (
      <Panel>
        <EmptyState title="ยังไม่ได้เพิ่มคู่แข่ง" description="เพิ่มคู่แข่งที่แท็บ Settings เพื่อเทียบว่าใครถูก AI พูดถึงบ่อยกว่า"
          action={<Button size="sm" onClick={() => onGoTab("settings")}>ไปที่ Settings</Button>} />
      </Panel>
    );
  }
  if (data.responses === 0) {
    return <Panel><EmptyState title="ยังไม่มีข้อมูล" description={NO_DATA_MESSAGE} /></Panel>;
  }

  return (
    <div className="space-y-4">
      <Panel title="Brand vs competitors" subtitle={`อ้างอิงจาก ${fmtNum(data.responses)} คำตอบ — Recommended ตรวจจากถ้อยคำรอบชื่อ เป็นการประมาณ`} padded={false}>
        <EntityTable entities={data.entities} />
      </Panel>

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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Competitor</TableHead>
                <TableHead className="text-right">ถูกพูดถึงทั้งคู่</TableHead>
                <TableHead className="text-right">เฉพาะคู่แข่ง</TableHead>
                <TableHead className="text-right">เฉพาะเรา</TableHead>
                <TableHead className="text-right">ไม่มีใครเลย</TableHead>
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
          <p className="py-6 text-center text-sm text-gray-500">{fmtPct(null)}</p>
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
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.domains.map((c) => (
            <div key={c.competitorId} className="rounded-2xl border border-gray-100 bg-white/70 p-3">
              <p className="mb-2 text-sm font-semibold text-brand-navy">{c.name}</p>
              {c.domains.length === 0 ? (
                <p className="text-xs text-gray-500">ยังไม่มีเว็บที่ถูกอ้างอิง</p>
              ) : (
                <ul className="space-y-1 text-xs">
                  {c.domains.map((d) => (
                    <li key={d.domain} className="flex items-center justify-between gap-2">
                      <a href={`https://${d.domain}`} target="_blank" rel="noopener noreferrer" className="truncate text-brand-blue hover:underline">{d.domain}</a>
                      <span className="tabular-nums text-gray-500">{fmtNum(d.citations)}</span>
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
