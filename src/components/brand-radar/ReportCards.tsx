"use client";

/**
 * Brand Radar — cards of the Overview dashboard:
 * answer kinds / platforms, the competitor ranking table, the sources table, latest answers.
 * Table headings carry a 2-second hover help (ColumnHelp).
 * All API text is untrusted: rendered as React text nodes only; only http(s) values become links.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Chip, Panel, Segmented, StackedBar } from "@/components/ds";
import { ANSWER_KINDS, answerKind, type AnswerFeedDTO, type AnswerKind } from "@/lib/brand-radar/types";
import { ProviderLogo } from "./ProviderLogo";
import { ANSWER_ZONE_LEGEND, fmtDate, fmtNum, fmtZoneShare, providerLabelFor, type TabId } from "./shared";
import type { ViewerTarget } from "./ResponseViewer";
import { KIND_SHORT, KIND_TONE } from "./AnswersTab";
import { INSIGHT_LIMITS } from "@/lib/brand-radar/insight";
import { BrandLogo, domainFavicon } from "./BrandLogo";
import { ColumnHelp } from "./ColumnHelp";
import type { BrandOpt } from "./ReportDossier";

type Dto = AnswerFeedDTO;

/** a rate (fraction) as "12.3%"; null/undefined = "—" (never 0) */
export function pct(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(digits)}%`;
}

/** change in points: 0.05 -> "+5.0 จุด"; null = "N/A" */
export function fmtChange(c: number | null | undefined): string {
  if (c === null || c === undefined || !Number.isFinite(c)) return "N/A";
  const p = c * 100;
  return `${p > 0 ? "+" : ""}${p.toFixed(1)} จุด`;
}

export function ChangeText({ c }: { c: number | null | undefined }) {
  const known = c !== null && c !== undefined && Number.isFinite(c);
  const cls = !known || c === 0 ? "text-gray-500" : (c as number) > 0 ? "text-emerald-600" : "text-red-600";
  return <span className={`tabular-nums ${cls}`}>{fmtChange(c)}</span>;
}

const KIND_HEX: Record<AnswerKind, string> = { both: "#10b981", mention_only: "#1d48f3", citation_only: "#38bdf8", none: "#d1d5db" };

/** 3a: how the answers look (kinds) or per-platform mention rates */
export function AnswerBreakdownCard({ dto, clientView }: { dto: Dto; clientView?: boolean }) {
  const [view, setView] = useState<"kinds" | "platform">("kinds");
  const kinds = dto.totals?.kinds;
  const providers = dto.byProvider ?? [];
  return (
    <Panel
      title="คำตอบเป็นแบบไหน"
      className="h-full"
      actions={
        <Segmented<"kinds" | "platform">
          size="sm"
          ariaLabel="เลือกมุมมอง"
          value={view}
          onChange={setView}
          options={[{ value: "kinds", label: "ประเภทคำตอบ" }, { value: "platform", label: "Platform" }]}
        />
      }
    >
      {view === "kinds" ? (
        <StackedBar
          ariaLabel="ประเภทคำตอบ"
          formatValue={fmtNum}
          segments={ANSWER_KINDS.map((k) => ({ label: KIND_SHORT[k], value: kinds?.[k] ?? 0, color: KIND_HEX[k] }))}
        />
      ) : providers.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500">ยังไม่มีข้อมูล</p>
      ) : (
        <ul className="space-y-3">
          {providers.map((p) => (
            <li key={p.provider}>
              <div className="flex items-center justify-between gap-3 text-sm text-gray-700">
                <ProviderLogo className="min-w-0" provider={p.provider} withName title={(!clientView && p.label) || providerLabelFor(p.provider, clientView)} />
                <span className="shrink-0 text-xs tabular-nums text-gray-500">
                  <b className="text-brand-navy">{fmtNum(p.mentioned)}</b> / {fmtNum(p.asked)} ({pct(p.mentionRate, 0)})
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-gray-100">
                <div className="h-1.5 rounded-full bg-brand-blue" style={{ width: `${Math.min(100, (p.mentionRate ?? 0) * 100)}%`, minWidth: (p.mentionRate ?? 0) > 0 ? 2 : 0 }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** change in points as a coloured chip with an arrow; unknown (fewer than 2 days of data) = "—" */
export function ChangeChip({ c }: { c: number | null | undefined }) {
  if (c === null || c === undefined || !Number.isFinite(c)) return <span className="text-gray-400">—</span>;
  const cls = c > 0
    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
    : c < 0
      ? "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300"
      : "bg-gray-100 text-gray-600 dark:bg-white/5 dark:text-gray-300";
  return (
    <span className={`inline-flex items-center gap-0.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${cls}`}>
      <span aria-hidden>{c > 0 ? "▲" : c < 0 ? "▼" : "•"}</span>
      {fmtChange(c)}
    </span>
  );
}

const TH = "py-1.5 pr-3 font-medium";
/** heading row that stays in view while a long table scrolls inside its card */
const STICKY_HEAD = "sticky top-0 z-10 bg-white text-left text-xs text-gray-500 shadow-[0_1px_0_0_rgb(0_0_0/0.06)]";

/** 3c: our brand and every tracked competitor, ranked by Visibility; our brand is highlighted in its real place */
export function TopCompetitorsCard({ dto, onGoTab, brand }: { dto: Dto; onGoTab: (t: TabId) => void; brand?: BrandOpt }) {
  const rows = [...(dto.entities ?? [])].sort((a, b) =>
    (b.mentionRate ?? -1) - (a.mentionRate ?? -1) || b.mentions - a.mentions || a.name.localeCompare(b.name));
  return (
    <Panel
      title="Top Competitors"
      subtitle="แบรนด์เราเทียบกับคู่แข่งที่ติดตาม เรียงจาก Visibility มากไปน้อย"
      className="h-full"
      actions={<Button size="sm" variant="outline" onClick={() => onGoTab("competitors")}>ดูทั้งหมด</Button>}
    >
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500">ยังไม่มีข้อมูล</p>
      ) : (
        <div className="max-h-[28rem] overflow-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className={STICKY_HEAD}>
                <th className="py-1.5 pl-1 pr-2 font-medium"><ColumnHelp k="rank" align="start">#</ColumnHelp></th>
                <th className={TH}><ColumnHelp k="entityName" align="start">Name</ColumnHelp></th>
                <th className={`${TH} text-right`}><ColumnHelp k="visibility" align="end">Visibility %</ColumnHelp></th>
                <th className={`${TH} text-right`}><ColumnHelp k="change" align="end">Change</ColumnHelp></th>
                <th className="py-1.5 text-right font-medium"><ColumnHelp k="avgPositionBoth" align="end">Avg. position</ColumnHelp></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e, i) => {
                const own = e.entityType === "brand";
                const zones = fmtZoneShare(e.zones);
                const hasOrder = e.avgPosition !== null && e.avgPosition !== undefined && Number.isFinite(e.avgPosition);
                return (
                  <tr key={e.key} className={`border-t border-gray-100 align-top ${own ? "bg-brand-mist/60 font-medium" : ""}`}>
                    <td className="py-2.5 pl-1 pr-2 tabular-nums text-gray-500">{i + 1}</td>
                    <td className="py-2 pr-3">
                      <span className="flex min-w-0 items-center gap-2">
                        <BrandLogo
                          name={e.name}
                          logo={own ? brand?.logo : null}
                          favicon={own ? brand?.favicon ?? domainFavicon(dto.entityDomains?.brand) : domainFavicon(dto.entityDomains?.[e.key])}
                          size={24}
                          rounded="rounded-md"
                        />
                        <span className="min-w-0 max-w-[11rem] truncate text-gray-800" title={e.name}>{e.name}</span>
                        {own && <Chip tone="info">แบรนด์เรา</Chip>}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{pct(e.mentionRate)}</td>
                    <td className="py-2.5 pr-3 text-right"><ChangeChip c={dto.entityChange?.[e.key] ?? null} /></td>
                    <td className="py-2.5 text-right tabular-nums">
                      {pct(e.avgPositionPct, 0)}
                      {hasOrder && <span className="block text-[11px] font-normal text-gray-500">ลำดับเฉลี่ย {(e.avgPosition as number).toFixed(1)}</span>}
                      {zones && <span className="block text-[11px] font-normal text-gray-500" title={ANSWER_ZONE_LEGEND}>{zones}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/** 3d: websites the answers cite, most cited first; the card scrolls when the list is long */
export function SourcesCard({ dto, onGoTab }: { dto: Dto; onGoTab: (t: TabId) => void }) {
  const sources = dto.sources ?? [];
  return (
    <Panel
      title="Sources"
      subtitle="เว็บที่ AI อ้างอิงในคำตอบ เรียงจากถูกอ้างอิงบ่อยที่สุด"
      className="h-full"
      actions={<Button size="sm" variant="outline" onClick={() => onGoTab("citations")}>ดูทั้งหมด</Button>}
    >
      {sources.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500">ยังไม่มีข้อมูล</p>
      ) : (
        <>
          <div className="max-h-[28rem] overflow-auto">
            <table className="w-full min-w-[320px] text-sm">
              <thead>
                <tr className={STICKY_HEAD}>
                  <th className={TH}><ColumnHelp k="domain" align="start">Domain</ColumnHelp></th>
                  <th className="w-36 py-1.5 text-right font-medium"><ColumnHelp k="citationShare" align="end">Citation %</ColumnHelp></th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => {
                  const share = Math.min(100, (s.rate ?? 0) * 100);
                  return (
                    <tr key={`${s.domain}-${s.ownerType}`} className={`border-t border-gray-100 ${s.ownerType === "own" ? "bg-emerald-50/60 dark:bg-emerald-500/10" : ""}`}>
                      <td className="py-2 pr-3">
                        <span className="flex min-w-0 flex-wrap items-center gap-2">
                          <BrandLogo name={s.domain} favicon={domainFavicon(s.domain)} size={20} rounded="rounded" />
                          <span className="min-w-0 max-w-[14rem] truncate text-gray-800" title={s.domain}>{s.domain}</span>
                          {s.ownerType === "own" ? <Chip tone="ok">เว็บเรา</Chip>
                            : s.ownerType === "competitor" ? <Chip tone="warn">{s.competitorName ? `คู่แข่ง: ${s.competitorName}` : "คู่แข่ง"}</Chip>
                            : null}
                        </span>
                      </td>
                      <td className="py-2 text-right">
                        <span className="block font-medium tabular-nums text-brand-navy">{pct(s.rate)}</span>
                        <span className="mt-1 block h-1.5 rounded-full bg-gray-100">
                          <span className={`block h-1.5 rounded-full ${s.ownerType === "own" ? "bg-emerald-500" : s.ownerType === "competitor" ? "bg-amber-400" : "bg-gray-400"}`} style={{ width: `${share}%`, minWidth: share > 0 ? 2 : 0 }} />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {sources.length >= INSIGHT_LIMITS.sources && (
            <p className="mt-2 text-xs text-gray-500">แสดง {INSIGHT_LIMITS.sources} เว็บแรก ดูรายการเต็มได้ที่ปุ่ม "ดูทั้งหมด"</p>
          )}
        </>
      )}
    </Panel>
  );
}

/** Row 5: latest answers; clicking a row opens the same answer viewer as the answer cards */
export function LatestAnswersTable({ dto, onOpen, onGoTab, clientView }: { dto: Dto; onOpen: (t: ViewerTarget) => void; onGoTab: (t: TabId) => void; clientView?: boolean }) {
  const items = (dto.items ?? []).slice(0, 8);
  return (
    <Panel
      title="คำตอบล่าสุด"
      actions={<Button size="sm" variant="outline" onClick={() => onGoTab("responses")}>ดูคำตอบทั้งหมด</Button>}
    >
      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500">ไม่มีคำตอบให้แสดง</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500">
                <th className={TH}><ColumnHelp k="promptText" align="start">คำถาม</ColumnHelp></th>
                <th className={TH}><ColumnHelp k="aiPlatform">Platform</ColumnHelp></th>
                <th className={TH}><ColumnHelp k="answerMentioned">พูดถึงเรา</ColumnHelp></th>
                <th className={TH}><ColumnHelp k="answerBrands">แบรนด์ที่ถูกพูดถึง</ColumnHelp></th>
                <th className={TH}><ColumnHelp k="answerKind">ประเภท</ColumnHelp></th>
                <th className="py-1.5 font-medium"><ColumnHelp k="answerDate" align="end">วันที่</ColumnHelp></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const a = it.answer;
                const open = () => { if (a) onOpen({ promptId: it.promptId, provider: it.provider, runId: a.runId, responseId: a.id }); };
                const kind = a ? answerKind(a.brandMentioned, a.ownedCited) : null;
                const names = [...(it.mentioned > 0 ? [dto.brandName || "แบรนด์เรา"] : []), ...(it.competitors ?? []).map((c) => c.name)];
                return (
                  <tr key={`${it.promptId}-${it.provider}`} onClick={open} className={`border-t border-gray-100 ${it.mentioned > 0 ? "bg-emerald-50/60 dark:bg-emerald-500/10" : ""} ${a ? "cursor-pointer hover:bg-gray-50" : ""}`}>
                    <td className={`max-w-[18rem] py-2 pr-3 ${it.mentioned > 0 ? "border-l-4 border-l-emerald-500 pl-2" : ""}`}>
                      <button type="button" disabled={!a} onClick={(e) => { e.stopPropagation(); open(); }} className="block w-full truncate text-left text-gray-800 hover:underline disabled:no-underline" title={it.promptText}>
                        {it.promptText}
                      </button>
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-gray-600"><ProviderLogo provider={it.provider} title={(!clientView && it.providerLabel) || providerLabelFor(it.provider, clientView)} /></td>
                    <td className="py-2 pr-3">{it.mentioned > 0 ? <Chip tone="ok">ใช่</Chip> : <Chip tone="muted">ไม่</Chip>}</td>
                    <td className="max-w-[16rem] py-2 pr-3 text-xs text-gray-600">
                      {names.length === 0 ? "—" : <span title={names.join(", ")}>{names.slice(0, 3).join(", ")}{names.length > 3 ? ` +${names.length - 3}` : ""}</span>}
                    </td>
                    <td className="py-2 pr-3">{kind ? <Chip tone={KIND_TONE[kind]}>{KIND_SHORT[kind]}</Chip> : "—"}</td>
                    <td className="whitespace-nowrap py-2 text-xs text-gray-500">{fmtDate(it.lastCollectedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
