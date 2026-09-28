"use client";

/**
 * แท็บ Generate — ตั้งธีมจากเว็บต้นฉบับ (หรือแก้เอง) แล้วสร้าง HTML/Text พร้อมใช้
 * ระบบไม่เขียนเนื้อหาเพิ่ม แค่จัดโครงสร้าง + Schema/Breadcrumb/FAQ/สารบัญ
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Sparkles, Loader2, Copy, ArrowRight, CheckSquare, Square, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ArticleFrame from "@/components/shared/ArticleFrame";
import { UPLOAD_FONT_INHERIT, type UploadArticleDTO, type UploadClientDTO, type UploadOutputMode, type UploadTheme, type UploadThemeDetail } from "@/lib/upload-article/types";
import FontPicker from "../shared/FontPicker";
import SiteScanPanel from "../shared/SiteScanPanel";
import FaqStyleEditor from "../shared/FaqStyleEditor";
import { toReadableHtml, shortenDataUris, copyRichText } from "../shared/readableHtml";

const GENERATABLE = new Set(["IMPORTED", "GENERATED", "REVIEWED", "FAILED"]);

export default function GenerateTab({
  client, setClient, articles, selected, selectedId, setSelectedId,
  loadArticleDetail, articleDetails, applyArticleUpdate, goToReview,
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
}) {
  const [scanUrl, setScanUrl] = useState(client.website || "");
  const [scanning, setScanning] = useState(false);
  const [themeDraft, setThemeDraft] = useState<UploadTheme>(client.theme);
  const [savingTheme, setSavingTheme] = useState(false);
  const [showFaqEditor, setShowFaqEditor] = useState(false);

  const [outputMode, setOutputMode] = useState<UploadOutputMode>("html");
  const [breadcrumb, setBreadcrumb] = useState(true);

  const [selectedForGen, setSelectedForGen] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const [previewMode, setPreviewMode] = useState<"preview" | "html" | "text">("preview");

  // เทียบค่าแทน reference — สแกนเว็บคืน client ใหม่ทั้งก้อน ไม่ควรล้างธีมที่กำลังแก้
  const savedThemeKey = JSON.stringify(client.theme);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setThemeDraft(client.theme); }, [savedThemeKey]);
  useEffect(() => { if (selectedId) void loadArticleDetail(selectedId); }, [selectedId, loadArticleDetail]);

  const genList = useMemo(() => articles.filter(a => GENERATABLE.has(a.status)), [articles]);
  const detail = selectedId ? articleDetails[selectedId] : null;

  function setColor(key: keyof UploadTheme, val: string) {
    setThemeDraft(prev => ({ ...prev, [key]: val }));
  }

  async function runThemeScan() {
    setScanning(true);
    try {
      const r = await fetch(`/api/upload-article/clients/${client.id}/theme-scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scanUrl.trim() ? { url: scanUrl.trim() } : {}),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "สแกนธีมไม่สำเร็จ"); return; }
      if (d.theme) {
        // ฟอนต์ที่ตั้งไว้เป็น "ใช้ฟอนต์ของเว็บ" (inherit) หรือยังไม่ได้ตั้ง (ว่าง) ไม่ควรถูกผลสแกนทับ — ผู้ใช้ตั้งใจเลือกไว้แบบนั้นแล้ว
        setThemeDraft(prev => ({
          ...d.theme,
          styleMode: prev.styleMode,
          detail: prev.detail,
          fontFamily: (prev.fontFamily === UPLOAD_FONT_INHERIT || !prev.fontFamily) ? prev.fontFamily : d.theme.fontFamily,
          headingFont: !prev.headingFont ? prev.headingFont : d.theme.headingFont,
        }));
        toast.success("ดึงธีมจากเว็บสำเร็จ — ตรวจสอบสีแล้วกดบันทึกธีม");
      }
    } catch (e) {
      toast.error(`สแกนไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setScanning(false);
    }
  }

  /** รับสี/ฟอนต์ + หน้าตา FAQ จากผลสแกนเว็บปลายทาง — ยังไม่บันทึกจนกดบันทึกธีม */
  function applyScannedTheme(theme: Partial<UploadTheme>, detail: UploadThemeDetail | null) {
    setThemeDraft(prev => ({ ...prev, ...theme, styleMode: prev.styleMode, detail: detail ?? prev.detail }));
    if (detail) setShowFaqEditor(true);
    toast.success("ใส่ธีมจากเว็บแล้ว — ตรวจพรีวิวแล้วกดบันทึกธีม");
  }

  async function saveTheme() {
    setSavingTheme(true);
    try {
      const r = await fetch(`/api/upload-article/clients/${client.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: { ...themeDraft, detail: themeDraft.detail ?? null } }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "บันทึกธีมไม่สำเร็จ"); return; }
      setClient(d);
      toast.success("บันทึกธีมแล้ว");
    } finally {
      setSavingTheme(false);
    }
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

      <SiteScanPanel client={client} setClient={setClient} onApplyTheme={applyScannedTheme}
        title="สแกนเว็บปลายทาง — ธีม, ปลั๊กอิน, หน้าตา FAQ (ละเอียด)" />

      {/* เว็บไซต์ต้นฉบับ / ธีม */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-4">
        <p className="text-sm font-semibold text-brand-navy">เว็บไซต์ต้นฉบับ</p>
        <div className="flex gap-2">
          <Input value={scanUrl} onChange={e => setScanUrl(e.target.value)} placeholder="https://www.example.com" className="flex-1" />
          <Button variant="outline" disabled={scanning} onClick={runThemeScan}>
            {scanning ? <Loader2 size={14} className="animate-spin mr-1.5" /> : <Sparkles size={14} className="mr-1.5" />}
            {scanning ? "กำลังดึงธีม... (อาจใช้เวลาถึง 1 นาที)" : "ดึงธีมจากเว็บต้นฉบับ"}
          </Button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {([
            ["theme", "สีหลัก"], ["text", "สีตัวอักษร"], ["border", "สีเส้นขอบ"],
            ["accent", "สีเน้น"], ["background", "สีพื้นหลัง"],
          ] as const).map(([key, label]) => (
            <div key={key}>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">{label}</label>
              <div className="flex items-center gap-1.5">
                <input type="color" value={themeDraft[key] || "#ffffff"} onChange={e => setColor(key, e.target.value)}
                  className="h-8 w-8 rounded border border-gray-200 cursor-pointer shrink-0" />
                <Input value={themeDraft[key] || ""} onChange={e => setColor(key, e.target.value)}
                  placeholder="#ffffff" className="text-xs h-8" />
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FontPicker label="Font ตัวอักษร" value={themeDraft.fontFamily || ""}
            onChange={v => setThemeDraft(p => ({ ...p, fontFamily: v }))}
            noneValue={UPLOAD_FONT_INHERIT} noneLabel="ไม่ใส่ฟอนต์ — ใช้ฟอนต์ของเว็บ"
            defaultLabel="ค่าเริ่มต้น (IBM Plex Sans Thai)" />
          <FontPicker label="Font หัวข้อ" value={themeDraft.headingFont || ""}
            onChange={v => setThemeDraft(p => ({ ...p, headingFont: v }))}
            noneValue="" noneLabel="ไม่ใส่ฟอนต์ — ใช้ตาม Font ตัวอักษร / ธีมเว็บ" />
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-gray-500 mb-1.5">รูปแบบ CSS</label>
          <div className="flex gap-3 text-xs">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" checked={themeDraft.styleMode === "embed"} onChange={() => setThemeDraft(p => ({ ...p, styleMode: "embed" }))} />
              embed — ใส่ CSS มากับบทความ
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" checked={themeDraft.styleMode === "clean"} onChange={() => setThemeDraft(p => ({ ...p, styleMode: "clean" }))} />
              clean — ใช้ CSS ของธีมเว็บ
            </label>
          </div>
        </div>

        <div className="border border-gray-100 rounded-lg">
          <button onClick={() => setShowFaqEditor(v => !v)} className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-gray-600 hover:text-brand-navy">
            {showFaqEditor ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            หน้าตา FAQ card + ตาราง (ละเอียด){themeDraft.detail ? " · ตั้งค่าแล้ว" : ""}
          </button>
          {showFaqEditor && (
            <div className="px-3 pb-3 border-t border-gray-100 pt-3">
              <FaqStyleEditor theme={themeDraft} onChange={d => setThemeDraft(p => ({ ...p, detail: d }))} />
            </div>
          )}
        </div>

        <Button size="sm" disabled={savingTheme} onClick={saveTheme}>
          {savingTheme ? "กำลังบันทึก..." : "บันทึกธีม"}
        </Button>
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
