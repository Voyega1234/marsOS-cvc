"use client";

/**
 * Brand Radar — "AI Responses" tab: the real answers, filterable and searchable.
 * The dashboard (visibility, sentiment, search query groups) lives on the Overview tab.
 * All API text is untrusted and rendered as React text nodes only.
 */
import { useEffect, useState } from "react";
import { Radar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip, EmptyState, KpiTile, Panel, SearchPill, Segmented } from "@/components/ds";
import type { ChipTone } from "@/components/ds";
import {
  ANSWER_KINDS, ANSWER_MENTION_FILTERS, BRAND_POSITIONING_LABEL, SENTIMENT_TONE_LABEL,
  answerKind, type AnswerFeedDTO, type AnswerFeedItem, type AnswerKind, type AnswerMentionFilter,
  type MentionStyleCounts, type SentimentTone,
} from "@/lib/brand-radar/types";
import { ProviderLogo } from "./ProviderLogo";
import { ANSWER_ZONE_LEGEND, fmtNum, fmtPct, INSUFFICIENT, NO_DATA_MESSAGE, fmtZoneShare, providerLabelFor, radarQuery, type TabProps } from "./shared";
import { LoadState, Pager, useApiData } from "./PromptDialogs";
import ResponseViewer, { AnswerBody, type ViewerTarget } from "./ResponseViewer";

const PAGE_SIZE = 10;

export const KIND_LABEL: Record<AnswerKind, string> = {
  both: "Mention + Citation",
  mention_only: "Mention อย่างเดียว (ชื่ออย่างเดียว ไม่แนบลิงก์)",
  citation_only: "Citation อย่างเดียว (อ้างอิงเว็บ ไม่เอ่ยชื่อ)",
  none: "ไม่พูดถึงเรา",
};
export const KIND_SHORT: Record<AnswerKind, string> = {
  both: "Mention + Citation",
  mention_only: "Mention อย่างเดียว",
  citation_only: "Citation อย่างเดียว",
  none: "ไม่พูดถึงเรา",
};
export const KIND_COLOR: Record<AnswerKind, string> = {
  both: "bg-emerald-500",
  mention_only: "bg-brand-blue",
  citation_only: "bg-sky-400",
  none: "bg-gray-300",
};
export const KIND_TONE: Record<AnswerKind, ChipTone> = { both: "ok", mention_only: "info", citation_only: "info", none: "muted" };

const FILTER_LABEL: Record<AnswerMentionFilter, string> = {
  all: "ทั้งหมด",
  both: KIND_SHORT.both,
  mention_only: KIND_SHORT.mention_only,
  citation_only: KIND_SHORT.citation_only,
  none: KIND_SHORT.none,
  competitor_only: "พูดถึงแต่คู่แข่ง",
};

const TONE_CHIP: Record<SentimentTone, ChipTone> = { positive: "ok", neutral: "muted", mixed: "warn", negative: "bad" };

function safeUrl(u: string): boolean {
  return /^https?:\/\//i.test(u);
}

// ── Answer card ──────────────────────────────────────────────────────────────

