"use client";

/**
 * Convert Cake only: "ติดตาม" from the คำค้นหา / หน้าเว็บ tabs — pick the project folder and keyword group
 * the new tracker goes into. The parent does the POST; this only collects the choice.
 */
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UPLOAD_MAX_TRACKER_GROUP, type UploadGscTracker, type UploadGscTrackerFolder } from "@/lib/upload-article/gsc-trackers";

export interface TrackTarget { keyword: string; url: string; title?: string }

const NEW = "__new__";
const NONE = "";

const selectCls = "h-9 w-full rounded-full border border-gray-200 px-3 text-sm bg-white";
const inputCls = "mt-2 h-9 w-full rounded-full border border-gray-200 px-3 text-sm bg-white";

const sortTh = (a: string, b: string) => a.localeCompare(b, "th", { numeric: true });

export default function TrackToFolderDialog({
  target, folders, trackers, busy, onClose, onSubmit,
}: {
  target: TrackTarget | null;
  folders: UploadGscTrackerFolder[];
  trackers: UploadGscTracker[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (group: string, subgroup: string) => void;
}) {
  const folderNames = useMemo(() => {
    const set = new Set<string>(folders.map((f) => f.name));
    for (const t of trackers) if (t.group) set.add(t.group);
    return Array.from(set).sort(sortTh);
  }, [folders, trackers]);

  // last choice is kept while the page is open, so adding many rows to one group is quick
  const [folder, setFolder] = useState(NONE);
  const [newFolder, setNewFolder] = useState("");
  const [sub, setSub] = useState(NONE);
  const [newSub, setNewSub] = useState("");

  useEffect(() => {
    if (folder && folder !== NEW && !folderNames.includes(folder)) { setFolder(NONE); setSub(NONE); }
  }, [folder, folderNames]);

  const subNames = useMemo(() => {
    if (!folder || folder === NEW) return [];
    const set = new Set<string>(folders.find((f) => f.name === folder)?.subgroups ?? []);
    for (const t of trackers) if (t.group === folder && t.subgroup) set.add(t.subgroup);
    return Array.from(set).sort(sortTh);
  }, [folder, folders, trackers]);

  useEffect(() => {
    if (sub && sub !== NEW && !subNames.includes(sub)) setSub(NONE);
  }, [sub, subNames]);

  const groupValue = folder === NEW ? newFolder.trim() : folder;
  const subValue = !groupValue ? "" : sub === NEW ? newSub.trim() : sub;
  const missingName = (folder === NEW && !newFolder.trim()) || (sub === NEW && !newSub.trim());
  const label = target ? (target.keyword || target.title || target.url) : "";

  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>ติดตามเข้าโฟลเดอร์</DialogTitle>
          <DialogDescription className="break-all">
            {target?.keyword ? "Keyword" : "หน้าเว็บ"}: <span className="font-medium text-brand-navy">{label}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600" htmlFor="track-folder">โฟลเดอร์โปรเจกต์</label>
            <select id="track-folder" value={folder} onChange={(e) => { setFolder(e.target.value); setSub(NONE); }} className={selectCls}>
              <option value={NONE}>ไม่ใส่โฟลเดอร์</option>
              {folderNames.map((n) => <option key={n} value={n}>{n}</option>)}
              <option value={NEW}>+ สร้างโฟลเดอร์ใหม่</option>
            </select>
            {folder === NEW && (
              <input autoFocus value={newFolder} onChange={(e) => setNewFolder(e.target.value)} maxLength={UPLOAD_MAX_TRACKER_GROUP}
                placeholder="ชื่อโฟลเดอร์ เช่น Ads Landingpage" aria-label="ชื่อโฟลเดอร์ใหม่" className={inputCls} />
            )}
          </div>

          {groupValue && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600" htmlFor="track-sub">กลุ่ม keyword</label>
              <select id="track-sub" value={sub} onChange={(e) => setSub(e.target.value)} className={selectCls}>
                <option value={NONE}>ไม่ใส่กลุ่ม keyword</option>
                {subNames.map((n) => <option key={n} value={n}>{n}</option>)}
                <option value={NEW}>+ สร้างกลุ่ม keyword ใหม่</option>
              </select>
              {sub === NEW && (
                <input autoFocus value={newSub} onChange={(e) => setNewSub(e.target.value)} maxLength={UPLOAD_MAX_TRACKER_GROUP}
                  placeholder="ชื่อกลุ่ม keyword เช่น รับทำ ChatGPT Ads" aria-label="ชื่อกลุ่ม keyword ใหม่" className={inputCls} />
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>ยกเลิก</Button>
          <Button disabled={busy || missingName} onClick={() => onSubmit(groupValue, subValue)}>ติดตาม</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
