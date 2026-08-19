"use client";

/**
 * Connect Website — แผงผูกเว็บไซต์ของ client รายโปรเจกต์ (Project Settings › Website)
 *
 * แต่ละลูกค้าเชื่อมเว็บคนละที่ รองรับทุกแพลตฟอร์มแบบ push ได้จริง:
 * - WordPress: Application Password (REST API)
 * - Shopify: Admin API token → ลง Blog / Webflow: API token → ลง CMS item
 * - Wix: API Key + Site ID → draft post / Custom: Webhook ของระบบเว็บลูกค้าเอง
 * credentials อื่นที่ไม่ใช่ WP เก็บใน Project.siteConnection (ดู src/lib/sitePublishers.ts)
 */
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Globe, Loader2, Plug, XCircle } from "lucide-react";

const PLATFORMS = [
  { id: "wordpress", label: "WordPress", note: "เชื่อมเต็มรูปแบบด้วย Application Password — scan + push อัตโนมัติ" },
  { id: "webflow", label: "Webflow", note: "ใช้ Site API token — ระบบลงบทความเข้า CMS Collection ให้อัตโนมัติ" },
  { id: "wix", label: "Wix", note: "ใช้ API Key + Site ID — ระบบสร้างโพสต์ในบล็อก Wix ให้อัตโนมัติ" },
  { id: "shopify", label: "Shopify", note: "ใช้ Admin API access token — ระบบลงบทความเข้า Blog ของร้านให้อัตโนมัติ" },
  { id: "custom", label: "อื่น ๆ / Custom", note: "ระบบ POST บทความ (JSON) ไปยัง Webhook ของเว็บลูกค้า — รองรับทุกระบบที่เขียนรับเองได้" },
] as const;

type PlatformId = (typeof PLATFORMS)[number]["id"];

interface Props {
  projectId: string;
  onSaved?: () => void;
}