export function AnswerCard({ item, onOpen, clientView }: { item: AnswerFeedItem; onOpen: (t: ViewerTarget) => void; clientView?: boolean }) {
  const a = item.answer;
  const ms: MentionStyleCounts = item.mentionStyle ?? { recommended: 0, compared: 0, listed: 0, first: 0, zones: { early: 0, middle: 0, late: 0 } };
  const kinds = item.kinds ?? { both: 0, mention_only: 0, citation_only: 0, none: 0 };
  const brandMention = a?.mentions?.find((m) => m.entityType === "brand");
  const brandSentiment = a?.sentiment?.entities?.find((e) => e.entityType === "brand");
  const ownLinks = (a?.citations ?? []).filter((c) => c.ownerType === "own");
  const queries = a?.searchQueries ?? [];
  const kind = a ? answerKind(a.brandMentioned, a.ownedCited) : null;
  const styleChips: Array<[string, number]> = [
    ["แนะนำ", ms.recommended], ["เปรียบเทียบ", ms.compared], ["เอ่ยชื่อเฉย ๆ", ms.listed], ["ชื่อแรก", ms.first],
  ];
  return (
    <div className="rounded-2xl border border-gray-100 bg-white/80 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <ProviderLogo provider={item.provider} title={(!clientView && item.providerLabel) || providerLabelFor(item.provider, clientView)} />
        {kind ? <Chip tone={KIND_TONE[kind]}>{KIND_SHORT[kind]}</Chip> : null}
        {item.topic ? <Chip tone="muted">{item.topic}</Chip> : null}
      </div>
      <p className="mt-2 break-words text-sm font-semibold text-brand-navy">{item.promptText}</p>
      <p className="mt-1 text-xs text-gray-600">
        ขึ้น <b>{fmtNum(item.mentioned)}</b> จาก <b>{fmtNum(item.asked)}</b> ครั้งที่ถาม ({fmtPct(item.mentionRate)}) · ชื่อปรากฏ {fmtNum(item.occurrences)} ครั้ง
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {ANSWER_KINDS.filter((k) => (kinds[k] ?? 0) > 0).map((k) => <Chip key={k} tone={KIND_TONE[k]}>{KIND_SHORT[k]} {kinds[k]}</Chip>)}
        {styleChips.filter(([, n]) => n > 0).map(([l, n]) => <Chip key={l} tone="muted">{l} {n}</Chip>)}
      </div>

      {!a ? (
        <p className="mt-3 text-sm text-gray-500">ไม่มีคำตอบให้แสดง</p>
      ) : (
        <>
          {brandMention?.snippet ? (
            <blockquote className="mt-3 border-l-2 border-amber-300 bg-amber-50/60 px-3 py-1.5 text-xs text-gray-700">{brandMention.snippet}</blockquote>
          ) : null}
          {queries.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-gray-600">
              <span>AI ค้นหาด้วยคำว่า:</span>
              {queries.map((q, i) => <Chip key={`${q}-${i}`} tone="info">{q}</Chip>)}
            </div>
          ) : null}
          {brandSentiment ? (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-gray-700">
              <Chip tone={TONE_CHIP[brandSentiment.tone] ?? "muted"}>{SENTIMENT_TONE_LABEL[brandSentiment.tone] ?? brandSentiment.tone}</Chip>
              {(brandSentiment.positioning ?? []).map((p) => <Chip key={p} tone="muted">{BRAND_POSITIONING_LABEL[p] ?? p}</Chip>)}
              {brandSentiment.summary ? <span className="text-gray-600">{brandSentiment.summary}</span> : null}
            </div>
          ) : null}
          {ownLinks.length > 0 ? (
            <div className="mt-3 text-xs text-gray-600">
              <span>ลิงก์เว็บเราที่ AI อ้าง:</span>
              <ul className="mt-1 space-y-0.5">
                {ownLinks.map((c, i) => (
                  <li key={`${c.url}-${i}`} className="min-w-0 truncate">
                    {safeUrl(c.url) ? (
                      <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-brand-blue hover:underline" title={c.url}>{c.title || c.url}</a>
                    ) : <span>{c.title || c.url}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {(item.competitors ?? []).length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-gray-600">
              <span>คู่แข่งที่ถูกเอ่ย:</span>
              {item.competitors.map((c) => <Chip key={c.key} tone="warn">{c.name} · {c.answers}</Chip>)}
            </div>
          ) : null}
          <div className="relative mt-3 max-h-[11.5rem] overflow-hidden rounded-xl bg-gray-50/70 px-3 py-1">
            <AnswerBody response={a} className="text-[13px] leading-6" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-gray-50 to-transparent" />
          </div>
          <div className="mt-3">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onOpen({ promptId: item.promptId, provider: item.provider, runId: a.runId, responseId: a.id })}
            >
              ดูคำตอบเต็ม / ทุกครั้งที่ถาม
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Main tab ─────────────────────────────────────────────────────────────────

export default function AnswersTab({ projectId, filters, refreshKey, onGoTab, clientView }: TabProps) {
  const [mention, setMention] = useState<AnswerMentionFilter>("all");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [viewing, setViewing] = useState<ViewerTarget | null>(null);

  // new project or filters: back to page 1, close the viewer
  useEffect(() => { setPage(1); setViewing(null); }, [projectId, filters]);

  // debounce the search box (300 ms)
  useEffect(() => {
    const t = window.setTimeout(() => {
      setQ(search);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const url = `/api/brand-radar/responses?${radarQuery(projectId, filters, { mention: mention === "all" ? "" : mention, q: q.trim(), page, pageSize: PAGE_SIZE })}`;
  const { data, loading, error, reload } = useApiData<AnswerFeedDTO>(url, refreshKey, true);

  if (!data) {
    return <Panel><LoadState loading={loading} error={error} onRetry={reload} clientView={clientView} /></Panel>;
  }
  if (!data.configured) {
    return (
      <Panel>
        <EmptyState
          icon={<Radar className="h-6 w-6" />}
          title={clientView ? "ยังไม่มีข้อมูลรายงานสำหรับแบรนด์นี้" : "ยังไม่ได้ตั้งค่าแบรนด์"}
          description={clientView ? undefined : "ตั้งชื่อแบรนด์ โดเมน และ AI platform ที่จะติดตามที่แท็บ Settings ก่อน"}
          action={clientView ? undefined : <Button onClick={() => onGoTab("settings")}>ไปที่ Settings</Button>}
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
          description={clientView ? "ลองเปลี่ยนช่วงเวลาหรือตัวกรอง หรือรอผลการสแกนรอบถัดไป" : "ตรวจว่าเชื่อมต่อ AI platform แล้วและมี Prompt ที่ใช้งาน จากนั้นกด Run scan now"}
          action={clientView ? undefined : <Button onClick={() => onGoTab("settings")}>Settings</Button>}
        />
      </Panel>
    );
  }

  const t = data.totals;

  return (
    <div className={`space-y-4 ${loading ? "opacity-70" : ""}`}>
      {/* Short totals strip (the full dashboard lives on the Overview tab) */}
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4">
        <KpiTile label="AI ตอบทั้งหมด" value={`${fmtNum(t.asked)} คำตอบ`} tone="plain" footer={<span className="text-xs text-gray-500">จาก {fmtNum(t.prompts)} คำถาม</span>} />
        <KpiTile label="Mention (พูดถึงแบรนด์เรา)" value={`${fmtNum(t.mentioned)} ครั้ง`} tone="sky" footer={<span className="text-xs text-gray-500">{fmtPct(t.mentionRate)}</span>} />
        <KpiTile label="Citation (อ้างอิงเว็บเรา)" value={`${fmtNum(t.ownedCited)} ครั้ง`} tone="mist" footer={<span className="text-xs text-gray-500">{fmtPct(t.citationRate)}</span>} />
        <KpiTile
          label="ลำดับที่ถูกเอ่ยถึงเฉลี่ย"
          value={t.avgPosition === null || t.avgPosition === undefined ? INSUFFICIENT : t.avgPosition.toFixed(1)}
          tone="plain"
          hint={`1 = ถูกเอ่ยเป็นชื่อแรก · ตำแหน่งในคำตอบ: ${fmtZoneShare(t.mentionStyle?.zones) ?? "ยังไม่มีข้อมูล"} (${ANSWER_ZONE_LEGEND})`}
        />
      </div>

      {/* Real answers */}
      <Panel title="คำตอบจริงจาก AI" subtitle="คำถามแต่ละข้อ × AI แต่ละตัว พร้อมตัวอย่างคำตอบ 1 ชิ้น">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="max-w-full overflow-x-auto"><Segmented<AnswerMentionFilter>
            size="sm"
            ariaLabel="กรองประเภทคำตอบ"
            value={mention}
            onChange={(v) => { setMention(v); setPage(1); }}
            options={ANSWER_MENTION_FILTERS.map((f) => ({ value: f, label: FILTER_LABEL[f], count: data.counts?.[f] ?? 0 }))}
          /></div>
          <SearchPill value={search} onChange={setSearch} placeholder="ค้นหาคำถามหรือคำตอบ" className="w-full sm:w-72" />
        </div>
        {error ? <p role="alert" className="mb-3 rounded-xl bg-red-50 p-2 text-xs text-red-700">{error}</p> : null}
        {data.items.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">ไม่มีคำตอบให้แสดง</p>
        ) : (
          <div className="space-y-3">
            {data.items.map((it) => <AnswerCard key={`${it.promptId}-${it.provider}`} item={it} onOpen={setViewing} clientView={clientView} />)}
          </div>
        )}
        <Pager page={data.page ?? page} pageSize={data.pageSize ?? PAGE_SIZE} total={data.total ?? 0} onPage={setPage} />
      </Panel>

      <ResponseViewer clientView={clientView} projectId={projectId} filters={filters} target={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}
