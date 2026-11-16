"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LINK_TYPES } from "@/lib/backlink-management/types";
import { PRICE_TYPES } from "@/lib/backlink-management/vendor-detail";
import { ACCEPT_ATTR, ALLOWED_LABEL, MAX_FILE_BYTES, MAX_FILES_PER_REQUEST, formatBytes } from "@/lib/backlink-management/attachments";
import { api, dateInput, selectCls, type BlmRow, type Meta, type Vendor } from "./shared";
import SearchSelect from "./SearchSelect";
import AsanaProjectSelect from "./AsanaProjectSelect";
import type { AsanaStatus } from "./AsanaDialog";
import { checkAttachmentFile, uploadAttachment } from "./RequestAttachments";

/** สร้าง / แก้ไขคำขอ (edit: ส่งแถวเดิมมา) */
export default function RequestDialog({ open, onOpenChange, meta, edit, duplicateFrom, asana, defaultProjectId, defaultPeriod, onSaved }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  meta: Meta | null;
  edit: BlmRow | null;
  /** ทำซ้ำจากคำขอเดิม (ใช้เมื่อ edit เป็น null) — สร้างคำขอใหม่ที่กรอกข้อมูลไว้ให้ */
  duplicateFrom?: BlmRow | null;
  asana?: AsanaStatus | null;
  defaultProjectId: string;
  defaultPeriod: string;
  onSaved: () => void;
}) {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [f, setF] = useState({
    projectId: "", vendorSiteId: "", targetUrl: "", anchorText: "", keyword: "", linkType: "dofollow",
    quotedPrice: "", budgetPeriod: "", assigneeId: "", dueDate: "", notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [staged, setStaged] = useState<File[]>([]);
  const [asanaProjectGid, setAsanaProjectGid] = useState("");
  const dup = !edit ? duplicateFrom ?? null : null;
  const asanaOn = !!asana && asana.tokenSource !== "none";
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  /** ราคาที่ระบบเติมให้ล่าสุด (จากเว็บที่เลือก หรือจากคำขอต้นฉบับตอนทำซ้ำ) — ถ้าผู้ใช้ยังไม่แก้ เปลี่ยนเว็บแล้วเปลี่ยนราคาตาม */
  const autoPrice = useRef("");
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const locked = !!edit && edit.status !== "REQUESTED" && !meta?.me.canApprove;

  useEffect(() => {
    setStaged([]);
    setAsanaProjectGid("");
    if (!open) return;
    api<{ vendors: Vendor[] }>("/api/backlink-management/vendors?status=ACTIVE").then((d) => setVendors(d.vendors)).catch(() => {});
    autoPrice.current = !edit && duplicateFrom ? String(duplicateFrom.quotedPrice) : "";
    setF(edit ? {
      projectId: edit.projectId, vendorSiteId: edit.vendorSiteId ?? "", targetUrl: edit.targetUrl, anchorText: edit.anchorText,
      keyword: edit.keyword, linkType: edit.linkType, quotedPrice: String(edit.quotedPrice), budgetPeriod: edit.budgetPeriod,
      assigneeId: edit.assigneeId ?? "", dueDate: dateInput(edit.dueDate), notes: edit.notes,
    } : duplicateFrom ? {
      projectId: duplicateFrom.projectId, vendorSiteId: duplicateFrom.vendorSiteId ?? "", targetUrl: duplicateFrom.targetUrl,
      anchorText: duplicateFrom.anchorText, keyword: duplicateFrom.keyword, linkType: duplicateFrom.linkType,
      quotedPrice: String(duplicateFrom.quotedPrice), budgetPeriod: defaultPeriod || duplicateFrom.budgetPeriod,
      assigneeId: duplicateFrom.assigneeId ?? "",
      // กำหนดส่งที่ผ่านมาแล้วไม่ต้องคัดลอก
      dueDate: (() => { const d = dateInput(duplicateFrom.dueDate); const n = new Date(); const today = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`; return d && d >= today ? d : ""; })(),
      notes: duplicateFrom.notes,
    } : {
      projectId: defaultProjectId, vendorSiteId: "", targetUrl: "", anchorText: "", keyword: "", linkType: "dofollow",
      quotedPrice: "", budgetPeriod: defaultPeriod, assigneeId: "", dueDate: "", notes: "",
    });
  }, [open, edit, duplicateFrom, defaultProjectId, defaultPeriod]);

  // คลังเว็บ → ฟอร์มคำขอ: จัดกลุ่มตามหมวดเดียวกับหน้าคลังเว็บ และดึงราคาแยกประเภทของเว็บที่เลือกมาให้กดใช้
  const vendorGroups = useMemo(() => {
    const m = new Map<string, Vendor[]>();
    for (const v of vendors) { const k = v.category || "ไม่ระบุหมวด"; m.set(k, [...(m.get(k) ?? []), v]); }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0], "th"));
  }, [vendors]);
  const picked = vendors.find((x) => x.id === f.vendorSiteId) ?? null;
  const pickedPrices = picked ? PRICE_TYPES.filter((p) => typeof picked[p.key] === "number") : [];
  // เว็บของคำขอเดิม (แก้ไข/ทำซ้ำ) ที่ไม่อยู่ในรายการเว็บที่ใช้งานแล้ว — ยังแสดงชื่อไว้ ไม่ให้ช่องดูเหมือนว่าง
  const srcRow = edit ?? dup;
  const missingVendor = !picked && !!f.vendorSiteId && srcRow?.vendorSiteId === f.vendorSiteId && !!srcRow.vendorDomain
    // รายการเว็บยังโหลดไม่เสร็จ = แสดงแค่ชื่อเว็บ ยังไม่ติดป้ายว่าไม่อยู่ในรายการ
    ? { value: f.vendorSiteId, label: vendors.length > 0 ? `${srcRow.vendorDomain} (ไม่อยู่ในรายการเว็บที่ใช้งาน)` : srcRow.vendorDomain }
    : null;

  function pickVendor(id: string) {
    set("vendorSiteId", id);
    const v = vendors.find((x) => x.id === id);
    if (v && !edit) {
      const prevAuto = autoPrice.current;
      const next = String(v.price);
      autoPrice.current = next;
      // ราคาว่าง หรือยังเป็นราคาที่ระบบเติมให้ = ใช้ราคาของเว็บใหม่; ราคาที่ผู้ใช้พิมพ์เองไม่แตะ
      setF((p) => ({
        ...p, vendorSiteId: id,
        quotedPrice: !p.quotedPrice || (prevAuto !== "" && p.quotedPrice === prevAuto) ? next : p.quotedPrice,
        linkType: v.linkType || p.linkType,
      }));
    }
  }

  async function save() {
    if (!f.projectId) return toast.error("กรุณาเลือกโปรเจกต์");
    const keepEmptyUrl = !!edit && !edit.targetUrl.trim() && !f.targetUrl.trim();
    if (!keepEmptyUrl && !/^https?:\/\//i.test(f.targetUrl.trim())) return toast.error("URL หน้าลูกค้าต้องขึ้นต้นด้วย http:// หรือ https://");
    setSaving(true);
    try {
      if (edit) {
        await api(`/api/backlink-management/requests/${edit.id}`, {
          method: "PATCH",
          json: {
            targetUrl: f.targetUrl, anchorText: f.anchorText, keyword: f.keyword, linkType: f.linkType, notes: f.notes,
            assigneeId: f.assigneeId || null, dueDate: f.dueDate || null,
            ...(locked ? {} : { vendorSiteId: f.vendorSiteId || null, quotedPrice: Number(f.quotedPrice || 0), budgetPeriod: f.budgetPeriod }),
          },
        });
        toast.success("บันทึกแล้ว");
      } else {
        const created = await api<{ request: { id: string; asanaSyncError?: string } }>("/api/backlink-management/requests", {
          method: "POST",
          json: {
            projectId: f.projectId, vendorSiteId: f.vendorSiteId || undefined, targetUrl: f.targetUrl, anchorText: f.anchorText,
            keyword: f.keyword, linkType: f.linkType, quotedPrice: f.quotedPrice === "" ? undefined : Number(f.quotedPrice),
            budgetPeriod: f.budgetPeriod || undefined, assigneeId: f.assigneeId || undefined, dueDate: f.dueDate || undefined, notes: f.notes,
            ...(asanaOn && asanaProjectGid ? { asanaProjectGid } : {}),
          },
        });
        // คำขอถูกสร้างแล้ว — ไฟล์ที่แนบไม่ได้ต้องบอกชัด และไม่เปิดฟอร์มค้างไว้ (กดส่งซ้ำจะได้คำขอซ้ำ)
        let missed = 0;
        if (staged.length > 0 && created?.request?.id) {
          setUploadingFiles(true);
          for (const file of staged) {
            try {
              const r = await uploadAttachment(created.request.id, file);
              if (r.warning) toast.warning(r.warning);
            } catch (err) {
              missed++;
              toast.error(`${file.name}: ${err instanceof Error ? err.message : "อัปโหลดไม่สำเร็จ"}`);
            }
          }
          setUploadingFiles(false);
        } else if (staged.length > 0) {
          missed = staged.length;
        }
        if (created?.request?.asanaSyncError) {
          toast.warning(`บันทึกคำขอแล้ว แต่ส่งเข้า Asana ไม่ได้: ${created.request.asanaSyncError}`, { duration: 10_000 });
        }
        if (missed > 0) {
          toast.warning(`สร้างคำขอแล้ว แต่แนบไฟล์ไม่สำเร็จ ${missed} จาก ${staged.length} ไฟล์ — เปิดคำขอแล้วแนบไฟล์อีกครั้ง`, { duration: 10_000 });
        } else {
          toast.success("สร้างคำขอแล้ว");
        }
      }
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
      setUploadingFiles(false);
    }
  }

  function stageFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    // คำนวณนอก setState: ตัว updater ต้องไม่มี side effect (toast จะเด้งซ้ำใน StrictMode)
    const next = [...staged];
    for (const file of picked) {
      const bad = checkAttachmentFile(file);
      if (bad) { toast.error(`${file.name}: ${bad}`); continue; }
      if (next.some((x) => x.name === file.name && x.size === file.size)) continue;
      if (next.length >= MAX_FILES_PER_REQUEST) { toast.warning(`แนบได้สูงสุด ${MAX_FILES_PER_REQUEST} ไฟล์`); break; }
      next.push(file);
    }
    setStaged(next);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{edit ? "แก้ไขคำขอ backlink" : dup ? "ทำซ้ำคำขอ" : "สร้างคำขอ backlink"}</DialogTitle>
          <DialogDescription>
            {locked ? "คำขอผ่านขั้นรออนุมัติแล้ว ราคา เดือนตัดงบ และเว็บ แก้ได้เฉพาะผู้อนุมัติ" : "ระบุหน้าลูกค้าที่ต้องการลิงก์ เว็บที่จะฝาก และราคา"}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>โปรเจกต์</Label>
            <SearchSelect
              value={f.projectId}
              onChange={(v) => set("projectId", v)}
              disabled={!!edit}
              emptyLabel="— เลือกโปรเจกต์ —"
              ariaLabel="โปรเจกต์"
              options={(meta?.projects ?? []).map((p) => ({ value: p.id, label: `${p.name}${p.manual ? " (เพิ่มเอง)" : ""}`, hint: p.clientName || undefined }))}
            />
          </div>
          <div>
            <Label>เว็บที่จะฝากลิงก์ (จากคลังเว็บ)</Label>
            <SearchSelect
              value={f.vendorSiteId}
              onChange={pickVendor}
              disabled={locked}
              emptyLabel="— ยังไม่เลือกเว็บ —"
              ariaLabel="เว็บที่จะฝากลิงก์"
              options={[
                ...(missingVendor ? [missingVendor] : []),
                ...vendorGroups.flatMap(([cat, list]) => list.map((v) => ({
                  value: v.id, label: `${v.domain} · ${v.price.toLocaleString("th-TH")} บาท`, hint: cat,
                }))),
              ]}
            />
            {picked && (pickedPrices.length > 0 || picked.contactChannel || picked.expiration) ? (
              <div className="mt-2 space-y-1.5 rounded-xl bg-brand-mist/40 p-2.5 text-xs text-gray-700">
                {pickedPrices.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-gray-500">ราคาในคลังเว็บ:</span>
                    {pickedPrices.map((p) => (
                      <button key={p.key} type="button" disabled={locked} onClick={() => set("quotedPrice", String(picked[p.key]))}
                        className="rounded-full border border-gray-200 bg-white px-2 py-0.5 hover:bg-brand-mist disabled:opacity-50"
                        title="กดเพื่อใช้ราคานี้">
                        {p.label} {(picked[p.key] as number).toLocaleString("th-TH")}
                      </button>
                    ))}
                  </div>
                ) : null}
                {picked.priceNote ? <div className="text-gray-500">หมายเหตุราคา: {picked.priceNote}</div> : null}
                {picked.expiration ? <div>อายุลิงก์: {picked.expiration}</div> : null}
                {picked.contactChannel ? <div className="line-clamp-3 whitespace-pre-line">ติดต่อ: {picked.contactName ? `${picked.contactName} · ` : ""}{picked.contactChannel}</div> : null}
              </div>
            ) : null}
          </div>
          <div>
            <Label>URL หน้าลูกค้าที่ลิงก์ต้องชี้มา</Label>
            <Input value={f.targetUrl} onChange={(e) => set("targetUrl", e.target.value)} placeholder="https://" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label>Anchor text</Label><Input value={f.anchorText} onChange={(e) => set("anchorText", e.target.value)} /></div>
            <div><Label>Keyword</Label><Input value={f.keyword} onChange={(e) => set("keyword", e.target.value)} /></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label>ประเภทลิงก์</Label>
              <select className={selectCls} value={f.linkType} onChange={(e) => set("linkType", e.target.value)}>
                {LINK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <Label>ราคา (บาท)</Label>
              <Input type="number" min={0} value={f.quotedPrice} disabled={locked} onChange={(e) => set("quotedPrice", e.target.value)} placeholder="ใช้ราคาจากคลังเว็บ" />
            </div>
            <div>
              <Label>ตัดงบเดือน</Label>
              <Input type="month" value={f.budgetPeriod} disabled={locked} onChange={(e) => set("budgetPeriod", e.target.value)} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>ผู้รับผิดชอบ</Label>
              <SearchSelect
                value={f.assigneeId}
                onChange={(v) => set("assigneeId", v)}
                emptyLabel="— ยังไม่มอบหมาย —"
                ariaLabel="ผู้รับผิดชอบ"
                options={(meta?.users ?? []).map((u) => ({ value: u.id, label: u.name, hint: u.email }))}
              />
              {asanaOn ? <p className="mt-1 text-xs text-gray-500">ผู้รับผิดชอบจะได้รับงานใน Asana (จับคู่ด้วยอีเมล)</p> : null}
            </div>
            <div><Label>กำหนดส่ง</Label><Input type="date" value={f.dueDate} onChange={(e) => set("dueDate", e.target.value)} /></div>
          </div>
          {!edit && asanaOn ? (
            <div>
              <Label>โปรเจกต์ Asana</Label>
              <AsanaProjectSelect value={asanaProjectGid} onChange={setAsanaProjectGid} defaultProjectName={asana?.projectName} disabled={saving} />
            </div>
          ) : null}
          <div><Label>หมายเหตุ</Label><Textarea rows={3} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></div>
          {!edit ? (
            <div>
              <Label>แนบไฟล์ (ไม่บังคับ)</Label>
              <div className="mt-1">
                <Button type="button" size="sm" variant="outline" disabled={saving || staged.length >= MAX_FILES_PER_REQUEST} onClick={() => fileRef.current?.click()}>
                  <Paperclip className="mr-1 h-4 w-4" /> เลือกไฟล์
                </Button>
                <input ref={fileRef} type="file" multiple accept={ACCEPT_ATTR} className="hidden" aria-label="เลือกไฟล์แนบ" onChange={stageFiles} />
              </div>
              <p className="mt-1 text-xs text-gray-400">{ALLOWED_LABEL} ไม่เกิน {formatBytes(MAX_FILE_BYTES)} ต่อไฟล์</p>
              {staged.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {staged.map((file) => (
                    <li key={`${file.name}-${file.size}`} className="flex items-center gap-2 rounded-lg border border-gray-200 px-2 py-1 text-xs">
                      <span className="min-w-0 flex-1 truncate" title={file.name}>{file.name}</span>
                      <span className="shrink-0 text-gray-400">{formatBytes(file.size)}</span>
                      <button type="button" aria-label={`เอา ${file.name} ออก`} title="เอาออก" disabled={saving}
                        onClick={() => setStaged((p) => p.filter((x) => x !== file))}
                        className="shrink-0 rounded p-1 text-gray-400 hover:text-red-600 disabled:opacity-50">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>ยกเลิก</Button>
          <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}{uploadingFiles ? "กำลังอัปโหลดไฟล์…" : "บันทึก"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
