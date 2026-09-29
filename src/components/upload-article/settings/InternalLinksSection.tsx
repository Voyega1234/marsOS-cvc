"use client";

/**
 * Settings > "Internal Link" — ลิงก์ภายในที่ AI ใช้แทรกตอนเขียนบทความ
 * หน้าตาอ้างอิงจาก Internal Link ของ Article Lab (ClientDetailTabs.tsx, sub-tab "sitelink")
 * แหล่งข้อมูล: GSC (ดึงจาก Search Console) + เพิ่มเอง (manual) — ยังไม่ทับกัน จนกดบันทึก
 * บันทึกทับทั้งก้อนที่ PUT .../internal-links แล้วอ่านกลับจาก GET เพื่อพิสูจน์ว่าบันทึกจริง
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_UPLOAD_INTERNAL_LINKS, type UploadInternalLinks, type UploadLinkPair } from "@/lib/upload-article/types";
import type { ArticleLinkRow } from "@/lib/upload-article/internal-links";

export default function InternalLinksSection({ clientId, hideArticles = false }: { clientId: string; hideArticles?: boolean }) {
  const [data, setData] = useState<UploadInternalLinks>(DEFAULT_UPLOAD_INTERNAL_LINKS);
  const [savedKey, setSavedKey] = useState(JSON.stringify(DEFAULT_UPLOAD_INTERNAL_LINKS));
  const [loading, setLoading] = useState(true);
  const [properties, setProperties] = useState<string[]>([]);
  const [gscFetching, setGscFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [articles, setArticles] = useState<ArticleLinkRow[]>([]);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`/api/upload-article/clients/${clientId}/internal-links`);
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        setData(d);
        setSavedKey(JSON.stringify(d));
      } else {
        toast.error(d?.error || "โหลด Internal Link ไม่สำเร็จ");
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadProperties() {
    try {
      const r = await fetch(`/api/upload-article/clients/${clientId}/internal-links/gsc?source=properties`);
      const d = await r.json().catch(() => ({}));
      if (r.ok) setProperties(d.properties ?? []);
    } catch { /* skip — ไม่ต้องแจ้ง error ตอนโหลด property list */ }
  }

  async function loadArticles() {
    if (hideArticles) { setArticles([]); return; }
    try {
      const r = await fetch(`/api/upload-article/clients/${clientId}/internal-links/articles`);
      const d = await r.json().catch(() => ({}));
      if (r.ok) setArticles(d.articles ?? []);
    } catch { /* skip — ไม่ต้องแจ้ง error ตอนโหลดรายการบทความ */ }
  }

  useEffect(() => { void load(); void loadProperties(); void loadArticles(); }, [clientId, hideArticles]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = useMemo(() => JSON.stringify(data) !== savedKey, [data, savedKey]);

  function toggleExclude(url: string) {
    setData(prev => {
      const excluded = new Set(prev.excluded);
      if (excluded.has(url)) excluded.delete(url); else excluded.add(url);
      return { ...prev, excluded: Array.from(excluded) };
    });
  }

  function manualAdd() {
    setData(prev => ({ ...prev, manual: [...prev.manual, { keyword: "", url: "" }] }));
  }
  function manualUpdate(i: number, field: "keyword" | "url", val: string) {
    setData(prev => ({ ...prev, manual: prev.manual.map((l, j) => (j === i ? { ...l, [field]: val } : l)) }));
  }
  function manualRemove(i: number) {
    setData(prev => ({ ...prev, manual: prev.manual.filter((_, j) => j !== i) }));
  }

  function bulkAdd() {
    const lines = bulkText.split("\n").map(l => l.trim()).filter(Boolean);
    const rows: UploadLinkPair[] = [];
    for (const line of lines) {
      const parts = line.includes("\t") ? line.split("\t") : line.split("|");
      const keyword = (parts[0] ?? "").trim();
      const url = (parts[1] ?? "").trim();
      if (url) rows.push({ keyword, url });
    }
    if (!rows.length) { toast.error("ไม่พบข้อมูล — ใช้รูปแบบ keyword | url ต่อบรรทัด"); return; }
    setData(prev => ({ ...prev, manual: [...prev.manual, ...rows] }));
    setBulkText("");
    toast.success(`เพิ่ม ${rows.length} รายการจากที่แปะ — อย่าลืมกดบันทึก`);
  }

  async function fetchGsc() {
    if (!data.gscSiteUrl.trim()) { toast.error("เลือก/กรอก GSC property ก่อน"); return; }
    setGscFetching(true);
    try {
      const r = await fetch(`/api/upload-article/clients/${clientId}/internal-links/gsc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteUrl: data.gscSiteUrl.trim() }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "ดึงจาก GSC ไม่สำเร็จ"); return; }
      setData(d);
      setSavedKey(JSON.stringify(d));
      toast.success("ดึงจาก GSC สำเร็จ — บันทึกให้แล้ว");
    } catch (e) {
      toast.error(`ดึงจาก GSC ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGscFetching(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const r = await fetch(`/api/upload-article/clients/${clientId}/internal-links`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "บันทึกไม่สำเร็จ"); return; }
      toast.success("บันทึก Internal Link แล้ว");
      await load(); // อ่านกลับจาก server เพื่อพิสูจน์ว่าบันทึกจริง
      await loadArticles();
    } finally {
      setSaving(false);
    }
  }

  const filteredGsc = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data.gsc;
    return data.gsc.filter(l => l.keyword.toLowerCase().includes(q) || l.url.toLowerCase().includes(q));
  }, [data.gsc, search]);

  const includedCount = data.gsc.filter(l => !data.excluded.includes(l.url)).length;
  const articlesUsedCount = articles.filter(a => a.url && !data.excluded.includes(a.url)).length;

  if (loading) return <p className="text-sm text-gray-400 text-center py-10">กำลังโหลด...</p>;

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-brand-navy">Internal Link</p>
            <p className="text-xs text-gray-500 mt-0.5">Mars จะแทรกลิงก์ภายในบทความจากรายการนี้ตามจำนวนที่กำหนด</p>
          </div>
          <div className="flex items-center gap-2">
            {dirty && <span className="text-[11px] text-amber-600 font-medium">มีการแก้ไขที่ยังไม่บันทึก</span>}
            <Button size="sm" disabled={saving} onClick={save}>
              {saving ? <Loader2 size={12} className="animate-spin mr-1.5" /> : null}
              {saving ? "กำลังบันทึก..." : "บันทึก"}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end">
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 mb-1">GSC Property</label>
            {properties.length > 0 ? (
              <select value={data.gscSiteUrl} onChange={e => setData(prev => ({ ...prev, gscSiteUrl: e.target.value }))}
                className="w-full h-9 rounded-md border border-gray-200 px-2 text-xs bg-white">
                <option value="">— เลือก —</option>
                {properties.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            ) : (
              <Input value={data.gscSiteUrl} onChange={e => setData(prev => ({ ...prev, gscSiteUrl: e.target.value }))}
                placeholder="sc-domain:example.com" className="text-xs h-9" />
            )}
          </div>
          <Button variant="outline" size="sm" disabled={gscFetching} onClick={fetchGsc}>
            {gscFetching ? <Loader2 size={12} className="animate-spin mr-1.5" /> : <RefreshCw size={12} className="mr-1.5" />}
            ดึงจาก GSC
          </Button>
        </div>
        {data.gscFetchedAt && (
          <p className="text-[11px] text-gray-400">ดึงล่าสุด {new Date(data.gscFetchedAt).toLocaleString("th-TH")}</p>
        )}

        <div>
          <label className="block text-[11px] font-semibold text-gray-500 mb-1">ลิงก์ต่อบทความ</label>
          <Input value={data.linksPerArticle} onChange={e => setData(prev => ({ ...prev, linksPerArticle: e.target.value }))}
            placeholder="3-5" className="text-xs h-9 w-24" />
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-brand-navy">จาก GSC</p>
            <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{includedCount} / {data.gsc.length}</span>
          </div>
          <div className="relative w-full sm:w-56">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-300" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="ค้นหา keyword/URL"
              className="w-full pl-7 pr-2 py-1.5 text-xs border border-gray-200 rounded-lg" />
          </div>
        </div>
        {data.gsc.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-6">ยังไม่มีข้อมูล — กด "ดึงจาก GSC" ด้านบน</p>
        ) : (
          <div className="max-h-72 overflow-y-auto space-y-0.5">
            {filteredGsc.map((l, i) => {
              const excluded = data.excluded.includes(l.url);
              return (
                <label key={`${l.url}-${i}`} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs cursor-pointer ${excluded ? "opacity-40" : "hover:bg-gray-50"}`}>
                  <input type="checkbox" checked={!excluded} onChange={() => toggleExclude(l.url)} />
                  <span className="w-40 shrink-0 truncate">{l.keyword}</span>
                  <span className="flex-1 truncate text-brand-blue font-mono">{l.url}</span>
                  {typeof l.clicks === "number" && <span className="text-gray-400 shrink-0">{l.clicks} clicks</span>}
                </label>
              );
            })}
          </div>
        )}
      </div>

      {!hideArticles && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-brand-navy">จากบทความในระบบ</p>
              <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{articlesUsedCount} / {articles.length}</span>
            </div>
          </div>
          <p className="text-[11px] text-gray-400">บทความที่เขียน/นำเข้าในโปรเจกต์นี้ถูกเพิ่มอัตโนมัติ — ใช้เป็นลิงก์เมื่อ push แบบ Publish แล้ว</p>
          {articles.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-6">ยังไม่มีบทความ</p>
          ) : (
            <div className="max-h-72 overflow-y-auto space-y-0.5">
              {articles.map(a => {
                if (!a.url) {
                  return (
                    <div key={a.articleId} className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs opacity-40">
                      <span className="w-40 shrink-0 truncate">{a.keyword}</span>
                      <span className="flex-1 truncate text-gray-400">รอเผยแพร่ — จะใช้เป็นลิงก์หลัง push แบบ Publish</span>
                    </div>
                  );
                }
                const url = a.url;
                const excluded = data.excluded.includes(url);
                return (
                  <label key={a.articleId} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs cursor-pointer ${excluded ? "opacity-40" : "hover:bg-gray-50"}`}>
                    <input type="checkbox" checked={!excluded} onChange={() => toggleExclude(url)} />
                    <span className="w-40 shrink-0 truncate">{a.keyword}</span>
                    <span className="flex-1 truncate text-brand-blue font-mono">{url}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
        <p className="text-sm font-semibold text-brand-navy">เพิ่มเอง ({data.manual.filter(l => l.url.trim()).length})</p>
        <div className="space-y-1 max-h-60 overflow-y-auto">
          {data.manual.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_2fr_2rem] items-center gap-2 group">
              <input value={l.keyword} onChange={e => manualUpdate(i, "keyword", e.target.value)} placeholder="anchor text"
                className="text-xs border border-gray-100 focus:border-gray-300 rounded-lg px-2 py-1.5 w-full focus:outline-none" />
              <input value={l.url} onChange={e => manualUpdate(i, "url", e.target.value)} placeholder="https://example.com/slug"
                className="text-xs text-brand-blue font-mono border border-gray-100 focus:border-gray-300 rounded-lg px-2 py-1.5 w-full focus:outline-none" />
              <button onClick={() => manualRemove(i)}
                className="text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
        <button onClick={manualAdd}
          className="w-full text-xs text-gray-400 border border-dashed border-gray-200 rounded-xl py-2 hover:border-gray-400 hover:text-gray-600 transition-colors">
          + เพิ่มลิงก์เอง
        </button>

        <div className="pt-2 border-t border-gray-100">
          <label className="block text-[11px] font-semibold text-gray-500 mb-1">แปะหลายรายการพร้อมกัน (keyword | url ต่อบรรทัด หรือคั่น tab)</label>
          <Textarea value={bulkText} onChange={e => setBulkText(e.target.value)} rows={3}
            placeholder={"บทความ SEO คืออะไร | https://example.com/seo\nรับทำ SEO\thttps://example.com/service"}
            className="text-xs font-mono" />
          <Button size="sm" variant="outline" className="mt-1.5" onClick={bulkAdd}>เพิ่มจากที่แปะ</Button>
        </div>
      </div>
    </div>
  );
}
