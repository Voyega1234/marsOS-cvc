"use client";

/**
 * Brand Radar: shared helpers for the prompt / competitor / citation tabs
 * (data hook, load-state box, entity table, cited-websites table, prompt dialogs, CSV parser).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Download, ExternalLink, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Chip, EmptyState, MeterBar, downloadCsv } from "@/components/ds";
import {
  COUNTRIES, JOURNEY_STAGES, LANGUAGES, LIMITS, PRIORITIES, PROMPT_INTENTS, PROMPT_INTENT_LABEL, PROMPT_SOURCE_LABEL,
  type CitedDomainRow, type EntityShare, type JourneyStage, type Priority, type PromptCandidate,
  type PromptDTO, type PromptGenerateRes, type PromptInput, type PromptIntent, type PromptSaveRes, type PromptSource, type PromptStatus,
} from "@/lib/brand-radar/types";
import { ColumnHelp } from "./ColumnHelp";
import { ProviderLogo } from "./ProviderLogo";
import { ANSWER_ZONE_LEGEND, api, clearRadarCache, domainHref, fmtNum, fmtPct, fmtZoneShare, postJson, providerShort, radarCacheGeneration, radarCacheGet, radarCacheSet } from "./shared";

export const SELECT_CLS = "h-9 rounded-full border border-gray-200 bg-white px-3 text-xs";
const INPUT_CLS = "h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm";

// ── data hook + state box ────────────────────────────────────────────────────

/**
 * Fetches `url`. With `swr` (report tabs) a repeat visit to the same url shows the last loaded data at once
 * and refetches in the background; a background failure keeps what is on screen.
 */
export function useApiData<T>(url: string, refreshKey: number, swr = false) {
  const [data, setData] = useState<T | null>(() => (swr ? radarCacheGet<T>(url, refreshKey) : null));
  const [loading, setLoading] = useState(() => !(swr && radarCacheGet<T>(url, refreshKey) !== null));
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) { setLoading(false); return; }
    let dead = false;
    const controller = new AbortController();
    const cached = swr ? radarCacheGet<T>(url, refreshKey) : null;
    const gen = radarCacheGeneration();
    setError("");
    if (cached !== null) { setData(cached); setLoading(false); }
    else setLoading(true);
    void api<T>(url, { signal: controller.signal }).then((r) => {
      if (dead) return;
      if (!r.ok) {
        if (cached !== null) return;
        setError(r.data.error || "โหลดข้อมูลไม่สำเร็จ"); setData(null);
      } else {
        if (swr) radarCacheSet(url, refreshKey, r.data, gen);
        setData(r.data as T);
      }
      setLoading(false);
    });
    return () => { dead = true; controller.abort(); };
  }, [url, refreshKey, tick, swr]);
  const reload = useCallback(() => { clearRadarCache(); setTick((t) => t + 1); }, []);
  return { data, loading, error, reload };
}

/** Loading / error-with-retry box; returns null when there is nothing to show instead of the data */
export function LoadState({ loading, error, onRetry, clientView }: { loading: boolean; error: string; onRetry: () => void; clientView?: boolean }) {
  if (loading) return <EmptyState icon={<Loader2 className="h-5 w-5 animate-spin" />} title="กำลังโหลด..." />;
  if (error) {
    if (clientView) console.error("brand-radar load:", error);
    return (
      <EmptyState
        icon={<AlertTriangle className="h-5 w-5" />}
        title="โหลดข้อมูลไม่สำเร็จ"
        description={clientView ? "โหลดข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง" : error}
        action={<Button size="sm" variant="outline" onClick={onRetry}>ลองใหม่</Button>}
      />
    );
  }
  return null;
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-4 py-3 text-xs text-gray-500">
      <span>{fmtNum(total)} รายการ · หน้า {page}/{pages}</span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="min-h-[36px]" disabled={page <= 1} onClick={() => onPage(page - 1)}>ก่อนหน้า</Button>
        <Button size="sm" variant="outline" className="min-h-[36px]" disabled={page >= pages} onClick={() => onPage(page + 1)}>ถัดไป</Button>
      </div>
    </div>
  );
}

// ── entity table (brand vs competitors) ──────────────────────────────────────

