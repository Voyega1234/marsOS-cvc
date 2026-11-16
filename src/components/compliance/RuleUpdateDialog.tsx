"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Chip } from "@/components/ds";
import {
  RULE_FIELD_LABEL, RULE_STATUS_LABEL, RULE_TYPE_LABEL, RULE_UPDATE_FIELDS, SEVERITY_LABEL, industryLabel,
  type RuleUpdateField, type RuleUpdateProposal, type RuleUpdateResult, type RuleUpdateValues,
} from "@/lib/compliance/types";
import { api } from "./shared";

type Outcome = { industry: string; result: RuleUpdateResult } | { industry: string; error: string };
type ItemState = "applying" | "applied" | "skipped";

const pk = (industry: string, p: RuleUpdateProposal) => `${industry}:${p.id}`;

function scalarText(field: RuleUpdateField, v: RuleUpdateValues[RuleUpdateField]): string {
  if (v === null || v === undefined || v === "") return "—";
  if (field === "ruleType" && typeof v === "string") return (RULE_TYPE_LABEL as Record<string, string>)[v] ?? v;
  if (field === "severity" && typeof v === "string") return (SEVERITY_LABEL as Record<string, string>)[v] ?? v;
  if (Array.isArray(v)) return v.join(", ") || "—";
  return String(v);
}

function DiffRow({ field, p }: { field: RuleUpdateField; p: RuleUpdateProposal }) {
  const next = p.changes[field];
  const prev = p.before[field];
  const isUpdate = p.kind === "update";
  let body: ReactNode;
  if (field === "terms") {
    const nextTerms = Array.isArray(next) ? next : [];
    const prevTerms = Array.isArray(prev) ? prev : [];
    if (isUpdate) {
      const added = nextTerms.filter((t) => !prevTerms.includes(t));
      const removed = prevTerms.filter((t) => !nextTerms.includes(t));
      body = (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {added.map((t) => <span key={`a:${t}`} className="text-emerald-700">+ {t}</span>)}
          {removed.map((t) => <span key={`r:${t}`} className="text-red-600 line-through">− {t}</span>)}
          {added.length === 0 && removed.length === 0 && <span className="text-gray-500">ไม่เปลี่ยน</span>}
        </div>
      );
    } else {
      body = <div className="text-emerald-700">{nextTerms.join(", ") || "—"}</div>;
    }
  } else {
    body = (
      <>
        {isUpdate && <div className="text-red-600 line-through">{scalarText(field, prev)}</div>}
        <div className="text-emerald-700">{scalarText(field, next)}</div>
      </>
    );
  }
  return (
    <div className="grid gap-1 text-xs sm:grid-cols-[150px_1fr]">
      <div className="font-medium text-gray-600">{RULE_FIELD_LABEL[field]}</div>
      <div className="min-w-0 whitespace-pre-wrap break-words">{body}</div>
    </div>
  );
}

