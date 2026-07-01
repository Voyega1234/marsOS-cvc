"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useUIMode } from "@/contexts/UIModeContext";
import { WizardArticleDetail } from "@/components/simple/WizardArticleDetail";
import { toast } from "sonner";
import Link from "next/link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { FunnelBadge } from "@/components/shared/FunnelBadge";
import { LoadingSpinner } from "@/components/shared/LoadingState";
import { safeJson, formatDate, formatDateTime } from "@/lib/utils";
import {
  FileText, PenLine, Search, Image, Globe, CheckCircle, History,
  Sparkles, RefreshCw, AlertTriangle, BookOpen, LayoutList, Save,
  Eye, Code2, AlignLeft, Download, Share2, BarChart2, Zap, Link2, Copy,
  ImagePlus,
} from "lucide-react";
import type { ArticleStatus } from "@/types";
import { ArticleEditor } from "@/components/articles/ArticleEditor";
import { ReviewChecklist } from "@/components/articles/ReviewChecklist";
import { ArticleAuditPanel } from "@/components/articles/ArticleAuditPanel";

interface OutlineSection {
  heading: string;
  subheadings?: string[];
  keyPoints?: string[];
  wordCount?: number;
}

interface OutlineData {
  title?: string;
  metaDescription?: string;
  sections?: OutlineSection[];
  estimatedWordCount?: number;
  faqSuggestions?: string[];
}

type CurrentUser = { id: string; role: string; name?: string | null };

interface Props {
  article: {
    id: string;
    title: string;
    slug: string;
    status: string;
    funnelStage: string;
    searchIntent: string;
    brief?: string | null;
    outline?: string | null;
    htmlContent?: string | null;
    seoTitle?: string | null;
    metaDescription?: string | null;
    faqSchema?: string | null;
    imagePrompt?: string | null;
    coverImageUrl?: string | null;
    wordpressUrl?: string | null;
    wordpressStatus?: string | null;
    auditScore?: number | null;
    auditResults?: string | null;
    createdAt: Date;
    updatedAt: Date;
    project: { id: string; name: string; website: string; automationMode: string };
    keyword?: { keyword: string; relatedKeywords: string } | null;
    assignedTo?: { id: string; name: string | null } | null;
    reviewer?: { id: string; name: string | null } | null;
    versions: { id: string; versionNumber: number; changeNote?: string | null; createdAt: Date }[];
    reviews: { id: string; seoScore?: number | null; aeoScore?: number | null; conversionScore?: number | null; riskLevel?: string | null; notes?: string | null; createdAt: Date; reviewer: { name: string | null } }[];
    aiJobs: { id: string; jobType: string; status: string; tokenUsed?: number | null; estimatedCost?: number | null; createdAt: Date }[];
    comments: { id: string; body: string; createdAt: Date; user: { name: string | null } }[];
  };
  users: { id: string; name: string | null; role: string }[];
  currentUser: CurrentUser;
  projectArticles?: { id: string; title: string; slug: string; status: string; keyword?: { keyword: string } | null }[];
}

const AI_ACTIONS = [
  { key: "outline",      labelTh: "สร้าง Outline",      requiredStatus: [],                                   lockedReason: "",                                    endpoint: "/api/ai/outline",       icon: LayoutList, color: "bg-[#FFF7ED] hover:bg-[#FEE9CC] text-[#9A4A00] border border-[#F5C896]", cost: "~$0.01" },
  { key: "article",      labelTh: "เขียนบทความ",        requiredStatus: ["OUTLINE_APPROVED"],                 lockedReason: "ต้อง Approve Outline ก่อน",           endpoint: "/api/ai/article",       icon: PenLine,    color: "bg-[#EDFAF4] hover:bg-[#D5F5E5] text-[#1A6A46] border border-[#B8E8D0]", cost: "~$0.04" },
  { key: "image-prompt", labelTh: "สร้าง Image Prompt", requiredStatus: ["ARTICLE_DONE","IMAGE_PROMPT_DONE"], lockedReason: "ต้องเขียนบทความเสร็จก่อน",           endpoint: "/api/ai/image-prompt",  icon: Image,      color: "bg-[#F5EEFF] hover:bg-[#EBD9FF] text-[#6B35A8] border border-[#D4B8F5]", cost: "~$0.01" },
  { key: "seo-check",    labelTh: "ตรวจ SEO",           requiredStatus: ["ARTICLE_DONE","IMAGE_PROMPT_DONE","SEO_REVIEW","REVISION_REQUIRED","APPROVED","WORDPRESS_DRAFTED","POSTED"], lockedReason: "ต้องเขียนบทความเสร็จก่อน", endpoint: "/api/ai/seo-check", icon: Search, color: "bg-[#EEF3FF] hover:bg-[#DCE7FF] text-[#2B4FAD] border border-[#BAC8F5]", cost: "~$0.02" },
  { key: "wordpress",    labelTh: "ส่ง WordPress Draft", requiredStatus: ["APPROVED"],                        lockedReason: "ต้อง Approve บทความก่อน",             endpoint: "/api/wordpress/draft",  icon: Globe,      color: "bg-[#F5F5F5] hover:bg-[#EBEBEB] text-[#444444] border border-[#E0E0E0]", cost: "free" },
];

