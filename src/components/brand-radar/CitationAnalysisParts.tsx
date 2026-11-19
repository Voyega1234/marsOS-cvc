"use client";

/**
 * Brand Radar — Citation Analysis: the cited-domains table with its drill-down.
 * All API text (domains, URLs, titles, prompt text) is untrusted: rendered as React text only,
 * links only for http(s) URLs.
 */
import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Chip, EmptyState, EntityAvatar, MeterBar, Panel, Segmented, Sparkline } from "@/components/ds";
import { faviconUrl } from "@/lib/backlink-management/project-logos";
import type { AnalysisDomainRow, AnalysisPage, SiteType, WhySignal } from "@/lib/brand-radar/citation-analysis-types";
import { fmtNum, fmtPct, providerLabelFor } from "./shared";
import { ProviderLogo } from "./ProviderLogo";
import type { ViewerTarget } from "./ResponseViewer";
import { ColumnHelp } from "./ColumnHelp";

export const SITE_TYPE_LABEL: Record<SiteType, string> = {
  official: "เว็บแบรนด์", blog: "บล็อก/บทความ", news: "ข่าว", review: "รีวิว/เปรียบเทียบ", forum: "เว็บบอร์ด",
  directory: "ไดเรกทอรี", social: "โซเชียล", video: "วิดีโอ", marketplace: "มาร์เก็ตเพลส", reference: "สารานุกรม",
  government: "หน่วยงานรัฐ/การศึกษา", other: "อื่น ๆ",
};

const PAGE_TYPE_LABEL: Record<string, string> = {
  home: "หน้าแรก", article: "บทความ", review: "รีวิว", comparison: "เปรียบเทียบ", list: "จัดอันดับ/รวมรายการ",
  product: "สินค้า/บริการ", "forum thread": "กระทู้", video: "วิดีโอ", other: "อื่น ๆ",
};
export function pageTypeLabel(t: string | undefined): string {
  return PAGE_TYPE_LABEL[t ?? ""] ?? "อื่น ๆ";
}

/** https link only for http(s) URLs; anything else is shown as plain text */
export function safeUrl(url: string | null | undefined): string | null {
  const u = (url ?? "").trim();
  return /^https?:\/\//i.test(u) ? u : null;
}

/** Path part of a URL for display; falls back to the raw text */
export function urlPath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`.slice(0, 120) || "/";
  } catch {
    return url.slice(0, 120);
  }
}

export function ExtLink({ href, children, className }: { href: string | null | undefined; children: ReactNode; className?: string }) {
  const safe = safeUrl(href);
  if (!safe) return <span className={className}>{children}</span>;
  return <a href={safe} target="_blank" rel="noopener noreferrer nofollow" className={`${className ?? ""} hover:underline`}>{children}</a>;
}

/** https URL for a plain hostname only */
function domainUrl(domain: string): string | null {
  const d = domain.trim().toLowerCase();
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) && d.length <= 253 ? `https://${d}` : null;
}

function DomainIcon({ domain }: { domain: string }) {
  const [failed, setFailed] = useState(false);
  const src = faviconUrl(domain);
  if (!src || failed) return <EntityAvatar label={domain || "?"} size={24} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" width={24} height={24} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="h-6 w-6 shrink-0 rounded-md bg-white object-contain" />;
}

export function Platforms({ providers, clientView }: { providers: string[] | undefined; clientView?: boolean }) {
  const list = providers ?? [];
  if (list.length === 0) return <span className="text-gray-400">-</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {list.map((p) => <ProviderLogo key={p} provider={p} size={16} title={providerLabelFor(p, clientView)} />)}
    </span>
  );
}

function signalText(s: WhySignal): string {
  const total = s.total ?? 0;
  switch (s.code) {
    case "multi_platform": return `ถูกอ้างอิงจาก ${fmtNum(s.value)} จาก ${fmtNum(total)} แพลตฟอร์ม AI`;
    case "many_pages": return `มี ${fmtNum(s.value)} หน้าที่ถูกหยิบไปใช้ ไม่ใช่หน้าเดียว`;
    case "consistent": return `ติดสม่ำเสมอ ${fmtNum(s.value)} จาก ${fmtNum(total)} รอบสแกน`;
    case "many_prompts": return `ติดใน ${fmtNum(s.value)} จาก ${fmtNum(total)} prompt`;
    case "top_position": return `อยู่ลำดับต้นของรายการอ้างอิง (เฉลี่ยลำดับที่ ${Math.round(s.value * 10) / 10})`;
    case "title_match": return `หัวข้อหรือ URL ของ ${fmtNum(s.value)} จาก ${fmtNum(total)} หน้าตรงกับคำใน prompt`;
    case "page_type": return `หน้าที่ติดส่วนใหญ่เป็น${pageTypeLabel(s.detail)} (${Math.round(s.value)}%)`;
    default: return "";
  }
}

