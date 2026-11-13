"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Panel, Segmented, SearchPill, EmptyState } from "@/components/ds";
import { api, fmtDateTime, type CheckFull, type IndustryOpt } from "./shared";
import CheckResult from "./CheckResult";

type Source = "sme" | "upload" | "manual";
interface ArticleOpt { id: string; title: string; ownerLabel: string; status: string; updatedAt: string }

export default function CheckTab({ industries, userRole, onGoRules }: {
  industries: IndustryOpt[];
  userRole: string;
  onGoRules: () => void;
}) {
  const [industry, setIndustry] = useState("");
  const [source, setSource] = useState<Source>("sme");
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<ArticleOpt[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [picked, setPicked] = useState<ArticleOpt | null>(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [useAi, setUseAi] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CheckFull | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!industry && industries.length) {
      const firstActive = industries.find((i) => i.active > 0) ?? industries[0];
      setIndustry(firstActive.key);
    }
  }, [industries, industry]);

  // ค้นหาบทความแบบ debounce
  useEffect(() => {
    if (source === "manual") return;
    const my = ++seq.current;
    setLoadingList(true);
    const t = setTimeout(async () => {
      const { ok, data } = await api<{ articles: ArticleOpt[] }>(
        `/api/compliance/articles?source=${source}&q=${encodeURIComponent(q.trim())}`,
      );
      if (my !== seq.current) return;
      setOptions(ok && Array.isArray(data.articles) ? data.articles : []);
      setLoadingList(false);
    }, 300);
    return () => clearTimeout(t);
  }, [source, q]);

  const cur = industries.find((i) => i.key === industry);
  const noRules = !!industry && !!cur && cur.active === 0;
  const canRun = !!industry && !running && (source === "manual" ? text.trim().length >= 20 : !!picked);

  async function run() {
    setRunning(true);
    setResult(null);
    const { ok, data } = await api<{ check: CheckFull }>("/api/compliance/checks", {
      method: "POST",
      body: JSON.stringify({
        industry, source, useAi,
        ...(source === "manual" ? { title, text } : { articleId: picked?.id }),
      }),
    });
    setRunning(false);
    if (!ok || !data.check) {
      toast.error(data.error || "ตรวจบทความไม่สำเร็จ");
      return;
    }
    setResult(data.check);
    if (data.check.aiError) toast.warning(`AI ตรวจบริบทไม่สำเร็จ ใช้ผลจากกฎอย่างเดียว: ${data.check.aiError}`);
    else toast.success("ตรวจเสร็จแล้ว");
  }

  return (
    <div className="space-y-4">
      <Panel title="ตั้งค่าการตรวจ" subtitle="เลือกอุตสาหกรรมและแหล่งบทความที่ต้องการตรวจ">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cmp-industry">อุตสาหกรรม</Label>
            <select
              id="cmp-industry"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              className="h-10 w-full rounded-full border border-gray-200 bg-white px-3 text-sm sm:max-w-sm"
            >
              {industries.map((i) => (
                <option key={i.key} value={i.key}>{i.label} (กฎที่เปิดใช้ {i.active})</option>
              ))}
            </select>
            {noRules && (
              <p className="flex flex-wrap items-center gap-1.5 text-xs text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5" />
                ยังไม่มีกฎที่เปิดใช้สำหรับอุตสาหกรรมนี้ —
                <button type="button" onClick={onGoRules} className="text-brand-blue underline">ไปที่คลังกฎ</button>
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>แหล่งบทความ</Label>
            <div>
              <Segmented<Source>
                value={source}
                onChange={(v) => { setSource(v); setPicked(null); setQ(""); setOptions([]); }}
                options={[
                  { value: "sme", label: "บทความ SME" },
                  { value: "upload", label: "Upload Article" },
                  { value: "manual", label: "วางข้อความ" },
                ]}
              />
            </div>
          </div>

          {source === "manual" ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="cmp-title">ชื่อเรื่อง (ไม่บังคับ)</Label>
                <Input id="cmp-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cmp-text">เนื้อหาบทความ</Label>
                <Textarea id="cmp-text" rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder="วางข้อความบทความที่ต้องการตรวจ (อย่างน้อย 20 ตัวอักษร)" />
                <p className="text-[11px] text-gray-400">{text.length.toLocaleString()} / 200,000 ตัวอักษร</p>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <SearchPill value={q} onChange={setQ} placeholder="ค้นหาชื่อบทความ" className="w-full sm:max-w-sm" />
              {picked && (
                <p className="text-sm text-brand-navy">เลือกแล้ว: <span className="font-semibold">{picked.title}</span></p>
              )}
              <div className="max-h-64 overflow-y-auto rounded-2xl border border-gray-100 bg-white/70">
                {loadingList ? (
                  <div className="flex items-center gap-2 p-4 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลด...</div>
                ) : options.length === 0 ? (
                  <EmptyState title="ไม่พบบทความ" className="py-6" />
                ) : (
                  <ul className="divide-y divide-gray-50">
                    {options.map((o) => (
                      <li key={o.id}>
                        <button
                          type="button"
                          onClick={() => setPicked(o)}
                          className={`flex w-full flex-col gap-0.5 px-4 py-2.5 text-left hover:bg-brand-mist/70 ${picked?.id === o.id ? "bg-brand-mist" : ""}`}
                        >
                          <span className="text-sm font-medium text-brand-navy">{o.title || "(ไม่มีชื่อ)"}</span>
                          <span className="text-[11px] text-gray-500">{o.ownerLabel || "—"} · {o.status} · {fmtDateTime(o.updatedAt)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <Switch checked={useAi} onCheckedChange={setUseAi} aria-label="ใช้ AI ตรวจบริบท" />
              ใช้ AI ตรวจบริบท
            </label>
            <Button onClick={run} disabled={!canRun}>
              {running ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-1.5 h-4 w-4" />}
              {running ? "กำลังตรวจ..." : "ตรวจบทความ"}
            </Button>
          </div>
        </div>
      </Panel>

      {result && <CheckResult check={result} userRole={userRole} onChange={setResult} />}
    </div>
  );
}
