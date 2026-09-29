"use client";

/**
 * Setup Checklist ของลูกค้า Upload Article (Project Setting › Checklist)
 * สถานะทุกข้อเช็คจากค่าที่บันทึกไว้จริงฝั่ง server (/api/upload-article/clients/[id]/setup-checklist)
 * ไม่มีให้ติ๊กเอง — กด "ไปตั้งค่า" เพื่อกระโดดไปเมนูที่ต้องตั้งได้เลย
 */
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, Circle, PartyPopper, RefreshCw } from "lucide-react";
import type { UploadChecklistItem, UploadChecklistSection } from "@/app/api/upload-article/clients/[id]/setup-checklist/route";
import type { UploadSetupChecklistStatus } from "./useUploadSetupChecklist";

interface ChecklistData extends UploadSetupChecklistStatus {
  items: UploadChecklistItem[];
}

export default function UploadSetupChecklist({ clientId, onNavigate, onStatus }: {
  clientId: string;
  onNavigate: (section: UploadChecklistSection) => void;
  /** แจ้ง parent ว่ายังขาดกี่ข้อ — ให้ badge บนปุ่ม Project Setting ตรงกับหน้านี้ทันที */
  onStatus?: (s: UploadSetupChecklistStatus) => void;
}) {
  const [data, setData] = useState<ChecklistData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/upload-article/clients/${clientId}/setup-checklist`);
      if (r.ok) {
        const d: ChecklistData = await r.json();
        setData(d);
        onStatus?.({ missingRequired: d.missingRequired, doneCount: d.doneCount, totalCount: d.totalCount });
      }
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-gray-400">
        <RefreshCw size={14} className="animate-spin" /> กำลังตรวจการตั้งค่าของลูกค้า...
      </div>
    );
  }
  if (!data) return <p className="py-6 text-sm text-gray-400">โหลด checklist ไม่สำเร็จ — ลองรีเฟรช</p>;

  const requiredItems = data.items.filter(i => i.required);
  const optionalItems = data.items.filter(i => !i.required);
  const allDone = data.doneCount === data.totalCount;
  const requiredReady = data.missingRequired === 0;
  const pct = data.totalCount ? Math.round((data.doneCount / data.totalCount) * 100) : 0;

  const ItemRow = ({ item }: { item: UploadChecklistItem }) => {
    // ข้อแนะนำที่ยังไม่ตั้งไม่ใช่ปัญหา — ใช้สีเทา ไม่ใช่สีแดง
    const warn = !item.ok && item.required;
    return (
      <div className={`flex items-start gap-3 rounded-xl border p-3.5 transition-colors ${
        item.ok ? "border-emerald-100 bg-emerald-50/40" : warn ? "border-red-200 bg-red-50" : "border-gray-200 bg-white"
      }`}>
        {item.ok
          ? <CheckCircle2 size={17} className="text-emerald-500 shrink-0 mt-0.5" />
          : <Circle size={17} className={`shrink-0 mt-0.5 ${warn ? "text-red-500" : "text-gray-300"}`} />}
        <div className="flex-1 min-w-0">
          <p className={`text-[13px] font-semibold ${item.ok ? "text-emerald-800" : warn ? "text-red-600" : "text-brand-navy"}`}>
            {item.label}
            {!item.required && <span className="ml-1.5 text-[10px] font-normal text-gray-400">(ไม่บังคับ)</span>}
          </p>
          <p className={`mt-0.5 text-[11px] leading-4 ${warn ? "text-red-500/80" : "text-gray-500"}`}>{item.hint}</p>
        </div>
        {!item.ok && (
          <button onClick={() => onNavigate(item.section)}
            className={`shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-opacity hover:opacity-90 ${
              warn ? "bg-red-600 text-white" : "bg-gray-100 text-gray-600"
            }`}>
            ไปตั้งค่า <ArrowRight size={11} />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className={`rounded-2xl border p-4 ${requiredReady ? "border-emerald-200 bg-emerald-50/60" : "border-red-200 bg-red-50"}`}>
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            {allDone && <PartyPopper size={16} className="text-emerald-600" />}
            <span className={`text-sm font-bold ${requiredReady ? "text-brand-navy" : "text-red-600"}`}>
              {allDone
                ? "ตั้งค่าครบทุกข้อแล้ว"
                : requiredReady
                  ? "ข้อบังคับครบแล้ว — ข้อที่เหลือไม่บังคับ ตั้งเพิ่มได้ถ้าลูกค้าต้องการ"
                  : `ยังตั้งค่าไม่ครบ ${data.missingRequired} ข้อ — เก็บข้อบังคับให้หมดก่อนเริ่มงาน`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-sm font-bold tabular-nums ${requiredReady ? "text-brand-navy" : "text-red-600"}`}>{data.doneCount}/{data.totalCount}</span>
            <button onClick={load} disabled={loading} title="ตรวจใหม่"
              className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors disabled:opacity-50">
              <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-500 ${requiredReady ? "bg-emerald-500" : "bg-red-500"}`}
            style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div>
        <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">
          ต้องตั้งก่อนเริ่มงาน ({requiredItems.filter(i => i.ok).length}/{requiredItems.length})
        </h3>
        <div className="space-y-2">{requiredItems.map(item => <ItemRow key={item.id} item={item} />)}</div>
      </div>

      <div>
        <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">
          ไม่บังคับ ({optionalItems.filter(i => i.ok).length}/{optionalItems.length})
        </h3>
        <div className="space-y-2">{optionalItems.map(item => <ItemRow key={item.id} item={item} />)}</div>
      </div>
    </div>
  );
}
