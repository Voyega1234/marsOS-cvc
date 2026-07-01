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

interface Props { orgId: string; userId: string; }

export function CreateProjectButton({ orgId, userId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: "", website: "", language: "th", businessType: "", targetAudience: "",
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, organizationId: orgId, createdById: userId }),
      });
      if (!res.ok) throw new Error("Failed to create project");
      toast.success("สร้างโปรเจ็กต์สำเร็จ!");
      setOpen(false);
      router.refresh();
    } catch {
      toast.error("เกิดข้อผิดพลาด ไม่สามารถสร้างโปรเจ็กต์ได้");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} className="gap-2">
        <Plus className="h-4 w-4" /> สร้างโปรเจ็กต์ใหม่
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>สร้างโปรเจ็กต์ใหม่</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label htmlFor="name">ชื่อโปรเจ็กต์</Label>
                <Input id="name" placeholder="เช่น Convert Cake" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} required className="mt-1 placeholder:text-gray-300" />
              </div>
              <div className="col-span-2">
                <Label htmlFor="website">เว็บไซต์</Label>
                <Input id="website" placeholder="เช่น convertcake.com" value={form.website} onChange={e => setForm(f => ({...f, website: e.target.value}))} required className="mt-1 placeholder:text-gray-300" />
              </div>
              <div>
                <Label htmlFor="language">ภาษา</Label>
                <Select value={form.language} onValueChange={v => setForm(f => ({...f, language: v}))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="th">ไทย (TH)</SelectItem>
                    <SelectItem value="en">English (EN)</SelectItem>
                    <SelectItem value="zh">Chinese (ZH)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="businessType">ประเภทธุรกิจ</Label>
                <Input id="businessType" placeholder="เช่น Performance Marketing Agency" value={form.businessType} onChange={e => setForm(f => ({...f, businessType: e.target.value}))} required className="mt-1 placeholder:text-gray-300" />
              </div>
              <div className="col-span-2">
                <Label htmlFor="targetAudience">กลุ่มเป้าหมาย</Label>
                <Textarea id="targetAudience" placeholder="เช่น ธุรกิจที่ต้องการทำโฆษณา SEO Performance Marketing" value={form.targetAudience} onChange={e => setForm(f => ({...f, targetAudience: e.target.value}))} required className="mt-1 placeholder:text-gray-300" rows={2} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>ยกเลิก</Button>
              <Button type="submit" disabled={loading}>{loading ? "กำลังสร้าง..." : "สร้างโปรเจ็กต์"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
