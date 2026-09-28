"use client";

/**
 * กล่อง "รูปจากโฟลเดอร์ Drive" ในแท็บ Review — เฉพาะบทความที่นำเข้าจากโฟลเดอร์ Google Drive
 * ดึงรายการรูปในโฟลเดอร์ต้นทาง → กด "ตั้งเป็นปก" / "แทรกในบทความ" (ฝั่งเซิร์ฟเวอร์ย่อรูปให้เป็น data URI)
 * การบันทึกจริงใช้ฟังก์ชันเดิมของ ReviewTab ที่ส่งเข้ามา (onSetCover / onInsert)
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DriveImage {
  id: string;
  name: string;
  thumbUrl: string;
}

export default function DriveImagesPanel({
  articleId,
  canInsert,
  insertHint,
  onSetCover,
  onInsert,
}: {
  articleId: string;
  /** แทรกได้เมื่อบทความมี HTML แล้วและเลือกหัวข้อ H2 แล้ว */
  canInsert: boolean;
  insertHint: string;
  onSetCover: (dataUrl: string, name: string) => Promise<boolean>;
  onInsert: (dataUrl: string, name: string) => Promise<boolean>;
}) {
  const [images, setImages] = useState<DriveImage[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/upload-article/articles/${articleId}/drive-images`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d?.error || "โหลดรายการรูปไม่สำเร็จ"); setImages([]); return; }
      setImages(Array.isArray(d.images) ? d.images : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setImages([]);
    } finally {
      setLoading(false);
    }
  }, [articleId]);

  useEffect(() => { setImages(null); void load(); }, [load]);

  async function fetchDataUrl(fileId: string): Promise<{ dataUrl: string; name: string } | null> {
    const r = await fetch(`/api/upload-article/articles/${articleId}/drive-images`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileId }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || typeof d?.dataUrl !== "string") { toast.error(d?.error || "ดึงรูปจาก Drive ไม่สำเร็จ"); return null; }
    return { dataUrl: d.dataUrl, name: d.name || "" };
  }

  async function act(img: DriveImage, action: "cover" | "insert") {
    setBusyKey(`${action}:${img.id}`);
    try {
      const got = await fetchDataUrl(img.id);
      if (!got) return;
      if (action === "cover") await onSetCover(got.dataUrl, img.name);
      else await onInsert(got.dataUrl, img.name);
    } catch (e) {
      toast.error(`ใช้รูปไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-brand-navy flex items-center gap-1.5"><FolderOpen size={12} /> รูปจากโฟลเดอร์ Drive</p>
        <button onClick={() => void load()} disabled={loading}
          className="p-1 rounded text-gray-400 hover:text-brand-blue disabled:opacity-50" title="โหลดใหม่">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {loading && images === null ? (
        <p className="flex items-center gap-1.5 text-xs text-gray-400"><Loader2 size={12} className="animate-spin" /> กำลังโหลดรายการรูป...</p>
      ) : error ? (
        <p className="text-xs text-rose-600">{error}</p>
      ) : !images || images.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-3">ไม่มีรูปในโฟลเดอร์นี้</p>
      ) : (
        <>
          {!canInsert && <p className="text-[11px] text-gray-400">{insertHint}</p>}
          <div className="grid grid-cols-2 gap-2 max-h-[50vh] overflow-y-auto">
            {images.map(img => (
              <div key={img.id} className="border border-gray-200 rounded-lg overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.thumbUrl} alt={img.name} loading="lazy" referrerPolicy="no-referrer"
                  className="w-full h-24 object-cover bg-gray-50" />
                <div className="p-1.5 space-y-1">
                  <p className="text-[10px] text-gray-500 truncate" title={img.name}>{img.name}</p>
                  <Button size="sm" variant="outline" className="w-full h-7 text-[11px]" disabled={!!busyKey}
                    onClick={() => void act(img, "cover")}>
                    {busyKey === `cover:${img.id}` ? <Loader2 size={11} className="animate-spin" /> : "ตั้งเป็นปก"}
                  </Button>
                  <Button size="sm" variant="outline" className="w-full h-7 text-[11px]" disabled={!!busyKey || !canInsert}
                    onClick={() => void act(img, "insert")}>
                    {busyKey === `insert:${img.id}` ? <Loader2 size={11} className="animate-spin" /> : "แทรกในบทความ"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