export default function RuleUpdateDialog({ industries, onClose, onApplied }: {
  industries: { key: string; label: string }[];
  onClose: () => void;
  onApplied: () => void;
}) {
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [progress, setProgress] = useState<{ index: number; label: string } | null>(null);
  const [done, setDone] = useState(false);
  const [items, setItems] = useState<Record<string, ItemState>>({});
  const [bulk, setBulk] = useState(false);

  const startedRef = useRef(false);
  const mountedRef = useRef(false);
  const stopRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    if (!startedRef.current) {
      startedRef.current = true;
      void (async () => {
        for (let i = 0; i < industries.length; i++) {
          if (stopRef.current) break;
          const ind = industries[i];
          if (mountedRef.current) setProgress({ index: i + 1, label: ind.label });
          const { ok, data } = await api<RuleUpdateResult>("/api/compliance/rules/ai-update", {
            method: "POST",
            body: JSON.stringify({ industry: ind.key }),
          });
          const outcome: Outcome = ok && Array.isArray(data.proposals)
            ? { industry: ind.key, result: data as RuleUpdateResult }
            : { industry: ind.key, error: data.error || "ตรวจไม่สำเร็จ" };
          if (mountedRef.current) setOutcomes((prev) => [...prev, outcome]);
        }
        if (mountedRef.current) { setProgress(null); setDone(true); }
      })();
    }
    return () => { mountedRef.current = false; };
  }, [industries]);

  function close() {
    stopRef.current = true;
    onClose();
  }

  /** คืน null เมื่อสำเร็จ หรือข้อความ error เมื่อไม่สำเร็จ */
  async function applyOne(ind: string, p: RuleUpdateProposal): Promise<string | null> {
    const key = pk(ind, p);
    const changeNote = `AI ตรวจอัปเดตกฎ: ${p.reason}`.slice(0, 380) + (p.evidenceUrl ? ` (${p.evidenceUrl})`.slice(0, 120) : "");
    setItems((s) => ({ ...s, [key]: "applying" }));
    const { ok, data } = p.kind === "update"
      ? await api(`/api/compliance/rules/${p.ruleId}`, { method: "PATCH", body: JSON.stringify({ ...p.changes, changeNote }) })
      : await api("/api/compliance/rules", { method: "POST", body: JSON.stringify({ industry: ind, code: p.ruleCode, ...p.changes }) });
    if (!ok) {
      setItems((s) => { const n = { ...s }; delete n[key]; return n; });
      const problems = Array.isArray(data.problems) && data.problems.length ? `\n• ${data.problems.join("\n• ")}` : "";
      return `${data.error || "นำไปใช้ไม่สำเร็จ"}${problems}`;
    }
    setItems((s) => ({ ...s, [key]: "applied" }));
    onApplied();
    return null;
  }

  async function applyClick(ind: string, p: RuleUpdateProposal) {
    const err = await applyOne(ind, p);
    if (err) toast.error(`${p.ruleCode}: ${err}`, { duration: 9000 });
    else toast.success(`นำไปใช้แล้ว: ${p.ruleCode}`);
  }

  const pending: { ind: string; p: RuleUpdateProposal }[] = [];
  for (const o of outcomes) {
    if ("result" in o) {
      for (const p of o.result.proposals) {
        if (p.trusted && !items[pk(o.industry, p)]) pending.push({ ind: o.industry, p });
      }
    }
  }

  async function applyAll() {
    const queue = [...pending];
    setBulk(true);
    let okCount = 0;
    let failCount = 0;
    for (const { ind, p } of queue) {
      const err = await applyOne(ind, p);
      if (err) failCount++; else okCount++;
    }
    setBulk(false);
    if (failCount) toast.error(`นำไปใช้สำเร็จ ${okCount} ข้อ, ไม่สำเร็จ ${failCount} ข้อ`, { duration: 9000 });
    else toast.success(`นำไปใช้สำเร็จ ${okCount} ข้อ`);
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) close(); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>ให้ AI ตรวจอัปเดตกฎ</DialogTitle></DialogHeader>

        {progress && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-gray-100 bg-gray-50 p-3 text-sm text-gray-700">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="min-w-0 flex-1">
              กำลังให้ AI อ่านแหล่งกฎหมายล่าสุด… ({progress.index}/{industries.length}) {progress.label}
            </span>
            <Button size="sm" variant="outline" className="h-8 px-3 text-xs" onClick={() => { stopRef.current = true; }}>หยุด</Button>
          </div>
        )}

        <div className="space-y-5">
          {outcomes.map((o) => (
            <section key={o.industry} className="space-y-3">
              <h3 className="text-sm font-semibold text-brand-navy">{industryLabel(o.industry)}</h3>
              {"error" in o ? (
                <p className="whitespace-pre-wrap break-words text-xs text-red-600">{o.error}</p>
              ) : (
                <>
                  <p className="whitespace-pre-wrap break-words text-sm text-gray-700">{o.result.summary}</p>
                  <p className="text-[11px] text-gray-500">
                    ตรวจ {o.result.checkedRules} ข้อ จาก {o.result.sources} แหล่ง · โมเดล {o.result.model}
                  </p>
                  {o.result.errors.map((e, i) => (
                    <p key={i} className="whitespace-pre-wrap break-words text-xs text-amber-700">{e}</p>
                  ))}
                  {o.result.proposals.length === 0 && <p className="text-xs text-gray-500">ไม่พบการเปลี่ยนแปลง</p>}
                  {o.result.proposals.map((p) => {
                    const key = pk(o.industry, p);
                    const st = items[key];
                    const fields = RULE_UPDATE_FIELDS.filter((f) => f in p.changes);
                    const locked = st === "applying" || st === "applied" || st === "skipped" || bulk;
                    return (
                      <div key={key} className={`space-y-2.5 rounded-2xl border border-gray-200 p-3 ${st === "skipped" ? "opacity-50" : ""}`}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs">{p.ruleCode || "—"}</span>
                          <span className="min-w-0 text-sm font-medium text-brand-navy">{p.ruleTitle}</span>
                          {p.kind === "new"
                            ? <Chip tone="info">กฎใหม่</Chip>
                            : p.ruleStatus && <Chip tone="muted">{RULE_STATUS_LABEL[p.ruleStatus]}</Chip>}
                          {p.trusted ? <Chip tone="ok">แหล่งน่าเชื่อถือ</Chip> : <Chip tone="warn">ต้องตรวจแหล่งเอง</Chip>}
                          {st === "applied" && <Chip tone="ok">นำไปใช้แล้ว</Chip>}
                        </div>
                        {p.trustNote && <p className="text-[11px] text-gray-500">{p.trustNote}</p>}
                        <p className="whitespace-pre-wrap break-words text-sm text-gray-700">{p.reason}</p>
                        <div className="space-y-1.5 rounded-xl bg-gray-50 p-2.5">
                          {fields.map((f) => <DiffRow key={f} field={f} p={p} />)}
                        </div>
                        {p.evidenceQuote && (
                          <blockquote className="whitespace-pre-wrap break-words rounded-xl border border-gray-200 px-3 py-2 text-xs text-gray-600">
                            {p.evidenceQuote}
                          </blockquote>
                        )}
                        {/^https?:\/\//.test(p.evidenceUrl) && (
                          <a href={p.evidenceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 underline">
                            เปิดแหล่งอ้างอิง
                          </a>
                        )}
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" className="h-8 px-3 text-xs" disabled={locked} onClick={() => applyClick(o.industry, p)}>
                            {st === "applying" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                            นำไปใช้
                          </Button>
                          <Button
                            size="sm" variant="ghost" className="h-8 px-3 text-xs" disabled={locked}
                            onClick={() => setItems((s) => ({ ...s, [key]: "skipped" }))}
                          >
                            ข้าม
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </section>
          ))}
          {done && outcomes.length === 0 && <p className="text-sm text-gray-500">ไม่ได้ตรวจอุตสาหกรรมใด</p>}
        </div>

        <DialogFooter className="items-center gap-2 sm:justify-between sm:gap-2 sm:space-x-0">
          <p className="text-[11px] text-gray-500 sm:max-w-xs">
            AI เป็นผู้เสนอ — เปิดแหล่งอ้างอิงตรวจก่อนกดนำไปใช้ทุกครั้ง กฎใหม่จะถูกเพิ่มเป็นฉบับร่าง
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={pending.length === 0 || bulk} onClick={applyAll}>
              {bulk ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              นำไปใช้ทั้งหมด (เฉพาะแหล่งน่าเชื่อถือ) ({pending.length})
            </Button>
            <Button onClick={close}>ปิด</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
