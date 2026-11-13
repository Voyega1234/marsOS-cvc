"use client";

/**
 * PBN Backlinks > Monitor — สรุปผล Google Search Console ของเว็บ PBN ที่เลือก (สำเนาจาก Upload Article > Report ตัดส่วนผู้ดูแลออก)
 * ตัวเลขภาพรวม/Queries/Pages เป็นของทั้งเว็บ — แท็บ "บทความที่ push" แสดงเฉพาะบทความที่ push จาก MarsOS ขึ้นเว็บนี้
 * Auth ฝั่งเซิร์ฟเวอร์ = service account เท่านั้น (เพิ่มอีเมลเป็นผู้ใช้ใน property ของเว็บนั้นที่ Search Console)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle, BarChart3, Loader2, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip, EmptyState, Panel, Segmented, UnderlineTabs } from "@/components/ds";
import GscTable, { type GscTableColumn } from "@/components/upload-article/report/GscTable";
import { GscKpiRow, GscTrendPanel, GscBucketPanel } from "@/components/upload-article/report/GscCharts";
import { usePbnSites } from "./usePbnSites";
import type {
  GscOverview, GscDailyPoint, GscQueryRow, GscPageRow, PositionBuckets, StrikingDistanceRow,
  LowCtrRow, CannibalRow, GscDimensionRow, UploadedArticleReportRow, ReportSearchType, ReportCompareMode,
} from "@/lib/upload-article/gsc-report";

const SELECTED_KEY = "pbn-monitor-site";

interface GscReportPeriod {
  start: string; end: string; compareStart: string; compareEnd: string;
  siteUrl: string; searchType: ReportSearchType; fetchedAt: string;
}

interface GscReportResponse {
  period: GscReportPeriod;
  serviceEmail?: string;
  overview: GscOverview;
  daily: GscDailyPoint[];
  dailyPrev: GscDailyPoint[];
  queries: GscQueryRow[];
  pages: GscPageRow[];
  positionBuckets: PositionBuckets;
  opportunities: { strikingDistance: StrikingDistanceRow[]; lowCtr: LowCtrRow[] };
  cannibalization: CannibalRow[];
  devices: GscDimensionRow[];
  countries: (GscDimensionRow & { name: string })[];
  searchAppearance: GscDimensionRow[];
  uploadedArticles: UploadedArticleReportRow[];
}

const DAY_OPTIONS = [7, 28, 90, 180, 365] as const;
const SEARCH_TYPE_LABELS: Record<ReportSearchType, string> = {
  web: "เว็บ", image: "รูปภาพ", video: "วิดีโอ", news: "ข่าว", discover: "Discover",
};
const SUB_TABS = ["overview", "queries", "pages", "articles", "opportunities", "cannibal", "devices"] as const;
type SubTab = (typeof SUB_TABS)[number];
const SUB_TAB_LABELS: Record<SubTab, string> = {
  overview: "ภาพรวม", queries: "คำค้นหา", pages: "หน้าเว็บ", articles: "บทความที่ push",
  opportunities: "โอกาส", cannibal: "Cannibalization", devices: "อุปกรณ์/ประเทศ",
};

function SUB_TAB_COUNTS(data: GscReportResponse, t: SubTab): number | undefined {
  switch (t) {
    case "queries": return data.queries.length;
    case "pages": return data.pages.length;
    case "articles": return data.uploadedArticles.length;
    case "opportunities": return data.opportunities.strikingDistance.length + data.opportunities.lowCtr.length;
    case "cannibal": return data.cannibalization.length;
    default: return undefined;
  }
}

function fmtNum(n: number): string { return Math.round(n).toLocaleString(); }
function fmtCtr(n: number): string { return `${(n * 100).toFixed(2)}%`; }
function fmtPos(n: number): string { return n ? n.toFixed(1) : "—"; }
function fmtDate(s: string): string {
  const p = s.split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s;
}

function ChangeCell({ current, prev, isNew, isLost }: { current: number; prev: number; isNew?: boolean; isLost?: boolean }) {
  if (isNew) return <Chip tone="info">ใหม่</Chip>;
  if (isLost) return <Chip tone="bad">หาย</Chip>;
  const diff = current - prev;
  if (diff === 0) return <span className="text-gray-400">—</span>;
  return <span className={diff > 0 ? "text-emerald-600" : "text-red-500"}>{diff > 0 ? "+" : ""}{fmtNum(diff)}</span>;
}


export function PbnMonitorTab({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { sites, loading, error } = usePbnSites();
  const selectable = useMemo(() => sites.filter(s => (s.gscSiteUrl ?? "").trim()), [sites]);
  const [siteId, setSiteId] = useState("");

  // ── ตัวควบคุมช่วงข้อมูล ──
  const [days, setDays] = useState<number>(28);
  const [customRange, setCustomRange] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [compare, setCompare] = useState<ReportCompareMode>("previous");
  const [searchType, setSearchType] = useState<ReportSearchType>("web");
  const [dailyMetric, setDailyMetric] = useState<"clicks" | "impressions">("clicks");
  const [subTab, setSubTab] = useState<SubTab>("overview");

  // ── ผลรายงาน ──
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState("");
  const [serviceEmail, setServiceEmail] = useState("");
  const [data, setData] = useState<GscReportResponse | null>(null);
  // ลำดับคำขอ — ผลของคำขอเก่า (เช่นสลับเว็บรัว ๆ) มาช้ากว่าไม่ทับผลใหม่
  const reqSeq = useRef(0);

  // จำเว็บที่ดูล่าสุดไว้ในเบราว์เซอร์นี้ — ไม่มีก็เลือกเว็บแรก
  useEffect(() => {
    if (!selectable.length || selectable.some(s => s.id === siteId)) return;
    let saved = "";
    try { saved = localStorage.getItem(SELECTED_KEY) ?? ""; } catch { /* ignore */ }
    setSiteId(selectable.some(s => s.id === saved) ? saved : selectable[0].id);
  }, [selectable, siteId]);

  function choose(id: string) {
    setSiteId(id);
    setData(null);
    setReportError("");
    try { localStorage.setItem(SELECTED_KEY, id); } catch { /* ignore */ }
  }

  const site = selectable.find(s => s.id === siteId) ?? null;

  const loadReport = useCallback(async () => {
    if (!siteId) return;
    const seq = ++reqSeq.current;
    setReportLoading(true);
    setReportError("");
    try {
      const body: Record<string, unknown> = { compare, searchType };
      if (customRange && startDate && endDate) { body.startDate = startDate; body.endDate = endDate; }
      else body.days = days;
      const r = await fetch(`/api/pbn-backlinks/sites/${encodeURIComponent(siteId)}/monitor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (seq !== reqSeq.current) return;
      if (d?.serviceEmail) setServiceEmail(d.serviceEmail);
      if (!r.ok) { setReportError(d?.error || "ดึงรายงานไม่สำเร็จ"); setData(null); return; }
      setData(d);
    } catch (e) {
      if (seq !== reqSeq.current) return;
      setReportError(`ดึงรายงานไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (seq === reqSeq.current) setReportLoading(false);
    }
  }, [siteId, days, customRange, startDate, endDate, compare, searchType]);

  // เปลี่ยนเว็บ = ดึงรายงานใหม่ทันที (ช่วงวัน/เทียบ/ประเภทยังต้องกด "ดึงข้อมูล" เหมือน Upload)
  useEffect(() => { if (site) void loadReport(); }, [siteId]); // eslint-disable-line react-hooks/exhaustive-deps

  const dailyCurrent = useMemo(
    () => (data?.daily ?? []).map((d) => ({ date: d.date, value: dailyMetric === "clicks" ? d.clicks : d.impressions })),
    [data, dailyMetric],
  );
  const dailyPrevious = useMemo(
    () => (data?.dailyPrev ?? []).map((d) => ({ date: d.date, value: dailyMetric === "clicks" ? d.clicks : d.impressions })),
    [data, dailyMetric],
  );

  if (loading) {
    return <Panel><EmptyState icon={<Loader2 className="h-5 w-5 animate-spin" />} title="กำลังโหลด..." /></Panel>;
  }
  if (error) return <Panel><EmptyState icon={<AlertCircle className="h-5 w-5" />} title={error} /></Panel>;

  if (!selectable.length) {
    return (
      <Panel>
        <EmptyState
          icon={<BarChart3 className="h-5 w-5" />}
          title={<>{sites.length ? "ยังไม่มีเว็บ PBN ที่ตั้ง Search Console property" : "ยังไม่มีเว็บ PBN"} — แต่ละเว็บต้องตั้ง Search Console property ของตัวเองที่ Project Setting</>}
          action={<Button size="sm" variant="outline" onClick={onOpenSettings}>ไปที่ PBN Sites & Connect</Button>}
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/80 bg-white/70 shadow-sm backdrop-blur p-3 space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <label htmlFor="pbn-monitor-site" className="text-xs font-semibold text-gray-600">ดูผลของเว็บ</label>
          <select id="pbn-monitor-site" value={siteId} onChange={e => choose(e.target.value)}
            className="h-9 min-w-[240px] rounded-full border border-gray-200 px-3 text-sm bg-white">
            {selectable.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {sites.length > selectable.length && (
            <span className="text-[11px] text-gray-400">อีก {sites.length - selectable.length} เว็บยังไม่ตั้ง Search Console property</span>
          )}
        </div>
        {site && (
          <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500">
            <span>Property:</span>
            <code className="bg-white/70 border border-gray-200 rounded px-2 py-0.5 text-gray-700">{site.gscSiteUrl}</code>
            {serviceEmail && (
              <>
                <span>Service account:</span>
                <code className="bg-white/70 border border-gray-200 rounded px-2 py-0.5 text-gray-700">{serviceEmail}</code>
              </>
            )}
            <button type="button" onClick={onOpenSettings} className="text-brand-blue underline">แก้ property</button>
          </div>
        )}
      </div>

      {site && (
        <>
          {/* ── ตัวควบคุมช่วงข้อมูล ── */}
          <div className="rounded-2xl border border-white/80 bg-white/70 shadow-sm backdrop-blur p-3 flex items-center gap-2 flex-wrap">
            <select value={customRange ? "custom" : String(days)} onChange={(e) => {
              if (e.target.value === "custom") { setCustomRange(true); return; }
              setCustomRange(false); setDays(Number(e.target.value));
            }} className="h-9 rounded-full border border-gray-200 px-2.5 text-xs bg-white">
              {DAY_OPTIONS.map((d) => <option key={d} value={d}>{d} วันล่าสุด</option>)}
              <option value="custom">กำหนดช่วงเอง</option>
            </select>
            {customRange && (
              <>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-9 rounded-full border border-gray-200 px-2 text-xs" />
                <span className="text-gray-400 text-xs">ถึง</span>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-9 rounded-full border border-gray-200 px-2 text-xs" />
              </>
            )}
            <select value={compare} onChange={(e) => setCompare(e.target.value as ReportCompareMode)} className="h-9 rounded-full border border-gray-200 px-2.5 text-xs bg-white">
              <option value="previous">เทียบช่วงก่อนหน้า</option>
              <option value="yoy">เทียบปีก่อนหน้า (YoY)</option>
            </select>
            <select value={searchType} onChange={(e) => setSearchType(e.target.value as ReportSearchType)} className="h-9 rounded-full border border-gray-200 px-2.5 text-xs bg-white">
              {Object.entries(SEARCH_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <Button size="sm" onClick={loadReport} disabled={reportLoading || (customRange && (!startDate || !endDate))}>
              {reportLoading ? <Loader2 size={12} className="animate-spin mr-1.5" /> : <RefreshCw size={12} className="mr-1.5" />}
              ดึงข้อมูล
            </Button>
            {data && <span className="text-[11px] text-gray-400">{fmtDate(data.period.start)} – {fmtDate(data.period.end)} เทียบ {fmtDate(data.period.compareStart)} – {fmtDate(data.period.compareEnd)}</span>}
          </div>

          {reportError && (
            <div className="bg-red-50/80 border border-red-200 rounded-2xl p-4 text-sm text-red-700 flex items-start gap-2">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <p>{reportError}</p>
            </div>
          )}

          {reportLoading && !data && (
            <Panel><EmptyState icon={<Loader2 className="h-5 w-5 animate-spin" />} title="กำลังดึงข้อมูลจาก Search Console..." /></Panel>
          )}

          {data && (
            <>
              {/* ── KPI ── */}
              <GscKpiRow overview={data.overview} />

              {/* ── กราฟรายวัน ── */}
              <GscTrendPanel current={dailyCurrent} previous={dailyPrevious} metric={dailyMetric} onMetricChange={setDailyMetric} />

              <p className="text-[11px] text-gray-400">ตัวเลขภาพรวม / Queries / Pages เป็นของทั้งเว็บ — แท็บ บทความที่ push แสดงเฉพาะบทความที่ push จาก MarsOS ขึ้นเว็บนี้</p>

              {/* ── Sub-tabs ── */}
              <UnderlineTabs
                value={subTab}
                onChange={setSubTab}
                tabs={SUB_TABS.map((t) => ({ id: t, label: SUB_TAB_LABELS[t], count: SUB_TAB_COUNTS(data, t) }))}
              />
              <div className="space-y-4">
                {subTab === "overview" && (
                  <OverviewSubTab data={data} />
                )}
                {subTab === "queries" && (
                  <QueriesSubTab rows={data.queries} />
                )}
                {subTab === "pages" && (
                  <PagesSubTab rows={data.pages} />
                )}
                {subTab === "articles" && (
                  <ArticlesSubTab rows={data.uploadedArticles} />
                )}
                {subTab === "opportunities" && (
                  <OpportunitiesSubTab strikingDistance={data.opportunities.strikingDistance} lowCtr={data.opportunities.lowCtr} />
                )}
                {subTab === "cannibal" && (
                  <CannibalSubTab rows={data.cannibalization} />
                )}
                {subTab === "devices" && (
                  <DevicesSubTab devices={data.devices} countries={data.countries} searchAppearance={data.searchAppearance} />
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── Sub-tabs ──────────────────────────────────────────────────────────────────

function OverviewSubTab({ data }: { data: GscReportResponse }) {
  return <GscBucketPanel buckets={data.positionBuckets} />;
}

function QueriesSubTab({ rows }: { rows: GscQueryRow[] }) {
  const columns: GscTableColumn<GscQueryRow>[] = [
    { key: "query", label: "คำค้นหา", sortValue: (r) => r.query, render: (r) => <span className="font-medium text-brand-navy">{r.query}</span> },
    { key: "clicks", label: "คลิก", align: "right", sortValue: (r) => r.clicks, csvValue: (r) => r.clicks },
    { key: "impressions", label: "การแสดงผล", align: "right", sortValue: (r) => r.impressions, csvValue: (r) => r.impressions },
    { key: "ctr", label: "CTR", align: "right", sortValue: (r) => r.ctr, render: (r) => fmtCtr(r.ctr), csvValue: (r) => fmtCtr(r.ctr) },
    { key: "position", label: "อันดับ", align: "right", sortValue: (r) => r.position, render: (r) => fmtPos(r.position), csvValue: (r) => r.position },
    { key: "change", label: "เปลี่ยนแปลง (คลิก)", align: "right", sortValue: (r) => r.changeClicks, render: (r) => <ChangeCell current={r.clicks} prev={r.prevClicks} isNew={r.isNew} isLost={r.isLost} />, csvValue: (r) => r.changeClicks },
  ];
  return (
    <GscTable rows={rows} columns={columns} rowKey={(r) => r.query} searchText={(r) => r.query} csvFilename="gsc-queries.csv" />
  );
}

function PagesSubTab({ rows }: { rows: GscPageRow[] }) {
  const columns: GscTableColumn<GscPageRow>[] = [
    { key: "page", label: "หน้าเว็บ", sortValue: (r) => r.page, render: (r) => <a href={r.page} target="_blank" rel="noreferrer" className="text-brand-blue font-mono text-[11px] hover:underline break-all">{r.page}</a> },
    { key: "clicks", label: "คลิก", align: "right", sortValue: (r) => r.clicks, csvValue: (r) => r.clicks },
    { key: "impressions", label: "การแสดงผล", align: "right", sortValue: (r) => r.impressions, csvValue: (r) => r.impressions },
    { key: "ctr", label: "CTR", align: "right", sortValue: (r) => r.ctr, render: (r) => fmtCtr(r.ctr), csvValue: (r) => fmtCtr(r.ctr) },
    { key: "position", label: "อันดับ", align: "right", sortValue: (r) => r.position, render: (r) => fmtPos(r.position), csvValue: (r) => r.position },
    { key: "change", label: "เปลี่ยนแปลง (คลิก)", align: "right", sortValue: (r) => r.changeClicks, render: (r) => <ChangeCell current={r.clicks} prev={r.prevClicks} isNew={r.isNew} isLost={r.isLost} />, csvValue: (r) => r.changeClicks },
  ];
  return <GscTable rows={rows} columns={columns} rowKey={(r) => r.page} searchText={(r) => r.page} csvFilename="gsc-pages.csv" />;
}

function ArticlesSubTab({ rows }: { rows: UploadedArticleReportRow[] }) {
  const columns: GscTableColumn<UploadedArticleReportRow>[] = [
    { key: "title", label: "บทความ", sortValue: (r) => r.title, render: (r) => (
      <div>
        <p className="font-medium text-brand-navy">{r.title}</p>
        <a href={r.url} target="_blank" rel="noreferrer" className="text-brand-blue font-mono text-[10px] hover:underline break-all">{r.url}</a>
      </div>
    ) },
    { key: "pushedAt", label: "push เมื่อ", sortValue: (r) => r.pushedAt ?? "", render: (r) => r.pushedAt ? new Date(r.pushedAt).toLocaleDateString("th-TH") : "—" },
    { key: "clicks", label: "คลิก", align: "right", sortValue: (r) => r.clicks, csvValue: (r) => r.clicks },
    { key: "impressions", label: "การแสดงผล", align: "right", sortValue: (r) => r.impressions, csvValue: (r) => r.impressions },
    { key: "ctr", label: "CTR", align: "right", sortValue: (r) => r.ctr, render: (r) => fmtCtr(r.ctr), csvValue: (r) => fmtCtr(r.ctr) },
    { key: "position", label: "อันดับ", align: "right", sortValue: (r) => r.position, render: (r) => fmtPos(r.position), csvValue: (r) => r.position },
    { key: "change", label: "เปลี่ยนแปลง (คลิก)", align: "right", sortValue: (r) => r.changeClicks, render: (r) => <ChangeCell current={r.clicks} prev={r.prevClicks} />, csvValue: (r) => r.changeClicks },
  ];
  return (
    <GscTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.id}
      searchText={(r) => `${r.title} ${r.url}`}
      csvFilename="pbn-monitor-articles.csv"
      emptyText="ยังไม่มีบทความที่ push ขึ้นเว็บนี้"
      renderExpanded={(r) => (
        r.topQueries.length === 0 ? <p className="text-xs text-gray-400">ไม่มีคำค้นหาในช่วงนี้</p> : (
          <table className="w-full text-[11px]">
            <thead><tr className="text-gray-400"><th className="text-left py-1">คำค้นหา</th><th className="text-right py-1">คลิก</th><th className="text-right py-1">การแสดงผล</th><th className="text-right py-1">CTR</th><th className="text-right py-1">อันดับ</th></tr></thead>
            <tbody>
              {r.topQueries.map((q, i) => (
                <tr key={i} className="border-t border-gray-100">
                  <td className="py-1">{q.query}</td>
                  <td className="text-right py-1">{fmtNum(q.clicks)}</td>
                  <td className="text-right py-1">{fmtNum(q.impressions)}</td>
                  <td className="text-right py-1">{fmtCtr(q.ctr)}</td>
                  <td className="text-right py-1">{fmtPos(q.position)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
    />
  );
}

function OpportunitiesSubTab({ strikingDistance, lowCtr }: { strikingDistance: StrikingDistanceRow[]; lowCtr: LowCtrRow[] }) {
  const strikingCols: GscTableColumn<StrikingDistanceRow>[] = [
    { key: "query", label: "คำค้นหา", sortValue: (r) => r.query },
    { key: "position", label: "อันดับ", align: "right", sortValue: (r) => r.position, render: (r) => fmtPos(r.position), csvValue: (r) => r.position },
    { key: "impressions", label: "การแสดงผล", align: "right", sortValue: (r) => r.impressions, csvValue: (r) => r.impressions },
    { key: "clicks", label: "คลิก", align: "right", sortValue: (r) => r.clicks, csvValue: (r) => r.clicks },
    { key: "ctr", label: "CTR", align: "right", sortValue: (r) => r.ctr, render: (r) => fmtCtr(r.ctr), csvValue: (r) => fmtCtr(r.ctr) },
  ];
  const lowCtrCols: GscTableColumn<LowCtrRow>[] = [
    { key: "query", label: "คำค้นหา", sortValue: (r) => r.query },
    { key: "impressions", label: "การแสดงผล", align: "right", sortValue: (r) => r.impressions, csvValue: (r) => r.impressions },
    { key: "ctr", label: "CTR", align: "right", sortValue: (r) => r.ctr, render: (r) => fmtCtr(r.ctr), csvValue: (r) => fmtCtr(r.ctr) },
    { key: "bucketAvgCtr", label: "CTR เฉลี่ยของช่วงอันดับ", align: "right", sortValue: (r) => r.bucketAvgCtr, render: (r) => fmtCtr(r.bucketAvgCtr), csvValue: (r) => fmtCtr(r.bucketAvgCtr) },
    { key: "position", label: "อันดับ", align: "right", sortValue: (r) => r.position, render: (r) => fmtPos(r.position), csvValue: (r) => r.position },
    { key: "bestPage", label: "หน้าที่ดีที่สุด", sortValue: (r) => r.bestPage ?? "", render: (r) => r.bestPage ? <a href={r.bestPage} target="_blank" rel="noreferrer" className="text-brand-blue font-mono text-[10px] hover:underline break-all">{r.bestPage}</a> : "—" },
  ];
  return (
    <div className="space-y-4">
      <div>
        <p className="section-label mb-2">Striking Distance — อันดับ 4-20 ที่ผลักขึ้นหน้าแรกได้ (เรียงตามการแสดงผล)</p>
        <GscTable rows={strikingDistance} columns={strikingCols} rowKey={(r) => r.query} searchText={(r) => r.query} csvFilename="gsc-striking-distance.csv" />
      </div>
      <div>
        <p className="section-label mb-2">CTR ต่ำกว่าที่ควร — การแสดงผล ≥ 100 และ CTR ต่ำกว่าครึ่งของค่าเฉลี่ยช่วงอันดับเดียวกัน</p>
        <GscTable rows={lowCtr} columns={lowCtrCols} rowKey={(r) => r.query} searchText={(r) => r.query} csvFilename="gsc-low-ctr.csv" />
      </div>
    </div>
  );
}

function CannibalSubTab({ rows }: { rows: CannibalRow[] }) {
  const columns: GscTableColumn<CannibalRow>[] = [
    { key: "query", label: "คำค้นหา", sortValue: (r) => r.query },
    { key: "pagesCount", label: "จำนวนหน้าที่แข่งกัน", align: "right", sortValue: (r) => r.pages.length, csvValue: (r) => r.pages.length },
    { key: "totalImpressions", label: "การแสดงผลรวม", align: "right", sortValue: (r) => r.totalImpressions, csvValue: (r) => r.totalImpressions },
    { key: "totalClicks", label: "คลิกรวม", align: "right", sortValue: (r) => r.totalClicks, csvValue: (r) => r.totalClicks },
  ];
  return (
    <GscTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.query}
      searchText={(r) => r.query}
      csvFilename="gsc-cannibalization.csv"
      emptyText="ไม่พบคำค้นหาที่มีหลายหน้าแข่งกันเอง"
      renderExpanded={(r) => (
        <table className="w-full text-[11px]">
          <thead><tr className="text-gray-400"><th className="text-left py-1">หน้าเว็บ</th><th className="text-right py-1">สัดส่วนการแสดงผล</th><th className="text-right py-1">คลิก</th><th className="text-right py-1">การแสดงผล</th><th className="text-right py-1">อันดับ</th></tr></thead>
          <tbody>
            {r.pages.map((p, i) => (
              <tr key={i} className="border-t border-gray-100">
                <td className="py-1"><a href={p.page} target="_blank" rel="noreferrer" className="text-brand-blue font-mono hover:underline break-all">{p.page}</a></td>
                <td className="text-right py-1">{(p.share * 100).toFixed(1)}%</td>
                <td className="text-right py-1">{fmtNum(p.clicks)}</td>
                <td className="text-right py-1">{fmtNum(p.impressions)}</td>
                <td className="text-right py-1">{fmtPos(p.position)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    />
  );
}

function DevicesSubTab({ devices, countries, searchAppearance }: {
  devices: GscDimensionRow[]; countries: (GscDimensionRow & { name: string })[]; searchAppearance: GscDimensionRow[];
}) {
  const dimCols = (extra?: GscTableColumn<GscDimensionRow>[]): GscTableColumn<GscDimensionRow>[] => [
    { key: "label", label: "รายการ", sortValue: (r) => r.label },
    ...(extra ?? []),
    { key: "clicks", label: "คลิก", align: "right", sortValue: (r) => r.clicks, csvValue: (r) => r.clicks },
    { key: "impressions", label: "การแสดงผล", align: "right", sortValue: (r) => r.impressions, csvValue: (r) => r.impressions },
    { key: "ctr", label: "CTR", align: "right", sortValue: (r) => r.ctr, render: (r) => fmtCtr(r.ctr), csvValue: (r) => fmtCtr(r.ctr) },
    { key: "position", label: "อันดับ", align: "right", sortValue: (r) => r.position, render: (r) => fmtPos(r.position), csvValue: (r) => r.position },
  ];
  const countryCols: GscTableColumn<GscDimensionRow & { name: string }>[] = [
    { key: "name", label: "ประเทศ", sortValue: (r) => r.name },
    { key: "clicks", label: "คลิก", align: "right", sortValue: (r) => r.clicks, csvValue: (r) => r.clicks },
    { key: "impressions", label: "การแสดงผล", align: "right", sortValue: (r) => r.impressions, csvValue: (r) => r.impressions },
    { key: "ctr", label: "CTR", align: "right", sortValue: (r) => r.ctr, render: (r) => fmtCtr(r.ctr), csvValue: (r) => fmtCtr(r.ctr) },
    { key: "position", label: "อันดับ", align: "right", sortValue: (r) => r.position, render: (r) => fmtPos(r.position), csvValue: (r) => r.position },
  ];
  return (
    <div className="space-y-4">
      <div>
        <p className="section-label mb-2">อุปกรณ์</p>
        <GscTable rows={devices} columns={dimCols()} rowKey={(r) => r.label} csvFilename="gsc-devices.csv" />
      </div>
      <div>
        <p className="section-label mb-2">ประเทศ</p>
        <GscTable rows={countries} columns={countryCols} rowKey={(r) => r.label} searchText={(r) => r.name} csvFilename="gsc-countries.csv" />
      </div>
      <div>
        <p className="section-label mb-2">รูปแบบการแสดงผล (Search Appearance)</p>
        <GscTable rows={searchAppearance} columns={dimCols()} rowKey={(r) => r.label} csvFilename="gsc-search-appearance.csv" emptyText="ไม่มีรูปแบบพิเศษในช่วงนี้" />
      </div>
    </div>
  );
}
