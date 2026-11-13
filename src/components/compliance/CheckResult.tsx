"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Copy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Chip, KpiTile, Panel } from "@/components/ds";
import {
  CHECK_STATUS_LABEL, REVIEWER_ROLES, SEVERITIES, SEVERITY_LABEL, VERDICT_LABEL, industryLabel,
  type Finding, type Verdict,
} from "@/lib/compliance/types";
import { api, fmtDateTime, riskTone, statusTone, type CheckFull } from "./shared";

function verdictTone(v: Verdict): "bad" | "warn" | "ok" {
  return v === "violation" ? "bad" : v === "needs_review" ? "warn" : "ok";
}

function Excerpt({ excerpt, quote }: { excerpt: string; quote: string }) {
  const q = quote.replace(/\s+/g, " ").trim();
  const i = q ? excerpt.indexOf(q) : -1;
  if (i < 0) return <>{excerpt}</>;
  return (
    <>
      {excerpt.slice(0, i)}
      <mark className="rounded bg-amber-200 px-0.5 text-brand-navy">{excerpt.slice(i, i + q.length)}</mark>
      {excerpt.slice(i + q.length)}
    </>
  );
}

function FindingCard({ f }: { f: Finding }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(f.suggestion);
      toast.success("คัดลอกแล้ว");
    } catch {
      toast.error("คัดลอกไม่สำเร็จ");
    }
  }
  return (
    <div className="rounded-2xl border border-gray-100 bg-white/80 p-3 md:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-mono text-gray-500">{f.ruleCode}</span>
        <span className="text-sm font-semibold text-brand-navy">{f.ruleTitle}</span>
        <Chip tone={verdictTone(f.verdict)}>{VERDICT_LABEL[f.verdict]}</Chip>
        {f.origin === "ai" && <Chip tone="info">AI</Chip>}
      </div>
      <p className="mt-2 rounded-xl bg-brand-mist/60 px-3 py-2 text-sm leading-relaxed text-gray-700 break-words">
        <Excerpt excerpt={f.excerpt} quote={f.quote} />
      </p>
      {f.reason ? <p className="mt-2 text-sm text-gray-700">{f.reason}</p> : null}
      {f.suggestion ? (
        <div className="mt-2 flex items-start gap-2 rounded-xl border border-gray-100 px-3 py-2">
          <div className="min-w-0 flex-1 text-sm">
            <span className="text-xs font-semibold text-gray-500">แนะนำให้เขียน</span>
            <p className="mt-0.5 break-words text-gray-800">{f.suggestion}</p>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={copy} aria-label="คัดลอกคำแนะนำ">
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : null}
      <p className="mt-2 text-[11px] text-gray-500">
        อ้างอิง:{" "}
        {/^https?:\/\//i.test(f.sourceUrl || "") ? (
          <a href={f.sourceUrl} target="_blank" rel="noreferrer" className="text-brand-blue underline">{f.sourceName || f.sourceUrl}</a>
        ) : (
          f.sourceName || "—"
        )}{" "}
        {f.sourceRef} · กฎเวอร์ชัน {f.ruleVersion}
      </p>
    </div>
  );
}

