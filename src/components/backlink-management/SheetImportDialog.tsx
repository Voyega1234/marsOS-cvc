"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, FileSpreadsheet, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Chip } from "@/components/ds";
import { MAP_ALIAS_PREFIX, MAP_NEW } from "@/lib/backlink-management/sheet-import";
import type { ImportPlan, ImportSummary, ProjectPlan, SkipReason } from "@/lib/backlink-management/sheet-import";
import { api, fmtDateTime } from "./shared";
import SearchSelect from "./SearchSelect";

type Config = null | { spreadsheetUrl: string; title: string; budgetPeriod: string; lastImportedAt: string | null; lastSummary: ImportSummary | null };
type ConfigResponse = { serviceEmail: string; canEdit: boolean; tableMissing?: boolean; config: Config };
type ImportResult = {
  projectsCreated: number; budgetsCreated: number; budgetsUpdated: number; requestsCreated: number;
  requestsUpdated: number; requestsLinked: number; requestsRevived: number; requestsCancelled: number;
};
type PreviewResponse = {
  ok: true; applied: boolean;
  spreadsheet: { title: string; url: string; budgetTab: string | null; expenseTab: string | null };
  budgetPeriod: string; suggestedPeriod: string;
  projectMap: Record<string, string>;
  existingProjects: { id: string; name: string; clientName: string; manual: boolean }[];
  plan: ImportPlan;
  planHash: string;
  truncated: { budget: boolean; expense: boolean };
  result?: ImportResult;
};

const SKIP_LABELS: Record<SkipReason, string> = {
  planned: "สถานะ Planned (ยังไม่จ่าย)",
  cancelled: "สถานะ Cancelled",
  blank_status: "ไม่มี Status",
  other_status: "Status ไม่รู้จัก",
  placeholder: "แถวว่าง",
  no_project: "ไม่มีชื่อโปรเจกต์",
  unresolved: "ยังไม่ได้เลือกโปรเจกต์",
  cancelled_in_app: "ถูกยกเลิกใน MarsOS",
  deleted_in_app: "ถูกลบใน MarsOS",
};
const MAX_NOTES = 200;
const noticeCls = "rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800";
const errorCls = "rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800";
const baht = (n: number) => `${(n ?? 0).toLocaleString("th-TH")} บาท`;

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-white/80 bg-white/70 p-2.5 shadow-sm">
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}

function selectValue(p: ProjectPlan, map: Record<string, string>): string {
  if (map[p.key]) return map[p.key];
  if ((p.resolution === "mapped" || p.resolution === "matched") && p.projectId) return p.projectId;
  if (p.resolution === "alias") return MAP_ALIAS_PREFIX + p.targetKey;
  if (p.resolution === "ambiguous") return "";
  return MAP_NEW;
}

function badge(p: ProjectPlan) {
  switch (p.resolution) {
    case "mapped":
    case "matched": return <Chip tone="ok">จับคู่แล้ว</Chip>;
    case "alias": return <Chip tone="muted">ใช้ร่วม</Chip>;
    case "ambiguous": return <Chip tone="warn">ต้องเลือก</Chip>;
    default: return <Chip tone="muted">สร้างใหม่</Chip>;
  }
}

