"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, XCircle, AlertTriangle, Loader2, ThumbsUp, ThumbsDown, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils";

// ─── Checklist definitions ────────────────────────────────────────────────────

const SEO_CHECKLIST = [
  { id: "title_tag",      label: "Title tag มี keyword หลัก และยาว 50–60 ตัวอักษร" },
  { id: "meta_desc",      label: "Meta description ดึงดูด มี keyword และยาว 120–160 ตัวอักษร" },
  { id: "h1_one",         label: "มี H1 เดียว และมี keyword หลักอยู่ใน H1" },
  { id: "h2_structure",   label: "H2/H3 ครอบคลุม subtopic สำคัญ เป็น logical structure" },
  { id: "keyword_density",label: "Keyword ปรากฏใน 100 คำแรก และกระจายทั่วบทความ" },
  { id: "word_count",     label: "Word count เพียงพอ (800+ คำสำหรับ TOFU, 1200+ สำหรับ MOFU/BOFU)" },
  { id: "internal_links", label: "มี internal links อย่างน้อย 2 ลิ้งค์" },
  { id: "external_links", label: "มี external links ไปยังแหล่งอ้างอิงที่น่าเชื่อถือ" },
  { id: "image_alt",      label: "รูปภาพทุกรูปมี alt text ที่มี keyword" },
  { id: "cta",            label: "มี CTA ที่ชัดเจนท้ายบทความ" },
  { id: "url_slug",       label: "Slug สั้น ชัดเจน มี keyword หลัก ไม่มี stop words" },
];

const EEAT_CHECKLIST = [
  { id: "experience",     label: "Experience: บทความแสดงประสบการณ์จริง (case study, ตัวอย่างจริง)" },
  { id: "expertise",      label: "Expertise: เนื้อหาแสดงความเชี่ยวชาญ ลึก ถูกต้อง ครอบคลุม" },
  { id: "authority",      label: "Authoritativeness: อ้างอิงแหล่งข้อมูลที่มีชื่อเสียง ข้อมูล up-to-date" },
  { id: "trust",          label: "Trustworthiness: โปร่งใส ไม่เกินจริง มีข้อมูล fact-checked" },
];

const READABILITY_CHECKLIST = [
  { id: "short_para",     label: "ย่อหน้าสั้น (3–5 ประโยค) อ่านง่ายบน mobile" },
  { id: "bullet_points",  label: "ใช้ bullet/numbered list เพื่อให้ scan ได้" },
  { id: "no_jargon",      label: "ภาษาเข้าใจง่าย ไม่ใช้ศัพท์เฉพาะโดยไม่อธิบาย" },
  { id: "intro_hook",     label: "Intro ดึงดูด ตอบคำถาม 'Why should I read this?'" },
  { id: "conclusion",     label: "บทสรุป/Conclusion ชัดเจน สรุป key takeaways" },
];

type ReviewRow = {
  id: string;
  seoScore?: number | null;
  aeoScore?: number | null;
  conversionScore?: number | null;
  riskLevel?: string | null;
  notes?: string | null;
  createdAt: Date;
  reviewer: { name: string | null };
};

interface Props {
  articleId: string;
  articleStatus: string;
  reviews: ReviewRow[];
}

function ScoreInput({ label, value, onChange, color }: { label: string; value: number; onChange: (v: number) => void; color: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-gray-600">{label}</label>
        <span className={cn("text-sm font-bold", color)}>{value}</span>
      </div>
      <input
        type="range" min={0} max={100} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full accent-green-500"
      />
      <div className="flex justify-between text-[10px] text-gray-400">
        <span>0</span><span>50</span><span>100</span>
      </div>
    </div>
  );
}

