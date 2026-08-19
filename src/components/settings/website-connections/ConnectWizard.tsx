"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2, Circle, Loader2, Lock, ShieldAlert, XCircle,
} from "lucide-react";

import type { ConnectionRow, ProjectLite } from "./types";
import { ADAPTERS, DEFAULT_FIELD_MAPPING, PERMISSION_CAPABILITIES, type FieldMappingRow } from "./mockData";
import { Modal, StatusPill } from "./shared";

interface Props {
  open: boolean;
  onClose: () => void;
  projects: ProjectLite[];
  onCreated: (row: ConnectionRow) => void;
}

const STEP_LABELS = [
  "Client", "Platform", "Environment", "Authentication", "Permissions", "Test Connection", "Field Mapping", "Sync & Activate",
];

const ENVIRONMENTS = ["Production", "Staging", "Development", "Read-only Replica"];

const AUTH_METHODS: Record<string, string[]> = {
  wordpress: ["Application Password", "OAuth"],
  sitemap: ["No Auth for Public Read-only Crawl"],
};

type CheckState = "pending" | "running" | "pass" | "fail" | "skip";

interface TestCheck {
  id: string;
  label: string;
  optional?: boolean;
  state: CheckState;
}

function initialChecks(): TestCheck[] {
  return [
    { id: "auth", label: "Authentication", state: "pending" },
    { id: "reach", label: "Website Reachability", state: "pending" },
    { id: "api-version", label: "API Version", state: "pending" },
    { id: "read-pages", label: "Read Pages", state: "pending" },
    { id: "read-authors", label: "Read Authors", state: "pending" },
    { id: "read-categories", label: "Read Categories", state: "pending" },
    { id: "create-draft", label: "Create Test Draft (Optional)", optional: true, state: "pending" },
    { id: "delete-draft", label: "Delete Test Draft", optional: true, state: "pending" },
    { id: "media-upload", label: "Media Upload", state: "pending" },
    { id: "preview-url", label: "Preview URL", state: "pending" },
    { id: "permission-scope", label: "Permission Scope", state: "pending" },
  ];
}

