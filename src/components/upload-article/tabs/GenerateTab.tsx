"use client";

/**
 * แท็บ Generate — สร้าง HTML/Text พร้อมใช้จากบทความที่นำเข้า/เขียนแล้ว
 * ระบบไม่เขียนเนื้อหาเพิ่ม แค่จัดโครงสร้าง + Schema/Breadcrumb/FAQ/สารบัญ
 * สไตล์บทความ (สี/ฟอนต์/สแกนเว็บ) ย้ายไปแท็บ Project Setting > สแกนเว็บปลายทาง / สไตล์บทความ แล้ว
 * ที่นี่ generate ใช้ธีมที่บันทึกไว้ของ client (client.theme) เสมอ — ไม่ส่ง draft ไปกับ request
 * ตัวเลือกเพิ่ม: ใส่ Internal Link (ครอบคำที่มีอยู่แล้ว ไม่แก้ถ้อยคำ), สร้างรูปปก, สร้างรูปประกอบ — รูปสร้างก่อนแล้วค่อย generate
 */
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, ArrowRight, CheckSquare, Square, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import ArticleFrame from "@/components/shared/ArticleFrame";
import { DEFAULT_UPLOAD_IMAGE_DEFAULTS, UPLOAD_FONT_INHERIT, UPLOAD_MAX_INLINE_IMAGES, type UploadArticleDTO, type UploadClientDTO, type UploadOutputMode } from "@/lib/upload-article/types";
import type { SettingsSection } from "../settings/SettingsTab";
import { toReadableHtml, shortenDataUris, copyRichText } from "../shared/readableHtml";
import { requestArticleImages } from "../shared/AiImagesPanel";

const GENERATABLE = new Set(["IMPORTED", "GENERATED", "REVIEWED", "FAILED"]);
/** สร้างรูปพร้อมกันกี่บทความ (แต่ละบทความใช้ 30-90 วิ) */
const IMAGE_CONCURRENCY = 2;

interface GenOptions {
  links: boolean;
  cover: boolean;
  coverWithText: boolean;
  inline: boolean;
  inlineCount: number;
  inlineWithText: boolean;
  /** ข้ามบทความที่มีปก/รูปประกอบจากระบบอยู่แล้ว */
  skipExisting: boolean;
}

type RowStatus =
  | { phase: "images" }
  | { phase: "generating" }
  | { phase: "done"; note?: string }
  | { phase: "error"; message: string };

function optionsKey(clientId: string) {
  return `ua-gen-options:${clientId}`;
}

