"use client";

/**
 * แท็บ Keyword — วาง/ลากไฟล์ keyword เข้าคลังของลูกค้ารายนี้ แก้ title/slug/intent/ประเภทบทความได้ในตาราง
 * แล้วส่งต่อไปแท็บ "เขียนบทความ" (ดูหน้าตา drop zone + paste อ้างอิงจาก ClientDetailTabs.KeywordsTab)
 */
import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { Upload, Sparkles, Trash2, Loader2, ArrowRight, FileSpreadsheet, X, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseKeywordTable, parseKeywordText, type KeywordImportField, type KeywordTableParse, type ParsedKeywordRow } from "@/lib/upload-article/keyword-import";
import {
  UPLOAD_INTENT_LABELS,
  type UploadClientDTO,
  type UploadKeyword,
  type UploadKeywordIntent,
} from "@/lib/upload-article/types";

/** keyword ที่ยังขาด title/slug/intent/ประเภทบทความ อย่างใดอย่างหนึ่ง = ให้ AI เติมได้ */
function needsFill(k: UploadKeyword): boolean {
  return !k.title || !k.slug || !k.intent || !k.articleType;
}

const FIELD_LABELS: Record<KeywordImportField, string> = {
  keyword: "Keyword", title: "Title", volume: "Volume", slug: "Slug", intent: "Intent", articleType: "ประเภทบทความ", note: "Note",
};

