"use client";

/**
 * Brand Radar — Citation Analysis tab, fed by ONE request: GET /api/brand-radar/citation-analysis.
 * Everything is computed on the server from stored answers; the tab only reads. All API text is untrusted
 * and rendered as React text nodes only.
 */
import { useMemo, useState, type ReactNode } from "react";
import { Radar } from "lucide-react";
import { AreaChart, Chip, EmptyState, KpiTile, MeterBar, Panel, Segmented, StackedBar } from "@/components/ds";
import type { AnalysisPrevious, AnalysisTotals, AnswerVariationRow, CitationAnalysisDTO, TrendPoint } from "@/lib/brand-radar/citation-analysis-types";
import { fmtDateTime, fmtNum, fmtPct, isSmallSample, NO_DATA_MESSAGE, providerLabelFor, radarQuery, type TabProps } from "./shared";
import { LoadState, useApiData } from "./PromptDialogs";
import ResponseViewer, { type ViewerTarget } from "./ResponseViewer";
import { DomainsSection, ExtLink, Platforms, urlPath } from "./CitationAnalysisParts";
import { ProviderLogo } from "./ProviderLogo";
import { FixPagesSection, FoundNotCitedSection } from "./CitationActionSections";
import SiteReadinessSection from "./SiteReadinessSection";

const TERMS = "mention = AI พูดถึงชื่อแบรนด์ในคำตอบ · citation = AI นำหน้าเว็บไปใช้เป็นแหล่งข้อมูลและแนบลิงก์";

/** Difference of two rates in percentage points; null when either is missing */
function ppDiff(cur: number | null | undefined, prev: number | null | undefined): number | null {
  if (cur === null || cur === undefined || prev === null || prev === undefined) return null;
  return (cur - prev) * 100;
}

function SmallSampleNote({ n }: { n: number }) {
  return isSmallSample(n) ? <p className="mt-2 text-xs text-amber-600">ตัวอย่างน้อย (ไม่ถึง 10 คำตอบ) ตัวเลขอาจเปลี่ยนมากเมื่อมีข้อมูลเพิ่ม</p> : null;
}

function Skeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="h-32 animate-pulse rounded-3xl bg-gray-100" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-gray-100" />)}
      </div>
      <div className="h-72 animate-pulse rounded-3xl bg-gray-100" />
    </div>
  );
}

// ── 1. Summary ───────────────────────────────────────────────────────────────

function SummarySection({ dto }: { dto: CitationAnalysisDTO }) {
  const t = dto.totals;
  const prev = dto.previous;
  const top = (dto.domains ?? [])[0];
  const lines: string[] = [];
  lines.push(`AI อ้างอิงเว็บ ${dto.brandName || "ของเรา"} ใน ${fmtNum(t.ownCitedAnswers)} จาก ${fmtNum(t.answers)} คำตอบ (${fmtPct(t.citationRate)})`);
  const d = ppDiff(t.citationRate, prev?.citationRate);
  if (d !== null) {
    const r = Math.round(Math.abs(d) * 10) / 10;
    lines[0] += r === 0 ? ` เท่ากับช่วงก่อนหน้า (${fmtPct(prev?.citationRate)})` : ` ${d > 0 ? "เพิ่มขึ้น" : "ลดลง"}จากช่วงก่อนหน้า (${fmtPct(prev?.citationRate)}) ${r} จุดเปอร์เซ็นต์`;
  }
  lines.push(`พูดถึงชื่อแบรนด์ ${fmtNum(t.brandMentions)} คำตอบ แต่ ${fmtNum(t.mentionedNotCited)} คำตอบไม่ได้อ้างอิงเว็บเรา`);
  if (top) lines.push(`เว็บที่ถูกอ้างอิงมากที่สุดคือ ${top.domain} (${fmtNum(top.answers)} จาก ${fmtNum(t.answers)} คำตอบ)`);
  return (
    <Panel title="สรุป" subtitle="AI ใช้เว็บของเราเป็นแหล่งข้อมูลมากแค่ไหน และดีขึ้นหรือไม่">
      <ul className="space-y-1.5 text-sm text-gray-700">
        {lines.map((l, i) => <li key={i} className="break-words">{l}</li>)}
      </ul>
      <p className="mt-3 text-xs text-gray-500">{TERMS}</p>
      <SmallSampleNote n={t.answers} />
    </Panel>
  );
}

// ── 2. KPI row ───────────────────────────────────────────────────────────────

