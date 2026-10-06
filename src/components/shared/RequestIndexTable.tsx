"use client";

/**
 * ตาราง Request Index ใช้ร่วม Upload Article / PBN Backlinks / SEO SME —
 * URL, ส่ง Request Index ไปเมื่อไหร่ (ผลล่าสุด), performance จาก GSC และกดส่งใหม่ได้ทีละแถวหรือหลายแถว
 * ผู้เรียกจัดการเก็บผล (records) และการยิง API เอง ตารางนี้ดูแลแค่ UI + toast
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, ExternalLink, Loader2, RefreshCw, SearchCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface IndexRecord { url: string; at: string; ok: boolean; error?: string }

export interface IndexTableRow {
  key: string;
  title: string;
  url: string;
  /** บรรทัดรอง เช่น ชื่อเว็บ PBN */
  sub?: string;
  canRequest: boolean;
  /** เหตุผลที่กดไม่ได้ (แสดงแทนปุ่ม) */
  blockedReason?: string;
}

export interface IndexPerfRow {
  clicks: number; impressions: number; ctr: number; position: number;
  prevClicks: number; prevImpressions: number; prevPosition: number;
}

export type IndexPerfResult =
  | { rows: Record<string, IndexPerfRow>; period: { start: string; end: string }; warning?: string }
  | { error: string; needSetup?: boolean };

type Filter = "all" | "never" | "ok" | "failed";

const DAY_OPTIONS = [7, 28, 90] as const;
const FILTER_LABELS: Record<Filter, string> = { all: "ทั้งหมด", never: "ยังไม่เคยส่ง", ok: "ส่งแล้ว", failed: "ไม่สำเร็จ" };

