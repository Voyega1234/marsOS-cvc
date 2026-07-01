"use client";

import { useState, useEffect, useCallback } from "react";
import {
  BarChart3, Globe2, Zap, RefreshCw, TrendingUp, TrendingDown,
  Activity, Users, MousePointerClick, Eye, Target, Gauge,
  CheckCircle2, AlertTriangle, Loader2, FileText, Search,
  ExternalLink, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GscSite {
  siteUrl: string;
  permissionLevel: string;
}

interface ProjectSummary {
  id: string;
  name: string;
  website: string;
  clientName: string | null;
  gscSiteUrl: string | null;
  ga4PropertyId: string | null;
  industry: string | null;
  language: string;
  accentColor: string;
  _count: { articles: number };
}

interface ArticleRow {
  id: string;
  title: string;
  status: string;
  wordpressUrl: string | null;
  keyword: string | null;
  position: number | null;
  updatedAt: string;
}

interface GscOverview {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  clicksDelta: number;
  impressionsDelta: number;
  ctrDelta: number;
  positionDelta: number;
}

interface GscPage {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface GscQuery {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface GscData {
  overview: GscOverview;
  pages: GscPage[];
  queries: GscQuery[];
  period: { start: string; end: string; days: number };
}

interface Ga4Overview {
  sessions: number;
  users: number;
  conversions: number;
  revenue: number;
  engagementRate: number;
  sessionsDelta: number;
  usersDelta: number;
  conversionsDelta: number;
}

interface Ga4Data {
  overview: Ga4Overview;
  period: { start: string; end: string; days: number };
}

interface PsiScores {
  performance: number | null;
  accessibility: number | null;
  seo: number | null;
}

interface PsiStrategy {
  scores: PsiScores;
  vitals: {
    lcp: { display: string; value: number | null };
    cls: { display: string; value: number | null };
    fcp: { display: string; value: number | null };
    ttfb: { display: string; value: number | null };
  };
}

interface PsiData {
  url: string;
  mobile: PsiStrategy;
  desktop: PsiStrategy;
}

interface AiMetric {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  impressionsDelta: number;
  clicksDelta: number;
}

interface GscAiData {
  available: boolean;
  reason?: string;
  period?: { start: string; end: string; days: number };
  aiOverviews: AiMetric | null;
  aiMode: AiMetric | null;
}

interface ArticleWithGsc extends ArticleRow {
  gscClicks: number;
  gscImpressions: number;
  gscCtr: number;
  gscPosition: number | null;
  psiScore: number | null;
  psiLoading: boolean;
}

type ConnectorState = "idle" | "loading" | "ok" | "error";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeUrl(url: string): string {
  return url.trim().toLowerCase().replace(/\/$/, "");
}

function matchGscPage(wordpressUrl: string, pages: GscPage[]): GscPage | undefined {
  const normalized = normalizeUrl(wordpressUrl);
  return pages.find((p) => normalizeUrl(p.page) === normalized);
}

function psiColor(score: number | null): string {
  if (score === null) return "text-gray-400";
  if (score >= 90) return "text-emerald-600";
  if (score >= 50) return "text-amber-500";
  return "text-red-500";
}

function psiRingColor(score: number | null): string {
  if (score === null) return "border-gray-200";
  if (score >= 90) return "border-emerald-500";
  if (score >= 50) return "border-amber-400";
  return "border-red-500";
}

function deltaColor(delta: number, inverse = false): string {
  const good = inverse ? delta < 0 : delta > 0;
  if (delta === 0) return "text-gray-400";
  return good ? "text-emerald-600" : "text-red-500";
}

function DeltaBadge({ delta, inverse = false, suffix = "%" }: { delta: number; inverse?: boolean; suffix?: string }) {
  const good = inverse ? delta < 0 : delta > 0;
  const Icon = good ? TrendingUp : TrendingDown;
  const abs = Math.abs(delta);
  if (abs === 0) return null;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-semibold", good ? "text-emerald-600" : "text-red-500")}>
      <Icon className="h-3 w-3" />
      {abs}{suffix}
    </span>
  );
}

function PsiScoreCircle({ score, label }: { score: number | null; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={cn("w-12 h-12 rounded-full border-4 flex items-center justify-center font-bold text-sm", psiRingColor(score), psiColor(score))}>
        {score ?? "—"}
      </div>
      <span className="text-[10px] text-gray-500">{label}</span>
    </div>
  );
}

function ConnectorBadge({ status, label }: { status: ConnectorState; label: string }) {
  if (status === "loading") {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-50 text-blue-600 text-xs font-medium border border-blue-100">
        <Loader2 className="h-3 w-3 animate-spin" />{label}: กำลังตรวจสอบ...
      </span>
    );
  }
  if (status === "ok") {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-medium border border-emerald-200">
        <CheckCircle2 className="h-3 w-3" />{label}: Connected
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-50 text-red-600 text-xs font-medium border border-red-200">
        <AlertTriangle className="h-3 w-3" />{label}: ไม่ได้เชื่อมต่อ
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gray-100 text-gray-400 text-xs font-medium border border-gray-200">
      {label}: —
    </span>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  icon: Icon, label, value, delta, inverse = false, note,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  delta?: number;
  inverse?: boolean;
  note?: string;
}) {
  return (
    <div className="rounded-xl bg-white border border-gray-100 shadow-sm p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-slate-500">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className="text-2xl font-bold text-slate-900">{value}</div>
      <div className="flex items-center gap-2 flex-wrap">
        {delta !== undefined && delta !== 0 && (
          <DeltaBadge delta={delta} inverse={inverse} />
        )}
        {note && <span className="text-xs text-gray-400">{note}</span>}
      </div>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse bg-gray-100 rounded-lg", className)} />;
}

function KpiSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="rounded-xl bg-white border border-gray-100 shadow-sm p-4 space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-3 w-12" />
        </div>
      ))}
    </div>
  );
}

