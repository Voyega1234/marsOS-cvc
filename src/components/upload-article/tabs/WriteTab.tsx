"use client";

/**
 * แท็บ "เขียนบทความ" — เลือก keyword ที่มี title แล้ว ให้ Content Engine เขียนบทความให้พร้อมกันหลายรายการ
 * (pool สูงสุด 10 พร้อมกัน) อ่าน progress ผ่าน NDJSON stream ต่อคำขอ
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { AlertCircle, AlertTriangle, ArrowRight, CheckCircle2, Clock, ImageIcon, Loader2, PlayCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DEFAULT_UPLOAD_IMAGE_DEFAULTS, type UploadArticleDTO, type UploadClientDTO, type UploadKeyword } from "@/lib/upload-article/types";
import { requestArticleImages } from "@/components/upload-article/shared/AiImagesPanel";
import type { SettingsSection } from "@/components/upload-article/settings/SettingsTab";
import { PBN_MAX_VARIANTS, parseWriterSourceName, writerSourceName } from "@/lib/upload-article/pbn";
import { PBN_MAIN_PROFILE } from "@/lib/upload-article/pbn-sets";
import { usePbnSites } from "@/components/upload-article/pbn/usePbnSites";
import { usePbnProfiles } from "@/components/upload-article/pbn/usePbnProfiles";

const MAX_CONCURRENCY = 10;
const IDLE_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 10_000;
const POLL_DEADLINE_MS = 12 * 60_000;
const STALE_MS = 6 * 60_000;
/** สร้างรูปหลังเขียนเสร็จทีละ 2 บทความ (บทความหนึ่งยิงรูปพร้อมกันได้หลายภาพอยู่แล้ว) */
const IMAGE_CONCURRENCY = 2;
/** ผู้ให้บริการ AI ขัดข้องชั่วคราว — เขียนใหม่อัตโนมัติ 1 ครั้งหลังรอสักครู่ */
const AUTO_RETRY_DELAY_MS = 5_000;
const TRANSIENT_RE = /\b(429|500|502|503|504|529)\b|network connection lost|provider_unavailable|overloaded|rate.?limit|timed? ?out|ECONNRESET|socket hang up/i;

type ImageStep = "cover" | "inline";

type RowStatus =
  | { phase: "idle" }
  | { phase: "queued" }
  | { phase: "writing"; elapsed: number; chars: number; attempt: number }
  | { phase: "retrying"; reason: string }
  /** เขียนบทความเสร็จ — imagesPending = รอคิวสร้างรูปต่อ */
  | { phase: "written"; articleId: string; imagesPending: boolean }
  | { phase: "images"; articleId: string; step: ImageStep }
  | { phase: "done"; articleId: string; cover: boolean; inline: number; imageError?: string }
  | { phase: "error"; message: string; detail?: string }
  | { phase: "disconnected" };

type WriteResult = { ok: true } | { ok: false; transient: boolean };

/** แปลง error จากผู้ให้บริการ AI เป็นข้อความที่อ่านเข้าใจ — ข้อความเต็มเก็บไว้ใน detail */
function describeWriteError(raw: string): { message: string; transient: boolean } {
  const transient = TRANSIENT_RE.test(raw);
  if (!transient) return { message: raw, transient };
  if (/\b429\b|rate.?limit/i.test(raw)) return { message: "ระบบ Mars รับงานไม่ทัน (ถูกจำกัดจำนวนคำขอ)", transient };
  if (/timed? ?out/i.test(raw)) return { message: "ระบบ Mars ตอบช้าเกินกำหนด", transient };
  return { message: "การเชื่อมต่อกับระบบ Mars ขาดกลางทาง (ขัดข้องชั่วคราว)", transient };
}

/** เว็บ PBN ปลายทาง (สไตล์ตามเว็บ + push ได้เฉพาะเว็บนี้) + set ข้อมูลโปรเจกต์ — PBN เท่านั้น */
type PbnJobTarget = { siteId: string; profileId: string };

/** งานเขียน 1 ชิ้น — เวอร์ชัน 1 ใช้ key = keywordId (เหมือนเดิม), เวอร์ชันอื่น = keywordId#v<k> */
type WriteJob = { key: string; keywordId: string; variant: number; total: number; target?: PbnJobTarget };

function jobKey(keywordId: string, variant: number): string {
  return variant > 1 ? `${keywordId}#v${variant}` : keywordId;
}

function makeJob(keywordId: string, variant: number, total: number, target?: PbnJobTarget): WriteJob {
  return { key: jobKey(keywordId, variant), keywordId, variant, total, ...(target ? { target } : {}) };
}

function hasArticle(s: RowStatus | undefined): s is Extract<RowStatus, { articleId: string }> {
  return !!s && (s.phase === "written" || s.phase === "images" || s.phase === "done");
}

