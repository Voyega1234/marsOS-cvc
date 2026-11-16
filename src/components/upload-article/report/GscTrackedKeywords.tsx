"use client";

/**
 * Upload Article > Report > "Keyword ที่ติดตาม" — คู่ keyword + URL ที่ทีมกด "บันทึก Monitor" ไว้
 * แสดงผล GSC รายวันของแต่ละคู่เป็นกราฟเส้น (ดึงเฉพาะตอนแท็บนี้ถูกเปิด เพื่อไม่เปลืองโควตา GSC)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, BookmarkPlus, Loader2, RefreshCw, Trash2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AreaChart, EmptyState, Panel, Segmented } from "@/components/ds";
import {
  UPLOAD_MAX_GSC_TRACKERS, UPLOAD_MAX_TRACKER_KEYWORD, UPLOAD_MAX_TRACKER_URL,
  type GscTrackerPerformance, type GscTrackerPerformanceResponse, type UploadGscTracker,
} from "@/lib/upload-article/gsc-trackers";

export interface TrackerArticleOption { title: string; url: string }
export interface TrackerDraft { keyword: string; url?: string; title?: string }

type Metric = "clicks" | "impressions";

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
  clientId, trackers, onTrackersChange, articles, periodParams, draft, onDraftConsumed,
}: {
  clientId: string;
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
  const [keyword, setKeyword] = useState("");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [saving, setSaving] = useState(false);

  // ร่างจากแท็บอื่น (เช่นกด "ติดตาม" ที่คำค้นหา) → เติมฟอร์มแล้วแจ้งผู้ปกครองว่าใช้แล้ว
  useEffect(() => {
    if (!draft) return;
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

  async function submit() {
    if (saving) return;
    if (!keyword.trim()) { toast.error("กรอก keyword ที่ต้องการติดตาม"); return; }
    if (!url.trim()) { toast.error("เลือกบทความหรือกรอก URL ของหน้าที่ต้องการติดตาม"); return; }
    setSaving(true);
    try {
      const r = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: keyword.trim(), url: url.trim(), ...(title ? { title } : {}) }),
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

  async function remove(t: UploadGscTracker) {
    if (!window.confirm(`เลิกติดตาม "${t.keyword}" ของหน้านี้?`)) return;
    try {
      const r = await fetch(`${base}?id=${encodeURIComponent(t.id)}`, { method: "DELETE" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "ลบไม่สำเร็จ"); return; }
      if (Array.isArray(d.trackers)) onTrackersChange(d.trackers);
      toast.success("เลิกติดตามแล้ว");
    } catch (e) {
      toast.error(`ลบไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const name = metric === "clicks" ? "คลิก" : "การแสดงผล";
  const inputCls = "h-9 rounded-full border border-gray-200 px-3 text-sm bg-white";

  return (
    <div className="space-y-4">
      {/* ── ฟอร์มเพิ่ม ── */}
      <div className="rounded-2xl border border-white/80 bg-white/70 shadow-sm backdrop-blur p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-brand-navy">บันทึก Monitor</p>
            <p className="text-xs text-gray-500 mt-0.5">เลือกบทความ (หรือกรอก URL เอง) คู่กับ keyword เพื่อดูผล Search Console รายวันของคู่นี้</p>
          </div>
          <span className="text-[11px] text-gray-400 tabular-nums">{trackers.length}/{UPLOAD_MAX_GSC_TRACKERS}</span>
        </div>

        <div className="flex items-start gap-2 flex-wrap">
          <input
            value={keyword}
            maxLength={UPLOAD_MAX_TRACKER_KEYWORD}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
            placeholder="keyword ที่ต้องการติดตาม"
            className={`${inputCls} w-full sm:w-64`}
          />

          <div className="relative w-full sm:w-72">
            <button type="button" onClick={() => setPickerOpen((o) => !o)}
              className={`${inputCls} w-full text-left truncate flex items-center gap-1.5 ${title ? "text-brand-navy" : "text-gray-500"}`}>
              <Search size={12} className="shrink-0 text-gray-400" />
              <span className="truncate">{title || "เลือกจากบทความที่อัปโหลด"}</span>
            </button>
            {pickerOpen && (
              <div className="absolute z-20 mt-1 w-full sm:w-[28rem] max-w-[90vw] rounded-2xl border border-gray-200 bg-white shadow-lg p-2 space-y-1.5">
                <input
                  autoFocus
                  value={pickerQuery}
                  onChange={(e) => setPickerQuery(e.target.value)}
                  placeholder="ค้นหาชื่อบทความหรือ URL"
                  className="h-8 w-full rounded-full border border-gray-200 px-3 text-xs"
                />
                <div className="max-h-64 overflow-y-auto">
                  {filteredArticles.length === 0 ? (
                    <p className="px-2 py-3 text-xs text-gray-400">{articles.length === 0 ? "ยังไม่มีบทความที่เผยแพร่แล้ว — กรอก URL เองได้" : "ไม่พบบทความ"}</p>
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

          <input
            value={url}
            maxLength={UPLOAD_MAX_TRACKER_URL}
            onChange={(e) => { setUrl(e.target.value); setTitle(""); }}
            onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
            placeholder="URL ของหน้า (แก้ไขเองได้)"
            className={`${inputCls} w-full sm:w-72 font-mono text-xs`}
          />

          <Button size="sm" onClick={() => void submit()} disabled={saving}>
            {saving ? <Loader2 size={12} className="animate-spin mr-1.5" /> : <BookmarkPlus size={12} className="mr-1.5" />}
            บันทึก Monitor
          </Button>
        </div>
      </div>

      {trackers.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<BookmarkPlus className="h-5 w-5" />}
            title="ยังไม่มี keyword ที่ติดตาม"
            description="กรอก keyword แล้วเลือกบทความในฟอร์มด้านบน หรือกดปุ่ม บันทึก Monitor ที่แถว keyword ในแท็บอื่น ๆ ของ Report"
          />
        </Panel>
      ) : (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <Segmented
              size="sm"
              ariaLabel="เลือกตัวชี้วัด"
              value={metric}
              onChange={setMetric}
              options={[{ value: "clicks", label: "คลิก" }, { value: "impressions", label: "การแสดงผล" }]}
            />
            {loading && <Loader2 size={14} className="animate-spin text-gray-400" />}
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

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {trackers.map((t) => {
              const p = perfById.get(t.id);
              return (
                <Panel
                  key={t.id}
                  title={t.keyword}
                  subtitle={
                    <span className="block min-w-0">
                      {t.title && <span className="block truncate text-gray-600">{t.title}</span>}
                      <a href={t.url} target="_blank" rel="noopener noreferrer"
                        className="block truncate text-brand-blue font-mono text-[10px] hover:underline" title={t.url}>{t.url}</a>
                      {p && p.matchUrl && p.matchUrl !== t.url && (
                        <a href={p.matchUrl} target="_blank" rel="noopener noreferrer"
                          className="block truncate text-gray-500 font-mono text-[10px] hover:underline" title={p.matchUrl}>ใช้เทียบกับ: {p.matchUrl}</a>
                      )}
                    </span>
                  }
                  actions={
                    <Button size="sm" variant="outline" onClick={() => void remove(t)} title="เลิกติดตาม">
                      <Trash2 size={12} />
                    </Button>
                  }
                >
                  {!p ? (
                    <div className="py-10 flex justify-center text-gray-400">
                      {loading ? <Loader2 size={18} className="animate-spin" /> : <span className="text-xs">ยังไม่มีข้อมูล</span>}
                    </div>
                  ) : (
                    <TrackerBody p={p} metric={metric} name={name} />
                  )}
                </Panel>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function TrackerBody({ p, metric, name }: { p: GscTrackerPerformance; metric: Metric; name: string }) {
  const cur = p.daily.map((d) => ({ label: fmtDm(d.date), value: metric === "clicks" ? d.clicks : d.impressions }));
  const prev = p.dailyPrev.map((d) => ({ label: fmtDm(d.date), value: metric === "clicks" ? d.clicks : d.impressions }));
  const total = p.totals[metric];
  const t = p.totals;
  const pt = p.prevTotals;
  const hasImp = t.impressions > 0;

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
      {p.matchedPages.length === 0 ? (
        <p className="rounded-xl bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-600">
          Search Console ไม่มีข้อมูลของ keyword นี้บนหน้านี้ในช่วงที่เลือก
        </p>
      ) : null}

      <div>
        <p className="text-2xl font-semibold tabular-nums leading-tight text-brand-navy">{fmtNum(total)}</p>
        <p className="text-xs text-gray-500">{name}รวมช่วงปัจจุบัน · ชี้หรือแตะบนกราฟเพื่อดูค่าของแต่ละวัน คลิกเพื่อค้างค่าไว้</p>
      </div>

      <AreaChart
        height={240}
        showLegend
        formatValue={fmtNum}
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
