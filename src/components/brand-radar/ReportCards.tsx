"use client";

/**
 * Brand Radar — small cards of the Overview dashboard (row 3 and row 5):
 * answer kinds / platforms, top competitors, sources, latest answers.
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

/** 3c: brand row first (highlighted), then top 5 competitors */
export function TopCompetitorsCard({ dto, onGoTab }: { dto: Dto; onGoTab: (t: TabId) => void }) {
  const entities = dto.entities ?? [];
  const brand = entities.filter((e) => e.entityType === "brand");
  const comps = entities.filter((e) => e.entityType === "competitor").slice(0, 5);
  const rows = [...brand, ...comps];
  return (
    <Panel
      title="Top Competitors"
      className="h-full"
      actions={<Button size="sm" variant="outline" onClick={() => onGoTab("competitors")}>ดูทั้งหมด</Button>}
    >
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500">ยังไม่มีข้อมูล</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[320px] text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500">
                <th className="py-1.5 pr-2 font-medium">#</th>
                <th className="py-1.5 pr-3 font-medium">ชื่อ</th>
                <th className="py-1.5 pr-3 text-right font-medium">Visibility</th>
                <th className="py-1.5 pr-3 text-right font-medium">เปลี่ยนแปลง</th>
                <th className="py-1.5 text-right font-medium">อันดับเฉลี่ย</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e, i) => (
                <tr key={e.key} className={`border-t border-gray-100 ${e.entityType === "brand" ? "bg-brand-mist/60 font-medium" : ""}`}>
                  <td className="py-2 pl-1 pr-2 tabular-nums text-gray-500">{i + 1}</td>
                  <td className="max-w-[10rem] truncate py-2 pr-3 text-gray-800" title={e.name}>{e.name}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{pct(e.mentionRate)}</td>
                  <td className="py-2 pr-3 text-right"><ChangeText c={dto.entityChange?.[e.key] ?? null} /></td>
                  <td className="py-2 text-right tabular-nums">{e.avgPosition === null || e.avgPosition === undefined ? "—" : e.avgPosition.toFixed(1)}
                    {fmtZoneShare(e.zones) && <span className="block text-[11px] font-normal text-gray-500" title={ANSWER_ZONE_LEGEND}>{fmtZoneShare(e.zones)}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/** 3d: websites the answers cite */
export function SourcesCard({ dto, onGoTab }: { dto: Dto; onGoTab: (t: TabId) => void }) {
  const sources = (dto.sources ?? []).slice(0, 8);
  return (
    <Panel
      title="Sources"
      subtitle="เว็บที่ AI อ้างอิงในคำตอบ"
      className="h-full"
      actions={<Button size="sm" variant="outline" onClick={() => onGoTab("citations")}>ดูทั้งหมด</Button>}
    >
      {sources.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500">ยังไม่มีข้อมูล</p>
      ) : (
        <ul className="space-y-2.5">
          {sources.map((s) => (
            <li key={`${s.domain}-${s.ownerType}`}>
              <div className="flex items-center justify-between gap-2 text-sm text-gray-700">
                <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="min-w-0 max-w-full truncate" title={s.domain}>{s.domain}</span>
                  {s.ownerType === "own" ? <Chip tone="ok">เว็บเรา</Chip>
                    : s.ownerType === "competitor" ? <Chip tone="warn">{s.competitorName ? `คู่แข่ง: ${s.competitorName}` : "คู่แข่ง"}</Chip>
                    : <Chip tone="muted">อื่น ๆ</Chip>}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-gray-500">Citation <b className="text-brand-navy">{pct(s.rate)}</b></span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-gray-100">
                <div className={`h-1.5 rounded-full ${s.ownerType === "own" ? "bg-emerald-500" : s.ownerType === "competitor" ? "bg-amber-400" : "bg-gray-400"}`} style={{ width: `${Math.min(100, (s.rate ?? 0) * 100)}%`, minWidth: (s.rate ?? 0) > 0 ? 2 : 0 }} />
              </div>
            </li>
          ))}
        </ul>
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
                <th className="py-1.5 pr-3 font-medium">คำถาม</th>
                <th className="py-1.5 pr-3 font-medium">Platform</th>
                <th className="py-1.5 pr-3 font-medium">พูดถึงเรา</th>
                <th className="py-1.5 pr-3 font-medium">แบรนด์ที่ถูกพูดถึง</th>
                <th className="py-1.5 pr-3 font-medium">ประเภท</th>
                <th className="py-1.5 font-medium">วันที่</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const a = it.answer;
                const open = () => { if (a) onOpen({ promptId: it.promptId, provider: it.provider, runId: a.runId, responseId: a.id }); };
                const kind = a ? answerKind(a.brandMentioned, a.ownedCited) : null;
                const names = [...(it.mentioned > 0 ? [dto.brandName || "แบรนด์เรา"] : []), ...(it.competitors ?? []).map((c) => c.name)];
                return (
                  <tr key={`${it.promptId}-${it.provider}`} onClick={open} className={`border-t border-gray-100 ${a ? "cursor-pointer hover:bg-gray-50" : ""}`}>
                    <td className="max-w-[18rem] py-2 pr-3">
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
