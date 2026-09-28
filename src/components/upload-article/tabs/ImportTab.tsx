"use client";

/** แท็บ "นำเข้าบทความ" — drop zone / วางข้อความ / ลิงก์ Google Doc + ตารางบทความของลูกค้านี้ */
import { useState } from "react";
import { toast } from "sonner";
import { Trash2, CheckCircle2, Loader2, Lock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { UploadArticleDTO, UploadClientDTO } from "@/lib/upload-article/types";
import DropZone from "@/components/upload-article/shared/DropZone";
import PasteDialog from "@/components/upload-article/shared/PasteDialog";
import GoogleDocDialog from "@/components/upload-article/shared/GoogleDocDialog";
import DriveFolderDialog from "@/components/upload-article/shared/DriveFolderDialog";
import UploadStatusBadge from "@/components/upload-article/shared/StatusBadge";

const SOURCE_LABEL: Record<string, string> = {
  docx: "Word (.docx)", txt: "Text (.txt)", md: "Markdown", html: "HTML",
  gdoc: "Google Doc", gdrive: "Google Drive", paste: "วางข้อความ",
};

export default function ImportTab({
  client, articles, selectedId, setSelectedId, refreshArticles, refreshClient, removeArticle,
}: {
  client: UploadClientDTO;
  articles: UploadArticleDTO[];
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  refreshArticles: () => Promise<void>;
  refreshClient: () => Promise<void>;
  removeArticle: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [gdocOpen, setGdocOpen] = useState(false);
  const [driveOpen, setDriveOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UploadArticleDTO | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function uploadFiles(files: File[]) {
    setBusy(true);
    try {
      const fd = new FormData();
      for (const f of files) fd.append("files", f);
      const r = await fetch(`/api/upload-article/clients/${client.id}/articles`, { method: "POST", body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "อัปโหลดไม่สำเร็จ"); return; }
      const created = Array.isArray(d.created) ? d.created.length : 0;
      const errors = Array.isArray(d.errors) ? d.errors : [];
      if (created) toast.success(`นำเข้าสำเร็จ ${created} บทความ`);
      for (const e of errors) toast.error(`${e.name}: ${e.error}`);
      await refreshArticles();
      await refreshClient();
    } catch (e) {
      toast.error(`อัปโหลดไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function submitItems(items: Array<{ title?: string; text?: string; html?: string; googleDocUrl?: string }>) {
    setBusy(true);
    try {
      const r = await fetch(`/api/upload-article/clients/${client.id}/articles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "นำเข้าไม่สำเร็จ"); return; }
      const created = Array.isArray(d.created) ? d.created.length : 0;
      const errors = Array.isArray(d.errors) ? d.errors : [];
      if (created) toast.success(`นำเข้าสำเร็จ ${created} บทความ`);
      for (const e of errors) toast.error(`${e.name}: ${e.error}`);
      await refreshArticles();
      await refreshClient();
    } catch (e) {
      toast.error(`นำเข้าไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/upload-article/articles/${deleteTarget.id}`, { method: "DELETE" });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        toast.error(d?.error || "ลบไม่สำเร็จ");
        return;
      }
      removeArticle(deleteTarget.id);
      toast.success("ลบบทความแล้ว");
      await refreshClient();
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <DropZone disabled={busy} onFiles={uploadFiles} />
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1" disabled={busy} onClick={() => setPasteOpen(true)}>
            วางข้อความ
          </Button>
          <Button variant="outline" size="sm" className="flex-1" disabled={busy} onClick={() => setGdocOpen(true)}>
            ลิงก์ Google Doc
          </Button>
          <Button variant="outline" size="sm" className="flex-1" disabled={busy} onClick={() => setDriveOpen(true)}>
            Google Drive (โฟลเดอร์)
          </Button>
        </div>
        {busy && (
          <p className="flex items-center gap-1.5 text-xs text-gray-400">
            <Loader2 size={12} className="animate-spin" /> กำลังนำเข้า...
          </p>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <p className="text-sm font-semibold text-brand-navy">บทความของลูกค้านี้ ({articles.length})</p>
        </div>
        {articles.length === 0 ? (
          <div className="py-14 text-center text-sm text-gray-400">ยังไม่มีบทความ — ลากไฟล์หรือวางข้อความด้านบนเพื่อเริ่ม</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">ชื่อบทความ</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">แหล่งที่มา</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">คำ</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">สถานะ</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">อัปเดตล่าสุด</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {articles.map(a => (
                <tr key={a.id}
                  onClick={() => setSelectedId(a.id)}
                  className={`cursor-pointer hover:bg-gray-50/60 transition-colors ${selectedId === a.id ? "bg-brand-mist/40" : ""}`}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-brand-navy truncate max-w-sm flex items-center gap-1.5">
                      {selectedId === a.id && <CheckCircle2 size={12} className="text-brand-blue shrink-0" />}
                      {a.title}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{SOURCE_LABEL[a.sourceType] ?? a.sourceType}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{a.wordCount.toLocaleString("th-TH")}</td>
                  <td className="px-4 py-3"><UploadStatusBadge status={a.status} /></td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {new Date(a.updatedAt).toLocaleDateString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {a.wordpressPostId || a.pushedAt ? (
                      <span title="ขึ้นเว็บไซต์แล้ว — ลบไม่ได้" className="inline-flex p-1.5 text-gray-300">
                        <Lock size={13} />
                      </span>
                    ) : (
                      <button
                        onClick={e => { e.stopPropagation(); setDeleteTarget(a); }}
                        className="p-1.5 rounded-lg text-gray-300 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <PasteDialog open={pasteOpen} onOpenChange={setPasteOpen} busy={busy}
        onSubmit={async data => { await submitItems([data]); setPasteOpen(false); }} />
      <GoogleDocDialog open={gdocOpen} onOpenChange={setGdocOpen} busy={busy}
        onSubmit={async data => { await submitItems([data]); setGdocOpen(false); }} />
      <DriveFolderDialog open={driveOpen} onOpenChange={setDriveOpen} clientId={client.id}
        onImported={async () => { await refreshArticles(); await refreshClient(); }} />

      <Dialog open={!!deleteTarget} onOpenChange={v => !v && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>ลบบทความนี้?</DialogTitle></DialogHeader>
          <p className="text-sm text-gray-600">"{deleteTarget?.title}" จะถูกลบถาวร — ยืนยันหรือไม่?</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>ยกเลิก</Button>
            <Button variant="destructive" disabled={deleting} onClick={confirmDelete}>
              {deleting ? "กำลังลบ..." : "ลบบทความ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