export function ProjectWebsitePanel({ projectId, onSaved }: Props) {
  const [loading, setLoading] = useState(true);
  const [platform, setPlatform] = useState<PlatformId>("wordpress");
  const [website, setWebsite] = useState("");
  const [wpUser, setWpUser] = useState("");
  const [wpAppPassword, setWpAppPassword] = useState("");
  const [hasStoredPassword, setHasStoredPassword] = useState(false);
  // credentials ของแพลตฟอร์มอื่น (เก็บรวมใน Project.siteConnection)
  const [siteConn, setSiteConn] = useState<Record<string, Record<string, string>>>({});
  const [choices, setChoices] = useState<{ blogs?: Array<{ id: string; title: string; handle: string }>; collections?: Array<{ id: string; name: string; slug: string }> }>({});
  const setConnField = (plat: string, key: string, val: string) =>
    setSiteConn(prev => ({ ...prev, [plat]: { ...(prev[plat] ?? {}), [key]: val } }));
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/projects/${projectId}`);
        if (!r.ok) return;
        const p = await r.json();
        if (!alive) return;
        setWebsite(p.wpUrl || p.website || "");
        setWpUser(p.wpUser || "");
        setHasStoredPassword(!!p.wpAppPassword);
        try { setSiteConn(JSON.parse(p.siteConnection || "{}")); } catch { /* ว่าง */ }
        const stored = p.websitePlatform as PlatformId | null;
        if (stored && PLATFORMS.some(x => x.id === stored)) setPlatform(stored);
        else if (p.wpUser || p.wpAppPassword) setPlatform("wordpress");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [projectId]);

  const save = useCallback(async () => {
    setSaving(true);
    setTestResult(null);
    try {
      const body: Record<string, unknown> = {
        websitePlatform: platform,
        website: website.trim(),
        wpUrl: platform === "wordpress" ? website.trim() : null,
        wpUser: platform === "wordpress" ? wpUser.trim() : null,
        siteConnection: JSON.stringify(siteConn),
      };
      // ไม่ทับรหัสเดิมด้วยค่าว่าง — ผู้ใช้เว้นช่องไว้ = คงรหัสที่บันทึกแล้ว
      if (platform === "wordpress") {
        if (wpAppPassword.trim()) body.wpAppPassword = wpAppPassword.trim();
        else if (!hasStoredPassword) body.wpAppPassword = null;
      } else {
        body.wpAppPassword = null;
      }
      const r = await fetch(`/api/projects/${projectId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) {
        if (platform === "wordpress" && wpAppPassword.trim()) {
          setHasStoredPassword(true);
          setWpAppPassword("");
        }
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 2500);
        onSaved?.();
      } else {
        const d = await r.json().catch(() => ({}));
        setTestResult({ ok: false, message: d.error || "บันทึกไม่สำเร็จ" });
      }
    } finally {
      setSaving(false);
    }
  }, [projectId, platform, website, wpUser, wpAppPassword, hasStoredPassword, onSaved]);

  const testConnection = useCallback(async () => {
    setTesting(true);
    // บันทึกค่าที่กรอกก่อนเสมอ — /api/push/connect อ่าน credentials จาก DB
    await save();
    setTestResult(null);
    try {
      const r = await fetch("/api/push/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        if (d.choices) setChoices(d.choices);
        // Webflow: จำ URL เว็บจริงไว้ประกอบลิงก์บทความ
        if (platform === "webflow" && d.url) setConnField("webflow", "siteUrl", d.url);
        setTestResult({
          ok: true,
          message: `เชื่อมต่อสำเร็จ: ${d.name || d.url || website}${d.version ? ` (WordPress ${d.version})` : ""}`,
        });
      } else {
        setTestResult({ ok: false, message: d.error || `เชื่อมต่อไม่สำเร็จ (${r.status})` });
      }
    } catch (e) {
      setTestResult({ ok: false, message: `เชื่อมต่อไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setTesting(false);
    }
  }, [projectId, website, save]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-gray-400">
        <Loader2 size={14} className="animate-spin" /> กำลังโหลดการตั้งค่าเว็บไซต์...
      </div>
    );
  }

  const platformInfo = PLATFORMS.find(x => x.id === platform)!;

  return (
    <div className="space-y-4">
      {/* Platform */}
      <div>
        <label className="block text-xs font-semibold text-brand-navy mb-1.5">แพลตฟอร์มเว็บไซต์</label>
        <div className="flex flex-wrap gap-1.5">
          {PLATFORMS.map(p => (
            <button key={p.id} onClick={() => { setPlatform(p.id); setTestResult(null); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                platform === p.id
                  ? "bg-brand-mist text-brand-blue border-brand-soft/60"
                  : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
              }`}>
              {p.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-gray-400">{platformInfo.note}</p>
      </div>

      {/* URL */}
      <div>
        <label className="block text-xs font-semibold text-brand-navy mb-1.5">Website URL</label>
        <div className="relative">
          <Globe size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-300" />
          <input value={website} onChange={e => setWebsite(e.target.value)}
            placeholder="https://www.example.com"
            className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-soft/50" />
        </div>
      </div>

      {/* WordPress credentials */}
      {platform === "wordpress" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-brand-navy mb-1.5">WP Username</label>
            <input value={wpUser} onChange={e => setWpUser(e.target.value)}
              placeholder="admin"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-soft/50" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-brand-navy mb-1.5">
              Application Password
              {hasStoredPassword && <span className="ml-1.5 font-normal text-emerald-600">(บันทึกแล้ว — เว้นว่างเพื่อใช้ค่าเดิม)</span>}
            </label>
            <input value={wpAppPassword} onChange={e => setWpAppPassword(e.target.value)} type="password"
              placeholder={hasStoredPassword ? "••••••••" : "xxxx xxxx xxxx xxxx"}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-soft/50" />
            <p className="mt-1 text-[11px] text-gray-400">
              สร้างได้ที่ WP Admin › Users › Profile › Application Passwords
            </p>
          </div>
        </div>
      )}

      {/* Shopify credentials */}
      {platform === "shopify" && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-brand-navy mb-1.5">Store domain</label>
              <input value={siteConn.shopify?.storeDomain ?? ""} onChange={e => setConnField("shopify", "storeDomain", e.target.value)}
                placeholder="your-store.myshopify.com"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-soft/50" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-brand-navy mb-1.5">Admin API access token</label>
              <input type="password" value={siteConn.shopify?.accessToken ?? ""} onChange={e => setConnField("shopify", "accessToken", e.target.value)}
                placeholder="shpat_..."
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-soft/50" />
              <p className="mt-1 text-[11px] text-gray-400">สร้างจาก Shopify Admin › Settings › Apps › Develop apps (สิทธิ์ write_content)</p>
            </div>
          </div>
          {choices.blogs && choices.blogs.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-brand-navy mb-1.5">ลงบทความที่ Blog</label>
              <select value={siteConn.shopify?.blogId ?? ""}
                onChange={e => {
                  const b = choices.blogs?.find(x => x.id === e.target.value);
                  setConnField("shopify", "blogId", e.target.value);
                  if (b) setConnField("shopify", "blogHandle", b.handle);
                }}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl bg-white">
                <option value="">— Blog แรกของร้าน (อัตโนมัติ) —</option>
                {choices.blogs.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Webflow credentials */}
      {platform === "webflow" && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-brand-navy mb-1.5">Site API token</label>
            <input type="password" value={siteConn.webflow?.apiToken ?? ""} onChange={e => setConnField("webflow", "apiToken", e.target.value)}
              placeholder="Webflow API token"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-soft/50" />
            <p className="mt-1 text-[11px] text-gray-400">Webflow › Site settings › Apps & integrations › API access (สิทธิ์ CMS read/write)</p>
          </div>
          {choices.collections && choices.collections.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-brand-navy mb-1.5">ลงบทความที่ Collection</label>
              <select value={siteConn.webflow?.collectionId ?? ""}
                onChange={e => setConnField("webflow", "collectionId", e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl bg-white">
                <option value="">— เลือก Collection (เช่น Blog Posts) —</option>
                {choices.collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <p className="mt-1 text-[11px] text-gray-400">เนื้อหาจะลงใน RichText field ตัวแรกของ Collection อัตโนมัติ</p>
            </div>
          )}
        </div>
      )}

      {/* Wix credentials */}
      {platform === "wix" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-brand-navy mb-1.5">API Key</label>
            <input type="password" value={siteConn.wix?.apiKey ?? ""} onChange={e => setConnField("wix", "apiKey", e.target.value)}
              placeholder="IST...."
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-soft/50" />
            <p className="mt-1 text-[11px] text-gray-400">wix.com/my-account/api-keys (สิทธิ์ Blog)</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-brand-navy mb-1.5">Site ID</label>
            <input value={siteConn.wix?.siteId ?? ""} onChange={e => setConnField("wix", "siteId", e.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-soft/50" />
            <p className="mt-1 text-[11px] text-gray-400">จาก URL ของ Dashboard: manage.wix.com/dashboard/&lt;site-id&gt;</p>
          </div>
        </div>
      )}

      {/* Custom webhook */}
      {platform === "custom" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-brand-navy mb-1.5">Webhook URL</label>
            <input value={siteConn.custom?.webhookUrl ?? ""} onChange={e => setConnField("custom", "webhookUrl", e.target.value)}
              placeholder="https://www.example.com/api/mars-article"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-soft/50" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-brand-navy mb-1.5">Secret (ไม่บังคับ)</label>
            <input type="password" value={siteConn.custom?.secret ?? ""} onChange={e => setConnField("custom", "secret", e.target.value)}
              placeholder="ส่งไปใน header X-Mars-Secret"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-soft/50" />
          </div>
          <p className="sm:col-span-2 text-[11px] text-gray-400 leading-4">
            ระบบจะ POST JSON: {"{ event: 'article.publish', title, slug, html, excerpt, coverImageBase64, publishMode }"} — เว็บลูกค้าเขียนตัวรับสั้น ๆ ก็ใช้ได้กับทุกระบบ
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <button onClick={save} disabled={saving || !website.trim()}
          className="px-4 py-2 rounded-xl text-xs font-semibold bg-brand-blue text-white hover:opacity-90 disabled:opacity-40 transition-opacity">
          {saving ? "กำลังบันทึก..." : savedFlash ? "บันทึกแล้ว ✓" : "บันทึกการเชื่อมต่อ"}
        </button>
        {(
          <button onClick={testConnection} disabled={testing || (platform === "wordpress" && !website.trim())}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors">
            {testing ? <Loader2 size={12} className="animate-spin" /> : <Plug size={12} />}
            ทดสอบการเชื่อมต่อ
          </button>
        )}
      </div>

      {testResult && (
        <div className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs ${
          testResult.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"
        }`}>
          {testResult.ok ? <CheckCircle2 size={14} className="shrink-0 mt-0.5" /> : <XCircle size={14} className="shrink-0 mt-0.5" />}
          <span>{testResult.message}</span>
        </div>
      )}
    </div>
  );
}
