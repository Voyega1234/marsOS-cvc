"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Radar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, Panel, UnderlineTabs } from "@/components/ds";
import SearchSelect from "@/components/backlink-management/SearchSelect";
import { useUrlState } from "@/hooks/use-url-state";
import {
  PROVIDER_KEYS,
  type CompetitorDTO, type ProfileDTO, type ProfileRes, type ProjectOptDTO, type ProjectsRes,
  type RadarFilters, type RunDTO, type RunDueRes,
} from "@/lib/brand-radar/types";
import { api, defaultFilters, fmtDate, postJson, TAB_IDS, type TabId, type TabProps } from "./shared";
import FilterBar from "./FilterBar";
import RunPanel from "./RunPanel";
import OverviewTab from "./OverviewTab";
import SettingsTab from "./SettingsTab";
import PromptsTab from "./PromptsTab";
import CompetitorsTab from "./CompetitorsTab";
import CitationsTab from "./CitationsTab";
import OpportunitiesTab from "./OpportunitiesTab";

const PROVIDER_FILTERS = ["all", ...PROVIDER_KEYS] as const;
const SCHEDULE_TH: Record<string, string> = { manual: "Manual", daily: "รายวัน", weekly: "รายสัปดาห์", monthly: "รายเดือน" };

export default function BrandRadarClient({ userRole }: { userRole: string }) {
  void userRole;
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

  const [projects, setProjects] = useState<ProjectOptDTO[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [projectsError, setProjectsError] = useState("");
  const [profile, setProfile] = useState<ProfileDTO | null>(null);
  const [, setCompetitors] = useState<CompetitorDTO[]>([]);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [dueRun, setDueRun] = useState<RunDTO | null>(null);
  const dueCheckedFor = useRef("");

  const loadProjects = useCallback(async () => {
    const res = await api<ProjectsRes>("/api/brand-radar/projects");
    if (!res.ok) setProjectsError(res.data.error || "โหลดรายชื่อลูกค้าไม่สำเร็จ");
    else setProjectsError("");
    setProjects(res.ok && Array.isArray(res.data.projects) ? res.data.projects : []);
    setProjectsLoaded(true);
  }, []);

  const loadProfile = useCallback(async (id: string) => {
    const res = await api<ProfileRes>(`/api/brand-radar/profile?projectId=${encodeURIComponent(id)}`);
    if (!res.ok) {
      setProfileError(res.data.error || "โหลดข้อมูลแบรนด์ไม่สำเร็จ");
      return;
    }
    setProfileError("");
    setProfile(res.data.profile ?? null);
    setCompetitors(Array.isArray(res.data.competitors) ? res.data.competitors : []);
    setProfileLoaded(true);
  }, []);

  useEffect(() => { void loadProjects(); }, [loadProjects]);

  useEffect(() => {
    setProfile(null);
    setCompetitors([]);
    setProfileLoaded(false);
    setProfileError("");
    setDueRun(null);
    if (projectId) void loadProfile(projectId);
  }, [projectId, loadProfile]);

  // scheduled scan: ask once per selected project
  useEffect(() => {
    if (!projectId || !profile || dueCheckedFor.current === projectId) return;
    dueCheckedFor.current = projectId;
    let cancelled = false;
    void (async () => {
      const res = await api<RunDueRes>("/api/brand-radar/runs/due", postJson({ projectId }));
      if (!cancelled && res.ok && res.data.run) setDueRun(res.data.run);
    })();
    return () => { cancelled = true; };
  }, [projectId, profile]);

  const onChanged = useCallback(() => {
    void loadProjects();
    if (projectId) void loadProfile(projectId);
    setRefreshKey((k) => k + 1);
  }, [loadProjects, loadProfile, projectId]);

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
      hint: `${p.website || "-"} · ${p.activePrompts} prompts`,
      keywords: `${p.name} ${p.clientName} ${p.website}`,
    })),
    [projects],
  );

  const picker = (
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

  const selected = projects.find((p) => p.id === projectId) ?? null;

  if (!projectId) {
    return (
      <div className="mx-auto w-full max-w-7xl">
        <PageHeader title="Brand Radar" subtitle="ติดตามว่า AI พูดถึงและอ้างอิงแบรนด์ของลูกค้าบ่อยแค่ไหน" actions={picker} />
        {projectsError && (
          <div role="alert" className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{projectsError}</div>
        )}
        <Panel>
          <EmptyState
            icon={<Radar className="h-6 w-6" />}
            title="เลือกลูกค้าที่จะทำ AI citation test"
            description="เลือกลูกค้า → ตั้งค่าแบรนด์ → เลือก Prompt → Monitor รายสัปดาห์ → อ่านข้อมูลการอ้างอิง"
            action={<div className="w-72 max-w-full">{picker}</div>}
          />
        </Panel>
      </div>
    );
  }

  const tabProps: TabProps = {
    projectId,
    filters,
    refreshKey,
    profile,
    onGoTab: setTab,
    onChanged,
  };

  const activePrompts = selected?.activePrompts;
  const steps: Array<{ n: number; title: string; done: boolean; body: React.ReactNode }> = [
    { n: 1, title: "เลือกลูกค้า", done: true, body: <span className="truncate">{selected ? selected.clientName || selected.name : "-"}</span> },
    {
      n: 2, title: "ตั้งค่าแบรนด์", done: !!profile,
      body: profile ? <span className="truncate">{profile.brandName}</span> : (
        <button type="button" className="text-brand-blue hover:underline" onClick={() => setTab("settings")}>ไปที่ Settings</button>
      ),
    },
    {
      n: 3, title: "เลือก Prompt", done: (activePrompts ?? 0) > 0,
      body: (
        <button type="button" className="text-brand-blue hover:underline" onClick={() => setTab("prompts")}>
          {activePrompts === undefined ? "ไปที่ AI Prompts" : `${activePrompts} prompts ที่ใช้งาน`}
        </button>
      ),
    },
    {
      n: 4, title: "Monitor", done: !!profile && profile.schedule !== "manual",
      body: profile && profile.schedule !== "manual"
        ? <span className="truncate">{SCHEDULE_TH[profile.schedule]} · ถัดไป {fmtDate(profile.nextRunAt)}</span>
        : <span className="text-gray-500">ยังไม่ได้ตั้ง</span>,
    },
  ];

  return (
    <div className="mx-auto w-full max-w-7xl">
      <PageHeader title="Brand Radar" subtitle="ติดตามว่า AI พูดถึงและอ้างอิงแบรนด์ของลูกค้าบ่อยแค่ไหน" actions={picker} />

      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s) => (
          <div key={s.n} className="flex min-w-0 items-center gap-3 rounded-2xl border border-white/80 bg-white/70 px-3 py-2.5 text-sm shadow-sm">
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${s.done ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
              {s.done ? <Check className="h-4 w-4" /> : s.n}
            </span>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-brand-navy">{s.title}</div>
              <div className="flex min-w-0 text-xs text-gray-600">{s.body}</div>
            </div>
          </div>
        ))}
      </div>

      {profileError && (
        <div role="alert" className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {profileError}
          <Button size="sm" variant="outline" className="ml-3" onClick={() => void loadProfile(projectId)}>ลองใหม่</Button>
        </div>
      )}

      <RunPanel projectId={projectId} profile={profile} refreshKey={refreshKey} dueRun={dueRun} onProgress={() => setRefreshKey((k) => k + 1)} />

      <FilterBar filters={filters} onChange={onFilterChange} onRefresh={() => setRefreshKey((k) => k + 1)} />

      {profileLoaded && !profile && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <span>ยังไม่ได้ตั้งค่าแบรนด์ของลูกค้ารายนี้</span>
          <Button size="sm" onClick={() => setTab("settings")}>ไปตั้งค่าแบรนด์</Button>
        </div>
      )}

      <UnderlineTabs<TabId>
        className="mb-4"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "prompts", label: "AI Prompts" },
          { id: "competitors", label: "Competitors" },
          { id: "citations", label: "Citations & Sources" },
          { id: "opportunities", label: "Opportunities" },
          { id: "settings", label: "Settings" },
        ]}
      />

      {tab === "overview" && <OverviewTab {...tabProps} />}
      {tab === "prompts" && <PromptsTab {...tabProps} />}
      {tab === "competitors" && <CompetitorsTab {...tabProps} />}
      {tab === "citations" && <CitationsTab {...tabProps} />}
      {tab === "opportunities" && <OpportunitiesTab {...tabProps} />}
      {tab === "settings" && <SettingsTab {...tabProps} />}
    </div>
  );
}
