"use client";

import { useState, useMemo } from "react";
import { toast } from "sonner";
import {
  Plus, RefreshCw, Trash2, Check, X,
  CheckCircle2, MinusCircle, ExternalLink, Filter, Clock, Search,
} from "lucide-react";

interface RefreshItem {
  id: string;
  url: string;
  pageTitle: string | null;
  clientName: string | null;
  projectId: string | null;
  priority: string;
  status: string;
  reasons: string;
  notes: string | null;
  daysOld: number | null;
  recommendation: string | null;
  dueDate: string | null;
  createdAt: string;
  project: { id: string; name: string; clientName: string | null } | null;
}

interface Props {
  initialItems: RefreshItem[];
  projects: { id: string; name: string }[];
}

const PRIORITY_CONFIG = {
  high:   { label: "High",   color: "bg-red-100 text-red-700",     dot: "bg-red-400" },
  medium: { label: "Medium", color: "bg-amber-100 text-amber-700", dot: "bg-amber-400" },
  low:    { label: "Low",    color: "bg-gray-100 text-gray-500",   dot: "bg-gray-300" },
};

const STATUS_CONFIG = {
  pending:     { label: "รอดำเนินการ", color: "text-gray-500",    icon: <Clock size={12} /> },
  in_progress: { label: "กำลังทำ",    color: "text-blue-600",    icon: <RefreshCw size={12} className="animate-spin" /> },
  done:        { label: "เสร็จแล้ว",  color: "text-emerald-600", icon: <CheckCircle2 size={12} /> },
  ignored:     { label: "ข้าม",       color: "text-gray-400",    icon: <MinusCircle size={12} /> },
};

function PriorityChip({ priority }: { priority: string }) {
  const cfg = PRIORITY_CONFIG[priority as keyof typeof PRIORITY_CONFIG] ?? PRIORITY_CONFIG.medium;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${cfg.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />{cfg.label}
    </span>
  );
}

// ─── Add form ──────────────────────────────────────────────────────────────────
function AddForm({ projects, onAdd }: { projects: { id: string; name: string }[]; onAdd: (item: RefreshItem) => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    url: "", pageTitle: "", projectId: "", priority: "medium",
    reasons: "", notes: "", daysOld: "", recommendation: "", dueDate: "",
  });

  function reset() {
    setForm({ url: "", pageTitle: "", projectId: "", priority: "medium", reasons: "", notes: "", daysOld: "", recommendation: "", dueDate: "" });
    setOpen(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.url) return;
    setSaving(true);
    try {
      const res = await fetch("/api/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          daysOld: form.daysOld ? Number(form.daysOld) : null,
          reasons: form.reasons ? form.reasons.split(",").map((s: string) => s.trim()).filter(Boolean) : [],
        }),
      });
      if (!res.ok) throw new Error();
      const item = await res.json();
      onAdd(item);
      reset();
      toast.success("เพิ่มรายการแล้ว");
    } catch { toast.error("เกิดข้อผิดพลาด"); }
    finally { setSaving(false); }
  }

  if (!open) return (
    <button onClick={() => setOpen(true)} className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-semibold rounded-xl hover:bg-gray-700 transition-colors">
      <Plus size={14} /> เพิ่มหน้าที่ต้อง Refresh
    </button>
  );

  return (
    <form onSubmit={submit} className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 text-sm">เพิ่มหน้าที่ต้อง Refresh</h3>
        <button type="button" onClick={reset} className="text-gray-400 hover:text-gray-700"><X size={16} /></button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-500 mb-1">URL *</label>
          <input type="url" value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} required
            placeholder="https://yoursite.com/page" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">ชื่อหน้า</label>
          <input value={form.pageTitle} onChange={e => setForm(f => ({ ...f, pageTitle: e.target.value }))}
            placeholder="Title ของหน้า" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Client</label>
          <select value={form.projectId} onChange={e => setForm(f => ({ ...f, projectId: e.target.value }))}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
            <option value="">— เลือก Client —</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Priority</label>
          <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">อายุบทความ (วัน)</label>
          <input type="number" value={form.daysOld} onChange={e => setForm(f => ({ ...f, daysOld: e.target.value }))}
            placeholder="180" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Due Date</label>
          <input type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-500 mb-1">เหตุผล (คั่นด้วย comma)</label>
          <input value={form.reasons} onChange={e => setForm(f => ({ ...f, reasons: e.target.value }))}
            placeholder="ข้อมูลเก่า, traffic ลด, competitor ใหม่"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-500 mb-1">คำแนะนำ</label>
          <input value={form.recommendation} onChange={e => setForm(f => ({ ...f, recommendation: e.target.value }))}
            placeholder="ปรับปรุงข้อมูลให้ทันสมัย, เพิ่ม FAQ"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={reset} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-900">ยกเลิก</button>
        <button type="submit" disabled={saving}
          className="px-4 py-2 bg-gray-900 text-white text-sm font-semibold rounded-xl hover:bg-gray-700 disabled:opacity-50 transition-colors">
          {saving ? "กำลังบันทึก..." : "บันทึก"}
        </button>
      </div>
    </form>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────────
