"use client";

/**
 * Brand Radar — "dossier" layout blocks for the report dashboard (UI only, no data of its own).
 * Header, hero row (trend + gauge + citation bar), bottom row (sentiment, mention style, history).
 * Every number comes from the AnswerFeedDTO the dashboard already loaded; reads are defensive.
 * All API text is untrusted: rendered as React text nodes only.
 */
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AreaChart, Chip, EmptyState, Gauge, MeterBar, Panel, Segmented } from "@/components/ds";
import type { AnswerFeedDTO } from "@/lib/brand-radar/types";
import { SENTIMENT_TONE_LABEL } from "@/lib/brand-radar/types";
import { ANSWER_ZONE_CAPTION, fmtDate, fmtNum, fmtZoneBrief, providerLabelFor, zoneMethodNote, type TabId, type TabProps } from "./shared";
import { ProviderLogo } from "./ProviderLogo";
import { pct } from "./ReportCards";
import { TONE_CHIP, ToneBar, dominantTone } from "./InsightSections";
import { BrandLogo } from "./BrandLogo";
import type { ViewerTarget } from "./ResponseViewer";

type Dto = AnswerFeedDTO;
type Filters = TabProps["filters"];

const BRAND_COLOR = "#1d48f3";
// muted, distinct colours for competitor lines
const COMPETITOR_COLORS = ["#98a3b6", "#ffb95c", "#6b8cef", "#e35336", "#2fb5a3"];

export interface BrandOpt { id: string; name: string; logo?: string | null; favicon?: string | null }

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-gray-100 bg-white/70 px-3 py-2">
      <div className="break-words text-[11px] leading-snug text-gray-500">{label}</div>
      <div className="mt-0.5 break-words text-base font-semibold tabular-nums text-brand-navy">{value}</div>
      {hint ? <div className="text-[11px] text-gray-500">{hint}</div> : null}
    </div>
  );
}

/** "12 ก.ย. 68 – 18 พ.ย. 68" from the filters, else from the first/last trend day */
function periodText(dto: Dto, filters: Filters): string {
  const pts = dto.trend?.points ?? [];
  const from = filters?.from || pts[0]?.date;
  const to = filters?.to || pts[pts.length - 1]?.date;
  if (!from && !to) return "";
  return `${fmtDate(from)} – ${fmtDate(to)}`;
}

// ── 1. Header ────────────────────────────────────────────────────────────────

export function DossierHeader({ dto, filters, onGoTab, brand: picture }: { dto: Dto; filters: Filters; onGoTab: (t: TabId) => void; brand?: BrandOpt }) {
  const brand = (dto.entities ?? []).find((e) => e.entityType === "brand");
  const name = brand?.name || dto.brandName || "";
  const period = periodText(dto, filters);
  const platforms = (dto.byProvider ?? []).length;
  return (
    <Panel className="rounded-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {name ? <BrandLogo name={name} logo={picture?.logo} favicon={picture?.favicon} size={48} color={BRAND_COLOR} /> : null}
          <div className="min-w-0">
            {name ? <h2 className="break-words text-xl font-semibold text-brand-navy md:text-2xl">{name}</h2> : null}
            <p className="mt-1 text-sm text-gray-600">
              {`วิเคราะห์ ${fmtNum(dto.totals?.asked)} คำตอบ จาก ${fmtNum(platforms)} AI platform${period ? ` · ช่วง ${period}` : ""}`}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => onGoTab("responses")}>ดูคำตอบทั้งหมด</Button>
          <Button size="sm" variant="outline" onClick={() => onGoTab("competitors")}>ดูคู่แข่ง</Button>
        </div>
      </div>
    </Panel>
  );
}

// ── 2. Hero row ──────────────────────────────────────────────────────────────

