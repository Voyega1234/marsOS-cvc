"use client";

/**
 * Upload Article — หน้ารวมลูกค้า (แยกจาก Clients/Project เด็ดขาด)
 * แต่ละการ์ด = ลูกค้าหนึ่งราย มี drop zone ของตัวเอง กันอัปโหลดผิดเว็บ
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Search, Globe, FileText, Sparkles, CheckCircle2, UploadCloud, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { UploadClientDTO } from "@/lib/upload-article/types";
import DropZone from "@/components/upload-article/shared/DropZone";
import PasteDialog from "@/components/upload-article/shared/PasteDialog";
import GoogleDocDialog from "@/components/upload-article/shared/GoogleDocDialog";

interface UploadResult {
  createdCount: number;
  errors: Array<{ name: string; error: string }>;
}

export default function UploadClientsBoard() {
  const router = useRouter();
  const [clients, setClients] = useState<UploadClientDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newWebsite, setNewWebsite] = useState("");
  const [creating, setCreating] = useState(false);

  // state ต่อการ์ด (client id) — ไม่ล็อกรวม อัปหลายเจ้าพร้อมกันได้
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, UploadResult | undefined>>({});
  const [pasteOpenFor, setPasteOpenFor] = useState<string | null>(null);
  const [gdocOpenFor, setGdocOpenFor] = useState<string | null>(null);

  async function loadClients() {
    setLoading(true);
    try {
      const r = await fetch("/api/upload-article/clients");
      if (r.ok) setClients(await r.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadClients(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(c => c.name.toLowerCase().includes(q) || c.website.toLowerCase().includes(q));
  }, [clients, search]);

  async function createClient() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const r = await fetch("/api/upload-article/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), website: newWebsite.trim() || undefined }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "เพิ่มลูกค้าไม่สำเร็จ"); return; }
      toast.success("เพิ่มลูกค้าแล้ว");
      setAddOpen(false);
      setNewName("");
      setNewWebsite("");
      await loadClients();
    } finally {
      setCreating(false);
    }
  }

  async function uploadFiles(clientId: string, files: File[]) {
    if (busy[clientId]) return;
    setBusy(prev => ({ ...prev, [clientId]: true }));
    setResults(prev => ({ ...prev, [clientId]: undefined }));
    try {
      const fd = new FormData();
      for (const f of files) fd.append("files", f);
      const r = await fetch(`/api/upload-article/clients/${clientId}/articles`, { method: "POST", body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "อัปโหลดไม่สำเร็จ"); return; }
      const created = Array.isArray(d.created) ? d.created.length : 0;
      const errors = Array.isArray(d.errors) ? d.errors : [];
      setResults(prev => ({ ...prev, [clientId]: { createdCount: created, errors } }));
      if (created) toast.success(`นำเข้าสำเร็จ ${created} บทความ`);
      if (errors.length) toast.error(`ผิดพลาด ${errors.length} ไฟล์`);
      await loadClients();
    } catch (e) {
      toast.error(`อัปโหลดไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(prev => ({ ...prev, [clientId]: false }));
    }
  }

  async function submitItems(clientId: string, items: Array<{ title?: string; text?: string; html?: string; googleDocUrl?: string }>) {
    if (busy[clientId]) return;
    setBusy(prev => ({ ...prev, [clientId]: true }));
    setResults(prev => ({ ...prev, [clientId]: undefined }));
    try {
      const r = await fetch(`/api/upload-article/clients/${clientId}/articles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "นำเข้าไม่สำเร็จ"); return; }
      const created = Array.isArray(d.created) ? d.created.length : 0;
      const errors = Array.isArray(d.errors) ? d.errors : [];
      setResults(prev => ({ ...prev, [clientId]: { createdCount: created, errors } }));
      if (created) toast.success(`นำเข้าสำเร็จ ${created} บทความ`);
      if (errors.length) toast.error(`ผิดพลาด ${errors.length} รายการ`);
      await loadClients();
    } catch (e) {
      toast.error(`นำเข้าไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(prev => ({ ...prev, [clientId]: false }));
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-brand-navy">Upload Article</h1>
          <p className="text-sm text-gray-500 mt-1">
            นำบทความที่เขียนเสร็จแล้วขึ้นเว็บลูกค้า — แยกลูกค้า แยกเว็บ ชัดเจน
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus size={14} className="mr-1.5" /> เพิ่มลูกค้า
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="ค้นหาชื่อลูกค้า / เว็บไซต์"
          className="pl-9" />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400 text-sm gap-2">
          <Loader2 size={16} className="animate-spin" /> กำลังโหลด...
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
          <FileText size={32} className="text-gray-200" />
          <p className="text-gray-400 text-sm">{clients.length === 0 ? "ยังไม่มีลูกค้าใน Upload Article" : "ไม่พบลูกค้าที่ค้นหา"}</p>
          {clients.length === 0 && (
            <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
              <Plus size={12} className="mr-1" /> เพิ่มลูกค้ารายแรก
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(c => {
            const host = c.website.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
            const result = results[c.id];
            const cardBusy = !!busy[c.id];
            return (
              <div key={c.id}
                className="bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col"
                style={{ borderLeft: `4px solid ${c.theme.theme || "#2563eb"}` }}
              >
                <div className="p-4 space-y-3 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-brand-navy truncate">{c.name}</p>
                      <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5 truncate">
                        <Globe size={11} className="shrink-0" /> {host ? `→ ${host}` : "ยังไม่ตั้งเว็บไซต์"}
                      </p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => router.push(`/upload-article/${c.id}`)}>
                      เปิด
                    </Button>
                  </div>

                  <div className="grid grid-cols-4 gap-1.5 text-center">
                    {[
                      ["นำเข้า", c.counts.imported],
                      ["Generate", c.counts.generated],
                      ["Review", c.counts.reviewed],
                      ["Push แล้ว", c.counts.pushed],
                    ].map(([label, val]) => (
                      <div key={label as string} className="rounded-lg bg-gray-50 py-1.5">
                        <p className="text-sm font-bold text-brand-navy">{val as number}</p>
                        <p className="text-[10px] text-gray-400">{label}</p>
                      </div>
                    ))}
                  </div>

                  <DropZone
                    label="ลากไฟล์มาวาง (.docx .txt .md .html)"
                    disabled={cardBusy}
                    compact
                    onFiles={files => uploadFiles(c.id, files)}
                  />

                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1 text-xs" disabled={cardBusy}
                      onClick={() => setPasteOpenFor(c.id)}>
                      วางข้อความ
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1 text-xs" disabled={cardBusy}
                      onClick={() => setGdocOpenFor(c.id)}>
                      ลิงก์ Google Doc
                    </Button>
                  </div>

                  {cardBusy && (
                    <p className="flex items-center gap-1.5 text-[11px] text-gray-400">
                      <UploadCloud size={11} className="animate-pulse" /> กำลังนำเข้า...
                    </p>
                  )}
                  {result && (
                    <div className="text-[11px] space-y-0.5">
                      {result.createdCount > 0 && (
                        <p className="flex items-center gap-1 text-emerald-600">
                          <CheckCircle2 size={11} /> นำเข้าสำเร็จ {result.createdCount} บทความ
                        </p>
                      )}
                      {result.errors.map((e, i) => (
                        <p key={i} className="text-rose-500">✕ {e.name}: {e.error}</p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>เพิ่มลูกค้าใหม่</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">ชื่อลูกค้า</label>
              <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="เช่น บริษัท เอบีซี จำกัด" maxLength={120} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">เว็บไซต์ (ไม่บังคับ)</label>
              <Input value={newWebsite} onChange={e => setNewWebsite(e.target.value)} placeholder="https://www.example.com" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>ยกเลิก</Button>
            <Button disabled={!newName.trim() || creating} onClick={createClient}>
              {creating ? "กำลังบันทึก..." : "เพิ่มลูกค้า"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PasteDialog
        open={!!pasteOpenFor}
        onOpenChange={v => !v && setPasteOpenFor(null)}
        busy={pasteOpenFor ? busy[pasteOpenFor] : false}
        onSubmit={async data => {
          const id = pasteOpenFor;
          if (!id) return;
          await submitItems(id, [data]);
          setPasteOpenFor(null);
        }}
      />

      <GoogleDocDialog
        open={!!gdocOpenFor}
        onOpenChange={v => !v && setGdocOpenFor(null)}
        busy={gdocOpenFor ? busy[gdocOpenFor] : false}
        onSubmit={async data => {
          const id = gdocOpenFor;
          if (!id) return;
          await submitItems(id, [data]);
          setGdocOpenFor(null);
        }}
      />
    </div>
  );
}
