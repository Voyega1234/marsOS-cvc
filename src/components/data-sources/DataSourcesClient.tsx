"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils";
import { PageHeader, UnderlineTabs } from "@/components/ds";
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
    color: "bg-white/70 border-white/80", iconColor: "text-brand-blue",
    desc: "Position, clicks, impressions ต่อ keyword — ใช้สำหรับ Rank Tracking และ Refresh Score",
    fields: [
      { key: "siteUrl",       label: "Site URL",            placeholder: "https://example.com" },
      { key: "accessToken",   label: "OAuth Access Token",  placeholder: "เชื่อมผ่าน Google OAuth →", type: "password" },
    ],
    connectUrl: "https://search.google.com/search-console",
  },
  {
    type: "GA4", label: "Google Analytics 4", icon: BarChart2,
    color: "bg-white/70 border-white/80", iconColor: "text-brand-blue",
    desc: "Sessions, conversions, bounce rate — ใช้สำหรับ Client Report และ content performance",
    fields: [
      { key: "propertyId",    label: "GA4 Property ID",     placeholder: "123456789" },
      { key: "accessToken",   label: "OAuth Access Token",  placeholder: "เชื่อมผ่าน Google OAuth →", type: "password" },
    ],
    connectUrl: "https://analytics.google.com",
  },
  {
    type: "AHREFS", label: "Ahrefs", icon: Link2,
    color: "bg-white/70 border-white/80", iconColor: "text-brand-blue",
    desc: "DR, backlinks, keyword rankings — ใช้สำหรับ Competitor Analysis และ Backlink Tracking",
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "ahrefs_api_key_...", type: "password" },
    ],
    connectUrl: "https://ahrefs.com/api",
  },
  {
    type: "SERPAPI", label: "SerpAPI / DataForSEO", icon: Globe,
    color: "bg-white/70 border-white/80", iconColor: "text-brand-blue",
    desc: "SERP results สำหรับ Competitor Analysis — AI อ่าน Top 10 ก่อนเขียนบทความ",
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "serpapi_key_...", type: "password" },
    ],
    connectUrl: "https://serpapi.com/manage-api-key",
  },
];

