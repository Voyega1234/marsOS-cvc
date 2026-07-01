"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Upload, Zap, Plus, X, ChevronDown, Loader2, CheckCircle2, AlertCircle, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils";

interface Project { id: string; name: string; automationMode: string; language: string }
interface BatchJob {
  id: string; name: string; status: string;
  totalItems: number; completedItems: number; failedItems: number;
  createdAt: Date;
}

interface Props {
  projects: Project[];
  recentJobs: BatchJob[];
}

const FUNNEL_OPTIONS = [
  { value: "TOFU", label: "TOFU — ดึง traffic กว้าง" },
  { value: "MOFU", label: "MOFU — nurture ลูกค้าสนใจ" },
  { value: "BOFU", label: "BOFU — ปิดการขาย" },
];
const INTENT_OPTIONS = [
  { value: "INFORMATIONAL", label: "Informational" },
  { value: "COMMERCIAL",    label: "Commercial" },
  { value: "TRANSACTIONAL", label: "Transactional" },
];

const STATUS_STYLE: Record<string, string> = {
  DONE:    "bg-green-100 text-green-700",
  RUNNING: "bg-blue-100 text-blue-700",
  FAILED:  "bg-red-100 text-red-700",
  PENDING: "bg-gray-100 text-gray-600",
};

