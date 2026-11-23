"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, Folder, FolderOpen, Loader2 } from "lucide-react";
import { Panel } from "@/components/ds";
import {
  trackerKind,
  type GscTrackerKind,
  type GscTrackerPerformance,
  type UploadGscTracker,
  type UploadGscTrackerFolder,
} from "@/lib/upload-article/gsc-trackers";
import type { UploadOwnerTag } from "@/lib/upload-article/types";

const KIND_BADGE: Record<GscTrackerKind, string> = {
  keyword: "Keyword · ทั้งเว็บ",
  page: "หน้า · ทุก keyword",
  pair: "Keyword + หน้า",
};

const NO_SUBGROUP = "ไม่อยู่ในกลุ่ม keyword";

function fmtNum(n: number): string { return Math.round(n).toLocaleString(); }
function fmtCtr(n: number): string { return `${(n * 100).toFixed(2)}%`; }
function fmtPos(n: number): string { return n ? n.toFixed(1) : "—"; }
const thSort = (a: string, b: string) => a.localeCompare(b, "th", { numeric: true });

interface Sum { clicks: number; impressions: number; posWeighted: number }

function sumPerf(list: UploadGscTracker[], perf: Map<string, GscTrackerPerformance> | null): Sum {
  const s: Sum = { clicks: 0, impressions: 0, posWeighted: 0 };
  if (!perf) return s;
  for (const t of list) {
    const p = perf.get(t.id);
    if (!p || p.unresolved) continue;
    s.clicks += p.totals.clicks;
    s.impressions += p.totals.impressions;
    s.posWeighted += p.totals.position * p.totals.impressions;
  }
  return s;
}

function SumText({ sum, loading }: { sum: Sum; loading: boolean }) {
  if (!sum.impressions && !sum.clicks) {
    return <span className="text-[11px] text-gray-400">{loading ? "กำลังโหลด…" : "—"}</span>;
  }
  const ctr = sum.impressions ? sum.clicks / sum.impressions : 0;
  const pos = sum.impressions ? sum.posWeighted / sum.impressions : 0;
  return (
    <span className="text-[11px] text-gray-600 tabular-nums">
      คลิก <b className="text-brand-navy">{fmtNum(sum.clicks)}</b> · แสดงผล <b className="text-brand-navy">{fmtNum(sum.impressions)}</b>
      {" "}· CTR <b className="text-brand-navy">{sum.impressions ? fmtCtr(ctr) : "—"}</b> · อันดับ <b className="text-brand-navy">{fmtPos(pos)}</b>
    </span>
  );
}

