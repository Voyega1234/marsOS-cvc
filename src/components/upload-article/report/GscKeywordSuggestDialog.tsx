"use client";

// Upload Article > Report > Keyword ที่ติดตาม — "หาคำใกล้เคียง"
// Pulls this site's GSC queries that contain a term (e.g. "cpas" -> "cpas คือ", "cpas ads"),
// sorted by clicks or impressions; the user ticks the ones to track and adds them to one group.
// Convert Cake: opened from a keyword group (initialSubgroup), every row also gets a "+" that adds
// that one keyword into the keyword group right away and keeps the dialog open.

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, Folder, Loader2, Plus, Search, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ds";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UPLOAD_MAX_TRACKER_GROUP, type GscKeywordSuggestion, type GscKeywordSuggestResponse, type UploadGscTracker } from "@/lib/upload-article/gsc-trackers";
import type { UploadOwnerTag } from "@/lib/upload-article/types";

type SortKey = "clicks" | "impressions";
const SORT_OPTIONS = [
  { value: "clicks" as const, label: "เรียงตามคลิก" },
  { value: "impressions" as const, label: "เรียงตามการแสดงผล" },
];

function fmtNum(n: number): string { return Math.round(n).toLocaleString(); }
function fmtPos(n: number): string { return n ? n.toFixed(1) : "—"; }

/** "Blog 45 - cpas" -> "cpas": the part after the last dash is usually the keyword */
export function termFromGroupName(name: string): string {
  const parts = name.split(/\s[-–—|]\s/);
  return (parts[parts.length - 1] || name).trim();
}

function Delta({ diff, lowerIsBetter = false }: { diff: number; lowerIsBetter?: boolean }) {
  if (!diff || !Number.isFinite(diff)) return null;
  const good = lowerIsBetter ? diff < 0 : diff > 0;
  const text = lowerIsBetter ? Math.abs(diff).toFixed(1) : fmtNum(Math.abs(diff));
  return <span className={`ml-1 text-[10px] ${good ? "text-emerald-600" : "text-rose-500"}`}>{diff > 0 ? "▲" : "▼"}{text}</span>;
}