function fmtNum(n: number): string { return Math.round(n).toLocaleString(); }
function fmtCtr(n: number): string { return `${(n * 100).toFixed(2)}%`; }
function fmtPos(n: number): string { return n ? n.toFixed(1) : "—"; }
function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("th-TH", { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function fmtDay(s: string): string {
  const p = s.split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s;
}

function Delta({ cur, prev, invert = false }: { cur: number; prev: number; invert?: boolean }) {
  if (!prev && !cur) return null;
  const diff = cur - prev;
  if (Math.abs(diff) < 0.05) return null;
  const good = invert ? diff < 0 : diff > 0;
  const text = invert ? diff.toFixed(1) : `${diff > 0 ? "+" : ""}${fmtNum(diff)}`;
  return <span className={`block text-[10px] ${good ? "text-emerald-600" : "text-rose-500"}`}>{text}</span>;
}

export default function RequestIndexTable({
  rows, records, loadPerf, onRequest, setupLabel, onSetup, emptyText,
}: {
  rows: IndexTableRow[];
  records: Record<string, IndexRecord | undefined>;
  /** โหลด performance ตามช่วงวัน — key ของ rows ใน result ต้องตรงกับ IndexTableRow.key */
  loadPerf: (days: number) => Promise<IndexPerfResult>;
  /** ยิง Request Index ของแถวนั้น — ผู้เรียกอัปเดต records เอง */
  onRequest: (key: string) => Promise<{ ok: boolean; error?: string }>;
  /** ปุ่มพาไปตั้งค่าเมื่อ performance ขาดการตั้งค่า (needSetup) */
  setupLabel?: string;
  onSetup?: () => void;
  emptyText: string;
}) {
  const [days, setDays] = useState<(typeof DAY_OPTIONS)[number]>(28);
  const [filter, setFilter] = useState<Filter>("all");
  const [perf, setPerf] = useState<Record<string, IndexPerfRow>>({});
  const [period, setPeriod] = useState<{ start: string; end: string } | null>(null);
  const [perfLoading, setPerfLoading] = useState(false);
  const [perfError, setPerfError] = useState<{ msg: string; needSetup?: boolean } | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);

  const refreshPerf = useCallback(async () => {
    setPerfLoading(true);
    setPerfError(null);
    try {
      const r = await loadPerf(days);
      if ("error" in r) { setPerfError({ msg: r.error, needSetup: r.needSetup }); return; }
      setPerf(r.rows);
      setPeriod(r.period);
      if (r.warning) setPerfError({ msg: r.warning });
    } catch (e) {
      setPerfError({ msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setPerfLoading(false);
    }
  }, [loadPerf, days]);

  useEffect(() => { if (rows.length > 0) refreshPerf(); }, [refreshPerf, rows.length]);

  const list = useMemo(() => rows.filter(row => {
    const ir = records[row.key];
    if (filter === "never") return !ir;
    if (filter === "ok") return !!ir?.ok;
    if (filter === "failed") return !!ir && !ir.ok;
    return true;
  }), [rows, records, filter]);

  async function requestOne(key: string, quiet = false): Promise<boolean> {
    setBusy(prev => ({ ...prev, [key]: true }));
    try {
      const r = await onRequest(key);
      if (!quiet) {
        if (r.ok) toast.success("ส่ง Request Index ให้ Google แล้ว");
        else toast.error(`Request Index ไม่สำเร็จ: ${r.error || "ไม่ทราบสาเหตุ"}`);
      }
      return r.ok;
    } catch (e) {
      if (!quiet) toast.error(`Request Index ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      setBusy(prev => ({ ...prev, [key]: false }));
    }
  }

  // ยิงทีละแถว (ไม่พร้อมกัน) — กันโควตา Indexing API พุ่งและให้เช็คหน้าเว็บทีละอัน
  async function requestSelected() {
    const keys = list.filter(row => selected.has(row.key) && row.canRequest).map(row => row.key);
    if (keys.length === 0) return;
    setBulkRunning(true);
    let ok = 0;
    for (const k of keys) if (await requestOne(k, true)) ok++;
    setBulkRunning(false);
    setSelected(new Set());
    if (ok === keys.length) toast.success(`ส่ง Request Index แล้ว ${ok} รายการ`);
    else toast.warning(`ส่งสำเร็จ ${ok}/${keys.length} รายการ — ดูเหตุผลในคอลัมน์ Request Index`);
  }

  const selectable = list.filter(row => row.canRequest);
  const allSelected = selectable.length > 0 && selectable.every(row => selected.has(row.key));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(selectable.map(row => row.key)));
  const toggle = (key: string) => setSelected(prev => {
    const n = new Set(prev);
    if (n.has(key)) n.delete(key); else n.add(key);
    return n;
  });

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-center bg-white border border-gray-200 rounded-xl">
        <SearchCheck size={32} className="text-gray-200" />
        <p className="text-gray-400 text-sm">{emptyText}</p>
      </div>
    );
  }

  const counts: Record<Filter, number> = {
    all: rows.length,
    never: rows.filter(row => !records[row.key]).length,
    ok: rows.filter(row => records[row.key]?.ok).length,
    failed: rows.filter(row => records[row.key] && !records[row.key]!.ok).length,
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-gray-200 bg-white p-0.5">
          {(Object.keys(FILTER_LABELS) as Filter[]).map(f => (
            <button key={f} type="button" onClick={() => setFilter(f)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium ${filter === f ? "bg-brand-mist text-brand-blue" : "text-gray-500 hover:bg-gray-50"}`}>
              {FILTER_LABELS[f]} ({counts[f]})
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-gray-500">
          Performance
          <select value={days} onChange={e => setDays(Number(e.target.value) as (typeof DAY_OPTIONS)[number])}
            className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs">
            {DAY_OPTIONS.map(d => <option key={d} value={d}>{d} วันล่าสุด</option>)}
          </select>
          <button type="button" onClick={refreshPerf} disabled={perfLoading} title="โหลด performance ใหม่"
            className="p-1 rounded-md text-gray-400 hover:bg-gray-100 disabled:opacity-50">
            {perfLoading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          </button>
          {period && <span className="text-gray-400">({fmtDay(period.start)} – {fmtDay(period.end)}, เทียบช่วงก่อนหน้า)</span>}
        </div>
        <div className="ml-auto">
          <Button size="sm" onClick={requestSelected} disabled={bulkRunning || selected.size === 0}>
            {bulkRunning ? <Loader2 size={12} className="mr-1 animate-spin" /> : <SearchCheck size={12} className="mr-1" />}
            Request Index ที่เลือก ({selected.size})
          </Button>
        </div>
      </div>

      {perfError && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          <AlertCircle size={13} /> Performance: {perfError.msg}
          {perfError.needSetup && onSetup && <button type="button" onClick={onSetup} className="underline font-semibold">{setupLabel || "ไปตั้งค่า"}</button>}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-xs font-semibold text-gray-500">
              <th className="px-3 py-2.5 w-8"><input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={selectable.length === 0} /></th>
              <th className="text-left px-3 py-2.5">บทความ / URL</th>
              <th className="text-left px-3 py-2.5">Request Index ล่าสุด</th>
              <th className="text-right px-3 py-2.5">Clicks</th>
              <th className="text-right px-3 py-2.5">Impressions</th>
              <th className="text-right px-3 py-2.5">CTR</th>
              <th className="text-right px-3 py-2.5">Position</th>
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {list.map(row => {
              const ir = records[row.key];
              const p = perf[row.key];
              const url = row.url || ir?.url || "";
              return (
                <tr key={row.key} className="hover:bg-gray-50/60 align-top">
                  <td className="px-3 py-3"><input type="checkbox" checked={selected.has(row.key)} onChange={() => toggle(row.key)} disabled={!row.canRequest} /></td>
                  <td className="px-3 py-3 max-w-sm">
                    <p className="font-medium text-brand-navy truncate">{row.title}</p>
                    {row.sub && <p className="text-[11px] text-gray-500">{row.sub}</p>}
                    {url ? (
                      <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[11px] text-brand-blue hover:underline break-all">
                        <ExternalLink size={10} className="shrink-0" /> {url}
                      </a>
                    ) : <p className="text-[11px] text-gray-400">ยังไม่มีลิงก์</p>}
                  </td>
                  <td className="px-3 py-3 text-xs">
                    {!ir ? <span className="text-gray-400">ยังไม่เคยส่ง</span>
                      : ir.ok ? <span className="text-emerald-600">ส่งแล้ว · {fmtDateTime(ir.at)}</span>
                      : (
                        <div className="text-rose-500">
                          <p>ไม่สำเร็จ · {fmtDateTime(ir.at)}</p>
                          <p className="text-[11px] max-w-xs break-words">{ir.error}</p>
                        </div>
                      )}
                  </td>
                  {p ? (
                    <>
                      <td className="px-3 py-3 text-right tabular-nums">{fmtNum(p.clicks)}<Delta cur={p.clicks} prev={p.prevClicks} /></td>
                      <td className="px-3 py-3 text-right tabular-nums">{fmtNum(p.impressions)}<Delta cur={p.impressions} prev={p.prevImpressions} /></td>
                      <td className="px-3 py-3 text-right tabular-nums">{fmtCtr(p.ctr)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{fmtPos(p.position)}{p.position > 0 && p.prevPosition > 0 && <Delta cur={p.position} prev={p.prevPosition} invert />}</td>
                    </>
                  ) : (
                    <td colSpan={4} className="px-3 py-3 text-right text-xs text-gray-300">{perfLoading ? "กำลังโหลด…" : "—"}</td>
                  )}
                  <td className="px-3 py-3 text-right">
                    {row.canRequest ? (
                      <Button size="sm" variant="outline" onClick={() => requestOne(row.key)} disabled={!!busy[row.key] || bulkRunning}>
                        {busy[row.key] ? <Loader2 size={11} className="mr-1 animate-spin" /> : <SearchCheck size={11} className="mr-1" />}
                        {ir?.ok ? "ส่งอีกครั้ง" : "Request Index"}
                      </Button>
                    ) : <span className="text-[11px] text-gray-400">{row.blockedReason || "ส่งไม่ได้"}</span>}
                  </td>
                </tr>
              );
            })}
            {list.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-xs text-gray-400">ไม่มีรายการในตัวกรองนี้</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-400">
        ข้อมูล Search Console ช้ากว่าจริงประมาณ 2–3 วัน · บทความใหม่อาจยังเป็น 0 จนกว่า Google จะ index · โควตา Indexing API 200 URL/วัน (รวมทุกลูกค้า) · service account ต้องเป็น Owner ใน GSC ของเว็บนั้น
      </p>
    </div>
  );
}
