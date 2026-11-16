"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, Info, Loader2, RefreshCw } from "lucide-react";
import { Chip, EmptyState, KpiTile, MeterBar, Panel, SearchPill, UnderlineTabs } from "@/components/ds";
import { affordableSites } from "@/lib/backlink-management/affordable";
import {
  ACTIVE_WINDOW_DAYS, NEAR_LIMIT_PCT,
  type TrackerHealth, type TrackerItem, type TrackerLink, type TrackerRow, type TrackerSummary, type TrackerTypeCount,
} from "@/lib/backlink-management/budget-tracker";
import { api, money, type Vendor } from "./shared";
import SearchSelect from "./SearchSelect";

export interface TrackerResp extends TrackerSummary {
  title: string;
  url: string;
  budgetTab: string | null;
  expenseTab: string | null;
  fetchedAt: string;
  /** key ในชีท → โปรเจกต์ใน MarsOS */
  links?: Record<string, TrackerLink>;
  /** โปรเจกต์ที่เพิ่งสร้างจากชีทในรอบนี้ */
  created?: string[];
}

type ListTab = "active" | "all" | "over" | "nobudget";

const pctText = (p: number | null) => (p === null ? "—" : `${p.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`);
const HEALTH: Record<TrackerHealth, { label: string; tone: "bad" | "warn" | "ok" | "muted"; meter: "bad" | "warn" | "ok" | "blue" }> = {
  over: { label: "เกินงบ", tone: "bad", meter: "bad" },
  near: { label: `ใช้เกิน ${NEAR_LIMIT_PCT}%`, tone: "warn", meter: "warn" },
  ok: { label: "ปกติ", tone: "ok", meter: "blue" },
  nobudget: { label: "ไม่มีงบในชีท", tone: "muted", meter: "blue" },
};
const AVATAR_TONES = ["bg-[#1d48f3] text-white", "bg-[#000E3F] text-white", "bg-[#177cfe] text-white", "bg-[#6b8cef] text-white", "bg-[#eff5f9] text-[#000E3F]"];

