"use client";

/**
 * แท็บ Translate — แปลบทความอย่างเดียว (ไม่เขียนใหม่) ได้แถวใหม่ 1 แถว ต้นฉบับไม่ถูกแก้
 * แล้วเรียก generate ของแถวใหม่ให้ใส่ style ของเว็บเหมือนกดแท็บ Generate
 * ประมวลผลทีละบทความ (ไม่ขนาน) — ไม่เขียนค่าใหม่ลง pushPrefs
 * นำเข้าต้นฉบับได้ในแท็บนี้เลย (กล่องเดียวกับ Import Article) — แถวที่เพิ่งนำเข้าถูกติ๊กให้พร้อมแปล
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, ArrowRight, CheckSquare, Square, Loader2, CheckCircle2, AlertCircle, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import ArticleFrame from "@/components/shared/ArticleFrame";
import ImportBox from "@/components/upload-article/shared/ImportBox";
import type { UploadArticleDTO, UploadClientDTO, UploadOutputMode } from "@/lib/upload-article/types";
import type { SettingsSection } from "../settings/SettingsTab";
import { toReadableHtml, shortenDataUris, copyRichText } from "../shared/readableHtml";

type Direction = "th-en" | "en-th";
type Tone = "formal" | "semi" | "casual";

const DIRECTIONS: { value: Direction; label: string }[] = [
  { value: "th-en", label: "ไทย → อังกฤษ" },
  { value: "en-th", label: "อังกฤษ → ไทย" },
];

const TONES: { value: Tone; label: string; hint: string }[] = [
  { value: "formal", label: "ทางการ", hint: "ภาษาเขียนสุภาพ เหมาะกับเอกสาร องค์กร การแพทย์ กฎหมาย" },
  { value: "semi", label: "กึ่งทางการ", hint: "สุภาพแต่อ่านง่าย เหมาะกับบทความทั่วไปบนเว็บ" },
  { value: "casual", label: "เป็นกันเอง", hint: "ภาษาพูดคุย เป็นมิตร เหมาะกับบล็อกและไลฟ์สไตล์" },
];

/** Result of the built-in check that runs right after translating (counts of text units) */
type Validation = { checked: number; corrected: number; flagged: number; unverified: number };

type RowStatus =
  | { phase: "translating" }
  | { phase: "styling"; warnings: string[]; validation: Validation | null }
  | { phase: "done"; warnings: string[]; validation: Validation | null }
  | { phase: "error"; message: string; warnings: string[]; validation: Validation | null };

function readValidation(v: unknown): Validation | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === "number" && isFinite(x) && x >= 0 ? x : 0);
  return { checked: n(o.checked), corrected: n(o.corrected), flagged: n(o.flagged), unverified: n(o.unverified) };
}

/** Same key GenerateTab reads (read-only here — nothing new is persisted) */
function optionsKey(clientId: string) {
  return `ua-gen-options:${clientId}`;
}

