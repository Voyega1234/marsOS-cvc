"use client";

/**
 * Brand Radar — full-answer viewer (right drawer).
 * One prompt, one run, one AI platform: the answer rendered as readable text with brand / competitor names
 * highlighted and links shown as domain chips, plus a side panel of mentions and cited pages.
 * The answer text is untrusted model output: it is rendered as React text nodes only (no HTML injection),
 * and only http(s) URLs become links.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight, Copy, ExternalLink, Info } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Chip, EntityAvatar } from "@/components/ds";
import { faviconUrl } from "@/lib/backlink-management/project-logos";
import { cn } from "@/lib/utils";
import { BRAND_POSITIONING_LABEL, SENTIMENT_TONE_LABEL, type CitationOwner, type RadarFilters, type ResponseDTO, type ResponseViewerDTO } from "@/lib/brand-radar/types";
import { ProviderLogo } from "./ProviderLogo";
import { ANSWER_ZONE_LEGEND, fmtAnswerPos, fmtDateTime, fmtPct, fmtRange, fmtUsd, fmtZoneShare, isSmallSample, providerShort, radarQuery } from "./shared";
import { LoadState, useApiData } from "./PromptDialogs";

export interface ViewerTarget {
  promptId: string
  runId?: string
  provider?: string
  /** open on this answer when it belongs to the loaded run + platform */
  responseId?: string
}

// ── Entity colours ───────────────────────────────────────────────────────────

const BRAND_MARK = "bg-amber-200/80 text-amber-950 ring-1 ring-amber-300";
const COMPETITOR_MARKS = [
  "bg-sky-100 text-sky-900 ring-1 ring-sky-200",
  "bg-violet-100 text-violet-900 ring-1 ring-violet-200",
  "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-200",
  "bg-rose-100 text-rose-900 ring-1 ring-rose-200",
  "bg-orange-100 text-orange-900 ring-1 ring-orange-200",
  "bg-teal-100 text-teal-900 ring-1 ring-teal-200",
];

// Brands the AI named that are not on our tracked list: dotted underline only
const OTHER_MARK = "underline decoration-dotted decoration-gray-400 underline-offset-4";

interface EntityStyle { key: string; name: string; brand: boolean; cls: string; other?: boolean; category?: string }

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Builds one case-insensitive matcher for every alias found in this answer, longest first. */
export function buildHighlighter(r: ResponseDTO, styles: Map<string, EntityStyle>) {
  const byAlias = new Map<string, EntityStyle>();
  for (const m of r.mentions) {
    const st = styles.get(m.key);
    if (!st) continue;
    const terms = m.aliases.length > 0 ? m.aliases : [m.name];
    for (const t of terms) {
      const k = t.trim().toLowerCase();
      if (k.length >= 2 && !byAlias.has(k)) byAlias.set(k, st);
    }
  }
  // Other brands the AI named: tracked aliases always win
  for (const o of r.otherEntities ?? []) {
    const k = (o.name ?? "").trim().toLowerCase();
    if (k.length < 2 || byAlias.has(k)) continue;
    byAlias.set(k, { key: "other:" + k, name: o.name, brand: false, cls: OTHER_MARK, other: true, category: o.category });
  }
  const terms = Array.from(byAlias.keys()).sort((a, b) => b.length - a.length);
  if (terms.length === 0) return null;
  return { re: new RegExp(terms.map(escapeRe).join("|"), "gi"), byAlias };
}

type Highlighter = ReturnType<typeof buildHighlighter>;

// ── Safe markdown-lite renderer ──────────────────────────────────────────────

function urlKey(u: string): string {
  return u.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/[/#?]+$/, "").toLowerCase();
}

function hostLabel(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./i, "");
  } catch {
    return u;
  }
}

interface RenderCtx {
  hl: Highlighter
  /** urlKey -> citation number (1-based) */
  citeNo: Map<string, number>
  seenEntity: Set<string>
}

const LATIN = /[A-Za-z0-9À-ɏ]/;

