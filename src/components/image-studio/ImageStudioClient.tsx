"use client";

import { useState } from "react";
import {
  Image, Sparkles, Download, RotateCcw,
  LayoutTemplate, AlignCenter, Wand2, ChevronDown, ChevronUp,
  FileSliders,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type ImageType = "cover" | "mid";

interface SizePreset { label: string; w: number; h: number; note: string }

const COVER_SIZES: SizePreset[] = [
  { label: "1536 × 864",  w: 1536, h: 864,  note: "16:9 HD (แนะนำ)" },
  { label: "1280 × 720",  w: 1280, h: 720,  note: "16:9 Standard" },
  { label: "1200 × 630",  w: 1200, h: 630,  note: "OG / Facebook" },
  { label: "1080 × 1080", w: 1080, h: 1080, note: "1:1 Square" },
]

const MID_SIZES: SizePreset[] = [
  { label: "1200 × 630",  w: 1200, h: 630,  note: "16:9 (แนะนำ)" },
  { label: "1024 × 576",  w: 1024, h: 576,  note: "16:9 Compact" },
  { label: "800 × 450",   w: 800,  h: 450,  note: "16:9 Small" },
  { label: "1080 × 1080", w: 1080, h: 1080, note: "1:1 Square" },
]

interface GeneratedImage {
  imageBase64: string;
  mimeType: string;
  type: ImageType;
  keyword: string;
  title: string;
  w: number;
  h: number;
  createdAt: Date;
}

const COVER_PRESETS = [
  { label: "บทความ SEO ทั่วไป", keyword: "", title: "", accent: "#2563eb" },
  { label: "รีวิว / เปรียบเทียบ", keyword: "รีวิว", title: "", accent: "#16a34a" },
  { label: "คู่มือ / How-to", keyword: "วิธี", title: "", accent: "#9333ea" },
  { label: "ข่าว / อัปเดต", keyword: "อัปเดต", title: "", accent: "#ea580c" },
];

export function ImageStudioClient() {
  const [imageType, setImageType] = useState<ImageType>("cover");
  const [title, setTitle] = useState("");
  const [keyword, setKeyword] = useState("");
  const [accentColor, setAccentColor] = useState("#2563eb");
  const [siteName, setSiteName] = useState("");
  const [brandTone, setBrandTone] = useState("professional, helpful");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [history, setHistory] = useState<GeneratedImage[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [coverSize, setCoverSize] = useState<SizePreset>(COVER_SIZES[0]);
  const [midSize, setMidSize] = useState<SizePreset>(MID_SIZES[0]);
  const [showPptx, setShowPptx] = useState(false);
  const [exportingPptx, setExportingPptx] = useState(false);

  const currentSize = imageType === "cover" ? coverSize : midSize;
  const selected = selectedIdx !== null ? history[selectedIdx] : null;
  const dims = selected ? { w: selected.w, h: selected.h } : currentSize;

  const handleGenerate = async () => {
    if (!title.trim() || !keyword.trim()) {
      toast.error("กรุณาใส่ Title และ Keyword ก่อน");
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch("/api/article/cover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, keyword, type: imageType, siteName, brandTone, accentColor, width: currentSize.w, height: currentSize.h }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      const item: GeneratedImage = {
        imageBase64: data.imageBase64,
        mimeType: data.mimeType || "image/webp",
        type: imageType,
        keyword,
        title,
        w: currentSize.w,
        h: currentSize.h,
        createdAt: new Date(),
      };
      setHistory(prev => [item, ...prev]);
      setSelectedIdx(0);
      toast.success(`สร้าง ${imageType === "cover" ? "Cover Image" : "Mid-Article Image"} สำเร็จ ✓`);
    } catch (e: unknown) {
      toast.error(`เกิดข้อผิดพลาด: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleDownloadWebp = () => {
    if (!selected) return;
    const a = document.createElement("a");
    a.href = `data:${selected.mimeType};base64,${selected.imageBase64}`;
    a.download = `${selected.type}-${selected.keyword.replace(/\s+/g, "-")}.png`;
    a.click();
    toast.success("ดาวน์โหลด WebP แล้ว");
  };

  const handleExportPptx = async () => {
    if (!selected) {
      toast.error("กรุณา Generate รูปก่อน แล้วค่อย Export PPTX");
      return;
    }
    setExportingPptx(true);
    try {
      const res = await fetch("/api/image-studio/export-pptx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: selected.imageBase64,
          mimeType: selected.mimeType,
          title: selected.title,
          keyword: selected.keyword,
          type: selected.type,
          accentColor,
          siteName,
          w: selected.w,
          h: selected.h,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const slug = selected.keyword.replace(/\s+/g, "-") || "image";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${selected.type}-${slug}.pptx`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success("ดาวน์โหลด PPTX แล้ว — เปิดใน Canva หรือ PowerPoint เพื่อแก้ไข");
    } catch (e: unknown) {
      console.error("PPTX export error:", e);
      toast.error(`Export ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExportingPptx(false);
    }
  };

  return (
    <div className="flex flex-col bg-white -m-6 min-h-[calc(100vh-4rem)] border-t border-gray-100">
      {/* Header */}
      <div className="border-b border-gray-100 bg-white px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-rose-500 to-orange-500 flex items-center justify-center shadow-sm">
            <Image className="h-4 w-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-800">Image Studio</h1>
            <p className="text-xs text-slate-400">สร้างรูป Cover &amp; Mid-Article ด้วย Gemini AI</p>
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ── LEFT PANEL — Settings ── */}
        <div className="w-72 flex-shrink-0 border-r border-gray-100 bg-gray-50 flex flex-col overflow-y-auto">
          <div className="px-4 py-3 border-b border-gray-100">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Image Settings</span>
          </div>

          <div className="p-4 space-y-5">

            {/* Image Type */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-600">ประเภทรูป</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setImageType("cover")}
                  className={cn(
                    "flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl border-2 transition-all",
                    imageType === "cover"
                      ? "border-rose-500 bg-rose-50 text-rose-700"
                      : "border-gray-200 bg-white text-slate-600 hover:border-slate-400"
                  )}
                >
                  <LayoutTemplate className="h-5 w-5" />
                  <span className="text-xs font-semibold">Cover Image</span>
                  <span className="text-[10px] text-slate-400">{coverSize.w} × {coverSize.h}</span>
                </button>
                <button
                  onClick={() => setImageType("mid")}
                  className={cn(
                    "flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl border-2 transition-all",
                    imageType === "mid"
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-gray-200 bg-white text-slate-600 hover:border-slate-400"
                  )}
                >
                  <AlignCenter className="h-5 w-5" />
                  <span className="text-xs font-semibold">Mid-Article</span>
                  <span className="text-[10px] text-slate-400">{midSize.w} × {midSize.h}</span>
                </button>
              </div>
            </div>

            {/* Size Selector */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600">ขนาดรูป</label>
              <div className="grid grid-cols-2 gap-1.5">
                {(imageType === "cover" ? COVER_SIZES : MID_SIZES).map(s => {
                  const active = imageType === "cover" ? coverSize.label === s.label : midSize.label === s.label;
                  return (
                    <button
                      key={s.label}
                      onClick={() => imageType === "cover" ? setCoverSize(s) : setMidSize(s)}
                      className={cn(
                        "flex flex-col items-start px-2.5 py-2 rounded-lg border text-left transition-all",
                        active
                          ? "border-rose-400 bg-rose-50 text-rose-700"
                          : "border-gray-200 bg-white text-slate-600 hover:border-slate-300"
                      )}
                    >
                      <span className="text-[11px] font-semibold leading-tight">{s.label}</span>
                      <span className="text-[9px] text-slate-400 leading-tight">{s.note}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Title */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600">Title บทความ *</label>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:border-rose-400 focus:ring-1 focus:ring-rose-100"
                placeholder="เช่น รากฟันเทียม คืออะไร เหมาะกับใคร"
              />
            </div>

            {/* Keyword */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600">Keyword หลัก *</label>
              <input
                value={keyword}
                onChange={e => setKeyword(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleGenerate(); }}
                className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:border-rose-400 focus:ring-1 focus:ring-rose-100"
                placeholder="เช่น รากฟันเทียม"
              />
            </div>

            {/* Accent Color — Cover only */}
            {imageType === "cover" && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600">Accent Color</label>
                <div className="flex items-center gap-3">
                  <label className="relative cursor-pointer">
                    <div className="w-9 h-9 rounded-full border-2 border-white shadow-md ring-1 ring-gray-200" style={{ backgroundColor: accentColor }} />
                    <input
                      type="color"
                      value={accentColor}
                      onChange={e => setAccentColor(e.target.value)}
                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    />
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {["#2563eb","#16a34a","#dc2626","#9333ea","#ea580c","#0891b2","#be185d","#000000"].map(c => (
                      <button
                        key={c}
                        onClick={() => setAccentColor(c)}
                        className={cn(
                          "w-6 h-6 rounded-full border-2 transition-all",
                          accentColor === c ? "border-slate-700 scale-125 shadow-md" : "border-white hover:scale-110"
                        )}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Quick Presets — Cover only */}
            {imageType === "cover" && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600">Quick Preset</label>
                <div className="space-y-1">
                  {COVER_PRESETS.map(p => (
                    <button
                      key={p.label}
                      onClick={() => {
                        if (p.keyword) setKeyword(p.keyword);
                        setAccentColor(p.accent);
                      }}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-white border border-gray-200 hover:border-slate-400 text-xs text-slate-700 transition-all"
                    >
                      <span>{p.label}</span>
                      <div className="w-3.5 h-3.5 rounded-full" style={{ backgroundColor: p.accent }} />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Advanced */}
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <button
                type="button"
                onClick={() => setShowAdvanced(v => !v)}
                className="w-full flex items-center justify-between px-3 py-2.5 bg-gray-50 hover:bg-gray-100 text-xs font-semibold text-slate-600 transition-colors"
              >
                ตั้งค่าเพิ่มเติม
                {showAdvanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
              {showAdvanced && (
                <div className="p-3 space-y-3 border-t border-gray-100">
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-slate-500 uppercase">Site Name</label>
                    <input value={siteName} onChange={e => setSiteName(e.target.value)}
                      className="w-full bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:border-rose-400"
                      placeholder="ชื่อเว็บไซต์" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-slate-500 uppercase">Brand Tone</label>
                    <input value={brandTone} onChange={e => setBrandTone(e.target.value)}
                      className="w-full bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:border-rose-400"
                      placeholder="professional, helpful" />
                  </div>
                </div>
              )}
            </div>

            {/* Generate button */}
            <button
              onClick={handleGenerate}
              disabled={generating || !title.trim() || !keyword.trim()}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-rose-500 to-orange-500 hover:from-rose-600 hover:to-orange-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-all shadow-sm"
            >
              <Sparkles className="h-4 w-4" />
              {generating ? "กำลังสร้างรูป..." : `สร้าง ${imageType === "cover" ? "Cover" : "Mid-Article"} Image`}
            </button>
            <p className="text-xs text-slate-400 text-center -mt-3">ใช้ Gemini Imagen 3</p>

            {/* PNG Download */}
            <button
              type="button"
              onClick={handleDownloadWebp}
              disabled={!selected}
              className={cn(
                "w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all",
                selected
                  ? "bg-indigo-600 hover:bg-indigo-700 text-white"
                  : "bg-gray-100 text-slate-400 cursor-not-allowed"
              )}
            >
              <Download className="h-3.5 w-3.5" />
              {selected ? "Download PNG" : "Generate รูปก่อน"}
            </button>
          </div>
        </div>

        {/* ── RIGHT PANEL — Preview + History ── */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Preview area */}
          <div className="flex-1 overflow-y-auto bg-[#f8f9fb] p-6">
            {generating && (
              <div className="flex flex-col items-center justify-center h-64 gap-4">
                <div className="w-full max-w-sm h-1.5 bg-white rounded-full overflow-hidden shadow-inner">
                  <div className="h-full bg-gradient-to-r from-rose-500 to-orange-400 rounded-full animate-pulse w-3/4" />
                </div>
                <div className="flex items-center gap-2">
                  <Wand2 className="h-4 w-4 text-rose-500 animate-pulse" />
                  <p className="text-slate-500 text-sm">Gemini กำลังสร้างรูปภาพ...</p>
                </div>
                <p className="text-slate-400 text-xs">อาจใช้เวลา 15–30 วินาที</p>
              </div>
            )}

            {!generating && !selected && (
              <div className="flex flex-col items-center justify-center h-full gap-4 py-16">
                <div className="w-16 h-16 rounded-2xl bg-white border border-gray-200 flex items-center justify-center shadow-sm">
                  <Image className="h-7 w-7 text-slate-300" />
                </div>
                <div className="text-center">
                  <p className="text-slate-600 font-medium">ยังไม่มีรูปภาพ</p>
                  <p className="text-sm text-slate-400 mt-1">ใส่ Title + Keyword แล้วกด สร้างรูปภาพ</p>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-2 max-w-xs w-full">
                  <div className="bg-white border border-dashed border-gray-300 rounded-xl aspect-video flex items-center justify-center">
                    <LayoutTemplate className="h-6 w-6 text-gray-300" />
                  </div>
                  <div className="bg-white border border-dashed border-gray-300 rounded-xl aspect-video flex items-center justify-center">
                    <AlignCenter className="h-6 w-6 text-gray-300" />
                  </div>
                </div>
                <p className="text-xs text-slate-400">Cover (1536×864) · Mid-Article (1200×630)</p>
              </div>
            )}

            {!generating && selected && (
              <div className="max-w-4xl mx-auto space-y-4">
                {/* Toolbar */}
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "text-xs px-2.5 py-1 rounded-full font-semibold",
                      selected.type === "cover"
                        ? "bg-rose-50 text-rose-600 border border-rose-200"
                        : "bg-blue-50 text-blue-600 border border-blue-200"
                    )}>
                      {selected.type === "cover" ? "Cover Image" : "Mid-Article"}
                    </span>
                    <span className="text-xs text-slate-400">{dims.w} × {dims.h} px</span>
                    <span className="text-xs text-slate-400">· {selected.keyword}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleGenerate}
                      disabled={generating}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-gray-200 hover:bg-gray-50 text-slate-600 text-xs font-medium transition-colors"
                    >
                      <RotateCcw className="h-3 w-3" /> Regenerate
                    </button>
                    <button
                      onClick={handleDownloadWebp}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500 hover:bg-rose-400 text-white text-xs font-semibold transition-colors"
                    >
                      <Download className="h-3 w-3" /> WebP
                    </button>
                    {showPptx && (
                      <button
                        onClick={handleExportPptx}
                        disabled={exportingPptx}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
                      >
                        <FileSliders className="h-3 w-3" /> {exportingPptx ? "..." : "PPTX"}
                      </button>
                    )}
                  </div>
                </div>

                {/* Image Preview */}
                <div
                  className="w-full bg-white rounded-2xl overflow-hidden shadow-lg border border-gray-100"
                  style={{ aspectRatio: `${dims.w} / ${dims.h}` }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`data:${selected.mimeType};base64,${selected.imageBase64}`}
                    alt={selected.title}
                    className="w-full h-full object-cover"
                  />
                </div>

                {/* Metadata */}
                <div className="bg-white rounded-xl border border-gray-100 p-4 text-xs text-slate-500 space-y-1">
                  <div className="flex gap-4">
                    <span><strong className="text-slate-700">Title:</strong> {selected.title}</span>
                    <span><strong className="text-slate-700">Keyword:</strong> {selected.keyword}</span>
                    <span><strong className="text-slate-700">Type:</strong> {selected.type}</span>
                    <span className="ml-auto">{selected.createdAt.toLocaleTimeString("th-TH")}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* History strip */}
          {history.length > 0 && (
            <div className="flex-shrink-0 border-t border-gray-100 bg-white px-4 py-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-slate-500">History</span>
                <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{history.length}</span>
              </div>
              <div className="flex gap-3 overflow-x-auto pb-1">
                {history.map((item, idx) => (
                  <button
                    key={idx}
                    onClick={() => setSelectedIdx(idx)}
                    className={cn(
                      "flex-shrink-0 w-32 rounded-xl overflow-hidden border-2 transition-all",
                      selectedIdx === idx ? "border-rose-500 shadow-md scale-105" : "border-gray-200 hover:border-slate-400"
                    )}
                  >
                    <div
                      className="w-full"
                      style={{ aspectRatio: item.type === "cover" ? "16/9" : "16/8.4" }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`data:${item.mimeType};base64,${item.imageBase64}`}
                        alt={item.keyword}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="px-2 py-1 bg-white border-t border-gray-100">
                      <p className="text-[9px] font-semibold text-slate-600 truncate">{item.keyword}</p>
                      <p className="text-[9px] text-slate-400">{item.type === "cover" ? "Cover" : "Mid"}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