function RefreshRow({ item, onUpdate, onDelete }: {
  item: RefreshItem;
  onUpdate: (updated: RefreshItem) => void;
  onDelete: (id: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const reasons: string[] = (() => { try { return JSON.parse(item.reasons || "[]"); } catch { return []; } })();
  const sc = STATUS_CONFIG[item.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.pending;
  const projectName = item.project?.clientName ?? item.project?.name ?? item.clientName ?? "—";

  async function changeStatus(status: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/refresh/${item.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
      onUpdate({ ...item, status });
    } catch { toast.error("เกิดข้อผิดพลาด"); }
    finally { setSaving(false); }
  }

  async function remove() {
    if (!confirm("ลบรายการนี้?")) return;
    try {
      await fetch(`/api/refresh/${item.id}`, { method: "DELETE" });
      onDelete(item.id);
      toast.success("ลบแล้ว");
    } catch { toast.error("เกิดข้อผิดพลาด"); }
  }

  return (
    <div className={`p-4 bg-white border border-gray-200 rounded-xl space-y-2 transition-opacity ${item.status === "done" || item.status === "ignored" ? "opacity-50" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <PriorityChip priority={item.priority} />
            <span className="text-xs font-medium text-gray-500">{projectName}</span>
            {item.daysOld && <span className="text-[10px] text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">{item.daysOld} วัน</span>}
          </div>
          <p className="text-sm font-semibold text-gray-900 mt-1">{item.pageTitle || item.url}</p>
          <a href={item.url} target="_blank" rel="noopener" className="text-[11px] text-blue-500 hover:underline flex items-center gap-0.5 truncate mt-0.5">
            <ExternalLink size={9} />{item.url}
          </a>
        </div>
        <span className={`flex items-center gap-1 text-xs font-medium shrink-0 ${sc.color}`}>{sc.icon}{sc.label}</span>
      </div>

      {reasons.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {reasons.map((r, i) => <span key={i} className="px-2 py-0.5 bg-gray-100 text-gray-600 text-[10px] rounded-full">{r}</span>)}
        </div>
      )}

      {item.recommendation && (
        <p className="text-xs text-gray-500 bg-gray-50 px-3 py-2 rounded-lg">💡 {item.recommendation}</p>
      )}

      <div className="flex items-center gap-2 pt-1 flex-wrap">
        {item.status !== "done" && (
          <button onClick={() => changeStatus("done")} disabled={saving}
            className="flex items-center gap-1 px-3 py-1 bg-emerald-100 text-emerald-700 text-xs font-semibold rounded-lg hover:bg-emerald-200 transition-colors disabled:opacity-50">
            <Check size={11} /> เสร็จแล้ว
          </button>
        )}
        {item.status === "pending" && (
          <button onClick={() => changeStatus("in_progress")} disabled={saving}
            className="flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-700 text-xs font-semibold rounded-lg hover:bg-blue-200 transition-colors disabled:opacity-50">
            <RefreshCw size={11} /> เริ่มทำ
          </button>
        )}
        {item.status !== "ignored" && item.status !== "done" && (
          <button onClick={() => changeStatus("ignored")} disabled={saving}
            className="px-3 py-1 bg-gray-100 text-gray-500 text-xs rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50">ข้าม</button>
        )}
        {(item.status === "done" || item.status === "ignored") && (
          <button onClick={() => changeStatus("pending")} disabled={saving}
            className="px-3 py-1 bg-gray-100 text-gray-500 text-xs rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50">รีเซ็ต</button>
        )}
        <div className="flex-1" />
        {item.dueDate && <span className="text-[10px] text-gray-400">Due: {item.dueDate}</span>}
        <button onClick={remove} className="p-1 text-gray-300 hover:text-red-400 transition-colors"><Trash2 size={12} /></button>
      </div>
    </div>
  );
}

// ─── GSC Scan Modal ───────────────────────────────────────────────────────────
function GSCScanModal({ projects, onDone }: { projects: { id: string; name: string }[]; onDone: (count: number) => void }) {
  const [open, setOpen]     = useState(false);
  const [scanning, setScanning] = useState(false);
  const [siteUrl, setSiteUrl]   = useState("");
  const [projectId, setProjectId] = useState("");
  const [dropThreshold, setDropThreshold] = useState("20");
  const [result, setResult] = useState<{ scanned: number; added: number; skipped: number } | null>(null);

  async function scan() {
    if (!siteUrl) return;
    setScanning(true); setResult(null);
    try {
      const res = await fetch("/api/refresh/gsc-scan", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteUrl, projectId: projectId || null, dropThreshold: Number(dropThreshold) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scan failed");
      setResult(data);
      if (data.added > 0) {
        toast.success(`เพิ่ม ${data.added} URL เข้า queue แล้ว`);
        onDone(data.added);
      } else {
        toast.success("Scan เสร็จ — ไม่มีหน้าที่ traffic ลดเกินเกณฑ์");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Scan failed";
      toast.error(msg);
    } finally { setScanning(false); }
  }

  if (!open) return (
    <button onClick={() => setOpen(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-500 transition-colors">
      <Search size={14} /> Scan GSC
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-gray-900">Scan จาก Google Search Console</h3>
          <button onClick={() => { setOpen(false); setResult(null); }} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">GSC Site URL *</label>
            <input value={siteUrl} onChange={e => setSiteUrl(e.target.value)}
              placeholder="sc-domain:example.com หรือ https://example.com/"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <p className="text-[10px] text-gray-400 mt-1">ดู format ได้จาก Google Search Console → Property selector</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Client (optional)</label>
            <select value={projectId} onChange={e => setProjectId(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">— ไม่ระบุ Client —</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Flag เมื่อ traffic ลดเกิน (%)</label>
            <input type="number" value={dropThreshold} onChange={e => setDropThreshold(e.target.value)}
              min={5} max={90} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>

        {result && (
          <div className="bg-blue-50 rounded-xl p-4 text-sm">
            <p className="font-semibold text-blue-800">ผลการ Scan</p>
            <p className="text-blue-700 mt-1">พบหน้าที่ traffic ลด: <b>{result.scanned}</b></p>
            <p className="text-blue-700">เพิ่มใหม่: <b>{result.added}</b> | ซ้ำ (ข้าม): <b>{result.skipped}</b></p>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={() => { setOpen(false); setResult(null); }} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-900">ปิด</button>
          <button onClick={scan} disabled={scanning || !siteUrl}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-500 disabled:opacity-50 transition-colors">
            {scanning ? <><RefreshCw size={13} className="animate-spin" /> กำลัง Scan...</> : <><Search size={13} /> Scan</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export function ContentRefreshClient({ initialItems, projects }: Props) {
  const [items, setItems] = useState<RefreshItem[]>(initialItems);
  const [filterProject, setFilterProject]   = useState("all");
  const [filterStatus, setFilterStatus]     = useState("pending");
  const [filterPriority, setFilterPriority] = useState("all");

  function handleGSCDone(_count: number) {
    // Reload to show new items from DB
    window.location.reload();
  }

  const counts = {
    all:         items.length,
    pending:     items.filter(i => i.status === "pending").length,
    in_progress: items.filter(i => i.status === "in_progress").length,
    done:        items.filter(i => i.status === "done").length,
    ignored:     items.filter(i => i.status === "ignored").length,
  };

  const filtered = useMemo(() => items.filter(i => {
    if (filterProject  !== "all" && i.projectId !== filterProject)  return false;
    if (filterStatus   !== "all" && i.status    !== filterStatus)   return false;
    if (filterPriority !== "all" && i.priority  !== filterPriority) return false;
    return true;
  }), [items, filterProject, filterStatus, filterPriority]);

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Content Refresh</h1>
          <p className="text-sm text-gray-500 mt-0.5">ติดตามหน้าที่ต้องปรับปรุงเนื้อหา</p>
        </div>
        <div className="flex items-center gap-2">
          <GSCScanModal projects={projects} onDone={handleGSCDone} />
          <AddForm projects={projects} onAdd={item => setItems(prev => [item, ...prev])} />
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex flex-wrap gap-2">
        {[
          { key: "all",         label: "ทั้งหมด" },
          { key: "pending",     label: "รอดำเนินการ" },
          { key: "in_progress", label: "กำลังทำ" },
          { key: "done",        label: "เสร็จแล้ว" },
          { key: "ignored",     label: "ข้าม" },
        ].map(s => (
          <button key={s.key} onClick={() => setFilterStatus(s.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${
              filterStatus === s.key ? "bg-gray-900 text-white border-gray-900" : "bg-gray-100 text-gray-600 border-transparent hover:border-gray-200"
            }`}>
            {s.label} <span className="opacity-60 ml-1">{counts[s.key as keyof typeof counts]}</span>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <Filter size={13} className="text-gray-400" />
        <select value={filterProject} onChange={e => setFilterProject(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-gray-900">
          <option value="all">ทุก Client</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-gray-900">
          <option value="all">ทุก Priority</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <span className="text-xs text-gray-400">{filtered.length} รายการ</span>
      </div>

      {/* Items */}
      {filtered.length > 0 ? (
        <div className="space-y-3">
          {filtered.map(item => (
            <RefreshRow key={item.id} item={item}
              onUpdate={updated => setItems(prev => prev.map(i => i.id === updated.id ? updated : i))}
              onDelete={id => setItems(prev => prev.filter(i => i.id !== id))}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-100">
          <CheckCircle2 size={32} className="text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">ไม่มีรายการ</p>
          <p className="text-gray-400 text-sm mt-1">กด "+ เพิ่มหน้าที่ต้อง Refresh" เพื่อเริ่มติดตาม</p>
        </div>
      )}
    </div>
  );
}
