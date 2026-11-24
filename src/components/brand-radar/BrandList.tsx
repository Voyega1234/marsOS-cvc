"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Camera, ChevronRight, Download, Loader2, Plus, Radar, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Chip, downloadCsv, EmptyState, MeterBar, PageHeader, Panel, SearchPill, Segmented, Sparkline, type ChipTone } from "@/components/ds";
import { BRAND_STATUSES, BRAND_STATUS_LABEL, type BrandStatus, type BrandsRes, type BrandSummaryDTO } from "@/lib/brand-radar/types";
import { rasterizeLogo } from "@/components/upload-article/ClientAvatar";
import { api, fmtDate, fmtNum, fmtPct, postJson } from "./shared";
import { BrandLogo } from "./BrandLogo";

/** the brand's own picture (uploaded logo, else its site icon); the coloured initials are the fallback */
export type BrandPicture = { logo: string | null; favicon: string | null };

type SortKey = "visibility_desc" | "visibility_asc" | "last_scan" | "name";

const STATUS_TONE: Record<BrandStatus, ChipTone> = { active: "ok", scanning: "info", no_data: "muted", needs_setup: "warn" };
const AVATAR_COLORS = ["bg-blue-100 text-blue-700", "bg-emerald-100 text-emerald-700", "bg-amber-100 text-amber-700", "bg-rose-100 text-rose-700", "bg-violet-100 text-violet-700", "bg-cyan-100 text-cyan-700"];

// Customers never see the internal "needs setup" state; show it as no data
const statusShown = (s: BrandStatus, clientView?: boolean): BrandStatus => (clientView && s === "needs_setup" ? "no_data" : s);
const statusTone = (s: BrandStatus, clientView?: boolean): ChipTone => STATUS_TONE[statusShown(s, clientView)];
const statusLabel = (s: BrandStatus, clientView?: boolean): string => BRAND_STATUS_LABEL[statusShown(s, clientView)];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return Array.from(parts[0]).slice(0, 2).join("").toUpperCase();
  return (Array.from(parts[0])[0] + Array.from(parts[1])[0]).toUpperCase();
}

function colorFor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function changeText(change: number | null): { text: string; cls: string } {
  if (change === null || !Number.isFinite(change)) return { text: "N/A", cls: "text-gray-400" };
  const pts = change * 100;
  if (Math.abs(pts) < 0.05) return { text: "0.0 จุด", cls: "text-gray-500" };
  const body = `${Math.abs(pts).toFixed(1)} จุด`;
  return pts > 0 ? { text: `+${body}`, cls: "text-emerald-600" } : { text: `−${body}`, cls: "text-red-600" };
}

function sparkValues(b: BrandSummaryDTO): number[] {
  return b.spark.map((s) => s.rate).filter((r): r is number => r !== null && Number.isFinite(r));
}