export default function CheckResult({ check, userRole, onChange }: {
  check: CheckFull;
  userRole: string;
  onChange: (c: CheckFull) => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const canReview = REVIEWER_ROLES.includes(userRole) && (check.status === "PENDING_REVIEW" || check.status === "CHANGES_REQUESTED");

  const counted = check.findings.filter((f) => f.verdict !== "likely_ok");
  const byTier = (s: string) => counted.filter((f) => f.severity === s);

  async function decide(decision: "APPROVED" | "CHANGES_REQUESTED" | "REJECTED") {
    setBusy(true);
    const { ok, data } = await api<{ check: CheckFull }>(`/api/compliance/checks/${check.id}/review`, {
      method: "POST",
      body: JSON.stringify({ decision, note }),
    });
    setBusy(false);
    if (!ok || !data.check) {
      toast.error(data.error || "บันทึกผลไม่สำเร็จ");
      return;
    }
    toast.success("บันทึกผลแล้ว");
    setNote("");
    onChange(data.check);
  }

  return (
    <div className="space-y-4">
      <Panel
        title={check.title || "ผลตรวจ"}
        subtitle={`${industryLabel(check.industry)} · ${check.ownerLabel || "—"} · ${fmtDateTime(check.createdAt)}`}
        actions={
          <>
            <Chip tone={riskTone(check.riskLevel)}>ความเสี่ยง: {SEVERITY_LABEL[check.riskLevel]} · {check.riskScore}/100</Chip>
            <Chip tone={statusTone(check.status)}>{CHECK_STATUS_LABEL[check.status]}</Chip>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {SEVERITIES.map((s) => (
            <KpiTile key={s} label={SEVERITY_LABEL[s]} value={byTier(s).length} tone={s === "CRITICAL" || s === "HIGH" ? "warm" : "plain"} />
          ))}
        </div>
        {check.summary ? <p className="mt-4 text-sm text-gray-700">{check.summary}</p> : null}
        <p className="mt-3 text-xs text-gray-500">
          {check.aiUsed
            ? `ใช้ AI ตรวจบริบทแล้ว (${check.aiModel})${check.aiError ? ` · ${check.aiError}` : ""}`
            : check.aiError
              ? `AI ตรวจบริบทไม่สำเร็จ: ${check.aiError} (ใช้ผลจากกฎอย่างเดียว)`
              : "ไม่ได้ใช้ AI — ตรวจจากกฎอย่างเดียว"}
        </p>
      </Panel>

      {check.findings.length === 0 ? (
        <Panel><p className="text-sm text-gray-600">ไม่พบข้อความที่เข้าข่ายกฎที่เปิดใช้</p></Panel>
      ) : (
        SEVERITIES.map((s) => {
          const list = check.findings.filter((f) => f.severity === s);
          if (!list.length) return null;
          return (
            <Panel key={s} title={`ความรุนแรง: ${SEVERITY_LABEL[s]}`} subtitle={`${list.length} รายการ`}>
              <div className="space-y-3">
                {list.map((f) => <FindingCard key={f.id} f={f} />)}
              </div>
            </Panel>
          );
        })
      )}

      <Panel title="การตรวจและอนุมัติ">
        {canReview ? (
          <div className="space-y-3">
            {check.status === "CHANGES_REQUESTED" && check.reviewNote ? (
              <p className="text-xs text-gray-500">ขอให้แก้ไขล่าสุดโดย {check.reviewedByName || "—"}: {check.reviewNote}</p>
            ) : null}
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="บันทึกเหตุผล (จำเป็นอย่างน้อย 10 ตัวอักษรเมื่ออนุมัติผลที่เสี่ยงสูง/วิกฤต)" />
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => decide("APPROVED")}>
                {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}อนุมัติ
              </Button>
              <Button disabled={busy} variant="outline" onClick={() => decide("CHANGES_REQUESTED")}>ขอให้แก้ไข</Button>
              <Button disabled={busy} variant="destructive" onClick={() => decide("REJECTED")}>ไม่อนุมัติ</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-1 text-sm text-gray-700">
            <p>สถานะ: <span className="font-semibold">{CHECK_STATUS_LABEL[check.status]}</span></p>
            {check.reviewedAt ? <p>ผู้ตรวจ: {check.reviewedByName || "—"} · {fmtDateTime(check.reviewedAt)}</p> : <p className="text-gray-500">ยังไม่มีผู้ตรวจ</p>}
            {check.reviewNote ? <p>บันทึก: {check.reviewNote}</p> : null}
          </div>
        )}
        <p className="mt-4 rounded-xl bg-brand-mist/60 px-3 py-2 text-xs text-gray-600">
          ผลตรวจนี้เป็นเครื่องมือช่วยคัดกรอง ไม่ใช่คำปรึกษาทางกฎหมาย การอนุมัติขั้นสุดท้ายเป็นของผู้ตรวจ
        </p>
      </Panel>
    </div>
  );
}
