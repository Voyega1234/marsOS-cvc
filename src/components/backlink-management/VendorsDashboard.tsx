"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, BarChart3, ChevronRight, Gauge, Globe2, PauseCircle, PhoneOff, Tag, Wallet } from "lucide-react";
import { BarChart, Chip, KpiTile, Panel, Segmented, StackedBar, chartColor, formatCompact } from "@/components/ds";
import { VENDOR_RANKS, vendorRank } from "@/lib/backlink-management/vendor-rank";
import { money, type Vendor } from "./shared";

const NO_CATEGORY = "ไม่ระบุหมวด";
type View = "category" | "dr" | "price" | "rank";

const avg = (a: number[]) => (a.length ? a.reduce((s, n) => s + n, 0) / a.length : 0);
const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const PRICE_BANDS: { label: string; min: number; max: number }[] = [
  { label: "< 500", min: 0.01, max: 500 },
  { label: "500–1,499", min: 500, max: 1500 },
  { label: "1,500–2,999", min: 1500, max: 3000 },
  { label: "3,000–4,999", min: 3000, max: 5000 },
  { label: "5,000+", min: 5000, max: Infinity },
];
const DR_BANDS = [
  { label: "DR 0–19", min: 0, max: 20 },
  { label: "DR 20–39", min: 20, max: 40 },
  { label: "DR 40–59", min: 40, max: 60 },
  { label: "DR 60–79", min: 60, max: 80 },
  { label: "DR 80+", min: 80, max: Infinity },
];

const card = "rounded-2xl border border-white/80 bg-white/60 p-3 dark:border-white/10 dark:bg-white/5";