function avatarTone(key: string): string {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

function Avatar({ name, k, size = "h-10 w-10 text-sm" }: { name: string; k: string; size?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${size} ${avatarTone(k)}`} aria-hidden>
      {(name.trim()[0] || "?").toUpperCase()}
    </span>
  );
}

function TypeChips({ types }: { types: TrackerTypeCount[] }) {
  if (!types.length) return <span className="text-xs text-gray-400">ยังไม่มีลิงก์ที่ Published</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {types.map((t) => <Chip key={t.type} tone="muted" title={money(t.cost)}>{`${t.type} · ${t.links}`}</Chip>)}
    </div>
  );
}

function siteLabel(i: TrackerItem): string {
  const s = i.site || i.url;
  try { return s.startsWith("http") ? new URL(s).hostname.replace(/^www\./, "") : s; } catch { return s; }
}

function shortDate(d: string | null): string {
  if (!d) return "—";
  const t = new Date(`${d}T00:00:00`);
  return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });
}

function monthLabel(d: string | null, raw: string): string {
  if (!d) return raw ? "ไม่ระบุเดือน" : "ไม่มีวันที่";
  const t = new Date(`${d.slice(0, 7)}-01T00:00:00`);
  return Number.isNaN(t.getTime()) ? d.slice(0, 7) : t.toLocaleDateString("th-TH", { month: "long", year: "numeric" });
}

/** เกจครึ่งวงกลม % งบที่ใช้ */
function Gauge({ pct, tone }: { pct: number | null; tone: "bad" | "warn" | "ok" | "blue" }) {
  const p = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  const color = tone === "bad" ? "#dc2626" : tone === "warn" ? "#d97706" : "#1d48f3";
  const len = Math.PI * 80;
  return (
    <div className="relative mx-auto w-full max-w-[220px]">
      <svg viewBox="0 0 200 112" className="w-full" role="img" aria-label={`ใช้งบไป ${pctText(pct)}`}>
        <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="#eff5f9" strokeWidth="16" strokeLinecap="round" />
        <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke={color} strokeWidth="16" strokeLinecap="round" strokeDasharray={`${(p / 100) * len} ${len}`} />
      </svg>
      <div className="absolute inset-x-0 bottom-1 text-center">
        <div className="text-2xl font-semibold text-[#000E3F]">{pctText(pct)}</div>
        <div className="text-[11px] text-gray-500">ของงบที่ใช้ไปแล้ว</div>
      </div>
    </div>
  );
}

/** สัดส่วน General / High Authority ของลิงก์ที่ Published */
function RankSplit({ general, ha }: { general: { links: number; cost: number }; ha: { links: number; cost: number } }) {
  const total = general.links + ha.links;
  const gPct = total ? (general.links / total) * 100 : 0;
  return (
    <div className="space-y-2">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-[#eff5f9]" aria-hidden>
        {total ? <><div className="bg-[#6b8cef]" style={{ width: `${gPct}%` }} /><div className="bg-[#000E3F]" style={{ width: `${100 - gPct}%` }} /></> : null}
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl bg-[#eff5f9] p-2.5">
          <div className="flex items-center gap-1.5 text-gray-500"><span className="h-2 w-2 rounded-full bg-[#6b8cef]" />General (0–7,999)</div>
          <div className="mt-1 text-base font-semibold text-[#000E3F]">{`${general.links.toLocaleString()} ลิงก์`}</div>
          <div className="text-gray-500">{money(general.cost)}</div>
        </div>
        <div className="rounded-xl bg-[#eff5f9] p-2.5">
          <div className="flex items-center gap-1.5 text-gray-500"><span className="h-2 w-2 rounded-full bg-[#000E3F]" />High Authority (8,000+)</div>
          <div className="mt-1 text-base font-semibold text-[#000E3F]">{`${ha.links.toLocaleString()} ลิงก์`}</div>
          <div className="text-gray-500">{money(ha.cost)}</div>
        </div>
      </div>
    </div>
  );
}

function RankPill({ rank }: { rank: TrackerItem["rank"] }) {
  if (!rank) return <span className="text-gray-400">—</span>;
  return rank === "HIGH_AUTHORITY"
    ? <span className="inline-flex rounded-full bg-[#000E3F] px-2 py-0.5 text-[10px] font-medium text-white">High Authority</span>
    : <span className="inline-flex rounded-full bg-[#eff5f9] px-2 py-0.5 text-[10px] font-medium text-[#1d48f3]">General</span>;
}

/** งบ Backlink จาก Google Sheet ของทีม — ลูกค้าที่ Active, งบ/ใช้ไป/คงเหลือของแต่ละเจ้า และเจาะดูว่าใช้อะไรไปบ้าง */
export default function BudgetTrackerPanel({ onData, onProjectsChanged }: { onData?: (d: TrackerResp | null) => void; onProjectsChanged?: () => void }) {
  const [data, setData] = useState<TrackerResp | null>(null);
  const [error, setError] = useState<{ message: string; url?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState("");
  const [tab, setTab] = useState<ListTab>("active");
  const [q, setQ] = useState("");
  const [vendors, setVendors] = useState<Vendor[] | null>(null);
  const [vendorsFailed, setVendorsFailed] = useState(false);
  const [buyChoice, setBuyChoice] = useState("");
  const seq = useRef(0);
  const onDataRef = useRef(onData);
  onDataRef.current = onData;
  const onProjectsChangedRef = useRef(onProjectsChanged);
  onProjectsChangedRef.current = onProjectsChanged;

  const load = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const d = await api<TrackerResp>("/api/backlink-management/budget-tracker");
      if (my !== seq.current) return;
      setData(d);
      setError(null);
      onDataRef.current?.(d);
      if (d.created?.length) onProjectsChangedRef.current?.();
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

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const counts = useMemo(() => ({
    active: rows.filter((r) => r.active).length,
    all: rows.length,
    over: rows.filter((r) => r.health === "over").length,
    nobudget: rows.filter((r) => r.health === "nobudget").length,
  }), [rows]);
  const listed = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter((r) => (tab === "all" ? true : tab === "active" ? r.active : r.health === tab))
      .filter((r) => !needle || `${r.project} ${r.client} ${r.note}`.toLowerCase().includes(needle));
  }, [rows, tab, q]);

  const row: TrackerRow | null = useMemo(() => (selected ? rows.find((r) => r.key === selected) ?? null : null), [rows, selected]);
  // ลำดับก่อน/ถัดไปตามรายการที่กำลังดู (ถ้าโปรเจกต์ไม่อยู่ในรายการ ใช้ทั้งหมด)
  const nav = useMemo(() => (row && listed.some((r) => r.key === row.key) ? listed : rows), [row, listed, rows]);
  const navIndex = row ? nav.findIndex((r) => r.key === row.key) : -1;
  const items = useMemo(() => (data && row ? data.items.filter((i) => i.key === row.key) : []), [data, row]);
  const months = useMemo(() => {
    const groups: { label: string; items: TrackerItem[]; cost: number }[] = [];
    for (const i of items) {
      const label = monthLabel(i.date, i.dateRaw);
      const last = groups[groups.length - 1];
      if (last && last.label === label) { last.items.push(i); last.cost += i.status === "published" ? i.cost ?? 0 : 0; }
      else groups.push({ label, items: [i], cost: i.status === "published" ? i.cost ?? 0 : 0 });
    }
    return groups;
  }, [items]);

  const budgetRows = useMemo(() => rows.filter((r) => r.remaining !== null), [rows]);
  const buyId = useMemo(() => {
    if (budgetRows.some((r) => r.key === buyChoice)) return buyChoice;
    if (row && row.remaining !== null) return row.key;
    return budgetRows.reduce<TrackerRow | null>((best, r) => (!best || (r.remaining ?? 0) > (best.remaining ?? 0) ? r : best), null)?.key ?? "";
  }, [budgetRows, buyChoice, row]);
  const buyRow = budgetRows.find((r) => r.key === buyId) ?? null;
  const buy = useMemo(() => (vendors && buyRow ? affordableSites(buyRow.remaining ?? 0, vendors) : null), [vendors, buyRow]);

  const title = "งบ Backlink ของลูกค้า";
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
  const fetched = new Date(data.fetchedAt).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
  const totalPct = t.initial > 0 ? Math.min(100, (t.used / t.initial) * 100) : 0;
  const link = row ? data.links?.[row.key] : undefined;

  const affordable = (
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
  );

  // ───────── รายละเอียดลูกค้า ─────────
  if (row) {
    const h = HEALTH[row.health];
    const over = row.remaining !== null && row.remaining < 0;
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setSelected("")} className="inline-flex items-center gap-1 rounded-lg border border-input bg-white/90 px-2.5 py-1.5 text-xs hover:bg-gray-50">
            <ArrowLeft className="h-3.5 w-3.5" /> ลูกค้าทั้งหมด
          </button>
          <div className="flex-1" />
          <span className="text-xs text-gray-500">{`${navIndex + 1} จาก ${nav.length}`}</span>
          <button type="button" aria-label="ก่อนหน้า" disabled={navIndex <= 0} onClick={() => setSelected(nav[navIndex - 1].key)} className="rounded-lg border border-input bg-white/90 p-1.5 hover:bg-gray-50 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" aria-label="ถัดไป" disabled={navIndex < 0 || navIndex >= nav.length - 1} onClick={() => setSelected(nav[navIndex + 1].key)} className="rounded-lg border border-input bg-white/90 p-1.5 hover:bg-gray-50 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
        </div>

        <Panel padded={false} bodyClassName="p-4 md:p-6">
          <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <Avatar name={row.project} k={row.key} size="h-12 w-12 text-lg" />
                <div className="min-w-0">
                  <h3 className="truncate text-lg font-semibold text-[#000E3F]">{row.project}</h3>
                  <p className="text-xs text-gray-500">
                    {[row.client !== row.project ? row.client : "", row.note ? `แพ็กเกจ: ${row.note}` : "", row.lastDate ? `ลิงก์ล่าสุด ${shortDate(row.lastDate)}` : "ยังไม่มีลิงก์"].filter(Boolean).join(" · ")}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {row.active ? <Chip tone="info" dot>Active</Chip> : <Chip tone="muted">ไม่ Active</Chip>}
                    <Chip tone={h.tone}>{h.label}</Chip>
                    {link?.projectId ? <Chip tone="muted" title="โปรเจกต์ใน MarsOS">{`MarsOS: ${link.projectName}`}</Chip> : null}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <KpiTile label="งบทั้งหมด" value={row.initial === null ? "—" : money(row.initial)} tone="blue" hint={row.initial === null ? "ยังไม่ได้กรอกงบในชีท" : undefined} />
                <KpiTile label="ใช้ไปแล้ว" value={money(row.used)} tone="sky" />
                <KpiTile label="คงเหลือ" value={row.remaining === null ? "—" : money(row.remaining)} tone={over ? "warm" : "navy"} hint={over ? "เกินงบ" : undefined} />
                <KpiTile label="ลิงก์ Published" value={row.links.toLocaleString()} tone="mist" hint={row.plannedLinks ? `รอ (Planned) ${row.plannedLinks} · ${money(row.plannedCost)}` : undefined} />
              </div>
            </div>
            <div className="flex flex-col justify-center gap-2">
              <Gauge pct={row.usedPct} tone={h.meter} />
              <p className="text-center text-xs text-gray-500">{row.initial === null ? "ชีทยังไม่มีงบตั้งต้น" : `${money(row.used)} จาก ${money(row.initial)}`}</p>
            </div>
          </div>
        </Panel>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="General หรือ High Authority" subtitle="นับเฉพาะลิงก์ที่ Published · คอลัมน์ Type ในชีทมาก่อน ไม่มีจึงดูจากราคา">
            <RankSplit general={row.general} ha={row.highAuthority} />
          </Panel>
          <Panel title="ใช้ไปตามประเภท" subtitle="คอลัมน์ Type ในแท็บ Expense Log">
            <TypeChips types={row.byType} />
          </Panel>
        </div>

        <Panel title="รายการที่ใช้" subtitle="Published หักงบแล้ว · Planned ยังไม่หักงบ" padded={false} bodyClassName="p-4 pt-3 md:p-5 md:pt-4">
          {items.length === 0 ? (
            <p className="text-sm text-gray-500">ยังไม่มีรายการ Published หรือ Planned</p>
          ) : (
            <div className="space-y-4">
              {months.map((m) => (
                <div key={m.label}>
                  <div className="mb-1.5 flex items-baseline justify-between text-xs">
                    <span className="font-semibold text-[#000E3F]">{m.label}</span>
                    <span className="text-gray-500">{`${m.items.length} รายการ · ${money(m.cost)}`}</span>
                  </div>
                  <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-white/80 bg-white/70 shadow-sm">
                    {m.items.map((i) => (
                      <li key={`${i.row}-${i.key}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs">
                        <span className="w-16 shrink-0 text-gray-500">{i.date ? shortDate(i.date) : (i.dateRaw || "—")}</span>
                        <span className="min-w-0 flex-1 truncate">
                          {i.url ? <a href={i.url} target="_blank" rel="noreferrer" className="font-medium text-[#1d48f3] hover:underline" title={i.url}>{siteLabel(i)}</a> : <span className="font-medium">{i.site || "—"}</span>}
                          {i.anchor ? <span className="ml-2 text-gray-400" title={i.anchor}>{`“${i.anchor}”`}</span> : null}
                        </span>
                        {i.type ? <Chip tone="muted">{i.type}</Chip> : null}
                        <RankPill rank={i.rank} />
                        <span className="w-24 text-right font-medium tabular-nums">{i.cost === null ? "—" : money(i.cost)}</span>
                        {i.status === "published" ? <Chip tone="ok">Published</Chip> : <Chip tone="warn">Planned</Chip>}
                        {i.note ? <span className="basis-full truncate pl-[76px] text-gray-400" title={i.note}>{i.note}</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {affordable}
      </div>
    );
  }

  // ───────── ภาพรวมทุกลูกค้า ─────────
  return (
    <div className="space-y-4">
      <Panel
        title={title}
        subtitle={`${data.title || "Backlink Budget Tracker"} · ดึงล่าสุด ${fetched}`}
        actions={<>{sheetLink(data.url)}{refresh}</>}
        padded={false}
        bodyClassName="p-4 pt-3 md:p-5 md:pt-4"
      >
        <div className="space-y-4">
          <div className="rounded-2xl bg-[#000E3F] p-4 text-white md:p-5">
            <div className="text-xs text-white/70">ใช้งบ Backlink ไปแล้ว</div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
              <span className="text-2xl font-semibold md:text-3xl">{money(t.used)}</span>
              <span className="text-sm text-white/70">{`จากงบทั้งหมด ${money(t.initial)} (${pctText(t.usedPct)})`}</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/15" aria-hidden>
              <div className="h-full rounded-full bg-[#177cfe]" style={{ width: `${totalPct}%` }} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
              <div><div className="text-[11px] text-white/60">คงเหลือ</div><div className="font-semibold">{money(t.remaining)}</div></div>
              <div><div className="text-[11px] text-white/60">ลูกค้า Active</div><div className="font-semibold">{`${t.active} จาก ${rows.length}`}</div></div>
              <div><div className="text-[11px] text-white/60">เกินงบ</div><div className="font-semibold">{`${t.over} ราย`}</div></div>
              <div><div className="text-[11px] text-white/60">ลิงก์ Published</div><div className="font-semibold">{`${t.links.toLocaleString()} (General ${t.general.links} · HA ${t.highAuthority.links})`}</div></div>
            </div>
          </div>

          {data.created?.length ? <p className="text-xs text-[#1d48f3]">{`เพิ่มโปรเจกต์ใหม่จากชีทเข้าระบบแล้ว: ${data.created.join(", ")}`}</p> : null}
          {error ? <p className="text-xs text-red-600">{`ดึงใหม่ไม่สำเร็จ: ${error.message}`}</p> : null}
          {data.warnings.length ? <ul className="list-disc pl-5 text-xs text-amber-700">{data.warnings.map((w) => <li key={w}>{w}</li>)}</ul> : null}

          {rows.length === 0 ? (
            <EmptyState title="ชีทยังไม่มีโปรเจกต์" description="กรอกแท็บ Project Budget หรือ Expense Log ในชีท แล้วกด ดึงใหม่" />
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-3">
                <UnderlineTabs<ListTab>
                  className="min-w-0 flex-1"
                  tabs={[
                    { id: "active", label: "Active", count: counts.active },
                    { id: "all", label: "ทั้งหมด", count: counts.all },
                    { id: "over", label: "เกินงบ", count: counts.over },
                    { id: "nobudget", label: "ไม่มีงบในชีท", count: counts.nobudget },
                  ]}
                  value={tab}
                  onChange={setTab}
                />
                <SearchPill value={q} onChange={setQ} placeholder="ค้นหาลูกค้า" className="w-full sm:w-56" />
              </div>
              {tab === "active" ? (
                <p className="flex items-start gap-1.5 text-[11px] text-gray-500">
                  <Info className="mt-0.5 h-3 w-3 shrink-0" />
                  {`Active = ยังมีงบเหลือ หรือมีลิงก์รอ (Planned) หรือมีลิงก์ในชีทภายใน ${ACTIVE_WINDOW_DAYS} วันล่าสุด`}
                </p>
              ) : null}

              {listed.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-400">ไม่มีลูกค้าในกลุ่มนี้</p>
              ) : (
                <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-white/80 bg-white/70 shadow-sm">
                  {listed.map((r) => {
                    const h = HEALTH[r.health];
                    const l = data.links?.[r.key];
                    return (
                      <li key={r.key}>
                        <button type="button" onClick={() => setSelected(r.key)} className="grid w-full grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 px-3 py-3 text-left hover:bg-sky-50/60 md:grid-cols-[auto_minmax(0,1.3fr)_minmax(0,1.4fr)_auto_auto] md:px-4">
                          <Avatar name={r.project} k={r.key} />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-[#000E3F]">{r.project}</span>
                            <span className="block truncate text-xs text-gray-500">
                              {[r.client !== r.project ? r.client : "", r.note, l && !l.projectId ? "ยังไม่มีในระบบ" : ""].filter(Boolean).join(" · ") || (r.lastDate ? `ลิงก์ล่าสุด ${shortDate(r.lastDate)}` : "ยังไม่มีลิงก์")}
                            </span>
                          </span>
                          <span className="col-span-2 min-w-0 md:col-span-1">
                            <span className="mb-1 flex justify-between gap-2 text-xs">
                              <span className="text-gray-500">{`ใช้ ${money(r.used)}`}</span>
                              <span className="font-medium text-[#000E3F]">{r.initial === null ? "ไม่มีงบ" : `จาก ${money(r.initial)}`}</span>
                            </span>
                            <MeterBar value={r.used} max={r.initial && r.initial > 0 ? r.initial : Math.max(r.used, 1)} tone={h.meter} ariaLabel={`การใช้งบ ${r.project}`} />
                            <span className="mt-1 block text-[11px] text-gray-500">
                              {`คงเหลือ ${r.remaining === null ? "—" : money(r.remaining)} · General ${r.general.links} · HA ${r.highAuthority.links}${r.plannedLinks ? ` · รอ ${r.plannedLinks}` : ""}`}
                            </span>
                          </span>
                          <span className="hidden md:block"><Chip tone={h.tone}>{h.label}</Chip></span>
                          <span className="hidden text-xs font-medium text-[#1d48f3] md:block">ดูรายละเอียด</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>
      </Panel>

      {affordable}
    </div>
  );
}
