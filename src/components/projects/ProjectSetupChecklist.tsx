"use client";

/**
 * Setup Checklist — ความพร้อมก่อนเริ่มโปรเจกต์กับลูกค้า (Project Settings › Checklist)
 * สถานะทุกข้อเช็คจากข้อมูลจริงฝั่ง server (/api/projects/[id]/setup-checklist)
 * ไม่ใช่ให้คนติ๊กเอง — กดปุ่มแต่ละข้อเพื่อกระโดดไปตั้งค่าจุดนั้นได้เลย
 */
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Circle, ArrowRight, RefreshCw, PartyPopper } from "lucide-react";

interface ChecklistItem {
  id: string;
  label: string;
  ok: boolean;
  required: boolean;
  hint: string;
  action: { kind: "drawer"; tab: "lab" | "ce" | "google" | "website" } | { kind: "main"; tab: string } | { kind: "clients" };
}

interface ChecklistData {
  items: ChecklistItem[];
  progressPct: number;
  requiredReady: boolean;
  doneCount: number;
  totalCount: number;
}

export function ProjectSetupChecklist({ projectId, onNavigate }: {
  projectId: string;
  /** พาไปตั้งค่า — คนเรียกจัดการสลับแท็บ drawer / แท็บหลัก / หน้า Clients เอง */
  onNavigate: (action: ChecklistItem["action"]) => void;
}) {
  const [data, setData] = useState<ChecklistData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/setup-checklist`);
      if (r.ok) setData(await r.json());
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-gray-400">
        <RefreshCw size={14} className="animate-spin" /> กำลังตรวจความพร้อมของโปรเจกต์...
      </div>
    );
  }
  if (!data) return <p className="py-6 text-sm text-gray-400">โหลด checklist ไม่สำเร็จ — ลองรีเฟรช</p>;

  const requiredItems = data.items.filter(i => i.required);
  const optionalItems = data.items.filter(i => !i.required);

  const ItemRow = ({ item }: { item: ChecklistItem }) => (
    <div className={`flex items-start gap-3 rounded-xl border p-3.5 transition-colors ${
      item.ok ? "border-emerald-100 bg-emerald-50/40" : "border-gray-200 bg-white"
    }`}>
      {item.ok
        ? <CheckCircle2 size={17} className="text-emerald-500 shrink-0 mt-0.5" />
        : <Circle size={17} className="text-gray-300 shrink-0 mt-0.5" />}
      <div className="flex-1 min-w-0">
        <p className={`text-[13px] font-semibold ${item.ok ? "text-emerald-800" : "text-brand-navy"}`}>
          {item.label}
          {!item.required && <span className="ml-1.5 text-[10px] font-normal text-gray-400">(แนะนำ)</span>}
        </p>
        <p className="mt-0.5 text-[11px] text-gray-500 leading-4">{item.hint}</p>
      </div>
      {!item.ok && (
        <button onClick={() => onNavigate(item.action)}
          className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-brand-blue text-white hover:opacity-90 transition-opacity">
          ไปตั้งค่า <ArrowRight size={11} />
        </button>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Progress */}
      <div className={`rounded-2xl border p-4 ${data.progressPct === 100 ? "border-emerald-200 bg-emerald-50/60" : "border-gray-200 bg-white"}`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {data.progressPct === 100 && <PartyPopper size={16} className="text-emerald-600" />}
            <span className="text-sm font-bold text-brand-navy">
              {data.progressPct === 100
                ? "พร้อม 100% — เริ่มงานกับลูกค้าได้เลย"
                : data.requiredReady
                  ? "ข้อบังคับครบแล้ว — เก็บข้อแนะนำให้ครบก่อนเริ่มจะดีที่สุด"
                  : "ยังตั้งค่าไม่ครบ — เก็บข้อบังคับให้หมดก่อนเริ่มกับลูกค้า"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-brand-navy tabular-nums">{data.doneCount}/{data.totalCount} · {data.progressPct}%</span>
            <button onClick={load} disabled={loading} title="ตรวจใหม่"
              className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors disabled:opacity-50">
              <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-500 ${data.progressPct === 100 ? "bg-emerald-500" : "bg-brand-blue"}`}
            style={{ width: `${data.progressPct}%` }} />
        </div>
      </div>

      {/* ข้อบังคับ */}
      <div>
        <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">
          ต้องมีก่อนเริ่ม ({requiredItems.filter(i => i.ok).length}/{requiredItems.length})
        </h3>
        <div className="space-y-2">{requiredItems.map(item => <ItemRow key={item.id} item={item} />)}</div>
      </div>

      {/* ข้อแนะนำ */}
      <div>
        <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">
          แนะนำให้ตั้งก่อนเริ่ม ({optionalItems.filter(i => i.ok).length}/{optionalItems.length})
        </h3>
        <div className="space-y-2">{optionalItems.map(item => <ItemRow key={item.id} item={item} />)}</div>
      </div>
    </div>
  );
}
