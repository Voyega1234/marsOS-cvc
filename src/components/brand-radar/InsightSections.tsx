"use client";

/**
 * Brand Radar — insight blocks shared by the Overview dashboard:
 * Brand Sentiment (how the AI describes the brand) and Search Query Groups (what the AI searched).
 * All API text is untrusted: rendered as React text nodes only, never as HTML.
 */
import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip, Panel } from "@/components/ds";
import type { ChipTone } from "@/components/ds";
import {
  BRAND_POSITIONING_LABEL, SEARCH_QUERY_SUPPORT, SENTIMENT_TONES, SENTIMENT_TONE_LABEL,
  type AnswerInsightDTO, type InsightEntityDTO, type InsightQuote, type QueryGroupDTO, type SentimentTone,
} from "@/lib/brand-radar/types";
import { fmtNum, fmtPct, providerLabelFor } from "./shared";
import type { ViewerTarget } from "./ResponseViewer";

/** DOM id of the sentiment block, used by the "ควรดูต่อ" panel to scroll here */
export const SENTIMENT_SECTION_ID = "brand-radar-sentiment";

export const TONE_COLOR: Record<SentimentTone, string> = {
  positive: "bg-emerald-500",
  neutral: "bg-gray-400",
  mixed: "bg-amber-400",
  negative: "bg-red-500",
};
export const TONE_CHIP: Record<SentimentTone, ChipTone> = { positive: "ok", neutral: "muted", mixed: "warn", negative: "bad" };

function pctWidth(n: number, total: number): number {
  return total > 0 ? Math.min(100, Math.max(0, (n / total) * 100)) : 0;
}

/** Tone with the most answers; null when nothing is counted */
export function dominantTone(tones: Record<SentimentTone, number> | undefined): SentimentTone | null {
  let best: SentimentTone | null = null;
  let bestN = 0;
  for (const t of SENTIMENT_TONES) {
    const n = tones?.[t] ?? 0;
    if (n > bestN) { best = t; bestN = n; }
  }
  return best;
}

function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-2">
      <h3 className="text-sm font-semibold text-brand-navy">{children}</h3>
      {hint ? <p className="mt-0.5 text-xs text-gray-500">{hint}</p> : null}
    </div>
  );
}

/** Four-tone bar (positive / neutral / mixed / negative); `legend` adds the count list under it */
export function ToneBar({ tones, total, legend = true }: { tones: Record<SentimentTone, number> | undefined; total: number; legend?: boolean }) {
  return (
    <>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-gray-100" role="img" aria-label="สัดส่วนโทน">
        {SENTIMENT_TONES.map((t) => {
          const n = tones?.[t] ?? 0;
          return n > 0 ? <div key={t} title={`${SENTIMENT_TONE_LABEL[t]}: ${n}`} className={TONE_COLOR[t]} style={{ width: `${pctWidth(n, total)}%` }} /> : null;
        })}
      </div>
      {legend ? (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
          {SENTIMENT_TONES.map((t) => {
            const n = tones?.[t] ?? 0;
            return (
              <span key={t} className="inline-flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${TONE_COLOR[t]}`} />
                {SENTIMENT_TONE_LABEL[t]} <b className="tabular-nums">{fmtNum(n)}</b> ({total > 0 ? fmtPct(n / total) : "—"})
              </span>
            );
          })}
        </div>
      ) : null}
    </>
  );
}

/** Split bar for one factor: positive (green) / neutral (gray) / negative (red) */
function FactorSplit({ positive, neutral, negative }: { positive: number; neutral: number; negative: number }) {
  const total = positive + neutral + negative;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-gray-100">
      {positive > 0 ? <div className="bg-emerald-500" style={{ width: `${pctWidth(positive, total)}%` }} /> : null}
      {neutral > 0 ? <div className="bg-gray-400" style={{ width: `${pctWidth(neutral, total)}%` }} /> : null}
      {negative > 0 ? <div className="bg-red-500" style={{ width: `${pctWidth(negative, total)}%` }} /> : null}
    </div>
  );
}

/** What ResponseViewer needs to open the answer a quote came from; null when the quote carries no usable ids */
export function quoteTarget(q: InsightQuote): ViewerTarget | null {
  if (!q || !q.promptId) return null;
  return { promptId: q.promptId, runId: q.runId || undefined, provider: q.provider || undefined, responseId: q.responseId || undefined };
}

