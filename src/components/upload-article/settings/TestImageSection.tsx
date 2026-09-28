"use client";

/**
 * Project Setting > Test Image — กดให้ Mars ลองสร้างรูปจาก Image Prompt ของ Content Engine ลูกค้านี้
 * ใช้ท่อเดียวกับตอนสร้างรูปบทความจริง (POST /clients/[id]/test-image) — มีค่าใช้จ่ายจริงทุกครั้งที่กด
 * พอร์ตหน้าตามาจาก Article Lab (LabTestImageCard.tsx)
 */
import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import type { UploadClientDTO } from "@/lib/upload-article/types";

interface TestImageResponse {
  imageBase64: string;
  mimeType: string;
  type: "cover" | "mid";
  keyword: string;
  title: string;
  meta?: {
    model: string;
    referenceImageCount: number;
    logoAttached: boolean;
    language: "th" | "en";
    costUsd: number;
  };
}

interface TestResult {
  src: string;
  ext: string;
  keyword: string;
  title: string;
  type: "cover" | "mid";
  meta: TestImageResponse["meta"] | null;
  elapsedMs: number;
  at: Date;
}

export default function TestImageSection({ client }: { client: UploadClientDTO }) {
  const [keyword, setKeyword] = useState("");
  const [title, setTitle] = useState("");
  const [type, setType] = useState<"cover" | "mid">("cover");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<TestResult[]>([]);

  async function generate() {
    const kw = keyword.trim();
    if (!kw) { setError("ใส่ keyword ก่อน"); return; }
    setBusy(true);
    setError(null);
    const started = Date.now();
    try {
      const res = await fetch(`/api/upload-article/clients/${client.id}/test-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: kw, title: title.trim() || kw, type }),
      });
      const data: Partial<TestImageResponse> & { error?: string } = await res.json().catch(() => ({}));
      if (!res.ok || !data.imageBase64) {
        setError(data.error || `สร้างรูปไม่สำเร็จ (HTTP ${res.status})`);
        return;
      }
      const mime = data.mimeType || "image/webp";
      setResults((prev) => [{
        src: `data:${mime};base64,${data.imageBase64}`,
        ext: mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : "webp",
        keyword: kw,
        title: title.trim() || kw,
        type,
        meta: data.meta ?? null,
        elapsedMs: Date.now() - started,
        at: new Date(),
      }, ...prev].slice(0, 6));
    } catch (e) {
      setError(e instanceof Error ? e.message : "สร้างรูปไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-purple-50 flex items-center justify-center shrink-0">
            <Sparkles size={18} className="text-purple-600" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-900">Test Image — ลองสร้างรูปจาก Image Prompt</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              ใช้ Image Prompt ที่ Active ของลูกค้านี้ + ภาพอ้างอิง/โลโก้ที่แนบไว้ใน Content Engine ผ่านท่อเดียวกับตอนสร้างรูปบทความจริง
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-semibold text-gray-600">Keyword</span>
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="เช่น คอนโดใกล้ BTS"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-600">Title <span className="font-normal text-gray-400">(ไม่ใส่ = ใช้ keyword)</span></span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="หัวเรื่องที่จะขึ้นบนปก"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200"
            />
          </label>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            {(["cover", "mid"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                  type === t ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {t === "cover" ? "รูปปก (cover)" : "รูปในบทความ (mid)"}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={generate}
            disabled={busy}
            className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 text-white text-sm font-semibold rounded-xl hover:bg-purple-700 disabled:opacity-50 transition-colors"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {busy ? "กำลังสร้างรูป..." : "ให้ Mars ลองสร้างรูป"}
          </button>
          <span className="text-[11px] text-gray-400">ใช้เวลาราว 30–90 วินาที และมีค่าใช้จ่ายจริงทุกครั้งที่กด</span>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 whitespace-pre-wrap">{error}</div>
        )}
      </div>

      {results.map((r, i) => (
        <div key={`${r.at.getTime()}-${i}`} className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="flex flex-col lg:flex-row">
            <div className="lg:w-2/3 bg-gray-50 flex items-center justify-center p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.src} alt={r.title} className="max-w-full max-h-[520px] rounded-lg object-contain" />
            </div>
            <div className="lg:w-1/3 p-4 text-xs space-y-2">
              <div className="font-semibold text-gray-900 text-sm">{r.title}</div>
              <div className="text-gray-500">keyword: {r.keyword} · {r.type === "cover" ? "รูปปก" : "รูปในบทความ"}</div>
              {r.meta ? (
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-gray-700 pt-1">
                  <dt className="text-gray-400">ภาพอ้างอิง</dt>
                  <dd>{r.meta.referenceImageCount} ภาพ{r.meta.logoAttached ? " + โลโก้" : ""}</dd>
                  <dt className="text-gray-400">โมเดล</dt>
                  <dd className="font-mono">{r.meta.model}</dd>
                  <dt className="text-gray-400">ภาษาบนภาพ</dt>
                  <dd>{r.meta.language === "en" ? "อังกฤษ" : "ไทย"}</dd>
                  <dt className="text-gray-400">ค่าใช้จ่าย</dt>
                  <dd>${r.meta.costUsd.toFixed(4)}</dd>
                </dl>
              ) : (
                <div className="text-gray-400">ไม่มีข้อมูล meta จากเซิร์ฟเวอร์</div>
              )}
              <div className="text-gray-400 pt-1">{Math.round(r.elapsedMs / 1000)} วินาที · {r.at.toLocaleTimeString("th-TH")}</div>
              <a href={r.src} download={`test-${r.type}-${r.keyword}.${r.ext}`} className="inline-block text-purple-600 hover:underline pt-1">ดาวน์โหลดรูป</a>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
