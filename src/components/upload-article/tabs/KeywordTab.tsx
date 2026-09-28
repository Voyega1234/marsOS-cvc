"use client";

/**
 * แท็บ Keyword — วาง/ลากไฟล์ keyword เข้าคลังของลูกค้ารายนี้ แก้ title/slug/intent/ประเภทบทความได้ในตาราง
 * แล้วส่งต่อไปแท็บ "เขียนบทความ" (ดูหน้าตา drop zone + paste อ้างอิงจาก ClientDetailTabs.KeywordsTab)
 */
import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { Upload, Sparkles, Trash2, Loader2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  UPLOAD_INTENT_LABELS,
  type UploadClientDTO,
  type UploadKeyword,
  type UploadKeywordIntent,
} from "@/lib/upload-article/types";

const HEADER_RE = /^(keyword|คีย์เวิร์ด|kw|search term)$/i;

function parsePaste(text: string): { keyword: string; volume?: number }[] {
  return text
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean)
    .map(line => {
      const parts = line.split(/\t|,|\|/).map(p => p.trim()).filter(Boolean);
      const keyword = parts[0] ?? "";
      const volNum = parts[1] ? Number(parts[1].replace(/,/g, "")) : undefined;
      return { keyword, volume: Number.isFinite(volNum) && (volNum as number) > 0 ? volNum : undefined };
    })
    .filter(r => r.keyword && !HEADER_RE.test(r.keyword));
}

function EditableCell({
  value, onCommit, placeholder, className,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <input
      value={local}
      placeholder={placeholder}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => { if (local !== value) onCommit(local); }}
      onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className={className ?? "w-full min-w-[120px] text-xs border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-brand-blue"}
    />
  );
}

