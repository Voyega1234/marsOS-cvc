"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip, MeterBar, Panel } from "@/components/ds";
import type {
  ProfileDTO, RunDetailRes, RunDTO, RunEstimateDTO, RunListRes, RunStatus, RunStepRes,
} from "@/lib/brand-radar/types";
import { ProviderLogo } from "./ProviderLogo";
import { api, fmtDateTime, fmtUsd, postJson } from "./shared";

const STATUS_TONE: Record<RunStatus, "ok" | "warn" | "bad" | "info" | "muted"> = {
  RUNNING: "info", COMPLETED: "ok", PARTIAL: "warn", FAILED: "bad", CANCELLED: "muted",
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const MAX_FAILS = 5;

type Failures = RunDetailRes["failures"];

/**
 * Scan controls. The component also drives the scan loop, so it stays mounted on every tab:
 * `compact` (the report tabs) renders nothing, the full panel is shown in Settings only.
 */
export default function RunPanel({ projectId, profile, refreshKey, dueRun, onProgress, compact = false, autoScan = false, onOpenSettings }: {
  projectId: string;
  profile: ProfileDTO | null;
  refreshKey: number;
  dueRun: RunDTO | null;
  onProgress: () => void;
  compact?: boolean;
  /** the project's "automatic scanning" switch is on: the server keeps a scan going after this page is closed */
  autoScan?: boolean;
  onOpenSettings?: () => void;
}) {
  const [run, setRun] = useState<RunDTO | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [estimate, setEstimate] = useState<RunEstimateDTO | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState("");
  const [stalled, setStalled] = useState(false);
  const [showFailures, setShowFailures] = useState(false);
  const [failures, setFailures] = useState<Failures | null>(null);
  const [failLoading, setFailLoading] = useState(false);

  const loopToken = useRef(0);
  const projectRef = useRef(projectId);
  projectRef.current = projectId;
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;

  const stopLoop = useCallback(() => { loopToken.current += 1; }, []);

  const startLoop = useCallback((first: RunDTO) => {
    loopToken.current += 1;
    const token = loopToken.current;
    const pid = projectRef.current;
    setRun(first);
    setStalled(false);
    setError("");
    void (async () => {
      let current = first;
      let steps = 0;
      let fails = 0;
      while (token === loopToken.current) {
        const res = await api<RunStepRes>(`/api/brand-radar/runs/${current.id}/step`, postJson({ projectId: pid }));
        if (token !== loopToken.current) return;
        if (!res.ok || !res.data.run) {
          fails += 1;
          if (fails >= MAX_FAILS) {
            setError(res.data.error || "สแกนต่อไม่สำเร็จ");
            setStalled(true);
            return;
          }
          await sleep(2000 * 2 ** (fails - 1));
          continue;
        }
        fails = 0;
        current = res.data.run;
        setRun(current);
        steps += 1;
        if (res.data.done || current.status !== "RUNNING") {
          onProgressRef.current();
          return;
        }
        if (steps % 3 === 0) onProgressRef.current();
        await sleep(300);
      }
    })();
  }, []);

  // load newest run on mount / project change; resume if RUNNING
  useEffect(() => {
    stopLoop();
    setRun(null);
    setLoaded(false);
    setEstimate(null);
    setError("");
    setStalled(false);
    setShowFailures(false);
    setFailures(null);
    let cancelled = false;
    void (async () => {
      const res = await api<RunListRes>(`/api/brand-radar/runs?projectId=${encodeURIComponent(projectId)}&pageSize=1`);
      if (cancelled) return;
      const newest = res.ok && Array.isArray(res.data.runs) ? res.data.runs[0] ?? null : null;
      setLoaded(true);
      if (newest) {
        setRun(newest);
        if (newest.status === "RUNNING") startLoop(newest);
      } else if (!res.ok) {
        setError(res.data.error || "โหลดประวัติการสแกนไม่สำเร็จ");
      }
    })();
    return () => { cancelled = true; stopLoop(); };
  }, [projectId, startLoop, stopLoop]);

  // run handed over by the "due" check
  useEffect(() => {
    if (dueRun && dueRun.status === "RUNNING" && dueRun.projectId === projectId) startLoop(dueRun);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dueRun?.id]);

  // reload last run when settings/prompts changed but nothing is running
  useEffect(() => {
    if (refreshKey === 0) return;
    if (run?.status === "RUNNING") return;
    let cancelled = false;
    void (async () => {
      const res = await api<RunListRes>(`/api/brand-radar/runs?projectId=${encodeURIComponent(projectId)}&pageSize=1`);
      if (cancelled || !res.ok) return;
      const newest = res.data.runs?.[0];
      if (newest && loopToken.current >= 0) setRun((cur) => (cur?.status === "RUNNING" ? cur : newest));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  async function askEstimate() {
    setError("");
    setEstimating(true);
    const res = await api<RunEstimateDTO>("/api/brand-radar/runs/estimate", postJson({ projectId }));
    setEstimating(false);
    if (!res.ok) { setError(res.data.error || "ประเมินการสแกนไม่สำเร็จ"); return; }
    setEstimate(res.data);
  }

  async function start() {
    setError("");
    setStarting(true);
    const res = await api<{ run: RunDTO }>("/api/brand-radar/runs", postJson({ projectId }));
    setStarting(false);
    if (res.ok && res.data.run) {
      setEstimate(null);
      setShowFailures(false);
      setFailures(null);
      startLoop(res.data.run);
      onProgressRef.current();
      return;
    }
    if (res.status === 409 && res.data.run) {
      setEstimate(null);
      startLoop(res.data.run);
      return;
    }
    setError(res.data.error || "เริ่มสแกนไม่สำเร็จ");
  }

  async function cancel() {
    if (!run) return;
    setCancelling(true);
    stopLoop();
    const res = await api<{ run: RunDTO }>(`/api/brand-radar/runs/${run.id}/cancel`, postJson({ projectId }));
    setCancelling(false);
    if (res.ok && res.data.run) {
      setRun(res.data.run);
      setStalled(false);
      onProgressRef.current();
    } else {
      setError(res.data.error || "ยกเลิกไม่สำเร็จ");
      setStalled(true);
    }
  }

  async function toggleFailures() {
    if (showFailures) { setShowFailures(false); return; }
    setShowFailures(true);
    if (!run) return;
    setFailLoading(true);
    const res = await api<RunDetailRes>(`/api/brand-radar/runs/${run.id}?projectId=${encodeURIComponent(projectId)}`);
    setFailLoading(false);
    setFailures(res.ok && Array.isArray(res.data.failures) ? res.data.failures : []);
    if (!res.ok) setError(res.data.error || "โหลดรายการที่ล้มเหลวไม่สำเร็จ");
  }

  const running = run?.status === "RUNNING";
  const finished = run && !running;
  const settled = run ? run.doneTasks + run.failedTasks + run.skippedTasks : 0;
  const pct = run && run.totalTasks > 0 ? Math.min(100, (settled / run.totalTasks) * 100) : 0;

  // Outside Settings nothing is shown: the hooks above keep the scan loop and onProgress running.
  if (compact) return null;

  return (
    <Panel
      className="mb-4"
      title="Scan"
      subtitle={autoScan
        ? "เปิดสแกนอัตโนมัติอยู่ — ปิดหน้านี้ได้ ระบบสแกนต่อเองทุกประมาณ 10 นาที (เปิดหน้าค้างไว้จะเสร็จเร็วกว่า)"
        : "สแกนจะทำงานตราบใดที่หน้านี้เปิดอยู่ ถ้าปิดหน้าไป จะทำต่อเมื่อมีคนเปิด Brand Radar ครั้งถัดไป"}
      actions={
        !running ? (
          <Button size="sm" onClick={askEstimate} disabled={estimating || !profile || !loaded}
            title={!profile ? "ตั้งค่าแบรนด์ก่อน" : undefined}>
            {estimating ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Play className="mr-1.5 h-4 w-4" />}
            Run scan now
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={cancel} disabled={cancelling}>
            {cancelling ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Square className="mr-1.5 h-4 w-4" />}
            ยกเลิกสแกน
          </Button>
        )
      }
    >
      {error && (
        <div role="alert" className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
          {stalled && running && (
            <div className="mt-2">
              <Button size="sm" variant="outline" onClick={() => run && startLoop(run)}>ทำต่อ</Button>
            </div>
          )}
        </div>
      )}

      {!loaded ? (
        <div className="h-10 animate-pulse rounded-xl bg-gray-100" />
      ) : running && run ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Chip tone="info" dot>{stalled ? "หยุดชั่วคราว" : "กำลังสแกน"}</Chip>
            <span className="text-gray-600 tabular-nums">{settled} / {run.totalTasks} งาน</span>
            <span className="text-gray-400">·</span>
            <span className="text-gray-600">ค่าใช้จ่ายถึงตอนนี้ {fmtUsd(run.costUsd)}</span>
          </div>
          <MeterBar value={pct} max={100} tone="blue" ariaLabel="ความคืบหน้าการสแกน" />
          <p className="text-xs text-gray-500">
            สำเร็จ {run.doneTasks} · ล้มเหลว {run.failedTasks} · ข้าม {run.skippedTasks} · เริ่ม {fmtDateTime(run.startedAt)}
          </p>
          <p className="text-xs text-gray-500">{autoScan ? "ปิดหน้านี้ได้ ระบบสแกนต่อเองทุกประมาณ 10 นาที" : "กรุณาเปิดหน้านี้ไว้จนสแกนเสร็จ"}</p>
        </div>
      ) : finished && run ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Chip tone={STATUS_TONE[run.status]}>{run.status}</Chip>
            <span className="text-gray-600">สแกนล่าสุด {fmtDateTime(run.finishedAt ?? run.startedAt)}</span>
            <span className="text-gray-400">·</span>
            <span className="text-gray-600">
              สำเร็จ {run.doneTasks} / ล้มเหลว {run.failedTasks} / ข้าม {run.skippedTasks} จาก {run.totalTasks} งาน
            </span>
            <span className="text-gray-400">·</span>
            <span className="text-gray-600">ค่าใช้จ่ายจริง {fmtUsd(run.costUsd)}</span>
          </div>
          {run.error && <p className="text-xs text-red-600">{run.error}</p>}
          {(run.failedTasks > 0 || run.skippedTasks > 0) && (
            <div>
              <button type="button" onClick={toggleFailures} className="text-xs font-medium text-brand-blue hover:underline">
                {showFailures ? "ซ่อนรายการที่ล้มเหลว" : "ดูรายการที่ล้มเหลว"}
              </button>
              {showFailures && (
                <div className="mt-2 max-h-64 overflow-y-auto rounded-2xl border border-gray-100 bg-gray-50 p-3 text-xs">
                  {failLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                  ) : failures && failures.length > 0 ? (
                    <ul className="space-y-2">
                      {failures.map((f, i) => (
                        <li key={i}>
                          <div className="font-medium text-gray-700">{f.promptText}</div>
                          <div className="flex flex-wrap items-center gap-1.5 text-gray-500"><ProviderLogo provider={f.provider} size={16} /> · {f.status}{f.error ? ` · ${f.error}` : ""}</div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-gray-500">ไม่มีรายการ</span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-gray-500">
          {profile ? "ยังไม่เคยสแกน กด Run scan now เพื่อเริ่มสแกนครั้งแรก" : "ตั้งค่าแบรนด์ก่อน จึงจะสแกนได้"}
        </p>
      )}

      {estimate && !running && (
        <div className="mt-3 space-y-2 rounded-2xl border border-gray-100 bg-gray-50 p-3 text-sm">
          <div className="font-medium text-brand-navy">ยืนยันการสแกน</div>
          <div className="text-gray-700">
            {estimate.prompts} prompts × {estimate.providers.length} AI platforms × {estimate.samplesPerPrompt} รอบ = <b>{estimate.tasks}</b> งาน
            {estimate.samplesPerPrompt > 1 && estimate.perProvider.some((p) => p.samples === 1) && (
              <span className="ml-1 text-xs text-gray-500">(Google AI Mode / AI Overview ถาม 1 รอบ)</span>
            )}
          </div>
          <div className="text-gray-700">
            ค่าใช้จ่ายโดยประมาณ:{" "}
            {estimate.estimatedCostUsd === null
              ? "ยังประเมินไม่ได้ เพราะยังไม่เคยสแกน (ค่าใช้จริงจะแสดงหลังสแกน)"
              : fmtUsd(estimate.estimatedCostUsd)}
          </div>
          <div className="text-gray-700">
            ใช้ไปเดือนนี้ {fmtUsd(estimate.monthSpendUsd)} / งบ{" "}
            {estimate.monthlyBudgetUsd === null ? "ไม่จำกัด" : fmtUsd(estimate.monthlyBudgetUsd)}
          </div>
          {!estimate.allowed && estimate.reason && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-2 text-red-700">{estimate.reason}</div>
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={start} disabled={!estimate.allowed || starting}>
              {starting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              เริ่มสแกน
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEstimate(null)}>ยกเลิก</Button>
          </div>
        </div>
      )}
    </Panel>
  );
}
