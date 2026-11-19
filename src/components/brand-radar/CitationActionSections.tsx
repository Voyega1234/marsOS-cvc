"use client";

/**
 * Brand Radar — Citation Analysis: "which page to fix" per question, and "found our site but did not cite it".
 * All API text (URLs, titles, domains, question text) is untrusted: rendered as React text only,
 * links only for http(s) URLs.
 */
import { useState, type ReactNode } from "react";
import { Chip, EmptyState, Panel } from "@/components/ds";
import type { FixAction, FoundFunnel, PromptFixRow } from "@/lib/brand-radar/citation-analysis-types";
import { ColumnHelp } from "./ColumnHelp";
import type { ColumnHelpText } from "./column-help";
import { ExtLink, Platforms, urlPath } from "./CitationAnalysisParts";
import { fmtNum, fmtPct } from "./shared";

const FIX_PAGE = 10;

const WHEN = "เปลี่ยนเมื่อมีการสแกนรอบใหม่ และเมื่อเปลี่ยนตัวกรองช่วงเวลา/แอป AI ระบบคำนวณจากคำตอบที่เก็บไว้ทุกครั้งที่เปิดหน้า";

const FIX_HELP: Record<"prompt" | "action" | "own" | "instead" | "cited", ColumnHelpText> = {
  prompt: {
    what: "คำถามที่ติดตามอยู่ และจำนวนคำตอบที่ได้ในช่วงที่เลือก",
    how: "นับคำตอบทั้งหมดของคำถามนั้น (ทุกรอบสแกนและทุกแอป AI ที่กรองไว้) เรียงจากคำถามที่ต้องแก้มากที่สุดก่อน แล้วตามด้วยจำนวนคำตอบ",
    when: WHEN,
  },
  action: {
    what: "สิ่งที่ควรทำกับคำถามนี้",
    how: "ถ้าคำตอบอย่างน้อยครึ่งหนึ่งลิงก์ไปเว็บเรา = รักษาและอัปเดต · ลิงก์ไปเว็บเราบ้างแต่ไม่ถึงครึ่ง = ปรับหน้าให้ครบขึ้น · ไม่มีลิงก์ไปเว็บเราเลยแต่ AI เอ่ยชื่อแบรนด์ = ทำหน้าที่ตอบตรง ๆ · ทั้งลิงก์และชื่อไม่มีเลย = ทำหน้าใหม่",
    when: WHEN,
  },
  own: {
    what: "หน้าของเว็บเราที่ AI แนบเป็นแหล่งข้อมูลเมื่อตอบคำถามนี้ (สูงสุด 3 หน้า)",
    how: "นับจำนวนคำตอบ (ไม่ใช่จำนวนลิงก์) ที่ลิงก์ไปหน้านั้น หน้าที่ถูกใช้ในคำตอบมากที่สุดอยู่บน",
    when: WHEN,
  },
  instead: {
    what: "หน้าที่ AI อ้างอิงในคำตอบที่ไม่มีลิงก์ไปเว็บเรา (สูงสุด 3 หน้า) แยกเป็นเว็บคู่แข่งหรือเว็บอื่น",
    how: "นับเฉพาะคำตอบของคำถามนี้ที่ไม่ลิงก์ไปหน้าใดของเราเลย แล้วนับจำนวนคำตอบที่ลิงก์ไปแต่ละหน้า",
    when: WHEN,
  },
  cited: {
    what: "จำนวนคำตอบของคำถามนี้ที่ลิงก์ไปเว็บเรา จากคำตอบทั้งหมดของคำถามนั้น",
    how: "คำตอบที่มีลิงก์ไปเว็บของเราอย่างน้อยหนึ่งลิงก์ นับเป็นหนึ่งคำตอบ",
    when: WHEN,
  },
};

const FOUND_HELP: Record<"page" | "found" | "cited" | "prompts", ColumnHelpText> = {
  page: {
    what: "หน้าของเว็บเราที่แอป AI ค้นเจอระหว่างหาข้อมูล แต่ใส่เป็นลิงก์อ้างอิงในคำตอบไม่ครบทุกครั้ง",
    how: "แสดงเฉพาะหน้าที่ค้นเจอมากกว่าที่ถูกอ้างอิง เรียงจากส่วนต่างมากที่สุดก่อน แล้วตามด้วยจำนวนที่ค้นเจอ",
    when: WHEN,
  },
  found: {
    what: "จำนวนคำตอบที่แอป AI รายงานว่าค้นเจอหน้านี้",
    how: "นับต่อคำตอบ (หน้าเดียวกันในคำตอบเดียวกันนับครั้งเดียว) เฉพาะคำตอบที่แอป AI ส่งรายการแหล่งที่ค้นเจอมาให้",
    when: WHEN,
  },
  cited: {
    what: "ในคำตอบที่ค้นเจอหน้านี้ มีกี่คำตอบที่ลิงก์ไปหน้านี้ด้วย",
    how: "เทียบ URL ของหน้าที่ค้นเจอกับ URL ที่อ้างอิงของคำตอบเดียวกัน หลังจัด URL ให้อยู่ในรูปเดียวกัน (ตัด www, utm และเครื่องหมาย / ท้ายสุด)",
    when: WHEN,
  },
  prompts: {
    what: "คำถามตัวอย่างที่ค้นเจอหน้านี้แต่ไม่ได้ลิงก์ (สูงสุด 3 คำถาม)",
    how: "เลือกคำถามที่มีคำตอบค้นเจอหน้านี้แต่ไม่ลิงก์มากที่สุด",
    when: WHEN,
  },
};

