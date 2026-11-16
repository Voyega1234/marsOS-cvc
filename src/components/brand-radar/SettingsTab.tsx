"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BarChart, Chip, MeterBar, Panel, Segmented } from "@/components/ds";
import {
  COUNTRIES, DEFAULT_SAMPLES, LANGUAGES, LIMITS, PROMPT_SOURCES, PROMPT_SOURCE_LABEL, PROVIDER_KEYS, SAMPLE_OPTIONS, SCHEDULES,
  type CompetitorDTO, type ProfileInput, type ProfileRes, type PromptSource, type ProviderKey,
  type ProviderStatusDTO, type ProvidersRes, type Schedule, type UsageDTO,
} from "@/lib/brand-radar/types";
import { api, fmtDateTime, fmtNum, fmtUsd, methodLabel, postJson, type TabProps } from "./shared";

const inputCls =
  "h-10 w-full rounded-xl border border-input bg-white/90 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";
const labelCls = "mb-1 block text-xs font-medium text-gray-600";
const helpCls = "mt-1 text-xs text-gray-500";

const SCHEDULE_LABEL: Record<Schedule, string> = { manual: "Manual", daily: "Daily", weekly: "Weekly", monthly: "Monthly" };

function hostOf(url: string): string {
  const t = url.trim();
  if (!t) return "";
  try {
    return new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`).hostname.replace(/^www\./, "");
  } catch {
    return t.replace(/^https?:\/\//i, "").replace(/^www\./, "").split("/")[0];
  }
}

function TagInput({ value, onChange, placeholder, max = LIMITS.aliasesMax }: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  max?: number;
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
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-full bg-brand-mist px-2.5 py-1 text-xs text-brand-navy">
          {t}
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

export default function SettingsTab({ projectId, refreshKey, onChanged }: TabProps) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [hasProfile, setHasProfile] = useState(false);
  const [form, setForm] = useState<ProfileInput & { budget: string }>({ budget: "" });
  const [nextRunAt, setNextRunAt] = useState<string | null>(null);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [competitors, setCompetitors] = useState<CompetitorDTO[]>([]);
  const [providers, setProviders] = useState<ProviderStatusDTO[]>([]);
  const [unsupported, setUnsupported] = useState<ProvidersRes["unsupported"]>([]);
  const [usage, setUsage] = useState<UsageDTO | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [saveError, setSaveError] = useState("");
  const [testing, setTesting] = useState<ProviderKey | "">("");
  const [testError, setTestError] = useState("");
  const [comp, setComp] = useState<CompForm | null>(null);
  const [compBusy, setCompBusy] = useState(false);
  const [compError, setCompError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    const [pr, pv, us] = await Promise.all([
      api<ProfileRes>(`/api/brand-radar/profile?projectId=${encodeURIComponent(projectId)}`),
      api<ProvidersRes>(`/api/brand-radar/providers?projectId=${encodeURIComponent(projectId)}`),
      api<UsageDTO>(`/api/brand-radar/usage?projectId=${encodeURIComponent(projectId)}`),
    ]);
    if (!pr.ok) { setLoadError(pr.data.error || "โหลดการตั้งค่าไม่สำเร็จ"); setLoading(false); return; }
    const profile = pr.data.profile;
    const proj = pr.data.project;
    setHasProfile(!!profile);
    setCompetitors(Array.isArray(pr.data.competitors) ? pr.data.competitors : []);
    if (profile) {
      setForm({
        brandName: profile.brandName, aliases: profile.aliases, ambiguousAliases: profile.ambiguousAliases,
        contextTerms: profile.contextTerms, primaryDomain: profile.primaryDomain, ownedDomains: profile.ownedDomains,
        country: profile.country, language: profile.language, industry: profile.industry, products: profile.products,
        providers: profile.providers, promptSources: profile.promptSources, schedule: profile.schedule,
        maxPromptsPerRun: profile.maxPromptsPerRun,
        samplesPerPrompt: profile.samplesPerPrompt,
        budget: profile.monthlyBudgetUsd === null ? "" : String(profile.monthlyBudgetUsd),
      });
      setNextRunAt(profile.nextRunAt);
      setLastRunAt(profile.lastRunAt);
    } else {
      setForm({
        brandName: proj.clientName || proj.name, aliases: [], ambiguousAliases: [], contextTerms: [],
        primaryDomain: hostOf(proj.website), ownedDomains: [], country: "TH",
        language: proj.language === "en" ? "en" : "th", industry: proj.industry || "", products: [],
        // same default as the server (DEFAULT_PROVIDERS): every platform on, staff switch off what they don't want
        providers: [...PROVIDER_KEYS], promptSources: ["manual"], schedule: "weekly", maxPromptsPerRun: 50, samplesPerPrompt: DEFAULT_SAMPLES, budget: "",
      });
      setNextRunAt(null);
      setLastRunAt(null);
    }
    if (pv.ok) { setProviders(pv.data.providers ?? []); setUnsupported(pv.data.unsupported ?? []); }
    setUsage(us.ok ? (us.data as UsageDTO) : null);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const patch = (p: Partial<ProfileInput & { budget: string }>) => { setForm((f) => ({ ...f, ...p })); setSaveMsg(""); };

  async function save() {
    setSaveError(""); setSaveMsg("");
    if (!form.brandName?.trim()) { setSaveError("กรุณากรอกชื่อแบรนด์"); return; }
    if (!form.primaryDomain?.trim()) { setSaveError("กรุณากรอกโดเมนหลักของแบรนด์"); return; }
    const budgetTxt = form.budget.trim();
    const budget = budgetTxt === "" ? null : Number(budgetTxt);
    if (budget !== null && (!Number.isFinite(budget) || budget < 0)) { setSaveError("งบประมาณต่อเดือนต้องเป็นตัวเลขที่ไม่ติดลบ"); return; }
    const { budget: _b, ...rest } = form;
    void _b;
    setSaving(true);
    const res = await api<{ profile: unknown }>("/api/brand-radar/profile", postJson({
      projectId, ...rest, brandName: rest.brandName?.trim(), primaryDomain: hostOf(rest.primaryDomain ?? ""), monthlyBudgetUsd: budget,
    }, "PUT"));
    setSaving(false);
    if (!res.ok) { setSaveError(res.data.error || "บันทึกไม่สำเร็จ"); return; }
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

  function toggleProvider(key: ProviderKey, on: boolean) {
    const cur = form.providers ?? [];
    patch({ providers: on ? [...cur.filter((k) => k !== key), key] : cur.filter((k) => k !== key) });
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

  return (
    <div className="space-y-4">
      {!hasProfile && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
          ตั้งค่าแบรนด์ครั้งแรก — ระบบเติมข้อมูลจากโปรเจกต์ให้แล้ว ตรวจสอบแล้วกด “บันทึก”
        </div>
      )}

      <Panel title="1. Brand Profile" subtitle="ชื่อและโดเมนที่ใช้ตรวจว่า AI พูดถึง / อ้างอิงแบรนด์หรือไม่">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className={labelCls}>Brand name *</label>
            <input className={inputCls} value={form.brandName ?? ""} onChange={(e) => patch({ brandName: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>Official domain *</label>
            <input className={inputCls} placeholder="example.com" value={form.primaryDomain ?? ""} onChange={(e) => patch({ primaryDomain: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>Aliases</label>
            <TagInput value={form.aliases ?? []} onChange={(v) => patch({ aliases: v })} placeholder="ชื่ออื่นของแบรนด์ (Enter หรือ , เพื่อเพิ่ม)" />
            <p className={helpCls}>ชื่ออื่น ชื่อย่อ หรือการสะกดอื่นของแบรนด์ สูงสุด {LIMITS.aliasesMax} รายการ</p>
          </div>
          <div>
            <label className={labelCls}>Extra owned domains</label>
            <TagInput value={form.ownedDomains ?? []} onChange={(v) => patch({ ownedDomains: v.map(hostOf) })} placeholder="โดเมนอื่นของแบรนด์" />
            <p className={helpCls}>ลิงก์ไปโดเมนเหล่านี้จะนับเป็น citation ของแบรนด์</p>
          </div>
          <div>
            <label className={labelCls}>Ambiguous aliases</label>
            <TagInput value={form.ambiguousAliases ?? []} onChange={(v) => patch({ ambiguousAliases: v })} placeholder="คำทั่วไปที่ซ้ำกับสิ่งอื่น" />
            <p className={helpCls}>คำทั่วไปที่อาจหมายถึงอย่างอื่น จะนับก็ต่อเมื่อมีคำบริบทอยู่ในคำตอบเดียวกัน</p>
          </div>
          <div>
            <label className={labelCls}>Context terms</label>
            <TagInput value={form.contextTerms ?? []} onChange={(v) => patch({ contextTerms: v })} placeholder="คำบริบท เช่น ประเภทธุรกิจ" />
            <p className={helpCls}>คำที่ต้องอยู่ในคำตอบเดียวกันจึงจะนับ ambiguous alias</p>
          </div>
          <div>
            <label className={labelCls}>Country</label>
            <select className={inputCls} value={form.country ?? "TH"} onChange={(e) => patch({ country: e.target.value })}>
              {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Language</label>
            <select className={inputCls} value={form.language ?? "th"} onChange={(e) => patch({ language: e.target.value })}>
              {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Industry</label>
            <input className={inputCls} value={form.industry ?? ""} onChange={(e) => patch({ industry: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>Products / services</label>
            <TagInput value={form.products ?? []} onChange={(v) => patch({ products: v })} placeholder="สินค้าหรือบริการหลัก" />
          </div>
        </div>
      </Panel>

      <Panel title="2. Competitor Management" subtitle="คู่แข่งที่ใช้คำนวณ Share of Voice และ Citation gap"
        actions={!comp ? <Button size="sm" variant="outline" onClick={() => { setComp(emptyComp); setCompError(""); }} disabled={competitors.length >= LIMITS.competitorsMax}><Plus className="mr-1 h-4 w-4" />เพิ่มคู่แข่ง</Button> : undefined}>
        {compError && <div role="alert" className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{compError}</div>}
        {comp && (
          <div className="mb-4 grid gap-3 rounded-2xl border border-gray-100 bg-gray-50 p-3 md:grid-cols-3">
            <div>
              <label className={labelCls}>ชื่อคู่แข่ง *</label>
              <input className={inputCls} value={comp.name} onChange={(e) => setComp({ ...comp, name: e.target.value })} />
            </div>
            <div>
              <label className={labelCls}>Aliases</label>
              <TagInput value={comp.aliases} onChange={(v) => setComp({ ...comp, aliases: v })} placeholder="ชื่ออื่น" />
            </div>
            <div>
              <label className={labelCls}>Domains</label>
              <TagInput value={comp.domains} onChange={(v) => setComp({ ...comp, domains: v })} placeholder="example.com" />
            </div>
            <div className="flex gap-2 md:col-span-3">
              <Button size="sm" onClick={saveComp} disabled={compBusy}>{compBusy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}บันทึกคู่แข่ง</Button>
              <Button size="sm" variant="outline" onClick={() => setComp(null)}>ยกเลิก</Button>
            </div>
          </div>
        )}
        {competitors.length === 0 ? (
          <p className="text-sm text-gray-500">ยังไม่มีคู่แข่ง — Share of Voice จะคำนวณไม่ได้จนกว่าจะเพิ่มอย่างน้อย 1 ราย</p>
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
                  <Button size="sm" variant="ghost" onClick={() => { setComp({ id: c.id, name: c.name, aliases: c.aliases, domains: c.domains }); setCompError(""); }} aria-label="แก้ไข"><Pencil className="h-4 w-4" /></Button>
                  <Button size="sm" variant="outline" onClick={() => void toggleComp(c)}>{c.status === "ACTIVE" ? "ปิดใช้งาน" : "เปิดใช้งาน"}</Button>
                  <Button size="sm" variant="ghost" onClick={() => void deleteComp(c)} aria-label="ลบ"><Trash2 className="h-4 w-4 text-red-600" /></Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="3. AI Providers" subtitle="เลือก AI platform ที่จะติดตาม แต่ละ platform ระบุวิธีเก็บคำตอบชัดเจน">
        {testError && <div role="alert" className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{testError}</div>}
        <ul className="space-y-3">
          {providers.map((p) => {
            const blocked = p.connection === "NOT_CONNECTED";
            const checked = selectedProviders.includes(p.key);
            return (
              <li key={p.key} className="rounded-2xl border border-gray-100 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <label className="flex min-w-0 items-start gap-2.5">
                    <input type="checkbox" className="mt-1 h-4 w-4" checked={checked && !blocked} disabled={blocked}
                      onChange={(e) => toggleProvider(p.key, e.target.checked)} />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-gray-800">{p.label}</span>
                      <span className="block text-xs text-gray-500">{p.note}</span>
                      {p.model && <span className="block text-xs text-gray-500">Model: {p.model}</span>}
                    </span>
                  </label>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Chip tone={p.method === "observed_serp" ? "info" : "muted"}>{methodLabel(p.method)}</Chip>
                    {p.connection === "CONNECTED" && <Chip tone="ok" dot>Connected</Chip>}
                    {p.connection === "UNTESTED" && <Chip tone="info" dot>Untested</Chip>}
                    {p.connection === "NOT_CONNECTED" && <Chip tone="muted" dot>Not connected</Chip>}
                    {p.connection === "ERROR" && <Chip tone="bad" dot>Error</Chip>}
                    <Button size="sm" variant="outline" disabled={blocked || testing !== ""} onClick={() => void testProvider(p.key)}>
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
      </Panel>

      <Panel title="4. Prompt Sources" subtitle="แหล่งที่ใช้สร้างรายการ prompt ในแท็บ AI Prompts">
        <div className="grid gap-2 sm:grid-cols-2">
          {PROMPT_SOURCES.map((s) => (
            <label key={s} className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" className="h-4 w-4" checked={selectedSources.includes(s)} onChange={(e) => toggleSource(s, e.target.checked)} />
              {PROMPT_SOURCE_LABEL[s]}
            </label>
          ))}
        </div>
      </Panel>

      <Panel title="5. Monitoring Schedule" subtitle="ความถี่ที่ระบบสแกนอัตโนมัติ (สแกนทำงานเมื่อมีคนเปิดหน้า Brand Radar)">
        <div className="space-y-4">
          <Segmented<Schedule>
            ariaLabel="Schedule"
            value={form.schedule ?? "weekly"}
            onChange={(v) => patch({ schedule: v })}
            options={SCHEDULES.map((s) => ({ value: s, label: SCHEDULE_LABEL[s] }))}
          />
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className={labelCls}>Max prompts per scan</label>
              <input type="number" min={1} max={LIMITS.maxPromptsPerRunMax} className={inputCls} value={form.maxPromptsPerRun ?? ""}
                onChange={(e) => patch({ maxPromptsPerRun: Math.min(LIMITS.maxPromptsPerRunMax, Math.max(1, Number(e.target.value) || 1)) })} />
              <p className={helpCls}>สูงสุด {LIMITS.maxPromptsPerRunMax}</p>
            </div>
            <div>
              <label className={labelCls}>จำนวนรอบถามต่อ prompt</label>
              <select className={inputCls} value={form.samplesPerPrompt ?? DEFAULT_SAMPLES}
                onChange={(e) => patch({ samplesPerPrompt: Number(e.target.value) })}>
                {SAMPLE_OPTIONS.map((n) => (
                  <option key={n} value={n}>{n === DEFAULT_SAMPLES ? `${n} รอบ (แนะนำ)` : `${n} รอบ`}</option>
                ))}
              </select>
              <p className={helpCls}>AI ตอบไม่เหมือนกันทุกครั้ง ถามซ้ำหลายรอบแล้วนับเป็น % ยิ่งมากยิ่งแม่น: 10 รอบ คลาด ±31%, 20 รอบ ±22%, 30 รอบ ±18% · ค่าใช้จ่ายและเวลาเพิ่มตามจำนวนรอบ · Google AI Mode / AI Overview ถาม 1 รอบเสมอ (ผลหน้าเดียวกัน)</p>
            </div>
            <div>
              <label className={labelCls}>Next run</label>
              <div className="flex h-10 items-center text-sm text-gray-700">{nextRunAt ? fmtDateTime(nextRunAt) : "ยังไม่ได้ตั้ง"}</div>
            </div>
            <div>
              <label className={labelCls}>Last run</label>
              <div className="flex h-10 items-center text-sm text-gray-700">{lastRunAt ? fmtDateTime(lastRunAt) : "ยังไม่เคยสแกน"}</div>
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="6. Usage & API Budget" subtitle="ค่าใช้จ่ายเป็นค่าจริงที่ผู้ให้บริการรายงานกลับมา ไม่ใช่ค่าประมาณ">
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className={labelCls}>Monthly budget (USD)</label>
            <input type="number" min={0} step="0.01" className={inputCls} placeholder="เว้นว่าง = ไม่จำกัด" value={form.budget}
              onChange={(e) => patch({ budget: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>ใช้ไปเดือนนี้ {usage ? `(${usage.month})` : ""}</label>
            <div className="flex h-10 items-center text-sm font-semibold text-brand-navy">{usage ? fmtUsd(usage.monthSpendUsd) : "N/A"}</div>
          </div>
          <div>
            <label className={labelCls}>จำนวน API calls เดือนนี้</label>
            <div className="flex h-10 items-center text-sm text-gray-700">{usage ? fmtNum(usage.calls) : "N/A"}</div>
          </div>
        </div>
        {usage && usage.budgetUsed !== null && usage.monthlyBudgetUsd !== null && (
          <div className="mt-3">
            <div className="mb-1 text-xs text-gray-500">ใช้งบไปแล้ว {(usage.budgetUsed * 100).toFixed(1)}% ของ {fmtUsd(usage.monthlyBudgetUsd)}</div>
            <MeterBar value={Math.min(100, usage.budgetUsed * 100)} max={100} tone={usage.budgetUsed >= 1 ? "bad" : usage.budgetUsed >= 0.8 ? "warn" : "blue"} ariaLabel="Budget used" />
          </div>
        )}
        {usage && usage.byProvider.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-gray-500">
                <tr><th className="py-1 pr-3">AI platform</th><th className="py-1 pr-3">Calls</th><th className="py-1 pr-3">Failed</th><th className="py-1">Cost</th></tr>
              </thead>
              <tbody>
                {usage.byProvider.map((r) => (
                  <tr key={r.provider} className="border-t border-gray-100">
                    <td className="py-1.5 pr-3 text-gray-700">{r.label}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{fmtNum(r.calls)}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{fmtNum(r.failed)}</td>
                    <td className="py-1.5 tabular-nums">{fmtUsd(r.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {usage && usage.history.length > 0 && (
          <div className="mt-4">
            <div className="mb-1 text-xs font-medium text-gray-600">ค่าใช้จ่าย 6 เดือนล่าสุด (USD)</div>
            <BarChart height={180} formatValue={(n) => fmtUsd(n)} data={usage.history.map((h) => ({ label: h.month, value: h.costUsd }))} ariaLabel="Cost history" />
          </div>
        )}
      </Panel>

      <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-white/80 bg-white/90 p-3 shadow-sm backdrop-blur">
        <Button onClick={() => void save()} disabled={saving}>
          {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}บันทึก
        </Button>
        {saveMsg && <span className="text-sm text-emerald-700">{saveMsg}</span>}
        {saveError && <span role="alert" className="text-sm text-red-700">{saveError}</span>}
      </div>
    </div>
  );
}