function highlightText(text: string, ctx: RenderCtx, keyBase: string): ReactNode[] {
  if (!ctx.hl || !text) return [text];
  const out: ReactNode[] = [];
  const re = new RegExp(ctx.hl.re.source, "gi");
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) { re.lastIndex += 1; continue; }
    const st = ctx.hl.byAlias.get(m[0].toLowerCase());
    if (!st) continue;
    // Latin names must match whole words; Thai text has no spaces so it matches inside running text
    const before = m.index > 0 ? text[m.index - 1] : "";
    const after = text[m.index + m[0].length] ?? "";
    if ((LATIN.test(m[0][0]) && before && LATIN.test(before)) || (LATIN.test(m[0][m[0].length - 1]) && after && LATIN.test(after))) {
      re.lastIndex = m.index + 1;
      continue;
    }
    if (m.index > last) out.push(text.slice(last, m.index));
    const first = !ctx.seenEntity.has(st.key);
    ctx.seenEntity.add(st.key);
    if (st.other) {
      out.push(
        <span key={`${keyBase}-h${i++}`} title={`แบรนด์อื่นที่ AI พูดถึง: ${st.name}${st.category ? ` (${st.category})` : ""}`}
          data-entity={first ? st.key : undefined}
          className={cn(st.cls)}>{m[0]}</span>,
      );
      last = m.index + m[0].length;
      continue;
    }
    out.push(
      <mark key={`${keyBase}-h${i++}`} title={st.brand ? `แบรนด์เรา: ${st.name}` : `คู่แข่ง: ${st.name}`}
        data-entity={first ? st.key : undefined}
        className={cn("rounded px-0.5 font-medium", st.cls)}>{m[0]}</mark>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function LinkChip({ href, label, no }: { href: string; label: string; no: number | undefined }) {
  const safe = /^https?:\/\//i.test(href);
  const inner = (
    <>
      {no ? <span className="mr-1 font-semibold text-gray-500">{no}</span> : null}
      <span className="truncate">{label}</span>
    </>
  );
  const cls = "mx-0.5 inline-flex max-w-[16rem] items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0 align-baseline text-[11px] leading-5 text-gray-700";
  if (!safe) return <span className={cls}>{inner}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" title={href} data-cite={no}
      className={cn(cls, "hover:border-brand-blue/40 hover:text-brand-blue")}>{inner}</a>
  );
}

// Alternation order: [text](url) | bare url | ***bold italic*** | **bold** | `code` | ~~strike~~ | *italic*
const INLINE_BASE =
  "\\[([^\\]\\n]{0,300})\\]\\((https?:\\/\\/[^\\s)]+)\\)" +
  "|(https?:\\/\\/[^\\s<>()\\]]+[^\\s<>()\\].,;:!?'\"])" +
  "|\\*\\*\\*([^*\\n]+)\\*\\*\\*" +
  "|\\*\\*([^*\\n]+)\\*\\*" +
  "|`([^`\\n]+)`" +
  "|~~([^~\\n]+)~~" +
  "|\\*(?![\\s*])([^*\\n]*[^*\\s])\\*(?!\\*)";
// Underscore emphasis never fires inside words (snake_case) or URLs; it needs lookbehind, so it is built at runtime
const INLINE_UNDERSCORE = "|(?<![A-Za-z0-9_])(__|_)(?!\\s)([^_\\n]*[^_\\s])\\9(?![A-Za-z0-9_])";
const INLINE_SRC: { src: string; underscore: boolean } = (() => {
  try {
    new RegExp(INLINE_BASE + INLINE_UNDERSCORE, "gi");
    return { src: INLINE_BASE + INLINE_UNDERSCORE, underscore: true };
  } catch {
    return { src: INLINE_BASE, underscore: false };
  }
})();

