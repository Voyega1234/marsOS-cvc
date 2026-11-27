"use client";

/**
 * Brand Radar — URL Monitor (staff only): staff list the pages they want to watch, and the report shows how the
 * AI answers to the project's prompts pull (cite) each page.
 * Every number comes from the server (UrlMonitorDTO); only differences between rounds / months are computed here.
 * Text from data (URLs, prompt text, topics) is rendered as React text nodes only.
 */
import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AreaChart, Chip, EmptyState, KpiTile, Panel, Segmented } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  POSITION_FAIR_GAP, POSITION_GOOD_GAP, RATE_FAIR_RATIO, RATE_GOOD_RATIO,
} from "@/lib/brand-radar/scorecard";
import type { ScoreGrade, ScoreMetricKey } from "@/lib/brand-radar/scorecard-types";
import type {
  UrlMonitorDTO, UrlMonitorWriteRes, UrlMonthStat, UrlPromptRow, UrlReport, UrlScanPoint, UrlSummaryRow,
} from "@/lib/brand-radar/url-monitor-types";
import { ColumnHelp } from "./ColumnHelp";
import { SentimentSection } from "./InsightSections";
import { LoadState, Pager, useApiData } from "./PromptDialogs";
import { ProviderLogo } from "./ProviderLogo";
import { pct } from "./ReportCards";
import ResponseViewer, { type ViewerTarget } from "./ResponseViewer";
import { DeltaChip, NO_DELTA, computeDelta, type Kind } from "./ScanProgressSection";
import { ChangeCell, GRADE_CHIP, change, monthLabel, showValue, type RowKind } from "./ScorecardSection";
import { NO_DATA_MESSAGE, api, fmtDate, fmtNum, fmtPct, postJson, providerShort, radarQuery, type TabProps } from "./shared";

type HelpText = { what: string; how: string; when: string };

const WHEN_FILTER = "คำนวณใหม่ทุกครั้งที่เปิดหน้า ตามตัวกรองด้านบน และเปลี่ยนเมื่อมีการสแกนรอบใหม่";
const WHEN_MONTH = "คำนวณใหม่ทุกครั้งที่เปิดหน้า และเปลี่ยนเมื่อมีการสแกนรอบใหม่ ไม่ขึ้นกับตัวกรองด้านบน";

const HELP = {
  citation: {
    what: "สัดส่วนคำตอบ AI ที่ใช้ URL นี้เป็นแหล่งอ้างอิง",
    how: "คำตอบที่อ้างอิง URL นี้ ÷ คำตอบทั้งหมดในช่วงที่เลือก",
    when: WHEN_FILTER,
  },
  mention: {
    what: "ในคำตอบที่ดึง URL นี้ไปใช้ AI เอ่ยชื่อแบรนด์ของเราด้วยกี่ %",
    how: "คำตอบที่อ้างอิง URL นี้และมีชื่อแบรนด์ ÷ คำตอบที่อ้างอิง URL นี้ ถ้ายังไม่มีคำตอบที่อ้างอิง URL นี้จะแสดง —",
    when: WHEN_FILTER,
  },
  place: {
    what: "URL นี้อยู่ลำดับที่เท่าไรในรายการแหล่งอ้างอิงของคำตอบ (1 = ลำดับแรก ยิ่งน้อยยิ่งดี)",
    how: "เฉลี่ยลำดับของ URL นี้ในรายการแหล่งอ้างอิง เฉพาะคำตอบที่ดึง URL นี้ไปใช้",
    when: WHEN_FILTER,
  },
} satisfies Record<string, HelpText>;

function fmtPlace(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(1);
}

/** http(s) link only; anything else is shown as plain text */
function safeHref(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

function UrlLink({ url, className }: { url: string; className?: string }) {
  const href = safeHref(url);
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className ?? "shrink-0 text-gray-400 hover:text-brand-blue"}
      title="เปิดหน้านี้ในแท็บใหม่" aria-label="เปิดหน้านี้ในแท็บใหม่">
      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
    </a>
  );
}

const TILE = "min-w-0 rounded-xl border border-gray-100 bg-white/60 px-3 py-2 dark:border-white/10 dark:bg-white/5";
const NOTE = "rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600 dark:bg-white/5";

// ── monitored list ───────────────────────────────────────────────────────────