function TrendHero({ dto, filters, clientView }: { dto: Dto; filters: Filters; clientView?: boolean }) {
  const [mode, setMode] = useState<"all" | "brand">("all");
  const series = dto.trend?.series ?? [];
  const points = dto.trend?.points ?? [];
  const t = dto.totals;
  const change = t?.change ?? null;
  // brand first, then up to 5 competitors (kept in original column order)
  const keep: number[] = [];
  series.forEach((s, i) => { if (s.entityType === "brand") keep.push(i); });
  if (mode === "all") {
    let n = 0;
    series.forEach((s, i) => { if (s.entityType !== "brand" && n < 5) { keep.push(i); n += 1; } });
  }
  let compIdx = 0;
  const lines = keep.map((i) => {
    const s = series[i];
    const isBrand = s.entityType === "brand";
    const color = isBrand ? BRAND_COLOR : COMPETITOR_COLORS[compIdx++ % COMPETITOR_COLORS.length];
    return {
      name: isBrand ? `${s.name} (เรา)` : s.name,
      color,
      fill: isBrand,
      dashed: !isBrand,
      points: points.map((p) => ({ label: fmtDate(p.date), value: typeof p.values?.[i] === "number" ? (p.values[i] as number) : null })),
    };
  });
  const period = periodText(dto, filters);
  return (
    <Panel
      title="Visibility รายวัน"
      subtitle="สัดส่วนคำตอบที่ AI พูดถึงแบรนด์หรืออ้างอิงเว็บ ในแต่ละวัน"
      className="h-full"
      actions={
        <div className="max-w-full overflow-x-auto">
          <Segmented<"all" | "brand">
            size="sm"
            ariaLabel="เลือกเส้นที่แสดง"
            value={mode}
            onChange={setMode}
            options={[{ value: "all", label: "เรา + คู่แข่ง" }, { value: "brand", label: "เฉพาะเรา" }]}
          />
        </div>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(dto.byProvider ?? []).map((p) => (
          <ProviderLogo key={p.provider} provider={p.provider} size={18} title={(!clientView && p.label) || providerLabelFor(p.provider, clientView)} />
        ))}
        {period ? <Chip tone="muted">{period}</Chip> : null}
      </div>
      <div className="mb-3 flex flex-wrap items-end gap-x-6 gap-y-2">
        <div>
          <div className="text-4xl font-semibold tabular-nums text-brand-navy">{pct(t?.appearRate)}</div>
          <div className="text-xs text-gray-500">Visibility (AI พูดถึงแบรนด์หรืออ้างอิงเว็บเรา)</div>
        </div>
        <div className="text-sm text-gray-600">
          {change === null ? <Chip tone="muted">N/A</Chip> : (
            <Chip tone={change > 0 ? "ok" : change < 0 ? "bad" : "muted"}>{`${change > 0 ? "+" : ""}${(change * 100).toFixed(1)} จุด`}</Chip>
          )}
          <div className="mt-1 text-xs text-gray-500">{change === null ? "" : "เทียบวันแรกของช่วง"}</div>
        </div>
        <div className="text-sm text-gray-600">AI พูดถึงหรืออ้างอิงเรา <b>{fmtNum(t?.appeared)}</b> จาก <b>{fmtNum(t?.asked)}</b> คำตอบ</div>
      </div>
      {points.length < 2 || lines.length === 0 ? (
        <EmptyState className="py-12" title="ต้องมีผลสแกนอย่างน้อย 2 วันจึงจะเห็นแนวโน้ม" />
      ) : (
        <AreaChart
          height={280}
          showLegend
          ariaLabel="Visibility รายวัน"
          series={lines}
          formatValue={(n) => `${Math.round(n * 100)}%`}
          formatTooltip={(n) => `${(n * 100).toFixed(1)}%`}
          tooltipRows={(i) => [{ label: "จำนวนคำตอบ", value: `${fmtNum(points[i]?.asked)} คำตอบ` }]}
        />
      )}
    </Panel>
  );
}

function GaugeCard({ dto }: { dto: Dto }) {
  const t = dto.totals;
  // Visibility = answers that name the brand or cite our site
  const rate = t?.appearRate;
  return (
    <Panel title="Visibility" subtitle="สัดส่วนคำตอบที่ AI พูดถึงแบรนด์หรืออ้างอิงเว็บเรา">
      {rate === null || rate === undefined ? (
        <EmptyState className="py-6" title="ยังไม่มีข้อมูล" />
      ) : (
        <Gauge value={rate * 100} max={100} size={200} color={BRAND_COLOR} formatValue={(n) => `${n.toFixed(1)}%`} ariaLabel="Visibility" />
      )}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Stat label="พูดถึงหรืออ้างอิง" value={fmtNum(t?.appeared)} />
        <Stat label="คำตอบทั้งหมด" value={fmtNum(t?.asked)} />
        <Stat label="Brand Mention" value={fmtNum(t?.mentioned)} />
      </div>
    </Panel>
  );
}

