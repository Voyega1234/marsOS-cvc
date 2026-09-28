"use client";

/**
 * Dialog "วางข้อความ" — contentEditable ที่จับ text/html จาก clipboard ตอน paste
 * (รักษา format เดิมของบทความที่ก็อปมาจาก Word/Google Docs ได้)
 */
import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function PasteDialog({
  open,
  onOpenChange,
  onSubmit,
  busy,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (data: { title?: string; html?: string; text?: string }) => void;
  busy?: boolean;
}) {
  const [title, setTitle] = useState("");
  const editorRef = useRef<HTMLDivElement>(null);
  const [hasContent, setHasContent] = useState(false);

  function reset() {
    setTitle("");
    setHasContent(false);
    if (editorRef.current) editorRef.current.innerHTML = "";
  }

  function handleSubmit() {
    const el = editorRef.current;
    if (!el) return;
    const html = el.innerHTML.trim();
    const text = el.innerText.trim();
    if (!html && !text) return;
    onSubmit({ title: title.trim() || undefined, html: html || undefined, text: !html ? text : undefined });
  }

  return (
    <Dialog open={open} onOpenChange={v => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>วางข้อความบทความ</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">ชื่อบทความ (ไม่บังคับ)</label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="ถ้าเว้นว่าง ระบบจะดึงจากหัวข้อแรกในเนื้อหา" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              เนื้อหาบทความ — วาง (Ctrl/Cmd+V) จาก Word / Google Docs / เว็บ ได้เลย
            </label>
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              onInput={() => setHasContent(!!editorRef.current?.innerText.trim())}
              className="min-h-[240px] max-h-[50vh] overflow-y-auto rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
              data-placeholder="วางเนื้อหาบทความที่นี่..."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>ยกเลิก</Button>
          <Button disabled={!hasContent || busy} onClick={handleSubmit}>
            {busy ? "กำลังนำเข้า..." : "นำเข้า"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