const STATUS_STYLE: Record<string, string> = {
  CONNECTED:    "chip chip-ok",
  PENDING:      "chip chip-muted",
  ERROR:        "chip chip-bad",
  DISCONNECTED: "chip chip-muted",
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
      <PageHeader
        eyebrow="Data"
        title="Data Sources"
        subtitle="เชื่อมต่อ AI, Analytics tools และ Data Brain files — ข้อมูลเหล่านี้จะถูก inject เข้า AI prompt ทุกครั้งที่สร้างบทความ"
      />

      {/* Data flow diagram */}
      <div className="glass rounded-3xl px-5 py-4">
        <p className="text-xs font-semibold text-brand-navy mb-2">วิธีที่ Data ไหลเข้า AI</p>
        <div className="flex items-center gap-2 text-xs text-gray-600 flex-wrap">
          {[
            { icon: Globe,    label: "GSC / GA4", color: "bg-brand-blue/10 text-brand-blue" },
            { icon: Link2,    label: "Ahrefs",    color: "bg-brand-blue/10 text-brand-blue" },
            { icon: Brain,    label: "Data Brain Files", color: "bg-brand-mist text-brand-navy" },
          ].map((s) => (
            <span key={s.label} className={`flex items-center gap-1 px-2.5 py-1 rounded-full font-medium ${s.color}`}>
              <s.icon className="h-3 w-3" />{s.label}
            </span>
          ))}
          <span className="text-gray-400">→</span>
          <span className="flex items-center gap-1 px-2.5 py-1 rounded-full font-medium bg-brand-navy text-white">
            <Cpu className="h-3 w-3" /> AI Prompt Context
          </span>
          <span className="text-gray-400">→</span>
          <span className="flex items-center gap-1 px-2.5 py-1 rounded-full chip chip-ok">
            <FileText className="h-3 w-3" /> บทความที่ดีกว่าคู่แข่ง
          </span>
        </div>
      </div>

      {/* Tabs */}
      <UnderlineTabs
        tabs={[
          { id: "analytics" as const, label: "Analytics & SEO Tools", count: dataSources.length },
          { id: "databrain" as const, label: "Data Brain Files", count: dataBrainFiles.length },
          { id: "ai" as const, label: "AI Configuration" },
        ]}
        value={activeTab}
        onChange={setActiveTab}
      />

      {/* Analytics Tab */}
      {activeTab === "analytics" && (
        <div className="space-y-4">
          {SOURCE_DEFS.map((def) => {
            const existing = dataSources.find((s) => s.type === def.type);
            return (
              <div key={def.type} className={cn("rounded-3xl border p-5 backdrop-blur", def.color)}>
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex items-center gap-3">
                    <def.icon className={cn("h-5 w-5", def.iconColor)} />
                    <div>
                      <p className="font-semibold text-brand-navy">{def.label}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{def.desc}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {existing && (
                      <span className={STATUS_STYLE[existing.status] ?? "chip chip-muted"}>
                        {existing.status}
                      </span>
                    )}
                    <a href={def.connectUrl} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-brand-blue hover:underline">เปิด Console →</a>
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
                        className="w-full border border-white/80 bg-white/80 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    onClick={() => connect(def.type)}
                    disabled={connecting === def.type}
                    className="flex items-center gap-1.5 px-4 py-2 bg-brand-blue hover:bg-brand-deep text-white text-xs font-semibold rounded-full disabled:opacity-50 transition-colors"
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
          <div className="glass rounded-3xl p-4">
            <p className="text-sm font-semibold text-brand-navy mb-1">Data Brain คืออะไร?</p>
            <p className="text-xs text-gray-600">อัปโหลดไฟล์ที่มีอยู่แล้ว เช่น Brand Guidelines, Competitor Reports, Industry Research, ข้อมูลลูกค้า — Mars จะดึง context จากไฟล์เหล่านี้ inject เข้า AI prompt ทุกครั้งที่เขียนบทความ</p>
          </div>

          {/* Upload area */}
          <div className="bg-white/70 border-2 border-dashed border-gray-200 rounded-3xl p-6 text-center hover:border-brand-blue/40 transition-colors">
            <Brain className="h-8 w-8 text-gray-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-700 mb-1">อัปโหลดไฟล์ Data Brain</p>
            <p className="text-xs text-gray-400 mb-4">รองรับ TXT, CSV, HTML · PDF/DOCX รองรับเมื่อต่อ extraction service</p>
            <div className="flex items-center justify-center gap-3">
              <select
                value={uploadProjectId}
                onChange={(e) => setUploadProjectId(e.target.value)}
                className="text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
              >
                <option value="">ทุก Project (Global)</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-2 px-4 py-2 bg-brand-blue hover:bg-brand-deep text-white text-sm font-semibold rounded-full disabled:opacity-50"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {uploading ? "กำลังอัปโหลด..." : "เลือกไฟล์"}
              </button>
              <input ref={fileRef} type="file" accept=".txt,.csv,.html,.pdf,.docx" className="hidden" onChange={uploadFile} />
            </div>
          </div>

          {/* File list */}
          {dataBrainFiles.length > 0 && (
            <div className="glass rounded-3xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase">
                {dataBrainFiles.length} ไฟล์
              </div>
              {dataBrainFiles.map((f) => (
                <div key={f.id} className="flex items-start gap-3 px-4 py-3 border-b border-gray-100/70 last:border-0 hover:bg-white/60">
                  <FileText className="h-4 w-4 text-brand-blue shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-brand-navy">{f.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {(f.sizeBytes / 1024).toFixed(1)} KB · {f.mimeType} · {formatDate(f.createdAt)}
                    </p>
                    {f.summary && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{f.summary}</p>}
                    {f.projectId && <p className="text-xs text-brand-blue mt-0.5">Project: {projects.find((p) => p.id === f.projectId)?.name ?? f.projectId}</p>}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" aria-label="Active" />
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
            className="flex items-center justify-between glass rounded-3xl p-5 hover:shadow-md transition-all group"
          >
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-brand-blue flex items-center justify-center shrink-0">
                <Cpu className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-brand-navy">ตั้งค่า AI Provider</p>
                <p className="text-xs text-gray-500 mt-0.5">เพิ่ม API key และเลือก provider / model ที่ต้องการใช้</p>
              </div>
            </div>
            <span className="text-xs font-semibold text-brand-blue group-hover:underline shrink-0">เปิด AI Connect →</span>
          </a>

          <div className="glass rounded-3xl p-4 text-xs text-gray-600">
            <p className="font-semibold mb-1">เมื่อต่อ Data Sources ครบ — AI จะทำงานอย่างนี้:</p>
            <ol className="list-decimal list-inside space-y-1 text-brand-blue">
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
