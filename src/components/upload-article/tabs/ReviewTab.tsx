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
import { exportFontCssDetailed } from "@/lib/upload-article/font-faces";
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
import { WRITER_STALE_MS } from "@/lib/upload-article/writer-timing";
import RewriteDialog, { type RewriteCheck } from "@/components/upload-article/shared/RewriteDialog";

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
  // บทความที่ขึ้นเว็บแล้วคงสถานะ PUSHED หลังกด "ผ่าน Review" — จำไว้แสดงปุ่มว่าผ่านแล้ว
  const [reviewedPushedId, setReviewedPushedId] = useState<string | null>(null);
  const [wordBusy, setWordBusy] = useState(false);
  const [docsBusy, setDocsBusy] = useState(false);
  // Re-generate: เช็คว่าของที่ใช้เขียนเปลี่ยนไหม แล้วถามว่าจะให้ AI เขียนใหม่ทั้งบทความหรือไม่
  const [rewriteCheck, setRewriteCheck] = useState<RewriteCheck | null>(null);
  // บทความที่กำลังรอ/เช็คเขียนใหม่ (หลาย id ได้ — สลับไปบทความอื่นแล้วปุ่มของบทความนั้นไม่ถูกล็อกตาม)
  const [rewriteBusyIds, setRewriteBusyIds] = useState<string[]>([]);
  const markRewriteBusy = (id: string, on: boolean) =>
    setRewriteBusyIds((cur) => (on ? (cur.includes(id) ? cur : [...cur, id]) : cur.filter((x) => x !== id)));
  // บทความที่มีเวอร์ชันก่อนเขียนใหม่ให้ย้อนกลับ
  const [backupIds, setBackupIds] = useState<Record<string, boolean>>({});
  const [undoBusy, setUndoBusy] = useState(false);

  // บทความที่เลือกอยู่ตอนนี้ (async ที่จบทีหลังใช้เช็คว่ายังเลือกอยู่ไหม) + บทความที่กำลังรอผลเขียนใหม่ + ออกจากหน้าแล้ว
  const selectedRef = useRef<string | null>(selectedId);
  selectedRef.current = selectedId;
  // id -> token ของลูปรอผล (กันลูปเก่าที่ถูกยกเลิกไปลบทะเบียนของลูปใหม่ตอนสลับ A-B-A)
  const pollingIds = useRef<Map<string, object>>(new Map());
  const unmountedRef = useRef(false);
  useEffect(() => { unmountedRef.current = false; return () => { unmountedRef.current = true; }; }, []);

  useEffect(() => { if (selectedId) void loadArticleDetail(selectedId); }, [selectedId, loadArticleDetail]);
  // กล่องถามเขียนใหม่เป็นของบทความที่เปิดตอนกด — สลับบทความแล้วปิด
  useEffect(() => { setRewriteCheck(null); }, [selectedId]);

  const detail = selectedId ? articleDetails[selectedId] : null;
  const rewriteBusy = !!selectedId && rewriteBusyIds.includes(selectedId);
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
      const d = await patchArticle(detail.id, { htmlContent: newHtml, expectedUpdatedAt: detail.updatedAt });
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
    setReviewedPushedId(null);
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

  /** ผลของ "เขียนใหม่ด้วย AI" ที่เซิร์ฟเวอร์จดไว้ใน pushPrefs.articleRewriteResults */
  type RewriteResult = { at: string; ok: boolean; error?: string; warnings?: string[] };
  const REWRITE_POLL_MS = 5000;
  /** เกินเวลานี้ (WRITER_STALE_MS + 60 วินาที) ยังไม่มีผล = เซิร์ฟเวอร์ตัดกลางทาง */
  const rewriteDeadline = (from: number) => from + WRITER_STALE_MS + 60_000;

  /** poll พังติดกันเกินนี้ถึงจะเลิกรอ (เน็ต/เซิร์ฟเวอร์สะดุดครั้งสองครั้งไม่ใช่ความล้มเหลว) */
  const REWRITE_MAX_POLL_FAILS = 6;
  /** ไม่กำลังเขียนแล้วแต่ไม่มีผลใหม่นานเกินนี้ = ผลไม่ชัดเจน (เขียนผลลง prefs ไม่สำเร็จ) */
  const REWRITE_NO_RESULT_MS = 30_000;

  /** รอผลเขียนใหม่ — ผลใหม่ = lastResult.at ต่างจาก baseline (ไม่เทียบนาฬิกาเบราว์เซอร์) */
  async function waitRewriteResult(id: string, baselineAt: string | null, startedAt: number, cancelled: () => boolean): Promise<RewriteResult | "timeout" | "stopped" | "error" | "unclear"> {
    let fails = 0;
    let idleSince: number | null = null;
    for (;;) {
      await new Promise((res) => setTimeout(res, REWRITE_POLL_MS));
      if (cancelled()) return "stopped";
      if (Date.now() > rewriteDeadline(startedAt)) return "timeout";
      let c: { rewriting?: boolean; lastResult?: RewriteResult | null; hasBackup?: boolean } | null = null;
      try {
        const r = await fetch(`/api/upload-article/articles/${id}/rewrite-check`);
        if (r.ok) c = await r.json().catch(() => null);
      } catch { /* เน็ตหลุดชั่วคราว */ }
      if (!c) {
        if (++fails >= REWRITE_MAX_POLL_FAILS) return "error";
        continue;
      }
      fails = 0;
      if (c.rewriting) { idleSince = null; continue; }
      const lr = c.lastResult;
      if (lr && lr.at !== baselineAt) return lr;
      if (idleSince === null) idleSince = Date.now();
      else if (Date.now() - idleSince > REWRITE_NO_RESULT_MS) return "unclear";
    }
  }

  const imageIntentKey = (id: string) => `rewriteImages:${id}`;

  /** แสดงผลเขียนใหม่ (สำเร็จ/ล้ม/คำเตือน) — โหลดบทความใหม่เข้าจอเฉพาะเมื่อบทความนี้ยังถูกเลือกอยู่ */
  async function finishRewrite(id: string, title: string, pushed: boolean, lr: RewriteResult, opts: { regenImages: boolean; imageCount: number }) {
    try { sessionStorage.setItem(`rewriteSeen:${id}:${lr.at}`, "1"); } catch { /* sessionStorage ใช้ไม่ได้ = ข้าม */ }
    // ติ๊ก "สร้างรูปใหม่" ไว้ตอนกดเขียน แต่หน้าถูกโหลดใหม่/กลับมาเปิด = ใช้ที่จำไว้ (ทำครั้งเดียว)
    let regenImages = opts.regenImages;
    let imageCount = opts.imageCount;
    try {
      const raw = sessionStorage.getItem(imageIntentKey(id));
      if (raw) {
        sessionStorage.removeItem(imageIntentKey(id));
        if (!regenImages) { const v = JSON.parse(raw) as { imageCount?: number }; regenImages = true; imageCount = Math.max(1, Number(v.imageCount) || 1); }
      }
    } catch { /* ไม่มี/อ่านไม่ได้ = ตามที่ส่งมา */ }
    if (!lr.ok) { toast.error(`เขียนใหม่ไม่สำเร็จ — บทความเดิมยังอยู่ (${title}): ${lr.error || ""}`); return; }
    const fresh = await loadArticleDetail(id, true);
    setBackupIds((cur) => ({ ...cur, [id]: true }));
    if (selectedRef.current === id) {
      if (fresh) {
        applyArticleUpdate(fresh);
        // แผง SEO เก็บค่าใน draft ของตัวเอง — ดึงค่า meta ใหม่เข้าไปด้วย ไม่งั้นบันทึกแล้วทับ meta ใหม่ด้วยของเก่า
        setSeoDraft({ seoTitle: fresh.seoTitle || "", metaDescription: fresh.metaDescription || "", slug: fresh.slug || "" });
      }
      setViewMode("preview");
      toast.success(pushed ? "AI เขียนใหม่แล้ว — กด ผ่าน Review แล้วไป Re-push ที่หน้า Push" : "AI เขียนใหม่แล้ว — ตรวจแล้วกด ผ่าน Review");
    } else {
      toast.success(`AI เขียนใหม่แล้ว: ${title}`);
    }
    if (lr.warnings?.length) toast.warning(`คำต้องห้ามที่ยังเหลือ (${title}): ${lr.warnings.join(", ")}`);
    if (regenImages) {
      try {
        const ir = await fetch(`/api/upload-article/articles/${id}/images`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "inline", withText: true, count: imageCount }),
        });
        const imgRes = await ir.json().catch(() => ({}));
        if (!ir.ok) toast.error(imgRes?.error || "สร้างรูปประกอบใหม่ไม่สำเร็จ");
        else {
          const f2 = await loadArticleDetail(id, true);
          if (f2 && selectedRef.current === id) applyArticleUpdate(f2);
          toast.success("สร้างรูปประกอบใหม่แล้ว");
        }
      } catch {
        toast.error("สร้างรูปประกอบใหม่ไม่สำเร็จ (เชื่อมต่อไม่ได้) — ลองสร้างรูปจากแท็บรูปภาพ");
      }
    }
  }

  /** รอผลแล้วแสดง — ใช้ทั้งหลังกดเขียนใหม่ และตอนเปิดหน้าซ้ำที่ยังเขียนอยู่ */
  async function awaitAndFinishRewrite(id: string, title: string, pushed: boolean, baselineAt: string | null, startedAt: number, cancelled: () => boolean, opts: { regenImages: boolean; imageCount: number }) {
    const res = await waitRewriteResult(id, baselineAt, startedAt, cancelled);
    if (res === "stopped") return;
    if (res === "timeout") { toast.error("ยังไม่เห็นผล ลองเปิดหน้านี้ใหม่อีกครั้งภายหลัง"); return; }
    if (res === "error") { toast.error("เช็คผลเขียนใหม่ไม่สำเร็จ — เปิดหน้านี้ใหม่อีกครั้งเพื่อดูผล"); return; }
    if (res === "unclear") {
      // เขียนจบแล้วแต่ไม่เห็นผลที่จดไว้ — โหลดบทความจริงมาแสดง แล้วให้ทีมตรวจเอง
      const fresh = await loadArticleDetail(id, true);
      if (fresh && selectedRef.current === id) {
        applyArticleUpdate(fresh);
        setSeoDraft({ seoTitle: fresh.seoTitle || "", metaDescription: fresh.metaDescription || "", slug: fresh.slug || "" });
      }
      toast.warning(`ผลไม่ชัดเจน (${title}) — โหลดบทความล่าสุดมาแสดงแล้ว ตรวจเนื้อหาก่อนใช้งาน`);
      return;
    }
    await finishRewrite(id, title, pushed, res, opts);
  }

  /** เขียนใหม่ทั้งบทความด้วย AI (แถวเงา + สลับเข้าบทความเดิมตอนจบ) — เซิร์ฟเวอร์ทำต่อจนจบแม้ปิดหน้า จึง poll ผลจาก rewrite-check */
  async function rewriteWithAi(opts: { regenImages: boolean }) {
    if (!detail) return;
    const id = detail.id;
    const title = detail.title;
    const pushed = detail.status === "PUSHED";
    const m = /^kw:(.*?)(?:#v(\d+))?$/.exec(detail.sourceName || "");
    if (!m) return;
    const imageCount = Math.max(1, (detail.sourceHtml?.match(/data-ua-gen/g) || []).length);
    setRewriteCheck(null);
    markRewriteBusy(id, true);
    setReviewedPushedId(null);
    const token = {};
    pollingIds.current.set(id, token);
    // จำไว้ว่าติ๊กสร้างรูปใหม่ — โหลดหน้าใหม่ระหว่างรอแล้วยังทำต่อตอนเขียนเสร็จ
    try {
      if (opts.regenImages) sessionStorage.setItem(imageIntentKey(id), JSON.stringify({ imageCount }));
      else sessionStorage.removeItem(imageIntentKey(id));
    } catch { /* sessionStorage ใช้ไม่ได้ = ข้าม */ }
    try {
      // ผลก่อนหน้า = baseline (เช็คก่อน POST) — ผลใหม่คือ lastResult.at ที่ต่างจากนี้
      const b = await fetch(`/api/upload-article/articles/${id}/rewrite-check`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (!b) { toast.error("เช็คสถานะบทความไม่สำเร็จ ลองใหม่อีกครั้ง"); return; }
      if (b.rewriting) { toast.info("AI กำลังเขียนบทความนี้ใหม่อยู่ รอให้เสร็จก่อน"); return; }
      if (b.pushing) { toast.info("บทความนี้กำลัง push อยู่ รอให้เสร็จก่อนแล้วลองใหม่"); return; }
      const baselineAt: string | null = b.lastResult?.at ?? null;
      const startedAt = Date.now();
      try {
        const r = await fetch(`/api/upload-article/clients/${client.id}/write`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keywordId: m[1], variant: m[2] ? Number(m[2]) : 1, rewriteArticleId: id }),
        });
        if (!r.ok || !r.body) {
          const d = await r.json().catch(() => ({}));
          toast.error(d?.error || "เริ่มเขียนใหม่ไม่สำเร็จ");
          try { sessionStorage.removeItem(imageIntentKey(id)); } catch { /* ข้าม */ }
          return;
        }
        // อ่าน stream ทิ้งให้หมดเพื่อไม่ให้ค้าง — ผลจริงดูจาก rewrite-check (client หลุดกลางทางก็ยังได้ผล)
        void r.body.pipeTo(new WritableStream()).catch(() => {});
      } catch {
        // คำขอหลุดกลางทาง — เซิร์ฟเวอร์อาจเริ่มเขียนไปแล้ว รอดูผลจาก baseline ต่อ
        toast.warning("เชื่อมต่อสะดุดตอนสั่งเขียนใหม่ — กำลังตรวจว่าเซิร์ฟเวอร์เริ่มเขียนหรือไม่");
      }
      await awaitAndFinishRewrite(id, title, pushed, baselineAt, startedAt, () => unmountedRef.current || pollingIds.current.get(id) !== token, { regenImages: opts.regenImages, imageCount });
    } finally {
      if (pollingIds.current.get(id) === token) pollingIds.current.delete(id);
      if (!unmountedRef.current) markRewriteBusy(id, false);
    }
  }

  // เปิดบทความที่ AI เขียน: เช็คครั้งเดียว — ยังเขียนใหม่อยู่ = รอผลต่อ, มีผลที่ยังไม่เคยเห็น = แจ้งครั้งเดียว (ไม่เรียก AI)
  const resumeKey = detail?.sourceType === "ai" ? detail.id : null;
  useEffect(() => {
    if (!resumeKey || pollingIds.current.has(resumeKey)) return;
    const id = resumeKey;
    const token = {};
    let cancelled = false;
    const stop = () => cancelled || unmountedRef.current || selectedRef.current !== id;
    void (async () => {
      const c = await fetch(`/api/upload-article/articles/${id}/rewrite-check`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (!c || stop()) return;
      setBackupIds((cur) => (cur[id] === !!c.hasBackup ? cur : { ...cur, [id]: !!c.hasBackup }));
      const title = articleDetails[id]?.title || "";
      const pushed = articleDetails[id]?.status === "PUSHED";
      const lr = c.lastResult as RewriteResult | null | undefined;
      if (c.rewriting) {
        pollingIds.current.set(id, token);
        markRewriteBusy(id, true);
        try { await awaitAndFinishRewrite(id, title, pushed, lr?.at ?? null, Date.now(), stop, { regenImages: false, imageCount: 1 }); }
        finally {
          if (pollingIds.current.get(id) === token) { pollingIds.current.delete(id); if (!unmountedRef.current) markRewriteBusy(id, false); }
        }
        return;
      }
      if (lr?.at) {
        let seen = false;
        try { seen = sessionStorage.getItem(`rewriteSeen:${id}:${lr.at}`) === "1"; } catch { /* ถือว่ายังไม่เห็น */ }
        if (!seen) await finishRewrite(id, title, pushed, lr, { regenImages: false, imageCount: 1 });
      }
    })();
    return () => {
      cancelled = true;
      // ปล่อยทะเบียนทันทีที่ออกจากบทความนี้ — กลับมาเปิดภายใน 5 วินาทีต้องเริ่มรอรอบใหม่ได้
      if (pollingIds.current.get(id) === token) { pollingIds.current.delete(id); markRewriteBusy(id, false); }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeKey]);

  /** กด Re-generate: ถามเซิร์ฟเวอร์ก่อนว่าของที่ใช้เขียนเปลี่ยนไหม — ไม่เปลี่ยน/เช็คไม่ได้ = ขั้นตอนเดิมทุกอย่าง */
  async function onRegenerateClick() {
    if (!detail) return;
    const id = detail.id;
    markRewriteBusy(id, true);
    let c: RewriteCheck | null = null;
    try {
      const r = await fetch(`/api/upload-article/articles/${id}/rewrite-check`);
      if (r.ok) c = await r.json();
    } catch { /* เช็คไม่ได้ = ใช้ขั้นตอนเดิม */ }
    markRewriteBusy(id, false);
    // เช็คเสร็จตอนที่ผู้ใช้สลับไปบทความอื่นแล้ว — ห้ามเปิดกล่อง/สร้าง HTML ให้บทความผิดตัว
    if (selectedRef.current !== id) return;
    if (c?.rewriting) { toast.info("AI กำลังเขียนบทความนี้ใหม่อยู่ รอให้เสร็จก่อน"); return; }
    if (c?.canRewrite && c.changed.length > 0) { setRewriteCheck(c); return; }
    regenerateFromReview();
  }

  /** ปุ่ม "ให้ AI เขียนใหม่ทั้งบทความ" — เปิดกล่องแม้ไม่พบว่าของที่ใช้เขียนเปลี่ยน */
  async function onForceRewriteClick() {
    if (!detail) return;
    const id = detail.id;
    markRewriteBusy(id, true);
    try {
      const r = await fetch(`/api/upload-article/articles/${id}/rewrite-check`);
      if (!r.ok) { toast.error("เช็คสถานะบทความไม่สำเร็จ ลองใหม่อีกครั้ง"); return; }
      const c = await r.json();
      if (selectedRef.current !== id) return;
      if (c.rewriting) { toast.info("AI กำลังเขียนบทความนี้ใหม่อยู่ รอให้เสร็จก่อน"); return; }
      if (c.pushing) { toast.info("บทความนี้กำลัง push อยู่ รอให้เสร็จก่อนแล้วลองใหม่"); return; }
      if (!c.canRewrite) { toast.error(c.reason || "บทความนี้ให้ AI เขียนใหม่ไม่ได้"); return; }
      setRewriteCheck(c);
    } catch {
      toast.error("เช็คสถานะบทความไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      markRewriteBusy(id, false);
    }
  }

  /** ย้อนเนื้อหากลับไปก่อน AI เขียนใหม่รอบล่าสุด (โพสต์บนเว็บไม่ถูกแตะจนกว่าจะ Re-push) */
  async function undoRewrite() {
    if (!detail || undoBusy) return;
    const id = detail.id;
    const pushed = detail.status === "PUSHED";
    if (!confirm(["ย้อนกลับไปเป็นเนื้อหาก่อน AI เขียนใหม่รอบล่าสุด?", "เนื้อหาตอนนี้ (รวมที่แก้มือหลังเขียนใหม่) จะถูกแทนที่ และย้อนซ้ำไม่ได้", pushed ? "บทความบนเว็บไม่เปลี่ยนจนกว่าจะ Re-push" : ""].filter(Boolean).join("\n"))) return;
    setUndoBusy(true);
    try {
      const r = await fetch(`/api/upload-article/articles/${id}/rewrite-undo`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "ย้อนกลับไม่สำเร็จ"); if (r.status === 404) setBackupIds((cur) => ({ ...cur, [id]: false })); return; }
      setBackupIds((cur) => ({ ...cur, [id]: false }));
      const fresh = await loadArticleDetail(id, true);
      if (fresh && selectedRef.current === id) {
        applyArticleUpdate(fresh);
        setSeoDraft({ seoTitle: fresh.seoTitle || "", metaDescription: fresh.metaDescription || "", slug: fresh.slug || "" });
        setViewMode("preview");
      }
      toast.success("ย้อนกลับเป็นเนื้อหาก่อนเขียนใหม่แล้ว");
    } catch {
      toast.error("ย้อนกลับไม่สำเร็จ (เชื่อมต่อไม่ได้) ลองใหม่อีกครั้ง");
    } finally {
      setUndoBusy(false);
    }
  }

  function regenerateFromReview() {
    if (!detail) return;
    const pushed = detail.status === "PUSHED";
    const msg = [
      "สร้าง HTML ใหม่จากต้นฉบับเดิม?",
      "ปุ่มนี้ไม่เรียก AI เนื้อหาเดิมทุกคำ และไม่ได้ใช้ Comment / ข้อจำกัดที่เพิ่มทีหลัง ถ้าต้องการให้ AI เขียนใหม่ ใช้ปุ่ม \"ให้ AI เขียนใหม่ทั้งบทความ\" ในหน้านี้",
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
      if (d?.status === "PUSHED") {
        setReviewedPushedId(d.id);
        toast.success("ผ่าน Review แล้ว — กด Re-push ที่หน้า Push เพื่ออัปเดตบนเว็บ");
      } else if (d) toast.success("ผ่าน Review แล้ว");
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
    const { css: fontCss, skipped: fontsSkipped } = await exportFontCssDetailed(client.theme.detail?.article);
    if (fontsSkipped > 0) toast.warning(`ไฟล์นี้ขาดฟอนต์ ${fontsSkipped} ไฟล์ เพราะดึงจากเว็บไม่ได้หรือไฟล์ใหญ่เกิน บทความบนเว็บจริงไม่กระทบ`);
    const doc = m.buildStandaloneArticleHtml({
      html: applyFaqDisplay(o.html, client.theme.detail?.faq), title: o.title, lang: resolveArticleLanguage({ projectLanguage: client.language, mode: client.language, title: o.title }),
      coverSrc: o.coverSrc, coverAlt: o.coverAlt, pageBackground: client.theme.pageBackground, fontCss,
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
                <button onClick={onRegenerateClick} disabled={regenBusy || editSaving || rewriteBusy}
                  title="สร้าง HTML ใหม่จากต้นฉบับเดิม ไม่เรียก AI และไม่ใช้ Comment / ข้อจำกัดที่เพิ่มทีหลัง — ที่แก้มือจะหาย (ให้ AI เขียนใหม่ใช้ปุ่ม ให้ AI เขียนใหม่ทั้งบทความ)"
                  className="px-2.5 py-1 text-[11px] font-semibold rounded-lg border bg-white text-gray-500 border-gray-200 hover:text-brand-blue disabled:opacity-50 flex items-center gap-1">
                  <RefreshCw size={11} className={regenBusy || rewriteBusy ? "animate-spin" : ""} /> {regenBusy ? "กำลัง Generate..." : rewriteBusy ? "AI กำลังทำงาน..." : "Re-generate"}
                </button>
                {detail.sourceType === "ai" && (detail.sourceName || "").startsWith("kw:") && (
                  <button onClick={onForceRewriteClick} disabled={regenBusy || editSaving || rewriteBusy}
                    title="ให้ AI เขียนบทความนี้ใหม่ทั้งบทความ (เสียค่าใช้จ่าย AI) แม้ไม่พบว่าของที่ใช้เขียนเปลี่ยน"
                    className="px-2.5 py-1 text-[11px] font-semibold rounded-lg border bg-white text-gray-500 border-gray-200 hover:text-brand-blue disabled:opacity-50">
                    ให้ AI เขียนใหม่ทั้งบทความ
                  </button>
                )}
                {detail.sourceType === "ai" && backupIds[detail.id] && (
                  <button onClick={undoRewrite} disabled={undoBusy || regenBusy || editSaving || rewriteBusy}
                    title="ย้อนเนื้อหากลับไปก่อน AI เขียนใหม่รอบล่าสุด"
                    className="px-2.5 py-1 text-[11px] font-semibold rounded-lg border bg-white text-gray-500 border-gray-200 hover:text-brand-blue disabled:opacity-50">
                    {undoBusy ? "กำลังย้อนกลับ..." : "ย้อนกลับก่อนเขียนใหม่"}
                  </button>
                )}
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
              {viewMode === "preview" && <ArticleFrame html={applyFaqDisplay(html, client.theme.detail?.faq)} pageBackground={client.theme.pageBackground} fontFaces={client.theme.detail?.article?.fontFaces} />}
              {viewMode === "edit" && (
                <div className={editTone === "readable" ? "ua-edit-readable" : ""}
                  style={{ background: editTone === "site" ? editBackground(client.theme.pageBackground) : "#fff" }}>
                  {editTone === "readable" && <style>{EDIT_READABLE_CSS}</style>}
                  <EditorToolbar editorRef={editorRef} className="sticky top-0 z-10 bg-white" />
                  <ScopedEditable html={html} editorRef={editorRef} className="p-5 outline-none min-h-[200px]" />
                </div>
              )}
            </div>

            <Button className="w-full" disabled={approving || detail.status === "REVIEWED" || reviewedPushedId === detail.id} onClick={markReviewed}>
              <CheckCircle2 size={14} className="mr-1.5" />
              {detail.status === "REVIEWED" || reviewedPushedId === detail.id ? "ผ่าน Review แล้ว" : approving ? "กำลังบันทึก..." : "ผ่าน Review ✓"}
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

      {rewriteCheck && detail && (
        <RewriteDialog
          key={detail.id}
          check={rewriteCheck}
          pushed={detail.status === "PUSHED"}
          hasInlineImages={/data-ua-gen/.test(detail.sourceHtml || "")}
          onRewrite={(o) => { void rewriteWithAi(o); }}
          onHtmlOnly={() => { setRewriteCheck(null); regenerateFromReview(); }}
          onClose={() => setRewriteCheck(null)}
        />
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
