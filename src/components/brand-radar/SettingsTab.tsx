"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { BarChart, Chip, EmptyState, MeterBar, Panel, Segmented } from "@/components/ds";
import { LANGUAGE_BOTH, PROFILE_LANGUAGES } from "@/lib/brand-radar/language";
import {
  COUNTRIES, DEFAULT_SAMPLES, LIMITS, PROMPT_SOURCES, PROMPT_SOURCE_LABEL, PROVIDER_KEYS, SAMPLE_OPTIONS, SCHEDULE_LIMITS,
  costPerCall, formatSchedule, isManualProjectId, parseSchedule,
  type AutoScanDTO, type CompetitorDTO, type ProfileInput, type ProfileRes, type PromptSource, type ProviderKey,
  type ProviderStatusDTO, type ProvidersRes, type Schedule, type ScheduleKind, type ScheduleSpec, type UsageDTO,
} from "@/lib/brand-radar/types";
import BrandNameSuggestions from "./BrandNameSuggestions";
import { PlatformChooser } from "./PlatformPicker";
import { ProviderLogo } from "./ProviderLogo";
import { SampleSizeTest } from "./SampleSizeTest";
import ClientAvatar from "@/components/upload-article/ClientAvatar";
import { ColumnHelp } from "./ColumnHelp";
import { brandTermsOf } from "@/lib/brand-radar/highlight";
import { api, fmtDateTime, fmtNum, fmtUsd, fmtUsdPerCall, methodLabel, monthLabelTh, postJson, scheduleLabel, WEEKDAYS_TH, type TabProps } from "./shared";

const inputCls =
  "h-10 w-full rounded-xl border border-input bg-white/90 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";
const labelCls = "mb-1 block text-xs font-medium text-gray-600";
const helpCls = "mt-1 text-xs text-gray-500";

const SCHEDULE_MODES: { value: ScheduleKind; label: string }[] = [
  { value: "manual", label: "Manual" },
  { value: "daily", label: "ทุกวัน" },
  { value: "weekly", label: "ทุกสัปดาห์" },
  { value: "monthly", label: "ทุกเดือน" },
  { value: "interval", label: "ทุก N วัน" },
  { value: "weekdays", label: "เลือกวัน" },
];
/** Short weekday labels in ISO order (index 0 = Monday) */
const WEEKDAY_SHORT = ["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"];
const SCHEDULE_NOTE: Record<ScheduleKind, string> = {
  manual: "ไม่เริ่มสแกนเอง — กดสแกนเองเมื่อต้องการ",
  daily: "สแกนวันละ 1 ครั้ง",
  weekly: "สแกนสัปดาห์ละ 1 ครั้ง (รอบใหม่เริ่มวันจันทร์)",
  monthly: "สแกนเดือนละ 1 ครั้ง (รอบใหม่เริ่มวันที่ 1)",
  interval: "นับจากวันที่สแกนจริงครั้งล่าสุด",
  weekdays: "สแกนเฉพาะวันที่เลือก เริ่มจากวันที่เลือกวันถัดไป (ไม่รวมวันนี้)",
};

// autoScan is the "สแกนอัตโนมัติตามรอบ" switch. It is saved with the profile but kept outside it on the server.
type FormState = ProfileInput & { budget: string; autoScan?: boolean };

/** The stored value the three local choices describe */
function scheduleFrom(mode: ScheduleKind, every: number, picked: number[]): Schedule {
  const spec: ScheduleSpec = mode === "interval" ? { kind: "interval", days: every } : mode === "weekdays" ? { kind: "weekdays", days: picked } : { kind: mode };
  return formatSchedule(spec);
}

/**
 * Scan frequency: fixed presets, every N days, or chosen weekdays.
 * The form keeps the one canonical stored value (types.ts). The mode is local state because two choices can
 * describe the same value (all 7 weekdays = every day) and the control must not jump away while staff are ticking days.
 */
function ScheduleField({ value, onChange }: { value: Schedule; onChange: (v: Schedule) => void }) {
  const [mode, setMode] = useState<ScheduleKind>("weekly");
  const [every, setEvery] = useState(3);
  const [everyTxt, setEveryTxt] = useState("3");
  const [picked, setPicked] = useState<number[]>([1]);

  // The value changed from outside (first load, discard): take the local choices from it
  // (compared in canonical form, so a value this version cannot read settles on Manual instead of looping)
  const spec = parseSchedule(value) ?? { kind: "manual" as const };
  if (scheduleFrom(mode, every, picked) !== formatSchedule(spec)) {
    setMode(spec.kind);
    if (spec.kind === "interval") { setEvery(spec.days); setEveryTxt(String(spec.days)); }
    if (spec.kind === "weekdays") setPicked(spec.days);
  }

  const { intervalMin, intervalMax } = SCHEDULE_LIMITS;
  const everyNum = Number(everyTxt);
  const everyBad = !/^\d+$/.test(everyTxt.trim()) || everyNum < intervalMin || everyNum > intervalMax;

  function chooseMode(m: ScheduleKind) {
    setMode(m);
    setEveryTxt(String(every));
    onChange(scheduleFrom(m, every, picked));
  }
  function typeEvery(txt: string) {
    setEveryTxt(txt);
    const n = Number(txt);
    if (!/^\d+$/.test(txt.trim()) || n < intervalMin || n > intervalMax) return;
    setEvery(n);
    onChange(scheduleFrom("interval", n, picked));
  }
  function toggleDay(d: number) {
    const next = picked.includes(d) ? picked.filter((x) => x !== d) : [...picked, d].sort((a, b) => a - b);
    if (!next.length) return; // at least one day stays chosen
    setPicked(next);
    onChange(scheduleFrom("weekdays", every, next));
  }

  return (
    <div className="space-y-2">
      <Segmented<ScheduleKind> ariaLabel="ความถี่ในการสแกน" value={mode} onChange={chooseMode} options={SCHEDULE_MODES} />
      {mode === "interval" && (
        <div>
          <label className="flex flex-wrap items-center gap-2 text-sm text-gray-700">
            สแกนทุก
            <input type="number" inputMode="numeric" min={intervalMin} max={intervalMax} step={1} aria-invalid={everyBad}
              className={`${inputCls} !w-24`} value={everyTxt}
              onChange={(e) => typeEvery(e.target.value)} onBlur={() => setEveryTxt(String(every))} />
            วัน
          </label>
          {everyBad && <p role="alert" className="mt-1 text-xs text-red-600">กรอกตัวเลข {intervalMin}–{intervalMax} วัน</p>}
        </div>
      )}
      {mode === "weekdays" && (
        <div role="group" aria-label="วันที่สแกน" className="flex flex-wrap gap-1.5">
          {WEEKDAY_SHORT.map((label, i) => {
            const d = i + 1;
            const on = picked.includes(d);
            const last = on && picked.length === 1;
            return (
              <button key={d} type="button" aria-pressed={on} aria-label={`วัน${WEEKDAYS_TH[i]}`} title={last ? "ต้องเลือกอย่างน้อย 1 วัน" : `วัน${WEEKDAYS_TH[i]}`}
                onClick={() => toggleDay(d)}
                className={`h-10 min-w-11 rounded-xl border px-3 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy ${
                  on ? "border-brand-navy bg-brand-navy text-white" : "border-gray-200 bg-white/90 text-gray-700 hover:border-gray-300"
                }`}>
                {label}
              </button>
            );
          })}
        </div>
      )}
      <p className={helpCls}>
        <span className="font-medium text-gray-700">{mode === "manual" ? "Manual" : `สแกน${scheduleLabel(value)}`}</span> · {SCHEDULE_NOTE[mode]} · เวลาไทย
      </p>
    </div>
  );
}

