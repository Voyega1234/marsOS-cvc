"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Sparkles, Zap, PenLine, ArrowRight, ChevronDown,
  BookOpen, Search, Wand2, Check, Loader2, Info,
} from "lucide-react";

interface Keyword {
  id: string;
  keyword: string;
  funnelStage: string;
  intent: string;
}

interface Project {
  id: string;
  name: string;
  automationMode: string;
  language: string;
  keywords: Keyword[];
}

interface Props {
  projects: Project[];
  userId: string;
  userRole: string;
}

const INTENT_OPTIONS = [
  { value: "INFORMATIONAL", label: "Informational",  desc: "ให้ข้อมูล ตอบคำถาม" },
  { value: "COMMERCIAL",    label: "Commercial",     desc: "เปรียบเทียบ ตัดสินใจ" },
  { value: "TRANSACTIONAL", label: "Transactional",  desc: "พร้อมซื้อ/สมัคร" },
];

const FUNNEL_OPTIONS = [
  { value: "TOFU", label: "TOFU", desc: "ดึง traffic กว้าง" },
  { value: "MOFU", label: "MOFU", desc: "nurture ลูกค้าที่สนใจ" },
  { value: "BOFU", label: "BOFU", desc: "ปิดการขาย" },
];

type Mode = "auto" | "semi" | "manual";

const MODES: { value: Mode; icon: React.ElementType; label: string; desc: string; badge: string; badgeColor: string }[] = [
  {
    value: "auto",
    icon: Zap,
    label: "Full Auto",
    desc: "ระบบเขียนทุกขั้นตอนอัตโนมัติ ตั้งแต่ Outline จนถึง SEO Check",
    badge: "แนะนำ",
    badgeColor: "bg-green-100 text-green-700",
  },
  {
    value: "semi",
    icon: Wand2,
    label: "Semi Auto",
    desc: "ระบบสร้าง Outline ให้ดูก่อน อนุมัติแล้วค่อยเขียนบทความต่อ",
    badge: "ควบคุมได้",
    badgeColor: "bg-blue-100 text-blue-700",
  },
  {
    value: "manual",
    icon: PenLine,
    label: "Manual",
    desc: "สร้างบทความเปล่าๆ แล้วกดปุ่มเองทีละขั้น",
    badge: "",
    badgeColor: "",
  },
];

