"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Loader2, Pencil, Plus, RefreshCw, Settings2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Chip, EmptyState, Panel } from "@/components/ds";
import type {
  QuotaPackageView,
  QuotaSlotInput,
  QuotaSlotView,
  QuotaView,
  QuotaWriteResult,
} from "@/lib/backlink-management/quota-types";
import { QuotaDashboard } from "./QuotaDashboard";
import { PackageDialog, ReserveDialog } from "./QuotaForms";
import { OverwriteCancelled, quotaWrite, useOverwriteConfirm } from "./QuotaOverwriteConfirm";
import { api, fmtDate, fmtDateTime, selectCls, type Meta } from "./shared";

const BASE = "/api/backlink-management/quota";
const n = (v: number | null | undefined) => (v ?? 0).toLocaleString("th-TH");

type SlotField = keyof QuotaSlotInput;

/** ช่องแก้ไขในตาราง: บันทึกเมื่อ blur / Enter และมีการเปลี่ยนค่าเท่านั้น */
function SlotCell({ value, type = "text", listId, onSave, className, ariaLabel, children }: {
  value: string;
  type?: "text" | "date";
  listId?: string;
  onSave: (v: string) => Promise<void>;
  className?: string;
  ariaLabel: string;
  children?: React.ReactNode;
}) {
  const [val, setVal] = useState(value);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setVal(value); }, [value]);

  async function commit() {
    if (saving || val === value) return;
    setSaving(true);
    try {
      await onSave(val);
    } catch {
      setVal(value);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-1">
      <Input
        type={type}
        list={listId}
        value={val}
        disabled={saving}
        aria-label={ariaLabel}
        className={className ?? "h-8 min-w-[110px] px-2 text-xs"}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") { setVal(value); (e.target as HTMLInputElement).blur(); }
        }}
      />
      {saving ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-gray-400" /> : children}
    </div>
  );
}

