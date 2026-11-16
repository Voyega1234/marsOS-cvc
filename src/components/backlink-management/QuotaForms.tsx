"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  QUOTA_STATUS_IN_PROCESS,
  type QuotaPackageInput,
  type QuotaPackageView,
  type QuotaReservationInput,
  type QuotaSlotView,
  type QuotaSourceView,
  type QuotaView,
  type QuotaWriteResult,
} from "@/lib/backlink-management/quota-types";
import { OverwriteCancelled, quotaWrite, useOverwriteConfirm } from "./QuotaOverwriteConfirm";
import SearchSelect from "./SearchSelect";
import { api, selectCls, type Meta } from "./shared";

const BASE = "/api/backlink-management/quota";

function report(r: QuotaWriteResult, onDone: (v: QuotaView) => void) {
  if (r.warning) toast.warning(r.warning);
  onDone(r.view);
}

/** จองช่อง (slot ว่าง) หรือแก้การจองเดิม (reservation ไม่ว่าง) */
export function ReserveDialog({ open, onOpenChange, meta, view, pkg, slot, onDone }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  meta: Meta | null;
  view: QuotaView;
  pkg: QuotaPackageView | null;
  /** ช่องที่เลือก: ว่าง = จองช่องนี้; มีการจอง = แก้การจอง; ไม่ส่ง = จองช่องว่างช่องแรก */
  slot?: QuotaSlotView | null;
  onDone: (v: QuotaView) => void;
}) {
  const editing = slot?.reservation ?? null;
  const [reservedById, setReservedById] = useState("");
  const [website, setWebsite] = useState("");
  const [projectId, setProjectId] = useState("");
  const [client, setClient] = useState("");
  const [clientTouched, setClientTouched] = useState(false);
  const [status, setStatus] = useState(QUOTA_STATUS_IN_PROCESS);
  const [remark, setRemark] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const overwrite = useOverwriteConfirm();

  useEffect(() => {
    if (!open) return;
    setReservedById(editing?.reservedById ?? meta?.me.id ?? "");
    setWebsite(editing?.website ?? "");
    setProjectId(editing?.projectId ?? "");
    setClient(slot?.client ?? "");
    setClientTouched(false);
    setStatus(slot?.status || QUOTA_STATUS_IN_PROCESS);
    setRemark(slot?.remark ?? "");
    setNote(editing?.note ?? "");
  }, [open, editing, slot, meta?.me.id]);

  const userOptions = useMemo(() => (meta?.users ?? []).map((u) => ({ value: u.id, label: u.name || u.email, hint: u.email })), [meta]);
  const projectOptions = useMemo(
    () => (meta?.projects ?? []).map((p) => ({ value: p.id, label: p.name, hint: p.clientName, keywords: p.clientName })),
    [meta],
  );

  function pickProject(id: string) {
    setProjectId(id);
    if (!clientTouched && !editing) {
      const p = meta?.projects.find((x) => x.id === id);
      setClient(p ? p.clientName || p.name : "");
    }
  }

  const websites = pkg?.websites ?? [];

  async function submit() {
    if (!pkg) return;
    if (!reservedById) return toast.error("เลือกผู้จอง");
    setBusy(true);
    try {
      let r: QuotaWriteResult;
      if (editing) {
        r = await api<QuotaWriteResult>(`${BASE}/reservations/${editing.id}`, {
          method: "PATCH",
          json: { reservedById, website, projectId, note },
        });
      } else {
        if (!client.trim()) { setBusy(false); return toast.error("กรอก Clients"); }
        const body: QuotaReservationInput = {
          packageId: pkg.id,
          ...(slot ? { slotIndex: slot.index } : {}),
          reservedById,
          website,
          projectId,
          client: client.trim(),
          status: status.trim() || QUOTA_STATUS_IN_PROCESS,
          remark,
          note,
        };
        r = await quotaWrite<QuotaWriteResult>(`${BASE}/reservations`, { method: "POST", json: { ...body } }, overwrite.ask);
      }
      toast.success(editing ? "แก้การจองแล้ว" : "จองแล้ว");
      report(r, onDone);
      onOpenChange(false);
    } catch (e) {
      // กด Cancel ใน popup เขียนทับ = ยังไม่ได้เขียนอะไร ฟอร์มเปิดค้างไว้ให้แก้ต่อ
      if (!(e instanceof OverwriteCancelled)) toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  const label = pkg ? pkg.vendorName || pkg.websites[0] || pkg.type || "แพ็กเกจ" : "";

  return (
    <>
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "แก้การจอง" : slot ? `จองช่อง #${slot.index + 1}` : "จองโควต้า"}</DialogTitle>
          <DialogDescription>
            {label}
            {!editing ? " — ระบบจะเขียน Clients / Status / REMARK ลงช่องว่างถัดไปของแพ็กเกจในชีท" : " — แก้ได้เฉพาะข้อมูลฝั่งระบบ (ไม่เขียนลงชีท)"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div>
            <Label>ผู้จอง *</Label>
            <SearchSelect value={reservedById} onChange={setReservedById} options={userOptions} placeholder="เลือกผู้จอง" ariaLabel="ผู้จอง" />
          </div>
          <div>
            <Label>เว็บ</Label>
            {websites.length > 0 ? (
              <select className={selectCls} value={website} onChange={(e) => setWebsite(e.target.value)}>
                <option value="">ไม่ระบุ</option>
                {websites.map((w) => <option key={w} value={w}>{w}</option>)}
                {website && !websites.includes(website) ? <option value={website}>{website}</option> : null}
              </select>
            ) : (
              <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="เว็บที่จะลง (พิมพ์เอง)" />
            )}
          </div>
          <div>
            <Label>โปรเจกต์</Label>
            <SearchSelect value={projectId} onChange={pickProject} options={projectOptions} emptyLabel="ไม่ระบุ" ariaLabel="โปรเจกต์" />
          </div>
          {!editing ? (
            <>
              <div>
                <Label>Clients *</Label>
                <Input list="quota-client-options" value={client} onChange={(e) => { setClient(e.target.value); setClientTouched(true); }} />
                <datalist id="quota-client-options">{view.clientOptions.map((c) => <option key={c} value={c} />)}</datalist>
              </div>
              <div>
                <Label>Status</Label>
                <Input list="quota-status-options" value={status} onChange={(e) => setStatus(e.target.value)} />
                <datalist id="quota-status-options">{view.statusOptions.map((c) => <option key={c} value={c} />)}</datalist>
              </div>
              <div>
                <Label>REMARK</Label>
                <Input value={remark} onChange={(e) => setRemark(e.target.value)} />
              </div>
            </>
          ) : null}
          <div>
            <Label>บันทึกภายใน</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
            <p className="mt-1 text-xs text-gray-500">เก็บในระบบเท่านั้น ไม่เขียนลงชีท</p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>ยกเลิก</Button>
          <Button onClick={submit} disabled={busy || !pkg}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}{editing ? "บันทึก" : "จอง"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {overwrite.dialog}
    </>
  );
}

/** เพิ่ม / แก้แพ็กเกจ (ครบ 6 ช่องของชีท) */
export function PackageDialog({ open, onOpenChange, sources, pkg, typeOptions = [], onDone }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sources: QuotaSourceView[];
  /** Type ที่เคยใช้ในชีท (ไว้เลือก) */
  typeOptions?: string[];
  /** null = สร้างใหม่ */
  pkg: QuotaPackageView | null;
  onDone: (v: QuotaView) => void;
}) {
  const [sourceId, setSourceId] = useState("");
  const [tabTitle, setTabTitle] = useState("");
  const [type, setType] = useState("");
  const [websiteText, setWebsiteText] = useState("");
  const [priceText, setPriceText] = useState("");
  const [units, setUnits] = useState("");
  const [startDate, setStartDate] = useState("");
  const [expireDate, setExpireDate] = useState("");
  const [busy, setBusy] = useState(false);
  const overwrite = useOverwriteConfirm();

  useEffect(() => {
    if (!open) return;
    const src = pkg ? sources.find((s) => s.id === pkg.sourceId) : sources[0];
    setSourceId(pkg?.sourceId ?? src?.id ?? "");
    setTabTitle(pkg?.tabTitle ?? src?.tabs[0] ?? "");
    setType(pkg?.type ?? "");
    setWebsiteText(pkg?.websiteText ?? "");
    setPriceText(pkg?.priceText ?? "");
    setUnits(pkg?.units != null ? String(pkg.units) : "");
    setStartDate(pkg?.startDate ?? "");
    setExpireDate(pkg?.expireDate ?? "");
    // รีเซ็ตฟอร์มเฉพาะตอนเปิด / เปลี่ยนแพ็กเกจ — ข้อมูลโหลดใหม่ระหว่างพิมพ์ต้องไม่ล้างสิ่งที่พิมพ์ค้างไว้
  }, [open, pkg?.id]);

  const tabs = sources.find((s) => s.id === sourceId)?.tabs ?? [];

  function changeSource(id: string) {
    setSourceId(id);
    setTabTitle(sources.find((s) => s.id === id)?.tabs[0] ?? "");
  }

  async function submit() {
    const n = units.trim() === "" ? null : Number(units);
    if (n !== null && (!Number.isInteger(n) || n < 1)) return toast.error("Unit ต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป");
    setBusy(true);
    try {
      let r: QuotaWriteResult;
      if (pkg) {
        const body: QuotaPackageInput = {};
        if (type !== pkg.type) body.type = type;
        if (websiteText !== pkg.websiteText) body.websiteText = websiteText;
        if (priceText !== pkg.priceText) body.priceText = priceText;
        if (n !== pkg.units) body.units = n;
        if (startDate !== (pkg.startDate ?? "")) body.startDate = startDate;
        if (expireDate !== (pkg.expireDate ?? "")) body.expireDate = expireDate;
        if (Object.keys(body).length === 0) { onOpenChange(false); return; }
        r = await quotaWrite<QuotaWriteResult>(`${BASE}/packages/${pkg.id}`, { method: "PATCH", json: { ...body } }, overwrite.ask);
      } else {
        if (!sourceId || !tabTitle) { setBusy(false); return toast.error("เลือกชีทและแท็บ"); }
        if (n === null) { setBusy(false); return toast.error("กรอก Unit"); }
        const body: QuotaPackageInput = { sourceId, tabTitle, type, websiteText, priceText, units: n, startDate, expireDate };
        r = await quotaWrite<QuotaWriteResult>(`${BASE}/packages`, { method: "POST", json: { ...body } }, overwrite.ask);
      }
      toast.success(pkg ? "แก้แพ็กเกจแล้ว" : "เพิ่มแพ็กเกจแล้ว");
      report(r, onDone);
      onOpenChange(false);
    } catch (e) {
      // กด Cancel ใน popup เขียนทับ = ยังไม่ได้เขียนอะไร ฟอร์มเปิดค้างไว้ให้แก้ต่อ
      if (!(e instanceof OverwriteCancelled)) toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{pkg ? "แก้แพ็กเกจ" : "เพิ่มแพ็กเกจ"}</DialogTitle>
          <DialogDescription>บันทึกแล้วระบบจะเขียนลง Google Sheet ทันที</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {!pkg ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>ชีท *</Label>
                <select className={selectCls} value={sourceId} onChange={(e) => changeSource(e.target.value)}>
                  {sources.map((s) => <option key={s.id} value={s.id}>{s.label || s.title}</option>)}
                </select>
              </div>
              <div>
                <Label>แท็บ *</Label>
                <select className={selectCls} value={tabTitle} onChange={(e) => setTabTitle(e.target.value)}>
                  {tabs.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
          ) : null}
          <div>
            <Label htmlFor="quota-pkg-type">Type</Label>
            <Input
              id="quota-pkg-type"
              list="quota-pkg-type-options"
              autoComplete="off"
              value={type}
              onChange={(e) => setType(e.target.value)}
              placeholder={typeOptions.length ? "พิมพ์ หรือเลือกจากรายการ" : "เช่น Guest Post"}
            />
            <datalist id="quota-pkg-type-options">{typeOptions.map((t) => <option key={t} value={t} />)}</datalist>
            {typeOptions.length ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {typeOptions.slice(0, 12).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={`rounded-full border px-2 py-0.5 text-xs ${type === t ? "border-[#1d48f3] bg-[#1d48f3] text-white" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div>
            <Label>Website</Label>
            <Textarea rows={4} value={websiteText} onChange={(e) => setWebsiteText(e.target.value)} placeholder={"ชื่อ vendor (บรรทัดแรก)\nwww.example.com\nwww.example2.com"} />
          </div>
          <div>
            <Label>Price / Link</Label>
            <Textarea rows={2} value={priceText} onChange={(e) => setPriceText(e.target.value)} placeholder={"80,000 THB\n2,666/Link"} />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label>Unit{!pkg ? " *" : ""}</Label>
              <Input type="number" min={1} step={1} value={units} onChange={(e) => setUnits(e.target.value)} />
            </div>
            <div>
              <Label>Start</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <Label>EXP.</Label>
              <Input type="date" value={expireDate} onChange={(e) => setExpireDate(e.target.value)} />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>ยกเลิก</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}บันทึก
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {overwrite.dialog}
    </>
  );
}