function CitationCard({ dto }: { dto: Dto }) {
  const t = dto.totals;
  const cite = t?.citationRate;
  const vis = t?.appearRate;
  return (
    <Panel title="AI Citation (อ้างอิงเว็บเรา)" subtitle={`${fmtNum(t?.ownedCited)} จาก ${fmtNum(t?.asked)} คำตอบ`}>
      <div className="text-3xl font-semibold tabular-nums text-brand-navy">{pct(cite)}</div>
      <MeterBar
        className="mt-2"
        value={(cite ?? 0) * 100}
        max={100}
        mark={vis === null || vis === undefined ? undefined : vis * 100}
        tone="blue"
        ariaLabel="สัดส่วนคำตอบที่อ้างอิงเว็บเรา"
      />
      <p className="mt-1.5 text-[11px] text-gray-500">แถบ = อ้างอิงเว็บเรา · เส้นขีด = Visibility ({pct(vis)}) ใช้สเกล 0–100% เดียวกัน</p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Stat label="อ้างอิงเว็บเรา" value={fmtNum(t?.ownedCited)} />
        <Stat label="ทั้งพูดถึงและอ้างอิง" value={fmtNum(t?.kinds?.both)} />
        <Stat label="พูดถึงแต่ไม่อ้างอิง" value={fmtNum(t?.kinds?.mention_only)} />
      </div>
    </Panel>
  );
}

export function HeroRow({ dto, filters, clientView }: { dto: Dto; filters: Filters; clientView?: boolean }) {
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="min-w-0 xl:col-span-2"><TrendHero dto={dto} filters={filters} clientView={clientView} /></div>
      <div className="grid min-w-0 content-start gap-4 md:grid-cols-2 xl:grid-cols-1">
        <div className="min-w-0"><GaugeCard dto={dto} /></div>
        <div className="min-w-0"><CitationCard dto={dto} /></div>
      </div>
    </div>
  );
}

// ── 3. Bottom row ────────────────────────────────────────────────────────────

function SentimentCard({ dto, clientView, onOpenAnswer }: { dto: Dto; clientView?: boolean; onOpenAnswer?: (target: ViewerTarget) => void }) {
  const t = dto.totals;
  const ms = t?.mentionStyle;
  const insight = dto.insight;
  const brandEntity = insight?.entities?.find((e) => e.entityType === "brand");
  const dom = dominantTone(brandEntity?.tones);
  const analyzed = insight?.analyzed ?? 0;
  const avg = t?.avgPosition === null || t?.avgPosition === undefined ? "—" : `#${t.avgPosition.toFixed(1)}`;
  return (
    <Panel
      title="Brand Sentiment"
      tone="solid"
      className="flex h-full flex-col"
      bodyClassName="flex flex-1 flex-col"
      actions={
        insight?.available === false ? null
          : analyzed === 0 || !dom ? null
          : <Chip tone={TONE_CHIP[dom]}>{SENTIMENT_TONE_LABEL[dom]}</Chip>
      }
    >
      {insight?.available === false ? (
        <p className="text-sm text-gray-500">{clientView ? "ยังไม่มีข้อมูลในช่วงเวลานี้" : "ยังไม่เปิดใช้ (รอสร้างตารางในฐานข้อมูล)"}</p>
      ) : analyzed === 0 ? (
        <p className="text-sm text-gray-500">ยังไม่มีคำตอบที่วิเคราะห์แล้ว</p>
      ) : (
        <div><ToneBar tones={brandEntity?.tones} total={brandEntity?.answers ?? 0} examples={brandEntity?.toneAnswers ?? {}} onOpenAnswer={onOpenAnswer} clientView={clientView} /></div>
      )}
      <div className="mt-auto pt-3">
        <div className="grid grid-cols-2 gap-2">
          <Stat label="วิเคราะห์แล้ว" value={`${fmtNum(analyzed)} คำตอบ`} />
          <Stat label="อันดับเฉลี่ยในคำตอบ" value={avg} />
        </div>
        <div className="mt-2 rounded-2xl border border-gray-100 bg-white/70 px-3 py-2">
          <div className="text-[11px] leading-snug text-gray-500">{ANSWER_ZONE_CAPTION}</div>
          <div className="mt-0.5 break-words text-sm font-semibold tabular-nums text-brand-navy">{fmtZoneBrief(ms?.zones) ?? "ยังไม่มีข้อมูล"}</div>
          {zoneMethodNote(ms?.zones) ? <div className="mt-1 break-words text-[11px] leading-snug text-gray-500">{zoneMethodNote(ms?.zones)}</div> : null}
        </div>
      </div>
    </Panel>
  );
}