export default function SheetImportDialog({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => void }) {
  const [cfg, setCfg] = useState<ConfigResponse | null>(null);
  const [cfgLoading, setCfgLoading] = useState(false);
  const [url, setUrl] = useState("");
  const [budgetPeriod, setBudgetPeriod] = useState("");
  const [projectMap, setProjectMap] = useState<Record<string, string>>({});
  const [update, setUpdate] = useState(true);
  const [cancelMissing, setCancelMissing] = useState(false);
  const [data, setData] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const seq = useRef(0);

  useEffect(() => {
    seq.current++;
    setCfg(null); setUrl(""); setBudgetPeriod(""); setProjectMap({}); setUpdate(true); setCancelMissing(false);
    setData(null); setLoading(false); setApplying(false); setError("");
    if (!open) return;
    let cancelled = false;
    setCfgLoading(true);
    api<ConfigResponse>("/api/backlink-management/sheet/import")
      .then((d) => {
        if (cancelled) return;
        setCfg(d);
        if (d.config?.spreadsheetUrl) setUrl(d.config.spreadsheetUrl);
      })
      .catch((e) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "โหลดการตั้งค่าไม่สำเร็จ";
        setError(msg);
        toast.error(msg);
      })
      .finally(() => { if (!cancelled) setCfgLoading(false); });
    return () => { cancelled = true; };
  }, [open]);

  const preview = useCallback(async (f: { url: string; budgetPeriod?: string; projectMap?: Record<string, string>; update: boolean; cancelMissing: boolean }) => {
    const my = ++seq.current;
    setLoading(true);
    setError("");
    try {
      const d = await api<PreviewResponse>("/api/backlink-management/sheet/import", {
        method: "POST",
        json: {
          url: f.url,
          ...(f.budgetPeriod ? { budgetPeriod: f.budgetPeriod } : {}),
          ...(f.projectMap ? { projectMap: f.projectMap } : {}),
          update: f.update,
          cancelMissing: f.cancelMissing,
        },
      });
      if (my !== seq.current) return;
      setData(d);
      setBudgetPeriod(d.budgetPeriod);
      setProjectMap(d.projectMap ?? {});
    } catch (e) {
      if (my !== seq.current) return;
      const msg = e instanceof Error ? e.message : "อ่านชีทไม่สำเร็จ";
      setError(msg);
      toast.error(msg);
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, []);

  function repreview(patch: Partial<{ budgetPeriod: string; projectMap: Record<string, string>; update: boolean; cancelMissing: boolean }>) {
    const next = { budgetPeriod, projectMap, update, cancelMissing, ...patch };
    if (patch.budgetPeriod !== undefined) setBudgetPeriod(patch.budgetPeriod);
    if (patch.projectMap !== undefined) setProjectMap(patch.projectMap);
    if (patch.update !== undefined) setUpdate(patch.update);
    if (patch.cancelMissing !== undefined) setCancelMissing(patch.cancelMissing);
    void preview({ url, ...next });
  }

  async function run() {
    if (!data) return;
    const my = ++seq.current;
    setApplying(true);
    setError("");
    try {
      const d = await api<PreviewResponse>("/api/backlink-management/sheet/import", {
        method: "POST",
        json: { url, budgetPeriod, projectMap, update, cancelMissing, apply: true, expectedHash: data.planHash },
      });
      if (my !== seq.current) return;
      const r = d.result;
      toast.success(r
        ? `นำเข้าแล้ว: คำขอใหม่ ${r.requestsCreated}, แก้ ${r.requestsUpdated}, งบ ${r.budgetsCreated + r.budgetsUpdated} รายการ`
        : "นำเข้าแล้ว");
      onImported();
      onClose();
    } catch (e) {
      if (my !== seq.current) return;
      const msg = e instanceof Error ? e.message : "นำเข้าไม่สำเร็จ";
      toast.error(msg);
      if ((e as { status?: number } | null)?.status === 409) {
        // แผนเปลี่ยนหลังดูตัวอย่าง: อ่านชีทใหม่ให้เลย แล้วคงข้อความไว้ให้ผู้ใช้ตรวจก่อนกดอีกครั้ง
        setApplying(false);
        await preview({ url, budgetPeriod, projectMap, update, cancelMissing });
        setError((cur) => cur || msg);
        return;
      }
      setError(msg);
    } finally {
      if (my === seq.current) setApplying(false);
    }
  }

  async function copyEmail() {
    if (!cfg?.serviceEmail) return;
    try {
      await navigator.clipboard.writeText(cfg.serviceEmail);
      toast.success("คัดลอกอีเมลแล้ว");
    } catch {
      toast.error("คัดลอกไม่สำเร็จ");
    }
  }

  const plan = data?.plan;
  const s = plan?.summary;
  const nothingToDo = !!s && s.projectsNew + s.budgetsCreate + s.budgetsUpdate + s.expensesCreate + s.expensesUpdate + s.expensesLink + s.expensesRevive + s.missingCancel + s.rowFixes === 0;
  const onlyRowFixes = !!s && !nothingToDo && s.projectsNew + s.budgetsCreate + s.budgetsUpdate + s.expensesCreate + s.expensesUpdate + s.expensesLink + s.expensesRevive + s.missingCancel === 0;
  const blocked = !!plan && plan.blockers.length > 0;
  const disabledAll = !!cfg?.tableMissing;
  const notes = (plan?.expenses ?? []).filter((x) => x.warnings.length || x.changes.length);
  const skippedEntries = s ? (Object.entries(s.skipped) as [SkipReason, number][]).filter(([, n]) => n > 0) : [];

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>นำเข้าจาก Google Sheet</DialogTitle>
          <DialogDescription>อ่านงบและค่าใช้จ่ายจากชีทของทีมเข้า MarsOS — ระบบอ่านอย่างเดียว ไม่แก้ชีท</DialogDescription>
        </DialogHeader>

        {cfgLoading ? <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />กำลังโหลด…</div> : null}

        {cfg?.tableMissing ? (
          <div className={noticeCls}>ยังไม่ได้สร้างตารางสำหรับนำเข้า ให้ผู้ดูแลรันไฟล์ scripts/sql/add-blm-sheet-import-tables.sql ใน Supabase ก่อน</div>
        ) : null}

        {cfg ? (
          <div className="space-y-3 text-sm">
            <div className="rounded-xl bg-brand-mist/50 p-3 text-xs">
              <div>แชร์ชีทให้อีเมลนี้ก่อน (สิทธิ์ Viewer ก็พอ — ระบบอ่านอย่างเดียว ไม่แก้ชีท)</div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <code className="break-all rounded bg-white/80 px-2 py-0.5">{cfg.serviceEmail || "—"}</code>
                <Button type="button" variant="outline" size="sm" onClick={copyEmail} disabled={!cfg.serviceEmail}>
                  <Copy className="mr-1 h-3.5 w-3.5" />คัดลอก
                </Button>
              </div>
              {cfg.config?.lastImportedAt ? <div className="mt-2 text-gray-600">นำเข้าล่าสุด {fmtDateTime(cfg.config.lastImportedAt)}</div> : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                type="url"
                value={url}
                onChange={(e) => { seq.current++; setUrl(e.target.value); setData(null); setError(""); setLoading(false); }}
                disabled={disabledAll || loading || applying}
                placeholder="https://docs.google.com/spreadsheets/d/…"
                aria-label="ลิงก์ Google Sheet"
                className="h-10 min-w-0 flex-1 rounded-xl border border-input bg-white/90 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <Button type="button" onClick={() => { setProjectMap({}); void preview({ url: url.trim(), update, cancelMissing }); }} disabled={disabledAll || !url.trim() || loading || applying}>
                {loading && !data ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-1 h-4 w-4" />}อ่านชีท
              </Button>
            </div>

            {error ? <div className={errorCls}>{error}</div> : null}

            {data && plan && s ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-gray-700">
                  <span className="font-semibold">{data.spreadsheet.title}</span>
                  {loading ? <span className="flex items-center gap-1 text-gray-500"><Loader2 className="h-3.5 w-3.5 animate-spin" />กำลังคำนวณใหม่…</span> : null}
                </div>
                <div className="text-xs text-gray-600">
                  แท็บงบ: {data.spreadsheet.budgetTab ?? "ไม่พบแท็บนี้ — ข้ามส่วนงบ"} · แท็บค่าใช้จ่าย: {data.spreadsheet.expenseTab ?? "ไม่พบแท็บนี้ — ข้ามส่วนค่าใช้จ่าย"}
                </div>
                {data.truncated.budget || data.truncated.expense ? (
                  <div className={noticeCls}>ชีทมีแถวมากกว่าที่ระบบอ่านได้ต่อครั้ง อ่านมาเฉพาะส่วนแรกเท่านั้น</div>
                ) : null}

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-600" htmlFor="blm-sheet-period">เดือนของงบ</label>
                  <div>
                    <input
                      id="blm-sheet-period"
                      type="month"
                      value={budgetPeriod}
                      onChange={(e) => { if (e.target.value) repreview({ budgetPeriod: e.target.value }); }}
                      disabled={loading || applying}
                      className="h-10 rounded-xl border border-input bg-white/90 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <div className="text-xs text-gray-500">Initial Budget ในชีทเป็นงบทั้งโปรเจกต์ ระบบจะตั้งเป็นงบของเดือนนี้ ส่วนค่าใช้จ่ายแต่ละแถวตัดงบตามเดือนของวันที่ในแถวนั้น ดูยอดรวมได้ที่แท็บงบประมาณ &gt; ทุกเดือน</div>
                </div>

                <div className="overflow-x-auto rounded-2xl border border-white/80 bg-white/70 shadow-sm">
                  <table className="tbl w-full text-xs">
                    <thead>
                      <tr>
                        <th className="text-left">ชื่อในชีท</th>
                        <th className="num">จำนวนแถวค่าใช้จ่าย</th>
                        <th className="text-left">มีในแท็บงบ</th>
                        <th className="text-left">ลงโปรเจกต์</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.projects.map((p) => (
                        <tr key={p.key}>
                          <td className="whitespace-nowrap font-medium">{p.sheetName}</td>
                          <td className="num">{p.expenseRows}</td>
                          <td>{p.inBudget ? "มี" : "—"}</td>
                          <td>
                            <div className="flex items-center gap-2">
                              <SearchSelect
                                className="!w-auto min-w-[200px]"
                                ariaLabel={`ลงโปรเจกต์ ${p.sheetName}`}
                                value={selectValue(p, projectMap)}
                                disabled={loading || applying}
                                onChange={(v) => repreview({ projectMap: { ...projectMap, [p.key]: v } })}
                                emptyLabel={p.resolution === "ambiguous" ? "— เลือกโปรเจกต์ —" : undefined}
                                options={[
                                  ...data.existingProjects.map((ep) => ({ value: ep.id, label: ep.manual ? `${ep.name} (เพิ่มเอง)` : ep.name })),
                                  { value: MAP_NEW, label: `+ สร้างโปรเจกต์ใหม่ "${p.sheetName}"` },
                                  ...plan.projects.filter((o) => o.key !== p.key).map((o) => ({ value: MAP_ALIAS_PREFIX + o.key, label: `ใช้ร่วมกับชื่อในชีท: ${o.sheetName}` })),
                                ]}
                              />
                              {badge(p)}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="space-y-1.5 rounded-xl border border-gray-200 p-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={update} disabled={loading || applying} onChange={(e) => repreview({ update: e.target.checked })} />
                    แก้รายการที่เคยนำเข้าให้ตรงกับชีท
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={cancelMissing} disabled={loading || applying} onChange={(e) => repreview({ cancelMissing: e.target.checked })} />
                    ยกเลิกรายการที่เคยนำเข้าแต่ไม่อยู่ในชีทแล้ว
                  </label>
                </div>

                <div className={`grid grid-cols-2 gap-2 sm:grid-cols-3 ${loading ? "opacity-60" : ""}`}>
                  <Stat label="โปรเจกต์ใหม่" value={s.projectsNew} />
                  <Stat label="งบ: ตั้งใหม่" value={s.budgetsCreate} />
                  <Stat label="งบ: แก้" value={s.budgetsUpdate} />
                  <Stat label="งบ: เหมือนเดิม" value={s.budgetsSame} />
                  <Stat label="งบ: ชนกับงบเดือนอื่น" value={s.budgetsConflict} />
                  <Stat label="งบ: ไม่มีตัวเลข" value={s.budgetsBlank} />
                  <Stat label="ค่าใช้จ่าย: สร้างใหม่" value={s.expensesCreate} />
                  <Stat label="ค่าใช้จ่าย: แก้" value={s.expensesUpdate} />
                  <Stat label="ค่าใช้จ่าย: เหมือนเดิม" value={s.expensesSame} />
                  <Stat label="ค่าใช้จ่าย: ไม่แก้ (ปิดตัวเลือกแก้)" value={s.expensesKeep} />
                  <Stat label="ค่าใช้จ่าย: จับคู่กับรายการที่มีอยู่" value={s.expensesLink} />
                  <Stat label="ค่าใช้จ่าย: เปิดกลับ" value={s.expensesRevive} />
                  <Stat label="ค่าใช้จ่าย: แถวถูกแก้ในชีท (จับคู่เดิม)" value={s.expensesRekey} />
                  <Stat label="ไม่อยู่ในชีทแล้ว" value={`${s.missing} (จะยกเลิก ${s.missingCancel})`} />
                  <Stat label="งบรวมในชีท" value={baht(s.budgetTotal)} />
                  <Stat label={`ค่าใช้จ่าย Published ในชีท (${s.publishedRows} แถว)`} value={baht(s.publishedTotal)} />
                  <Stat label="ยอดที่จะอยู่ใน MarsOS" value={baht(s.importTotal)} />
                </div>

                {skippedEntries.length > 0 ? (
                  <div className="text-xs text-gray-600">
                    แถวที่ข้าม: {skippedEntries.map(([k, n]) => `${SKIP_LABELS[k] ?? k} ${n}`).join(" · ")}
                  </div>
                ) : null}

                {plan.blockers.length > 0 ? (
                  <div className={errorCls}>
                    <div className="mb-1 font-semibold">ต้องแก้ก่อนนำเข้า</div>
                    <ul className="list-disc space-y-0.5 pl-4">{plan.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>
                  </div>
                ) : null}
                {plan.warnings.length > 0 ? (
                  <div className={noticeCls}>
                    <ul className="list-disc space-y-0.5 pl-4">{plan.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                  </div>
                ) : null}
                {notes.length > 0 ? (
                  <details className="text-xs">
                    <summary className="cursor-pointer font-medium">หมายเหตุรายแถว ({notes.length})</summary>
                    <ul className="mt-1 space-y-0.5 text-gray-600">
                      {notes.slice(0, MAX_NOTES).map((x) => (
                        <li key={x.rowKey || x.row}>แถว {x.row} · {x.sheetName}: {[...x.warnings, ...x.changes].join(" · ")}</li>
                      ))}
                    </ul>
                    {notes.length > MAX_NOTES ? <div className="mt-1 text-gray-500">และอีก {notes.length - MAX_NOTES} แถว</div> : null}
                  </details>
                ) : null}
                {s.otherSheetRows > 0 ? <div className="text-xs text-gray-600">มี {s.otherSheetRows} รายการที่นำเข้าจากชีทอื่น — รอบนี้ไม่แตะ</div> : null}
                {nothingToDo && !blocked ? <div className="text-xs text-gray-600">ข้อมูลตรงกับชีทแล้ว ไม่มีอะไรต้องนำเข้า</div> : null}
                {onlyRowFixes && !blocked ? <div className="text-xs text-gray-600">ข้อมูลตรงกับชีทแล้ว เหลือแค่ปรับบันทึกการจับคู่แถว {s.rowFixes} รายการ (ไม่แก้คำขอและงบ)</div> : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={applying}>ยกเลิก</Button>
          <Button onClick={run} disabled={!data || loading || applying || blocked || nothingToDo || disabledAll || !(cfg?.canEdit ?? true)}>
            {applying ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}นำเข้า
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