function renderInline(text: string, ctx: RenderCtx, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = new RegExp(INLINE_SRC.src, "gi");
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) { re.lastIndex += 1; continue; }
    if (m.index > last) out.push(...highlightText(text.slice(last, m.index), ctx, `${keyBase}-t${i}`));
    const k = `${keyBase}-i${i++}`;
    if (m[2]) {
      const no = ctx.citeNo.get(urlKey(m[2]));
      const label = m[1] && m[1].trim() && !/^\d+$/.test(m[1].trim()) && urlKey(m[1]) !== urlKey(m[2]) ? m[1].trim() : hostLabel(m[2]);
      out.push(<LinkChip key={k} href={m[2]} label={label} no={no} />);
    } else if (m[3]) {
      out.push(<LinkChip key={k} href={m[3]} label={hostLabel(m[3])} no={ctx.citeNo.get(urlKey(m[3]))} />);
    } else if (m[4]) {
      out.push(<strong key={k} className="font-semibold"><em>{renderInline(m[4], ctx, k)}</em></strong>);
    } else if (m[5]) {
      out.push(<strong key={k} className="font-semibold">{renderInline(m[5], ctx, k)}</strong>);
    } else if (m[6]) {
      out.push(<code key={k} className="rounded bg-gray-100 px-1 text-[0.9em]">{m[6]}</code>);
    } else if (m[7]) {
      out.push(<del key={k}>{renderInline(m[7], ctx, k)}</del>);
    } else if (m[8]) {
      out.push(<em key={k}>{renderInline(m[8], ctx, k)}</em>);
    } else if (INLINE_SRC.underscore && m[10] !== undefined) {
      out.push(m[9] === "__"
        ? <strong key={k} className="font-semibold">{renderInline(m[10], ctx, k)}</strong>
        : <em key={k}>{renderInline(m[10], ctx, k)}</em>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(...highlightText(text.slice(last), ctx, `${keyBase}-tz`));
  return out;
}

const HEADING_CLS = ["", "text-lg font-bold", "text-base font-bold", "text-[15px] font-semibold", "text-sm font-semibold", "text-sm font-semibold", "text-sm font-semibold"];

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

export function renderMarkdown(src: string, ctx: RenderCtx): ReactNode[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let b = 0;
  const isTable = (l: string) => /^\s*\|.*\|\s*$/.test(l);
  const isSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
  const bullet = /^(\s*)([-*•+])\s+(.*)$/;
  const ordered = /^(\s*)(\d{1,3})[.)]\s+(.*)$/;
  while (i < lines.length) {
    const line = lines[i];
    const key = `b${b++}`;
    if (!line.trim()) { i++; continue; }
    if (/^\s*```/.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++;
      blocks.push(<pre key={key} className="overflow-x-auto rounded-xl bg-gray-50 p-3 text-xs">{body.join("\n")}</pre>);
      continue;
    }
    const h = /^\s*(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const lvl = h[1].length;
      const HTag = lvl <= 2 ? "h3" : lvl <= 4 ? "h4" : "h5";
      blocks.push(<HTag key={key} className={cn("mt-4 first:mt-0", HEADING_CLS[lvl])}>{renderInline(h[2].replace(/\s*#+\s*$/, ""), ctx, key)}</HTag>);
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quoted.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push(<blockquote key={key} className="my-2 border-l-2 border-gray-200 pl-3 text-gray-600">{renderMarkdown(quoted.join("\n"), ctx)}</blockquote>);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { blocks.push(<hr key={key} className="my-3 border-gray-100" />); i++; continue; }
    if (isTable(line) && i + 1 < lines.length && isSep(lines[i + 1])) {
      const head = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && isTable(lines[i])) rows.push(splitRow(lines[i++]));
      blocks.push(
        <div key={key} className="overflow-x-auto">
          <table className="my-2 w-full border-collapse text-xs">
            <thead><tr>{head.map((c, j) => <th key={j} className="border border-gray-200 bg-gray-50 px-2 py-1 text-left font-semibold">{renderInline(c, ctx, `${key}h${j}`)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j} className="border border-gray-200 px-2 py-1 align-top">{renderInline(c, ctx, `${key}r${ri}c${j}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (bullet.test(line) || ordered.test(line)) {
      const isOl = !bullet.test(line);
      const items: Array<{ depth: number; text: string; n: string }> = [];
      while (i < lines.length) {
        const l = lines[i];
        const mm = (isOl ? ordered : bullet).exec(l) || (isOl ? bullet : ordered).exec(l);
        if (mm) {
          items.push({ depth: Math.min(3, Math.floor(mm[1].replace(/\t/g, "  ").length / 2)), text: mm[3], n: mm[2] });
          i++;
        } else if (l.trim() && /^\s{2,}\S/.test(l) && items.length > 0) {
          items[items.length - 1].text += ` ${l.trim()}`;
          i++;
        } else break;
      }
      blocks.push(
        <ul key={key} className="my-2 space-y-1">
          {items.map((it, j) => (
            <li key={j} className="flex gap-2" style={{ paddingLeft: `${it.depth * 1.1}rem` }}>
              <span className="w-5 shrink-0 text-right text-gray-400">{/^\d+$/.test(it.n) ? `${it.n}.` : "•"}</span>
              <span className="min-w-0 flex-1">{renderInline(it.text, ctx, `${key}l${j}`)}</span>
            </li>
          ))}
        </ul>,
      );
      continue;
    }
    // paragraph: consecutive plain lines
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(#{1,6}\s|```|>|[-*•+]\s|\d{1,3}[.)]\s)/.test(lines[i]) && !(isTable(lines[i]) && i + 1 < lines.length && isSep(lines[i + 1]))) {
      para.push(lines[i].trim());
      i++;
    }
    if (para.length === 0) { para.push(line.trim()); i++; }
    blocks.push(
      <p key={key} className="my-2">
        {para.map((p, j) => <Fragment key={j}>{j > 0 ? <br /> : null}{renderInline(p, ctx, `${key}p${j}`)}</Fragment>)}
      </p>,
    );
  }
  return blocks;
}

/** Renders one answer's text (markdown-lite + brand / competitor highlighting) from the answer's own mentions. */
export function AnswerBody({ response, className }: { response: ResponseDTO; className?: string }) {
  const nodes = useMemo(() => {
    if (!response.responseText) return null;
    const styles = new Map<string, EntityStyle>();
    let c = 0;
    for (const m of response.mentions) {
      if (!styles.has(m.key)) styles.set(m.key, { key: m.key, name: m.name, brand: m.entityType === "brand", cls: m.entityType === "brand" ? BRAND_MARK : COMPETITOR_MARKS[c++ % COMPETITOR_MARKS.length] });
    }
    const citeNo = new Map<string, number>();
    response.citations.forEach((ci, i) => { const k = urlKey(ci.url); if (!citeNo.has(k)) citeNo.set(k, i + 1); });
    return renderMarkdown(response.responseText, { hl: buildHighlighter(response, styles), citeNo, seenEntity: new Set() });
  }, [response]);
  if (!nodes || nodes.length === 0) return <p className="text-sm text-gray-500">คำตอบว่าง</p>;
  return <article className={cn("text-[14px] leading-7 text-gray-800", className)}>{nodes}</article>;
}

// ── Side panel pieces ────────────────────────────────────────────────────────

const OWNER_LABEL: Record<CitationOwner, string> = { own: "เว็บเรา", competitor: "เว็บคู่แข่ง", external: "เว็บอื่น" };
const OWNER_TONE: Record<CitationOwner, "ok" | "warn" | "muted"> = { own: "ok", competitor: "warn", external: "muted" };

function pathOf(u: string): string {
  try {
    const x = new URL(u);
    const p = decodeURIComponent(x.pathname + x.search);
    return p === "/" ? "" : p;
  } catch {
    return "";
  }
}

function Favicon({ domain, label, size = 20 }: { domain?: string | null; label?: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const src = faviconUrl(domain);
  if (src && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="shrink-0 rounded" style={{ width: size, height: size }} />;
  }
  return <EntityAvatar label={label || domain || "?"} size={size} />;
}

function Section({ title, count, children, note }: { title: string; count?: number; children: ReactNode; note?: string }) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}{count !== undefined ? <span className="ml-1.5 text-gray-400">{count}</span> : null}</h3>
      </div>
      {note ? <p className="text-[11px] leading-4 text-gray-500">{note}</p> : null}
      {children}
    </section>
  );
}

