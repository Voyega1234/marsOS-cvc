"use client";

/**
 * ตั้งวัน-เวลาที่บทความจะขึ้นเว็บ — เก็บใน pushPrefs.publishAt[articleId]
 * ตอน Push ขึ้น WordPress: ส่งเป็น date_gmt, ถ้าเป็นเวลาอนาคต + โหมด publish = ตั้งเวลาเผยแพร่ (scheduled)
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarClock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UploadClientDTO } from "@/lib/upload-article/types";

/** ISO → ค่าของ <input type="datetime-local"> ตามเวลาเครื่องผู้ใช้ */
function toLocalInput(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatPublishAt(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

export default function PublishDatePanel({ client, setClient, articleId }: {
  client: UploadClientDTO;
  setClient: (c: UploadClientDTO) => void;
  articleId: string;
}) {
  const saved = client.pushPrefs.publishAt?.[articleId];
  const [value, setValue] = useState(toLocalInput(saved));
  const [saving, setSaving] = useState(false);

  useEffect(() => { setValue(toLocalInput(saved)); }, [saved, articleId]);

  async function save(next: string | null) {
    setSaving(true);
    try {
      const iso = next ? new Date(next).toISOString() : null;
      const r = await fetch(`/api/upload-article/articles/${articleId}/schedule`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publishAt: iso }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "บันทึกวันที่ไม่สำเร็จ"); return; }
      const map = { ...(client.pushPrefs.publishAt ?? {}) };
      if (d.publishAt) map[articleId] = d.publishAt; else delete map[articleId];
      setClient({ ...client, pushPrefs: { ...client.pushPrefs, publishAt: map } });
      toast.success(d.publishAt ? "บันทึกวันที่เผยแพร่แล้ว" : "ล้างวันที่เผยแพร่แล้ว");
    } catch (e) {
      toast.error(`บันทึกวันที่ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  const isWp = !client.websitePlatform || client.websitePlatform === "wordpress";
  const dirty = value !== toLocalInput(saved);
  const future = saved ? new Date(saved).getTime() > Date.now() : false;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
      <p className="text-xs font-bold text-brand-navy flex items-center gap-1.5"><CalendarClock size={12} /> วันที่เผยแพร่</p>
      <input type="datetime-local" value={value} onChange={e => setValue(e.target.value)}
        className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 bg-white" />
      <div className="flex gap-2">
        <Button size="sm" className="flex-1" disabled={!value || !dirty || saving} onClick={() => save(value)}>
          {saving && <Loader2 size={12} className="mr-1 animate-spin" />} บันทึกวันที่
        </Button>
        {saved && (
          <Button size="sm" variant="outline" disabled={saving} onClick={() => save(null)}>ล้าง</Button>
        )}
      </div>
      <p className="text-[10px] text-gray-500">
        {saved
          ? future
            ? `ตั้งไว้ ${formatPublishAt(saved)} — Push แบบ Publish แล้ว WordPress จะตั้งเวลาเผยแพร่ให้เอง`
            : `ตั้งไว้ ${formatPublishAt(saved)} — เป็นวันย้อนหลัง บทความจะขึ้นด้วยวันที่นี้`
          : "ไม่ตั้ง = ใช้วันเวลาที่กด Push"}
      </p>
      {!isWp && <p className="text-[10px] text-amber-700">ตั้งวันที่ใช้ได้กับ WordPress เท่านั้น แพลตฟอร์มอื่นใช้วันเวลาที่ Push</p>}
    </div>
  );
}
