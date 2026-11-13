"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Info, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Chip, EmptyState, Panel, Segmented } from "@/components/ds";
import {
  RULE_EDITOR_ROLES, RULE_STATUS_LABEL, RULE_TYPE_LABEL, SEVERITY_LABEL, industryLabel,
  type RuleLite, type RuleStatus,
} from "@/lib/compliance/types";
import { api, type IndustryOpt } from "./shared";
import RuleDialog from "./RuleDialog";

export type RuleRow = RuleLite & { status: RuleStatus };
type StatusFilter = "" | RuleStatus;

export default function RulesTab({ industries, userRole, onChanged }: {
  industries: IndustryOpt[];
  userRole: string;
  onChanged: () => void;
}) {
  const canEdit = RULE_EDITOR_ROLES.includes(userRole);
  const [industry, setIndustry] = useState("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<{ open: boolean; rule: RuleRow | null }>({ open: false, rule: null });
  const [busyId, setBusyId] = useState("");
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams();
    if (industry) p.set("industry", industry);
    if (status) p.set("status", status);
    const { ok, data } = await api<{ rules: RuleRow[] }>(`/api/compliance/rules?${p.toString()}`);
    if (!ok) toast.error(data.error || "โหลดกฎไม่สำเร็จ");
    setRules(ok && Array.isArray(data.rules) ? data.rules : []);
    setLoading(false);
  }, [industry, status]);

  useEffect(() => { void load(); }, [load]);

  function refresh() {
    void load();
    onChanged();
  }

  async function setRuleStatus(r: RuleRow, next: RuleStatus) {
    setBusyId(r.id);
    const { ok, data } = await api(`/api/compliance/rules/${r.id}`, { method: "PATCH", body: JSON.stringify({ status: next }) });
    setBusyId("");
    if (!ok) {
      const problems = Array.isArray(data.problems) && data.problems.length ? `\n• ${data.problems.join("\n• ")}` : "";
      toast.error(`${data.error || "เปลี่ยนสถานะไม่สำเร็จ"}${problems}`, { duration: 9000 });
      return;
    }
    toast.success("เปลี่ยนสถานะแล้ว");
    refresh();
  }

  async function importStarter() {
    if (!industry) return;
    setImporting(true);
    const { ok, data } = await api<{ created: number; skipped: number }>("/api/compliance/rules/starter", {
      method: "POST",
      body: JSON.stringify({ industry }),
    });
    setImporting(false);
    if (!ok) { toast.error(data.error || "นำเข้าไม่สำเร็จ"); return; }
    toast.success(`เพิ่มกฎฉบับร่าง ${data.created} ข้อ (ข้ามที่มีอยู่แล้ว ${data.skipped} ข้อ)`);
    refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-800">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>กฎฉบับร่างยังไม่ถูกใช้ตรวจ — ต้องใส่แหล่งอ้างอิงและวันที่มีผลบังคับใช้ให้ครบก่อนเปิดใช้</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select value={industry} onChange={(e) => setIndustry(e.target.value)} aria-label="อุตสาหกรรม" className="h-9 rounded-full border border-gray-200 bg-white px-3 text-xs">
          <option value="">ทุกอุตสาหกรรม</option>
          {industries.map((i) => <option key={i.key} value={i.key}>{i.label}</option>)}
        </select>
        <Segmented<StatusFilter>
          size="sm"
          value={status}
          onChange={setStatus}
          options={[
            { value: "", label: "ทั้งหมด" },
            { value: "ACTIVE", label: RULE_STATUS_LABEL.ACTIVE },
            { value: "DRAFT", label: RULE_STATUS_LABEL.DRAFT },
            { value: "ARCHIVED", label: RULE_STATUS_LABEL.ARCHIVED },
          ]}
        />
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <Button size="sm" variant="outline" onClick={importStarter} disabled={!industry || importing} title={industry ? undefined : "เลือกอุตสาหกรรมก่อน"}>
              {importing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              เพิ่มชุดกฎตั้งต้น (ฉบับร่าง)
            </Button>
            <Button size="sm" onClick={() => setDialog({ open: true, rule: null })}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> เพิ่มกฎ
            </Button>
          </div>
        )}
      </div>

      <Panel padded={false}>
        {loading ? (
          <EmptyState icon={<Loader2 className="h-5 w-5 animate-spin" />} title="กำลังโหลด..." />
        ) : rules.length === 0 ? (
          <EmptyState title="ยังไม่มีกฎ" description={canEdit ? "เพิ่มกฎเอง หรือเลือกอุตสาหกรรมแล้วกด เพิ่มชุดกฎตั้งต้น" : "ผู้ดูแลระบบยังไม่ได้เพิ่มกฎ"} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>รหัส</TableHead>
                  <TableHead>ชื่อกฎ</TableHead>
                  <TableHead>ประเภท</TableHead>
                  <TableHead>ความรุนแรง</TableHead>
                  <TableHead>จำนวนคำ</TableHead>
                  <TableHead>แหล่งอ้างอิง</TableHead>
                  <TableHead>มีผลบังคับใช้</TableHead>
                  <TableHead>เวอร์ชัน</TableHead>
                  <TableHead>สถานะ</TableHead>
                  {canEdit && <TableHead>จัดการ</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs">{r.code || "—"}</TableCell>
                    <TableCell className="min-w-[200px]">
                      <div className="font-medium text-brand-navy">{r.title}</div>
                      <div className="text-[11px] text-gray-500">{industryLabel(r.industry)}</div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{RULE_TYPE_LABEL[r.ruleType] ?? r.ruleType}</TableCell>
                    <TableCell>
                      <Chip tone={r.severity === "CRITICAL" || r.severity === "HIGH" ? "bad" : r.severity === "MEDIUM" ? "warn" : "info"}>{SEVERITY_LABEL[r.severity]}</Chip>
                    </TableCell>
                    <TableCell className="text-center text-xs">{r.terms.length}</TableCell>
                    <TableCell className="min-w-[200px] text-xs text-gray-600">{r.sourceName || "—"}{r.sourceRef ? ` · ${r.sourceRef}` : ""}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{r.effectiveDate ?? "—"}</TableCell>
                    <TableCell className="text-center text-xs">v{r.version}</TableCell>
                    <TableCell>
                      <Chip tone={r.status === "ACTIVE" ? "ok" : r.status === "DRAFT" ? "warn" : "muted"}>{RULE_STATUS_LABEL[r.status]}</Chip>
                    </TableCell>
                    {canEdit && (
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          <Button size="sm" variant="outline" className="h-8 px-3 text-xs" onClick={() => setDialog({ open: true, rule: r })}>แก้ไข</Button>
                          {r.status !== "ACTIVE" && (
                            <Button size="sm" variant="outline" className="h-8 px-3 text-xs" disabled={busyId === r.id} onClick={() => setRuleStatus(r, "ACTIVE")}>เปิดใช้</Button>
                          )}
                          {r.status === "ACTIVE" && (
                            <Button size="sm" variant="outline" className="h-8 px-3 text-xs" disabled={busyId === r.id} onClick={() => setRuleStatus(r, "DRAFT")}>ปิดใช้ (กลับเป็นร่าง)</Button>
                          )}
                          {r.status !== "ARCHIVED" && (
                            <Button size="sm" variant="ghost" className="h-8 px-3 text-xs" disabled={busyId === r.id} onClick={() => setRuleStatus(r, "ARCHIVED")}>เก็บถาวร</Button>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      {dialog.open && (
        <RuleDialog
          rule={dialog.rule}
          industries={industries}
          defaultIndustry={industry}
          onClose={() => setDialog({ open: false, rule: null })}
          onSaved={() => { setDialog({ open: false, rule: null }); refresh(); }}
        />
      )}
    </div>
  );
}