export default function KeywordTab({
  client, onWrite, goToReview,
}: {
  client: UploadClientDTO;
  onWrite: (ids: string[]) => void;
  goToReview: (articleId: string) => void;
}) {
  const [items, setItems] = useState<UploadKeyword[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pasteText, setPasteText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [adding, setAdding] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiProgress, setAiProgress] = useState({ done: 0, total: 0 });
  const [deleting, setDeleting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/upload-article/clients/${client.id}/keywords`);
        if (alive && r.ok) {
          const d = await r.json();
          setItems(d.items ?? []);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [client.id]);

  function handleFile(file: File) {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "xlsx" || ext === "xls") {
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const buf = ev.target?.result as ArrayBuffer;
          const wb = XLSX.read(buf, { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows: (string | number)[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
          const lines = rows.map(r => r.filter(c => String(c).trim() !== "").join("\t")).filter(Boolean);
          setPasteText(prev => (prev ? `${prev}\n${lines.join("\n")}` : lines.join("\n")));
        } catch {
          toast.error("อ่านไฟล์ไม่สำเร็จ");
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = ev => {
        const text = (ev.target?.result as string) ?? "";
        setPasteText(prev => (prev ? `${prev}\n${text}` : text));
      };
      reader.readAsText(file);
    }
  }

  async function addKeywords() {
    const rows = parsePaste(pasteText);
    if (!rows.length) { toast.error("ยังไม่มี keyword ให้เพิ่ม"); return; }
    setAdding(true);
    try {
      const r = await fetch(`/api/upload-article/clients/${client.id}/keywords`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: rows }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "เพิ่ม keyword ไม่สำเร็จ"); return; }
      setItems(d.items ?? []);
      setPasteText("");
      toast.success(`เพิ่ม keyword แล้ว (${rows.length})`);
    } catch (e) {
      toast.error(`เพิ่ม keyword ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAdding(false);
    }
  }

  async function patchItem(id: string, patch: Partial<Pick<UploadKeyword, "title" | "slug" | "intent" | "articleType" | "note">>) {
    setItems(prev => prev.map(it => (it.id === id ? { ...it, ...patch } : it)));
    try {
      const r = await fetch(`/api/upload-article/clients/${client.id}/keywords`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, patch }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "บันทึกไม่สำเร็จ"); return; }
      if (d.item) setItems(prev => prev.map(it => (it.id === id ? d.item : it)));
    } catch (e) {
      toast.error(`บันทึกไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function deleteSelected() {
    if (!selected.size) return;
    if (!confirm(`ลบ ${selected.size} keyword?`)) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/upload-article/clients/${client.id}/keywords`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "ลบไม่สำเร็จ"); return; }
      setItems(d.items ?? []);
      setSelected(new Set());
      toast.success("ลบแล้ว");
    } catch (e) {
      toast.error(`ลบไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDeleting(false);
    }
  }

  async function runAi() {
    const ids = selected.size ? Array.from(selected) : items.filter(it => !it.title).map(it => it.id);
    if (!ids.length) { toast.error("ไม่มี keyword ให้ตั้งค่า (เลือก หรือไม่มี keyword ที่ยังไม่มี title)"); return; }
    setAiBusy(true);
    setAiProgress({ done: 0, total: ids.length });
    try {
      for (let i = 0; i < ids.length; i += 40) {
        const chunk = ids.slice(i, i + 40);
        try {
          const r = await fetch(`/api/upload-article/clients/${client.id}/keywords/ai`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: chunk }),
          });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) toast.error(d?.error || "AI ตั้งค่าไม่สำเร็จบางส่วน");
          else if (d.items) setItems(d.items);
        } catch (e) {
          toast.error(`AI ตั้งค่าไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
        }
        setAiProgress(p => ({ ...p, done: Math.min(ids.length, p.done + chunk.length) }));
      }
      toast.success("AI ตั้ง Title / Slug / Intent เสร็จแล้ว");
    } finally {
      setAiBusy(false);
    }
  }

  function toggleSelect(id: string) {
    setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function toggleSelectAll() {
    setSelected(prev => (prev.size === items.length ? new Set() : new Set(items.map(it => it.id))));
  }

  function goWrite() {
    if (!selected.size) { toast.error("เลือก keyword ก่อน"); return; }
    onWrite(Array.from(selected));
  }

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <Upload size={14} className="text-gray-400" />
          <span className="text-sm font-bold text-brand-navy">เพิ่ม Keyword</span>
        </div>
        <div className="px-5 pt-4 pb-3">
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => {
              e.preventDefault(); setDragOver(false);
              const f = e.dataTransfer.files[0];
              if (f) handleFile(f);
            }}
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
              dragOver ? "border-gray-400 bg-gray-50" : "border-gray-200 hover:border-gray-300"
            }`}
          >
            <Upload size={22} className="mx-auto mb-2 text-gray-300" />
            <p className="text-sm font-medium text-gray-500">คลิกหรือลากไฟล์มาวาง</p>
            <p className="text-[11px] text-gray-400 mt-0.5">.txt · .csv · .xlsx</p>
            <input ref={fileRef} type="file" accept=".txt,.csv,.tsv,.xlsx,.xls" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
          </div>

          <div className="mt-3">
            <label className="block text-[11px] font-medium text-gray-500 mb-1.5">หรือวาง keyword หนึ่งบรรทัดต่อหนึ่งคำ</label>
            <textarea
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              placeholder={`รับทำ google ads\tรับทำ google ads, 1200\nรับทำ facebook ads, 800\nSEO marketing`}
              rows={5}
              className="w-full text-[11px] font-mono border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-200 resize-none"
            />
            <p className="mt-1 text-[10px] text-gray-400">
              1 บรรทัด = 1 keyword — ใส่ volume ต่อท้ายด้วย tab / comma / | ก็ได้ (ไม่บังคับ)
            </p>
          </div>

          <Button size="sm" className="mt-3" disabled={adding || !pasteText.trim()} onClick={addKeywords}>
            {adding ? <Loader2 size={12} className="animate-spin mr-1.5" /> : <Upload size={12} className="mr-1.5" />}
            {adding ? "กำลังเพิ่ม..." : "เพิ่ม keyword"}
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs text-gray-500">{items.length} keyword{selected.size ? ` · เลือก ${selected.size}` : ""}</p>
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="outline" disabled={aiBusy || loading || !items.length} onClick={runAi}>
            {aiBusy ? <Loader2 size={12} className="animate-spin mr-1.5" /> : <Sparkles size={12} className="mr-1.5" />}
            {aiBusy ? `กำลังตั้งค่า... (${aiProgress.done}/${aiProgress.total})` : "ให้ AI ตั้ง Title + Slug + Intent"}
          </Button>
          <Button size="sm" variant="outline" disabled={!selected.size || deleting} onClick={deleteSelected}>
            {deleting ? <Loader2 size={12} className="animate-spin mr-1.5" /> : <Trash2 size={12} className="mr-1.5" />}
            ลบที่เลือก
          </Button>
          <Button size="sm" disabled={!selected.size} onClick={goWrite}>
            ไปเขียนบทความ <ArrowRight size={12} className="ml-1.5" />
          </Button>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
        {loading ? (
          <p className="text-sm text-gray-400 text-center py-10">กำลังโหลด...</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-10">ยังไม่มี keyword — เพิ่มจากด้านบน</p>
        ) : (
          <table className="w-full text-xs min-w-[900px]">
            <thead>
              <tr className="border-b border-gray-100 text-left text-gray-400">
                <th className="px-3 py-2 w-8">
                  <input type="checkbox" checked={selected.size === items.length && items.length > 0} onChange={toggleSelectAll} />
                </th>
                <th className="px-2 py-2 min-w-[140px]">Keyword</th>
                <th className="px-2 py-2 w-20">Volume</th>
                <th className="px-2 py-2 min-w-[160px]">Title</th>
                <th className="px-2 py-2 min-w-[120px]">Slug</th>
                <th className="px-2 py-2 w-32">Intent</th>
                <th className="px-2 py-2 min-w-[120px]">ประเภทบทความ</th>
                <th className="px-2 py-2 min-w-[120px]">Note</th>
                <th className="px-2 py-2 min-w-[100px]">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.id} className="border-b border-gray-50 align-top hover:bg-gray-50/60">
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={selected.has(it.id)} onChange={() => toggleSelect(it.id)} />
                  </td>
                  <td className="px-2 py-2 text-brand-navy font-medium">{it.keyword}</td>
                  <td className="px-2 py-2 text-gray-500">{it.volume ?? "—"}</td>
                  <td className="px-2 py-2">
                    <EditableCell value={it.title} placeholder="H1" onCommit={v => patchItem(it.id, { title: v })} />
                  </td>
                  <td className="px-2 py-2">
                    <EditableCell value={it.slug} placeholder="slug" onCommit={v => patchItem(it.id, { slug: v })} />
                  </td>
                  <td className="px-2 py-2">
                    <select
                      value={it.intent}
                      onChange={e => patchItem(it.id, { intent: e.target.value as UploadKeywordIntent | "" })}
                      className="w-full text-xs border border-gray-200 rounded px-1.5 py-1 bg-white"
                    >
                      <option value="">—</option>
                      {(Object.keys(UPLOAD_INTENT_LABELS) as UploadKeywordIntent[]).map(k => (
                        <option key={k} value={k}>{UPLOAD_INTENT_LABELS[k]}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <EditableCell value={it.articleType} placeholder="ประเภทบทความ" onCommit={v => patchItem(it.id, { articleType: v })} />
                  </td>
                  <td className="px-2 py-2">
                    <EditableCell value={it.note ?? ""} placeholder="โน้ต" onCommit={v => patchItem(it.id, { note: v })} />
                  </td>
                  <td className="px-2 py-2">
                    {it.articleId ? (
                      <button onClick={() => goToReview(it.articleId!)} className="text-brand-blue hover:underline font-semibold">
                        เขียนแล้ว
                      </button>
                    ) : it.writeError ? (
                      <span className="text-rose-600" title={it.writeError}>ผิดพลาด</span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
