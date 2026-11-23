"use client";

/**
 * Upload Article > Report > "Keyword ที่ติดตาม" — รายการที่ทีมกด "บันทึก Monitor" ไว้
 * ติดตามได้ 3 แบบ: keyword อย่างเดียว (ทั้งเว็บ), บทความ/URL อย่างเดียว (ทุกคำค้นหา), หรือ keyword + หน้า
 * แสดงผล GSC รายวันของแต่ละรายการเป็นกราฟเส้น (ดึงเฉพาะตอนแท็บนี้ถูกเปิด เพื่อไม่เปลืองโควตา GSC)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, BookmarkPlus, ChevronDown, ChevronsDownUp, ChevronsUpDown, Folder, FolderInput, FolderOpen, FolderPlus, Link2, ListTree, Loader2, Pencil, Plus, RefreshCw, Trash2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import GscKeywordSuggestDialog, { termFromGroupName } from "./GscKeywordSuggestDialog";
import { AreaChart, EmptyState, Panel, Segmented } from "@/components/ds";
import {
  UPLOAD_MAX_GSC_TRACKERS, UPLOAD_MAX_TRACKER_GROUP, UPLOAD_MAX_TRACKER_KEYWORD, UPLOAD_MAX_TRACKER_URL, trackerKind, aggregateTrackerPerformance, withSimilarTotals,
  type GscQuerySeriesResponse, type GscSimilarKeyword, type GscTrackerKind, type GscTrackerPerformance, type GscTrackerPerformanceResponse,
  type UploadGscTracker, type UploadGscTrackerFolder,
} from "@/lib/upload-article/gsc-trackers";
import type { UploadOwnerTag } from "@/lib/upload-article/types";

/** ค่าพิเศษของตัวกรองผู้ดูแล: "" = ทุกคน, NO_OWNER = รายการที่ยังไม่ระบุผู้ดูแล */
const NO_OWNER = "__none__";

/** กลุ่มที่ย่อไว้ (เก็บชื่อกลุ่ม, "" = ไม่มีกลุ่ม) จำแยกต่อลูกค้าในเบราว์เซอร์นี้ — ไม่มี/อ่านไม่ได้ = ขยายทั้งหมด */
function collapsedStorageKey(clientId: string): string { return `mars_tracker_groups_collapsed_${clientId}`; }
function readCollapsed(clientId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(collapsedStorageKey(clientId));
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}
function writeCollapsed(clientId: string, ids: Set<string>) {
  try { window.localStorage.setItem(collapsedStorageKey(clientId), JSON.stringify(Array.from(ids))); } catch { /* ไม่มีที่เก็บ — ใช้ได้แค่รอบนี้ */ }
}

