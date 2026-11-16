"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "./shared";

interface ManualProject {
  id: string; name: string; clientName: string; note: string; createdById: string; requests: number; budgets: number;
}

export default function ProjectsDialog({ open, onOpenChange, onChanged }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged: () => void;
}) {
  const [list, setList] = useState<ManualProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [clientName, setClientName] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editClient, setEditClient] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<{ projects: ManualProject[] }>("/api/backlink-management/projects");
      setList(d.projects);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "โหลดรายการโปรเจกต์ไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setEditId(null);
    void load();
  }, [open, load]);

  async function add() {
    if (!name.trim()) { toast.error("กรุณาระบุชื่อโปรเจกต์"); return; }
    setBusy(true);
    try {
      await api("/api/backlink-management/projects", { method: "POST", json: { name, clientName } });
      setName(""); setClientName("");
      toast.success("เพิ่มโปรเจกต์แล้ว");
      await load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "เพิ่มโปรเจกต์ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(id: string) {
    if (!editName.trim()) { toast.error("กรุณาระบุชื่อโปรเจกต์"); return; }
    setBusy(true);
    try {
      await api(`/api/backlink-management/projects/${id}`, { method: "PATCH", json: { name: editName, clientName: editClient } });
      setEditId(null);
      toast.success("บันทึกแล้ว");
      await load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: ManualProject) {
    if (!confirm(`ลบโปรเจกต์ "${p.name}"?`)) return;
    setBusy(true);
    try {
      await api(`/api/backlink-management/projects/${p.id}`, { method: "DELETE" });
      toast.success("ลบโปรเจกต์แล้ว");
      await load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>โปรเจกต์ที่เพิ่มเอง</DialogTitle>
          <DialogDescription>ใช้กับลูกค้าที่ไม่มีในเมนู Clients — ใช้ได้เฉพาะใน Backlink Management</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="blm-proj-name">ชื่อโปรเจกต์ *</Label>
            <Input id="blm-proj-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="blm-proj-client">ชื่อลูกค้า</Label>
            <Input id="blm-proj-client" value={clientName} maxLength={200} onChange={(e) => setClientName(e.target.value)} />
          </div>
        </div>
        <div>
          <Button type="button" onClick={add} disabled={busy}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}เพิ่มโปรเจกต์
          </Button>
        </div>

        <div className="max-h-[320px] space-y-2 overflow-y-auto">
          {loading ? <p className="text-sm text-gray-500">กำลังโหลด…</p> : null}
          {!loading && list.length === 0 ? <p className="text-sm text-gray-500">ยังไม่มีโปรเจกต์ที่เพิ่มเอง</p> : null}
          {list.map((p) => {
            const used = p.requests + p.budgets;
            return (
              <div key={p.id} className="rounded-xl border border-input bg-white/70 p-3">
                {editId === p.id ? (
                  <div className="space-y-2">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Input value={editName} maxLength={120} onChange={(e) => setEditName(e.target.value)} aria-label="ชื่อโปรเจกต์" />
                      <Input value={editClient} maxLength={200} onChange={(e) => setEditClient(e.target.value)} placeholder="ชื่อลูกค้า" aria-label="ชื่อลูกค้า" />
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" disabled={busy} onClick={() => saveEdit(p.id)}>บันทึก</Button>
                      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setEditId(null)}>ยกเลิก</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{p.name}</div>
                      <div className="truncate text-xs text-gray-500">
                        {p.clientName ? `${p.clientName} · ` : ""}คำขอ {p.requests} · งบ {p.budgets}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button type="button" size="sm" variant="outline" disabled={busy}
                        onClick={() => { setEditId(p.id); setEditName(p.name); setEditClient(p.clientName); }}>
                        แก้ไข
                      </Button>
                      <Button type="button" size="sm" variant="outline" disabled={busy || used > 0} onClick={() => remove(p)}
                        title={used > 0 ? "มีคำขอหรืองบประมาณใช้โปรเจกต์นี้อยู่ ลบไม่ได้" : "ลบโปรเจกต์"}>
                        ลบ
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
