"use client";

/**
 * แท็บ Review — แก้ไขบทความ, ตั้ง Meta/Slug (ให้ AI เขียนได้), จัดการภาพ, แล้วผ่าน Review
 */
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Sparkles, ImageIcon, Trash2, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import ArticleFrame from "@/components/shared/ArticleFrame";
import ScopedEditable from "@/components/shared/ScopedEditable";
import { fileToDownscaledDataUrl } from "@/lib/imageDownscale";
import type { UploadArticleDTO, UploadClientDTO } from "@/lib/upload-article/types";
import SerpPreview from "@/components/upload-article/shared/SerpPreview";
import UploadStatusBadge from "@/components/upload-article/shared/StatusBadge";
import { listH2Sections, insertFigureAfterH2 } from "@/components/upload-article/shared/htmlSections";
import DriveImagesPanel from "@/components/upload-article/shared/DriveImagesPanel";

const MAX_PATCH_BYTES = 4_000_000;

export default function ReviewTab({
  client, articles, selectedId, setSelectedId, loadArticleDetail, articleDetails, applyArticleUpdate,
}: {
  client: UploadClientDTO;
  articles: UploadArticleDTO[];
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  loadArticleDetail: (id: string, force?: boolean) => Promise<UploadArticleDTO | null>;
  articleDetails: Record<string, UploadArticleDTO>;
  applyArticleUpdate: (a: UploadArticleDTO) => void;
}) {
  const [viewMode, setViewMode] = useState<"preview" | "edit">("preview");
  const editorRef = useRef<HTMLDivElement>(null);
  const [editSaving, setEditSaving] = useState(false);

  const [seoDraft, setSeoDraft] = useState({ seoTitle: "", metaDescription: "", slug: "" });
  const [savingSeo, setSavingSeo] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);

  const [coverAlt, setCoverAlt] = useState("");
  const [coverBusy, setCoverBusy] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);

  const [insertFile, setInsertFile] = useState<File | null>(null);
  const [insertAlt, setInsertAlt] = useState("");
  const [insertPos, setInsertPos] = useState<number | "">("");
  const [inserting, setInserting] = useState(false);

  const [approving, setApproving] = useState(false);

  useEffect(() => { if (selectedId) void loadArticleDetail(selectedId); }, [selectedId, loadArticleDetail]);

  const detail = selectedId ? articleDetails[selectedId] : null;
  const html = detail?.htmlContent || "";

  useEffect(() => {
    if (detail) {
      setSeoDraft({ seoTitle: detail.seoTitle || "", metaDescription: detail.metaDescription || "", slug: detail.slug || "" });
      setCoverAlt(detail.coverAlt || "");
      setViewMode("preview");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.id]);

  // insertPos เป็น offset อ้างอิงกับ html ก้อนปัจจุบัน — สลับบทความ หรือ html ถูกแทนที่จากเซิร์ฟเวอร์
  // (บันทึกแก้ไข/AI เขียน Meta ที่คืน htmlContent ใหม่) ต้องเคลียร์ทิ้ง ไม่งั้น offset จะเพี้ยน
  useEffect(() => {
    setInsertFile(null);
    setInsertAlt("");
    setInsertPos("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.id, html]);

  const siteHost = client.website.replace(/^https?:\/\//i, "").replace(/\/+$/, "");

  async function patchArticle(id: string, body: Record<string, unknown>): Promise<UploadArticleDTO | null> {
    const size = new Blob([JSON.stringify(body)]).size;
    if (size > MAX_PATCH_BYTES) {
      toast.error("ข้อมูลใหญ่เกิน 4MB — รูปอาจใหญ่ไป ลองย่อขนาดก่อนบันทึก");
      return null;
    }
    const r = await fetch(`/api/upload-article/articles/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { toast.error(d?.error || "บันทึกไม่สำเร็จ"); return null; }
    applyArticleUpdate(d);
    return d;
  }

  async function saveEditedHtml() {
    if (!detail || !editorRef.current) return;
    setEditSaving(true);
    try {
      const newHtml = editorRef.current.innerHTML;
      const d = await patchArticle(detail.id, { htmlContent: newHtml });
      if (d) { setViewMode("preview"); toast.success("บันทึกแล้ว"); }
    } finally {
      setEditSaving(false);
    }
  }

  async function saveSeo() {
    if (!detail) return;
    setSavingSeo(true);
    try {
      const cleanSlug = seoDraft.slug.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
      const d = await patchArticle(detail.id, {
        seoTitle: seoDraft.seoTitle.trim(),
        metaDescription: seoDraft.metaDescription.trim(),
        slug: cleanSlug,
      });
      if (d) { setSeoDraft(prev => ({ ...prev, slug: cleanSlug })); toast.success("บันทึก SEO แล้ว"); }
    } finally {
      setSavingSeo(false);
    }
  }

  async function aiMeta() {
    if (!detail) return;
    setAiBusy(true);
    try {
      const r = await fetch(`/api/upload-article/articles/${detail.id}/meta`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "AI เขียน Meta ไม่สำเร็จ"); return; }
      setSeoDraft({ seoTitle: d.seoTitle ?? "", metaDescription: d.metaDescription ?? "", slug: d.slug ?? "" });
      applyArticleUpdate({
        ...(detail as UploadArticleDTO),
        seoTitle: d.seoTitle ?? "",
        metaDescription: d.metaDescription ?? "",
        slug: d.slug ?? "",
        ...(typeof d.htmlContent === "string" ? { htmlContent: d.htmlContent } : {}),
      });
      if (d.warning) toast.warning(d.warning);
      else toast.success(`AI เขียน Meta แล้ว${typeof d.costUsd === "number" ? ` (ต้นทุน $${d.costUsd.toFixed(4)})` : ""}`);
    } catch (e) {
      toast.error(`AI เขียน Meta ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAiBusy(false);
    }
  }

  /** บันทึกภาพปกจาก data URI (ใช้ทั้งไฟล์ในเครื่อง และรูปจากโฟลเดอร์ Drive) */
  async function applyCoverDataUrl(dataUrl: string): Promise<boolean> {
    if (!detail) return false;
    const d = await patchArticle(detail.id, { coverImageUrl: dataUrl, coverAlt: coverAlt || detail.title });
    if (d) toast.success("อัปโหลดภาพปกแล้ว");
    return !!d;
  }

  async function handleCoverFile(file: File) {
    if (!detail) return;
    setCoverBusy(true);
    try {
      const dataUrl = await fileToDownscaledDataUrl(file, 1600);
      await applyCoverDataUrl(dataUrl);
    } catch (e) {
      toast.error("อัปโหลดภาพปกไม่สำเร็จ");
    } finally {
      setCoverBusy(false);
    }
  }

  async function removeCover() {
    if (!detail) return;
    await patchArticle(detail.id, { coverImageUrl: null });
  }

  async function saveCoverAlt() {
    if (!detail) return;
    await patchArticle(detail.id, { coverAlt });
  }

  async function regenerateWithCover() {
    if (!detail) return;
    setRegenBusy(true);
    try {
      const r = await fetch(`/api/upload-article/articles/${detail.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: detail.outputMode }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "Generate ใหม่ไม่สำเร็จ"); return; }
      applyArticleUpdate(d);
      toast.success("Generate ใหม่แล้ว — ปกถูกใส่ใน HTML แล้ว");
    } finally {
      setRegenBusy(false);
    }
  }

  const h2List = html ? listH2Sections(html) : [];

  /** แทรก <figure> จาก data URI หลังหัวข้อ H2 ที่เลือก (ใช้ทั้งไฟล์ในเครื่อง และรูปจากโฟลเดอร์ Drive) */
  async function insertDataUrlAfterH2(dataUrl: string): Promise<boolean> {
    if (!detail || insertPos === "") return false;
    const altText = (insertAlt || detail.title).replace(/"/g, "&quot;");
    const figureHtml = `<figure class="content-figure"><img src="${dataUrl}" alt="${altText}"></figure>`;
    const newHtml = insertFigureAfterH2(html, insertPos as number, figureHtml);
    const d = await patchArticle(detail.id, { htmlContent: newHtml });
    if (d) {
      toast.success("แทรกรูปในเนื้อหาแล้ว");
      setInsertFile(null); setInsertAlt(""); setInsertPos("");
    }
    return !!d;
  }

  async function doInsertImage() {
    if (!detail || !insertFile || insertPos === "") return;
    setInserting(true);
    try {
      const dataUrl = await fileToDownscaledDataUrl(insertFile, 1600);
      await insertDataUrlAfterH2(dataUrl);
    } catch {
      toast.error("แทรกรูปไม่สำเร็จ");
    } finally {
      setInserting(false);
    }
  }

  async function markReviewed() {
    if (!detail) return;
    setApproving(true);
    try {
      const d = await patchArticle(detail.id, { status: "REVIEWED" });
      if (d) toast.success("ผ่าน Review แล้ว");
    } finally {
      setApproving(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)_340px] gap-4 items-start">
      {/* รายการบทความ */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-3 py-2.5 border-b border-gray-100 text-xs font-semibold text-gray-500">บทความ ({articles.length})</div>
        <div className="max-h-[70vh] overflow-y-auto divide-y divide-gray-50">
          {articles.map(a => (
            <button key={a.id} onClick={() => setSelectedId(a.id)}
              className={`w-full text-left px-3 py-2.5 hover:bg-gray-50 transition-colors ${selectedId === a.id ? "bg-brand-mist/40" : ""}`}>
              <p className="text-xs font-medium text-brand-navy truncate">{a.title}</p>
              <div className="mt-1"><UploadStatusBadge status={a.status} /></div>
            </button>
          ))}
          {articles.length === 0 && <p className="text-xs text-gray-400 text-center py-8">ยังไม่มีบทความ</p>}
        </div>
      </div>

      {/* พรีวิว/แก้ไข */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3 min-w-0">
        {!detail ? (
          <p className="text-sm text-gray-400 text-center py-10">เลือกบทความจากรายการด้านซ้าย</p>
        ) : !html ? (
          <p className="text-sm text-gray-400 text-center py-10">บทความนี้ยังไม่ได้ Generate — ไปที่แท็บ Generate ก่อน</p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-sm font-semibold text-brand-navy truncate">{detail.title}</p>
              <div className="flex items-center gap-1.5">
                <button onClick={() => setViewMode("preview")}
                  className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg border transition-colors ${viewMode === "preview" ? "bg-brand-blue text-white border-brand-blue" : "bg-white text-gray-500 border-gray-200"}`}>
                  Preview
                </button>
                <button onClick={() => setViewMode("edit")}
                  className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg border transition-colors ${viewMode === "edit" ? "bg-brand-blue text-white border-brand-blue" : "bg-white text-gray-500 border-gray-200"}`}>
                  แก้ไข
                </button>
                {viewMode === "edit" && (
                  <Button size="sm" disabled={editSaving} onClick={saveEditedHtml}>
                    {editSaving ? "กำลังบันทึก..." : "บันทึก"}
                  </Button>
                )}
              </div>
            </div>
            <div className="border border-gray-200 rounded-xl overflow-hidden max-h-[55vh] overflow-y-auto">
              {viewMode === "preview" && <ArticleFrame html={html} />}
              {viewMode === "edit" && (
                <ScopedEditable html={html} editorRef={editorRef} className="p-5 outline-none min-h-[200px]" />
              )}
            </div>

            <Button className="w-full" disabled={approving || detail.status === "REVIEWED"} onClick={markReviewed}>
              <CheckCircle2 size={14} className="mr-1.5" />
              {detail.status === "REVIEWED" ? "ผ่าน Review แล้ว" : approving ? "กำลังบันทึก..." : "ผ่าน Review ✓"}
            </Button>
          </>
        )}
      </div>

      {/* แผง SEO + ภาพ */}
      {detail && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-brand-navy">Search appearance</p>
              <Button size="sm" variant="outline" disabled={aiBusy} onClick={aiMeta}>
                {aiBusy ? <Loader2 size={12} className="animate-spin mr-1" /> : <Sparkles size={12} className="mr-1" />}
                ให้ AI เขียน Meta + Slug
              </Button>
            </div>

            <SerpPreview siteHost={siteHost} title={seoDraft.seoTitle} description={seoDraft.metaDescription} slug={seoDraft.slug} />

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-semibold text-gray-600">Meta Title</label>
                <span className={`text-[10px] ${seoDraft.seoTitle.length > 60 ? "text-rose-500" : "text-gray-400"}`}>{seoDraft.seoTitle.length}/60</span>
              </div>
              <Input value={seoDraft.seoTitle} onChange={e => setSeoDraft(p => ({ ...p, seoTitle: e.target.value }))} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-semibold text-gray-600">Meta Description</label>
                <span className={`text-[10px] ${seoDraft.metaDescription.length > 155 ? "text-rose-500" : "text-gray-400"}`}>{seoDraft.metaDescription.length}/155</span>
              </div>
              <Textarea rows={3} value={seoDraft.metaDescription} onChange={e => setSeoDraft(p => ({ ...p, metaDescription: e.target.value }))} />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-600 mb-1">Slug</label>
              <div className="flex items-center gap-1 text-[11px] text-gray-400 mb-1 truncate">{siteHost}/{seoDraft.slug || "…"}</div>
              <Input value={seoDraft.slug} onChange={e => setSeoDraft(p => ({ ...p, slug: e.target.value }))} className="font-mono text-xs" />
            </div>
            <Button size="sm" className="w-full" disabled={savingSeo} onClick={saveSeo}>
              {savingSeo ? "กำลังบันทึก..." : "บันทึก SEO"}
            </Button>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <p className="text-xs font-bold text-brand-navy flex items-center gap-1.5"><ImageIcon size={12} /> ภาพปกบทความ</p>
            {detail.coverImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={detail.coverImageUrl} alt={detail.coverAlt} className="w-full h-auto rounded-lg border border-gray-200" />
            ) : (
              <p className="text-xs text-gray-400 text-center py-4 border border-dashed border-gray-200 rounded-lg">ยังไม่มีภาพปก</p>
            )}
            <input type="file" accept="image/*" disabled={coverBusy}
              onChange={e => { const f = e.target.files?.[0]; if (f) void handleCoverFile(f); e.target.value = ""; }}
              className="text-xs" />
            <Input value={coverAlt} onChange={e => setCoverAlt(e.target.value)} onBlur={saveCoverAlt} placeholder="Alt text ของภาพปก" className="text-xs" />
            {detail.coverImageUrl && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="flex-1" onClick={removeCover}>
                  <Trash2 size={12} className="mr-1" /> ลบภาพปก
                </Button>
                <Button size="sm" variant="outline" className="flex-1" disabled={regenBusy} onClick={regenerateWithCover}>
                  {regenBusy ? <RefreshCw size={12} className="animate-spin mr-1" /> : null} Generate ใหม่ให้ใส่ปก
                </Button>
              </div>
            )}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <p className="text-xs font-bold text-brand-navy">แทรกรูปในเนื้อหา</p>
            <input type="file" accept="image/*" onChange={e => setInsertFile(e.target.files?.[0] ?? null)} className="text-xs" />
            <Input value={insertAlt} onChange={e => setInsertAlt(e.target.value)} placeholder="Alt text ของรูป" className="text-xs" />
            <select value={insertPos} onChange={e => setInsertPos(e.target.value === "" ? "" : Number(e.target.value))}
              className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 bg-white">
              <option value="">หลังหัวข้อ H2:</option>
              {h2List.map((h, i) => <option key={i} value={h.index}>{h.text}</option>)}
            </select>
            <Button size="sm" className="w-full" disabled={!insertFile || insertPos === "" || inserting} onClick={doInsertImage}>
              {inserting ? "กำลังแทรก..." : "แทรกรูป"}
            </Button>
          </div>

          {detail.sourceType === "gdrive" && (
            <DriveImagesPanel
              articleId={detail.id}
              canInsert={!!html && insertPos !== ""}
              insertHint={!html
                ? "แทรกในบทความได้หลัง Generate แล้ว"
                : "เลือกหัวข้อ H2 ในกล่อง \"แทรกรูปในเนื้อหา\" ก่อน แล้วกด \"แทรกในบทความ\""}
              onSetCover={dataUrl => applyCoverDataUrl(dataUrl)}
              onInsert={dataUrl => insertDataUrlAfterH2(dataUrl)}
            />
          )}
        </div>
      )}
    </div>
  );
}