function KpiRow({ t, prev }: { t: AnalysisTotals; prev: AnalysisPrevious | null }) {
  const ppSuffix = " จุด";
  const domainDelta = prev ? t.domains - prev.domains : null;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <KpiTile tone="blue" label="อัตราอ้างอิงเว็บเรา" value={fmtPct(t.citationRate)} hint={`${fmtNum(t.ownCitedAnswers)} จาก ${fmtNum(t.answers)} คำตอบ`} delta={ppDiff(t.citationRate, prev?.citationRate)} deltaSuffix={ppSuffix} />
      <KpiTile label="อัตราพูดถึงแบรนด์" value={fmtPct(t.mentionRate)} hint={`${fmtNum(t.brandMentions)} จาก ${fmtNum(t.answers)} คำตอบ`} delta={ppDiff(t.mentionRate, prev?.mentionRate)} deltaSuffix={ppSuffix} />
      <KpiTile label="อัตราแนะนำ" value={fmtPct(t.recommendedRate)} hint={`${fmtNum(t.brandRecommended)} จาก ${fmtNum(t.answers)} คำตอบ`} delta={ppDiff(t.recommendedRate, prev?.recommendedRate)} deltaSuffix={ppSuffix} />
      <KpiTile label="ส่วนแบ่งลิงก์อ้างอิงของเรา" value={fmtPct(t.ownCitationShare)} hint={`${fmtNum(t.ownCitations)} จาก ${fmtNum(t.citations)} ลิงก์`} delta={ppDiff(t.ownCitationShare, prev?.ownCitationShare)} deltaSuffix={ppSuffix} />
      <KpiTile label="จำนวนเว็บที่ถูกอ้างอิง" value={fmtNum(t.domains)} hint="เว็บไม่ซ้ำกัน" delta={domainDelta} deltaSuffix=" เว็บ" />
    </div>
  );
}

// ── 3. Trend ─────────────────────────────────────────────────────────────────

type TrendMode = "day" | "run";
const SENTIMENT_SEGMENTS = [
  { key: "positive", label: "เชิงบวก", color: "#16a34a" },
  { key: "neutral", label: "กลาง", color: "#98a3b6" },
  { key: "mixed", label: "ผสม", color: "#ffb95c" },
  { key: "negative", label: "เชิงลบ", color: "#e35336" },
] as const;

