"use client";

/** Dialog "ลิงก์ Google Doc" — ผู้ใช้แชร์เอกสารแบบ Anyone with the link แล้ววางลิงก์ */
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function GoogleDocDialog({
  open,
  onOpenChange,
  onSubmit,
  busy,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (data: { googleDocUrl: string; title?: string }) => void;
  busy?: boolean;
}) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");

  function reset() {
    setUrl("");
    setTitle("");
  }

  return (
    <Dialog open={open} onOpenChange={v => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>นำเข้าจาก Google Doc</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">ลิงก์ Google Doc</label>
            <Input
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://docs.google.com/document/d/…/edit"
            />
            <p className="text-[11px] text-gray-400 mt-1">
              ต้องแชร์เอกสารแบบ "Anyone with the link" ก่อน ระบบจึงจะอ่านเนื้อหาได้
            </p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">ชื่อบทความ (ไม่บังคับ)</label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="ถ้าเว้นว่าง ระบบจะดึงจากหัวข้อในเอกสาร" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>ยกเลิก</Button>
          <Button
            disabled={!url.trim() || busy}
            onClick={() => onSubmit({ googleDocUrl: url.trim(), title: title.trim() || undefined })}
          >
            {busy ? "กำลังนำเข้า..." : "นำเข้า"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
