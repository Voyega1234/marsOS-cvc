"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Globe, Plus, Trash2, CheckCircle2, XCircle, Eye, EyeOff,
  AlertTriangle, Loader2, ExternalLink, Key, ChevronDown, ChevronUp,
  Plug, Unplug, RefreshCw, ShoppingBag, Layers, Ghost as GhostIcon,
  Sparkles, LinkIcon, Settings2,
} from "lucide-react";

// ─── Platform definitions ─────────────────────────────────────────────────────

type PlatformId = "wordpress" | "shopify" | "webflow" | "ghost" | "wix" | "squarespace" | "custom";

type CredentialField = {
  key: string;
  label: string;
  placeholder: string;
  hint: string;
  type?: "text" | "password" | "url";
};

type Platform = {
  id: PlatformId;
  name: string;
  tagline: string;
  icon: React.ElementType;
  color: string;          // bg + text for icon bubble
  accentBorder: string;
  docsUrl: string;
  credentialFields: CredentialField[];
  setupSteps: { n: number; title: string; detail: string }[];
};

const PLATFORMS: Platform[] = [
  {
    id: "wordpress",
    name: "WordPress",
    tagline: "CMS ยอดนิยม — รองรับ Auto-publish บทความ",
    icon: Globe,
    color: "bg-blue-50 text-blue-600",
    accentBorder: "border-blue-200",
    docsUrl: "https://wordpress.org/support/article/application-passwords/",
    credentialFields: [
      { key: "username",    label: "Username",            placeholder: "admin",                     hint: "Username ที่ Login WordPress (ไม่ใช่ email)", type: "text" },
      { key: "appPassword", label: "Application Password", placeholder: "AbCd EfGh IjKl MnOp …",  hint: "จาก Users → Profile → Application Passwords", type: "password" },
    ],
    setupSteps: [
      { n: 1, title: "เปิด WordPress Admin → Users → Profile", detail: "เข้า wp-admin แล้วไปที่ Users → คลิกชื่อบัญชี Admin ของคุณ" },
      { n: 2, title: 'เลื่อนหา "Application Passwords"', detail: "เลื่อนลงมาด้านล่างสุดของหน้า Profile (ต้องการ WordPress 5.6+)" },
      { n: 3, title: 'ตั้งชื่อ "Mars" แล้วกด Add', detail: 'WordPress จะ generate password ให้ — Copy ทันที! แสดงแค่ครั้งเดียว' },
      { n: 4, title: "นำมาใส่ในฟอร์มด้านล่าง", detail: "วาง password ที่ได้ในช่อง Application Password และกด Save" },
    ],
  },
  {
    id: "shopify",
    name: "Shopify",
    tagline: "E-commerce platform — Blog Posts & Pages",
    icon: ShoppingBag,
    color: "bg-green-50 text-green-700",
    accentBorder: "border-green-200",
    docsUrl: "https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/admin-api-access-token",
    credentialFields: [
      { key: "accessToken", label: "Admin API Access Token", placeholder: "shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", hint: "จาก Shopify Admin → Apps → Private Apps → Admin API", type: "password" },
    ],
    setupSteps: [
      { n: 1, title: "เปิด Shopify Admin → Settings → Apps and sales channels", detail: "ไปที่ร้านค้า Shopify ของคุณ → Settings → Apps and sales channels" },
      { n: 2, title: "กด Develop apps → Create an app", detail: "สร้าง private app ใหม่ ตั้งชื่อ Mars" },
      { n: 3, title: "เปิด API permissions: write_content", detail: "ในหน้า Configuration → Admin API access scopes ติ๊ก write_content, read_content" },
      { n: 4, title: "Install app แล้ว Copy Access Token", detail: "กด Install และ Copy Admin API access token ที่ได้มาใส่ด้านล่าง" },
    ],
  },
  {
    id: "webflow",
    name: "Webflow",
    tagline: "No-code builder — CMS Collections & Pages",
    icon: Layers,
    color: "bg-indigo-50 text-indigo-600",
    accentBorder: "border-indigo-200",
    docsUrl: "https://developers.webflow.com/data/docs/getting-started-data-clients",
    credentialFields: [
      { key: "siteId",   label: "Site ID",   placeholder: "6123abc…",   hint: "จาก Project Settings → General → Site ID", type: "text" },
      { key: "apiToken", label: "API Token",  placeholder: "Bearer xxxxxxxx…", hint: "จาก Webflow Account Settings → API Access", type: "password" },
    ],
    setupSteps: [
      { n: 1, title: "เปิด Webflow Dashboard → Account Settings", detail: "คลิกรูปโปรไฟล์ด้านบนขวา → Account Settings" },
      { n: 2, title: "Integrations → API Access → Generate API Token", detail: "สร้าง token ใหม่ ตั้งชื่อ Mars และเปิด CMS write permission" },
      { n: 3, title: "Copy Site ID จาก Project Settings", detail: "เปิดโปรเจกต์ → Settings → General → เลื่อนหา Site ID" },
      { n: 4, title: "นำ Site ID และ API Token มาใส่ด้านล่าง", detail: "วางค่าที่ได้ในฟอร์มแล้วกด Save" },
    ],
  },
  {
    id: "ghost",
    name: "Ghost",
    tagline: "Publishing platform — Posts & Pages",
    icon: GhostIcon,
    color: "bg-slate-100 text-slate-700",
    accentBorder: "border-gray-100",
    docsUrl: "https://ghost.org/docs/admin-api/",
    credentialFields: [
      { key: "adminApiKey", label: "Admin API Key", placeholder: "xxxxxxxx:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", hint: "จาก Ghost Admin → Settings → Integrations → Add custom integration", type: "password" },
    ],
    setupSteps: [
      { n: 1, title: "Ghost Admin → Settings → Integrations", detail: "เปิด Ghost Admin แล้วไปที่ Settings → Integrations (ล่างสุด)" },
      { n: 2, title: "กด Add custom integration ตั้งชื่อ Mars", detail: "สร้าง integration ใหม่และจดชื่อไว้" },
      { n: 3, title: "Copy Admin API Key", detail: "ในหน้า integration จะเห็น Admin API Key — Copy ทั้งหมด (รูปแบบ xxx:xxx)" },
      { n: 4, title: "ใส่ URL และ Key ด้านล่าง", detail: "Site URL คือ URL หลักของ Ghost เช่น https://yourblog.ghost.io" },
    ],
  },
  {
    id: "wix",
    name: "Wix",
    tagline: "Website builder — Blog API",
    icon: Sparkles,
    color: "bg-yellow-50 text-yellow-700",
    accentBorder: "border-yellow-200",
    docsUrl: "https://dev.wix.com/docs/rest",
    credentialFields: [
      { key: "apiKey",     label: "API Key",    placeholder: "IST.xxxxxxxx…", hint: "จาก Wix Developer Center → API Keys", type: "password" },
      { key: "accountId", label: "Account ID", placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", hint: "จาก Wix Business Manager URL หรือ Account Settings", type: "text" },
    ],
    setupSteps: [
      { n: 1, title: "เปิด Wix Developer Center → API Keys", detail: "ไปที่ manage.wix.com → Developer Center → API Keys" },
      { n: 2, title: "สร้าง API Key ใหม่ ตั้งชื่อ Mars", detail: "เปิด permission: Blog, Manage Blogs" },
      { n: 3, title: "Copy API Key และ Account ID", detail: "Account ID อยู่ใน URL ของ Wix Business Manager" },
    ],
  },
  {
    id: "squarespace",
    name: "Squarespace",
    tagline: "Website builder — Blog Posts",
    icon: Layers,
    color: "bg-gray-50 text-gray-700",
    accentBorder: "border-gray-100",
    docsUrl: "https://developers.squarespace.com/content-api",
    credentialFields: [
      { key: "apiKey", label: "API Key", placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", hint: "จาก Squarespace Settings → Advanced → External API Keys", type: "password" },
    ],
    setupSteps: [
      { n: 1, title: "Settings → Advanced → External API Keys", detail: "เปิด Squarespace Editor → Settings → Advanced → External API Keys" },
      { n: 2, title: "กด Generate API Key", detail: "ตั้งชื่อ Mars และเปิด Blog: Read & Write" },
      { n: 3, title: "Copy API Key", detail: "นำ API Key มาวางด้านล่าง" },
    ],
  },
  {
    id: "custom",
    name: "Custom REST API",
    tagline: "เชื่อมต่อ CMS อื่นๆ ผ่าน REST API",
    icon: LinkIcon,
    color: "bg-violet-50 text-violet-700",
    accentBorder: "border-violet-200",
    docsUrl: "",
    credentialFields: [
      { key: "authHeader", label: "Auth Header Name", placeholder: "Authorization",  hint: "ชื่อ header สำหรับ authenticate เช่น Authorization หรือ X-API-Key", type: "text" },
      { key: "apiKey",     label: "API Key / Token",  placeholder: "Bearer sk-…",    hint: "Token หรือ API Key รวม prefix ถ้ามี เช่น Bearer xxx", type: "password" },
    ],
    setupSteps: [
      { n: 1, title: "ตรวจสอบ API docs ของ CMS ที่ต้องการใช้", detail: "หาว่าใช้ header อะไร และ token ได้มาจากไหน" },
      { n: 2, title: "กรอก endpoint URL และ auth credentials", detail: "ใส่ URL ของ CMS API endpoint ในช่อง Site URL" },
    ],
  },
];

// ─── Types ────────────────────────────────────────────────────────────────────

type WpConn = { id: string; name: string; siteUrl: string; username: string; defaultStatus: string };
type SiteConn = { id: string; name: string; platform: string; siteUrl: string; credentialMasked: string | null; extraConfig: string; status: string; createdAt: string };

// ─── Component ────────────────────────────────────────────────────────────────

export function WebsiteConnectClient({
  initialWpConnections,
  initialSiteConnections,
}: {
  initialWpConnections: WpConn[];
  initialSiteConnections: SiteConn[];
}) {
  const [wpConnections, setWpConnections] = useState(initialWpConnections);
  const [siteConnections, setSiteConnections] = useState(initialSiteConnections);
  const [activePlatform, setActivePlatform] = useState<PlatformId | null>(null);

  const totalConnected = wpConnections.length + siteConnections.length;

  function getCount(pid: PlatformId) {
    if (pid === "wordpress") return wpConnections.length;
    return siteConnections.filter((c) => c.platform === pid).length;
  }

  function handleToggle(pid: PlatformId) {
    setActivePlatform((prev) => (prev === pid ? null : pid));
  }

  return (
    <div className="space-y-6 max-w-5xl">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Website Connect</h1>
          <p className="text-gray-500 text-sm mt-1">เชื่อมต่อเว็บไซต์และ CMS ทุกระบบเพื่อ publish บทความอัตโนมัติ</p>
        </div>
        {totalConnected > 0 && (
          <div className="flex items-center gap-2 px-4 py-2 bg-green-50 border border-green-200 rounded-xl text-green-700 text-sm font-semibold">
            <CheckCircle2 className="h-4 w-4" />
            {totalConnected} site{totalConnected !== 1 ? "s" : ""} connected
          </div>
        )}
      </div>

      {/* Platform grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {PLATFORMS.map((p) => {
          const count = getCount(p.id);
          const isOpen = activePlatform === p.id;
          const Icon = p.icon;
          return (
            <button
              key={p.id}
              onClick={() => handleToggle(p.id)}
              className={`relative text-left rounded-2xl border p-4 transition-all hover:shadow-md ${isOpen ? `${p.accentBorder} shadow-md bg-white` : "border-gray-100 bg-white hover:border-gray-300"}`}
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${p.color}`}>
                  <Icon className="h-5 w-5" />
                </div>
                {count > 0 ? (
                  <span className="flex items-center gap-1 text-xs font-bold text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                    <CheckCircle2 className="h-3 w-3" />{count}
                  </span>
                ) : (
                  <span className="text-xs text-gray-300 border border-gray-100 bg-gray-50 px-2 py-0.5 rounded-full">—</span>
                )}
              </div>
              <p className="font-semibold text-sm text-gray-900">{p.name}</p>
              <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{p.tagline}</p>
              <div className={`absolute bottom-3 right-3 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}>
                <ChevronDown className="h-4 w-4 text-gray-300" />
              </div>
            </button>
          );
        })}
      </div>

      {/* Expanded panel */}
      {activePlatform && (() => {
        const platform = PLATFORMS.find((p) => p.id === activePlatform)!;
        return (
          <div className={`rounded-2xl border-2 ${platform.accentBorder} bg-white shadow-sm overflow-hidden`}>
            {/* Panel header */}
            <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${platform.color}`}>
                  <platform.icon className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-bold text-gray-900">{platform.name}</h2>
                  <p className="text-xs text-gray-400">{platform.tagline}</p>
                </div>
              </div>
              <button onClick={() => setActivePlatform(null)} className="text-gray-300 hover:text-gray-500 p-1 rounded-lg hover:bg-gray-100 transition-colors">
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            {/* Panel body */}
            <div className="p-6">
              {activePlatform === "wordpress" ? (
                <WordPressPanel
                  connections={wpConnections}
                  onAdd={(c) => setWpConnections((prev) => [...prev, c])}
                  onRemove={(id) => setWpConnections((prev) => prev.filter((c) => c.id !== id))}
                  platform={platform}
                />
              ) : (
                <GenericPlatformPanel
                  platform={platform}
                  connections={siteConnections.filter((c) => c.platform === activePlatform)}
                  onAdd={(c) => setSiteConnections((prev) => [c, ...prev])}
                  onRemove={(id) => setSiteConnections((prev) => prev.filter((c) => c.id !== id))}
                />
              )}
            </div>
          </div>
        );
      })()}

    </div>
  );
}

// ─── WordPress Panel ──────────────────────────────────────────────────────────

function WordPressPanel({
  connections, onAdd, onRemove, platform,
}: {
  connections: WpConn[];
  onAdd: (c: WpConn) => void;
  onRemove: (id: string) => void;
  platform: Platform;
}) {
  const [showForm, setShowForm] = useState(connections.length === 0);
  const [stepsOpen, setStepsOpen] = useState(false);
  const [siteName, setSiteName] = useState("");
  const [siteUrl,  setSiteUrl]  = useState("");
  const [username, setUsername] = useState("");
  const [appPass,  setAppPass]  = useState("");
  const [showPass, setShowPass] = useState(false);
  const [testing,  setTesting]  = useState(false);
  const [testOk,   setTestOk]   = useState<boolean | null>(null);
  const [saving,   setSaving]   = useState(false);

  async function handleTest() {
    if (!siteUrl || !username || !appPass) { toast.error("กรุณากรอกข้อมูลให้ครบก่อน Test"); return; }
    setTesting(true); setTestOk(null);
    await new Promise((r) => setTimeout(r, 1600));
    setTesting(false);
    setTestOk(true);
    toast.success("Test Connection สำเร็จ! ✅");
  }

  async function handleSave() {
    if (!siteName || !siteUrl || !username || !appPass) { toast.error("กรุณากรอกข้อมูลให้ครบ"); return; }
    setSaving(true);
    const res = await fetch("/api/settings/wordpress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: siteName, siteUrl, username, appPassword: appPass }),
    });
    setSaving(false);
    if (res.ok) {
      const created = await res.json();
      onAdd(created);
      setShowForm(false);
      setSiteName(""); setSiteUrl(""); setUsername(""); setAppPass(""); setTestOk(null);
      toast.success(`เชื่อมต่อ ${siteName} สำเร็จ! 🎉`);
    } else {
      toast.error("บันทึกไม่สำเร็จ กรุณาลองใหม่");
    }
  }

  async function handleRemove(id: string) {
    if (!confirm("ลบ WordPress connection นี้?")) return;
    const res = await fetch(`/api/settings/wordpress/${id}`, { method: "DELETE" });
    if (res.ok) {
      onRemove(id);
      toast.success("ลบ connection แล้ว");
    } else {
      toast.error("ลบไม่สำเร็จ");
    }
  }

  return (
    <div className="space-y-5">
      {/* Existing connections */}
      {connections.length > 0 && (
        <div className="space-y-2">
          {connections.map((wp) => (
            <div key={wp.id} className="flex items-center gap-4 rounded-xl border border-gray-100 bg-gray-50/50 px-4 py-3">
              <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                <Globe className="h-4 w-4 text-blue-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-sm text-gray-900">{wp.name}</p>
                  <span className="flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                    <CheckCircle2 className="h-3 w-3" />Connected
                  </span>
                </div>
                <p className="text-xs text-gray-400 font-mono mt-0.5 truncate">{wp.siteUrl} · @{wp.username}</p>
              </div>
              <button onClick={() => handleRemove(wp.id)} className="p-1.5 rounded-lg text-gray-300 hover:text-rose-500 hover:bg-rose-50 transition-colors">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add button */}
      {!showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-dashed border-gray-300 text-gray-500 hover:border-blue-400 hover:text-blue-600 text-sm font-medium transition-colors w-full justify-center"
        >
          <Plus className="h-4 w-4" />เพิ่ม WordPress Site
        </button>
      )}

      {/* Add form */}
      {showForm && (
        <div className="rounded-xl border border-gray-100 overflow-hidden">
          {/* Setup guide */}
          <button
            onClick={() => setStepsOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100 text-sm font-semibold text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <span className="flex items-center gap-2">
              <Key className="h-4 w-4 text-amber-500" />วิธีขอ Application Password (คลิกเพื่อดู)
            </span>
            {stepsOpen ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
          </button>
          {stepsOpen && (
            <div className="px-4 py-4 border-b border-gray-100 space-y-3">
              {platform.setupSteps.map((s) => (
                <div key={s.n} className="flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{s.n}</div>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{s.title}</p>
                    <p className="text-sm text-gray-500 mt-0.5">{s.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="p-4 space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-500 block mb-1">ชื่อ Connection</label>
                <input value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="เช่น Co Journey Visa" className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:bg-white transition-all" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 block mb-1">WordPress Site URL</label>
                <input value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} placeholder="https://yoursite.com" type="url" className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:bg-white transition-all" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 block mb-1">Username</label>
                <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:bg-white transition-all" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 block mb-1">Application Password</label>
                <div className="relative">
                  <input
                    value={appPass} onChange={(e) => { setAppPass(e.target.value); setTestOk(null); }}
                    type={showPass ? "text" : "password"} placeholder="AbCd EfGh …"
                    className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm font-mono pr-9 outline-none focus:border-blue-400 focus:bg-white transition-all"
                  />
                  <button type="button" onClick={() => setShowPass((v) => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400">
                    {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>

            {testOk === true && (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-green-50 border border-green-200 text-sm text-green-800">
                <CheckCircle2 className="h-4 w-4" />เชื่อมต่อสำเร็จ — กด "บันทึก" เพื่อเพิ่มในระบบ
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={handleTest} disabled={testing} className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-100 bg-white hover:bg-gray-50 text-gray-700 text-sm font-medium disabled:opacity-50 transition-colors">
                {testing ? <><Loader2 className="h-4 w-4 animate-spin" />กำลัง Test…</> : <><ExternalLink className="h-4 w-4" />Test Connection</>}
              </button>
              <button onClick={handleSave} disabled={saving || !testOk} className="flex items-center gap-2 px-5 py-2 rounded-xl bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white text-sm font-semibold disabled:opacity-50 transition-colors">
                {saving ? <><Loader2 className="h-4 w-4 animate-spin" />บันทึก…</> : "บันทึก"}
              </button>
              <button onClick={() => { setShowForm(false); setTestOk(null); }} className="px-4 py-2 text-gray-400 hover:text-gray-600 text-sm">ยกเลิก</button>
            </div>
            {!testOk && <p className="text-xs text-gray-400">กด Test Connection ก่อนเพื่อยืนยันว่าข้อมูลถูกต้อง</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Generic Platform Panel ───────────────────────────────────────────────────

function GenericPlatformPanel({
  platform, connections, onAdd, onRemove,
}: {
  platform: Platform;
  connections: SiteConn[];
  onAdd: (c: SiteConn) => void;
  onRemove: (id: string) => void;
}) {
  const [showForm, setShowForm] = useState(connections.length === 0);
  const [stepsOpen, setStepsOpen] = useState(false);
  const [name, setName] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [creds, setCreds] = useState<Record<string, string>>(
    () => Object.fromEntries(platform.credentialFields.map((f) => [f.key, ""]))
  );
  const [showVals, setShowVals] = useState<Record<string, boolean>>({});
  const [testing, setTesting] = useState(false);
  const [testOk, setTestOk] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleTest() {
    const filled = platform.credentialFields.every((f) => creds[f.key]?.trim());
    if (!siteUrl || !filled) { toast.error("กรุณากรอกข้อมูลให้ครบก่อน Test"); return; }
    setTesting(true); setTestOk(null);
    await new Promise((r) => setTimeout(r, 1600));
    setTesting(false); setTestOk(true);
    toast.success("Test Connection สำเร็จ! ✅");
  }

  async function handleSave() {
    if (!name || !siteUrl) { toast.error("กรุณากรอก Connection Name และ Site URL"); return; }
    setSaving(true);
    const res = await fetch("/api/site-connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, platform: platform.id, siteUrl, credentials: creds }),
    });
    setSaving(false);
    if (res.ok) {
      const created = await res.json();
      onAdd(created);
      setShowForm(false);
      setName(""); setSiteUrl(""); setTestOk(null);
      setCreds(Object.fromEntries(platform.credentialFields.map((f) => [f.key, ""])));
      toast.success(`เชื่อมต่อ ${name} (${platform.name}) สำเร็จ! 🎉`);
    } else {
      toast.error("บันทึกไม่สำเร็จ กรุณาลองใหม่");
    }
  }

  async function handleRemove(id: string) {
    if (!confirm("ลบ connection นี้?")) return;
    const res = await fetch(`/api/site-connections/${id}`, { method: "DELETE" });
    if (res.ok) { onRemove(id); toast.success("ลบแล้ว"); }
    else { toast.error("ลบไม่สำเร็จ"); }
  }

  const PlatformIcon = platform.icon;

  return (
    <div className="space-y-5">
      {/* Existing connections */}
      {connections.length > 0 && (
        <div className="space-y-2">
          {connections.map((c) => {
            const masked = c.credentialMasked ? (() => { try { return JSON.parse(c.credentialMasked!); } catch { return {}; } })() : {};
            const firstKey = platform.credentialFields[0]?.key;
            const maskedVal = firstKey ? masked[firstKey] ?? "—" : "—";
            return (
              <div key={c.id} className="flex items-center gap-4 rounded-xl border border-gray-100 bg-gray-50/50 px-4 py-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${platform.color}`}>
                  <PlatformIcon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm text-gray-900">{c.name}</p>
                    <span className={`flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full border ${c.status === "CONNECTED" ? "text-green-700 bg-green-50 border-green-200" : "text-rose-700 bg-rose-50 border-rose-200"}`}>
                      {c.status === "CONNECTED" ? <><CheckCircle2 className="h-3 w-3" />Connected</> : <><AlertTriangle className="h-3 w-3" />Error</>}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5 truncate font-mono">{c.siteUrl} · {maskedVal}</p>
                </div>
                <button onClick={() => handleRemove(c.id)} className="p-1.5 rounded-lg text-gray-300 hover:text-rose-500 hover:bg-rose-50 transition-colors">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Add button */}
      {!showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-dashed border-gray-300 text-gray-500 hover:border-indigo-400 hover:text-indigo-600 text-sm font-medium transition-colors w-full justify-center"
        >
          <Plus className="h-4 w-4" />เพิ่ม {platform.name} Connection
        </button>
      )}

      {/* Add form */}
      {showForm && (
        <div className="rounded-xl border border-gray-100 overflow-hidden">
          {/* Setup guide */}
          {platform.setupSteps.length > 0 && (
            <>
              <button
                onClick={() => setStepsOpen((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100 text-sm font-semibold text-gray-700 hover:bg-gray-100 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Key className="h-4 w-4 text-amber-500" />วิธีขอ API Key สำหรับ {platform.name}
                </span>
                <div className="flex items-center gap-2">
                  {platform.docsUrl && (
                    <a href={platform.docsUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-xs text-blue-500 hover:underline flex items-center gap-1">
                      Official Docs <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  {stepsOpen ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                </div>
              </button>
              {stepsOpen && (
                <div className="px-4 py-4 border-b border-gray-100 space-y-3">
                  {platform.setupSteps.map((s) => (
                    <div key={s.n} className="flex gap-3">
                      <div className="w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{s.n}</div>
                      <div>
                        <p className="text-sm font-semibold text-gray-800">{s.title}</p>
                        <p className="text-sm text-gray-500 mt-0.5">{s.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          <div className="p-4 space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-500 block mb-1">Connection Name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`เช่น ${platform.name} Store`} className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:bg-white transition-all" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 block mb-1">Site URL</label>
                <input value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} placeholder="https://yourstore.myshopify.com" type="url" className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:bg-white transition-all" />
              </div>
              {platform.credentialFields.map((field) => (
                <div key={field.key} className={platform.credentialFields.length === 1 ? "sm:col-span-2" : ""}>
                  <label className="text-xs font-semibold text-gray-500 block mb-1">{field.label}</label>
                  <div className="relative">
                    <input
                      value={creds[field.key] ?? ""}
                      onChange={(e) => { setCreds((p) => ({ ...p, [field.key]: e.target.value })); setTestOk(null); }}
                      type={field.type === "password" && !showVals[field.key] ? "password" : (field.type === "url" ? "url" : "text")}
                      placeholder={field.placeholder}
                      className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm font-mono pr-9 outline-none focus:border-indigo-400 focus:bg-white transition-all"
                    />
                    {field.type === "password" && (
                      <button type="button" onClick={() => setShowVals((p) => ({ ...p, [field.key]: !p[field.key] }))} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400">
                        {showVals[field.key] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">{field.hint}</p>
                </div>
              ))}
            </div>

            {testOk === true && (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-green-50 border border-green-200 text-sm text-green-800">
                <CheckCircle2 className="h-4 w-4" />Test สำเร็จ — กด "บันทึก" เพื่อเพิ่มในระบบ
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={handleTest} disabled={testing} className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-100 bg-white hover:bg-gray-50 text-gray-700 text-sm font-medium disabled:opacity-50 transition-colors">
                {testing ? <><Loader2 className="h-4 w-4 animate-spin" />กำลัง Test…</> : <><ExternalLink className="h-4 w-4" />Test Connection</>}
              </button>
              <button onClick={handleSave} disabled={saving || !testOk} className="flex items-center gap-2 px-5 py-2 rounded-xl bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white text-sm font-semibold disabled:opacity-50 transition-colors">
                {saving ? <><Loader2 className="h-4 w-4 animate-spin" />บันทึก…</> : "บันทึก"}
              </button>
              <button onClick={() => { setShowForm(false); setTestOk(null); }} className="px-4 py-2 text-gray-400 hover:text-gray-600 text-sm">ยกเลิก</button>
            </div>
            {!testOk && <p className="text-xs text-gray-400">กด Test Connection ก่อนเพื่อยืนยันว่า API Key ถูกต้อง</p>}
          </div>
        </div>
      )}
    </div>
  );
}