export default function QuotaTab({ meta, refreshKey, onOpenSheets }: { meta: Meta | null; refreshKey: number; onOpenSheets?: () => void }) {
  const [view, setView] = useState<QuotaView | null>(null);
  const [loadError, setLoadError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [hideDone, setHideDone] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pkgForm, setPkgForm] = useState<{ open: boolean; pkg: QuotaPackageView | null }>({ open: false, pkg: null });
  const [reserve, setReserve] = useState<{ open: boolean; pkgId: string; slotIndex: number | null }>({ open: false, pkgId: "", slotIndex: null });
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const overwrite = useOverwriteConfirm();
  const tableRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (force = false) => {
    if (force) setRefreshing(true);
    setLoadError("");
    try {
      const v = await api<QuotaView>(`${BASE}${force ? "?refresh=1" : ""}`);
      setView(v);
      if (force) toast.success("โหลดจากชีทใหม่แล้ว");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "โหลดโควต้าไม่สำเร็จ";
      if (force) toast.error(msg); else setLoadError(msg);
    } finally {
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load, refreshKey]);

  const applyResult = useCallback((r: QuotaWriteResult) => {
    if (r.warning) toast.warning(r.warning);
    setView(r.view);
  }, []);

  async function patchSlot(pkg: QuotaPackageView, slot: QuotaSlotView, field: SlotField, value: string) {
    try {
      const r = await quotaWrite<QuotaWriteResult>(`${BASE}/packages/${pkg.id}/slots/${slot.index}`, { method: "PATCH", json: { [field]: value } }, overwrite.ask);
      applyResult(r);
    } catch (e) {
      // กด Cancel ใน popup เขียนทับ: ไม่ใช่ error — โยนต่อให้ช่องคืนค่าเดิม
      if (!(e instanceof OverwriteCancelled)) toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
      throw e;
    }
  }

  async function cancelReservation(id: string, slot: QuotaSlotView) {
    // ช่องที่มีข้อมูลในชีท: popup เขียนทับ (รายการเซลล์ที่จะถูกล้าง) คือการยืนยัน ไม่ถามซ้ำสองรอบ
    const clearsCells = !!(slot.client || slot.status || slot.remark || slot.publishedDate);
    if (!clearsCells && !confirm("ยกเลิกการจองนี้?")) return;
    setCancelling(id);
    try {
      applyResult(await quotaWrite<QuotaWriteResult>(`${BASE}/reservations/${id}`, { method: "DELETE" }, overwrite.ask));
      toast.success("ยกเลิกการจองแล้ว");
    } catch (e) {
      if (!(e instanceof OverwriteCancelled)) toast.error(e instanceof Error ? e.message : "ยกเลิกไม่สำเร็จ");
    } finally {
      setCancelling(null);
    }
  }

  /** แพ็กเกจที่ไม่พบในชีทแล้ว: ลบออกจากระบบ (ผู้จัดการเท่านั้น) — ไม่แตะชีท */
  async function removeStalePackage(pkg: QuotaPackageView) {
    if (!confirm("ลบแพ็กเกจนี้ออกจากระบบ?\nการจองของแพ็กเกจนี้จะถูกลบไปด้วย (ไม่แก้ไขอะไรในชีท)")) return;
    setRemoving(pkg.id);
    try {
      applyResult(await quotaWrite<QuotaWriteResult>(`${BASE}/packages/${pkg.id}`, { method: "DELETE" }, overwrite.ask));
      toast.success("ลบแพ็กเกจออกจากระบบแล้ว");
    } catch (e) {
      if (!(e instanceof OverwriteCancelled)) toast.error(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
    } finally {
      setRemoving(null);
    }
  }

  const toggle = (id: string) => setExpanded((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });

  /** จากการ์ด "ต้องจัดการ": ค้นหาแพ็กเกจนั้น ขยายแถว แล้วเลื่อนลงตาราง */
  const focusPackage = (p: QuotaPackageView) => {
    setSearch(p.vendorName || p.websiteText || "");
    setExpanded((s) => new Set(s).add(p.id));
    setTimeout(() => tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  const packages = useMemo(() => {
    if (!view) return [];
    const q = search.trim().toLowerCase();
    return view.packages.filter((p) => {
      if (sourceFilter && p.sourceId !== sourceFilter) return false;
      if (hideDone && (p.expired || p.remaining === 0)) return false;
      if (!q) return true;
      const hay = [p.vendorName, p.websiteText, p.type, p.priceText, ...p.slots.flatMap((s) => [s.client, s.remark])].join("\n").toLowerCase();
      return hay.includes(q);
    });
  }, [view, search, sourceFilter, hideDone]);

  if (!view && !loadError) return <div className="flex justify-center py-10 text-gray-400"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (!view) return <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{loadError}</div>;

  if (view.tableMissing) {
    return (
      <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700">
        ยังไม่ได้สร้างตารางโควต้า — ให้ผู้ดูแลรัน scripts/sql/add-blm-quota-asana-tables.sql ใน Supabase
      </div>
    );
  }

  const t = view.totals;
  const pulled = view.sources.map((s) => s.lastPulledAt).filter((x): x is string => !!x).sort();
  const oldest = view.sources.length > 0 && view.sources.every((s) => s.lastPulledAt) ? pulled[0] : null;
  const reservePkg = view.packages.find((p) => p.id === reserve.pkgId) ?? null;
  const reserveSlot = reservePkg && reserve.slotIndex != null ? reservePkg.slots.find((s) => s.index === reserve.slotIndex) ?? null : null;
  const editPkg = pkgForm.pkg ? view.packages.find((p) => p.id === pkgForm.pkg!.id) ?? pkgForm.pkg : null;

  return (
    <div className="space-y-4">
      {view.sources.length > 0 && view.packages.length > 0 ? <QuotaDashboard view={view} onFocusPackage={focusPackage} /> : null}
      {t.unknownUnits > 0 ? <p className="text-xs text-amber-700">มี {t.unknownUnits} แพ็กเกจที่ยังไม่ระบุ Unit (ไม่ถูกนับ)</p> : null}

      <div ref={tableRef} className="scroll-mt-4">
        <Panel title="แพ็กเกจทั้งหมด" subtitle={`แสดง ${packages.length} จาก ${view.packages.length} แพ็กเกจ`} padded={false} bodyClassName="pb-4 pt-3">
      <div className="flex flex-wrap items-center gap-2 px-4 pb-3 md:px-5">
        <Input className="h-10 w-full sm:w-64" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหา vendor / เว็บ / Type / ลูกค้า / REMARK" aria-label="ค้นหาแพ็กเกจ" />
        {view.sources.length > 1 ? (
          <select className={`${selectCls} w-auto`} value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} aria-label="กรองตามชีท">
            <option value="">ทุกชีท</option>
            {view.sources.map((s) => <option key={s.id} value={s.id}>{s.label || s.title}</option>)}
          </select>
        ) : null}
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-600">
          <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
          ซ่อนที่หมดอายุ/เต็มแล้ว
        </label>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {oldest ? <span className="text-xs text-gray-500">ข้อมูลล่าสุด {fmtDateTime(oldest)}</span> : null}
          <Button variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing || view.sources.length === 0}>
            {refreshing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}โหลดจากชีทใหม่
          </Button>
          {view.canManage ? (
            <Button size="sm" onClick={() => setPkgForm({ open: true, pkg: null })} disabled={view.sources.length === 0}>
              <Plus className="mr-1 h-3.5 w-3.5" />เพิ่มแพ็กเกจ
            </Button>
          ) : null}
          {onOpenSheets ? (
            <Button variant="outline" size="sm" onClick={onOpenSheets}><Settings2 className="mr-1 h-3.5 w-3.5" />จัดการลิงก์ชีท</Button>
          ) : null}
        </div>
      </div>
      {view.sources.length === 0 ? (
        <EmptyState
          title="ยังไม่ได้เพิ่มลิงก์ชีทโควต้า"
          description="เพิ่มลิงก์ Google Sheet เพื่อดึงแพ็กเกจโควต้ามาแสดง"
          action={onOpenSheets ? <Button onClick={onOpenSheets}>จัดการลิงก์ชีท</Button> : undefined}
        />
      ) : packages.length === 0 ? (
        <EmptyState title="ไม่พบแพ็กเกจ" description="ลองปรับคำค้นหาหรือตัวกรอง" />
      ) : (
        <div className="max-h-[75vh] overflow-auto border-t border-gray-100 dark:border-white/10">
          <table className="tbl w-full text-xs">
            <thead>
              <tr>
                <th className="w-8" />
                <th className="text-left">Type</th>
                <th className="text-left">Vendor / เว็บ</th>
                <th className="text-left">ราคา</th>
                <th className="num">Unit</th>
                <th className="text-left">ใช้แล้ว</th>
                <th className="num">เผยแพร่</th>
                <th className="num">กำลังทำ</th>
                <th className="num">จอง</th>
                <th className="num">คงเหลือ</th>
                <th className="num">ใช้ได้</th>
                <th className="text-left">Start</th>
                <th className="text-left">EXP.</th>
                <th className="text-left">สถานะ</th>
                <th className="text-left">การทำงาน</th>
              </tr>
            </thead>
            <tbody>
              {packages.map((p) => {
                const open = expanded.has(p.id);
                const full = p.units != null && p.remaining === 0;
                const pct = p.units ? Math.min(100, (p.used / p.units) * 100) : 0;
                return (
                  <Fragment key={p.id}>
                    <tr className={p.stale ? "opacity-60 hover:bg-white/60" : "hover:bg-white/60 dark:hover:bg-white/5"}>
                      <td>
                        <button type="button" onClick={() => toggle(p.id)} aria-label={open ? "ย่อ" : "ขยาย"} aria-expanded={open} className="p-1 text-gray-500">
                          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      </td>
                      <td>{p.type || "—"}</td>
                      <td className="min-w-[160px]">
                        <div className="font-medium text-brand-navy">{p.vendorName || p.websites[0] || "—"}</div>
                        {p.websites.length > 0 ? <div className="whitespace-pre-line text-gray-500">{p.websites.join("\n")}</div> : null}
                        <div className="mt-0.5 text-[11px] text-gray-400">
                          <a href={p.spreadsheetUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline">{p.sourceTitle}<ExternalLink className="h-3 w-3" /></a> · {p.tabTitle}
                        </div>
                      </td>
                      <td className="whitespace-pre-line">{p.priceText || "—"}</td>
                      <td className="num">{p.units ?? "—"}</td>
                      <td className="min-w-[90px]">
                        <div>{p.used}{p.units != null ? ` / ${p.units}` : ""}</div>
                        {p.units != null ? (
                          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-200" role="progressbar" aria-valuenow={p.used} aria-valuemax={p.units}>
                            <div className="h-full rounded-full bg-brand-blue" style={{ width: `${pct}%` }} />
                          </div>
                        ) : null}
                      </td>
                      <td className="num">{p.published}</td>
                      <td className="num">{p.inProcess}</td>
                      <td className="num">{p.reserved}</td>
                      <td className="num">{p.remaining ?? "—"}</td>
                      <td className="num font-medium">{p.usable ?? "—"}</td>
                      <td className="whitespace-nowrap">{p.startDate ? fmtDate(p.startDate) : p.startText || "—"}</td>
                      <td className="whitespace-nowrap">{p.expireDate ? fmtDate(p.expireDate) : p.expireText || "—"}</td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {p.expired ? <Chip tone="bad">หมดอายุ</Chip> : null}
                          {full ? <Chip tone="muted">เต็ม</Chip> : null}
                          {p.units == null ? <Chip tone="warn">ไม่ระบุ Unit</Chip> : null}
                          {p.stale ? <Chip tone="warn">ไม่พบในชีท</Chip> : null}
                          {p.stale && view.canManage ? (
                            <button
                              type="button" title="ลบแพ็กเกจนี้ออกจากระบบ (ไม่แตะชีท)" disabled={removing === p.id}
                              onClick={() => removeStalePackage(p)}
                              className="inline-flex items-center gap-0.5 rounded px-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                            >
                              {removing === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}ลบ
                            </button>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" disabled={p.expired || full || p.stale} onClick={() => setReserve({ open: true, pkgId: p.id, slotIndex: null })}>จอง</Button>
                          {view.canManage ? (
                            <Button size="sm" variant="outline" disabled={p.stale} onClick={() => setPkgForm({ open: true, pkg: p })}><Pencil className="mr-1 h-3 w-3" />แก้ไข</Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                    {open ? (
                      <tr>
                        <td colSpan={15} className="bg-white/50 p-2">
                          <div className="max-h-[60vh] overflow-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-left text-gray-500">
                                  <th className="px-1 py-1">#</th>
                                  <th className="px-1">Link URL</th>
                                  <th className="px-1">Published Date</th>
                                  <th className="px-1">Clients</th>
                                  <th className="px-1">Status</th>
                                  <th className="px-1">REMARK</th>
                                  <th className="px-1">ผู้จอง / เว็บ / โปรเจกต์</th>
                                  <th className="px-1">การทำงาน</th>
                                </tr>
                              </thead>
                              <tbody>
                                {p.slots.map((s) => (
                                  <tr key={s.index} className="border-t border-gray-100 align-top">
                                    <td className="px-1 py-1.5 text-gray-500">{s.index + 1}</td>
                                    <td className="px-1 py-1">
                                      <SlotCell ariaLabel="Link URL" className="h-8 min-w-[180px] px-2 text-xs" value={s.linkUrl} onSave={(v) => patchSlot(p, s, "linkUrl", v)}>
                                        {s.linkUrl ? (
                                          <a href={s.linkUrl} target="_blank" rel="noopener noreferrer" aria-label="เปิดลิงก์" className="text-brand-blue"><ExternalLink className="h-3.5 w-3.5" /></a>
                                        ) : null}
                                      </SlotCell>
                                    </td>
                                    <td className="px-1 py-1">
                                      <SlotCell ariaLabel="Published Date" type="date" className="h-8 w-[140px] px-2 text-xs" value={s.publishedDate ?? ""} onSave={(v) => patchSlot(p, s, "publishedDate", v)} />
                                      {!s.publishedDate && s.publishedText ? <div className="mt-0.5 text-[11px] text-gray-500">{s.publishedText}</div> : null}
                                    </td>
                                    <td className="px-1 py-1"><SlotCell ariaLabel="Clients" listId="quota-client-options-tab" value={s.client} onSave={(v) => patchSlot(p, s, "client", v)} /></td>
                                    <td className="px-1 py-1"><SlotCell ariaLabel="Status" listId="quota-status-options-tab" value={s.status} onSave={(v) => patchSlot(p, s, "status", v)} /></td>
                                    <td className="px-1 py-1"><SlotCell ariaLabel="REMARK" className="h-8 min-w-[140px] px-2 text-xs" value={s.remark} onSave={(v) => patchSlot(p, s, "remark", v)} /></td>
                                    <td className="px-1 py-1.5">
                                      {s.reservation ? (
                                        <div className="space-y-0.5">
                                          <div className="font-medium">{s.reservation.reservedByName}</div>
                                          {s.reservation.website ? <div className="text-gray-500">{s.reservation.website}</div> : null}
                                          {s.reservation.projectName ? <div className="text-gray-500">{s.reservation.projectName}</div> : null}
                                          {s.reservation.note ? <div className="text-gray-400">{s.reservation.note}</div> : null}
                                        </div>
                                      ) : <span className="text-gray-400">—</span>}
                                    </td>
                                    <td className="px-1 py-1.5">
                                      {s.reservation ? (
                                        <div className="flex gap-1">
                                          <Button size="sm" variant="outline" onClick={() => setReserve({ open: true, pkgId: p.id, slotIndex: s.index })}>แก้การจอง</Button>
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={!!s.linkUrl || cancelling === s.reservation.id}
                                            title={s.linkUrl ? "มีลิงก์แล้ว — แก้ที่ช่องโดยตรง" : undefined}
                                            onClick={() => cancelReservation(s.reservation!.id, s)}
                                          >
                                            {cancelling === s.reservation.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}ยกเลิกการจอง
                                          </Button>
                                        </div>
                                      ) : !s.used && !p.expired ? (
                                        <Button size="sm" variant="outline" onClick={() => setReserve({ open: true, pkgId: p.id, slotIndex: s.index })}>จองช่องนี้</Button>
                                      ) : null}
                                    </td>
                                  </tr>
                                ))}
                                {p.slots.length === 0 ? <tr><td colSpan={8} className="px-1 py-3 text-center text-gray-400">ไม่มีช่อง</td></tr> : null}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
        </Panel>
      </div>

      <datalist id="quota-client-options-tab">{view.clientOptions.map((c) => <option key={c} value={c} />)}</datalist>
      <datalist id="quota-status-options-tab">{view.statusOptions.map((c) => <option key={c} value={c} />)}</datalist>

      <PackageDialog
        open={pkgForm.open}
        onOpenChange={(v) => setPkgForm((s) => ({ ...s, open: v }))}
        sources={view.sources}
        pkg={editPkg}
        onDone={setView}
      />
      <ReserveDialog
        open={reserve.open}
        onOpenChange={(v) => setReserve((s) => ({ ...s, open: v }))}
        meta={meta}
        view={view}
        pkg={reservePkg}
        slot={reserveSlot}
        onDone={setView}
      />
      {overwrite.dialog}
    </div>
  );
}