export function EntityTable({ entities, focusName, focusSeq }: { entities: EntityShare[]; focusName?: string; focusSeq?: number }) {
  // Deep link: mark the row whose name matches focusName, scroll to it, and drop the mark after ~4 s
  const wanted = focusName?.trim().toLowerCase() ?? "";
  const [marked, setMarked] = useState("");
  const markedRef = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => {
    if (!wanted) return;
    const hit = entities.find((e) => e.name.trim().toLowerCase() === wanted);
    if (!hit) return;
    setMarked(hit.key);
    const timer = window.setTimeout(() => setMarked(""), 4000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, focusSeq]);
  useEffect(() => {
    if (marked) markedRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [marked]);
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[640px]">
        <TableHeader>
          <TableRow>
            <TableHead><ColumnHelp k="entityName" align="start">Name</ColumnHelp></TableHead>
            <TableHead className="text-right"><ColumnHelp k="entityMentions" align="end">Mentions</ColumnHelp></TableHead>
            <TableHead className="min-w-[180px]"><ColumnHelp k="entityAppearance">Appearance %</ColumnHelp></TableHead>
            <TableHead className="text-right"><ColumnHelp k="entityRecommended" align="end">Recommended</ColumnHelp></TableHead>
            <TableHead className="text-right"><ColumnHelp k="entityCited" align="end">Cited</ColumnHelp></TableHead>
            <TableHead className="text-right"><ColumnHelp k="avgPosition" align="end">Avg position</ColumnHelp></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entities.map((e) => (
            <TableRow
              key={e.key}
              ref={e.key === marked ? markedRef : undefined}
              className={cn(e.entityType === "brand" && "bg-brand-mist/60 font-medium", e.key === marked && "ring-2 ring-inset ring-brand-blue bg-brand-mist/60 transition-shadow")}
            >
              <TableCell>
                {e.name} {e.entityType === "brand" ? <Chip tone="info" className="ml-1">แบรนด์เรา</Chip> : null}
              </TableCell>
              <TableCell className="text-right tabular-nums">{fmtNum(e.mentions)}</TableCell>
              <TableCell>
                {e.mentionRate === null ? (
                  <span className="text-xs text-gray-500">{fmtPct(null)}</span>
                ) : (
                  <div className="flex items-center gap-2">
                    <MeterBar value={e.mentionRate * 100} max={100} tone={e.entityType === "brand" ? "blue" : "navy"} className="w-24" />
                    <span className="text-xs tabular-nums">{fmtPct(e.mentionRate)}</span>
                  </div>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">{fmtNum(e.recommended)} ครั้ง</TableCell>
              <TableCell className="text-right tabular-nums">{fmtNum(e.cited)} ครั้ง</TableCell>
              <TableCell className="text-right tabular-nums">{e.avgPosition === null ? "N/A" : e.avgPosition.toFixed(1)}
                {fmtZoneShare(e.zones) && <span className="block text-[11px] font-normal text-gray-500" title={ANSWER_ZONE_LEGEND}>{fmtZoneShare(e.zones)}</span>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ── cited websites table ─────────────────────────────────────────────────────

function ownerText(r: CitedDomainRow): string {
  if (r.ownerType === "own") return "Own";
  if (r.ownerType === "competitor") return `Competitor: ${r.competitorName || "-"}`;
  return "External";
}

function vendorText(v: NonNullable<CitedDomainRow["vendor"]>): { price: string; dr: string; linkType: string } {
  return {
    price: v.price === null ? "N/A" : `${fmtNum(v.price)} ${v.currency || ""}`.trim(),
    dr: fmtNum(v.domainRating),
    linkType: v.linkType ? v.linkType : "N/A",
  };
}

export function exportCitedCsv(filename: string, rows: CitedDomainRow[], clientView?: boolean) {
  const head = ["Domain", "Owner", "Citations", "Responses", "Prompts", "AI platforms", "Example URLs", "In backlink library", "Price", "Currency", "DR", "Link type", "Own PBN"];
  const body = rows.map((r) => {
    const v = r.vendor;
    if (clientView) {
      return [
        r.domain, ownerText(r), r.citations, r.responses, r.prompts,
        r.providers.map(providerShort).join("; "), r.urls.map((u) => u.url).join(" "),
      ];
    }
    return [
      r.domain, ownerText(r), r.citations, r.responses, r.prompts,
      r.providers.map(providerShort).join("; "), r.urls.map((u) => u.url).join(" "),
      v ? "yes" : "no", v ? (v.price === null ? "N/A" : v.price) : "", v ? v.currency : "",
      v ? (v.domainRating === null ? "N/A" : v.domainRating) : "", v ? (v.linkType || "N/A") : "",
      r.isOwnPbn ? "yes" : "no",
    ];
  });
  downloadCsv(filename, [clientView ? head.slice(0, 7) : head, ...body]);
}

function safeHref(url: string): string | null {
  return /^https?:\/\//i.test(url) ? url : null;
}

export function CitedDomainsTable({ rows, clientView }: { rows: CitedDomainRow[]; clientView?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[760px]">
        <TableHeader>
          <TableRow>
            <TableHead><ColumnHelp k="domain" align="start">Domain</ColumnHelp></TableHead>
            <TableHead><ColumnHelp k="ownerType" align="start">Owner</ColumnHelp></TableHead>
            <TableHead className="text-right"><ColumnHelp k="citedDomainLinks" align="end">Citations</ColumnHelp></TableHead>
            <TableHead className="text-right"><ColumnHelp k="citedDomainResponses" align="end">Responses</ColumnHelp></TableHead>
            <TableHead><ColumnHelp k="citedDomainPlatforms" align="start">AI platforms</ColumnHelp></TableHead>
            <TableHead className="min-w-[220px]"><ColumnHelp k="citedDomainExamples" align="start">Example URLs</ColumnHelp></TableHead>
            {clientView ? null : <TableHead className="min-w-[200px]"><ColumnHelp k="backlinkAvailable" align="start">ซื้อ backlink ได้?</ColumnHelp></TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.domain}>
              <TableCell className="whitespace-nowrap">
                {domainHref(r.domain) ? (
                  <a href={domainHref(r.domain) ?? undefined} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand-blue hover:underline">
                    {r.domain} <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  <span className="inline-flex items-center gap-1 font-medium">{r.domain}</span>
                )}
              </TableCell>
              <TableCell>
                <Chip tone={r.ownerType === "own" ? "ok" : r.ownerType === "competitor" ? "warn" : "muted"}>{ownerText(r)}</Chip>
              </TableCell>
              <TableCell className="text-right tabular-nums">{fmtNum(r.citations)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtNum(r.responses)}</TableCell>
              <TableCell className="text-xs">{r.providers.length ? <span className="flex flex-wrap gap-1">{r.providers.map((p) => <ProviderLogo key={p} provider={p} size={16} />)}</span> : "-"}</TableCell>
              <TableCell>
                <ul className="space-y-0.5 text-xs">
                  {r.urls.slice(0, 5).map((u) => {
                    const href = safeHref(u.url);
                    return (
                      <li key={u.url} className="max-w-[320px] truncate">
                        {href ? (
                          <a href={href} target="_blank" rel="noopener noreferrer" title={u.title || u.url} className="text-brand-blue hover:underline">
                            {u.title || u.url}
                          </a>
                        ) : <span>{u.url}</span>}
                        <span className="ml-1 text-gray-400">×{u.count}</span>
                      </li>
                    );
                  })}
                  {r.urls.length === 0 ? <li className="text-gray-400">-</li> : null}
                </ul>
              </TableCell>
              {clientView ? null : <TableCell>
                <div className="flex flex-col items-start gap-1 text-xs">
                  {r.vendor ? (() => {
                    const v = vendorText(r.vendor);
                    return (
                      <>
                        <Chip tone="ok">อยู่ในคลัง Backlink</Chip>
                        <span>ราคา {v.price} · DR {v.dr} · {v.linkType}</span>
                      </>
                    );
                  })() : null}
                  {r.isOwnPbn ? <Chip tone="info">PBN ของเรา</Chip> : null}
                  {!r.vendor && !r.isOwnPbn ? <span className="text-gray-400">-</span> : null}
                </div>
              </TableCell>}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ── CSV parser (quoted fields, "" escapes, CRLF, BOM) ────────────────────────

export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { quoted = true; i++; continue; }
    if (ch === ",") { row.push(field); field = ""; i++; continue; }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = ""; rows.push(row); row = []; i++; continue;
    }
    field += ch; i++;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const CSV_HEADER = ["text", "topic", "intent", "journeyStage", "country", "language", "keyword", "searchVolume", "priority"];

export function downloadPromptTemplate() {
  downloadCsv("brand-radar-prompts-template.csv", [CSV_HEADER]);
}

/** CSV text -> PromptInput[] (invalid rows are counted, not guessed) */
export function csvToPrompts(text: string): { prompts: PromptInput[]; invalid: number; error: string } {
  const rows = parseCsv(text);
  if (rows.length < 2) return { prompts: [], invalid: 0, error: "ไฟล์ไม่มีข้อมูล (ต้องมีแถวหัวคอลัมน์ + อย่างน้อย 1 แถว)" };
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h));
  const iText = col("text", "prompt");
  if (iText < 0) return { prompts: [], invalid: 0, error: "ไม่พบคอลัมน์ text (หรือ prompt) ในแถวแรก" };
  const iTopic = col("topic"), iIntent = col("intent"), iJourney = col("journeystage"), iCountry = col("country"),
    iLang = col("language"), iKw = col("keyword"), iVol = col("searchvolume"), iPri = col("priority");
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const out: PromptInput[] = [];
  let invalid = 0;
  for (const r of rows.slice(1)) {
    const t = cell(r, iText);
    if (!t || t.length > LIMITS.promptTextMax) { invalid++; continue; }
    const intent = cell(r, iIntent).toLowerCase();
    const journey = cell(r, iJourney).toLowerCase();
    const pri = cell(r, iPri).toLowerCase();
    const volRaw = cell(r, iVol).replace(/,/g, "");
    const vol = volRaw !== "" && Number.isFinite(Number(volRaw)) && Number(volRaw) >= 0 ? Number(volRaw) : null;
    out.push({
      text: t,
      topic: cell(r, iTopic) || undefined,
      intent: (PROMPT_INTENTS as readonly string[]).includes(intent) ? (intent as PromptIntent) : undefined,
      journeyStage: (JOURNEY_STAGES as readonly string[]).includes(journey) ? (journey as JourneyStage) : undefined,
      country: cell(r, iCountry) || undefined,
      language: cell(r, iLang) || undefined,
      keyword: cell(r, iKw) || undefined,
      searchVolume: vol,
      priority: (PRIORITIES as readonly string[]).includes(pri) ? (pri as Priority) : undefined,
      source: "imported",
    });
  }
  return { prompts: out, invalid, error: "" };
}

// ── add / edit one prompt ────────────────────────────────────────────────────

export function PromptFormDialog({ projectId, prompt, topics, onClose, onSaved }: {
  projectId: string;
  /** null = create */
  prompt: PromptDTO | null;
  topics: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!prompt;
  const [text, setText] = useState(prompt?.text ?? "");
  const [topic, setTopic] = useState(prompt?.topic ?? "");
  const [intent, setIntent] = useState<string>(prompt?.intent ?? "");
  const [journey, setJourney] = useState<string>(prompt?.journeyStage ?? "awareness");
  const [keyword, setKeyword] = useState(prompt?.keyword ?? "");
  const [volume, setVolume] = useState(prompt?.searchVolume === null || prompt?.searchVolume === undefined ? "" : String(prompt.searchVolume));
  const [priority, setPriority] = useState<string>(prompt?.priority ?? "medium");
  // "" = follow the project profile (new prompts only)
  const [country, setCountry] = useState<string>(prompt?.country ?? "");
  const [language, setLanguage] = useState<string>(prompt?.language ?? "");
  const [startNow, setStartNow] = useState(true);
  const [busy, setBusy] = useState(false);

  async function save() {
    const t = text.trim();
    if (!t) { toast.error("กรอกข้อความ Prompt"); return; }
    if (t.length > LIMITS.promptTextMax) { toast.error(`ข้อความยาวเกิน ${LIMITS.promptTextMax} ตัวอักษร`); return; }
    const volTrim = volume.replace(/,/g, "").trim();
    if (volTrim !== "" && !(Number.isFinite(Number(volTrim)) && Number(volTrim) >= 0)) { toast.error("Search volume ต้องเป็นตัวเลข หรือเว้นว่างถ้าไม่ทราบ"); return; }
    const body: PromptInput = {
      text: t,
      topic: topic.trim(),
      journeyStage: journey as JourneyStage,
      keyword: keyword.trim(),
      searchVolume: volTrim === "" ? null : Number(volTrim),
      priority: priority as Priority,
    };
    if (intent) body.intent = intent as PromptIntent;
    // when editing, send country/language only if changed so a stored legacy code never blocks saving
    if (country && (!editing || country !== prompt?.country)) body.country = country;
    if (language && (!editing || language !== prompt?.language)) body.language = language;
    setBusy(true);
    if (editing && prompt) {
      const r = await api(`/api/brand-radar/prompts/${prompt.id}`, postJson({ projectId, ...body }, "PATCH"));
      setBusy(false);
      if (!r.ok) { toast.error(r.data.error || "บันทึกไม่สำเร็จ"); return; }
      toast.success("บันทึกแล้ว");
    } else {
      const r = await api<PromptSaveRes>("/api/brand-radar/prompts", postJson({
        projectId, prompts: [{ ...body, source: "manual", status: startNow ? "ACTIVE" : "CANDIDATE" }],
      }));
      setBusy(false);
      if (!r.ok) { toast.error(r.data.error || "บันทึกไม่สำเร็จ"); return; }
      if (r.data.created === 0) { toast.error(r.data.skipped?.[0]?.reason || "Prompt นี้มีอยู่แล้ว"); return; }
      toast.success("เพิ่ม Prompt แล้ว");
    }
    onSaved();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] w-full max-w-[calc(100vw-1.5rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>{editing ? "แก้ไข Prompt" : "เพิ่ม Prompt"}</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-600">ข้อความ Prompt ({text.length}/{LIMITS.promptTextMax})</span>
            <textarea value={text} maxLength={LIMITS.promptTextMax} onChange={(e) => setText(e.target.value)} rows={3}
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm" placeholder="คำถามที่ลูกค้าอาจถาม AI" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-600">Topic</span>
              <input list="br-topics" value={topic} onChange={(e) => setTopic(e.target.value)} className={INPUT_CLS} />
              <datalist id="br-topics">{topics.map((t) => <option key={t} value={t} />)}</datalist>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-600">Intent</span>
              <select value={intent} onChange={(e) => setIntent(e.target.value)} className={INPUT_CLS}>
                {!editing ? <option value="">ให้ระบบจัดให้</option> : null}
                {PROMPT_INTENTS.map((i) => <option key={i} value={i}>{PROMPT_INTENT_LABEL[i]}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-600">Journey stage</span>
              <select value={journey} onChange={(e) => setJourney(e.target.value)} className={INPUT_CLS}>
                {JOURNEY_STAGES.map((j) => <option key={j} value={j}>{j}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-600">Priority</span>
              <select value={priority} onChange={(e) => setPriority(e.target.value)} className={INPUT_CLS}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-600">ประเทศ</span>
              <select value={country} onChange={(e) => setCountry(e.target.value)} className={INPUT_CLS}>
                {!editing ? <option value="">ใช้ค่าจากโปรไฟล์ตอนนี้</option> : null}
                {editing && country && !COUNTRIES.some((c) => c.code === country) ? <option value={country}>{country}</option> : null}
                {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-600">ภาษาของคำถาม/คำตอบ</span>
              <select value={language} onChange={(e) => setLanguage(e.target.value)} className={INPUT_CLS}>
                {!editing ? <option value="">ใช้ค่าจากโปรไฟล์ตอนนี้</option> : null}
                {editing && language && !LANGUAGES.some((l) => l.code === language) ? <option value={language}>{language}</option> : null}
                {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            </label>
            {!editing ? (
              <p className="text-xs text-gray-500 sm:col-span-2">ค่านี้ถูกบันทึกกับคำถามตอนสร้าง ถ้าเปลี่ยนโปรไฟล์ภายหลัง คำถามเดิมไม่เปลี่ยนตาม</p>
            ) : null}
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-600">Keyword</span>
              <input value={keyword} onChange={(e) => setKeyword(e.target.value)} className={INPUT_CLS} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-600">Search volume (เว้นว่าง = ไม่ทราบ)</span>
              <input inputMode="numeric" value={volume} onChange={(e) => setVolume(e.target.value)} className={INPUT_CLS} />
            </label>
          </div>
          {!editing ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={startNow} onChange={(e) => setStartNow(e.target.checked)} />
              เริ่มติดตามทันที (ไม่ติ๊ก = เก็บเป็น Candidate)
            </label>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>ยกเลิก</Button>
          <Button onClick={save} disabled={busy}>{busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}บันทึก</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── candidate list (generate + import) ───────────────────────────────────────

interface CandItem { c: PromptCandidate; on: boolean }

function CandidateList({ items, setItems, editable }: { items: CandItem[]; setItems: (f: (prev: CandItem[]) => CandItem[]) => void; editable: boolean }) {
  const [editing, setEditing] = useState(-1);
  const upd = (i: number, f: (it: CandItem) => CandItem) => setItems((prev) => prev.map((it, k) => (k === i ? f(it) : it)));
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <button type="button" className="text-brand-blue hover:underline" onClick={() => setItems((p) => p.map((it) => ({ ...it, on: true })))}>เลือกทั้งหมด</button>
        <span className="text-gray-300">|</span>
        <button type="button" className="text-brand-blue hover:underline" onClick={() => setItems((p) => p.map((it) => ({ ...it, on: false })))}>ไม่เลือกเลย</button>
        <span className="ml-auto text-gray-500">เลือก {items.filter((i) => i.on).length} / {items.length}</span>
      </div>
      <div className="max-h-[320px] overflow-auto rounded-xl border border-gray-100">
        <ul className="divide-y divide-gray-100">
          {items.map((it, i) => (
            <li key={i} className="flex items-start gap-2 px-3 py-2 text-sm">
              <input type="checkbox" className="mt-1" checked={it.on} onChange={(e) => upd(i, (x) => ({ ...x, on: e.target.checked }))} />
              <div className="min-w-0 flex-1">
                {editing === i && editable ? (
                  <input autoFocus value={it.c.text} maxLength={LIMITS.promptTextMax} onChange={(e) => upd(i, (x) => ({ ...x, c: { ...x.c, text: e.target.value } }))}
                    onBlur={() => setEditing(-1)} onKeyDown={(e) => { if (e.key === "Enter") setEditing(-1); }}
                    className="h-8 w-full rounded-lg border border-gray-200 px-2 text-sm" />
                ) : (
                  <button type="button" className="text-left" onClick={() => editable && setEditing(i)} title={editable ? "คลิกเพื่อแก้ข้อความ" : undefined}>{it.c.text}</button>
                )}
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500">
                  {it.c.topic ? <span>{it.c.topic}</span> : null}
                  {it.c.intent ? <span>· {PROMPT_INTENT_LABEL[it.c.intent]}</span> : null}
                  <span>· volume {fmtNum(it.c.searchVolume)}</span>
                  {it.c.duplicateOf ? (
                    <Chip tone="warn">
                      ซ้ำกับ: {it.c.duplicateOf.text} ({fmtPct(it.c.duplicateOf.similarity, 0)}{it.c.duplicateOf.kind === "batch" ? ", ในชุดนี้" : ""})
                    </Chip>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function toItems(cands: PromptCandidate[]): CandItem[] {
  return cands.map((c) => ({ c, on: !c.duplicateOf }));
}

async function saveCandidates(projectId: string, items: CandItem[], startNow: boolean): Promise<PromptSaveRes | null> {
  const prompts: PromptInput[] = items.filter((i) => i.on).map((i) => {
    const { duplicateOf: _d, ...rest } = i.c;
    void _d;
    return { ...rest, text: rest.text.trim(), source: rest.source, status: (startNow ? "ACTIVE" : "CANDIDATE") as PromptStatus };
  }).filter((p) => p.text);
  if (prompts.length === 0) { toast.error("ยังไม่ได้เลือก Prompt"); return null; }
  const r = await api<PromptSaveRes>("/api/brand-radar/prompts", postJson({ projectId, prompts }));
  if (!r.ok) { toast.error(r.data.error || "บันทึกไม่สำเร็จ"); return null; }
  return { created: r.data.created, skipped: r.data.skipped ?? [] };
}

function SaveResult({ res }: { res: PromptSaveRes }) {
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-sm text-emerald-800">
      <p>บันทึกแล้ว {res.created} Prompt{res.skipped.length ? ` · ข้าม ${res.skipped.length} รายการ` : ""}</p>
      {res.skipped.length ? (
        <ul className="mt-1 max-h-32 list-disc space-y-0.5 overflow-auto pl-5 text-xs">
          {res.skipped.map((s, i) => <li key={i}>{s.text} — {s.reason}</li>)}
        </ul>
      ) : null}
    </div>
  );
}

// ── research dialog ──────────────────────────────────────────────────────────

const GEN_SOURCES: Array<{ value: Exclude<PromptSource, "manual" | "imported">; label: string; help: string }> = [
  { value: "ai_generated", label: "AI generated", help: "AI คิดคำถามให้จากข้อมูลแบรนด์ — ไม่ใช่คำถามจริงของผู้ใช้" },
  { value: "gsc", label: "Google Search Console", help: "ดึงคำค้นจริงที่คนค้นหาแล้วเจอเว็บของลูกค้า" },
  { value: "keyword_database", label: "Keyword database", help: "ดึงจากฐานคีย์เวิร์ดของระบบ" },
  { value: "paa_provider", label: "People Also Ask", help: "คำถามจากกล่อง People Also Ask ผ่านผู้ให้บริการ SERP" },
];

export function GeneratePromptsDialog({ projectId, onClose, onSaved }: { projectId: string; onClose: () => void; onSaved: () => void }) {
  const [source, setSource] = useState<(typeof GEN_SOURCES)[number]["value"]>("ai_generated");
  const [count, setCount] = useState<number>(LIMITS.generateMin);
  const [seed, setSeed] = useState("");
  const [busy, setBusy] = useState(false);
  const [gen, setGen] = useState<PromptGenerateRes | null>(null);
  const [items, setItems] = useState<CandItem[]>([]);
  const [startNow, setStartNow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<PromptSaveRes | null>(null);

  async function run() {
    setBusy(true); setGen(null); setItems([]); setResult(null);
    const r = await api<PromptGenerateRes>("/api/brand-radar/prompts/generate", postJson({
      projectId, source,
      ...(source === "ai_generated" ? { count, seed: seed.trim() || undefined } : {}),
    }));
    setBusy(false);
    if (!r.ok) { toast.error(r.data.error || "หา Prompt ไม่สำเร็จ"); return; }
    setGen(r.data);
    setItems(toItems(r.data.candidates ?? []));
  }

  async function save() {
    setSaving(true);
    const res = await saveCandidates(projectId, items, startNow);
    setSaving(false);
    if (!res) return;
    setResult(res);
    setItems((p) => p.filter((i) => !i.on));
    onSaved();
  }

  const help = GEN_SOURCES.find((s) => s.value === source)?.help;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] w-full max-w-[calc(100vw-1.5rem)] overflow-y-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle>หา Prompt</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block sm:col-span-1">
              <span className="mb-1 block text-xs font-medium text-gray-600">แหล่งที่มา</span>
              <select value={source} onChange={(e) => setSource(e.target.value as typeof source)} className={INPUT_CLS}>
                {GEN_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </label>
            {source === "ai_generated" ? (
              <>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-600">จำนวน ({LIMITS.generateMin}–{LIMITS.generateMax})</span>
                  <input type="number" min={LIMITS.generateMin} max={LIMITS.generateMax} value={count}
                    onChange={(e) => setCount(Math.min(LIMITS.generateMax, Math.max(LIMITS.generateMin, Number(e.target.value) || LIMITS.generateMin)))} className={INPUT_CLS} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-600">Topic ตั้งต้น (ไม่บังคับ)</span>
                  <input value={seed} onChange={(e) => setSeed(e.target.value)} className={INPUT_CLS} />
                </label>
              </>
            ) : null}
          </div>
          {help ? <p className="text-xs text-gray-500">{help}</p> : null}
          <Button onClick={run} disabled={busy}>{busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}หา Prompt</Button>

          {gen ? (
            <div className={`rounded-xl border p-3 text-sm font-medium ${gen.connected ? "border-amber-200 bg-amber-50/70 text-amber-800" : "border-gray-200 bg-gray-50 text-gray-700"}`}>
              {!gen.connected ? <p className="mb-1 text-xs font-semibold uppercase tracking-wide">ยังไม่ได้เชื่อมต่อ — {PROMPT_SOURCE_LABEL[gen.source]}</p> : null}
              <p>{gen.note}</p>
            </div>
          ) : null}
          {gen?.source === "ai_generated" && gen.connected ? (
            <p className="text-xs text-amber-700">Prompt ที่ AI สร้างไม่ใช่คำถามจริงของผู้ใช้ ใช้เป็นตัวแทนสำหรับทดสอบเท่านั้น</p>
          ) : null}
          {gen && gen.connected && items.length === 0 && !result ? <p className="text-xs text-gray-500">ไม่พบ Prompt ใหม่จากแหล่งนี้</p> : null}
          {gen?.connected && items.length > 0 ? <CandidateList items={items} setItems={setItems} editable /> : null}
          {result ? <SaveResult res={result} /> : null}
        </div>
        <DialogFooter className="items-center gap-2">
          {items.length > 0 ? (
            <label className="mr-auto flex items-center gap-2 text-xs">
              <input type="checkbox" checked={startNow} onChange={(e) => setStartNow(e.target.checked)} />
              เริ่มติดตามทันที (ไม่ติ๊ก = Candidate)
            </label>
          ) : null}
          <Button variant="outline" onClick={onClose}>ปิด</Button>
          {items.length > 0 ? (
            <Button onClick={save} disabled={saving || !items.some((i) => i.on)}>
              {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}บันทึกที่เลือก
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── CSV import dialog ────────────────────────────────────────────────────────

export function ImportPromptsDialog({ projectId, onClose, onSaved }: { projectId: string; onClose: () => void; onSaved: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [items, setItems] = useState<CandItem[]>([]);
  const [startNow, setStartNow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<PromptSaveRes | null>(null);

  async function onFile(f: File | undefined) {
    if (!f) return;
    setBusy(true); setNote(""); setItems([]); setResult(null);
    const text = await f.text();
    const parsed = csvToPrompts(text);
    if (parsed.error) { setBusy(false); setNote(parsed.error); return; }
    if (parsed.prompts.length === 0) { setBusy(false); setNote("ไม่มีแถวที่ใช้ได้"); return; }
    const r = await api<{ candidates: PromptCandidate[] }>("/api/brand-radar/prompts/check", postJson({ projectId, prompts: parsed.prompts }));
    setBusy(false);
    if (!r.ok) { toast.error(r.data.error || "ตรวจ Prompt ซ้ำไม่สำเร็จ"); return; }
    setItems(toItems((r.data.candidates ?? []).map((c) => ({ ...c, source: "imported" as const }))));
    setNote(parsed.invalid ? `ข้าม ${parsed.invalid} แถวที่ไม่มีข้อความหรือยาวเกิน ${LIMITS.promptTextMax} ตัวอักษร` : "");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function save() {
    setSaving(true);
    const res = await saveCandidates(projectId, items, startNow);
    setSaving(false);
    if (!res) return;
    setResult(res);
    setItems([]);
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] w-full max-w-[calc(100vw-1.5rem)] overflow-y-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle>นำเข้า Prompt จาก CSV</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-xs text-gray-500">
            หัวคอลัมน์: text (หรือ prompt), topic, intent, journeyStage, country, language, keyword, searchVolume, priority — volume ที่ว่างหรือไม่ใช่ตัวเลขจะถือว่าไม่ทราบ
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} className="text-xs" />
            <button type="button" onClick={downloadPromptTemplate} className="inline-flex items-center gap-1 text-xs text-brand-blue hover:underline">
              <Download className="h-3.5 w-3.5" /> ดาวน์โหลดไฟล์ตัวอย่าง
            </button>
          </div>
          {busy ? <p className="flex items-center gap-2 text-xs text-gray-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> กำลังอ่านและตรวจ Prompt ซ้ำ...</p> : null}
          {note ? <p className="text-xs text-amber-700">{note}</p> : null}
          {items.length > 0 ? <CandidateList items={items} setItems={setItems} editable={false} /> : null}
          {result ? <SaveResult res={result} /> : null}
        </div>
        <DialogFooter className="items-center gap-2">
          {items.length > 0 ? (
            <label className="mr-auto flex items-center gap-2 text-xs">
              <input type="checkbox" checked={startNow} onChange={(e) => setStartNow(e.target.checked)} />
              เริ่มติดตามทันที (ไม่ติ๊ก = Candidate)
            </label>
          ) : null}
          <Button variant="outline" onClick={onClose}>ปิด</Button>
          {items.length > 0 ? (
            <Button onClick={save} disabled={saving || !items.some((i) => i.on)}>
              {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}นำเข้าที่เลือก
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
