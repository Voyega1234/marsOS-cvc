"use client";

/**
 * แท็บ Review — แก้ไขบทความ, ตั้ง Meta/Slug (ให้ AI เขียนได้), วันที่เผยแพร่, สร้าง/จัดการภาพ, แล้วผ่าน Review
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Sparkles, ImageIcon, Trash2, RefreshCw, Loader2, Download, ExternalLink, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import ArticleFrame from "@/components/shared/ArticleFrame";
import ScopedEditable from "@/components/shared/ScopedEditable";
import EditorToolbar from "@/components/shared/EditorToolbar";
import { fileToDownscaledDataUrl } from "@/lib/imageDownscale";
import { googleDocsResultNotice, isDriveExportConfigured, preloadGoogleDocsExport, sendToGoogleDocs } from "@/lib/google-docs-export";
import type { UploadArticleDTO, UploadClientDTO } from "@/lib/upload-article/types";
import { applyFaqDisplay } from "@/lib/upload-article/theme-css";
import { canDeleteArticle, duplicateMap } from "@/lib/upload-article/duplicates";
import { resolveArticleLanguage } from "@/lib/keyword-language";
import SerpPreview from "@/components/upload-article/shared/SerpPreview";
import UploadStatusBadge, { UPLOAD_STATUS_OPTIONS } from "@/components/upload-article/shared/StatusBadge";
import { listH2Sections, insertFigureAfterH2 } from "@/components/upload-article/shared/htmlSections";
import DriveImagesPanel from "@/components/upload-article/shared/DriveImagesPanel";
import AiImagesPanel from "@/components/upload-article/shared/AiImagesPanel";
import PublishDatePanel from "@/components/upload-article/shared/PublishDatePanel";
import ArticleImagesPanel from "@/components/upload-article/shared/ArticleImagesPanel";
import DeleteArticleDialog from "@/components/upload-article/shared/DeleteArticleDialog";

const PAGE_BG_RE = /^(?:#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\))$/i;

/** พื้นหลังตอนแก้ไขให้ตรงกับ Preview (สีพื้นหน้าเว็บปลายทาง) — รับเฉพาะ hex/rgb */
function editBackground(pageBackground?: string): string {
  const bg = (pageBackground || "").trim();
  return bg && PAGE_BG_RE.test(bg) ? bg : "#fff";
}

/** โหมด "สีอ่านง่าย" — บังคับตัวอักษรเข้มบนพื้นขาว อยู่นอกตัว editor จึงไม่ถูกบันทึกลงบทความ */
const EDIT_READABLE_CSS = `
.ua-edit-readable .cc-scoped-editor,
.ua-edit-readable .cc-scoped-editor *:not(img):not(svg) {
  color: #111827 !important;
  background-color: transparent !important;
  -webkit-text-fill-color: #111827 !important;
}
.ua-edit-readable .cc-scoped-editor a, .ua-edit-readable .cc-scoped-editor a * {
  color: #1d4ed8 !important;
  -webkit-text-fill-color: #1d4ed8 !important;
}
`;

const MAX_PATCH_BYTES = 4_000_000;

