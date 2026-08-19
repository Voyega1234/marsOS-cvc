"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FlaskConical, Play, Save, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Drawer, SectionCard } from "./shared";
import type {
  ArticleBriefData,
  BusinessSkillData,
  MasterPromptData,
  PromptRow,
  ValidatorConfig,
  ValidatorPackData,
} from "./types";
import { emptyArticleBrief, emptyBusinessSkill, emptyMasterPrompt, tryParse } from "./types";

interface Props {
  businessSkills: PromptRow[];
  masterPrompts: PromptRow[];
  briefTemplates: PromptRow[];
  validatorPacks: PromptRow[];
}

function section(data: unknown): string {
  if (data == null) return "";
  if (typeof data === "string") return data;
  const isEmptyObj = typeof data === "object" && !Array.isArray(data) && Object.keys(data as object).length === 0;
  const isEmptyArr = Array.isArray(data) && data.length === 0;
  if (isEmptyObj || isEmptyArr) return "";
  return JSON.stringify(data, null, 2);
}

type ValidatorResult = { id: string; name: string; status: "pass" | "warning" | "fail"; score: number };

export function PromptComposerTab({ businessSkills, masterPrompts, briefTemplates, validatorPacks }: Props) {
  const [outputFormat, setOutputFormat] = useState("HTML article พร้อม H1/H2/H3, FAQ schema, Internal Links");

  const [compiled, setCompiled] = useState<string | null>(null);
  const [resolved, setResolved] = useState<string[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [riskFlags, setRiskFlags] = useState<string[]>([]);
  const [testOutput, setTestOutput] = useState<string | null>(null);
  const [validatorResults, setValidatorResults] = useState<ValidatorResult[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [resultsOpen, setResultsOpen] = useState(false);

  // ── ใช้ Active layer ของ scope ปัจจุบันเท่านั้น — ไม่มีการเลือก Client/Matrix ─────
  const businessSkillRow = useMemo(() => businessSkills.find((i) => i.isActive), [businessSkills]);
  const masterPromptRow = useMemo(() => masterPrompts.find((i) => i.isActive), [masterPrompts]);
  const briefRow = useMemo(() => briefTemplates.find((i) => i.isActive), [briefTemplates]);
  const validatorPackRow = useMemo(() => validatorPacks.find((i) => i.isActive), [validatorPacks]);

  const businessSkillData = useMemo(
    () => (businessSkillRow ? tryParse<BusinessSkillData>(businessSkillRow.promptText) ?? emptyBusinessSkill() : null),
    [businessSkillRow]
  );
  const masterPromptData = useMemo(
    () => (masterPromptRow ? tryParse<MasterPromptData>(masterPromptRow.promptText) ?? emptyMasterPrompt() : null),
    [masterPromptRow]
  );
  const briefData = useMemo(
    () => (briefRow ? tryParse<ArticleBriefData>(briefRow.promptText) ?? emptyArticleBrief() : null),
    [briefRow]
  );
  const validatorPackData = useMemo(
    () => (validatorPackRow ? tryParse<ValidatorPackData>(validatorPackRow.promptText) : null),
    [validatorPackRow]
  );

  const layerStatus: { label: string; row: PromptRow | undefined }[] = [
    { label: "Business Skill", row: businessSkillRow },
    { label: "Master Prompt", row: masterPromptRow },
    { label: "Article Brief", row: briefRow },
    { label: "Validator Pack", row: validatorPackRow },
  ];

  function compile() {
    if (!masterPromptData) {
      toast.error("ยังไม่มี Master Prompt ที่ Active ในสโคปนี้");
      return;
    }
    const template = `${masterPromptData.systemInstruction}\n\n${masterPromptData.writingInstruction}\n\nOUTPUT FORMAT\n{{output_format}}`;

    const varMap: Record<string, string> = {
      "{{business_skill}}": businessSkillData ? section(businessSkillData) : "",
      "{{article_brief}}": briefData ? section(briefData) : "",
      "{{approved_sources}}": businessSkillData ? section(businessSkillData.officialSources) : "",
      "{{brand_voice}}": businessSkillData ? section(businessSkillData.brandVoice) : "",
      "{{approved_claims}}": businessSkillData ? section(businessSkillData.approvedClaims) : "",
      "{{prohibited_claims}}": businessSkillData ? section(businessSkillData.prohibitedClaims) : "",
      "{{expert_reviewer}}": businessSkillData ? section(businessSkillData.expertReviewer) : "",
      "{{content_type}}": briefData?.contentType || masterPromptData.contentType || "",
      "{{risk_level}}": businessSkillData?.riskLevel || masterPromptData.riskLevel || "",
      "{{language}}": businessSkillData?.businessProfile?.language || "th",
      "{{output_format}}": outputFormat,
      "{{internal_links}}": briefData ? section(briefData.internalLinksSection) : "",
      "{{contact_information}}": businessSkillData?.businessProfile?.contact || "",
      "{{website_inventory}}": "",
      "{{cms_capabilities}}": "",
    };

    let output = template;
    const nowResolved: string[] = [];
    const nowMissing: string[] = [];
    const required = new Set(masterPromptData.requiredVariables);
    const allVars = Array.from(new Set([...masterPromptData.requiredVariables, ...masterPromptData.optionalVariables]));

    for (const v of allVars) {
      const value = varMap[v] ?? "";
      const present = value.trim() !== "";
      output = output.split(v).join(present ? value : `[MISSING:${v}]`);
      if (present) nowResolved.push(v);
      else if (required.has(v)) nowMissing.push(v);
    }

    const flags: string[] = [];
    if (!businessSkillRow) flags.push("ไม่มี Business Skill ที่ Active ในสโคปนี้");
    if (!briefRow) flags.push("ไม่มี Article Brief ที่ Active ในสโคปนี้");
    if (!validatorPackRow) flags.push("ไม่มี Validator Pack ที่ Active ในสโคปนี้");
    if (businessSkillData && (businessSkillData.riskLevel === "high" || businessSkillData.riskLevel === "critical")) {
      if (!businessSkillData.expertReviewer?.name?.trim()) flags.push("High/Critical Risk แต่ยังไม่มี Expert Reviewer");
    }
    if (nowMissing.length > 0) flags.push(`ขาดตัวแปรที่จำเป็น ${nowMissing.length} ตัว`);

    setCompiled(output);
    setResolved(nowResolved);
    setMissing(nowMissing);
    setRiskFlags(flags);
    setTestOutput(null);
    setValidatorResults([]);
    setRunId(null);
  }

  function runTest() {
    if (!compiled) {
      toast.error("Compile ก่อนถึงจะ Run Test ได้");
      return;
    }
    const id = `run_${Date.now().toString(36)}`;
    setRunId(id);
    setTestOutput(
      `[MOCK] บทความทดสอบจาก Prompt Composer (Run ID: ${id})\n\n<h1>${briefData?.coreTopic?.workingTitle || "หัวข้อบทความทดสอบ"}</h1>\n<p>เนื้อหานี้เป็น mock output สำหรับทดสอบการ compile — เชื่อม OPENROUTER_API_KEY เพื่อสร้างบทความจริง</p>\n\n<!-- [MOCK] Content Engine test run -->`
    );
    const validators: ValidatorConfig[] = validatorPackData?.validators?.filter((v) => v.enabled) ?? [];
    setValidatorResults(
      validators.map((v, idx) => ({
        id: v.id,
        name: v.name,
        status: missing.length > 0 && v.blocking ? "fail" : idx % 4 === 3 ? "warning" : "pass",
        score: missing.length > 0 && v.blocking ? 45 : idx % 4 === 3 ? 68 : 92,
      }))
    );
    setResultsOpen(true);
    toast.success("Run Test เสร็จแล้ว (mock)");
  }

  function saveTest() {
    if (!runId) {
      toast.error("ยังไม่มีผล Test ให้บันทึก");
      return;
    }
    toast.success(`บันทึกผล Test ${runId} แล้ว`);
  }

  function exportDebugPackage() {
    const pkg = {
      runId,
      selection: {
        businessSkillId: businessSkillRow?.id ?? null,
        masterPromptId: masterPromptRow?.id ?? null,
        briefTemplateId: briefRow?.id ?? null,
        validatorPackId: validatorPackRow?.id ?? null,
        outputFormat,
      },
      resolvedVariables: resolved,
      missingVariables: missing,
      riskFlags,
      compiledPrompt: compiled,
      testOutput,
      validatorResults,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `content-engine-debug-${runId ?? "draft"}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success("Export Debug Package แล้ว");
  }

  const tokenEstimate = compiled ? Math.round(compiled.length / 4) : 0;

  return (
    <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
      {/* ── ซ้าย: Active layer ของสโคปปัจจุบัน ─────────────────────────────────── */}
      <aside className="space-y-3">
        <SectionCard title="Active Layers (สโคปปัจจุบัน)" description="Compose จาก Layer ที่ Active อยู่ในสโคปนี้เท่านั้น">
          <div className="space-y-2">
            {layerStatus.map((l) => (
              <div key={l.label} className="flex items-center justify-between rounded-md border border-gray-100 px-3 py-2 text-xs">
                <span className="text-gray-600">{l.label}</span>
                {l.row ? (
                  <span className="inline-flex items-center gap-1 font-medium text-green-700">
                    <CheckCircle2 className="size-3.5" /> {l.row.name}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 font-medium text-red-600">
                    <XCircle className="size-3.5" /> ไม่มี Active
                  </span>
                )}
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Output Format">
          <Input value={outputFormat} onChange={(e) => setOutputFormat(e.target.value)} className="h-9 text-sm" />
        </SectionCard>

        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" className="gap-1.5" onClick={compile}>
            <FlaskConical className="size-3.5" /> Compile
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={runTest} disabled={!compiled}>
            <Play className="size-3.5" /> Run Test
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={saveTest} disabled={!runId}>
            <Save className="size-3.5" /> Save Test
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={exportDebugPackage} disabled={!compiled}>
            <Download className="size-3.5" /> Export Debug
          </Button>
        </div>
      </aside>

      {/* ── ขวา: ผลลัพธ์ ────────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionCard title="Compiled Prompt" description={compiled ? `Token estimate: ~${tokenEstimate}` : "กด Compile เพื่อประกอบ prompt จาก Layer ที่ Active"}>
          <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-md bg-gray-50 p-3 text-xs text-gray-700">
            {compiled ?? "ยังไม่ได้ Compile"}
          </pre>
        </SectionCard>

        <div className="grid gap-3 sm:grid-cols-2">
          <SectionCard title="Resolved Variables">
            {resolved.length === 0 ? (
              <p className="text-xs text-gray-400">—</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {resolved.map((v) => (
                  <span key={v} className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 font-mono text-[11px] text-green-700">{v}</span>
                ))}
              </div>
            )}
          </SectionCard>
          <SectionCard title="Missing Variables">
            {missing.length === 0 ? (
              <p className="text-xs text-gray-400">—</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {missing.map((v) => (
                  <span key={v} className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 font-mono text-[11px] text-red-700">{v}</span>
                ))}
              </div>
            )}
          </SectionCard>
        </div>

        {riskFlags.length > 0 && (
          <SectionCard title="Risk Flags">
            <div className="space-y-1.5">
              {riskFlags.map((f, idx) => (
                <div key={idx} className="flex items-center gap-1.5 text-xs text-amber-700">
                  <AlertTriangle className="size-3.5 shrink-0" /> {f}
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {testOutput && (
          <SectionCard title="Test Result" description={runId ? `Run ID: ${runId}` : undefined}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {validatorResults.map((r) => (
                  <span
                    key={r.id}
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                      r.status === "pass" && "bg-green-100 text-green-700",
                      r.status === "warning" && "bg-amber-100 text-amber-700",
                      r.status === "fail" && "bg-red-100 text-red-700"
                    )}
                  >
                    {r.name}: {r.status}
                  </span>
                ))}
              </div>
              <Button size="sm" variant="outline" onClick={() => setResultsOpen(true)}>
                ดูรายละเอียด
              </Button>
            </div>
          </SectionCard>
        )}
      </section>

      {/* ── Test result drawer (Apollo-style right panel) ───────────────── */}
      <Drawer
        open={resultsOpen}
        onClose={() => setResultsOpen(false)}
        title={runId ? `Test Result · ${runId}` : "Test Result"}
        wide
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setResultsOpen(false)}>
              ปิด
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={exportDebugPackage}>
              <Download className="size-3.5" /> Export Debug
            </Button>
            <Button size="sm" className="gap-1.5" onClick={saveTest}>
              <Save className="size-3.5" /> Save Test
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-xs font-semibold text-gray-600">Test Output</p>
            <pre className="max-h-[280px] overflow-auto whitespace-pre-wrap rounded-md bg-gray-50 p-3 text-xs text-gray-700">{testOutput}</pre>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-semibold text-gray-600">Validator Results (mock)</p>
            <div className="space-y-1.5">
              {validatorResults.length === 0 && <p className="text-xs text-gray-400">ไม่มี Validator ที่เปิดใช้งานใน Pack ที่เลือก</p>}
              {validatorResults.map((r) => (
                <div key={r.id} className="flex items-center justify-between rounded-md border border-gray-100 px-3 py-2 text-xs">
                  <span className="text-gray-700">{r.name}</span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 font-semibold",
                      r.status === "pass" && "bg-green-100 text-green-700",
                      r.status === "warning" && "bg-amber-100 text-amber-700",
                      r.status === "fail" && "bg-red-100 text-red-700"
                    )}
                  >
                    {r.status} · {r.score}
                  </span>
                </div>
              ))}
            </div>
          </div>
          {riskFlags.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold text-gray-600">Risk Flags</p>
              <div className="space-y-1.5">
                {riskFlags.map((f, idx) => (
                  <div key={idx} className="flex items-center gap-1.5 text-xs text-amber-700">
                    <AlertTriangle className="size-3.5 shrink-0" /> {f}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Drawer>
    </div>
  );
}
