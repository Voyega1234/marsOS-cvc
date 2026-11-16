"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Chip, EmptyState, KpiTile, MeterBar, Panel } from "@/components/ds";
import { affordableSites } from "@/lib/backlink-management/affordable";
import type { TrackerItem, TrackerRow, TrackerSummary, TrackerTypeCount } from "@/lib/backlink-management/budget-tracker";
import { api, money, type Vendor } from "./shared";
import SearchSelect from "./SearchSelect";

export interface TrackerResp extends TrackerSummary {
  title: string;
  url: string;
  budgetTab: string | null;
  expenseTab: string | null;
  fetchedAt: string;
}

const ITEMS_PAGE = 50;

const pctText = (p: number | null) => (p === null ? "—" : `${p.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`);
const meterTone = (used: number, initial: number | null) =>
  initial === null || initial <= 0 ? (used > 0 ? "bad" : "ok") : used > initial ? "bad" : used / initial > 0.8 ? "warn" : "ok";

function TypeChips({ types }: { types: TrackerTypeCount[] }) {
  if (!types.length) return <span className="text-gray-400">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {types.map((t) => <Chip key={t.type} tone="muted" title={money(t.cost)}>{`${t.type} ${t.links}`}</Chip>)}
    </div>
  );
}

function siteLabel(i: TrackerItem): string {
  const s = i.site || i.url;
  try { return s.startsWith("http") ? new URL(s).hostname.replace(/^www\./, "") : s; } catch { return s; }
}