/** Numbered section card with a one-line reason why the step matters */
function Section({ n, id, title, why, optional, children }: { n: number; id: string; title: string; why: string; optional?: boolean; children: ReactNode }) {
  return (
    <Panel
      className="scroll-mt-20"
      title={
        <span id={id} className="flex items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-navy text-xs text-white">{n}</span>
          {title}
          {optional && <Chip tone="muted">ไม่บังคับ</Chip>}
        </span>
      }
      subtitle={why}
    >
      <div className="mt-4">{children}</div>
    </Panel>
  );
}

function Field({ label, help, children }: { label: string; help?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <label className={labelCls}>{label}</label>
      {children}
      {help && <p className={helpCls}>{help}</p>}
    </div>
  );
}

function hostOf(url: string): string {
  const t = url.trim();
  if (!t) return "";
  try {
    return new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`).hostname.replace(/^www\./, "");
  } catch {
    return t.replace(/^https?:\/\//i, "").replace(/^www\./, "").split("/")[0];
  }
}

/**
 * Chip input for a list of short texts. With `primary`, the first chip is the main entry (it carries a badge)
 * and clicking another chip moves it to the front.
 */
export function TagInput({ value, onChange, placeholder, max = LIMITS.aliasesMax, primary = false }: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  max?: number;
  primary?: boolean;
}) {
  const [draft, setDraft] = useState("");
  function commit(raw: string) {
    const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) { setDraft(""); return; }
    const next = [...value];
    for (const p of parts) {
      if (next.length >= max) break;
      if (!next.some((x) => x.toLowerCase() === p.toLowerCase())) next.push(p);
    }
    onChange(next);
    setDraft("");
  }
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-xl border border-input bg-white/90 px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring">
      {value.map((t, i) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-full bg-brand-mist px-2.5 py-1 text-xs text-brand-navy">
          {primary && i === 0 ? (
            <>
              <span className="rounded-full bg-brand-navy px-1.5 py-px text-[10px] font-medium text-white">ชื่อหลัก</span>
              {t}
            </>
          ) : primary ? (
            <button type="button" title="กดเพื่อตั้งเป็นชื่อหลัก" onClick={() => onChange([t, ...value.filter((x) => x !== t)])}>{t}</button>
          ) : t}
          <button type="button" aria-label={`ลบ ${t}`} onClick={() => onChange(value.filter((x) => x !== t))}>
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      {value.length < max && (
        <input
          value={draft}
          placeholder={value.length === 0 ? placeholder : ""}
          className="min-w-[120px] flex-1 bg-transparent px-1 text-sm outline-none"
          onChange={(e) => {
            const v = e.target.value;
            if (v.includes(",")) commit(v); else setDraft(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(draft); }
            else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={() => commit(draft)}
        />
      )}
    </div>
  );
}

interface CompForm { id: string; name: string; aliases: string[]; domains: string[] }
const emptyComp: CompForm = { id: "", name: "", aliases: [], domains: [] };

export default function SettingsTab({ projectId, refreshKey, onChanged, clientView, brandLogo, onDeleted }: TabProps & { onDeleted?: () => void }) {
  // logo shown in the uploader: follows the saved logo, ClientAvatar updates it optimistically
  const [logoDraft, setLogoDraft] = useState<string | null>(brandLogo?.logo ?? null);
  useEffect(() => { setLogoDraft(brandLogo?.logo ?? null); }, [brandLogo?.logo, projectId]);
  async function saveLogo(logo: string | null): Promise<void> {
    const res = await api<{ logo: string | null }>("/api/brand-radar/logo", postJson({ projectId, logo }, "PUT"));
    if (!res.ok) throw new Error(res.data.error || `HTTP ${res.status}`);
    onChanged();
  }
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [hasProfile, setHasProfile] = useState(false);
  const [form, setForm] = useState<FormState>({ budget: "" });
  const [baseline, setBaseline] = useState<FormState>({ budget: "" });
  const [nextRunAt, setNextRunAt] = useState<string | null>(null);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  // state of the scheduled server job, as last reported by the server (not part of the form)
  const [auto, setAuto] = useState<AutoScanDTO | null>(null);
  const [competitors, setCompetitors] = useState<CompetitorDTO[]>([]);
  const [providers, setProviders] = useState<ProviderStatusDTO[]>([]);
  const [unsupported, setUnsupported] = useState<ProvidersRes["unsupported"]>([]);
  const [usage, setUsage] = useState<UsageDTO | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [saveError, setSaveError] = useState("");
  const [testing, setTesting] = useState<ProviderKey | "">("");
  const [testError, setTestError] = useState("");
  const [statusOpen, setStatusOpen] = useState<boolean | null>(null);
  const [advOpen, setAdvOpen] = useState(false);
  const [comp, setComp] = useState<CompForm | null>(null);
  const [compBusy, setCompBusy] = useState(false);
  const [compError, setCompError] = useState("");
  // delete project: the confirmation box, what was typed into it, and the request state
  const [delOpen, setDelOpen] = useState(false);
  const [delText, setDelText] = useState("");
  const [delBusy, setDelBusy] = useState(false);
  const [delError, setDelError] = useState("");
  const delProjectRef = useRef(projectId);
  delProjectRef.current = projectId;

  // bumps on every load / project switch so a late response from an older request is ignored
  const reqRef = useRef(0);

  // project switch: drop everything that belongs to the previous project (declared before the load effect)
  useEffect(() => {
    reqRef.current += 1;
    setLoading(true);
    setLoadError("");
    setHasProfile(false);
    setForm({ budget: "" });
    setBaseline({ budget: "" });
    setNextRunAt(null);
    setLastRunAt(null);
    setAuto(null);
    setCompetitors([]);
    setProviders([]);
    setUnsupported([]);
    setUsage(null);
    setSaveMsg("");
    setSaveError("");
    setTestError("");
    setComp(null);
    setDelOpen(false);
    setDelText("");
    setDelBusy(false);
    setDelError("");
    setCompError("");
  }, [projectId]);

  const load = useCallback(async () => {
    const reqId = ++reqRef.current;
    setLoading(true);
    setLoadError("");
    const [pr, pv, us] = await Promise.all([
      api<ProfileRes>(`/api/brand-radar/profile?projectId=${encodeURIComponent(projectId)}`),
      api<ProvidersRes>(`/api/brand-radar/providers?projectId=${encodeURIComponent(projectId)}`),
      api<UsageDTO>(`/api/brand-radar/usage?projectId=${encodeURIComponent(projectId)}`),
    ]);
    if (reqId !== reqRef.current) return;
    if (!pr.ok) { setLoadError(pr.data.error || "โหลดการตั้งค่าไม่สำเร็จ"); setLoading(false); return; }
    const profile = pr.data.profile;
    const proj = pr.data.project;
    setHasProfile(!!profile);
    setCompetitors(Array.isArray(pr.data.competitors) ? pr.data.competitors : []);
    setAuto(pr.data.auto ?? null);
    const autoScan = pr.data.auto?.on === true;
    let loaded: FormState;
    if (profile) {
      loaded = {
        brandName: profile.brandName, aliases: profile.aliases, ambiguousAliases: profile.ambiguousAliases,
        contextTerms: profile.contextTerms, primaryDomain: profile.primaryDomain, ownedDomains: profile.ownedDomains,
        country: profile.country, language: profile.language, industry: profile.industry, products: profile.products,
        providers: profile.providers, promptSources: profile.promptSources, schedule: profile.schedule,
        maxPromptsPerRun: profile.maxPromptsPerRun,
        samplesPerPrompt: profile.samplesPerPrompt,
        budget: profile.monthlyBudgetUsd === null ? "" : String(profile.monthlyBudgetUsd),
        autoScan,
      };
      setNextRunAt(profile.nextRunAt);
      setLastRunAt(profile.lastRunAt);
    } else {
      loaded = {
        brandName: proj.clientName || proj.name, aliases: [], ambiguousAliases: [], contextTerms: [],
        primaryDomain: hostOf(proj.website), ownedDomains: [], country: "TH",
        language: proj.language === "en" ? "en" : proj.language === LANGUAGE_BOTH ? LANGUAGE_BOTH : "th", industry: proj.industry || "", products: [],
        // same default as the server (DEFAULT_PROVIDERS): every platform on, staff switch off what they don't want
        providers: [...PROVIDER_KEYS], promptSources: ["manual"], schedule: "weekly", maxPromptsPerRun: 50, samplesPerPrompt: DEFAULT_SAMPLES, budget: "",
        autoScan,
      };
      setNextRunAt(null);
      setLastRunAt(null);
    }
    setForm(loaded);
    setBaseline(loaded);
    if (pv.ok) { setProviders(pv.data.providers ?? []); setUnsupported(pv.data.unsupported ?? []); }
    else { setProviders([]); setUnsupported([]); }
    setUsage(us.ok ? (us.data as UsageDTO) : null);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const patch = (p: Partial<FormState>) => { setForm((f) => ({ ...f, ...p })); setSaveMsg(""); };
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);

  function discard() {
    setForm(baseline);
    setSaveError(""); setSaveMsg("");
  }

  async function save() {
    if (loading || loadError) return;
    setSaveError(""); setSaveMsg("");
    if (!form.brandName?.trim()) { setSaveError("กรุณากรอกชื่อแบรนด์"); return; }
    if (!form.primaryDomain?.trim()) { setSaveError("กรุณากรอกโดเมนหลักของแบรนด์"); return; }
    const budgetTxt = form.budget.trim();
    const budget = budgetTxt === "" ? null : Number(budgetTxt);
    if (budget !== null && (!Number.isFinite(budget) || budget < 0)) { setSaveError("งบประมาณต่อเดือนต้องเป็นตัวเลขที่ไม่ติดลบ"); return; }
    const { budget: _b, autoScan: wantAuto, ...rest } = form;
    void _b;
    // the switch is sent only when it was changed here, so saving other fields never undoes a change made by a colleague
    const autoPatch = !!wantAuto !== !!baseline.autoScan ? { autoScan: !!wantAuto } : {};
    setSaving(true);
    const res = await api<Pick<ProfileRes, "profile" | "auto">>("/api/brand-radar/profile", postJson({
      projectId, ...rest, ...autoPatch, brandName: rest.brandName?.trim(), primaryDomain: hostOf(rest.primaryDomain ?? ""), monthlyBudgetUsd: budget,
    }, "PUT"));
    setSaving(false);
    if (!res.ok) { setSaveError(res.data.error || "บันทึกไม่สำเร็จ"); return; }
    // what the server now holds wins (a colleague may have flipped the switch in the meantime)
    const saved: FormState = res.data.auto ? { ...form, autoScan: res.data.auto.on } : form;
    if (res.data.auto) { setAuto(res.data.auto); setForm(saved); }
    setBaseline(saved);
    setHasProfile(true);
    // the server recalculates the next scan when the schedule changes
    if (res.data.profile) { setNextRunAt(res.data.profile.nextRunAt); setLastRunAt(res.data.profile.lastRunAt); }
    setSaveMsg("บันทึกแล้ว");
    onChanged();
  }

  async function testProvider(key: ProviderKey) {
    if (!window.confirm("การทดสอบจะเรียก AI จริง 1 ครั้งและมีค่าใช้จ่ายจริง ต้องการทดสอบหรือไม่?")) return;
    setTesting(key); setTestError("");
    const res = await api<{ provider: ProviderStatusDTO }>("/api/brand-radar/providers/test", postJson({ projectId, provider: key }));
    setTesting("");
    if (!res.ok || !res.data.provider) { setTestError(res.data.error || "ทดสอบไม่สำเร็จ"); return; }
    const updated = res.data.provider;
    setProviders((ps) => ps.map((p) => (p.key === key ? { ...updated, enabled: p.enabled } : p)));
  }

  function toggleSource(s: PromptSource, on: boolean) {
    const cur = form.promptSources ?? [];
    patch({ promptSources: on ? [...cur.filter((k) => k !== s), s] : cur.filter((k) => k !== s) });
  }

  async function saveComp() {
    if (!comp) return;
    if (!comp.name.trim()) { setCompError("กรุณากรอกชื่อคู่แข่ง"); return; }
    setCompBusy(true); setCompError("");
    const body = { projectId, name: comp.name.trim(), aliases: comp.aliases, domains: comp.domains.map(hostOf).filter(Boolean) };
    const res = comp.id
      ? await api<{ competitor: CompetitorDTO }>(`/api/brand-radar/competitors/${comp.id}`, postJson(body, "PATCH"))
      : await api<{ competitor: CompetitorDTO }>("/api/brand-radar/competitors", postJson(body));
    setCompBusy(false);
    if (!res.ok || !res.data.competitor) { setCompError(res.data.error || "บันทึกคู่แข่งไม่สำเร็จ"); return; }
    const c = res.data.competitor;
    setCompetitors((cs) => (comp.id ? cs.map((x) => (x.id === c.id ? c : x)) : [...cs, c]));
    setComp(null);
    onChanged();
  }

  async function toggleComp(c: CompetitorDTO) {
    const status = c.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    const res = await api<{ competitor: CompetitorDTO }>(`/api/brand-radar/competitors/${c.id}`, postJson({ projectId, status }, "PATCH"));
    if (!res.ok || !res.data.competitor) { setCompError(res.data.error || "เปลี่ยนสถานะไม่สำเร็จ"); return; }
    setCompetitors((cs) => cs.map((x) => (x.id === c.id ? res.data.competitor : x)));
    onChanged();
  }

  async function deleteComp(c: CompetitorDTO) {
    if (!window.confirm(`ลบคู่แข่ง "${c.name}" ? ข้อมูลที่เคยตรวจพบของคู่แข่งนี้จะไม่ถูกนับอีก`)) return;
    const res = await api(`/api/brand-radar/competitors/${c.id}?projectId=${encodeURIComponent(projectId)}`, { method: "DELETE" });
    if (!res.ok) { setCompError(res.data.error || "ลบไม่สำเร็จ"); return; }
    setCompetitors((cs) => cs.filter((x) => x.id !== c.id));
    onChanged();
  }

  // The saved brand name must be typed before the delete button works (an unsaved edit of the name does not count).
  const delWord = (baseline.brandName ?? "").trim() || "ลบ";
  async function deleteProject() {
    if (delBusy || delText.trim() !== delWord) return;
    setDelBusy(true);
    setDelError("");
    const asked = projectId;
    const res = await api(`/api/brand-radar/projects?project=${encodeURIComponent(asked)}`, { method: "DELETE" });
    // The user moved to another project while the delete ran: its result must not touch the project now open.
    if (delProjectRef.current !== asked) return;
    setDelBusy(false);
    if (!res.ok) { setDelError(res.data.error || `ลบไม่สำเร็จ (HTTP ${res.status})`); return; }
    onDeleted?.();
  }

  // Hooks must run before the early returns below: the loading skeleton renders first, and a hook placed after it changes the hook count on the next render.
  const sampleBrandTerms = useMemo(() => brandTermsOf(form.brandName, form.aliases), [form.brandName, form.aliases]);

  if (loading && !hasProfile && !form.brandName) {
    return <div className="space-y-4" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-40 animate-pulse rounded-3xl bg-gray-100" />)}</div>;
  }
  if (loadError) {
    return (
      <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        {loadError}
        <Button size="sm" variant="outline" className="ml-3" onClick={() => void load()}>ลองใหม่</Button>
      </div>
    );
  }

  const selectedProviders = form.providers ?? [];
  const selectedSources = form.promptSources ?? [];
  const connected: Partial<Record<ProviderKey, boolean>> = {};
  for (const p of providers) connected[p.key] = p.connection !== "NOT_CONNECTED";
  const needsAttention = providers.some((p) => p.connection === "NOT_CONNECTED" || p.connection === "ERROR");
  const showStatus = statusOpen ?? needsAttention;
  const activeComps = competitors.filter((c) => c.status === "ACTIVE").length;
  const compFull = competitors.length >= LIMITS.competitorsMax;

  // The brand name and its other names are edited as one list: the first entry is the brand name, the rest are aliases.
  const brandNames = [form.brandName ?? "", ...(form.aliases ?? [])]
    .map((x) => x.trim())
    .filter((x, i, all) => !!x && all.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i);

  const steps = [
    { n: 1, label: "แบรนด์", done: !!form.brandName?.trim() && !!form.primaryDomain?.trim(), optional: false },
    { n: 2, label: "AI platform", done: selectedProviders.length >= 1, optional: false },
    { n: 3, label: "คู่แข่ง", done: activeComps >= 1, optional: true },
    { n: 4, label: "รอบสแกน", done: !!form.schedule, optional: false },
  ];
  const goStep = (n: number) => document.getElementById(`br-step-${n}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const barVisible = dirty || !hasProfile || saving || !!saveMsg || !!saveError;
  const usageFailed = usage ? usage.byProvider.reduce((s, p) => s + p.failed, 0) : 0;

  return (
    <div className="space-y-4">
      {!hasProfile && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
          ตั้งค่าแบรนด์ครั้งแรก — ระบบเติมข้อมูลจากโปรเจกต์ให้แล้ว ตรวจสอบแล้วกด “บันทึก”
        </div>
      )}

      <nav aria-label="ขั้นตอนการตั้งค่า" className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 md:grid-cols-4">
        {steps.map((s) => (
          <button key={s.n} type="button" onClick={() => goStep(s.n)}
            className="flex min-h-10 items-center gap-2 rounded-2xl border border-white/80 bg-white/70 px-3 py-2 text-left text-sm shadow-sm backdrop-blur-xl transition hover:border-gray-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy">
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${s.done ? "bg-emerald-600 text-white" : "bg-gray-200 text-gray-600"}`}>
              {s.done ? <Check className="h-3.5 w-3.5" aria-label="เสร็จแล้ว" /> : s.n}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-medium text-brand-navy">{s.n} {s.label}</span>
              {s.optional && <span className="block text-[11px] text-gray-500">ไม่บังคับ</span>}
            </span>
          </button>
        ))}
      </nav>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <Section n={1} id="br-step-1" title="แบรนด์ของเรา" why="ระบบใช้ชื่อและโดเมนนี้ตรวจว่า AI พูดถึงหรืออ้างอิงแบรนด์ของคุณหรือไม่">
            <div className="grid gap-4 md:grid-cols-2">
              {!clientView && (
                <div className="md:col-span-2 flex items-center gap-3">
                  <ClientAvatar
                    clientId={projectId}
                    name={form.brandName || "Brand"}
                    theme=""
                    logo={logoDraft}
                    onChange={setLogoDraft}
                    save={saveLogo}
                    size={48}
                  />
                  <div className="min-w-0">
                    <span className={labelCls}>โลโก้แบรนด์</span>
                    <p className={helpCls}>ใช้แสดงในหน้ารายงาน คลิกที่รูปเพื่ออัปโหลดหรือเปลี่ยน (ไม่ใส่ก็ได้ ระบบจะใช้ไอคอนของเว็บแทน)</p>
                  </div>
                </div>
              )}
              <div className="md:col-span-2">
                <Field
                  label="ชื่อแบรนด์ * (พิมพ์ได้หลายชื่อ)"
                  help={`ใส่ทุกแบบที่คนเรียกหรือสะกด เช่น Convert Cake, คอนเวิร์ท เค้ก, ConvertCake ถ้า AI ใช้ชื่อใดชื่อหนึ่งจะนับเป็นการพูดถึงแบรนด์ ชื่อแรกเป็นชื่อหลักที่แสดงในรายงาน กดที่ชื่ออื่นเพื่อตั้งเป็นชื่อหลัก สูงสุด ${LIMITS.aliasesMax + 1} ชื่อ`}
                >
                  <BrandNameSuggestions
                    names={brandNames}
                    website={form.primaryDomain ?? ""}
                    projectId={projectId}
                    max={LIMITS.aliasesMax + 1}
                    onAdd={(added) => {
                      const v = [...brandNames, ...added];
                      patch({ brandName: v[0] ?? "", aliases: v.slice(1) });
                    }}
                  >
                    <TagInput
                      primary
                      max={LIMITS.aliasesMax + 1}
                      value={brandNames}
                      onChange={(v) => patch({ brandName: v[0] ?? "", aliases: v.slice(1) })}
                      placeholder="พิมพ์ชื่อแบรนด์ แล้วกด Enter หรือ , เพื่อเพิ่มชื่อถัดไป"
                    />
                  </BrandNameSuggestions>
                </Field>
              </div>
              <Field label="เว็บไซต์หลัก (โดเมน) *" help="เช่น example.com ใส่ลิงก์เต็มได้ ระบบตัดให้เหลือแค่โดเมน">
                <input className={inputCls} placeholder="example.com" value={form.primaryDomain ?? ""} onChange={(e) => patch({ primaryDomain: e.target.value })} />
              </Field>
              <Field label="โดเมนอื่นของแบรนด์" help="เช่น shop.example.com ลิงก์ไปโดเมนเหล่านี้จะนับเป็น citation ของแบรนด์">
                <TagInput value={form.ownedDomains ?? []} onChange={(v) => patch({ ownedDomains: v.map(hostOf) })} placeholder="โดเมนอื่นของแบรนด์" />
              </Field>
            </div>
          </Section>

          <Section n={2} id="br-step-2" title="AI platform ที่ต้องการติดตาม" why="เลือก AI ที่ลูกค้าของคุณใช้ถามหาข้อมูล ระบบจะถามแต่ละตัวแล้วนับว่าพูดถึงแบรนด์กี่ครั้ง">
            <PlatformChooser value={selectedProviders} onChange={(v) => patch({ providers: v })} connected={connected} />
            <div className="mt-4 rounded-2xl border border-gray-100">
              <button type="button" aria-expanded={showStatus} onClick={() => setStatusOpen(!showStatus)}
                className="flex min-h-10 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium text-brand-navy">
                <span>สถานะการเชื่อมต่อ{needsAttention ? " (มี platform ที่ต้องตรวจสอบ)" : ""}</span>
                <ChevronDown className={`h-4 w-4 transition ${showStatus ? "rotate-180" : ""}`} aria-hidden="true" />
              </button>
              {showStatus && (
                <div className="border-t border-gray-100 p-3">
                  {testError && <div role="alert" className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{testError}</div>}
                  <ul className="space-y-3">
                    {providers.map((p) => {
                      const blocked = p.connection === "NOT_CONNECTED";
                      return (
                        <li key={p.key} className="rounded-2xl border border-gray-100 p-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <span className="block text-sm font-medium text-gray-800">{p.label}</span>
                              <span className="block text-xs text-gray-500">{p.note}</span>
                              {p.model && <span className="block text-xs text-gray-500">Model: {p.model}</span>}
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Chip tone={p.method === "observed_serp" || p.method === "observed_chat" ? "info" : "muted"}>{methodLabel(p.method)}</Chip>
                              {p.connection === "CONNECTED" && <Chip tone="ok" dot>Connected</Chip>}
                              {p.connection === "UNTESTED" && <Chip tone="info" dot>Untested</Chip>}
                              {p.connection === "NOT_CONNECTED" && <Chip tone="muted" dot>Not connected</Chip>}
                              {p.connection === "ERROR" && <Chip tone="bad" dot>Error</Chip>}
                              <Button size="sm" variant="outline" className="min-h-10" disabled={blocked || testing !== ""} onClick={() => void testProvider(p.key)}>
                                {testing === p.key && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                                ทดสอบการเชื่อมต่อ
                              </Button>
                            </div>
                          </div>
                          {blocked && p.requiredEnv.length > 0 && (
                            <p className="mt-2 text-xs text-gray-500">ต้องตั้งค่า environment: <code>{p.requiredEnv.join(", ")}</code></p>
                          )}
                          {p.connection === "ERROR" && p.error && <p className="mt-2 text-xs text-red-600">{p.error}</p>}
                          {p.testedAt && <p className="mt-1 text-xs text-gray-400">ทดสอบล่าสุด {fmtDateTime(p.testedAt)}</p>}
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-3 text-xs text-amber-700">การทดสอบการเชื่อมต่อจะเรียก AI จริง 1 ครั้ง และมีค่าใช้จ่ายจริง</p>
                  {unsupported.length > 0 && (
                    <div className="mt-4">
                      <div className="mb-1.5 text-xs font-semibold text-gray-600">Unsupported</div>
                      <ul className="space-y-1.5">
                        {unsupported.map((u) => (
                          <li key={u.label} className="text-xs text-gray-500">
                            <Chip tone="muted" className="mr-1.5">Unsupported</Chip>
                            <span className="font-medium text-gray-700">{u.label}</span> — {u.reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Section>

          <Section n={3} id="br-step-3" title="คู่แข่ง" optional why="ระบบเทียบแบรนด์ของคุณกับคู่แข่งในทุกรายงาน (Share of Voice และ Citation gap)">
            <div className="mb-3 flex justify-end">
              {!comp && (
                <Button size="sm" className="min-h-10" onClick={() => { setComp(emptyComp); setCompError(""); }} disabled={compFull}>
                  <Plus className="mr-1 h-4 w-4" />เพิ่มคู่แข่ง
                </Button>
              )}
            </div>
            {compError && <div role="alert" className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{compError}</div>}
            {comp && (
              <div className="mb-4 grid gap-3 rounded-2xl border border-gray-100 bg-gray-50 p-3 md:grid-cols-3">
                <Field label="ชื่อคู่แข่ง *">
                  <input className={inputCls} value={comp.name} onChange={(e) => setComp({ ...comp, name: e.target.value })} />
                </Field>
                <Field label="ชื่ออื่น (Aliases)">
                  <TagInput value={comp.aliases} onChange={(v) => setComp({ ...comp, aliases: v })} placeholder="ชื่ออื่น" />
                </Field>
                <Field label="โดเมน (Domains)">
                  <TagInput value={comp.domains} onChange={(v) => setComp({ ...comp, domains: v })} placeholder="example.com" />
                </Field>
                <div className="flex gap-2 md:col-span-3">
                  <Button size="sm" className="min-h-10" onClick={saveComp} disabled={compBusy}>{compBusy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}บันทึกคู่แข่ง</Button>
                  <Button size="sm" variant="outline" className="min-h-10" onClick={() => setComp(null)}>ยกเลิก</Button>
                </div>
              </div>
            )}
            {competitors.length === 0 ? (
              <EmptyState title="ยังไม่มีคู่แข่ง" description="ทุกรายงานจะเทียบแบรนด์กับคู่แข่ง — Share of Voice จะคำนวณไม่ได้จนกว่าจะเพิ่มอย่างน้อย 1 ราย" />
            ) : (
              <ul className="divide-y divide-gray-100">
                {competitors.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
                        {c.name}
                        {c.status === "INACTIVE" && <Chip tone="muted">ปิดใช้งาน</Chip>}
                      </div>
                      <div className="truncate text-xs text-gray-500">
                        {[...c.domains, ...c.aliases].join(", ") || "-"}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" className="h-10 w-10" onClick={() => { setComp({ id: c.id, name: c.name, aliases: c.aliases, domains: c.domains }); setCompError(""); }} aria-label="แก้ไข"><Pencil className="h-4 w-4" /></Button>
                      <Button size="sm" variant="outline" className="min-h-10" onClick={() => void toggleComp(c)}>{c.status === "ACTIVE" ? "ปิดใช้งาน" : "เปิดใช้งาน"}</Button>
                      <Button size="sm" variant="ghost" className="h-10 w-10" onClick={() => void deleteComp(c)} aria-label="ลบ"><Trash2 className="h-4 w-4 text-red-600" /></Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section n={4} id="br-step-4" title="รอบสแกนและงบ" why="กำหนดว่าระบบสแกนบ่อยแค่ไหน ถามกี่ครั้ง ใช้งบได้เท่าไรต่อเดือน และให้ระบบสแกนเองตามรอบหรือไม่">
            <div className="space-y-4">
              <Field label="ความถี่ในการสแกน">
                <ScheduleField value={form.schedule ?? "weekly"} onChange={(v) => patch({ schedule: v })} />
                {form.schedule === baseline.schedule && form.schedule !== "manual" && nextRunAt && (
                  <p className={helpCls}>สแกนครั้งถัดไป: {fmtDateTime(nextRunAt)}</p>
                )}
              </Field>

              <div className="rounded-2xl border border-gray-100 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <label htmlFor="br-auto-scan" className="block text-sm font-medium text-brand-navy">สแกนอัตโนมัติตามรอบ</label>
                    <p className={helpCls}>
                      {form.autoScan
                        ? "เปิดอยู่ — ระบบสแกนเองตามความถี่ด้านบน ไม่ต้องมีใครเปิดหน้านี้"
                        : "ปิดอยู่ — สแกนจะเริ่มและเดินต่อเฉพาะตอนมีคนเปิดหน้า Brand Radar"}
                    </p>
                  </div>
                  <Switch id="br-auto-scan" checked={!!form.autoScan} onCheckedChange={(v) => patch({ autoScan: v })} aria-label="สแกนอัตโนมัติตามรอบ" />
                </div>
                {form.autoScan && (
                  <div className="mt-2 space-y-1 text-xs">
                    {form.schedule === "manual" && (
                      <p className="text-amber-700">ความถี่ตั้งเป็น Manual ระบบจะไม่เริ่มสแกนเอง — เลือกความถี่ด้านบนก่อน (สแกนที่กดเริ่มเองจะเดินต่อจนจบแม้ปิดหน้านี้)</p>
                    )}
                    {auto && !auto.ready && (
                      <p role="alert" className="text-red-700">ระบบยังไม่พร้อมสแกนอัตโนมัติ: ผู้ดูแลระบบต้องตั้งค่า CRON_SECRET บน Vercel ก่อน เปิดสวิตช์ไว้ได้ แต่จะยังไม่ทำงานจนกว่าจะตั้งค่า</p>
                    )}
                    {auto?.ready && (
                      <p className="text-gray-500">
                        {auto.lastTickAt ? `ระบบตรวจรอบล่าสุด: ${fmtDateTime(auto.lastTickAt)}` : "ระบบยังไม่เคยตรวจรอบ (ปกติตรวจทุก 10 นาที)"}
                      </p>
                    )}
                    {!baseline.autoScan && (
                      <p className="text-gray-500">หลังบันทึก ถ้าถึงรอบสแกนแล้ว ระบบจะเริ่มสแกนภายในประมาณ 10 นาที และมีค่าใช้จ่ายจริงตามงบที่ตั้งไว้</p>
                    )}
                  </div>
                )}
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="งบประมาณต่อเดือน (USD)" help="เว้นว่าง = ไม่จำกัด">
                  <input type="number" min={0} step="0.01" className={inputCls} placeholder="เว้นว่าง = ไม่จำกัด" value={form.budget}
                    onChange={(e) => patch({ budget: e.target.value })} />
                </Field>
                <Field label="จำนวนรอบถามต่อ prompt" help="AI ตอบไม่เหมือนกันทุกครั้ง ถามซ้ำหลายรอบแล้วนับเป็น % ยิ่งมากยิ่งแม่น: 10 รอบ คลาด ±31%, 20 รอบ ±22%, 30 รอบ ±18% · ค่าใช้จ่ายและเวลาเพิ่มตามจำนวนรอบ · Google AI Mode / AI Overview ถาม 1 รอบเสมอ (ผลหน้าเดียวกัน)">
                  <select className={inputCls} value={form.samplesPerPrompt ?? DEFAULT_SAMPLES}
                    onChange={(e) => patch({ samplesPerPrompt: Number(e.target.value) })}>
                    {SAMPLE_OPTIONS.map((n) => (
                      <option key={n} value={n}>{n === DEFAULT_SAMPLES ? `${n} รอบ (แนะนำ)` : `${n} รอบ`}</option>
                    ))}
                  </select>
                </Field>
                <Field label="ประเทศ">
                  <select className={inputCls} value={form.country ?? "TH"} onChange={(e) => patch({ country: e.target.value })}>
                    {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                  </select>
                </Field>
                <Field label="ภาษา" help={form.language === LANGUAGE_BOTH ? "แต่ละ prompt ถามตามภาษาที่พิมพ์: มีตัวอักษรไทย = ถามเป็นไทย ไม่มี = ถามเป็นอังกฤษ" : undefined}>
                  <select className={inputCls} value={form.language ?? "th"} onChange={(e) => patch({ language: e.target.value })}>
                    {PROFILE_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
                  </select>
                </Field>
              </div>

              <SampleSizeTest projectId={projectId} providers={providers} disabled={!hasProfile} brandTerms={sampleBrandTerms} />

              <div className="rounded-2xl border border-gray-100">
                <button type="button" aria-expanded={advOpen} onClick={() => setAdvOpen(!advOpen)}
                  className="flex min-h-10 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium text-brand-navy">
                  <span>ตั้งค่าขั้นสูง</span>
                  <ChevronDown className={`h-4 w-4 transition ${advOpen ? "rotate-180" : ""}`} aria-hidden="true" />
                </button>
                {advOpen && (
                  <div className="space-y-4 border-t border-gray-100 p-3">
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label="จำนวน prompt สูงสุดต่อการสแกน" help={`สูงสุด ${LIMITS.maxPromptsPerRunMax}`}>
                        <input type="number" min={1} max={LIMITS.maxPromptsPerRunMax} className={inputCls} value={form.maxPromptsPerRun ?? ""}
                          onChange={(e) => patch({ maxPromptsPerRun: Math.min(LIMITS.maxPromptsPerRunMax, Math.max(1, Number(e.target.value) || 1)) })} />
                      </Field>
                      <Field label="อุตสาหกรรม" help="เช่น คลินิกความงาม">
                        <input className={inputCls} value={form.industry ?? ""} onChange={(e) => patch({ industry: e.target.value })} />
                      </Field>
                      <Field label="สินค้า / บริการหลัก" help="เช่น ฟิลเลอร์, โบทอกซ์">
                        <TagInput value={form.products ?? []} onChange={(v) => patch({ products: v })} placeholder="สินค้าหรือบริการหลัก" />
                      </Field>
                      <Field label="คำกำกวม (Ambiguous aliases)" help="คำทั่วไปที่อาจหมายถึงอย่างอื่น จะนับก็ต่อเมื่อมีคำบริบทอยู่ในคำตอบเดียวกัน">
                        <TagInput value={form.ambiguousAliases ?? []} onChange={(v) => patch({ ambiguousAliases: v })} placeholder="คำทั่วไปที่ซ้ำกับสิ่งอื่น" />
                      </Field>
                      <Field label="คำบริบท (Context terms)" help="คำที่ต้องอยู่ในคำตอบเดียวกันจึงจะนับ ambiguous alias เช่น ประเภทธุรกิจ">
                        <TagInput value={form.contextTerms ?? []} onChange={(v) => patch({ contextTerms: v })} placeholder="คำบริบท เช่น ประเภทธุรกิจ" />
                      </Field>
                    </div>
                    <div>
                      <div className={labelCls}>แหล่งสร้างรายการ prompt (แท็บ AI Prompts)</div>
                      <div className="grid gap-1 sm:grid-cols-2">
                        {PROMPT_SOURCES.map((s) => (
                          <label key={s} className="flex min-h-10 items-center gap-2 text-sm text-gray-700">
                            <input type="checkbox" className="h-4 w-4" checked={selectedSources.includes(s)} onChange={(e) => toggleSource(s, e.target.checked)} />
                            {PROMPT_SOURCE_LABEL[s]}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <div className={labelCls}>สแกนครั้งถัดไป</div>
                        <div className="text-sm text-gray-700">{nextRunAt ? fmtDateTime(nextRunAt) : "ยังไม่ได้ตั้ง"}</div>
                      </div>
                      <div>
                        <div className={labelCls}>สแกนล่าสุด</div>
                        <div className="text-sm text-gray-700">{lastRunAt ? fmtDateTime(lastRunAt) : "ยังไม่เคยสแกน"}</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Section>
        </div>

        <aside className="min-w-0 xl:sticky xl:top-4">
          <Panel title="สรุปการใช้งาน" subtitle="ค่าใช้จ่ายเป็นค่าจริงที่ผู้ให้บริการรายงานกลับมา ไม่ใช่ค่าประมาณ">
            <div className="mt-3 text-xs font-medium text-gray-600">เดือนนี้{usage ? ` (${monthLabelTh(usage.month)})` : ""}</div>
            <div className="mt-1.5 grid grid-cols-3 gap-2">
              <div>
                <div className={labelCls}>รวมทั้งเดือน</div>
                <div className="text-lg font-semibold text-brand-navy">{usage ? fmtUsd(usage.monthSpendUsd) : "N/A"}</div>
              </div>
              <div>
                <div className={labelCls}>ถามไป (ครั้ง)</div>
                <div className="text-lg font-semibold text-gray-700">{usage ? fmtNum(usage.calls) : "N/A"}</div>
              </div>
              <div>
                <div className={labelCls}>เฉลี่ยต่อครั้ง</div>
                <div className="text-lg font-semibold text-gray-700">{usage ? fmtUsdPerCall(costPerCall(usage.monthSpendUsd, usage.calls, usageFailed)) : "N/A"}</div>
              </div>
            </div>
            <p className={helpCls}>
              ต่อครั้ง = ค่าใช้จ่าย ÷ จำนวนครั้งที่ได้คำตอบ{usage && usageFailed > 0 ? ` (ไม่นับ ${fmtNum(usageFailed)} ครั้งที่ล้มเหลว)` : ""}
            </p>
            {usage && usage.budgetUsed !== null && usage.monthlyBudgetUsd !== null && (
              <div className="mt-3">
                <div className="mb-1 text-xs text-gray-500">ใช้งบไปแล้ว {(usage.budgetUsed * 100).toFixed(1)}% ของ {fmtUsd(usage.monthlyBudgetUsd)}</div>
                <MeterBar value={Math.min(100, usage.budgetUsed * 100)} max={100} tone={usage.budgetUsed >= 1 ? "bad" : usage.budgetUsed >= 0.8 ? "warn" : "blue"} ariaLabel="Budget used" />
              </div>
            )}
            {usage && usage.byProvider.length > 0 && (
              <div className="mt-4">
                <div className="mb-1 text-xs font-medium text-gray-600">แยกตาม AI platform (เดือนนี้)</div>
                <table className="w-full text-left text-xs">
                  <thead className="text-gray-500">
                    <tr>
                      <th className="py-1 pr-1 font-medium"><ColumnHelp k="usageProvider" align="start">Platform</ColumnHelp></th>
                      <th className="py-1 pr-1 text-right font-medium"><ColumnHelp k="usageCalls" align="end">ครั้ง</ColumnHelp></th>
                      <th className="py-1 pr-1 text-right font-medium"><ColumnHelp k="usageFailed" align="end">ล้มเหลว</ColumnHelp></th>
                      <th className="py-1 pr-1 text-right font-medium"><ColumnHelp k="usageCost" align="end">รวม</ColumnHelp></th>
                      <th className="py-1 text-right font-medium"><ColumnHelp k="usagePerCall" align="end">ต่อครั้ง</ColumnHelp></th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.byProvider.map((r) => (
                      <tr key={r.provider} className="border-t border-gray-100">
                        <td className="py-1.5 pr-1 text-gray-700"><ProviderLogo provider={r.provider} title={r.label} /></td>
                        <td className="py-1.5 pr-1 text-right tabular-nums">{fmtNum(r.calls)}</td>
                        <td className={`py-1.5 pr-1 text-right tabular-nums ${r.failed > 0 ? "text-red-600" : "text-gray-400"}`}>{fmtNum(r.failed)}</td>
                        <td className="py-1.5 pr-1 text-right tabular-nums">{fmtUsd(r.costUsd)}</td>
                        <td className="py-1.5 text-right tabular-nums">{fmtUsdPerCall(costPerCall(r.costUsd, r.calls, r.failed))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {usage && usage.history.length > 0 && (
              <div className="mt-4">
                <div className="mb-1 text-xs font-medium text-gray-600">รายเดือน 6 เดือนล่าสุด (USD)</div>
                <table className="w-full text-left text-xs">
                  <thead className="text-gray-500">
                    <tr>
                      <th className="py-1 pr-1 font-medium"><ColumnHelp k="usageMonth" align="start">เดือน</ColumnHelp></th>
                      <th className="py-1 pr-1 text-right font-medium"><ColumnHelp k="usageCalls" align="end">ครั้ง</ColumnHelp></th>
                      <th className="py-1 pr-1 text-right font-medium"><ColumnHelp k="usageCost" align="end">รวม</ColumnHelp></th>
                      <th className="py-1 text-right font-medium"><ColumnHelp k="usagePerCall" align="end">ต่อครั้ง</ColumnHelp></th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...usage.history].reverse().map((h) => (
                      <tr key={h.month} className={`border-t border-gray-100 ${h.month === usage.month ? "font-medium text-brand-navy" : ""}`}>
                        <td className="py-1.5 pr-1">{monthLabelTh(h.month)}</td>
                        <td className="py-1.5 pr-1 text-right tabular-nums">{fmtNum(h.calls)}</td>
                        <td className="py-1.5 pr-1 text-right tabular-nums">{fmtUsd(h.costUsd)}</td>
                        <td className="py-1.5 text-right tabular-nums">{fmtUsdPerCall(costPerCall(h.costUsd, h.calls, h.failed))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <BarChart className="mt-3" height={140} formatValue={(n) => fmtUsd(n)} data={usage.history.map((h) => ({ label: monthLabelTh(h.month, true), value: h.costUsd }))} ariaLabel="ค่าใช้จ่ายรายเดือน 6 เดือนล่าสุด" />
              </div>
            )}
          </Panel>
        </aside>
      </div>

      {!clientView && hasProfile && (
        <section aria-labelledby="br-delete-title" className="rounded-3xl border border-red-200 bg-white/90 p-4 sm:p-5">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <h3 id="br-delete-title" className="text-sm font-semibold text-red-700">ลบโปรเจกต์นี้ออกจาก Brand Radar</h3>
              <p className="mt-1 text-xs text-gray-600">
                ลบการตั้งค่าแบรนด์ คู่แข่ง Prompt ผลสแกน และคำตอบ AI ทั้งหมดของโปรเจกต์นี้ ลบแล้วกู้คืนไม่ได้
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {isManualProjectId(projectId)
                  ? "โปรเจกต์นี้สร้างใน Brand Radar จึงหายไปทั้งโปรเจกต์ ประวัติค่าใช้จ่าย AI ยังอยู่"
                  : "โปรเจกต์ใน MarsOS และข้อมูลของเมนูอื่นไม่ถูกลบ กลับมาตั้งค่า Brand Radar ใหม่ได้ ประวัติค่าใช้จ่าย AI ยังอยู่"}
              </p>
            </div>
            {!delOpen && (
              <Button variant="outline" className="min-h-10 border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800" onClick={() => { setDelOpen(true); setDelText(""); setDelError(""); }}>
                <Trash2 className="mr-1.5 h-4 w-4" />ลบโปรเจกต์
              </Button>
            )}
          </div>
          {delOpen && (
            <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-3">
              <label htmlFor="br-delete-confirm" className="block text-xs font-medium text-red-800">
                พิมพ์ <span className="font-semibold">{delWord}</span> เพื่อยืนยันการลบ
              </label>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  id="br-delete-confirm"
                  className={`${inputCls} max-w-xs`}
                  value={delText}
                  onChange={(e) => setDelText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void deleteProject(); }}
                  autoComplete="off"
                  disabled={delBusy}
                />
                <Button className="min-h-10 bg-red-600 text-white hover:bg-red-700" onClick={() => void deleteProject()} disabled={delBusy || delText.trim() !== delWord}>
                  {delBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Trash2 className="mr-1.5 h-4 w-4" />}ลบถาวร
                </Button>
                <Button variant="outline" className="min-h-10" onClick={() => { setDelOpen(false); setDelText(""); setDelError(""); }} disabled={delBusy}>ยกเลิก</Button>
              </div>
              {delError && <p role="alert" className="mt-2 text-sm text-red-700">{delError}</p>}
            </div>
          )}
        </section>
      )}

      {barVisible && (
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-white/80 bg-white/90 p-3 shadow-sm backdrop-blur">
          {(dirty || !hasProfile) && <span className="text-sm font-medium text-amber-700">มีการแก้ไขที่ยังไม่บันทึก</span>}
          {saveMsg && <span className="text-sm text-emerald-700">{saveMsg}</span>}
          {saveError && <span role="alert" className="text-sm text-red-700">{saveError}</span>}
          <div className="ml-auto flex gap-2">
            {dirty && <Button variant="outline" className="min-h-10" onClick={discard} disabled={saving}>ยกเลิก</Button>}
            <Button className="min-h-10" onClick={() => void save()} disabled={saving || loading || !!loadError}>
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}บันทึก
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
