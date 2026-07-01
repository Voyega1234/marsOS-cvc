"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { safeJson, formatDate, formatDateTime } from "@/lib/utils";
import { STATUS_CONFIG, FUNNEL_CONFIG } from "@/types";
import type { ArticleStatus, FunnelStage } from "@/types";
import {
  BookOpen, Search, LayoutList, PenLine, CheckSquare, Image as ImageIcon,
  CheckCircle, Globe, ChevronRight, Sparkles, AlertTriangle, ArrowLeft,
  Check, Clock, Loader2, History, ExternalLink, Star,
} from "lucide-react";

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
}

const STEPS = [
  { num: 1, key: "brief",   emoji: "📋", labelTh: "Brief",       desc: "ข้อมูลพื้นฐาน" },
  { num: 2, key: "keyword", emoji: "🔎", labelTh: "คีย์เวิร์ด",   desc: "Keywords" },
  { num: 3, key: "outline", emoji: "📝", labelTh: "โครงร่าง",     desc: "Outline" },
  { num: 4, key: "article", emoji: "📄", labelTh: "บทความ",       desc: "Article HTML" },
  { num: 5, key: "seo",     emoji: "✅", labelTh: "SEO",           desc: "ตรวจ SEO" },
  { num: 6, key: "image",   emoji: "🖼️", labelTh: "รูปภาพ",       desc: "Image Prompt" },
  { num: 7, key: "review",  emoji: "👁️", labelTh: "ตรวจสอบ",      desc: "Review" },
  { num: 8, key: "publish", emoji: "🌐", labelTh: "เผยแพร่",       desc: "Publish" },
];

function getActiveStep(status: string): number {
  if (["KEYWORD_RESEARCHING", "KEYWORD_DONE", "CONTENT_MAP_DONE"].includes(status)) return 2;
  if (["OUTLINE_GENERATING", "OUTLINE_DONE", "OUTLINE_APPROVED"].includes(status)) return 3;
  if (["ARTICLE_GENERATING", "ARTICLE_DONE"].includes(status)) return 4;
  if (["SEO_REVIEW", "REVISION_REQUIRED"].includes(status)) return 5;
  if (["IMAGE_PROMPT_DONE"].includes(status)) return 6;
  if (["APPROVED"].includes(status)) return 7;
  if (["WORDPRESS_DRAFTED", "POSTED"].includes(status)) return 8;
  return 1;
}

function isStepComplete(stepNum: number, status: string): boolean {
  const active = getActiveStep(status);
  if (stepNum < active) return true;
  if (stepNum === 3 && ["OUTLINE_APPROVED", "ARTICLE_GENERATING", "ARTICLE_DONE", "IMAGE_PROMPT_DONE", "SEO_REVIEW", "REVISION_REQUIRED", "APPROVED", "WORDPRESS_DRAFTED", "POSTED"].includes(status)) return true;
  if (stepNum === 4 && ["IMAGE_PROMPT_DONE", "SEO_REVIEW", "REVISION_REQUIRED", "APPROVED", "WORDPRESS_DRAFTED", "POSTED"].includes(status)) return true;
  return false;
}

