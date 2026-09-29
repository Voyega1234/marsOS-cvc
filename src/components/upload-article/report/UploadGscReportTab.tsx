"use client";

/**
 * Upload Article > Report — สรุปผล Google Search Console แบบละเอียด (GSC เท่านั้น ไม่มี GA4/PageSpeed/AI)
 * Auth ฝั่งเซิร์ฟเวอร์ = service account (mars-seo-reporter) เท่านั้น — เจ้าของแค่เพิ่ม service email
 * เป็นผู้ใช้ในเว็บที่ Search Console แล้วเลือกเว็บที่นี่ ระบบดึงข้อมูลได้เลย
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle, BarChart3, Copy, ExternalLink, Loader2, RefreshCw, TrendingDown, TrendingUp, Minus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import GscTable, { type GscTableColumn } from "./GscTable";
import { GscLineChart, GscBarChart } from "./GscCharts";
import type {
  GscOverview, GscDailyPoint, GscQueryRow, GscPageRow, PositionBuckets, StrikingDistanceRow,
  LowCtrRow, CannibalRow, GscDimensionRow, UploadedArticleReportRow, ReportSearchType, ReportCompareMode,
  GscSiteEntry,
} from "@/lib/upload-article/gsc-report";

interface GscReportPeriod {
  start: string; end: string; compareStart: string; compareEnd: string;
  siteUrl: string; searchType: ReportSearchType; fetchedAt: string;
}

interface GscReportResponse {
  period: GscReportPeriod;
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
  overview: "ภาพรวม", queries: "คำค้นหา", pages: "หน้าเว็บ", articles: "บทความที่อัปโหลด",
  opportunities: "โอกาส", cannibal: "Cannibalization", devices: "อุปกรณ์/ประเทศ",
};

function fmtNum(n: number): string { return Math.round(n).toLocaleString(); }
function fmtCtr(n: number): string { return `${(n * 100).toFixed(2)}%`; }
function fmtPos(n: number): string { return n ? n.toFixed(1) : "—"; }
function fmtDate(s: string): string {
  const p = s.split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s;
}

function DeltaBadge({ pct, inverse = false }: { pct: number; inverse?: boolean }) {
  const good = inverse ? pct < 0 : pct > 0;
  const neutral = pct === 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${neutral ? "text-gray-400" : good ? "text-emerald-600" : "text-red-500"}`}>
      {neutral ? <Minus size={10} /> : good ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

function KpiCard({ label, value, pct, inverse = false }: { label: string; value: string; pct: number; inverse?: boolean }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-2xl font-bold text-brand-navy">{value}</p>
      <div className="mt-1"><DeltaBadge pct={pct} inverse={inverse} /> <span className="text-[11px] text-gray-400">vs ก่อนหน้า</span></div>
    </div>
  );
}

function ChangeCell({ current, prev, isNew, isLost }: { current: number; prev: number; isNew?: boolean; isLost?: boolean }) {
  if (isNew) return <span className="text-[10px] font-bold text-brand-blue bg-blue-50 px-1.5 py-0.5 rounded">ใหม่</span>;
  if (isLost) return <span className="text-[10px] font-bold text-red-500 bg-red-50 px-1.5 py-0.5 rounded">หาย</span>;
  const diff = current - prev;
  if (diff === 0) return <span className="text-gray-400">—</span>;
  return <span className={diff > 0 ? "text-emerald-600" : "text-red-500"}>{diff > 0 ? "+" : ""}{fmtNum(diff)}</span>;
}

export default function UploadGscReportTab({ clientId }: { clientId: string }) {
  // ── ตั้งค่าเว็บ GSC ──
  const [sitesLoading, setSitesLoading] = useState(true);
  const [serviceEmail, setServiceEmail] = useState("");
  const [serviceReady, setServiceReady] = useState(false);
  const [sites, setSites] = useState<GscSiteEntry[]>([]);
  const [sitesError, setSitesError] = useState("");
  const [selectedSite, setSelectedSite] = useState("");
  const [savingSite, setSavingSite] = useState(false);

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
  const [data, setData] = useState<GscReportResponse | null>(null);

  const loadSites = useCallback(async () => {
    setSitesLoading(true);
    setSitesError("");
    try {
      const r = await fetch(`/api/upload-article/clients/${clientId}/report/sites`);
      const d = await r.json().catch(() => ({}));
      setServiceEmail(d.serviceEmail ?? "");
      setServiceReady(Boolean(d.serviceReady));
      setSites(Array.isArray(d.sites) ? d.sites : []);
      if (d.error) setSitesError(d.error);
      const chosen = d.selected || d.suggested || "";
      if (chosen) setSelectedSite(chosen);
      // เว็บที่แนะนำยังไม่ได้บันทึก — บันทึกให้เลย ไม่งั้น dropdown โชว์เว็บแต่ server ยังมองว่าไม่ได้เลือก
      if (!d.selected && d.suggested) {
        await fetch(`/api/upload-article/clients/${clientId}/report/site`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ siteUrl: d.suggested }),
        }).catch(() => undefined);
      }
    } catch (e) {
      setSitesError(`โหลดรายชื่อเว็บไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSitesLoading(false);
    }
  }, [clientId]);

  useEffect(() => { void loadSites(); }, [loadSites]);

  async function saveSite(siteUrl: string) {
    setSavingSite(true);
    try {
      const r = await fetch(`/api/upload-article/clients/${clientId}/report/site`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteUrl }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "บันทึกไม่สำเร็จ"); return; }
      setSelectedSite(siteUrl);
      toast.success("บันทึกเว็บที่ใช้ดูรายงานแล้ว");
    } finally {
      setSavingSite(false);
    }
  }

  const loadReport = useCallback(async () => {
    if (!selectedSite) return;
    setReportLoading(true);
    setReportError("");
    try {
      const body: Record<string, unknown> = { compare, searchType };
      if (customRange && startDate && endDate) { body.startDate = startDate; body.endDate = endDate; }
      else body.days = days;
      const r = await fetch(`/api/upload-article/clients/${clientId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setReportError(d?.error || "ดึงรายงานไม่สำเร็จ"); setData(null); return; }
      setData(d);
    } catch (e) {
      setReportError(`ดึงรายงานไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setReportLoading(false);
    }
  }, [clientId, selectedSite, days, customRange, startDate, endDate, compare, searchType]);

  useEffect(() => { if (selectedSite) void loadReport(); }, [selectedSite]); // eslint-disable-line react-hooks/exhaustive-deps

  function copyServiceEmail() {
    if (!serviceEmail) return;
    navigator.clipboard.writeText(serviceEmail).then(() => toast.success("คัดลอกแล้ว")).catch(() => toast.error("คัดลอกไม่สำเร็จ"));
  }

  const dailyCurrent = useMemo(
    () => (data?.daily ?? []).map((d) => ({ date: d.date, value: dailyMetric === "clicks" ? d.clicks : d.impressions })),
    [data, dailyMetric],
  );
  const dailyPrevious = useMemo(
    () => (data?.dailyPrev ?? []).map((d) => ({ date: d.date, value: dailyMetric === "clicks" ? d.clicks : d.impressions })),
    [data, dailyMetric],
  );

  if (sitesLoading) {
    return <p className="text-xs text-gray-400 flex items-center gap-1.5 py-10 justify-center"><Loader2 size={12} className="animate-spin" /> กำลังโหลด...</p>;
  }

  return (
    <div className="space-y-4">
      {/* ── การ์ดตั้งค่า service account + property ── */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-brand-navy">เชื่อมต่อ Search Console</p>
            <p className="text-xs text-gray-500 mt-0.5">เพิ่มอีเมลนี้เป็นผู้ใช้ใน Search Console ของเว็บลูกค้า (สิทธิ์ผู้ใช้เต็มพอ) แล้วเลือกเว็บด้านล่าง</p>
          </div>
          <span className={`text-[11px] font-semibold px-2 py-1 rounded-full ${serviceReady ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"}`}>
            {serviceReady ? "เชื่อมต่อพร้อมใช้งาน" : "ยังเชื่อมต่อไม่สำเร็จ"}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <code className="text-xs bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-700">{serviceEmail || "ไม่พบ service account"}</code>
          <Button size="sm" variant="outline" onClick={copyServiceEmail} disabled={!serviceEmail}>
            <Copy size={12} className="mr-1.5" /> คัดลอก
          </Button>
          <a href="https://search.google.com/search-console/users" target="_blank" rel="noreferrer"
            className="text-xs text-brand-blue underline inline-flex items-center gap-1">
            เปิด Search Console <ExternalLink size={11} />
          </a>
        </div>

        {sitesError && <p className="text-xs text-red-600">{sitesError}</p>}

        <div className="flex items-center gap-2 flex-wrap">
          <select value={selectedSite} onChange={(e) => saveSite(e.target.value)} disabled={savingSite}
            className="h-9 min-w-[260px] rounded-md border border-gray-200 px-3 text-sm bg-white">
            <option value="">— เลือกเว็บ —</option>
            {sites.map((s) => <option key={s.siteUrl} value={s.siteUrl}>{s.siteUrl}</option>)}
          </select>
          {savingSite && <Loader2 size={14} className="animate-spin text-gray-400" />}
          {!sites.length && !sitesError && (
            <span className="text-[11px] text-gray-400">ยังไม่มีเว็บที่ service account เข้าถึงได้ — เพิ่มอีเมลด้านบนใน Search Console ก่อน</span>
          )}
        </div>
      </div>

      {selectedSite && (
        <>
          {/* ── ตัวควบคุมช่วงข้อมูล ── */}
          <div className="bg-white border border-gray-200 rounded-xl p-3 flex items-center gap-2 flex-wrap">
            <select value={customRange ? "custom" : String(days)} onChange={(e) => {
              if (e.target.value === "custom") { setCustomRange(true); return; }
              setCustomRange(false); setDays(Number(e.target.value));
            }} className="h-9 rounded-md border border-gray-200 px-2.5 text-xs bg-white">
              {DAY_OPTIONS.map((d) => <option key={d} value={d}>{d} วันล่าสุด</option>)}
              <option value="custom">กำหนดช่วงเอง</option>
            </select>
            {customRange && (
              <>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-9 rounded-md border border-gray-200 px-2 text-xs" />
                <span className="text-gray-400 text-xs">ถึง</span>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-9 rounded-md border border-gray-200 px-2 text-xs" />
              </>
            )}
            <select value={compare} onChange={(e) => setCompare(e.target.value as ReportCompareMode)} className="h-9 rounded-md border border-gray-200 px-2.5 text-xs bg-white">
              <option value="previous">เทียบช่วงก่อนหน้า</option>
              <option value="yoy">เทียบปีก่อนหน้า (YoY)</option>
            </select>
            <select value={searchType} onChange={(e) => setSearchType(e.target.value as ReportSearchType)} className="h-9 rounded-md border border-gray-200 px-2.5 text-xs bg-white">
              {Object.entries(SEARCH_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <Button size="sm" onClick={loadReport} disabled={reportLoading || (customRange && (!startDate || !endDate))}>
              {reportLoading ? <Loader2 size={12} className="animate-spin mr-1.5" /> : <RefreshCw size={12} className="mr-1.5" />}
              ดึงข้อมูล
            </Button>
            {data && <span className="text-[11px] text-gray-400">{fmtDate(data.period.start)} – {fmtDate(data.period.end)} เทียบ {fmtDate(data.period.compareStart)} – {fmtDate(data.period.compareEnd)}</span>}
          </div>

          {reportError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700 flex items-start gap-2">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <div>
                <p>{reportError}</p>
                {serviceEmail && <p className="text-xs mt-1">เพิ่ม <code className="bg-white/60 px-1 rounded">{serviceEmail}</code> เป็นผู้ใช้ใน Search Console ของเว็บนี้ แล้วลองใหม่</p>}
              </div>
            </div>
          )}

          {reportLoading && !data && (
            <p className="text-xs text-gray-400 flex items-center gap-1.5 py-10 justify-center"><Loader2 size={12} className="animate-spin" /> กำลังดึงข้อมูลจาก Search Console...</p>
          )}

          {data && (
            <>
              {/* ── KPI ── */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <KpiCard label="คลิก" value={fmtNum(data.overview.current.clicks)} pct={data.overview.deltaPct.clicks} />
                <KpiCard label="การแสดงผล" value={fmtNum(data.overview.current.impressions)} pct={data.overview.deltaPct.impressions} />
                <KpiCard label="CTR" value={fmtCtr(data.overview.current.ctr)} pct={data.overview.deltaPct.ctr} />
                <KpiCard label="อันดับเฉลี่ย" value={fmtPos(data.overview.current.position)} pct={data.overview.deltaPct.position} inverse />
              </div>

              {/* ── กราฟรายวัน ── */}
              <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-brand-navy">แนวโน้มรายวัน</p>
                  <div className="flex gap-1">
                    {(["clicks", "impressions"] as const).map((m) => (
                      <button key={m} onClick={() => setDailyMetric(m)}
                        className={`text-[11px] px-2.5 py-1 rounded-full font-medium ${dailyMetric === m ? "bg-brand-mist text-brand-blue" : "text-gray-400 hover:bg-gray-50"}`}>
                        {m === "clicks" ? "คลิก" : "การแสดงผล"}
                      </button>
                    ))}
                  </div>
                </div>
                <GscLineChart current={dailyCurrent} previous={dailyPrevious} color={dailyMetric === "clicks" ? "#137333" : "#1a73e8"} />
                <p className="text-[11px] text-gray-400">เส้นทึบ = ช่วงปัจจุบัน, เส้นประ = ช่วงเทียบ</p>
              </div>

              {/* ── Sub-tabs ── */}
              <Tabs value={subTab} onValueChange={(v) => setSubTab(v as SubTab)}>
                <TabsList className="flex-wrap h-auto">
                  {SUB_TABS.map((t) => <TabsTrigger key={t} value={t}>{SUB_TAB_LABELS[t]}</TabsTrigger>)}
                </TabsList>

                <TabsContent value="overview">
                  <OverviewSubTab data={data} />
                </TabsContent>
                <TabsContent value="queries">
                  <QueriesSubTab rows={data.queries} />
                </TabsContent>
                <TabsContent value="pages">
                  <PagesSubTab rows={data.pages} />
                </TabsContent>
                <TabsContent value="articles">
                  <ArticlesSubTab rows={data.uploadedArticles} />
                </TabsContent>
                <TabsContent value="opportunities">
                  <OpportunitiesSubTab strikingDistance={data.opportunities.strikingDistance} lowCtr={data.opportunities.lowCtr} />
                </TabsContent>
                <TabsContent value="cannibal">
                  <CannibalSubTab rows={data.cannibalization} />
                </TabsContent>
                <TabsContent value="devices">
                  <DevicesSubTab devices={data.devices} countries={data.countries} searchAppearance={data.searchAppearance} />
                </TabsContent>
              </Tabs>
            </>
          )}
        </>
      )}

      {!selectedSite && !sitesError && (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center space-y-2">
          <BarChart3 size={28} className="mx-auto text-gray-300" />
          <p className="text-sm text-gray-500">เลือกเว็บ Search Console ด้านบนเพื่อดูรายงาน</p>
        </div>
      )}
    </div>
  );
}