function UrlList({ urls, selectedId, busyId, stale, onSelect, onDelete }: {
  urls: UrlSummaryRow[];
  selectedId: string | null;
  busyId: string;
  /** true = numbers are from the previous load while the new one is on its way */
  stale: boolean;
  onSelect: (id: string) => void;
  onDelete: (u: UrlSummaryRow) => void;
}) {
  return (
    <div className={`overflow-x-auto ${stale ? "opacity-60" : ""}`}>
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500">
            <th className="py-1.5 pr-3 font-medium">URL</th>
            <th className="py-1.5 pr-3 text-right font-medium">
              <ColumnHelp help={{ what: "จำนวนคำตอบ AI ที่ใช้ URL นี้เป็นแหล่งอ้างอิง", how: "นับคำตอบที่มี URL นี้ในรายการแหล่งอ้างอิง ในช่วงที่เลือก", when: WHEN_FILTER }}>คำตอบที่ดึง</ColumnHelp>
            </th>
            <th className="py-1.5 pr-3 text-right font-medium"><ColumnHelp help={HELP.citation}>AI Citation</ColumnHelp></th>
            <th className="py-1.5 pr-3 text-right font-medium">
              <ColumnHelp help={{ what: "จำนวนคำถามที่ AI ดึง URL นี้ไปตอบอย่างน้อย 1 คำตอบ", how: "นับคำถามที่มีคำตอบอ้างอิง URL นี้ ในช่วงที่เลือก", when: WHEN_FILTER }}>คำถามที่ดึง</ColumnHelp>
            </th>
            <th className="py-1.5 pr-3 text-right font-medium">ดึงล่าสุด</th>
            <th className="py-1.5 text-right font-medium"><span className="sr-only">ลบ</span></th>
          </tr>
        </thead>
        <tbody>
          {urls.map((u) => {
            const active = u.id === selectedId;
            return (
              <tr key={u.id} className={`border-t border-gray-100 align-top ${active ? "bg-blue-50/60 dark:bg-white/10" : ""}`}>
                <td className="py-2 pl-2 pr-3">
                  <div className="flex min-w-0 items-start gap-2">
                    <button type="button" onClick={() => onSelect(u.id)} aria-pressed={active}
                      className={`min-w-0 break-all text-left hover:underline ${active ? "font-semibold text-brand-blue" : "text-gray-800"}`}
                      title="ดูรายงานของ URL นี้">
                      {u.url}
                    </button>
                    <UrlLink url={u.url} className="mt-0.5 shrink-0 text-gray-400 hover:text-brand-blue" />
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Chip tone={u.prefix ? "info" : "muted"}>{u.prefix ? "รวมหน้าย่อย" : "เฉพาะหน้านี้"}</Chip>
                    {active && <Chip tone="ok">กำลังดูรายงาน</Chip>}
                  </div>
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{fmtNum(u.citingAnswers)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{pct(u.citationRate)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{fmtNum(u.citingPrompts)}</td>
                <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums text-gray-600">{u.lastCitedAt ? fmtDate(u.lastCitedAt) : "—"}</td>
                <td className="py-2 pr-2 text-right">
                  <Button size="sm" variant="ghost" className="h-8 px-2 text-gray-500 hover:text-red-600" disabled={busyId !== ""}
                    onClick={() => onDelete(u)} title="เลิกติดตาม URL นี้" aria-label={`เลิกติดตาม ${u.url}`}>
                    {busyId === u.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── scorecard ────────────────────────────────────────────────────────────────

const GOOD_PCT = Math.round(RATE_GOOD_RATIO * 100);
const FAIR_PCT = Math.round(RATE_FAIR_RATIO * 100);
const RATE_RULE =
  `ค่าของ URL นี้ ÷ ค่าของตัวเทียบ ถ้าได้ ${GOOD_PCT}% ขึ้นไปเป็น "ดี" ${FAIR_PCT}% ขึ้นไปเป็น "พอใช้" ต่ำกว่านั้นเป็น "ต้องแก้" ` +
  `ถ้าค่าของ URL นี้เป็น 0 เป็น "ต้องแก้" ถ้าไม่มีตัวเทียบจะไม่ให้เกรด`;

const GRADE_META: Record<ScoreMetricKey, { label: string; benchmark: string; help: HelpText }> = {
  citation: {
    label: "AI Citation",
    benchmark: "หน้าอื่นที่ถูกอ้างอิงมากที่สุด",
    help: {
      what: "URL นี้ถูก AI ดึงไปอ้างอิงบ่อยแค่ไหน เทียบกับหน้าอื่นทุกหน้าที่ AI อ้างอิงในคำตอบชุดเดียวกัน",
      how: `คำตอบที่อ้างอิง URL นี้ ÷ คำตอบทั้งหมด เทียบกับหน้าอื่นที่ถูกอ้างอิงมากที่สุด ${RATE_RULE} อันดับ = 1 + จำนวนหน้าที่ถูกอ้างอิงมากกว่า URL นี้`,
      when: WHEN_FILTER,
    },
  },
  mention: {
    label: "Brand Mention",
    benchmark: "ค่าเฉลี่ยทั้งโปรเจกต์",
    help: {
      what: "คำตอบที่ดึง URL นี้ เอ่ยชื่อแบรนด์ของเราบ่อยกว่าคำตอบทั่วไปของโปรเจกต์หรือไม่",
      how: `คำตอบที่อ้างอิง URL นี้และมีชื่อแบรนด์ ÷ คำตอบที่อ้างอิง URL นี้ เทียบกับสัดส่วนคำตอบที่มีชื่อแบรนด์ของทั้งโปรเจกต์ ${RATE_RULE}`,
      when: WHEN_FILTER,
    },
  },
  position: {
    label: "ลำดับเฉลี่ยในแหล่งอ้างอิง",
    benchmark: "ค่าเฉลี่ยแหล่งอ้างอิงอื่น",
    help: {
      what: "URL นี้ถูกวางไว้ลำดับต้น ๆ ของรายการแหล่งอ้างอิงหรือไม่ (1 = ลำดับแรก ยิ่งน้อยยิ่งดี)",
      how: `เฉลี่ยลำดับของ URL นี้ เทียบกับลำดับเฉลี่ยของแหล่งอ้างอิงอื่นทั้งหมด ถ้าตามหลังไม่เกิน ${POSITION_GOOD_GAP} ลำดับ (หรือนำอยู่) เป็น "ดี" ` +
        `ไม่เกิน ${POSITION_FAIR_GAP} ลำดับเป็น "พอใช้" มากกว่านั้นเป็น "ต้องแก้"`,
      when: WHEN_FILTER,
    },
  },
};

function UrlGradeTile({ g }: { g: ScoreGrade }) {
  const meta = GRADE_META[g.metric];
  const isPlace = g.metric === "position";
  const chip = g.grade
    ? GRADE_CHIP[g.grade]
    : g.value === null
      ? { tone: "muted" as const, text: "ยังไม่มีข้อมูล" }
      : { tone: "muted" as const, text: "ยังไม่มีตัวเทียบ" };
  return (
    <div className="min-w-0 rounded-xl border border-gray-100 bg-white/60 px-3 py-3 dark:border-white/10 dark:bg-white/5">
      <div className="text-xs text-gray-500"><ColumnHelp help={meta.help} align="start">{meta.label}</ColumnHelp></div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span className="text-2xl font-semibold tabular-nums text-gray-900">{isPlace ? fmtPlace(g.value) : pct(g.value)}</span>
        <Chip tone={chip.tone}>{chip.text}</Chip>
      </div>
      {g.metric === "citation" && g.grade && g.rank !== null && (
        <div className="mt-1 text-sm text-gray-700">อันดับ {fmtNum(g.rank)} จาก {fmtNum(g.outOf)} หน้าที่ถูกอ้างอิง</div>
      )}
      {g.bestCompetitor && (
        <div className="mt-1 text-xs text-gray-500">
          {meta.benchmark}:{" "}
          <span className="tabular-nums">{isPlace ? fmtPlace(g.bestCompetitor.value) : pct(g.bestCompetitor.value)}</span>
          {g.metric === "citation" && <div className="mt-0.5 break-all">{g.bestCompetitor.name}</div>}
        </div>
      )}
    </div>
  );
}

const MONTH_ROWS: Array<{ key: string; label: string; kind: RowKind; get: (m: UrlMonthStat) => number | null; help: HelpText }> = [
  {
    key: "citation", label: "AI Citation", kind: "rate", get: (m) => m.citationRate,
    help: { what: HELP.citation.what, how: "คำตอบที่อ้างอิง URL นี้ ÷ คำตอบทั้งหมดของเดือนนั้น ส่วนต่างแสดงเป็นจุดเปอร์เซ็นต์", when: WHEN_MONTH },
  },
  {
    key: "mention", label: "Brand Mention", kind: "rate", get: (m) => m.brandMentionRate,
    help: { what: HELP.mention.what, how: "คำตอบที่อ้างอิง URL นี้และมีชื่อแบรนด์ ÷ คำตอบที่อ้างอิง URL นี้ของเดือนนั้น", when: WHEN_MONTH },
  },
  {
    key: "place", label: "ลำดับเฉลี่ยในแหล่งอ้างอิง", kind: "position", get: (m) => m.avgPlace,
    help: { what: HELP.place.what, how: "เฉลี่ยลำดับของ URL นี้ในรายการแหล่งอ้างอิงทั้งเดือน ส่วนต่างติดลบแปลว่าดีขึ้น", when: WHEN_MONTH },
  },
  {
    key: "cited", label: "คำตอบที่ดึง URL นี้", kind: "count", get: (m) => m.cited,
    help: { what: "จำนวนคำตอบ AI ที่อ้างอิง URL นี้ในเดือนนั้น", how: "นับคำตอบที่มี URL นี้ในรายการแหล่งอ้างอิง ส่วนต่างเป็นจำนวนที่เพิ่มหรือลด ไม่ตัดสินว่าดีหรือแย่", when: WHEN_MONTH },
  },
  {
    key: "asked", label: "จำนวนคำตอบ", kind: "count", get: (m) => m.asked,
    help: { what: "จำนวนคำตอบจาก AI ที่เก็บได้สำเร็จในเดือนนั้น", how: "นับคำตอบที่เก็บสำเร็จของรอบสแกนที่เริ่มในเดือนนั้น (เดือนปฏิทินเวลาประเทศไทย)", when: WHEN_MONTH },
  },
  {
    key: "scans", label: "จำนวนรอบสแกน", kind: "count", get: (m) => m.scans,
    help: { what: "จำนวนรอบสแกนที่เริ่มในเดือนนั้นและมีคำตอบอย่างน้อยหนึ่งคำตอบ", how: "นับรอบสแกนที่มีคำตอบที่เก็บสำเร็จ จัดเข้าเดือนตามวันที่รอบนั้นเริ่ม", when: WHEN_MONTH },
  },
];

const CHANGE_HELP = (base: string): HelpText => ({
  what: `การเปลี่ยนแปลงของเดือนล่าสุดเมื่อเทียบกับ${base}`,
  how: "อัตราส่วนแสดงเป็นจุดเปอร์เซ็นต์ (เดือนล่าสุด − เดือนที่เทียบ) ลำดับเฉลี่ยแสดงส่วนต่างตรง ๆ สีเขียว = ดีขึ้น สีแดง = แย่ลง (ลำดับยิ่งน้อยยิ่งดี) แถวจำนวนไม่ใช้สี",
  when: WHEN_MONTH,
});

function UrlScorecardPanel({ scorecard }: { scorecard: UrlReport["scorecard"] }) {
  const months = scorecard.months;
  const current = months?.current ?? null;
  const previous = months?.previous ?? null;
  const first = months?.first ?? null;
  const showFirst = !!first && first.month !== previous?.month && first.month !== current?.month;
  const onlyCurrent = !!current && !previous && !showFirst;

  return (
    <Panel title="Scorecard" subtitle="เกรดของ URL นี้เทียบกับแหล่งอ้างอิงอื่น (เกรดคิดตามตัวกรองของหน้านี้) และเทียบรายเดือน">
      <div className="space-y-6">
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-900">เกรดของ URL นี้</h3>
          <div className="grid gap-2 sm:grid-cols-3">
            {scorecard.grades.map((g) => <UrlGradeTile key={g.metric} g={g} />)}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-900">เทียบรายเดือน</h3>
          <p className="text-xs text-gray-500">ทุกแพลตฟอร์ม ทุกคำถาม ไม่ขึ้นกับตัวกรองด้านบน</p>
          {months === null ? (
            <p className={NOTE}>โหลดข้อมูลรายเดือนไม่สำเร็จ ลองเปิดหน้านี้ใหม่อีกครั้ง</p>
          ) : !current ? (
            <p className={NOTE}>ยังไม่มีข้อมูลรายเดือน</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500">
                      <th className="py-1.5 pr-3 text-left font-medium">ตัวชี้วัด</th>
                      <th className="py-1.5 pr-3 text-right font-medium">{monthLabel(current.month)}</th>
                      {!onlyCurrent && (
                        <>
                          <th className="py-1.5 pr-3 text-right font-medium">{previous ? monthLabel(previous.month) : "เดือนก่อน"}</th>
                          <th className="py-1.5 pr-3 text-right font-medium">
                            <ColumnHelp help={CHANGE_HELP("เดือนก่อนหน้า")}>เทียบเดือนก่อน</ColumnHelp>
                          </th>
                        </>
                      )}
                      {showFirst && first && (
                        <>
                          <th className="py-1.5 pr-3 text-right font-medium">{monthLabel(first.month)}</th>
                          <th className="py-1.5 text-right font-medium">
                            <ColumnHelp help={CHANGE_HELP("เดือนแรกที่มีข้อมูล")} align="end">เทียบเดือนแรก</ColumnHelp>
                          </th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {MONTH_ROWS.map((r) => {
                      const cur = r.get(current);
                      return (
                        <tr key={r.key} className="border-t border-gray-100">
                          <td className="py-2 pr-3 text-gray-800"><ColumnHelp help={r.help} align="start">{r.label}</ColumnHelp></td>
                          <td className="py-2 pr-3 text-right font-medium tabular-nums">{showValue(r.kind, cur)}</td>
                          {!onlyCurrent && (
                            <>
                              <td className="py-2 pr-3 text-right tabular-nums">{previous ? showValue(r.kind, r.get(previous)) : "—"}</td>
                              <td className="py-2 pr-3 text-right"><ChangeCell c={previous ? change(r.kind, cur, r.get(previous)) : null} /></td>
                            </>
                          )}
                          {showFirst && first && (
                            <>
                              <td className="py-2 pr-3 text-right tabular-nums">{showValue(r.kind, r.get(first))}</td>
                              <td className="py-2 text-right"><ChangeCell c={change(r.kind, cur, r.get(first))} /></td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {onlyCurrent && <p className="text-sm text-gray-600">ยังไม่มีเดือนก่อนให้เทียบ</p>}
            </>
          )}
        </section>
      </div>
    </Panel>
  );
}

// ── scan progress ────────────────────────────────────────────────────────────

interface ScanMetric {
  key: string;
  label: string;
  kind: Kind;
  get: (s: UrlScanPoint) => number | null;
  show: (s: UrlScanPoint) => string;
  help: HelpText;
}

const SCAN_METRICS: ScanMetric[] = [
  { key: "citation", label: "AI Citation", kind: "rate", get: (s) => s.citationRate, show: (s) => pct(s.citationRate), help: HELP.citation },
  {
    key: "cited", label: "คำตอบที่ดึง", kind: "count", get: (s) => s.cited, show: (s) => `${fmtNum(s.cited)} คำตอบ`,
    help: { what: "จำนวนคำตอบของรอบนั้นที่อ้างอิง URL นี้", how: "นับคำตอบที่มี URL นี้ในรายการแหล่งอ้างอิง", when: WHEN_FILTER },
  },
  { key: "mention", label: "Brand Mention", kind: "rate", get: (s) => s.brandMentionRate, show: (s) => pct(s.brandMentionRate), help: HELP.mention },
  { key: "place", label: "ลำดับเฉลี่ย", kind: "position", get: (s) => s.avgPlace, show: (s) => fmtPlace(s.avgPlace), help: HELP.place },
];

const SCAN_PAGE_SIZE = 10;
const toPct = (v: number | null) => (v === null ? null : v * 100);

function UrlScanPanel({ scans }: { scans: UrlScanPoint[] }) {
  const [page, setPage] = useState(1);
  const signature = `${scans.length}:${scans[0]?.runId ?? ""}:${scans[scans.length - 1]?.runId ?? ""}`;
  useEffect(() => { setPage(1); }, [signature]);

  if (scans.length === 0) return null;
  const newest = scans[scans.length - 1];
  const before = scans.length > 1 ? scans[scans.length - 2] : null;
  // newest first for the table; the "previous" round is the next row down
  const rows = [...scans].reverse();
  const multi = scans.length >= 2;
  const pages = Math.max(1, Math.ceil(rows.length / SCAN_PAGE_SIZE));
  const curPage = Math.min(page, pages);
  const firstRow = (curPage - 1) * SCAN_PAGE_SIZE;
  const pageRows = rows.slice(firstRow, firstRow + SCAN_PAGE_SIZE);

  return (
    <Panel title="Scan Progress" subtitle="AI ดึง URL นี้ไปตอบมากขึ้นหรือน้อยลงในแต่ละรอบสแกน เทียบกับรอบก่อนหน้า">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {SCAN_METRICS.map((m) => (
            <div key={m.key} className={TILE}>
              <div className="truncate text-xs text-gray-500">{m.label}</div>
              <div className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900">{m.show(newest)}</div>
              <div className="mt-1">
                <DeltaChip d={before ? computeDelta(m.get(newest), m.get(before), m.kind) : NO_DELTA} />
              </div>
            </div>
          ))}
        </div>

        {!multi && <p className={NOTE}>มีรอบสแกนรอบเดียว ต้องมีอย่างน้อย 2 รอบจึงจะเทียบพัฒนาการได้</p>}

        {multi && (
          <AreaChart
            height={240}
            showLegend
            formatValue={(n) => `${Math.round(n)}%`}
            ariaLabel="กราฟ AI Citation และ Brand Mention ของ URL นี้ในแต่ละรอบสแกน"
            series={[
              { name: "AI Citation", points: scans.map((s) => ({ label: s.label, value: toPct(s.citationRate) })) },
              { name: "Brand Mention", points: scans.map((s) => ({ label: s.label, value: toPct(s.brandMentionRate) })) },
            ]}
          />
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500">
                <th className="py-1.5 pr-3 font-medium">รอบสแกน</th>
                <th className="py-1.5 pr-3 text-right font-medium">คำตอบ</th>
                {SCAN_METRICS.map((m) => (
                  <th key={m.key} className="py-1.5 pr-3 text-right font-medium last:pr-0"><ColumnHelp help={m.help}>{m.label}</ColumnHelp></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((s, i) => {
                // the round before may sit on the next page; compare against the full list
                const prev = rows[firstRow + i + 1] ?? null;
                const dim = s.sameSetAsPrevious === false;
                return (
                  <tr key={s.runId} className="border-t border-gray-100 align-top">
                    <td className="py-2 pr-3 text-gray-800">
                      <span className="whitespace-nowrap tabular-nums">{s.label}</span>
                      {dim && (
                        <Chip tone="warn" className="ml-2" title="รอบนี้ใช้ชุดคำถามหรือแอป AI ไม่เหมือนรอบก่อนหน้า ตัวเลขส่วนต่างจึงเทียบกันตรง ๆ ไม่ได้">
                          เทียบตรงไม่ได้
                        </Chip>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{fmtNum(s.asked)}</td>
                    {SCAN_METRICS.map((m) => (
                      <td key={m.key} className="py-2 pr-3 text-right last:pr-0">
                        <div className="tabular-nums">{m.show(s)}</div>
                        <div className="mt-0.5 flex justify-end">
                          <DeltaChip d={prev ? computeDelta(m.get(s), m.get(prev), m.kind) : NO_DELTA} dim={dim} />
                        </div>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pager page={curPage} pageSize={SCAN_PAGE_SIZE} total={rows.length} onPage={setPage} />
        <p className="text-xs text-gray-500">ตัวเลขสีเขียว/แดง = เทียบกับรอบสแกนก่อนหน้า</p>
      </div>
    </Panel>
  );
}

// ── prompts ──────────────────────────────────────────────────────────────────

type PromptFilter = "cited" | "none" | "all";
const PROMPT_PAGE_SIZE = 10;

function UrlPromptsPanel({ prompts, onOpenAnswer }: { prompts: UrlPromptRow[]; onOpenAnswer: (t: ViewerTarget) => void }) {
  const citedCount = useMemo(() => prompts.filter((p) => p.cited > 0).length, [prompts]);
  const [filter, setFilter] = useState<PromptFilter>(citedCount > 0 ? "cited" : "all");
  const [page, setPage] = useState(1);
  const rows = useMemo(
    () => (filter === "all" ? prompts : prompts.filter((p) => (filter === "cited" ? p.cited > 0 : p.cited === 0))),
    [prompts, filter],
  );
  useEffect(() => { setPage(1); }, [filter, prompts]);

  const pages = Math.max(1, Math.ceil(rows.length / PROMPT_PAGE_SIZE));
  const curPage = Math.min(page, pages);
  const pageRows = rows.slice((curPage - 1) * PROMPT_PAGE_SIZE, curPage * PROMPT_PAGE_SIZE);

  return (
    <Panel
      title="Prompt ที่ดึง URL นี้ไปตอบ"
      subtitle="คำถามแต่ละข้อที่ถาม AI: มีกี่คำตอบที่ใช้ URL นี้เป็นแหล่งอ้างอิง และ AI ตัวไหนดึงไปใช้"
      actions={
        <Segmented<PromptFilter>
          size="sm"
          ariaLabel="กรองคำถาม"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "cited", label: "ดึง URL นี้", count: citedCount },
            { value: "none", label: "ไม่ดึง", count: prompts.length - citedCount },
            { value: "all", label: "ทั้งหมด", count: prompts.length },
          ]}
        />
      }
    >
      {rows.length === 0 ? (
        <p className={NOTE}>
          {filter === "cited" ? "ยังไม่มีคำถามที่ AI ดึง URL นี้ไปตอบในช่วงที่เลือก" : filter === "none" ? "ทุกคำถามมีคำตอบที่ดึง URL นี้" : "ยังไม่มีคำถามที่มีคำตอบ"}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500">
                  <th className="py-1.5 pr-3 font-medium">คำถาม</th>
                  <th className="py-1.5 pr-3 text-right font-medium">คำตอบ</th>
                  <th className="py-1.5 pr-3 text-right font-medium">ดึง URL นี้</th>
                  <th className="py-1.5 pr-3 text-right font-medium"><ColumnHelp help={HELP.citation}>AI Citation</ColumnHelp></th>
                  <th className="py-1.5 pr-3 text-right font-medium"><ColumnHelp help={HELP.mention}>Brand Mention</ColumnHelp></th>
                  <th className="py-1.5 pr-3 font-medium">AI ที่ดึง</th>
                  <th className="py-1.5 text-right font-medium"><span className="sr-only">ดูคำตอบ</span></th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((p) => {
                  const latest = p.latest;
                  return (
                    <tr key={p.promptId} className="border-t border-gray-100 align-top">
                      <td className="py-2 pr-3">
                        <div className="max-w-[28rem] break-words text-gray-800">{p.text}</div>
                        {p.topic && <div className="mt-1"><Chip tone="muted">{p.topic}</Chip></div>}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmtNum(p.asked)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmtNum(p.cited)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{pct(p.citationRate)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{p.cited > 0 ? `${fmtNum(p.brandMentioned)}/${fmtNum(p.cited)}` : "—"}</td>
                      <td className="py-2 pr-3">
                        {p.providers.length === 0 ? <span className="text-gray-400">—</span> : (
                          <div className="flex flex-wrap gap-1.5">
                            {p.providers.map((pr) => <ProviderLogo key={pr} provider={pr} size={18} title={providerShort(pr)} />)}
                          </div>
                        )}
                      </td>
                      <td className="py-2 text-right">
                        {latest && (
                          <Button size="sm" variant="outline" className="h-8 whitespace-nowrap px-2.5 text-xs"
                            title={latest.at ? `คำตอบล่าสุดที่ดึง URL นี้ (${fmtDate(latest.at)})` : "คำตอบล่าสุดที่ดึง URL นี้"}
                            onClick={() => onOpenAnswer({ promptId: p.promptId, runId: latest.runId, provider: latest.provider, responseId: latest.responseId })}>
                            ดูคำตอบ
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pager page={curPage} pageSize={PROMPT_PAGE_SIZE} total={rows.length} onPage={setPage} />
        </>
      )}
    </Panel>
  );
}

// ── report of one URL ────────────────────────────────────────────────────────

function UrlReportView({ report, onOpenAnswer }: { report: UrlReport; onOpenAnswer: (t: ViewerTarget) => void }) {
  const { totals, heat } = report;
  const heatHasValue = heat.values.some((row) => row.some((v) => v !== null));
  const neverCited = totals.citingAnswers === 0;

  return (
    <div className="space-y-4">
      <Panel
        title="รายงานของ URL ที่เลือก"
        subtitle={`อ้างอิงจาก ${fmtNum(totals.answers)} คำตอบ ของ ${fmtNum(totals.prompts)} คำถาม ในตัวกรองปัจจุบัน`}
      >
        <div className="space-y-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
            <span className="min-w-0 break-all font-medium text-gray-900">{report.url.url}</span>
            <UrlLink url={report.url.url} />
            <Chip tone={report.url.prefix ? "info" : "muted"}>{report.url.prefix ? "รวมหน้าย่อย" : "เฉพาะหน้านี้"}</Chip>
            {totals.lastCitedAt && <span className="text-xs text-gray-500">ดึงล่าสุด {fmtDate(totals.lastCitedAt)}</span>}
          </div>
          {neverCited && <p className={NOTE}>ยังไม่มีคำตอบ AI ที่ดึง URL นี้ไปตอบในช่วงที่เลือก</p>}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <KpiTile tone="sky" label={<ColumnHelp help={HELP.citation} align="start">AI Citation</ColumnHelp>}
              value={pct(totals.citationRate)} hint={`${fmtNum(totals.citingAnswers)} จาก ${fmtNum(totals.answers)} คำตอบ`} />
            <KpiTile tone="mist" label={<ColumnHelp help={HELP.mention} align="start">Brand Mention</ColumnHelp>}
              value={pct(totals.brandMentionRate)} hint={`${fmtNum(totals.brandMentioned)} จาก ${fmtNum(totals.citingAnswers)} คำตอบที่ดึง URL นี้`} />
            <KpiTile tone="plain" label={<ColumnHelp help={HELP.place} align="start">ลำดับเฉลี่ยในแหล่งอ้างอิง</ColumnHelp>}
              value={fmtPlace(totals.avgPlace)} hint="1 = ลำดับแรก ยิ่งน้อยยิ่งดี" />
          </div>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="แยกตาม AI" subtitle="AI แต่ละตัวดึง URL นี้ไปตอบกี่คำตอบ">
          {report.byProvider.length === 0 ? <p className={NOTE}>ยังไม่มีข้อมูล</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500">
                    <th className="py-1.5 pr-3 font-medium">AI</th>
                    <th className="py-1.5 pr-3 text-right font-medium">คำตอบ</th>
                    <th className="py-1.5 pr-3 text-right font-medium">ดึง URL นี้</th>
                    <th className="py-1.5 pr-3 text-right font-medium"><ColumnHelp help={HELP.citation}>AI Citation</ColumnHelp></th>
                    <th className="py-1.5 text-right font-medium"><ColumnHelp help={HELP.mention} align="end">Brand Mention</ColumnHelp></th>
                  </tr>
                </thead>
                <tbody>
                  {report.byProvider.map((r) => (
                    <tr key={r.provider} className="border-t border-gray-100">
                      <td className="py-2 pr-3"><ProviderLogo provider={r.provider} size={18} withName /></td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmtNum(r.answers)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmtNum(r.citingAnswers)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{pct(r.citationRate)}</td>
                      <td className="py-2 text-right tabular-nums">{pct(r.brandMentionRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="หัวข้อ × AI" subtitle="AI ดึง URL นี้ไปตอบกี่ % ของคำตอบในแต่ละหัวข้อ; – = ยังไม่มีข้อมูล">
          {heat.rows.length === 0 || heat.columns.length === 0 || !heatHasValue ? <p className={NOTE}>ยังไม่มีข้อมูล</p> : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] border-separate border-spacing-1 text-xs">
                  <thead>
                    <tr>
                      <th className="text-left font-medium text-gray-500" />
                      {heat.columns.map((c) => (
                        <th key={c} className="px-1 text-center font-medium text-gray-600"><ProviderLogo provider={c} size={18} title={providerShort(c)} /></th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {heat.rows.map((row, ri) => (
                      <tr key={row}>
                        <th className="max-w-[10rem] break-words pr-2 text-left font-medium text-gray-700">{row}</th>
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
              <p className="mt-2 text-xs text-gray-500">สีเข้ม = AI ดึง URL นี้ไปตอบบ่อย (0% ถึง 100%)</p>
            </>
          )}
        </Panel>
      </div>

      {report.url.prefix && report.pages.length > 0 && (
        <Panel title="หน้าที่ถูกดึงไปตอบ" subtitle="หน้าใต้ URL นี้ที่ AI ใช้เป็นแหล่งอ้างอิง เรียงจากมากไปน้อย">
          <ul className="divide-y divide-gray-100 text-sm">
            {report.pages.map((p) => (
              <li key={p.url} className="flex min-w-0 items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  {p.title && <div className="break-words text-gray-800">{p.title}</div>}
                  <div className="flex min-w-0 items-start gap-2">
                    <span className={`min-w-0 break-all ${p.title ? "text-xs text-gray-500" : "text-gray-800"}`}>{p.url}</span>
                    <UrlLink url={p.url} className="mt-0.5 shrink-0 text-gray-400 hover:text-brand-blue" />
                  </div>
                </div>
                <span className="shrink-0 whitespace-nowrap tabular-nums text-gray-700">{fmtNum(p.answers)} คำตอบ</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="space-y-1">
        <SentimentSection insight={report.insight} onOpenAnswer={onOpenAnswer} />
        <p className="px-1 text-xs text-gray-500">Brand Sentiment ในหน้านี้นับเฉพาะคำตอบที่ดึง URL นี้ไปตอบ</p>
      </div>

      <UrlScorecardPanel scorecard={report.scorecard} />
      <UrlScanPanel scans={report.scans} />
      <UrlPromptsPanel key={report.url.id} prompts={report.prompts} onOpenAnswer={onOpenAnswer} />
    </div>
  );
}

// ── tab ──────────────────────────────────────────────────────────────────────

export default function UrlMonitorTab({ projectId, filters, refreshKey, profile, onGoTab }: TabProps) {
  const [urlId, setUrlId] = useState("");
  const [draft, setDraft] = useState("");
  const [prefix, setPrefix] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [formError, setFormError] = useState("");
  const [viewing, setViewing] = useState<ViewerTarget | null>(null);
  // the list stays on screen while another URL (or another filter) is loading
  const [kept, setKept] = useState<{ projectId: string; dto: UrlMonitorDTO } | null>(null);

  const url = `/api/brand-radar/url-monitor?${radarQuery(projectId, filters, { urlId })}`;
  const { data, loading, error, reload } = useApiData<UrlMonitorDTO>(profile ? url : "", refreshKey, true);

  useEffect(() => { if (data) setKept({ projectId, dto: data }); }, [data, projectId]);
  useEffect(() => { setUrlId(""); setFormError(""); setViewing(null); }, [projectId]);

  const shown = data ?? (kept && kept.projectId === projectId ? kept.dto : null);

  async function add() {
    const value = draft.trim();
    if (!value || adding) return;
    setAdding(true);
    setFormError("");
    const r = await api<UrlMonitorWriteRes>("/api/brand-radar/url-monitor", postJson({ projectId, url: value, prefix }));
    setAdding(false);
    if (!r.ok) {
      const msg = r.data.error || "เพิ่ม URL ไม่สำเร็จ";
      setFormError(msg);
      toast.error(msg);
      return;
    }
    setDraft("");
    setPrefix(false);
    if (r.data.id) setUrlId(r.data.id);
    reload();
  }

  async function remove(u: UrlSummaryRow) {
    if (busyId) return;
    if (!window.confirm(`เลิกติดตาม URL นี้?\n${u.url}\n\nข้อมูลคำตอบของ AI ไม่ถูกลบ เพิ่ม URL นี้กลับมาเมื่อไรก็ได้`)) return;
    setBusyId(u.id);
    const r = await api<UrlMonitorWriteRes>("/api/brand-radar/url-monitor", postJson({ projectId, id: u.id }, "DELETE"));
    setBusyId("");
    if (!r.ok) {
      toast.error(r.data.error || "ลบ URL ไม่สำเร็จ");
      return;
    }
    if (shown?.selectedId === u.id) setUrlId("");
    reload();
  }

  if (!profile) {
    return (
      <Panel>
        <EmptyState title="ยังไม่ได้ตั้งค่า Brand Radar" description="ตั้งค่าแบรนด์และคู่แข่งที่ปุ่ม Settings มุมขวาบน ก่อน"
          action={<Button size="sm" onClick={() => onGoTab("settings")}>ไปที่ Settings</Button>} />
      </Panel>
    );
  }
  if (!shown) {
    return <Panel><LoadState loading={loading} error={error} onRetry={reload} /></Panel>;
  }

  const report = data?.report ?? null;

  return (
    <div className="space-y-4">
      <Panel title="URL ที่ติดตาม" subtitle="ใส่ลิงก์หน้าที่ต้องการดูว่า AI ดึงไปตอบคำถาม (prompt) ของโปรเจกต์นี้อย่างไร กดที่ URL เพื่อดูรายงาน">
        <div className="space-y-4">
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void add(); }}>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={draft}
                onChange={(e) => { setDraft(e.target.value); if (formError) setFormError(""); }}
                placeholder="https://example.com/page"
                inputMode="url"
                autoComplete="off"
                aria-label="URL ที่ต้องการติดตาม"
                aria-invalid={formError ? true : undefined}
                className="min-w-0 flex-1"
              />
              <Button type="submit" disabled={adding || draft.trim() === ""} className="shrink-0">
                {adding ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <Plus className="mr-1.5 h-4 w-4" aria-hidden />}
                เพิ่ม URL
              </Button>
            </div>
            <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" className="h-4 w-4 rounded border-gray-300" checked={prefix} onChange={(e) => setPrefix(e.target.checked)} />
              รวมหน้าย่อยทั้งหมดใต้ URL นี้
            </label>
            {formError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{formError}</p>}
          </form>

          {shown.urls.length === 0 ? (
            <EmptyState title="ยังไม่มี URL ที่ติดตาม" description="เพิ่มลิงก์หน้าเว็บด้านบน ระบบจะนับจากคำตอบ AI ที่สแกนไว้แล้วทันที ไม่ต้องสแกนใหม่" />
          ) : (
            <UrlList urls={shown.urls} selectedId={shown.selectedId} busyId={busyId} stale={!data} onSelect={setUrlId} onDelete={(u) => void remove(u)} />
          )}
        </div>
      </Panel>

      {shown.urls.length > 0 && (
        !data ? (
          <Panel><LoadState loading={loading} error={error} onRetry={reload} /></Panel>
        ) : data.answers === 0 ? (
          <Panel><EmptyState title="ยังไม่มีข้อมูล" description={NO_DATA_MESSAGE} /></Panel>
        ) : report ? (
          <UrlReportView key={report.url.id} report={report} onOpenAnswer={setViewing} />
        ) : null
      )}

      <ResponseViewer projectId={projectId} filters={filters} target={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}