export function WizardArticleDetail({ article, users, currentUser }: Props) {
  const router = useRouter();
  const [activeStep, setActiveStep] = useState(() => getActiveStep(article.status));
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [confirmRegenerate, setConfirmRegenerate] = useState<{ key: string; label: string } | null>(null);
  const [autoRunning, setAutoRunning] = useState(false);

  const automationMode = article.project.automationMode ?? "MANUAL";

  async function runAutoFlow() {
    setAutoRunning(true);
    try {
      const res = await fetch("/api/ai/auto-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articleId: article.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Auto-run failed");
      toast.success(data.message ?? "Auto-run เสร็จแล้ว 🎉");
      router.refresh();
    } catch (err: any) {
      toast.error(err.message ?? "เกิดข้อผิดพลาด");
    } finally {
      setAutoRunning(false);
    }
  }

  const outline = safeJson<OutlineData>(article.outline, {});
  const relatedKeywords = safeJson<string[]>(article.keyword?.relatedKeywords ?? "[]", []);
  const latestReview = article.reviews[0];
  const statusCfg = STATUS_CONFIG[article.status as ArticleStatus];
  const funnelCfg = FUNNEL_CONFIG[article.funnelStage as FunnelStage];
  const progress = Math.round(((getActiveStep(article.status) - 1) / 7) * 100);

  async function runAIAction(key: string, endpoint: string) {
    const hasContent =
      (key === "article" && !!article.htmlContent) ||
      (key === "outline" && !!article.outline);
    if (hasContent && confirmRegenerate?.key !== key) {
      setConfirmRegenerate({ key, label: key === "article" ? "บทความ" : "โครงร่าง" });
      return;
    }
    setConfirmRegenerate(null);
    setLoadingAction(key);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articleId: article.id }),
      });
      if (!res.ok) throw new Error();
      toast.success("AI ดำเนินการเสร็จแล้ว! 🎉");
      router.refresh();
    } catch {
      toast.error("เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
    } finally {
      setLoadingAction(null);
    }
  }

  async function patchStatus(newStatus: string, successMsg: string) {
    setLoadingAction("patch-" + newStatus);
    try {
      const res = await fetch(`/api/articles/${article.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error();
      toast.success(successMsg);
      router.refresh();
    } catch {
      toast.error("เกิดข้อผิดพลาด กรุณาลองใหม่");
    } finally {
      setLoadingAction(null);
    }
  }

  return (
    <div className="space-y-6 pb-12">

      {/* Back + Header */}
      <div>
        <Link href={`/projects/${article.project.id}/articles`} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-green-600 transition-colors mb-4">
          <ArrowLeft className="h-4 w-4" />
          กลับไปหน้าบทความ — {article.project.name}
        </Link>
        <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                {statusCfg && (
                  <span className={`text-sm px-3 py-1 rounded-full font-medium ${statusCfg.bg} ${statusCfg.color}`}>
                    {statusCfg.labelTh}
                  </span>
                )}
                {funnelCfg && (
                  <span className={`text-sm px-3 py-1 rounded-full font-medium ${funnelCfg.bg} ${funnelCfg.color}`}>
                    {article.funnelStage}
                  </span>
                )}
                <span className="text-xs text-gray-400">อัปเดต {formatDate(article.updatedAt)}</span>
              </div>
              <h1 className="text-2xl font-bold text-gray-900 leading-tight">{article.title}</h1>
              <p className="text-sm text-gray-500 mt-1">{article.project.name} · {article.project.website}</p>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mt-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">ความคืบหน้า</span>
              <span className="text-sm font-bold text-green-600">{progress}%</span>
            </div>
            <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-green-400 to-emerald-500 rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Auto-run Banner ──────────────────────────────────────────── */}
      {automationMode !== "MANUAL" && !["WORDPRESS_DRAFTED", "POSTED"].includes(article.status) && (
        <div className="rounded-2xl border-2 border-violet-200 bg-violet-50 p-5 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/70 flex items-center justify-center shadow-sm">
              <Sparkles className="h-5 w-5 text-violet-600" />
            </div>
            <div>
              <p className="font-bold text-violet-900">
                {automationMode === "FULL_AUTO" ? "⚡ Full Auto Mode" : "🔁 Semi-Auto Mode"}
              </p>
              <p className="text-sm text-violet-600 mt-0.5">
                {automationMode === "FULL_AUTO"
                  ? "กด Run เพื่อให้ AI วิ่ง Pipeline ทั้งหมดจนถึง WordPress Draft"
                  : "AI จะรันต่อเนื่องแต่หยุดรอ Approve ที่ Outline และ SEO Review"}
              </p>
            </div>
          </div>
          <button
            onClick={runAutoFlow}
            disabled={autoRunning || !!loadingAction}
            className="flex items-center gap-2.5 px-6 py-3 rounded-xl bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white font-semibold text-sm transition-all shadow-sm disabled:opacity-60 disabled:cursor-not-allowed flex-shrink-0"
          >
            {autoRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {autoRunning ? "กำลังรัน Pipeline..." : "▶ Run Auto Pipeline"}
          </button>
        </div>
      )}

      {/* ── Current Action Banner ─────────────────────────────────────── */}
      <CurrentActionBanner
        status={article.status}
        loadingAction={loadingAction}
        onRunAI={runAIAction}
        onPatchStatus={patchStatus}
        onGoToStep={setActiveStep}
      />

      {/* Step Progress Indicator */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm overflow-x-auto">
        <div className="flex items-start gap-0 min-w-max">
          {STEPS.map((step, idx) => {
            const isDone = isStepComplete(step.num, article.status);
            const isActive = activeStep === step.num;
            const isNatural = getActiveStep(article.status) === step.num;

            return (
              <div key={step.key} className="flex items-start">
                <button
                  onClick={() => setActiveStep(step.num)}
                  className="flex flex-col items-center gap-2 px-3 group"
                >
                  <div className={`
                    relative w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm transition-all
                    ${isDone ? "bg-green-500 text-white shadow-sm" : ""}
                    ${isActive && !isDone ? "bg-green-600 text-white shadow-md ring-2 ring-green-300 ring-offset-2" : ""}
                    ${!isDone && !isActive ? "bg-gray-100 text-gray-400 group-hover:bg-gray-200" : ""}
                  `}>
                    {isDone ? (
                      <Check className="h-5 w-5" />
                    ) : (
                      <span>{step.emoji}</span>
                    )}
                    {isNatural && !isDone && (
                      <span className="absolute -top-1 -right-1 w-3 h-3 bg-orange-400 rounded-full border-2 border-white" />
                    )}
                  </div>
                  <div className="text-center">
                    <p className={`text-xs font-semibold leading-none ${isActive ? "text-green-700" : isDone ? "text-green-600" : "text-gray-400"}`}>
                      {step.labelTh}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5 hidden sm:block">{step.desc}</p>
                  </div>
                </button>
                {idx < STEPS.length - 1 && (
                  <div className={`w-8 h-0.5 mt-5 flex-shrink-0 ${isDone ? "bg-green-400" : "bg-gray-200"}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Step Content */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">

        {/* Step Header */}
        <div className="px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center text-xl">
              {STEPS[activeStep - 1].emoji}
            </div>
            <div>
              <p className="text-xs text-gray-400 font-medium">ขั้นตอนที่ {activeStep} / {STEPS.length}</p>
              <h2 className="text-lg font-bold text-gray-900">{STEPS[activeStep - 1].labelTh}</h2>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setActiveStep(Math.max(1, activeStep - 1))}
                disabled={activeStep === 1}
                className="p-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-500 disabled:opacity-30 transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setActiveStep(Math.min(STEPS.length, activeStep + 1))}
                disabled={activeStep === STEPS.length}
                className="p-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-500 disabled:opacity-30 transition-colors"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="p-6">

          {/* ── Step 1: Brief ── */}
          {activeStep === 1 && (
            <div className="space-y-5">
              {!article.brief ? (
                <EmptyStepState
                  emoji="📋"
                  title="ยังไม่มี Brief"
                  description="กรอกข้อมูลพื้นฐานของบทความ เช่น เป้าหมาย กลุ่มเป้าหมาย และโทนเสียงที่ต้องการ"
                />
              ) : (
                <div>
                  <SectionLabel>รายละเอียด Brief</SectionLabel>
                  <div className="p-5 bg-blue-50 rounded-2xl border border-b border-gray-100lue-100 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                    {article.brief}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                {[
                  { label: "โปรเจ็กต์",     value: article.project.name },
                  { label: "เว็บไซต์",       value: article.project.website },
                  { label: "Funnel Stage",   value: article.funnelStage },
                  { label: "Search Intent",  value: article.searchIntent },
                ].map((item) => (
                  <div key={item.label} className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                    <p className="text-xs text-gray-400 font-medium mb-1">{item.label}</p>
                    <p className="text-sm font-semibold text-gray-800">{item.value}</p>
                  </div>
                ))}
              </div>

              <StepNav
                nextLabel="ดูคีย์เวิร์ด →"
                onNext={() => setActiveStep(2)}
              />
            </div>
          )}

          {/* ── Step 2: Keywords ── */}
          {activeStep === 2 && (
            <div className="space-y-5">
              {!article.keyword ? (
                <EmptyStepState
                  emoji="🔎"
                  title="ยังไม่มีคีย์เวิร์ด"
                  description="ระบุ Main Keyword และ Related Keywords สำหรับบทความนี้"
                  actionLabel="ไปที่โปรเจ็กต์เพื่อวิจัยคีย์เวิร์ด"
                  actionHref={`/projects/${article.project.id}`}
                />
              ) : (
                <div className="space-y-4">
                  <div>
                    <SectionLabel>Main Keyword</SectionLabel>
                    <div className="inline-flex items-center gap-2 px-4 py-2.5 bg-green-50 border border-green-200 rounded-xl">
                      <Star className="h-4 w-4 text-green-600" />
                      <span className="font-bold text-green-700 text-base">{article.keyword.keyword}</span>
                    </div>
                  </div>
                  {relatedKeywords.length > 0 && (
                    <div>
                      <SectionLabel>Related Keywords</SectionLabel>
                      <div className="flex flex-wrap gap-2">
                        {relatedKeywords.map((kw, i) => (
                          <span key={i} className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-xl text-sm border border-b border-gray-100lue-100 font-medium">
                            {kw}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              <StepNav
                prevLabel="← Brief"
                nextLabel="ดูโครงร่าง →"
                onPrev={() => setActiveStep(1)}
                onNext={() => setActiveStep(3)}
              />
            </div>
          )}

          {/* ── Step 3: Outline ── */}
          {activeStep === 3 && (
            <div className="space-y-5">
              {!article.outline ? (
                <EmptyStepState
                  emoji="📝"
                  title="ยังไม่มีโครงร่าง"
                  description="กด 'สร้างโครงร่าง' ด้านล่างเพื่อให้ AI สร้างโครงสร้างบทความพร้อมหัวข้อและ subheading"
                >
                  <AIActionButton
                    label="🤖 ให้ AI สร้างโครงร่าง"
                    loading={loadingAction === "outline"}
                    onClick={() => runAIAction("outline", "/api/ai/outline")}
                  />
                </EmptyStepState>
              ) : (
                <div className="space-y-4">
                  {outline.estimatedWordCount && (
                    <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-xl text-sm">
                      <Clock className="h-4 w-4 text-blue-500" />
                      <span className="text-blue-700">ประมาณ <strong>{outline.estimatedWordCount.toLocaleString()}</strong> คำ</span>
                    </div>
                  )}
                  {outline.sections?.map((section, i) => (
                    <div key={i} className="border border-gray-100 rounded-2xl p-4 hover:border-green-200 transition-colors">
                      <p className="font-semibold text-gray-900 text-base">{section.heading}</p>
                      {section.subheadings?.map((sh, j) => (
                        <p key={j} className="text-sm text-gray-600 ml-4 mt-1.5 flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-gray-300 flex-shrink-0" />
                          {sh}
                        </p>
                      ))}
                      {section.keyPoints?.length ? (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {section.keyPoints.map((kp, k) => (
                            <span key={k} className="text-xs px-2.5 py-1 bg-orange-50 text-orange-600 rounded-lg border border-orange-100">{kp}</span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                  {outline.faqSuggestions?.length ? (
                    <div className="border border-yellow-100 rounded-2xl p-4 bg-yellow-50">
                      <p className="font-semibold text-gray-900 mb-2">💬 FAQ ที่แนะนำ</p>
                      {outline.faqSuggestions.map((q, i) => (
                        <p key={i} className="text-sm text-gray-700 mt-1.5 flex items-start gap-2">
                          <span className="text-yellow-500 font-bold">Q{i + 1}.</span>
                          {q}
                        </p>
                      ))}
                    </div>
                  ) : null}

                  {/* Actions */}
                  <div className="flex items-center gap-3 pt-2 flex-wrap">
                    {article.status === "OUTLINE_DONE" && (
                      <Button
                        onClick={() => patchStatus("OUTLINE_APPROVED", "โครงร่างได้รับการอนุมัติแล้ว! ✅")}
                        disabled={!!loadingAction}
                        className="bg-amber-500 hover:bg-amber-600 text-white rounded-xl gap-2 px-6 py-3 text-base font-semibold"
                      >
                        {loadingAction === "patch-OUTLINE_APPROVED" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                        อนุมัติโครงร่าง
                      </Button>
                    )}
                    <button
                      onClick={() => runAIAction("outline", "/api/ai/outline")}
                      disabled={!!loadingAction}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-100 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                    >
                      {loadingAction === "outline" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      สร้างใหม่
                    </button>
                  </div>
                </div>
              )}
              <StepNav
                prevLabel="← คีย์เวิร์ด"
                nextLabel="ดูบทความ →"
                onPrev={() => setActiveStep(2)}
                onNext={() => setActiveStep(4)}
              />
            </div>
          )}

          {/* ── Step 4: Article HTML ── */}
          {activeStep === 4 && (
            <div className="space-y-5">
              {!article.htmlContent ? (
                <EmptyStepState
                  emoji="📄"
                  title="ยังไม่มีบทความ"
                  description={
                    article.status === "OUTLINE_APPROVED"
                      ? "โครงร่างอนุมัติแล้ว! กด 'เขียนบทความ' เพื่อให้ AI เขียนเนื้อหาเต็มรูปแบบ"
                      : "อนุมัติโครงร่างก่อน แล้วจึงเขียนบทความได้"
                  }
                >
                  {article.status === "OUTLINE_APPROVED" && (
                    <AIActionButton
                      label="✍️ ให้ AI เขียนบทความ"
                      loading={loadingAction === "article"}
                      onClick={() => runAIAction("article", "/api/ai/article")}
                    />
                  )}
                </EmptyStepState>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 p-3 bg-green-50 rounded-xl text-sm border border-green-100">
                    <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" />
                    <span className="text-green-700 font-medium">
                      บทความพร้อมแล้ว — {article.htmlContent.length.toLocaleString()} ตัวอักษร
                    </span>
                  </div>
                  <div className="border border-gray-100 rounded-2xl overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                      <span className="text-sm font-medium text-gray-700">Preview บทความ</span>
                    </div>
                    <div
                      className="p-6 prose max-w-none text-sm overflow-auto max-h-80 text-gray-700"
                      dangerouslySetInnerHTML={{ __html: article.htmlContent }}
                    />
                    <div className="border-t p-4 bg-gray-50">
                      <details>
                        <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">ดู HTML Source</summary>
                        <pre className="text-xs text-gray-600 mt-2 overflow-auto max-h-48 whitespace-pre-wrap bg-gray-900 text-green-400 p-3 rounded-xl">{article.htmlContent}</pre>
                      </details>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <button
                      onClick={() => runAIAction("article", "/api/ai/article")}
                      disabled={!!loadingAction}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-100 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                    >
                      {loadingAction === "article" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      เขียนใหม่
                    </button>
                  </div>
                </div>
              )}
              <StepNav
                prevLabel="← โครงร่าง"
                nextLabel="ตรวจ SEO →"
                onPrev={() => setActiveStep(3)}
                onNext={() => setActiveStep(5)}
              />
            </div>
          )}

          {/* ── Step 5: SEO ── */}
          {activeStep === 5 && (
            <div className="space-y-5">
              {!article.seoTitle && !article.metaDescription ? (
                <EmptyStepState
                  emoji="✅"
                  title="ยังไม่ได้ตรวจ SEO"
                  description="กด 'ตรวจ SEO' เพื่อให้ AI วิเคราะห์คุณภาพ SEO และสร้าง Meta Title + Description"
                >
                  {(article.status === "ARTICLE_DONE" || article.status === "IMAGE_PROMPT_DONE") && (
                    <AIActionButton
                      label="🔍 ตรวจ SEO อัตโนมัติ"
                      loading={loadingAction === "seo-check"}
                      onClick={() => runAIAction("seo-check", "/api/ai/seo-check")}
                      color="bg-[#1A1A1A] hover:bg-[#2D2D2D]"
                    />
                  )}
                </EmptyStepState>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4">
                    <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">SEO Title</p>
                      <p className="text-base font-medium text-gray-900">{article.seoTitle}</p>
                      {article.seoTitle && (
                        <div className="flex items-center gap-2 mt-2">
                          <div className={`h-1.5 rounded-full flex-1 ${article.seoTitle.length <= 60 ? "bg-green-400" : "bg-red-400"}`}
                            style={{ width: `${Math.min(100, (article.seoTitle.length / 60) * 100)}%` }}
                          />
                          <span className={`text-xs font-medium ${article.seoTitle.length <= 60 ? "text-green-600" : "text-red-600"}`}>
                            {article.seoTitle.length}/60
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Meta Description</p>
                      <p className="text-sm text-gray-700 leading-relaxed">{article.metaDescription}</p>
                      {article.metaDescription && (
                        <div className="flex items-center gap-2 mt-2">
                          <div className={`h-1.5 rounded-full ${article.metaDescription.length <= 160 ? "bg-green-400" : "bg-red-400"}`}
                            style={{ width: `${Math.min(100, (article.metaDescription.length / 160) * 100)}%` }}
                          />
                          <span className={`text-xs font-medium ${article.metaDescription.length <= 160 ? "text-green-600" : "text-red-600"}`}>
                            {article.metaDescription.length}/160
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                  {latestReview && (
                    <div>
                      <SectionLabel>คะแนน SEO</SectionLabel>
                      <div className="grid grid-cols-3 gap-3">
                        {[
                          { label: "SEO",         value: latestReview.seoScore,        color: "text-blue-600",   bg: "bg-blue-50",   border: "border-b border-gray-100lue-100" },
                          { label: "AEO",         value: latestReview.aeoScore,        color: "text-violet-600", bg: "bg-violet-50", border: "border-violet-100" },
                          { label: "Conversion",  value: latestReview.conversionScore, color: "text-green-600",  bg: "bg-green-50",  border: "border-green-100" },
                        ].map((s) => (
                          <div key={s.label} className={`p-4 rounded-2xl border text-center ${s.bg} ${s.border}`}>
                            <p className="text-xs text-gray-500 font-medium">{s.label}</p>
                            <p className={`text-3xl font-bold mt-1 ${s.color}`}>{s.value ?? "—"}</p>
                            <p className="text-xs text-gray-400">/ 100</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {article.status === "SEO_REVIEW" && (
                    <Button
                      onClick={() => patchStatus("APPROVED", "บทความได้รับการอนุมัติแล้ว! 🎉")}
                      disabled={!!loadingAction}
                      className="bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white rounded-xl px-6 py-3 text-base font-semibold gap-2 w-full sm:w-auto"
                    >
                      {loadingAction?.startsWith("patch") ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                      อนุมัติบทความ
                    </Button>
                  )}
                </div>
              )}
              <StepNav
                prevLabel="← บทความ"
                nextLabel="ดูรูปภาพ →"
                onPrev={() => setActiveStep(4)}
                onNext={() => setActiveStep(6)}
              />
            </div>
          )}

          {/* ── Step 6: Image ── */}
          {activeStep === 6 && (
            <div className="space-y-5">
              {!article.imagePrompt ? (
                <EmptyStepState
                  emoji="🖼️"
                  title="ยังไม่มี Image Prompt"
                  description="กด 'สร้าง Image Prompt' เพื่อให้ AI สร้าง prompt สำหรับภาพ Hero ของบทความ"
                >
                  {(article.status === "ARTICLE_DONE" || article.status === "SEO_REVIEW" || article.status === "IMAGE_PROMPT_DONE") && (
                    <AIActionButton
                      label="🖼️ สร้าง Image Prompt"
                      loading={loadingAction === "image-prompt"}
                      onClick={() => runAIAction("image-prompt", "/api/ai/image-prompt")}
                      color="bg-pink-500 hover:bg-pink-600"
                    />
                  )}
                </EmptyStepState>
              ) : (
                <div className="space-y-4">
                  <div>
                    <SectionLabel>Image Prompt</SectionLabel>
                    <div className="p-5 bg-pink-50 rounded-2xl border border-pink-100">
                      <p className="text-sm text-gray-800 leading-relaxed">{article.imagePrompt}</p>
                    </div>
                  </div>
                  {article.coverImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={article.coverImageUrl} alt={article.title} className="w-full max-w-lg rounded-2xl border shadow-sm" />
                  ) : (
                    <div className="w-full max-w-lg h-52 rounded-2xl border-2 border-dashed border-pink-200 flex items-center justify-center bg-pink-50">
                      <div className="text-center">
                        <ImageIcon className="h-10 w-10 text-pink-300 mx-auto mb-2" />
                        <p className="text-sm text-pink-400 font-medium">นำ prompt ไปใช้กับ AI image generator</p>
                        <p className="text-xs text-pink-300 mt-1">Midjourney / DALL-E / Stable Diffusion</p>
                      </div>
                    </div>
                  )}
                  <button
                    onClick={() => runAIAction("image-prompt", "/api/ai/image-prompt")}
                    disabled={!!loadingAction}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-100 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {loadingAction === "image-prompt" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    สร้างใหม่
                  </button>
                </div>
              )}
              <StepNav
                prevLabel="← SEO"
                nextLabel="ดู Review →"
                onPrev={() => setActiveStep(5)}
                onNext={() => setActiveStep(7)}
              />
            </div>
          )}

          {/* ── Step 7: Review ── */}
          {activeStep === 7 && (
            <div className="space-y-5">
              {article.reviews.length === 0 ? (
                <EmptyStepState
                  emoji="👁️"
                  title="ยังไม่มี Review"
                  description="เมื่อผู้ตรวจสอบ SEO ให้คะแนนและความเห็นแล้ว จะแสดงผลที่นี่"
                />
              ) : (
                <div className="space-y-4">
                  {article.reviews.map((review) => (
                    <div key={review.id} className="border border-gray-100 rounded-2xl p-5">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-teal-400 to-emerald-500 flex items-center justify-center text-sm font-bold text-white shadow-sm">
                            {review.reviewer.name?.[0] ?? "?"}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-gray-900">{review.reviewer.name}</p>
                            <p className="text-xs text-gray-400">{formatDate(review.createdAt)}</p>
                          </div>
                        </div>
                        {review.riskLevel && (
                          <span className={`text-xs px-3 py-1 rounded-full font-medium ${
                            review.riskLevel === "HIGH" ? "bg-red-100 text-red-700" :
                            review.riskLevel === "MEDIUM" ? "bg-yellow-100 text-yellow-700" :
                            "bg-green-100 text-green-700"
                          }`}>
                            Risk: {review.riskLevel}
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-3 mb-4">
                        {[
                          { l: "SEO",        v: review.seoScore,        bg: "bg-blue-50",   text: "text-blue-600" },
                          { l: "AEO",        v: review.aeoScore,        bg: "bg-violet-50", text: "text-violet-600" },
                          { l: "Conversion", v: review.conversionScore, bg: "bg-green-50",  text: "text-green-600" },
                        ].map((s) => (
                          <div key={s.l} className={`p-3 rounded-xl text-center ${s.bg}`}>
                            <p className="text-xs text-gray-500">{s.l}</p>
                            <p className={`text-2xl font-bold ${s.text}`}>{s.v ?? "—"}</p>
                          </div>
                        ))}
                      </div>
                      {review.notes && (
                        <div className="p-4 bg-gray-50 rounded-xl text-sm text-gray-700 leading-relaxed">
                          {review.notes}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {(article.status === "SEO_REVIEW" || article.status === "IMAGE_PROMPT_DONE") && (
                <div className="p-5 bg-emerald-50 border border-emerald-100 rounded-2xl">
                  <p className="font-semibold text-emerald-800 mb-3">พร้อมอนุมัติบทความแล้ว?</p>
                  <Button
                    onClick={() => patchStatus("APPROVED", "บทความได้รับการอนุมัติแล้ว! 🎉")}
                    disabled={!!loadingAction}
                    className="bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white rounded-xl px-6 gap-2"
                  >
                    {loadingAction?.startsWith("patch") ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                    อนุมัติบทความ
                  </Button>
                </div>
              )}

              <StepNav
                prevLabel="← รูปภาพ"
                nextLabel="เผยแพร่ →"
                onPrev={() => setActiveStep(6)}
                onNext={() => setActiveStep(8)}
              />
            </div>
          )}

          {/* ── Step 8: Publish ── */}
          {activeStep === 8 && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                  <p className="text-xs text-gray-400 font-medium mb-2">สถานะบทความ</p>
                  {statusCfg && (
                    <span className={`text-sm px-3 py-1 rounded-full font-medium ${statusCfg.bg} ${statusCfg.color}`}>
                      {statusCfg.labelTh}
                    </span>
                  )}
                </div>
                <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                  <p className="text-xs text-gray-400 font-medium mb-2">สถานะ WordPress</p>
                  <p className="text-sm font-medium text-gray-800">{article.wordpressStatus ?? "ยังไม่ได้ส่ง"}</p>
                </div>
              </div>

              {article.wordpressUrl && (
                <a
                  href={article.wordpressUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2.5 p-4 bg-indigo-50 border border-indigo-100 rounded-2xl text-indigo-700 hover:bg-indigo-100 transition-colors text-sm font-medium"
                >
                  <Globe className="h-5 w-5" />
                  <span className="flex-1 truncate">{article.wordpressUrl}</span>
                  <ExternalLink className="h-4 w-4 flex-shrink-0" />
                </a>
              )}

              {article.status === "APPROVED" && !article.wordpressUrl && (
                <div className="space-y-3">
                  <div className="p-4 bg-green-50 border border-green-100 rounded-2xl text-sm text-green-700">
                    ✅ บทความได้รับการอนุมัติแล้ว — พร้อมส่ง WordPress ได้เลย!
                  </div>
                  <AIActionButton
                    label="🌐 ส่ง WordPress Draft"
                    loading={loadingAction === "wordpress"}
                    onClick={() => runAIAction("wordpress", "/api/wordpress/draft")}
                    color="bg-[#1A1A1A] hover:bg-[#2D2D2D]"
                  />
                </div>
              )}

              {article.status === "POSTED" && (
                <div className="p-6 bg-green-50 border border-green-200 rounded-2xl text-center">
                  <p className="text-4xl mb-3">🎉</p>
                  <p className="text-xl font-bold text-green-700">เผยแพร่เรียบร้อยแล้ว!</p>
                  <p className="text-sm text-green-600 mt-2">บทความนี้มีผลบนเว็บไซต์แล้ว</p>
                  {article.wordpressUrl && (
                    <a href={article.wordpressUrl} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 mt-4 px-5 py-2.5 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 transition-colors">
                      <Globe className="h-4 w-4" /> ดูบทความบนเว็บ
                    </a>
                  )}
                </div>
              )}

              {!["APPROVED", "WORDPRESS_DRAFTED", "POSTED"].includes(article.status) && (
                <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-2xl text-sm text-yellow-700 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>บทความต้องได้รับการอนุมัติก่อนจึงจะส่ง WordPress ได้ (ขั้นตอนปัจจุบัน: {statusCfg?.labelTh})</span>
                </div>
              )}

              <div className="pt-2">
                <p className="text-sm font-semibold text-gray-700 mb-3">ประวัติ Version</p>
                {article.versions.length === 0 ? (
                  <p className="text-sm text-gray-400">ยังไม่มี version</p>
                ) : (
                  <div className="space-y-2">
                    {article.versions.map((v) => (
                      <div key={v.id} className="flex items-center gap-3 p-3 border border-gray-100 rounded-xl text-sm">
                        <div className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-600">
                          v{v.versionNumber}
                        </div>
                        <div className="flex-1">
                          <p className="font-medium text-gray-700">{v.changeNote ?? "Auto-saved"}</p>
                          <p className="text-xs text-gray-400">{formatDateTime(v.createdAt)}</p>
                        </div>
                        <History className="h-4 w-4 text-gray-300" />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <StepNav prevLabel="← ตรวจสอบ" onPrev={() => setActiveStep(7)} />
            </div>
          )}

        </div>
      </div>

      {/* Regenerate Confirmation Modal */}
      <Dialog open={!!confirmRegenerate} onOpenChange={() => setConfirmRegenerate(null)}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              สร้าง{confirmRegenerate?.label}ใหม่?
            </DialogTitle>
            <DialogDescription className="text-base mt-2">
              {confirmRegenerate?.label}เดิมจะถูกบันทึกเป็น version สำรอง แล้ว AI จะสร้างใหม่แทน
            </DialogDescription>
          </DialogHeader>
          <div className="bg-blue-50 rounded-xl p-4 text-sm text-blue-700 border border-b border-gray-100lue-100">
            💡 ไม่ต้องกังวล — เนื้อหาเดิมจะยังอยู่ใน "ประวัติ Version" สามารถย้อนกลับได้เสมอ
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmRegenerate(null)} className="rounded-xl">
              ยกเลิก
            </Button>
            <Button
              onClick={() => {
                if (confirmRegenerate) {
                  const key = confirmRegenerate.key;
                  const endpointMap: Record<string, string> = {
                    outline: "/api/ai/outline",
                    article: "/api/ai/article",
                  };
                  setConfirmRegenerate(null);
                  runAIAction(key, endpointMap[key]);
                }
              }}
              className="bg-orange-500 hover:bg-orange-600 text-white rounded-xl gap-2"
            >
              <Sparkles className="h-4 w-4" />
              ใช่ สร้างใหม่
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Small helper sub-components ──────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2.5">{children}</p>
  );
}

function EmptyStepState({
  emoji, title, description, actionLabel, actionHref, children,
}: {
  emoji: string;
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="text-center py-10 px-4">
      <div className="w-20 h-20 bg-gray-50 rounded-2xl flex items-center justify-center mx-auto mb-4 text-4xl">
        {emoji}
      </div>
      <p className="text-xl font-semibold text-gray-700">{title}</p>
      <p className="text-sm text-gray-400 mt-2 mb-6 max-w-sm mx-auto leading-relaxed">{description}</p>
      {actionHref && actionLabel && (
        <Link href={actionHref} className="inline-flex items-center gap-2 text-sm text-green-600 hover:text-green-700 font-medium underline underline-offset-2">
          {actionLabel}
          <ChevronRight className="h-4 w-4" />
        </Link>
      )}
      {children && <div className="flex justify-center mt-2">{children}</div>}
    </div>
  );
}

function AIActionButton({
  label, loading, onClick, color = "bg-[#1A1A1A] hover:bg-[#2D2D2D]",
}: {
  label: string;
  loading: boolean;
  onClick: () => void;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`flex items-center gap-2.5 px-7 py-3.5 rounded-xl text-white font-semibold text-base transition-all shadow-sm disabled:opacity-60 disabled:cursor-not-allowed ${color}`}
    >
      {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
      {loading ? "กำลังดำเนินการ..." : label}
    </button>
  );
}

function StepNav({
  prevLabel, nextLabel, onPrev, onNext,
}: {
  prevLabel?: string;
  nextLabel?: string;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  return (
    <div className="flex items-center justify-between pt-4 border-t border-gray-100 mt-2">
      {onPrev ? (
        <button onClick={onPrev} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 font-medium transition-colors">
          <ArrowLeft className="h-4 w-4" />
          {prevLabel}
        </button>
      ) : <div />}
      {onNext ? (
        <button onClick={onNext} className="flex items-center gap-1.5 text-sm text-green-600 hover:text-green-700 font-semibold transition-colors">
          {nextLabel}
          <ChevronRight className="h-4 w-4" />
        </button>
      ) : <div />}
    </div>
  );
}

type BannerAction =
  | { type: "ai"; key: string; endpoint: string; label: string; color: string }
  | { type: "patch"; newStatus: string; successMsg: string; label: string; color: string }
  | { type: "nav"; step: number; label: string; color: string }
  | null;

function resolveBannerAction(status: string): {
  bannerStyle: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  action: BannerAction;
} | null {
  switch (status) {
    case "NEW":
      return {
        bannerStyle: "bg-blue-50 border-blue-200",
        icon: <Search className="h-5 w-5 text-blue-600" />,
        title: "เพิ่มคีย์เวิร์ดก่อนเริ่มต้น",
        subtitle: "เลือก keyword จากโปรเจกต์ แล้วสร้าง Outline",
        action: { type: "nav", step: 2, label: "ไปหน้าคีย์เวิร์ด →", color: "bg-[#1A1A1A] hover:bg-[#2D2D2D]" },
      };
    case "KEYWORD_DONE":
    case "CONTENT_MAP_DONE":
      return {
        bannerStyle: "bg-purple-50 border-purple-200",
        icon: <LayoutList className="h-5 w-5 text-purple-600" />,
        title: "พร้อมสร้างโครงร่างแล้ว",
        subtitle: "คีย์เวิร์ดพร้อมแล้ว กด Generate เพื่อให้ AI สร้าง Outline",
        action: { type: "ai", key: "outline", endpoint: "/api/ai/outline", label: "🤖 สร้างโครงร่าง (AI)", color: "bg-[#1A1A1A] hover:bg-[#2D2D2D]" },
      };
    case "OUTLINE_DONE":
      return {
        bannerStyle: "bg-amber-50 border-amber-200",
        icon: <CheckSquare className="h-5 w-5 text-amber-600" />,
        title: "ตรวจ Outline แล้วอนุมัติ",
        subtitle: "ตรวจสอบโครงสร้างบทความ แล้วกดอนุมัติเพื่อเริ่มเขียนบทความ",
        action: { type: "patch", newStatus: "OUTLINE_APPROVED", successMsg: "โครงร่างได้รับการอนุมัติแล้ว! ✅", label: "✅ อนุมัติ Outline", color: "bg-amber-500 hover:bg-amber-600" },
      };
    case "OUTLINE_APPROVED":
      return {
        bannerStyle: "bg-green-50 border-green-200",
        icon: <PenLine className="h-5 w-5 text-green-600" />,
        title: "พร้อมเขียนบทความแล้ว",
        subtitle: "Outline อนุมัติแล้ว กด Generate เพื่อให้ AI เขียนบทความเต็มรูปแบบ",
        action: { type: "ai", key: "article", endpoint: "/api/ai/article", label: "✍️ เขียนบทความ (AI)", color: "bg-[#1A1A1A] hover:bg-[#2D2D2D]" },
      };
    case "ARTICLE_DONE":
    case "IMAGE_PROMPT_DONE":
      return {
        bannerStyle: "bg-teal-50 border-teal-200",
        icon: <Search className="h-5 w-5 text-teal-600" />,
        title: "ตรวจสอบ SEO ก่อนส่งรีวิว",
        subtitle: "บทความพร้อมแล้ว กด SEO Check เพื่อวิเคราะห์คุณภาพและสร้าง Meta tags",
        action: { type: "ai", key: "seo-check", endpoint: "/api/ai/seo-check", label: "🔍 ตรวจ SEO อัตโนมัติ", color: "bg-[#1A1A1A] hover:bg-[#2D2D2D]" },
      };
    case "SEO_REVIEW":
      return {
        bannerStyle: "bg-emerald-50 border-emerald-200",
        icon: <CheckCircle className="h-5 w-5 text-emerald-600" />,
        title: "ผ่าน SEO แล้ว — รออนุมัติ",
        subtitle: "ตรวจผลคะแนน SEO แล้วกดอนุมัติบทความเพื่อดำเนินการต่อ",
        action: { type: "patch", newStatus: "APPROVED", successMsg: "บทความได้รับการอนุมัติแล้ว! 🎉", label: "✅ อนุมัติบทความ", color: "bg-[#1A1A1A] hover:bg-[#2D2D2D]" },
      };
    case "REVISION_REQUIRED":
      return {
        bannerStyle: "bg-red-50 border-red-200",
        icon: <AlertTriangle className="h-5 w-5 text-red-600" />,
        title: "ต้องแก้ไขบทความ",
        subtitle: "มีข้อเสนอแนะจาก SEO review กรุณาแก้ไขแล้วรัน SEO Check ใหม่",
        action: { type: "ai", key: "seo-check", endpoint: "/api/ai/seo-check", label: "🔍 ตรวจ SEO อีกครั้ง", color: "bg-red-600 hover:bg-red-700" },
      };
    case "APPROVED":
      return {
        bannerStyle: "bg-indigo-50 border-indigo-200",
        icon: <Globe className="h-5 w-5 text-indigo-600" />,
        title: "อนุมัติแล้ว — พร้อมส่ง WordPress",
        subtitle: "บทความผ่านการอนุมัติแล้ว กดส่งเพื่อสร้าง Draft บน WordPress",
        action: { type: "ai", key: "wordpress", endpoint: "/api/wordpress/draft", label: "🌐 ส่ง WordPress Draft", color: "bg-[#1A1A1A] hover:bg-[#2D2D2D]" },
      };
    case "WORDPRESS_DRAFTED":
      return {
        bannerStyle: "bg-green-50 border-green-200",
        icon: <CheckCircle className="h-5 w-5 text-green-600" />,
        title: "Draft บน WordPress แล้ว",
        subtitle: "ไปที่ WordPress เพื่อตรวจสอบและ Publish บทความ",
        action: null,
      };
    case "POSTED":
      return {
        bannerStyle: "bg-green-50 border-green-200",
        icon: <Star className="h-5 w-5 text-green-600" />,
        title: "🎉 เผยแพร่เรียบร้อยแล้ว!",
        subtitle: "บทความนี้มีผลบนเว็บไซต์แล้ว",
        action: null,
      };
    default:
      return null;
  }
}

function CurrentActionBanner({
  status,
  loadingAction,
  onRunAI,
  onPatchStatus,
  onGoToStep,
}: {
  status: string;
  loadingAction: string | null;
  onRunAI: (key: string, endpoint: string) => void;
  onPatchStatus: (newStatus: string, successMsg: string) => void;
  onGoToStep: (step: number) => void;
}) {
  const config = resolveBannerAction(status);
  if (!config) return null;

  const { bannerStyle, icon, title, subtitle, action } = config;

  const isLoading = action?.type === "ai"
    ? loadingAction === action.key
    : action?.type === "patch"
    ? loadingAction === `patch-${action.newStatus}`
    : false;

  function handleClick() {
    if (!action) return;
    if (action.type === "ai") onRunAI(action.key, action.endpoint);
    else if (action.type === "patch") onPatchStatus(action.newStatus, action.successMsg);
    else if (action.type === "nav") onGoToStep(action.step);
  }

  return (
    <div className={`rounded-2xl border-2 p-5 flex items-center gap-4 flex-wrap ${bannerStyle}`}>
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="w-10 h-10 rounded-xl bg-white/70 flex items-center justify-center shadow-sm flex-shrink-0">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="font-bold text-gray-900 text-base leading-tight">{title}</p>
          <p className="text-sm text-gray-500 mt-0.5 leading-snug">{subtitle}</p>
        </div>
      </div>
      {action && (
        <button
          onClick={handleClick}
          disabled={!!loadingAction}
          className={`flex items-center gap-2.5 px-6 py-3 rounded-xl text-white font-semibold text-sm transition-all shadow-sm disabled:opacity-60 disabled:cursor-not-allowed flex-shrink-0 ${action.color}`}
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {isLoading ? "กำลังดำเนินการ..." : action.label}
        </button>
      )}
    </div>
  );
}
