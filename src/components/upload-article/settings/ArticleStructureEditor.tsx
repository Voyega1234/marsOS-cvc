"use client";

/**
 * โครงบทความ + แหล่งอ้างอิง — แก้ detail.structure / detail.references / detail.referencesBlocked ของธีม (ยังไม่บันทึกจนกดบันทึกธีม)
 * สวิตช์แต่ละตัวเขียนเฉพาะคีย์ของตัวเอง; ไม่แตะ = ไม่มีคีย์ structure (โปรเจกต์เก่าทำงานเหมือนเดิม)
 * แหล่งอ้างอิงตั้งได้ในสองขั้น: กดดึงจากบทความบนเว็บ แล้วกด "ไม่ใช้" ที่เว็บคู่แข่ง — ที่เหลือซ่อนไว้ใน "ตั้งค่าเพิ่มเติม"
 * โดเมนที่ไม่ใช้ถูกตัดออกจากคลัง ไม่ถูกดึงกลับตอนสแกนใหม่/ดึงจากบทความ และไม่ถูกค้นตอนเขียน
 */
import { useMemo, useRef, useState } from "react";
import { Download, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isOfficialReferenceDomain, isReferenceBlocked, referenceDomain, refKey } from "@/lib/upload-article/references";
import type { UploadArticleStructure, UploadReference, UploadTheme, UploadThemeDetail } from "@/lib/upload-article/types";

// เท่ากับเพดานของ sanitizeThemeDetail (theme-css.ts) — เกินนี้ถูกตัดตอนบันทึกอยู่ดี
const MAX_REFS = 200;
const MAX_BLOCKED = 50;

type ToggleKey = "toc" | "takeaways" | "faqPlain" | "conclusionBeforeFaq" | "references" | "latinThaiSpacing";

// สวิตช์อ้างอิงอยู่ในกล่องแหล่งอ้างอิงด้านล่าง
const TOGGLES: Array<[Exclude<ToggleKey, "references">, string, boolean]> = [
  ["toc", "ใส่สารบัญ", true],
  ["takeaways", "ใส่กล่องสรุป", true],
  ["faqPlain", "FAQ แบบเปิดตลอด ไม่มีกรอบ", false],
  ["conclusionBeforeFaq", "มีหัวข้อสรุปก่อน FAQ", false],
  ["latinThaiSpacing", "เว้นวรรคระหว่างอังกฤษกับไทย", false],
];

const SOURCE_LABEL: Record<NonNullable<UploadReference["from"]>, string> = {
  site: "จากเว็บ",
  team: "ทีมเพิ่ม",
  import: "ดึงจากบทความ",
};

interface SiteReferencesResponse {
  references?: Array<{ title?: unknown; url?: unknown }>;
  posts?: number;
  postsWithReferences?: number;
  skippedBlocked?: number;
  truncated?: boolean;
  error?: string;
}

interface DomainRow {
  domain: string;
  count: number;
  official: boolean;
}

