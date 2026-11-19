"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ds";
import { PROVIDERS, type ProviderKey, type ProviderStatusDTO } from "@/lib/brand-radar/types";
import { SCRAPER_ASK_PRICE_USD, compare, planBatches, summarize, type AskResult, type EntityRow, type RateKey } from "@/lib/brand-radar/sample-test";
import { ProviderLogo } from "./ProviderLogo";
import { api, fmtUsd, postJson, providerShort } from "./shared";

const inputCls =
  "h-10 w-full rounded-xl border border-input bg-white/90 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";
const labelCls = "mb-1 block text-xs font-medium text-gray-600";
const helpCls = "mt-1 text-xs text-gray-500";

const COUNT_OPTIONS = [3, 5, 10, 20, 30];
const BATCH = 5;
const pct = (v: number | null) => (v === null ? "-" : `${Math.round(v * 100)}%`);
const pp = (v: number | null) => (v === null ? "-" : `${v > 0 ? "+" : ""}${Math.round(v)} pp`);

const ROW_LABEL: Record<RateKey, string> = {
  mention: "แบรนด์เราถูกพูดถึง",
  recommend: "ถูกแนะนำ",
  ownCited: "เว็บเราถูกอ้างอิง",
};

function NoiseChip({ noise }: { noise: boolean | null }) {
  if (noise === null) return null;
  return noise ? <Chip tone="muted">คลาดเคลื่อนปกติ</Chip> : <Chip tone="warn">ต่างจริง</Chip>;
}

