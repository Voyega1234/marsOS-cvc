"use client";

/**
 * PBN Backlinks > Project Setting > เว็บ PBN & Connect
 * connect เว็บ PBN ทุกเว็บไว้ที่เดียว (ตอน push เลือกว่าจะขึ้นเว็บไหน)
 * - WordPress: URL + User + Application Password
 * - GitHub: เว็บที่ deploy ด้วย Vercel / Cloudflare Pages — push = commit ไฟล์บทความลง repo แล้วเว็บ build ใหม่เอง
 * - Report: ผูก GSC property / GA4 property ต่อเว็บ (ใช้ในแท็บ Report)
 * - ข้อมูลโปรเจกต์ PBN มีได้หลาย set (เว็บหลัก + ภาษา + Content Engine) — เลือกตอนเขียนบทความ
 * secret (รหัสผ่าน / token / deploy hook) ไม่เคยถูกส่งกลับมาหน้าเว็บ — เว้นว่าง = ใช้ค่าเดิม
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Github, Globe, Loader2, Pencil, Plug, Plus, Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { UploadClientDTO } from "@/lib/upload-article/types";
import { DEFAULT_GH_BRANCH, DEFAULT_GH_DIR, DEFAULT_URL_PATTERN, type PbnSiteDTO } from "@/lib/upload-article/pbn";
import { usePbnSites } from "./usePbnSites";
import { usePbnProfiles } from "./usePbnProfiles";
import PbnProjectSets from "./PbnProjectSets";
import PbnSiteGuide from "./PbnSiteGuide";

type Draft = {
  name: string;
  siteUrl: string;
  platform: "wordpress" | "github";
  wpUrl: string;
  wpUser: string;
  wpPassword: string;
  host: "vercel" | "cloudflare" | "other";
  ghOwner: string;
  ghRepo: string;
  ghBranch: string;
  ghDir: string;
  ghFormat: "md" | "mdx" | "html";
  ghImageDir: string;
  ghImageUrl: string;
  ghToken: string;
  urlPattern: string;
  deployHook: string;
  gscSiteUrl: string;
  ga4PropertyId: string;
};

const EMPTY: Draft = {
  name: "", siteUrl: "", platform: "github", wpUrl: "", wpUser: "", wpPassword: "",
  host: "vercel", ghOwner: "", ghRepo: "", ghBranch: DEFAULT_GH_BRANCH, ghDir: DEFAULT_GH_DIR, ghFormat: "md",
  ghImageDir: "public/images/blog", ghImageUrl: "", ghToken: "", urlPattern: DEFAULT_URL_PATTERN, deployHook: "",
  gscSiteUrl: "", ga4PropertyId: "",
};

function fromSite(s: PbnSiteDTO): Draft {
  return {
    name: s.name, siteUrl: s.siteUrl, platform: s.platform, wpUrl: s.wpUrl, wpUser: s.wpUser, wpPassword: "",
    host: s.host, ghOwner: s.ghOwner, ghRepo: s.ghRepo, ghBranch: s.ghBranch, ghDir: s.ghDir, ghFormat: s.ghFormat,
    ghImageDir: s.ghImageDir, ghImageUrl: s.ghImageUrl, ghToken: "", urlPattern: s.urlPattern, deployHook: "",
    gscSiteUrl: s.gscSiteUrl, ga4PropertyId: s.ga4PropertyId,
  };
}

const HOST_LABEL: Record<Draft["host"], string> = { vercel: "Vercel", cloudflare: "Cloudflare Pages", other: "อื่น ๆ" };

const labelCls = "block text-xs font-semibold text-gray-600 mb-1";
const pwCls = "w-full px-3 py-2 text-sm border border-gray-200 rounded-xl";
const selectCls = "w-full h-10 rounded-md border border-gray-200 px-3 text-sm bg-white";

function useReportSources() {
  const [gscSites, setGscSites] = useState<string[] | null>(null);
  const [ga4, setGa4] = useState<{ propertyId: string; displayName: string; accountName?: string }[] | null>(null);
  useEffect(() => {
    fetch("/api/report/gsc-sites").then(r => (r.ok ? r.json() : null)).then(d => {
      setGscSites(Array.isArray(d?.sites) ? d.sites.map((s: { siteUrl: string }) => s.siteUrl) : []);
    }).catch(() => setGscSites([]));
    fetch("/api/report/ga4-properties").then(r => (r.ok ? r.json() : null)).then(d => {
      setGa4(Array.isArray(d?.properties) ? d.properties : []);
    }).catch(() => setGa4([]));
  }, []);
  return { gscSites, ga4 };
}

function SiteForm({
  initial, site, onDone, onCancel,
}: {
  initial: Draft;
  site: PbnSiteDTO | null;
  onDone: (s: PbnSiteDTO) => void;
  onCancel: () => void;
}) {
  const [d, setD] = useState<Draft>(initial);
  const [saving, setSaving] = useState(false);
  const { gscSites, ga4 } = useReportSources();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD(prev => ({ ...prev, [k]: v }));

  // วาง URL ของ repo ทั้งเส้นได้ — แยก owner/repo ให้เอง
  function onRepoPaste(v: string) {
    const m = /github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[/#?].*)?$/i.exec(v.trim());
    if (m) setD(prev => ({ ...prev, ghOwner: m[1], ghRepo: m[2] }));
    else set("ghRepo", v);
  }

  async function save() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: d.name, siteUrl: d.siteUrl, platform: d.platform,
        gscSiteUrl: d.gscSiteUrl, ga4PropertyId: d.ga4PropertyId,
      };
      if (d.platform === "wordpress") {
        Object.assign(body, { wpUrl: d.wpUrl || d.siteUrl, wpUser: d.wpUser });
        if (d.wpPassword.trim()) body.wpPassword = d.wpPassword;
      } else {
        Object.assign(body, {
          host: d.host, ghOwner: d.ghOwner, ghRepo: d.ghRepo, ghBranch: d.ghBranch, ghDir: d.ghDir,
          ghFormat: d.ghFormat, ghImageDir: d.ghImageDir, ghImageUrl: d.ghImageUrl, urlPattern: d.urlPattern,
        });
        if (d.ghToken.trim()) body.ghToken = d.ghToken;
        if (d.deployHook.trim()) body.deployHook = d.deployHook;
      }
      const r = await fetch(site ? `/api/pbn-backlinks/sites/${site.id}` : "/api/pbn-backlinks/sites", {
        method: site ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const res = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(res.error || "บันทึกไม่สำเร็จ");
      if (Array.isArray(res.cleared) && res.cleared.length) {
        toast.warning("เปลี่ยนเว็บ/repo แล้ว — ล้างรหัสผ่าน/Token เดิมทิ้ง กรุณาใส่ใหม่");
      } else {
        toast.success(site ? "บันทึกเว็บแล้ว" : "เพิ่มเว็บ PBN แล้ว");
      }
      onDone(res.site);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white border border-brand-soft/60 rounded-xl p-4 space-y-4">
      <p className="text-sm font-semibold text-brand-navy">{site ? `แก้ไขเว็บ: ${site.name}` : "เพิ่มเว็บ PBN"}</p>
      <PbnSiteGuide platform={d.platform} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>ชื่อเว็บ</label>
          <Input value={d.name} onChange={e => set("name", e.target.value)} placeholder="เช่น PBN รีวิวคอนโด 1" />
        </div>
        <div>
          <label className={labelCls}>URL เว็บ</label>
          <Input value={d.siteUrl} onChange={e => set("siteUrl", e.target.value)} placeholder="https://www.example.com" />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {([["github", "GitHub (Vercel / Cloudflare)"], ["wordpress", "WordPress"]] as const).map(([id, label]) => (
          <button key={id} onClick={() => set("platform", id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              d.platform === id ? "bg-brand-mist text-brand-blue border-brand-soft/60" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
            }`}>
            {label}
          </button>
        ))}
      </div>

      {d.platform === "wordpress" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className={labelCls}>WordPress URL (เว้นว่าง = ใช้ URL เว็บด้านบน)</label>
            <Input value={d.wpUrl} onChange={e => set("wpUrl", e.target.value)} placeholder={d.siteUrl || "https://www.example.com"} />
          </div>
          <div>
            <label className={labelCls}>WP Username</label>
            <Input value={d.wpUser} onChange={e => set("wpUser", e.target.value)} placeholder="admin" />
          </div>
          <div>
            <label className={labelCls}>
              Application Password
              {site?.hasWpPassword && <span className="ml-1.5 font-normal text-emerald-600">(บันทึกไว้แล้ว — เว้นว่างเพื่อใช้ค่าเดิม)</span>}
            </label>
            <input type="password" value={d.wpPassword} onChange={e => set("wpPassword", e.target.value)}
              placeholder={site?.hasWpPassword ? "••••••••" : "xxxx xxxx xxxx xxxx"} className={pwCls} autoComplete="new-password" />
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Deploy ด้วย</label>
              <select value={d.host} onChange={e => set("host", e.target.value as Draft["host"])} className={selectCls}>
                {(Object.keys(HOST_LABEL) as Draft["host"][]).map(h => <option key={h} value={h}>{HOST_LABEL[h]}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>GitHub owner</label>
              <Input value={d.ghOwner} onChange={e => set("ghOwner", e.target.value)} placeholder="my-org" />
            </div>
            <div>
              <label className={labelCls}>Repo (วาง URL repo ได้)</label>
              <Input value={d.ghRepo} onChange={e => onRepoPaste(e.target.value)} placeholder="pbn-site-1" />
            </div>
            <div>
              <label className={labelCls}>Branch</label>
              <Input value={d.ghBranch} onChange={e => set("ghBranch", e.target.value)} placeholder={DEFAULT_GH_BRANCH} />
            </div>
            <div>
              <label className={labelCls}>โฟลเดอร์บทความ</label>
              <Input value={d.ghDir} onChange={e => set("ghDir", e.target.value)} placeholder={DEFAULT_GH_DIR} />
            </div>
            <div>
              <label className={labelCls}>ชนิดไฟล์</label>
              <select value={d.ghFormat} onChange={e => set("ghFormat", e.target.value as Draft["ghFormat"])} className={selectCls}>
                <option value="md">Markdown (.md) + frontmatter</option>
                <option value="mdx">MDX (.mdx) + frontmatter</option>
                <option value="html">HTML (.html)</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>โฟลเดอร์รูปปก (ว่าง = ไม่อัปรูป)</label>
              <Input value={d.ghImageDir} onChange={e => set("ghImageDir", e.target.value)} placeholder="public/images/blog" />
            </div>
            <div>
              <label className={labelCls}>URL รูป (ว่าง = ตามโฟลเดอร์)</label>
              <Input value={d.ghImageUrl} onChange={e => set("ghImageUrl", e.target.value)} placeholder="/images/blog" />
            </div>
            <div>
              <label className={labelCls}>รูปแบบ URL บทความ</label>
              <Input value={d.urlPattern} onChange={e => set("urlPattern", e.target.value)} placeholder={DEFAULT_URL_PATTERN} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>
                GitHub Token (fine-grained, Contents: Read and write)
                {site?.hasGhToken && <span className="ml-1.5 font-normal text-emerald-600">(บันทึกไว้แล้ว)</span>}
              </label>
              <input type="password" value={d.ghToken} onChange={e => set("ghToken", e.target.value)}
                placeholder={site?.hasGhToken ? "••••••••" : "github_pat_..."} className={pwCls} autoComplete="new-password" />
            </div>
            <div>
              <label className={labelCls}>
                Deploy Hook (ไม่บังคับ)
                {site?.hasDeployHook && <span className="ml-1.5 font-normal text-emerald-600">(บันทึกไว้แล้ว)</span>}
              </label>
              <input type="password" value={d.deployHook} onChange={e => set("deployHook", e.target.value)}
                placeholder={site?.hasDeployHook ? "••••••••" : "https://api.vercel.com/v1/integrations/deploy/..."} className={pwCls} autoComplete="new-password" />
            </div>
          </div>
          <p className="text-[11px] text-gray-400 leading-relaxed">
            push = commit ไฟล์บทความ (+ รูปปก) ลง repo เป็น commit เดียว — {HOST_LABEL[d.host]} ที่ผูก repo ไว้จะ build ใหม่เอง.
            ใส่ Deploy Hook เฉพาะเว็บที่ไม่ได้เปิด auto-deploy จาก git. รูปแบบ URL ใช้ {"{siteUrl}"} และ {"{slug}"}
          </p>
        </div>
      )}

      <div className="border-t border-gray-100 pt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Report: Google Search Console</label>
          {gscSites && gscSites.length > 0 ? (
            <select value={d.gscSiteUrl} onChange={e => set("gscSiteUrl", e.target.value)} className={selectCls}>
              <option value="">— ไม่ผูก —</option>
              {d.gscSiteUrl && !gscSites.includes(d.gscSiteUrl) && <option value={d.gscSiteUrl}>{d.gscSiteUrl}</option>}
              {gscSites.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          ) : (
            <Input value={d.gscSiteUrl} onChange={e => set("gscSiteUrl", e.target.value)}
              placeholder={gscSites === null ? "กำลังโหลด..." : "sc-domain:example.com"} />
          )}
        </div>
        <div>
          <label className={labelCls}>Report: GA4 Property</label>
          {ga4 && ga4.length > 0 ? (
            <select value={d.ga4PropertyId} onChange={e => set("ga4PropertyId", e.target.value)} className={selectCls}>
              <option value="">— ไม่ผูก —</option>
              {d.ga4PropertyId && !ga4.some(p => p.propertyId === d.ga4PropertyId) && <option value={d.ga4PropertyId}>{d.ga4PropertyId}</option>}
              {ga4.map(p => <option key={p.propertyId} value={p.propertyId}>{p.displayName} ({p.propertyId})</option>)}
            </select>
          ) : (
            <Input value={d.ga4PropertyId} onChange={e => set("ga4PropertyId", e.target.value)}
              placeholder={ga4 === null ? "กำลังโหลด..." : "123456789"} />
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button disabled={saving || (!d.name.trim() && !d.siteUrl.trim())} onClick={save}>
          {saving ? "กำลังบันทึก..." : site ? "บันทึก" : "เพิ่มเว็บ"}
        </Button>
        <Button variant="outline" disabled={saving} onClick={onCancel}>ยกเลิก</Button>
      </div>
    </div>
  );
}

export default function PbnSitesSection({ client, setClient }: { client: UploadClientDTO; setClient: (c: UploadClientDTO) => void }) {
  const { sites, setSites, styleNames, loading, error } = usePbnSites();
  const pbnProfiles = usePbnProfiles();
  const [editing, setEditing] = useState<PbnSiteDTO | "new" | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; message: string }>>({});

  async function test(site: PbnSiteDTO) {
    setTesting(site.id);
    try {
      const r = await fetch(`/api/pbn-backlinks/sites/${site.id}/test`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      setTestResult(prev => ({ ...prev, [site.id]: r.ok ? { ok: true, message: `เชื่อมต่อได้ — ${d.message || ""}` } : { ok: false, message: d.error || "เชื่อมต่อไม่สำเร็จ" } }));
    } finally {
      setTesting(null);
    }
  }

  async function remove(site: PbnSiteDTO) {
    if (!confirm(`ลบเว็บ "${site.name}" ออกจากรายการ? (บทความที่ขึ้นเว็บไปแล้วยังอยู่ที่เว็บเดิม, สไตล์บทความของเว็บนี้ถูกลบด้วย)`)) return;
    const r = await fetch(`/api/pbn-backlinks/sites/${site.id}`, { method: "DELETE" });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      toast.error(d.error || "ลบไม่สำเร็จ");
      return;
    }
    setSites(prev => prev.filter(s => s.id !== site.id));
    toast.success("ลบเว็บแล้ว");
  }

  function onSaved(s: PbnSiteDTO) {
    setSites(prev => (prev.some(x => x.id === s.id) ? prev.map(x => (x.id === s.id ? s : x)) : [...prev, s]));
    setTestResult(prev => { const n = { ...prev }; delete n[s.id]; return n; });
    setEditing(null);
  }

  return (
    <div className="max-w-3xl space-y-4">
      <PbnProjectSets client={client} setClient={setClient} profiles={pbnProfiles.profiles} setProfiles={pbnProfiles.setProfiles}
        loading={pbnProfiles.loading} error={pbnProfiles.error} />

      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-brand-navy">เว็บ PBN ทั้งหมด ({sites.length})</p>
            <p className="text-[11px] text-gray-400">connect ทุกเว็บไว้ที่นี่ — ตอน push เลือกว่าจะขึ้นเว็บไหน</p>
          </div>
          {editing === null && (
            <Button size="sm" onClick={() => setEditing("new")}><Plus size={13} className="mr-1" /> เพิ่มเว็บ</Button>
          )}
        </div>

        {loading && <p className="text-xs text-gray-400 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> กำลังโหลด...</p>}
        {error && <p className="text-xs text-red-600">{error}</p>}
        {!loading && !error && sites.length === 0 && editing === null && (
          <p className="text-xs text-gray-400 py-4 text-center">ยังไม่มีเว็บ PBN — กด &quot;เพิ่มเว็บ&quot;</p>
        )}

        <div className="space-y-2">
          {sites.map(s => {
            const ready = s.platform === "github" ? s.hasGhToken && !!s.ghOwner && !!s.ghRepo : s.hasWpPassword && !!s.wpUser;
            const tr = testResult[s.id];
            return (
              <div key={s.id} className="border border-gray-100 rounded-lg px-3 py-2.5">
                <div className="flex items-center gap-2 flex-wrap">
                  {s.platform === "github" ? <Github size={14} className="text-gray-500" /> : <Globe size={14} className="text-gray-500" />}
                  <span className="text-sm font-medium text-brand-navy">{s.name}</span>
                  <span className="text-[11px] text-gray-400 truncate max-w-[260px]">{s.siteUrl}</span>
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                    {s.platform === "github" ? `GitHub · ${HOST_LABEL[s.host]}` : "WordPress"}
                  </span>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${styleNames[s.id] ? "bg-violet-50 text-violet-700" : "bg-gray-50 text-gray-400"}`}>
                    สไตล์: {styleNames[s.id] || "สไตล์หลัก"}
                  </span>
                  {!ready && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">ตั้งค่ายังไม่ครบ</span>}
                  {(s.gscSiteUrl || s.ga4PropertyId) && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-brand-mist text-brand-blue">
                      Report: {[s.gscSiteUrl && "GSC", s.ga4PropertyId && "GA4"].filter(Boolean).join(" + ")}
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-1">
                    <Button size="sm" variant="outline" disabled={testing === s.id} onClick={() => test(s)}>
                      {testing === s.id ? <Loader2 size={12} className="animate-spin" /> : <Plug size={12} />}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditing(s)}><Pencil size={12} /></Button>
                    <Button size="sm" variant="outline" onClick={() => remove(s)}><Trash2 size={12} className="text-red-500" /></Button>
                  </div>
                </div>
                {s.platform === "github" && s.ghOwner && (
                  <p className="text-[11px] text-gray-400 mt-1">{s.ghOwner}/{s.ghRepo}@{s.ghBranch} · {s.ghDir || "(root)"} · .{s.ghFormat}</p>
                )}
                {tr && (
                  <div className={`mt-2 flex items-start gap-2 rounded-lg px-2.5 py-2 text-xs ${tr.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
                    {tr.ok ? <CheckCircle2 size={13} className="shrink-0 mt-0.5" /> : <XCircle size={13} className="shrink-0 mt-0.5" />}
                    <span>{tr.message}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {editing !== null && (
        <SiteForm
          key={editing === "new" ? "new" : editing.id}
          initial={editing === "new" ? EMPTY : fromSite(editing)}
          site={editing === "new" ? null : editing}
          onDone={onSaved}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}