const APPROX_NOTE = "ข้อความรอบชื่อแบรนด์ในคำตอบนี้ (คำตอบรอบเก่า ระบบยังไม่ได้เก็บประโยคที่ตรงกับหัวข้อ)";
const NO_QUOTE_HINT = "ยังไม่มีตัวอย่างข้อความ จะมีหลังสแกนรอบถัดไป";

/** Example passages from the AI's answers. Model text: rendered as text nodes only. */
function QuoteList({ quotes, onOpenAnswer }: { quotes: InsightQuote[]; onOpenAnswer?: (target: ViewerTarget) => void }) {
  return (
    <div className="mt-1.5 rounded-lg bg-gray-50 p-2.5">
      <p className="mb-1 text-[11px] font-medium text-gray-600">ตัวอย่างข้อความจากคำตอบของ AI</p>
      <ul className="space-y-2">
        {quotes.map((q, i) => {
          const target = onOpenAnswer ? quoteTarget(q) : null;
          return (
            <li key={`${q.responseId}-${i}`} className="border-l-2 border-gray-200 pl-2 text-xs text-gray-700">
              <span className="break-words">&ldquo;{q.text}&rdquo;</span>
              {q.approx ? <span className="mt-0.5 block text-[11px] text-gray-500">{APPROX_NOTE}</span> : null}
              {target && onOpenAnswer ? (
                <button type="button" onClick={() => onOpenAnswer(target)} className="mt-0.5 block text-[11px] text-brand-blue hover:underline">ดูคำตอบเต็ม</button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A ranked-list row; with quotes the whole head becomes a button that opens the example passages */
function ExampleRow({ head, bar, quotes, onOpenAnswer }: { head: ReactNode; bar: ReactNode; quotes?: InsightQuote[]; onOpenAnswer?: (target: ViewerTarget) => void }) {
  const [open, setOpen] = useState(false);
  const has = !!quotes && quotes.length > 0;
  if (!has) {
    return (
      <li>
        {head}
        <div className="mt-1">{bar}</div>
      </li>
    );
  }
  return (
    <li>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="block w-full rounded-lg text-left hover:bg-gray-50">
        <span className="flex items-start gap-1">
          {open ? <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" /> : <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />}
          <span className="block min-w-0 flex-1">
            {head}
            <span className="mt-1 block">{bar}</span>
          </span>
        </span>
      </button>
      {open && quotes ? <QuoteList quotes={quotes} onOpenAnswer={onOpenAnswer} /> : null}
    </li>
  );
}

const TYPES_SHOWN = 8;

/** "ประเภท": the short labels the AI gives the brand, ranked like the factor list */
function DescriptorList({ items, onOpenAnswer }: { items: InsightEntityDTO["descriptors"]; onOpenAnswer?: (target: ViewerTarget) => void }) {
  const [all, setAll] = useState(false);
  const max = items.reduce((m, d) => Math.max(m, d.answers ?? 0), 0);
  const shown = all ? items : items.slice(0, TYPES_SHOWN);
  const anyQuote = items.some((d) => (d.quotes?.length ?? 0) > 0);
  return (
    <div className="mt-4">
      <SectionTitle hint="AI มองแบรนด์เราเป็นแบบไหน (ป้ายสั้น ๆ ที่ AI ใช้เรียกแบรนด์)">ประเภท</SectionTitle>
      <ul className="space-y-2.5">
        {shown.map((d) => (
          <ExampleRow
            key={d.text}
            quotes={d.quotes}
            onOpenAnswer={onOpenAnswer}
            head={
              <span className="flex items-start justify-between gap-3 text-xs text-gray-700">
                <span className="min-w-0 break-words">{d.text}</span>
                <span className="shrink-0 tabular-nums text-gray-500">{fmtNum(d.answers)} คำตอบ</span>
              </span>
            }
            bar={
              <span className="block h-2 rounded-full bg-gray-100">
                <span className="block h-2 rounded-full bg-brand-blue" style={{ width: `${pctWidth(d.answers ?? 0, max)}%`, minWidth: (d.answers ?? 0) > 0 ? 2 : 0 }} />
              </span>
            }
          />
        ))}
      </ul>
      {items.length > TYPES_SHOWN ? (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 text-xs text-brand-blue hover:underline">{all ? "ย่อ" : `ดูเพิ่ม (${fmtNum(items.length - TYPES_SHOWN)})`}</button>
      ) : null}
      {!anyQuote ? <p className="mt-2 text-[11px] text-gray-500">{NO_QUOTE_HINT}</p> : null}
    </div>
  );
}

function BrandBlock({ e, onOpenAnswer }: { e: InsightEntityDTO; onOpenAnswer?: (target: ViewerTarget) => void }) {
  const positioning = e.positioning ?? [];
  const factors = e.factors ?? [];
  const descriptors = e.descriptors ?? [];
  const summaries = (e.summaries ?? []).slice(0, 3);
  return (
    <div className="rounded-2xl border border-gray-100 bg-white/80 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-brand-navy">{e.name}</span>
        <Chip tone="ok">{fmtNum(e.answers)} คำตอบ</Chip>
      </div>
      <ToneBar tones={e.tones} total={e.answers} />
      {positioning.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {positioning.map((p) => (
            <Chip key={p.code} tone="info">{p.label || BRAND_POSITIONING_LABEL[p.code] || p.code} {fmtNum(p.answers)}</Chip>
          ))}
        </div>
      ) : null}
      {factors.length > 0 ? (
        <div className="mt-4">
          <p className="mb-1.5 flex flex-wrap items-center gap-3 text-[11px] text-gray-500">
            <span className="font-medium text-gray-600">ปัจจัยที่ AI พูดถึงแบรนด์</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" />บวก</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-gray-400" />กลาง</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" />ลบ</span>
          </p>
          <ul className="space-y-2.5">
            {factors.map((f) => (
              <ExampleRow
                key={f.code}
                quotes={f.quotes}
                onOpenAnswer={onOpenAnswer}
                head={
                  <span className="flex items-start justify-between gap-3 text-xs text-gray-700">
                    <span className="min-w-0">{f.label || f.code}</span>
                    <span className="shrink-0 tabular-nums text-gray-500">
                      <span className="text-emerald-600">+{fmtNum(f.positive)}</span> · {fmtNum(f.neutral)} · <span className="text-red-600">−{fmtNum(f.negative)}</span>
                    </span>
                  </span>
                }
                bar={<FactorSplit positive={f.positive ?? 0} neutral={f.neutral ?? 0} negative={f.negative ?? 0} />}
              />
            ))}
          </ul>
        </div>
      ) : null}
      {descriptors.length > 0 ? <DescriptorList items={descriptors} onOpenAnswer={onOpenAnswer} /> : null}
      {summaries.length > 0 ? (
        <ul className="mt-4 space-y-1.5">
          {summaries.map((s, i) => (
            <li key={i} className="border-l-2 border-gray-200 pl-2 text-xs italic text-gray-600">&ldquo;{s}&rdquo;</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Compact competitor card; the details (factors, quotes) stay collapsed until asked for */
function CompetitorCard({ e }: { e: InsightEntityDTO }) {
  const [open, setOpen] = useState(false);
  const dom = dominantTone(e.tones);
  const positioning = (e.positioning ?? []).slice(0, 3);
  const factors = e.factors ?? [];
  const summaries = (e.summaries ?? []).slice(0, 1);
  const hasDetail = factors.length > 0 || summaries.length > 0;
  return (
    <div className="rounded-2xl border border-gray-100 bg-white/80 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="min-w-0 truncate text-sm font-semibold text-brand-navy" title={e.name}>{e.name}</span>
        {dom ? <Chip tone={TONE_CHIP[dom]}>{SENTIMENT_TONE_LABEL[dom]}</Chip> : null}
        <span className="text-[11px] text-gray-500">{fmtNum(e.answers)} คำตอบ</span>
      </div>
      <ToneBar tones={e.tones} total={e.answers} legend={false} />
      {positioning.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {positioning.map((p) => <Chip key={p.code} tone="info">{p.label || BRAND_POSITIONING_LABEL[p.code] || p.code}</Chip>)}
        </div>
      ) : null}
      {hasDetail ? (
        <>
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-2 inline-flex items-center gap-1 text-xs text-brand-blue hover:underline">
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {open ? "ซ่อนรายละเอียด" : "ดูรายละเอียด"}
          </button>
          {open ? (
            <div className="mt-2 space-y-2">
              {factors.slice(0, 5).map((f) => (
                <div key={f.code}>
                  <div className="flex justify-between gap-2 text-[11px] text-gray-600">
                    <span className="min-w-0 truncate">{f.label || f.code}</span>
                    <span className="shrink-0 tabular-nums">{fmtNum(f.answers)}</span>
                  </div>
                  <FactorSplit positive={f.positive ?? 0} neutral={f.neutral ?? 0} negative={f.negative ?? 0} />
                </div>
              ))}
              {summaries.map((s, i) => (
                <p key={i} className="border-l-2 border-gray-200 pl-2 text-xs italic text-gray-600">&ldquo;{s}&rdquo;</p>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** Row 4: "Brand Sentiment: AI มองแบรนด์ยังไง" — full width, has an id so other cards can scroll to it */
export function SentimentSection({ insight, clientView, onOpenAnswer }: { insight: AnswerInsightDTO | undefined; clientView?: boolean; onOpenAnswer?: (target: ViewerTarget) => void }) {
  const ready = !!insight && insight.available !== false && (insight.analyzed ?? 0) > 0;
  if (!ready || !insight) {
    return (
      <div id={SENTIMENT_SECTION_ID} className="scroll-mt-20">
        <Panel title="Brand Sentiment: AI มองแบรนด์ยังไง">
          <p className="rounded-xl bg-gray-50 px-3 py-3 text-sm text-gray-500">
            {insight && insight.available === false
              ? (clientView ? "ยังไม่มีข้อมูล Brand Sentiment ในช่วงเวลานี้" : "ยังไม่เปิดใช้ (รอสร้างตารางในฐานข้อมูล)")
              : "ยังไม่มีข้อมูล Brand Sentiment — ระบบจะเริ่มวิเคราะห์อัตโนมัติในการสแกนรอบถัดไป"}
          </p>
        </Panel>
      </div>
    );
  }
  const entities = insight.entities ?? [];
  const brand = entities.find((e) => e.entityType === "brand");
  const competitors = entities.filter((e) => e.entityType === "competitor").slice(0, 4);
  const factors = insight.factors ?? [];
  const overallTotal = SENTIMENT_TONES.reduce((s, t) => s + (insight.overallTones?.[t] ?? 0), 0);
  return (
    <div id={SENTIMENT_SECTION_ID} className="scroll-mt-20">
      <Panel title="Brand Sentiment: AI มองแบรนด์ยังไง" subtitle={`วิเคราะห์จาก ${fmtNum(insight.analyzed)} คำตอบ`}>
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)]">
          <div>
            <SectionTitle hint="สัดส่วนคำตอบที่พูดถึงปัจจัยนั้น">AI ให้น้ำหนักกับอะไร</SectionTitle>
            {factors.length === 0 ? <p className="text-xs text-gray-500">ยังไม่มีข้อมูล</p> : (
              <ul className="space-y-2.5">
                {factors.slice(0, 8).map((f) => (
                  <ExampleRow
                    key={f.code}
                    quotes={brand?.factors?.find((x) => x.code === f.code)?.quotes}
                    onOpenAnswer={onOpenAnswer}
                    head={
                      <span className="flex items-start justify-between gap-3 text-xs text-gray-700">
                        <span className="min-w-0">{f.label || f.code}</span>
                        <span className="shrink-0 tabular-nums"><b className="text-brand-navy">{fmtNum(f.answers)}</b> <span className="text-gray-500">({f.rate === null || f.rate === undefined ? "—" : fmtPct(f.rate, 0)})</span></span>
                      </span>
                    }
                    bar={
                      <span className="block h-2 rounded-full bg-gray-100">
                        <span className="block h-2 rounded-full bg-brand-blue" style={{ width: `${Math.min(100, Math.max(0, (f.rate ?? 0) * 100))}%`, minWidth: (f.rate ?? 0) > 0 ? 2 : 0 }} />
                      </span>
                    }
                  />
                ))}
              </ul>
            )}
          </div>
          <div>
            <SectionTitle>แบรนด์เรา</SectionTitle>
            {brand ? <BrandBlock e={brand} onOpenAnswer={onOpenAnswer} /> : <p className="text-xs text-gray-500">AI ยังไม่ได้พูดถึงแบรนด์เราในคำตอบที่วิเคราะห์</p>}
          </div>
          <div>
            <SectionTitle>คู่แข่ง</SectionTitle>
            {competitors.length === 0 ? <p className="text-xs text-gray-500">ยังไม่มีคู่แข่งที่ AI พูดถึงในคำตอบที่วิเคราะห์</p> : (
              <div className="space-y-3">
                {competitors.map((e) => <CompetitorCard key={e.key} e={e} />)}
              </div>
            )}
          </div>
        </div>
        <div className="mt-5 border-t border-gray-100 pt-4">
          <SectionTitle>โทนโดยรวมทุกแบรนด์</SectionTitle>
          <ToneBar tones={insight.overallTones} total={overallTotal} />
        </div>
      </Panel>
    </div>
  );
}

/** Footnote: which platforms expose their search queries and which do not */
function supportNote(clientView?: boolean): string {
  const exposed = Object.entries(SEARCH_QUERY_SUPPORT);
  const names = (kind: string) => exposed.filter(([, v]) => v === kind).map(([k]) => providerLabelFor(k, clientView));
  return [
    names("exposed").length ? `${names("exposed").join(" และ ")} ส่งคำค้นกลับมาให้` : "",
    names("prompt").length ? `${names("prompt").join(" / ")} ใช้คำถามเป็นคำค้นโดยตรง` : "",
    names("hidden").length ? "บาง platform ไม่เปิดเผยคำค้น" : "",
  ].filter(Boolean).join(" · ");
}

function QueryGroupRow({ g, max }: { g: QueryGroupDTO; max: number }) {
  const [open, setOpen] = useState(false);
  const prompts = g.prompts ?? [];
  const queries = g.queries ?? [];
  return (
    <li>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="block min-h-[36px] w-full rounded-lg px-1 py-1.5 text-left hover:bg-gray-50">
        <div className="flex items-center justify-between gap-3 text-sm text-gray-700">
          <span className="flex min-w-0 items-center gap-1">
            {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-400" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-400" />}
            <span className="min-w-0 truncate" title={g.group}>{g.group}</span>
          </span>
          <b className="shrink-0 tabular-nums text-brand-navy">{fmtNum(g.searches)}</b>
        </div>
        <div className="mt-1 h-1.5 rounded-full bg-gray-100">
          <div className="h-1.5 rounded-full bg-brand-blue" style={{ width: `${max > 0 ? Math.min(100, (g.searches / max) * 100) : 0}%`, minWidth: g.searches > 0 ? 2 : 0 }} />
        </div>
      </button>
      {open ? (
        <div className="mb-2 ml-4 mt-1 space-y-2 border-l border-gray-100 pl-3">
          {prompts.length > 0 ? (
            <div>
              <p className="text-[11px] font-medium text-gray-600">คำถามที่ทำให้ AI ค้นหา</p>
              <ul className="mt-0.5 space-y-0.5">
                {prompts.slice(0, 5).map((p) => (
                  <li key={p.promptId} className="flex justify-between gap-2 text-xs text-gray-700">
                    <span className="min-w-0 break-words">{p.text}</span>
                    <span className="shrink-0 tabular-nums text-gray-500">{fmtNum(p.searches)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {queries.length > 0 ? (
            <div>
              <p className="text-[11px] font-medium text-gray-600">คำค้นจริง</p>
              <ul className="mt-0.5 space-y-0.5">
                {queries.slice(0, 8).map((q, i) => (
                  <li key={`${q.query}-${i}`} className="flex justify-between gap-2 text-[11px] text-gray-500">
                    <span className="min-w-0 break-words">{q.query}</span>
                    <span className="shrink-0 tabular-nums">{fmtNum(q.searches)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {prompts.length === 0 && queries.length === 0 ? <p className="text-xs text-gray-500">ไม่มีรายละเอียด</p> : null}
        </div>
      ) : null}
    </li>
  );
}

/** Row 3b: "Search Query Groups" — what the AI searched before answering, grouped by topic */
export function QueryGroupsCard({ insight, clientView }: { insight: AnswerInsightDTO | undefined; clientView?: boolean }) {
  const [all, setAll] = useState(false);
  const groups = insight?.queryGroups ?? [];
  const shown = all ? groups : groups.slice(0, 8);
  const max = groups.reduce((m, g) => Math.max(m, g.searches ?? 0), 0);
  return (
    <Panel
      title="Search Query Groups"
      subtitle="AI เอาอะไรไป search ก่อนตอบ"
      actions={groups.length > 8 ? <Button size="sm" variant="outline" onClick={() => setAll((v) => !v)}>{all ? "ย่อ" : "ดูทั้งหมด"}</Button> : undefined}
      className="h-full"
    >
      {groups.length === 0 ? (
        <p className="rounded-xl bg-gray-50 px-3 py-3 text-sm text-gray-500">ยังไม่มีข้อมูลคำค้น — จะเริ่มเก็บในการสแกนรอบถัดไป</p>
      ) : (
        <ul className="space-y-0.5">
          {shown.map((g) => <QueryGroupRow key={g.group} g={g} max={max} />)}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-gray-500">
        {insight && (insight.answersWithQueries ?? 0) > 0 ? `${fmtNum(insight.answersWithQueries)} คำตอบมีข้อมูลคำค้น · ` : ""}
        {supportNote(clientView)}
      </p>
    </Panel>
  );
}
