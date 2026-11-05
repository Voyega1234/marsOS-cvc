"use client";

/** กล่องถาม Re-generate เมื่อของที่ใช้เขียนบทความเปลี่ยนไป — เลือก AI เขียนใหม่ทั้งบทความ หรือสร้าง HTML ใหม่อย่างเดียว */
import { useState } from "react";
import { Button } from "@/components/ui/button";

export interface RewriteCheck {
  canRewrite: boolean;
  changed: Array<{ key: string; label: string }>;
  /** true = บทความเก่าไม่มีตรา เดาจากเวลาแก้ layer */
  unknown: boolean;
  avgCostUsd: number | null;
  costSamples: number;
  rewriting: boolean;
  /** true = มีเวอร์ชันก่อนเขียนใหม่ให้ย้อนกลับ */
  hasBackup?: boolean;
  /** true = กำลัง push จริงอยู่ */
  pushing?: boolean;
}

export default function RewriteDialog({ check, pushed, hasInlineImages, onRewrite, onHtmlOnly, onClose }: {
  check: RewriteCheck;
  pushed: boolean;
  hasInlineImages: boolean;
  onRewrite: (opts: { regenImages: boolean }) => void;
  onHtmlOnly: () => void;
  onClose: () => void;
}) {
  const [regenImages, setRegenImages] = useState(false);
  const cost = check.avgCostUsd != null
    ? `ประมาณ $${check.avgCostUsd.toFixed(2)} ต่อบทความ (เฉลี่ยจาก ${check.costSamples} งานล่าสุด)`
    : "ไม่ทราบค่าใช้จ่าย";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-3">
        {check.changed.length === 0 ? (
          <>
            <p className="text-sm font-bold text-brand-navy">ให้ AI เขียนบทความนี้ใหม่</p>
            <p className="text-xs text-gray-600" data-testid="rewrite-nochange">ไม่พบว่าของที่ใช้เขียนเปลี่ยน แต่สั่งเขียนใหม่ได้ มีค่าใช้จ่าย AI</p>
          </>
        ) : (
          <>
            <p className="text-sm font-bold text-brand-navy">ของที่ใช้เขียนบทความนี้เปลี่ยนไป</p>
            <p className="text-xs text-gray-600">
              {check.unknown ? "น่าจะเปลี่ยน (บทความนี้เขียนก่อนระบบจดบันทึก จึงเดาจากเวลาที่แก้):" : "ที่เปลี่ยนตั้งแต่เขียนครั้งล่าสุด:"}
            </p>
            <ul className="text-xs text-gray-800 list-disc pl-5 space-y-0.5" data-testid="rewrite-changed">
              {check.changed.map((c) => <li key={c.key}>{c.label}</li>)}
            </ul>
          </>
        )}
        <div className="text-xs text-gray-600 space-y-1 bg-gray-50 rounded-lg p-3">
          <p><b>เขียนใหม่ทั้งบทความ (AI)</b> — เสียค่าใช้จ่าย {cost}</p>
          <p>ที่แก้มือและรูปประกอบในเนื้อหาจะถูกแทนที่ (ปก ชื่อ slug และโพสต์เดิมคงอยู่)</p>
          {pushed && <p>บทความบนเว็บยังเป็นเวอร์ชันเดิมจนกว่าจะกด ผ่าน Review แล้ว Re-push</p>}
          <p>ถ้าเขียนไม่สำเร็จ บทความเดิมไม่หาย</p>
        </div>
        {hasInlineImages && (
          <label className="flex items-start gap-2 text-xs text-gray-700">
            <input type="checkbox" checked={regenImages} onChange={(e) => setRegenImages(e.target.checked)} className="mt-0.5" />
            <span>สร้างรูปประกอบใหม่หลังเขียนเสร็จ (เสียค่ารูปเพิ่มตามจำนวนรูปเดิม)</span>
          </label>
        )}
        <div className="flex flex-col gap-2 pt-1">
          <Button size="sm" onClick={() => onRewrite({ regenImages })} disabled={check.rewriting}>เขียนใหม่ทั้งบทความ (AI)</Button>
          <Button size="sm" variant="outline" onClick={onHtmlOnly}>สร้าง HTML ใหม่อย่างเดียว (ไม่เสียเงิน)</Button>
          <Button size="sm" variant="ghost" onClick={onClose}>ยกเลิก</Button>
        </div>
      </div>
    </div>
  );
}
