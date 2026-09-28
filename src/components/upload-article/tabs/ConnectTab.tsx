"use client";

/**
 * แท็บ Connect Website — เชื่อมเว็บปลายทางของลูกค้า Upload Article รายนี้
 * หน้าตา/พฤติกรรมอ้างอิงจาก ProjectWebsitePanel.tsx (อ่านอย่างเดียว ไม่แก้ไฟล์เดิม)
 * ผูกกับ endpoint ใหม่ /api/upload-article/clients/{id} และ /connect-test
 */
import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Globe, Loader2, Plug, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { UploadClientDTO } from "@/lib/upload-article/types";

const PLATFORMS = [
  { id: "wordpress", label: "WordPress" },
  { id: "webflow", label: "Webflow" },
  { id: "wix", label: "Wix" },
  { id: "shopify", label: "Shopify" },
  { id: "custom", label: "อื่น ๆ / Custom" },
] as const;
type PlatformId = (typeof PLATFORMS)[number]["id"];

export default function ConnectTab({
  client, setClient,
}: {
  client: UploadClientDTO;
  setClient: (c: UploadClientDTO) => void;
}) {
  const [name, setName] = useState(client.name);
  const [website, setWebsite] = useState(client.website);
  const [language, setLanguage] = useState<"th" | "en" | "both">(client.language);
  const [platform, setPlatform] = useState<PlatformId>((client.websitePlatform as PlatformId) || "wordpress");
  const [wpUrl, setWpUrl] = useState(client.wpUrl);
  const [wpUser, setWpUser] = useState(client.wpUser);
  const [wpAppPassword, setWpAppPassword] = useState("");
  const [siteConn, setSiteConn] = useState<Record<string, Record<string, string>>>({});
  const setConnField = (plat: string, key: string, val: string) =>
    setSiteConn(prev => ({ ...prev, [plat]: { ...(prev[plat] ?? {}), [key]: val } }));

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  function maskedPlaceholder(plat: string, key: string): string {
    return client.siteConnectionMasked?.[`${plat}.${key}`] ?? "";
  }

  async function save(): Promise<boolean> {
    setSaving(true);
    setTestResult(null);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        website: website.trim(),
        language,
        websitePlatform: platform,
        wpUrl: platform === "wordpress" ? wpUrl.trim() : "",
        wpUser: platform === "wordpress" ? wpUser.trim() : "",
        siteConnection: siteConn,
      };
      if (platform === "wordpress" && wpAppPassword.trim()) body.wpAppPassword = wpAppPassword.trim();
      const r = await fetch(`/api/upload-article/clients/${client.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "บันทึกไม่สำเร็จ"); return false; }
      setClient(d);
      if (wpAppPassword.trim()) setWpAppPassword("");
      toast.success("บันทึกแล้ว");
      if (d.wpPasswordCleared) toast.warning("เปลี่ยนเว็บ/ผู้ใช้แล้ว — กรุณาใส่ Application Password ใหม่");
      if (Array.isArray(d.siteConnectionSecretsCleared) && d.siteConnectionSecretsCleared.length) {
        toast.warning("เปลี่ยนโดเมน/URL แล้ว — กรุณาใส่ key/secret ใหม่ของแพลตฟอร์มนั้นอีกครั้ง");
      }
      return true;
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    const ok = await save();
    if (!ok) { setTesting(false); return; }
    try {
      const r = await fetch(`/api/upload-article/clients/${client.id}/connect-test`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok) {
        setTestResult({ ok: true, message: d.message || "เชื่อมต่อสำเร็จ" });
      } else {
        setTestResult({ ok: false, message: d.message || d.error || "เชื่อมต่อไม่สำเร็จ" });
      }
    } catch (e) {
      setTestResult({ ok: false, message: `เชื่อมต่อไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <p className="text-sm font-semibold text-brand-navy">ข้อมูลลูกค้า</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">ชื่อลูกค้า</label>
            <Input value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">ภาษา</label>
            <select value={language} onChange={e => setLanguage(e.target.value as "th" | "en" | "both")}
              className="w-full h-10 rounded-md border border-gray-200 px-3 text-sm bg-white">
              <option value="th">ไทยเท่านั้น</option>
              <option value="en">อังกฤษเท่านั้น</option>
              <option value="both">ไทย+อังกฤษ</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">เว็บไซต์</label>
          <Input value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://www.example.com" />
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-4">
        <p className="text-sm font-semibold text-brand-navy">เชื่อมต่อเว็บไซต์</p>
        <div className="flex flex-wrap gap-1.5">
          {PLATFORMS.map(p => (
            <button key={p.id} onClick={() => { setPlatform(p.id); setTestResult(null); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                platform === p.id ? "bg-brand-mist text-brand-blue border-brand-soft/60" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
              }`}>
              {p.label}
            </button>
          ))}
        </div>

        {platform === "wordpress" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-gray-600 mb-1">WordPress URL</label>
              <div className="relative">
                <Globe size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-300" />
                <input value={wpUrl} onChange={e => setWpUrl(e.target.value)} placeholder="https://www.example.com"
                  className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-xl" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">WP Username</label>
              <Input value={wpUser} onChange={e => setWpUser(e.target.value)} placeholder="admin" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                Application Password
                {client.hasWpPassword && <span className="ml-1.5 font-normal text-emerald-600">(บันทึกไว้แล้ว — เว้นว่างเพื่อใช้ค่าเดิม)</span>}
              </label>
              <input type="password" value={wpAppPassword} onChange={e => setWpAppPassword(e.target.value)}
                placeholder={client.hasWpPassword ? "••••••••" : "xxxx xxxx xxxx xxxx"}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl" />
            </div>
          </div>
        )}

        {platform === "shopify" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Store domain</label>
              <Input value={siteConn.shopify?.storeDomain ?? ""} onChange={e => setConnField("shopify", "storeDomain", e.target.value)}
                placeholder={maskedPlaceholder("shopify", "storeDomain") || "your-store.myshopify.com"} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Admin API access token</label>
              <input type="password" value={siteConn.shopify?.accessToken ?? ""} onChange={e => setConnField("shopify", "accessToken", e.target.value)}
                placeholder={maskedPlaceholder("shopify", "accessToken") || "shpat_..."}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl" />
            </div>
          </div>
        )}

        {platform === "webflow" && (
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Site API token</label>
            <input type="password" value={siteConn.webflow?.apiToken ?? ""} onChange={e => setConnField("webflow", "apiToken", e.target.value)}
              placeholder={maskedPlaceholder("webflow", "apiToken") || "Webflow API token"}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl" />
          </div>
        )}

        {platform === "wix" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">API Key</label>
              <input type="password" value={siteConn.wix?.apiKey ?? ""} onChange={e => setConnField("wix", "apiKey", e.target.value)}
                placeholder={maskedPlaceholder("wix", "apiKey") || "IST...."}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Site ID</label>
              <Input value={siteConn.wix?.siteId ?? ""} onChange={e => setConnField("wix", "siteId", e.target.value)}
                placeholder={maskedPlaceholder("wix", "siteId") || "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"} />
            </div>
          </div>
        )}

        {platform === "custom" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Webhook URL</label>
              <Input value={siteConn.custom?.webhookUrl ?? ""} onChange={e => setConnField("custom", "webhookUrl", e.target.value)}
                placeholder={maskedPlaceholder("custom", "webhookUrl") || "https://www.example.com/api/content-article"} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Secret (ไม่บังคับ)</label>
              <input type="password" value={siteConn.custom?.secret ?? ""} onChange={e => setConnField("custom", "secret", e.target.value)}
                placeholder={maskedPlaceholder("custom", "secret") || "ส่งไปใน header X-Content-Secret"}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl" />
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button disabled={saving || !website.trim()} onClick={save}>
            {saving ? "กำลังบันทึก..." : "บันทึก"}
          </Button>
          <Button variant="outline" disabled={testing} onClick={testConnection}>
            {testing ? <Loader2 size={12} className="animate-spin mr-1.5" /> : <Plug size={12} className="mr-1.5" />}
            ทดสอบการเชื่อมต่อ
          </Button>
        </div>

        {testResult && (
          <div className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs ${testResult.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
            {testResult.ok ? <CheckCircle2 size={14} className="shrink-0 mt-0.5" /> : <XCircle size={14} className="shrink-0 mt-0.5" />}
            <span>{testResult.message}</span>
          </div>
        )}
      </div>
    </div>
  );
}
