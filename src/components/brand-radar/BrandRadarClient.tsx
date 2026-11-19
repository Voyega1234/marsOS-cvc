"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Loader2, Plus, Settings, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader, UnderlineTabs } from "@/components/ds";
import SearchSelect from "@/components/backlink-management/SearchSelect";
import { useUrlState } from "@/hooks/use-url-state";
import {
  LIMITS, PROVIDER_KEYS,
  type CompetitorDTO, type CreateProjectRes, type ProfileDTO, type ProfileRes, type ProjectOptDTO, type ProjectsRes,
  type RadarFilters, type RunDTO, type RunDueRes, type ProviderKey,
} from "@/lib/brand-radar/types";
import { api, CLIENT_TAB_IDS, clearRadarCache, defaultFilters, postJson, TAB_IDS, type TabFocus, type TabFocusState, type TabId, type TabProps } from "./shared";
import { PlatformChooser } from "./PlatformPicker";
import { BrandList } from "./BrandList";
import BrandNameSuggestions from "./BrandNameSuggestions";
import FilterBar from "./FilterBar";
import RunPanel from "./RunPanel";
import OverviewTab from "./OverviewTab";
import AnswersTab from "./AnswersTab";
import SettingsTab, { TagInput } from "./SettingsTab";
import PromptsTab from "./PromptsTab";
import CompetitorsTab from "./CompetitorsTab";
import CitationsTab from "./CitationsTab";
import CitationAnalysisTab from "./CitationAnalysisTab";
import OpportunitiesTab from "./OpportunitiesTab";

const PROVIDER_FILTERS = ["all", ...PROVIDER_KEYS] as const;
const CLIENT_LOAD_ERROR = "โหลดข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง";
const INPUT_CLS = "h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm";