const ACTION_CHIP: Record<FixAction, { tone: "bad" | "warn" | "info" | "ok"; text: string }> = {
  create: { tone: "bad", text: "ยังไม่มีหน้าที่ AI ใช้ — ควรทำหน้าใหม่" },
  make_citable: { tone: "warn", text: "AI เอ่ยชื่อแต่ไม่ลิงก์ — ทำหน้าที่ตอบคำถามนี้ตรง ๆ" },
  strengthen: { tone: "info", text: "ถูกอ้างอิงบ้าง — ปรับหน้านี้ให้ครบขึ้น" },
  keep: { tone: "ok", text: "ถูกอ้างอิงเป็นหลัก — รักษาและอัปเดต" },
};

function PageLine({ url, title, domain, count, children }: { url: string; title: string; domain?: string; count: number; children?: ReactNode }) {
  return (
    <li className="min-w-0 text-xs">
      <ExtLink href={url} className="break-words font-medium text-brand-navy">{title || domain || urlPath(url)}</ExtLink>
      <span className="ml-1 text-gray-400">({fmtNum(count)} คำตอบ)</span>
      <div className="break-all text-gray-400">{domain ? `${domain} ` : ""}{urlPath(url)}</div>
      {children}
    </li>
  );
}

// ── Which page to fix ────────────────────────────────────────────────────────