function VendorChips({ vendor, isOwnPbn }: { vendor: ResponseDTO["citations"][number]["vendor"]; isOwnPbn: boolean }) {
  return (
    <>
      {isOwnPbn ? <Chip tone="ok">PBN ของเรา</Chip> : null}
      {vendor ? <Chip tone="info" title={vendor.price !== null ? `ราคา ${vendor.price} ${vendor.currency}` : undefined}>อยู่ในคลัง Backlink</Chip> : null}
    </>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function ResponseViewer({ projectId, filters, target, onClose, clientView }: {
  /** true = customer login: no cost, model, error text or backlink-vendor chips */
  clientView?: boolean
  projectId: string
  filters: RadarFilters
  /** null = closed */
  target: ViewerTarget | null
  onClose: () => void
}) {
  const [runId, setRunId] = useState<string>("");
  const [provider, setProvider] = useState<string>("");
  const [sampleId, setSampleId] = useState<string>("");
  const [sideTab, setSideTab] = useState<"answer" | "all">("answer");
  const [copied, setCopied] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // A new target resets the selection to what the caller asked for.
  useEffect(() => {
    setRunId(target?.runId ?? "");
    setProvider(target?.provider ?? "");
    setSampleId(target?.responseId ?? "");
    setSideTab("answer");
  }, [target]);

  const url = target
    ? `/api/brand-radar/prompts/${encodeURIComponent(target.promptId)}/responses?${radarQuery(projectId, filters, { runId, viewProvider: provider })}`
    : "";
  const { data: raw, loading, error, reload } = useApiData<ResponseViewerDTO>(url, 0);
  // the hook keeps the previous payload while a new one loads: never show another prompt's answers,
  // nor answers loaded for other filters. Switching AI / run inside the viewer keeps the dimmed old view.
  const scopeKey = target ? `${target.promptId}|${radarQuery(projectId, filters)}` : "";
  const loadedRaw = useRef<unknown>(null);
  const loadedScope = useRef("");
  if (raw !== loadedRaw.current) { loadedRaw.current = raw; loadedScope.current = scopeKey; }
  const data = raw && target && raw.prompt.id === target.promptId && loadedScope.current === scopeKey ? raw : null;

  const samples = useMemo(() => data?.samples ?? [], [data]);
  const current = useMemo(() => {
    if (samples.length === 0) return null;
    return samples.find((s) => s.id === sampleId) ?? samples.find((s) => s.status === "DONE") ?? samples[0];
  }, [samples, sampleId]);
  const curIdx = current ? samples.indexOf(current) : -1;

  const styles = useMemo(() => {
    const map = new Map<string, EntityStyle>();
    let c = 0;
    for (const e of data?.summary?.entities ?? []) {
      map.set(e.key, { key: e.key, name: e.name, brand: e.entityType === "brand", cls: e.entityType === "brand" ? BRAND_MARK : COMPETITOR_MARKS[c++ % COMPETITOR_MARKS.length] });
    }
    for (const s of samples) {
      for (const m of s.mentions) {
        if (!map.has(m.key)) map.set(m.key, { key: m.key, name: m.name, brand: m.entityType === "brand", cls: m.entityType === "brand" ? BRAND_MARK : COMPETITOR_MARKS[c++ % COMPETITOR_MARKS.length] });
      }
    }
    return map;
  }, [data, samples]);

  const rendered = useMemo(() => {
    if (!current || !current.responseText) return null;
    const citeNo = new Map<string, number>();
    current.citations.forEach((c, i) => { const k = urlKey(c.url); if (!citeNo.has(k)) citeNo.set(k, i + 1); });
    return renderMarkdown(current.responseText, { hl: buildHighlighter(current, styles), citeNo, seenEntity: new Set() });
  }, [current, styles]);

  const go = useCallback((delta: number) => {
    if (samples.length === 0 || curIdx < 0) return;
    const next = samples[(curIdx + delta + samples.length) % samples.length];
    setSampleId(next.id);
    bodyRef.current?.scrollTo({ top: 0 });
  }, [samples, curIdx]);

  // ← / → switch between repeat asks
  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.getAttribute("role") === "combobox")) return;
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target, go]);

  const jumpTo = (key: string) => {
    const el = bodyRef.current?.querySelector<HTMLElement>(`[data-entity="${CSS.escape(key)}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-brand-blue");
    window.setTimeout(() => el.classList.remove("ring-2", "ring-brand-blue"), 1400);
  };

  const copy = async () => {
    if (!current?.responseText) return;
    try {
      await navigator.clipboard.writeText(current.responseText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked: nothing to do */ }
  };

  const sum = data?.summary;
  const brandRate = sum && sum.asked > 0 ? sum.brandMentioned / sum.asked : null;
  const mentionsSorted = current ? [...current.mentions].sort((a, b) => (a.position ?? 999) - (b.position ?? 999)) : [];
  const otherEntities = current?.otherEntities ?? [];
  const unlinked = mentionsSorted.filter((m) => !m.linked);
  // Read from the row, not from PROVIDERS: answers collected before a platform changed source keep their own method
  const method = current?.collectionMethod;
  const methodChip = method === "observed_serp" ? "Google จริง" : method === "observed_chat" ? "คำตอบจริงจากแอป" : method === "imported" ? "นำเข้า" : "API";
  const methodNote =
    method === "observed_serp" ? "ข้อความนี้เก็บจากหน้า Google จริงผ่าน DataForSEO"
    : method === "observed_chat" ? "คำตอบนี้อ่านจากหน้าแอปจริงผ่าน DataForSEO แบบผู้ใช้ที่ไม่ได้ login คำตอบของผู้ใช้ที่ login อาจต่างออกไป"
    : method === "imported" ? "คำตอบนี้นำเข้าจากไฟล์"
    : "คำตอบนี้ได้จากการถาม AI ผ่าน API พร้อมค้นเว็บ อาจไม่ตรงกับที่ผู้ใช้เห็นในแอปทุกคำ";

  return (
    <Sheet open={!!target} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="flex w-full max-w-full flex-col gap-0 overflow-x-hidden p-0 sm:max-w-[min(1200px,96vw)]">
        {/* Header */}
        <div className="space-y-3 border-b border-gray-100 px-5 pb-3 pt-4 pr-12">
          <SheetTitle className="break-words text-base font-semibold leading-snug">{data?.prompt.text ?? "คำตอบของ AI"}</SheetTitle>
          <SheetDescription className="sr-only">คำตอบเต็มของ AI สำหรับ Prompt นี้ พร้อมชื่อแบรนด์ที่ถูกพูดถึงและลิงก์อ้างอิง</SheetDescription>
          {data ? (
            <div className="flex flex-wrap items-center gap-2">
              <Select value={data.provider ?? ""} onValueChange={(v) => { setProvider(v); setSampleId(""); }}>
                <SelectTrigger className="h-9 w-auto min-w-[9rem] max-w-full text-xs sm:min-w-[11rem]"><SelectValue placeholder="เลือก AI" /></SelectTrigger>
                <SelectContent>
                  {data.providers.map((p) => (
                    <SelectItem key={p.provider} value={p.provider} className="text-xs">
                      <span className="inline-flex items-center gap-1.5"><ProviderLogo provider={p.provider} size={16} />{providerShort(p.provider)} · เราขึ้น {p.brandMentions}/{p.responses}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={data.runId ?? ""} onValueChange={(v) => { setRunId(v); setSampleId(""); }}>
                <SelectTrigger className="h-9 w-auto min-w-[9rem] max-w-full text-xs sm:min-w-[10rem]"><SelectValue placeholder="เลือกรอบสแกน" /></SelectTrigger>
                <SelectContent>
                  {data.runs.map((r) => (
                    <SelectItem key={r.runId} value={r.runId} className="text-xs">สแกน {fmtDateTime(r.date)} · {r.providers.length} AI</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Chip tone="muted">{data.prompt.country}{data.prompt.language ? ` · ${data.prompt.language}` : ""}</Chip>
              {data.prompt.topic ? <Chip tone="muted">{data.prompt.topic}</Chip> : null}
            </div>
          ) : null}
          {/* Summary across repeat asks */}
          {sum && sum.asked > 0 ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-700">
              <span>
                ถาม {providerShort(data?.provider ?? "")} ซ้ำ <b>{sum.asked}</b> ครั้งในรอบนี้ · {data?.brandName || "แบรนด์เรา"} ถูกพูดถึง{" "}
                <b>{sum.brandMentioned}/{sum.asked}</b> ({fmtPct(brandRate, 0)}{fmtRange(brandRate, sum.asked) ? `, ช่วง ${fmtRange(brandRate, sum.asked)}` : ""})
              </span>
              <span>ถูกแนะนำ <b>{sum.brandRecommended}/{sum.asked}</b></span>
              <span>มีลิงก์เว็บเรา <b>{sum.ownedCited}/{sum.asked}</b></span>
              {isSmallSample(sum.asked) ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">ตัวอย่างน้อย</span> : null}
            </div>
          ) : null}
        </div>

        {!data ? (
          <div className="p-6"><LoadState loading={loading} error={error} onRetry={reload} clientView={clientView} /></div>
        ) : samples.length === 0 || !current ? (
          <p className="p-6 text-sm text-gray-500">
            {data.runs.length === 0 ? "ยังไม่มีคำตอบของ Prompt นี้ในช่วงวันที่ / ประเทศ / ภาษาที่เลือก" : "AI ตัวนี้ไม่มีคำตอบในรอบสแกนที่เลือก"}
          </p>
        ) : (
          <div className={cn("grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px]", loading && "opacity-60")}>
            {/* Answer */}
            <div ref={bodyRef} className="min-h-0 min-w-0 overflow-y-auto px-4 py-4 sm:px-5">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {samples.length > 1 ? (
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="outline" className="h-9 w-9 p-0 sm:h-7 sm:w-7" onClick={() => go(-1)} aria-label="คำตอบก่อนหน้า"><ChevronLeft className="h-4 w-4" /></Button>
                    <div className="flex flex-wrap gap-1">
                      {samples.map((s, i) => {
                        const failed = s.status !== "DONE";
                        return (
                          <button key={s.id} type="button" onClick={() => { setSampleId(s.id); bodyRef.current?.scrollTo({ top: 0 }); }}
                            title={failed ? (clientView ? `ครั้งที่ ${i + 1}: ยังไม่พร้อมแสดง` : `ครั้งที่ ${i + 1}: ${s.status}`) : s.brandMentioned ? `ครั้งที่ ${i + 1}: พูดถึงเรา` : `ครั้งที่ ${i + 1}: ไม่พูดถึงเรา`}
                            className={cn(
                              "h-9 min-w-9 rounded-lg border px-1.5 text-xs tabular-nums sm:h-7 sm:min-w-7",
                              s.id === current.id ? "border-brand-blue bg-brand-blue text-white" : "border-gray-200 bg-white hover:bg-gray-50",
                            )}>
                            <span className="inline-flex items-center gap-1">
                              <span className={cn("h-1.5 w-1.5 rounded-full", failed ? "bg-red-500" : s.brandMentioned ? "bg-emerald-500" : "bg-gray-300")} />
                              {i + 1}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <Button size="sm" variant="outline" className="h-9 w-9 p-0 sm:h-7 sm:w-7" onClick={() => go(1)} aria-label="คำตอบถัดไป"><ChevronRight className="h-4 w-4" /></Button>
                  </div>
                ) : null}
                <div className="ml-auto flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500">
                  {clientView ? null : <span>{current.model || "-"}</span>}
                  {clientView ? null : <Chip tone={method === "observed_chat" || method === "observed_serp" ? "info" : "muted"}>{methodChip}</Chip>}
                  <span>{fmtDateTime(current.collectedAt)}</span>
                  {!clientView && current.costUsd !== null ? <span>{fmtUsd(current.costUsd)}</span> : null}
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={copy} disabled={!current.responseText}>
                    {copied ? <Check className="mr-1 h-3.5 w-3.5" /> : <Copy className="mr-1 h-3.5 w-3.5" />}{copied ? "คัดลอกแล้ว" : "คัดลอก"}
                  </Button>
                </div>
              </div>
              {clientView ? null : (
                <p className="mb-3 flex items-start gap-1.5 text-[11px] leading-4 text-gray-500">
                  <Info className="mt-px h-3.5 w-3.5 shrink-0" />
                  {methodNote}
                </p>
              )}
              {(current.searchQueries ?? []).length > 0 ? (
                <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-gray-600">
                  <span>AI ค้นหาด้วยคำว่า</span>
                  {(current.searchQueries ?? []).map((q, i) => <Chip key={`${q}-${i}`} tone="info">{q}</Chip>)}
                </div>
              ) : null}
              {current.sentiment && (current.sentiment.entities ?? []).length > 0 ? (
                <ul className="mb-3 space-y-1 rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-700">
                  {current.sentiment.entities.map((e) => (
                    <li key={e.key} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <b>{e.name}</b>
                      <Chip tone={e.tone === "positive" ? "ok" : e.tone === "negative" ? "bad" : e.tone === "mixed" ? "warn" : "muted"}>{SENTIMENT_TONE_LABEL[e.tone] ?? e.tone}</Chip>
                      {(e.positioning ?? []).map((p) => <Chip key={p} tone="muted">{BRAND_POSITIONING_LABEL[p] ?? p}</Chip>)}
                      {e.summary ? <span className="text-gray-600">{e.summary}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              {current.status !== "DONE" ? (
                <p className="rounded-xl bg-red-50 p-3 text-xs text-red-700">{clientView ? "คำตอบนี้ยังไม่พร้อมแสดง" : `${current.status}: ${current.error || "ไม่มีรายละเอียดข้อผิดพลาด"}`}</p>
              ) : rendered && rendered.length > 0 ? (
                <article className="break-words text-[14px] leading-7 text-gray-800">{rendered}</article>
              ) : (
                <p className="text-sm text-gray-500">คำตอบว่าง</p>
              )}
            </div>

            {/* Side panel */}
            <aside className="min-h-0 min-w-0 space-y-5 overflow-y-auto border-t border-gray-100 bg-gray-50/50 px-4 py-4 lg:border-l lg:border-t-0">
              <div className="flex rounded-lg border border-gray-200 bg-white p-0.5 text-xs">
                {([["answer", `คำตอบที่ ${curIdx + 1}`], ["all", `รวม ${sum?.asked ?? 0} คำตอบ`]] as const).map(([k, label]) => (
                  <button key={k} type="button" onClick={() => setSideTab(k)}
                    className={cn("min-h-[36px] flex-1 rounded-md px-2 py-1", sideTab === k ? "bg-brand-blue text-white" : "text-gray-600 hover:bg-gray-50")}>{label}</button>
                ))}
              </div>

              {sideTab === "answer" ? (
                <>
                  <Section title="ชื่อที่ถูกพูดถึง" count={mentionsSorted.length} note="เรียงตามลำดับที่ปรากฏในคำตอบ กดเพื่อเลื่อนไปจุดนั้น">
                    {mentionsSorted.length === 0 ? (
                      <p className="text-xs text-gray-500">คำตอบนี้ไม่พูดถึงแบรนด์เราหรือคู่แข่งที่ตั้งไว้</p>
                    ) : (
                      <ol className="space-y-1">
                        {mentionsSorted.map((m, i) => {
                          const st = styles.get(m.key);
                          return (
                            <li key={m.key}>
                              <button type="button" onClick={() => jumpTo(m.key)}
                                className="flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg px-1.5 py-1 text-left text-xs hover:bg-white">
                                <span className="w-4 shrink-0 text-right tabular-nums text-gray-400">{i + 1}</span>
                                <Favicon domain={data.entityDomains?.[m.key]} label={m.name} />
                                <span className={cn("truncate rounded px-1.5 py-0.5 font-medium", st?.cls)}>{m.name}</span>
                                <span className="text-gray-500">×{m.occurrences}</span>
                                <span className="text-[11px] text-gray-500">{fmtAnswerPos(m.positionPct)}</span>
                                <span className="ml-auto flex shrink-0 gap-1">
                                  {m.recommended ? <Chip tone="ok">แนะนำ</Chip> : null}
                                  {m.compared ? <Chip tone="muted">เทียบ</Chip> : null}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </Section>

                  {otherEntities.length === 0 ? null : (
                    <Section title="แบรนด์อื่นที่ AI พูดถึง" count={otherEntities.length}
                      note="ชื่อแบรนด์ที่ AI เอ่ยถึงแต่ไม่อยู่ในรายการติดตาม กดเพื่อเลื่อนไปจุดนั้น">
                      <ul className="space-y-1">
                        {otherEntities.map((o, i) => (
                          <li key={`${o.name}-${i}`}>
                            <button type="button" onClick={() => jumpTo("other:" + o.name.trim().toLowerCase())}
                              className="flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg px-1.5 py-1 text-left text-xs hover:bg-white">
                              <Favicon domain={o.domain || undefined} label={o.name} />
                              <span className={cn("min-w-0 truncate", OTHER_MARK)}>{o.name}</span>
                              {o.category ? <Chip tone="muted">{o.category}</Chip> : null}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </Section>
                  )}

                  <Section title="หน้าที่ถูกอ้างอิง" count={current.citations.length}>
                    {current.citations.length === 0 ? (
                      <p className="text-xs text-gray-500">คำตอบนี้ไม่มีลิงก์อ้างอิง</p>
                    ) : (
                      <ol className="space-y-2">
                        {current.citations.map((c, i) => {
                          const safe = /^https?:\/\//i.test(c.url);
                          const path = pathOf(c.url);
                          return (
                            <li key={`${c.url}-${i}`} className="flex items-start gap-2 text-xs">
                              <span className="w-4 shrink-0 pt-0.5 text-right tabular-nums text-gray-400">{i + 1}</span>
                              <Favicon domain={c.domain} label={c.domain} />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                                  <div className="flex min-w-0 max-w-full items-baseline gap-1">
                                    {safe ? (
                                      <a href={c.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex shrink-0 items-center gap-1 font-medium text-brand-blue hover:underline">
                                        {c.domain}<ExternalLink className="h-3 w-3" />
                                      </a>
                                    ) : <span className="shrink-0 font-medium">{c.domain}</span>}
                                    {path ? <span className="min-w-0 truncate text-gray-400" title={path}>{path}</span> : null}
                                  </div>
                                  <Chip tone={OWNER_TONE[c.ownerType]}>{OWNER_LABEL[c.ownerType]}</Chip>
                                  {clientView ? null : <VendorChips vendor={c.vendor} isOwnPbn={c.isOwnPbn} />}
                                </div>
                                {c.title ? <p className="truncate text-gray-600" title={c.title}>{c.title}</p> : null}
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </Section>

                  <Section title="เจอแต่ไม่ได้อ้างอิง" count={(current.foundSources ?? []).length}
                    note="หน้าที่ AI ค้นเจอระหว่างหาคำตอบ แต่ไม่ได้นำมาอ้างอิงในคำตอบ">
                    {(current.foundSources ?? []).length === 0 ? (
                      <p className="text-xs text-gray-500">
                        {current.provider === "openai"
                          ? "คำตอบนี้ไม่มีหน้าที่ค้นเจอแต่ไม่ได้นำมาอ้างอิง"
                          : "แพลตฟอร์มนี้ไม่ส่งรายการหน้าที่ค้นเจอแต่ไม่ได้อ้างอิงมาให้ จึงไม่แสดงแทนด้วยการเดา"}
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {(current.foundSources ?? []).map((f, i) => {
                          const safe = /^https?:\/\//i.test(f.url);
                          const path = pathOf(f.url);
                          return (
                            <li key={`${f.url}-${i}`} className="flex items-start gap-2 text-xs">
                              <Favicon domain={f.domain} label={f.domain} />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                                  <div className="flex min-w-0 max-w-full items-baseline gap-1">
                                    {safe ? (
                                      <a href={f.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex shrink-0 items-center gap-1 font-medium text-brand-blue hover:underline">
                                        {f.domain}<ExternalLink className="h-3 w-3" />
                                      </a>
                                    ) : <span className="shrink-0 font-medium">{f.domain}</span>}
                                    {path ? <span className="min-w-0 truncate text-gray-400" title={path}>{path}</span> : null}
                                  </div>
                                  {f.ownerType === "own" || f.ownerType === "competitor" ? <Chip tone={OWNER_TONE[f.ownerType]}>{OWNER_LABEL[f.ownerType]}</Chip> : null}
                                </div>
                                {f.title ? <p className="truncate text-gray-600" title={f.title}>{f.title}</p> : null}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </Section>

                  <Section title="พูดถึงแต่ไม่ลิงก์เว็บ" count={unlinked.length}
                    note="แบรนด์ที่ AI เอ่ยชื่อ แต่ไม่ได้ใส่ลิงก์ไปเว็บของแบรนด์นั้น (ถ้าเป็นเรา = โอกาสทำให้เว็บเราถูกอ้างอิง)">
                    {unlinked.length === 0 ? (
                      <p className="text-xs text-gray-500">ไม่มี</p>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {unlinked.map((m) => <span key={m.key} className={cn("rounded px-1.5 py-0.5 text-xs", styles.get(m.key)?.cls)}>{m.name}</span>)}
                      </div>
                    )}
                  </Section>
                </>
              ) : sum ? (
                <>
                  <Section title="ใครถูกพูดถึงบ่อยแค่ไหน" count={sum.entities?.length ?? 0} note={`นับจาก ${sum.asked} คำตอบของ ${providerShort(data.provider ?? "")} ในรอบนี้`}>
                    {(sum.entities ?? []).length === 0 ? <p className="text-xs text-gray-500">ไม่มี</p> : (
                      <>
                      <p className="mb-1.5 text-[11px] leading-4 text-gray-500">ตำแหน่งในคำตอบ = % ของคำตอบที่ AI เริ่มพูดถึงชื่อนั้นในแต่ละช่วง ({ANSWER_ZONE_LEGEND})</p>
                      <ul className="space-y-1.5">
                        {(sum.entities ?? []).map((e) => {
                          const rate = sum.asked > 0 ? e.answers / sum.asked : 0;
                          return (
                            <li key={e.key} className="text-xs">
                              <div className="flex items-center gap-2">
                                <span className={cn("truncate rounded px-1.5 py-0.5 font-medium", styles.get(e.key)?.cls)}>{e.name}</span>
                                <span className="ml-auto shrink-0 tabular-nums text-gray-600">{e.answers}/{sum.asked}</span>
                              </div>
                              <div className="mt-1 h-1.5 rounded-full bg-gray-200">
                                <div className="h-1.5 rounded-full bg-brand-blue" style={{ width: `${Math.round(rate * 100)}%` }} />
                              </div>
                              <p className="mt-0.5 text-[11px] text-gray-500">
                                แนะนำ {e.recommended} ครั้ง{e.avgPosition !== null ? ` · ลำดับที่ปรากฏเฉลี่ย ${e.avgPosition.toFixed(1)}` : ""}
                              </p>
                              {fmtZoneShare(e.zones) ? (
                                <p className="mt-0.5 text-[11px] text-gray-500">ตำแหน่งในคำตอบ: {fmtZoneShare(e.zones)}</p>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                      </>
                    )}
                  </Section>
                  <Section title="เว็บที่ถูกอ้างอิง" count={sum.domains?.length ?? 0} note="จำนวนคำตอบที่มีลิงก์ไปเว็บนั้น">
                    {(sum.domains ?? []).length === 0 ? <p className="text-xs text-gray-500">ไม่มีลิงก์อ้างอิง</p> : (
                      <ul className="space-y-1">
                        {(sum.domains ?? []).map((d) => (
                          <li key={d.domain} className="flex flex-wrap items-center gap-1 text-xs">
                            <span className="min-w-0 break-all font-medium">{d.domain}</span>
                            <Chip tone={OWNER_TONE[d.ownerType]}>{OWNER_LABEL[d.ownerType]}</Chip>
                            {clientView ? null : <VendorChips vendor={d.vendor} isOwnPbn={d.isOwnPbn} />}
                            <span className="ml-auto tabular-nums text-gray-600">{d.answers}/{sum.asked}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Section>
                </>
              ) : null}
            </aside>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
