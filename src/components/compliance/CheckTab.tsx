"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, FileText, Loader2, ShieldCheck, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Panel, Segmented, SearchPill, EmptyState } from "@/components/ds";
import { BRAND_UNAVAILABLE_MESSAGE, type BrandSummary } from "@/lib/compliance/brand";
import { api, fmtDateTime, type CheckFull, type IndustryOpt } from "./shared";
import CheckResult from "./CheckResult";

type Mode = "industry" | "brand";
type Source = "sme" | "upload" | "manual" | "file";
interface ArticleOpt { id: string; title: string; ownerLabel: string; status: string; updatedAt: string }

const TEXT_MAX = 200_000;
const TEXT_MIN = 20;
const WORD_FILE_MAX_BYTES = 25 * 1024 * 1024;

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

/** อ่านข้อความจากไฟล์ Word ในเบราว์เซอร์ — ไฟล์ไม่ถูกส่งขึ้นเซิร์ฟเวอร์ ส่งเฉพาะข้อความที่อ่านได้ */
async function readWordText(file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (file.size > WORD_FILE_MAX_BYTES) throw new Error("ไฟล์ใหญ่เกิน 25 MB");
  if (ext === "docx") {
    const { readDocxBodyText } = await import("@/lib/compliance/docx-suggest-client");
    return readDocxBodyText(file);
  }
  if (ext === "doc") {
    const { readLegacyDocText } = await import("@/lib/doc-legacy");
    return readLegacyDocText(new Uint8Array(await file.arrayBuffer()));
  }
  throw new Error("รองรับเฉพาะไฟล์ .docx และ .doc");
}