export function FixPagesSection({ rows, onOpenPrompt }: { rows: PromptFixRow[]; onOpenPrompt?: (promptId: string) => void }) {
  const [all, setAll] = useState(false);
  const list = rows ?? [];
  const shown = all ? list : list.slice(0, FIX_PAGE);
  return (
    <Panel
      title="ต้องแก้หน้าไหน"
      subtitle="แต่ละคำถาม: หน้าของเราที่ AI ใช้ตอบ และหน้าที่ AI ใช้แทนเรา · ใช้ดูว่าควรปรับหน้าเดิมหรือทำหน้าใหม่เพื่อให้ AI อ้างอิงเรา"
    >
      {list.length === 0 ? <EmptyState title="ยังไม่มีคำถามที่มีคำตอบในช่วงนี้" /> : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-500">
                  <th className="py-2 pr-3 font-medium"><ColumnHelp help={FIX_HELP.prompt}>คำถาม</ColumnHelp></th>
                  <th className="py-2 pr-3 font-medium"><ColumnHelp help={FIX_HELP.action}>สิ่งที่ควรทำ</ColumnHelp></th>
                  <th className="py-2 pr-3 font-medium"><ColumnHelp help={FIX_HELP.own}>หน้าของเราที่ AI อ้างอิง</ColumnHelp></th>
                  <th className="py-2 pr-3 font-medium"><ColumnHelp help={FIX_HELP.instead}>หน้าที่ AI อ้างอิงแทนเรา</ColumnHelp></th>
                  <th className="py-2 font-medium"><ColumnHelp help={FIX_HELP.cited}>อ้างอิงเรา</ColumnHelp></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const chip = ACTION_CHIP[r.action];
                  return (
                    <tr key={r.promptId} className="border-b border-gray-50 align-top">
                      <td className="max-w-[260px] py-2.5 pr-3">
                        {onOpenPrompt ? (
                          <button type="button" className="break-words text-left font-medium text-brand-navy hover:underline" onClick={() => onOpenPrompt(r.promptId)}>{r.text || r.promptId}</button>
                        ) : <span className="break-words font-medium text-brand-navy">{r.text || r.promptId}</span>}
                        <div className="text-xs text-gray-400">{fmtNum(r.asked)} คำตอบ · เอ่ยชื่อแบรนด์ {fmtNum(r.mentionedAnswers)}</div>
                      </td>
                      <td className="max-w-[200px] py-2.5 pr-3"><Chip tone={chip.tone} className="whitespace-normal text-left">{chip.text}</Chip></td>
                      <td className="max-w-[240px] py-2.5 pr-3">
                        {r.ownPages.length === 0 ? <span className="text-gray-400">-</span> : (
                          <ul className="space-y-1.5">{r.ownPages.map((p) => <PageLine key={p.url} url={p.url} title={p.title} count={p.answers} />)}</ul>
                        )}
                      </td>
                      <td className="max-w-[260px] py-2.5 pr-3">
                        {r.insteadPages.length === 0 ? <span className="text-gray-400">-</span> : (
                          <ul className="space-y-1.5">
                            {r.insteadPages.map((p) => (
                              <PageLine key={p.url} url={p.url} title={p.title} domain={p.domain} count={p.answers}>
                                <Chip tone={p.ownerType === "competitor" ? "warn" : "muted"} className="mt-0.5">
                                  {p.ownerType === "competitor" ? (p.competitorName ? `คู่แข่ง · ${p.competitorName}` : "คู่แข่ง") : "เว็บอื่น"}
                                </Chip>
                              </PageLine>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="whitespace-nowrap py-2.5 tabular-nums text-gray-700">{fmtNum(r.ownAnswers)}/{fmtNum(r.asked)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {list.length > FIX_PAGE ? (
            <button type="button" className="mt-3 text-sm font-medium text-brand-blue hover:underline" onClick={() => setAll((v) => !v)}>
              {all ? "ซ่อน" : `ดูทั้งหมด (${fmtNum(list.length)})`}
            </button>
          ) : null}
        </>
      )}
    </Panel>
  );
}

// ── Found but not cited ──────────────────────────────────────────────────────

function FunnelStep({ label, count, total, tone }: { label: string; count: number; total: number; tone: string }) {
  const share = total > 0 ? count / total : null;
  return (
    <div className="min-w-0 rounded-2xl border border-gray-100 p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-xl font-semibold text-brand-navy">{fmtNum(count)}</span>
        <span className="text-xs text-gray-500">คำตอบ · {fmtPct(share)} ของ {fmtNum(total)}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(100, Math.round((share ?? 0) * 100))}%` }} />
      </div>
    </div>
  );
}

export function FoundNotCitedSection({ funnel }: { funnel: FoundFunnel | null }) {
  const subtitle = "ข้อมูลนี้มาจากแอป AI ที่รายงานแหล่งที่ค้นเจอระหว่างหาข้อมูลเท่านั้น (ตอนนี้มีเฉพาะ ChatGPT) · ดูว่า AI ค้นเจอเว็บเราแล้วแต่ไม่ลิงก์ในคำตอบ";
  if (!funnel) {
    return (
      <Panel title="เจอเว็บเราแต่ไม่อ้างอิง" subtitle={subtitle}>
        <EmptyState title="ยังไม่มีข้อมูลแหล่งที่ AI ค้นเจอในช่วงที่เลือก" description="ต้องสแกนด้วยแอป AI ที่รายงานแหล่งที่ค้นเจอ (ตอนนี้มีเฉพาะ ChatGPT) จึงจะเห็นข้อมูลนี้" />
      </Panel>
    );
  }
  return (
    <Panel title="เจอเว็บเราแต่ไม่อ้างอิง" subtitle={subtitle}>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <span>ข้อมูลจาก {fmtNum(funnel.withData)} คำตอบ จาก</span>
        <Platforms providers={funnel.providers} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FunnelStep label="1. ค้นเจอเว็บเรา" count={funnel.found} total={funnel.withData} tone="bg-sky-400" />
        <FunnelStep label="2. อ้างอิงเว็บเรา" count={funnel.foundAndCited} total={funnel.withData} tone="bg-emerald-500" />
        <FunnelStep label="3. เอ่ยชื่อแบรนด์" count={funnel.foundAndMentioned} total={funnel.withData} tone="bg-violet-500" />
      </div>
      <p className="mt-2 text-xs text-gray-400">ขั้นที่ 2 และ 3 นับเฉพาะคำตอบที่ค้นเจอเว็บเรา (ขั้นที่ 1) และคิดเป็นสัดส่วนของคำตอบที่มีข้อมูลทั้งหมด</p>
      {funnel.pages.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500">หน้าของเราที่ค้นเจอถูกอ้างอิงครบทุกครั้ง</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-500">
                <th className="py-2 pr-3 font-medium"><ColumnHelp help={FOUND_HELP.page}>หน้า</ColumnHelp></th>
                <th className="py-2 pr-3 font-medium"><ColumnHelp help={FOUND_HELP.found}>ค้นเจอ</ColumnHelp></th>
                <th className="py-2 pr-3 font-medium"><ColumnHelp help={FOUND_HELP.cited}>อ้างอิง</ColumnHelp></th>
                <th className="py-2 font-medium"><ColumnHelp help={FOUND_HELP.prompts}>คำถามตัวอย่าง</ColumnHelp></th>
              </tr>
            </thead>
            <tbody>
              {funnel.pages.map((p) => (
                <tr key={p.url} className="border-b border-gray-50 align-top">
                  <td className="max-w-[320px] py-2.5 pr-3">
                    <ExtLink href={p.url} className="break-words font-medium text-brand-navy">{p.title || urlPath(p.url)}</ExtLink>
                    <div className="break-all text-xs text-gray-400">{urlPath(p.url)}</div>
                  </td>
                  <td className="py-2.5 pr-3 tabular-nums">{fmtNum(p.found)}</td>
                  <td className="py-2.5 pr-3 tabular-nums">{fmtNum(p.cited)}</td>
                  <td className="max-w-[320px] py-2.5 text-xs text-gray-500">
                    {p.prompts.length === 0 ? "-" : <ul className="space-y-0.5">{p.prompts.map((q) => <li key={q.promptId} className="break-words">{q.text || q.promptId}</li>)}</ul>}
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