// ── Version Diff ─────────────────────────────────────────────────────────────
function VersionDiff({ versions }: {
  versions: { id: string; versionNumber: number; changeNote?: string | null; htmlContent?: string | null; createdAt: Date }[];
}) {
  const [vA, setVA] = useState<string>(versions[1]?.id ?? "");
  const [vB, setVB] = useState<string>(versions[0]?.id ?? "");

  if (versions.length === 0) return <p className="text-gray-400 text-sm">ยังไม่มีประวัติ version</p>;

  const verA = versions.find((v) => v.id === vA);
  const verB = versions.find((v) => v.id === vB);

  function stripHtmlLocal(h: string) {
    return h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }

  // Simple word-level diff
  function diffWords(a: string, b: string) {
    const wa = a.split(/\s+/);
    const wb = b.split(/\s+/);
    const setA = new Set(wa);
    const setB = new Set(wb);
    const added   = wb.filter((w) => !setA.has(w)).slice(0, 40);
    const removed = wa.filter((w) => !setB.has(w)).slice(0, 40);
    const wcA = wa.length;
    const wcB = wb.length;
    return { added, removed, wcA, wcB, delta: wcB - wcA };
  }

  const textA = stripHtmlLocal(verA?.htmlContent ?? "");
  const textB = stripHtmlLocal(verB?.htmlContent ?? "");
  const diff = verA && verB && textA && textB ? diffWords(textA, textB) : null;

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-gray-900">Version History</h3>

      {/* Version list */}
      <div className="space-y-2">
        {versions.map((v) => (
          <div key={v.id} className="flex items-center gap-3 p-3 border rounded-lg">
            <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-sm font-bold text-gray-600 shrink-0">
              v{v.versionNumber}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900">{v.changeNote ?? "Auto-saved"}</p>
              <p className="text-xs text-gray-400">{formatDateTime(v.createdAt)}</p>
            </div>
            {v.htmlContent && (
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => setVA(v.id)}
                  className={`px-2 py-1 text-[10px] font-bold rounded ${vA === v.id ? "bg-blue-600 text-white" : "border border-gray-200 text-gray-500 hover:bg-gray-50"}`}
                >A</button>
                <button
                  onClick={() => setVB(v.id)}
                  className={`px-2 py-1 text-[10px] font-bold rounded ${vB === v.id ? "bg-green-600 text-white" : "border border-gray-200 text-gray-500 hover:bg-gray-50"}`}
                >B</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Diff panel */}
      {diff && verA && verB && (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center gap-3">
            <span className="text-xs font-semibold text-gray-700">Diff: v{verA.versionNumber} → v{verB.versionNumber}</span>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${diff.delta > 0 ? "bg-green-100 text-green-700" : diff.delta < 0 ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-500"}`}>
              {diff.delta > 0 ? `+${diff.delta}` : diff.delta} คำ ({diff.wcA} → {diff.wcB})
            </span>
          </div>
          <div className="grid grid-cols-2 divide-x divide-gray-200">
            <div className="p-4">
              <p className="text-[10px] font-bold text-red-500 uppercase mb-2">ลบออก ({diff.removed.length} คำ)</p>
              <div className="flex flex-wrap gap-1">
                {diff.removed.length === 0
                  ? <p className="text-xs text-gray-400">ไม่มีคำที่ถูกลบ</p>
                  : diff.removed.map((w, i) => (
                    <span key={i} className="px-1.5 py-0.5 bg-red-50 text-red-600 text-xs rounded border border-red-100 line-through">{w}</span>
                  ))
                }
              </div>
            </div>
            <div className="p-4">
              <p className="text-[10px] font-bold text-green-600 uppercase mb-2">เพิ่มใหม่ ({diff.added.length} คำ)</p>
              <div className="flex flex-wrap gap-1">
                {diff.added.length === 0
                  ? <p className="text-xs text-gray-400">ไม่มีคำที่เพิ่ม</p>
                  : diff.added.map((w, i) => (
                    <span key={i} className="px-1.5 py-0.5 bg-green-50 text-green-700 text-xs rounded border border-green-100">{w}</span>
                  ))
                }
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Schema Generator ─────────────────────────────────────────────────────────
function SchemaGenerator({ article }: { article: { title: string; seoTitle?: string | null; metaDescription?: string | null; wordpressUrl?: string | null; project: { website: string; name: string } } }) {
  const [type, setType] = useState<"Article" | "HowTo" | "LocalBusiness" | "FAQPage">("Article");
  const [copied, setCopied] = useState(false);

  const url = article.wordpressUrl ?? `https://${article.project.website}`;

  const schemas: Record<string, object> = {
    Article: {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: article.seoTitle ?? article.title,
      description: article.metaDescription ?? "",
      url,
      author: { "@type": "Organization", name: article.project.name },
      publisher: { "@type": "Organization", name: article.project.name },
      datePublished: new Date().toISOString().split("T")[0],
      dateModified: new Date().toISOString().split("T")[0],
    },
    HowTo: {
      "@context": "https://schema.org",
      "@type": "HowTo",
      name: article.title,
      description: article.metaDescription ?? "",
      url,
      step: [
        { "@type": "HowToStep", name: "ขั้นตอนที่ 1", text: "อธิบายขั้นตอนที่ 1 ที่นี่" },
        { "@type": "HowToStep", name: "ขั้นตอนที่ 2", text: "อธิบายขั้นตอนที่ 2 ที่นี่" },
      ],
    },
    LocalBusiness: {
      "@context": "https://schema.org",
      "@type": "LocalBusiness",
      name: article.project.name,
      description: article.metaDescription ?? "",
      url: `https://${article.project.website}`,
      telephone: "+66-XX-XXX-XXXX",
      address: { "@type": "PostalAddress", addressCountry: "TH", addressLocality: "Bangkok" },
    },
    FAQPage: {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        { "@type": "Question", name: "คำถามที่ 1?", acceptedAnswer: { "@type": "Answer", text: "คำตอบที่ 1" } },
        { "@type": "Question", name: "คำถามที่ 2?", acceptedAnswer: { "@type": "Answer", text: "คำตอบที่ 2" } },
      ],
    },
  };

  const json = JSON.stringify(schemas[type], null, 2);
  const scriptTag = `<script type="application/ld+json">\n${json}\n</script>`;

  function copy() {
    navigator.clipboard.writeText(scriptTag);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden mt-2">
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
        <p className="text-xs font-semibold text-gray-700">Schema Markup Generator</p>
        <div className="flex items-center gap-1">
          {(["Article", "HowTo", "FAQPage", "LocalBusiness"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${type === t ? "bg-gray-900 text-white" : "text-gray-500 hover:bg-gray-200"}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <pre className="p-4 bg-gray-900 text-green-300 text-[11px] overflow-auto max-h-52 font-mono leading-relaxed">
        {scriptTag}
      </pre>
      <div className="px-4 py-2.5 border-t border-gray-200 flex justify-end">
        <button
          onClick={copy}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 hover:bg-gray-700 text-white text-xs font-semibold rounded-lg transition-colors"
        >
          <Copy className="h-3 w-3" />
          {copied ? "คัดลอกแล้ว ✓" : "Copy Schema"}
        </button>
      </div>
    </div>
  );
}

// ── Brief Editor with target word count ──────────────────────────────────────
function BriefEditor({ article }: { article: { id: string; brief?: string | null } }) {
  const router = useRouter();
  const [brief, setBrief] = useState(article.brief ?? "");
  const [targetWc, setTargetWc] = useState(() => {
    const m = (article.brief ?? "").match(/target.*?(\d{3,5})\s*คำ/i);
    return m ? m[1] : "";
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const fullBrief = targetWc ? `[Target: ${targetWc} คำ]\n${brief}` : brief;
    await fetch(`/api/articles/${article.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief: fullBrief.trim() }),
    });
    setSaving(false);
    toast.success("บันทึก Brief แล้ว");
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">Brief</h3>
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 hover:bg-gray-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
        >
          <Save className="h-3.5 w-3.5" />
          {saving ? "กำลังบันทึก..." : "บันทึก"}
        </button>
      </div>

      {/* Target word count */}
      <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-100 rounded-xl">
        <span className="text-xs font-semibold text-blue-700 shrink-0">เป้าหมายจำนวนคำ</span>
        <div className="flex items-center gap-1.5">
          {["800", "1200", "1500", "2000", "2500", "3000"].map((n) => (
            <button
              key={n}
              onClick={() => setTargetWc(n)}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${targetWc === n ? "bg-blue-600 text-white" : "bg-white border border-blue-200 text-blue-600 hover:bg-blue-50"}`}
            >
              {n}
            </button>
          ))}
          <input
            type="number"
            value={targetWc}
            onChange={(e) => setTargetWc(e.target.value)}
            placeholder="กำหนดเอง"
            className="w-24 px-2 py-1 text-xs border border-blue-200 rounded-lg text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <span className="text-xs text-blue-500">คำ</span>
        </div>
      </div>

      <textarea
        rows={5}
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
        placeholder="เขียน brief สำหรับบทความนี้ เช่น เป้าหมาย, tone, จุดเน้น, สิ่งที่ต้องมี..."
        className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 resize-none leading-relaxed"
      />
    </div>
  );
}

export function ArticleDetailClient({ article, users, currentUser, projectArticles = [] }: Props) {
  const { mode } = useUIMode();
  const router = useRouter();
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [confirmRegenerate, setConfirmRegenerate] = useState<string | null>(null);
  const [editedHtml, setEditedHtml] = useState(article.htmlContent ?? "");
  const [findQuery, setFindQuery] = useState("");
  const [showFind, setShowFind] = useState(false);
  const [savingHtml, setSavingHtml] = useState(false);
  const [outputFormat, setOutputFormat] = useState<"html" | "text">("html");
  const [articleViewMode, setArticleViewMode] = useState<"edit" | "preview">("edit");

  async function runAutoFull() {
    setLoadingAction("auto-full");
    try {
      const res = await fetch("/api/ai/auto-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articleId: article.id, modeOverride: "FULL_AUTO" }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Auto-run ล้มเหลว"); return; }
      toast.success(`Auto-run เสร็จ: ${data.stepsRun?.join(" → ")}`);
      router.refresh();
    } catch {
      toast.error("เกิดข้อผิดพลาด");
    } finally {
      setLoadingAction(null);
    }
  }

  async function saveHtmlContent() {
    setSavingHtml(true);
    try {
      const res = await fetch(`/api/articles/${article.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ htmlContent: editedHtml }),
      });
      if (!res.ok) throw new Error();
      toast.success("บันทึกบทความแล้ว ✅");
      router.refresh();
    } catch {
      toast.error("บันทึกไม่สำเร็จ");
    } finally {
      setSavingHtml(false);
    }
  }

  // Insert coverImageUrl into htmlContent after the first <h2> (or at midpoint if no h2)
  async function insertImageIntoContent() {
    if (!article.coverImageUrl) {
      toast.error("ยังไม่มีรูป — กด 'สร้าง Image Prompt' และ generate รูปก่อน");
      return;
    }

    const imgHtml = `\n<figure style="margin: 2em 0; text-align: center;">\n  <img src="${article.coverImageUrl}" alt="${article.title}" style="max-width: 100%; border-radius: 12px;" />\n  <figcaption style="font-size: 0.85em; color: #666; margin-top: 0.5em;">${article.title}</figcaption>\n</figure>\n`;

    let newHtml = editedHtml;

    // Try to insert after first </h2>
    const h2Idx = newHtml.indexOf("</h2>");
    if (h2Idx !== -1) {
      newHtml = newHtml.slice(0, h2Idx + 5) + imgHtml + newHtml.slice(h2Idx + 5);
    } else {
      // Fallback: insert at midpoint by character count
      const mid = Math.floor(newHtml.length / 2);
      const pIdx = newHtml.indexOf("</p>", mid);
      const insertAt = pIdx !== -1 ? pIdx + 4 : mid;
      newHtml = newHtml.slice(0, insertAt) + imgHtml + newHtml.slice(insertAt);
    }

    setEditedHtml(newHtml);

    // Auto-save
    setSavingHtml(true);
    try {
      const res = await fetch(`/api/articles/${article.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ htmlContent: newHtml }),
      });
      if (!res.ok) throw new Error();
      toast.success("แทรกรูปในบทความแล้ว ✅");
      router.refresh();
    } catch {
      toast.error("บันทึกไม่สำเร็จ");
    } finally {
      setSavingHtml(false);
    }
  }

  if (mode === "simple") {
    return <WizardArticleDetail article={article} users={users} currentUser={currentUser} />;
  }

  const outline = safeJson<OutlineData>(article.outline, {});
  const relatedKeywords = safeJson<string[]>(article.keyword?.relatedKeywords ?? "[]", []);
  const latestReview = article.reviews[0];

  async function runAIAction(key: string, endpoint: string) {
    const hasContent =
      (key === "article" && article.htmlContent) ||
      (key === "outline" && article.outline);

    if (hasContent && confirmRegenerate !== key) {
      setConfirmRegenerate(key);
      return;
    }
    setConfirmRegenerate(null);
    setLoadingAction(key);

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articleId: article.id, ...(key === "article" ? { outputFormat } : {}) }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success("สำเร็จ!");
      router.refresh();
    } catch {
      toast.error("เกิดข้อผิดพลาด กรุณาลองใหม่");
    } finally {
      setLoadingAction(null);
    }
  }

  async function approveOutline() {
    setLoadingAction("approve-outline");
    try {
      const res = await fetch(`/api/articles/${article.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "OUTLINE_APPROVED" }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success("Outline ได้รับการอนุมัติแล้ว!");
      router.refresh();
    } catch {
      toast.error("เกิดข้อผิดพลาด");
    } finally {
      setLoadingAction(null);
    }
  }

  async function approveArticle() {
    setLoadingAction("approve-article");
    try {
      const res = await fetch(`/api/articles/${article.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "APPROVED" }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success("บทความได้รับการอนุมัติแล้ว!");
      router.refresh();
    } catch {
      toast.error("เกิดข้อผิดพลาด");
    } finally {
      setLoadingAction(null);
    }
  }

  return (
    <div className="space-y-5">
      {/* Breadcrumb + Header */}
      <div className="bg-white rounded-xl border p-5">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-3">
          <Link href="/articles" className="hover:text-green-600">บทความ</Link>
          <span>/</span>
          <Link href={`/projects/${article.project.id}`} className="hover:text-green-600">{article.project.name}</Link>
          <span>/</span>
          <span className="text-gray-900 truncate max-w-xs">{article.title}</span>
        </div>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-gray-900 leading-tight">{article.title}</h1>
            <div className="flex items-center gap-3 mt-2">
              <StatusBadge status={article.status} />
              <FunnelBadge stage={article.funnelStage as never} />
              <span className="text-xs text-gray-400">{article.searchIntent}</span>
              <span className="text-xs text-gray-400">อัปเดต {formatDate(article.updatedAt)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Export / Share */}
            <Link
              href={`/articles/${article.id}/export`}
              target="_blank"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-600 border border-gray-100 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />Export
            </Link>
            {["ARTICLE_DONE","SEO_REVIEW","APPROVED","POSTED"].includes(article.status) && (
              <Link
                href={`/share/${article.id}`}
                target="_blank"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
              >
                <Share2 className="h-3.5 w-3.5" />Share
              </Link>
            )}
            {article.status === "OUTLINE_DONE" && (
              <Button
                onClick={approveOutline}
                disabled={loadingAction === "approve-outline"}
                className="bg-[#1A1A1A] hover:bg-[#2D2D2D]"
              >
                {loadingAction === "approve-outline" ? <LoadingSpinner className="border-white mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                อนุมัติ Outline
              </Button>
            )}
            {(article.status === "SEO_REVIEW" || article.status === "IMAGE_PROMPT_DONE") && (
              <Button
                onClick={approveArticle}
                disabled={loadingAction === "approve-article"}
                className="bg-[#1A1A1A] hover:bg-[#2D2D2D]"
              >
                {loadingAction === "approve-article" ? <LoadingSpinner className="border-white mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                อนุมัติบทความ
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Next Step Banner — บอกเด็กใหม่ว่าต้องทำอะไรตอนนี้ */}
      {(() => {
        const s = article.status;
        const map: Record<string, { emoji: string; title: string; desc: string; action?: string; actionLabel?: string; actionEndpoint?: string; isApprove?: boolean }> = {
          NEW:               { emoji: "✦", title: "เริ่มสร้าง Outline", desc: "กด Auto Run ด้านล่างให้ AI เขียนโครงร่างให้เลย หรือกด Generate Outline เพื่อเริ่มทีละขั้น" },
          KEYWORD_DONE:      { emoji: "✦", title: "พร้อมสร้าง Outline", desc: "Keyword พร้อมแล้ว กด Generate Outline เพื่อให้ AI วางโครงร่างบทความ", action: "outline", actionLabel: "Generate Outline", actionEndpoint: "/api/ai/outline" },
          OUTLINE_GENERATING:{ emoji: "⟳", title: "AI กำลังสร้างโครงร่าง...", desc: "รอสักครู่ ระบบกำลังทำงานอยู่" },
          OUTLINE_DONE:      { emoji: "👀", title: "รอคุณ Approve โครงร่าง", desc: "ดูโครงร่างในแท็บ Outline แล้วกดปุ่ม Approve ด้านบน ถ้าโอเคก็กด AI จะเขียนบทความต่อ", isApprove: true },
          OUTLINE_APPROVED:  { emoji: "✦", title: "เริ่มเขียนบทความได้เลย", desc: "Outline อนุมัติแล้ว กด Generate Article ให้ AI เขียนบทความเต็มๆ", action: "article", actionLabel: "Generate Article", actionEndpoint: "/api/ai/article" },
          ARTICLE_GENERATING:{ emoji: "⟳", title: "AI กำลังเขียนบทความ...", desc: "รอสักครู่ อาจใช้เวลา 1–2 นาที" },
          ARTICLE_DONE:      { emoji: "✦", title: "เขียนเสร็จแล้ว — รัน SEO Check", desc: "ดูบทความในแท็บ Article แล้วกด SEO Check ให้ AI ตรวจคุณภาพ", action: "seo", actionLabel: "SEO Check", actionEndpoint: "/api/ai/seo-check" },
          IMAGE_PROMPT_DONE: { emoji: "👀", title: "รอ Approve บทความ", desc: "ตรวจบทความในแท็บ Article แล้วกดปุ่ม Approve บทความด้านบน", isApprove: true },
          SEO_REVIEW:        { emoji: "👀", title: "รอ Approve บทความ", desc: "SEO Check เสร็จแล้ว ดูผลในแท็บ SEO แล้วกดปุ่ม Approve บทความ", isApprove: true },
          APPROVED:          { emoji: "🚀", title: "พร้อม Publish!", desc: "บทความผ่านแล้ว ไปแท็บ Publish เพื่อส่งขึ้น WordPress" },
          WORDPRESS_DRAFTED: { emoji: "✓",  title: "Draft ใน WordPress แล้ว", desc: "เข้าไปตรวจและ Publish ใน WordPress admin ได้เลย" },
          POSTED:            { emoji: "✓",  title: "เผยแพร่แล้ว!", desc: "บทความอยู่บนเว็บไซต์แล้ว" },
          ERROR:             { emoji: "⚠", title: "เกิดข้อผิดพลาด", desc: "ลอง Auto Run ใหม่ หรือกดปุ่ม Generate ทีละขั้นตอน" },
        };
        const step = map[s];
        if (!step || s === "POSTED") return null;
        const isDone = s === "WORDPRESS_DRAFTED";
        return (
          <div className={`rounded-xl border px-5 py-4 flex items-start gap-3 ${isDone ? "bg-green-50 border-green-100" : s === "ERROR" ? "bg-red-50 border-red-100" : s.includes("GENERATING") ? "bg-gray-50 border-gray-100" : "bg-blue-50 border-blue-100"}`}>
            <span className="text-xl mt-0.5 shrink-0">{step.emoji}</span>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-semibold ${s === "ERROR" ? "text-red-800" : "text-gray-900"}`}>{step.title}</p>
              <p className="text-xs text-gray-500 mt-0.5">{step.desc}</p>
            </div>
          </div>
        );
      })()}

      {/* AI Action Buttons */}
      <div className="bg-white rounded-xl border p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">AI Actions</p>
            {/* Auto Run — runs full pipeline in one click */}
            <button
              onClick={runAutoFull}
              disabled={loadingAction !== null}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1A1A1A] hover:bg-[#2D2D2D] disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors"
            >
              {loadingAction === "auto-full"
                ? <LoadingSpinner className="border-white" />
                : <Zap className="h-3.5 w-3.5" />}
              Auto Run ทั้งหมด
            </button>
          </div>
          {/* Output format toggle — shown near article generation context */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-400 mr-1">รูปแบบผลลัพธ์:</span>
            <button
              onClick={() => setOutputFormat("html")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${outputFormat === "html" ? "bg-green-50 border-green-300 text-green-700" : "bg-white border-gray-100 text-gray-500 hover:border-gray-300"}`}
            >
              <Code2 className="h-3.5 w-3.5" />HTML
            </button>
            <button
              onClick={() => setOutputFormat("text")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${outputFormat === "text" ? "bg-blue-50 border-blue-300 text-blue-700" : "bg-white border-gray-100 text-gray-500 hover:border-gray-300"}`}
            >
              <AlignLeft className="h-3.5 w-3.5" />Plain Text
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {AI_ACTIONS.map((action) => {
            const isLocked = action.requiredStatus.length > 0 && !action.requiredStatus.includes(article.status);
            return (
              <div key={action.key} className="relative group/btn">
                {confirmRegenerate === action.key ? (
                  <div className="flex items-center gap-2 p-2 rounded-lg border border-orange-200 bg-orange-50">
                    <AlertTriangle className="h-4 w-4 text-orange-500 flex-shrink-0" />
                    <span className="text-xs text-orange-700">เนื้อหาเดิมจะถูกบันทึกเป็น version — ยืนยัน?</span>
                    <button onClick={() => runAIAction(action.key, action.endpoint)} className="text-xs font-medium text-orange-700 hover:text-orange-900 underline">ยืนยัน</button>
                    <button onClick={() => setConfirmRegenerate(null)} className="text-xs text-gray-500 hover:text-gray-700">ยกเลิก</button>
                  </div>
                ) : (
                  <button
                    onClick={() => !isLocked && runAIAction(action.key, action.endpoint)}
                    disabled={loadingAction !== null || isLocked}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${isLocked ? "opacity-40 cursor-not-allowed" : "disabled:opacity-50"} ${action.color}`}
                  >
                    {loadingAction === action.key ? <LoadingSpinner className="border-current" /> : <action.icon className="h-4 w-4" />}
                    {action.key === "article" ? (outputFormat === "html" ? "เขียนบทความ HTML" : "เขียนบทความ Plain Text") : action.labelTh}
                    {isLocked && <span className="text-[10px] ml-0.5">🔒</span>}
                    {!isLocked && <span className="text-[10px] opacity-60 font-normal ml-0.5">{action.cost}</span>}
                  </button>
                )}
                {/* Tooltip on locked */}
                {isLocked && (
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/btn:block z-50 pointer-events-none">
                    <div className="bg-gray-900 text-white text-[11px] font-medium px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-lg">
                      🔒 {action.lockedReason}
                    </div>
                    <div className="w-2 h-2 bg-gray-900 rotate-45 mx-auto -mt-1" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl border">
        <Tabs defaultValue="brief">
          <div className="px-5 border-b border-gray-100">
            <TabsList className="h-auto bg-transparent p-0 gap-0">
              {[
                { value: "brief",   label: "Brief",     icon: BookOpen },
                { value: "outline", label: "Outline",   icon: LayoutList },
                { value: "article", label: "Article HTML", icon: FileText },
                { value: "seo",     label: "SEO",       icon: Search },
                { value: "image",   label: "Image",     icon: Image },
                { value: "audit",   label: "AI Audit",  icon: BarChart2 },
                { value: "review",   label: "Review",     icon: CheckCircle },
                { value: "linking", label: "Links",      icon: Link2 },
                { value: "publish", label: "Publish",    icon: Globe },
                { value: "history", label: "History",    icon: History },
              ].map((tab) => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className="flex items-center gap-1.5 px-4 py-3 rounded-none border-b border-gray-100-2 border-transparent data-[state=active]:border-green-600 data-[state=active]:text-green-700 data-[state=active]:bg-transparent text-gray-500 hover:text-gray-700"
                >
                  <tab.icon className="h-3.5 w-3.5" />
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {/* Brief */}
          <TabsContent value="brief" className="p-5">
            <BriefEditor article={article} />
            {article.keyword && (
              <div className="mt-5">
                <h4 className="font-medium text-gray-900 mb-2 text-sm">Keywords</h4>
                <div className="flex flex-wrap gap-2">
                  <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-medium">{article.keyword.keyword}</span>
                  {relatedKeywords.map((kw, i) => (
                    <span key={i} className="px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-sm">{kw}</span>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          {/* Outline */}
          <TabsContent value="outline" className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Outline บทความ</h3>
              {article.status === "OUTLINE_DONE" && (
                <Button onClick={approveOutline} size="sm" className="bg-[#1A1A1A] hover:bg-[#2D2D2D] gap-2">
                  <CheckCircle className="h-4 w-4" /> อนุมัติ Outline
                </Button>
              )}
            </div>
            {!article.outline ? (
              <div className="text-center py-12 text-gray-400">
                <LayoutList className="h-10 w-10 mx-auto mb-3 text-gray-300" />
                <p>ยังไม่มี outline — กด "สร้าง Outline" ด้านบน</p>
              </div>
            ) : (
              <div className="space-y-3">
                {outline.estimatedWordCount && (
                  <p className="text-sm text-gray-500">ประมาณ {outline.estimatedWordCount?.toLocaleString()} คำ</p>
                )}
                {outline.sections?.map((section, i) => (
                  <div key={i} className="border rounded-lg p-4">
                    <p className="font-medium text-gray-900">{section.heading}</p>
                    {section.subheadings?.map((sh, j) => (
                      <p key={j} className="text-sm text-gray-600 ml-4 mt-1">• {sh}</p>
                    ))}
                    {section.keyPoints?.length ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {section.keyPoints.map((kp, k) => (
                          <span key={k} className="text-xs px-2 py-0.5 bg-blue-50 text-blue-600 rounded">{kp}</span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
                {outline.faqSuggestions?.length ? (
                  <div className="border rounded-lg p-4 bg-yellow-50">
                    <p className="font-medium text-gray-900 mb-2">FAQ ที่แนะนำ</p>
                    {outline.faqSuggestions.map((q, i) => (
                      <p key={i} className="text-sm text-gray-700">• {q}</p>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </TabsContent>

          {/* Article HTML — Rich Editor + Preview */}
          <TabsContent value="article" className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <h3 className="font-semibold text-gray-900">
                  บทความ
                  {editedHtml && (
                    <span className="ml-2 text-xs text-gray-400 font-normal">
                      ({editedHtml.length.toLocaleString()} chars)
                    </span>
                  )}
                </h3>
                {/* Insert image into content */}
                {article.coverImageUrl && editedHtml && (
                  <button
                    onClick={insertImageIntoContent}
                    disabled={savingHtml}
                    title="แทรกรูปประกอบเข้ากลางบทความ"
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 transition-colors disabled:opacity-50"
                  >
                    <ImagePlus className="h-3 w-3" />แทรกรูปในบทความ
                  </button>
                )}
                {/* Find in page toggle */}
                {editedHtml && (
                  <button
                    onClick={() => { setShowFind((v) => !v); setFindQuery(""); }}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${showFind ? "bg-yellow-100 text-yellow-800 border border-yellow-300" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}
                  >
                    <Search className="h-3 w-3" />ค้นหา
                  </button>
                )}
                {/* Edit / Preview toggle */}
                {editedHtml && (
                  <div className="flex items-center gap-1 p-1 bg-gray-100 rounded-lg">
                    <button
                      onClick={() => setArticleViewMode("edit")}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${articleViewMode === "edit" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
                    >
                      <Code2 className="h-3.5 w-3.5" />Edit
                    </button>
                    <button
                      onClick={() => setArticleViewMode("preview")}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${articleViewMode === "preview" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
                    >
                      <Eye className="h-3.5 w-3.5" />Preview
                    </button>
                  </div>
                )}
              </div>
              {editedHtml && articleViewMode === "edit" && (
                <button
                  onClick={saveHtmlContent}
                  disabled={savingHtml}
                  className="flex items-center gap-2 px-4 py-2 bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50"
                >
                  {savingHtml
                    ? <><span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />บันทึก...</>
                    : <><Save className="h-4 w-4" />บันทึกการแก้ไข</>
                  }
                </button>
              )}
            </div>
            {/* Find in page bar */}
            {showFind && (
              <div className="flex items-center gap-2 px-3 py-2 bg-yellow-50 border border-yellow-200 rounded-xl mb-3">
                <Search className="h-3.5 w-3.5 text-yellow-600 shrink-0" />
                <input
                  autoFocus
                  type="text"
                  value={findQuery}
                  onChange={(e) => setFindQuery(e.target.value)}
                  placeholder="ค้นหาใน article..."
                  className="flex-1 bg-transparent text-sm text-gray-800 placeholder-yellow-400 focus:outline-none"
                />
                {findQuery && (() => {
                  const plain = editedHtml.replace(/<[^>]+>/g, " ").toLowerCase();
                  const count = (plain.match(new RegExp(findQuery.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length;
                  return (
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${count > 0 ? "bg-yellow-200 text-yellow-800" : "bg-red-100 text-red-600"}`}>
                      {count > 0 ? `พบ ${count} ครั้ง` : "ไม่พบ"}
                    </span>
                  );
                })()}
                <button onClick={() => setShowFind(false)} className="text-yellow-400 hover:text-yellow-700 shrink-0 text-lg leading-none">✕</button>
              </div>
            )}

            {/* Real-time stats bar */}
            {editedHtml && (() => {
              const plainText = editedHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
              const words = plainText ? plainText.split(/\s+/).length : 0;
              const mainKw = article.keyword?.keyword ?? "";
              const kwCount = mainKw
                ? (plainText.toLowerCase().match(new RegExp(mainKw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length
                : 0;
              const density = words > 0 && kwCount > 0 ? ((kwCount / words) * 100).toFixed(1) : "0.0";
              const densityNum = parseFloat(density);
              const densityColor = densityNum < 0.5 ? "text-gray-400" : densityNum > 3 ? "text-red-500" : "text-green-600";
              const readScore = words < 300 ? "สั้นเกินไป" : words < 800 ? "ปานกลาง" : words < 2000 ? "ดี" : "ยาวมาก";
              const h2count = (editedHtml.match(/<h2/gi) ?? []).length;
              const h3count = (editedHtml.match(/<h3/gi) ?? []).length;
              return (
                <div className="flex flex-wrap items-center gap-4 px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl mb-3 text-xs">
                  <span className="font-semibold text-gray-700">{words.toLocaleString()} คำ</span>
                  <span className="text-gray-400">·</span>
                  <span className={`font-medium ${densityNum < 0.5 ? "text-gray-400" : densityNum > 3 ? "text-red-500" : "text-green-600"}`}>
                    Keyword density: {density}%
                    {mainKw && <span className="text-gray-400 font-normal ml-1">({mainKw} × {kwCount})</span>}
                  </span>
                  <span className="text-gray-400">·</span>
                  <span className={`font-medium ${words < 300 ? "text-orange-500" : words < 800 ? "text-amber-500" : "text-green-600"}`}>
                    {readScore}
                  </span>
                  {h2count > 0 && <><span className="text-gray-400">·</span><span className="text-gray-500">H2 × {h2count}</span></>}
                  {h3count > 0 && <><span className="text-gray-400">·</span><span className="text-gray-500">H3 × {h3count}</span></>}
                  {densityNum > 3 && <span className="ml-auto text-red-500 font-medium">⚠ Keyword density สูงเกินไป</span>}
                  {densityNum > 0 && densityNum < 0.5 && mainKw && <span className="ml-auto text-amber-500 font-medium">⚠ ใส่ keyword น้อยเกินไป</span>}
                </div>
              );
            })()}

            {!article.htmlContent ? (
              <div className="text-center py-12 text-gray-400 border border-dashed border-gray-100 rounded-2xl">
                <PenLine className="h-10 w-10 mx-auto mb-3 text-gray-300" />
                <p>ยังไม่มีบทความ — กด "เขียนบทความ HTML" หรือ "เขียนบทความ Plain Text" ด้านบน</p>
              </div>
            ) : articleViewMode === "preview" ? (
              <div className="border rounded-2xl overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                  <Eye className="h-3.5 w-3.5 text-gray-400" />
                  <span className="text-xs font-medium text-gray-500">HTML Preview</span>
                  <span className="ml-auto text-xs text-gray-400">{editedHtml.startsWith("<") ? "HTML" : "Plain Text"}</span>
                </div>
                {editedHtml.startsWith("<") ? (
                  <div
                    className="p-6 prose prose-sm max-w-none text-gray-800 leading-relaxed"
                    style={{ fontFamily: "Georgia, serif" }}
                    dangerouslySetInnerHTML={{ __html: editedHtml }}
                  />
                ) : (
                  <div className="p-6 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed font-mono">
                    {editedHtml}
                  </div>
                )}
              </div>
            ) : (
              <ArticleEditor
                value={editedHtml}
                onChange={setEditedHtml}
              />
            )}
          </TabsContent>

          {/* SEO */}
          <TabsContent value="seo" className="p-5">
            <h3 className="font-semibold text-gray-900 mb-4">SEO Metadata</h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">SEO Title</label>
                <div className="mt-1 p-3 bg-gray-50 rounded-lg text-sm">{article.seoTitle || <span className="text-gray-400">ยังไม่ได้สร้าง</span>}</div>
                {article.seoTitle && <p className="text-xs text-gray-400 mt-1">{article.seoTitle.length}/60 ตัวอักษร</p>}
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Meta Description</label>
                <div className="mt-1 p-3 bg-gray-50 rounded-lg text-sm">{article.metaDescription || <span className="text-gray-400">ยังไม่ได้สร้าง</span>}</div>
                {article.metaDescription && <p className="text-xs text-gray-400 mt-1">{article.metaDescription.length}/160 ตัวอักษร</p>}
              </div>
              {article.faqSchema && (
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">FAQ Schema (JSON-LD)</label>
                  <pre className="mt-1 p-3 bg-gray-900 text-green-400 rounded-lg text-xs overflow-auto max-h-48">
                    {JSON.stringify(safeJson(article.faqSchema, {}), null, 2)}
                  </pre>
                </div>
              )}

              {/* Schema Generator */}
              <SchemaGenerator article={article} />
              {latestReview && (
                <div className="grid grid-cols-3 gap-4 mt-4">
                  {[
                    { label: "SEO Score", value: latestReview.seoScore, color: "text-blue-600" },
                    { label: "AEO Score", value: latestReview.aeoScore, color: "text-purple-600" },
                    { label: "Conversion", value: latestReview.conversionScore, color: "text-green-600" },
                  ].map((s) => (
                    <div key={s.label} className="border rounded-lg p-4 text-center">
                      <p className="text-xs text-gray-500">{s.label}</p>
                      <p className={`text-2xl font-bold ${s.color}`}>{s.value ?? "—"}</p>
                      <p className="text-xs text-gray-400">/100</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          {/* Image */}
          <TabsContent value="image" className="p-5">
            <h3 className="font-semibold text-gray-900 mb-4">Image Prompt</h3>
            {!article.imagePrompt ? (
              <div className="text-center py-12 text-gray-400">
                <Image className="h-10 w-10 mx-auto mb-3 text-gray-300" />
                <p>ยังไม่มี image prompt — กด "สร้าง Image Prompt" ด้านบน</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="p-4 bg-gray-50 rounded-xl border">
                  <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">Image Prompt</p>
                  <p className="text-sm text-gray-800">{article.imagePrompt}</p>
                </div>
                {article.coverImageUrl ? (
                  <div className="space-y-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={article.coverImageUrl} alt={article.title} className="w-full max-w-md rounded-xl border" />
                    <button
                      onClick={insertImageIntoContent}
                      disabled={savingHtml || !article.htmlContent}
                      className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-semibold rounded-xl hover:bg-gray-700 disabled:opacity-40 transition-colors"
                    >
                      <ImagePlus className="h-4 w-4" />
                      {savingHtml ? "กำลังแทรก..." : "แทรกรูปเข้าบทความ"}
                    </button>
                    {!article.htmlContent && (
                      <p className="text-xs text-gray-400">ต้องมีบทความก่อนถึงจะแทรกรูปได้</p>
                    )}
                  </div>
                ) : (
                  <div className="w-full max-w-md h-48 rounded-xl border-2 border-dashed border-gray-100 flex items-center justify-center text-gray-400 bg-gray-50">
                    <div className="text-center">
                      <Image className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                      <p className="text-sm">Cover image placeholder</p>
                      <p className="text-xs mt-1">1200 × 630 px</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          {/* AI Audit */}
          <TabsContent value="audit" className="p-5">
            <ArticleAuditPanel
              articleId={article.id}
              auditScore={article.auditScore}
              auditResultsJson={article.auditResults}
              hasHtmlContent={!!article.htmlContent}
            />
          </TabsContent>

          {/* Review */}
          <TabsContent value="review" className="p-5">
            <ReviewChecklist
              articleId={article.id}
              articleStatus={article.status}
              reviews={article.reviews}
            />
          </TabsContent>

          {/* Internal Linking */}
          <TabsContent value="linking" className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-gray-900">Internal Linking</h3>
                <p className="text-xs text-gray-500 mt-0.5">บทความอื่นใน project นี้ที่ควร link ถึงกัน</p>
              </div>
            </div>
            {projectArticles.length === 0 ? (
              <p className="text-sm text-gray-400 py-8 text-center">ยังไม่มีบทความอื่นใน project นี้</p>
            ) : (
              <div className="space-y-2">
                {projectArticles.map((a) => {
                  const mainKw = article.keyword?.keyword?.toLowerCase() ?? "";
                  const targetKw = a.keyword?.keyword?.toLowerCase() ?? "";
                  const titleMatch = mainKw && a.title.toLowerCase().includes(mainKw);
                  const kwMatch = targetKw && mainKw && (mainKw.includes(targetKw) || targetKw.includes(mainKw));
                  const relevant = titleMatch || kwMatch;
                  const siteBase = article.project.website?.replace(/\/$/, "") ?? "";
                  const linkHtml = `<a href="${siteBase}/${a.slug}">${a.title}</a>`;
                  return (
                    <div key={a.id} className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${relevant ? "border-green-200 bg-green-50/50" : "border-gray-100 bg-white"}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Link href={`/articles/${a.id}`} target="_blank" className="text-sm font-medium text-gray-900 hover:text-green-700 truncate">
                            {a.title}
                          </Link>
                          {relevant && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 shrink-0">แนะนำ</span>}
                        </div>
                        {a.keyword?.keyword && <p className="text-xs text-gray-400 mt-0.5">keyword: {a.keyword.keyword}</p>}
                        <code className="text-[11px] text-gray-400 font-mono mt-1 block truncate">{linkHtml}</code>
                      </div>
                      <button
                        onClick={() => { navigator.clipboard.writeText(linkHtml); toast.success("คัดลอก link HTML แล้ว"); }}
                        className="shrink-0 flex items-center gap-1 px-2 py-1.5 text-xs text-gray-500 hover:text-gray-900 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        <Copy className="h-3 w-3" />Copy
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* Publish */}
          <TabsContent value="publish" className="p-5">
            <h3 className="font-semibold text-gray-900 mb-4">เผยแพร่ไป WordPress</h3>

            {/* Pre-publish checklist */}
            {(() => {
              const html = article.htmlContent ?? "";
              const plainText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
              const wc = plainText ? plainText.split(/\s+/).length : 0;
              const altMissing = (html.match(/<img(?![^>]*alt=)[^>]*>/gi) ?? []).length;
              const internalLinks = (html.match(/<a\s[^>]*href="\/[^"]*"[^>]*>/gi) ?? []).length;
              const checks = [
                { label: "SEO Title ครบ",           ok: !!article.seoTitle,       tip: "กรอก SEO Title ในแท็บ SEO" },
                { label: "Meta Description ครบ",     ok: !!article.metaDescription, tip: "กรอก Meta Description ในแท็บ SEO" },
                { label: "จำนวนคำ ≥ 800",           ok: wc >= 800,                tip: `ปัจจุบัน ${wc} คำ — ควรมีอย่างน้อย 800 คำ` },
                { label: "Alt text รูปทุกรูป",       ok: altMissing === 0,         tip: `พบรูปที่ไม่มี alt text ${altMissing} รูป` },
                { label: "Internal link ≥ 1",       ok: internalLinks >= 1,       tip: "เพิ่ม internal link ในแท็บ Links" },
                { label: "FAQ Schema",               ok: !!article.faqSchema,      tip: "สร้าง FAQ Schema ในแท็บ SEO" },
                { label: "บทความผ่าน Approve",       ok: ["APPROVED","WORDPRESS_DRAFTED","POSTED"].includes(article.status), tip: "ต้อง Approve บทความก่อน" },
              ];
              const passed = checks.filter((c) => c.ok).length;
              const allPassed = passed === checks.length;
              return (
                <div className={`rounded-xl border p-4 mb-5 ${allPassed ? "border-green-200 bg-green-50" : "border-gray-200 bg-gray-50"}`}>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-semibold text-gray-900">Pre-publish Checklist</p>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${allPassed ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-600"}`}>
                      {passed}/{checks.length} ✓
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {checks.map((c) => (
                      <div key={c.label} className="flex items-start gap-2">
                        <span className={`mt-0.5 shrink-0 text-sm ${c.ok ? "text-green-500" : "text-gray-300"}`}>{c.ok ? "✓" : "○"}</span>
                        <div>
                          <span className={`text-xs font-medium ${c.ok ? "text-gray-700" : "text-gray-500"}`}>{c.label}</span>
                          {!c.ok && <p className="text-[11px] text-gray-400">{c.tip}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 border rounded-xl">
                  <p className="text-xs text-gray-500 mb-1">Status</p>
                  <StatusBadge status={article.status} />
                </div>
                <div className="p-4 border rounded-xl">
                  <p className="text-xs text-gray-500 mb-1">WordPress Status</p>
                  <p className="text-sm font-medium">{article.wordpressStatus ?? "ยังไม่ได้ส่ง"}</p>
                </div>
              </div>
              {article.wordpressUrl && (
                <a
                  href={article.wordpressUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-green-600 hover:text-green-700"
                >
                  <Globe className="h-4 w-4" />
                  {article.wordpressUrl}
                </a>
              )}
              {article.status !== "APPROVED" && article.status !== "WORDPRESS_DRAFTED" && article.status !== "POSTED" && (
                <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-700">
                  ⚠️ บทความต้องได้รับการอนุมัติก่อนจึงจะส่ง WordPress ได้
                </div>
              )}
            </div>
          </TabsContent>

          {/* History */}
          <TabsContent value="history" className="p-5">
            <VersionDiff versions={article.versions} />

            <h3 className="font-semibold text-gray-900 mb-3 mt-6">AI Jobs</h3>
            {article.aiJobs.length === 0 ? (
              <p className="text-gray-400 text-sm">ยังไม่มี AI job</p>
            ) : (
              <div className="space-y-2">
                {article.aiJobs.map((job) => (
                  <div key={job.id} className="flex items-center gap-3 p-3 border rounded-lg text-sm">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${job.status === "DONE" ? "bg-green-100 text-green-700" : job.status === "FAILED" ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"}`}>
                      {job.status}
                    </span>
                    <span className="font-medium text-gray-900">{job.jobType}</span>
                    <span className="text-gray-400 ml-auto">{job.tokenUsed?.toLocaleString()} tokens</span>
                    <span className="text-gray-400">${job.estimatedCost?.toFixed(4)}</span>
                    <span className="text-gray-400">{formatDate(job.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
