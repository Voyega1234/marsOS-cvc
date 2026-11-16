"use client";

import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, BookmarkCheck, CalendarClock, CheckCircle2, ChevronRight, History, PackageCheck, Star } from "lucide-react";
import { BarChart, CHART_COLORS, KpiTile, MeterBar, Panel, Segmented, StackedBar } from "@/components/ds";
import { cn } from "@/lib/utils";
import type { QuotaPackageView, QuotaView } from "@/lib/backlink-management/quota-types";
import { fmtDateTime } from "./shared";

const n = (v: number | null | undefined) => (v ?? 0).toLocaleString("th-TH");
const pctOf = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const pkgName = (p: QuotaPackageView) => p.vendorName || p.websiteText || p.websites[0] || "—";

type GroupMode = "type" | "vendor" | "sheet";
type ActionKind = "expiring" | "noUnit" | "stale" | "full";

const ACTION_META: Record<ActionKind, { icon: ReactNode; cls: string }> = {
  expiring: { icon: <CalendarClock className="h-4 w-4" />, cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" },
  noUnit: { icon: <AlertTriangle className="h-4 w-4" />, cls: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300" },
  stale: { icon: <History className="h-4 w-4" />, cls: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300" },
  full: { icon: <CheckCircle2 className="h-4 w-4" />, cls: "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300" },
};

function daysUntil(iso: string): number {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - now.getTime()) / 86400000);
}

function initials(name: string): string {
  const s = name.trim();
  if (!s) return "?";
  const parts = s.split(/\s+/);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : s.slice(0, 2)).toUpperCase();
}