export function BatchCreateClient({ projects, recentJobs }: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [projectId, setProjectId]   = useState(projects[0]?.id ?? "");
  const [keywords, setKeywords]     = useState<string[]>([]);
  const [rawText, setRawText]       = useState("");
  const [funnel, setFunnel]         = useState("TOFU");
  const [intent, setIntent]         = useState("INFORMATIONAL");
  const [mode, setMode]             = useState("FULL_AUTO");
  const [competitors, setCompetitors] = useState("");
  const [loading, setLoading]       = useState(false);
  const [result, setResult]         = useState<{ created: number; failed: number; batchJobId: string } | null>(null);

  function parseKeywords(text: string): string[] {
    return text.split(/[\n,]+/).map((k) => k.trim()).filter(Boolean);
  }

  function handleTextChange(v: string) {
    setRawText(v);
    setKeywords(parseKeywords(v));
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setRawText(text);
      setKeywords(parseKeywords(text));
      toast.success(`โหลดไฟล์สำเร็จ พบ ${parseKeywords(text).length} keywords`);
    };
    reader.readAsText(file);
  }

  async function handleSubmit() {
    if (!keywords.length) { toast.error("ใส่ keyword อย่างน้อย 1 คำ"); return; }
    if (!projectId)        { toast.error("เลือก project ก่อน"); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          keywords,
          funnelStage: funnel,
          searchIntent: intent,
          automationMode: mode,
          competitorUrls: competitors.split("\n").map((u) => u.trim()).filter(Boolean),
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "เกิดข้อผิดพลาด"); return; }
      setResult(data);
      toast.success(`สร้าง ${data.created} บทความแล้ว — AI กำลัง run`);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Batch Content Creation</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          วาง keyword list → ระบบสร้างบทความพร้อม Auto Run ทั้งหมดในครั้งเดียว
        </p>
      </div>

      {/* Result banner */}
      {result && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-5 py-4 flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-green-800">เริ่ม Batch Job แล้ว!</p>
            <p className="text-xs text-green-600">สร้าง {result.created} บทความ · AI กำลังทำงานใน background</p>
          </div>
          <button onClick={() => router.push("/articles")} className="ml-auto text-xs font-semibold text-green-700 underline">
            ดูบทความทั้งหมด →
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Left: keyword input */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">

            {/* Keyword input */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                  Keywords
                  {keywords.length > 0 && <span className="ml-2 font-bold text-blue-600">{keywords.length} คำ</span>}
                </label>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded-lg px-2.5 py-1 hover:bg-gray-50 transition-colors"
                >
                  <Upload className="h-3 w-3" /> Upload CSV / TXT
                </button>
                <input ref={fileRef} type="file" accept=".txt,.csv" className="hidden" onChange={handleFile} />
              </div>
              <textarea
                rows={10}
                value={rawText}
                onChange={(e) => handleTextChange(e.target.value)}
                placeholder={"วาง keyword list ทีละบรรทัด หรือคั่นด้วย comma เช่น:\nวีซ่าเชงเก้น\nขอวีซ่าออสเตรเลีย\nNAATI translator bangkok"}
                className="w-full rounded-xl border border-gray-200 px-3 py-3 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 resize-none font-mono leading-relaxed"
              />
              <p className="text-[11px] text-gray-400 mt-1">รองรับ 1 keyword ต่อบรรทัด หรือ CSV (comma-separated)</p>
            </div>

            {/* Preview pills */}
            {keywords.length > 0 && (
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                {keywords.slice(0, 30).map((kw, i) => (
                  <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-full border border-blue-100">
                    {kw}
                    <button onClick={() => { const k = [...keywords]; k.splice(i, 1); setKeywords(k); setRawText(k.join("\n")); }} className="hover:text-blue-900">
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))}
                {keywords.length > 30 && <span className="text-xs text-gray-400 self-center">+{keywords.length - 30} more</span>}
              </div>
            )}

            {/* Competitor URLs */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
                Competitor URLs
                <span className="font-normal text-gray-400 ml-1">(optional — AI จะอ่านก่อนเขียนทุกบทความ)</span>
              </label>
              <textarea
                rows={3}
                value={competitors}
                onChange={(e) => setCompetitors(e.target.value)}
                placeholder={"https://competitor1.com/page\nhttps://competitor2.com/page"}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none font-mono text-xs"
              />
            </div>
          </div>
        </div>

        {/* Right: config */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">

            {/* Project */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">Project</label>
              <div className="relative">
                <select value={projectId} onChange={(e) => setProjectId(e.target.value)}
                  className="w-full appearance-none border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-white">
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
              </div>
            </div>

            {/* Funnel */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">Funnel Stage</label>
              <div className="relative">
                <select value={funnel} onChange={(e) => setFunnel(e.target.value)}
                  className="w-full appearance-none border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-white">
                  {FUNNEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
              </div>
            </div>

            {/* Intent */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">Search Intent</label>
              <div className="relative">
                <select value={intent} onChange={(e) => setIntent(e.target.value)}
                  className="w-full appearance-none border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-white">
                  {INTENT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
              </div>
            </div>

            {/* Mode */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">Automation</label>
              {[
                { v: "FULL_AUTO", l: "Full Auto", d: "AI เขียนจนจบ" },
                { v: "SEMI_AUTO", l: "Semi Auto", d: "หยุดรอ Approve" },
                { v: "MANUAL",    l: "สร้างเปล่า", d: "กดเองทีละขั้น" },
              ].map((m) => (
                <label key={m.v} className={cn("flex items-start gap-2.5 p-2.5 rounded-lg cursor-pointer mb-1.5 border transition-colors", mode === m.v ? "border-blue-300 bg-blue-50" : "border-gray-100 hover:bg-gray-50")}>
                  <input type="radio" name="mode" value={m.v} checked={mode === m.v} onChange={() => setMode(m.v)} className="mt-0.5 accent-blue-600" />
                  <div>
                    <p className="text-xs font-semibold text-gray-800">{m.l}</p>
                    <p className="text-[11px] text-gray-400">{m.d}</p>
                  </div>
                </label>
              ))}
            </div>

            {/* Cost estimate */}
            {keywords.length > 0 && (
              <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5 text-xs text-amber-700">
                <p className="font-semibold">ประมาณการ (จริง)</p>
                <p>~${(keywords.length * 0.06).toFixed(2)} เมื่อต่อ AI จริง</p>
                <p className="text-amber-500 mt-0.5">ตอนนี้ Demo Mode — ฟรี</p>
              </div>
            )}

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={loading || !keywords.length}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-gray-900 hover:bg-gray-700 disabled:opacity-40 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              {loading ? "กำลังสร้าง..." : `สร้าง ${keywords.length} บทความ`}
            </button>
          </div>
        </div>
      </div>

      {/* Recent batch jobs */}
      {recentJobs.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm font-semibold text-gray-900 mb-3">Batch Jobs ล่าสุด</p>
          <div className="space-y-2">
            {recentJobs.map((job) => (
              <div key={job.id} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                <FileText className="h-4 w-4 text-gray-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{job.name}</p>
                  <p className="text-xs text-gray-400">{formatDate(job.createdAt)}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_STYLE[job.status] ?? "bg-gray-100 text-gray-500"}`}>
                    {job.status}
                  </span>
                  <span className="text-xs text-gray-500">{job.completedItems}/{job.totalItems}</span>
                  {job.failedItems > 0 && (
                    <AlertCircle className="h-3.5 w-3.5 text-red-400" />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