/** งบ Backlink จาก Google Sheet ของทีม — ดูทุกโปรเจกต์ หรือเจาะทีละโปรเจกต์ว่าใช้อะไรไปบ้าง */
export default function BudgetTrackerPanel({ onData }: { onData?: (d: TrackerResp | null) => void }) {
  const [data, setData] = useState<TrackerResp | null>(null);
  const [error, setError] = useState<{ message: string; url?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [vendors, setVendors] = useState<Vendor[] | null>(null);
  const [vendorsFailed, setVendorsFailed] = useState(false);
  const [buyChoice, setBuyChoice] = useState("");
  const seq = useRef(0);
  const onDataRef = useRef(onData);
  onDataRef.current = onData;

  const load = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const d = await api<TrackerResp>("/api/backlink-management/budget-tracker");
      if (my !== seq.current) return;
      setData(d);
      setError(null);
      onDataRef.current?.(d);
    } catch (e) {
      if (my !== seq.current) return;
      const err = e as Error & { data?: { url?: string } };
      setError({ message: err.message || "อ่าน Google Sheet ไม่สำเร็จ", url: err.data?.url });
      onDataRef.current?.(null);
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const v = await api<{ vendors: Vendor[] }>("/api/backlink-management/vendors?status=ACTIVE");
        if (!cancelled) setVendors(v.vendors ?? []);
      } catch {
        if (!cancelled) setVendorsFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { setShowAll(false); }, [selected]);

  const row: TrackerRow | null = useMemo(() => (data && selected ? data.rows.find((r) => r.key === selected) ?? null : null), [data, selected]);
  const items = useMemo(() => (data ? (row ? data.items.filter((i) => i.key === row.key) : data.items) : []), [data, row]);

  const budgetRows = useMemo(() => (data ? data.rows.filter((r) => r.remaining !== null) : []), [data]);
  const buyId = useMemo(() => {
    if (budgetRows.some((r) => r.key === buyChoice)) return buyChoice;
    if (row && row.remaining !== null) return row.key;
    return budgetRows.reduce<TrackerRow | null>((best, r) => (!best || (r.remaining ?? 0) > (best.remaining ?? 0) ? r : best), null)?.key ?? "";
  }, [budgetRows, buyChoice, row]);
  const buyRow = budgetRows.find((r) => r.key === buyId) ?? null;
  const buy = useMemo(() => (vendors && buyRow ? affordableSites(buyRow.remaining ?? 0, vendors) : null), [vendors, buyRow]);

  const title = "งบ Backlink จาก Google Sheet";
  const refresh = (
    <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-1 rounded-lg border border-input bg-white/90 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-60">
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} ดึงใหม่
    </button>
  );
  const sheetLink = (href: string) => (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-input bg-white/90 px-2 py-1 text-xs hover:bg-gray-50">
      <ExternalLink className="h-3.5 w-3.5" /> เปิดชีท
    </a>
  );

  if (error && !data) {
    return (
      <Panel title={title} actions={<>{error.url ? sheetLink(error.url) : null}{refresh}</>}>
        <p className="text-sm text-red-600">{error.message}</p>
      </Panel>
    );
  }
  if (!data) return <Panel title={title}><p className="text-sm text-gray-400">กำลังอ่าน Google Sheet...</p></Panel>;

  const t = data.totals;
  const k = row
    ? { initial: row.initial, used: row.used, remaining: row.remaining, usedPct: row.usedPct, links: row.links, plannedLinks: row.plannedLinks, plannedCost: row.plannedCost, byType: row.byType }
    : { initial: t.initial as number | null, used: t.used, remaining: t.remaining as number | null, usedPct: t.usedPct, links: t.links, plannedLinks: t.plannedLinks, plannedCost: t.plannedCost, byType: t.byType };
  const over = k.remaining !== null && k.remaining < 0;
  const shownItems = showAll ? items : items.slice(0, ITEMS_PAGE);
  const fetched = new Date(data.fetchedAt).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="space-y-4">
      <Panel
        title={title}
        subtitle={`${data.title || "Backlink Budget Tracker"} · ดึงล่าสุด ${fetched}`}
        actions={<>{sheetLink(data.url)}{refresh}</>}
        padded={false}
        bodyClassName="p-4 pt-3 md:p-5 md:pt-4"
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <SearchSelect
              className="!w-auto min-w-[220px]"
              value={selected}
              onChange={setSelected}
              emptyLabel="ทุกโปรเจกต์"
              ariaLabel="เลือกโปรเจกต์ในชีท"
              options={data.rows.map((r) => ({ value: r.key, label: r.project, hint: r.client !== r.project ? r.client : undefined, keywords: r.note }))}
            />
            {row?.note ? <Chip tone="info">{`แพ็กเกจ: ${row.note}`}</Chip> : null}
            {error ? <span className="text-xs text-red-600">{`ดึงใหม่ไม่สำเร็จ: ${error.message}`}</span> : null}
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile label="Total Initial Budget" value={k.initial === null ? "—" : money(k.initial)} tone="blue" hint={row && row.initial === null ? "ยังไม่ได้กรอกงบในชีท" : undefined} />
            <KpiTile label="Used Budget" value={money(k.used)} tone="sky" hint={`${k.links.toLocaleString()} ลิงก์ที่ Published`} />
            <KpiTile label="Remaining Budget" value={k.remaining === null ? "—" : money(k.remaining)} tone={over ? "warm" : "navy"} hint={over ? "เกินงบ" : undefined} />
            <KpiTile label="Overall Budget Used" value={pctText(k.usedPct)} tone="mist" hint={k.plannedLinks ? `รอ (Planned) ${k.plannedLinks} ลิงก์ · ${money(k.plannedCost)}` : undefined} />
          </div>
          <MeterBar value={k.used} max={k.initial || 1} tone={meterTone(k.used, k.initial)} ariaLabel="การใช้งบ" />
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span>ใช้ไปตามประเภท:</span>
            <TypeChips types={k.byType} />
          </div>
          {data.warnings.length ? <ul className="list-disc pl-5 text-xs text-amber-700">{data.warnings.map((w) => <li key={w}>{w}</li>)}</ul> : null}

          {!row ? (
            data.rows.length === 0 ? (
              <EmptyState title="ชีทยังไม่มีโปรเจกต์" description="กรอกแท็บ Project Budget หรือ Expense Log ในชีท แล้วกด ดึงใหม่" />
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-white/80 bg-white/70 shadow-sm">
                <table className="tbl w-full text-xs">
                  <thead>
                    <tr>
                      <th className="text-left">Client</th><th className="text-left">Project</th>
                      <th className="num">Initial</th><th className="num">Used</th><th className="num">Remaining</th><th className="num">% ใช้</th>
                      <th className="num">ลิงก์</th><th className="text-left">ประเภท</th><th className="text-left">แพ็กเกจ (Note)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.key} className="cursor-pointer hover:bg-sky-50/60" onClick={() => setSelected(r.key)} title="ดูรายการที่ใช้">
                        <td>{r.client}</td>
                        <td className="font-medium text-[#0B2D5C]">{r.project}</td>
                        <td className="num whitespace-nowrap">{r.initial === null ? "—" : money(r.initial)}</td>
                        <td className="num whitespace-nowrap">{money(r.used)}</td>
                        <td className={`num whitespace-nowrap ${r.remaining !== null && r.remaining < 0 ? "font-semibold text-red-600" : ""}`}>{r.remaining === null ? "—" : money(r.remaining)}</td>
                        <td className="num">{pctText(r.usedPct)}</td>
                        <td className="num whitespace-nowrap">{r.plannedLinks ? `${r.links} (+${r.plannedLinks} รอ)` : r.links}</td>
                        <td><TypeChips types={r.byType} /></td>
                        <td className="max-w-[220px] truncate" title={r.note}>{r.note || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="font-semibold">
                      <td colSpan={2}>รวม</td>
                      <td className="num whitespace-nowrap">{money(t.initial)}</td>
                      <td className="num whitespace-nowrap">{money(t.used)}</td>
                      <td className="num whitespace-nowrap">{money(t.remaining)}</td>
                      <td className="num">{pctText(t.usedPct)}</td>
                      <td className="num">{t.links}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )
          ) : null}
        </div>
      </Panel>

      <Panel
        title={row ? `รายการที่ใช้ — ${row.project}` : "รายการที่ใช้ล่าสุด (ทุกโปรเจกต์)"}
        subtitle="จากแท็บ Expense Log · Published หักงบแล้ว · Planned ยังไม่หักงบ"
        actions={row ? <button type="button" className="rounded-lg border border-input bg-white/90 px-2 py-1 text-xs hover:bg-gray-50" onClick={() => setSelected("")}>กลับไปดูทุกโปรเจกต์</button> : undefined}
        padded={false}
        bodyClassName="p-4 pt-3 md:p-5 md:pt-4"
      >
        {items.length === 0 ? (
          <p className="text-sm text-gray-500">ยังไม่มีรายการ Published หรือ Planned</p>
        ) : (
          <div className="space-y-2">
            <div className="overflow-x-auto rounded-2xl border border-white/80 bg-white/70 shadow-sm">
              <table className="tbl w-full text-xs">
                <thead>
                  <tr>
                    <th className="text-left">วันที่</th>
                    {row ? null : <th className="text-left">Project</th>}
                    <th className="text-left">เว็บ / ลิงก์</th><th className="text-left">ประเภท</th><th className="num">ราคา</th>
                    <th className="text-left">Anchor Text</th><th className="text-left">สถานะ</th><th className="text-left">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {shownItems.map((i) => (
                    <tr key={`${i.row}-${i.key}`}>
                      <td className="whitespace-nowrap">{i.date ?? (i.dateRaw || "—")}</td>
                      {row ? null : <td><button type="button" className="text-left text-[#0B2D5C] hover:underline" onClick={() => setSelected(i.key)}>{i.project}</button></td>}
                      <td className="max-w-[260px] truncate">
                        {i.url ? <a href={i.url} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline" title={i.url}>{siteLabel(i)}</a> : (i.site || "—")}
                      </td>
                      <td>{i.type || "—"}</td>
                      <td className="num whitespace-nowrap">{i.cost === null ? "—" : money(i.cost)}</td>
                      <td className="max-w-[200px] truncate" title={i.anchor}>{i.anchor || "—"}</td>
                      <td>{i.status === "published" ? <Chip tone="ok">Published</Chip> : <Chip tone="warn">Planned</Chip>}</td>
                      <td className="max-w-[200px] truncate" title={i.note}>{i.note || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {items.length > ITEMS_PAGE ? (
              <button type="button" className="text-xs text-sky-700 hover:underline" onClick={() => setShowAll((v) => !v)}>
                {showAll ? "แสดงน้อยลง" : `แสดงทั้งหมด ${items.length.toLocaleString()} รายการ`}
              </button>
            ) : null}
          </div>
        )}
      </Panel>

      <Panel title="งบที่เหลือซื้ออะไรได้บ้าง" subtitle="ใช้งบคงเหลือตามชีท เทียบกับราคาในคลังเว็บ">
        {budgetRows.length === 0 ? (
          <p className="text-sm text-gray-500">ชีทยังไม่มีโปรเจกต์ที่กรอก Initial Budget</p>
        ) : (
          <div className="space-y-3">
            <SearchSelect
              className="!w-auto min-w-[200px]"
              value={buyId}
              onChange={setBuyChoice}
              ariaLabel="เลือกโปรเจกต์"
              options={budgetRows.map((r) => ({ value: r.key, label: r.project, hint: r.client !== r.project ? r.client : undefined }))}
            />
            {vendorsFailed ? (
              <p className="text-sm text-red-600">โหลดคลังเว็บไม่สำเร็จ — รีเฟรชหน้าเพื่อลองใหม่</p>
            ) : !buyRow || !buy ? (
              <p className="text-sm text-gray-400">กำลังโหลดคลังเว็บ...</p>
            ) : (buyRow.remaining ?? 0) <= 0 ? (
              <p className="text-sm text-gray-500">งบของโปรเจกต์นี้ไม่เหลือแล้ว</p>
            ) : buy.pricedSites === 0 ? (
              <p className="text-sm text-gray-500">คลังเว็บยังไม่มีเว็บที่ใส่ราคา</p>
            ) : buy.total === 0 ? (
              <p className="text-sm text-gray-500">{`งบคงเหลือไม่พอสำหรับเว็บใดในคลัง (ราคาถูกสุด ${money(buy.cheapest)})`}</p>
            ) : (
              <>
                <p className="text-sm text-gray-600">
                  {`งบคงเหลือ ${money(buyRow.remaining ?? 0)} · ซื้อได้ ${buy.total} เว็บ จาก ${buy.pricedSites} เว็บที่มีราคาในคลัง · ราคาถูกสุด ${money(buy.cheapest)} · ถ้าเลือกเว็บราคาถูกสุดก่อน ซื้อได้สูงสุด ${buy.greedyCount} เว็บ (เว็บละ 1 ลิงก์ รวม ${money(buy.greedyCost)})`}
                </p>
                <div className="overflow-x-auto rounded-2xl border border-white/80 bg-white/70 shadow-sm">
                  <table className="tbl w-full text-xs">
                    <thead><tr><th className="text-left">เว็บ</th><th className="text-left">หมวด</th><th className="num">DR</th><th className="num">Traffic</th><th className="text-left">ราคาที่ซื้อได้</th><th className="num">ซื้อได้สูงสุด</th></tr></thead>
                    <tbody>
                      {buy.sites.map((s) => (
                        <tr key={s.id}>
                          <td>{s.domain}</td>
                          <td>{s.category || "—"}</td>
                          <td className="num">{s.domainRating ?? "—"}</td>
                          <td className="num">{s.traffic !== null ? s.traffic.toLocaleString("th-TH") : "—"}</td>
                          <td><div className="flex flex-wrap gap-1">{s.options.map((o) => <Chip key={o.label} tone="muted">{`${o.label} ${o.price.toLocaleString("th-TH")}`}</Chip>)}</div></td>
                          <td className="num whitespace-nowrap">{`${s.maxLinks} ลิงก์`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {buy.total > buy.sites.length ? <p className="text-xs text-gray-400">{`แสดง ${buy.sites.length} จาก ${buy.total} เว็บ (เรียงตาม DR สูงสุด)`}</p> : null}
              </>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}