/** Keyword groups (subgroups) that are open — closed by default, since an open one draws a chart. Per client, this browser only. */
function openSubsStorageKey(clientId: string): string { return `mars_tracker_subgroups_open_${clientId}`; }
function readOpenSubs(clientId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(openSubsStorageKey(clientId));
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}
function writeOpenSubs(clientId: string, ids: Set<string>) {
  try { window.localStorage.setItem(openSubsStorageKey(clientId), JSON.stringify(Array.from(ids))); } catch { /* no storage: this visit only */ }
}
const NO_FOLDERS: UploadGscTrackerFolder[] = [];
/** A keyword-group entry that is a page link rather than a keyword */
export function looksLikeUrl(text: string): boolean { return /^https?:\/\//i.test(text.trim()); }

/** Key of a keyword group inside a project folder. Starts with a space like the owner keys, so it never equals a folder name. */
function subKey(folder: string, sub: string): string { return ` sub:${JSON.stringify([folder, sub])}`; }

export interface TrackerArticleOption { title: string; url: string }
export interface TrackerDraft { keyword: string; url?: string; title?: string }

type Metric = "clicks" | "impressions" | "ctr" | "position";

const METRIC_NAME: Record<Metric, string> = { clicks: "คลิก", impressions: "การแสดงผล", ctr: "CTR", position: "อันดับเฉลี่ย" };

/** ค่าของวันนั้นตามตัวชี้วัด — CTR/อันดับ ของวันที่ไม่มีการแสดงผลเป็นช่องว่าง (ไม่ใช่ 0 ที่ทำให้กราฟเข้าใจผิด) */
function dailyValue(d: { clicks: number; impressions: number; ctr: number; position: number }, metric: Metric): number | null {
  if (metric === "clicks") return d.clicks;
  if (metric === "impressions") return d.impressions;
  if (!(d.impressions > 0)) return null;
  return metric === "ctr" ? d.ctr * 100 : d.position;
}
/** โหมดของฟอร์ม — "บทความ" กับ "URL" เก็บเป็นชนิด page เหมือนกัน ต่างกันแค่วิธีเลือกหน้า */
type Mode = "keyword" | "article" | "url" | "pair";

const MODE_OPTIONS: { value: Mode; label: string }[] = [
  { value: "keyword", label: "Keyword" },
  { value: "article", label: "บทความ" },
  { value: "url", label: "URL" },
  { value: "pair", label: "Keyword + หน้า" },
];

const MODE_HINT: Record<Mode, string> = {
  keyword: "ดูผลของ keyword นี้ทั้งเว็บ (ทุกหน้าที่ติดอันดับ)",
  article: "ดูผลของบทความนี้จากทุก keyword ที่คนค้นเจอ",
  url: "ดูผลของหน้านี้จากทุก keyword — ใส่ลิงก์เต็มของหน้า",
  pair: "ดูผลของ keyword นี้บนหน้านี้เท่านั้น",
};

const KIND_BADGE: Record<GscTrackerKind, string> = {
  keyword: "Keyword · ทั้งเว็บ",
  page: "หน้า · ทุก keyword",
  pair: "Keyword + หน้า",
};

function fmtNum(n: number): string { return Math.round(n).toLocaleString(); }
function fmtCtr(n: number): string { return `${(n * 100).toFixed(2)}%`; }
function fmtPos(n: number): string { return n ? n.toFixed(1) : "—"; }
function fmtDm(raw: string): string {
  const p = raw.split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}` : raw;
}

/** ตัวเลขเปลี่ยนแปลงเทียบช่วงก่อนหน้า — good = ทิศทางที่ดี (อันดับ: ต่ำลงคือดี) */
function Delta({ diff, text, lowerIsBetter }: { diff: number; text: string; lowerIsBetter?: boolean }) {
  if (!diff) return <span className="text-gray-400">—</span>;
  const good = lowerIsBetter ? diff < 0 : diff > 0;
  return <span className={good ? "text-emerald-600" : "text-red-500"}>{diff > 0 ? "+" : ""}{text}</span>;
}

function Stat({ label, value, change }: { label: string; value: string; change: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white/60 border border-gray-100 px-3 py-2">
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className="text-sm font-semibold tabular-nums text-brand-navy">{value}</p>
      <p className="text-[11px] tabular-nums">{change}</p>
    </div>
  );
}

export default function GscTrackedKeywords({
  clientId, trackers, onTrackersChange, articles, periodParams, draft, onDraftConsumed, ownerTags = [], defaultOwnerTagId = "",
  foldersEnabled = false, folders = NO_FOLDERS, onFoldersChange,
}: {
  clientId: string;
  /** Convert Cake only: project folders (created empty, with an owner) holding keyword groups with their own combined chart */
  foldersEnabled?: boolean;
  /** Folder records (pushPrefs.gscTrackerFolders), loaded by the parent when foldersEnabled */
  folders?: UploadGscTrackerFolder[];
  onFoldersChange?: (folders: UploadGscTrackerFolder[]) => void;
  /** ผู้ดูแลที่ทีมตั้งไว้ในหน้า Report — ใช้ระบุและกรองผู้ดูแลของแต่ละรายการ */
  ownerTags?: UploadOwnerTag[];
  /** ผู้ดูแลที่เลือกไว้ตอนเพิ่มรายการใหม่ (เช่น ผู้ดูแลที่กรองรายงานอยู่) */
  defaultOwnerTagId?: string;
  trackers: UploadGscTracker[];
  onTrackersChange: (trackers: UploadGscTracker[]) => void;
  articles: TrackerArticleOption[];
  /** ช่วงวัน/เทียบ/ประเภท — ชุดเดียวกับที่ loadReport ส่ง (ไม่รวมผู้ดูแล) */
  periodParams: Record<string, unknown>;
  draft?: TrackerDraft | null;
  onDraftConsumed?: () => void;
}) {
  const base = `/api/upload-article/clients/${clientId}/report/trackers`;

  // ── ฟอร์มเพิ่ม ──
  const [mode, setMode] = useState<Mode>("keyword");
  const [keyword, setKeyword] = useState("");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [formOwner, setFormOwner] = useState(defaultOwnerTagId);
  const [formGroup, setFormGroup] = useState("");
  const [formSubgroup, setFormSubgroup] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);

  const ownerIds = useMemo(() => new Set(ownerTags.map((t) => t.id)), [ownerTags]);
  const ownerName = useCallback((id?: string) => (id ? ownerTags.find((t) => t.id === id)?.name : undefined), [ownerTags]);

  // ผู้ดูแลที่เลือกในฟอร์มถูกลบไปแล้ว → กลับเป็นไม่ระบุ
  useEffect(() => {
    if (formOwner && !ownerIds.has(formOwner)) setFormOwner("");
  }, [ownerIds, formOwner]);
  useEffect(() => { if (defaultOwnerTagId && ownerIds.has(defaultOwnerTagId)) setFormOwner(defaultOwnerTagId); }, [defaultOwnerTagId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ปิดรายการบทความเมื่อคลิกนอกกล่อง / กด Esc
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPickerOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [pickerOpen]);

  // ร่างจากแท็บอื่น (เช่นกด "ติดตาม" ที่คำค้นหา) → เติมฟอร์มแล้วแจ้งผู้ปกครองว่าใช้แล้ว
  useEffect(() => {
    if (!draft) return;
    setMode(draft.url ? "pair" : "keyword");
    setKeyword(draft.keyword);
    if (draft.url !== undefined) setUrl(draft.url);
    setTitle(draft.title ?? "");
    onDraftConsumed?.();
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredArticles = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    const list = q ? articles.filter((a) => `${a.title} ${a.url}`.toLowerCase().includes(q)) : articles;
    return list.slice(0, 50);
  }, [articles, pickerQuery]);

  function changeMode(m: Mode) {
    setMode(m);
    setPickerOpen(false);
    // สลับระหว่าง "บทความ" กับ "URL": URL ที่พิมพ์เองไม่ใช่บทความที่เลือก จึงล้างทิ้ง
    if (m === "article" && !title) setUrl("");
  }

  async function submit() {
    if (saving) return;
    const kw = keyword.trim();
    const u = url.trim();
    const needKeyword = mode === "keyword" || mode === "pair";
    if (needKeyword && !kw) { toast.error("กรอก keyword ที่ต้องการติดตาม"); return; }
    if (mode === "article" && !u) { toast.error("เลือกบทความที่ต้องการติดตาม"); return; }
    if (mode === "url" && !u) { toast.error("กรอก URL ของหน้าที่ต้องการติดตาม"); return; }
    if (mode === "pair" && !u) { toast.error("เลือกบทความหรือกรอก URL ของหน้าที่ต้องการติดตาม"); return; }
    const kind: GscTrackerKind = mode === "keyword" ? "keyword" : mode === "pair" ? "pair" : "page";
    const payload: Record<string, string> = { kind };
    if (formOwner) payload.ownerTagId = formOwner;
    if (formGroup.trim()) payload.group = formGroup.trim();
    if (foldersEnabled && formGroup.trim() && formSubgroup.trim()) payload.subgroup = formSubgroup.trim();
    if (kind !== "page") payload.keyword = kw;
    if (kind !== "keyword") { payload.url = u; if (title) payload.title = title; }
    setSaving(true);
    try {
      const r = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "บันทึก Monitor ไม่สำเร็จ"); return; }
      if (Array.isArray(d.trackers)) onTrackersChange(d.trackers);
      toast.success("บันทึก Monitor แล้ว");
      setKeyword(""); setUrl(""); setTitle(""); setPickerQuery("");
    } catch (e) {
      toast.error(`บันทึก Monitor ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  // ── สวิตช์ตัวชี้วัด + ผลรายวัน ──
  const [metric, setMetric] = useState<Metric>("clicks");
  const [perf, setPerf] = useState<GscTrackerPerformance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const reqSeq = useRef(0);

  const idsKey = trackers.map((t) => t.id).join(",");
  const periodKey = JSON.stringify(periodParams);

  const loadPerformance = useCallback(async () => {
    const seq = ++reqSeq.current;
    if (!idsKey) { setPerf([]); setError(""); setLoading(false); return; }
    setLoading(true);
    setError("");
    try {
      const r = await fetch(`${base}/performance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: periodKey,
      });
      const d = await r.json().catch(() => ({}));
      if (seq !== reqSeq.current) return;
      if (!r.ok) { setError(d?.error || "ดึงข้อมูล Monitor ไม่สำเร็จ"); return; }
      setPerf((d as GscTrackerPerformanceResponse).trackers ?? []);
    } catch (e) {
      if (seq !== reqSeq.current) return;
      setError(`ดึงข้อมูล Monitor ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }, [base, idsKey, periodKey]);

  useEffect(() => { void loadPerformance(); }, [loadPerformance]);

  const perfById = useMemo(() => new Map(perf.map((p) => [p.id, p])), [perf]);

  // ── กรองตามผู้ดูแล ── (ผู้ดูแลที่ถูกลบไปแล้ว = ยังไม่ระบุ)
  const [ownerFilter, setOwnerFilter] = useState("");
  useEffect(() => {
    if (ownerFilter && ownerFilter !== NO_OWNER && !ownerIds.has(ownerFilter)) setOwnerFilter("");
  }, [ownerIds, ownerFilter]);
  const effectiveOwner = useCallback((t: UploadGscTracker) => (t.ownerTagId && ownerIds.has(t.ownerTagId) ? t.ownerTagId : ""), [ownerIds]);
  // ── project folders (Convert Cake only) ──
  const foldersBase = `/api/upload-article/clients/${clientId}/report/tracker-folders`;
  const folderByName = useMemo(() => new Map(folders.map((f) => [f.name, f])), [folders]);
  const folderOwner = useCallback((name: string) => {
    const id = folderByName.get(name)?.ownerTagId;
    return id && ownerIds.has(id) ? id : "";
  }, [folderByName, ownerIds]);

  const visibleTrackers = useMemo(() => {
    if (!ownerFilter) return trackers;
    return trackers.filter((t) => (ownerFilter === NO_OWNER ? !effectiveOwner(t) : effectiveOwner(t) === ownerFilter));
  }, [trackers, ownerFilter, effectiveOwner]);
  const ownerCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of trackers) { const o = effectiveOwner(t) || NO_OWNER; m.set(o, (m.get(o) ?? 0) + 1); }
    return m;
  }, [trackers, effectiveOwner]);

  // ── กลุ่ม + แถวที่เปิดกราฟ + เลือกหลายแถว ──
  const groupNames = useMemo(() => {
    const set = new Set<string>();
    for (const t of trackers) if (t.group) set.add(t.group);
    for (const f of folders) set.add(f.name);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "th", { numeric: true }));
  }, [trackers, folders]);
  const subgroupNames = useMemo(() => {
    const set = new Set<string>();
    for (const t of trackers) {
      if (!t.group) continue;
      if (t.subgroup) set.add(t.subgroup);
      // Convert Cake: a keyword tracked directly in a folder is a keyword group of its own name
      else if (foldersEnabled && t.keyword && !t.url) set.add(t.keyword);
    }
    for (const f of folders) for (const sub of f.subgroups) set.add(sub);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "th", { numeric: true }));
  }, [trackers, folders, foldersEnabled]);
  // แถวที่ไม่มีกลุ่มแยกตามผู้ดูแล หัวเป็นชื่อผู้ดูแล — key ขึ้นต้นด้วยตัวคั่นที่ชื่อกลุ่มจริงมีไม่ได้ (ชื่อกลุ่มถูกตัดช่องว่างหัวท้าย) จึงไม่ชนกัน
  // name = ชื่อกลุ่มจริง ('' = ไม่มีกลุ่ม), label = ข้อความบนหัว, key = ใช้จำการพับ
  const groups = useMemo(() => {
    const byName = new Map<string, UploadGscTracker[]>();
    const byOwner = new Map<string, UploadGscTracker[]>();
    const loose: UploadGscTracker[] = [];
    for (const t of visibleTrackers) {
      const owner = effectiveOwner(t);
      const [m, k] = t.group ? [byName, t.group] : owner ? [byOwner, owner] : [null, ""];
      if (!m) { loose.push(t); continue; }
      const list = m.get(k);
      if (list) list.push(t); else m.set(k, [t]);
    }
    const sortTh = (a: string, b: string) => a.localeCompare(b, "th", { numeric: true });
    // กลุ่มที่มีชื่อแตกเป็นกลุ่มย่อย (เรียงชื่อ) + รายการที่ไม่มีกลุ่มย่อยต่อท้าย
    // key กลุ่มย่อยขึ้นต้นด้วยช่องว่างเหมือน key ผู้ดูแล จึงไม่ชนชื่อกลุ่มจริง
    type Sub = { key: string; name: string; items: UploadGscTracker[] };
    const splitSubs = (group: string, items: UploadGscTracker[]): { subs: Sub[]; direct: UploadGscTracker[] } => {
      if (!foldersEnabled) return { subs: [], direct: items };
      const bySub = new Map<string, UploadGscTracker[]>();
      for (const sub of folderByName.get(group)?.subgroups ?? []) bySub.set(sub, []);
      const direct: UploadGscTracker[] = [];
      for (const t of items) {
        if (!t.subgroup) { direct.push(t); continue; }
        const list = bySub.get(t.subgroup);
        if (list) list.push(t); else bySub.set(t.subgroup, [t]);
      }
      const subs = Array.from(bySub.keys()).sort(sortTh)
        .map((name) => ({ key: subKey(group, name), name, items: bySub.get(name)! }));
      return { subs, direct };
    };
    // empty project folders (and ones whose keywords the owner filter hides) still show when their owner matches the filter
    for (const f of folders) {
      if (byName.has(f.name)) continue;
      const fo = f.ownerTagId && ownerIds.has(f.ownerTagId) ? f.ownerTagId : "";
      if (!ownerFilter || (ownerFilter === NO_OWNER ? !fo : fo === ownerFilter)) byName.set(f.name, []);
    }
    const out: { key: string; name: string; label: string; items: UploadGscTracker[]; subs: Sub[]; direct: UploadGscTracker[] }[] = Array.from(byName.keys()).sort(sortTh)
      .map((g) => ({ key: g, name: g, label: g, items: byName.get(g)!, ...splitSubs(g, byName.get(g)!) }));
    const owners = Array.from(byOwner.keys()).map((id) => ({ id, label: ownerName(id) ?? "ผู้ดูแล" })).sort((a, b) => sortTh(a.label, b.label));
    for (const o of owners) out.push({ key: ` owner:${o.id}`, name: "", label: o.label, items: byOwner.get(o.id)!, subs: [], direct: byOwner.get(o.id)! });
    if (loose.length) out.push({ key: "", name: "", label: "ไม่มีกลุ่ม", items: loose, subs: [], direct: loose });
    return out;
  }, [visibleTrackers, effectiveOwner, ownerName, foldersEnabled, folders, folderByName, ownerFilter, ownerIds]);

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  useEffect(() => { setCollapsedGroups(readCollapsed(clientId)); }, [clientId]);
  function toggleGroup(g: string) {
    const next = new Set(collapsedGroups);
    if (next.has(g)) next.delete(g); else next.add(g);
    setCollapsedGroups(next);
    writeCollapsed(clientId, next);
  }
  const allGroupsCollapsed = groups.length > 0 && groups.every((g) => collapsedGroups.has(g.key));
  function setAllGroups(collapse: boolean) {
    const next = new Set(collapsedGroups);
    for (const g of groups) { if (collapse) next.add(g.key); else next.delete(g.key); }
    setCollapsedGroups(next);
    writeCollapsed(clientId, next);
  }

  const [openSubs, setOpenSubs] = useState<Set<string>>(() => new Set());
  useEffect(() => { setOpenSubs(readOpenSubs(clientId)); }, [clientId]);
  function setSubOpen(key: string, open: boolean) {
    setOpenSubs((prev) => {
      if (prev.has(key) === open) return prev;
      const next = new Set(prev);
      if (open) next.add(key); else next.delete(key);
      writeOpenSubs(clientId, next);
      return next;
    });
  }

  const [subDrafts, setSubDrafts] = useState<Record<string, string>>({});

  const [openRows, setOpenRows] = useState<Set<string>>(() => new Set());
  function toggleRow(id: string) {
    setOpenRows((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  // คำใกล้เคียงพับไว้ก่อนเสมอ (กินพื้นที่) — เปิดทีละรายการจากป้าย "คำใกล้เคียง N" หรือเปิด/ปิดทั้งหมดจากแถบบน
  const [openSimilar, setOpenSimilar] = useState<Set<string>>(() => new Set());
  function toggleSimilar(id: string) {
    setOpenSimilar((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  const similarIds = useMemo(
    () => visibleTrackers.filter((t) => { const p = perfById.get(t.id); return !!p && !p.unresolved && (p.similar?.length ?? 0) > 0; }).map((t) => t.id),
    [visibleTrackers, perfById],
  );
  const allSimilarOpen = similarIds.length > 0 && similarIds.every((id) => openSimilar.has(id));

  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  // รายการที่ถูกลบ/ซ่อนด้วยตัวกรอง ไม่นับว่าเลือกอยู่
  useEffect(() => {
    const visible = new Set(visibleTrackers.map((t) => t.id));
    setSelected((prev) => {
      const next = new Set(Array.from(prev).filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [visibleTrackers]);
  function toggleSelect(ids: string[], on: boolean) {
    setSelected((prev) => { const next = new Set(prev); for (const id of ids) { if (on) next.add(id); else next.delete(id); } return next; });
  }

  const [busy, setBusy] = useState(false);
  /** แก้ผู้ดูแล/กลุ่มของหลายรายการ — patch มีเฉพาะช่องที่จะเปลี่ยน */
  async function patchTrackers(ids: string[], patch: { ownerTagId?: string; group?: string; subgroup?: string }, okText?: string): Promise<boolean> {
    if (ids.length === 0) return false;
    setBusy(true);
    try {
      const r = await fetch(base, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, ...patch }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "บันทึกไม่สำเร็จ"); return false; }
      if (Array.isArray(d.trackers)) onTrackersChange(d.trackers);
      if (okText) toast.success(okText);
      return true;
    } catch (e) {
      toast.error(`บันทึกไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function removeMany(ids: string[], label: string) {
    if (ids.length === 0 || !window.confirm(`เลิกติดตาม ${label}?`)) return;
    setBusy(true);
    try {
      const r = await fetch(`${base}?ids=${encodeURIComponent(ids.join(","))}`, { method: "DELETE" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "ลบไม่สำเร็จ"); return; }
      if (Array.isArray(d.trackers)) onTrackersChange(d.trackers);
      toast.success("เลิกติดตามแล้ว");
    } catch (e) {
      toast.error(`ลบไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  function remove(t: UploadGscTracker) {
    const kind = trackerKind(t);
    const label = kind === "keyword" ? `keyword "${t.keyword}" (ทั้งเว็บ)`
      : kind === "page" ? `หน้า "${t.title || t.url}"`
      : `"${t.keyword}" ของหน้านี้`;
    void removeMany([t.id], label);
  }

  // "หาคำใกล้เคียง": null = ปิด; term/group = ค่าเริ่มต้นตามปุ่มที่กด
  const [suggest, setSuggest] = useState<{ term: string; group: string; subgroup?: string } | null>(null);

  async function renameGroup(oldName: string, ids: string[]) {
    const next = window.prompt("ชื่อกลุ่มใหม่ (เว้นว่าง = เอาออกจากกลุ่ม)", oldName);
    if (next === null || next.trim() === oldName) return;
    await patchTrackers(ids, { group: next }, next.trim() ? "เปลี่ยนชื่อกลุ่มแล้ว" : "เอาออกจากกลุ่มแล้ว");
  }

  /** Folder/keyword-group change on the server (Convert Cake only); updates folders and trackers together */
  async function folderOp(op: Record<string, unknown>, okText?: string): Promise<boolean> {
    setBusy(true);
    try {
      const r = await fetch(foldersBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(op),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "บันทึกไม่สำเร็จ"); return false; }
      if (Array.isArray(d.folders)) onFoldersChange?.(d.folders);
      if (Array.isArray(d.trackers)) onTrackersChange(d.trackers);
      if (okText) toast.success(okText);
      return true;
    } catch (e) {
      toast.error(`บันทึกไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      setBusy(false);
    }
  }

  // new project folder form
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderOwner, setNewFolderOwner] = useState("");
  async function createFolder() {
    const name = newFolderName.trim();
    if (!name) { toast.error("ตั้งชื่อโฟลเดอร์ก่อน"); return; }
    const ok = await folderOp({ op: "create", name, ownerTagId: newFolderOwner }, `สร้างโฟลเดอร์ "${name}" แล้ว`);
    if (ok) { setNewFolderName(""); setNewFolderOpen(false); }
  }

  async function renameFolder(oldName: string) {
    const next = window.prompt("ชื่อโฟลเดอร์ใหม่", oldName);
    if (next === null || !next.trim() || next.trim() === oldName) return;
    await folderOp({ op: "rename", folder: oldName, name: next }, "เปลี่ยนชื่อโฟลเดอร์แล้ว");
  }

  async function deleteFolder(name: string, count: number) {
    const msg = count > 0
      ? `ลบโฟลเดอร์ "${name}"? keyword ${count} รายการข้างในยังติดตามอยู่ แค่ย้ายออกจากโฟลเดอร์`
      : `ลบโฟลเดอร์ "${name}"?`;
    if (!window.confirm(msg)) return;
    await folderOp({ op: "delete", folder: name }, "ลบโฟลเดอร์แล้ว");
  }

  /** New keyword group in a folder; keywords ticked in that folder move into it */
  async function createSubgroup(folder: string, items: UploadGscTracker[]) {
    const ids = items.filter((t) => selected.has(t.id)).map((t) => t.id);
    const name = window.prompt(
      ids.length ? `ชื่อกลุ่ม keyword ใน "${folder}" (ย้าย ${ids.length} รายการที่ติ๊กไว้เข้าไปด้วย)` : `ชื่อกลุ่ม keyword ใน "${folder}"`, "");
    if (name === null || !name.trim()) return;
    const ok = await folderOp({ op: "createSub", folder, subgroup: name, ...(ids.length ? { ids } : {}) }, `สร้างกลุ่ม keyword "${name.trim()}" แล้ว`);
    if (ok) {
      if (ids.length) toggleSelect(ids, false);
      setSubOpen(subKey(folder, name.normalize("NFC").replace(/\s+/g, " ").trim()), true);
    }
  }

  async function renameSubgroup(folder: string, oldName: string) {
    const next = window.prompt("ชื่อกลุ่ม keyword ใหม่", oldName);
    if (next === null || !next.trim() || next.trim() === oldName) return;
    await folderOp({ op: "renameSub", folder, subgroup: oldName, name: next }, "เปลี่ยนชื่อกลุ่ม keyword แล้ว");
  }

  async function deleteSubgroup(folder: string, name: string, count: number) {
    const msg = count > 0
      ? `ลบกลุ่ม keyword "${name}"? keyword ${count} รายการข้างในยังติดตามอยู่ในโฟลเดอร์ "${folder}"`
      : `ลบกลุ่ม keyword "${name}"?`;
    if (!window.confirm(msg)) return;
    await folderOp({ op: "deleteSub", folder, subgroup: name }, "ลบกลุ่ม keyword แล้ว");
  }

  /** Turn one tracked keyword into a keyword group of the same name, with itself inside */
  async function keywordToGroup(t: UploadGscTracker): Promise<boolean> {
    if (!t.group) return false;
    const exists = (folderByName.get(t.group)?.subgroups ?? []).includes(t.keyword) || trackers.some((x) => x.group === t.group && x.subgroup === t.keyword);
    const ok = exists
      ? await patchTrackers([t.id], { subgroup: t.keyword }, `ย้ายเข้ากลุ่ม keyword "${t.keyword}" แล้ว`)
      : await folderOp({ op: "createSub", folder: t.group, subgroup: t.keyword, ids: [t.id] }, `สร้างกลุ่ม keyword "${t.keyword}" แล้ว`);
    if (ok) setSubOpen(subKey(t.group, t.keyword), true);
    return ok;
  }

  /**
   * "+" on a similar keyword: start monitoring it inside the tracker's keyword group. A tracker that sits
   * in a folder but not yet in a keyword group becomes a keyword group of its own name first.
   */
  async function addSimilarToGroup(t: UploadGscTracker, keyword: string) {
    if (!t.group) return;
    let sub = t.subgroup || "";
    if (!sub) {
      if (!(await keywordToGroup(t))) return;
      sub = t.keyword;
    }
    await addToSubgroup(t.group, sub, [keyword]);
  }

  /** Add keywords (site-wide) and/or page links into a keyword group; owner = the folder's owner */
  async function addToSubgroup(folder: string, sub: string, entries: string[]): Promise<boolean> {
    const urls = entries.filter(looksLikeUrl);
    const keywords = entries.filter((e) => !looksLikeUrl(e));
    if (entries.length === 0) return false;
    setBusy(true);
    try {
      const owner = folderOwner(folder);
      const common = { group: folder, subgroup: sub, ...(owner ? { ownerTagId: owner } : {}) };
      let added = 0, skipped = 0, lastError = "";
      let latest: UploadGscTracker[] | null = null;
      if (keywords.length) {
        const r = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keywords, ...common }) });
        const d = await r.json().catch(() => ({}));
        if (Array.isArray(d.trackers)) latest = d.trackers;
        if (r.ok) { added += d.added ?? 0; skipped += (d.duplicates ?? 0) + (d.invalid ?? 0) + (d.overLimit ?? 0); }
        else { skipped += keywords.length; lastError = d?.error || "เพิ่ม keyword ไม่สำเร็จ"; }
      }
      for (const url of urls) {
        const r = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "page", url, ...common }) });
        const d = await r.json().catch(() => ({}));
        if (Array.isArray(d.trackers)) latest = d.trackers;
        if (r.ok) added += 1; else { skipped += 1; lastError = d?.error || "เพิ่มหน้าเว็บไม่สำเร็จ"; }
      }
      if (latest) onTrackersChange(latest);
      if (added === 0) { toast.error(lastError || "ไม่มีรายการที่เพิ่มได้"); return false; }
      toast.success(`เพิ่ม ${added} รายการแล้ว${skipped ? ` (ข้าม ${skipped} รายการที่ติดตามอยู่แล้ว/ใช้ไม่ได้)` : ""}`);
      return true;
    } catch (e) {
      toast.error(`เพิ่มไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      setBusy(false);
    }
  }

  // แถบจัดการหลายรายการ
  const [bulkGroup, setBulkGroup] = useState("");
  const [bulkSubgroup, setBulkSubgroup] = useState("");
  const selectedIds = Array.from(selected);
  const selectedInGroup = trackers.filter((t) => selected.has(t.id) && t.group);
  const selectedHasSubgroup = selectedInGroup.some((t) => t.subgroup);
  /** ย้ายรายการที่เลือกเข้ากลุ่ม/กลุ่มย่อย — กรอกแค่กลุ่มย่อย = ย้ายเฉพาะรายการที่อยู่ในกลุ่มแล้ว */
  async function bulkMove() {
    const g = bulkGroup.trim();
    const sub = foldersEnabled ? bulkSubgroup.trim() : "";
    let ok: boolean;
    if (g) {
      ok = await patchTrackers(selectedIds, foldersEnabled ? { group: g, subgroup: sub } : { group: g }, sub ? `ย้ายเข้า "${g}" › "${sub}" แล้ว` : `ย้ายเข้ากลุ่ม "${g}" แล้ว`);
    } else {
      const ids = selectedInGroup.map((t) => t.id);
      if (ids.length === 0) { toast.error("รายการที่เลือกยังไม่อยู่ในกลุ่ม — ใส่ชื่อกลุ่มด้วย"); return; }
      ok = await patchTrackers(ids, { subgroup: sub }, `ย้ายเข้ากลุ่มย่อย "${sub}" แล้ว`);
    }
    if (ok) setSelected(new Set());
  }

  /** แถวของ 1 รายการ (+ กราฟ + คำใกล้เคียง) — indent = อยู่ใต้กลุ่มย่อยหรือข้างกลุ่มย่อย */
  function renderRow(t: UploadGscTracker, indent: boolean) {
    const p = perfById.get(t.id);
    const kind = trackerKind(t);
    const open = openRows.has(t.id);
    const owner = ownerName(effectiveOwner(t));
    const own = p && !p.unresolved ? p : null;
    const similarCount = own?.similar?.length ?? 0;
    // Convert Cake: the row counts the keyword together with the similar keywords listed under it
    const combined = foldersEnabled && similarCount > 0;
    const usable = own && combined ? withSimilarTotals(own) : own;
    const ownHint = own && combined
      ? `รวมคำใกล้เคียง ${similarCount} คำ — เฉพาะ "${t.keyword}": ${fmtNum(own.totals.clicks)} คลิก, ${fmtNum(own.totals.impressions)} การแสดงผล`
      : undefined;
    const hasImp = !!usable && usable.totals.impressions > 0;
    const prevImp = !!usable && usable.prevTotals.impressions > 0;
    const similarOpen = similarCount > 0 && openSimilar.has(t.id);
    return (
      <TrackerRowFragment key={t.id}>
        <tr className={`border-b border-gray-100 ${open ? "bg-brand-mist/40" : "hover:bg-gray-50/60"}`}>
          <td className="px-3 py-2 align-top">
            <input type="checkbox" aria-label="เลือกรายการนี้" checked={selected.has(t.id)}
              onChange={(e) => toggleSelect([t.id], e.target.checked)} />
          </td>
          <td className={`px-2 py-2 min-w-0 max-w-[22rem] ${indent ? "pl-7" : ""}`}>
            <button type="button" onClick={() => toggleRow(t.id)} aria-expanded={open}
              title={open ? "ซ่อนกราฟ" : "ดูกราฟ"} className="flex items-center gap-2 min-w-0 w-full text-left">
              <ChevronDown size={13} className={`shrink-0 text-gray-400 transition-transform ${open ? "" : "-rotate-90"}`} />
              <span className="truncate text-brand-blue hover:underline">{kind === "page" ? (t.title || t.url) : t.keyword}</span>
            </button>
            <div className="ml-5 mt-0.5 flex flex-wrap items-center gap-1">
              <span className="rounded-full bg-brand-mist px-1.5 py-px text-[10px] text-brand-navy">{KIND_BADGE[kind]}</span>
              {/* Convert Cake: inside a project folder the owner is set on the folder row, not per keyword */}
              {ownerTags.length > 0 && !(foldersEnabled && t.group) ? (
                <select value={effectiveOwner(t)} disabled={busy} aria-label="ผู้ดูแลของรายการนี้"
                  onChange={(e) => void patchTrackers([t.id], { ownerTagId: e.target.value })}
                  className={`h-5 max-w-[9rem] rounded-full border-0 px-1.5 text-[10px] ${owner ? "bg-indigo-50 text-brand-blue font-medium" : "bg-gray-100 text-gray-500"}`}>
                  <option value="">ยังไม่ระบุผู้ดูแล</option>
                  {ownerTags.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              ) : null}
              {kind === "pair" && t.title && <span className="truncate text-[10px] text-gray-500 max-w-[12rem]">{t.title}</span>}
              {/* Convert Cake: a keyword directly in a folder is a keyword group of its own name — the first
                  keyword added from here moves this keyword into that group as well (server side) */}
              {foldersEnabled && t.group && !t.subgroup && kind === "keyword" && (
                <button type="button"
                  onClick={() => { setSubOpen(subKey(t.group!, t.keyword), true); setSuggest({ term: t.keyword, group: t.group!, subgroup: t.keyword }); }}
                  title={`หาคำใกล้เคียง แล้วกด + เพิ่มเข้ากลุ่ม keyword "${t.keyword}"`}
                  className="inline-flex items-center gap-0.5 rounded-full border border-gray-200 bg-white px-1.5 py-px text-[10px] font-medium text-brand-navy hover:border-brand-blue hover:text-brand-blue whitespace-nowrap">
                  <Search size={10} /> หาคำใกล้เคียง
                </button>
              )}
              {similarCount > 0 && (
                <button type="button" onClick={() => toggleSimilar(t.id)} aria-expanded={similarOpen}
                  title={similarOpen ? "ซ่อนคำใกล้เคียง" : combined ? "ดูคำใกล้เคียงที่ระบบหาให้ (ตัวเลขในแถวนี้รวมคำเหล่านี้แล้ว)" : "ดูคำใกล้เคียงที่ระบบหาให้"}
                  className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[10px] ${similarOpen ? "bg-brand-blue text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                  <ChevronDown size={10} className={`transition-transform ${similarOpen ? "" : "-rotate-90"}`} />
                  {combined ? "รวมคำใกล้เคียง" : "คำใกล้เคียง"} {similarCount}
                </button>
              )}
            </div>
          </td>
          <td className="px-2 py-2 text-center">
            {t.url ? (
              <a href={t.url} target="_blank" rel="noopener noreferrer" title={t.url} className="inline-flex text-brand-blue hover:opacity-70">
                <Link2 size={15} />
              </a>
            ) : <span className="text-[10px] text-gray-400" title="ทุกหน้าของเว็บ">ทั้งเว็บ</span>}
          </td>
          <td className="px-2 py-2 text-right tabular-nums" title={ownHint}>
            {usable ? <>{fmtNum(usable.totals.clicks)} <Arrow diff={usable.totals.clicks - usable.prevTotals.clicks} text={fmtNum(Math.abs(usable.totals.clicks - usable.prevTotals.clicks))} /></> : <CellPending loading={loading} unresolved={!!p?.unresolved} />}
          </td>
          <td className="px-2 py-2 text-right tabular-nums" title={ownHint}>
            {usable ? <>{fmtNum(usable.totals.impressions)} <Arrow diff={usable.totals.impressions - usable.prevTotals.impressions} text={fmtNum(Math.abs(usable.totals.impressions - usable.prevTotals.impressions))} /></> : null}
          </td>
          <td className="px-2 py-2 text-right tabular-nums">{hasImp ? fmtCtr(usable!.totals.ctr) : usable ? "—" : null}</td>
          <td className="px-1 py-1 text-center tabular-nums">
            {usable ? (
              <span className={`inline-block min-w-[4.5rem] rounded-md px-2 py-1.5 ${hasImp ? positionTone(usable.totals.position) : "bg-gray-50 text-gray-400"}`}>
                {hasImp ? fmtPos(usable.totals.position) : "—"}{" "}
                {hasImp && prevImp && <Arrow lowerIsBetter diff={usable.totals.position - usable.prevTotals.position} text={Math.abs(usable.totals.position - usable.prevTotals.position).toFixed(1)} />}
              </span>
            ) : null}
          </td>
          <td className="px-3 py-2 text-right whitespace-nowrap">
            {foldersEnabled && t.group && !t.subgroup && kind === "keyword" && (
              <button type="button" disabled={busy} onClick={() => void keywordToGroup(t)}
                title="ทำเป็นกลุ่ม keyword (เพิ่ม keyword ที่ monitor เข้าไปได้ + ดูกราฟรวม)" aria-label={`ทำ ${t.keyword} เป็นกลุ่ม keyword`}
                className="mr-2 text-gray-400 hover:text-brand-blue disabled:opacity-50">
                <FolderPlus size={13} />
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => remove(t)} title="เลิกติดตาม"
              className="text-gray-400 hover:text-red-500 disabled:opacity-50">
              <Trash2 size={13} />
            </button>
          </td>
        </tr>
        {open && (
          <tr className="border-b border-gray-100 bg-white/60">
            <td colSpan={8} className="px-4 py-4 md:px-6">
              {p && p.matchUrl && p.matchUrl !== t.url && (
                <p className="mb-2 truncate font-mono text-[10px] text-gray-500" title={p.matchUrl}>ใช้เทียบกับ: {p.matchUrl}</p>
              )}
              {!p ? (
                <div className="py-10 flex justify-center text-gray-400">
                  {loading ? <Loader2 size={18} className="animate-spin" /> : <span className="text-xs">ยังไม่มีข้อมูล</span>}
                </div>
              ) : (
                <>
                  {combined && (
                    <p className="mb-2 text-[11px] text-gray-500">
                      กราฟนี้เป็นของคำ &quot;{t.keyword}&quot; คำเดียว — ตัวเลขในแถวรวมคำใกล้เคียง {similarCount} คำแล้ว
                    </p>
                  )}
                  <TrackerBody p={p} kind={kind} metric={metric} name={name} />
                </>
              )}
            </td>
          </tr>
        )}
        {similarOpen && usable?.similar && (
          <SimilarRows key={periodKey} list={usable.similar} base={base} periodKey={periodKey} metric={metric} name={name}
            busy={busy}
            onAdd={foldersEnabled && kind === "keyword" ? (keyword) => void addSimilarToGroup(t, keyword) : undefined}
            addHint={!foldersEnabled || kind !== "keyword" ? undefined
              : !t.group ? "ย้าย keyword นี้เข้าโฟลเดอร์ก่อน แล้วจึงเพิ่มคำใกล้เคียงเข้ากลุ่ม keyword ได้"
              : `เพิ่มเข้ากลุ่ม keyword "${t.subgroup || t.keyword}"`}
            canAdd={!!t.group} />
        )}
      </TrackerRowFragment>
    );
  }

  const name = METRIC_NAME[metric];
  const inputCls = "h-9 rounded-full border border-gray-200 px-3 text-sm bg-white";

  return (
    <div className="space-y-4">
      <datalist id="tracker-group-names">
        {groupNames.map((g) => <option key={g} value={g} />)}
      </datalist>
      <datalist id="tracker-subgroup-names">
        {subgroupNames.map((g) => <option key={g} value={g} />)}
      </datalist>
      <GscKeywordSuggestDialog
        clientId={clientId}
        open={!!suggest}
        onOpenChange={(v) => { if (!v) setSuggest(null); }}
        initialTerm={suggest?.term ?? ""}
        initialGroup={suggest?.group ?? ""}
        initialSubgroup={suggest?.subgroup ?? ""}
        periodParams={periodParams}
        ownerTags={ownerTags}
        defaultOwnerTagId={suggest?.subgroup ? folderOwner(suggest.group) || formOwner : formOwner}
        onTrackersChange={onTrackersChange}
      />
      {/* ── ฟอร์มเพิ่ม ── relative + z-30: การ์ดนี้มี backdrop-blur (สร้าง stacking context) ไม่ยกชั้นไว้ รายการบทความที่เปิดลงมาจะโดนแผงถัดไปทับ */}
      <div className="relative z-30 rounded-2xl border border-white/80 bg-white/70 shadow-sm backdrop-blur p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-brand-navy">บันทึก Monitor</p>
            <p className="text-xs text-gray-500 mt-0.5">ติดตามแยกเป็น keyword, บทความ หรือ URL — หรือจับคู่ keyword กับหน้า</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Convert Cake: this button lives on each keyword group row instead */}
            {!foldersEnabled && (
              <Button type="button" variant="outline" size="sm" className="rounded-full h-8"
                onClick={() => setSuggest({ term: formGroup.trim() ? termFromGroupName(formGroup.trim()) : "", group: formGroup.trim() })}>
                <Search size={13} /> หาคำใกล้เคียง
              </Button>
            )}
            <span className="text-[11px] text-gray-400 tabular-nums">{trackers.length}/{UPLOAD_MAX_GSC_TRACKERS}</span>
          </div>
        </div>

        <div className="space-y-1.5">
          <Segmented size="sm" ariaLabel="ติดตามแบบ" value={mode} onChange={changeMode} options={MODE_OPTIONS} />
          <p className="text-[11px] text-gray-500">{MODE_HINT[mode]}</p>
        </div>

        <div className="flex items-start gap-2 flex-wrap">
          {(mode === "keyword" || mode === "pair") && (
            <input
              value={keyword}
              maxLength={UPLOAD_MAX_TRACKER_KEYWORD}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
              placeholder="keyword ที่ต้องการติดตาม"
              className={`${inputCls} w-full sm:w-64`}
            />
          )}

          {(mode === "article" || mode === "pair") && (
            <div ref={pickerRef} className="relative w-full sm:w-72">
              <button type="button" onClick={() => setPickerOpen((o) => !o)} aria-expanded={pickerOpen}
                className={`${inputCls} w-full text-left truncate flex items-center gap-1.5 ${title ? "text-brand-navy" : "text-gray-500"}`}>
                <Search size={12} className="shrink-0 text-gray-400" />
                <span className="truncate">{title || "เลือกจากบทความที่อัปโหลด"}</span>
              </button>
              {pickerOpen && (
                <div className="absolute left-0 top-full z-40 mt-1 w-full sm:w-[28rem] max-w-[90vw] rounded-2xl border border-gray-200 bg-white shadow-lg p-2 space-y-1.5">
                  <input
                    autoFocus
                    value={pickerQuery}
                    onChange={(e) => setPickerQuery(e.target.value)}
                    placeholder="ค้นหาชื่อบทความหรือ URL"
                    className="h-8 w-full rounded-full border border-gray-200 px-3 text-xs"
                  />
                  <div className="max-h-64 overflow-y-auto">
                    {filteredArticles.length === 0 ? (
                      <p className="px-2 py-3 text-xs text-gray-400">{articles.length === 0 ? "ยังไม่มีบทความที่เผยแพร่แล้ว — ใช้แบบ URL แทนได้" : "ไม่พบบทความ"}</p>
                    ) : filteredArticles.map((a) => (
                      <button key={a.url} type="button"
                        onClick={() => { setUrl(a.url); setTitle(a.title); setPickerOpen(false); setPickerQuery(""); }}
                        className="block w-full text-left rounded-lg px-2 py-1.5 hover:bg-brand-mist">
                        <span className="block text-xs font-medium text-brand-navy truncate">{a.title}</span>
                        <span className="block text-[10px] font-mono text-gray-500 truncate">{a.url}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {(mode === "url" || mode === "pair") && (
            <input
              value={url}
              maxLength={UPLOAD_MAX_TRACKER_URL}
              onChange={(e) => { setUrl(e.target.value); setTitle(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
              placeholder={mode === "pair" ? "URL ของหน้า (แก้ไขเองได้)" : "https://example.com/blog/post"}
              className={`${inputCls} w-full sm:w-72 font-mono text-xs`}
            />
          )}

          <input value={formGroup} onChange={(e) => setFormGroup(e.target.value)} list="tracker-group-names"
            maxLength={UPLOAD_MAX_TRACKER_GROUP} aria-label="กลุ่มคำ"
            onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
            placeholder={foldersEnabled ? "โฟลเดอร์โปรเจกต์ (ไม่ใส่ก็ได้)" : "กลุ่มคำ (ไม่ใส่ก็ได้)"} className={`${inputCls} w-full sm:w-44 text-xs`} />
          {foldersEnabled && formGroup.trim() && (
            <input value={formSubgroup} onChange={(e) => setFormSubgroup(e.target.value)} list="tracker-subgroup-names"
              maxLength={UPLOAD_MAX_TRACKER_GROUP} aria-label="กลุ่ม keyword"
              onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
              placeholder="กลุ่ม keyword (ไม่ใส่ก็ได้)" className={`${inputCls} w-full sm:w-40 text-xs`} />
          )}

          {ownerTags.length > 0 && (
            <select value={formOwner} onChange={(e) => setFormOwner(e.target.value)} aria-label="ผู้ดูแลของรายการนี้"
              className={`${inputCls} w-full sm:w-44 text-xs ${formOwner ? "text-brand-navy font-semibold" : "text-gray-500"}`}>
              <option value="">ผู้ดูแล: ยังไม่ระบุ</option>
              {ownerTags.map((o) => <option key={o.id} value={o.id}>ผู้ดูแล: {o.name}</option>)}
            </select>
          )}

          <Button size="sm" onClick={() => void submit()} disabled={saving}>
            {saving ? <Loader2 size={12} className="animate-spin mr-1.5" /> : <BookmarkPlus size={12} className="mr-1.5" />}
            บันทึก Monitor
          </Button>
        </div>
        {mode === "article" && url && (
          <p className="text-[10px] font-mono text-gray-500 truncate" title={url}>{url}</p>
        )}
      </div>

      {foldersEnabled && (
        <div className="flex flex-wrap items-center gap-2">
          {newFolderOpen ? (
            <>
              <input autoFocus value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)}
                maxLength={UPLOAD_MAX_TRACKER_GROUP} aria-label="ชื่อโฟลเดอร์โปรเจกต์"
                onKeyDown={(e) => { if (e.key === "Enter") void createFolder(); if (e.key === "Escape") setNewFolderOpen(false); }}
                placeholder="ชื่อโฟลเดอร์ เช่น Ads Landingpage" className={`${inputCls} w-full sm:w-64 text-xs`} />
              {ownerTags.length > 0 && (
                <select value={newFolderOwner} onChange={(e) => setNewFolderOwner(e.target.value)} aria-label="ผู้รับผิดชอบโฟลเดอร์"
                  className={`${inputCls} w-full sm:w-48 text-xs ${newFolderOwner ? "text-brand-navy font-semibold" : "text-gray-500"}`}>
                  <option value="">ผู้รับผิดชอบ: ยังไม่ระบุ</option>
                  {ownerTags.map((o) => <option key={o.id} value={o.id}>ผู้รับผิดชอบ: {o.name}</option>)}
                </select>
              )}
              <Button size="sm" disabled={busy || !newFolderName.trim()} onClick={() => void createFolder()}>
                <FolderPlus size={12} className="mr-1.5" /> สร้างโฟลเดอร์
              </Button>
              <button type="button" className="text-xs text-gray-500 hover:text-brand-navy" onClick={() => setNewFolderOpen(false)}>ยกเลิก</button>
            </>
          ) : (
            <Button size="sm" variant="outline" onClick={() => { setNewFolderOwner(formOwner); setNewFolderOpen(true); }}>
              <FolderPlus size={12} className="mr-1.5" /> สร้างโฟลเดอร์โปรเจกต์
            </Button>
          )}
        </div>
      )}

      {trackers.length === 0 && folders.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<BookmarkPlus className="h-5 w-5" />}
            title="ยังไม่มีรายการที่ติดตาม"
            description="เลือกติดตามแบบ Keyword, บทความ หรือ URL ในฟอร์มด้านบน หรือกดปุ่ม บันทึก Monitor ที่แถว keyword ในแท็บอื่น ๆ ของ Report"
          />
        </Panel>
      ) : (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <Segmented
              size="sm"
              ariaLabel="ตัวชี้วัดของกราฟ"
              value={metric}
              onChange={setMetric}
              options={[
                { value: "clicks", label: "คลิก" },
                { value: "impressions", label: "การแสดงผล" },
                { value: "ctr", label: "CTR" },
                { value: "position", label: "อันดับเฉลี่ย" },
              ]}
            />
            {loading && <Loader2 size={14} className="animate-spin text-gray-400" />}
            <div className="flex items-center gap-2 flex-wrap ml-auto">
              {ownerTags.length > 0 && (
                <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)} aria-label="กรองตามผู้ดูแล"
                  className={`h-8 rounded-full border px-3 text-xs bg-white ${ownerFilter ? "border-brand-soft/60 text-brand-blue font-semibold" : "border-gray-200 text-gray-600"}`}>
                  <option value="">ผู้ดูแล: ทุกคน ({trackers.length})</option>
                  {ownerTags.map((o) => <option key={o.id} value={o.id}>ผู้ดูแล: {o.name} ({ownerCounts.get(o.id) ?? 0})</option>)}
                  <option value={NO_OWNER}>ยังไม่ระบุผู้ดูแล ({ownerCounts.get(NO_OWNER) ?? 0})</option>
                </select>
              )}
              {similarIds.length > 0 && (
                <Button size="sm" variant="outline" onClick={() => setOpenSimilar(allSimilarOpen ? new Set() : new Set(similarIds))}>
                  <ListTree size={12} className="mr-1.5" /> {allSimilarOpen ? "ซ่อนคำใกล้เคียง" : "แสดงคำใกล้เคียงทั้งหมด"}
                </Button>
              )}
              {groups.length > 0 && (
                <Button size="sm" variant="outline" onClick={() => setAllGroups(!allGroupsCollapsed)}>
                  {allGroupsCollapsed
                    ? <><ChevronsUpDown size={12} className="mr-1.5" /> ขยายทุกกลุ่ม</>
                    : <><ChevronsDownUp size={12} className="mr-1.5" /> ย่อทุกกลุ่ม</>}
                </Button>
              )}
            </div>
          </div>

          {error && (
            <div className="bg-red-50/80 border border-red-200 rounded-2xl p-4 text-sm text-red-700 flex items-start gap-2">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <div className="flex-1">
                <p>{error}</p>
                <Button size="sm" variant="outline" className="mt-2" onClick={() => void loadPerformance()} disabled={loading}>
                  <RefreshCw size={12} className="mr-1.5" /> ลองใหม่
                </Button>
              </div>
            </div>
          )}

          {selectedIds.length > 0 && (
            <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-2xl border border-brand-soft/40 bg-white/95 px-3 py-2 shadow-sm backdrop-blur">
              <span className="text-xs font-semibold text-brand-navy">เลือก {selectedIds.length} รายการ</span>
              <span className="h-5 w-px bg-gray-200" />
              <input value={bulkGroup} onChange={(e) => setBulkGroup(e.target.value)} list="tracker-group-names"
                maxLength={UPLOAD_MAX_TRACKER_GROUP} placeholder={foldersEnabled ? "โฟลเดอร์ เช่น Ads Landingpage" : "ชื่อกลุ่ม เช่น Blog 45 - cpas"}
                className="h-8 w-48 rounded-full border border-gray-200 px-3 text-xs bg-white" />
              {foldersEnabled && (
                <input value={bulkSubgroup} onChange={(e) => setBulkSubgroup(e.target.value)} list="tracker-subgroup-names"
                  maxLength={UPLOAD_MAX_TRACKER_GROUP} placeholder="กลุ่ม keyword (ไม่ใส่ก็ได้)" aria-label="กลุ่ม keyword"
                  className="h-8 w-44 rounded-full border border-gray-200 px-3 text-xs bg-white" />
              )}
              <Button size="sm" variant="outline" disabled={busy || (!bulkGroup.trim() && !(foldersEnabled && bulkSubgroup.trim()))}
                onClick={() => void bulkMove()}>
                <FolderInput size={12} className="mr-1.5" /> ย้ายเข้ากลุ่ม
              </Button>
              {foldersEnabled && selectedHasSubgroup && (
                <Button size="sm" variant="outline" disabled={busy}
                  onClick={() => void patchTrackers(selectedInGroup.map((t) => t.id), { subgroup: "" }, "เอาออกจากกลุ่มย่อยแล้ว").then((ok) => { if (ok) setSelected(new Set()); })}>
                  เอาออกจากกลุ่ม keyword
                </Button>
              )}
              <Button size="sm" variant="outline" disabled={busy}
                onClick={() => void patchTrackers(selectedIds, { group: "" }, "เอาออกจากกลุ่มแล้ว").then((ok) => { if (ok) setSelected(new Set()); })}>
                เอาออกจากกลุ่ม
              </Button>
              {ownerTags.length > 0 && (
                <select value="" disabled={busy} aria-label="ตั้งผู้ดูแลให้รายการที่เลือก"
                  onChange={(e) => { const v = e.target.value; if (v) void patchTrackers(selectedIds, { ownerTagId: v === NO_OWNER ? "" : v }, "ตั้งผู้ดูแลแล้ว"); }}
                  className="h-8 rounded-full border border-gray-200 px-3 text-xs bg-white">
                  <option value="">ตั้งผู้ดูแล…</option>
                  {ownerTags.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  <option value={NO_OWNER}>ล้างผู้ดูแล</option>
                </select>
              )}
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void removeMany(selectedIds, `${selectedIds.length} รายการที่เลือก`)}>
                <Trash2 size={12} className="mr-1.5" /> เลิกติดตาม
              </Button>
              <button type="button" className="ml-auto text-xs text-gray-500 hover:text-brand-navy" onClick={() => setSelected(new Set())}>ยกเลิกการเลือก</button>
            </div>
          )}

          {groups.length === 0 ? (
            <Panel>
              <EmptyState
                icon={<BookmarkPlus className="h-5 w-5" />}
                title="ไม่มีรายการของผู้ดูแลนี้"
                description="เลือกผู้ดูแลอื่น หรือระบุผู้ดูแลให้รายการที่ติดตามจากเมนูในแต่ละแถว"
              />
            </Panel>
          ) : (
            <Panel padded={false} bodyClassName="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-[11px] text-gray-500">
                    <th className="w-9 px-3 py-2.5 text-left">
                      <input type="checkbox" aria-label="เลือกทั้งหมด"
                        checked={visibleTrackers.every((t) => selected.has(t.id))}
                        onChange={(e) => toggleSelect(visibleTrackers.map((t) => t.id), e.target.checked)} />
                    </th>
                    <th className="px-2 py-2.5 text-left font-medium">Keyword / หน้า</th>
                    <th className="w-10 px-2 py-2.5" />
                    <th className="px-2 py-2.5 text-right font-medium">คลิก</th>
                    <th className="px-2 py-2.5 text-right font-medium">การแสดงผล</th>
                    <th className="px-2 py-2.5 text-right font-medium">CTR</th>
                    <th className="px-2 py-2.5 text-center font-medium">อันดับเฉลี่ย</th>
                    <th className="w-24 px-3 py-2.5" />
                  </tr>
                </thead>
                {groups.map((g) => {
                  const ids = g.items.map((t) => t.id);
                  const isCollapsed = collapsedGroups.has(g.key);
                  const sum = sumPerf(g.items.map((t) => perfById.get(t.id)), foldersEnabled);
                  return (
                    <tbody key={g.key || "__ungrouped__"}>
                      <tr className="border-b border-gray-100 bg-gray-50/80">
                        <td className="px-3 py-2">
                          <input type="checkbox" aria-label={`เลือกทั้งกลุ่ม ${g.label}`}
                            checked={ids.every((id) => selected.has(id))}
                            onChange={(e) => toggleSelect(ids, e.target.checked)} />
                        </td>
                        <td className="px-2 py-2" colSpan={2}>
                          <button type="button" onClick={() => toggleGroup(g.key)} aria-expanded={!isCollapsed}
                            className="flex items-center gap-2 font-semibold text-brand-navy hover:text-brand-blue">
                            <ChevronDown size={14} className={`text-gray-400 transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
                            {isCollapsed ? <Folder size={14} /> : <FolderOpen size={14} />}
                            <span>{g.label}</span>
                            <span className="rounded-full bg-gray-200/80 px-2 py-0.5 text-[10px] font-medium text-gray-600">{g.items.length}</span>
                          </button>
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums font-semibold">{sum ? fmtNum(sum.clicks) : "—"}</td>
                        <td className="px-2 py-2 text-right tabular-nums font-semibold">{sum ? fmtNum(sum.impressions) : "—"}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{sum && sum.impressions > 0 ? fmtCtr(sum.ctr) : "—"}</td>
                        <td className="px-2 py-2 text-center tabular-nums">{sum && sum.impressions > 0 ? fmtPos(sum.position) : "—"}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          {foldersEnabled && g.name && ownerTags.length > 0 && (
                            <select value={folderOwner(g.name)} disabled={busy} aria-label={`ผู้รับผิดชอบโฟลเดอร์ ${g.name}`}
                              title="ผู้รับผิดชอบโฟลเดอร์นี้ (ตั้งให้ทุก keyword ในโฟลเดอร์ด้วย)"
                              onChange={(e) => void folderOp({ op: "owner", folder: g.name, ownerTagId: e.target.value }, "เปลี่ยนผู้รับผิดชอบแล้ว")}
                              className={`mr-2 h-6 max-w-[9rem] rounded-full border-0 px-2 text-[11px] align-middle ${folderOwner(g.name) ? "bg-indigo-50 text-brand-blue font-medium" : "bg-gray-100 text-gray-500"}`}>
                              <option value="">ยังไม่ระบุผู้รับผิดชอบ</option>
                              {ownerTags.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                            </select>
                          )}
                          {foldersEnabled && g.name && (
                            <button type="button" disabled={busy} onClick={() => void createSubgroup(g.name, g.items)}
                              className="mr-2 text-gray-400 hover:text-brand-blue disabled:opacity-50"
                              title={`สร้างกลุ่ม keyword ใน "${g.name}"`} aria-label={`สร้างกลุ่ม keyword ใน ${g.name}`}>
                              <FolderPlus size={13} />
                            </button>
                          )}
                          {g.name && (
                            <button type="button" onClick={() => setSuggest({ term: termFromGroupName(g.name), group: g.name })}
                              className="mr-2 text-gray-400 hover:text-brand-blue" title={`หาคำใกล้เคียงเข้ากลุ่ม "${g.name}"`} aria-label={`หาคำใกล้เคียงเข้ากลุ่ม ${g.name}`}>
                              <Search size={13} />
                            </button>
                          )}
                          {foldersEnabled && g.name ? (
                            <>
                              <button type="button" disabled={busy} onClick={() => void renameFolder(g.name)}
                                className="mr-2 text-gray-400 hover:text-brand-blue disabled:opacity-50" title="เปลี่ยนชื่อโฟลเดอร์" aria-label={`เปลี่ยนชื่อโฟลเดอร์ ${g.name}`}>
                                <Pencil size={13} />
                              </button>
                              <button type="button" disabled={busy} onClick={() => void deleteFolder(g.name, g.items.length)}
                                className="text-gray-400 hover:text-red-500 disabled:opacity-50" title="ลบโฟลเดอร์ (keyword ข้างในยังติดตามอยู่)" aria-label={`ลบโฟลเดอร์ ${g.name}`}>
                                <Trash2 size={13} />
                              </button>
                            </>
                          ) : g.key && (
                            <button type="button" disabled={busy} onClick={() => void renameGroup(g.name, ids)}
                              className="text-gray-400 hover:text-brand-blue disabled:opacity-50" title={g.name ? "เปลี่ยนชื่อกลุ่ม / เอาออกจากกลุ่ม" : "ตั้งชื่อกลุ่มให้รายการของผู้ดูแลนี้"}>
                              <Pencil size={13} />
                            </button>
                          )}
                        </td>
                      </tr>
                      {!isCollapsed && foldersEnabled && g.name && g.items.length === 0 && g.subs.length === 0 && (
                        <tr className="border-b border-gray-100">
                          <td colSpan={8} className="px-4 py-3 pl-10 text-xs text-gray-500">
                            โฟลเดอร์ยังว่าง — กด <FolderPlus size={11} className="inline -mt-0.5" /> เพื่อสร้างกลุ่ม keyword แล้วเพิ่ม keyword ที่ต้องการ monitor
                          </td>
                        </tr>
                      )}
                      {!isCollapsed && g.subs.map((sub) => {
                        const subIds = sub.items.map((t) => t.id);
                        const subOpen = openSubs.has(sub.key);
                        const subPerf = sub.items.map((t) => perfById.get(t.id)).filter((x): x is GscTrackerPerformance => !!x);
                        const subSum = sumPerf(subPerf, foldersEnabled);
                        const subSimilar = subPerf.reduce((n, x) => n + (x.unresolved ? 0 : x.similar?.length ?? 0), 0);
                        const agg = subOpen ? aggregateTrackerPerformance(subPerf) : null;
                        const draft = subDrafts[sub.key] ?? "";
                        const draftWords = draft.split(/[,\n]/).map((w) => w.trim()).filter(Boolean);
                        const submitDraft = async () => {
                          if (await addToSubgroup(g.name, sub.name, draftWords)) setSubDrafts((d) => ({ ...d, [sub.key]: "" }));
                        };
                        return (
                          <TrackerRowFragment key={sub.key}>
                            <tr className={`border-b border-gray-100 ${subOpen ? "bg-brand-mist/40" : "bg-gray-50/40"}`}>
                              <td className="px-3 py-1.5">
                                <input type="checkbox" aria-label={`เลือกทั้งกลุ่ม keyword ${sub.name}`} disabled={subIds.length === 0}
                                  checked={subIds.length > 0 && subIds.every((id) => selected.has(id))}
                                  onChange={(e) => toggleSelect(subIds, e.target.checked)} />
                              </td>
                              <td className="px-2 py-1.5 pl-7" colSpan={2}>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <button type="button" onClick={() => setSubOpen(sub.key, !subOpen)} aria-expanded={subOpen}
                                    title={subOpen ? "ซ่อน" : "ดูกราฟรวม + เพิ่ม keyword"}
                                    className="flex items-center gap-2 text-[13px] font-medium text-brand-navy hover:text-brand-blue">
                                    <ChevronDown size={13} className={`text-gray-400 transition-transform ${subOpen ? "" : "-rotate-90"}`} />
                                    {subOpen ? <FolderOpen size={13} /> : <Folder size={13} />}
                                    <span>{sub.name}</span>
                                    <span className="rounded-full bg-gray-200/70 px-2 py-0.5 text-[10px] font-medium text-gray-600">{sub.items.length}</span>
                                  </button>
                                  <button type="button"
                                    onClick={() => setSuggest({ term: termFromGroupName(sub.name), group: g.name, subgroup: sub.name })}
                                    title={`หาคำใกล้เคียง แล้วกด + เพิ่มเข้ากลุ่ม keyword "${sub.name}"`}
                                    className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-medium text-brand-navy hover:border-brand-blue hover:text-brand-blue whitespace-nowrap">
                                    <Search size={11} /> หาคำใกล้เคียง
                                  </button>
                                </div>
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums font-medium">{subSum ? fmtNum(subSum.clicks) : "—"}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums font-medium">{subSum ? fmtNum(subSum.impressions) : "—"}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">{subSum && subSum.impressions > 0 ? fmtCtr(subSum.ctr) : "—"}</td>
                              <td className="px-2 py-1.5 text-center tabular-nums">{subSum && subSum.impressions > 0 ? fmtPos(subSum.position) : "—"}</td>
                              <td className="px-3 py-1.5 text-right whitespace-nowrap">
                                <button type="button" disabled={busy} onClick={() => void renameSubgroup(g.name, sub.name)}
                                  className="mr-2 text-gray-400 hover:text-brand-blue disabled:opacity-50" title="เปลี่ยนชื่อกลุ่ม keyword" aria-label={`เปลี่ยนชื่อกลุ่ม keyword ${sub.name}`}>
                                  <Pencil size={12} />
                                </button>
                                <button type="button" disabled={busy} onClick={() => void deleteSubgroup(g.name, sub.name, sub.items.length)}
                                  className="text-gray-400 hover:text-red-500 disabled:opacity-50" title="ลบกลุ่ม keyword (keyword ข้างในยังติดตามอยู่)" aria-label={`ลบกลุ่ม keyword ${sub.name}`}>
                                  <Trash2 size={12} />
                                </button>
                              </td>
                            </tr>
                            {subOpen && (
                              <tr className="border-b border-gray-100 bg-white/60">
                                <td colSpan={8} className="px-4 py-4 pl-10 md:px-6 md:pl-12">
                                  <p className="mb-2 text-[11px] font-medium text-gray-500">
                                    กราฟรวม {sub.items.length} keyword ในกลุ่ม &quot;{sub.name}&quot;
                                    {subSimilar > 0 && ` — กราฟนับเฉพาะ keyword ที่ติดตาม ตัวเลขในแถวกลุ่มรวมคำใกล้เคียงอีก ${subSimilar} คำแล้ว`}
                                  </p>
                                  {sub.items.length === 0 ? (
                                    <p className="py-4 text-xs text-gray-400">ยังไม่มี keyword ในกลุ่มนี้ — เพิ่มด้านล่าง</p>
                                  ) : agg ? (
                                    <TrackerBody
                                      p={{ daily: agg.daily, dailyPrev: agg.dailyPrev, totals: agg.overview.current, prevTotals: agg.overview.previous, hasData: subPerf.some((x) => x.hasData), unresolved: false }}
                                      kind="keyword" metric={metric} name={name} />
                                  ) : (
                                    <div className="py-6 flex justify-center text-gray-400">
                                      {loading ? <Loader2 size={18} className="animate-spin" /> : <span className="text-xs">ยังไม่มีข้อมูล</span>}
                                    </div>
                                  )}
                                  <div className="mt-3 flex flex-wrap items-center gap-2">
                                    <input value={draft} disabled={busy}
                                      onChange={(e) => setSubDrafts((d) => ({ ...d, [sub.key]: e.target.value }))}
                                      onKeyDown={(e) => { if (e.key === "Enter" && draftWords.length) void submitDraft(); }}
                                      aria-label={`เพิ่ม keyword หรือ URL ที่ monitor เข้ากลุ่ม ${sub.name}`}
                                      placeholder="เพิ่ม keyword หรือ URL (https://…) คั่นหลายรายการด้วย ,"
                                      className={`${inputCls} w-full sm:w-80 text-xs`} />
                                    <Button size="sm" disabled={busy || draftWords.length === 0} onClick={() => void submitDraft()}>
                                      <Plus size={12} className="mr-1" /> เพิ่ม{draftWords.length > 1 ? ` ${draftWords.length} รายการ` : ""}
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            )}
                            {subOpen && sub.items.map((t) => renderRow(t, true))}
                          </TrackerRowFragment>
                        );
                      })}
                      {!isCollapsed && g.direct.map((t) => renderRow(t, g.subs.length > 0))}
                    </tbody>
                  );
                })}
              </table>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

/** How many similar keywords show under a tracker before "+ อีก N คำ" */
const SIMILAR_SHOWN = 5;

type SeriesState = { loading: true } | { loading: false; data?: GscQuerySeriesResponse; error?: string };

/**
 * Similar keywords that GSC returned for a tracker's keyword (found automatically by the performance
 * route). Each one opens its own daily chart; the chart is fetched only when opened (2 GSC calls, cached).
 */
function SimilarRows({ list, base, periodKey, metric, name, busy = false, onAdd, addHint, canAdd = true }: {
  list: GscSimilarKeyword[]; base: string; periodKey: string; metric: Metric; name: string;
  busy?: boolean;
  /** Convert Cake: "+" adds the similar keyword into the tracker's keyword group; absent = no button */
  onAdd?: (keyword: string) => void;
  addHint?: string;
  /** false = show the "+" disabled with addHint (the tracker is not in a folder yet) */
  canAdd?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [series, setSeries] = useState<Record<string, SeriesState>>({});

  async function loadSeries(keyword: string) {
    setSeries((prev) => ({ ...prev, [keyword]: { loading: true } }));
    try {
      const r = await fetch(`${base}/query-series`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...JSON.parse(periodKey), keyword }),
      });
      const d = await r.json().catch(() => ({}));
      setSeries((prev) => ({ ...prev, [keyword]: r.ok ? { loading: false, data: d as GscQuerySeriesResponse } : { loading: false, error: d?.error || "ดึงกราฟไม่สำเร็จ" } }));
    } catch (e) {
      setSeries((prev) => ({ ...prev, [keyword]: { loading: false, error: `ดึงกราฟไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}` } }));
    }
  }
  function toggle(keyword: string) {
    const next = new Set(open);
    if (next.has(keyword)) next.delete(keyword);
    else {
      next.add(keyword);
      const st = series[keyword];
      if (!st || (!st.loading && !st.data)) void loadSeries(keyword);
    }
    setOpen(next);
  }

  const shown = showAll ? list : list.slice(0, SIMILAR_SHOWN);
  return (
    <>
      {shown.map((s) => {
        const isOpen = open.has(s.keyword);
        const t = s.totals;
        const pt = s.prevTotals;
        const hasImp = t.impressions > 0;
        const st = series[s.keyword];
        return (
          <TrackerRowFragment key={s.keyword}>
            <tr className={`border-b border-gray-50 text-[13px] ${isOpen ? "bg-brand-mist/30" : "bg-gray-50/40 hover:bg-gray-50"}`}>
              <td className="px-3 py-1.5" />
              <td className="px-2 py-1.5 min-w-0 max-w-[22rem]">
                <button type="button" onClick={() => toggle(s.keyword)} aria-expanded={isOpen}
                  title={isOpen ? "ซ่อนกราฟ" : "ดูกราฟ"} className="ml-5 flex items-center gap-1.5 min-w-0 w-[calc(100%-1.25rem)] text-left">
                  <span className="shrink-0 text-gray-300">↳</span>
                  <ChevronDown size={12} className={`shrink-0 text-gray-400 transition-transform ${isOpen ? "" : "-rotate-90"}`} />
                  <span className="truncate text-gray-700 hover:text-brand-blue hover:underline">{s.keyword}</span>
                  <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-px text-[10px] text-gray-500">คำใกล้เคียง</span>
                </button>
              </td>
              <td className="px-2 py-1.5 text-center"><span className="text-[10px] text-gray-400" title="ทุกหน้าของเว็บ">ทั้งเว็บ</span></td>
              <td className="px-2 py-1.5 text-right tabular-nums">{fmtNum(t.clicks)} <Arrow diff={t.clicks - pt.clicks} text={fmtNum(Math.abs(t.clicks - pt.clicks))} /></td>
              <td className="px-2 py-1.5 text-right tabular-nums">{fmtNum(t.impressions)} <Arrow diff={t.impressions - pt.impressions} text={fmtNum(Math.abs(t.impressions - pt.impressions))} /></td>
              <td className="px-2 py-1.5 text-right tabular-nums">{hasImp ? fmtCtr(t.ctr) : "—"}</td>
              <td className="px-1 py-1 text-center tabular-nums">
                <span className={`inline-block min-w-[4.5rem] rounded-md px-2 py-1 ${hasImp ? positionTone(t.position) : "bg-gray-50 text-gray-400"}`}>
                  {hasImp ? fmtPos(t.position) : "—"}{" "}
                  {hasImp && pt.impressions > 0 && <Arrow lowerIsBetter diff={t.position - pt.position} text={Math.abs(t.position - pt.position).toFixed(1)} />}
                </span>
              </td>
              <td className="px-3 py-1.5 text-right">
                {onAdd && (
                  <button type="button" disabled={busy || !canAdd} onClick={() => onAdd(s.keyword)}
                    title={addHint} aria-label={`เพิ่ม ${s.keyword} เข้ากลุ่ม keyword`}
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-gray-200 bg-white text-brand-blue hover:bg-brand-mist disabled:opacity-40">
                    <Plus size={12} />
                  </button>
                )}
              </td>
            </tr>
            {isOpen && (
              <tr className="border-b border-gray-100 bg-white/60">
                <td colSpan={8} className="px-4 py-4 md:px-6">
                  {!st || st.loading ? (
                    <div className="py-10 flex justify-center text-gray-400"><Loader2 size={18} className="animate-spin" /></div>
                  ) : st.error || !st.data ? (
                    <p className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                      {st.error || "ดึงกราฟไม่สำเร็จ"}{" "}
                      <button type="button" onClick={() => void loadSeries(s.keyword)} className="underline">ลองใหม่</button>
                    </p>
                  ) : (
                    <TrackerBody p={{ ...st.data, unresolved: false }} kind="keyword" metric={metric} name={name} />
                  )}
                </td>
              </tr>
            )}
          </TrackerRowFragment>
        );
      })}
      {list.length > SIMILAR_SHOWN && (
        <tr className="border-b border-gray-100 bg-gray-50/40">
          <td />
          <td colSpan={7} className="px-2 py-1">
            <button type="button" onClick={() => setShowAll(!showAll)} className="ml-5 text-[11px] text-brand-blue hover:underline">
              {showAll ? "ย่อคำใกล้เคียง" : `+ คำใกล้เคียงอีก ${list.length - SIMILAR_SHOWN} คำ`}
            </button>
          </td>
        </tr>
      )}
    </>
  );
}

/** ตัวครอบแถว (tr ข้อมูล + tr กราฟ) ให้ใส่ key ได้ */
function TrackerRowFragment({ children }: { children: React.ReactNode }) { return <>{children}</>; }

/** ลูกศรเปลี่ยนแปลงเทียบช่วงก่อนหน้า (เล็ก ๆ ข้างตัวเลข) — อันดับ: ลดลงคือดี */
function Arrow({ diff, text, lowerIsBetter }: { diff: number; text: string; lowerIsBetter?: boolean }) {
  if (!diff || !Number.isFinite(diff)) return null;
  const good = lowerIsBetter ? diff < 0 : diff > 0;
  const up = diff > 0;
  return (
    <span className={`whitespace-nowrap text-[11px] ${good ? "text-emerald-600" : "text-red-500"}`}>
      {up ? "▲" : "▼"} {text}
    </span>
  );
}

function CellPending({ loading, unresolved }: { loading: boolean; unresolved: boolean }) {
  if (unresolved) return <span className="text-[10px] text-amber-600" title="ลิงก์ ?p= ยังหา URL จริงไม่เจอ">รอ URL จริง</span>;
  return loading ? <Loader2 size={12} className="inline animate-spin text-gray-300" /> : <span className="text-gray-300">—</span>;
}

/** สีพื้นช่องอันดับ: หน้าแรก = เขียว, หน้า 2 = เหลือง, ไกลกว่านั้น = เทา */
function positionTone(pos: number): string {
  if (pos <= 10) return "bg-emerald-50 text-emerald-800";
  if (pos <= 20) return "bg-amber-50 text-amber-800";
  return "bg-gray-50 text-gray-700";
}

/** ผลรวมของกลุ่ม — CTR/อันดับถ่วงตามการแสดงผล; ยังไม่มีข้อมูลสักแถว = null */
function sumPerf(list: (GscTrackerPerformance | undefined)[], withSimilar = false): { clicks: number; impressions: number; ctr: number; position: number } | null {
  let clicks = 0, impressions = 0, posW = 0, any = false;
  for (const raw of list) {
    if (!raw || raw.unresolved) continue;
    // Convert Cake: similar keywords count toward the folder / keyword group totals too
    const p = withSimilar ? withSimilarTotals(raw) : raw;
    any = true;
    clicks += p.totals.clicks;
    impressions += p.totals.impressions;
    posW += p.totals.position * p.totals.impressions;
  }
  if (!any) return null;
  return { clicks, impressions, ctr: impressions > 0 ? clicks / impressions : 0, position: impressions > 0 ? posW / impressions : 0 };
}


const NO_DATA_TEXT: Record<GscTrackerKind, string> = {
  keyword: "Search Console ไม่มีข้อมูลของ keyword นี้บนเว็บนี้ในช่วงที่เลือก",
  page: "Search Console ไม่มีข้อมูลของหน้านี้ในช่วงที่เลือก (หน้าอาจยังไม่ถูก index หรือ URL ไม่ตรงกับที่ Google เก็บ)",
  pair: "Search Console ไม่มีข้อมูลของ keyword นี้บนหน้านี้ในช่วงที่เลือก",
};

type TrackerBodyData = Pick<GscTrackerPerformance, "daily" | "dailyPrev" | "totals" | "prevTotals" | "hasData" | "unresolved">;

function TrackerBody({ p, kind, metric, name }: { p: TrackerBodyData; kind: GscTrackerKind; metric: Metric; name: string }) {
  const cur = p.daily.map((d) => ({ label: fmtDm(d.date), value: dailyValue(d, metric) }));
  const prev = p.dailyPrev.map((d) => ({ label: fmtDm(d.date), value: dailyValue(d, metric) }));
  const t = p.totals;
  const pt = p.prevTotals;
  const hasImp = t.impressions > 0;
  const isRate = metric === "ctr" || metric === "position";
  const headline =
    metric === "ctr" ? (hasImp ? fmtCtr(t.ctr) : "—")
    : metric === "position" ? (hasImp ? fmtPos(t.position) : "—")
    : fmtNum(t[metric]);
  const fmtAxis = metric === "ctr" ? (n: number) => `${n.toFixed(1)}%` : metric === "position" ? (n: number) => n.toFixed(1) : fmtNum;
  const fmtTip = metric === "ctr" ? (n: number) => `${n.toFixed(2)}%` : fmtAxis;

  // ยังไม่รู้ URL จริง = ไม่ได้ถาม Google เลย — ไม่วาดกราฟ 0 ให้เข้าใจผิดว่าไม่มีคนค้น
  if (p.unresolved) {
    return (
      <p className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
        URL นี้เป็นลิงก์แบบ ?p= ที่ยังหา URL จริงของหน้าไม่เจอ (บทความอาจยังไม่เผยแพร่) จึงยังไม่มีข้อมูลให้แสดง
        ลบแล้วบันทึกใหม่ด้วยลิงก์จริงของหน้า หรือรอจนบทความเผยแพร่
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {!p.hasData ? (
        <p className="rounded-xl bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-600">
          {NO_DATA_TEXT[kind]}
        </p>
      ) : null}

      <div>
        <p className="text-2xl font-semibold tabular-nums leading-tight text-brand-navy">{headline}</p>
        <p className="text-xs text-gray-500">
          {isRate ? `${name}ทั้งช่วงปัจจุบัน (ถ่วงตามการแสดงผล)` : `${name}รวมช่วงปัจจุบัน`} · ชี้หรือแตะบนกราฟเพื่อดูค่าของแต่ละวัน คลิกเพื่อค้างค่าไว้
          {metric === "position" ? " · อันดับยิ่งน้อยยิ่งดี (แกนกลับหัว)" : ""}
        </p>
      </div>

      <AreaChart
        height={240}
        showLegend
        invertY={metric === "position"}
        formatValue={fmtAxis}
        formatTooltip={fmtTip}
        series={[
          { name: `${name} (ช่วงปัจจุบัน)`, points: cur },
          ...(prev.length >= 2 ? [{ name: `${name} (ช่วงเทียบ)`, dashed: true, fill: false, points: prev }] : []),
        ]}
      />
      <p className="text-[11px] text-gray-400">เส้นทึบ = ช่วงปัจจุบัน, เส้นประ = ช่วงเทียบ</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="คลิก" value={fmtNum(t.clicks)}
          change={<Delta diff={t.clicks - pt.clicks} text={fmtNum(t.clicks - pt.clicks)} />} />
        <Stat label="การแสดงผล" value={fmtNum(t.impressions)}
          change={<Delta diff={t.impressions - pt.impressions} text={fmtNum(t.impressions - pt.impressions)} />} />
        <Stat label="CTR" value={hasImp ? fmtCtr(t.ctr) : "—"}
          change={hasImp && pt.impressions > 0
            ? <Delta diff={t.ctr - pt.ctr} text={`${((t.ctr - pt.ctr) * 100).toFixed(2)}%`} />
            : <span className="text-gray-400">—</span>} />
        <Stat label="อันดับเฉลี่ย" value={hasImp ? fmtPos(t.position) : "—"}
          change={hasImp && pt.impressions > 0
            ? <Delta lowerIsBetter diff={t.position - pt.position} text={(t.position - pt.position).toFixed(1)} />
            : <span className="text-gray-400">—</span>} />
      </div>
    </div>
  );
}
