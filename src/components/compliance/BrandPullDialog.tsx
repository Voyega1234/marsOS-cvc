"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Info, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Chip, EmptyState, SearchPill } from "@/components/ds";
import type { BrandDetail } from "@/lib/compliance/brand";
import { RULE_TYPE_LABEL, SEVERITY_LABEL } from "@/lib/compliance/types";
import { api, type IndustryOpt } from "./shared";
import type { RuleRow } from "./RulesTab";

type PullStatus = "ACTIVE" | "DRAFT";

export default function BrandPullDialog({ brand, industries, onClose, onSaved }: {
  brand: BrandDetail;
  industries: IndustryOpt[];
  onClose: () => void;
  onSaved: (brand: BrandDetail) => void;
}) {
  const [industry, setIndustry] = useState(() => {
    if (brand.industry && industries.some((i) => i.key === brand.industry)) return brand.industry;
    return (industries.find((i) => i.active + i.draft > 0) ?? industries[0])?.key ?? "";
  });
  const [status, setStatus] = useState<PullStatus>("ACTIVE");
  const [q, setQ] = useState("");
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const linked = useMemo(
    () => new Set(brand.rules.map((r) => r.libraryRuleId).filter((x): x is string => !!x)),
    [brand.rules],
  );

  useEffect(() => {
    if (!industry) { setRules([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const p = new URLSearchParams({ industry, status });
      const { ok, data } = await api<{ rules: RuleRow[] }>(`/api/compliance/rules?${p.toString()}`);
      if (cancelled) return;
      if (!ok) toast.error(data.error || "โหลดกฎไม่สำเร็จ");
      setRules(ok && Array.isArray(data.rules) ? data.rules : []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [industry, status]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rules;
    return rules.filter((r) => `${r.code} ${r.title}`.toLowerCase().includes(needle));
  }, [rules, q]);

  const selectable = visible.filter((r) => !linked.has(r.id));
  const allChecked = selectable.length > 0 && selectable.every((r) => selected.has(r.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allChecked) selectable.forEach((r) => next.delete(r.id));
      else selectable.forEach((r) => next.add(r.id));
      return next;
    });
  }

  async function pull() {
    if (selected.size === 0) return;
    setSaving(true);
    const { ok, data } = await api<{ brand: BrandDetail; added: number; skipped: number }>(
      `/api/compliance/brands/${brand.id}/rules`,
      { method: "POST", body: JSON.stringify({ libraryRuleIds: Array.from(selected) }) },
    );
    setSaving(false);
    if (!ok || !data.brand) { toast.error(data.error || "ดึงกฎไม่สำเร็จ", { duration: 9000 }); return; }
    toast.success(`ดึงเข้าแบรนด์แล้ว ${data.added} ข้อ${data.skipped > 0 ? ` · ข้าม ${data.skipped} ข้อ` : ""}`);
    onSaved(data.brand);
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v && !saving) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>ดึงกฎจากคลังกฎ</DialogTitle></DialogHeader>
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>กฎที่ดึงมาใช้เนื้อหาปัจจุบันของคลังกฎเสมอ — แก้ที่คลังกฎแล้วมีผลกับทุกแบรนด์ที่ดึงไป</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={industry} onChange={(e) => setIndustry(e.target.value)} aria-label="อุตสาหกรรม" className="h-9 rounded-full border border-gray-200 bg-white px-3 text-xs">
            {industries.map((i) => <option key={i.key} value={i.key}>{i.label}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value as PullStatus)} aria-label="สถานะกฎ" className="h-9 rounded-full border border-gray-200 bg-white px-3 text-xs">
            <option value="ACTIVE">เปิดใช้อยู่</option>
            <option value="DRAFT">ฉบับร่าง</option>
          </select>
          <SearchPill value={q} onChange={setQ} placeholder="ค้นหารหัส / ชื่อกฎ" className="w-full sm:w-56" />
          <label className="flex items-center gap-1.5 text-xs text-gray-700 sm:ml-auto">
            <input type="checkbox" checked={allChecked} disabled={selectable.length === 0} onChange={toggleAll} />
            เลือกทั้งหมด
          </label>
        </div>

        <div className="rounded-2xl border border-gray-100">
          {loading ? (
            <EmptyState icon={<Loader2 className="h-5 w-5 animate-spin" />} title="กำลังโหลด..." />
          ) : visible.length === 0 ? (
            <EmptyState title="ไม่พบกฎ" description="ลองเปลี่ยนอุตสาหกรรม สถานะ หรือคำค้น" />
          ) : (
            <div className="max-h-[45vh] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>รหัส</TableHead>
                    <TableHead>ชื่อกฎ</TableHead>
                    <TableHead>ประเภท</TableHead>
                    <TableHead>ความรุนแรง</TableHead>
                    <TableHead>จำนวนคำ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((r) => {
                    const already = linked.has(r.id);
                    return (
                      <TableRow key={r.id} className={already ? "opacity-60" : undefined}>
                        <TableCell>
                          <input
                            type="checkbox" aria-label={`เลือก ${r.code || r.title}`}
                            disabled={already} checked={already || selected.has(r.id)} onChange={() => toggle(r.id)}
                          />
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs">{r.code || "—"}</TableCell>
                        <TableCell className="min-w-[200px]">
                          <span className="font-medium text-brand-navy">{r.title}</span>
                          {already && <Chip tone="muted" className="ml-2">ดึงแล้ว</Chip>}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs">{RULE_TYPE_LABEL[r.ruleType] ?? r.ruleType}</TableCell>
                        <TableCell>
                          <Chip tone={r.severity === "CRITICAL" || r.severity === "HIGH" ? "bad" : r.severity === "MEDIUM" ? "warn" : "info"}>{SEVERITY_LABEL[r.severity]}</Chip>
                        </TableCell>
                        <TableCell className="text-center text-xs">{r.terms.length}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={saving}>ยกเลิก</Button>
          <Button onClick={pull} disabled={saving || selected.size === 0}>
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            ดึง {selected.size} ข้อ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