function nextStep(r: AnalysisDomainRow): string {
  if (r.ownerType === "own") return "รักษาและอัปเดตหน้าที่ติดอยู่";
  if (r.ownerType === "competitor") return "ดูหน้าที่คู่แข่งติด แล้วทำเนื้อหาเรื่องเดียวกันให้ครบกว่า";
  return r.vendor ? "มีในคลัง backlink — สั่งลงบทความ/ลิงก์ที่เว็บนี้ได้" : "ติดต่อเว็บนี้เพื่อขอลงบทความหรือถูกกล่าวถึง";
}

function PageList({ pages, clientView }: { pages: AnalysisPage[]; clientView?: boolean }) {
  if (pages.length === 0) return <p className="text-xs text-gray-500">ยังไม่มีข้อมูลระดับหน้า</p>;
  return (
    <ul className="space-y-2">
      {pages.map((p) => (
        <li key={p.url} className="min-w-0 text-sm">
          <ExtLink href={p.url} className="break-words font-medium text-brand-navy">{p.title || urlPath(p.url)}</ExtLink>
          <div className="break-all text-xs text-gray-400">{urlPath(p.url)}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <Chip tone="muted">{pageTypeLabel(p.pageType)}</Chip>
            <span>{fmtNum(p.answers)} คำตอบ</span>
            <Platforms providers={p.providers} clientView={clientView} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function DrillDown({ row, clientView, onView }: { row: AnalysisDomainRow; clientView?: boolean; onView: (t: ViewerTarget) => void }) {
  const signals = row.signals ?? [];
  const sample = row.sample;
  return (
    <div className="grid gap-4 rounded-2xl bg-gray-50/70 p-3 md:grid-cols-3">
      <div className="min-w-0">
        <h4 className="mb-2 text-xs font-semibold text-brand-navy">หน้าที่ AI หยิบไปใช้</h4>
        <PageList pages={row.pages ?? []} clientView={clientView} />
      </div>
      <div className="min-w-0">
        <h4 className="mb-2 text-xs font-semibold text-brand-navy">prompt ที่ทำให้เว็บนี้ติด</h4>
        {(row.promptsList ?? []).length === 0 ? <p className="text-xs text-gray-500">ไม่มีข้อมูล</p> : (
          <ul className="space-y-1.5">
            {(row.promptsList ?? []).map((p) => (
              <li key={p.promptId} className="text-sm">
                <span className="break-words text-brand-navy">{p.text}</span>
                <span className="block text-xs text-gray-500">{fmtNum(p.answers)} จาก {fmtNum(p.asked)} คำตอบ</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="min-w-0">
        <h4 className="mb-2 text-xs font-semibold text-brand-navy">ทำไมถึงติด (หลักฐานจากข้อมูลที่เก็บ)</h4>
        {signals.length === 0 ? <p className="text-xs text-gray-500">ยังมีข้อมูลไม่พอสรุป</p> : (
          <ul className="list-disc space-y-1 pl-4 text-sm text-gray-700">
            {signals.map((s, i) => <li key={`${s.code}-${i}`}>{signalText(s)}</li>)}
          </ul>
        )}
        <p className="mt-2 text-xs text-gray-400">เป็นสัญญาณจากข้อมูลที่ระบบเก็บ ไม่ใช่คำยืนยันจาก AI</p>
        {sample ? (
          <button type="button" className="mt-2 text-xs font-medium text-brand-blue hover:underline" onClick={() => onView({ promptId: sample.promptId, runId: sample.runId, provider: sample.provider })}>
            ดูคำตอบตัวอย่าง
          </button>
        ) : null}
        {!clientView ? <p className="mt-3 rounded-xl bg-white/80 p-2 text-xs text-brand-navy">ขั้นต่อไป: {nextStep(row)}</p> : null}
      </div>
    </div>
  );
}

const CHANGE_CHIP: Record<NonNullable<AnalysisDomainRow["change"]>, { tone: "info" | "ok" | "bad" | "muted"; label: string }> = {
  new: { tone: "info", label: "ใหม่" }, up: { tone: "ok", label: "เพิ่มขึ้น" }, down: { tone: "bad", label: "ลดลง" }, same: { tone: "muted", label: "เท่าเดิม" },
};

function OwnerChip({ r }: { r: AnalysisDomainRow }) {
  if (r.ownerType === "own") return <Chip tone="ok">เว็บเรา</Chip>;
  if (r.ownerType === "competitor") return <Chip tone="warn">เว็บคู่แข่ง{r.competitorName ? ` · ${r.competitorName}` : ""}</Chip>;
  return <Chip tone="muted">เว็บอื่น</Chip>;
}

function StaffChips({ r }: { r: AnalysisDomainRow }) {
  const v = r.vendor;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {v ? (
        <>
          <Chip tone="info">ซื้อ backlink ได้</Chip>
          {v.price !== null && v.price !== undefined ? <Chip tone="muted">{fmtNum(v.price)} {v.currency}</Chip> : null}
          {v.domainRating !== null && v.domainRating !== undefined ? <Chip tone="muted">DR {fmtNum(v.domainRating)}</Chip> : null}
          {v.traffic !== null && v.traffic !== undefined ? <Chip tone="muted">traffic {fmtNum(v.traffic)}</Chip> : null}
          {v.linkType ? <Chip tone="muted">{v.linkType}</Chip> : null}
        </>
      ) : r.ownerType === "external" && !r.isOwnPbn ? <Chip tone="muted">ยังไม่มีในคลัง — ติดต่อขอลงได้</Chip> : null}
      {r.isOwnPbn ? <Chip tone="ok">PBN ของเรา</Chip> : null}
    </div>
  );
}

type OwnerFilter = "all" | "own" | "competitor" | "external";
type VendorFilter = "any" | "yes" | "no";
const PAGE = 15;

export function DomainsSection({ domains, totalAnswers, clientView, onView }: { domains: AnalysisDomainRow[]; totalAnswers: number; clientView?: boolean; onView: (t: ViewerTarget) => void }) {
  const [owner, setOwner] = useState<OwnerFilter>("all");
  const [vendor, setVendor] = useState<VendorFilter>("any");
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);

  const rows = useMemo(() => domains.filter((r) => {
    if (owner !== "all" && r.ownerType !== owner) return false;
    if (!clientView && vendor === "yes" && !r.vendor) return false;
    if (!clientView && vendor === "no" && r.vendor) return false;
    return true;
  }), [domains, owner, vendor, clientView]);

  return (
    <Panel title="ใครถูกอ้างอิงบ่อยที่สุด" subtitle="เว็บที่ AI นำไปใช้เป็นแหล่งข้อมูลในคำตอบ เรียงตามจำนวนคำตอบที่อ้างอิง กดที่แถวเพื่อดูรายละเอียด">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented<OwnerFilter> size="sm" ariaLabel="กรองตามเจ้าของเว็บ" value={owner} onChange={(v) => { setOwner(v); setShown(PAGE); }}
          options={[{ value: "all", label: "ทั้งหมด" }, { value: "own", label: "เว็บเรา" }, { value: "competitor", label: "คู่แข่ง" }, { value: "external", label: "เว็บอื่น" }]} />
        {!clientView ? (
          <Segmented<VendorFilter> size="sm" ariaLabel="กรองตามคลัง backlink" value={vendor} onChange={(v) => { setVendor(v); setShown(PAGE); }}
            options={[{ value: "any", label: "ทุกเว็บ" }, { value: "yes", label: "มีในคลัง backlink" }, { value: "no", label: "ยังไม่มีในคลัง" }]} />
        ) : null}
      </div>
      {rows.length === 0 ? <EmptyState title="ไม่พบเว็บตามตัวกรองนี้" /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-500">
                <th className="w-8 py-2 pr-2 font-medium"><ColumnHelp k="citedRowNo">#</ColumnHelp></th>
                <th className="py-2 pr-3 font-medium"><ColumnHelp k="analysisDomain">เว็บ</ColumnHelp></th>
                <th className="py-2 pr-3 font-medium"><ColumnHelp k="citationShare">คำตอบที่อ้างอิง (จาก {fmtNum(totalAnswers)})</ColumnHelp></th>
                <th className="py-2 pr-3 font-medium"><ColumnHelp k="analysisPrompts">prompt</ColumnHelp></th>
                <th className="py-2 pr-3 font-medium"><ColumnHelp k="analysisPlatforms">แพลตฟอร์ม</ColumnHelp></th>
                <th className="py-2 pr-3 font-medium"><ColumnHelp k="analysisConsistency">ความสม่ำเสมอ</ColumnHelp></th>
                <th className="py-2 pr-3 font-medium"><ColumnHelp k="analysisAvgPosition">ลำดับเฉลี่ย</ColumnHelp></th>
                <th className="py-2 font-medium"><ColumnHelp k="analysisChange">เทียบช่วงก่อน</ColumnHelp></th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, shown).map((r, i) => {
                const isOpen = open === r.domain;
                const href = domainUrl(r.domain);
                const ch = r.change ? CHANGE_CHIP[r.change] : null;
                const series = r.series ?? [];
                return (
                  <RowFragment key={r.domain}>
                    <tr className="border-b border-gray-50 align-top">
                      <td className="py-2 pr-2 tabular-nums text-gray-500">{i + 1}</td>
                      <td className="py-2 pr-3">
                        <div className="flex min-w-0 items-start gap-2">
                          <DomainIcon domain={r.domain} />
                          <div className="min-w-0">
                            <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.domain)} className="inline-flex items-center gap-1 text-left font-medium text-brand-navy">
                              {isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />}
                              <span className="break-all">{r.domain}</span>
                            </button>
                            {href ? <ExtLink href={href} className="ml-5 block text-[11px] text-gray-400">เปิดเว็บ</ExtLink> : null}
                            <div className="mt-1 flex flex-wrap gap-1"><OwnerChip r={r} /><Chip tone="muted">{SITE_TYPE_LABEL[r.siteType] ?? "อื่น ๆ"}</Chip></div>
                            {!clientView ? <StaffChips r={r} /> : null}
                          </div>
                        </div>
                      </td>
                      <td className="min-w-[150px] py-2 pr-3">
                        <div className="text-xs tabular-nums text-gray-700">{fmtNum(r.answers)} จาก {fmtNum(totalAnswers)} ({fmtPct(r.answerShare)})</div>
                        <MeterBar value={(r.answerShare ?? 0) * 100} max={100} ariaLabel={`สัดส่วน ${fmtPct(r.answerShare)}`} />
                      </td>
                      <td className="py-2 pr-3 tabular-nums">{fmtNum(r.prompts)}</td>
                      <td className="py-2 pr-3"><Platforms providers={r.providers} clientView={clientView} /></td>
                      <td className="py-2 pr-3">
                        <div className="text-xs text-gray-700">ติด {fmtNum(r.runsPresent)} จาก {fmtNum(r.runsTotal)} รอบ</div>
                        {series.length >= 2 ? <Sparkline values={series.map((v) => v * 100)} width={72} height={20} ariaLabel="สัดส่วนต่อรอบสแกน" /> : null}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">{r.avgPosition !== null && r.avgPosition !== undefined ? Math.round(r.avgPosition * 10) / 10 : "-"}</td>
                      <td className="py-2">{ch ? <Chip tone={ch.tone}>{ch.label}</Chip> : <span className="text-gray-400">-</span>}</td>
                    </tr>
                    {isOpen ? (
                      <tr className="border-b border-gray-50">
                        <td colSpan={8} className="pb-3"><DrillDown row={r} clientView={clientView} onView={onView} /></td>
                      </tr>
                    ) : null}
                  </RowFragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > shown ? (
        <button type="button" className="mt-3 text-sm font-medium text-brand-blue hover:underline" onClick={() => setShown((n) => n + PAGE)}>แสดงเพิ่ม ({fmtNum(rows.length - shown)})</button>
      ) : null}
    </Panel>
  );
}

function RowFragment({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