function timeOf(iso: string | null): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function Thumb({ name }: { name: string }) {
  return (
    <span aria-hidden className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-semibold ${colorFor(name)}`}>
      {initials(name)}
    </span>
  );
}

/** staff-only: upload / change / remove the brand logo straight from the list row */
function LogoUploader({ b, picture, onLogo, children }: {
  b: BrandSummaryDTO;
  picture?: BrandPicture;
  onLogo: (id: string, logo: string | null) => void;
  children: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function save(logo: string | null): Promise<void> {
    setBusy(true);
    try {
      const res = await api<{ logo: string | null }>("/api/brand-radar/logo", postJson({ projectId: b.id, logo }, "PUT"));
      if (!res.ok) throw new Error(res.data.error || `HTTP ${res.status}`);
      onLogo(b.id, res.data.logo ?? null);
    } catch (e) {
      toast.error(`${logo === null ? "ลบโลโก้ไม่สำเร็จ" : "อัปโหลดโลโก้ไม่สำเร็จ"}: ${e instanceof Error ? e.message : "ไม่ทราบสาเหตุ"}`);
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File | undefined): Promise<void> {
    if (!file) return;
    setBusy(true);
    try {
      const dataUrl = await rasterizeLogo(file);
      await save(dataUrl);
    } catch (e) {
      toast.error(`อัปโหลดโลโก้ไม่สำเร็จ: ${e instanceof Error ? e.message : "ไม่ทราบสาเหตุ"}`);
      setBusy(false);
    }
  }

  return (
    <div className="group/logo relative shrink-0" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <div className={busy ? "opacity-50" : undefined}>{children}</div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg"
        className="hidden"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          void onFile(f);
        }}
      />
      <button
        type="button"
        disabled={busy}
        aria-label={`อัปโหลดโลโก้ ${b.name}`}
        title="อัปโหลดโลโก้"
        onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
        onKeyDown={(e) => e.stopPropagation()}
        className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/45 text-white opacity-0 transition focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-brand-navy group-hover/logo:opacity-100 disabled:cursor-not-allowed"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Camera className="h-4 w-4" aria-hidden />}
      </button>
      {picture?.logo && (
        <button
          type="button"
          disabled={busy}
          aria-label={`ลบโลโก้ ${b.name}`}
          title="ลบโลโก้"
          onClick={(e) => { e.stopPropagation(); void save(null); }}
          onKeyDown={(e) => e.stopPropagation()}
          className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-gray-700 text-white opacity-0 shadow transition hover:bg-red-600 focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-brand-navy group-hover/logo:opacity-100 disabled:cursor-not-allowed"
        >
          <X className="h-3 w-3" aria-hidden />
        </button>
      )}
    </div>
  );
}

function NameBlock({ b, clientView, picture, onLogo }: { b: BrandSummaryDTO; clientView?: boolean; picture?: BrandPicture; onLogo?: (id: string, logo: string | null) => void }) {
  const showClient = b.clientName && b.clientName !== b.name;
  const pic = picture?.logo || picture?.favicon
    ? <BrandLogo name={b.name} logo={picture.logo} favicon={picture.favicon} size={40} rounded="rounded-xl" />
    : <Thumb name={b.name} />;
  return (
    <div className="flex min-w-0 items-center gap-3">
      {!clientView && onLogo ? <LogoUploader b={b} picture={picture} onLogo={onLogo}>{pic}</LogoUploader> : pic}
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-brand-navy">{b.name}</div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500">
          {b.website && <span className="truncate">{b.website}</span>}
          {showClient && <span className="truncate">· {b.clientName}</span>}
          {b.manual && !clientView && <Chip tone="muted">สร้างใน Brand Radar</Chip>}
        </div>
      </div>
    </div>
  );
}

function Visibility({ b }: { b: BrandSummaryDTO }) {
  const ch = changeText(b.change);
  const mark = b.topCompetitor?.mentionRate ?? undefined;
  return (
    <div className="min-w-0">
      <div className="text-sm font-semibold tabular-nums text-brand-navy">{fmtPct(b.visibilityRate)}</div>
      {b.visibilityRate !== null ? (
        <div title={mark !== undefined ? "เส้น = อัตราที่ AI เอ่ยชื่อคู่แข่งอันดับ 1" : undefined}>
          <MeterBar value={b.visibilityRate} max={1} mark={mark} ariaLabel={`Visibility ${fmtPct(b.visibilityRate)}`} />
        </div>
      ) : null}
      <div className={`text-xs tabular-nums ${ch.cls}`}>{ch.text}</div>
    </div>
  );
}

function Row({ b, onOpen, clientView, picture, onLogo }: { b: BrandSummaryDTO; onOpen: (id: string) => void; clientView?: boolean; picture?: BrandPicture; onLogo?: (id: string, logo: string | null) => void }) {
  const sv = sparkValues(b);
  const open = () => onOpen(b.id);
  const topLine = b.topCompetitor ? `คู่แข่งที่ถูกพูดถึงมากสุด: ${b.topCompetitor.name} ${fmtPct(b.topCompetitor.mentionRate)}` : null;
  const lastScan = b.lastRunAt ? fmtDate(b.lastRunAt) : "ยังไม่เคยสแกน";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
      }}
      className="group cursor-pointer rounded-2xl border border-white/80 bg-white/70 px-4 py-3 shadow-sm transition hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy"
    >
      {/* desktop */}
      <div className="hidden items-center gap-4 md:grid md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_minmax(0,0.9fr)_minmax(0,1.5fr)_96px_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1fr)_16px]">
        <NameBlock b={b} clientView={clientView} picture={picture} onLogo={onLogo} />
        <div className="min-w-0 text-xs text-gray-500">
          <div className="text-sm text-brand-navy">{b.providers.length} platform · {b.competitors} คู่แข่ง</div>
          {topLine && <div className="truncate" title={topLine}>{topLine}</div>}
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold tabular-nums text-brand-navy">{fmtNum(b.appeared)}/{fmtNum(b.asked)}</div>
          <div className="text-xs text-gray-500">คำตอบที่พูดถึงหรืออ้างอิง</div>
        </div>
        <Visibility b={b} />
        <div className="flex justify-center">{sv.length >= 2 ? <Sparkline values={sv} width={88} height={28} ariaLabel="แนวโน้ม Visibility" /> : null}</div>
        <div className="text-right">
          <div className="text-sm font-semibold tabular-nums text-brand-navy">{fmtPct(b.citationRate)}</div>
          <div className="text-xs text-gray-500">อ้างอิงเว็บเรา {fmtNum(b.ownedCited)}</div>
        </div>
        <div><Chip tone={statusTone(b.status, clientView)} dot>{statusLabel(b.status, clientView)}</Chip></div>
        <div className="min-w-0 text-xs text-gray-500">
          <div className="text-gray-700">{lastScan}</div>
          {b.nextRunAt && !clientView && <div>ถัดไป {fmtDate(b.nextRunAt)}</div>}
        </div>
        <ChevronRight className="h-4 w-4 text-gray-400 group-hover:text-brand-navy" aria-hidden />
      </div>

      {/* mobile */}
      <div className="space-y-3 md:hidden">
        <div className="flex items-start justify-between gap-2">
          <NameBlock b={b} clientView={clientView} picture={picture} onLogo={onLogo} />
          <Chip tone={statusTone(b.status, clientView)} dot className="shrink-0">{statusLabel(b.status, clientView)}</Chip>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs text-gray-500">
          <div>
            <div className="text-sm font-semibold tabular-nums text-brand-navy">{fmtNum(b.appeared)}/{fmtNum(b.asked)}</div>
            <div>คำตอบที่พูดถึงหรืออ้างอิง</div>
          </div>
          <Visibility b={b} />
          <div>
            <div className="text-sm font-semibold tabular-nums text-brand-navy">{fmtPct(b.citationRate)}</div>
            <div>อ้างอิงเว็บเรา {fmtNum(b.ownedCited)}</div>
          </div>
          <div>
            <div className="text-sm text-brand-navy">{b.providers.length} platform · {b.competitors} คู่แข่ง</div>
            <div>{lastScan}</div>
          </div>
        </div>
        {topLine && <div className="truncate text-xs text-gray-500">{topLine}</div>}
      </div>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="กำลังโหลด">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex animate-pulse items-center gap-3 rounded-2xl border border-white/80 bg-white/70 px-4 py-4">
          <div className="h-10 w-10 rounded-xl bg-gray-200" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/3 rounded bg-gray-200" />
            <div className="h-3 w-1/2 rounded bg-gray-100" />
          </div>
          <div className="hidden h-3 w-24 rounded bg-gray-200 md:block" />
        </div>
      ))}
    </div>
  );
}

export function BrandList({ onOpen, onCreate, picker, refreshKey, clientView, pictures, onLogoChanged }: {
  onOpen: (projectId: string) => void;
  onCreate?: () => void;
  picker?: ReactNode;
  refreshKey?: number;
  clientView?: boolean;
  /** brand pictures by project id */
  pictures?: Record<string, BrandPicture>;
  /** called after a logo was uploaded or removed from a row (staff view) */
  onLogoChanged?: () => void;
}) {
  const [data, setData] = useState<BrandsRes | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | BrandStatus>("all");
  const [sort, setSort] = useState<SortKey>("visibility_desc");
  // project id -> logo path returned by the server (null = removed); wins over `pictures` until the parent reloads
  const [logoOverride, setLogoOverride] = useState<Record<string, string | null>>({});

  const onLogo = useCallback((id: string, logo: string | null) => {
    setLogoOverride((prev) => ({ ...prev, [id]: logo }));
    onLogoChanged?.();
  }, [onLogoChanged]);

  const pictureOf = (id: string): BrandPicture | undefined => {
    const base = pictures?.[id];
    if (!(id in logoOverride)) return base;
    return { logo: logoOverride[id], favicon: base?.favicon ?? null };
  };

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api<BrandsRes>("/api/brand-radar/brands");
    if (!res.ok || !Array.isArray(res.data.brands)) {
      setError((res.data as { error?: string }).error || "โหลดรายการแบรนด์ไม่สำเร็จ");
      setData(null);
    } else {
      setError("");
      setData(res.data);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const brands = useMemo(() => data?.brands ?? [], [data]);
  const windowDays = data?.windowDays ?? 30;

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const b of brands) { const st = statusShown(b.status, clientView); c[st] = (c[st] ?? 0) + 1; }
    return c;
  }, [brands, clientView]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = brands.filter((b) => {
      if (status !== "all" && statusShown(b.status, clientView) !== status) return false;
      if (!q) return true;
      return `${b.name} ${b.clientName} ${b.website}`.toLowerCase().includes(q);
    });
    const byName = (a: BrandSummaryDTO, b: BrandSummaryDTO) => a.name.localeCompare(b.name, "th");
    // null visibility always goes last, whichever direction is chosen
    const vis = (a: BrandSummaryDTO, b: BrandSummaryDTO, dir: 1 | -1) => {
      if (a.visibilityRate === null && b.visibilityRate === null) return 0;
      if (a.visibilityRate === null) return 1;
      if (b.visibilityRate === null) return -1;
      return (a.visibilityRate - b.visibilityRate) * dir;
    };
    return [...list].sort((a, b) => {
      const sa = a.status === "scanning" ? 0 : 1;
      const sb = b.status === "scanning" ? 0 : 1;
      if (sa !== sb) return sa - sb;
      if (sort === "visibility_desc") return vis(a, b, -1) || b.asked - a.asked || byName(a, b);
      if (sort === "visibility_asc") return vis(a, b, 1) || b.asked - a.asked || byName(a, b);
      if (sort === "last_scan") return timeOf(b.lastRunAt) - timeOf(a.lastRunAt) || byName(a, b);
      if (sort === "name") return byName(a, b);
      return b.asked - a.asked || byName(a, b);
    });
  }, [brands, query, status, sort, clientView]);

  const exportCsv = () => {
    const head = ["แบรนด์", "ลูกค้า", "เว็บไซต์", "Platform", "คู่แข่ง", "คำตอบทั้งหมด", "พูดถึงแบรนด์", "Brand Mention %", "Visibility %", "เปลี่ยนแปลง (จุด)", "อ้างอิงเว็บเรา", "AI Citation %", "สถานะ", "สแกนล่าสุด", ...(clientView ? [] : ["สแกนถัดไป"])];
    const pct = (v: number | null) => (v === null ? "" : Number((v * 100).toFixed(1)));
    const body = rows.map((b) => [
      b.name, b.clientName, b.website, b.providers.length, b.competitors, b.asked, b.mentioned,
      pct(b.mentionRate), pct(b.visibilityRate), pct(b.change), b.ownedCited, pct(b.citationRate), statusLabel(b.status, clientView),
      b.lastRunAt ? fmtDate(b.lastRunAt) : "", ...(clientView ? [] : [b.nextRunAt ? fmtDate(b.nextRunAt) : ""]),
    ]);
    downloadCsv("brand-radar-brands.csv", [head, ...body]);
  };

  return (
    <div className="mx-auto w-full max-w-7xl">
      <PageHeader
        title="Brand Radar"
        subtitle={clientView ? `แบรนด์ของคุณ · ตัวเลข ${windowDays} วันล่าสุด` : `แบรนด์ที่ตั้ง monitor ไว้ · ตัวเลข ${windowDays} วันล่าสุด`}
        actions={
          <>
            <Button type="button" variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
              <Download className="mr-1.5 h-4 w-4" />Export
            </Button>
            {!clientView && (
              <Button type="button" onClick={onCreate}>
                <Plus className="mr-1.5 h-4 w-4" />สร้างโปรเจกต์ใหม่
              </Button>
            )}
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <SearchPill value={query} onChange={setQuery} placeholder="ค้นหาแบรนด์ / ลูกค้า / เว็บไซต์" className="w-full sm:w-80" />
        <div className="flex max-w-full min-w-0 items-center gap-2 overflow-x-auto sm:ml-auto">
          <span className="shrink-0 whitespace-nowrap text-xs text-gray-500">เรียงตาม</span>
          <Segmented<SortKey>
            size="sm"
            ariaLabel="เรียงตาม"
            value={sort}
            onChange={setSort}
            options={[
              { value: "visibility_desc", label: "Visibility สูงสุด" },
              { value: "visibility_asc", label: "Visibility ต่ำสุด" },
              { value: "last_scan", label: "สแกนล่าสุด" },
              { value: "name", label: "ชื่อ" },
            ]}
          />
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Chip onClick={() => setStatus("all")} active={status === "all"} className={status === "all" ? "ring-2 ring-brand-blue" : undefined}>
          ทั้งหมด {brands.length}
        </Chip>
        {BRAND_STATUSES.filter((s) => (counts[s] ?? 0) > 0 && !(clientView && s === "needs_setup")).map((s) => (
          <Chip key={s} tone={STATUS_TONE[s]} onClick={() => setStatus(s)} active={status === s} className={status === s ? "ring-2 ring-brand-blue" : undefined}>
            {statusLabel(s, clientView)} {counts[s]}
          </Chip>
        ))}
      </div>

      {error && (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={() => void load()}>ลองใหม่</Button>
        </div>
      )}

      {loading && !data ? (
        <SkeletonRows />
      ) : error && !data ? null : brands.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Radar className="h-6 w-6" />}
            title={clientView ? "ยังไม่มีแบรนด์ที่แสดงรายงาน" : "ยังไม่มีแบรนด์ที่ตั้ง monitor"}
            description={clientView ? "เมื่อทีมงานเปิดรายงานให้แล้ว แบรนด์ของคุณจะแสดงที่นี่" : "สร้างโปรเจกต์ใหม่ หรือเลือกลูกค้าที่มีอยู่ใน MarsOS ด้านล่างเพื่อเริ่มตั้งค่า"}
            action={clientView ? undefined : <Button type="button" onClick={onCreate}><Plus className="mr-1.5 h-4 w-4" />สร้างโปรเจกต์ใหม่</Button>}
          />
        </Panel>
      ) : rows.length === 0 ? (
        <Panel><EmptyState title="ไม่พบแบรนด์ที่ตรงกับตัวกรอง" description="ลองเปลี่ยนคำค้นหาหรือสถานะ" /></Panel>
      ) : (
        <div className="space-y-2">
          {rows.map((b) => <Row key={b.id} b={b} onOpen={onOpen} clientView={clientView} picture={pictureOf(b.id)} onLogo={clientView ? undefined : onLogo} />)}
        </div>
      )}

      {!clientView && (
        <div className="mt-6 rounded-2xl border border-dashed border-gray-300/80 p-4">
          <div className="mb-2 text-sm font-medium text-gray-600">เพิ่ม monitor ให้ลูกค้าที่มีอยู่ใน MarsOS</div>
          {picker}
        </div>
      )}
    </div>
  );
}