export default function ReviewTab({
  client, setClient, articles, allArticles, selectedId, setSelectedId, loadArticleDetail, articleDetails, applyArticleUpdate,
  removeArticle, refreshClient, pbn = false,
}: {
  client: UploadClientDTO;
  setClient: (c: UploadClientDTO) => void;
  articles: UploadArticleDTO[];
  /** ทุกแถวของลูกค้านี้ (รวมที่กำลังเขียน) — ใช้หาบทความซ้ำ */
  allArticles: UploadArticleDTO[];
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  loadArticleDetail: (id: string, force?: boolean) => Promise<UploadArticleDTO | null>;
  articleDetails: Record<string, UploadArticleDTO>;
  applyArticleUpdate: (a: UploadArticleDTO) => void;
  removeArticle: (id: string) => void;
  refreshClient: () => Promise<void>;
  /** PBN Backlinks: แถวที่ push แล้วลบไม่ได้ */
  pbn?: boolean;
}) {
  const [deleteTarget, setDeleteTarget] = useState<UploadArticleDTO | null>(null);
  const dupMap = useMemo(() => duplicateMap(allArticles), [allArticles]);
  const [viewMode, setViewMode] = useState<"preview" | "edit">("preview");
  const [statusFilter, setStatusFilter] = useState<string>("");
  // สีตอนแก้ไขเท่านั้น — ใส่ที่กรอบนอก editorRef จึงไม่ติดไปกับ innerHTML ที่บันทึก/push
  const [editTone, setEditTone] = useState<"site" | "readable">("site");
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
  const [wordBusy, setWordBusy] = useState(false);
  const [docsBusy, setDocsBusy] = useState(false);

  useEffect(() => { if (selectedId) void loadArticleDetail(selectedId); }, [selectedId, loadArticleDetail]);

  const detail = selectedId ? articleDetails[selectedId] : null;
  const html = detail?.htmlContent || "";
  const statusCounts = articles.reduce<Record<string, number>>((acc, a) => { acc[a.status] = (acc[a.status] || 0) + 1; return acc; }, {});
  const visibleArticles = statusFilter ? articles.filter(a => a.status === statusFilter) : articles;

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
      if (!r.ok) { toast.error(d?.error || "Mars เขียน Meta ไม่สำเร็จ"); return; }
      setSeoDraft({ seoTitle: d.seoTitle ?? "", metaDescription: d.metaDescription ?? "", slug: d.slug ?? "" });
      applyArticleUpdate({
        ...(detail as UploadArticleDTO),
        seoTitle: d.seoTitle ?? "",
        metaDescription: d.metaDescription ?? "",
        slug: d.slug ?? "",
        ...(typeof d.htmlContent === "string" ? { htmlContent: d.htmlContent } : {}),
      });
      if (d.warning) toast.warning(d.warning);
      else toast.success(`Mars เขียน Meta แล้ว${typeof d.costUsd === "number" ? ` (ต้นทุน $${d.costUsd.toFixed(4)})` : ""}`);
    } catch (e) {
      toast.error(`Mars เขียน Meta ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
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

  /**
   * Generate ใหม่จาก sourceHtml — ใช้ตัวเลือกเดิมของบทความนี้ (Internal Link / Breadcrumb schema ดูจาก HTML ปัจจุบัน)
   * รูปปก/รูปประกอบอยู่ใน coverImageUrl/sourceHtml จึงไม่หาย แต่ที่แก้มือในโหมด "แก้ไข" (เก็บแค่ใน htmlContent) จะหาย
   * relink: บทความที่ AI เขียน — ถอดลิงก์ภายในเดิมแล้วใส่ใหม่เฉพาะคำที่ตรงคู่ keyword→URL (เซิร์ฟเวอร์ข้ามบทความที่ไม่ใช่ AI/PBN เอง)
   */
  async function regenerate(successMessage: string, relink = false) {
    if (!detail) return;
    setRegenBusy(true);
    try {
      const r = await fetch(`/api/upload-article/articles/${detail.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: detail.outputMode,
          internalLinks: /\bdata-ua-link=/.test(html),
          breadcrumb: !html || /"BreadcrumbList"/.test(html),
          relink,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "Generate ใหม่ไม่สำเร็จ"); return; }
      applyArticleUpdate(d);
      setViewMode("preview");
      const removed = Number(r.headers.get("X-Links-Removed") || 0);
      const added = Number(r.headers.get("X-Links-Added") || 0);
      toast.success(relink && (removed || added) ? `${successMessage} (Internal Link: ถอด ${removed} ใส่ใหม่ ${added})` : successMessage);
    } finally {
      setRegenBusy(false);
    }
  }

  function regenerateWithCover() {
    void regenerate("Generate ใหม่แล้ว — ปกถูกใส่ใน HTML แล้ว");
  }

  function regenerateFromReview() {
    if (!detail) return;
    const pushed = detail.status === "PUSHED";
    const msg = [
      "Generate บทความนี้ใหม่จากต้นฉบับ?",
      "ที่แก้มือในโหมด \"แก้ไข\" จะหาย (รูปปก/รูปประกอบยังอยู่)",
      detail.sourceType === "ai" ? "Internal Link จะถูกจัดใหม่ให้ตรงหัวข้อ" : "",
      pushed ? "บทความบนเว็บยังเป็นเวอร์ชันเดิมจนกว่าจะกด ผ่าน Review แล้ว Re-push" : "",
    ].filter(Boolean).join("\n");
    if (!confirm(msg)) return;
    void regenerate(pushed ? "Generate ใหม่แล้ว — กด ผ่าน Review แล้วไป Re-push ที่หน้า Push" : "Generate ใหม่แล้ว — ตรวจแล้วกด ผ่าน Review", true);
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

  // ── Export ให้ลูกค้าตรวจ: HTML (เปิดดูในเบราว์เซอร์ได้เลย) + Word — ใช้ตัวเดียวกับ SME Review ──
  // โหมดแก้ไขที่ยังไม่บันทึก ก็ export ตามที่เห็นบนจอ
  function exportSource() {
    if (!detail) return null;
    const src = viewMode === "edit" && editorRef.current ? editorRef.current.innerHTML : html;
    return {
      html: src,
      title: detail.title,
      coverSrc: detail.coverImageUrl || undefined,
      coverAlt: detail.coverAlt || detail.title,
      fileBase: detail.slug || detail.title,
    };
  }
  async function buildHtmlBlob() {
    const o = exportSource();
    if (!o) return null;
    const m = await import("@/lib/article-export");
    const doc = m.buildStandaloneArticleHtml({
      html: o.html, title: o.title, lang: resolveArticleLanguage({ projectLanguage: client.language, mode: client.language, title: o.title }),
      coverSrc: o.coverSrc, coverAlt: o.coverAlt, pageBackground: client.theme.pageBackground,
    });
    return { m, blob: new Blob([doc], { type: "text/html;charset=utf-8" }), name: `${m.articleFileName(o.fileBase)}.html` };
  }
  async function openHtmlPreview() {
    const tab = window.open("", "_blank"); // เปิดตอนคลิก ก่อน await — ไม่งั้นเบราว์เซอร์บล็อก popup
    try {
      const r = await buildHtmlBlob();
      if (!r) { tab?.close(); return; }
      if (!r.m.showBlobInTab(tab, r.blob)) {
        r.m.downloadBlob(r.blob, r.name);
        toast.info("เบราว์เซอร์บล็อกแท็บใหม่ — ดาวน์โหลดไฟล์ HTML ให้แทน");
      }
    } catch (e) {
      tab?.close();
      toast.error("สร้างไฟล์ HTML ไม่สำเร็จ: " + (e instanceof Error ? e.message : String(e)));
    }
  }
  async function downloadHtml() {
    try {
      const r = await buildHtmlBlob();
      if (r) r.m.downloadBlob(r.blob, r.name);
    } catch (e) {
      toast.error("สร้างไฟล์ HTML ไม่สำเร็จ: " + (e instanceof Error ? e.message : String(e)));
    }
  }
  async function downloadWord() {
    const o = exportSource();
    if (!o) return;
    setWordBusy(true);
    try {
      const m = await import("@/lib/article-export");
      const blob = await m.buildArticleDocx({ html: o.html, title: o.title, coverSrc: o.coverSrc, coverAlt: o.coverAlt });
      m.downloadBlob(blob, `${m.articleFileName(o.fileBase)}.docx`);
    } catch (e) {
      toast.error("สร้างไฟล์ Word ไม่สำเร็จ: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setWordBusy(false);
    }
  }
  // ห้าม await ก่อน sendToGoogleDocs — popup ขอสิทธิ์ Google / แท็บใหม่ต้องเปิดในจังหวะคลิก
  async function exportGoogleDocs() {
    const o = exportSource();
    if (!o) return;
    setDocsBusy(true);
    try {
      const r = await sendToGoogleDocs(o, async () => {
        const m = await import("@/lib/article-export");
        return m.buildArticleDocx({ html: o.html, title: o.title, coverSrc: o.coverSrc, coverAlt: o.coverAlt });
      });
      const n = googleDocsResultNotice(r);
      const action = n.action;
      toast.success(n.message, action ? { duration: 15000, action: { label: action.label, onClick: () => window.open(action.url, "_blank", "noopener") } } : undefined);
    } catch (e) {
      toast.error("ส่งไป Google Docs ไม่สำเร็จ: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setDocsBusy(false);
    }
  }
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)_340px] gap-4 items-start">
      {/* รายการบทความ */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-3 py-2.5 border-b border-gray-100 space-y-1.5">
          <p className="text-xs font-semibold text-gray-500">
            บทความ ({statusFilter ? `${visibleArticles.length}/${articles.length}` : articles.length})
          </p>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
            <option value="">ทุกสถานะ ({articles.length})</option>
            {UPLOAD_STATUS_OPTIONS.filter(o => statusCounts[o.value] || o.value === statusFilter).map(o => (
              <option key={o.value} value={o.value}>{o.label} ({statusCounts[o.value] || 0})</option>
            ))}
          </select>
        </div>
        <div className="max-h-[70vh] overflow-y-auto divide-y divide-gray-50">
          {visibleArticles.map(a => {
            const dupCount = dupMap.get(a.id)?.length ?? 0;
            return (
              <div key={a.id} className={`flex items-center hover:bg-gray-50 transition-colors ${selectedId === a.id ? "bg-brand-mist/40" : ""}`}>
                <button onClick={() => setSelectedId(a.id)} className="flex-1 min-w-0 text-left px-3 py-2.5">
                  <p className="text-xs font-medium text-brand-navy truncate">{a.title}</p>
                  <div className="mt-1 flex items-center gap-1.5">
                    <UploadStatusBadge status={a.status} />
                    {dupCount > 0 && (
                      <span title={`มีบทความชื่อ/slug/โพสต์เดียวกันอีก ${dupCount} แถว`}
                        className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700">
                        ซ้ำ
                      </span>
                    )}
                  </div>
                </button>
                {canDeleteArticle(a, pbn) && (
                  <button title="ลบบทความ" onClick={() => setDeleteTarget(a)}
                    className="mr-2 p-1.5 shrink-0 rounded-lg text-gray-300 hover:text-rose-600 hover:bg-rose-50 transition-colors">
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            );
          })}
          {articles.length === 0 && <p className="text-xs text-gray-400 text-center py-8">ยังไม่มีบทความ</p>}
          {articles.length > 0 && visibleArticles.length === 0 && <p className="text-xs text-gray-400 text-center py-8">ไม่มีบทความในสถานะนี้</p>}
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
              <div className="flex flex-wrap items-center gap-1.5">
                <button onClick={() => setViewMode("preview")}
                  className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg border transition-colors ${viewMode === "preview" ? "bg-brand-blue text-white border-brand-blue" : "bg-white text-gray-500 border-gray-200"}`}>
                  Preview
                </button>
                <button onClick={() => setViewMode("edit")}
                  className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg border transition-colors ${viewMode === "edit" ? "bg-brand-blue text-white border-brand-blue" : "bg-white text-gray-500 border-gray-200"}`}>
                  แก้ไข
                </button>
                <button onClick={regenerateFromReview} disabled={regenBusy || editSaving}
                  title="Generate ใหม่จากต้นฉบับ (ตัวเลือก Internal Link เดิม) — ที่แก้มือจะหาย"
                  className="px-2.5 py-1 text-[11px] font-semibold rounded-lg border bg-white text-gray-500 border-gray-200 hover:text-brand-blue disabled:opacity-50 flex items-center gap-1">
                  <RefreshCw size={11} className={regenBusy ? "animate-spin" : ""} /> {regenBusy ? "กำลัง Generate..." : "Re-generate"}
                </button>
                <span className="w-px h-4 bg-gray-200 mx-0.5" aria-hidden />
                <button onClick={openHtmlPreview}
                  title="เปิดบทความเป็นหน้า HTML ในแท็บใหม่ — ดูได้ทันที ส่งลิงก์/ไฟล์ให้ลูกค้าตรวจได้"
                  className="px-2.5 py-1 text-[11px] font-semibold rounded-lg border bg-white text-gray-500 border-gray-200 hover:text-brand-blue flex items-center gap-1">
                  <ExternalLink size={11} /> HTML
                </button>
                <button onClick={downloadHtml} title="ดาวน์โหลดไฟล์ .html (เปิดได้ทุกเบราว์เซอร์)"
                  className="px-1.5 py-1 text-[11px] font-semibold rounded-lg border bg-white text-gray-500 border-gray-200 hover:text-brand-blue flex items-center"
                  aria-label="ดาวน์โหลด HTML">
                  <Download size={11} />
                </button>
                <button onClick={downloadWord} disabled={wordBusy} title="ดาวน์โหลดไฟล์ Word (.docx)"
                  className="px-2.5 py-1 text-[11px] font-semibold rounded-lg border bg-white text-gray-500 border-gray-200 hover:text-brand-blue disabled:opacity-50 flex items-center gap-1">
                  {wordBusy ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />} Word
                </button>
                <button onClick={exportGoogleDocs} disabled={docsBusy}
                  onPointerEnter={preloadGoogleDocsExport} onFocus={preloadGoogleDocsExport}
                  title={isDriveExportConfigured()
                    ? "สร้างเป็น Google Doc ใน Drive ของคุณ แล้วเปิดให้ทันที"
                    : "คัดลอกบทความ แล้วเปิด Google Docs ใหม่ให้กดวาง (⌘V / Ctrl+V)"}
                  className="px-2.5 py-1 text-[11px] font-semibold rounded-lg border bg-white text-gray-500 border-gray-200 hover:text-brand-blue disabled:opacity-50 flex items-center gap-1">
                  {docsBusy ? <Loader2 size={11} className="animate-spin" /> : <FileText size={11} />} Google Docs
                </button>
                {viewMode === "edit" && (
                  <button onClick={() => setEditTone(t => (t === "site" ? "readable" : "site"))}
                    title="เปลี่ยนสีเฉพาะตอนแก้ไข ไม่มีผลกับบทความที่บันทึก/push"
                    className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg border transition-colors ${editTone === "readable" ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-500 border-gray-200"}`}>
                    {editTone === "readable" ? "สีอ่านง่าย ✓" : "สีอ่านง่าย"}
                  </button>
                )}
                {viewMode === "edit" && (
                  <Button size="sm" disabled={editSaving} onClick={saveEditedHtml}>
                    {editSaving ? "กำลังบันทึก..." : "บันทึก"}
                  </Button>
                )}
              </div>
            </div>
            <div className="border border-gray-200 rounded-xl overflow-hidden max-h-[55vh] overflow-y-auto">
              {viewMode === "preview" && <ArticleFrame html={applyFaqDisplay(html, client.theme.detail?.faq)} pageBackground={client.theme.pageBackground} />}
              {viewMode === "edit" && (
                <div className={editTone === "readable" ? "ua-edit-readable" : ""}
                  style={{ background: editTone === "site" ? editBackground(client.theme.pageBackground) : "#fff" }}>
                  {editTone === "readable" && <style>{EDIT_READABLE_CSS}</style>}
                  <EditorToolbar editorRef={editorRef} className="sticky top-0 z-10 bg-white" />
                  <ScopedEditable html={html} editorRef={editorRef} className="p-5 outline-none min-h-[200px]" />
                </div>
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
                ให้ Mars เขียน Meta + Slug
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

          <PublishDatePanel client={client} setClient={setClient} articleId={detail.id} />

          <AiImagesPanel client={client} detail={detail} applyArticleUpdate={applyArticleUpdate} />

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

          {html && (
            <ArticleImagesPanel
              html={html}
              coverImageUrl={detail.coverImageUrl}
              onSaveAlt={async (index, alt) => {
                const d = await patchArticle(detail.id, { imageAlt: { index, alt } });
                if (d) toast.success("บันทึก alt แล้ว");
                return !!d;
              }}
              onSaveLink={async (index, href) => {
                const d = await patchArticle(detail.id, { imageLink: { index, href } });
                if (d) toast.success(href ? "ใส่ลิงก์ให้รูปแล้ว" : "เอาลิงก์ออกจากรูปแล้ว");
                return !!d;
              }}
              onSetCover={async (src, alt) => {
                const d = await patchArticle(detail.id, { coverImageUrl: src, coverAlt: alt || coverAlt || detail.title });
                if (d) { setCoverAlt(d.coverAlt || ""); toast.success("ตั้งเป็นภาพปกแล้ว"); }
                return !!d;
              }}
            />
          )}

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

      <DeleteArticleDialog
        article={deleteTarget}
        allArticles={allArticles}
        onClose={() => setDeleteTarget(null)}
        onDeleted={id => { removeArticle(id); void refreshClient(); }}
      />
    </div>
  );
}
