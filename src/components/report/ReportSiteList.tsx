"use client";

// Report-only component. Does not create tasks or workflow items.

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  BarChart3, CheckCircle2, AlertCircle, RefreshCw,
  Pencil, Check, X, Globe, ExternalLink, Link2, Settings2,
} from "lucide-react";

interface GSCSite {
  siteUrl: string;
  permissionLevel: string;
}

interface Project {
  id: string;
  name: string;
  clientName: string | null;
  website: string;
  gscSiteUrl: string | null;
  ga4PropertyId: string | null;
}

interface LinkedSite {
  siteUrl: string;
  permissionLevel: string;
  project: Project | null;   // null = not yet linked to any project
}

function hostnameFrom(siteUrl: string): string {
  if (siteUrl.startsWith("sc-domain:")) return siteUrl.replace("sc-domain:", "");
  try { return new URL(siteUrl).hostname; } catch { return siteUrl; }
}

// ─── Inline rename ────────────────────────────────────────────────────────────
function RenameInline({ projectId, current, onSaved }: {
  projectId: string; current: string; onSaved: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue]     = useState(current);
  const [saving, setSaving]   = useState(false);

  async function save() {
    if (!value.trim() || value === current) { setEditing(false); return; }
    setSaving(true);
    const r = await fetch("/api/report/site-link", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, displayName: value.trim() }),
    });
    if (r.ok) { onSaved(value.trim()); setEditing(false); }
    setSaving(false);
  }

  if (!editing) return (
    <button onClick={() => setEditing(true)}
      className="flex items-center gap-1 group/rename text-left">
      <span className="font-semibold text-gray-900 text-sm group-hover/rename:text-blue-600 transition-colors">{current}</span>
      <Pencil size={10} className="text-gray-300 group-hover/rename:text-blue-400 transition-colors" />
    </button>
  );

  return (
    <div className="flex items-center gap-1">
      <input autoFocus value={value} onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
        className="text-sm font-semibold border border-blue-400 rounded-lg px-2 py-0.5 outline-none w-44 focus:ring-2 focus:ring-blue-300" />
      <button onClick={save} disabled={saving} className="p-1 text-emerald-600 hover:text-emerald-700 disabled:opacity-50">
        {saving ? <RefreshCw size={12} className="animate-spin" /> : <Check size={12} />}
      </button>
      <button onClick={() => { setValue(current); setEditing(false); }} className="p-1 text-gray-400 hover:text-gray-600">
        <X size={12} />
      </button>
    </div>
  );
}

