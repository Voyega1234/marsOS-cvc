"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import {
  PenLine, Search, Sparkles, Copy, Eye, Code2, FileText, Upload,
  CheckCircle2, Circle, Brain, BookOpen, Link2, Target, Wand2, Check,
  Plus, RotateCcw, Lightbulb, ArrowRight, X, Palette, Edit3,
  Bold, Italic, List, Heading2, Heading3, AlignLeft, Minus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ── Types ────────────────────────────────────────────────────────────────────

type MainTab = "write" | "review";
type ViewMode = "html" | "preview" | "text" | "edit";
type ReviewTab = "suggestions" | "links" | "cta" | "prompt";
type Priority = "High" | "Medium" | "Low";
type Category = "SEO" | "E-E-A-T" | "Readability" | "Conversion";

interface ScrapedTypography {
  fontFamily: string | null;
  fontSize: string | null;
  lineHeight: string | null;
  letterSpacing: string | null;
  headingFont: string | null;
  headingWeight: string | null;
  paragraphMargin: string | null;
}

interface CtaChannel {
  type: "line" | "facebook" | "phone" | "email" | "website" | "form" | "custom";
  label: string;       // ชื่อที่แสดง เช่น "ปรึกษาฟรีผ่าน Line"
  value: string;       // URL หรือ text เช่น "https://lin.ee/xxxxx"
}

interface CtaSettings {
  enabled: boolean;
  headline: string;    // เช่น "สนใจปรึกษาฟรี?"
  subtext: string;     // เช่น "ทีมงานพร้อมตอบทุกคำถาม"
  channels: CtaChannel[];
}

interface WriteSettings {
  keyword: string;
  language: string;
  theme: string;
  // Multi-level color system
  colorTheme: string;
  colorText: string;
  colorBorder: string;
  colorAccent: string;
  // Style reference
  styleUrl: string;
  // Scraped typography (applied to article)
  typography: ScrapedTypography | null;
  // CTA
  cta: CtaSettings;
}

interface Suggestion {
  id: string;
  category: Category;
  priority: Priority;
  title: string;
  description: string;
  applied: boolean;
}

interface InternalLink {
  id: string;
  anchor: string;
  url: string;
  reason: string;
  added: boolean;
}

// ── Theme & Color options ─────────────────────────────────────────────────────

const THEMES = [
  { id: "professional", label: "Professional", desc: "สะอาด เป็นทางการ" },
  { id: "modern", label: "Modern", desc: "ดีไซน์ทันสมัย มินิมอล" },
  { id: "warm", label: "Warm", desc: "อบอุ่น เป็นกันเอง" },
  { id: "bold", label: "Bold", desc: "เข้มแข็ง โดดเด่น" },
];

// Curated theme palette options — เลือก 1 สี ระบบ generate ที่เหลือให้
const THEME_PALETTES = [
  { name: "Ocean Blue",    theme: "#1d4ed8", text: "#0f172a", border: "#bfdbfe", accent: "#0891b2" },
  { name: "Forest Green",  theme: "#15803d", text: "#0f172a", border: "#bbf7d0", accent: "#16a34a" },
  { name: "Sunset Red",    theme: "#b91c1c", text: "#0f172a", border: "#fecaca", accent: "#dc2626" },
  { name: "Royal Purple",  theme: "#7e22ce", text: "#0f172a", border: "#e9d5ff", accent: "#9333ea" },
  { name: "Amber Gold",    theme: "#d97706", text: "#1c1917", border: "#fde68a", accent: "#ea580c" },
  { name: "Deep Teal",     theme: "#0e7490", text: "#0f172a", border: "#a5f3fc", accent: "#0d9488" },
  { name: "Hot Pink",      theme: "#be185d", text: "#0f172a", border: "#fbcfe8", accent: "#ec4899" },
  { name: "Midnight",      theme: "#1c1c1c", text: "#0f172a", border: "#374151", accent: "#6b7280" },
  { name: "Indigo",        theme: "#4338ca", text: "#0f172a", border: "#c7d2fe", accent: "#6366f1" },
  { name: "Rose Gold",     theme: "#e11d48", text: "#0f172a", border: "#fda4af", accent: "#f43f5e" },
  { name: "Emerald",       theme: "#059669", text: "#0f172a", border: "#6ee7b7", accent: "#10b981" },
  { name: "Sky Blue",      theme: "#0284c7", text: "#0f172a", border: "#bae6fd", accent: "#0ea5e9" },
];

// Helper: generate a related palette from a single hex color
function generatePalette(hex: string): { colorText: string; colorBorder: string; colorAccent: string } {
  // Parse the hex to HSL-like values for simple derivation
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;

  // Text: always dark
  const colorText = brightness < 80 ? "#0f172a" : "#0f172a";

  // Border: lighten the theme color significantly
  const br = Math.min(255, Math.round(r + (255 - r) * 0.72));
  const bg = Math.min(255, Math.round(g + (255 - g) * 0.72));
  const bb = Math.min(255, Math.round(b + (255 - b) * 0.72));
  const colorBorder = `#${br.toString(16).padStart(2,"0")}${bg.toString(16).padStart(2,"0")}${bb.toString(16).padStart(2,"0")}`;

  // Accent: shift hue slightly — darken if light, lighten if dark
  const factor = brightness > 150 ? 0.75 : 1.2;
  const ar = Math.min(255, Math.round(r * (factor < 1 ? factor : 1) + (factor > 1 ? (255 - r) * (factor - 1) * 0.3 : 0)));
  const ag = Math.min(255, Math.round(g * (factor < 1 ? factor : 1) + (factor > 1 ? (255 - g) * (factor - 1) * 0.3 : 0)));
  const ab = Math.min(255, Math.round(b * (factor < 1 ? factor : 1) + (factor > 1 ? (255 - b) * (factor - 1) * 0.3 : 0)));
  const colorAccent = `#${ar.toString(16).padStart(2,"0")}${ag.toString(16).padStart(2,"0")}${ab.toString(16).padStart(2,"0")}`;

  return { colorText, colorBorder, colorAccent };
}

const CTA_CHANNEL_OPTIONS: { type: CtaChannel["type"]; icon: string; placeholder: string }[] = [
  { type: "line",     icon: "💬", placeholder: "https://lin.ee/xxxxxxx" },
  { type: "facebook", icon: "📘", placeholder: "https://m.me/pagename" },
  { type: "phone",    icon: "📞", placeholder: "0xx-xxx-xxxx" },
  { type: "email",    icon: "📧", placeholder: "contact@example.com" },
  { type: "website",  icon: "🌐", placeholder: "https://example.com/contact" },
  { type: "form",     icon: "📝", placeholder: "https://example.com/form" },
  { type: "custom",   icon: "✨", placeholder: "ข้อความหรือ URL" },
];

