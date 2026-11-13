"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2, Pencil, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Chip } from "@/components/ds";
import { CHECK_LABEL, CHECK_TONE, STATUS_LABEL, STATUS_TONE, type BlmStatus, type CheckStatus } from "@/lib/backlink-management/types";
import { ACTION_LABEL, allowedActions, type BlmAction } from "@/lib/backlink-management/workflow";
import { api, fmtDate, fmtDateTime, money, type BlmRow } from "./shared";

interface EventRow {
  id: string; type: string; fromStatus: string; toStatus: string; amount: number | null; note: string;
  source: string; actorName: string; createdAt: string;
}

interface BudgetBlock {
  error: string;
  budget: { approved: number; reserved: number; actual: number; remaining: number; period: string; hasBudgetRow: boolean };
}

export default function RequestDrawer({ id, onClose, role, userId, onChanged, onEdit }: {
  id: string | null;
  onClose: () => void;
  role: string;
  userId: string;
  onChanged: () => void;
  onEdit: (row: BlmRow) => void;
}) {
  const [row, setRow] = useState<BlmRow | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [publishOpen, setPublishOpen] = useState(false);
  const [liveUrl, setLiveUrl] = useState("");
  const [actualPrice, setActualPrice] = useState("");
  const [block, setBlock] = useState<BudgetBlock | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const d = await api<{ request: BlmRow; events: EventRow[] }>(`/api/backlink-management/requests/${id}`);
      setRow(d.request);
      setEvents(d.events);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "โหลดไม่สำเร็จ");
    }
  }, [id]);

  useEffect(() => { setRow(null); setEvents([]); void load(); }, [load]);

  async function act(action: BlmAction, extra: Record<string, unknown> = {}) {
    if (!row) return;
    setBusy(true);
    try {
      const d = await api<{ request: BlmRow }>(`/api/backlink-management/requests/${row.id}`, { method: "PATCH", json: { action, ...extra } });
      setRow(d.request);
      toast.success(`${ACTION_LABEL[action]} แล้ว`);
      setRejectOpen(false); setPublishOpen(false); setBlock(null);
      onChanged();
      void load();
    } catch (e) {
      const err = e as Error & { status?: number; data?: BudgetBlock };
      if (err.status === 409 && err.data?.budget) setBlock(err.data);
      else toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!row) return;
    setBusy(true);
    try {
      const d = await api<{ request: BlmRow }>(`/api/backlink-management/requests/${row.id}/verify`, { method: "POST" });
      setRow(d.request);
      toast.success(d.request.checkDetail || "ตรวจลิงก์แล้ว");
      onChanged();
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ตรวจไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!row || !confirm("ลบคำขอนี้?")) return;
    setBusy(true);
    try {
      await api(`/api/backlink-management/requests/${row.id}`, { method: "DELETE" });
      toast.success("ลบแล้ว");
      onChanged();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  function startPublish() {
    if (!row) return;
    setLiveUrl(row.liveUrl);
    setActualPrice(row.actualPrice !== null ? String(row.actualPrice) : String(row.quotedPrice));
    setPublishOpen(true);
  }

  const actions = row ? allowedActions(row.status, role) : [];
  const canDelete = !!row && ["REQUESTED", "REJECTED", "CANCELLED"].includes(row.status) && (["ADMIN", "SEO_MANAGER"].includes(role) || row.requestedById === userId);
  const tone = (s: string) => STATUS_TONE[s as BlmStatus] ?? "muted";

  return (
    <>
      <Sheet open={!!id} onOpenChange={(o) => { if (!o) onClose(); }}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader><SheetTitle>รายละเอียดคำขอ</SheetTitle></SheetHeader>
          {!row ? (
            <div className="flex justify-center py-10 text-gray-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : (
            <div className="mt-4 space-y-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={tone(row.status)}>{STATUS_LABEL[row.status as BlmStatus] ?? row.status}</Chip>
                {row.checkStatus ? <Chip tone={CHECK_TONE[row.checkStatus as CheckStatus] ?? "muted"} title={row.checkDetail}>{CHECK_LABEL[row.checkStatus as CheckStatus] ?? row.checkStatus}</Chip> : null}
                {row.asanaCompleted && !row.liveUrl && (row.status === "APPROVED" || row.status === "IN_PROGRESS") ? (
                  <Chip tone="warn">Asana เสร็จแล้ว — รอใส่ URL ที่ลิงก์อยู่</Chip>
                ) : null}
                {row.asanaSyncError ? <Chip tone="warn" title={row.asanaSyncError}>Asana sync ผิดพลาด</Chip> : null}
              </div>

              <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5">
                <dt className="text-gray-500">โปรเจกต์</dt><dd>{row.projectName}</dd>
                <dt className="text-gray-500">เว็บที่ฝาก</dt><dd>{row.vendorDomain || "ยังไม่เลือกเว็บ"}</dd>
                <dt className="text-gray-500">หน้าลูกค้า</dt><dd className="break-all">{row.targetUrl}</dd>
                <dt className="text-gray-500">Anchor</dt><dd>{row.anchorText || "—"}</dd>
                <dt className="text-gray-500">Keyword</dt><dd>{row.keyword || "—"}</dd>
                <dt className="text-gray-500">ประเภทลิงก์</dt><dd>{row.linkType}</dd>
                <dt className="text-gray-500">ราคาที่ขอ</dt><dd>{money(row.quotedPrice)}</dd>
                <dt className="text-gray-500">ราคาจริง</dt><dd>{row.actualPrice !== null ? money(row.actualPrice) : "—"}</dd>
                <dt className="text-gray-500">ตัดงบเดือน</dt><dd>{row.budgetPeriod}</dd>
                <dt className="text-gray-500">ผู้ขอ</dt><dd>{row.requestedByName || "—"}</dd>
                <dt className="text-gray-500">ผู้รับผิดชอบ</dt><dd>{row.assigneeName || "—"}</dd>
                <dt className="text-gray-500">กำหนดส่ง</dt><dd>{fmtDate(row.dueDate)}</dd>
                <dt className="text-gray-500">URL ที่ลิงก์อยู่</dt>
                <dd className="break-all">{row.liveUrl ? <a href={row.liveUrl} target="_blank" rel="noopener noreferrer" className="text-brand-blue underline">{row.liveUrl}</a> : "—"}</dd>
                {row.rejectReason ? (<><dt className="text-gray-500">เหตุผลที่ไม่อนุมัติ</dt><dd>{row.rejectReason}</dd></>) : null}
                {row.notes ? (<><dt className="text-gray-500">หมายเหตุ</dt><dd className="whitespace-pre-wrap">{row.notes}</dd></>) : null}
                {row.lastCheckedAt ? (<><dt className="text-gray-500">ตรวจลิงก์ล่าสุด</dt><dd>{fmtDateTime(row.lastCheckedAt)} · {row.checkDetail}</dd></>) : null}
              </dl>

              {row.asanaTaskUrl ? (
                <a href={row.asanaTaskUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-blue underline">
                  <ExternalLink className="h-3.5 w-3.5" /> เปิดงานใน Asana
                </a>
              ) : null}

              <div className="flex flex-wrap gap-2">
                {actions.map((a) => {
                  const onClick = a === "reject" ? () => { setReason(""); setRejectOpen(true); }
                    : a === "publish" ? startPublish
                    : () => void act(a);
                  return (
                    <Button key={a} size="sm" variant={a === "approve" || a === "publish" ? "default" : "outline"} disabled={busy} onClick={onClick}>
                      {ACTION_LABEL[a]}
                    </Button>
                  );
                })}
                {row.liveUrl ? (
                  <Button size="sm" variant="outline" disabled={busy} onClick={verify}><ShieldCheck className="mr-1 h-4 w-4" /> ตรวจลิงก์</Button>
                ) : null}
                <Button size="sm" variant="outline" disabled={busy} onClick={() => onEdit(row)}><Pencil className="mr-1 h-4 w-4" /> แก้ไข</Button>
                {canDelete ? (
                  <Button size="sm" variant="outline" disabled={busy} onClick={remove}><Trash2 className="mr-1 h-4 w-4" /> ลบ</Button>
                ) : null}
              </div>

              <div>
                <h3 className="mb-2 text-[13px] font-semibold text-brand-navy">ประวัติ</h3>
                <ol className="space-y-2 border-l border-gray-200 pl-3">
                  {events.map((e) => (
                    <li key={e.id} className="text-xs">
                      <div className="text-gray-400">
                        {fmtDateTime(e.createdAt)} · {e.actorName || (e.source === "asana" ? "Asana" : "ระบบ")}
                      </div>
                      <div>
                        {e.type === "STATUS" || e.type === "VERIFY"
                          ? <>{e.fromStatus ? `${STATUS_LABEL[e.fromStatus as BlmStatus] ?? e.fromStatus} → ` : ""}<b>{STATUS_LABEL[e.toStatus as BlmStatus] ?? e.toStatus}</b></>
                          : <b>{e.type}</b>}
                        {e.amount !== null && e.amount !== undefined ? ` · ${money(e.amount)}` : ""}
                        {e.note ? ` — ${e.note}` : ""}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>ไม่อนุมัติคำขอ</DialogTitle><DialogDescription>ระบุเหตุผลเพื่อให้ผู้ขอทราบ</DialogDescription></DialogHeader>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เหตุผล" />
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRejectOpen(false)}>ยกเลิก</Button>
            <Button disabled={busy || !reason.trim()} onClick={() => act("reject", { reason })}>ยืนยัน</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>บันทึกว่าเผยแพร่แล้ว</DialogTitle><DialogDescription>ใส่ URL ของหน้าที่ลิงก์อยู่จริง และราคาที่จ่ายจริง</DialogDescription></DialogHeader>
          <div className="grid gap-3">
            <div><Label>URL ที่ลิงก์อยู่</Label><Input value={liveUrl} onChange={(e) => setLiveUrl(e.target.value)} placeholder="https://" /></div>
            <div><Label>ราคาจริง (บาท)</Label><Input type="number" min={0} value={actualPrice} onChange={(e) => setActualPrice(e.target.value)} /></div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPublishOpen(false)}>ยกเลิก</Button>
            <Button disabled={busy || !/^https?:\/\//i.test(liveUrl.trim())} onClick={() => act("publish", { liveUrl: liveUrl.trim(), actualPrice: actualPrice === "" ? undefined : Number(actualPrice) })}>บันทึก</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!block} onOpenChange={(o) => { if (!o) setBlock(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>อนุมัติไม่ได้ — งบไม่พอ</DialogTitle><DialogDescription>{block?.error}</DialogDescription></DialogHeader>
          {block ? (
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
              <dt>งบที่อนุมัติ ({block.budget.period})</dt><dd className="text-right">{money(block.budget.approved)}</dd>
              <dt>กันงบแล้ว</dt><dd className="text-right">{money(block.budget.reserved)}</dd>
              <dt>ใช้จริง</dt><dd className="text-right">{money(block.budget.actual)}</dd>
              <dt>คงเหลือหลังอนุมัติ</dt><dd className="text-right font-semibold text-red-600">{money(block.budget.remaining)}</dd>
            </dl>
          ) : null}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setBlock(null)}>ปิด</Button>
            {role === "ADMIN" ? <Button variant="destructive" disabled={busy} onClick={() => act("approve", { force: true })}>อนุมัติเกินงบ</Button> : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