// ─── Client Tab ───────────────────────────────────────────────────────────────

function ClientTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-4 py-2 text-sm font-semibold rounded-t-lg border-b-2 transition-colors whitespace-nowrap",
        active
          ? "border-blue-500 text-blue-700 bg-blue-50/50"
          : "border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-200"
      )}
    >
      {label}
    </button>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function SEOReportClient() {
  const [days, setDays] = useState(28);
  const [loading, setLoading] = useState(false);
  const [gscConnector, setGscConnector] = useState<ConnectorState>("idle");
  const [ga4Connector, setGa4Connector] = useState<ConnectorState>("idle");
  const [gscSites, setGscSites] = useState<GscSite[]>([]);
  const [gscError, setGscError] = useState<string | null>(null);

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeClientIdx, setActiveClientIdx] = useState(0);

  // Per-project data (keyed by projectId)
  const [gscData, setGscData] = useState<Record<string, GscData>>({});
  const [ga4Data, setGa4Data] = useState<Record<string, Ga4Data>>({});
  const [psiData, setPsiData] = useState<Record<string, PsiData>>({});
  const [articleData, setArticleData] = useState<Record<string, ArticleRow[]>>({});
  const [gscAiData, setGscAiData] = useState<Record<string, GscAiData>>({});

  // Per-article PSI loading
  const [articlePsiData, setArticlePsiData] = useState<Record<string, number | null>>({});
  const [articlePsiLoading, setArticlePsiLoading] = useState<Record<string, boolean>>({});

  const [projectLoading, setProjectLoading] = useState<Record<string, boolean>>({});

  // Group projects by clientName
  const clients: { name: string; projects: ProjectSummary[] }[] = [];
  const unmatched: ProjectSummary[] = [];

  for (const p of projects) {
    const clientName = p.clientName ?? p.name;
    const matched = gscSites.length === 0 || (p.gscSiteUrl && gscSites.some((s) => s.siteUrl === p.gscSiteUrl));
    if (!matched && gscSites.length > 0) {
      unmatched.push(p);
      continue;
    }
    const existing = clients.find((c) => c.name === clientName);
    if (existing) {
      existing.projects.push(p);
    } else {
      clients.push({ name: clientName, projects: [p] });
    }
  }

  const activeClient = clients[activeClientIdx] ?? clients[0];

  // ── Refresh ──────────────────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    setLoading(true);
    setGscError(null);
    setGscConnector("loading");
    setGa4Connector("loading");

    // Step 1: fetch GSC sites + projects in parallel
    const [sitesRes, projRes] = await Promise.allSettled([
      fetch("/api/report/gsc-sites").then((r) => r.json()),
      fetch("/api/seo-report/projects").then((r) => r.json()),
    ]);

    let sites: GscSite[] = [];
    if (sitesRes.status === "fulfilled" && !sitesRes.value.error) {
      sites = sitesRes.value.sites ?? [];
      setGscSites(sites);
      setGscConnector("ok");
    } else {
      const errMsg = sitesRes.status === "fulfilled"
        ? sitesRes.value.error
        : "ไม่สามารถเชื่อมต่อ GSC ได้";
      setGscError(errMsg);
      setGscConnector("error");
    }

    let loadedProjects: ProjectSummary[] = [];
    if (projRes.status === "fulfilled" && Array.isArray(projRes.value)) {
      loadedProjects = projRes.value;
      setProjects(loadedProjects);
    }

    // Step 2: for each project with gscSiteUrl in sites list, fetch data
    const matchedProjects = loadedProjects.filter((p) =>
      p.gscSiteUrl && (sites.length === 0 || sites.some((s) => s.siteUrl === p.gscSiteUrl))
    );

    let anyGa4 = false;
    const newGscData: Record<string, GscData> = {};
    const newGa4Data: Record<string, Ga4Data> = {};
    const newPsiData: Record<string, PsiData> = {};
    const newArticleData: Record<string, ArticleRow[]> = {};
    const newGscAiData: Record<string, GscAiData> = {};

    setProjectLoading(Object.fromEntries(matchedProjects.map((p) => [p.id, true])));

    await Promise.all(
      matchedProjects.map(async (project) => {
        const fetches: Promise<void>[] = [];

        // GSC data
        if (project.gscSiteUrl) {
          fetches.push(
            fetch("/api/report/gsc", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ siteUrl: project.gscSiteUrl, days }),
            })
              .then((r) => r.json())
              .then((d) => {
                if (!d.error) newGscData[project.id] = d as GscData;
              })
              .catch(() => {})
          );

          // GSC AI Performance
          fetches.push(
            fetch("/api/report/gsc-ai", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ siteUrl: project.gscSiteUrl, days }),
            })
              .then((r) => r.json())
              .then((d) => {
                if (!d.error) newGscAiData[project.id] = d as GscAiData;
              })
              .catch(() => {})
          );
        }

        // Articles
        fetches.push(
          fetch(`/api/seo-report/data?projectId=${project.id}`)
            .then((r) => r.json())
            .then((d) => {
              if (d.articles) newArticleData[project.id] = d.articles as ArticleRow[];
            })
            .catch(() => {})
        );

        // GA4
        if (project.ga4PropertyId) {
          anyGa4 = true;
          fetches.push(
            fetch("/api/report/ga4", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ propertyId: project.ga4PropertyId, days }),
            })
              .then((r) => r.json())
              .then((d) => {
                if (!d.error) newGa4Data[project.id] = d as Ga4Data;
              })
              .catch(() => {})
          );
        }

        // PageSpeed for homepage
        const homepage = project.website;
        if (homepage) {
          fetches.push(
            fetch("/api/report/pagespeed", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: homepage }),
            })
              .then((r) => r.json())
              .then((d) => {
                if (!d.error) newPsiData[project.id] = d as PsiData;
              })
              .catch(() => {})
          );
        }

        await Promise.all(fetches);
        setProjectLoading((prev) => ({ ...prev, [project.id]: false }));
      })
    );

    setGscData(newGscData);
    setGa4Data(newGa4Data);
    setPsiData(newPsiData);
    setArticleData(newArticleData);
    setGscAiData(newGscAiData);

    if (anyGa4 || Object.keys(newGa4Data).length > 0) {
      setGa4Connector("ok");
    } else {
      setGa4Connector("idle");
    }

    setLoading(false);
  }, [days]);

  // Auto-load projects on mount
  useEffect(() => {
    fetch("/api/seo-report/projects")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setProjects(d); })
      .catch(() => {});
  }, []);

  // ── Load per-article PSI ──────────────────────────────────────────────────────

  const loadArticlePsi = useCallback(async (url: string) => {
    setArticlePsiLoading((prev) => ({ ...prev, [url]: true }));
    try {
      const res = await fetch("/api/report/pagespeed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const d = await res.json() as PsiData & { error?: string };
      if (!d.error) {
        setArticlePsiData((prev) => ({ ...prev, [url]: d.mobile?.scores?.performance ?? null }));
      } else {
        setArticlePsiData((prev) => ({ ...prev, [url]: null }));
      }
    } catch {
      setArticlePsiData((prev) => ({ ...prev, [url]: null }));
    } finally {
      setArticlePsiLoading((prev) => ({ ...prev, [url]: false }));
    }
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 text-slate-900">
      <div className="max-w-[1400px] mx-auto px-4 py-6 md:px-8 md:py-8 space-y-6">

        {/* ── Header ───────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">SEO Report</h1>
            <p className="text-sm text-slate-500 mt-0.5">ข้อมูลจริงจาก Google Search Console · GA4 · PageSpeed</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Day range selector */}
            <div className="flex rounded-lg overflow-hidden border border-gray-200 bg-white text-sm">
              {([7, 28, 90] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={cn(
                    "px-3 py-1.5 font-medium transition-colors",
                    days === d ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-50"
                  )}
                >
                  {d} วัน
                </button>
              ))}
            </div>
            <button
              onClick={refresh}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors disabled:opacity-60"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              {loading ? "กำลังโหลด..." : "Refresh"}
            </button>
          </div>
        </div>

        {/* ── Connectors Panel ─────────────────────────────────────────────── */}
        <div className="rounded-xl bg-white border border-gray-100 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="h-4 w-4 text-slate-500" />
            <span className="text-sm font-semibold text-slate-700">Data API Connectors</span>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <ConnectorBadge status={gscConnector} label="Google Search Console" />
            <ConnectorBadge status={ga4Connector} label="Google Analytics 4" />
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-violet-50 text-violet-700 text-xs font-medium border border-violet-100">
              <Gauge className="h-3 w-3" />PageSpeed: พร้อมใช้งาน
            </span>
          </div>
          {gscError && (
            <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
              <AlertTriangle className="h-3.5 w-3.5 inline mr-1" />
              {gscError === "Could not load the default credentials." || gscError?.includes("credentials")
                ? "กรุณาตั้งค่า Service Account ใน .env.local: ตั้งค่า GOOGLE_SERVICE_ACCOUNT_KEY หรือ GOOGLE_APPLICATION_CREDENTIALS"
                : gscError}
            </div>
          )}
          {gscConnector === "ok" && gscSites.length > 0 && (
            <div className="mt-2 text-xs text-slate-400">
              พบ {gscSites.length} sites ใน GSC service account
            </div>
          )}
        </div>

        {/* ── Client Tabs ──────────────────────────────────────────────────── */}
        {clients.length > 0 && (
          <div>
            <div className="flex gap-0 border-b border-gray-200 overflow-x-auto">
              {clients.map((client, idx) => (
                <ClientTab
                  key={client.name}
                  label={client.name}
                  active={activeClientIdx === idx}
                  onClick={() => setActiveClientIdx(idx)}
                />
              ))}
              {unmatched.length > 0 && (
                <ClientTab
                  label={`ยังไม่ได้เชื่อมต่อ (${unmatched.length})`}
                  active={activeClientIdx === clients.length}
                  onClick={() => setActiveClientIdx(clients.length)}
                />
              )}
            </div>
          </div>
        )}

        {/* ── Unmatched projects ──────────────────────────────────────────── */}
        {activeClientIdx === clients.length && unmatched.length > 0 && (
          <div className="rounded-xl bg-white border border-gray-100 shadow-sm p-5">
            <h2 className="font-semibold text-slate-700 mb-3 text-sm">Projects ที่ยังไม่ได้ผูก GSC Site</h2>
            <div className="space-y-2">
              {unmatched.map((p) => (
                <div key={p.id} className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 bg-gray-50">
                  <Globe2 className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-slate-700">{p.name}</p>
                    <p className="text-xs text-gray-400">{p.website}</p>
                  </div>
                  <span className="ml-auto text-xs text-amber-600 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-full">
                    ไม่มี gscSiteUrl
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Per-client project reports ───────────────────────────────────── */}
        {activeClient && activeClientIdx < clients.length && (
          <div className="space-y-8">
            {activeClient.projects.map((project) => (
              <ProjectReport
                key={project.id}
                project={project}
                gscData={gscData[project.id] ?? null}
                ga4Data={ga4Data[project.id] ?? null}
                psiData={psiData[project.id] ?? null}
                articles={articleData[project.id] ?? null}
                gscAiData={gscAiData[project.id] ?? null}
                isLoading={projectLoading[project.id] ?? false}
                articlePsiData={articlePsiData}
                articlePsiLoading={articlePsiLoading}
                onLoadArticlePsi={loadArticlePsi}
              />
            ))}
          </div>
        )}

        {/* ── Empty state ─────────────────────────────────────────────────── */}
        {projects.length === 0 && !loading && (
          <div className="rounded-xl bg-white border border-dashed border-gray-200 p-12 text-center">
            <Globe2 className="h-10 w-10 text-gray-200 mx-auto mb-3" />
            <p className="font-semibold text-slate-600 mb-1">ยังไม่มี Projects</p>
            <p className="text-sm text-slate-400">กด Refresh เพื่อโหลดข้อมูล หรือสร้าง Project ก่อน</p>
          </div>
        )}

      </div>
    </div>
  );
}

// ─── ProjectReport ────────────────────────────────────────────────────────────

interface ProjectReportProps {
  project: ProjectSummary;
  gscData: GscData | null;
  ga4Data: Ga4Data | null;
  psiData: PsiData | null;
  articles: ArticleRow[] | null;
  gscAiData: GscAiData | null;
  isLoading: boolean;
  articlePsiData: Record<string, number | null>;
  articlePsiLoading: Record<string, boolean>;
  onLoadArticlePsi: (url: string) => void;
}

function ProjectReport({
  project, gscData, ga4Data, psiData, articles, gscAiData, isLoading,
  articlePsiData, articlePsiLoading, onLoadArticlePsi,
}: ProjectReportProps) {
  // Articles with GSC match
  const enrichedArticles: ArticleWithGsc[] = (articles ?? [])
    .filter((a) => a.wordpressUrl)
    .map((a) => {
      const page = gscData ? matchGscPage(a.wordpressUrl!, gscData.pages) : undefined;
      const url = a.wordpressUrl!;
      return {
        ...a,
        gscClicks: page?.clicks ?? 0,
        gscImpressions: page?.impressions ?? 0,
        gscCtr: page?.ctr ?? 0,
        gscPosition: page?.position ?? null,
        psiScore: articlePsiData[url] ?? null,
        psiLoading: articlePsiLoading[url] ?? false,
      };
    })
    .sort((a, b) => b.gscClicks - a.gscClicks);

  return (
    <div className="rounded-2xl bg-white border border-gray-100 shadow-sm overflow-hidden">
      {/* Project header */}
      <div className="p-5 border-b border-gray-100 flex items-start gap-3">
        <div className="w-2 h-10 rounded-full flex-shrink-0" style={{ background: project.accentColor ?? "#2563eb" }} />
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-slate-900 text-lg leading-tight">{project.name}</h2>
          {project.clientName && <p className="text-sm text-gray-400">{project.clientName}</p>}
          <a href={project.website} target="_blank" rel="noopener noreferrer"
            className="text-xs text-blue-500 hover:underline flex items-center gap-1 mt-0.5">
            <Globe2 className="h-3 w-3" />{project.website}
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        </div>
        <div className="flex flex-wrap gap-1.5 flex-shrink-0">
          {project.gscSiteUrl && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100 font-medium">
              GSC: {project.gscSiteUrl}
            </span>
          )}
          {project.ga4PropertyId && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-100 font-medium">
              GA4: {project.ga4PropertyId}
            </span>
          )}
        </div>
      </div>

      <div className="p-5 space-y-6">

        {/* Loading skeleton */}
        {isLoading && <KpiSkeleton />}

        {/* ── 4a. GSC Overview ─────────────────────────────────────────────── */}
        {!isLoading && gscData && (
          <section>
            <SectionTitle icon={<Search className="h-4 w-4" />} label="Google Search Console" sub={`${gscData.period.start} → ${gscData.period.end}`} />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
              <KpiCard
                icon={MousePointerClick}
                label="Clicks"
                value={gscData.overview.clicks.toLocaleString()}
                delta={gscData.overview.clicksDelta}
              />
              <KpiCard
                icon={Eye}
                label="Impressions"
                value={gscData.overview.impressions.toLocaleString()}
                delta={gscData.overview.impressionsDelta}
              />
              <KpiCard
                icon={Target}
                label="CTR"
                value={`${gscData.overview.ctr.toFixed(1)}%`}
                delta={gscData.overview.ctrDelta}
              />
              <KpiCard
                icon={TrendingUp}
                label="Avg Position"
                value={`#${gscData.overview.position.toFixed(1)}`}
                delta={gscData.overview.positionDelta}
                inverse
                note="vs ก่อนหน้า"
              />
            </div>
          </section>
        )}

        {/* GSC not available */}
        {!isLoading && !gscData && project.gscSiteUrl && (
          <div className="rounded-lg bg-amber-50 border border-amber-100 p-4 text-sm text-amber-700">
            <AlertTriangle className="h-4 w-4 inline mr-1.5" />
            ไม่สามารถดึงข้อมูล GSC ได้ — กด Refresh เพื่อลองใหม่
          </div>
        )}
        {!isLoading && !project.gscSiteUrl && (
          <div className="rounded-lg bg-gray-50 border border-gray-100 p-4 text-sm text-gray-500">
            ยังไม่ได้ตั้งค่า <code className="bg-gray-200 px-1 rounded text-xs">gscSiteUrl</code> ใน Project settings
          </div>
        )}

        {/* ── 4b. Articles Table ───────────────────────────────────────────── */}
        {!isLoading && articles !== null && (
          <section>
            <SectionTitle icon={<FileText className="h-4 w-4" />} label="บทความที่ Published (WordPress)" sub={`${enrichedArticles.length} บทความ`} />
            {enrichedArticles.length === 0 ? (
              <div className="mt-3 text-center py-8 text-gray-400 text-sm border border-dashed border-gray-200 rounded-xl">
                ยังไม่มีบทความที่มี WordPress URL
              </div>
            ) : (
              <div className="mt-3 overflow-x-auto rounded-xl border border-gray-100">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      {["ชื่อบทความ", "URL", "Keyword", "Clicks", "Impressions", "CTR", "Position", "PageSpeed Mobile"].map((h) => (
                        <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {enrichedArticles.map((a, i) => (
                      <tr key={a.id} className={cn("border-b border-gray-50 hover:bg-blue-50/20 transition-colors", i % 2 === 1 && "bg-gray-50/50")}>
                        <td className="px-3 py-2.5 font-medium text-slate-800 max-w-[200px]">
                          <div className="truncate text-xs leading-snug">{a.title}</div>
                        </td>
                        <td className="px-3 py-2.5">
                          <a href={a.wordpressUrl!} target="_blank" rel="noopener noreferrer"
                            className="text-xs text-blue-500 hover:underline flex items-center gap-0.5 max-w-[160px]">
                            <span className="truncate">{a.wordpressUrl!.replace(/^https?:\/\/[^/]+/, "").slice(0, 32) || "/"}</span>
                            <ExternalLink className="h-2.5 w-2.5 flex-shrink-0" />
                          </a>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-gray-500 max-w-[120px]">
                          <div className="truncate">{a.keyword ?? "—"}</div>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={cn("text-xs font-bold", a.gscClicks > 0 ? "text-slate-900" : "text-gray-300")}>
                            {a.gscClicks > 0 ? a.gscClicks.toLocaleString() : "0"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-gray-500">
                          {a.gscImpressions > 0 ? a.gscImpressions.toLocaleString() : "0"}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-gray-500">
                          {a.gscCtr > 0 ? `${a.gscCtr.toFixed(1)}%` : "—"}
                        </td>
                        <td className="px-3 py-2.5">
                          {a.gscPosition !== null ? (
                            <span className={cn("text-xs font-bold px-1.5 py-0.5 rounded",
                              a.gscPosition <= 3 ? "bg-emerald-100 text-emerald-700"
                              : a.gscPosition <= 10 ? "bg-blue-100 text-blue-700"
                              : "bg-amber-100 text-amber-700"
                            )}>
                              #{a.gscPosition.toFixed(1)}
                            </span>
                          ) : <span className="text-xs text-gray-300">—</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          <ArticlePsiCell
                            url={a.wordpressUrl!}
                            score={articlePsiData[a.wordpressUrl!] ?? null}
                            isLoading={articlePsiLoading[a.wordpressUrl!] ?? false}
                            onLoad={() => onLoadArticlePsi(a.wordpressUrl!)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* ── 4c. GA4 Section ──────────────────────────────────────────────── */}
        {!isLoading && ga4Data && (
          <section>
            <SectionTitle icon={<BarChart3 className="h-4 w-4" />} label="Google Analytics 4" sub={`${ga4Data.period.start} → ${ga4Data.period.end}`} />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
              <KpiCard
                icon={Activity}
                label="Sessions"
                value={ga4Data.overview.sessions.toLocaleString()}
                delta={ga4Data.overview.sessionsDelta}
              />
              <KpiCard
                icon={Users}
                label="Users"
                value={ga4Data.overview.users.toLocaleString()}
                delta={ga4Data.overview.usersDelta}
              />
              <KpiCard
                icon={Target}
                label="Conversions"
                value={ga4Data.overview.conversions.toLocaleString()}
                delta={ga4Data.overview.conversionsDelta}
              />
              <KpiCard
                icon={TrendingUp}
                label="Revenue"
                value={`฿${ga4Data.overview.revenue.toLocaleString()}`}
              />
            </div>
          </section>
        )}
        {!isLoading && !ga4Data && project.ga4PropertyId && (
          <div className="rounded-lg bg-amber-50 border border-amber-100 p-4 text-sm text-amber-700">
            <AlertTriangle className="h-4 w-4 inline mr-1.5" />
            ไม่สามารถดึงข้อมูล GA4 ได้ — ตรวจสอบ property ID: {project.ga4PropertyId}
          </div>
        )}

        {/* ── 4d. AI Performance (GSC) ─────────────────────────────────────── */}
        {!isLoading && project.gscSiteUrl && gscAiData !== null && (
          <section>
            <SectionTitle icon={<Zap className="h-4 w-4 text-blue-500" />} label="AI Performance (Google Search Console)" sub="Beta" />
            {!gscAiData.available ? (
              <div className="mt-3 rounded-xl bg-blue-50 border border-blue-100 p-5 flex gap-3 items-start">
                <div className="flex-shrink-0 w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center">
                  <Zap className="h-4 w-4 text-blue-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-blue-800 mb-0.5">Account นี้ยังไม่มีข้อมูล AI Performance</p>
                  <p className="text-xs text-blue-600 leading-relaxed">
                    Google Search Console กำลัง rollout ฟีเจอร์ <strong>AI Overviews</strong> และ <strong>AI Mode</strong> Report แบบ Beta
                    — หากเว็บไซต์ของคุณมี traffic จาก AI-generated results จะเริ่มเห็นข้อมูลในส่วนนี้โดยอัตโนมัติ
                  </p>
                  {gscAiData.reason && (
                    <p className="text-[11px] text-blue-400 mt-1.5 font-mono">{gscAiData.reason}</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* AI Overviews */}
                {gscAiData.aiOverviews && (
                  <div className="rounded-xl border border-blue-100 bg-gradient-to-br from-blue-50 to-white p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center">
                        <Zap className="h-3 w-3 text-white" />
                      </div>
                      <span className="text-sm font-semibold text-blue-900">AI Overviews</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600 font-medium">Beta</span>
                    </div>
                    <p className="text-[11px] text-blue-500 mb-3">Google-generated summaries at the top of search results</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-xs text-gray-500 mb-0.5">Impressions</p>
                        <p className="text-xl font-bold text-slate-900">{gscAiData.aiOverviews.impressions.toLocaleString()}</p>
                        <DeltaBadge delta={gscAiData.aiOverviews.impressionsDelta} />
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-0.5">Clicks</p>
                        <p className="text-xl font-bold text-slate-900">{gscAiData.aiOverviews.clicks.toLocaleString()}</p>
                        <DeltaBadge delta={gscAiData.aiOverviews.clicksDelta} />
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-0.5">CTR</p>
                        <p className="text-sm font-bold text-slate-700">{gscAiData.aiOverviews.ctr.toFixed(1)}%</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-0.5">Avg Position</p>
                        <p className="text-sm font-bold text-slate-700">#{gscAiData.aiOverviews.position.toFixed(1)}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* AI Mode */}
                {gscAiData.aiMode && (
                  <div className="rounded-xl border border-violet-100 bg-gradient-to-br from-violet-50 to-white p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-6 h-6 rounded-full bg-violet-500 flex items-center justify-center">
                        <Search className="h-3 w-3 text-white" />
                      </div>
                      <span className="text-sm font-semibold text-violet-900">AI Mode</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-600 font-medium">Beta</span>
                    </div>
                    <p className="text-[11px] text-violet-500 mb-3">Conversational AI experience in Search</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-xs text-gray-500 mb-0.5">Impressions</p>
                        <p className="text-xl font-bold text-slate-900">{gscAiData.aiMode.impressions.toLocaleString()}</p>
                        <DeltaBadge delta={gscAiData.aiMode.impressionsDelta} />
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-0.5">Clicks</p>
                        <p className="text-xl font-bold text-slate-900">{gscAiData.aiMode.clicks.toLocaleString()}</p>
                        <DeltaBadge delta={gscAiData.aiMode.clicksDelta} />
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-0.5">CTR</p>
                        <p className="text-sm font-bold text-slate-700">{gscAiData.aiMode.ctr.toFixed(1)}%</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-0.5">Avg Position</p>
                        <p className="text-sm font-bold text-slate-700">#{gscAiData.aiMode.position.toFixed(1)}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Summary banner */}
                <div className="md:col-span-2 rounded-lg bg-slate-50 border border-slate-100 px-4 py-3 flex items-center gap-2">
                  <TrendingUp className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                  <p className="text-xs text-slate-500">
                    {gscAiData.period && <>ข้อมูล {gscAiData.period.days} วัน · {gscAiData.period.start} → {gscAiData.period.end} · </>}
                    Performance Summary: Impressions{" "}
                    <span className="font-semibold text-slate-700">
                      {((gscAiData.aiOverviews?.impressions ?? 0) + (gscAiData.aiMode?.impressions ?? 0)).toLocaleString()}
                    </span>
                    {" "}· Clicks{" "}
                    <span className="font-semibold text-slate-700">
                      {((gscAiData.aiOverviews?.clicks ?? 0) + (gscAiData.aiMode?.clicks ?? 0)).toLocaleString()}
                    </span>
                  </p>
                </div>
              </div>
            )}
          </section>
        )}

        {/* ── 4e. PageSpeed Homepage ───────────────────────────────────────── */}
        {!isLoading && psiData && (
          <section>
            <SectionTitle icon={<Zap className="h-4 w-4" />} label="PageSpeed Insights — Homepage" sub={psiData.url} />
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
              <PsiPanel strategy="Mobile" data={psiData.mobile} />
              <PsiPanel strategy="Desktop" data={psiData.desktop} />
            </div>
          </section>
        )}

        {/* ── 4e. Top Keywords (from GSC queries) ──────────────────────────── */}
        {!isLoading && gscData && gscData.queries.length > 0 && (
          <section>
            <SectionTitle icon={<Search className="h-4 w-4" />} label="Top Keywords จาก GSC" />
            <div className="mt-3 overflow-x-auto rounded-xl border border-gray-100">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    {["Keyword", "Clicks", "Impressions", "CTR", "Position"].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {gscData.queries.slice(0, 15).map((q, i) => (
                    <tr key={q.query} className={cn("border-b border-gray-50 hover:bg-blue-50/20 transition-colors", i % 2 === 1 && "bg-gray-50/50")}>
                      <td className="px-3 py-2 text-xs text-slate-700 font-medium max-w-[220px]">
                        <div className="truncate">{q.query}</div>
                      </td>
                      <td className="px-3 py-2 text-xs font-bold text-slate-900">{q.clicks.toLocaleString()}</td>
                      <td className="px-3 py-2 text-xs text-gray-500">{q.impressions.toLocaleString()}</td>
                      <td className="px-3 py-2 text-xs text-gray-500">{q.ctr.toFixed(1)}%</td>
                      <td className="px-3 py-2">
                        <span className={cn("text-xs font-semibold",
                          q.position <= 3 ? "text-emerald-600"
                          : q.position <= 10 ? "text-blue-600"
                          : "text-gray-500"
                        )}>
                          #{q.position.toFixed(1)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

      </div>
    </div>
  );
}

// ─── PSI Panel ────────────────────────────────────────────────────────────────

function PsiPanel({ strategy, data }: { strategy: string; data: PsiStrategy }) {
  return (
    <div className="rounded-xl border border-gray-100 p-4">
      <div className="flex items-center gap-1.5 mb-3">
        <Gauge className="h-3.5 w-3.5 text-violet-500" />
        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{strategy}</span>
      </div>
      <div className="flex gap-4 mb-4">
        <PsiScoreCircle score={data.scores.performance} label="Performance" />
        <PsiScoreCircle score={data.scores.accessibility} label="Accessibility" />
        <PsiScoreCircle score={data.scores.seo} label="SEO" />
      </div>
      {data.vitals && (
        <div className="grid grid-cols-2 gap-2">
          {data.vitals.lcp && (
            <VitalRow label="LCP" display={data.vitals.lcp.display} value={data.vitals.lcp.value} good={2500} bad={4000} unit="ms" />
          )}
          {data.vitals.cls && (
            <VitalRow label="CLS" display={data.vitals.cls.display} value={data.vitals.cls.value} good={0.1} bad={0.25} unit="" />
          )}
          {data.vitals.fcp && (
            <VitalRow label="FCP" display={data.vitals.fcp.display} value={data.vitals.fcp.value} good={1800} bad={3000} unit="ms" />
          )}
          {data.vitals.ttfb && (
            <VitalRow label="TTFB" display={data.vitals.ttfb.display} value={data.vitals.ttfb.value} good={800} bad={1800} unit="ms" />
          )}
        </div>
      )}
    </div>
  );
}

function VitalRow({ label, display, value, good, bad, unit }: {
  label: string; display: string; value: number | null; good: number; bad: number; unit: string;
}) {
  const color = value === null ? "text-gray-400"
    : value <= good ? "text-emerald-600"
    : value <= bad ? "text-amber-500"
    : "text-red-500";
  void unit;
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-gray-400 font-medium">{label}</span>
      <span className={cn("font-bold", color)}>{display}</span>
    </div>
  );
}

// ─── Article PSI Cell ─────────────────────────────────────────────────────────

function ArticlePsiCell({ url, score, isLoading, onLoad }: {
  url: string; score: number | null; isLoading: boolean; onLoad: () => void;
}) {
  if (isLoading) {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />;
  }
  if (score !== null) {
    return (
      <span className={cn("text-xs font-bold px-1.5 py-0.5 rounded",
        score >= 90 ? "bg-emerald-100 text-emerald-700"
        : score >= 50 ? "bg-amber-100 text-amber-700"
        : "bg-red-100 text-red-700"
      )}>
        {score}
      </span>
    );
  }
  return (
    <button
      onClick={() => onLoad()}
      className="text-xs px-2 py-0.5 rounded bg-gray-100 hover:bg-blue-100 text-gray-500 hover:text-blue-600 transition-colors font-medium"
      title={url}
    >
      โหลด
    </button>
  );
}

// ─── Section Title ────────────────────────────────────────────────────────────

function SectionTitle({ icon, label, sub }: { icon: React.ReactNode; label: string; sub?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-slate-500">{icon}</span>
      <span className="font-semibold text-slate-800 text-sm">{label}</span>
      {sub && (
        <>
          <ChevronRight className="h-3 w-3 text-gray-300" />
          <span className="text-xs text-gray-400">{sub}</span>
        </>
      )}
    </div>
  );
}
