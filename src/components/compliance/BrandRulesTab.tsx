"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Chip, EmptyState, Panel, SearchPill } from "@/components/ds";
import {
  BRAND_UNAVAILABLE_MESSAGE, BRAND_VOICE_MAX,
  type BrandDetail, type BrandRuleView, type BrandSummary,
} from "@/lib/compliance/brand";
import { RULE_EDITOR_ROLES, RULE_TYPE_LABEL, SEVERITY_LABEL, industryLabel } from "@/lib/compliance/types";
import { api, type IndustryOpt } from "./shared";
import BrandDialog from "./BrandDialog";
import BrandFiles from "./BrandFiles";
import BrandPullDialog from "./BrandPullDialog";
import BrandRuleDialog from "./BrandRuleDialog";

function summaryOf(b: BrandDetail): BrandSummary {
  return {
    id: b.id, name: b.name, industry: b.industry, status: b.status,
    voiceChars: b.voiceChars, ruleCount: b.ruleCount, fileCount: b.fileCount, updatedAt: b.updatedAt,
  };
}

function libraryWarning(r: BrandRuleView): string {
  if (r.source !== "library" || !r.libraryStatus || r.libraryStatus === "ACTIVE") return "";
  if (r.libraryStatus === "MISSING") return "กฎต้นทางถูกลบ";
  if (r.libraryStatus === "DRAFT") return "ต้นทางยังเป็นฉบับร่าง — ยังไม่ถูกใช้ตรวจ";
  return "ต้นทางถูกเก็บ — ไม่ถูกใช้ตรวจ";
}