const DEFAULT_SETTINGS: WriteSettings = {
  keyword: "",
  language: "th",
  theme: "professional",
  colorTheme: "#2563eb",
  colorText: "#1c1c1c",
  colorBorder: "#e2e8f0",
  colorAccent: "#16a34a",
  styleUrl: "",
  typography: null,
  cta: {
    enabled: false,
    headline: "สนใจปรึกษาฟรี?",
    subtext: "ทีมงานพร้อมตอบทุกคำถาม ไม่มีค่าใช้จ่าย",
    channels: [],
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function stripHtml(html: string) {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// ── Score Circle ──────────────────────────────────────────────────────────────

function ScoreCircle({ score, label, color }: { score: number; label: string; color: string }) {
  const r = 26;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const colorMap: Record<string, string> = {
    green: "#16a34a", yellow: "#ca8a04", orange: "#ea580c", blue: "#2563eb",
  };
  const bgMap: Record<string, string> = {
    green: "#dcfce7", yellow: "#fef9c3", orange: "#ffedd5", blue: "#dbeafe",
  };
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative w-14 h-14">
        <svg className="w-14 h-14 -rotate-90" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r={r} fill={bgMap[color]} stroke="#e2e8f0" strokeWidth="4" />
          <circle cx="32" cy="32" r={r} fill="none" stroke={colorMap[color]} strokeWidth="4"
            strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round" />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-slate-800">{score}</span>
      </div>
      <span className="text-xs text-slate-500 text-center leading-tight">{label}</span>
    </div>
  );
}

// ── Badges ────────────────────────────────────────────────────────────────────

function CatBadge({ cat }: { cat: Category }) {
  const map: Record<Category, string> = {
    "SEO": "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
    "E-E-A-T": "bg-purple-50 text-purple-700 ring-1 ring-purple-200",
    "Readability": "bg-teal-50 text-teal-700 ring-1 ring-teal-200",
    "Conversion": "bg-orange-50 text-orange-700 ring-1 ring-orange-200",
  };
  return <span className={cn("text-xs px-2 py-0.5 rounded-full font-semibold", map[cat])}>{cat}</span>;
}

function PrioBadge({ p }: { p: Priority }) {
  const map: Record<Priority, string> = {
    High: "bg-red-50 text-red-600 ring-1 ring-red-200",
    Medium: "bg-amber-50 text-amber-600 ring-1 ring-amber-200",
    Low: "bg-slate-100 text-slate-500",
  };
  return <span className={cn("text-xs px-2 py-0.5 rounded-full font-semibold", map[p])}>{p}</span>;
}

// ── Main Component ────────────────────────────────────────────────────────────

export function ContentStudioClient() {
  const searchParams = useSearchParams();
  const [mainTab, setMainTab] = useState<MainTab>("write");
  const [prefillTitle, setPrefillTitle] = useState("");

  // Write state
  const [settings, setSettings] = useState<WriteSettings>(() => {
    if (typeof window !== "undefined") {
      try {
        const s = localStorage.getItem("content_studio_settings_v3");
        if (s) return { ...DEFAULT_SETTINGS, ...JSON.parse(s) };
      } catch {}
    }
    return DEFAULT_SETTINGS;
  });
  const [scrapingStyle, setScrapingStyle] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [articleHtml, setArticleHtml] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("content_studio_draft_html") ?? "";
    }
    return "";
  });
  const [viewMode, setViewMode] = useState<ViewMode>("preview");
  const editorRef = useRef<HTMLDivElement>(null);
  const [saveTargetId, setSaveTargetId] = useState("");
  const [saveArticles, setSaveArticles] = useState<{ id: string; title: string }[]>([]);
  const [saving, setSaving] = useState(false);

  // Review state
  const [reviewText, setReviewText] = useState<string>(() => {
    if (typeof window !== "undefined") return localStorage.getItem("content_studio_review_text") ?? "";
    return "";
  });
  const reviewEditorRef = useRef<HTMLDivElement>(null);
  const [reviewViewMode, setReviewViewMode] = useState<"preview" | "edit" | "text">("preview");
  const [reviewHtml, setReviewHtml] = useState<string>(() => {
    if (typeof window !== "undefined") return localStorage.getItem("content_studio_review_html") ?? "";
    return "";
  });
  const [fileName, setFileName] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [reviewDone, setReviewDone] = useState(false);
  const [reviewTab, setReviewTab] = useState<ReviewTab>("suggestions");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [links, setLinks] = useState<InternalLink[]>([]);
  const [siteUrl, setSiteUrl] = useState("");
  const [ctaHtml, setCtaHtml] = useState(`<div class="cta-box">\n  <p>ต้องการความช่วยเหลือ?</p>\n  <a href="/contact">ปรึกษาฟรี →</a>\n</div>`);
  const [copiedPrompt, setCopiedPrompt] = useState<"style" | "improve" | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load articles for save-to picker
  useState(() => {
    fetch("/api/articles")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setSaveArticles(data.slice(0, 50).map((a: { id: string; title: string }) => ({ id: a.id, title: a.title }))); })
      .catch(() => {});
  });

  const saveSettings = (next: WriteSettings) => {
    localStorage.setItem("content_studio_settings_v3", JSON.stringify(next));
  };

  const setAndPersistHtml = useCallback((html: string) => {
    setArticleHtml(html);
    localStorage.setItem("content_studio_draft_html", html);
  }, []);

  const setAndPersistReviewText = useCallback((text: string) => {
    setReviewText(text);
    localStorage.setItem("content_studio_review_text", text);
  }, []);

  const setAndPersistReviewHtml = useCallback((html: string) => {
    setReviewHtml(html);
    localStorage.setItem("content_studio_review_html", html);
  }, []);

  const execCmd = useCallback((cmd: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, value);
    if (editorRef.current) setAndPersistHtml(editorRef.current.innerHTML);
  }, [setAndPersistHtml]);

  const execReviewCmd = useCallback((cmd: string, value?: string) => {
    reviewEditorRef.current?.focus();
    document.execCommand(cmd, false, value);
    if (reviewEditorRef.current) setAndPersistReviewHtml(reviewEditorRef.current.innerHTML);
  }, [setAndPersistReviewHtml]);

  // Auto-fill from Morning Brief URL params
  useEffect(() => {
    const title   = searchParams.get("title");
    const keyword = searchParams.get("keyword");
    if (title)   setPrefillTitle(title);
    if (keyword) updateSettings({ keyword });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateSettings = (patch: Partial<WriteSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettings(next);
  };

  async function saveToArticle() {
    if (!saveTargetId || !articleHtml) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/articles/${saveTargetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ htmlContent: articleHtml }),
      });
      if (res.ok) toast.success("บันทึกกลับ Article เรียบร้อย ✓");
      else toast.error("บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  const handleScrapeStyle = async () => {
    if (!settings.styleUrl.trim()) { toast.error("กรุณาใส่ URL บทความตัวอย่างก่อน"); return; }
    setScrapingStyle(true);
    try {
      const res = await fetch("/api/content-studio/scrape-style", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: settings.styleUrl }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const patch: Partial<WriteSettings> = {};
      if (data.colors?.theme)  patch.colorTheme  = data.colors.theme;
      if (data.colors?.text)   patch.colorText   = data.colors.text;
      if (data.colors?.border) patch.colorBorder = data.colors.border;
      if (data.colors?.accent) patch.colorAccent = data.colors.accent;
      if (data.typography) {
        patch.typography = {
          fontFamily:      data.typography.fontFamily     ?? null,
          fontSize:        data.typography.fontSize       ?? null,
          lineHeight:      data.typography.lineHeight     ?? null,
          letterSpacing:   data.typography.letterSpacing  ?? null,
          headingFont:     data.typography.headingFont    ?? null,
          headingWeight:   data.typography.headingWeight  ?? null,
          paragraphMargin: data.spacing?.paragraphMargin  ?? null,
        };
      }
      updateSettings(patch);
      const parts = [];
      if (data.colors?.theme) parts.push("สี");
      if (data.typography?.fontFamily) parts.push("font");
      if (data.typography?.lineHeight) parts.push("spacing");
      toast.success(`แกะสไตล์สำเร็จ ✓ (${parts.join(", ") || "ข้อมูลจำกัด"})`);
    } catch (e: unknown) {
      toast.error(`แกะสไตล์ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setScrapingStyle(false);
    }
  };

  const handleGenerate = async () => {
    if (!settings.keyword.trim()) { toast.error("กรุณาใส่ keyword ก่อน"); return; }
    setGenerating(true);
    setAndPersistHtml("");
    try {
      const res = await fetch("/api/article/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword: settings.keyword,
          title: prefillTitle.trim() || settings.keyword,
          language: settings.language,
          theme: settings.theme,
          colorTheme: settings.colorTheme,
          colorText: settings.colorText,
          colorBorder: settings.colorBorder,
          colorAccent: settings.colorAccent,
          typography: settings.typography ?? null,
          cta: settings.cta,
          stream: false,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAndPersistHtml(data.html ?? data.content ?? "");
      setViewMode("preview");
    } catch (e: unknown) {
      toast.error(`เกิดข้อผิดพลาด: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    if (file.name.endsWith(".txt")) {
      const reader = new FileReader();
      reader.onload = ev => setAndPersistReviewText(ev.target?.result as string ?? "");
      reader.readAsText(file);
    } else {
      setAndPersistReviewText(`[Content from ${file.name}]`);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    setFileName(file.name);
    if (file.name.endsWith(".txt")) {
      const reader = new FileReader();
      reader.onload = ev => setAndPersistReviewText(ev.target?.result as string ?? "");
      reader.readAsText(file);
    } else {
      setAndPersistReviewText(`[Content from ${file.name}]`);
    }
  };

  const handleReview = async () => {
    if (!reviewText.trim()) { toast.error("กรุณาวางบทความก่อน"); return; }
    setReviewing(true);
    setReviewDone(false);
    try {
      const res = await fetch("/api/article/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: reviewText, siteUrl }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSuggestions((data.suggestions ?? []).map((s: Suggestion) => ({ ...s, applied: false })));
      setLinks((data.links ?? []).map((l: InternalLink) => ({ ...l, added: false })));
      // set reviewHtml to input text so it can be edited
      const inputHtml = reviewText.trimStart().startsWith("<") ? reviewText : `<div style="font-family:sans-serif;line-height:1.7;padding:8px">${reviewText.split("\n").map(l => `<p>${l}</p>`).join("")}</div>`;
      setAndPersistReviewHtml(inputHtml);
      setReviewDone(true);
      setReviewTab("suggestions");
    } catch (e: unknown) {
      toast.error(`เกิดข้อผิดพลาด: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setReviewing(false);
    }
  };

  const copyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  const copyPrompt = (type: "style" | "improve") => {
    const text = type === "style"
      ? `คุณเป็น SEO Content Writer เชี่ยวชาญตลาดไทย\nวิเคราะห์ writing pattern จากบทความต้นฉบับและเขียนบทความใหม่ในสไตล์เดียวกัน\nReturn HTML only.`
      : `คุณเป็น SEO Content Editor ผู้เชี่ยวชาญ\nปรับปรุงบทความตาม suggestions ทั้งหมด เพิ่ม internal links และ CTA\nReturn complete improved HTML only.`;
    navigator.clipboard.writeText(text);
    setCopiedPrompt(type);
    toast.success("Prompt copied");
    setTimeout(() => setCopiedPrompt(null), 2000);
  };

  const appliedCount = suggestions.filter(s => s.applied).length;
  const addedLinksCount = links.filter(l => l.added).length;

  return (
    <div className="flex flex-col bg-white -m-6 min-h-[calc(100vh-4rem)] border-t border-gray-100">
      {/* Header */}
      <div className="border-b border-gray-100 bg-white px-6 py-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center shadow-sm">
              <PenLine className="h-4 w-4 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-800">Content Studio</h1>
              <p className="text-xs text-slate-400">Write with Claude · Review with AI</p>
            </div>
          </div>
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
            {([
              ["write", "Write", PenLine, "text-orange-500"],
              ["review", "Review & Analyze", Search, "text-blue-500"],
            ] as const).map(([tab, label, Icon, color]) => (
              <button
                key={tab}
                onClick={() => setMainTab(tab)}
                className={cn(
                  "flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium transition-all",
                  mainTab === tab ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
                )}
              >
                <Icon className={cn("h-3.5 w-3.5", mainTab === tab ? color : "")} />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ────────────── WRITE TAB ────────────── */}
      {mainTab === "write" && (
        <div className="flex flex-1 overflow-hidden">
          {/* Settings panel */}
          <div className="w-72 flex-shrink-0 border-r border-gray-100 bg-gray-50 flex flex-col">
            <div className="px-4 py-3 border-b border-gray-100">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Article Settings</span>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-5">

              {/* Prefill banner from Morning Brief */}
              {prefillTitle && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5 space-y-1">
                  <div className="text-[10px] font-bold text-blue-600 uppercase tracking-wide">จาก Morning Brief</div>
                  <p className="text-xs text-blue-800 font-medium leading-4">{prefillTitle}</p>
                  <button
                    onClick={() => setPrefillTitle("")}
                    className="text-[10px] text-blue-400 hover:text-blue-600 underline"
                  >
                    ล้าง
                  </button>
                </div>
              )}

              {/* Title */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600">Article Title (ไม่บังคับ)</label>
                <input
                  value={prefillTitle}
                  onChange={e => setPrefillTitle(e.target.value)}
                  className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                  placeholder="Title ที่ต้องการ (AI จะใช้เป็น reference)"
                />
              </div>

              {/* Keyword */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600">Target Keyword *</label>
                <input
                  value={settings.keyword}
                  onChange={e => updateSettings({ keyword: e.target.value })}
                  onKeyDown={e => { if (e.key === "Enter" && settings.keyword.trim()) handleGenerate(); }}
                  className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                  placeholder="เช่น วีซ่าเชงเก้น, รากฟันเทียม..."
                />
              </div>

              {/* Language */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600">ภาษา</label>
                <div className="grid grid-cols-2 gap-2">
                  {[["th", "ไทย"], ["en", "English"]].map(([val, label]) => (
                    <button
                      key={val}
                      onClick={() => updateSettings({ language: val })}
                      className={cn(
                        "py-2 rounded-lg text-sm font-medium border transition-all",
                        settings.language === val
                          ? "bg-slate-800 text-white border-slate-800"
                          : "bg-white text-slate-600 border-gray-200 hover:border-slate-400"
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Theme */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-600">Theme บทความ</label>
                <div className="space-y-1.5">
                  {THEMES.map(t => (
                    <button
                      key={t.id}
                      onClick={() => updateSettings({ theme: t.id })}
                      className={cn(
                        "w-full flex items-center justify-between px-3 py-2.5 rounded-lg border text-left transition-all",
                        settings.theme === t.id
                          ? "bg-slate-800 border-slate-800 text-white"
                          : "bg-white border-gray-200 text-slate-700 hover:border-slate-400"
                      )}
                    >
                      <span className="text-sm font-medium">{t.label}</span>
                      <span className={cn("text-xs", settings.theme === t.id ? "text-slate-300" : "text-slate-400")}>{t.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Color System ── */}
              <div className="space-y-3">
                <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                  <Palette className="h-3.5 w-3.5" /> ระบบสี
                </label>

                {/* STEP 1 — เลือก Theme Color หลัก */}
                <div className="space-y-2">
                  <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">1. เลือก Theme Color หลัก</p>

                  {/* Color wheel picker */}
                  <div className="flex items-center gap-2">
                    <label className="relative cursor-pointer flex-shrink-0" title="เลือกสี Theme จาก Color Wheel">
                      <div
                        className="w-12 h-12 rounded-full border-[3px] border-white shadow-lg ring-2 ring-gray-200 transition-all hover:scale-105"
                        style={{ background: `conic-gradient(red, yellow, lime, cyan, blue, magenta, red)` }}
                      >
                        <div
                          className="absolute inset-[3px] rounded-full border-2 border-white shadow-inner"
                          style={{ backgroundColor: settings.colorTheme }}
                        />
                      </div>
                      <input
                        type="color"
                        value={settings.colorTheme.length === 7 ? settings.colorTheme : "#2563eb"}
                        onChange={e => {
                          const hex = e.target.value;
                          const derived = generatePalette(hex);
                          updateSettings({ colorTheme: hex, ...derived });
                        }}
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                      />
                    </label>
                    <div className="flex-1">
                      <p className="text-xs font-semibold text-slate-700" style={{ color: settings.colorTheme }}>
                        {settings.colorTheme.toUpperCase()}
                      </p>
                      <p className="text-[10px] text-slate-400">คลิกวงกลมเพื่อเปิด Color Wheel</p>
                    </div>
                  </div>

                  {/* Curated palette chips */}
                  <div className="grid grid-cols-4 gap-1.5">
                    {THEME_PALETTES.map(p => (
                      <button
                        key={p.theme}
                        title={p.name}
                        onClick={() => updateSettings({
                          colorTheme: p.theme,
                          colorText: p.text,
                          colorBorder: p.border,
                          colorAccent: p.accent,
                        })}
                        className={cn(
                          "flex flex-col items-center gap-1 p-1.5 rounded-xl border-2 transition-all",
                          settings.colorTheme === p.theme
                            ? "border-slate-700 bg-slate-50 scale-105 shadow-md"
                            : "border-transparent hover:border-gray-300 hover:bg-gray-50"
                        )}
                      >
                        <div className="w-7 h-7 rounded-full shadow-sm border border-white" style={{ backgroundColor: p.theme }} />
                        <span className="text-[8px] text-slate-500 text-center leading-tight truncate w-full">{p.name}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* STEP 2 — Derived palette (auto-generated, adjustable) */}
                <div className="space-y-1.5">
                  <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">2. ปรับ Palette (auto จาก Theme)</p>
                  <div className="bg-white border border-gray-100 rounded-xl p-3 space-y-2">
                    {([
                      { key: "colorTheme" as const,  label: "Theme",  hint: "หัวข้อ / CTA" },
                      { key: "colorText" as const,   label: "Text",   hint: "เนื้อหาหลัก" },
                      { key: "colorBorder" as const, label: "Border", hint: "เส้นขอบ" },
                      { key: "colorAccent" as const, label: "Accent", hint: "ลิ้งก์ / Badge" },
                    ] as const).map(({ key, label, hint }) => (
                      <div key={key} className="flex items-center gap-2.5">
                        <label className="relative cursor-pointer flex-shrink-0">
                          <div
                            className="w-7 h-7 rounded-full border-2 border-white shadow-md ring-1 ring-gray-200"
                            style={{ backgroundColor: settings[key] }}
                          />
                          <input
                            type="color"
                            value={settings[key].length === 7 ? settings[key] : "#000000"}
                            onChange={e => updateSettings({ [key]: e.target.value })}
                            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                          />
                        </label>
                        <span className="text-[10px] font-mono text-slate-500 w-16 flex-shrink-0">{settings[key].toUpperCase()}</span>
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-semibold text-slate-700">{label}</span>
                          <span className="text-[10px] text-slate-400 ml-1.5">{hint}</span>
                        </div>
                      </div>
                    ))}
                    {/* Preview strip */}
                    <div className="mt-2 flex rounded-lg overflow-hidden h-3 shadow-inner">
                      <div className="flex-1" style={{ backgroundColor: settings.colorTheme }} />
                      <div className="flex-1" style={{ backgroundColor: settings.colorAccent }} />
                      <div className="flex-1" style={{ backgroundColor: settings.colorBorder }} />
                      <div className="w-8" style={{ backgroundColor: settings.colorText }} />
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Style Reference URL ── */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Link2 className="h-3.5 w-3.5 text-slate-400" />
                  <label className="text-xs font-semibold text-slate-600">Generate Theme จาก URL</label>
                </div>
                <div className="space-y-1.5">
                  <div className="flex gap-1.5">
                    <input
                      type="url"
                      value={settings.styleUrl}
                      onChange={e => updateSettings({ styleUrl: e.target.value })}
                      onKeyDown={e => { if (e.key === "Enter" && settings.styleUrl.trim()) handleScrapeStyle(); }}
                      className="flex-1 min-w-0 bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs text-slate-700 placeholder-slate-400 focus:outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-100"
                      placeholder="https://yoursite.com/article..."
                    />
                    <button
                      onClick={handleScrapeStyle}
                      disabled={scrapingStyle || !settings.styleUrl.trim()}
                      title="Generate palette จาก URL"
                      className="flex-shrink-0 flex items-center gap-1 px-2.5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-xs font-semibold transition-colors"
                    >
                      {scrapingStyle
                        ? <span className="inline-block animate-spin text-sm">⟳</span>
                        : <Wand2 className="h-3.5 w-3.5" />
                      }
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400">วางลิ้งก์ → ระบบดึงสี + font + spacing ทำ theme ให้เลย</p>

                  {/* Palette preview after scrape */}
                  {(settings.colorTheme || settings.typography) && settings.styleUrl && (
                    <div className="bg-violet-50 border border-violet-100 rounded-xl p-2.5 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold text-violet-700">Theme ที่ดึงมาได้</span>
                        <button
                          onClick={() => updateSettings({ typography: null, styleUrl: "", colorTheme: DEFAULT_SETTINGS.colorTheme, colorText: DEFAULT_SETTINGS.colorText, colorBorder: DEFAULT_SETTINGS.colorBorder, colorAccent: DEFAULT_SETTINGS.colorAccent })}
                          className="text-[9px] text-violet-400 hover:text-red-500 transition-colors"
                        >
                          ล้าง
                        </button>
                      </div>
                      <div className="flex gap-1.5">
                        {[settings.colorTheme, settings.colorAccent, settings.colorBorder, settings.colorText].map((c, i) => (
                          <div key={i} className="flex-1 h-5 rounded shadow-sm border border-white" style={{ backgroundColor: c }} title={c} />
                        ))}
                      </div>
                      {settings.typography && (
                        <div className="flex flex-wrap gap-1">
                          {settings.typography.fontFamily && (
                            <span className="text-[9px] bg-white text-violet-700 border border-violet-200 px-1.5 py-0.5 rounded-full font-medium">
                              {settings.typography.fontFamily.split(",")[0].replace(/['"]/g, "").trim()}
                            </span>
                          )}
                          {settings.typography.lineHeight && (
                            <span className="text-[9px] bg-white text-violet-700 border border-violet-200 px-1.5 py-0.5 rounded-full font-medium">
                              line {settings.typography.lineHeight}
                            </span>
                          )}
                          {settings.typography.fontSize && (
                            <span className="text-[9px] bg-white text-violet-700 border border-violet-200 px-1.5 py-0.5 rounded-full font-medium">
                              {settings.typography.fontSize}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* ── CTA Settings ── */}
              <div className="space-y-3 border-t border-gray-100 pt-4">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                    <Target className="h-3.5 w-3.5 text-slate-400" /> CTA ในบทความ
                  </label>
                  <button
                    onClick={() => updateSettings({ cta: { ...settings.cta, enabled: !settings.cta.enabled } })}
                    className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${settings.cta.enabled ? "bg-emerald-500" : "bg-gray-200"}`}
                  >
                    <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${settings.cta.enabled ? "translate-x-4" : "translate-x-0"}`} />
                  </button>
                </div>

                {settings.cta.enabled && (
                  <div className="space-y-3 bg-emerald-50 border border-emerald-100 rounded-xl p-3">
                    {/* Headline */}
                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Headline CTA</label>
                      <input
                        value={settings.cta.headline}
                        onChange={e => updateSettings({ cta: { ...settings.cta, headline: e.target.value } })}
                        className="w-full bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:border-emerald-400"
                        placeholder="เช่น สนใจปรึกษาฟรี?"
                      />
                    </div>
                    {/* Subtext */}
                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Subtext</label>
                      <input
                        value={settings.cta.subtext}
                        onChange={e => updateSettings({ cta: { ...settings.cta, subtext: e.target.value } })}
                        className="w-full bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:border-emerald-400"
                        placeholder="เช่น ทีมงานพร้อมตอบทุกคำถาม"
                      />
                    </div>

                    {/* Channels */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">ช่องทาง</label>
                      {settings.cta.channels.map((ch, idx) => {
                        const opt = CTA_CHANNEL_OPTIONS.find(o => o.type === ch.type);
                        return (
                          <div key={idx} className="flex items-start gap-1.5">
                            <span className="mt-1.5 text-sm shrink-0">{opt?.icon ?? "✨"}</span>
                            <div className="flex-1 space-y-1">
                              <input
                                value={ch.label}
                                onChange={e => {
                                  const next = [...settings.cta.channels];
                                  next[idx] = { ...ch, label: e.target.value };
                                  updateSettings({ cta: { ...settings.cta, channels: next } });
                                }}
                                className="w-full bg-white border border-gray-200 rounded-lg px-2 py-1 text-[11px] text-slate-700 focus:outline-none focus:border-emerald-400"
                                placeholder="ชื่อปุ่ม เช่น ปรึกษาฟรีผ่าน Line"
                              />
                              <input
                                value={ch.value}
                                onChange={e => {
                                  const next = [...settings.cta.channels];
                                  next[idx] = { ...ch, value: e.target.value };
                                  updateSettings({ cta: { ...settings.cta, channels: next } });
                                }}
                                className="w-full bg-white border border-gray-200 rounded-lg px-2 py-1 text-[11px] text-slate-700 focus:outline-none focus:border-emerald-400 font-mono"
                                placeholder={opt?.placeholder ?? "URL หรือข้อความ"}
                              />
                            </div>
                            <button
                              onClick={() => {
                                const next = settings.cta.channels.filter((_, i) => i !== idx);
                                updateSettings({ cta: { ...settings.cta, channels: next } });
                              }}
                              className="mt-1.5 text-gray-300 hover:text-red-500 shrink-0 transition-colors"
                            >
                              <X size={13} />
                            </button>
                          </div>
                        );
                      })}

                      {/* Add channel dropdown */}
                      <div className="grid grid-cols-4 gap-1 pt-0.5">
                        {CTA_CHANNEL_OPTIONS.filter(o => !settings.cta.channels.find(c => c.type === o.type)).map(opt => (
                          <button
                            key={opt.type}
                            onClick={() => updateSettings({ cta: { ...settings.cta, channels: [...settings.cta.channels, { type: opt.type, label: "", value: "" }] } })}
                            className="flex flex-col items-center gap-0.5 py-1.5 px-1 rounded-lg bg-white border border-dashed border-gray-200 hover:border-emerald-400 hover:bg-emerald-50 transition-colors text-center"
                            title={`เพิ่ม ${opt.type}`}
                          >
                            <span className="text-base">{opt.icon}</span>
                            <span className="text-[8px] text-gray-400 capitalize leading-none">{opt.type}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Preview pill */}
                    {settings.cta.channels.filter(c => c.value).length > 0 && (
                      <div className="bg-white rounded-lg border border-emerald-100 p-2 space-y-1">
                        <p className="text-[9px] font-bold text-emerald-600 uppercase tracking-wide">Preview</p>
                        <p className="text-[11px] font-bold text-gray-800">{settings.cta.headline || "—"}</p>
                        <p className="text-[10px] text-gray-500">{settings.cta.subtext}</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {settings.cta.channels.filter(c => c.value).map((ch, i) => {
                            const opt = CTA_CHANNEL_OPTIONS.find(o => o.type === ch.type);
                            return (
                              <span key={i} className="text-[10px] bg-emerald-600 text-white px-2 py-0.5 rounded-full font-medium">
                                {opt?.icon} {ch.label || ch.type}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="pt-2">
                <button
                  onClick={handleGenerate}
                  disabled={generating || !settings.keyword.trim()}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[#1A1A1A] hover:bg-[#2D2D2D] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors shadow-sm"
                >
                  <Sparkles className="h-4 w-4" />
                  {generating ? "กำลังเขียน..." : "เขียนบทความ"}
                </button>
                <p className="text-xs text-slate-400 text-center mt-2">ระบบ SEO Master Prompt + Auto-Validate</p>
              </div>
            </div>
          </div>

          {/* Output area */}
          <div className="flex-1 flex flex-col overflow-hidden bg-white">
            {/* Top toolbar */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 bg-white">
              {articleHtml && (
                <button
                  onClick={() => { setAndPersistHtml(""); setViewMode("preview"); }}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 text-xs transition-colors"
                >
                  <RotateCcw className="h-3 w-3" /> Clear
                </button>
              )}
              {articleHtml && (
                <div className="ml-auto flex items-center gap-1 bg-slate-100 rounded-lg p-1">
                  {([
                    ["preview", Eye, "Preview"],
                    ["edit",    Edit3, "Edit"],
                    ["html",    Code2, "HTML"],
                    ["text",    FileText, "Text"],
                  ] as const).map(([mode, Icon, label]) => (
                    <button
                      key={mode}
                      onClick={() => {
                        if (mode === "edit" && editorRef.current) {
                          editorRef.current.innerHTML = articleHtml;
                        }
                        setViewMode(mode);
                      }}
                      className={cn(
                        "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
                        viewMode === mode
                          ? mode === "edit" ? "bg-orange-500 text-white shadow-sm" : "bg-white text-slate-800 shadow-sm"
                          : "text-slate-500 hover:text-slate-700"
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Formatting toolbar — only in edit mode */}
            {viewMode === "edit" && articleHtml && (
              <div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-orange-100 bg-orange-50">
                {[
                  { icon: Bold,      title: "Bold",        cmd: "bold" },
                  { icon: Italic,    title: "Italic",      cmd: "italic" },
                ].map(({ icon: Icon, title, cmd }) => (
                  <button key={cmd} title={title} onMouseDown={e => { e.preventDefault(); execCmd(cmd); }}
                    className="p-1.5 rounded hover:bg-orange-200 text-slate-700 transition-colors">
                    <Icon className="h-3.5 w-3.5" />
                  </button>
                ))}
                <div className="w-px h-4 bg-orange-200 mx-1" />
                {[
                  { label: "H1", title: "Heading 1", tag: "h1" },
                  { label: "H2", title: "Heading 2", tag: "h2" },
                  { label: "H3", title: "Heading 3", tag: "h3" },
                  { label: "P",  title: "Paragraph", tag: "p"  },
                ].map(({ label, title, tag }) => (
                  <button key={tag} title={title} onMouseDown={e => { e.preventDefault(); execCmd("formatBlock", tag); }}
                    className="px-2 py-1 rounded text-xs font-semibold hover:bg-orange-200 text-slate-700 transition-colors">
                    {label}
                  </button>
                ))}
                <div className="w-px h-4 bg-orange-200 mx-1" />
                <button title="Bullet list" onMouseDown={e => { e.preventDefault(); execCmd("insertUnorderedList"); }}
                  className="p-1.5 rounded hover:bg-orange-200 text-slate-700 transition-colors">
                  <List className="h-3.5 w-3.5" />
                </button>
                <button title="Ordered list" onMouseDown={e => { e.preventDefault(); execCmd("insertOrderedList"); }}
                  className="p-1.5 rounded hover:bg-orange-200 text-slate-700 transition-colors">
                  <AlignLeft className="h-3.5 w-3.5" />
                </button>
                <button title="Horizontal rule" onMouseDown={e => { e.preventDefault(); execCmd("insertHorizontalRule"); }}
                  className="p-1.5 rounded hover:bg-orange-200 text-slate-700 transition-colors">
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <div className="w-px h-4 bg-orange-200 mx-1" />
                <button title="Undo" onMouseDown={e => { e.preventDefault(); execCmd("undo"); }}
                  className="px-2 py-1 rounded text-xs font-mono hover:bg-orange-200 text-slate-700 transition-colors">↩</button>
                <button title="Redo" onMouseDown={e => { e.preventDefault(); execCmd("redo"); }}
                  className="px-2 py-1 rounded text-xs font-mono hover:bg-orange-200 text-slate-700 transition-colors">↪</button>
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-[10px] text-orange-500 font-medium">กำลังแก้ไข — คลิกเพื่อพิมพ์ได้เลย</span>
                  <button
                    onClick={() => {
                      if (editorRef.current) {
                        setAndPersistHtml(editorRef.current.innerHTML);
                        toast.success("บันทึกการแก้ไขแล้ว ✓");
                      }
                    }}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-orange-500 hover:bg-orange-400 text-white text-xs font-semibold transition-colors"
                  >
                    <Check className="h-3 w-3" /> บันทึก
                  </button>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-5">
              {generating && (
                <div className="flex flex-col items-center justify-center h-64 gap-4">
                  <div className="w-full max-w-sm h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-green-500 to-emerald-400 rounded-full animate-pulse w-3/4" />
                  </div>
                  <p className="text-slate-500 text-sm">Claude กำลังเขียนบทความ...</p>
                  <p className="text-slate-400 text-xs">SEO Master Prompt + Auto-Validate · อาจใช้เวลา 30–60 วินาที</p>
                </div>
              )}

              {!generating && !articleHtml && (
                <div className="flex flex-col items-center justify-center h-full gap-8 py-12 px-6">
                  <div className="text-center">
                    <h2 className="text-2xl font-semibold text-gray-900 mb-2">เริ่มเขียนบทความ</h2>
                    <p className="text-sm text-gray-400">ใส่ keyword ในแผงซ้าย แล้วกด เขียนบทความ</p>
                  </div>

                  <div className="flex flex-wrap justify-center gap-2">
                    {[
                      { label: "คู่มือฉบับสมบูรณ์", keyword: "คู่มือ", icon: BookOpen },
                      { label: "เปรียบเทียบ", keyword: "เปรียบเทียบ", icon: Wand2 },
                      { label: "ตอบคำถาม FAQ", keyword: "วิธี", icon: Target },
                      { label: "Review / รีวิว", keyword: "รีวิว", icon: Lightbulb },
                    ].map((chip) => (
                      <button
                        key={chip.label}
                        onClick={() => {
                          const next = { ...settings, keyword: settings.keyword || chip.keyword };
                          setSettings(next);
                          saveSettings(next);
                        }}
                        className="group flex items-center gap-2 px-4 py-2 rounded-full border border-gray-100 bg-white text-sm text-gray-700 hover:border-green-400 hover:bg-green-50 hover:text-green-700 transition-all shadow-sm"
                      >
                        <chip.icon className="h-3.5 w-3.5 text-gray-400 group-hover:text-green-500 transition-colors" />
                        {chip.label}
                      </button>
                    ))}
                  </div>

                  <div className="w-full max-w-lg">
                    <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-2xl px-4 py-3 shadow-md focus-within:ring-2 focus-within:ring-green-500/20 focus-within:border-green-400 transition-all">
                      <Sparkles className="h-4 w-4 text-gray-300 flex-shrink-0" />
                      <input
                        type="text"
                        placeholder="พิมพ์ keyword เช่น วีซ่าเชงเก้น, รากฟันเทียม..."
                        value={settings.keyword}
                        onChange={e => updateSettings({ keyword: e.target.value })}
                        onKeyDown={e => { if (e.key === "Enter" && settings.keyword.trim()) handleGenerate(); }}
                        className="flex-1 text-sm text-gray-700 placeholder-gray-400 bg-transparent outline-none"
                      />
                      <button
                        onClick={handleGenerate}
                        disabled={!settings.keyword.trim()}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#1A1A1A] hover:bg-[#2D2D2D] disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold transition-colors"
                      >
                        <ArrowRight className="h-3.5 w-3.5" />
                        Generate
                      </button>
                    </div>
                    <p className="text-xs text-gray-400 text-center mt-2">กด Enter หรือ Generate · ใช้ SEO Master Prompt + Auto-Validate</p>
                  </div>
                </div>
              )}

              {!generating && articleHtml && (
                <div className="max-w-4xl mx-auto">
                  <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
                    <span className="text-xs text-slate-400">
                      {countWords(stripHtml(articleHtml)).toLocaleString()} คำ
                    </span>
                    <div className="flex items-center gap-2 flex-wrap">
                      {saveArticles.length > 0 && (
                        <div className="flex items-center gap-1.5">
                          <select
                            value={saveTargetId}
                            onChange={(e) => setSaveTargetId(e.target.value)}
                            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-700 bg-white focus:outline-none max-w-48 truncate"
                          >
                            <option value="">— เลือก Article —</option>
                            {saveArticles.map((a) => (
                              <option key={a.id} value={a.id}>{a.title}</option>
                            ))}
                          </select>
                          <button
                            onClick={saveToArticle}
                            disabled={!saveTargetId || saving}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white text-xs font-semibold transition-colors"
                          >
                            {saving ? "กำลังบันทึก..." : "บันทึกกลับ Article"}
                          </button>
                        </div>
                      )}
                      <button
                        onClick={() => {
                          const current = editorRef.current?.innerHTML ?? articleHtml;
                          if (viewMode === "html" || viewMode === "edit") {
                            copyText(current, "HTML");
                          } else {
                            copyText(stripHtml(current), "Text");
                          }
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-medium transition-colors"
                      >
                        <Copy className="h-3 w-3" />
                        Copy {(viewMode === "html" || viewMode === "edit") ? "HTML" : "Text"}
                      </button>
                    </div>
                  </div>

                  {viewMode === "html" && (
                    <pre className="bg-slate-900 border border-gray-100 rounded-xl p-4 text-xs text-green-300 overflow-x-auto leading-relaxed whitespace-pre-wrap font-mono">
                      {articleHtml}
                    </pre>
                  )}
                  {viewMode === "preview" && (
                    <div
                      className="bg-white border border-gray-100 rounded-xl p-8 text-slate-800 prose prose-lg max-w-none shadow-sm"
                      dangerouslySetInnerHTML={{ __html: articleHtml }}
                    />
                  )}
                  {viewMode === "edit" && (
                    <div
                      ref={editorRef}
                      contentEditable
                      suppressContentEditableWarning
                      onInput={() => {
                        if (editorRef.current) setAndPersistHtml(editorRef.current.innerHTML);
                      }}
                      className="bg-white border-2 border-orange-200 rounded-xl p-8 text-slate-800 prose prose-lg max-w-none shadow-sm outline-none focus:border-orange-400 min-h-[300px]"
                      dangerouslySetInnerHTML={{ __html: articleHtml }}
                    />
                  )}
                  {viewMode === "text" && (
                    <div className="bg-gray-50 border border-gray-100 rounded-xl p-6 text-slate-700 text-sm leading-relaxed whitespace-pre-wrap">
                      {stripHtml(articleHtml)}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ────────────── REVIEW TAB ────────────── */}
      {mainTab === "review" && (
        <div className="flex flex-1 overflow-hidden">
          {/* Input panel */}
          <div className="w-80 flex-shrink-0 border-r border-gray-100 bg-gray-50 flex flex-col">
            <div className="px-4 py-3 border-b border-gray-100">
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200">
                <Brain className="h-4 w-4 text-blue-500" />
                <span className="text-sm font-semibold text-blue-700">Claude SEO Reviewer</span>
              </div>
            </div>
            <div className="flex-1 flex flex-col p-4 gap-3 overflow-y-auto">
              <label className="text-xs font-semibold text-slate-600">เนื้อหาบทความ</label>
              <textarea
                value={reviewText}
                onChange={e => setAndPersistReviewText(e.target.value)}
                rows={10}
                className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 resize-none leading-relaxed"
                placeholder="วาง HTML หรือ text บทความที่นี่..."
              />

              <div
                onDrop={handleDrop}
                onDragOver={e => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-gray-200 hover:border-blue-400 hover:bg-blue-50 rounded-lg p-4 text-center cursor-pointer transition-colors"
              >
                <Upload className="h-5 w-5 text-slate-400 mx-auto mb-2" />
                {fileName ? (
                  <p className="text-xs text-green-600 font-semibold">{fileName}</p>
                ) : (
                  <>
                    <p className="text-xs text-slate-500 font-medium">วางไฟล์ หรือคลิกเลือก</p>
                    <p className="text-xs text-slate-400 mt-0.5">.txt · .pdf · .doc</p>
                  </>
                )}
                <input ref={fileInputRef} type="file" accept=".txt,.pdf,.doc,.docx" className="hidden" onChange={handleFileUpload} />
              </div>

              <button
                onClick={handleReview}
                disabled={reviewing}
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors shadow-sm"
              >
                <Search className="h-4 w-4" />
                {reviewing ? "กำลังวิเคราะห์..." : "วิเคราะห์บทความ"}
              </button>
            </div>
          </div>

          {/* Results panel */}
          <div className="flex-1 flex overflow-hidden bg-white">

            {/* Feedback column */}
            <div className="w-80 flex-shrink-0 border-r border-gray-100 flex flex-col overflow-hidden">
            {reviewing && (
              <div className="flex flex-col items-center justify-center flex-1 gap-4">
                <div className="w-full max-w-xs h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-blue-500 to-indigo-400 rounded-full animate-pulse w-3/4" />
                </div>
                <p className="text-slate-500 text-sm">Claude กำลังวิเคราะห์บทความ...</p>
              </div>
            )}

            {!reviewing && !reviewDone && (
              <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center p-6">
                <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
                  <Search className="h-5 w-5 text-slate-400" />
                </div>
                <p className="text-slate-500 text-sm">วางบทความและกด วิเคราะห์ เพื่อรับ feedback</p>
              </div>
            )}

            {!reviewing && reviewDone && (
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Sub-tabs */}
                <div className="flex gap-0.5 px-4 pt-2 border-b border-gray-100 bg-white">
                  {([
                    ["suggestions", "Suggestions", Lightbulb, appliedCount > 0 ? `${appliedCount}/${suggestions.length}` : `${suggestions.length}`],
                    ["links", "Internal Links", Link2, addedLinksCount > 0 ? `${addedLinksCount}/${links.length}` : `${links.length}`],
                    ["cta", "CTA", Target, null],
                    ["prompt", "Generate Prompt", Wand2, null],
                  ] as const).map(([tab, label, Icon, badge]) => (
                    <button
                      key={tab}
                      onClick={() => setReviewTab(tab)}
                      className={cn(
                        "flex items-center gap-1.5 px-3 pb-2.5 pt-1 text-sm font-medium border-b-2 transition-colors",
                        reviewTab === tab
                          ? "border-blue-500 text-blue-600"
                          : "border-transparent text-slate-500 hover:text-slate-700"
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {label}
                      {badge && (
                        <span className={cn(
                          "text-xs px-1.5 py-0.5 rounded-full font-semibold",
                          reviewTab === tab ? "bg-blue-100 text-blue-600" : "bg-slate-100 text-slate-500"
                        )}>{badge}</span>
                      )}
                    </button>
                  ))}
                </div>

                <div className="flex-1 overflow-y-auto p-4">

                  {/* SUGGESTIONS */}
                  {reviewTab === "suggestions" && (
                    <div className="space-y-2">
                      {suggestions.length === 0 && (
                        <p className="text-center text-slate-400 text-sm py-8">ไม่มี suggestions</p>
                      )}
                      {suggestions.map(s => (
                        <div
                          key={s.id}
                          className={cn(
                            "p-3.5 rounded-xl border transition-colors cursor-pointer",
                            s.applied ? "bg-green-50 border-green-200" : "bg-white border-gray-200 hover:bg-gray-50"
                          )}
                          onClick={() => setSuggestions(prev => prev.map(x => x.id === s.id ? { ...x, applied: !x.applied } : x))}
                        >
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 flex-shrink-0">
                              {s.applied
                                ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                                : <Circle className="h-4 w-4 text-slate-300" />
                              }
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5 mb-1">
                                <CatBadge cat={s.category} />
                                <PrioBadge p={s.priority} />
                              </div>
                              <p className={cn("text-sm font-semibold mb-0.5", s.applied ? "text-slate-400 line-through" : "text-slate-700")}>{s.title}</p>
                              <p className="text-xs text-slate-500 leading-relaxed">{s.description}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* INTERNAL LINKS */}
                  {reviewTab === "links" && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <input
                          value={siteUrl}
                          onChange={e => setSiteUrl(e.target.value)}
                          className="flex-1 bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:border-blue-400"
                          placeholder="URL เว็บไซต์ เช่น example.co.th"
                        />
                        <button
                          onClick={() => { setLinks(prev => prev.map(l => ({ ...l, added: true }))); toast.success("เพิ่ม links ทั้งหมดแล้ว"); }}
                          className="flex-shrink-0 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors"
                        >
                          Apply All
                        </button>
                      </div>
                      {links.length === 0 && (
                        <p className="text-center text-slate-400 text-sm py-8">ไม่มี internal link suggestions</p>
                      )}
                      {links.map(l => (
                        <div key={l.id} className={cn(
                          "p-3.5 rounded-xl border",
                          l.added ? "bg-green-50 border-green-200" : "bg-white border-gray-200"
                        )}>
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <code className="text-xs bg-slate-100 text-blue-600 px-2 py-0.5 rounded font-mono">{l.anchor}</code>
                                <ArrowRight className="h-3 w-3 text-slate-400 flex-shrink-0" />
                                <code className="text-xs text-slate-500 truncate font-mono">{siteUrl || "site.com"}{l.url}</code>
                              </div>
                              <p className="text-xs text-slate-400">{l.reason}</p>
                            </div>
                            <button
                              onClick={() => { setLinks(prev => prev.map(x => x.id === l.id ? { ...x, added: true } : x)); toast.success("Link added"); }}
                              disabled={l.added}
                              className={cn(
                                "flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors",
                                l.added ? "bg-green-100 text-green-600 cursor-default" : "bg-slate-100 hover:bg-slate-200 text-slate-600"
                              )}
                            >
                              {l.added ? <><Check className="h-3 w-3" /> Added</> : <><Plus className="h-3 w-3" /> Add</>}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* CTA */}
                  {reviewTab === "cta" && (
                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-600">CTA HTML Block</label>
                        <textarea value={ctaHtml} onChange={e => setCtaHtml(e.target.value)} rows={6}
                          className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-slate-700 font-mono focus:outline-none focus:border-blue-400 resize-none" />
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-slate-600">Insert position</p>
                        {["After Introduction", "After H2 #1", "At End"].map(pos => (
                          <button key={pos} onClick={() => toast.success(`CTA: ${pos}`)}
                            className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg bg-white border border-gray-200 hover:bg-gray-50 text-sm text-slate-700 transition-colors">
                            <span>{pos}</span>
                            <Plus className="h-3.5 w-3.5 text-slate-400" />
                          </button>
                        ))}
                      </div>
                      <button onClick={() => copyText(ctaHtml, "CTA HTML")}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-medium transition-colors">
                        <Copy className="h-3.5 w-3.5" />Copy CTA HTML
                      </button>
                    </div>
                  )}

                  {/* GENERATE PROMPT */}
                  {reviewTab === "prompt" && (
                    <div className="space-y-4">
                      <div className="flex items-start gap-3 p-3.5 rounded-xl bg-violet-50 border border-violet-200">
                        <Brain className="h-4 w-4 text-violet-500 mt-0.5 flex-shrink-0" />
                        <p className="text-xs text-violet-700 leading-relaxed">
                          สร้าง 2 prompts จากบทความนี้: สำหรับเลียนแบบสไตล์การเขียน และปรับปรุงตามคำแนะนำทั้งหมด
                        </p>
                      </div>

                      {([
                        ["style", "Prompt 1: Replicate Writing Style", "เรียนรู้ pattern การเขียนจากบทความนี้", `คุณเป็น SEO Content Writer เชี่ยวชาญตลาดไทย\nวิเคราะห์ writing pattern จากบทความต้นฉบับและเขียนบทความใหม่ในสไตล์เดียวกัน\nReturn HTML only.`],
                        ["improve", "Prompt 2: SEO Improvement Rewrite", "ปรับปรุงบทความตามคำแนะนำทั้งหมด", `คุณเป็น SEO Content Editor ผู้เชี่ยวชาญ\nปรับปรุงบทความตาม suggestions ทั้งหมด เพิ่ม internal links และ CTA\nReturn complete improved HTML only.`],
                      ] as const).map(([key, title, subtitle, content]) => (
                        <div key={key} className="rounded-xl border border-gray-100 bg-white overflow-hidden shadow-sm">
                          <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-gray-50">
                            <div>
                              <p className="text-sm font-semibold text-slate-800">{title}</p>
                              <p className="text-xs text-slate-500">{subtitle}</p>
                            </div>
                            <button onClick={() => copyPrompt(key)}
                              className={cn(
                                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors",
                                copiedPrompt === key ? "bg-green-50 text-green-600 border border-green-200" : "bg-white border border-gray-100 hover:bg-gray-50 text-slate-600"
                              )}>
                              {copiedPrompt === key ? <><Check className="h-3 w-3" />Copied</> : <><Copy className="h-3 w-3" />Copy</>}
                            </button>
                          </div>
                          <pre className="p-4 text-xs text-slate-600 leading-relaxed whitespace-pre-wrap font-mono overflow-x-auto max-h-56 overflow-y-auto bg-white">
                            {content}
                          </pre>
                        </div>
                      ))}
                    </div>
                  )}

                </div>
              </div>
            )}
            </div>{/* end feedback column */}

            {/* Article editor column — right side of Review */}
            <div className="flex-1 flex flex-col overflow-hidden bg-white">
              {/* Toolbar */}
              <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 bg-white">
                <span className="text-xs font-semibold text-slate-500">บทความ</span>
                {reviewHtml && (
                  <div className="ml-auto flex items-center gap-1 bg-slate-100 rounded-lg p-1">
                    {([
                      ["preview", Eye, "Preview"],
                      ["edit",    Edit3, "Edit"],
                      ["text",    FileText, "Text"],
                    ] as const).map(([mode, Icon, label]) => (
                      <button
                        key={mode}
                        onClick={() => {
                          if (mode === "edit" && reviewEditorRef.current) {
                            reviewEditorRef.current.innerHTML = reviewHtml;
                          }
                          setReviewViewMode(mode);
                        }}
                        className={cn(
                          "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
                          reviewViewMode === mode
                            ? mode === "edit" ? "bg-orange-500 text-white shadow-sm" : "bg-white text-slate-800 shadow-sm"
                            : "text-slate-500 hover:text-slate-700"
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {label}
                      </button>
                    ))}
                    <button
                      onClick={() => copyText(reviewEditorRef.current?.innerHTML ?? reviewHtml, "HTML")}
                      className="ml-1 flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-slate-500 hover:text-slate-700 hover:bg-white transition-colors"
                    >
                      <Copy className="h-3.5 w-3.5" /> Copy
                    </button>
                  </div>
                )}
              </div>

              {/* Formatting toolbar */}
              {reviewViewMode === "edit" && reviewHtml && (
                <div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-orange-100 bg-orange-50">
                  {[
                    { icon: Bold,   title: "Bold",   cmd: "bold" },
                    { icon: Italic, title: "Italic", cmd: "italic" },
                  ].map(({ icon: Icon, title, cmd }) => (
                    <button key={cmd} title={title} onMouseDown={e => { e.preventDefault(); execReviewCmd(cmd); }}
                      className="p-1.5 rounded hover:bg-orange-200 text-slate-700 transition-colors">
                      <Icon className="h-3.5 w-3.5" />
                    </button>
                  ))}
                  <div className="w-px h-4 bg-orange-200 mx-1" />
                  {[
                    { label: "H1", tag: "h1" }, { label: "H2", tag: "h2" },
                    { label: "H3", tag: "h3" }, { label: "P",  tag: "p"  },
                  ].map(({ label, tag }) => (
                    <button key={tag} onMouseDown={e => { e.preventDefault(); execReviewCmd("formatBlock", tag); }}
                      className="px-2 py-1 rounded text-xs font-semibold hover:bg-orange-200 text-slate-700 transition-colors">
                      {label}
                    </button>
                  ))}
                  <div className="w-px h-4 bg-orange-200 mx-1" />
                  <button onMouseDown={e => { e.preventDefault(); execReviewCmd("insertUnorderedList"); }}
                    className="p-1.5 rounded hover:bg-orange-200 text-slate-700 transition-colors">
                    <List className="h-3.5 w-3.5" />
                  </button>
                  <button title="Undo" onMouseDown={e => { e.preventDefault(); execReviewCmd("undo"); }}
                    className="px-2 py-1 rounded text-xs font-mono hover:bg-orange-200 text-slate-700 transition-colors">↩</button>
                  <button title="Redo" onMouseDown={e => { e.preventDefault(); execReviewCmd("redo"); }}
                    className="px-2 py-1 rounded text-xs font-mono hover:bg-orange-200 text-slate-700 transition-colors">↪</button>
                  <div className="ml-auto">
                    <span className="text-[10px] text-orange-500 font-medium">แก้ไขได้เลย</span>
                  </div>
                </div>
              )}

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-5">
                {!reviewHtml && (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                    <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
                      <Edit3 className="h-5 w-5 text-slate-400" />
                    </div>
                    <p className="text-slate-500 text-sm">วิเคราะห์บทความก่อน แล้วแก้ไขได้ที่นี่</p>
                  </div>
                )}
                {reviewHtml && reviewViewMode === "preview" && (
                  <div
                    className="bg-white border border-gray-100 rounded-xl p-8 text-slate-800 prose prose-lg max-w-none shadow-sm"
                    dangerouslySetInnerHTML={{ __html: reviewHtml }}
                  />
                )}
                {reviewHtml && reviewViewMode === "edit" && (
                  <div
                    ref={reviewEditorRef}
                    contentEditable
                    suppressContentEditableWarning
                    onInput={() => {
                      if (reviewEditorRef.current) setAndPersistReviewHtml(reviewEditorRef.current.innerHTML);
                    }}
                    className="bg-white border-2 border-orange-200 rounded-xl p-8 text-slate-800 prose prose-lg max-w-none shadow-sm outline-none focus:border-orange-400 min-h-[300px]"
                    dangerouslySetInnerHTML={{ __html: reviewHtml }}
                  />
                )}
                {reviewHtml && reviewViewMode === "text" && (
                  <div className="bg-gray-50 border border-gray-100 rounded-xl p-6 text-slate-700 text-sm leading-relaxed whitespace-pre-wrap">
                    {stripHtml(reviewHtml)}
                  </div>
                )}
              </div>
            </div>{/* end article editor column */}

          </div>{/* end Results panel */}
        </div>
      )}
    </div>
  );
}