function Cells({ t, perf, loading }: { t: UploadGscTracker; perf: Map<string, GscTrackerPerformance> | null; loading: boolean }) {
  const p = perf?.get(t.id);
  if (!p) {
    const c = loading || !perf
      ? <Loader2 size={12} className="animate-spin text-gray-400" aria-label="กำลังโหลด" />
      : <span className="text-gray-400">—</span>;
    return <>{[0, 1, 2, 3, 4].map((i) => <td key={i} className="px-3 py-2 text-right">{c}</td>)}</>;
  }
  if (p.unresolved) {
    return <td colSpan={5} className="px-3 py-2 text-right text-[11px] text-gray-400">รอลิงก์จริง</td>;
  }
  const has = p.totals.impressions > 0;
  const diff = Math.round(p.totals.clicks - p.prevTotals.clicks);
  return (
    <>
      <td className="px-3 py-2 text-right tabular-nums">{fmtNum(p.totals.clicks)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{fmtNum(p.totals.impressions)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{has ? fmtCtr(p.totals.ctr) : "—"}</td>
      <td className="px-3 py-2 text-right tabular-nums">{has ? fmtPos(p.totals.position) : "—"}</td>
      <td className={`px-3 py-2 text-right tabular-nums ${diff > 0 ? "text-emerald-600" : diff < 0 ? "text-red-600" : "text-gray-400"}`}>
        {diff > 0 ? `+${fmtNum(diff)}` : diff < 0 ? `-${fmtNum(-diff)}` : "—"}
      </td>
    </>
  );
}

function RowLabel({ t, kind }: { t: UploadGscTracker; kind: GscTrackerKind }): ReactNode {
  const link = (text: string, mono: boolean) => (
    <a href={t.url} target="_blank" rel="noopener noreferrer"
      className={`break-all text-brand-blue hover:underline ${mono ? "font-mono text-[11px]" : ""}`}>{text}</a>
  );
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-1.5">
        {kind === "keyword" ? <span className="font-medium text-brand-navy">{t.keyword}</span>
          : kind === "page" ? (t.title ? link(t.title, false) : link(t.url, true))
          : <span className="font-medium text-brand-navy">{t.keyword}</span>}
        <span className="rounded-full bg-brand-mist px-1.5 py-px text-[10px] text-brand-navy">{KIND_BADGE[kind]}</span>
      </div>
      {kind === "pair" ? (
        <div className="mt-0.5 text-[11px] text-gray-500">{t.title ? link(t.title, false) : link(t.url, true)}</div>
      ) : null}
    </div>
  );
}

function GroupTable({ name, items, perf, loading, mode }: {
  name: string;
  items: UploadGscTracker[];
  perf: Map<string, GscTrackerPerformance> | null;
  loading: boolean;
  mode: "queries" | "pages";
}) {
  const sorted = useMemo(() => {
    const val = (t: UploadGscTracker) => {
      const p = perf?.get(t.id);
      return p && !p.unresolved ? p.totals : { clicks: -1, impressions: -1 };
    };
    return [...items].sort((a, b) => val(b).clicks - val(a).clicks || val(b).impressions - val(a).impressions);
  }, [items, perf]);
  const sum = useMemo(() => sumPerf(items, perf), [items, perf]);
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white/60">
      <table className="w-full min-w-[560px] text-xs">
        <caption className="px-3 py-2 text-left">
          <span className="text-[13px] font-semibold text-brand-navy">{name}</span>
          <span className="ml-2 text-[11px] text-gray-500">{items.length} รายการ</span>
          <span className="ml-3"><SumText sum={sum} loading={loading} /></span>
        </caption>
        <thead>
          <tr className="border-y border-gray-100 bg-gray-50/70 text-[11px] text-gray-500">
            <th className="px-3 py-1.5 text-left font-medium">{mode === "queries" ? "Keyword" : "หน้าเว็บ"}</th>
            <th className="px-3 py-1.5 text-right font-medium">คลิก</th>
            <th className="px-3 py-1.5 text-right font-medium">การแสดงผล</th>
            <th className="px-3 py-1.5 text-right font-medium">CTR</th>
            <th className="px-3 py-1.5 text-right font-medium">อันดับ</th>
            <th className="px-3 py-1.5 text-right font-medium">เปลี่ยนแปลง (คลิก)</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((t) => (
            <tr key={t.id} className="border-b border-gray-50 last:border-0">
              <td className="px-3 py-2"><RowLabel t={t} kind={trackerKind(t)} /></td>
              <Cells t={t} perf={perf} loading={loading} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function TrackerGroupTables({ mode, trackers, folders, perf, loading, ownerTags, onOpenTracked }: {
  mode: "queries" | "pages";
  trackers: UploadGscTracker[];
  folders: UploadGscTrackerFolder[];
  perf: Map<string, GscTrackerPerformance> | null;
  loading: boolean;
  ownerTags: UploadOwnerTag[];
  onOpenTracked?: () => void;
}) {
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const isQ = mode === "queries";

  const view = useMemo(() => {
    const shown = trackers.filter((t) => {
      const k = trackerKind(t);
      return k === "pair" || k === (isQ ? "keyword" : "page");
    });
    const byGroup = new Map<string, UploadGscTracker[]>();
    for (const t of shown) {
      const g = (t.group || "").trim();
      if (!g) continue;
      const arr = byGroup.get(g);
      if (arr) arr.push(t); else byGroup.set(g, [t]);
    }
    const names = new Set<string>([...folders.map((f) => f.name), ...Array.from(byGroup.keys())]);
    return Array.from(names).filter((n) => byGroup.has(n)).sort(thSort).map((name) => {
      const items = byGroup.get(name) ?? [];
      const rec = folders.find((f) => f.name === name);
      const subMap = new Map<string, UploadGscTracker[]>();
      const none: UploadGscTracker[] = [];
      for (const t of items) {
        const s = (t.subgroup || "").trim();
        if (!s) { none.push(t); continue; }
        const arr = subMap.get(s);
        if (arr) arr.push(t); else subMap.set(s, [t]);
      }
      const order = [...(rec?.subgroups ?? []), ...Array.from(subMap.keys()).filter((s) => !(rec?.subgroups ?? []).includes(s)).sort(thSort)];
      const subs = order.filter((s) => subMap.has(s)).map((s) => ({ name: s, items: subMap.get(s) ?? [] }));
      return { name, items, rec, subs, none };
    });
  }, [trackers, folders, isQ]);

  const toggle = (name: string) => setClosed((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  const title = isQ ? "Keyword ที่ติดตามตามโฟลเดอร์" : "หน้าเว็บที่ติดตามตามโฟลเดอร์";
  const noun = isQ ? "keyword" : "หน้าเว็บ";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-brand-navy">{title}</h3>
        {onOpenTracked ? (
          <button type="button" onClick={onOpenTracked} className="text-xs text-brand-blue hover:underline">
            จัดการที่แท็บ Keyword ที่ติดตาม
          </button>
        ) : null}
      </div>
      {view.length === 0 ? (
        <p className="text-xs text-gray-500">
          ยังไม่มีรายการในโฟลเดอร์ — กด ติดตาม ในตารางด้านล่างเพื่อเพิ่มเข้าโฟลเดอร์/กลุ่ม {noun}
        </p>
      ) : view.map((f) => {
        const open = !closed.has(f.name);
        const ownerName = f.rec?.ownerTagId ? ownerTags.find((o) => o.id === f.rec?.ownerTagId)?.name : undefined;
        const Icon = open ? FolderOpen : Folder;
        return (
          <Panel key={f.name} padded={false} bodyClassName="">
            <button type="button" onClick={() => toggle(f.name)} aria-expanded={open}
              className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-3xl px-4 py-3 text-left md:px-5">
              <Icon size={16} className="shrink-0 text-brand-blue" />
              <span className="text-sm font-semibold text-brand-navy">{f.name}</span>
              {ownerName ? <span className="rounded-full bg-indigo-50 px-2 py-px text-[10px] font-medium text-brand-blue">{ownerName}</span> : null}
              <span className="text-[11px] text-gray-500">{f.items.length} รายการ</span>
              <span className="min-w-0"><SumText sum={sumPerf(f.items, perf)} loading={loading} /></span>
              <ChevronDown size={14} className={`ml-auto shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
            {open ? (
              <div className="space-y-3 px-4 pb-4 md:px-5">
                {f.subs.map((s) => (
                  <GroupTable key={s.name} name={s.name} items={s.items} perf={perf} loading={loading} mode={mode} />
                ))}
                {f.none.length ? <GroupTable name={NO_SUBGROUP} items={f.none} perf={perf} loading={loading} mode={mode} /> : null}
              </div>
            ) : null}
          </Panel>
        );
      })}
    </div>
  );
}