export default function TranslateTab({
  client, articles, selectedId, setSelectedId,
  loadArticleDetail, articleDetails, applyArticleUpdate, goToReview, onOpenSettings, onArticleCreated, refreshArticles, refreshClient, pbn = false,
}: {
  client: UploadClientDTO;
  setClient: (c: UploadClientDTO) => void;
  articles: UploadArticleDTO[];
  selected: UploadArticleDTO | null;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  loadArticleDetail: (id: string, force?: boolean) => Promise<UploadArticleDTO | null>;
  articleDetails: Record<string, UploadArticleDTO>;
  applyArticleUpdate: (a: UploadArticleDTO) => void;
  goToReview: (id: string) => void;
  onOpenSettings?: (section: SettingsSection) => void;
  onArticleCreated: (article: UploadArticleDTO) => void;
  /** Reload the list / the client counts after an import made from this tab */
  refreshArticles: () => Promise<void>;
  refreshClient: () => Promise<void>;
  pbn?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [direction, setDirection] = useState<Direction>("th-en");
  const [tone, setTone] = useState<Tone>("semi");
  const [outputMode, setOutputMode] = useState<UploadOutputMode>("html");
  const [breadcrumb, setBreadcrumb] = useState(true);
  const [links, setLinks] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [rowStatus, setRowStatus] = useState<Record<string, RowStatus>>({});
  const [summary, setSummary] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<"preview" | "html" | "text">("preview");
  const [exportBusy, setExportBusy] = useState(false);

  // Read the same stored defaults GenerateTab uses (Internal Link only)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(optionsKey(client.id));
      if (raw) {
        const o = JSON.parse(raw);
        if (typeof o?.links === "boolean") setLinks(o.links);
      }
    } catch { /* no storage: keep defaults */ }
  }, [client.id]);

  const list = useMemo(() => articles.filter(a => a.status !== "WRITING" && a.status !== "PUSHING"), [articles]);

  // Rows imported from this tab are ticked, ready to translate. `imported` is set after the list has been
  // refreshed, so the render that runs this effect already holds the new rows.
  const idsNow = useRef<Set<string>>(new Set());
  idsNow.current = new Set(articles.map(a => a.id));
  const [imported, setImported] = useState<{ before: Set<string> } | null>(null);
  useEffect(() => {
    if (!imported) return;
    const fresh = list.filter(a => !imported.before.has(a.id)).map(a => a.id);
    if (fresh.length) setPicked(prev => new Set([...Array.from(prev), ...fresh]));
    // only an import triggers this; a later list change (a new translation row) must not tick anything
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imported]);

  async function afterImport() {
    const before = new Set(idsNow.current);
    await refreshArticles();
    await refreshClient();
    setImported({ before });
  }
  const previewArticle = previewId ? articleDetails[previewId] ?? null : null;

  function openSettings(section: SettingsSection) {
    if (onOpenSettings) { onOpenSettings(section); return; }
    router.replace(`${pathname}?tab=settings&section=${section}`);
  }

  function toggle(id: string) {
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setPicked(prev => prev.size === list.length ? new Set() : new Set(list.map(a => a.id)));
  }

  function setStatus(id: string, s: RowStatus) {
    setRowStatus(prev => ({ ...prev, [id]: s }));
  }

  async function translateOne(id: string): Promise<boolean> {
    setStatus(id, { phase: "translating" });
    let created: UploadArticleDTO;
    let warnings: string[] = [];
    let validation: Validation | null = null;
    try {
      const r = await fetch(`/api/upload-article/articles/${id}/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction, tone }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d?.article) {
        setStatus(id, { phase: "error", message: d?.error || `แปลไม่สำเร็จ (HTTP ${r.status})`, warnings: [], validation: null });
        return false;
      }
      created = d.article as UploadArticleDTO;
      warnings = Array.isArray(d.warnings) ? d.warnings.map(String) : [];
      validation = readValidation(d.validation);
    } catch (e) {
      setStatus(id, { phase: "error", message: e instanceof Error ? e.message : String(e), warnings: [], validation: null });
      return false;
    }

    onArticleCreated(created);
    setPreviewId(created.id);
    setStatus(id, { phase: "styling", warnings, validation });

    try {
      const r = await fetch(`/api/upload-article/articles/${created.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: outputMode, breadcrumb, internalLinks: !pbn && links }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setStatus(id, { phase: "error", message: `แปลเสร็จแล้ว แต่ใส่ style ไม่สำเร็จ: ${d?.error || "generate ไม่สำเร็จ"} — กด Generate ที่แท็บ Generate ได้`, warnings, validation });
        return false;
      }
      applyArticleUpdate(d);
      setStatus(id, { phase: "done", warnings, validation });
      return true;
    } catch (e) {
      setStatus(id, { phase: "error", message: `แปลเสร็จแล้ว แต่ใส่ style ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)} — กด Generate ที่แท็บ Generate ได้`, warnings, validation });
      return false;
    }
  }

  async function runTranslate() {
    const ids = list.filter(a => picked.has(a.id)).map(a => a.id);
    if (!ids.length) return;
    const dirLabel = DIRECTIONS.find(d => d.value === direction)?.label ?? direction;
    const toneLabel = TONES.find(t => t.value === tone)?.label ?? tone;
    if (!confirm(`แปล ${ids.length} บทความ ${dirLabel} โทน${toneLabel} ด้วย AI (มีค่าใช้จ่ายตามความยาวบทความ) ทำต่อไหม?`)) return;
    setRunning(true);
    setSummary(null);
    setProgress({ done: 0, total: ids.length });
    setRowStatus(prev => {
      const next = { ...prev };
      for (const id of ids) delete next[id];
      return next;
    });
    let ok = 0;
    for (const id of ids) {
      if (await translateOne(id)) ok++;
      setProgress(p => ({ ...p, done: p.done + 1 }));
    }
    setRunning(false);
    setSummary(`แปลเสร็จ ${ok} จาก ${ids.length} บทความ`);
    if (ok === ids.length) toast.success(`แปลสำเร็จ ${ok}/${ids.length} บทความ`);
    else toast.error(`แปลสำเร็จ ${ok}/${ids.length} บทความ — ดูสาเหตุในรายการ`);
  }

  function copy(text: string, label: string) {
    navigator.clipboard?.writeText(text).then(() => toast.success(`คัดลอก${label}แล้ว`)).catch(() => toast.error("คัดลอกไม่สำเร็จ"));
  }

  function copyText(html: string) {
    copyRichText(toReadableHtml(html)).then(() => toast.success("คัดลอกข้อความแล้ว")).catch(() => toast.error("คัดลอกไม่สำเร็จ"));
  }

  /**
   * Word file laid out like the writer's original document: the row's source (brief table, "H1:"/"H2:" labels,
   * images) — not the styled article Review exports. The list DTO has no source, so it is fetched when missing.
   */
  async function downloadOriginalLayout(id: string) {
    setExportBusy(true);
    try {
      const cached = articleDetails[id];
      const detail = cached?.sourceHtml ? cached : await loadArticleDetail(id, true);
      if (!detail?.sourceHtml) { toast.error("ไม่พบเนื้อหาต้นฉบับของบทความนี้"); return; }
      const m = await import("@/lib/article-export");
      const blob = await m.buildArticleDocx({ html: detail.sourceHtml, title: detail.title });
      m.downloadBlob(blob, `${m.articleFileName(detail.slug || detail.title)}.docx`);
    } catch (e) {
      toast.error("สร้างไฟล์ Word ไม่สำเร็จ: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setExportBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 space-y-0.5">
        <p className="text-xs">
          Translate แปลภาษาอย่างเดียว ไม่เขียนใหม่ ไม่ตัดและไม่เพิ่มเนื้อหา — ได้บทความใหม่ 1 แถว ต้นฉบับไม่ถูกแก้ แล้วใส่ style ของเว็บให้เหมือนกด Generate
        </p>
        <p className="text-[11px]">แปลเสร็จแล้วระบบตรวจทานกับต้นฉบับให้ทันที (ความหมาย ตัวเลข ไวยากรณ์) จุดที่ผิดจะถูกแก้ จุดที่แก้ไม่ได้จะแจ้งไว้ใต้ชื่อบทความ</p>
        <p className="text-[11px]">ใช้ AI แปล มีค่าใช้จ่ายตามความยาวบทความ • ข้อความบนภาพปกไม่ถูกแปล</p>
      </div>

      <ImportBox clientId={client.id} endpoint="articles" onImported={afterImport} />

      <div className="grid grid-cols-1 xl:grid-cols-[380px_minmax(0,1fr)] gap-4 items-start">
        <div className="bg-white/75 backdrop-blur border border-white/80 shadow-sm rounded-2xl p-4 space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 mb-1.5">แปลจาก → เป็น</label>
            <div className="grid grid-cols-2 gap-1.5">
              {DIRECTIONS.map(d => (
                <button key={d.value} type="button" disabled={running} aria-pressed={direction === d.value} onClick={() => setDirection(d.value)}
                  className={`px-2 py-1.5 text-xs font-semibold rounded-lg border transition-colors disabled:opacity-60 ${direction === d.value ? "bg-brand-navy text-white border-brand-navy" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}>
                  {d.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-gray-500 mt-1">บทความที่เลือกต้องเป็นภาษาต้นทางตามที่เลือก ไม่ตรงระบบจะไม่แปลและแจ้งเหตุผล</p>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-gray-500 mb-1.5">โทนภาษา</label>
            <div className="grid grid-cols-3 gap-1.5">
              {TONES.map(t => (
                <button key={t.value} type="button" disabled={running} aria-pressed={tone === t.value} onClick={() => setTone(t.value)}
                  className={`px-2 py-1.5 text-xs font-semibold rounded-lg border transition-colors disabled:opacity-60 ${tone === t.value ? "bg-brand-navy text-white border-brand-navy" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}>
                  {t.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-gray-500 mt-1">{TONES.find(t => t.value === tone)?.hint}</p>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-gray-500 mb-1.5">รูปแบบผลลัพธ์</label>
            <div className="flex flex-col gap-2 text-xs">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" disabled={running} checked={outputMode === "html"} onChange={() => setOutputMode("html")} />
                HTML (มี Schema / Breadcrumb / FAQ / สารบัญ)
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" disabled={running} checked={outputMode === "text"} onChange={() => setOutputMode("text")} />
                Text ปกติ
              </label>
            </div>
          </div>
          {outputMode === "html" && (
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input type="checkbox" disabled={running} checked={breadcrumb} onChange={e => setBreadcrumb(e.target.checked)} />
              ใส่ Breadcrumb ใน Schema (ไม่แสดงบนหน้าเว็บ)
            </label>
          )}

          {!pbn && (
            <div className="space-y-2.5 border-t border-gray-100 pt-3">
              <label className="block text-[11px] font-semibold text-gray-500">เพิ่มเติม</label>
              <div>
                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input type="checkbox" disabled={running} checked={links} onChange={e => setLinks(e.target.checked)} />
                  ใส่ Internal Link
                </label>
                {links && (
                  <p className="text-[10px] text-gray-500 mt-1 ml-5">
                    ครอบลิงก์ให้คำที่มีอยู่แล้วในเนื้อหาตามรายการใน{" "}
                    <button type="button" onClick={() => openSettings("links")} className="text-brand-blue hover:underline">Project Setting &gt; Internal Link</button>
                    {" "}— ไม่แก้ถ้อยคำ ย่อหน้าละไม่เกิน 1 ลิงก์
                  </p>
                )}
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-semibold text-gray-500">เลือกบทความ ({picked.size}/{list.length})</label>
              <button onClick={toggleAll} disabled={running} className="text-[11px] text-brand-blue hover:underline flex items-center gap-1">
                {picked.size === list.length && list.length > 0 ? <CheckSquare size={11} /> : <Square size={11} />}
                เลือกทั้งหมด
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1 border border-gray-100 rounded-lg p-1.5">
              {list.length === 0 && <p className="text-xs text-gray-400 text-center py-4">ยังไม่มีบทความที่แปลได้</p>}
              {list.map(a => (
                <label key={a.id} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-xs ${picked.has(a.id) ? "bg-brand-mist/40" : "hover:bg-gray-50"}`}>
                  <input type="checkbox" disabled={running} checked={picked.has(a.id)} onChange={() => toggle(a.id)} />
                  <span className="min-w-0 flex-1" onClick={e => { e.preventDefault(); setSelectedId(a.id); void loadArticleDetail(a.id); setPreviewId(a.id); }}>
                    <span className="block truncate">{a.title}</span>
                    <RowStatusLine status={rowStatus[a.id]} />
                  </span>
                </label>
              ))}
            </div>
          </div>

          <Button className="w-full" disabled={!picked.size || running} onClick={runTranslate}>
            {running ? `กำลัง Translate... (${progress.done}/${progress.total})` : `Translate (${picked.size})`}
          </Button>
          {summary && <p className="text-xs text-gray-600 text-center">{summary}</p>}
        </div>

        <div className="space-y-4 min-w-0">
          <div className="bg-white/75 backdrop-blur border border-white/80 shadow-sm rounded-2xl p-4 space-y-3 min-w-0">
            {!previewArticle ? (
              <p className="text-sm text-gray-400 text-center py-10">เลือกบทความแล้วกด Translate</p>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-brand-navy truncate">{previewArticle.title}</p>
                  <div className="flex items-center gap-1.5">
                    {(["preview", "html", "text"] as const).map(m => (
                      <button key={m} onClick={() => setPreviewMode(m)}
                        className={`px-2.5 py-1 text-[11px] font-semibold rounded-full border transition-colors ${previewMode === m ? "bg-brand-navy text-white border-brand-navy" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"}`}>
                        {m === "preview" ? "Preview" : m === "html" ? "HTML code" : "Text"}
                      </button>
                    ))}
                  </div>
                </div>

                {!previewArticle.htmlContent ? (
                  <p className="text-sm text-gray-400 text-center py-10">บทความนี้ยังไม่ได้ generate</p>
                ) : (
                  <div className="border border-gray-200 rounded-xl overflow-hidden max-h-[60vh] overflow-y-auto">
                    {previewMode === "preview" && <ArticleFrame html={previewArticle.htmlContent} pageBackground={client.theme.pageBackground} fontFaces={client.theme.detail?.article?.fontFaces} />}
                    {previewMode === "html" && (
                      <div className="p-3 space-y-2">
                        <Button size="sm" variant="outline" onClick={() => copy(previewArticle.htmlContent || "", "HTML")}>
                          <Copy size={12} className="mr-1.5" /> คัดลอก HTML
                        </Button>
                        <textarea readOnly value={shortenDataUris(previewArticle.htmlContent)} className="w-full h-72 text-xs font-mono border border-gray-200 rounded-lg p-2.5" />
                      </div>
                    )}
                    {previewMode === "text" && (
                      <div className="p-3 space-y-2">
                        <Button size="sm" variant="outline" onClick={() => copyText(previewArticle.htmlContent || "")}>
                          <Copy size={12} className="mr-1.5" /> คัดลอกข้อความ
                        </Button>
                        <ArticleFrame html={toReadableHtml(previewArticle.htmlContent)} pageBackground={client.theme.pageBackground} fontFaces={client.theme.detail?.article?.fontFaces} />
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-2 flex-wrap">
                  {previewArticle.htmlContent && (
                    <Button variant="outline" size="sm" onClick={() => goToReview(previewArticle.id)}>
                      ส่งไป Review <ArrowRight size={12} className="ml-1.5" />
                    </Button>
                  )}
                  <Button variant="outline" size="sm" disabled={exportBusy} onClick={() => downloadOriginalLayout(previewArticle.id)}
                    title="ไฟล์ Word หน้าตาเหมือนต้นฉบับ: มีตาราง brief และป้าย H1/H2 ครบ">
                    {exportBusy ? <Loader2 size={12} className="mr-1.5 animate-spin" /> : <Download size={12} className="mr-1.5" />}
                    ดาวน์โหลด Word แบบต้นฉบับ
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RowStatusLine({ status }: { status?: RowStatus }) {
  if (!status) return null;
  const warnings = status.phase === "translating" ? [] : status.warnings;
  const validation = status.phase === "translating" ? null : status.validation;
  return (
    <>
      {status.phase === "translating" && <span className="flex items-center gap-1 text-[10px] text-brand-blue"><Loader2 size={10} className="animate-spin" /> กำลังแปล…</span>}
      {status.phase === "styling" && <span className="flex items-center gap-1 text-[10px] text-brand-blue"><Loader2 size={10} className="animate-spin" /> กำลังใส่ style…</span>}
      {status.phase === "error" && <span className="flex items-start gap-1 text-[10px] text-red-600"><AlertCircle size={10} className="mt-0.5 shrink-0" /> {status.message}</span>}
      {status.phase === "done" && <span className="flex items-start gap-1 text-[10px] text-emerald-700"><CheckCircle2 size={10} className="mt-0.5 shrink-0" /> เสร็จ</span>}
      {validation && (
        <span className={`block text-[10px] ${validation.flagged > 0 || validation.unverified > 0 ? "text-amber-700" : "text-gray-500"}`}>
          ตรวจทาน {validation.checked} จุด
          {validation.corrected > 0 ? ` • แก้ให้แล้ว ${validation.corrected}` : ""}
          {validation.flagged > 0 ? ` • ต้องดูเอง ${validation.flagged}` : ""}
          {validation.unverified > 0 ? ` • ยังไม่ได้ตรวจ ${validation.unverified}` : ""}
          {validation.checked > 0 && !validation.corrected && !validation.flagged && !validation.unverified ? " • ตรงกับต้นฉบับ" : ""}
        </span>
      )}
      {warnings.length > 0 && (
        <ul className="mt-0.5 list-disc ml-4 text-[10px] text-amber-700">
          {warnings.map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      )}
    </>
  );
}