export default function WriteTab({
  client, articles, preselectIds, clearPreselect, refreshArticles, applyArticleUpdate, goToReview, onOpenSettings, variantsEnabled = false,
}: {
  client: UploadClientDTO;
  articles: UploadArticleDTO[];
  preselectIds: string[];
  clearPreselect: () => void;
  refreshArticles: () => Promise<void>;
  applyArticleUpdate: (a: UploadArticleDTO) => void;
  goToReview: (articleId: string) => void;
  onOpenSettings: (section: SettingsSection) => void;
  /** PBN Backlinks: เลือกจำนวนบทความต่อ keyword ได้ (title + keyword เดียวกัน เขียนต่างกัน intent เดิม) */
  variantsEnabled?: boolean;
}) {
  const [ready, setReady] = useState<boolean | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [keywords, setKeywords] = useState<UploadKeyword[]>([]);
  const [loadingKw, setLoadingKw] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rowStatus, setRowStatus] = useState<Record<string, RowStatus>>({});
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState<"writing" | "images" | null>(null);
  /** keyword ในรอบที่กำลังรัน — ใช้นับความคืบหน้า */
  const [runIds, setRunIds] = useState<string[]>([]);
  /** จำนวนบทความต่อ keyword (PBN) — Upload Article = 1 เสมอ */
  const [variantCount, setVariantCount] = useState(1);
  const perKeyword = variantsEnabled ? variantCount : 1;
  // ── PBN เท่านั้น: set ข้อมูลโปรเจกต์ + เว็บปลายทางของแต่ละบทความ (Upload Article ไม่โหลด/ไม่แสดง) ──
  const pbnSites = usePbnSites(variantsEnabled);
  const pbnProfiles = usePbnProfiles(variantsEnabled);
  const [pbnSetId, setPbnSetId] = useState<string>(PBN_MAIN_PROFILE);
  /** เว็บที่เลือกให้บทความที่ 1..N (index 0 = บทความที่ 1) */
  const [variantSites, setVariantSites] = useState<string[]>([]);
  /** เป้าหมายของงานที่ยิงไปแล้ว — เขียนใหม่ทีละงานใช้เว็บ/set เดิม */
  const jobTargetsRef = useRef<Record<string, PbnJobTarget>>({});
  const activePbnSet = pbnSetId === PBN_MAIN_PROFILE || pbnProfiles.profiles.some(p => p.id === pbnSetId) ? pbnSetId : PBN_MAIN_PROFILE;
  const pbnSetQs = variantsEnabled && activePbnSet !== PBN_MAIN_PROFILE ? `?set=${encodeURIComponent(activePbnSet)}` : "";
  const pbnSiteIds = pbnSites.sites.map(s => s.id);
  const chosenSites = variantSites.slice(0, perKeyword);
  const pbnTargetsOk = !variantsEnabled || (
    chosenSites.length === perKeyword
    && chosenSites.every(id => pbnSiteIds.includes(id))
    && new Set(chosenSites).size === chosenSites.length
  );
  const imageDefaults = client.pushPrefs.imageDefaults ?? DEFAULT_UPLOAD_IMAGE_DEFAULTS;
  const imagesPlanned = imageDefaults.cover || imageDefaults.inlineCount > 0;
  const [autoImages, setAutoImages] = useState(false);
  const ctaSummary = client.ctaSummary;
  const ctaReady = Boolean(ctaSummary?.ready);
  const [withCta, setWithCta] = useState(false);
  /** ค่าติ๊ก CTA ของรอบที่กำลังรัน — ใช้ตอนยิงเขียน (รวมรอบ retry) ไม่ให้เปลี่ยนตามการติ๊กระหว่างรัน */
  const ctaRunRef = useRef(false);
  const imageSummary = [imageDefaults.cover ? "ปก" : "", imageDefaults.inlineCount > 0 ? `รูปประกอบ ${imageDefaults.inlineCount} รูป` : ""].filter(Boolean).join(" + ");
  /** บทความที่เขียนเสร็จในรอบนี้ — ใช้สร้างรูปต่อหลังเขียนครบ */
  const writtenRef = useRef<{ keywordId: string; articleId: string }[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [wr, kr] = await Promise.all([
          fetch(`/api/upload-article/clients/${client.id}/write${pbnSetQs}`),
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
  }, [client.id, pbnSetQs]);

  // PBN: เติมเว็บให้ช่องที่ยังว่าง/เว็บถูกลบ ด้วยเว็บที่ยังไม่ถูกเลือก (ไม่ซ้ำกัน)
  const pbnSiteKey = pbnSiteIds.join(",");
  useEffect(() => {
    if (!variantsEnabled) return;
    setVariantSites(prev => {
      const next: string[] = [];
      for (let i = 0; i < variantCount; i++) {
        const cur = prev[i];
        next.push(cur && pbnSiteIds.includes(cur) && !next.includes(cur) ? cur : "");
      }
      for (let i = 0; i < next.length; i++) {
        if (!next[i]) next[i] = pbnSiteIds.find(id => !next.includes(id)) || "";
      }
      return next.join("|") === prev.join("|") ? prev : next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variantsEnabled, variantCount, pbnSiteKey]);

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

  async function pollUntilDone(job: WriteJob, withImages: boolean): Promise<boolean> {
    const { key, keywordId } = job;
    const source = writerSourceName(keywordId, job.variant);
    const deadline = Date.now() + POLL_DEADLINE_MS;
    while (Date.now() < deadline) {
      await new Promise(res => setTimeout(res, POLL_INTERVAL_MS));
      try {
        const r = await fetch(`/api/upload-article/clients/${client.id}/articles`);
        if (r.ok) {
          const list: UploadArticleDTO[] = await r.json();
          const found = list.find(a => a.sourceName === source && a.status === "GENERATED");
          if (found) {
            setRowStatus(prev => ({ ...prev, [key]: { phase: "written", articleId: found.id, imagesPending: withImages } }));
            if (job.variant === 1) setKeywords(prev => prev.map(k => (k.id === keywordId ? { ...k, articleId: found.id } : k)));
            applyArticleUpdate(found);
            writtenRef.current.push({ keywordId: key, articleId: found.id });
            await refreshArticles();
            return true;
          }
        }
      } catch { /* เก็บ polling ต่อไป */ }
    }
    setRowStatus(prev => ({ ...prev, [key]: { phase: "error", message: "รอผลนานเกินไป — ลองกดรีเฟรชหน้า ถ้าเขียนเสร็จแล้วบทความจะขึ้นเอง" } }));
    return false;
  }

  async function runWriteOne(job: WriteJob, withImages: boolean, attempt: number): Promise<WriteResult> {
    const { key, keywordId } = job;
    const fail = (raw: string): WriteResult => {
      const { message, transient } = describeWriteError(raw);
      setRowStatus(prev => ({ ...prev, [key]: { phase: "error", message, detail: message === raw ? undefined : raw } }));
      return { ok: false, transient };
    };
    setRowStatus(prev => ({ ...prev, [key]: { phase: "writing", elapsed: 0, chars: 0, attempt } }));
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
        body: JSON.stringify({
          keywordId,
          withCta: ctaRunRef.current,
          ...(job.total > 1 ? { variant: job.variant, variantTotal: job.total } : {}),
          ...(job.target ? { siteId: job.target.siteId, profileId: job.target.profileId } : {}),
        }),
        signal: controller.signal,
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        if (r.status === 409) {
          setRowStatus(prev => ({ ...prev, [key]: { phase: "error", message: "keyword นี้กำลังเขียนอยู่แล้ว — รอสักครู่แล้วกดรีเฟรชหน้า" } }));
          return { ok: false, transient: false };
        }
        if (r.status === 422) {
          setRowStatus(prev => ({ ...prev, [key]: { phase: "error", message: `ยังไม่พร้อมเขียน: ${(d.missing ?? []).join(", ")}` } }));
          return { ok: false, transient: false };
        }
        // 5xx ก่อนเริ่ม stream = งานยังไม่เริ่ม ลองใหม่ได้ไม่ชนกัน
        return fail(d?.error || `เขียนไม่สำเร็จ (HTTP ${r.status})`);
      }
      if (!r.body) throw new Error("ไม่มี response stream");
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let result: WriteResult | null = null;
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
            setRowStatus(prev => ({ ...prev, [key]: { phase: "writing", elapsed: 0, chars: 0, attempt } }));
          } else if (msg.type === "heartbeat") {
            setRowStatus(prev => ({ ...prev, [key]: { phase: "writing", elapsed: msg.elapsed ?? 0, chars: msg.chars ?? 0, attempt } }));
          } else if (msg.type === "done" && msg.article) {
            const article = msg.article;
            setRowStatus(prev => ({ ...prev, [key]: { phase: "written", articleId: article.id, imagesPending: withImages } }));
            if (job.variant === 1) setKeywords(prev => prev.map(k => (k.id === keywordId ? { ...k, articleId: article.id, writeError: undefined } : k)));
            applyArticleUpdate(article);
            writtenRef.current.push({ keywordId: key, articleId: article.id });
            result = { ok: true };
          } else if (msg.type === "error") {
            // เซิร์ฟเวอร์ล้างบทความที่ค้างแล้วก่อนส่ง error — เขียนใหม่ได้ทันที
            result = fail(msg.error || "เขียนไม่สำเร็จ");
          }
        }
      }
      if (result) return result;
      // stream จบโดยไม่มีผล — เซิร์ฟเวอร์อาจยังบันทึกอยู่ ไปรอผลแทน
      setRowStatus(prev => ({ ...prev, [key]: { phase: "disconnected" } }));
      return { ok: await pollUntilDone(job, withImages), transient: false } as WriteResult;
    } catch (e) {
      if (controller.signal.aborted) {
        setRowStatus(prev => ({ ...prev, [key]: { phase: "disconnected" } }));
        return { ok: await pollUntilDone(job, withImages), transient: false } as WriteResult;
      }
      // เน็ตฝั่งเบราว์เซอร์หลุด — เซิร์ฟเวอร์อาจยังเขียนอยู่ จึงไม่ลองใหม่อัตโนมัติ
      const { message } = describeWriteError(e instanceof Error ? e.message : String(e));
      setRowStatus(prev => ({ ...prev, [key]: { phase: "error", message } }));
      return { ok: false, transient: false };
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
    }
  }

  /** เขียน 1 keyword — ผู้ให้บริการ AI ขัดข้องชั่วคราวจะลองใหม่อัตโนมัติ 1 ครั้ง */
  async function writeWithRetry(job: WriteJob, withImages: boolean): Promise<boolean> {
    const first = await runWriteOne(job, withImages, 1);
    if (first.ok) return true;
    if (!first.transient) return false;
    setRowStatus(prev => {
      const cur = prev[job.key];
      const reason = cur?.phase === "error" ? cur.message : "ขัดข้องชั่วคราว";
      return { ...prev, [job.key]: { phase: "retrying", reason } };
    });
    await new Promise(res => setTimeout(res, AUTO_RETRY_DELAY_MS));
    return (await runWriteOne(job, withImages, 2)).ok;
  }

  /** สร้างรูปตามค่าใน Project Setting > รูปภาพ ให้บทความที่เพิ่งเขียนเสร็จ (ข้ามส่วนที่มีรูปจากระบบแล้ว) */
  async function makeImages(jobs: { keywordId: string; articleId: string }[]) {
    let idx = 0;
    let totalCost = 0;
    let failedJobs = 0;
    const worker = async () => {
      while (idx < jobs.length) {
        const job = jobs[idx++];
        const errors: string[] = [];
        let cover = false;
        let inline = 0;
        if (imageDefaults.cover) {
          setRowStatus(prev => ({ ...prev, [job.keywordId]: { phase: "images", articleId: job.articleId, step: "cover" } }));
          const res = await requestArticleImages(job.articleId, { kind: "cover", withText: imageDefaults.coverWithText, onlyIfMissing: true }).catch(e => ({ ok: false as const, error: String(e) }));
          if (res.ok) { totalCost += res.costUsd; applyArticleUpdate(res.article); cover = true; }
          else errors.push(`ปก: ${res.error}`);
        }
        if (imageDefaults.inlineCount > 0) {
          setRowStatus(prev => ({ ...prev, [job.keywordId]: { phase: "images", articleId: job.articleId, step: "inline" } }));
          const res = await requestArticleImages(job.articleId, { kind: "inline", withText: imageDefaults.inlineWithText, count: imageDefaults.inlineCount, onlyIfMissing: true }).catch(e => ({ ok: false as const, error: String(e) }));
          if (res.ok) {
            totalCost += res.costUsd;
            applyArticleUpdate(res.article);
            inline = res.skipped ? imageDefaults.inlineCount : res.generated;
            if (res.failed) errors.push(`รูปประกอบไม่สำเร็จ ${res.failed} รูป`);
          } else errors.push(`รูปประกอบ: ${res.error}`);
        }
        if (errors.length) failedJobs++;
        setRowStatus(prev => ({ ...prev, [job.keywordId]: { phase: "done", articleId: job.articleId, cover, inline, imageError: errors.length ? errors.join(" · ") : undefined } }));
      }
    };
    await Promise.all(Array.from({ length: Math.min(IMAGE_CONCURRENCY, jobs.length) }, () => worker()));
    if (!jobs.length) return;
    const cost = `ต้นทุนรวม $${totalCost.toFixed(3)}`;
    if (failedJobs) toast.error(`สร้างรูปไม่ครบ ${failedJobs} จาก ${jobs.length} บทความ (${cost}) — กด "สร้างรูปใหม่" ที่แถวนั้น`);
    else toast.success(`สร้างรูปให้ ${jobs.length} บทความแล้ว (${cost})`);
  }

  /** เขียนตามรายการ แล้วสร้างรูปต่อให้บทความที่เขียนสำเร็จ */
  async function runBatch(jobs: WriteJob[]) {
    const ids = jobs.map(j => j.key);
    for (const j of jobs) if (j.target) jobTargetsRef.current[j.key] = j.target;
    const withImages = autoImages && imagesPlanned;
    ctaRunRef.current = withCta && ctaReady;
    setRunning(true);
    setStage("writing");
    setRunIds(ids);
    writtenRef.current = [];
    setRowStatus(prev => {
      const next = { ...prev };
      for (const id of ids) next[id] = { phase: "queued" };
      return next;
    });
    try {
      let idx = 0;
      const worker = async () => {
        while (idx < jobs.length) await writeWithRetry(jobs[idx++], withImages);
      };
      await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, ids.length) }, () => worker()));
      const written = writtenRef.current.length;
      const failed = ids.length - written;
      if (failed) toast.error(`เขียนไม่สำเร็จ ${failed} จาก ${ids.length} บทความ — กด "เขียนใหม่" ที่แถวนั้น`);
      else toast.success(`เขียนบทความเสร็จ ${written} บทความ${withImages && written ? " — กำลังสร้างรูปต่อ" : ""}`);
      if (withImages && written) {
        setStage("images");
        await makeImages([...writtenRef.current]);
      }
    } finally {
      setRunning(false);
      setStage(null);
      await refreshArticles();
    }
  }

  async function retryImages(keywordId: string, articleId: string) {
    setRunning(true);
    setStage("images");
    setRunIds([keywordId]);
    try {
      await makeImages([{ keywordId, articleId }]);
    } finally {
      setRunning(false);
      setStage(null);
      await refreshArticles();
    }
  }

  async function runWriteSelected() {
    const ids = Array.from(selected);
    if (!ids.length) return;
    // เรียงเวอร์ชันแบบสลับ keyword (kw1v1, kw2v1, ..., kw1v2) — ถ้าหยุดกลางทางแต่ละ keyword ยังได้อย่างน้อย 1 บทความ
    if (!pbnTargetsOk) return;
    const jobs: WriteJob[] = [];
    for (let v = 1; v <= perKeyword; v++) {
      const target = variantsEnabled ? { siteId: chosenSites[v - 1], profileId: activePbnSet } : undefined;
      for (const id of ids) jobs.push(makeJob(id, v, perKeyword, target));
    }
    await runBatch(jobs);
  }

  /** เขียนใหม่ทีละงาน (key = keywordId หรือ keywordId#v<k>) */
  async function retryJob(key: string) {
    const m = /^(.*)#v(\d+)$/.exec(key);
    const keywordId = m ? m[1] : key;
    const variant = m ? Number(m[2]) : 1;
    // PBN: ใช้เว็บ/set เดิมของงานนี้ — ไม่มี (เช่นโหลดหน้าใหม่) ใช้ค่าที่เลือกอยู่ตอนนี้
    let target: PbnJobTarget | undefined;
    if (variantsEnabled) {
      const prev = jobTargetsRef.current[key];
      target = prev && pbnSiteIds.includes(prev.siteId) ? prev : (variantSites[variant - 1] ? { siteId: variantSites[variant - 1], profileId: activePbnSet } : undefined);
      if (!target) { toast.error("เลือกเว็บ PBN ของบทความนี้ก่อนเขียนใหม่"); return; }
    }
    await runBatch([makeJob(keywordId, variant, Math.max(variant, variantTotalOf(keywordId)), target)]);
  }

  /** จำนวนเวอร์ชันของ keyword นี้ในรอบล่าสุด (ใช้ตอนเขียนใหม่ทีละเวอร์ชันให้ได้มุมเขียนเดิม) */
  function variantTotalOf(keywordId: string): number {
    let max = 1;
    for (const k of Object.keys(rowStatus)) {
      const m = /^(.*)#v(\d+)$/.exec(k);
      if (m && m[1] === keywordId) max = Math.max(max, Number(m[2]));
    }
    return max;
  }

  /** key งานของ keyword นี้ที่มีสถานะในรอบนี้ (v1 ก่อน แล้ว v2, v3, ...) */
  function variantKeysOf(keywordId: string): string[] {
    const extra = Object.keys(rowStatus)
      .filter(key => key.startsWith(`${keywordId}#v`))
      .sort((a, b) => Number(a.slice(a.lastIndexOf("#v") + 2)) - Number(b.slice(b.lastIndexOf("#v") + 2)));
    return extra.length ? [keywordId, ...extra] : [keywordId];
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

  const progress = useMemo(() => {
    if (!runIds.length) return null;
    let written = 0, failed = 0, imagesDone = 0, imagesFailed = 0, imagesTotal = 0;
    for (const id of runIds) {
      const st = rowStatus[id];
      if (hasArticle(st)) written++;
      if (st?.phase === "error") failed++;
      if (st?.phase === "done") { if (st.imageError) imagesFailed++; else imagesDone++; }
      if ((st?.phase === "written" && st.imagesPending) || st?.phase === "images" || st?.phase === "done") imagesTotal++;
    }
    return { total: runIds.length, written, failed, imagesDone, imagesFailed, imagesTotal };
  }, [runIds, rowStatus]);

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
          <Button size="sm" disabled={!selected.size || running || ready === false || !pbnTargetsOk} onClick={runWriteSelected}>
            {running ? <Loader2 size={12} className="animate-spin mr-1.5" /> : <PlayCircle size={12} className="mr-1.5" />}
            {running ? (stage === "images" ? "กำลังสร้างรูป..." : "กำลังเขียน...") : `เขียน ${selected.size ? selected.size * perKeyword : ""} บทความ`}
          </Button>
        </div>
      </div>

      {variantsEnabled && (
        <div className="bg-white border border-gray-200 rounded-xl p-3 flex items-center gap-3 flex-wrap">
          <label className="text-xs font-semibold text-gray-600" htmlFor="pbn-variant-count">จำนวนบทความต่อ keyword</label>
          <select id="pbn-variant-count" value={variantCount} disabled={running}
            onChange={e => setVariantCount(Number(e.target.value))}
            className="h-8 rounded-md border border-gray-200 px-2 text-sm bg-white">
            {Array.from({ length: PBN_MAX_VARIANTS }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n} บทความ</option>)}
          </select>
          <p className="text-[11px] text-gray-400 flex-1 min-w-[220px]">
            ใช้ title + keyword เดียวกัน แต่ละบทความเขียนคนละมุม/โครงสร้าง ไม่ซ้ำกัน และยังตอบ intent เดิม — ไว้ push ขึ้นเว็บ PBN คนละเว็บ
          </p>
          <div className="w-full border-t border-gray-100 pt-3 grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-x-3 gap-y-2 items-center">
            <label className="text-xs font-semibold text-gray-600" htmlFor="pbn-write-set">ข้อมูลโปรเจกต์ (set)</label>
            <select id="pbn-write-set" value={activePbnSet} disabled={running} onChange={e => setPbnSetId(e.target.value)}
              className="h-8 rounded-md border border-gray-200 px-2 text-sm bg-white">
              <option value={PBN_MAIN_PROFILE}>set หลัก{client.website ? ` — ${client.website}` : ""}</option>
              {pbnProfiles.profiles.map(p => <option key={p.id} value={p.id}>{p.name}{p.website ? ` — ${p.website}` : ""}</option>)}
            </select>
            {Array.from({ length: perKeyword }, (_, i) => {
              const siteId = variantSites[i] || "";
              const dup = !!siteId && variantSites.slice(0, perKeyword).indexOf(siteId) !== i;
              return (
                <div key={i} className="contents">
                  <label className="text-xs font-semibold text-gray-600" htmlFor={`pbn-variant-site-${i}`}>
                    {perKeyword > 1 ? `บทความที่ ${i + 1} → เว็บ` : "เว็บที่จะ push"}
                  </label>
                  <div className="flex items-center gap-2 flex-wrap">
                    <select id={`pbn-variant-site-${i}`} value={siteId} disabled={running}
                      onChange={e => setVariantSites(prev => { const n = [...prev]; n[i] = e.target.value; return n; })}
                      className={`h-8 rounded-md border px-2 text-sm bg-white min-w-[200px] ${dup ? "border-red-300" : "border-gray-200"}`}>
                      <option value="">— เลือกเว็บ —</option>
                      {pbnSites.sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    {siteId && (
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${pbnSites.styleNames[siteId] ? "bg-violet-50 text-violet-700" : "bg-gray-50 text-gray-500"}`}>
                        สไตล์: {pbnSites.styleNames[siteId] || "สไตล์หลัก"}
                      </span>
                    )}
                    {dup && <span className="text-[11px] text-red-600">เว็บซ้ำกับบทความอื่น</span>}
                  </div>
                </div>
              );
            })}
          </div>
          {!pbnSites.loading && pbnSites.sites.length < perKeyword && (
            <p className="w-full text-[11px] text-red-600">
              มีเว็บ PBN {pbnSites.sites.length} เว็บ — เขียน {perKeyword} บทความต่อ keyword ต้องมีอย่างน้อย {perKeyword} เว็บ (1 บทความ = 1 เว็บ)
              {" "}<button type="button" onClick={() => onOpenSettings("website")} className="text-brand-blue hover:underline">เพิ่มเว็บ</button>
            </p>
          )}
          <p className="w-full text-[11px] text-gray-400">
            แต่ละบทความเขียนตามสไตล์ของเว็บที่เลือก และ push ได้เฉพาะเว็บนั้น — ตั้งสไตล์ตามเว็บได้ที่ Project Setting &gt; สไตล์บทความ
          </p>
        </div>
      )}

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

      <label className={`flex items-start gap-2 text-xs ${ctaReady ? "text-gray-700" : "text-gray-400"}`}>
        <input type="checkbox" className="mt-0.5" checked={withCta && ctaReady} disabled={!ctaReady || running}
          onChange={e => setWithCta(e.target.checked)} />
        <span>
          ใส่ CTA ในบทความ
          {ctaReady
            ? ` — สุ่มจาก ${ctaSummary.count} แบบ วาง ${ctaSummary.perArticle} จุดต่อบทความ ไม่มีค่าใช้จ่ายเพิ่ม`
            : ctaSummary?.enabled
              ? " — ตั้งค่า CTA ยังไม่ครบใน Project Setting > CTA"
              : " — ยังไม่ได้เปิดใช้ใน Project Setting > CTA"}
          {" "}<button type="button" onClick={() => onOpenSettings("cta")} className="text-brand-blue hover:underline">ตั้งค่า</button>
        </span>
      </label>

      {progress && (running || progress.failed > 0 || progress.imagesFailed > 0) && (
        <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-xs">
          <span className="text-gray-600">เขียนบทความเสร็จ <b className="text-brand-navy">{progress.written}/{progress.total}</b></span>
          {progress.imagesTotal > 0 && (
            <span className="text-gray-600">สร้างรูปเสร็จ <b className="text-brand-navy">{progress.imagesDone}/{progress.imagesTotal}</b></span>
          )}
          {progress.failed > 0 && <span className="text-rose-600">เขียนไม่สำเร็จ {progress.failed}</span>}
          {progress.imagesFailed > 0 && <span className="text-rose-600">รูปไม่ครบ {progress.imagesFailed}</span>}
        </div>
      )}
      {running && (
        <p className="text-xs text-rose-500">
          อย่าปิดแท็บนี้ระหว่าง{stage === "images" ? "สร้างรูป — รูปที่ยังไม่เริ่มจะไม่ถูกสร้าง" : "กำลังเขียนบทความ — ระบบยังเขียนฝั่งเซิร์ฟเวอร์ต่อแม้ปิดแท็บ แต่จะเห็นผลช้าลงและรูปจะไม่ถูกสร้าง"}
        </p>
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
                <th className="px-2 py-2 min-w-[260px]">สถานะ</th>
                <th className="px-2 py-2 w-24" />
              </tr>
            </thead>
            <tbody>
              {keywords.map(k => {
                const st = rowStatus[k.id];
                const variantKeys = variantKeysOf(k.id);
                if (variantKeys.length > 1) {
                  return (
                    <tr key={k.id} className="border-b border-gray-50 hover:bg-gray-50/60 align-top">
                      <td className="px-3 py-2"><input type="checkbox" checked={selected.has(k.id)} onChange={() => toggleSelect(k.id)} /></td>
                      <td className="px-2 py-2 text-brand-navy font-medium">{k.title}</td>
                      <td className="px-2 py-2 text-gray-500">{k.keyword}</td>
                      <td className="px-2 py-2" colSpan={2}>
                        <div className="space-y-1.5">
                          {variantKeys.map(key => {
                            const vst = rowStatus[key];
                            const v = key === k.id ? 1 : Number(key.slice(key.lastIndexOf("#v") + 2));
                            return (
                              <div key={key} className="flex items-start gap-2">
                                <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-brand-mist text-brand-blue">v{v}</span>
                                {variantsEnabled && jobTargetsRef.current[key] && (
                                  <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 max-w-[120px] truncate">
                                    {pbnSites.sites.find(s => s.id === jobTargetsRef.current[key].siteId)?.name || "เว็บที่ถูกลบ"}
                                  </span>
                                )}
                                <div className="flex-1 min-w-0">
                                  <StatusCell status={vst} keyword={v === 1 ? k : { ...k, articleId: undefined, writeError: undefined }} imageSummary={imageSummary} />
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {hasArticle(vst) && (
                                    <button onClick={() => goToReview(vst.articleId)} className="text-brand-blue hover:underline flex items-center gap-0.5 whitespace-nowrap">
                                      Review <ArrowRight size={11} />
                                    </button>
                                  )}
                                  {vst?.phase === "error" && (
                                    <button disabled={running || ready === false} onClick={() => retryJob(key)} className="text-brand-blue hover:underline disabled:text-gray-300 disabled:no-underline flex items-center gap-0.5 whitespace-nowrap">
                                      <RefreshCw size={10} /> เขียนใหม่
                                    </button>
                                  )}
                                  {vst?.phase === "done" && vst.imageError && (
                                    <button disabled={running} onClick={() => retryImages(key, vst.articleId)} className="text-brand-blue hover:underline disabled:text-gray-300 disabled:no-underline flex items-center gap-0.5 whitespace-nowrap">
                                      <ImageIcon size={10} /> สร้างรูปใหม่
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={k.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                    <td className="px-3 py-2"><input type="checkbox" checked={selected.has(k.id)} onChange={() => toggleSelect(k.id)} /></td>
                    <td className="px-2 py-2 text-brand-navy font-medium">{k.title}</td>
                    <td className="px-2 py-2 text-gray-500">{k.keyword}</td>
                    <td className="px-2 py-2">
                      <StatusCell status={st} keyword={k} imageSummary={imageSummary} />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <div className="flex flex-col items-end gap-1">
                        {(hasArticle(st) || (k.articleId && !st)) && (
                          <button onClick={() => goToReview(hasArticle(st) ? st.articleId : k.articleId!)} className="text-brand-blue hover:underline flex items-center gap-0.5 whitespace-nowrap">
                            ไป Review <ArrowRight size={11} />
                          </button>
                        )}
                        {st?.phase === "error" && (
                          <button disabled={running || ready === false} onClick={() => retryJob(k.id)} className="text-brand-blue hover:underline disabled:text-gray-300 disabled:no-underline flex items-center gap-0.5 whitespace-nowrap">
                            <RefreshCw size={10} /> เขียนใหม่
                          </button>
                        )}
                        {st?.phase === "done" && st.imageError && (
                          <button disabled={running} onClick={() => retryImages(k.id, st.articleId)} className="text-brand-blue hover:underline disabled:text-gray-300 disabled:no-underline flex items-center gap-0.5 whitespace-nowrap">
                            <ImageIcon size={10} /> สร้างรูปใหม่
                          </button>
                        )}
                      </div>
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
            const parsed = parseWriterSourceName(a.sourceName);
            const kwKey = parsed ? jobKey(parsed.keywordId, parsed.variant) : null;
            return (
              <div key={a.id} className="flex items-center justify-between text-xs gap-2">
                <span className="truncate">{a.title || a.id} — ค้าง</span>
                {kwKey && (
                  <Button size="sm" variant="outline" disabled={running} onClick={() => retryJob(kwKey)}>
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

function StatusCell({ status: st, keyword, imageSummary }: { status?: RowStatus; keyword: UploadKeyword; imageSummary: string }) {
  const line = (icon: ReactNode, cls: string, text: ReactNode, title?: string) => (
    <span className={`flex items-start gap-1 ${cls}`} title={title}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>{text}</span>
    </span>
  );
  const spin = <Loader2 size={11} className="animate-spin" />;
  if (!st) {
    if (keyword.articleId) return line(<CheckCircle2 size={11} />, "text-emerald-600", "เขียนแล้ว");
    if (keyword.writeError) return line(<AlertCircle size={11} />, "text-rose-600", `รอบก่อนเขียนไม่สำเร็จ — เลือกแล้วกดเขียนใหม่`);
    return <span className="text-gray-400">ยังไม่เขียน</span>;
  }
  switch (st.phase) {
    case "idle":
    case "queued":
      return line(<Clock size={11} />, "text-gray-500", "รอคิวเขียน");
    case "writing":
      return line(spin, "text-brand-blue", `กำลังเขียนบทความ${st.attempt > 1 ? ` (ลองใหม่ครั้งที่ ${st.attempt})` : ""} · ${st.elapsed}s · ${st.chars.toLocaleString()} ตัวอักษร`);
    case "retrying":
      return line(spin, "text-amber-600", `${st.reason} — กำลังลองเขียนใหม่อัตโนมัติ...`);
    case "written":
      return st.imagesPending
        ? line(<CheckCircle2 size={11} />, "text-gray-600", <>เขียนบทความเสร็จ · <span className="text-gray-500">รอคิวสร้างรูป</span></>)
        : line(<CheckCircle2 size={11} />, "text-emerald-600", "เขียนบทความเสร็จ");
    case "images":
      return line(spin, "text-brand-blue", <>เขียนบทความเสร็จ · กำลังสร้าง{st.step === "cover" ? "รูปปก" : "รูปประกอบ"}...{imageSummary && <span className="text-gray-400"> ({imageSummary})</span>}</>);
    case "done": {
      const made = [st.cover ? "ปก" : "", st.inline ? `รูปประกอบ ${st.inline} รูป` : ""].filter(Boolean).join(" + ");
      if (st.imageError) {
        return (
          <span className="flex flex-col gap-0.5">
            {line(<CheckCircle2 size={11} />, "text-emerald-600", `เขียนบทความเสร็จ${made ? ` · ได้${made}` : ""}`)}
            {line(<AlertCircle size={11} />, "text-rose-600", `สร้างรูปไม่สำเร็จ: ${st.imageError}`)}
          </span>
        );
      }
      return line(<CheckCircle2 size={11} />, "text-emerald-600", `เสร็จทั้งหมด · บทความ${made ? ` + ${made}` : ""}`);
    }
    case "error":
      return line(<AlertCircle size={11} />, "text-rose-600", `เขียนบทความไม่สำเร็จ: ${st.message}`, st.detail);
    case "disconnected":
      return line(spin, "text-amber-600", "ขาดการเชื่อมต่อ — ระบบยังเขียนต่อฝั่งเซิร์ฟเวอร์ กำลังรอผล...");
  }
}