function csvCell(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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
  const [fileImport, setFileImport] = useState<{ name: string; parse: KeywordTableParse } | null>(null);
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

  function takeParse(name: string, parse: KeywordTableParse) {
    if (!parse.rows.length) { toast.error(`ไม่พบ keyword ในไฟล์ ${name} — ต้องมีคอลัมน์หัวตารางชื่อ Keyword/Keywords หรือ keyword อยู่คอลัมน์แรก`); return; }
    setFileImport({ name, parse });
  }

  function handleFile(file: File) {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const reader = new FileReader();
    if (ext === "xlsx" || ext === "xls") {
      reader.onload = ev => {
        try {
          const wb = XLSX.read(ev.target?.result as ArrayBuffer, { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const grid: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });
          takeParse(file.name, parseKeywordTable(grid.map(r => r.map(c => String(c ?? "")))));
        } catch {
          toast.error("อ่านไฟล์ไม่สำเร็จ");
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = ev => takeParse(file.name, parseKeywordText((ev.target?.result as string) ?? ""));
      reader.readAsText(file);
    }
  }

  async function addRows(rows: ParsedKeywordRow[]): Promise<boolean> {
    if (!rows.length) { toast.error("ยังไม่มี keyword ให้เพิ่ม"); return false; }
    setAdding(true);
    try {
      const r = await fetch(`/api/upload-article/clients/${client.id}/keywords`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: rows }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "เพิ่ม keyword ไม่สำเร็จ"); return false; }
      setItems(d.items ?? []);
      const parts = [`เพิ่มใหม่ ${d.added ?? rows.length}`];
      if (d.updated) parts.push(`เติมข้อมูลคำเดิม ${d.updated}`);
      if (d.skipped) parts.push(`ซ้ำ/ข้าม ${d.skipped}`);
      toast.success(`เพิ่ม keyword แล้ว (${parts.join(" · ")})`);
      return true;
    } catch (e) {
      toast.error(`เพิ่ม keyword ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      setAdding(false);
    }
  }

  async function addKeywords() {
    if (await addRows(parseKeywordText(pasteText).rows)) setPasteText("");
  }

  async function addFileImport() {
    if (fileImport && await addRows(fileImport.parse.rows)) setFileImport(null);
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

  // ติ๊กเลือก = ให้ AI เขียนใหม่ทับของเดิม · ไม่ติ๊ก = เติมเฉพาะช่องที่ว่าง (title ที่มีอยู่/มากับไฟล์ไม่โดนแตะ)
  const rewriteMode = selected.size > 0;
  const fillIds = items.filter(needsFill).map(it => it.id);

  async function runAi() {
    const ids = rewriteMode ? Array.from(selected) : fillIds;
    if (!ids.length) { toast.error("ทุก keyword มี Title / Slug / Intent ครบแล้ว — ติ๊กเลือกแถวที่อยากให้ Mars เขียนใหม่"); return; }
    if (rewriteMode) {
      const withTitle = items.filter(it => selected.has(it.id) && it.title).length;
      if (withTitle && !confirm(`Mars จะเขียน Title / Slug / Intent ใหม่ทับของเดิม ${withTitle} รายการที่มี Title อยู่แล้ว — ทำต่อ?`)) return;
    }
    setAiBusy(true);
    setAiProgress({ done: 0, total: ids.length });
    let failed = false;
    try {
      for (let i = 0; i < ids.length; i += 40) {
        const chunk = ids.slice(i, i + 40);
        try {
          const r = await fetch(`/api/upload-article/clients/${client.id}/keywords/ai`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: chunk, mode: rewriteMode ? "rewrite" : "fill" }),
          });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) { failed = true; toast.error(d?.error || "Mars ตั้งค่าไม่สำเร็จบางส่วน"); }
          else if (d.items) setItems(d.items);
        } catch (e) {
          failed = true;
          toast.error(`Mars ตั้งค่าไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
        }
        setAiProgress(p => ({ ...p, done: Math.min(ids.length, p.done + chunk.length) }));
      }
      if (!failed) toast.success(rewriteMode ? `Mars เขียนใหม่ ${ids.length} keyword แล้ว` : `Mars เติมช่องที่ว่าง ${ids.length} keyword แล้ว`);
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

  // หัวคอลัมน์ตรงกับที่ตัว import อ่านได้ — export แล้วแก้ใน Sheets แล้วลากกลับเข้ามาได้เลย
  function exportCsv() {
    const rows = selected.size ? items.filter(it => selected.has(it.id)) : items;
    if (!rows.length) return;
    const header = ["Keyword", "Volume", "Title", "Slug", "Intent", "ประเภทบทความ", "Note", "สถานะ"];
    const lines = [header.join(",")];
    for (const it of rows) {
      lines.push([
        csvCell(it.keyword),
        csvCell(it.volume ?? ""),
        csvCell(it.title),
        csvCell(it.slug),
        csvCell(it.intent ? UPLOAD_INTENT_LABELS[it.intent] : ""),
        csvCell(it.articleType),
        csvCell(it.note ?? ""),
        csvCell(it.articleId ? "เขียนแล้ว" : it.writeError ? "ผิดพลาด" : ""),
      ].join(","));
    }
    // BOM ให้ Excel อ่านภาษาไทยถูก
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeName = client.name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "client";
    a.download = `keywords-${safeName}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success(`Export ${rows.length} keyword เป็น CSV แล้ว`);
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

          {fileImport && (
            <div className="mt-3 rounded-xl border border-brand-soft/60 bg-brand-mist/40 p-3 space-y-2">
              <div className="flex items-start gap-2">
                <FileSpreadsheet size={14} className="text-brand-blue mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-brand-navy truncate">{fileImport.name} — พบ {fileImport.parse.rows.length} keyword</p>
                  <p className="text-[11px] text-gray-500">
                    {fileImport.parse.columns.length
                      ? `คอลัมน์ที่ดึง: ${fileImport.parse.columns.map(c => `${c.header} → ${FIELD_LABELS[c.field]}`).join(" · ")}`
                      : "ไม่พบหัวตาราง — ใช้คอลัมน์แรกเป็น keyword (คอลัมน์ที่สองเป็นตัวเลข = Volume)"}
                  </p>
                </div>
                <button onClick={() => setFileImport(null)} className="text-gray-400 hover:text-gray-600 shrink-0" title="ยกเลิก"><X size={14} /></button>
              </div>
              <div className="overflow-x-auto rounded-lg border border-gray-100 bg-white">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-left text-gray-400 border-b border-gray-100">
                      <th className="px-2 py-1.5 w-8">#</th>
                      <th className="px-2 py-1.5">Keyword</th>
                      <th className="px-2 py-1.5">Title</th>
                      <th className="px-2 py-1.5 w-20">Volume</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fileImport.parse.rows.slice(0, 5).map((r, i) => (
                      <tr key={i} className="border-b border-gray-50 last:border-0">
                        <td className="px-2 py-1.5 text-gray-400">{i + 1}</td>
                        <td className="px-2 py-1.5 text-brand-navy font-medium">{r.keyword}</td>
                        <td className="px-2 py-1.5 text-gray-600">{r.title || <span className="text-gray-300">—</span>}</td>
                        <td className="px-2 py-1.5 text-gray-500">{r.volume ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {fileImport.parse.rows.length > 5 && (
                  <p className="px-2 py-1.5 text-[10px] text-gray-400 border-t border-gray-50">และอีก {fileImport.parse.rows.length - 5} แถว</p>
                )}
              </div>
              <div className="flex gap-2">
                <Button size="sm" disabled={adding} onClick={addFileImport}>
                  {adding ? <Loader2 size={12} className="animate-spin mr-1.5" /> : <Upload size={12} className="mr-1.5" />}
                  เพิ่ม {fileImport.parse.rows.length} keyword
                </Button>
                <Button size="sm" variant="outline" disabled={adding} onClick={() => setFileImport(null)}>ยกเลิก</Button>
              </div>
            </div>
          )}

          <div className="mt-3">
            <label className="block text-[11px] font-medium text-gray-500 mb-1.5">หรือวาง keyword หนึ่งบรรทัดต่อหนึ่งคำ (วางจาก Google Sheets พร้อมหัวตารางได้)</label>
            <textarea
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              placeholder={`รับทำ google ads\tรับทำ google ads, 1200\nรับทำ facebook ads, 800\nSEO marketing`}
              rows={5}
              className="w-full text-[11px] font-mono border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-200 resize-none"
            />
            <p className="mt-1 text-[10px] text-gray-400">
              1 บรรทัด = 1 keyword — ใส่ volume ต่อท้ายด้วย tab / comma / | ก็ได้ · มีหัวตาราง Keyword / Title (Topic) / Volume จะดึงตามคอลัมน์
            </p>
          </div>

          <Button size="sm" className="mt-3" disabled={adding || !pasteText.trim()} onClick={addKeywords}>
            {adding ? <Loader2 size={12} className="animate-spin mr-1.5" /> : <Upload size={12} className="mr-1.5" />}
            {adding ? "กำลังเพิ่ม..." : "เพิ่ม keyword"}
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <p className="text-xs text-gray-500">{items.length} keyword{selected.size ? ` · เลือก ${selected.size}` : ""}</p>
          {items.length > 0 && (
            <p className="text-[11px] text-gray-400 mt-0.5">ติ๊กแถวที่อยากให้ Mars เขียน Title / Slug / Intent ใหม่ — ไม่ติ๊ก Mars จะเติมเฉพาะช่องที่ว่าง (Title ที่มากับไฟล์ไม่โดนแตะ)</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="outline" disabled={aiBusy || loading || !items.length || (!rewriteMode && !fillIds.length)} onClick={runAi}
            title="ติ๊กเลือกแถว = ให้ Mars เขียน Title / Slug / Intent ใหม่ทับของเดิม · ไม่ติ๊ก = เติมเฉพาะช่องที่ยังว่าง">
            {aiBusy ? <Loader2 size={12} className="animate-spin mr-1.5" /> : <Sparkles size={12} className="mr-1.5" />}
            {aiBusy
              ? `กำลังตั้งค่า... (${aiProgress.done}/${aiProgress.total})`
              : rewriteMode
                ? `ให้ Mars เขียนใหม่ (${selected.size} ที่ติ๊ก)`
                : `ให้ Mars เติมช่องที่ว่าง (${fillIds.length})`}
          </Button>
          <Button size="sm" variant="outline" disabled={loading || !items.length} onClick={exportCsv}
            title="ไม่ติ๊ก = export ทั้งหมด · ติ๊กเลือก = export เฉพาะแถวที่เลือก">
            <Download size={12} className="mr-1.5" />
            {selected.size ? `Export CSV (${selected.size})` : "Export CSV"}
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
          <table className="w-full text-xs min-w-[1080px]">
            <thead>
              <tr className="border-b border-gray-100 text-left text-gray-400">
                <th className="px-3 py-2 w-8">
                  <input type="checkbox" checked={selected.size === items.length && items.length > 0} onChange={toggleSelectAll} />
                </th>
                <th className="px-2 py-2 min-w-[140px]">Keyword</th>
                <th className="px-2 py-2 w-20">Volume</th>
                <th className="px-2 py-2 min-w-[160px]">Title</th>
                <th className="px-2 py-2 min-w-[120px]">Slug</th>
                <th className="px-2 py-2 min-w-[140px]">Intent</th>
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
                      className="w-full min-w-[130px] text-xs border border-gray-200 rounded px-1.5 py-1 bg-white"
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