function fontLabel(f?: string): string {
  if (!f) return "ค่าเริ่มต้น (IBM Plex Sans Thai)";
  if (f === UPLOAD_FONT_INHERIT) return "ใช้ฟอนต์ของเว็บ";
  return f.split(",")[0].replace(/['"]/g, "").trim();
}

export default function GenerateTab({
  client, articles, selected, selectedId, setSelectedId,
  loadArticleDetail, articleDetails, applyArticleUpdate, goToReview, onOpenSettings,
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
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [outputMode, setOutputMode] = useState<UploadOutputMode>("html");
  const [breadcrumb, setBreadcrumb] = useState(true);

  const [selectedForGen, setSelectedForGen] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const [previewMode, setPreviewMode] = useState<"preview" | "html" | "text">("preview");

  const imageDefaults = client.pushPrefs.imageDefaults ?? DEFAULT_UPLOAD_IMAGE_DEFAULTS;
  const [opts, setOpts] = useState<GenOptions>(() => ({
    links: false,
    cover: false,
    coverWithText: imageDefaults.coverWithText,
    inline: false,
    inlineCount: Math.max(1, imageDefaults.inlineCount || 1),
    inlineWithText: imageDefaults.inlineWithText,
    skipExisting: true,
  }));
  const [rowStatus, setRowStatus] = useState<Record<string, RowStatus>>({});

  // จำตัวเลือกไว้ต่อลูกค้า (เฉพาะเครื่องนี้)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(optionsKey(client.id));
      if (raw) setOpts(prev => ({ ...prev, ...JSON.parse(raw) }));
    } catch { /* ไม่มี storage ก็ใช้ค่าเริ่มต้น */ }
  }, [client.id]);

  function setOpt<K extends keyof GenOptions>(key: K, value: GenOptions[K]) {
    setOpts(prev => {
      const next = { ...prev, [key]: value };
      try { localStorage.setItem(optionsKey(client.id), JSON.stringify(next)); } catch { /* ข้าม */ }
      return next;
    });
  }

  useEffect(() => { if (selectedId) void loadArticleDetail(selectedId); }, [selectedId, loadArticleDetail]);

  const genList = useMemo(() => articles.filter(a => GENERATABLE.has(a.status)), [articles]);
  const detail = selectedId ? articleDetails[selectedId] : null;

  function openSettings(section: SettingsSection) {
    if (onOpenSettings) { onOpenSettings(section); return; }
    router.replace(`${pathname}?tab=settings&section=${section}`);
  }

  function toggleGen(id: string) {
    setSelectedForGen(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedForGen(prev => prev.size === genList.length ? new Set() : new Set(genList.map(a => a.id)));
  }

  /** สร้างรูปตามตัวเลือกให้บทความ 1 ชิ้น — คืนข้อความปัญหา (ถ้ามี) และค่ารูป */
  async function makeImages(id: string, o: GenOptions): Promise<{ notes: string[]; cost: number }> {
    const notes: string[] = [];
    let cost = 0;
    const jobs: Promise<void>[] = [];
    if (o.cover) {
      jobs.push(requestArticleImages(id, { kind: "cover", withText: o.coverWithText, onlyIfMissing: o.skipExisting })
        .catch(e => ({ ok: false as const, error: String(e) }))
        .then(res => {
          if (res.ok) { cost += res.costUsd; if (res.skipped) notes.push("มีปกอยู่แล้ว ข้าม"); }
          else notes.push(`ปก: ${res.error}`);
        }));
    }
    if (o.inline) {
      jobs.push(requestArticleImages(id, { kind: "inline", withText: o.inlineWithText, count: o.inlineCount, onlyIfMissing: o.skipExisting })
        .catch(e => ({ ok: false as const, error: String(e) }))
        .then(res => {
          if (res.ok) {
            cost += res.costUsd;
            if (res.skipped) notes.push("มีรูปประกอบอยู่แล้ว ข้าม");
            else if (res.failed) notes.push(`รูปประกอบไม่สำเร็จ ${res.failed} รูป`);
          } else notes.push(`รูปประกอบ: ${res.error}`);
        }));
    }
    await Promise.all(jobs);
    return { notes, cost };
  }

  async function generateOne(id: string, o: GenOptions): Promise<{ ok: boolean; cost: number }> {
    let notes: string[] = [];
    let cost = 0;
    if (o.cover || o.inline) {
      setRowStatus(prev => ({ ...prev, [id]: { phase: "images" } }));
      ({ notes, cost } = await makeImages(id, o));
    }
    setRowStatus(prev => ({ ...prev, [id]: { phase: "generating" } }));
    try {
      const r = await fetch(`/api/upload-article/articles/${id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: outputMode, breadcrumb, internalLinks: o.links }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setRowStatus(prev => ({ ...prev, [id]: { phase: "error", message: d?.error || "generate ไม่สำเร็จ" } }));
        return { ok: false, cost };
      }
      applyArticleUpdate(d);
      if (o.links) {
        const added = Number(r.headers.get("X-Links-Added")) || 0;
        notes.unshift(added ? `ใส่ลิงก์ ${added} จุด` : "ไม่พบคำที่ตรงกับรายการลิงก์");
      }
      setRowStatus(prev => ({ ...prev, [id]: { phase: "done", note: notes.join(" · ") || undefined } }));
      return { ok: true, cost };
    } catch (e) {
      setRowStatus(prev => ({ ...prev, [id]: { phase: "error", message: e instanceof Error ? e.message : String(e) } }));
      return { ok: false, cost };
    }
  }

  async function runGenerate() {
    const ids = Array.from(selectedForGen);
    if (!ids.length) return;
    const o = opts;
    if (o.cover || o.inline) {
      const perArticle = (o.cover ? 1 : 0) + (o.inline ? o.inlineCount : 0);
      if (!confirm(`จะสร้างรูปสูงสุด ${perArticle * ids.length} ภาพ (${perArticle} ภาพ × ${ids.length} บทความ) คิดค่าใช้จ่ายต่อภาพ ดำเนินการต่อ?`)) return;
    }
    setGenerating(true);
    setProgress({ done: 0, total: ids.length });
    setRowStatus(prev => {
      const next = { ...prev };
      for (const id of ids) delete next[id];
      return next;
    });
    let okCount = 0;
    let totalCost = 0;
    let idx = 0;
    const concurrency = o.cover || o.inline ? IMAGE_CONCURRENCY : 1;
    const worker = async () => {
      while (idx < ids.length) {
        const id = ids[idx++];
        const res = await generateOne(id, o);
        if (res.ok) okCount++;
        totalCost += res.cost;
        setProgress(p => ({ ...p, done: p.done + 1 }));
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, () => worker()));
    setGenerating(false);
    const costNote = totalCost > 0 ? ` · ค่ารูป $${totalCost.toFixed(3)}` : "";
    if (okCount === ids.length) toast.success(`Generate สำเร็จ ${okCount}/${ids.length} บทความ${costNote}`);
    else toast.error(`Generate สำเร็จ ${okCount}/${ids.length} บทความ${costNote} — ดูสาเหตุในรายการ`);
  }

  function copy(text: string, label: string) {
    navigator.clipboard?.writeText(text).then(() => toast.success(`คัดลอก${label}แล้ว`)).catch(() => toast.error("คัดลอกไม่สำเร็จ"));
  }

  function copyText(html: string) {
    copyRichText(toReadableHtml(html)).then(() => toast.success("คัดลอกข้อความแล้ว")).catch(() => toast.error("คัดลอกไม่สำเร็จ"));
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
        ระบบไม่เขียนเนื้อหาเพิ่ม — จัดโครงสร้าง ใส่ Schema, Breadcrumb, FAQ, สารบัญ ให้เท่านั้น
      </p>

      <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-xs text-gray-600 flex-wrap">
          <span className="font-semibold text-brand-navy">สไตล์บทความ:</span>
          <span>{fontLabel(client.theme.fontFamily)}</span>
          <span className="text-gray-300">·</span>
          <span className="flex items-center gap-1">
            สี
            <span className="inline-block h-3 w-3 rounded-full border border-gray-200" style={{ background: client.theme.theme || "#fff" }} />
            <span className="inline-block h-3 w-3 rounded-full border border-gray-200" style={{ background: client.theme.accent || "#fff" }} />
          </span>
        </div>
        <button onClick={() => openSettings("style")} className="text-xs font-semibold text-brand-blue hover:underline shrink-0">
          แก้ใน Project Setting
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[380px_minmax(0,1fr)] gap-4 items-start">
        {/* ตัวเลือก generate + checklist บทความ */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 mb-1.5">รูปแบบผลลัพธ์</label>
            <div className="flex flex-col gap-2 text-xs">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" checked={outputMode === "html"} onChange={() => setOutputMode("html")} />
                HTML (มี Schema / Breadcrumb / FAQ / สารบัญ)
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" checked={outputMode === "text"} onChange={() => setOutputMode("text")} />
                Text ปกติ
              </label>
            </div>
          </div>
          {outputMode === "html" && (
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input type="checkbox" checked={breadcrumb} onChange={e => setBreadcrumb(e.target.checked)} />
              ใส่ Breadcrumb ใน Schema (ไม่แสดงบนหน้าเว็บ)
            </label>
          )}

          <div className="space-y-2.5 border-t border-gray-100 pt-3">
            <label className="block text-[11px] font-semibold text-gray-500">เพิ่มเติม</label>

            <div>
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input type="checkbox" checked={opts.links} onChange={e => setOpt("links", e.target.checked)} />
                ใส่ Internal Link
              </label>
              {opts.links && (
                <p className="text-[10px] text-gray-500 mt-1 ml-5">
                  ครอบลิงก์ให้คำที่มีอยู่แล้วในเนื้อหาตามรายการใน{" "}
                  <button type="button" onClick={() => openSettings("links")} className="text-brand-blue hover:underline">Project Setting &gt; Internal Link</button>
                  {" "}— ไม่แก้ถ้อยคำ ย่อหน้าละไม่เกิน 1 ลิงก์
                </p>
              )}
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input type="checkbox" checked={opts.cover} onChange={e => setOpt("cover", e.target.checked)} />
                สร้างรูปปกบทความ
              </label>
              {opts.cover && (
                <label className="flex items-center gap-1.5 text-[11px] text-gray-600 cursor-pointer mt-1 ml-5">
                  <input type="checkbox" checked={opts.coverWithText} onChange={e => setOpt("coverWithText", e.target.checked)} />
                  มีตัวหนังสือบนปก
                </label>
              )}
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input type="checkbox" checked={opts.inline} onChange={e => setOpt("inline", e.target.checked)} />
                สร้างรูปประกอบบทความ
              </label>
              {opts.inline && (
                <div className="mt-1 ml-5 space-y-1">
                  <label className="flex items-center gap-1.5 text-[11px] text-gray-600">
                    จำนวน
                    <select value={opts.inlineCount} onChange={e => setOpt("inlineCount", Number(e.target.value))}
                      className="text-[11px] border border-gray-200 rounded px-1.5 py-0.5 bg-white">
                      {Array.from({ length: UPLOAD_MAX_INLINE_IMAGES }, (_, i) => i + 1).map(n => (
                        <option key={n} value={n}>{n} รูป</option>
                      ))}
                    </select>
                    ต่อบทความ (วางใต้หัวข้อ H2)
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] text-gray-600 cursor-pointer">
                    <input type="checkbox" checked={opts.inlineWithText} onChange={e => setOpt("inlineWithText", e.target.checked)} />
                    มีตัวหนังสือในรูป
                  </label>
                </div>
              )}
            </div>

            {(opts.cover || opts.inline) && (
              <label className="flex items-center gap-1.5 text-[11px] text-gray-600 cursor-pointer">
                <input type="checkbox" checked={opts.skipExisting} onChange={e => setOpt("skipExisting", e.target.checked)} />
                ข้ามบทความที่มีรูปจากระบบอยู่แล้ว (ไม่เสียค่ารูปซ้ำ)
              </label>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-semibold text-gray-500">เลือกบทความ ({selectedForGen.size}/{genList.length})</label>
              <button onClick={toggleSelectAll} className="text-[11px] text-brand-blue hover:underline flex items-center gap-1">
                {selectedForGen.size === genList.length && genList.length > 0 ? <CheckSquare size={11} /> : <Square size={11} />}
                เลือกทั้งหมด
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1 border border-gray-100 rounded-lg p-1.5">
              {genList.length === 0 && <p className="text-xs text-gray-400 text-center py-4">ยังไม่มีบทความที่ generate ได้</p>}
              {genList.map(a => (
                <label key={a.id} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-xs ${selectedForGen.has(a.id) ? "bg-brand-mist/40" : "hover:bg-gray-50"}`}>
                  <input type="checkbox" checked={selectedForGen.has(a.id)} onChange={() => toggleGen(a.id)} />
                  <span className="min-w-0 flex-1" onClick={e => { e.preventDefault(); setSelectedId(a.id); }}>
                    <span className="block truncate">{a.title}</span>
                    <RowStatusLine status={rowStatus[a.id]} />
                  </span>
                </label>
              ))}
            </div>
          </div>

          <Button className="w-full" disabled={!selectedForGen.size || generating} onClick={runGenerate}>
            {generating ? `กำลัง Generate... (${progress.done}/${progress.total})` : `Generate (${selectedForGen.size})`}
          </Button>
        </div>

        {/* พรีวิว */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3 min-w-0">
          {!selected ? (
            <p className="text-sm text-gray-400 text-center py-10">เลือกบทความจากรายการด้านซ้ายเพื่อดูตัวอย่าง</p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-sm font-semibold text-brand-navy truncate">{selected.title}</p>
                <div className="flex items-center gap-1.5">
                  {(["preview", "html", "text"] as const).map(m => (
                    <button key={m} onClick={() => setPreviewMode(m)}
                      className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg border transition-colors ${previewMode === m ? "bg-brand-blue text-white border-brand-blue" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"}`}>
                      {m === "preview" ? "Preview" : m === "html" ? "HTML code" : "Text"}
                    </button>
                  ))}
                </div>
              </div>

              {!detail?.htmlContent ? (
                <p className="text-sm text-gray-400 text-center py-10">บทความนี้ยังไม่ได้ generate</p>
              ) : (
                <div className="border border-gray-200 rounded-xl overflow-hidden max-h-[60vh] overflow-y-auto">
                  {previewMode === "preview" && <ArticleFrame html={detail.htmlContent} pageBackground={client.theme.pageBackground} />}
                  {previewMode === "html" && (
                    <div className="p-3 space-y-2">
                      <Button size="sm" variant="outline" onClick={() => copy(detail.htmlContent || "", "HTML")}>
                        <Copy size={12} className="mr-1.5" /> คัดลอก HTML
                      </Button>
                      {/data:image\//i.test(detail.htmlContent) && (
                        <p className="text-[11px] text-gray-500">
                          รูปที่อัปโหลดถูกฝังเป็น base64 ในโค้ด (ย่อให้ดูในกล่องนี้) — ตอน Push ขึ้น WordPress ระบบอัปรูปเข้า Media Library แล้วเปลี่ยนเป็นลิงก์ให้เอง
                        </p>
                      )}
                      <textarea readOnly value={shortenDataUris(detail.htmlContent)} className="w-full h-72 text-xs font-mono border border-gray-200 rounded-lg p-2.5" />
                    </div>
                  )}
                  {previewMode === "text" && (
                    <div className="p-3 space-y-2">
                      <Button size="sm" variant="outline" onClick={() => copyText(detail.htmlContent || "")}>
                        <Copy size={12} className="mr-1.5" /> คัดลอกข้อความ
                      </Button>
                      <ArticleFrame html={toReadableHtml(detail.htmlContent)} pageBackground={client.theme.pageBackground} />
                    </div>
                  )}
                </div>
              )}

              {detail?.htmlContent && (
                <Button variant="outline" size="sm" onClick={() => goToReview(selected.id)}>
                  ส่งไป Review <ArrowRight size={12} className="ml-1.5" />
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function RowStatusLine({ status }: { status?: RowStatus }) {
  if (!status) return null;
  if (status.phase === "images") return <span className="flex items-center gap-1 text-[10px] text-brand-blue"><Loader2 size={10} className="animate-spin" /> กำลังสร้างรูป...</span>;
  if (status.phase === "generating") return <span className="flex items-center gap-1 text-[10px] text-brand-blue"><Loader2 size={10} className="animate-spin" /> กำลัง Generate...</span>;
  if (status.phase === "error") return <span className="flex items-start gap-1 text-[10px] text-red-600"><AlertCircle size={10} className="mt-0.5 shrink-0" /> {status.message}</span>;
  return (
    <span className="flex items-start gap-1 text-[10px] text-emerald-700">
      <CheckCircle2 size={10} className="mt-0.5 shrink-0" /> เสร็จ{status.note ? ` · ${status.note}` : ""}
    </span>
  );
}