export default function GscKeywordSuggestDialog({
  clientId, open, onOpenChange, initialTerm = "", initialGroup = "", initialSubgroup = "", periodParams, ownerTags = [], defaultOwnerTagId = "", onTrackersChange,
}: {
  clientId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTerm?: string;
  initialGroup?: string;
  /** Convert Cake: the keyword group (inside folder initialGroup) the found keywords go into */
  initialSubgroup?: string;
  periodParams: Record<string, unknown>;
  ownerTags?: UploadOwnerTag[];
  defaultOwnerTagId?: string;
  onTrackersChange: (trackers: UploadGscTracker[]) => void;
}) {
  const [term, setTerm] = useState(initialTerm);
  const [group, setGroup] = useState(initialGroup);
  const [owner, setOwner] = useState(defaultOwnerTagId);
  const [sort, setSort] = useState<SortKey>("clicks");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<GscKeywordSuggestResponse | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const subgroup = initialSubgroup.trim();
  // a keyword group lives inside one folder, so the folder is fixed when the dialog was opened from one
  const targetGroup = subgroup ? initialGroup.trim() : group.trim();
  const target = subgroup ? { group: targetGroup, subgroup } : { group: targetGroup };

  async function search(q = term) {
    const t = q.trim();
    if (t.length < 2) { setError("พิมพ์คำหลักอย่างน้อย 2 ตัวอักษร"); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch(`/api/upload-article/clients/${clientId}/report/trackers/suggest`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...periodParams, term: t }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "หาคำไม่สำเร็จ");
      setResult(d as GscKeywordSuggestResponse);
      setPicked(new Set());
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  // Each open starts fresh from the button that opened it; a prefilled term searches right away.
  useEffect(() => {
    if (!open) return;
    setTerm(initialTerm); setGroup(initialGroup); setOwner(defaultOwnerTagId);
    setResult(null); setPicked(new Set()); setAdding(new Set()); setError("");
    if (initialTerm.trim().length >= 2) void search(initialTerm);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    const list = [...(result?.suggestions ?? [])];
    list.sort((a, b) => (sort === "clicks"
      ? b.clicks - a.clicks || b.impressions - a.impressions
      : b.impressions - a.impressions || b.clicks - a.clicks));
    return list;
  }, [result, sort]);
  const pickable = rows.filter((r) => !r.tracked);
  const remaining = result?.remaining ?? 0;
  const overBy = Math.max(0, picked.size - remaining);
  const allPicked = pickable.length > 0 && pickable.every((r) => picked.has(r.keyword));

  function toggle(r: GscKeywordSuggestion, on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(r.keyword); else next.delete(r.keyword);
      return next;
    });
  }

  async function add() {
    if (picked.size === 0) return;
    setSaving(true);
    try {
      // keep the on-screen order so the group reads the same as the list
      const keywords = rows.filter((r) => picked.has(r.keyword)).map((r) => r.keyword);
      const res = await fetch(`/api/upload-article/clients/${clientId}/report/trackers`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords, ...target, ownerTagId: owner }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "เพิ่มไม่สำเร็จ");
      if (Array.isArray(d.trackers)) onTrackersChange(d.trackers);
      const notes = [
        d.duplicates ? `ซ้ำ ${d.duplicates}` : "",
        d.overLimit ? `เกินเพดาน ${d.overLimit}` : "",
      ].filter(Boolean).join(", ");
      const into = subgroup ? ` เข้ากลุ่ม keyword "${subgroup}"` : targetGroup ? ` เข้ากลุ่ม "${targetGroup}"` : "";
      toast.success(`เพิ่ม ${d.added} คำ${into}${notes ? ` (ข้าม: ${notes})` : ""}`);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  /** "+" on one row: add that keyword into the keyword group now; the dialog stays open for the next one */
  async function addOne(keyword: string) {
    if (adding.has(keyword)) return;
    setAdding((prev) => new Set(prev).add(keyword));
    try {
      const res = await fetch(`/api/upload-article/clients/${clientId}/report/trackers`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords: [keyword], ...target, ownerTagId: owner }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "เพิ่มไม่สำเร็จ");
      if (Array.isArray(d.trackers)) onTrackersChange(d.trackers);
      if (!d.added) throw new Error(d.overLimit ? "เต็มเพดานแล้ว เพิ่มไม่ได้" : "คำนี้ติดตามอยู่แล้ว");
      setResult((prev) => prev && {
        ...prev,
        remaining: Math.max(0, prev.remaining - 1),
        suggestions: prev.suggestions.map((r) => (r.keyword === keyword ? { ...r, tracked: true } : r)),
      });
      setPicked((prev) => { const next = new Set(prev); next.delete(keyword); return next; });
      toast.success(`เพิ่ม "${keyword}" เข้ากลุ่ม keyword "${subgroup}" แล้ว`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding((prev) => { const next = new Set(prev); next.delete(keyword); return next; });
    }
  }

  const inputCls = "h-9 rounded-full border border-gray-200 px-3 text-sm bg-white";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!saving) onOpenChange(v); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>หาคำใกล้เคียง</DialogTitle>
          <DialogDescription>
            {subgroup
              ? "ดึงคำค้นหาจาก Search Console ของเว็บนี้ที่มีคำหลักอยู่ กด + ที่คำที่ต้องการเพื่อเพิ่มเข้ากลุ่ม keyword นี้ หรือติ๊กหลายคำแล้วเพิ่มทีเดียว (ติดตามเป็น keyword ทั้งเว็บ)"
              : "ดึงคำค้นหาจาก Search Console ของเว็บนี้ที่มีคำหลักอยู่ ติ๊กคำที่ต้องการ แล้วเพิ่มเข้ากลุ่มทีเดียว (ติดตามเป็น keyword ทั้งเว็บ)"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <form className="flex items-center gap-2 flex-wrap" onSubmit={(e) => { e.preventDefault(); void search(); }}>
            <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="คำหลัก เช่น cpas" aria-label="คำหลัก"
              className={`${inputCls} flex-1 min-w-[180px]`} autoFocus />
            <Button type="submit" size="sm" disabled={loading} className="rounded-full">
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} ค้นหา
            </Button>
          </form>

          <div className="flex items-center gap-2 flex-wrap">
            {subgroup ? (
              <div className="flex flex-1 min-w-[180px] items-center gap-1.5 flex-wrap text-[11px]">
                <span className="text-gray-500">เพิ่มเข้า</span>
                <span title={targetGroup} className="inline-flex max-w-[200px] items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 font-medium text-blue-700">
                  <Folder size={11} className="shrink-0" /><span className="truncate">{targetGroup}</span>
                </span>
                <span title={subgroup} className="inline-flex max-w-[200px] items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 font-medium text-violet-700">
                  <Tag size={11} className="shrink-0" /><span className="truncate">{subgroup}</span>
                </span>
              </div>
            ) : (
              <input value={group} onChange={(e) => setGroup(e.target.value)} list="tracker-group-names" maxLength={UPLOAD_MAX_TRACKER_GROUP}
                placeholder="ชื่อกลุ่ม (ไม่ใส่ = ไม่มีกลุ่ม)" aria-label="เพิ่มเข้ากลุ่ม" className={`${inputCls} flex-1 min-w-[180px]`} />
            )}
            {ownerTags.length > 0 && (
              <select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="ผู้ดูแลของคำที่เพิ่ม" className={inputCls}>
                <option value="">ไม่ระบุผู้ดูแล</option>
                {ownerTags.map((o) => <option key={o.id} value={o.id}>ผู้ดูแล: {o.name}</option>)}
              </select>
            )}
          </div>

          {error && <p className="text-xs text-rose-600">{error}</p>}

          {result && (
            <>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <Segmented size="sm" ariaLabel="เรียงตาม" value={sort} onChange={setSort} options={SORT_OPTIONS} />
                <span className="text-[11px] text-gray-500">
                  เจอ {rows.length} คำที่มี "{result.term}"{rows.length >= 200 ? " (แสดง 200 อันดับแรก)" : ""}
                </span>
              </div>
              {rows.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-500">ไม่มีคำค้นหาที่มี "{result.term}" ในช่วงเวลานี้</p>
              ) : (
                <div className="max-h-[50vh] overflow-auto rounded-xl border border-gray-100">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-gray-50 text-[11px] text-gray-500">
                      <tr>
                        <th className="px-3 py-2 w-8">
                          <input type="checkbox" aria-label="เลือกทั้งหมด" checked={allPicked} disabled={pickable.length === 0}
                            onChange={(e) => setPicked(e.target.checked ? new Set(pickable.map((r) => r.keyword)) : new Set())} />
                        </th>
                        <th className="px-2 py-2 text-left font-medium">คำค้นหา</th>
                        <th className="px-2 py-2 text-right font-medium">คลิก</th>
                        <th className="px-2 py-2 text-right font-medium">การแสดงผล</th>
                        <th className="px-3 py-2 text-center font-medium">อันดับเฉลี่ย</th>
                        {subgroup && <th className="px-3 py-2 w-10"><span className="sr-only">เพิ่มเข้ากลุ่ม keyword</span></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.keyword} className={`border-t border-gray-100 ${r.tracked ? "opacity-50" : "hover:bg-gray-50/60"}`}>
                          <td className="px-3 py-1.5">
                            <input type="checkbox" aria-label={`เลือก ${r.keyword}`} disabled={r.tracked}
                              checked={r.tracked || picked.has(r.keyword)} onChange={(e) => toggle(r, e.target.checked)} />
                          </td>
                          <td className="px-2 py-1.5">
                            <label className="cursor-pointer">{r.keyword}</label>
                            {r.tracked && <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500">ติดตามแล้ว</span>}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{fmtNum(r.clicks)}<Delta diff={r.clicks - r.prevClicks} /></td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{fmtNum(r.impressions)}<Delta diff={r.impressions - r.prevImpressions} /></td>
                          <td className="px-3 py-1.5 text-center tabular-nums">
                            {fmtPos(r.position)}
                            {r.prevPosition > 0 && r.position > 0 && <Delta diff={r.position - r.prevPosition} lowerIsBetter />}
                          </td>
                          {subgroup && (
                            <td className="px-3 py-1.5 text-center">
                              {r.tracked ? (
                                <Check size={14} className="inline text-emerald-600" aria-label="ติดตามแล้ว" />
                              ) : (
                                <button type="button" disabled={saving || adding.has(r.keyword) || remaining <= 0} onClick={() => void addOne(r.keyword)}
                                  title={remaining <= 0 ? "เต็มเพดานแล้ว" : `เพิ่ม "${r.keyword}" เข้ากลุ่ม keyword "${subgroup}"`}
                                  aria-label={`เพิ่ม ${r.keyword} เข้ากลุ่ม keyword ${subgroup}`}
                                  className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-gray-200 bg-white text-brand-blue hover:bg-brand-mist disabled:opacity-40">
                                  {adding.has(r.keyword) ? <Loader2 size={12} className="animate-spin" /> : <Plus size={13} />}
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <span className={`text-[11px] ${overBy ? "text-rose-600" : "text-gray-500"}`}>
            {result
              ? overBy
                ? `เลือกเกินเพดาน ${overBy} คำ — เพิ่มได้อีก ${remaining} จาก ${result.limit}`
                : `เลือก ${picked.size} คำ · เพิ่มได้อีก ${remaining} จาก ${result.limit}`
              : ""}
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" className="rounded-full" disabled={saving} onClick={() => onOpenChange(false)}>ยกเลิก</Button>
            <Button type="button" size="sm" className="rounded-full" disabled={saving || picked.size === 0 || overBy > 0} onClick={() => void add()}>
              {saving && <Loader2 size={14} className="animate-spin" />}
              เพิ่ม {picked.size || ""} คำ{targetGroup ? "เข้ากลุ่ม" : ""}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
