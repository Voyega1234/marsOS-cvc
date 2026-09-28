"use client";

/**
 * แท็บ "เขียนบทความ" — เลือก keyword ที่มี title แล้ว ให้ Content Engine เขียนบทความให้พร้อมกันหลายรายการ
 * (pool สูงสุด 10 พร้อมกัน) อ่าน progress ผ่าน NDJSON stream ต่อคำขอ
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight, Loader2, PlayCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DEFAULT_UPLOAD_IMAGE_DEFAULTS, type UploadArticleDTO, type UploadClientDTO, type UploadKeyword } from "@/lib/upload-article/types";
import { requestArticleImages } from "@/components/upload-article/shared/AiImagesPanel";
import type { SettingsSection } from "@/components/upload-article/settings/SettingsTab";

const MAX_CONCURRENCY = 10;
const IDLE_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 10_000;
const POLL_DEADLINE_MS = 12 * 60_000;
const STALE_MS = 6 * 60_000;
/** สร้างรูปหลังเขียนเสร็จทีละ 2 บทความ (บทความหนึ่งยิงรูปพร้อมกันได้หลายภาพอยู่แล้ว) */
const IMAGE_CONCURRENCY = 2;

type RowStatus =
  | { phase: "idle" }
  | { phase: "queued" }
  | { phase: "writing"; elapsed: number; chars: number }
  | { phase: "done"; articleId: string; note?: string }
  | { phase: "images"; articleId: string }
  | { phase: "error"; message: string }
  | { phase: "disconnected" };

