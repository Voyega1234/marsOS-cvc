"use client";

/**
 * Project Setting > ลบลูกค้า — ลบลูกค้า + บทความทั้งหมดในระบบของลูกค้านี้ (รวมที่ขึ้นเว็บแล้ว)
 * ต้องพิมพ์ชื่อลูกค้ายืนยัน (เช็คซ้ำฝั่ง server) — ระบบไม่ลบโพสต์บนเว็บไซต์ลูกค้า
 */
import { useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import type { UploadClientDTO } from "@/lib/upload-article/types";

export default function DangerSection({ client, onDeleted }: { client: UploadClientDTO; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function confirmDelete() {
    if (typed.trim() !== client.name.trim()) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/upload-article/clients/${client.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmName: typed.trim() }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "ลบไม่สำเร็จ"); return; }
      toast.success("ลบลูกค้าแล้ว");
      setOpen(false);
      onDeleted();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="bg-white border border-rose-200 rounded-xl p-4 space-y-2">
        <p className="text-sm font-semibold text-rose-600">Danger zone</p>
        <p className="text-xs text-gray-500">
          ลบลูกค้านี้จะลบบทความในระบบทั้งหมดของลูกค้านี้ ({client.counts.total} บทความ) รวมถึง Keyword, Internal Link และ Content Engine ของลูกค้านี้ ทำแล้วกู้คืนไม่ได้
        </p>
        {client.counts.pushed > 0 && (
          <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
            มีบทความที่ขึ้นเว็บไซต์แล้ว {client.counts.pushed} บทความ — ประวัติในระบบจะหายไปด้วย แต่โพสต์บนเว็บไซต์ลูกค้ายังอยู่ครบ (ระบบไม่ลบโพสต์บนเว็บลูกค้า)
          </p>
        )}
        <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
          <Trash2 size={12} className="mr-1.5" /> ลบลูกค้านี้
        </Button>
      </div>

      <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) setTyped(""); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>ยืนยันการลบ &quot;{client.name}&quot;</DialogTitle></DialogHeader>
          <p className="text-sm text-gray-600">พิมพ์ชื่อลูกค้า <strong>{client.name}</strong> เพื่อยืนยันการลบถาวร</p>
          <Input value={typed} onChange={e => setTyped(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>ยกเลิก</Button>
            <Button variant="destructive" disabled={typed.trim() !== client.name.trim() || deleting} onClick={confirmDelete}>
              {deleting ? "กำลังลบ..." : "ลบถาวร"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
