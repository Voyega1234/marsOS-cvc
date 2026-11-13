"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Chip, EmptyState, Panel, SearchPill, Segmented } from "@/components/ds";
import { CHECK_STATUS_LABEL, SEVERITY_LABEL, industryLabel, type CheckStatus } from "@/lib/compliance/types";
import { api, fmtDateTime, riskTone, statusTone, type CheckFull, type CheckRow, type IndustryOpt } from "./shared";
import CheckResult from "./CheckResult";

type StatusFilter = "" | CheckStatus;

export default function HistoryTab({ industries, userRole }: { industries: IndustryOpt[]; userRole: string }) {
  const [status, setStatus] = useState<StatusFilter>("");
  const [industry, setIndustry] = useState("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<CheckRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<CheckFull | null>(null);
  const [opening, setOpening] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (industry) p.set("industry", industry);
    if (q.trim()) p.set("q", q.trim());
    const { ok, data } = await api<{ checks: CheckRow[] }>(`/api/compliance/checks?${p.toString()}`);
    if (!ok) toast.error(data.error || "โหลดผลตรวจไม่สำเร็จ");
    setRows(ok && Array.isArray(data.checks) ? data.checks : []);
    setLoading(false);
  }, [status, industry, q]);

  useEffect(() => {
    const t = setTimeout(() => { void load(); }, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  async function openRow(id: string) {
    setOpening(true);
    const { ok, data } = await api<{ check: CheckFull }>(`/api/compliance/checks/${id}`);
    setOpening(false);
    if (!ok || !data.check) { toast.error(data.error || "เปิดผลตรวจไม่สำเร็จ"); return; }
    setOpen(data.check);
  }

  function changed(c: CheckFull) {
    setOpen(c);
    void load();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<StatusFilter>
          value={status}
          onChange={setStatus}
          size="sm"
          options={[
            { value: "", label: "ทั้งหมด" },
            { value: "PENDING_REVIEW", label: CHECK_STATUS_LABEL.PENDING_REVIEW },
            { value: "CHANGES_REQUESTED", label: CHECK_STATUS_LABEL.CHANGES_REQUESTED },
            { value: "APPROVED", label: CHECK_STATUS_LABEL.APPROVED },
            { value: "REJECTED", label: CHECK_STATUS_LABEL.REJECTED },
          ]}
        />
        <select value={industry} onChange={(e) => setIndustry(e.target.value)} aria-label="อุตสาหกรรม" className="h-9 rounded-full border border-gray-200 bg-white px-3 text-xs">
          <option value="">ทุกอุตสาหกรรม</option>
          {industries.map((i) => <option key={i.key} value={i.key}>{i.label}</option>)}
        </select>
        <SearchPill value={q} onChange={setQ} placeholder="ค้นหาชื่อบทความ" className="w-full sm:w-64" />
      </div>

      <Panel padded={false}>
        {loading ? (
          <EmptyState icon={<Loader2 className="h-5 w-5 animate-spin" />} title="กำลังโหลด..." />
        ) : rows.length === 0 ? (
          <EmptyState title="ยังไม่มีผลตรวจ" description="ไปที่แท็บ ตรวจบทความ เพื่อเริ่มตรวจ" />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>วันที่</TableHead>
                  <TableHead>บทความ</TableHead>
                  <TableHead>เจ้าของ</TableHead>
                  <TableHead>อุตสาหกรรม</TableHead>
                  <TableHead>ความเสี่ยง</TableHead>
                  <TableHead>สถานะ</TableHead>
                  <TableHead>ผู้ตรวจ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => openRow(r.id)}>
                    <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(r.createdAt)}</TableCell>
                    <TableCell className="min-w-[200px] font-medium text-brand-navy">{r.title || "—"}</TableCell>
                    <TableCell className="text-xs">{r.ownerLabel || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{industryLabel(r.industry)}</TableCell>
                    <TableCell><Chip tone={riskTone(r.riskLevel)}>{SEVERITY_LABEL[r.riskLevel]} · {r.riskScore}</Chip></TableCell>
                    <TableCell><Chip tone={statusTone(r.status)}>{CHECK_STATUS_LABEL[r.status]}</Chip></TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{r.reviewedByName || r.createdByName || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>
      {opening && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> กำลังเปิดผลตรวจ...</p>}

      <Dialog open={!!open} onOpenChange={(v) => { if (!v) setOpen(null); }}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>รายละเอียดผลตรวจ</DialogTitle></DialogHeader>
          {open && <CheckResult check={open} userRole={userRole} onChange={changed} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
