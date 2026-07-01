"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus } from "lucide-react";

interface Props { projectId: string; userId: string; }

export function CreateArticleButton({ projectId, userId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    title: "", funnelStage: "TOFU", searchIntent: "INFORMATIONAL", brief: "",
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/articles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, projectId, createdById: userId }),
      });
      if (!res.ok) throw new Error("Failed");
      const article = await res.json();
      toast.success("สร้างบทความสำเร็จ!");
      setOpen(false);
      router.push(`/articles/${article.id}`);
    } catch {
      toast.error("เกิดข้อผิดพลาดในการสร้างบทความ");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} className="gap-2">
        <Plus className="h-4 w-4" /> สร้างบทความ
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>สร้างบทความใหม่</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="title">ชื่อบทความ</Label>
              <Input id="title" placeholder="วีซ่าเชงเก้นคืออะไร..." value={form.title} onChange={e => setForm(f => ({...f, title: e.target.value}))} required className="mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Funnel Stage</Label>
                <Select value={form.funnelStage} onValueChange={v => setForm(f => ({...f, funnelStage: v}))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TOFU">TOFU - Awareness</SelectItem>
                    <SelectItem value="MOFU">MOFU - Consideration</SelectItem>
                    <SelectItem value="BOFU">BOFU - Decision</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Search Intent</Label>
                <Select value={form.searchIntent} onValueChange={v => setForm(f => ({...f, searchIntent: v}))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="INFORMATIONAL">Informational</SelectItem>
                    <SelectItem value="NAVIGATIONAL">Navigational</SelectItem>
                    <SelectItem value="TRANSACTIONAL">Transactional</SelectItem>
                    <SelectItem value="COMMERCIAL">Commercial</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="brief">Brief (ไม่บังคับ)</Label>
              <Textarea id="brief" placeholder="อธิบายเนื้อหาที่ต้องการ..." value={form.brief} onChange={e => setForm(f => ({...f, brief: e.target.value}))} className="mt-1" rows={3} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>ยกเลิก</Button>
              <Button type="submit" disabled={loading}>{loading ? "กำลังสร้าง..." : "สร้างบทความ"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