export default function WriteTab({
  client, articles, preselectIds, clearPreselect, refreshArticles, applyArticleUpdate, goToReview, onOpenSettings,
}: {
  client: UploadClientDTO;
  articles: UploadArticleDTO[];
  preselectIds: string[];
  clearPreselect: () => void;
  refreshArticles: () => Promise<void>;
  applyArticleUpdate: (a: UploadArticleDTO) => void;
  goToReview: (articleId: string) => void;
  onOpenSettings: (section: SettingsSection) => void;
}) {
  const [ready, setReady] = useState<boolean | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [keywords, setKeywords] = useState<UploadKeyword[]>([]);
  const [loadingKw, setLoadingKw] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rowStatus, setRowStatus] = useState<Record<string, RowStatus>>({});
  const [running, setRunning] = useState(false);
  const imageDefaults = client.pushPrefs.imageDefaults ?? DEFAULT_UPLOAD_IMAGE_DEFAULTS;
  const imagesPlanned = imageDefaults.cover || imageDefaults.inlineCount > 0;
  const [autoImages, setAutoImages] = useState(false);
  /** บทความที่เขียนเสร็จในรอบนี้ — ใช้สร้างรูปต่อหลังเขียนครบ */
  const writtenRef = useRef<{ keywordId: string; articleId: string }[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [wr, kr] = await Promise.all([
          fetch(`/api/upload-article/clients/${client.id}/write`),
          fetch(`/api/upload-article/clients/${client.id}/keywords`),
        ]);
        if (alive && wr.ok) {
          const d = await wr.json();
          setReady(!!d.ready);
          setMissing(d.missing ?? []);
        }
        if (alive && kr.ok) {
          const d = await kr.json();
          setKeywords(((d.items ?? []) as UploadKeyword[]).filter(k => !!k.title));
        }
      } finally {
        if (alive) setLoadingKw(false);
      }
    })();
    return () => { alive = false; };
  }, [client.id]);

  useEffect(() => {
    if (preselectIds.length) {
      setSelected(new Set(preselectIds));
      clearPreselect();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectIds.join("|")]);

  useEffect(() => {
    function handler(e: BeforeUnloadEvent) {
      if (running) { e.preventDefault(); e.returnValue = ""; }
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [running]);

  async function pollUntilDone(keywordId: string) {
    const deadline = Date.now() + POLL_DEADLINE_MS;
    while (Date.now() < deadline) {
      await new Promise(res => setTimeout(res, POLL_INTERVAL_MS));
      try {
        const r = await fetch(`/api/upload-article/clients/${client.id}/articles`);
        if (r.ok) {
          const list: UploadArticleDTO[] = await r.json();
          const found = list.find(a => a.sourceName === `kw:${keywordId}` && a.status === "GENERATED");
          if (found) {
            setRowStatus(prev => ({ ...prev, [keywordId]: { phase: "done", articleId: found.id } }));
            setKeywords(prev => prev.map(k => (k.id === keywordId ? { ...k, articleId: found.id } : k)));
            applyArticleUpdate(found);
            writtenRef.current.push({ keywordId, articleId: found.id });
            await refreshArticles();
            return;
          }
        }
      } catch { /* เก็บ polling ต่อไป */ }
    }
  }

  async function runWriteOne(keywordId: string) {
    setRowStatus(prev => ({ ...prev, [keywordId]: { phase: "writing", elapsed: 0, chars: 0 } }));
    const controller = new AbortController();
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const resetIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
    };
    resetIdle();
    try {
      const r = await fetch(`/api/upload-article/clients/${client.id}/write`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywordId }),
        signal: controller.signal,
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        if (r.status === 409) {
          setRowStatus(prev => ({ ...prev, [keywordId]: { phase: "error", message: "กำลังเขียนอยู่แล้ว" } }));
        } else if (r.status === 422) {
          setRowStatus(prev => ({ ...prev, [keywordId]: { phase: "error", message: `ยังไม่พร้อมเขียน: ${(d.missing ?? []).join(", ")}` } }));
        } else {
          setRowStatus(prev => ({ ...prev, [keywordId]: { phase: "error", message: d?.error || "เขียนไม่สำเร็จ" } }));
        }
        return;
      }
      if (!r.body) throw new Error("ไม่มี response stream");
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        resetIdle();
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let msg: { type?: string; elapsed?: number; chars?: number; article?: UploadArticleDTO; error?: string };
          try { msg = JSON.parse(line); } catch { continue; }
          if (msg.type === "start") {
            setRowStatus(prev => ({ ...prev, [keywordId]: { phase: "writing", elapsed: 0, chars: 0 } }));
          } else if (msg.type === "heartbeat") {
            setRowStatus(prev => ({ ...prev, [keywordId]: { phase: "writing", elapsed: msg.elapsed ?? 0, chars: msg.chars ?? 0 } }));
          } else if (msg.type === "done" && msg.article) {
            const article = msg.article;
            setRowStatus(prev => ({ ...prev, [keywordId]: { phase: "done", articleId: article.id } }));
            setKeywords(prev => prev.map(k => (k.id === keywordId ? { ...k, articleId: article.id, writeError: undefined } : k)));
            applyArticleUpdate(article);
            writtenRef.current.push({ keywordId, articleId: article.id });
          } else if (msg.type === "error") {
            setRowStatus(prev => ({ ...prev, [keywordId]: { phase: "error", message: msg.error || "เขียนไม่สำเร็จ" } }));
          }
        }
      }
    } catch (e) {
      if (controller.signal.aborted) {
        setRowStatus(prev => ({ ...prev, [keywordId]: { phase: "disconnected" } }));
        await pollUntilDone(keywordId);
      } else {
        setRowStatus(prev => ({ ...prev, [keywordId]: { phase: "error", message: e instanceof Error ? e.message : String(e) } }));
      }
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
    }
  }

  /** สร้างรูปตามค่าใน Project Setting > รูปภาพ ให้บทความที่เพิ่งเขียนเสร็จ */
  async function makeImages(jobs: { keywordId: string; articleId: string }[]) {
    let idx = 0;
    let totalCost = 0;
    const worker = async () => {
      while (idx < jobs.length) {
        const job = jobs[idx++];
        setRowStatus(prev => ({ ...prev, [job.keywordId]: { phase: "images", articleId: job.articleId } }));
        const errors: string[] = [];
        if (imageDefaults.cover) {
          const res = await requestArticleImages(job.articleId, { kind: "cover", withText: imageDefaults.coverWithText }).catch(e => ({ ok: false as const, error: String(e) }));
          if (res.ok) { totalCost += res.costUsd; applyArticleUpdate(res.article); } else errors.push(`ปก: ${res.error}`);
        }
        if (imageDefaults.inlineCount > 0) {
          const res = await requestArticleImages(job.articleId, { kind: "inline", withText: imageDefaults.inlineWithText, count: imageDefaults.inlineCount }).catch(e => ({ ok: false as const, error: String(e) }));
          if (res.ok) { totalCost += res.costUsd; applyArticleUpdate(res.article); if (res.failed) errors.push(`รูปประกอบไม่สำเร็จ ${res.failed} รูป`); }
          else errors.push(`รูปประกอบ: ${res.error}`);
        }
        setRowStatus(prev => ({ ...prev, [job.keywordId]: { phase: "done", articleId: job.articleId, note: errors.length ? errors.join(" · ") : undefined } }));
      }
    };
    await Promise.all(Array.from({ length: Math.min(IMAGE_CONCURRENCY, jobs.length) }, () => worker()));
    if (jobs.length) toast.success(`สร้างรูปให้ ${jobs.length} บทความแล้ว (ต้นทุนรวม $${totalCost.toFixed(3)})`);
  }

  async function runWriteSelected() {
    const ids = Array.from(selected);
    if (!ids.length) return;
    setRunning(true);
    writtenRef.current = [];
    setRowStatus(prev => {
      const next = { ...prev };
      for (const id of ids) next[id] = { phase: "queued" };
      return next;
    });
    try {
      let idx = 0;
      const worker = async () => {
        while (idx < ids.length) {
          const my = ids[idx++];
          await runWriteOne(my);
        }
      };
      const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, ids.length) }, () => worker());
      await Promise.all(workers);
      if (autoImages && imagesPlanned) await makeImages([...writtenRef.current]);
    } finally {
      setRunning(false);
      await refreshArticles();
    }
  }

  async function retryKeyword(keywordId: string) {
    setRunning(true);
    setRowStatus(prev => ({ ...prev, [keywordId]: { phase: "queued" } }));
    writtenRef.current = [];
    try {
      await runWriteOne(keywordId);
      if (autoImages && imagesPlanned) await makeImages([...writtenRef.current]);
    } finally {
      setRunning(false);
      await refreshArticles();
    }
  }

  function toggleSelect(id: string) {
    setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function toggleSelectAll() {
    setSelected(prev => (prev.size === keywords.length ? new Set() : new Set(keywords.map(k => k.id))));
  }

  const staleWriting = useMemo(
    () => articles.filter(a => a.status === "WRITING" && Date.now() - new Date(a.updatedAt).getTime() > STALE_MS),
    [articles],
  );

  function statusLabel(s: RowStatus | undefined): string {
    if (!s) return "รอคิว";
    switch (s.phase) {
      case "queued": return "รอคิว";
      case "writing": return `กำลังเขียน (${s.elapsed}s · ${s.chars.toLocaleString()} ตัวอักษร)`;
      case "done": return s.note ? `เสร็จ (รูป: ${s.note})` : "เสร็จ";
      case "images": return "เขียนเสร็จ · กำลังสร้างรูป...";
      case "error": return `ผิดพลาด: ${s.message}`;
      case "disconnected": return "ขาดการเชื่อมต่อ — ระบบอาจยังเขียนต่อ";
      default: return "—";
    }
  }

  return (
    <div className="space-y-4">
      {ready === false && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
          <p className="text-sm font-semibold text-amber-800 flex items-center gap-1.5">
            <AlertTriangle size={14} /> ยังตั้งค่า Content Engine ไม่ครบ — เขียนบทความไม่ได้
          </p>
          {missing.length > 0 && (
            <ul className="text-xs text-amber-700 list-disc list-inside">
              {missing.map(m => <li key={m}>{m}</li>)}
            </ul>
          )}
          <Button size="sm" variant="outline" onClick={() => onOpenSettings("engine")}>ไปตั้งค่า Content Engine</Button>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs text-gray-500">{keywords.length} keyword ที่มี title{selected.size ? ` · เลือก ${selected.size}` : ""}</p>
        <div className="flex items-center gap-2">
          <button onClick={toggleSelectAll} className="text-[11px] text-brand-blue hover:underline">
            {selected.size === keywords.length && keywords.length > 0 ? "ยกเลิกเลือกทั้งหมด" : "เลือกทั้งหมด"}
          </button>
          <Button size="sm" disabled={!selected.size || running || ready === false} onClick={runWriteSelected}>
            {running ? <Loader2 size={12} className="animate-spin mr-1.5" /> : <PlayCircle size={12} className="mr-1.5" />}
            {running ? "กำลังเขียน..." : `เขียน ${selected.size || ""} บทความ`}
          </Button>
        </div>
      </div>

      <label className={`flex items-start gap-2 text-xs ${imagesPlanned ? "text-gray-700" : "text-gray-400"}`}>
        <input type="checkbox" className="mt-0.5" checked={autoImages && imagesPlanned} disabled={!imagesPlanned || running}
          onChange={e => setAutoImages(e.target.checked)} />
        <span>
          สร้างรูปหลังเขียนเสร็จ
          {imagesPlanned
            ? ` — ${[imageDefaults.cover ? `ปก (${imageDefaults.coverWithText ? "มีตัวหนังสือ" : "ภาพล้วน"})` : "", imageDefaults.inlineCount > 0 ? `รูปประกอบ ${imageDefaults.inlineCount} รูป (${imageDefaults.inlineWithText ? "มีตัวหนังสือ" : "ภาพล้วน"})` : ""].filter(Boolean).join(" + ")} มีค่าใช้จ่ายต่อรูป`
            : " — ยังไม่ได้ตั้งใน Project Setting > รูปภาพ"}
          {" "}<button type="button" onClick={() => onOpenSettings("images")} className="text-brand-blue hover:underline">ตั้งค่า</button>
        </span>
      </label>

      {running && (
        <p className="text-xs text-rose-500">อย่าปิดแท็บนี้ระหว่างกำลังเขียนบทความ — ระบบยังทำงานฝั่งเซิร์ฟเวอร์ต่อแม้ปิดแท็บ แต่จะเห็นผลช้าลง</p>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
        {loadingKw ? (
          <p className="text-sm text-gray-400 text-center py-10">กำลังโหลด...</p>
        ) : keywords.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-10">ยังไม่มี keyword ที่มี title — ไปตั้ง title ที่แท็บ Keyword ก่อน</p>
        ) : (
          <table className="w-full text-xs min-w-[700px]">
            <thead>
              <tr className="border-b border-gray-100 text-left text-gray-400">
                <th className="px-3 py-2 w-8"><input type="checkbox" checked={selected.size === keywords.length && keywords.length > 0} onChange={toggleSelectAll} /></th>
                <th className="px-2 py-2 min-w-[160px]">Title</th>
                <th className="px-2 py-2 min-w-[120px]">Keyword</th>
                <th className="px-2 py-2 min-w-[220px]">สถานะ</th>
                <th className="px-2 py-2 w-24" />
              </tr>
            </thead>
            <tbody>
              {keywords.map(k => {
                const st = rowStatus[k.id];
                return (
                  <tr key={k.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                    <td className="px-3 py-2"><input type="checkbox" checked={selected.has(k.id)} onChange={() => toggleSelect(k.id)} /></td>
                    <td className="px-2 py-2 text-brand-navy font-medium">{k.title}</td>
                    <td className="px-2 py-2 text-gray-500">{k.keyword}</td>
                    <td className="px-2 py-2">
                      <span className={st?.phase === "error" ? "text-rose-600" : st?.phase === "disconnected" ? "text-amber-600" : st?.phase === "done" ? "text-emerald-600" : "text-gray-500"}>
                        {k.articleId && !st ? "เขียนแล้ว" : statusLabel(st)}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right">
                      {(st?.phase === "done" || (k.articleId && !st)) && (
                        <button onClick={() => goToReview(st?.phase === "done" ? st.articleId : k.articleId!)} className="text-brand-blue hover:underline flex items-center gap-0.5 ml-auto">
                          ไป Review <ArrowRight size={11} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {staleWriting.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
          <p className="text-sm font-semibold text-brand-navy">บทความที่ค้างเขียนนานเกิน 6 นาที</p>
          {staleWriting.map(a => {
            const kwId = a.sourceName?.startsWith("kw:") ? a.sourceName.slice(3) : null;
            return (
              <div key={a.id} className="flex items-center justify-between text-xs gap-2">
                <span className="truncate">{a.title || a.id} — ค้าง</span>
                {kwId && (
                  <Button size="sm" variant="outline" disabled={running} onClick={() => retryKeyword(kwId)}>
                    <RefreshCw size={11} className="mr-1" /> เขียนใหม่
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
