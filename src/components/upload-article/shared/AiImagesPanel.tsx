"use client";

/**
 * แผงสร้างรูปด้วย AI ต่อบทความ — ปก + รูปประกอบ (เลือกแบบมี/ไม่มีตัวหนังสือ และจำนวนได้)
 * โมเดลเดียวกับหน้า Clients, prompt + ภาพตัวอย่างมาจาก Content Engine > Image Prompt ของลูกค้านี้
 * ค่าเริ่มต้นมาจาก Project Setting > รูปภาพ
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Sparkles, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_UPLOAD_IMAGE_DEFAULTS, UPLOAD_MAX_INLINE_IMAGES,
  type UploadArticleDTO, type UploadClientDTO,
} from "@/lib/upload-article/types";
import { countGeneratedFigures } from "@/lib/upload-article/article-images";

type Busy = "" | "cover" | "inline" | "remove";

function TextToggle({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-[11px]">
      {[{ v: true, l: "มีตัวหนังสือ" }, { v: false, l: "ภาพล้วน" }].map(o => (
        <button key={String(o.v)} type="button" disabled={disabled} onClick={() => onChange(o.v)}
          className={`px-2.5 py-1 ${value === o.v ? "bg-brand-blue text-white" : "bg-white text-gray-600 hover:bg-gray-50"} disabled:opacity-40`}>
          {o.l}
        </button>
      ))}
    </div>
  );
}

export async function requestArticleImages(articleId: string, body: { kind: "cover" | "inline"; withText: boolean; count?: number; onlyIfMissing?: boolean }) {
  const r = await fetch(`/api/upload-article/articles/${articleId}/images`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = d?.error === "CONTENT_ENGINE_NOT_CONFIGURED"
      ? "ยังไม่ได้ตั้ง Image Prompt ใน Project Setting > Content Engine"
      : d?.error || "สร้างรูปไม่สำเร็จ";
    return { ok: false as const, error: msg };
  }
  return { ok: true as const, article: d.article as UploadArticleDTO, costUsd: Number(d.costUsd) || 0, generated: Number(d.generated) || 0, failed: Number(d.failed) || 0, skipped: d.skipped === true };
}

export default function AiImagesPanel({ client, detail, applyArticleUpdate }: {
  client: UploadClientDTO;
  detail: UploadArticleDTO;
  applyArticleUpdate: (a: UploadArticleDTO) => void;
}) {
  const defaults = client.pushPrefs.imageDefaults ?? DEFAULT_UPLOAD_IMAGE_DEFAULTS;
  const [coverWithText, setCoverWithText] = useState(defaults.coverWithText);
  const [inlineWithText, setInlineWithText] = useState(defaults.inlineWithText);
  const [inlineCount, setInlineCount] = useState(Math.max(1, defaults.inlineCount || 1));
  const [busy, setBusy] = useState<Busy>("");

  // ค่าเริ่มต้นเปลี่ยนใน Project Setting → ใช้ค่าใหม่
  useEffect(() => {
    setCoverWithText(defaults.coverWithText);
    setInlineWithText(defaults.inlineWithText);
    setInlineCount(Math.max(1, defaults.inlineCount || 1));
  }, [defaults.coverWithText, defaults.inlineWithText, defaults.inlineCount]);

  const locked = detail.status === "PUSHING" || detail.status === "WRITING";
  const genCount = countGeneratedFigures(detail.sourceHtml || "");

  async function run(kind: "cover" | "inline") {
    setBusy(kind);
    try {
      const res = await requestArticleImages(detail.id, kind === "cover"
        ? { kind, withText: coverWithText }
        : { kind, withText: inlineWithText, count: inlineCount });
      if (!res.ok) { toast.error(res.error); return; }
      applyArticleUpdate(res.article);
      const cost = `ต้นทุน $${res.costUsd.toFixed(3)}`;
      if (kind === "cover") toast.success(`สร้างรูปปกแล้ว (${cost})`);
      else if (res.failed) toast.warning(`สร้างรูปประกอบได้ ${res.generated} รูป ไม่สำเร็จ ${res.failed} รูป (${cost})`);
      else toast.success(`สร้างรูปประกอบ ${res.generated} รูปแล้ว (${cost})`);
    } catch (e) {
      toast.error(`สร้างรูปไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy("");
    }
  }

  async function removeInline() {
    setBusy("remove");
    try {
      const r = await fetch(`/api/upload-article/articles/${detail.id}/images?kind=inline`, { method: "DELETE" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "ลบรูปไม่สำเร็จ"); return; }
      applyArticleUpdate(d.article);
      toast.success("เอารูปประกอบที่ Mars สร้างออกแล้ว");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <p className="text-xs font-bold text-brand-navy flex items-center gap-1.5"><Sparkles size={12} /> สร้างรูปด้วย Mars</p>
      <p className="text-[11px] text-gray-500">ใช้ Image Prompt + ภาพตัวอย่างจาก Content Engine ของลูกค้านี้ · ใช้เวลาประมาณ 1-2 นาที</p>

      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold text-gray-600">รูปปก</p>
        <TextToggle value={coverWithText} onChange={setCoverWithText} disabled={!!busy || locked} />
        <Button size="sm" variant="outline" className="w-full" disabled={!!busy || locked} onClick={() => run("cover")}>
          {busy === "cover" ? <Loader2 size={12} className="mr-1 animate-spin" /> : <Wand2 size={12} className="mr-1" />}
          {detail.coverImageUrl ? "สร้างรูปปกใหม่" : "สร้างรูปปก"}
        </Button>
      </div>

      <div className="space-y-1.5 pt-2 border-t border-gray-100">
        <p className="text-[11px] font-semibold text-gray-600">รูปประกอบในบทความ {genCount > 0 && <span className="font-normal text-gray-400">(ตอนนี้มี {genCount} รูปจาก Mars)</span>}</p>
        <TextToggle value={inlineWithText} onChange={setInlineWithText} disabled={!!busy || locked} />
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[11px] text-gray-500 mr-1">จำนวน</span>
          {Array.from({ length: UPLOAD_MAX_INLINE_IMAGES }, (_, i) => i + 1).map(n => (
            <button key={n} type="button" disabled={!!busy || locked} onClick={() => setInlineCount(n)}
              className={`w-7 h-7 rounded-md border text-[11px] ${inlineCount === n ? "bg-brand-blue text-white border-brand-blue" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}>
              {n}
            </button>
          ))}
        </div>
        <Button size="sm" variant="outline" className="w-full" disabled={!!busy || locked} onClick={() => run("inline")}>
          {busy === "inline" ? <Loader2 size={12} className="mr-1 animate-spin" /> : <Wand2 size={12} className="mr-1" />}
          {genCount > 0 ? `สร้างรูปประกอบใหม่ ${inlineCount} รูป (แทนชุดเดิม)` : `สร้างรูปประกอบ ${inlineCount} รูป`}
        </Button>
        {genCount > 0 && (
          <Button size="sm" variant="ghost" className="w-full text-rose-600" disabled={!!busy || locked} onClick={removeInline}>
            <Trash2 size={12} className="mr-1" /> เอารูปประกอบที่ Mars สร้างออก
          </Button>
        )}
        <p className="text-[10px] text-gray-400">วางใต้หัวข้อ H2 กระจายทั้งบทความ ไม่วางในส่วน FAQ · รูปที่มากับไฟล์ต้นฉบับไม่โดนแตะ</p>
      </div>
    </div>
  );
}