export function QuickCreateClient({ projects, userId, userRole }: Props) {
  const router = useRouter();

  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [keywordId, setKeywordId] = useState("");
  const [customKeyword, setCustomKeyword] = useState("");
  const [intent, setIntent] = useState("INFORMATIONAL");
  const [funnel, setFunnel] = useState("TOFU");
  const [brief, setBrief] = useState("");
  const [mode, setMode] = useState<Mode>("auto");
  const [step, setStep] = useState<"creating" | "running" | "done" | null>(null);
  const [stepsRun, setStepsRun] = useState<string[]>([]);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const project = projects.find((p) => p.id === projectId);
  const keywords = project?.keywords ?? [];

  const projAutoMode = project?.automationMode ?? "MANUAL";

  async function handleCreate() {
    if (!title.trim()) { toast.error("กรุณาใส่ชื่อบทความ"); return; }
    if (!projectId)     { toast.error("กรุณาเลือก Project"); return; }

    setStep("creating");

    // 1. Create article
    const res = await fetch("/api/articles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        projectId,
        funnelStage: funnel,
        searchIntent: intent,
        brief: brief.trim() || null,
        keywordId: keywordId || null,
      }),
    });

    if (!res.ok) {
      toast.error("สร้างบทความไม่สำเร็จ");
      setStep(null);
      return;
    }

    const article = await res.json();
    setCreatedId(article.id);

    if (mode === "manual") {
      toast.success("สร้างบทความแล้ว — ไปหน้า Article");
      router.push(`/articles/${article.id}`);
      return;
    }

    // 2. Set project to correct auto mode temporarily if needed
    const targetMode = mode === "auto" ? "FULL_AUTO" : "SEMI_AUTO";

    // If project is MANUAL, we need to override — use the article's project mode
    // We'll pass mode override via query param on auto-run
    setStep("running");

    const autoRes = await fetch("/api/ai/auto-run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        articleId: article.id,
        modeOverride: targetMode,
      }),
    });

    const autoData = await autoRes.json();

    if (!autoRes.ok) {
      toast.error(autoData.error ?? "Auto-run ล้มเหลว");
      router.push(`/articles/${article.id}`);
      return;
    }

    setStepsRun(autoData.stepsRun ?? []);
    setStep("done");

    if (autoData.stepsStopped?.length > 0) {
      toast.success(`รัน ${autoData.stepsRun?.length} ขั้นตอน — รอ Approve Outline`);
    } else {
      toast.success(`เสร็จ! รัน ${autoData.stepsRun?.length} ขั้นตอน`);
    }
  }

  const isRunning = step === "creating" || step === "running";

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">สร้างบทความใหม่</h1>
          <p className="text-sm text-gray-500 mt-0.5">ใส่ title → เลือก Full Auto → กด Enter</p>
        </div>
        <span className="text-xs text-gray-400 pb-0.5">กด <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-600 font-mono text-[10px]">Enter</kbd> เพื่อสร้าง</span>
      </div>

      {/* Mode selector */}
      <div className="grid grid-cols-3 gap-3">
        {MODES.map((m) => (
          <button
            key={m.value}
            onClick={() => setMode(m.value)}
            className={cn(
              "relative flex flex-col gap-1.5 rounded-xl border p-4 text-left transition-all",
              mode === m.value
                ? "border-gray-900 bg-gray-900 text-white shadow-md"
                : "border-gray-100 bg-white hover:border-gray-300"
            )}
          >
            {m.badge && (
              <span className={cn(
                "absolute top-2.5 right-2.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full",
                mode === m.value ? "bg-white/20 text-white" : m.badgeColor
              )}>
                {m.badge}
              </span>
            )}
            <m.icon className={cn("h-4 w-4", mode === m.value ? "text-white" : "text-gray-600")} />
            <span className="text-sm font-semibold">{m.label}</span>
            <span className={cn("text-[11px] leading-snug", mode === m.value ? "text-gray-300" : "text-gray-400")}>
              {m.desc}
            </span>
          </button>
        ))}
      </div>

      {/* Form */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-4">

        {/* Project */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">Project</label>
          <div className="relative">
            <select
              value={projectId}
              onChange={(e) => { setProjectId(e.target.value); setKeywordId(""); }}
              className="w-full appearance-none rounded-lg border border-gray-100 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-400"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
          </div>
        </div>

        {/* Title */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">
            ชื่อบทความ / Title <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            placeholder="เช่น วีซ่าเชงเก้นคืออะไร ใช้เดินทางประเทศไหนได้บ้าง"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !isRunning) handleCreate(); }}
            className="w-full rounded-lg border border-gray-100 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-400"
          />
        </div>

        {/* Keyword — pick from list or type custom */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">Keyword หลัก</label>
          {keywords.length > 0 ? (
            <div className="relative">
              <select
                value={keywordId}
                onChange={(e) => setKeywordId(e.target.value)}
                className="w-full appearance-none rounded-lg border border-gray-100 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-400"
              >
                <option value="">— พิมพ์เองด้านล่าง หรือเลือกจาก keyword ที่มี —</option>
                {keywords.map((kw) => (
                  <option key={kw.id} value={kw.id}>{kw.keyword} ({kw.funnelStage})</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            </div>
          ) : (
            <p className="text-xs text-gray-400">ยังไม่มี keyword ใน project นี้</p>
          )}
        </div>

        {/* Intent + Funnel */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">
              Search Intent
              <span className="font-normal text-gray-400 ml-1">— คนค้นหาด้วยเจตนาอะไร?</span>
            </label>
            <div className="relative">
              <select
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                className="w-full appearance-none rounded-lg border border-gray-100 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-400"
              >
                {INTENT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label} — {o.desc}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            </div>
            {intent === "INFORMATIONAL" && <p className="text-[11px] text-gray-400 mt-1">เหมาะกับบทความ "คืออะไร / ทำยังไง / วิธี..."</p>}
            {intent === "COMMERCIAL" && <p className="text-[11px] text-gray-400 mt-1">เหมาะกับบทความ "รีวิว / เปรียบเทียบ / ดีไหม..."</p>}
            {intent === "TRANSACTIONAL" && <p className="text-[11px] text-gray-400 mt-1">เหมาะกับหน้า "สมัคร / สั่งซื้อ / ราคา..."</p>}
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">
              Funnel Stage
              <span className="font-normal text-gray-400 ml-1">— ลูกค้าอยู่ขั้นไหน?</span>
            </label>
            <div className="relative">
              <select
                value={funnel}
                onChange={(e) => setFunnel(e.target.value)}
                className="w-full appearance-none rounded-lg border border-gray-100 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-400"
              >
                {FUNNEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label} — {o.desc}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            </div>
            {funnel === "TOFU" && <p className="text-[11px] text-gray-400 mt-1">คนยังไม่รู้จักสินค้า — เขียนให้ความรู้กว้างๆ</p>}
            {funnel === "MOFU" && <p className="text-[11px] text-gray-400 mt-1">คนสนใจแล้ว — เขียนเปรียบเทียบหรือ case study</p>}
            {funnel === "BOFU" && <p className="text-[11px] text-gray-400 mt-1">คนใกล้ตัดสินใจ — เขียน CTA ชัดเจน ราคา โปรโมชั่น</p>}
          </div>
        </div>

        {/* Brief / extra instructions */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">
            Brief / คำสั่งพิเศษ
            <span className="font-normal text-gray-400 ml-1">(optional — ระบุ style, ความยาว, จุดเน้น)</span>
          </label>
          <textarea
            rows={3}
            placeholder="เช่น เขียนแบบเป็นกันเอง ความยาว 2,000 คำ ใส่ตัวเลขสถิติเยอะๆ อย่าใช้ศัพท์เทคนิค"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            className="w-full rounded-lg border border-gray-100 px-3 py-2.5 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-400 resize-none leading-relaxed"
          />
        </div>
      </div>

      {/* Cost hint */}
      {mode !== "manual" && (
        <div className="flex items-start gap-2 text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2.5">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-gray-400" />
          <span>
            Demo Mode — ขณะนี้เป็น mock ไม่มีค่าใช้จ่าย · ถ้า connect Claude จริงจะเสีย{" "}
            <strong className="text-gray-700">~$0.06 ต่อบทความ</strong>{" "}
            (Outline $0.01 + Article $0.04 + SEO $0.01)
          </span>
        </div>
      )}

      {/* Progress */}
      {step && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-3">
          <p className="text-sm font-semibold text-gray-900">
            {step === "creating" && "กำลังสร้างบทความ..."}
            {step === "running"  && "AI กำลังทำงาน..."}
            {step === "done"     && "เสร็จแล้ว! 🎉"}
          </p>
          <div className="space-y-1.5">
            {[
              { key: "outline",         label: "สร้าง Outline" },
              { key: "approve-outline", label: "Auto-approve Outline" },
              { key: "article",         label: "เขียนบทความ HTML" },
              { key: "seo-check",       label: "ตรวจ SEO" },
              { key: "image-prompt",    label: "สร้าง Image Prompt" },
            ].map((s) => {
              const done = stepsRun.includes(s.key);
              const active = step === "running" && !done;
              return (
                <div key={s.key} className="flex items-center gap-2.5 text-sm">
                  {done ? (
                    <Check className="h-4 w-4 text-green-600 shrink-0" />
                  ) : active ? (
                    <Loader2 className="h-4 w-4 text-blue-500 animate-spin shrink-0" />
                  ) : (
                    <div className="h-4 w-4 rounded-full border-2 border-gray-100 shrink-0" />
                  )}
                  <span className={cn(
                    done ? "text-gray-900" : "text-gray-400",
                  )}>{s.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* CTA */}
      {step === "done" && createdId ? (
        <button
          onClick={() => router.push(`/articles/${createdId}`)}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gray-900 text-white font-semibold hover:bg-gray-800 transition-colors"
        >
          <ArrowRight className="h-4 w-4" />
          ดูบทความที่สร้างแล้ว
        </button>
      ) : (
        <button
          onClick={handleCreate}
          disabled={isRunning || !title.trim() || !projectId}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gray-900 text-white font-semibold hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {isRunning ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : mode === "auto" ? (
            <Zap className="h-4 w-4" />
          ) : mode === "semi" ? (
            <Wand2 className="h-4 w-4" />
          ) : (
            <PenLine className="h-4 w-4" />
          )}
          {isRunning ? "กำลังทำงาน..." : mode === "manual" ? "สร้างบทความเปล่า" : "สร้างและ Generate เลย"}
        </button>
      )}
    </div>
  );
}