// ─── Link to existing project modal ──────────────────────────────────────────
function LinkProjectModal({ siteUrl, projects, onLinked, onClose }: {
  siteUrl: string;
  projects: Project[];
  onLinked: (project: Project) => void;
  onClose: () => void;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [saving, setSaving] = useState(false);

  async function link() {
    setSaving(true);
    const r = await fetch("/api/report/site-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteUrl, projectId: selectedId }),
    });
    if (r.ok) { onLinked(await r.json()); onClose(); }
    setSaving(false);
  }

  const selectedProject = projects.find(p => p.id === selectedId);
  const willOverwrite = selectedProject?.gscSiteUrl && selectedProject.gscSiteUrl !== siteUrl;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <p className="font-bold text-gray-900 text-sm">ผูก Site กับ Client</p>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={16} /></button>
        </div>
        <p className="text-xs text-gray-500 font-mono bg-gray-50 px-3 py-2 rounded-lg break-all">{siteUrl}</p>
        {projects.length === 0 ? (
          <p className="text-xs text-gray-400">ไม่มี Client — สร้าง Client ก่อนจากหน้า Clients</p>
        ) : (
          <div className="space-y-2">
            <select value={selectedId} onChange={e => setSelectedId(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
              <option value="">— เลือก Client —</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>
                  {p.clientName ?? p.name}{p.gscSiteUrl ? ` (GSC: ${hostnameFrom(p.gscSiteUrl)})` : ""}
                </option>
              ))}
            </select>
            {willOverwrite && (
              <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
                ⚠️ GSC เดิมของ Client นี้ ({hostnameFrom(selectedProject!.gscSiteUrl!)}) จะถูกแทนที่
              </p>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-xs text-gray-500 hover:text-gray-900">ยกเลิก</button>
          <button onClick={link} disabled={!selectedId || saving}
            className="px-4 py-2 bg-gray-900 text-white text-xs font-semibold rounded-xl hover:bg-gray-700 disabled:opacity-40 transition-colors">
            {saving ? "กำลังผูก..." : "ผูก"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Edit site settings modal ─────────────────────────────────────────────────
function EditSiteModal({ site, allProjects, onSaved, onClose }: {
  site: LinkedSite;
  allProjects: Project[];
  onSaved: (project: Project) => void;
  onClose: () => void;
}) {
  const project = site.project!;

  // General
  const [displayName, setDisplayName] = useState(project.clientName ?? project.name);
  const [website, setWebsite]         = useState(project.website ?? "");

  // GA4
  const [ga4Id, setGa4Id]             = useState(project.ga4PropertyId ?? "");
  const [ga4Input, setGa4Input]       = useState(project.ga4PropertyId ?? "");
  const [ga4Properties, setGa4Properties] = useState<{ propertyId: string; displayName: string }[]>([]);
  const [ga4Loading, setGa4Loading]   = useState(false);

  // GSC
  const [gscUrl, setGscUrl]           = useState(project.gscSiteUrl ?? "");
  const [gscInput, setGscInput]       = useState(project.gscSiteUrl ?? "");
  const [gscSites, setGscSites]       = useState<{ siteUrl: string; permissionLevel: string }[]>([]);
  const [gscLoading, setGscLoading]   = useState(false);
  const [relinkId, setRelinkId]       = useState("");

  const [saving, setSaving]           = useState(false);
  const [activeTab, setActiveTab]     = useState<"general" | "ga4" | "gsc">("general");

  const fetchGA4Props = useCallback(async () => {
    setGa4Loading(true);
    try {
      const r = await fetch("/api/report/ga4-properties");
      const d = await r.json() as { properties?: { propertyId: string; displayName: string }[] };
      if (d.properties) setGa4Properties(d.properties);
    } catch { /* skip */ } finally { setGa4Loading(false); }
  }, []);

  const fetchGscSites = useCallback(async () => {
    setGscLoading(true);
    try {
      const r = await fetch("/api/report/gsc-sites");
      const d = await r.json() as { sites?: { siteUrl: string; permissionLevel: string }[] };
      if (d.sites) setGscSites(d.sites);
    } catch { /* skip */ } finally { setGscLoading(false); }
  }, []);

  useEffect(() => { fetchGA4Props(); fetchGscSites(); }, [fetchGA4Props, fetchGscSites]);

  async function save() {
    setSaving(true);
    try {
      const nameChanged    = displayName.trim() !== (project.clientName ?? project.name);
      const websiteChanged = website.trim() !== (project.website ?? "");
      const finalGa4       = ga4Id || ga4Input.trim();
      const finalGsc       = gscUrl || gscInput.trim();
      const ga4Changed     = finalGa4 !== (project.ga4PropertyId ?? "");
      const gscChanged     = finalGsc !== (project.gscSiteUrl ?? "");

      // Rename client
      if (nameChanged) {
        await fetch("/api/report/site-link", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: project.id, displayName: displayName.trim() }),
        });
      }

      // Save website + GA4 + GSC via style route
      if (websiteChanged || ga4Changed || gscChanged) {
        await fetch(`/api/projects/${project.id}/style`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(websiteChanged && { website: website.trim() }),
            ...(ga4Changed     && { ga4PropertyId: finalGa4 || null }),
            ...(gscChanged     && { gscSiteUrl: finalGsc || null }),
          }),
        });
      }

      // Relink GSC to another client
      if (relinkId && relinkId !== project.id) {
        await fetch("/api/report/site-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ siteUrl: finalGsc || site.siteUrl, projectId: relinkId }),
        });
      }

      onSaved({
        ...project,
        clientName:    nameChanged ? displayName.trim() : project.clientName,
        website:       websiteChanged ? website.trim() : project.website,
        ga4PropertyId: ga4Changed ? (finalGa4 || null) : project.ga4PropertyId,
        gscSiteUrl:    gscChanged ? (finalGsc || null) : project.gscSiteUrl,
      });
      onClose();
    } catch { /* skip */ } finally { setSaving(false); }
  }

  const tabCls = (t: typeof activeTab) =>
    `px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${activeTab === t ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`;

  const unrelinkable = allProjects.filter(p => p.id !== project.id);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <p className="font-bold text-gray-900 text-sm">แก้ไขการผูก — {project.clientName ?? project.name}</p>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={16} /></button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1.5">
          <button className={tabCls("general")} onClick={() => setActiveTab("general")}>ทั่วไป</button>
          <button className={tabCls("ga4")} onClick={() => setActiveTab("ga4")}>GA4</button>
          <button className={tabCls("gsc")} onClick={() => setActiveTab("gsc")}>GSC / Client</button>
        </div>

        {/* Tab: General */}
        {activeTab === "general" && (
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1">ชื่อ Client</label>
              <input value={displayName} onChange={e => setDisplayName(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1">Website URL</label>
              <input value={website} onChange={e => setWebsite(e.target.value)}
                placeholder="https://example.com"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-900" />
            </div>
          </div>
        )}

        {/* Tab: GA4 */}
        {activeTab === "ga4" && (
          <div className="space-y-3">
            <p className="text-xs text-gray-500">เลือก GA4 Property จากรายการ หรือพิมพ์ Property ID โดยตรง</p>
            {ga4Loading ? (
              <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
                <RefreshCw size={11} className="animate-spin" /> กำลังโหลด GA4 Properties...
              </div>
            ) : ga4Properties.length > 0 ? (
              <div>
                <label className="text-xs font-semibold text-gray-500 block mb-1">เลือกจาก Google Account</label>
                <select value={ga4Id} onChange={e => { setGa4Id(e.target.value); setGa4Input(e.target.value); }}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
                  <option value="">— ไม่ระบุ —</option>
                  {ga4Properties.map(p => (
                    <option key={p.propertyId} value={p.propertyId}>{p.displayName} ({p.propertyId})</option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">ไม่พบ GA4 Properties — ตรวจสอบ Service Account</p>
            )}
            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1">หรือพิมพ์ Property ID</label>
              <input value={ga4Input} onChange={e => { setGa4Input(e.target.value); setGa4Id(""); }}
                placeholder="เช่น 485395571"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-900" />
            </div>
            {(ga4Id || ga4Input) && (
              <button onClick={() => { setGa4Id(""); setGa4Input(""); }}
                className="text-xs text-red-500 hover:text-red-700">ลบ GA4 ออก</button>
            )}
          </div>
        )}

        {/* Tab: GSC / Client */}
        {activeTab === "gsc" && (
          <div className="space-y-3">
            <p className="text-xs text-gray-500">เลือก GSC Site หรือพิมพ์ URL โดยตรง และเปลี่ยน Client ที่ผูกอยู่</p>

            {/* GSC site picker */}
            {gscLoading ? (
              <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
                <RefreshCw size={11} className="animate-spin" /> กำลังโหลด GSC Sites...
              </div>
            ) : gscSites.length > 0 ? (
              <div>
                <label className="text-xs font-semibold text-gray-500 block mb-1">เลือก GSC Site</label>
                <select value={gscUrl} onChange={e => { setGscUrl(e.target.value); setGscInput(e.target.value); }}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
                  <option value="">— ไม่ระบุ —</option>
                  {gscSites.map(s => (
                    <option key={s.siteUrl} value={s.siteUrl}>
                      {s.siteUrl} ({s.permissionLevel.replace("siteFullUser","Full").replace("siteOwner","Owner").replace("siteRestricted","Restricted")})
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1">หรือพิมพ์ GSC Site URL</label>
              <input value={gscInput} onChange={e => { setGscInput(e.target.value); setGscUrl(""); }}
                placeholder="เช่น sc-domain:example.com หรือ https://example.com/"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-900" />
            </div>

            {(gscUrl || gscInput) && (
              <button onClick={() => { setGscUrl(""); setGscInput(""); }}
                className="text-xs text-red-500 hover:text-red-700">ลบ GSC ออก</button>
            )}

            {/* Relink to another client */}
            <div className="border-t border-gray-100 pt-3">
              <label className="text-xs font-semibold text-gray-500 block mb-1">ย้ายไปผูกกับ Client อื่น (optional)</label>
              {unrelinkable.length === 0 ? (
                <p className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2">ไม่มี Client อื่นในระบบ</p>
              ) : (
                <select value={relinkId} onChange={e => setRelinkId(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
                  <option value="">— คงไว้ที่ {project.clientName ?? project.name} —</option>
                  {unrelinkable.map(p => (
                    <option key={p.id} value={p.id}>{p.clientName ?? p.name}{p.gscSiteUrl ? ` (GSC: ${p.gscSiteUrl})` : ""}</option>
                  ))}
                </select>
              )}
              {relinkId && (
                <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 mt-2">
                  ⚠️ GSC จะถูกย้ายไปยัง Client ที่เลือก
                </p>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 text-xs text-gray-500 hover:text-gray-900">ยกเลิก</button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 bg-gray-900 text-white text-xs font-semibold rounded-xl hover:bg-gray-700 disabled:opacity-40 transition-colors">
            {saving ? <><RefreshCw size={11} className="inline animate-spin mr-1" />กำลังบันทึก...</> : "บันทึก"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Site row ─────────────────────────────────────────────────────────────────
function SiteRow({ site, allProjects, onUpdate }: {
  site: LinkedSite;
  allProjects: Project[];
  onUpdate: (siteUrl: string, project: Project) => void;
}) {
  const [linkModal, setLinkModal] = useState(false);
  const [editModal, setEditModal] = useState(false);

  const hostname = hostnameFrom(site.siteUrl);
  const displayName = site.project?.clientName ?? site.project?.name ?? hostname;

  return (
    <>
      <div className="flex items-center gap-3 p-4 bg-white border border-gray-200 rounded-xl hover:shadow-sm transition-shadow">
        {/* Avatar */}
        <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center text-gray-600 font-bold text-sm shrink-0">
          {displayName.charAt(0).toUpperCase()}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          {site.project ? (
            <RenameInline
              projectId={site.project.id}
              current={displayName}
              onSaved={name => onUpdate(site.siteUrl, { ...site.project!, clientName: name })}
            />
          ) : (
            <p className="font-semibold text-gray-500 text-sm">{hostname}</p>
          )}
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-[10px] text-gray-400 font-mono truncate max-w-[200px]">{site.siteUrl}</span>
            {site.project?.ga4PropertyId && (
              <span className="text-[10px] text-emerald-600 flex items-center gap-0.5">
                <CheckCircle2 size={9} /> GA4
              </span>
            )}
            <span className="text-[10px] text-gray-300">{site.permissionLevel.replace("s", "").replace("iteRestricted", "Restricted").replace("iteOwner", "Owner").replace("iteFullUser", "Full").replace("iteUnverifiedUser", "Unverified")}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {site.project ? (
            <>
              <button onClick={() => setEditModal(true)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                title="แก้ไขการผูก">
                <Settings2 size={13} />
              </button>
              <Link href={`/report/${site.project.id}`}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white text-xs font-semibold rounded-xl hover:bg-gray-700 transition-colors">
                <BarChart3 size={11} /> ดูรายงาน
              </Link>
            </>
          ) : (
            <button onClick={() => setLinkModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 text-xs font-semibold rounded-xl hover:bg-blue-100 transition-colors border border-blue-200">
              <Link2 size={11} /> ผูก Client
            </button>
          )}
        </div>
      </div>

      {linkModal && (
        <LinkProjectModal
          siteUrl={site.siteUrl}
          projects={allProjects}
          onLinked={p => { onUpdate(site.siteUrl, p); setLinkModal(false); }}
          onClose={() => setLinkModal(false)}
        />
      )}

      {editModal && site.project && (
        <EditSiteModal
          site={site}
          allProjects={allProjects}
          onSaved={p => { onUpdate(site.siteUrl, p); setEditModal(false); }}
          onClose={() => setEditModal(false)}
        />
      )}
    </>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
interface Props {
  initialProjects: Project[];
  serviceEmail:    string;
}

export function ReportSiteList({ initialProjects, serviceEmail }: Props) {
  const [sites, setSites]         = useState<LinkedSite[] | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [projects, setProjects]   = useState<Project[]>(initialProjects);

  useEffect(() => {
    fetch("/api/report/gsc-sites")
      .then(r => r.json())
      .then(data => {
        if (data.error) { setError(data.error); return; }
        // Build linked sites list
        const gscSites: GSCSite[] = data.sites ?? [];
        const linked: LinkedSite[] = gscSites.map(s => ({
          ...s,
          project: projects.find(p => p.gscSiteUrl === s.siteUrl) ?? null,
        }));
        setSites(linked);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleUpdate(siteUrl: string, project: Project) {
    setProjects(prev => {
      const exists = prev.find(p => p.id === project.id);
      if (exists) return prev.map(p => p.id === project.id ? project : p);
      return [...prev, project];
    });
    setSites(prev => prev ? prev.map(s =>
      s.siteUrl === siteUrl ? { ...s, project } : s
    ) : prev);
  }

  // Projects not linked to any GSC site (no siteUrl match)
  const linkedSiteUrls = new Set((sites ?? []).filter(s => s.project).map(s => s.siteUrl));
  const unlinkedProjects = projects.filter(p => !p.gscSiteUrl || !linkedSiteUrls.has(p.gscSiteUrl));

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Report</h1>
          <p className="text-sm text-gray-500 mt-0.5">Sites ที่บัญชี Google ที่เชื่อมต่อเข้าถึงได้</p>
        </div>
      </div>

      {/* Google identity badge */}
      <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5 text-xs">
        <CheckCircle2 size={13} className="text-emerald-600 shrink-0" />
        <div>
          <span className="font-semibold text-emerald-800">Google Identity: </span>
          <span className="font-mono text-emerald-700">{serviceEmail}</span>
        </div>
      </div>

      {/* GSC Sites from service account */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Globe size={14} className="text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-700">Sites จาก Google Search Console</h2>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-gray-400 py-6 justify-center">
            <RefreshCw size={14} className="animate-spin" /> กำลังดึง sites จาก GSC...
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
            <AlertCircle size={13} className="shrink-0" />
            <div>
              <p className="font-semibold">ไม่สามารถดึง Sites ได้</p>
              <p className="text-xs mt-0.5 opacity-80">{error}</p>
              <p className="text-xs mt-1 opacity-60">ตรวจสอบ GOOGLE_SERVICE_ACCOUNT_JSON และสิทธิ์ของ service account ใน GSC</p>
            </div>
          </div>
        )}

        {sites && sites.length === 0 && !error && (
          <div className="text-center py-10 bg-gray-50 rounded-2xl border border-gray-100">
            <Globe size={28} className="text-gray-200 mx-auto mb-2" />
            <p className="text-gray-500 text-sm font-medium">ไม่พบ Site ใน GSC</p>
            <p className="text-gray-400 text-xs mt-1">Share GSC property ให้ <span className="font-mono">{serviceEmail}</span> เป็น Viewer</p>
          </div>
        )}

        {sites && sites.length > 0 && (
          <div className="space-y-2">
            {/* Linked sites first */}
            {sites.filter(s => s.project).map(s => (
              <SiteRow key={s.siteUrl} site={s} allProjects={projects} onUpdate={handleUpdate} />
            ))}
            {/* Unlinked sites */}
            {sites.filter(s => !s.project).map(s => (
              <SiteRow key={s.siteUrl} site={s} allProjects={projects} onUpdate={handleUpdate} />
            ))}
          </div>
        )}
      </div>

      {/* Projects that have gscSiteUrl but it's not in GSC list (manual setup) */}
      {!loading && sites && unlinkedProjects.filter(p => p.gscSiteUrl).length > 0 && (
        <div className="space-y-2">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Clients ที่ผูก GSC แล้ว (manual)</h2>
          {unlinkedProjects.filter(p => p.gscSiteUrl).map(p => (
            <Link key={p.id} href={`/report/${p.id}`}
              className="flex items-center justify-between p-4 bg-white border border-gray-200 rounded-xl hover:border-gray-900 transition-colors group">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center text-gray-600 font-bold text-sm">
                  {(p.clientName ?? p.name).charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-semibold text-gray-900 text-sm">{p.clientName ?? p.name}</p>
                  <p className="text-[10px] font-mono text-gray-400">{p.gscSiteUrl}</p>
                </div>
              </div>
              <BarChart3 size={14} className="text-gray-400 group-hover:text-gray-900 transition-colors" />
            </Link>
          ))}
        </div>
      )}

      {/* Projects with no GSC at all */}
      {!loading && unlinkedProjects.filter(p => !p.gscSiteUrl).length > 0 && (
        <div className="space-y-2">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Clients ที่ยังไม่ผูก GSC ({unlinkedProjects.filter(p => !p.gscSiteUrl).length})</h2>
          {unlinkedProjects.filter(p => !p.gscSiteUrl).map(p => (
            <div key={p.id} className="flex items-center justify-between p-3.5 bg-gray-50 border border-gray-100 rounded-xl opacity-60">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gray-200 flex items-center justify-center text-gray-400 font-bold text-xs">
                  {(p.clientName ?? p.name).charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-medium text-gray-600 text-sm">{p.clientName ?? p.name}</p>
                  <p className="text-[10px] text-gray-400">{p.website}</p>
                </div>
              </div>
              <Link href={`/projects/${p.id}`} className="text-[10px] text-gray-400 flex items-center gap-1 hover:text-gray-700">
                <ExternalLink size={9} /> Project
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
