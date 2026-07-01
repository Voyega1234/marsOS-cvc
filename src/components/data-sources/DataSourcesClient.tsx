"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils";
import {
  Link2, Upload, CheckCircle2, AlertCircle, Clock, Plus, X,
  FileText, Trash2, Loader2, Globe, BarChart2, Brain, Cpu,
} from "lucide-react";

interface DataSource {
  id: string; type: string; name: string; status: string;
  lastSyncAt: Date | null; syncError: string | null; projectId: string | null; config: string;
}
interface DataBrainFile {
  id: string; name: string; originalName: string; mimeType: string;
  sizeBytes: number; summary: string | null; tags: string; projectId: string | null; createdAt: Date;
}
interface Props {
  dataSources: DataSource[];
  dataBrainFiles: DataBrainFile[];
  projects: { id: string; name: string }[];
}

const SOURCE_DEFS = [
  {
    type: "GSC", label: "Google Search Console", icon: Globe,
    color: "bg-blue-50 border-blue-200", iconColor: "text-blue-600",
    desc: "Position, clicks, impressions ต่อ keyword — ใช้สำหรับ Rank Tracking และ Refresh Score",
    fields: [
      { key: "siteUrl",       label: "Site URL",            placeholder: "https://example.com" },
      { key: "accessToken",   label: "OAuth Access Token",  placeholder: "เชื่อมผ่าน Google OAuth →", type: "password" },
    ],
    connectUrl: "https://search.google.com/search-console",
  },
  {
    type: "GA4", label: "Google Analytics 4", icon: BarChart2,
    color: "bg-orange-50 border-orange-200", iconColor: "text-orange-600",
    desc: "Sessions, conversions, bounce rate — ใช้สำหรับ Client Report และ content performance",
    fields: [
      { key: "propertyId",    label: "GA4 Property ID",     placeholder: "123456789" },
      { key: "accessToken",   label: "OAuth Access Token",  placeholder: "เชื่อมผ่าน Google OAuth →", type: "password" },
    ],
    connectUrl: "https://analytics.google.com",
  },
  {
    type: "AHREFS", label: "Ahrefs", icon: Link2,
    color: "bg-violet-50 border-violet-200", iconColor: "text-violet-600",
    desc: "DR, backlinks, keyword rankings — ใช้สำหรับ Competitor Analysis และ Backlink Tracking",
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "ahrefs_api_key_...", type: "password" },
    ],
    connectUrl: "https://ahrefs.com/api",
  },
  {
    type: "SERPAPI", label: "SerpAPI / DataForSEO", icon: Globe,
    color: "bg-emerald-50 border-emerald-200", iconColor: "text-emerald-600",
    desc: "SERP results สำหรับ Competitor Analysis — AI อ่าน Top 10 ก่อนเขียนบทความ",
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "serpapi_key_...", type: "password" },
    ],
    connectUrl: "https://serpapi.com/manage-api-key",
  },
];

const STATUS_STYLE: Record<string, string> = {
  CONNECTED:    "bg-green-100 text-green-700",
  PENDING:      "bg-gray-100 text-gray-500",
  ERROR:        "bg-red-100 text-red-700",
  DISCONNECTED: "bg-gray-100 text-gray-400",
};

