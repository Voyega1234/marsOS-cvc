"use client";

/**
 * แท็บ Connect Website — เชื่อมเว็บปลายทางของลูกค้า Upload Article รายนี้
 * หน้าตา/พฤติกรรมอ้างอิงจาก ProjectWebsitePanel.tsx (อ่านอย่างเดียว ไม่แก้ไฟล์เดิม)
 * ผูกกับ endpoint ใหม่ /api/upload-article/clients/{id} และ /connect-test
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Globe, Loader2, Plug, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { UploadClientDTO } from "@/lib/upload-article/types";
import {
  UPLOAD_PLATFORM_LABEL, uploadPlatformOf, pushTargetUrl, pushTargetDetail, missingConnectionFields,
} from "@/lib/upload-article/platform-info";
import ConnectHowTo from "../settings/ConnectHowTo";

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
  // ค่าที่ไม่ใช่ secret ของทุกแพลตฟอร์มถูกส่งกลับมาแบบไม่ mask → เติมล่วงหน้า (secret ไม่เติม)
  const PLAIN_KEYS: Record<string, readonly string[]> = {
    webflow: ["collectionId", "collectionSlug", "siteUrl", "bodyField", "imageField", "descriptionField", "seoTitleField"],
    shopify: ["storeDomain", "blogId", "blogHandle"],
    wix: ["siteId", "memberId"],
    custom: ["webhookUrl"],
  };
  const [siteConn, setSiteConn] = useState<Record<string, Record<string, string>>>((): Record<string, Record<string, string>> => {
    const out: Record<string, Record<string, string>> = {};
    for (const [plat, keys] of Object.entries(PLAIN_KEYS)) {
      const o: Record<string, string> = {};
      for (const k of keys) { const v = client.siteConnectionMasked?.[`${plat}.${k}`]; if (v) o[k] = v; }
      if (Object.keys(o).length) out[plat] = o;
    }
    return out;
  });
  const [shBlogs, setShBlogs] = useState<{ id: string; title: string; handle: string }[]>([]);
  const [wixMembers, setWixMembers] = useState<{ id: string; name: string }[]>([]);
  const [wfCollections, setWfCollections] = useState<{ id: string; name: string; slug: string }[]>([]);
  const [wfFields, setWfFields] = useState<{ slug: string; displayName: string; type: string }[]>([]);
  const setConnField = (plat: string, key: string, val: string) =>
    setSiteConn(prev => ({ ...prev, [plat]: { ...(prev[plat] ?? {}), [key]: val } }));

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [lastTest, setLastTest] = useState<{ ok: boolean; message: string; platform: PlatformId } | null>(null);

  async function loadWfFields(collectionId: string) {
    setWfFields([]);
    if (!collectionId) return;
    try {
      const r = await fetch(`/api/upload-article/clients/${client.id}/webflow-fields?collectionId=${encodeURIComponent(collectionId)}`);
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        setWfFields(d.fields ?? []);
        if (d.collectionSlug) setConnField("webflow", "collectionSlug", d.collectionSlug);
      } else toast.error(d?.error || "ดึงฟิลด์ของ Collection ไม่สำเร็จ");
    } catch { toast.error("ดึงฟิลด์ของ Collection ไม่สำเร็จ"); }
  }

  // เปิดหน้ามาแล้วมี Collection ที่บันทึกไว้ → โหลดรายการฟิลด์ให้เลือกต่อได้เลย
  useEffect(() => {
    if (platform === "webflow" && client.siteConnectionMasked?.["webflow.collectionId"] && client.siteConnectionMasked?.["webflow.apiToken"]) {
      void loadWfFields(client.siteConnectionMasked["webflow.collectionId"]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        setLastTest({ ok: true, message: d.message || "เชื่อมต่อสำเร็จ", platform });
        if (platform === "webflow") {
          setWfCollections(d.choices?.collections ?? []);
          if (d.url) setConnField("webflow", "siteUrl", d.url);
        }
        if (platform === "shopify") setShBlogs(d.choices?.blogs ?? []);
        if (platform === "wix") setWixMembers(d.choices?.members ?? []);
      } else {
        const m = d.message || d.error || "เชื่อมต่อไม่สำเร็จ";
        setTestResult({ ok: false, message: m });
        setLastTest({ ok: false, message: m, platform });
      }
    } catch (e) {
      const m = `เชื่อมต่อไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`;
      setTestResult({ ok: false, message: m });
      setLastTest({ ok: false, message: m, platform });
    } finally {
      setTesting(false);
    }
  }

  const savedPlatform = uploadPlatformOf(client);
  const savedLabel = UPLOAD_PLATFORM_LABEL[savedPlatform];
  const missing = missingConnectionFields(client);
  const targetUrl = pushTargetUrl(client);
  const targetDetail = pushTargetDetail(client);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,42rem)_minmax(0,1fr)] gap-4 items-start">
    <div className="space-y-4 min-w-0">
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
        <p className="text-sm font-semibold text-brand-navy">ตอนนี้เชื่อมต่อกับ</p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-brand-mist text-brand-blue border border-brand-soft/60">{savedLabel}</span>
          {targetUrl && <span className="text-xs text-gray-600 break-all">{targetUrl}</span>}
          {targetDetail && <span className="text-xs text-gray-400">· {targetDetail}</span>}
        </div>
        {missing.length === 0 ? (
          <p className="flex items-center gap-1.5 text-xs text-emerald-700"><CheckCircle2 size={13} /> ตั้งค่าครบ</p>
        ) : (
          <p className="flex items-start gap-1.5 text-xs text-amber-700"><AlertTriangle size={13} className="shrink-0 mt-0.5" /> ยังขาด: {missing.join(", ")}</p>
        )}
        {lastTest && (
          <p className={`text-xs ${lastTest.ok ? "text-emerald-700" : "text-red-600"}`}>
            ผลทดสอบล่าสุด ({UPLOAD_PLATFORM_LABEL[lastTest.platform]}): {lastTest.message}
          </p>
        )}
        <p className="text-[11px] text-gray-400">Push / สแกนเว็บ / สไตล์บทความ จะทำงานแบบ {savedLabel} ตามที่เลือกไว้</p>
        {platform !== savedPlatform && (
          <p className="text-[11px] text-amber-700 bg-amber-50 rounded-lg px-2 py-1">
            ยังไม่บันทึก — กดบันทึกเพื่อสลับไปใช้ {UPLOAD_PLATFORM_LABEL[platform]}
          </p>
        )}
      </div>

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
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-gray-600 mb-1">Blog ที่จะลงบทความ (กดทดสอบการเชื่อมต่อก่อนเพื่อโหลดรายการ)</label>
              {(() => {
                const sh = siteConn.shopify ?? {};
                const bid = sh.blogId ?? "";
                return (
                  <select value={bid}
                    onChange={e => {
                      const b = shBlogs.find(x => x.id === e.target.value);
                      setConnField("shopify", "blogId", e.target.value);
                      setConnField("shopify", "blogHandle", b?.handle ?? "");
                    }}
                    className="w-full h-10 rounded-md border border-gray-200 px-3 text-sm bg-white">
                    <option value="">บล็อกแรกของร้าน (อัตโนมัติ)</option>
                    {bid && !shBlogs.some(b => b.id === bid) && <option value={bid}>{sh.blogHandle || bid}</option>}
                    {shBlogs.map(b => <option key={b.id} value={b.id}>{b.title} ({b.handle})</option>)}
                  </select>
                );
              })()}
            </div>
          </div>
        )}

        {platform === "webflow" && (() => {
          const wf = siteConn.webflow ?? {};
          const colId = wf.collectionId ?? "";
          const colOptions = colId && !wfCollections.some(c => c.id === colId)
            ? [{ id: colId, name: wf.collectionSlug || colId, slug: wf.collectionSlug ?? "" }, ...wfCollections]
            : wfCollections;
          const fieldSelect = (key: string, label: string, type: string, emptyLabel: string) => (
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">{label}</label>
              <select value={wf[key] || "none"} onChange={e => setConnField("webflow", key, e.target.value)}
                className="w-full h-10 rounded-md border border-gray-200 px-3 text-sm bg-white">
                <option value="none">{emptyLabel}</option>
                {/* ค่าที่บันทึกไว้แต่ยังโหลดรายการฟิลด์ไม่ได้ (token หมดอายุ/ยังไม่กดทดสอบ) — ยังแสดงค่าเดิม */}
                {wf[key] && wf[key] !== "none" && !wfFields.some(f => f.slug === wf[key]) && <option value={wf[key]}>{wf[key]}</option>}
                {wfFields.filter(f => f.type === type).map(f => <option key={f.slug} value={f.slug}>{f.displayName} ({f.slug})</option>)}
              </select>
            </div>
          );
          return (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Site API token</label>
                <input type="password" value={wf.apiToken ?? ""} onChange={e => setConnField("webflow", "apiToken", e.target.value)}
                  placeholder={maskedPlaceholder("webflow", "apiToken") || "Webflow API token"}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Collection (กดทดสอบการเชื่อมต่อก่อนเพื่อโหลดรายการ)</label>
                <select value={colId}
                  onChange={e => {
                    const c = colOptions.find(x => x.id === e.target.value);
                    setConnField("webflow", "collectionId", e.target.value);
                    setConnField("webflow", "collectionSlug", c?.slug ?? "");
                    void loadWfFields(e.target.value);
                  }}
                  className="w-full h-10 rounded-md border border-gray-200 px-3 text-sm bg-white">
                  <option value="">— เลือก Collection —</option>
                  {colOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              {colId && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {fieldSelect("bodyField", "เนื้อหาบทความ", "RichText", "RichText ตัวแรกอัตโนมัติ")}
                  {fieldSelect("imageField", "รูปปก", "Image", "ไม่ส่งรูปปก")}
                  {fieldSelect("descriptionField", "Meta Description / คำโปรย", "PlainText", "ไม่ส่ง")}
                  {fieldSelect("seoTitleField", "SEO Title", "PlainText", "ไม่ส่ง")}
                </div>
              )}
              {wf.seoTitleField === "name" && (
                <p className="text-[11px] text-amber-700 bg-amber-50 rounded-lg px-2 py-1">
                  Name คือชื่อบทความใน Webflow อยู่แล้ว — map SEO Title ไปช่องนี้จะเขียนทับชื่อด้วย SEO Title
                </p>
              )}
              {wf.imageField && wf.imageField.toLowerCase().includes("thumb") && (
                <p className="text-[11px] text-amber-700 bg-amber-50 rounded-lg px-2 py-1">
                  ช่อง &quot;{wf.imageField}&quot; น่าจะเป็นรูปย่อ (thumbnail) — หน้าบทความมักแสดงฟิลด์ &quot;Main Image&quot; แนะนำให้เลือกฟิลด์นั้นเป็นรูปปก
                </p>
              )}
              <p className="text-[11px] text-gray-400">
                Webflow: รูปในบทความจะอัปโหลดเข้า Assets ของเว็บอัตโนมัติ (token ต้องมีสิทธิ์ CMS + Assets read/write) · ฟิลด์ที่ไม่ได้เลือกจะไม่ถูกเขียน · สไตล์/กล่องพิเศษในบทความจะเหลือเป็น HTML พื้นฐานตามที่ RichText ของ Webflow รองรับ
              </p>
            </div>
          );
        })()}

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
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-gray-600 mb-1">ผู้เขียน (Member) — กดทดสอบการเชื่อมต่อก่อน</label>
              {(() => {
                const mid = siteConn.wix?.memberId ?? "";
                return wixMembers.length > 0 ? (
                  <select value={mid} onChange={e => setConnField("wix", "memberId", e.target.value)}
                    className="w-full h-10 rounded-md border border-gray-200 px-3 text-sm bg-white">
                    <option value="">— เลือกผู้เขียน —</option>
                    {mid && !wixMembers.some(m => m.id === mid) && <option value={mid}>{mid}</option>}
                    {wixMembers.map(m => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}
                  </select>
                ) : (
                  <Input value={mid} onChange={e => setConnField("wix", "memberId", e.target.value)}
                    placeholder="Member ID (หรือกดทดสอบการเชื่อมต่อเพื่อโหลดรายการ)" />
                );
              })()}
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
    <div className="lg:sticky lg:top-4 min-w-0">
      <ConnectHowTo platform={platform} />
    </div>
    </div>
  );
}