export default function BrandRulesTab({ industries, userRole }: {
  industries: IndustryOpt[];
  userRole: string;
}) {
  const canArchive = RULE_EDITOR_ROLES.includes(userRole);
  const [brands, setBrands] = useState<BrandSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [selectedId, setSelectedIdState] = useState("");
  // คำตอบของ API กลับมาช้ากว่าการเปลี่ยนแบรนด์ได้ — ref นี้คือแบรนด์ที่เปิดอยู่จริง ณ ตอนคำตอบมาถึง
  // ใช้กันไม่ให้รายละเอียดของแบรนด์หนึ่งไปอยู่คู่กับ Brand voice ที่พิมพ์ค้างของอีกแบรนด์
  const selectedRef = useRef("");
  const setSelectedId = (id: string) => { selectedRef.current = id; setSelectedIdState(id); };
  const [detail, setDetail] = useState<BrandDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [voice, setVoice] = useState("");
  const [savingVoice, setSavingVoice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyRuleId, setBusyRuleId] = useState("");
  const [brandDialog, setBrandDialog] = useState<{ open: boolean; create: boolean }>({ open: false, create: false });
  const [ruleDialog, setRuleDialog] = useState<{ open: boolean; rule: BrandRuleView | null }>({ open: false, rule: null });
  const [pulling, setPulling] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    const { ok, data } = await api<{ brands: BrandSummary[]; unavailable?: boolean }>("/api/compliance/brands");
    if (data.unavailable) {
      setUnavailable(true);
      setBrands([]);
    } else {
      setUnavailable(false);
      if (!ok) toast.error(data.error || "โหลดรายการแบรนด์ไม่สำเร็จ");
      setBrands(ok && Array.isArray(data.brands) ? data.brands : []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void loadList(); }, [loadList]);

  const voiceDirty = !!detail && voice !== detail.voice;

  /** ใช้ brand สดจากทุกคำตอบของ API อัปเดตแถวในรายการเสมอ — รายละเอียดอัปเดตเฉพาะเมื่อยังเปิดแบรนด์นั้นอยู่
   *  (ไม่ทับ Brand voice ที่ยังพิมพ์ค้าง เว้นแต่ resetVoice) */
  function applyBrand(b: BrandDetail, resetVoice = false) {
    setBrands((prev) => {
      const s = summaryOf(b);
      return prev.some((x) => x.id === b.id) ? prev.map((x) => (x.id === b.id ? s : x)) : [s, ...prev];
    });
    if (b.id !== selectedRef.current) return;
    setDetail(b);
    if (resetVoice) setVoice(b.voice);
  }

  async function select(id: string) {
    if (id === selectedId) return;
    if (voiceDirty && !window.confirm("Brand voice ที่แก้ไว้ยังไม่ได้บันทึก — ถ้าเปลี่ยนแบรนด์ข้อความที่แก้จะหายไป ต้องการเปลี่ยนหรือไม่?")) return;
    setSelectedId(id);
    setDetail(null);
    setVoice("");
    setDetailLoading(true);
    const { ok, data } = await api<{ brand: BrandDetail }>(`/api/compliance/brands/${id}`);
    if (selectedRef.current !== id) return; // เปลี่ยนไปแบรนด์อื่นแล้ว — ทิ้งคำตอบนี้
    setDetailLoading(false);
    if (!ok || !data.brand) { toast.error(data.error || "โหลดข้อมูลแบรนด์ไม่สำเร็จ"); setSelectedId(""); return; }
    setDetail(data.brand);
    setVoice(data.brand.voice);
  }

  async function saveVoice() {
    if (!detail || detail.id !== selectedRef.current) return;
    setSavingVoice(true);
    const { ok, data } = await api<{ brand: BrandDetail }>(`/api/compliance/brands/${detail.id}`, {
      method: "PATCH", body: JSON.stringify({ voice }),
    });
    setSavingVoice(false);
    if (!ok || !data.brand) { toast.error(data.error || "บันทึก Brand voice ไม่สำเร็จ", { duration: 9000 }); return; }
    toast.success("บันทึก Brand voice แล้ว");
    applyBrand(data.brand, true);
  }

  async function toggleArchive() {
    if (!detail) return;
    const archive = detail.status === "ACTIVE";
    const msg = archive
      ? `เก็บแบรนด์ "${detail.name}"? แบรนด์จะถูกซ่อนจากรายการและเลือกตรวจไม่ได้ (นำกลับมาใช้ได้ภายหลัง)`
      : `นำแบรนด์ "${detail.name}" กลับมาใช้?`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    const { ok, data } = await api<{ brand: BrandDetail }>(`/api/compliance/brands/${detail.id}`, {
      method: "PATCH", body: JSON.stringify({ status: archive ? "ARCHIVED" : "ACTIVE" }),
    });
    setBusy(false);
    if (!ok || !data.brand) { toast.error(data.error || "เปลี่ยนสถานะไม่สำเร็จ", { duration: 9000 }); return; }
    toast.success(archive ? "เก็บแบรนด์แล้ว" : "นำแบรนด์กลับมาใช้แล้ว");
    applyBrand(data.brand);
  }

  async function setRuleActive(r: BrandRuleView, active: boolean) {
    if (!detail) return;
    setBusyRuleId(r.id);
    const { ok, data } = await api<{ brand: BrandDetail }>(`/api/compliance/brands/${detail.id}/rules/${r.id}`, {
      method: "PATCH", body: JSON.stringify({ status: active ? "ACTIVE" : "INACTIVE" }),
    });
    setBusyRuleId("");
    if (!ok || !data.brand) { toast.error(data.error || "เปลี่ยนสถานะไม่สำเร็จ", { duration: 9000 }); return; }
    applyBrand(data.brand);
  }

  async function removeRule(r: BrandRuleView) {
    if (!detail) return;
    const msg = r.source === "own"
      ? `ลบกฎ "${r.title}" ออกจากแบรนด์นี้?`
      : `เอากฎ "${r.title}" ออกจากแบรนด์นี้? (กฎในคลังกฎไม่ถูกลบ)`;
    if (!window.confirm(msg)) return;
    setBusyRuleId(r.id);
    const { ok, data } = await api<{ brand: BrandDetail }>(`/api/compliance/brands/${detail.id}/rules/${r.id}`, { method: "DELETE" });
    setBusyRuleId("");
    if (!ok || !data.brand) { toast.error(data.error || "ลบไม่สำเร็จ", { duration: 9000 }); return; }
    toast.success(r.source === "own" ? "ลบกฎแล้ว" : "เอากฎออกแล้ว");
    applyBrand(data.brand);
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return brands.filter((b) => (showArchived || b.status === "ACTIVE" || b.id === selectedId)
      && (!needle || b.name.toLowerCase().includes(needle)));
  }, [brands, q, showArchived, selectedId]);

  if (unavailable) {
    return (
      <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        {BRAND_UNAVAILABLE_MESSAGE}
      </div>
    );
  }

  const effectiveCount = detail ? detail.rules.filter((r) => r.effective).length : 0;

  return (
    <div className="space-y-4 lg:grid lg:grid-cols-[280px_1fr] lg:items-start lg:gap-4 lg:space-y-0">
      <Panel
        title="ลูกค้า / แบรนด์"
        actions={
          <Button size="sm" onClick={() => setBrandDialog({ open: true, create: true })}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> เพิ่มแบรนด์
          </Button>
        }
      >
        <div className="space-y-3">
          <SearchPill value={q} onChange={setQ} placeholder="ค้นหาชื่อแบรนด์" className="w-full" />
          <label className="flex items-center gap-2 text-xs text-gray-700">
            <Switch checked={showArchived} onCheckedChange={setShowArchived} aria-label="แสดงที่เก็บแล้ว" />
            แสดงที่เก็บแล้ว
          </label>
          {loading ? (
            <EmptyState icon={<Loader2 className="h-5 w-5 animate-spin" />} title="กำลังโหลด..." />
          ) : filtered.length === 0 ? (
            brands.length === 0 ? (
              <EmptyState title="ยังไม่มีแบรนด์ — กดเพิ่มแบรนด์เพื่อสร้างโปรไฟล์ของลูกค้า 1 ราย" />
            ) : (
              <EmptyState title="ไม่พบแบรนด์" description="ลองเปลี่ยนคำค้น หรือเปิด แสดงที่เก็บแล้ว" />
            )
          ) : (
            <ul className="space-y-1.5">
              {filtered.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => void select(b.id)}
                    aria-pressed={b.id === selectedId}
                    className={`w-full rounded-2xl border px-3 py-2 text-left transition-colors ${
                      b.id === selectedId ? "border-brand-navy bg-white shadow-sm" : "border-gray-100 bg-white/60 hover:border-gray-300"}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className={`min-w-0 break-words text-sm font-medium ${b.status === "ARCHIVED" ? "text-gray-500" : "text-brand-navy"}`}>{b.name}</span>
                      {b.status === "ARCHIVED" && <Chip tone="muted" className="shrink-0">เก็บแล้ว</Chip>}
                    </div>
                    {b.industry && <div className="text-[11px] text-gray-500">{industryLabel(b.industry)}</div>}
                    <div className="text-[11px] text-gray-500">กฎ {b.ruleCount} · ไฟล์ {b.fileCount}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>

      <div className="min-w-0 space-y-4">
        {!selectedId ? (
          <Panel>
            <EmptyState title="เลือกแบรนด์จากรายการด้านซ้าย" description="หรือกด เพิ่มแบรนด์ เพื่อสร้างโปรไฟล์ของลูกค้า 1 ราย" />
          </Panel>
        ) : detailLoading || !detail ? (
          <Panel>
            <EmptyState icon={<Loader2 className="h-5 w-5 animate-spin" />} title="กำลังโหลด..." />
          </Panel>
        ) : (
          <>
            <Panel
              title={<span className="break-words">{detail.name}</span>}
              subtitle={detail.industry ? industryLabel(detail.industry) : "ไม่ได้ระบุอุตสาหกรรม"}
              actions={
                <>
                  {detail.status === "ARCHIVED" && <Chip tone="muted">เก็บแล้ว</Chip>}
                  <Button size="sm" variant="outline" onClick={() => setBrandDialog({ open: true, create: false })}>แก้ไขข้อมูล</Button>
                  {canArchive && (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void toggleArchive()}>
                      {detail.status === "ACTIVE" ? "เก็บแบรนด์" : "นำกลับมาใช้"}
                    </Button>
                  )}
                </>
              }
            >
              {detail.notes && <p className="whitespace-pre-wrap text-xs text-gray-600">{detail.notes}</p>}
            </Panel>

            <Panel title="Brand voice">
              <div className="space-y-2">
                <Textarea
                  rows={8} value={voice} maxLength={BRAND_VOICE_MAX} aria-label="Brand voice"
                  onChange={(e) => setVoice(e.target.value)}
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-gray-500">
                    อธิบายน้ำเสียง ระดับภาษา สรรพนาม คำที่ให้ใช้ / ห้ามใช้ วิธีเรียกชื่อแบรนด์และสินค้า — AI ใช้ส่วนนี้ตรวจบทความเมื่อเลือกตรวจแบบ Brand Rule
                  </p>
                  <span className="text-xs text-gray-500">{voice.length.toLocaleString("en-US")} / {BRAND_VOICE_MAX.toLocaleString("en-US")}</span>
                </div>
                <Button size="sm" disabled={!voiceDirty || savingVoice} onClick={() => void saveVoice()}>
                  {savingVoice ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                  บันทึก Brand voice
                </Button>
              </div>
            </Panel>

            <Panel title="ไฟล์ Brand voice">
              <BrandFiles brand={detail} onChanged={(b) => applyBrand(b)} />
            </Panel>

            <Panel
              title="กฎของแบรนด์"
              padded={false}
              actions={
                <>
                  <Button size="sm" variant="outline" onClick={() => setPulling(true)}>ดึงจากคลังกฎ</Button>
                  <Button size="sm" onClick={() => setRuleDialog({ open: true, rule: null })}>
                    <Plus className="mr-1.5 h-3.5 w-3.5" /> เพิ่มกฎของแบรนด์
                  </Button>
                </>
              }
            >
              <p className="px-4 pb-2 pt-2 text-xs text-gray-600 md:px-5">ใช้ตรวจจริง {effectiveCount} จาก {detail.rules.length} ข้อ</p>
              {detail.rules.length === 0 ? (
                <EmptyState title="ยังไม่มีกฎของแบรนด์" description="เพิ่มกฎของแบรนด์เอง หรือดึงจากคลังกฎ" />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>รหัส</TableHead>
                        <TableHead>ชื่อกฎ</TableHead>
                        <TableHead>ประเภท</TableHead>
                        <TableHead>ความรุนแรง</TableHead>
                        <TableHead>ใช้ตรวจ</TableHead>
                        <TableHead>จัดการ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.rules.map((r) => {
                        const warn = libraryWarning(r);
                        return (
                          <TableRow key={r.id}>
                            <TableCell className="whitespace-nowrap font-mono text-xs">{r.code || "—"}</TableCell>
                            <TableCell className="min-w-[200px]">
                              <div className="font-medium text-brand-navy">{r.title}</div>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {r.source === "own"
                                  ? <Chip tone="info">ของแบรนด์</Chip>
                                  : <Chip tone="muted">คลังกฎ · {industryLabel(r.libraryIndustry)}</Chip>}
                                {warn && <Chip tone="warn">{warn}</Chip>}
                              </div>
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs">
                              {RULE_TYPE_LABEL[r.ruleType] ?? r.ruleType}
                              {r.terms.length > 0 ? <span className="text-gray-500"> · {r.terms.length} คำ</span> : null}
                            </TableCell>
                            <TableCell>
                              <Chip tone={r.severity === "CRITICAL" || r.severity === "HIGH" ? "bad" : r.severity === "MEDIUM" ? "warn" : "info"}>{SEVERITY_LABEL[r.severity]}</Chip>
                            </TableCell>
                            <TableCell>
                              <Switch
                                checked={r.status === "ACTIVE"} disabled={busyRuleId === r.id}
                                aria-label={`ใช้ตรวจ ${r.title}`}
                                onCheckedChange={(v) => void setRuleActive(r, v)}
                              />
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1.5">
                                {r.source === "own" ? (
                                  <>
                                    <Button size="sm" variant="outline" className="h-8 px-3 text-xs" onClick={() => setRuleDialog({ open: true, rule: r })}>แก้ไข</Button>
                                    <Button size="sm" variant="ghost" className="h-8 px-3 text-xs" disabled={busyRuleId === r.id} onClick={() => void removeRule(r)}>ลบ</Button>
                                  </>
                                ) : (
                                  <Button size="sm" variant="ghost" className="h-8 px-3 text-xs" disabled={busyRuleId === r.id} onClick={() => void removeRule(r)}>เอาออก</Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Panel>
          </>
        )}
      </div>

      {brandDialog.open && (
        <BrandDialog
          brand={brandDialog.create ? null : detail}
          industries={industries}
          onClose={() => setBrandDialog({ open: false, create: false })}
          onSaved={(b, created) => {
            setBrandDialog({ open: false, create: false });
            if (created) {
              if (voiceDirty && !window.confirm("Brand voice ที่แก้ไว้ยังไม่ได้บันทึก — ถ้าเปลี่ยนแบรนด์ข้อความที่แก้จะหายไป ต้องการเปลี่ยนหรือไม่?")) {
                applyBrand(b);
                return;
              }
              setSelectedId(b.id);
              applyBrand(b, true);
            } else {
              applyBrand(b);
            }
          }}
        />
      )}
      {ruleDialog.open && detail && (
        <BrandRuleDialog
          brandId={detail.id}
          rule={ruleDialog.rule}
          onClose={() => setRuleDialog({ open: false, rule: null })}
          onSaved={(b) => { setRuleDialog({ open: false, rule: null }); applyBrand(b); }}
        />
      )}
      {pulling && detail && (
        <BrandPullDialog
          brand={detail}
          industries={industries}
          onClose={() => setPulling(false)}
          onSaved={(b) => { setPulling(false); applyBrand(b); }}
        />
      )}
    </div>
  );
}
