"use client";

/**
 * Dialog "Google Drive (โฟลเดอร์)" — วางลิงก์โฟลเดอร์แม่ (1 โฟลเดอร์ย่อย = 1 บทความ) → ตรวจโฟลเดอร์ →
 * เลือกบทความ → นำเข้าทีละโฟลเดอร์ (request ละ 1 บทความ กัน timeout)
 */
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, FolderOpen, CheckCircle2, XCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface DriveArticleItem {
  folderId: string;
  resourceKey?: string;
  name: string;
  docName: string;
  imageCount: number;
  alreadyImported: boolean;
}

interface DriveSkippedItem {
  folderId: string;
  name: string;
  reason: string;
}

interface ListResult {
  folderName?: string;
  articles: DriveArticleItem[];
  skipped: DriveSkippedItem[];
  truncated: boolean;
}

type ItemState = { status: "pending" | "running" | "done" | "error"; message?: string };

export default function DriveFolderDialog({
  open,
  onOpenChange,
  clientId,
  onImported,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string;
  /** เรียกหลังนำเข้าเสร็จ (อย่างน้อย 1 บทความ) — ใช้ refresh รายการเหมือนตัวนำเข้าอื่น */
  onImported: () => Promise<void>;
}) {
  const [url, setUrl] = useState("");
  const [checking, setChecking] = useState(false);
  const [listing, setListing] = useState<ListResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [states, setStates] = useState<Record<string, ItemState>>({});

  function reset() {
    setUrl("");
    setListing(null);
    setSelected(new Set());
    setStates({});
  }

  async function checkFolder() {
    setChecking(true);
    setListing(null);
    setStates({});
    try {
      const r = await fetch(`/api/upload-article/clients/${clientId}/drive/list`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "ตรวจโฟลเดอร์ไม่สำเร็จ"); return; }
      const result = d as ListResult;
      setListing(result);
      // ค่าเริ่มต้น: เลือกทุกบทความที่ยังไม่เคยนำเข้า
      setSelected(new Set(result.articles.filter(a => !a.alreadyImported).map(a => a.folderId)));
      if (result.articles.length === 0) toast.error("ไม่พบโฟลเดอร์บทความที่มีเอกสาร");
    } catch (e) {
      toast.error(`ตรวจโฟลเดอร์ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setChecking(false);
    }
  }

  function toggle(id: string) {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  async function runImport() {
    if (!listing) return;
    const queue = listing.articles.filter(a => selected.has(a.folderId));
    if (queue.length === 0) return;
    setImporting(true);
    setStates(Object.fromEntries(queue.map(a => [a.folderId, { status: "pending" } as ItemState])));
    let ok = 0;
    let failed = 0;
    try {
      // ทีละโฟลเดอร์ — request เดียวไม่ต้องทำทั้งหมด
      for (const a of queue) {
        setStates(prev => ({ ...prev, [a.folderId]: { status: "running" } }));
        try {
          const r = await fetch(`/api/upload-article/clients/${clientId}/drive/import`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ folderId: a.folderId, name: a.name, resourceKey: a.resourceKey }),
          });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) {
            failed++;
            setStates(prev => ({ ...prev, [a.folderId]: { status: "error", message: d?.error || `HTTP ${r.status}` } }));
            continue;
          }
          ok++;
          setStates(prev => ({ ...prev, [a.folderId]: { status: "done", message: d?.warning } }));
          // เอาออกจากที่เลือก กันกดนำเข้าซ้ำตอนลองใหม่เฉพาะอันที่พลาด
          setSelected(prev => { const n = new Set(prev); n.delete(a.folderId); return n; });
          if (d?.warning) toast.warning(`${a.name}: ${d.warning}`);
        } catch (e) {
          failed++;
          setStates(prev => ({ ...prev, [a.folderId]: { status: "error", message: e instanceof Error ? e.message : String(e) } }));
        }
      }
      if (ok) {
        toast.success(`นำเข้าสำเร็จ ${ok} บทความ`);
        await onImported();
      }
      if (failed) toast.error(`นำเข้าไม่สำเร็จ ${failed} บทความ — ดูเหตุผลในรายการ`);
      else if (ok) { onOpenChange(false); reset(); }
    } finally {
      setImporting(false);
    }
  }

  const doneCount = Object.values(states).filter(s => s.status === "done" || s.status === "error").length;
  const totalRun = Object.keys(states).length;

  return (
    <Dialog open={open} onOpenChange={v => { if (importing) return; onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>นำเข้าจากโฟลเดอร์ Google Drive</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">ลิงก์โฟลเดอร์ Google Drive</label>
            <div className="flex gap-2">
              <Input
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://drive.google.com/drive/folders/…"
                disabled={importing}
              />
              <Button variant="outline" disabled={!url.trim() || checking || importing} onClick={checkFolder}>
                {checking ? <Loader2 size={14} className="animate-spin mr-1" /> : <FolderOpen size={14} className="mr-1" />}
                ตรวจโฟลเดอร์
              </Button>
            </div>
            <p className="text-[11px] text-gray-400 mt-1">
              ต้องแชร์โฟลเดอร์แบบ "Anyone with the link" — 1 โฟลเดอร์ย่อย = 1 บทความ (มี Google Doc หรือ .docx + รูป)
              · รูปที่ชื่อมีคำว่า ปก/cover/thumbnail จะถูกใช้เป็นภาพปก ถ้าไม่มีจะใช้รูปแรกตามชื่อ
            </p>
          </div>

          {listing && (
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-3 py-2 border-b border-gray-100 bg-gray-50 flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-brand-navy truncate">
                  {listing.folderName || "โฟลเดอร์"} · พบ {listing.articles.length} บทความ
                  {listing.skipped.length > 0 && ` · ข้าม ${listing.skipped.length}`}
                </p>
                {listing.articles.length > 0 && !importing && (
                  <button
                    className="text-[11px] text-brand-blue hover:underline shrink-0"
                    onClick={() => setSelected(prev => prev.size === listing.articles.length
                      ? new Set()
                      : new Set(listing.articles.map(a => a.folderId)))}
                  >
                    {selected.size === listing.articles.length ? "ไม่เลือกทั้งหมด" : "เลือกทั้งหมด"}
                  </button>
                )}
              </div>
              <div className="max-h-[45vh] overflow-y-auto divide-y divide-gray-50">
                {listing.articles.map(a => {
                  const st = states[a.folderId];
                  return (
                    <label key={a.folderId} className="flex items-start gap-2.5 px-3 py-2 hover:bg-gray-50/60 cursor-pointer">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={selected.has(a.folderId)}
                        disabled={importing}
                        onChange={() => toggle(a.folderId)}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-brand-navy truncate">{a.name}</p>
                        <p className="text-[11px] text-gray-400 truncate">
                          {a.docName} · รูป {a.imageCount} ไฟล์
                          {a.alreadyImported && <span className="text-amber-600"> · เคยนำเข้าแล้ว</span>}
                        </p>
                        {st?.message && (
                          <p className={`text-[11px] ${st.status === "error" ? "text-rose-600" : "text-amber-600"}`}>{st.message}</p>
                        )}
                      </div>
                      <span className="shrink-0 mt-0.5">
                        {st?.status === "running" && <Loader2 size={13} className="animate-spin text-brand-blue" />}
                        {st?.status === "done" && <CheckCircle2 size={13} className="text-emerald-600" />}
                        {st?.status === "error" && <XCircle size={13} className="text-rose-600" />}
                      </span>
                    </label>
                  );
                })}
                {listing.skipped.map(s => (
                  <div key={s.folderId} className="flex items-start gap-2.5 px-3 py-2 opacity-60">
                    <input type="checkbox" className="mt-0.5" disabled checked={false} readOnly />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-gray-500 truncate">{s.name}</p>
                      <p className="text-[11px] text-gray-400">ข้าม: {s.reason}</p>
                    </div>
                  </div>
                ))}
              </div>
              {listing.truncated && (
                <p className="px-3 py-2 text-[11px] text-amber-600 border-t border-gray-100">
                  แสดงแค่ 50 โฟลเดอร์แรก — ถ้ามีมากกว่านี้ให้แบ่งเป็นหลายโฟลเดอร์แม่
                </p>
              )}
            </div>
          )}

          {importing && (
            <p className="flex items-center gap-1.5 text-xs text-gray-500">
              <Loader2 size={12} className="animate-spin" /> กำลังนำเข้า {doneCount}/{totalRun} บทความ...
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={importing} onClick={() => { onOpenChange(false); reset(); }}>ปิด</Button>
          <Button disabled={!listing || selected.size === 0 || importing || checking} onClick={runImport}>
            {importing ? "กำลังนำเข้า..." : `นำเข้า ${selected.size} บทความ`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