/** ส่วนแดชบอร์ดของแท็บโควต้า — แสดงผลอย่างเดียว คำนวณจาก view ฝั่งเบราว์เซอร์ */
export function QuotaDashboard({ view, onFocusPackage }: { view: QuotaView; onFocusPackage: (p: QuotaPackageView) => void }) {
  const [mode, setMode] = useState<GroupMode>("type");
  const t = view.totals;
  const live = useMemo(() => view.packages.filter((p) => !p.stale), [view.packages]);

  const groups = useMemo(() => {
    const m = new Map<string, { label: string; used: number; usable: number }>();
    for (const p of view.packages) {
      const label = (mode === "type" ? p.type : mode === "vendor" ? pkgName(p) : p.sourceTitle) || "ไม่ระบุ";
      const g = m.get(label) ?? { label, used: 0, usable: 0 };
      g.used += p.used;
      g.usable += p.usable ?? 0;
      m.set(label, g);
    }
    return Array.from(m.values()).sort((a, b) => b.used + b.usable - (a.used + a.usable)).slice(0, 8);
  }, [view.packages, mode]);
  const groupMax = Math.max(1, ...groups.map((g) => g.used + g.usable));

  const actions = useMemo(() => {
    const out: { key: string; kind: ActionKind; pkg: QuotaPackageView; title: string; sub: string }[] = [];
    for (const p of view.packages) {
      if (!p.expired && p.expireDate && (p.usable ?? 0) > 0) {
        const d = daysUntil(p.expireDate);
        if (d >= 0 && d <= 30) out.push({ key: `e-${p.id}`, kind: "expiring", pkg: p, title: pkgName(p), sub: `ใกล้หมดอายุอีก ${d} วัน · ใช้ได้ ${p.usable}` });
      }
      if (p.units == null) out.push({ key: `u-${p.id}`, kind: "noUnit", pkg: p, title: pkgName(p), sub: "ยังไม่ระบุ Unit" });
      if (p.stale) out.push({ key: `s-${p.id}`, kind: "stale", pkg: p, title: pkgName(p), sub: "ไม่พบในชีทแล้ว" });
      if (p.units != null && p.remaining === 0) out.push({ key: `f-${p.id}`, kind: "full", pkg: p, title: pkgName(p), sub: "ใช้ครบแล้ว (เต็ม)" });
    }
    return out;
  }, [view.packages]);

  const statusSegs = useMemo(() => [
    { label: "เผยแพร่แล้ว", value: t.published, color: CHART_COLORS[0] },
    { label: "กำลังทำ", value: t.inProcess, color: CHART_COLORS[1] },
    { label: "จองไว้", value: t.reserved, color: CHART_COLORS[5] },
    { label: "ใช้ได้", value: t.usable, color: CHART_COLORS[4] },
  ], [t]);
  const statusTotal = statusSegs.reduce((s, x) => s + x.value, 0);

  const timeline = useMemo(() => {
    const now = new Date();
    const keyOf = (y: number, m: number) => y * 12 + m;
    const base = keyOf(now.getFullYear(), now.getMonth());
    const buckets = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      return { label: d.toLocaleDateString("th-TH", { month: "short", year: "2-digit" }), value: 0 };
    });
    let overdue = 0;
    let later = 0;
    for (const p of live) {
      if (p.expired) { overdue += p.remaining ?? 0; continue; }
      if (!p.expireDate || !(p.usable ?? 0)) continue;
      const d = new Date(`${p.expireDate.slice(0, 10)}T00:00:00`);
      const idx = keyOf(d.getFullYear(), d.getMonth()) - base;
      if (idx < 0) overdue += p.usable ?? 0;
      else if (idx < 6) buckets[idx].value += p.usable ?? 0;
      else later += p.usable ?? 0;
    }
    const data = [...buckets, ...(later > 0 ? [{ label: "ถัดไป", value: later }] : []), { label: "เลยกำหนด", value: overdue, color: CHART_COLORS[6] }];
    const peak = data.reduce((a, b) => (b.value > a.value ? b : a), data[0]);
    return { data, peak };
  }, [live]);

  const topPkgs = useMemo(
    () => [...view.packages].filter((p) => !p.expired && !p.stale && (p.usable ?? 0) > 0).sort((a, b) => (b.usable ?? 0) - (a.usable ?? 0)).slice(0, 5),
    [view.packages],
  );

  const recent = useMemo(() => {
    const rows: { id: string; name: string; sub: string; at: string }[] = [];
    for (const p of view.packages) {
      for (const s of p.slots) {
        const r = s.reservation;
        if (r) rows.push({ id: r.id, name: r.reservedByName || "—", sub: [r.website, r.projectName].filter(Boolean).join(" · ") || pkgName(p), at: r.createdAt });
      }
    }
    return rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, 5);
  }, [view.packages]);

  return (
    <div className="space-y-4">
      {/* 1. KPI */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          tone="blue" label="ซื้อมาแล้ว" value={n(t.bought)} icon={<PackageCheck className="h-4 w-4" />}
          hint={`ใช้ไป ${n(t.used)} / ${n(t.bought)} (${pctOf(t.used, t.bought)}%)`}
          footer={<MeterBar value={t.used} max={Math.max(1, t.bought)} />}
        />
        <KpiTile tone="sky" label="คงเหลือใช้ได้" value={n(t.usable)} icon={<CheckCircle2 className="h-4 w-4" />} hint={`คงเหลือทั้งหมด ${n(t.remaining)} (ไม่นับแพ็กเกจหมดอายุ)`} />
        <KpiTile tone="mist" label="จองไว้" value={n(t.reserved)} icon={<BookmarkCheck className="h-4 w-4" />} hint={`เผยแพร่ ${n(t.published)} · กำลังทำ ${n(t.inProcess)}`} />
        <KpiTile tone={t.expiringSoon > 0 ? "warm" : "plain"} label="ใกล้หมดอายุใน 30 วัน" value={n(t.expiringSoon)} icon={<CalendarClock className="h-4 w-4" />} hint={t.expiringSoon > 0 ? "ควรรีบใช้หรือจองก่อนหมดอายุ" : "ไม่มีแพ็กเกจใกล้หมดอายุ"} />
      </div>

      {/* 2. ภาพรวม + ต้องจัดการ */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel
          className="lg:col-span-2"
          title="ภาพรวมการใช้ลิงก์"
          subtitle="ใช้แล้ว เทียบกับที่ยังใช้ได้ (8 กลุ่มบนสุด)"
          actions={
            <Segmented<GroupMode>
              size="sm" ariaLabel="จัดกลุ่มภาพรวม" value={mode} onChange={setMode}
              options={[{ value: "type", label: "ตามประเภท" }, { value: "vendor", label: "ตามเว็บ/Vendor" }, { value: "sheet", label: "ตามชีท" }]}
            />
          }
        >
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-4xl font-semibold tabular-nums text-brand-navy">{n(t.usable)}</span>
            <span className="text-xs text-gray-500">ลิงก์ที่ใช้ได้ · ใช้ไปแล้ว {n(t.used)}</span>
          </div>
          <div className="mt-4 space-y-2.5">
            {groups.map((g) => (
              <div key={g.label} className="grid grid-cols-[minmax(80px,160px)_1fr_auto] items-center gap-3 text-xs">
                <div className="truncate text-gray-700 dark:text-gray-200" title={g.label}>{g.label}</div>
                <div className="flex h-3 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
                  <div className="h-full bg-brand-blue" style={{ width: `${(g.used / groupMax) * 100}%` }} />
                  <div className="h-full bg-sky-300 dark:bg-sky-400/60" style={{ width: `${(g.usable / groupMax) * 100}%` }} />
                </div>
                <div className="whitespace-nowrap tabular-nums text-gray-500">{n(g.used)} / <span className="font-medium text-brand-navy">{n(g.usable)}</span></div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-4 text-[11px] text-gray-500">
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-brand-blue" />ใช้แล้ว</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-sky-300 dark:bg-sky-400/60" />ใช้ได้</span>
          </div>
        </Panel>

        <Panel title="ต้องจัดการ" subtitle={actions.length > 0 ? `${actions.length} รายการ` : undefined}>
          {actions.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-sm text-gray-500">
              <CheckCircle2 className="h-6 w-6 text-emerald-500" />ไม่มีอะไรต้องจัดการ
            </div>
          ) : (
            <ul className="space-y-2">
              {actions.slice(0, 6).map((a) => (
                <li key={a.key}>
                  <button
                    type="button" onClick={() => onFocusPackage(a.pkg)}
                    className="flex w-full items-center gap-3 rounded-2xl border border-gray-100 bg-white/60 px-3 py-2 text-left transition hover:bg-white dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
                  >
                    <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", ACTION_META[a.kind].cls)}>{ACTION_META[a.kind].icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-brand-navy">{a.title}</span>
                      <span className="block truncate text-xs text-gray-500">{a.sub}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
                  </button>
                </li>
              ))}
              {actions.length > 6 ? <li className="px-1 text-xs text-gray-400">และอีก {actions.length - 6} รายการ</li> : null}
            </ul>
          )}
        </Panel>
      </div>

      {/* 3. แถวล่าง */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Panel title="สถานะลิงก์" subtitle={`รวม ${n(statusTotal)}`}>
          <StackedBar segments={statusSegs} showLegend={false} />
          <ul className="mt-3 space-y-1.5 text-xs">
            {statusSegs.map((s) => (
              <li key={s.label} className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-gray-600 dark:text-gray-300"><span className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label}</span>
                <span className="tabular-nums text-gray-500"><span className="font-medium text-brand-navy">{n(s.value)}</span> · {pctOf(s.value, statusTotal)}%</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="ไทม์ไลน์หมดอายุ" subtitle="ช่องที่ยังใช้ได้ แยกตามเดือนที่หมดอายุ">
          <BarChart data={timeline.data} height={150} showValues ariaLabel="ช่องที่ใช้ได้ตามเดือนหมดอายุ" />
          <p className="mt-2 text-xs text-gray-500">
            {timeline.peak && timeline.peak.value > 0 ? `หนักสุด: ${timeline.peak.label} (${n(timeline.peak.value)} ช่อง)` : "ไม่มีช่องที่ใกล้หมดอายุ"}
          </p>
        </Panel>

        <Panel title="แพ็กเกจที่ใช้ได้มากสุด" subtitle="5 อันดับแรก">
          {topPkgs.length === 0 ? <div className="py-6 text-center text-xs text-gray-400">ไม่มีแพ็กเกจที่ใช้ได้</div> : (
            <ul className="space-y-3">
              {topPkgs.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => onFocusPackage(p)} className="block w-full text-left">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="flex min-w-0 items-center gap-1.5"><Star className="h-3 w-3 shrink-0 text-amber-500" /><span className="truncate font-medium text-brand-navy">{pkgName(p)}</span></span>
                      <span className="shrink-0 tabular-nums text-gray-500">{n(p.usable)}{p.units != null ? ` / ${n(p.units)}` : ""}</span>
                    </div>
                    <div className="mb-1 truncate text-[11px] text-gray-400">{p.type || "—"}</div>
                    <MeterBar value={p.usable ?? 0} max={Math.max(1, p.units ?? p.usable ?? 1)} tone="ok" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="การจองล่าสุด" subtitle="5 รายการล่าสุด">
          {recent.length === 0 ? <div className="py-6 text-center text-xs text-gray-400">ยังไม่มีการจอง</div> : (
            <ul className="space-y-2.5">
              {recent.map((r) => (
                <li key={r.id} className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-blue/10 text-[11px] font-semibold text-brand-blue">{initials(r.name)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-brand-navy">{r.name}</span>
                    <span className="block truncate text-[11px] text-gray-500">{r.sub}</span>
                  </span>
                  <span className="shrink-0 text-[10px] text-gray-400">{fmtDateTime(r.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