function MentionStyleCard({ dto }: { dto: Dto }) {
  const t = dto.totals;
  const ms = t?.mentionStyle;
  const rows = [
    { label: "แนะนำ", value: ms?.recommended ?? 0, tone: "ok" as const },
    { label: "เปรียบเทียบ", value: ms?.compared ?? 0, tone: "warn" as const },
    { label: "เอ่ยถึงเฉย ๆ", value: ms?.listed ?? 0, tone: "navy" as const },
  ];
  const sum = rows.reduce((a, r) => a + r.value, 0);
  return (
    <Panel title="Brand Mention (พูดถึงแบรนด์เรา)" subtitle={`ชื่อแบรนด์ปรากฏ ${fmtNum(t?.occurrences)} ครั้ง`} tone="solid" className="flex h-full flex-col" bodyClassName="flex flex-1 flex-col">
      {!ms ? <p className="text-sm text-gray-500">ยังไม่มีข้อมูล</p> : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.label}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="text-gray-700">{r.label}</span>
                <span className="tabular-nums text-brand-navy"><b>{fmtNum(r.value)}</b> <span className="text-xs text-gray-500">({sum > 0 ? `${((r.value / sum) * 100).toFixed(0)}%` : "0%"})</span></span>
              </div>
              <MeterBar className="mt-1" value={sum > 0 ? (r.value / sum) * 100 : 0} max={100} tone={r.tone} ariaLabel={r.label} />
            </li>
          ))}
        </ul>
      )}
      <div className="mt-auto grid grid-cols-2 gap-2 pt-3">
        <Stat label="พูดถึงแบรนด์เรา" value={`${fmtNum(t?.mentioned)} คำตอบ`} />
        <Stat label="ถูกเอ่ยเป็นชื่อแรก" value={`${fmtNum(ms?.first ?? 0)} คำตอบ`} />
      </div>
    </Panel>
  );
}

function HistoryCard({ dto }: { dto: Dto }) {
  const t = dto.totals;
  const brandIdx = (dto.trend?.series ?? []).findIndex((s) => s.entityType === "brand");
  const all = (dto.trend?.points ?? []).map((p) => ({
    date: p.date,
    asked: p.asked,
    v: brandIdx < 0 ? null : typeof p.values?.[brandIdx] === "number" ? (p.values[brandIdx] as number) : null,
  }));
  const recent = all.slice(-24);
  let best: (typeof all)[number] | null = null;
  for (const d of all) if (d.v !== null && (best === null || d.v > (best.v ?? 0))) best = d;
  const zeroDays = all.filter((d) => d.v === 0).length;
  const block = (v: number | null) => (v === null ? "bg-gray-200" : v >= 0.5 ? "bg-emerald-500" : v > 0 ? "bg-amber-400" : "bg-rose-300");
  return (
    <Panel title="ประวัติการสแกน" subtitle={`${fmtNum(recent.length)} วันล่าสุด · สีตาม Visibility ของวันนั้น`} tone="solid" className="flex h-full flex-col" bodyClassName="flex flex-1 flex-col">
      {recent.length === 0 ? <p className="text-sm text-gray-500">ยังไม่มีข้อมูล</p> : (
        <div className="flex flex-wrap gap-1" role="img" aria-label="Visibility รายวัน">
          {recent.map((d) => (
            <span
              key={d.date}
              className={`h-6 w-6 rounded-md ${block(d.v)}`}
              title={`${fmtDate(d.date)} · ${d.v === null ? "ไม่มีข้อมูล" : `${(d.v * 100).toFixed(1)}%`} · ${fmtNum(d.asked)} คำตอบ`}
            />
          ))}
        </div>
      )}
      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-500">
        <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-500" />ตั้งแต่ 50%</span>
        <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-amber-400" />มากกว่า 0%</span>
        <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-rose-300" />0%</span>
        <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-gray-200" />ไม่มีข้อมูล</span>
      </p>
      <div className="mt-auto grid grid-cols-3 gap-2 pt-3">
        <Stat label="วันที่สแกน" value={fmtNum(all.length)} />
        <Stat label="วันที่ดีที่สุด" value={best ? fmtDate(best.date) : "—"} hint={best?.v != null ? pct(best.v) : undefined} />
        <Stat label="วันที่ Visibility 0%" value={fmtNum(zeroDays)} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-2">
        <Stat label="คำตอบทั้งหมด" value={fmtNum(t?.asked)} />
        <Stat label="Brand Mention" value={fmtNum(t?.mentioned)} />
        <Stat label="AI Citation" value={fmtNum(t?.ownedCited)} />
        <Stat label="มีแต่คู่แข่ง" value={fmtNum(dto.counts?.competitor_only ?? 0)} hint="คำถาม × AI" />
      </div>
    </Panel>
  );
}

export function BottomRow({ dto, clientView, actions, onOpenAnswer }: { dto: Dto; clientView?: boolean; actions?: ReactNode; onOpenAnswer?: (target: ViewerTarget) => void }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <div className="min-w-0"><SentimentCard dto={dto} clientView={clientView} onOpenAnswer={onOpenAnswer} /></div>
      <div className="min-w-0"><MentionStyleCard dto={dto} /></div>
      <div className="min-w-0 md:col-span-2 xl:col-span-1"><HistoryCard dto={dto} /></div>
      {actions ? <div className="min-w-0 md:col-span-2 xl:col-span-3">{actions}</div> : null}
    </div>
  );
}
