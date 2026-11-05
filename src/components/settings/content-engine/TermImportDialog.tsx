"use client";

// ตรวจรายการคำจากไฟล์ก่อนใส่ในข้อจำกัด — ทีมเห็นทุกคำที่อ่านได้ และเลือกได้เอง
// คำที่ชนชื่อสินค้าไม่ติ๊กให้ เพราะถ้าห้ามจริง ระบบจะแก้คำนั้นออกจากบทความทุกชิ้น

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  applyClientConflicts,
  approvedLinesFrom,
  bannedLinesFrom,
  looksLikeBadTermImport,
  type TermCandidate,
} from "@/lib/restriction-table";
import { cn } from "@/lib/utils";

type Filter = "all" | "banned" | "approved" | "warning";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "ทั้งหมด" },
  { key: "banned", label: "ห้ามใช้" },
  { key: "approved", label: "ใช้ได้" },
  { key: "warning", label: "ต้องตรวจ" },
];

function keyOf(c: TermCandidate): string {
  return `${c.kind}:${c.term}`;
}

export function TermImportDialog({
  fileName,
  candidates,
  usedTerms,
  existingBanned,
  existingApproved,
  defaultKeywords,
  onClose,
  onApply,
}: {
  fileName: string;
  candidates: TermCandidate[];
  usedTerms: string[];
  existingBanned: string;
  existingApproved: string;
  defaultKeywords: string;
  onClose: () => void;
  onApply: (patch: { bannedTerms?: string; approvedTerms?: string }) => void;
}) {
  const [keywords, setKeywords] = useState(defaultKeywords);
  const [filter, setFilter] = useState<Filter>("all");
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const badExisting = useMemo(() => looksLikeBadTermImport(existingBanned), [existingBanned]);
  const [mode, setMode] = useState<"append" | "replace">(badExisting ? "replace" : "append");

  const rows = useMemo(() => {
    const checked = applyClientConflicts(candidates, { usedTerms, productKeywords: keywords });
    return checked.map((c) => {
      const ticked = overrides.get(keyOf(c));
      return ticked === undefined ? c : { ...c, ticked };
    });
  }, [candidates, usedTerms, keywords, overrides]);

  const visible = useMemo(
    () =>
      rows.filter((c) => {
        if (filter === "warning") return c.warnings.length > 0;
        return filter === "all" || c.kind === filter;
      }),
    [rows, filter],
  );

  const count = (kind: TermCandidate["kind"]) => {
    const list = rows.filter((c) => c.kind === kind);
    return { total: list.length, ticked: list.filter((c) => c.ticked).length };
  };
  const banned = count("banned");
  const approved = count("approved");

  function setTicked(list: TermCandidate[], ticked: boolean) {
    setOverrides((prev) => {
      const next = new Map(prev);
      for (const c of list) next.set(keyOf(c), ticked);
      return next;
    });
  }

  function apply() {
    const replace = mode === "replace";
    const merge = (existing: string, lines: string[]) =>
      [replace ? "" : existing.trim(), ...lines].filter(Boolean).join("\n");
    const patch: { bannedTerms?: string; approvedTerms?: string } = {};
    if (banned.total) patch.bannedTerms = merge(existingBanned, bannedLinesFrom(rows, replace ? "" : existingBanned));
    if (approved.total) patch.approvedTerms = merge(existingApproved, approvedLinesFrom(rows, replace ? "" : existingApproved));
    onApply(patch);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>ตรวจรายการคำจาก {fileName}</DialogTitle>
          <DialogDescription>
            อ่านได้ห้ามใช้ {banned.total.toLocaleString()} คำ ใช้ได้ {approved.total.toLocaleString()} คำ รายการที่มีป้ายเตือนไม่ได้เลือกไว้ให้ ฝ่ายกฎหมายของลูกค้าควรยืนยันรายการก่อนใช้จริง
          </DialogDescription>
        </DialogHeader>

        {/\.pdf$/i.test(fileName) && (
          <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
            รายการนี้ประกอบจากตำแหน่งข้อความใน PDF ถ้ามีไฟล์เดียวกันเป็น Excel หรือ CSV ใช้ไฟล์นั้นจะแม่นกว่า และได้คำแทนที่กำหนดไว้ด้วย
          </p>
        )}

        <div>
          <Label className="text-xs">คำหลักของสินค้าที่ต้องไม่ถูกห้าม (คั่นด้วย ,)</Label>
          <Input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="เช่น สเต็มเซลล์, เซลล์ต้นกำเนิด" />
          <p className="mt-1 text-[11px] text-gray-500">
            คำห้ามที่ตรงกับคำเหล่านี้จะไม่ถูกเลือก เพราะถ้าเลือก ระบบจะแก้คำนั้นออกจากบทความทุกชิ้น ถ้าต้องห้ามจริงให้ติ๊กเอง
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs",
                filter === f.key ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-gray-200 text-gray-600",
              )}
            >
              {f.label}
            </button>
          ))}
          <span className="ml-auto flex gap-1">
            <Button size="sm" variant="outline" onClick={() => setTicked(visible, true)}>
              เลือกทั้งหมดที่แสดง
            </Button>
            <Button size="sm" variant="outline" onClick={() => setTicked(visible, false)}>
              ไม่เลือกที่แสดง
            </Button>
          </span>
        </div>

        <div className="max-h-[42vh] divide-y divide-gray-100 overflow-y-auto rounded-xl border border-gray-200">
          {visible.map((c) => (
            <label key={keyOf(c)} className="flex items-start gap-2 px-3 py-1.5 text-xs" title={c.note || undefined}>
              <input type="checkbox" className="mt-0.5" checked={c.ticked} onChange={(e) => setTicked([c], e.target.checked)} />
              <span className="min-w-0 flex-1">
                <span className="text-gray-800">{c.term}</span>
                {c.replacement && <span className="text-gray-500"> {"=>"} {c.replacement}</span>}
                {c.warnings.map((w) => (
                  <span key={w} className="ml-1.5 rounded bg-amber-50 px-1 py-px text-[10px] text-amber-700">
                    {w}
                  </span>
                ))}
              </span>
              <span
                className={cn(
                  "shrink-0 rounded-full px-1.5 py-px text-[10px]",
                  c.kind === "banned" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700",
                )}
              >
                {c.kind === "banned" ? "ห้ามใช้" : "ใช้ได้"}
              </span>
            </label>
          ))}
          {visible.length === 0 && <p className="p-3 text-xs text-gray-400">ไม่มีรายการ</p>}
        </div>

        <div className="space-y-1 text-xs text-gray-600">
          <label className="flex items-center gap-2">
            <input type="radio" checked={mode === "append"} onChange={() => setMode("append")} /> เพิ่มต่อจากรายการเดิม
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={mode === "replace"} onChange={() => setMode("replace")} /> แทนที่รายการเดิมทั้งหมด
          </label>
          {badExisting && (
            <p className="text-amber-700">รายการเดิมดูเหมือนอ่านผิดคอลัมน์ (เช่น {'"ก. => 1"'}) จึงเลือกแทนที่ไว้ให้</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button onClick={apply} disabled={!banned.ticked && !approved.ticked}>
            ใส่ห้ามใช้ {banned.ticked.toLocaleString()} · ใช้ได้ {approved.ticked.toLocaleString()} คำ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