function pointLabel(p: TrendPoint, mode: TrendMode): string {
  const d = new Date(p.date);
  if (Number.isNaN(d.getTime())) return p.key.slice(0, 10);
  return mode === "day"
    ? d.toLocaleDateString("th-TH", { day: "numeric", month: "short" })
    : d.toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

const pctOrNull = (v: number | null | undefined): number | null => (v === null || v === undefined || !Number.isFinite(v) ? null : v * 100);

function TrendSection({ dto }: { dto: CitationAnalysisDTO }) {
  const [mode, setMode] = useState<TrendMode>("day");
  const points = (mode === "day" ? dto.trend?.byDay : dto.trend?.byRun) ?? [];
  const series = useMemo(() => [
    { name: "พูดถึงแบรนด์ (mention)", color: "#1d48f3", key: "mentionRate" as const },
    { name: "อ้างอิงเว็บเรา (citation)", color: "#16a34a", key: "citationRate" as const },
    { name: "แนะนำเรา", color: "#ffb95c", key: "recommendedRate" as const },
    { name: "อ้างอิงเว็บคู่แข่ง", color: "#e35336", key: "competitorCitationRate" as const, dashed: true },
  ].map((s) => ({ name: s.name, color: s.color, dashed: s.dashed, fill: false, points: points.map((p) => ({ label: pointLabel(p, mode), value: pctOrNull(p[s.key]) })) })), [points, mode]);
  const withSentiment = points.filter((p) => p.sentiment).slice(-12);
  const last = points[points.length - 1];

  return (
    <Panel title="อัตราเปลี่ยนไปอย่างไรตามเวลา" subtitle="ร้อยละของคำตอบในแต่ละช่วง (0–100%)"
      actions={<Segmented<TrendMode> size="sm" ariaLabel="มุมมองเวลา" value={mode} onChange={setMode} options={[{ value: "day", label: "รายวัน" }, { value: "run", label: "รายรอบสแกน" }]} />}>
      {points.length === 0 ? <EmptyState title="ยังไม่มีข้อมูลตามเวลา" /> : points.length === 1 && last ? (
        <div>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {series.map((s) => (
              <div key={s.name} className="rounded-2xl bg-gray-50/70 p-3">
                <dt className="text-xs text-gray-500">{s.name}</dt>
                <dd className="text-lg font-semibold tabular-nums text-brand-navy">{fmtPct((s.points[0]?.value ?? null) === null ? null : (s.points[0]?.value as number) / 100)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-gray-500">มีข้อมูล 1 รอบ กราฟจะยาวขึ้นเมื่อสแกนรอบถัดไป</p>
          <SmallSampleNote n={last.answers} />
        </div>
      ) : (
        <AreaChart series={series} height={260} showLegend yTickCount={4} formatValue={(n) => `${Math.round(n)}%`} formatTooltip={(n) => `${Math.round(n * 10) / 10}%`} ariaLabel="กราฟอัตรา mention และ citation ตามเวลา" />
      )}
      {withSentiment.length > 0 ? (
        <div className="mt-5">
          <h3 className="mb-2 text-xs font-semibold text-brand-navy">AI พูดถึงแบรนด์ด้วยน้ำเสียงแบบไหน</h3>
          <ul className="space-y-1.5">
            {withSentiment.map((p) => (
              <li key={p.key} className="grid grid-cols-[88px_1fr] items-center gap-2 text-xs text-gray-600 sm:grid-cols-[130px_1fr]">
                <span className="truncate tabular-nums">{pointLabel(p, mode)}</span>
                <StackedBar height={8} showLegend={false} ariaLabel="น้ำเสียงที่ AI พูดถึงแบรนด์"
                  segments={SENTIMENT_SEGMENTS.map((s) => ({ label: s.label, color: s.color, value: p.sentiment?.[s.key] ?? 0 }))} />
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-600">
            {SENTIMENT_SEGMENTS.map((s) => (
              <span key={s.key} className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />{s.label}</span>
            ))}
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

// ── 5. Variation ─────────────────────────────────────────────────────────────

function stabilityInfo(s: number | null): { label: string; tone: "ok" | "warn" | "bad" | "muted" } {
  if (s === null || s === undefined) return { label: "ถามครั้งเดียว เทียบไม่ได้", tone: "muted" };
  if (s >= 0.7) return { label: "คำตอบนิ่ง", tone: "ok" };
  if (s >= 0.4) return { label: "เปลี่ยนบ้าง", tone: "warn" };
  return { label: "เปลี่ยนเยอะ", tone: "bad" };
}

function DomainChips({ label, items, tone }: { label: string; items: string[] | undefined; tone: "ok" | "info" | "bad" | "muted" }) {
  const list = items ?? [];
  if (list.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs text-gray-500">
      <span className="mr-1">{label}</span>
      {list.map((d) => <Chip key={d} tone={tone}>{d}</Chip>)}
    </div>
  );
}

function VariationCard({ r, clientView, onView }: { r: AnswerVariationRow; clientView?: boolean; onView: (t: ViewerTarget) => void }) {
  const st = stabilityInfo(r.stability);
  const mc = r.mentionChange;
  const mcPts = mc === null || mc === undefined ? null : Math.round(mc * 1000) / 10;
  return (
    <li className="rounded-2xl border border-gray-100 bg-white/70 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 break-words text-sm font-medium text-brand-navy">{r.promptText}</p>
        <button type="button" className="shrink-0 text-xs font-medium text-brand-blue hover:underline" onClick={() => onView({ promptId: r.promptId, runId: r.runId, provider: r.provider })}>ดูคำตอบ</button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
        <ProviderLogo provider={r.provider} withName title={(!clientView && r.providerLabel) || providerLabelFor(r.provider, clientView)} />
        <span>ถาม {fmtNum(r.asks)} ครั้ง</span>
        <span>พูดถึงเรา {fmtNum(r.brandMentioned)} จาก {fmtNum(r.asks)}</span>
        <span>แนะนำ {fmtNum(r.brandRecommended)}</span>
        <span>อ้างอิงเว็บเรา {fmtNum(r.ownCited)}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <div className="flex w-44 items-center gap-2">
          <MeterBar value={(r.stability ?? 0) * 100} max={100} tone={st.tone === "muted" ? "blue" : st.tone} ariaLabel={st.label} className="flex-1" />
        </div>
        <Chip tone={st.tone}>{st.label}</Chip>
        {mcPts !== null ? <span className="text-xs text-gray-600">พูดถึงเรา {mcPts > 0 ? "+" : ""}{mcPts} จุด เทียบรอบก่อน</span> : null}
      </div>
      <div className="mt-2 space-y-1">
        <DomainChips label="อ้างอิงทุกครั้ง" items={r.alwaysCited} tone="ok" />
        <DomainChips label="อ้างอิงบางครั้ง" items={r.sometimesCited} tone="muted" />
        <DomainChips label="เข้ามาใหม่" items={r.newDomains} tone="info" />
        <DomainChips label="หลุดออก" items={r.lostDomains} tone="bad" />
        {(r.competitorsMentioned ?? []).length > 0 ? (
          <div className="flex flex-wrap items-center gap-1 text-xs text-gray-500">
            <span className="mr-1">คู่แข่งที่ถูกพูดถึง</span>
            {(r.competitorsMentioned ?? []).map((c, i) => <Chip key={`${i}-${c.name}`} tone="warn">{c.name} ({fmtNum(c.answers)})</Chip>)}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function VariationSection({ rows, clientView, onView }: { rows: AnswerVariationRow[]; clientView?: boolean; onView: (t: ViewerTarget) => void }) {
  const [shown, setShown] = useState(10);
  return (
    <Panel title="คำตอบแต่ละครั้งต่างกันอย่างไร" subtitle="AI ตอบไม่เหมือนกันทุกครั้ง ยิ่งเว็บถูกอ้างอิงทุกครั้ง ยิ่งเป็นแหล่งที่ AI เชื่อ">
      {rows.length === 0 ? <EmptyState title="ยังไม่มีข้อมูลเทียบรายคำตอบ" /> : (
        <>
          <ul className="space-y-2">
            {rows.slice(0, shown).map((r) => <VariationCard key={`${r.promptId}-${r.provider}`} r={r} clientView={clientView} onView={onView} />)}
          </ul>
          {rows.length > shown ? <button type="button" className="mt-3 text-sm font-medium text-brand-blue hover:underline" onClick={() => setShown((n) => n + 10)}>แสดงเพิ่ม ({fmtNum(rows.length - shown)})</button> : null}
        </>
      )}
    </Panel>
  );
}

// ── 6. Own pages ─────────────────────────────────────────────────────────────

function OwnPagesSection({ dto, clientView }: { dto: CitationAnalysisDTO; clientView?: boolean }) {
  const pages = dto.ownPages ?? [];
  return (
    <Panel title="หน้าเว็บเราหน้าไหนที่ AI อ้างอิง" subtitle="หน้าของเว็บเราที่ AI แนบเป็นแหล่งข้อมูลในคำตอบ">
      {pages.length === 0 ? <p className="py-6 text-center text-sm text-gray-500">AI ยังไม่ได้อ้างอิงหน้าเว็บเราในช่วงนี้</p> : (
        <ul className="divide-y divide-gray-100">
          {pages.map((p) => (
            <li key={p.url} className="min-w-0 py-2.5 text-sm">
              <ExtLink href={p.url} className="break-words font-medium text-brand-navy">{p.title || urlPath(p.url)}</ExtLink>
              <div className="break-all text-xs text-gray-400">{urlPath(p.url)}</div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                <span>{fmtNum(p.answers)} คำตอบ จาก {fmtNum(dto.totals.answers)}</span>
                <Platforms providers={p.providers} clientView={clientView} />
                <span>{fmtNum((p.prompts ?? []).length)} prompt</span>
              </div>
              {(p.prompts ?? []).length > 0 ? <div className="mt-0.5 break-words text-xs text-gray-400">{(p.prompts ?? []).slice(0, 3).map((q) => q.text).join(" · ")}</div> : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ── 7. Gaps ──────────────────────────────────────────────────────────────────

function GapsSection({ dto, clientView }: { dto: CitationAnalysisDTO; clientView?: boolean }) {
  const a = dto.gaps?.mentionedNotCited ?? [];
  const b = dto.gaps?.competitorCitedNotUs ?? [];
  const Empty = ({ text }: { text: string }) => <p className="py-6 text-center text-sm text-gray-500">{text}</p>;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="AI พูดถึงเราแต่ไม่อ้างอิงเว็บเรา" subtitle="มีชื่อแบรนด์ในคำตอบ แต่ไม่มีลิงก์กลับมาที่เว็บ · โอกาสทำเนื้อหาให้ AI หยิบไปอ้างอิง">
        {a.length === 0 ? <Empty text="ไม่พบกรณีนี้ในช่วงนี้" /> : (
          <ul className="space-y-3">
            {a.map((r) => (
              <li key={r.promptId} className="text-sm">
                <p className="break-words font-medium text-brand-navy">{r.text}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  <span>{fmtNum(r.answers)} จาก {fmtNum(r.asked)} คำตอบ</span>
                  <Platforms providers={r.providers} clientView={clientView} />
                </div>
                {(r.citedInstead ?? []).length > 0 ? (
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-gray-500">
                    <span>AI อ้างอิงแทน:</span>
                    {(r.citedInstead ?? []).map((d) => <Chip key={d} tone="muted">{d}</Chip>)}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="AI อ้างอิงเว็บคู่แข่งแต่ไม่มีเว็บเรา" subtitle="คำตอบที่คู่แข่งได้ลิงก์ แต่เราไม่ได้">
        {b.length === 0 ? <Empty text="ไม่พบกรณีนี้ในช่วงนี้" /> : (
          <ul className="space-y-3">
            {b.map((r) => (
              <li key={r.promptId} className="text-sm">
                <p className="break-words font-medium text-brand-navy">{r.text}</p>
                <div className="mt-0.5 text-xs text-gray-500">{fmtNum(r.answers)} จาก {fmtNum(r.asked)} คำตอบ</div>
                {(r.competitors ?? []).length > 0 ? (
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {(r.competitors ?? []).map((c, i) => <Chip key={`${i}-${c.domain}`} tone="warn">{c.name} · {c.domain} ({fmtNum(c.answers)})</Chip>)}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

// ── Tab ──────────────────────────────────────────────────────────────────────

export default function CitationAnalysisTab({ projectId, filters, refreshKey, onGoTab, clientView }: TabProps): ReactNode {
  const [viewing, setViewing] = useState<ViewerTarget | null>(null);
  const url = `/api/brand-radar/citation-analysis?${radarQuery(projectId, filters)}`;
  const { data, loading, error, reload } = useApiData<CitationAnalysisDTO>(url, refreshKey, true);

  if (!data) {
    if (loading) return <Skeleton />;
    return <Panel><LoadState loading={false} error={error} onRetry={reload} clientView={clientView} /></Panel>;
  }
  if (!data.configured) {
    return (
      <Panel>
        <EmptyState
          icon={<Radar className="h-6 w-6" />}
          title={clientView ? "ยังไม่มีข้อมูลรายงานสำหรับแบรนด์นี้" : "ยังไม่ได้ตั้งค่าแบรนด์"}
          description={clientView ? undefined : "ตั้งชื่อแบรนด์ โดเมน และ AI platform ที่จะติดตามที่ปุ่ม Settings มุมขวาบน ก่อน"}
          action={clientView ? undefined : <button type="button" className="text-sm font-medium text-brand-blue hover:underline" onClick={() => onGoTab("settings")}>ไปที่ Settings</button>}
        />
      </Panel>
    );
  }
  if (!data.hasData) {
    return (
      <Panel>
        <EmptyState
          icon={<Radar className="h-6 w-6" />}
          title={clientView ? "ยังไม่มีข้อมูลในช่วงเวลานี้" : NO_DATA_MESSAGE}
          description={clientView ? "ลองเปลี่ยนช่วงเวลาหรือตัวกรอง หรือรอผลการสแกนรอบถัดไป" : "เพิ่มคำถามที่ต้องการติดตาม แล้วกด Run scan now เพื่อเริ่มเก็บคำตอบ"}
        />
      </Panel>
    );
  }

  return (
    <div className={`space-y-4 ${loading ? "opacity-70" : ""}`}>
      <SummarySection dto={data} />
      <KpiRow t={data.totals} prev={data.previous} />
      <TrendSection dto={data} />
      <DomainsSection domains={data.domains ?? []} totalAnswers={data.totals.answers} clientView={clientView} onView={setViewing} />
      <VariationSection rows={data.variation ?? []} clientView={clientView} onView={setViewing} />
      <OwnPagesSection dto={data} clientView={clientView} />
      <GapsSection dto={data} clientView={clientView} />
      {!clientView && (
        <>
          <FixPagesSection rows={data.fixPages ?? []} />
          <FoundNotCitedSection funnel={data.foundFunnel ?? null} />
          <SiteReadinessSection projectId={projectId} />
        </>
      )}
      <ResponseViewer clientView={clientView} projectId={projectId} filters={filters} target={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}
