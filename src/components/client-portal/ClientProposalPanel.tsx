"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Chip, Panel } from "@/components/ds";
import { diffWords } from "@/lib/client-proposal/diff";
import type { ProposalEdit, ProposalView } from "@/lib/client-proposal/constants";

/** แสดง diff ระดับคำ เป็น React text node ล้วน (ข้อความของลูกค้าไม่เคยเป็น HTML) */
export function DiffText({ before, after }: { before: string; after: string }) {
  const parts = diffWords(before, after);
  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-7 text-brand-navy">
      {parts.map((p, i) =>
        p.type === "del" ? (
          <del key={i} className="rounded bg-red-50 px-0.5 text-red-700 line-through">{p.text}</del>
        ) : p.type === "ins" ? (
          <ins key={i} className="rounded bg-emerald-50 px-0.5 text-emerald-700 no-underline">{p.text}</ins>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </p>
  );
}

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("th-TH", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function EditCard({ edit }: { edit: ProposalEdit }) {
  const [full, setFull] = useState(false);
  return (
    <div className="rounded-2xl border border-gray-200 bg-white/80 p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="min-w-0 truncate text-xs text-gray-500">
          {edit.section ? `ใต้หัวข้อ: ${edit.section}` : "ส่วนต้นบทความ"} · <span className="uppercase">{edit.tag}</span>
        </div>
        <button type="button" onClick={() => setFull((v) => !v)} className="shrink-0 text-xs font-medium text-brand-blue hover:underline">
          {full ? "ดู diff" : "ก่อน / หลัง"}
        </button>
      </div>
      {full ? (
        <div className="space-y-2 text-sm">
          <div><div className="text-[11px] font-semibold text-gray-400">ก่อน</div><p className="whitespace-pre-wrap break-words text-brand-navy">{edit.before}</p></div>
          <div><div className="text-[11px] font-semibold text-gray-400">หลัง</div><p className="whitespace-pre-wrap break-words text-brand-navy">{edit.after}</p></div>
        </div>
      ) : (
        <DiffText before={edit.before} after={edit.after} />
      )}
    </div>
  );
}

function ProposalBody({ p }: { p: ProposalView }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
        <span className="font-medium text-brand-navy">{p.author.name || "ลูกค้า"}</span>
        <span>{fmtDate(p.createdAt)}</span>
        <Chip tone="info">{p.edits.length} จุด</Chip>
      </div>
      {p.comment && <p className="whitespace-pre-wrap break-words rounded-xl bg-brand-mist p-3 text-sm text-brand-navy">{p.comment}</p>}
      <div className="space-y-2">{p.edits.map((e) => <EditCard key={e.i} edit={e} />)}</div>
    </div>
  );
}

/**
 * ฝั่งทีม: ข้อเสนอแก้ไขจากลูกค้าของบทความหนึ่งชิ้น — mount ใน SmeReviewTab (ไม่แสดงให้ role CLIENT, API ตอบ 403)
 * โหลดจาก GET /api/articles/<id>/client-proposal (สูงสุด 10 รายการล่าสุด); ไม่มีข้อเสนอ = ไม่ render อะไรเลย
 * ข้อเสนอที่ยัง pending แสดง diff รายจุด + ปุ่ม "ทำเครื่องหมายว่าแก้ตามแล้ว" (resolved) / "ไม่ปรับตาม" (dismissed)
 * ซึ่งยิง PATCH { proposalId, status } — เปลี่ยนแค่สถานะของข้อเสนอ ไม่แก้เนื้อหาบทความ; รายการที่เหลือพับอยู่ใน "ประวัติข้อเสนอ"
 */
export default function ClientProposalPanel({ articleId, className }: { articleId: string; className?: string }) {
  const [proposals, setProposals] = useState<ProposalView[]>([]);
  const [busy, setBusy] = useState(false);
  const [showOld, setShowOld] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/articles/${encodeURIComponent(articleId)}/client-proposal`);
      if (!res.ok) { setProposals([]); return; }
      const data = await res.json();
      setProposals(Array.isArray(data.proposals) ? data.proposals : []);
    } catch {
      setProposals([]);
    }
  }, [articleId]);

  useEffect(() => { void load(); }, [load]);

  const act = async (proposalId: string, status: "resolved" | "dismissed") => {
    setBusy(true);
    try {
      const res = await fetch(`/api/articles/${encodeURIComponent(articleId)}/client-proposal`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalId, status }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast.error(d?.error || "บันทึกไม่สำเร็จ");
        return;
      }
      toast.success("บันทึกแล้ว");
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (proposals.length === 0) return null;
  const current = proposals.find((p) => p.status === "pending") ?? null;
  const history = proposals.filter((p) => p !== current);

  return (
    <Panel title="ลูกค้าเสนอแก้ไข" subtitle="บทความจริงยังไม่ถูกแก้ ทีมต้องปรับเองในตัวแก้ไข" className={className}>
      <div className="space-y-4">
        {current && (
          <div className="space-y-3">
            <ProposalBody p={current} />
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => act(current.id, "resolved")} className="btn-primary disabled:opacity-50">ทำเครื่องหมายว่าแก้ตามแล้ว</button>
              <button type="button" disabled={busy} onClick={() => act(current.id, "dismissed")} className="btn-secondary disabled:opacity-50">ไม่ปรับตาม</button>
            </div>
          </div>
        )}
        {history.length > 0 && (
          <div>
            <button type="button" onClick={() => setShowOld((v) => !v)} className="text-sm font-medium text-brand-blue hover:underline">
              {showOld ? "ซ่อน" : "ดู"}ประวัติข้อเสนอ ({history.length})
            </button>
            {showOld && (
              <div className="mt-3 space-y-5">
                {history.map((p) => (
                  <div key={p.id} className="space-y-2 border-t border-gray-100 pt-3">
                    <Chip tone="muted">{p.status}</Chip>
                    <ProposalBody p={p} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
