"use client";

import { useCallback, useRef, useState } from "react";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { QuotaOverwrite } from "@/lib/backlink-management/quota-types";
import { api } from "./shared";

/** ผู้ใช้กด Cancel ใน popup เขียนทับ — ผู้เรียกไม่ต้องแสดง error */
export class OverwriteCancelled extends Error {
  constructor() {
    super("ยกเลิกการเขียนทับ");
    this.name = "OverwriteCancelled";
  }
}

type Ask = (overwrites: QuotaOverwrite[]) => Promise<boolean>;

function isOverwriteList(v: unknown): v is QuotaOverwrite[] {
  return Array.isArray(v) && v.length > 0 && v.every((o) => o && typeof o === "object" && typeof (o as QuotaOverwrite).key === "string");
}

/**
 * เรียก API เขียนโควต้า — ถ้าเซิร์ฟเวอร์ตอบ 409 พร้อมรายการเซลล์ที่จะถูกเขียนทับ (ยังไม่ได้เขียนอะไรลงชีท)
 * จะถามผู้ใช้ผ่าน popup แล้วส่งซ้ำพร้อม key ที่ยืนยัน ถ้าชีทเปลี่ยนระหว่างนั้น เซิร์ฟเวอร์จะถามใหม่
 */
export async function quotaWrite<T>(url: string, init: { method: string; json?: Record<string, unknown> }, ask: Ask): Promise<T> {
  let confirmed: string[] = [];
  for (let round = 0; round < 5; round++) {
    try {
      const json = confirmed.length ? { ...(init.json ?? {}), confirmOverwrite: confirmed } : init.json;
      return await api<T>(url, { method: init.method, ...(json !== undefined ? { json } : {}) });
    } catch (e) {
      const err = e as Error & { status?: number; data?: { overwrites?: unknown } };
      const list = err?.status === 409 ? err.data?.overwrites : undefined;
      if (!isOverwriteList(list)) throw e;
      if (!(await ask(list))) throw new OverwriteCancelled();
      confirmed = list.map((o) => o.key);
    }
  }
  throw new Error("ข้อมูลในชีทเปลี่ยนระหว่างยืนยันหลายครั้ง — โหลดใหม่แล้วลองอีกครั้ง");
}

/** popup ยืนยันการเขียนทับ: วาง `dialog` ไว้ใน JSX แล้วส่ง `ask` ให้ quotaWrite */
export function useOverwriteConfirm(): { ask: Ask; dialog: React.ReactNode } {
  const [items, setItems] = useState<QuotaOverwrite[] | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const settle = useCallback((ok: boolean) => {
    const r = resolver.current;
    resolver.current = null;
    setItems(null);
    r?.(ok);
  }, []);

  const ask = useCallback<Ask>((overwrites) => new Promise<boolean>((resolve) => {
    resolver.current?.(false);
    resolver.current = resolve;
    setItems(overwrites);
  }), []);

  const dialog = (
    <Dialog open={items !== null} onOpenChange={(v) => { if (!v) settle(false); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" /> จะเขียนทับข้อมูลเดิมใน Google Sheet
          </DialogTitle>
          <DialogDescription>
            {items?.length ?? 0} เซลล์มีข้อมูลอยู่แล้ว ตรวจตำแหน่งและค่าที่จะเขียนทับก่อนยืนยัน — ยังไม่ได้เขียนอะไรลงชีท
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] overflow-auto rounded-xl border border-gray-200">
          <table className="w-full text-xs" data-testid="overwrite-list">
            <thead className="sticky top-0 bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">แท็บ</th>
                <th className="px-3 py-2 font-medium">เซลล์</th>
                <th className="px-3 py-2 font-medium">คอลัมน์</th>
                <th className="px-3 py-2 font-medium">ค่าเดิม</th>
                <th className="w-6" />
                <th className="px-3 py-2 font-medium">เขียนทับด้วย</th>
              </tr>
            </thead>
            <tbody>
              {(items ?? []).map((o) => (
                <tr key={o.key} className="border-t border-gray-100 align-top">
                  <td className="px-3 py-2 text-gray-600">{o.tabTitle}</td>
                  <td className="px-3 py-2 font-mono font-semibold">{o.cell}</td>
                  <td className="px-3 py-2 text-gray-600">{o.header}</td>
                  <td className="break-all px-3 py-2 text-red-700 line-through decoration-red-300">{o.oldValue}</td>
                  <td className="py-2 text-gray-400"><ArrowRight className="h-3.5 w-3.5" /></td>
                  <td className="break-all px-3 py-2 font-medium text-emerald-700">
                    {o.newValue === "" ? <span className="font-normal italic text-gray-500">(ล้างช่อง)</span> : o.newValue}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => settle(false)}>Cancel</Button>
          <Button onClick={() => settle(true)}>Approve</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { ask, dialog };
}