/** Create a project that lives only in Brand Radar (a brand that is not a client elsewhere in MarsOS). */
function NewProjectDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void | Promise<void> }) {
  // Every name the brand goes by. The first one names the project, the rest are stored as aliases.
  const [names, setNames] = useState<string[]>([]);
  const [website, setWebsite] = useState("");
  const [picked, setPicked] = useState<ProviderKey[]>([...PROVIDER_KEYS]);
  const [rows, setRows] = useState<Array<{ name: string; domain: string }>>([{ name: "", domain: "" }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const setRow = (i: number, patch: Partial<{ name: string; domain: string }>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const submit = async () => {
    if (saving) return;
    const [name, ...aliases] = names;
    if (!name) { setError("กรอกชื่อแบรนด์ แล้วกด Enter"); return; }
    if (!website.trim()) { setError("กรอกเว็บไซต์ของแบรนด์"); return; }
    const competitors: Array<{ name: string; domain?: string }> = [];
    for (const r of rows) {
      const n = r.name.trim();
      const d = r.domain.trim();
      if (!n && !d) continue;
      if (!n) { setError("กรอกชื่อคู่แข่งให้ครบ"); return; }
      competitors.push(d ? { name: n, domain: d } : { name: n });
    }
    const providers: ProviderKey[] = picked.length === 0 ? [...PROVIDER_KEYS] : PROVIDER_KEYS.filter((k) => picked.includes(k));
    setSaving(true);
    setError("");
    const res = await api<CreateProjectRes>("/api/brand-radar/projects", postJson({ name, website: website.trim(), aliases, providers, competitors }));
    setSaving(false);
    if (!res.ok || !res.data.project) {
      const raw = res.data.error || "";
      setError(
        raw === "Primary domain is not a valid domain" ? "เว็บไซต์ไม่ถูกต้อง เช่น example.com"
          : raw === "Brand name is required" ? "กรอกชื่อแบรนด์"
          : raw === "Competitor name is required" ? "กรอกชื่อคู่แข่งให้ครบ"
          : raw || "สร้างโปรเจกต์ไม่สำเร็จ",
      );
      return;
    }
    toast.success(`สร้างโปรเจกต์ ${res.data.project.name} แล้ว`);
    await onCreated(res.data.project.id);
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent className="max-h-[90vh] w-full max-w-[calc(100vw-1.5rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>สร้างโปรเจกต์ใหม่</DialogTitle>
        </DialogHeader>
        <form className="max-h-[75vh] space-y-3 overflow-y-auto px-0.5" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <p className="text-xs text-gray-500">
            ใช้กับแบรนด์ที่ยังไม่มีในรายชื่อลูกค้า โปรเจกต์นี้อยู่ใน Brand Radar เท่านั้น ไม่ไปโผล่ในเมนูอื่น
          </p>
          <div className="block text-sm">
            <span className="mb-1 block font-medium text-brand-navy">ชื่อแบรนด์ (พิมพ์ได้หลายชื่อ)</span>
            <BrandNameSuggestions names={names} website={website} max={LIMITS.aliasesMax + 1} onAdd={(added) => setNames((cur) => [...cur, ...added])}>
              <TagInput primary max={LIMITS.aliasesMax + 1} value={names} onChange={setNames} placeholder="เช่น Mfactors, เอ็มแฟคเตอร์, M-Factors (Enter หรือ , เพื่อเพิ่ม)" />
            </BrandNameSuggestions>
            <span className="mt-1 block text-xs text-gray-500">
              ใส่ทุกแบบที่คนเรียกหรือสะกด เช่น ชื่อไทย ชื่ออังกฤษ ชื่อย่อ แบบเว้นวรรคและไม่เว้นวรรค ถ้า AI ใช้ชื่อใดชื่อหนึ่ง จะนับเป็นการพูดถึงแบรนด์ (ไม่สนตัวพิมพ์เล็ก-ใหญ่) ชื่อแรกใช้เป็นชื่อโปรเจกต์ กดที่ชื่ออื่นเพื่อตั้งเป็นชื่อหลัก แก้ไขภายหลังได้ที่ปุ่ม Settings มุมขวาบน
            </span>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-brand-navy">เว็บไซต์</span>
            <input className={INPUT_CLS} value={website} onChange={(e) => setWebsite(e.target.value)} maxLength={253} placeholder="example.com" inputMode="url" />
            <span className="mt-1 block text-xs text-gray-500">ใช้จับว่า AI อ้างอิงหน้าเว็บของแบรนด์หรือไม่ (citation)</span>
          </label>
          <div className="space-y-2">
            <span className="block text-sm font-medium text-brand-navy">AI platform ที่จะติดตาม</span>
            <PlatformChooser value={picked} onChange={setPicked} disabled={saving} />
            <p className="text-xs text-gray-500">ยิ่งเลือกหลาย platform ค่าใช้จ่ายต่อการสแกนยิ่งสูง · สถานะการเชื่อมต่อดูได้ที่ปุ่ม Settings มุมขวาบน</p>
          </div>
          <div className="space-y-2">
            <span className="block text-sm font-medium text-brand-navy">คู่แข่งที่จะติดตาม (ไม่บังคับ)</span>
            <p className="text-xs text-gray-500">ใส่ไว้ก่อนได้เลย รายงานจะเทียบแบรนด์เรากับคู่แข่งเหล่านี้ แก้ไขภายหลังได้ที่แท็บ Competitors</p>
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_40px] sm:items-center">
                <input className={INPUT_CLS} value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} maxLength={100} placeholder="ชื่อคู่แข่ง" />
                <input className={INPUT_CLS} value={r.domain} onChange={(e) => setRow(i, { domain: e.target.value })} maxLength={253} placeholder="เว็บไซต์ (ไม่บังคับ)" inputMode="url" />
                <button type="button" aria-label="ลบคู่แข่ง" disabled={saving}
                  onClick={() => setRows((rs) => (rs.length <= 1 ? [{ name: "", domain: "" }] : rs.filter((_, j) => j !== i)))}
                  className="flex h-10 w-full shrink-0 items-center justify-center rounded-xl border border-gray-200 text-gray-500 sm:w-10 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
            {rows.length < LIMITS.competitorsMax && (
              <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => setRows((rs) => [...rs, { name: "", domain: "" }])}>
                <Plus className="mr-1.5 h-4 w-4" />เพิ่มคู่แข่ง
              </Button>
            )}
          </div>
          {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>ยกเลิก</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}สร้างโปรเจกต์
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}


export default function BrandRadarClient({ userRole, initialProjects }: { userRole: string; initialProjects?: ProjectOptDTO[] }) {
  const clientView = userRole === "CLIENT";
  const defaults = useMemo(() => defaultFilters(), []);
  const [projectId, setProjectId] = useUrlState<string>("project", "");
  const [tab, setTab] = useUrlState<TabId>("tab", "overview", TAB_IDS);
  const [from, setFrom] = useUrlState<string>("from", defaults.from);
  const [to, setTo] = useUrlState<string>("to", defaults.to);
  const [country, setCountry] = useUrlState<string>("country", "all");
  const [language, setLanguage] = useUrlState<string>("language", "all");
  const [provider, setProvider] = useUrlState<string>("provider", "all", PROVIDER_FILTERS);

  const filters: RadarFilters = useMemo(
    () => ({ from, to, country, language, provider: provider as RadarFilters["provider"] }),
    [from, to, country, language, provider],
  );

  const [projects, setProjects] = useState<ProjectOptDTO[]>(initialProjects ?? []);
  const [projectsLoaded, setProjectsLoaded] = useState(initialProjects !== undefined);
  const [projectsError, setProjectsError] = useState("");
  const [profile, setProfile] = useState<ProfileDTO | null>(null);
  const [, setCompetitors] = useState<CompetitorDTO[]>([]);
  const [profileLoaded, setProfileLoaded] = useState(false);
  // "automatic scanning" switch of the active project (staff only), used to word the scan notices
  const [autoScan, setAutoScan] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [dueRun, setDueRun] = useState<RunDTO | null>(null);
  const dueCheckedFor = useRef("");
  const profileFor = useRef("");
  const [creating, setCreating] = useState(false);
  // customer login: the server answered 401 / 403 / 404 for the project list
  const [projectsDenied, setProjectsDenied] = useState(false);

  const loadProjects = useCallback(async () => {
    const res = await api<ProjectsRes>("/api/brand-radar/projects");
    if (!res.ok) {
      if (clientView) console.error("brand-radar projects:", res.data.error);
      setProjectsError(clientView ? CLIENT_LOAD_ERROR : res.data.error || "โหลดรายชื่อลูกค้าไม่สำเร็จ");
    } else setProjectsError("");
    setProjectsDenied(!res.ok && (res.status === 401 || res.status === 403 || res.status === 404));
    setProjects(res.ok && Array.isArray(res.data.projects) ? res.data.projects : []);
    setProjectsLoaded(true);
  }, [clientView]);

  const loadProfile = useCallback(async (id: string) => {
    profileFor.current = id;
    const res = await api<ProfileRes>(`/api/brand-radar/profile?projectId=${encodeURIComponent(id)}`);
    if (profileFor.current !== id) return;
    if (!res.ok) {
      if (clientView) console.error("brand-radar profile:", res.data.error);
      setProfileError(clientView ? CLIENT_LOAD_ERROR : res.data.error || "โหลดข้อมูลแบรนด์ไม่สำเร็จ");
      return;
    }
    setProfileError("");
    setProfile(res.data.profile ?? null);
    setAutoScan(res.data.auto?.on === true);
    setCompetitors(Array.isArray(res.data.competitors) ? res.data.competitors : []);
    setProfileLoaded(true);
  }, [clientView]);

  // Server-rendered list seeds the state: skip only the first mount fetch.
  const skipFirstProjectsFetch = useRef(initialProjects !== undefined);
  useEffect(() => {
    if (skipFirstProjectsFetch.current) { skipFirstProjectsFetch.current = false; return; }
    void loadProjects();
  }, [loadProjects]);

  // customer login: one project opens directly; with several, only a project the server listed counts
  const activeProjectId = !clientView
    ? projectId
    : !projectsLoaded || projectsDenied ? ""
    : projects.length === 1 ? projects[0].id
    : projects.some((p) => p.id === projectId) ? projectId : "";
  // tab data is cached in memory per project; a new project (or a new login view) starts empty
  const cacheScope = useRef("");
  if (cacheScope.current !== `${clientView ? "c" : "s"}:${activeProjectId}`) {
    cacheScope.current = `${clientView ? "c" : "s"}:${activeProjectId}`;
    clearRadarCache();
  }
  // a customer sees the four report tabs only; a hidden tab id falls back to overview
  // Opportunities is no longer a tab of its own: it sits at the bottom of Citation Analysis, old links follow it there.
  const wantedTab: TabId = tab === "opportunities" ? "citation-analysis" : tab;
  const activeTab: TabId = clientView && !CLIENT_TAB_IDS.includes(wantedTab) ? "overview" : wantedTab;
  // A shortcut on the report ("ควรดูต่อ") opens a tab already narrowed to one thing. Plain tab clicks clear it.
  const [focus, setFocus] = useState<TabFocusState | null>(null);
  const focusSeq = useRef(0);
  const goTab = useCallback((t: TabId, f?: TabFocus) => {
    if (clientView && !CLIENT_TAB_IDS.includes(t)) return;
    if (f?.provider) setProvider(f.provider);
    setFocus(f ? { ...f, tab: t, seq: ++focusSeq.current } : null);
    setTab(t);
  }, [clientView, setTab, setProvider]);

  useEffect(() => {
    setProfile(null);
    setAutoScan(false);
    setCompetitors([]);
    setProfileLoaded(false);
    setProfileError("");
    setDueRun(null);
    if (activeProjectId) void loadProfile(activeProjectId);
  }, [activeProjectId, loadProfile]);

  // scheduled scan: ask once per selected project (never for a customer login)
  useEffect(() => {
    if (clientView) return;
    if (!projectId || !profile || dueCheckedFor.current === projectId) return;
    dueCheckedFor.current = projectId;
    let cancelled = false;
    void (async () => {
      const res = await api<RunDueRes>("/api/brand-radar/runs/due", postJson({ projectId }));
      if (!cancelled && res.ok && res.data.run) setDueRun(res.data.run);
    })();
    return () => { cancelled = true; };
  }, [clientView, projectId, profile]);

  const onChanged = useCallback(() => {
    void loadProjects();
    if (activeProjectId) void loadProfile(activeProjectId);
    setRefreshKey((k) => k + 1);
  }, [loadProjects, loadProfile, activeProjectId]);

  // the open project was deleted in Settings: back to the brand list, with the list reloaded
  const onDeleted = useCallback(() => {
    setProjectId("");
    setTab("overview");
    void loadProjects();
    setRefreshKey((k) => k + 1);
  }, [setProjectId, setTab, loadProjects]);

  const onFilterChange = useCallback((patch: Partial<RadarFilters>) => {
    if (patch.from !== undefined) setFrom(patch.from);
    if (patch.to !== undefined) setTo(patch.to);
    if (patch.country !== undefined) setCountry(patch.country);
    if (patch.language !== undefined) setLanguage(patch.language);
    if (patch.provider !== undefined) setProvider(patch.provider);
  }, [setFrom, setTo, setCountry, setLanguage, setProvider]);

  const options = useMemo(
    () => projects.map((p) => ({
      value: p.id,
      label: p.clientName || p.name,
      hint: `${p.website || "-"} · ${p.activePrompts} prompts${p.manual ? " · เพิ่มเอง" : ""}`,
      keywords: `${p.name} ${p.clientName} ${p.website}`,
    })),
    [projects],
  );

  const select = (
    <SearchSelect
      value={projectId}
      onChange={(v) => { setProjectId(v); }}
      options={options}
      placeholder="เลือกลูกค้า…"
      ariaLabel="เลือกลูกค้า"
      loading={!projectsLoaded}
      error={projectsError}
      className="w-full min-w-[240px] sm:w-72"
    />
  );
  const newButton = (
    <Button type="button" variant="outline" className="shrink-0" onClick={() => setCreating(true)}>
      <Plus className="mr-1 h-4 w-4" />สร้างโปรเจกต์ใหม่
    </Button>
  );
  // Settings is a button in the page corner (same shape as Project Setting in Upload Article), not a tab.
  const settingsButton = (
    <button
      type="button"
      onClick={() => setTab("settings")}
      title="ตั้งค่า Brand Radar"
      aria-label="ตั้งค่า Brand Radar"
      aria-pressed={tab === "settings"}
      className={`flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-2 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy ${
        tab === "settings"
          ? "border-brand-blue/20 bg-brand-blue/10 text-brand-blue"
          : "border-gray-200 bg-white/80 text-gray-600 hover:bg-white hover:text-brand-navy"
      }`}
    >
      <Settings size={13} aria-hidden /> Settings
    </button>
  );
  const picker = <div className="flex flex-wrap items-center gap-2">{select}{newButton}{settingsButton}</div>;
  const newDialog = creating ? (
    <NewProjectDialog
      onClose={() => setCreating(false)}
      onCreated={async (id) => {
        await loadProjects();
        setCreating(false);
        setProjectId(id);
        setTab("settings");
      }}
    />
  ) : null;

  const selected = projects.find((p) => p.id === activeProjectId) ?? null;
  const pictures = Object.fromEntries(projects.map((p) => [p.id, { logo: p.logo, favicon: p.favicon }]));

  if (clientView) {
    if (!projectsLoaded) {
      return <div className="flex min-h-[40vh] items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" aria-label="กำลังโหลด" /></div>;
    }
    if (projectsDenied || (projects.length === 0 && !projectsError)) {
      return (
        <div className="mx-auto flex min-h-[50vh] w-full max-w-md items-center justify-center px-4 text-center text-sm text-gray-600">
          บัญชีนี้ยังไม่ได้รับสิทธิ์ดูรายงาน Brand Radar กรุณาติดต่อทีมงาน
        </div>
      );
    }
    if (projects.length === 0) {
      return (
        <div role="alert" className="mx-auto flex min-h-[40vh] w-full max-w-md flex-col items-center justify-center gap-3 px-4 text-center text-sm text-red-700">
          {projectsError}
          <Button size="sm" variant="outline" onClick={() => void loadProjects()}>ลองใหม่</Button>
        </div>
      );
    }
  }

  if (!activeProjectId) {
    if (clientView) {
      return <BrandList clientView onOpen={(id) => { setProjectId(id); }} refreshKey={refreshKey} pictures={pictures} />;
    }
    return (
      <>
        <BrandList
          onOpen={(id) => { setProjectId(id); }}
          onCreate={() => setCreating(true)}
          picker={select}
          refreshKey={refreshKey}
          pictures={pictures}
        />
        {newDialog}
      </>
    );
  }

  const tabProps: TabProps = {
    projectId: activeProjectId,
    filters,
    refreshKey,
    profile,
    onGoTab: goTab,
    focus,
    onChanged,
    brandLogo: selected ? { logo: selected.logo, favicon: selected.favicon } : undefined,
    clientView,
  };
  const singleClientProject = clientView && projects.length === 1;

  // The report tabs show the report only: setup and the scan controls live in the Settings tab.
  const onSettings = activeTab === "settings";
  const noActivePrompts = !!profile && !!selected && selected.activePrompts === 0;

  return (
    <div className="mx-auto w-full max-w-7xl">
      {singleClientProject ? null : (
        <button
          type="button"
          onClick={() => { setProjectId(""); setTab("overview"); }}
          className="mb-3 inline-flex min-h-[36px] items-center gap-1.5 rounded-lg text-sm font-medium text-gray-600 hover:text-brand-navy focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy"
        >
          <ArrowLeft className="h-4 w-4" />แบรนด์ทั้งหมด
        </button>
      )}
      <PageHeader
        title="Brand Radar"
        subtitle={clientView ? "รายงานการมองเห็นแบรนด์ของคุณในคำตอบของ AI" : "ติดตามว่า AI พูดถึงและอ้างอิงแบรนด์ของลูกค้าบ่อยแค่ไหน"}
        actions={clientView ? undefined : picker}
      />

      {profileError && (
        <div role="alert" className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {profileError}
          <Button size="sm" variant="outline" className="ml-3" onClick={() => void loadProfile(activeProjectId)}>ลองใหม่</Button>
        </div>
      )}

      <UnderlineTabs<TabId>
        className="mb-4"
        value={activeTab}
        onChange={(t) => goTab(t)}
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "responses", label: "AI Responses" },
          { id: "prompts", label: "AI Prompts" },
          { id: "competitors", label: "Competitors" },
          { id: "citations", label: "Citations & Sources" },
          { id: "citation-analysis", label: "Citation Analysis" },
        ].filter((t) => !clientView || CLIENT_TAB_IDS.includes(t.id as TabId)) as Array<{ id: TabId; label: string }>}
      />

      {/* Always mounted: it drives the scan loop. It is visible in Settings only. */}
      {clientView ? null : (
        <RunPanel
          projectId={projectId}
          profile={profile}
          refreshKey={refreshKey}
          dueRun={dueRun}
          onProgress={() => setRefreshKey((k) => k + 1)}
          compact={!onSettings}
          autoScan={autoScan}
        />
      )}

      {onSettings ? null : <FilterBar filters={filters} onChange={onFilterChange} onRefresh={() => setRefreshKey((k) => k + 1)} />}

      {clientView && profileLoaded && !profile && (
        <div className="mb-4 rounded-2xl border border-gray-200 bg-white/70 p-3 text-sm text-gray-600">ยังไม่มีข้อมูลรายงานสำหรับแบรนด์นี้</div>
      )}

      {!clientView && !onSettings && profileLoaded && !profile && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <span>ยังไม่ได้ตั้งค่าแบรนด์ของลูกค้ารายนี้</span>
          <Button size="sm" onClick={() => setTab("settings")}>ไปตั้งค่าแบรนด์</Button>
        </div>
      )}

      {!clientView && !onSettings && activeTab !== "prompts" && noActivePrompts && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <span>ยังไม่มี prompt ที่ใช้งาน จึงยังสแกนไม่ได้</span>
          <Button size="sm" onClick={() => setTab("prompts")}>ไปที่ AI Prompts</Button>
        </div>
      )}

      {activeTab === "overview" && <OverviewTab {...tabProps} brands={projects.map((p) => ({ id: p.id, name: p.clientName || p.name, logo: p.logo, favicon: p.favicon }))} onSwitchBrand={(id) => setProjectId(id)} />}
      {activeTab === "responses" && <AnswersTab {...tabProps} />}
      {!clientView && activeTab === "prompts" && <PromptsTab {...tabProps} />}
      {activeTab === "competitors" && <CompetitorsTab {...tabProps} />}
      {activeTab === "citations" && <CitationsTab {...tabProps} />}
      {activeTab === "citation-analysis" && <CitationAnalysisTab {...tabProps} />}
      {!clientView && activeTab === "citation-analysis" && profile && (
        <section id="brand-radar-opportunities" aria-labelledby="brand-radar-opportunities-title" className="mt-8 space-y-3 border-t border-gray-200 pt-6">
          <div>
            <h2 id="brand-radar-opportunities-title" className="text-lg font-semibold text-brand-navy">Opportunities</h2>
            <p className="text-sm text-gray-500">โอกาสที่ควรลงมือทำ คำนวณจากคำตอบ AI ที่เก็บได้</p>
          </div>
          <OpportunitiesTab {...tabProps} />
        </section>
      )}
      {!clientView && activeTab === "settings" && <SettingsTab {...tabProps} onDeleted={onDeleted} />}
      {clientView ? null : newDialog}
    </div>
  );
}