export function ReviewChecklist({ articleId, articleStatus, reviews }: Props) {
  const router = useRouter();
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [seoScore, setSeoScore]   = useState(75);
  const [aeoScore, setAeoScore]   = useState(70);
  const [convScore, setConvScore] = useState(65);
  const [riskLevel, setRiskLevel] = useState<"LOW" | "MEDIUM" | "HIGH">("LOW");
  const [notes, setNotes]         = useState("");
  const [submitting, setSubmitting] = useState(false);

  const canReview = ["SEO_REVIEW", "ARTICLE_DONE", "OUTLINE_APPROVED"].includes(articleStatus);

  const totalChecks = SEO_CHECKLIST.length + EEAT_CHECKLIST.length + READABILITY_CHECKLIST.length;
  const checkedCount = Object.values(checks).filter(Boolean).length;
  const progress = Math.round((checkedCount / totalChecks) * 100);

  function toggleCheck(id: string) {
    setChecks((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function submit(action: "approve" | "revision") {
    setSubmitting(true);
    try {
      // Create review record
      const reviewRes = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          articleId,
          seoScore,
          aeoScore,
          conversionScore: convScore,
          riskLevel,
          status: action === "approve" ? "APPROVED" : "REVISION_REQUIRED",
          notes: JSON.stringify({
            checklist: checks,
            feedback: notes,
            checklistScore: `${checkedCount}/${totalChecks}`,
          }),
        }),
      });
      if (!reviewRes.ok) throw new Error();

      // Update article status
      const newStatus = action === "approve" ? "APPROVED" : "REVISION_REQUIRED";
      await fetch(`/api/articles/${articleId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      toast.success(action === "approve" ? "✅ อนุมัติบทความแล้ว!" : "✏️ ส่ง Revision Request แล้ว");
      router.refresh();
    } catch {
      toast.error("บันทึกไม่สำเร็จ");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Past Reviews */}
      {reviews.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-gray-700">ประวัติ Review</h4>
          {reviews.map((review) => {
            let parsed: { feedback?: string; checklistScore?: string } = {};
            try { if (review.notes) parsed = JSON.parse(review.notes); } catch {}
            return (
              <div key={review.id} className="border border-gray-100 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-teal-100 flex items-center justify-center text-xs font-bold text-teal-700">
                      {review.reviewer.name?.[0] ?? "?"}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{review.reviewer.name}</p>
                      <p className="text-xs text-gray-400">{formatDate(review.createdAt)}</p>
                    </div>
                  </div>
                  <span className={cn("text-xs font-bold px-2 py-1 rounded-full",
                    review.riskLevel === "HIGH" ? "bg-rose-100 text-rose-700" :
                    review.riskLevel === "MEDIUM" ? "bg-amber-100 text-amber-700" :
                    "bg-green-100 text-green-700"
                  )}>
                    Risk: {review.riskLevel ?? "LOW"}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { l: "SEO",        v: review.seoScore,        c: "blue" },
                    { l: "E-E-A-T",    v: review.aeoScore,        c: "purple" },
                    { l: "Conversion", v: review.conversionScore, c: "green" },
                  ].map((s) => (
                    <div key={s.l} className={`p-2 rounded-lg bg-${s.c}-50 text-center`}>
                      <p className="text-xs text-gray-500">{s.l}</p>
                      <p className={`text-xl font-bold text-${s.c}-600`}>{s.v ?? "—"}</p>
                    </div>
                  ))}
                </div>
                {parsed.checklistScore && (
                  <p className="text-xs text-gray-500">Checklist: {parsed.checklistScore}</p>
                )}
                {parsed.feedback && (
                  <div className="p-3 bg-gray-50 rounded-lg text-sm text-gray-700 whitespace-pre-wrap">{parsed.feedback}</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* New Review Form */}
      {canReview && (
        <div className="border border-gray-100 rounded-xl overflow-hidden">
          <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-gray-800">ตรวจสอบบทความ</h4>
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-24 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", progress === 100 ? "bg-green-500" : progress > 60 ? "bg-amber-400" : "bg-rose-400")}
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-xs font-semibold text-gray-500">{checkedCount}/{totalChecks}</span>
            </div>
          </div>

          <div className="p-5 space-y-6">
            {/* SEO Checklist */}
            <ChecklistSection title="🔍 SEO Checklist" items={SEO_CHECKLIST} checks={checks} onToggle={toggleCheck} />
            {/* E-E-A-T */}
            <ChecklistSection title="⭐ E-E-A-T Checklist" items={EEAT_CHECKLIST} checks={checks} onToggle={toggleCheck} />
            {/* Readability */}
            <ChecklistSection title="📖 Readability Checklist" items={READABILITY_CHECKLIST} checks={checks} onToggle={toggleCheck} />

            {/* Scores */}
            <div className="space-y-4 pt-2 border-t border-gray-100">
              <h5 className="text-xs font-bold text-gray-500 uppercase tracking-wide">ให้คะแนน</h5>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                <ScoreInput label="SEO Score"       value={seoScore}  onChange={setSeoScore}  color="text-blue-600" />
                <ScoreInput label="E-E-A-T Score"   value={aeoScore}  onChange={setAeoScore}  color="text-purple-600" />
                <ScoreInput label="Conversion Score" value={convScore} onChange={setConvScore} color="text-green-600" />
              </div>
            </div>

            {/* Risk Level */}
            <div className="space-y-2">
              <h5 className="text-xs font-bold text-gray-500 uppercase tracking-wide">ระดับความเสี่ยง</h5>
              <div className="flex gap-2">
                {(["LOW","MEDIUM","HIGH"] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setRiskLevel(r)}
                    className={cn("flex-1 py-2 rounded-xl text-xs font-bold border transition-all",
                      riskLevel === r
                        ? r === "LOW" ? "bg-green-100 border-green-300 text-green-700"
                          : r === "MEDIUM" ? "bg-amber-100 border-amber-300 text-amber-700"
                          : "bg-rose-100 border-rose-300 text-rose-700"
                        : "bg-gray-50 border-gray-100 text-gray-400 hover:border-gray-300"
                    )}
                  >
                    {r === "LOW" ? "✅ Low" : r === "MEDIUM" ? "⚠️ Medium" : "🚨 High"}
                  </button>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <h5 className="text-xs font-bold text-gray-500 uppercase tracking-wide">หมายเหตุ / Feedback</h5>
              <textarea
                rows={4}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="ระบุสิ่งที่ต้องแก้ไข หรือคำแนะนำเพิ่มเติม..."
                className="w-full text-sm border border-gray-100 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-green-400/30 focus:border-green-400 resize-none placeholder:text-gray-400"
              />
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={() => submit("approve")}
                disabled={submitting}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white text-sm font-semibold transition-colors disabled:opacity-50 shadow-sm"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ThumbsUp className="h-4 w-4" />}
                อนุมัติบทความ
              </button>
              <button
                onClick={() => submit("revision")}
                disabled={submitting}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white text-sm font-semibold transition-colors disabled:opacity-50"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ThumbsDown className="h-4 w-4" />}
                ขอ Revision
              </button>
            </div>
          </div>
        </div>
      )}

      {!canReview && reviews.length === 0 && (
        <div className="py-10 text-center text-sm text-gray-400">
          บทความยังไม่พร้อมสำหรับ Review (ต้องมีสถานะ SEO_REVIEW หรือ ARTICLE_DONE)
        </div>
      )}
    </div>
  );
}

function ChecklistSection({
  title, items, checks, onToggle,
}: {
  title: string;
  items: { id: string; label: string }[];
  checks: Record<string, boolean>;
  onToggle: (id: string) => void;
}) {
  const checked = items.filter((i) => checks[i.id]).length;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h5 className="text-xs font-bold text-gray-700">{title}</h5>
        <span className="text-xs text-gray-400">{checked}/{items.length}</span>
      </div>
      <div className="space-y-1.5">
        {items.map((item) => {
          const ok = !!checks[item.id];
          return (
            <label key={item.id} className="flex items-start gap-3 cursor-pointer group">
              <div
                className={cn(
                  "w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all",
                  ok ? "bg-green-500 border-green-500" : "border-gray-300 group-hover:border-green-400"
                )}
                onClick={() => onToggle(item.id)}
              >
                {ok && <CheckCircle2 className="h-3 w-3 text-white" />}
              </div>
              <span className={cn("text-sm leading-5 transition-colors", ok ? "text-gray-500 line-through" : "text-gray-700")}>
                {item.label}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