/** แดชบอร์ดสรุปคลังเว็บ — แสดงผลล้วน คำนวณจากรายการที่โหลดมาแล้ว (rows) ไม่เรียก API */
export default function VendorsDashboard({ rows, onPick }: { rows: Vendor[]; onPick: (domain: string) => void }) {
  const [view, setView] = useState<View>("category");

  const s = useMemo(() => {
    const total = rows.length;
    const active = rows.filter((v) => v.status === "ACTIVE").length;
    const drs = rows.map((v) => v.domainRating).filter((n): n is number => typeof n === "number");
    const traffics = rows.map((v) => v.traffic).filter((n): n is number => typeof n === "number");
    const prices = rows.map((v) => v.price).filter((n) => n > 0);
    const topTraffic = rows.filter((v) => typeof v.traffic === "number").sort((a, b) => (b.traffic ?? 0) - (a.traffic ?? 0))[0];

    const catMap = new Map<string, number>();
    for (const v of rows) catMap.set(v.category, (catMap.get(v.category) ?? 0) + 1);
    const cats = Array.from(catMap.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

    const drBands = DR_BANDS.map((b) => ({ label: b.label, value: drs.filter((n) => n >= b.min && n < b.max).length }));
    const priceBands = PRICE_BANDS.map((b) => ({ label: b.label, value: prices.filter((n) => n >= b.min && n < b.max).length }));
    const rankBands = [
      ...VENDOR_RANKS.map((r) => ({ label: `${r.label} (${r.range})`, value: rows.filter((v) => vendorRank(v.price) === r.key).length })),
      { label: "ยังไม่มีราคา", value: rows.filter((v) => vendorRank(v.price) === null).length },
    ];

    const noContact = rows.filter((v) => !v.contactName && !v.contactChannel);
    const noPrice = rows.filter((v) => !(v.price > 0));
    const noDr = rows.filter((v) => v.domainRating === null);
    const inactive = rows.filter((v) => v.status !== "ACTIVE");
    const outdated = rows.filter((v) => v.dataStatus === "OUTDATED");

    const topDr = rows.filter((v) => typeof v.domainRating === "number")
      .sort((a, b) => (b.domainRating ?? 0) - (a.domainRating ?? 0) || (b.traffic ?? 0) - (a.traffic ?? 0)).slice(0, 5);
    // คุ้มสุด = ราคาต่อ 1 DR ต่ำสุด (เฉพาะเว็บที่มีราคาและ DR ≥ 40)
    const value = rows.filter((v) => v.price > 0 && (v.domainRating ?? 0) >= 40)
      .map((v) => ({ v, per: v.price / (v.domainRating as number) }))
      .sort((a, b) => a.per - b.per).slice(0, 5);

    return {
      total, active, drs, traffics, prices, topTraffic, cats, drBands, priceBands, rankBands, noContact, noPrice, noDr, inactive, outdated, topDr, value,
      avgDr: avg(drs), medDr: median(drs), sumTraffic: traffics.reduce((a, n) => a + n, 0), avgPrice: avg(prices),
      minPrice: prices.length ? Math.min(...prices) : 0, maxPrice: prices.length ? Math.max(...prices) : 0,
    };
  }, [rows]);

  const chartData = view === "category"
    ? s.cats.slice(0, 12).map(([c, n], i) => ({ label: c || NO_CATEGORY, value: n, color: chartColor(i) }))
    : view === "dr" ? s.drBands : view === "rank" ? s.rankBands : s.priceBands;

  const todo: { icon: React.ReactNode; title: string; sub: string; domain: string }[] = [];
  const add = (list: Vendor[], icon: React.ReactNode, title: string) => {
    if (list.length) todo.push({ icon, title: `${title} ${list.length} เว็บ`, sub: list.slice(0, 3).map((v) => v.domain).join(", "), domain: list[0].domain });
  };
  add(s.noContact, <PhoneOff className="h-4 w-4" />, "ยังไม่มีข้อมูลติดต่อ");
  add(s.noPrice, <Tag className="h-4 w-4" />, "ยังไม่มีราคาเริ่มต้น");
  add(s.noDr, <Gauge className="h-4 w-4" />, "ยังไม่มี DR");
  add(s.inactive, <PauseCircle className="h-4 w-4" />, "สถานะไม่ใช้งาน");
  add(s.outdated, <AlertTriangle className="h-4 w-4" />, "ข้อมูลเก่า");

  const pct = (n: number) => (s.total ? Math.round((n / s.total) * 100) : 0);
  const bar = (p: number) => (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200/80 dark:bg-white/10">
      <div className="h-full rounded-full bg-brand-blue" style={{ width: `${Math.min(100, Math.max(0, p))}%` }} />
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile tone="blue" label="จำนวนเว็บ" value={s.total.toLocaleString()} icon={<Globe2 className="h-4 w-4" />}
          hint={`ใช้งาน ${s.active.toLocaleString()} (${pct(s.active)}%)`} footer={bar(pct(s.active))} />
        <KpiTile tone="sky" label="DR เฉลี่ย" value={s.drs.length ? s.avgDr.toFixed(1) : "—"} icon={<Gauge className="h-4 w-4" />}
          hint={`มัธยฐาน ${s.drs.length ? s.medDr : "—"} · มี DR ${s.drs.length}/${s.total}`} footer={bar(s.avgDr)} />
        <KpiTile tone="mist" label="Traffic รวม" value={formatCompact(s.sumTraffic)} icon={<BarChart3 className="h-4 w-4" />}
          hint={s.topTraffic ? `สูงสุด ${s.topTraffic.domain} (${formatCompact(s.topTraffic.traffic ?? 0)})` : "ยังไม่มีข้อมูล traffic"} />
        <KpiTile tone="warm" label="ราคาเริ่มต้นเฉลี่ย" value={s.prices.length ? money(Math.round(s.avgPrice)) : "—"} icon={<Wallet className="h-4 w-4" />}
          hint={s.prices.length ? `ต่ำสุด ${money(s.minPrice)} – สูงสุด ${money(s.maxPrice)}` : "ยังไม่มีราคา"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2" title="ภาพรวมคลังเว็บ" subtitle="จำนวนเว็บ"
          actions={<Segmented size="sm" ariaLabel="มุมมองกราฟ" value={view} onChange={setView}
            options={[{ value: "category", label: "ตามหมวด" }, { value: "dr", label: "ตาม DR" }, { value: "price", label: "ตามราคา" }, { value: "rank", label: "ตาม Rank" }]} />}>
          {chartData.some((d) => d.value > 0)
            ? <BarChart data={chartData} height={260} showValues ariaLabel="จำนวนเว็บ" />
            : <p className="py-10 text-center text-xs text-gray-500">ยังไม่มีข้อมูลสำหรับมุมมองนี้</p>}
        </Panel>
        <Panel title="ต้องจัดการ" subtitle="กดเพื่อค้นหาเว็บนั้นในตาราง">
          {todo.length === 0 ? (
            <p className="py-8 text-center text-xs text-gray-500">ข้อมูลครบถ้วนดี</p>
          ) : (
            <ul className="space-y-2">
              {todo.slice(0, 6).map((t) => (
                <li key={t.title}>
                  <button type="button" onClick={() => onPick(t.domain)}
                    className={`${card} flex w-full items-center gap-3 text-left transition hover:bg-brand-mist/60 dark:hover:bg-white/10`}>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/80 text-brand-blue dark:bg-white/10">{t.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-brand-navy">{t.title}</span>
                      <span className="block truncate text-[11px] text-gray-500">{t.sub}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Panel title="หมวด" subtitle={`${s.cats.length} หมวด`}>
          <StackedBar legendColumns={1} ariaLabel="สัดส่วนหมวด"
            segments={s.cats.slice(0, 5).map(([c, n], i) => ({ label: c || NO_CATEGORY, value: n, color: chartColor(i) }))
              .concat(s.cats.length > 5 ? [{ label: "อื่น ๆ", value: s.cats.slice(5).reduce((a, [, n]) => a + n, 0), color: chartColor(4) }] : [])}
            formatValue={(n) => n.toLocaleString()} />
        </Panel>
        <Panel title="สถานะ">
          <div className="flex flex-wrap gap-2">
            <Chip tone="ok" dot>ใช้งาน {s.active.toLocaleString()}</Chip>
            <Chip tone="muted" dot>ไม่ใช้งาน {(s.total - s.active).toLocaleString()}</Chip>
            {s.outdated.length ? <Chip tone="warn" dot>ข้อมูลเก่า {s.outdated.length.toLocaleString()}</Chip> : null}
          </div>
          <div className="mt-4 space-y-2 text-xs text-gray-600">
            {[["มีข้อมูลติดต่อ", s.total - s.noContact.length], ["มีราคา", s.total - s.noPrice.length], ["มี DR", s.total - s.noDr.length]].map(([l, n]) => (
              <div key={l as string}>
                <div className="mb-1 flex justify-between"><span>{l}</span><span className="tabular-nums">{n} ({pct(n as number)}%)</span></div>
                {bar(pct(n as number))}
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="เว็บ DR สูงสุด" subtitle="Top 5">
          <ol className="space-y-2">
            {s.topDr.length === 0 ? <li className="text-xs text-gray-500">ยังไม่มีข้อมูล DR</li> : s.topDr.map((v) => (
              <li key={v.id} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate font-medium">{v.domain}</span>
                <Chip tone="info">DR {v.domainRating}</Chip>
                <span className="w-12 text-right tabular-nums text-gray-500">{v.traffic != null ? formatCompact(v.traffic) : "—"}</span>
              </li>
            ))}
          </ol>
        </Panel>
        <Panel title="เว็บราคาคุ้มสุด" subtitle="ราคาต่อ 1 DR ต่ำสุด (DR ≥ 40)">
          <ol className="space-y-2">
            {s.value.length === 0 ? <li className="text-xs text-gray-500">ยังไม่มีเว็บที่มีทั้งราคาและ DR ≥ 40</li> : s.value.map(({ v, per }) => (
              <li key={v.id} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate font-medium">{v.domain}</span>
                <span className="tabular-nums text-gray-500">DR {v.domainRating}</span>
                <span className="w-20 text-right tabular-nums" title={`฿${Math.round(per).toLocaleString()} / DR`}>{money(v.price)}</span>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </div>
  );
}