export default function CheckTab({ industries, userRole, onGoRules, onGoBrand }: {
  industries: IndustryOpt[];
  userRole: string;
  onGoRules: () => void;
  onGoBrand?: () => void;
}) {
  const [mode, setMode] = useState<Mode>("industry");
  const [industry, setIndustry] = useState("");
  const [brands, setBrands] = useState<BrandSummary[]>([]);
  const [brandsState, setBrandsState] = useState<"idle" | "loading" | "ready" | "unavailable" | "error">("idle");
  const [brandId, setBrandId] = useState("");
  const [source, setSource] = useState<Source>("sme");
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<ArticleOpt[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [picked, setPicked] = useState<ArticleOpt | null>(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileText, setFileText] = useState("");
  const [fileBusy, setFileBusy] = useState(false);
  const [fileError, setFileError] = useState("");
  const [useAi, setUseAi] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CheckFull | null>(null);
  // ไฟล์ .docx ที่ใช้ตรวจรอบที่แสดงผลอยู่ — ส่งต่อให้ปุ่ม export ใส่คำแนะนำกลับลงไฟล์เดิม
  const [resultFile, setResultFile] = useState<File | null>(null);
  const seq = useRef(0);
  const fileSeq = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!industry && industries.length) {
      const firstActive = industries.find((i) => i.active > 0) ?? industries[0];
      setIndustry(firstActive.key);
    }
  }, [industries, industry]);

  // โหลดรายการแบรนด์ครั้งแรกที่สลับมาโหมด Brand Rule
  useEffect(() => {
    if (mode !== "brand" || brandsState !== "idle") return;
    setBrandsState("loading");
    void (async () => {
      const { ok, data } = await api<{ brands: BrandSummary[]; unavailable?: boolean }>("/api/compliance/brands");
      if (data.unavailable) { setBrandsState("unavailable"); return; }
      if (!ok || !Array.isArray(data.brands)) {
        toast.error(data.error || "โหลดรายการแบรนด์ไม่สำเร็จ");
        setBrandsState("error");
        return;
      }
      const active = data.brands.filter((b) => b.status === "ACTIVE");
      setBrands(active);
      setBrandsState("ready");
      setBrandId((cur) => cur || active[0]?.id || "");
    })();
  }, [mode, brandsState]);

  // เลือกบทความแล้ว ถ้าชื่อลูกค้าตรงกับแบรนด์ ให้เลือกแบรนด์นั้นให้เลย (เปลี่ยนเองได้)
  useEffect(() => {
    if (mode !== "brand" || !picked?.ownerLabel) return;
    const want = picked.ownerLabel.trim().toLowerCase();
    const hit = brands.find((b) => b.name.trim().toLowerCase() === want);
    if (hit) setBrandId(hit.id);
  }, [picked, brands, mode]);

  // ค้นหาบทความแบบ debounce
  useEffect(() => {
    if (source === "manual" || source === "file") return;
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

  async function chooseFile(f: File | null) {
    const my = ++fileSeq.current;
    setFile(f);
    setFileText("");
    setFileError("");
    if (!f) return;
    setFileBusy(true);
    try {
      const t = (await readWordText(f)).trim();
      if (my !== fileSeq.current) return;
      if (t.length < TEXT_MIN) setFileError("อ่านข้อความจากไฟล์ได้น้อยเกินไป (ไฟล์อาจเป็นรูปสแกนหรือไม่มีเนื้อหา)");
      else if (t.length > TEXT_MAX) setFileError(`เนื้อหาในไฟล์ยาว ${t.length.toLocaleString("en-US")} ตัวอักษร เกินเพดาน ${TEXT_MAX.toLocaleString("en-US")} — แบ่งไฟล์ก่อนตรวจ`);
      else setFileText(t);
    } catch (e) {
      if (my !== fileSeq.current) return;
      setFileError(e instanceof Error ? e.message : "อ่านไฟล์ไม่สำเร็จ");
    } finally {
      if (my === fileSeq.current) setFileBusy(false);
    }
  }

  const cur = industries.find((i) => i.key === industry);
  const noRules = mode === "industry" && !!industry && !!cur && cur.active === 0;
  const curBrand = brands.find((b) => b.id === brandId);
  const brandEmpty = !!curBrand && curBrand.ruleCount === 0 && curBrand.voiceChars === 0 && curBrand.fileCount === 0;
  const scopeReady = mode === "industry" ? !!industry : brandsState === "ready" && !!brandId;
  const contentReady = source === "manual"
    ? text.trim().length >= TEXT_MIN
    : source === "file" ? !!file && !fileBusy && fileText.length >= TEXT_MIN : !!picked;
  const canRun = scopeReady && contentReady && !running;

  async function run() {
    setRunning(true);
    setResult(null);
    setResultFile(null);
    const usedFile = source === "file" ? file : null;
    const content = source === "manual"
      ? { source: "manual", title, text }
      : source === "file"
        ? { source: "manual", title: usedFile ? stripExt(usedFile.name) : "", text: fileText }
        : { source, articleId: picked?.id };
    const { ok, data } = await api<{ check: CheckFull; notes?: string[] }>("/api/compliance/checks", {
      method: "POST",
      body: JSON.stringify({
        ...(mode === "brand" ? { mode: "brand", brandId } : { industry }),
        useAi,
        ...content,
      }),
    });
    setRunning(false);
    if (!ok || !data.check) {
      toast.error(data.error || "ตรวจบทความไม่สำเร็จ", { duration: 9000 });
      return;
    }
    setResult(data.check);
    setResultFile(usedFile && /\.docx$/i.test(usedFile.name) ? usedFile : null);
    if (data.check.aiError) toast.warning(`AI ตรวจบริบทไม่สำเร็จ ใช้ผลจากกฎอย่างเดียว: ${data.check.aiError}`);
    else toast.success("ตรวจเสร็จแล้ว");
    if (Array.isArray(data.notes)) for (const n of data.notes) toast.warning(n, { duration: 9000 });
  }

  return (
    <div className="space-y-4">
      <Panel title="ตั้งค่าการตรวจ" subtitle="เลือกระดับการตรวจและแหล่งบทความที่ต้องการตรวจ">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>ตรวจกับ</Label>
            <div>
              <Segmented<Mode>
                value={mode}
                onChange={setMode}
                ariaLabel="ระดับการตรวจ"
                options={[
                  { value: "industry", label: "ระดับอุตสาหกรรม" },
                  { value: "brand", label: "Brand Rule" },
                ]}
              />
            </div>
          </div>

          {mode === "industry" ? (
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
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="cmp-brand">แบรนด์ / ลูกค้า</Label>
              {brandsState === "unavailable" ? (
                <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  {BRAND_UNAVAILABLE_MESSAGE}
                </div>
              ) : brandsState === "loading" || brandsState === "idle" ? (
                <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลดรายการแบรนด์...</p>
              ) : brandsState === "error" ? (
                <p className="text-xs text-red-700">
                  โหลดรายการแบรนด์ไม่สำเร็จ —{" "}
                  <button type="button" onClick={() => setBrandsState("idle")} className="text-brand-blue underline">ลองใหม่</button>
                </p>
              ) : brands.length === 0 ? (
                <p className="flex flex-wrap items-center gap-1.5 text-xs text-amber-700">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  ยังไม่มีแบรนด์ที่เปิดใช้ —
                  {onGoBrand ? <button type="button" onClick={onGoBrand} className="text-brand-blue underline">ไปที่ Brand Rule</button> : "สร้างที่แท็บ Brand Rule"}
                </p>
              ) : (
                <>
                  <select
                    id="cmp-brand"
                    value={brandId}
                    onChange={(e) => setBrandId(e.target.value)}
                    className="h-10 w-full rounded-full border border-gray-200 bg-white px-3 text-sm sm:max-w-sm"
                  >
                    {brands.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} (กฎ {b.ruleCount} · ไฟล์ {b.fileCount}{b.voiceChars > 0 ? " · มี Brand voice" : ""})
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500">
                    ตรวจกับกฎของแบรนด์ + กฎที่ดึงจากคลังกฎ และเมื่อเปิด AI จะเทียบกับ Brand voice และไฟล์ Brand voice ของแบรนด์ด้วย
                  </p>
                  {brandEmpty && (
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-amber-700">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      แบรนด์นี้ยังไม่มีกฎ ไม่มี Brand voice และไม่มีไฟล์ —
                      {onGoBrand ? <button type="button" onClick={onGoBrand} className="text-brand-blue underline">ไปที่ Brand Rule</button> : null}
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>แหล่งบทความ</Label>
            <div className="max-w-full overflow-x-auto">
              <Segmented<Source>
                value={source}
                onChange={(v) => { setSource(v); setPicked(null); setQ(""); setOptions([]); }}
                options={[
                  { value: "sme", label: "บทความ SME" },
                  { value: "upload", label: "Upload Article" },
                  { value: "manual", label: "วางข้อความ" },
                  { value: "file", label: "ไฟล์ Word" },
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
          ) : source === "file" ? (
            <div className="space-y-2">
              <input
                ref={fileInput}
                type="file"
                accept=".docx,.doc"
                className="hidden"
                aria-label="เลือกไฟล์ Word"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  e.target.value = "";
                  if (f) void chooseFile(f);
                }}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" disabled={fileBusy} onClick={() => fileInput.current?.click()}>
                  {fileBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />}
                  {file ? "เปลี่ยนไฟล์" : "เลือกไฟล์ Word (.docx / .doc)"}
                </Button>
                {file && (
                  <span className="flex min-w-0 items-center gap-1.5 text-sm text-brand-navy">
                    <FileText className="h-4 w-4 shrink-0" />
                    <span className="break-all font-medium">{file.name}</span>
                    {fileText ? <span className="shrink-0 text-xs text-gray-500">· {fileText.length.toLocaleString("en-US")} ตัวอักษร</span> : null}
                  </span>
                )}
              </div>
              {fileError && <p role="alert" className="text-xs text-red-700">{fileError}</p>}
              <p className="text-xs text-gray-500">
                ไฟล์ถูกอ่านในเบราว์เซอร์ ส่งขึ้นระบบเฉพาะข้อความ — หลังตรวจ ไฟล์ .docx ดาวน์โหลดกลับได้พร้อม Comment และข้อเสนอแก้แบบ Suggesting (ไม่แก้เนื้อหาเดิม)
                {file && /\.doc$/i.test(file.name) ? " · ไฟล์ .doc รุ่นเก่าตรวจได้ แต่ export ได้เป็นไฟล์ Word ใหม่จากข้อความเท่านั้น" : ""}
              </p>
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
              {mode === "brand" ? <span className="text-xs text-gray-500">(จำเป็นสำหรับตรวจ Brand voice และข้อเสนอแก้แบบ Suggesting)</span> : null}
            </label>
            <Button onClick={run} disabled={!canRun}>
              {running ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-1.5 h-4 w-4" />}
              {running ? "กำลังตรวจ..." : "ตรวจบทความ"}
            </Button>
          </div>
        </div>
      </Panel>

      {result && <CheckResult check={result} userRole={userRole} onChange={setResult} originalFile={resultFile} />}
    </div>
  );
}
