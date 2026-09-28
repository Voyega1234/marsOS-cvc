"use client";

/**
 * แท็บ Generate — สร้าง HTML/Text พร้อมใช้จากบทความที่นำเข้า/เขียนแล้ว
 * ระบบไม่เขียนเนื้อหาเพิ่ม แค่จัดโครงสร้าง + Schema/Breadcrumb/FAQ/สารบัญ
 * สไตล์บทความ (สี/ฟอนต์/สแกนเว็บ) ย้ายไปแท็บ Project Setting > สแกนเว็บปลายทาง / สไตล์บทความ แล้ว
 * ที่นี่ generate ใช้ธีมที่บันทึกไว้ของ client (client.theme) เสมอ — ไม่ส่ง draft ไปกับ request
 */
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, ArrowRight, CheckSquare, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import ArticleFrame from "@/components/shared/ArticleFrame";
import { UPLOAD_FONT_INHERIT, type UploadArticleDTO, type UploadClientDTO, type UploadOutputMode } from "@/lib/upload-article/types";
import type { SettingsSection } from "../settings/SettingsTab";
import { toReadableHtml, shortenDataUris, copyRichText } from "../shared/readableHtml";

const GENERATABLE = new Set(["IMPORTED", "GENERATED", "REVIEWED", "FAILED"]);

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

  useEffect(() => { if (selectedId) void loadArticleDetail(selectedId); }, [selectedId, loadArticleDetail]);

  const genList = useMemo(() => articles.filter(a => GENERATABLE.has(a.status)), [articles]);
  const detail = selectedId ? articleDetails[selectedId] : null;

  function openStyleSettings() {
    if (onOpenSettings) { onOpenSettings("style"); return; }
    router.replace(`${pathname}?tab=settings&section=style`);
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

  async function runGenerate() {
    const ids = Array.from(selectedForGen);
    if (!ids.length) return;
    setGenerating(true);
    setProgress({ done: 0, total: ids.length });
    let okCount = 0;
    for (const id of ids) {
      try {
        const r = await fetch(`/api/upload-article/articles/${id}/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: outputMode, breadcrumb }),
        });
        const d = await r.json().catch(() => ({}));
        if (r.ok) { applyArticleUpdate(d); okCount++; }
        else toast.error(`${id}: ${d?.error || "generate ไม่สำเร็จ"}`);
      } catch (e) {
        toast.error(`generate ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setProgress(p => ({ ...p, done: p.done + 1 }));
      }
    }
    setGenerating(false);
    if (okCount) toast.success(`Generate สำเร็จ ${okCount}/${ids.length} บทความ`);
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
        <button onClick={openStyleSettings} className="text-xs font-semibold text-brand-blue hover:underline shrink-0">
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
                  <span className="truncate flex-1" onClick={e => { e.preventDefault(); setSelectedId(a.id); }}>{a.title}</span>
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
                  {previewMode === "preview" && <ArticleFrame html={detail.htmlContent} />}
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
                      <ArticleFrame html={toReadableHtml(detail.htmlContent)} />
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