function EntityList({ title, rows }: { title: string; rows: EntityRow[] }) {
  return (
    <div className="min-w-0">
      <h4 className="mb-2 text-sm font-medium text-gray-800">{title}</h4>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-500">ไม่พบ</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.name} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-gray-100 px-3 py-2 text-sm">
              <span className="min-w-0 break-all text-gray-800">{r.name}</span>
              <span className="flex flex-wrap items-center gap-1.5 text-xs text-gray-600">
                {r.onlyIn && <Chip tone="info">{r.onlyIn === "A" ? "เจอเฉพาะชุด A" : "เจอเฉพาะชุด B"}</Chip>}
                <span>A {pct(r.a)}</span>
                <span>B {pct(r.b)}</span>
                <span className="font-medium">{pp(r.diffPp)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AnswerList({ title, items }: { title: string; items: AskResult[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-w-0 rounded-2xl border border-gray-100">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
        className="flex min-h-10 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium text-brand-navy">
        <span>{title} ({items.length})</span>
        <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <ul className="space-y-2 border-t border-gray-100 p-3">
          {items.map((a, i) => (
            <li key={i} className="rounded-xl border border-gray-100 p-2">
              <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                <span>#{i + 1}</span>
                {a.ok ? (a.brandMentioned ? <Chip tone="ok">พูดถึงแบรนด์เรา</Chip> : <Chip tone="muted">ไม่พูดถึงแบรนด์เรา</Chip>) : <Chip tone="bad">ไม่สำเร็จ</Chip>}
              </div>
              <div className="whitespace-pre-wrap break-words text-sm text-gray-800">{a.ok ? a.answer : a.error}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SampleSizeTest({ projectId, providers, disabled }: { projectId: string; providers: ProviderStatusDTO[]; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState<ProviderKey | "">("");
  const [countA, setCountA] = useState(10);
  const [countB, setCountB] = useState(20);
  const [setA, setSetA] = useState<AskResult[]>([]);
  const [setB, setSetB] = useState<AskResult[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const stopRef = useRef(false);
  const runningRef = useRef(false);
  const mounted = useRef(true);
  const runId = useRef(0);

  // Only connected platforms that can be asked more than once make sense here.
  const options = providers.filter((p) => p.connection !== "NOT_CONNECTED" && p.method !== "observed_serp");
  const selected = options.find((p) => p.key === provider) ?? options[0];

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; stopRef.current = true; };
  }, []);

  // A new client means a new test: drop the old results and stop anything still running.
  useEffect(() => {
    stopRef.current = true;
    runId.current += 1;
    setSetA([]); setSetB([]); setError(""); setRunning(false); runningRef.current = false;
  }, [projectId]);

  const total = countA + countB;
  const viaDfs = selected ? PROVIDERS[selected.key].via === "dataforseo" : false;
  const minutes = Math.ceil((planBatches(countA, countB, BATCH).length * 30) / 60);
  const askedSoFar = setA.length + setB.length;
  const runningCost = [...setA, ...setB].reduce((s, a) => s + (a.costUsd || 0), 0);
  const sameCount = countA === countB;
  const canRun = !disabled && !running && !!selected && prompt.trim().length >= 3 && !sameCount;

  async function run() {
    if (runningRef.current || !selected) return;
    runningRef.current = true;
    const myRun = ++runId.current;
    stopRef.current = false;
    setRunning(true); setError(""); setSetA([]); setSetB([]);
    for (const b of planBatches(countA, countB, BATCH)) {
      if (stopRef.current || !mounted.current || runId.current !== myRun) break;
      const res = await api<{ results: AskResult[] }>(
        "/api/brand-radar/providers/sample-test",
        postJson({ projectId, provider: selected.key, prompt: prompt.trim(), asks: b.asks }),
      );
      if (!mounted.current || runId.current !== myRun) return;
      if (!res.ok || !Array.isArray(res.data.results)) {
        setError(res.data.error || "ทดสอบไม่สำเร็จ");
        break;
      }
      (b.set === "A" ? setSetA : setSetB)((prev) => [...prev, ...res.data.results]);
    }
    if (mounted.current && runId.current === myRun) setRunning(false);
    if (runId.current === myRun) runningRef.current = false;
  }

  const sumA = summarize(setA);
  const sumB = summarize(setB);
  const showResult = sumA.answered >= 1 && sumB.answered >= 1;
  const cmp = showResult ? compare(sumA, sumB) : null;

  const verdictText = cmp
    ? cmp.verdict === "no_clear_difference"
      ? `ยังไม่เห็นความต่างที่ชัดเจนระหว่าง ${countA} รอบกับ ${countB} รอบ (ผลต่างอยู่ในช่วงคลาดเคลื่อนปกติ)`
      : cmp.verdict === "different"
        ? `ผลของ ${countA} รอบกับ ${countB} รอบต่างกันเกินช่วงคลาดเคลื่อน ควรใช้จำนวนรอบที่มากกว่า`
        : "ข้อมูลยังไม่พอเปรียบเทียบ"
    : "";

  return (
    <div className="rounded-2xl border border-gray-100">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
        className="flex min-h-10 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium text-brand-navy">
        <span>ทดสอบว่าถามกี่รอบถึงพอ</span>
        <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="space-y-4 border-t border-gray-100 p-3">
          <p className="text-xs text-gray-500">ถามคำถามเดียวกัน 2 ชุดด้วยจำนวนรอบต่างกัน แล้วเทียบผลให้เห็นว่าต่างกันไหม ใช้ตัดสินใจว่าควรตั้งกี่รอบ</p>
          {disabled && <p className="text-xs text-amber-700">บันทึกการตั้งค่าของลูกค้ารายนี้ก่อน จึงจะทดสอบได้</p>}

          <div className="min-w-0">
            <label className={labelCls}>คำถาม (prompt)</label>
            <textarea className="min-h-[88px] w-full rounded-xl border border-input bg-white/90 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              maxLength={2000} value={prompt} disabled={disabled || running} onChange={(e) => setPrompt(e.target.value)} />
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="min-w-0">
              <label className={labelCls}>Platform</label>
              {options.length === 0 ? (
                <p className="text-sm text-gray-500">ยังไม่มี platform ที่เชื่อมต่อ</p>
              ) : (
                <div className="flex items-center gap-2">
                  {selected && <ProviderLogo provider={selected.key} />}
                  <select className={inputCls} value={selected?.key ?? ""} disabled={disabled || running}
                    onChange={(e) => setProvider(e.target.value as ProviderKey)}>
                    {options.map((p) => <option key={p.key} value={p.key}>{providerShort(p.key)}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="min-w-0">
              <label className={labelCls}>ชุด A</label>
              <select className={inputCls} value={countA} disabled={disabled || running} onChange={(e) => setCountA(Number(e.target.value))}>
                {COUNT_OPTIONS.map((n) => <option key={n} value={n}>{n} รอบ</option>)}
              </select>
            </div>
            <div className="min-w-0">
              <label className={labelCls}>ชุด B</label>
              <select className={inputCls} value={countB} disabled={disabled || running} onChange={(e) => setCountB(Number(e.target.value))}>
                {COUNT_OPTIONS.map((n) => <option key={n} value={n}>{n} รอบ</option>)}
              </select>
            </div>
          </div>
          {sameCount && <p className={helpCls}>เลือกจำนวนรอบของสองชุดให้ต่างกัน</p>}

          <div className="space-y-1 rounded-xl bg-gray-50 p-3 text-sm text-gray-700">
            <p>จะถามทั้งหมด {total} ครั้ง</p>
            <p>{viaDfs ? `ประมาณ ${fmtUsd(total * SCRAPER_ASK_PRICE_USD)} และใช้เวลาราว ${minutes} นาที` : "ค่าใช้จ่ายจริงจะแสดงระหว่างทดสอบ"}</p>
            <p className="text-xs text-gray-500">ผลทดสอบไม่ถูกบันทึกในรายงาน และไม่นับในงบรายเดือนของ Brand Radar ค่าใช้จ่ายดูได้ที่หน้า AI Cost</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button className="min-h-10" disabled={!canRun} onClick={() => void run()}>
              {running && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              เริ่มทดสอบ
            </Button>
            {running && (
              <>
                <Button variant="outline" className="min-h-10" onClick={() => { stopRef.current = true; }}>หยุด</Button>
                <span className="text-xs text-gray-500">รอบที่ส่งไปแล้วจะทำงานจนจบและคิดค่าใช้จ่ายตามจริง</span>
              </>
            )}
          </div>

          {(running || askedSoFar > 0) && (
            <p className="text-sm text-gray-700">ถามแล้ว {askedSoFar} / {total} ครั้ง · ค่าใช้จ่ายสะสม {fmtUsd(runningCost)}</p>
          )}
          {error && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

          {cmp && (
            <div className="space-y-4">
              <div className={`rounded-2xl border p-3 text-sm ${cmp.verdict === "different" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-gray-100 bg-gray-50 text-gray-800"}`}>
                {verdictText}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs text-gray-500">
                      <th className="py-2 pr-3 font-medium" />
                      <th className="px-3 py-2 font-medium">ชุด A ({countA} รอบ)</th>
                      <th className="px-3 py-2 font-medium">ชุด B ({countB} รอบ)</th>
                      <th className="px-3 py-2 font-medium">ส่วนต่าง</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    <tr>
                      <td className="py-2 pr-3 text-gray-700">ตอบสำเร็จ</td>
                      <td className="px-3 py-2">{sumA.answered}/{sumA.asked}</td>
                      <td className="px-3 py-2">{sumB.answered}/{sumB.asked}</td>
                      <td className="px-3 py-2" />
                    </tr>
                    {cmp.rows.map((r) => (
                      <tr key={r.key}>
                        <td className="py-2 pr-3 text-gray-700">{ROW_LABEL[r.key]}</td>
                        <td className="px-3 py-2">{pct(r.a)}{r.key === "mention" && sumA.marginPp !== null ? ` ± ${Math.round(sumA.marginPp)}` : ""}</td>
                        <td className="px-3 py-2">{pct(r.b)}{r.key === "mention" && sumB.marginPp !== null ? ` ± ${Math.round(sumB.marginPp)}` : ""}</td>
                        <td className="px-3 py-2"><span className="mr-1.5">{pp(r.diffPp)}</span><NoiseChip noise={r.likelyNoise} /></td>
                      </tr>
                    ))}
                    <tr>
                      <td className="py-2 pr-3 text-gray-700">ตำแหน่งเฉลี่ยในคำตอบ</td>
                      <td className="px-3 py-2">{pct(sumA.avgPositionPct)}</td>
                      <td className="px-3 py-2">{pct(sumB.avgPositionPct)}</td>
                      <td className="px-3 py-2" />
                    </tr>
                    <tr>
                      <td className="py-2 pr-3 text-gray-700">ค่าใช้จ่าย</td>
                      <td className="px-3 py-2">{fmtUsd(sumA.costUsd)}</td>
                      <td className="px-3 py-2">{fmtUsd(sumB.costUsd)}</td>
                      <td className="px-3 py-2" />
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <EntityList title="แบรนด์ที่ AI พูดถึง" rows={cmp.competitors} />
                <EntityList title="เว็บที่ AI อ้างอิง" rows={cmp.domains} />
              </div>
            </div>
          )}

          {(setA.length > 0 || setB.length > 0) && (
            <div>
              <h4 className="mb-2 text-sm font-medium text-gray-800">ดูคำตอบทั้งหมด</h4>
              <div className="grid gap-3 md:grid-cols-2">
                <AnswerList title="ชุด A" items={setA} />
                <AnswerList title="ชุด B" items={setB} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
