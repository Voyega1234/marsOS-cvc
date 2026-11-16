"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ds";
import type { QuotaView } from "@/lib/backlink-management/quota-types";
import { api, fmtDate } from "./shared";

const n = (v: number) => v.toLocaleString("th-TH");

/** สรุปโควต้าแบบย่อสำหรับหน้ารายงาน */
export default function QuotaSummaryPanel({ onOpenQuota }: { onOpenQuota?: () => void }) {
  const [view, setView] = useState<QuotaView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const v = await api<QuotaView>("/api/backlink-management/quota");
        if (!cancelled) setView(v);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (failed) return <p className="text-xs text-gray-500">โหลดสรุปโควต้าไม่สำเร็จ</p>;
  if (!view) return <div className="flex justify-center py-3 text-gray-400"><Loader2 className="h-4 w-4 animate-spin" /></div>;
  if (view.tableMissing || view.sources.length === 0) return null;

  const t = view.totals;
  const items: [string, number][] = [
    ["ซื้อมาแล้ว", t.bought], ["ใช้ไปแล้ว", t.used], ["จองไว้", t.reserved],
    ["คงเหลือ", t.remaining], ["ใช้ได้จริง", t.usable], ["ใกล้หมดอายุ", t.expiringSoon],
  ];
  const top = view.packages
    .filter((p) => (p.usable ?? 0) > 0)
    .sort((a, b) => (b.usable ?? 0) - (a.usable ?? 0))
    .slice(0, 5);

  return (
    <Panel
      title="โควต้า Backlink"
      actions={onOpenQuota ? <Button size="sm" variant="outline" onClick={onOpenQuota}>เปิดหน้าโควต้า</Button> : undefined}
    >
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {items.map(([label, v]) => (
          <div key={label}>
            <div className="text-xs text-gray-500">{label}</div>
            <div className="text-lg font-semibold text-brand-navy">{n(v)}</div>
          </div>
        ))}
      </div>
      {top.length > 0 ? (
        <ul className="mt-3 divide-y divide-gray-100 text-xs">
          {top.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 py-1.5">
              <span className="min-w-0 truncate font-medium">{p.vendorName || p.websites[0] || p.type || "—"}</span>
              <span className="shrink-0 text-gray-500">
                ใช้ได้ {n(p.usable ?? 0)}{p.units != null ? `/${n(p.units)}` : ""} · EXP. {p.expireDate ? fmtDate(p.expireDate) : p.expireText || "—"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}