// ── Sub-tabs ──────────────────────────────────────────────────────────────────

function OverviewSubTab({ data }: { data: GscReportResponse }) {
  const buckets = data.positionBuckets;
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <p className="text-sm font-semibold text-brand-navy">สัดส่วนอันดับคำค้นหา (ปัจจุบันเทียบก่อนหน้า)</p>
      <GscBarChart data={buckets.current.map((b, i) => ({ label: `อันดับ ${b.bucket} (${b.count} คำ)`, value: b.clicks, prevValue: buckets.previous[i]?.clicks ?? 0 }))} />
      <p className="text-[11px] text-gray-400">แถบเข้ม = คลิกช่วงปัจจุบัน, แถบเทา = คลิกช่วงก่อนหน้า</p>
    </div>
  );
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
    { key: "pushedAt", label: "เผยแพร่เมื่อ", sortValue: (r) => r.pushedAt ?? "", render: (r) => r.pushedAt ? new Date(r.pushedAt).toLocaleDateString("th-TH") : "—" },
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
      csvFilename="gsc-uploaded-articles.csv"
      emptyText="ยังไม่มีบทความที่เผยแพร่แล้ว (PUSHED)"
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
        <p className="text-sm font-semibold text-brand-navy mb-2">Striking Distance — อันดับ 4-20 ที่ผลักขึ้นหน้าแรกได้ (เรียงตามการแสดงผล)</p>
        <GscTable rows={strikingDistance} columns={strikingCols} rowKey={(r) => r.query} searchText={(r) => r.query} csvFilename="gsc-striking-distance.csv" />
      </div>
      <div>
        <p className="text-sm font-semibold text-brand-navy mb-2">CTR ต่ำกว่าที่ควร — การแสดงผล ≥ 100 และ CTR ต่ำกว่าครึ่งของค่าเฉลี่ยช่วงอันดับเดียวกัน</p>
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
        <p className="text-sm font-semibold text-brand-navy mb-2">อุปกรณ์</p>
        <GscTable rows={devices} columns={dimCols()} rowKey={(r) => r.label} csvFilename="gsc-devices.csv" />
      </div>
      <div>
        <p className="text-sm font-semibold text-brand-navy mb-2">ประเทศ</p>
        <GscTable rows={countries} columns={countryCols} rowKey={(r) => r.label} searchText={(r) => r.name} csvFilename="gsc-countries.csv" />
      </div>
      <div>
        <p className="text-sm font-semibold text-brand-navy mb-2">รูปแบบการแสดงผล (Search Appearance)</p>
        <GscTable rows={searchAppearance} columns={dimCols()} rowKey={(r) => r.label} csvFilename="gsc-search-appearance.csv" emptyText="ไม่มีรูปแบบพิเศษในช่วงนี้" />
      </div>
    </div>
  );
}