export default function ArticleStructureEditor({ theme, onChange, importUrl }: {
  theme: UploadTheme;
  onChange: (detail: UploadThemeDetail | undefined) => void;
  /** POST endpoint ที่ดึงอ้างอิงจากบทความทั้งเว็บ — ไม่ส่ง = ไม่มีปุ่มดึง (SME / เว็บ PBN) */
  importUrl?: string;
}) {
  const detail = theme.detail || {};
  const structure = detail.structure || {};
  const refs = detail.references || [];
  const blocked = detail.referencesBlocked || [];
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [blockInput, setBlockInput] = useState("");
  const [err, setErr] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  // ผลดึงกลับมาหลังรอหลายวินาที — รวมเข้าค่าล่าสุด ไม่ทับสิ่งที่ทีมแก้ระหว่างรอ
  const latest = useRef(detail);
  latest.current = detail;

  // เว็บที่ต้องตรวจขึ้นก่อน (อาจเป็นเว็บขายหรือคู่แข่ง) แล้วเรียงตามจำนวนรายการ
  const domains = useMemo<DomainRow[]>(() => {
    const counts = new Map<string, number>();
    for (const r of refs) {
      const d = referenceDomain(r.url);
      if (d) counts.set(d, (counts.get(d) || 0) + 1);
    }
    return Array.from(counts, ([domain, count]) => ({ domain, count, official: isOfficialReferenceDomain(domain) }))
      .sort((a, b) => Number(a.official) - Number(b.official) || b.count - a.count || a.domain.localeCompare(b.domain));
  }, [refs]);
  const toCheck = domains.filter(d => !d.official).length;

  function emit(next: UploadThemeDetail) {
    onChange(Object.keys(next).length ? next : undefined);
  }
  function withList<K extends "references" | "referencesBlocked">(base: UploadThemeDetail, key: K, list: NonNullable<UploadThemeDetail[K]>): UploadThemeDetail {
    const next: UploadThemeDetail = { ...base };
    if (list.length) next[key] = list; else delete next[key];
    return next;
  }
  function setToggle(key: ToggleKey, on: boolean) {
    const next: UploadThemeDetail = { ...detail, structure: { ...structure, [key]: on } };
    if (key === "faqPlain" && on) next.faq = { ...(detail.faq || {}), display: "open", layout: "plain" };
    emit(next);
  }
  function setRefsTitle(v: string) {
    const st: UploadArticleStructure = { ...structure };
    if (v.trim()) st.referencesTitle = v; else delete st.referencesTitle;
    emit({ ...detail, structure: st });
  }
  function setRefs(list: UploadReference[]) {
    emit(withList(detail, "references", list));
  }
  function addRef() {
    const t = title.trim();
    const u = url.trim();
    if (!t) { setErr("กรอกชื่อแหล่งอ้างอิง"); return; }
    if (!/^https:\/\/\S+$/i.test(u)) { setErr("ลิงก์ต้องขึ้นต้นด้วย https://"); return; }
    if (isReferenceBlocked(u, blocked)) { setErr(`เว็บ ${referenceDomain(u)} อยู่ในรายการไม่ใช้`); return; }
    const key = refKey(u);
    if (key && refs.some(r => refKey(r.url) === key)) { setErr("มีลิงก์นี้ในรายการแล้ว"); return; }
    if (refs.length >= MAX_REFS) { setErr(`เพิ่มได้สูงสุด ${MAX_REFS} รายการ`); return; }
    setErr("");
    setRefs([...refs, { title: t, url: u, from: "team" }]);
    setTitle(""); setUrl("");
  }
  function blockDomain(raw: string) {
    const domain = referenceDomain(raw);
    if (!domain) { setErr("ชื่อเว็บไม่ถูกต้อง เช่น competitor.com"); return; }
    if (blocked.includes(domain)) { setBlockInput(""); return; }
    if (blocked.length >= MAX_BLOCKED) { setErr(`ตั้งไม่ใช้ได้สูงสุด ${MAX_BLOCKED} เว็บ`); return; }
    const kept = refs.filter(r => !isReferenceBlocked(r.url, [domain]));
    const removed = refs.length - kept.length;
    if (removed && !window.confirm(`ไม่ใช้เว็บ ${domain}?\nลบ ${removed} รายการของเว็บนี้ออก และจะไม่ถูกดึงกลับมาอีก กด "ใช้อีกครั้ง" เพื่อเปลี่ยนใจได้`)) return;
    setErr("");
    setBlockInput("");
    emit(withList(withList(detail, "references", kept), "referencesBlocked", [...blocked, domain]));
  }
  function unblock(domain: string) {
    emit(withList(detail, "referencesBlocked", blocked.filter(d => d !== domain)));
  }
  async function importFromSite() {
    if (!importUrl) return;
    setImporting(true); setImportMsg(""); setErr("");
    try {
      const res = await fetch(importUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocked }),
      });
      const data: SiteReferencesResponse = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `ดึงอ้างอิงไม่สำเร็จ (${res.status})`);
      const base = latest.current;
      const current = base.references || [];
      const nowBlocked = base.referencesBlocked || [];
      const seen = new Set(current.map(r => refKey(r.url)).filter(Boolean));
      const added: UploadReference[] = [];
      let full = false;
      for (const r of data.references || []) {
        const t = typeof r.title === "string" ? r.title.trim() : "";
        const u = typeof r.url === "string" ? r.url : "";
        const key = refKey(u);
        if (!t || !key || seen.has(key) || isReferenceBlocked(u, nowBlocked)) continue;
        if (current.length + added.length >= MAX_REFS) { full = true; break; }
        seen.add(key);
        added.push({ title: t, url: u, from: "import" });
      }
      if (added.length) emit(withList(base, "references", [...current, ...added]));
      const notes = [
        added.length
          ? `ได้ ${added.length} รายการใหม่ จาก ${data.postsWithReferences ?? 0} บทความ`
          : `ไม่มีรายการใหม่ (อ่าน ${data.posts ?? 0} บทความ${data.postsWithReferences ? "" : " ไม่พบส่วนอ้างอิง"})`,
        data.skippedBlocked ? `ข้ามเว็บที่ไม่ใช้ ${data.skippedBlocked} รายการ` : "",
        full ? `คลังเต็ม ${MAX_REFS} รายการ` : "",
        data.truncated ? "เว็บมีบทความมาก อ่านได้ไม่ครบ" : "",
      ].filter(Boolean);
      setImportMsg(notes.join(" · "));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "ดึงอ้างอิงไม่สำเร็จ");
    } finally {
      setImporting(false);
    }
  }
  function clearScanned() {
    if (!window.confirm("ล้างหน้าตาที่สแกนมา (ฟอนต์จริง โครงบทความ และรายการอ้างอิง)? หน้าตา FAQ ตาราง และเว็บที่ตั้งไม่ใช้ไม่ถูกลบ ต้องกดบันทึกธีมจึงจะมีผลจริง")) return;
    const next: UploadThemeDetail = { ...detail };
    delete next.article; delete next.structure; delete next.references;
    emit(next);
  }

  const hasScanned = !!(detail.article || detail.structure || detail.references);
  const refsOn = structure.references === true;

  return (
    <div className="border border-gray-100 rounded-lg p-3 space-y-3">
      <p className="text-xs font-semibold text-gray-600">โครงบทความ</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
        {TOGGLES.map(([key, label, def]) => (
          <label key={key} className="flex items-center gap-2 text-xs cursor-pointer">
            <input type="checkbox" checked={structure[key] ?? def} onChange={e => setToggle(key, e.target.checked)} />
            {label}
          </label>
        ))}
      </div>

      <div className="rounded-lg border border-gray-200 p-3 space-y-2.5">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={refsOn} onChange={e => setToggle("references", e.target.checked)} />
          <span className="text-xs font-semibold text-gray-700">ใส่แหล่งอ้างอิงท้ายบทความ</span>
        </label>
        <p className="text-[11px] text-gray-500">
          ทุกครั้งที่เขียน ระบบเปิดอ่านแหล่งที่ตรงหัวข้อก่อน และอ้างได้เฉพาะแหล่งที่อ่านได้จริง ไม่แต่งลิงก์เอง
        </p>

        {!refsOn && refs.length > 0 && (
          <p className="text-[11px] text-gray-500">ปิดอยู่ · เก็บรายการไว้ {refs.length} รายการ ไม่ถูกลบ</p>
        )}

        {refsOn && (
          <>
            {importUrl && (
              <div className="space-y-1">
                <p className="text-[11px] font-semibold text-gray-600">1. ดึงแหล่งอ้างอิงจากบทความบนเว็บลูกค้า</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" size="sm" onClick={importFromSite} disabled={importing || refs.length >= MAX_REFS} className="h-8 text-xs">
                    <Download size={13} className="mr-1" />{importing ? "กำลังอ่านบทความบนเว็บ…" : refs.length ? "ดึงเพิ่มจากบทความบนเว็บ" : "ดึงจากบทความบนเว็บ"}
                  </Button>
                  <span className="text-[11px] text-gray-400">กดซ้ำได้ ไม่เพิ่มรายการซ้ำ</span>
                </div>
              </div>
            )}
            {importMsg && <p className="text-[11px] text-green-800 bg-green-50 border border-green-200 rounded px-2 py-1">{importMsg}</p>}
            {err && <p className="text-[11px] text-red-600">{err}</p>}

            {refs.length === 0 ? (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                ยังไม่มีแหล่งอ้างอิง บทความจะยังไม่มีหัวข้ออ้างอิง{importUrl ? " กดปุ่มด้านบนเพื่อดึงจากเว็บ" : " เพิ่มเองได้ที่ตั้งค่าเพิ่มเติม"}
              </p>
            ) : (
              <div className="space-y-1">
                <p className="text-[11px] font-semibold text-gray-600">
                  {importUrl ? "2. " : ""}ตรวจเว็บที่ใช้อ้างอิง ({domains.length} เว็บ · {refs.length} รายการ)
                </p>
                <p className="text-[11px] text-gray-500">
                  {toCheck
                    ? `มี ${toCheck} เว็บที่ควรตรวจ ถ้าเป็นคู่แข่งหรือเว็บขายของ กด "ไม่ใช้"`
                    : "ทุกเว็บเป็นหน่วยงานหรือวารสาร ไม่ต้องทำอะไรเพิ่ม"}
                </p>
                <ul className="divide-y divide-gray-100 rounded border border-gray-100 max-h-64 overflow-y-auto">
                  {domains.map(d => (
                    <li key={d.domain} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1.5 text-xs">
                      <span className="min-w-0 w-full sm:w-auto sm:flex-1 truncate text-brand-navy">{d.domain}</span>
                      <span className="shrink-0 text-[11px] text-gray-400 mr-auto sm:mr-0">{d.count} รายการ</span>
                      {d.official ? (
                        <span className="shrink-0 rounded border border-green-200 bg-green-50 px-1.5 py-0.5 text-[10px] text-green-800">หน่วยงาน/วารสาร</span>
                      ) : (
                        <span title="ไม่ใช่หน่วยงานรัฐ มหาวิทยาลัย องค์กร หรือวารสารที่ระบบรู้จัก" className="shrink-0 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800">ควรตรวจ</span>
                      )}
                      <Button type="button" size="sm" variant="outline" onClick={() => blockDomain(d.domain)} className="h-6 px-2 text-[11px]">ไม่ใช้</Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {blocked.length > 0 && (
              <div className="space-y-1">
                <p className="text-[11px] font-semibold text-gray-600">เว็บที่ไม่ใช้อ้างอิง ({blocked.length})</p>
                <ul className="divide-y divide-gray-100 rounded border border-amber-100 bg-amber-50/40">
                  {blocked.map(d => (
                    <li key={d} className="flex items-center gap-2 px-2 py-1.5 text-xs">
                      <span className="min-w-0 flex-1 break-all text-gray-500 line-through">{d}</span>
                      <Button type="button" size="sm" variant="outline" onClick={() => unblock(d)} className="h-6 px-2 text-[11px]">ใช้อีกครั้ง</Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {refs.length > 0 && (
              <details className="group">
                <summary className="cursor-pointer text-[11px] font-semibold text-gray-500 hover:text-gray-700">ดูทุกรายการ ({refs.length})</summary>
                <ul className="mt-1.5 space-y-1 max-h-64 overflow-y-auto pr-1">
                  {refs.map((r, i) => (
                    <li key={`${r.url}-${i}`} className="flex items-center gap-2 text-xs border border-gray-100 rounded px-2 py-1">
                      <div className="min-w-0 flex-1">
                        <a href={r.url} target="_blank" rel="noopener noreferrer" className="block font-medium text-brand-navy truncate hover:underline">{r.title}</a>
                        <p className="text-[11px] text-gray-500 truncate">{r.url}</p>
                      </div>
                      <span className="shrink-0 px-1.5 py-0.5 rounded bg-gray-50 border border-gray-200 text-[10px] text-gray-600">{SOURCE_LABEL[r.from || "site"]}</span>
                      <button type="button" aria-label={`ลบ ${r.title}`} title="ลบรายการนี้" onClick={() => setRefs(refs.filter((_, j) => j !== i))} className="shrink-0 text-gray-400 hover:text-red-500">
                        <Trash2 size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <details className="group">
              <summary className="cursor-pointer text-[11px] font-semibold text-gray-500 hover:text-gray-700">ตั้งค่าเพิ่มเติม (เพิ่มเอง · ชื่อหัวข้อ)</summary>
              <div className="mt-2 space-y-3">
                <div className="space-y-1">
                  <p className="text-[11px] text-gray-500">เพิ่มแหล่งอ้างอิงเอง</p>
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
                    <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="ชื่อแหล่งอ้างอิง" className="text-xs h-8" />
                    <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://..." className="text-xs h-8" />
                    <Button type="button" size="sm" variant="outline" onClick={addRef} disabled={refs.length >= MAX_REFS} className="h-8">เพิ่ม</Button>
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-[11px] text-gray-500">ไม่ใช้เว็บนี้ล่วงหน้า (เช่นคู่แข่งที่ยังไม่อยู่ในรายการ)</p>
                  <div className="flex gap-2">
                    <Input value={blockInput} onChange={e => setBlockInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); blockDomain(blockInput); } }}
                      placeholder="competitor.com" className="text-xs h-8 max-w-xs" />
                    <Button type="button" size="sm" variant="outline" onClick={() => blockDomain(blockInput)} disabled={!blockInput.trim()} className="h-8">ไม่ใช้</Button>
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-[11px] text-gray-500">ชื่อหัวข้อท้ายบทความ</p>
                  <Input value={structure.referencesTitle || ""} onChange={e => setRefsTitle(e.target.value)} placeholder="อ้างอิง" className="text-xs h-8 max-w-xs" />
                </div>
              </div>
            </details>

            <p className="text-[11px] text-gray-500">เปลี่ยนแล้วกด &quot;บันทึกธีม&quot; เพื่อใช้จริง</p>
          </>
        )}
      </div>

      {hasScanned && (
        <Button type="button" size="sm" variant="outline" onClick={clearScanned} className="h-8 text-red-600">ล้างหน้าตาที่สแกนมา</Button>
      )}
    </div>
  );
}