export function DataSourcesClient({ dataSources, dataBrainFiles, projects }: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<"analytics" | "databrain" | "ai">("analytics");
  const [connecting, setConnecting] = useState<string | null>(null);
  const [formData, setFormData] = useState<Record<string, Record<string, string>>>({});
  const [uploading, setUploading] = useState(false);
  const [uploadProjectId, setUploadProjectId] = useState("");

  function updateField(type: string, key: string, val: string) {
    setFormData((p) => ({ ...p, [type]: { ...(p[type] ?? {}), [key]: val } }));
  }

  async function connect(type: string) {
    const fields = formData[type] ?? {};
    setConnecting(type);
    try {
      const existing = dataSources.find((s) => s.type === type);
      const res = await fetch("/api/data-sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: existing?.id, type, name: SOURCE_DEFS.find((s) => s.type === type)?.label ?? type, credentialJson: fields }),
      });
      if (!res.ok) throw new Error();
      toast.success(`${type} เชื่อมต่อแล้ว (รอ sync จริงเมื่อใส่ credentials ถูกต้อง)`);
      router.refresh();
    } catch { toast.error("เกิดข้อผิดพลาด"); }
    finally { setConnecting(null); }
  }

  async function uploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("name", file.name);
      if (uploadProjectId) fd.append("projectId", uploadProjectId);
      const res = await fetch("/api/data-brain", { method: "POST", body: fd });
      if (!res.ok) throw new Error();
      toast.success(`อัปโหลด "${file.name}" สำเร็จ`);
      router.refresh();
    } catch { toast.error("Upload ล้มเหลว"); }
    finally { setUploading(false); e.target.value = ""; }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Data Sources</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          เชื่อมต่อ AI, Analytics tools และ Data Brain files — ข้อมูลเหล่านี้จะถูก inject เข้า AI prompt ทุกครั้งที่สร้างบทความ
        </p>
      </div>

      {/* Data flow diagram */}
      <div className="bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-100 rounded-xl px-5 py-4">
        <p className="text-xs font-semibold text-blue-800 mb-2">วิธีที่ Data ไหลเข้า AI</p>
        <div className="flex items-center gap-2 text-xs text-gray-600 flex-wrap">
          {[
            { icon: Globe,    label: "GSC / GA4", color: "bg-blue-100 text-blue-700" },
            { icon: Link2,    label: "Ahrefs",    color: "bg-violet-100 text-violet-700" },
            { icon: Brain,    label: "Data Brain Files", color: "bg-amber-100 text-amber-700" },
          ].map((s) => (
            <span key={s.label} className={`flex items-center gap-1 px-2.5 py-1 rounded-full font-medium ${s.color}`}>
              <s.icon className="h-3 w-3" />{s.label}
            </span>
          ))}
          <span className="text-gray-400">→</span>
          <span className="flex items-center gap-1 px-2.5 py-1 rounded-full font-medium bg-gray-900 text-white">
            <Cpu className="h-3 w-3" /> AI Prompt Context
          </span>
          <span className="text-gray-400">→</span>
          <span className="flex items-center gap-1 px-2.5 py-1 rounded-full font-medium bg-green-100 text-green-700">
            <FileText className="h-3 w-3" /> บทความที่ดีกว่าคู่แข่ง
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {[
          { key: "analytics", label: "Analytics & SEO Tools", count: dataSources.length },
          { key: "databrain", label: "Data Brain Files",      count: dataBrainFiles.length },
          { key: "ai",        label: "AI Configuration",      count: null },
        ].map((t) => (
          <button key={t.key} onClick={() => setActiveTab(t.key as typeof activeTab)}
            className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
              activeTab === t.key ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700")}>
            {t.label}
            {t.count !== null && <span className="text-xs bg-gray-200 text-gray-600 rounded-full px-1.5">{t.count}</span>}
          </button>
        ))}
      </div>

      {/* Analytics Tab */}
      {activeTab === "analytics" && (
        <div className="space-y-4">
          {SOURCE_DEFS.map((def) => {
            const existing = dataSources.find((s) => s.type === def.type);
            return (
              <div key={def.type} className={cn("rounded-xl border p-5", def.color)}>
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex items-center gap-3">
                    <def.icon className={cn("h-5 w-5", def.iconColor)} />
                    <div>
                      <p className="font-semibold text-gray-900">{def.label}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{def.desc}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {existing && (
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLE[existing.status] ?? "bg-gray-100 text-gray-500"}`}>
                        {existing.status}
                      </span>
                    )}
                    <a href={def.connectUrl} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-blue-600 hover:underline">เปิด Console →</a>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {def.fields.map((f) => (
                    <div key={f.key}>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">{f.label}</label>
                      <input
                        type={(f as { type?: string }).type === "password" ? "password" : "text"}
                        placeholder={f.placeholder}
                        value={formData[def.type]?.[f.key] ?? ""}
                        onChange={(e) => updateField(def.type, f.key, e.target.value)}
                        className="w-full border border-white/80 bg-white/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/30"
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    onClick={() => connect(def.type)}
                    disabled={connecting === def.type}
                    className="flex items-center gap-1.5 px-4 py-2 bg-gray-900 hover:bg-gray-700 text-white text-xs font-semibold rounded-lg disabled:opacity-50 transition-colors"
                  >
                    {connecting === def.type ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                    {existing ? "Update Connection" : "Connect"}
                  </button>
                  {existing?.lastSyncAt && (
                    <span className="text-xs text-gray-400">sync ล่าสุด: {formatDate(existing.lastSyncAt)}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Data Brain Tab */}
      {activeTab === "databrain" && (
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p className="text-sm font-semibold text-amber-800 mb-1">Data Brain คืออะไร?</p>
            <p className="text-xs text-amber-700">อัปโหลดไฟล์ที่มีอยู่แล้ว เช่น Brand Guidelines, Competitor Reports, Industry Research, ข้อมูลลูกค้า — Mars จะดึง context จากไฟล์เหล่านี้ inject เข้า AI prompt ทุกครั้งที่เขียนบทความ</p>
          </div>

          {/* Upload area */}
          <div className="bg-white border-2 border-dashed border-gray-200 rounded-xl p-6 text-center hover:border-blue-300 transition-colors">
            <Brain className="h-8 w-8 text-gray-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-700 mb-1">อัปโหลดไฟล์ Data Brain</p>
            <p className="text-xs text-gray-400 mb-4">รองรับ TXT, CSV, HTML · PDF/DOCX รองรับเมื่อต่อ extraction service</p>
            <div className="flex items-center justify-center gap-3">
              <select
                value={uploadProjectId}
                onChange={(e) => setUploadProjectId(e.target.value)}
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400/30"
              >
                <option value="">ทุก Project (Global)</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-2 px-4 py-2 bg-gray-900 hover:bg-gray-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {uploading ? "กำลังอัปโหลด..." : "เลือกไฟล์"}
              </button>
              <input ref={fileRef} type="file" accept=".txt,.csv,.html,.pdf,.docx" className="hidden" onChange={uploadFile} />
            </div>
          </div>

          {/* File list */}
          {dataBrainFiles.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase">
                {dataBrainFiles.length} ไฟล์
              </div>
              {dataBrainFiles.map((f) => (
                <div key={f.id} className="flex items-start gap-3 px-4 py-3 border-b border-gray-50 last:border-0 hover:bg-gray-50">
                  <FileText className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800">{f.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {(f.sizeBytes / 1024).toFixed(1)} KB · {f.mimeType} · {formatDate(f.createdAt)}
                    </p>
                    {f.summary && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{f.summary}</p>}
                    {f.projectId && <p className="text-xs text-blue-500 mt-0.5">Project: {projects.find((p) => p.id === f.projectId)?.name ?? f.projectId}</p>}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-400" aria-label="Active" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* AI Config Tab — redirect to AI Connect */}
      {activeTab === "ai" && (
        <div className="space-y-4">
          <a
            href="/ai-connect"
            className="flex items-center justify-between bg-white border border-gray-200 rounded-xl p-5 hover:border-gray-300 hover:shadow-sm transition-all group"
          >
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-gray-900 flex items-center justify-center shrink-0">
                <Cpu className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">ตั้งค่า AI Provider</p>
                <p className="text-xs text-gray-500 mt-0.5">เพิ่ม API key และเลือก provider / model ที่ต้องการใช้</p>
              </div>
            </div>
            <span className="text-xs font-semibold text-blue-600 group-hover:underline shrink-0">เปิด AI Connect →</span>
          </a>

          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-xs text-blue-700">
            <p className="font-semibold mb-1">เมื่อต่อ Data Sources ครบ — AI จะทำงานอย่างนี้:</p>
            <ol className="list-decimal list-inside space-y-1 text-blue-600">
              <li>ดึง Top 10 SERP จาก SerpAPI สำหรับ keyword นั้น</li>
              <li>อ่าน competitor URLs (ถ้ากำหนดใน brief)</li>
              <li>โหลด Data Brain files ที่เกี่ยวข้องกับ project</li>
              <li>ดึง GSC position history ของ keyword</li>
              <li>รวมทุกอย่าง inject เข้า AI prompt → เขียนบทความที่ดีกว่าคู่แข่งในทุกมิติ</li>
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