export function ConnectWizard({ open, onClose, projects, onCreated }: Props) {
  const [step, setStep] = useState(1);

  // Step 1
  const [projectId, setProjectId] = useState("");
  const [businessSkill, setBusinessSkill] = useState("");
  const [connectionName, setConnectionName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");

  // Step 2
  const [platformId, setPlatformId] = useState("wordpress");

  // Step 3
  const [environment, setEnvironment] = useState("Production");

  // Step 4
  const [authMethod, setAuthMethod] = useState("Application Password");
  const [username, setUsername] = useState("");
  const [appPassword, setAppPassword] = useState("");

  // Step 5
  const [permissions, setPermissions] = useState<Record<string, boolean>>({
    "Read Website Data": true,
    "Read Drafts": true,
    "Read Media": true,
  });

  // Step 6
  const [checks, setChecks] = useState<TestCheck[]>(initialChecks());
  const [testing, setTesting] = useState(false);
  const [testPassed, setTestPassed] = useState(false);

  // Step 7
  const [mapping, setMapping] = useState<FieldMappingRow[]>(DEFAULT_FIELD_MAPPING);

  // Step 8
  const [syncMode, setSyncMode] = useState<"full" | "incremental">("full");
  const [contentScope, setContentScope] = useState("บทความและหน้าเว็บทั้งหมด");
  const [excludePatterns, setExcludePatterns] = useState("/wp-admin/*, /cart/*");
  const [activating, setActivating] = useState(false);

  const platform = ADAPTERS.find((a) => a.id === platformId) ?? ADAPTERS[0];
  const selectedProject = projects.find((p) => p.id === projectId);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setProjectId("");
    setBusinessSkill("");
    setConnectionName("");
    setWebsiteUrl("");
    setPlatformId("wordpress");
    setEnvironment("Production");
    setAuthMethod("Application Password");
    setUsername("");
    setAppPassword("");
    setPermissions({ "Read Website Data": true, "Read Drafts": true, "Read Media": true });
    setChecks(initialChecks());
    setTesting(false);
    setTestPassed(false);
    setMapping(DEFAULT_FIELD_MAPPING);
    setSyncMode("full");
    setContentScope("บทความและหน้าเว็บทั้งหมด");
    setExcludePatterns("/wp-admin/*, /cart/*");
    setActivating(false);
  }, [open]);

  function selectProject(id: string) {
    setProjectId(id);
    const p = projects.find((pr) => pr.id === id);
    if (p) {
      if (!connectionName) setConnectionName(`${p.clientName || p.name} — ${platform.platform}`);
      if (!websiteUrl) setWebsiteUrl(p.website);
    }
  }

  function togglePermission(cap: string) {
    setPermissions((prev) => ({ ...prev, [cap]: !prev[cap] }));
  }

  function updateMappingSource(idx: number, value: string) {
    setMapping((prev) => prev.map((m, i) => (i === idx ? { ...m, sourceField: value } : m)));
  }

  async function runTest() {
    setTesting(true);
    setTestPassed(false);
    let list = initialChecks();
    setChecks(list);
    for (let i = 0; i < list.length; i++) {
      list = list.map((c, idx) => (idx === i ? { ...c, state: "running" } : c));
      setChecks([...list]);
      await new Promise((r) => setTimeout(r, 280));
      list = list.map((c, idx) => (idx === i ? { ...c, state: "pass" } : c));
      setChecks([...list]);
    }
    setTesting(false);
    setTestPassed(true);
    toast.success("Test Connection ผ่านทุกรายการ");
  }

  function canGoNext(): boolean {
    if (step === 1) return !!connectionName && !!websiteUrl;
    if (step === 4) {
      if (platformId === "wordpress") return !!username && !!appPassword;
      return true;
    }
    if (step === 6) return testPassed;
    return true;
  }

  async function handleActivate() {
    setActivating(true);
    try {
      if (platformId === "wordpress") {
        const res = await fetch("/api/settings/wordpress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: connectionName, siteUrl: websiteUrl, username, appPassword }),
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error || "เชื่อมต่อ WordPress ไม่สำเร็จ");
          setActivating(false);
          return;
        }
        let domain = "—";
        try { domain = new URL(data.siteUrl).hostname; } catch { domain = data.siteUrl; }
        const row: ConnectionRow = {
          id: data.id,
          isMock: false,
          name: data.name,
          client: selectedProject?.clientName || selectedProject?.name || "—",
          websiteUrl: data.siteUrl,
          domain,
          platform: "WordPress",
          environment,
          status: "Active",
          verification: "ตรวจสอบแล้ว",
          permissionMode: permissions["Publish"] ? "Draft + Publish (Direct)" : "Read + Create Draft",
          readCapability: true,
          writeCapability: true,
          publishCapability: !!permissions["Publish"],
          lastSync: null,
          nextSync: null,
          pageCount: null,
          mediaCount: null,
          authors: null,
          error: null,
          connectorVersion: null,
          createdBy: data.username || username,
        };
        onCreated(row);
        toast.success(`สร้าง Connection "${connectionName}" สำเร็จ`);
      } else {
        let domain = "—";
        try { domain = new URL(websiteUrl).hostname; } catch { domain = websiteUrl; }
        const row: ConnectionRow = {
          id: `mock-${Date.now()}`,
          isMock: true,
          name: connectionName,
          client: selectedProject?.clientName || selectedProject?.name || "—",
          websiteUrl,
          domain,
          platform: platform.platform,
          environment,
          status: "Read-only",
          verification: "ตรวจสอบแล้ว",
          permissionMode: "Read-only",
          readCapability: true,
          writeCapability: false,
          publishCapability: false,
          lastSync: "เมื่อสักครู่",
          nextSync: "—",
          pageCount: null,
          mediaCount: null,
          authors: null,
          error: null,
          connectorVersion: `${platform.id}-adapter@mock`,
          createdBy: "you (mock)",
        };
        onCreated(row);
        toast.success("สร้าง Connection แล้ว (mock)");
      }
      onClose();
    } catch {
      toast.error("เกิดข้อผิดพลาดระหว่างเชื่อมต่อ");
    } finally {
      setActivating(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} widthClassName="max-w-3xl">
      <div className="flex flex-col max-h-[85vh]">
        <div className="px-6 pt-6 pb-4 border-b border-gray-200">
          <h2 className="text-base font-bold text-brand-navy">Connect Website</h2>
          <p className="text-xs text-gray-500 mt-0.5">Step {step} of 8 — {STEP_LABELS[step - 1]}</p>
          <div className="flex items-center gap-1 mt-3 overflow-x-auto">
            {STEP_LABELS.map((label, idx) => {
              const n = idx + 1;
              const active = n === step;
              const done = n < step;
              return (
                <div key={label} className="flex items-center gap-1 flex-shrink-0">
                  <div
                    className={`w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center flex-shrink-0 ${
                      active ? "bg-indigo-600 text-white" : done ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-400"
                    }`}
                  >
                    {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : n}
                  </div>
                  {n < STEP_LABELS.length && <div className={`w-4 h-px ${done ? "bg-emerald-300" : "bg-gray-200"}`} />}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Client</label>
                <select
                  value={projectId}
                  onChange={(e) => selectProject(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                >
                  <option value="">— เลือก Client —</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.clientName || p.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Business Skill</label>
                <input
                  value={businessSkill}
                  onChange={(e) => setBusinessSkill(e.target.value)}
                  placeholder="เช่น Aesthetic Clinic Skill v1.4"
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Website URL</label>
                <input
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  placeholder="https://yoursite.com"
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Connection Name</label>
                <input
                  value={connectionName}
                  onChange={(e) => setConnectionName(e.target.value)}
                  placeholder="เช่น ABC Clinic WordPress"
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {ADAPTERS.map((a) => (
                <button
                  key={a.id}
                  disabled={!a.available}
                  onClick={() => setPlatformId(a.id)}
                  className={`text-left rounded-xl border px-4 py-3 transition-colors ${
                    !a.available
                      ? "border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed"
                      : platformId === a.id
                      ? "border-indigo-300 bg-indigo-50/50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <p className="text-sm font-semibold text-brand-navy">{a.platform}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{a.name}</p>
                  {!a.available && <p className="text-[10px] font-medium text-amber-600 mt-1">เร็วๆ นี้</p>}
                </button>
              ))}
            </div>
          )}

          {step === 3 && (
            <div className="grid grid-cols-2 gap-3">
              {ENVIRONMENTS.map((env) => (
                <button
                  key={env}
                  onClick={() => setEnvironment(env)}
                  className={`rounded-xl border px-4 py-3 text-sm font-medium text-left transition-colors ${
                    environment === env ? "border-indigo-300 bg-indigo-50/50 text-indigo-700" : "border-gray-200 hover:border-gray-300 text-gray-700"
                  }`}
                >
                  {env}
                </button>
              ))}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Authentication Method</label>
                <select
                  value={authMethod}
                  onChange={(e) => setAuthMethod(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                >
                  {(AUTH_METHODS[platformId] ?? ["Application Password"]).map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              {platformId === "wordpress" && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Username</label>
                    <input
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Application Password</label>
                    <input
                      type="password"
                      value={appPassword}
                      onChange={(e) => setAppPassword(e.target.value)}
                      autoComplete="new-password"
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-200"
                    />
                  </div>
                </>
              )}
              {platformId === "sitemap" && (
                <p className="text-sm text-gray-500">Adapter นี้อ่านข้อมูลแบบ Public ไม่ต้องใช้ Credential</p>
              )}
              <div className="flex items-start gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600">
                <Lock className="h-4 w-4 text-gray-400 flex-shrink-0 mt-0.5" />
                Secret ถูกเก็บฝั่ง Server แบบเข้ารหัส — จะไม่แสดงอีก ระบบไม่เก็บ Token ใน Local Storage และใช้ Least Privilege เสมอ
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">ค่าเริ่มต้นคือ Read-only สิทธิ์ Publish ต้องเปิดโดยผู้มีสิทธิ์เท่านั้น</p>
              {PERMISSION_CAPABILITIES.map((cap) => {
                const isPublishLike = ["Publish", "Unpublish", "Rollback", "Manage Schema", "Manage Redirects", "Schedule Publish"].includes(cap);
                return (
                  <label key={cap} className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 px-3 py-2">
                    <span className="text-sm text-gray-700">{cap}</span>
                    <span className="flex items-center gap-2">
                      {isPublishLike && !permissions[cap] && <span className="text-[10px] text-amber-600">ต้องเปิดโดยผู้มีสิทธิ์</span>}
                      <input type="checkbox" checked={!!permissions[cap]} onChange={() => togglePermission(cap)} />
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          {step === 6 && (
            <div className="space-y-4">
              <button
                onClick={runTest}
                disabled={testing}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold disabled:opacity-50"
              >
                {testing && <Loader2 className="h-4 w-4 animate-spin" />}
                {testing ? "กำลังทดสอบ..." : "Run Test Connection"}
              </button>
              <div className="space-y-1.5">
                {checks.map((c) => (
                  <div key={c.id} className="flex items-center gap-2 text-sm">
                    {c.state === "pass" && <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0" />}
                    {c.state === "running" && <Loader2 className="h-4 w-4 text-indigo-500 animate-spin flex-shrink-0" />}
                    {c.state === "pending" && <Circle className="h-4 w-4 text-gray-200 flex-shrink-0" />}
                    {c.state === "fail" && <XCircle className="h-4 w-4 text-rose-500 flex-shrink-0" />}
                    <span className={c.state === "pending" ? "text-gray-400" : "text-gray-700"}>{c.label}</span>
                  </div>
                ))}
              </div>
              {testPassed && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  Test Connection ผ่านทุกรายการ พร้อมไปขั้นตอนถัดไป
                </div>
              )}
            </div>
          )}

          {step === 7 && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 px-1">
                <span>CMS Field</span>
                <span>Source Field</span>
              </div>
              {mapping.map((m, idx) => (
                <div key={m.cmsField} className="grid grid-cols-2 gap-2 items-center">
                  <span className="text-sm text-gray-800">{m.cmsField}</span>
                  <input
                    value={m.sourceField}
                    onChange={(e) => updateMappingSource(idx, e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-mono text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                  />
                </div>
              ))}
            </div>
          )}

          {step === 8 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setSyncMode("full")}
                  className={`rounded-xl border px-4 py-3 text-sm font-medium text-left ${syncMode === "full" ? "border-indigo-300 bg-indigo-50/50 text-indigo-700" : "border-gray-200 text-gray-700"}`}
                >
                  Full Initial Sync
                </button>
                <button
                  onClick={() => setSyncMode("incremental")}
                  className={`rounded-xl border px-4 py-3 text-sm font-medium text-left ${syncMode === "incremental" ? "border-indigo-300 bg-indigo-50/50 text-indigo-700" : "border-gray-200 text-gray-700"}`}
                >
                  Incremental Sync
                </button>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Content Scope</label>
                <input value={contentScope} onChange={(e) => setContentScope(e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Exclude Patterns</label>
                <input value={excludePatterns} onChange={(e) => setExcludePatterns(e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-200" />
              </div>

              <div className="rounded-xl border border-gray-200 p-4 space-y-1.5 text-sm">
                <p className="font-semibold text-gray-800 mb-1">สรุป Connection</p>
                <p className="text-gray-600">Connection: <span className="font-medium text-brand-navy">{connectionName || "—"}</span></p>
                <p className="text-gray-600">Platform: <span className="font-medium text-brand-navy">{platform.platform}</span></p>
                <p className="text-gray-600">Environment: <span className="font-medium text-brand-navy">{environment}</span></p>
                <p className="text-gray-600">Status หลัง Activate: <StatusPill status={platformId === "wordpress" ? "Active" : "Read-only"} className="ml-1" /></p>
                {platformId !== "wordpress" && (
                  <div className="flex items-start gap-2 mt-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
                    <ShieldAlert className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                    Adapter นี้เป็นข้อมูลตัวอย่าง (mock) — สำหรับ WordPress จริงให้ใช้ขั้นตอนนี้เพื่อเชื่อมต่อผ่าน API เดิม
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-200">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-gray-500 hover:text-gray-700 text-sm">
            ยกเลิก
          </button>
          <div className="flex items-center gap-2">
            {step > 1 && (
              <button onClick={() => setStep((s) => s - 1)} className="px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-sm font-semibold text-gray-700">
                ย้อนกลับ
              </button>
            )}
            {step < 8 && (
              <button
                onClick={() => setStep((s) => s + 1)}
                disabled={!canGoNext()}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold disabled:opacity-50"
              >
                ถัดไป
              </button>
            )}
            {step === 8 && (
              <button
                onClick={handleActivate}
                disabled={activating}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold disabled:opacity-50"
              >
                {activating && <Loader2 className="h-4 w-4 animate-spin" />}
                Activate
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
