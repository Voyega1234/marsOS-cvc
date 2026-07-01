"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AVAILABLE_VARIABLES, tokenizePrompt, getMissingVariables, extractVariables } from "@/services/ai/compiler";
import {
  ChevronLeft, FlaskConical, Play, Loader2, CheckCircle2, AlertTriangle,
  RotateCcw, Copy, Eye, EyeOff, DollarSign, Cpu, Clock,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PromptData {
  id: string;
  name: string;
  type: string;
  promptText: string;
  modelProvider: string;
  modelName: string;
  temperature: number;
  maxTokens: number;
  isActive: boolean;
  version: number;
}

interface TestResult {
  compiled: string;
  output: string;
  missingVariables: string[];
  tokenEstimate: number;
  costEstimate: number;
}

interface Props {
  prompt: PromptData;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SAMPLE_DEFAULTS = AVAILABLE_VARIABLES.reduce(
  (acc, v) => ({ ...acc, [v.name]: v.example }),
  {} as Record<string, string>
);

const PROVIDER_COLOR: Record<string, string> = {
  CLAUDE: "bg-orange-50 text-orange-700 border-orange-200",
  OPENAI: "bg-green-50 text-green-700 border-green-200",
  GEMINI: "bg-blue-50 text-blue-700 border-blue-200",
  CUSTOM: "bg-gray-50 text-gray-700 border-gray-100",
};

const TYPE_LABELS: Record<string, string> = {
  KEYWORD_RESEARCH_PROMPT:  "Keyword Research",
  CONTENT_MAP_PROMPT:       "Content Map",
  OUTLINE_PROMPT:           "Outline",
  ARTICLE_WRITER_PROMPT:    "Article Writer",
  SEO_CHECK_PROMPT:         "SEO Check",
  IMAGE_PROMPT_GENERATOR:   "Image Prompt",
  WORDPRESS_PUBLISH_PROMPT: "WordPress",
  TEMPLATE_SPECIFIC_PROMPT: "Template Specific",
};

// ── Highlighted Preview ───────────────────────────────────────────────────────

function HighlightedPreview({ promptText, variables }: { promptText: string; variables: Record<string, string> }) {
  const tokens = useMemo(() => tokenizePrompt(promptText), [promptText]);
  return (
    <span className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
      {tokens.map((tok, i) => {
        if (tok.type === "text") return <span key={i}>{tok.value}</span>;
        const val = variables[tok.value];
        if (val) {
          return (
            <span key={i} className="bg-green-100 text-green-800 rounded px-0.5 border border-green-200" title={`{{${tok.value}}} = "${val}"`}>
              {val}
            </span>
          );
        }
        return (
          <span key={i} className="bg-red-100 text-red-700 rounded px-0.5 border border-red-300 font-bold" title="Missing variable">
            {`{{${tok.value}}}`}
          </span>
        );
      })}
    </span>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function TestPromptClient({ prompt }: Props) {
  const usedVarNames = useMemo(() => extractVariables(prompt.promptText), [prompt.promptText]);

  // Build initial values: sample defaults for known vars, empty for unknown
  const initialVars = useMemo(() => {
    const vals: Record<string, string> = {};
    for (const v of usedVarNames) {
      vals[v] = SAMPLE_DEFAULTS[v] ?? "";
    }
    return vals;
  }, [usedVarNames]);

  const [vars, setVars] = useState<Record<string, string>>(initialVars);
  const [showPreview, setShowPreview] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  const missing = useMemo(() => getMissingVariables(prompt.promptText, vars), [prompt.promptText, vars]);

  function resetToSample() {
    setVars(initialVars);
    setResult(null);
    toast.success("Reset to sample values");
  }

  async function handleRun() {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch(`/api/prompts/${prompt.id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variables: vars }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Test failed");
      }
      const data: TestResult = await res.json();
      setResult(data);
      toast.success("Test complete!");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  function copyOutput() {
    if (!result) return;
    navigator.clipboard.writeText(result.output);
    toast.success("Copied to clipboard");
  }

  const isJsonOutput = (() => {
    if (!result?.output) return false;
    try { JSON.parse(result.output); return true; } catch { return false; }
  })();

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href={`/prompts/${prompt.id}`} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition-colors">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <FlaskConical className="h-5 w-5 text-teal-600" />
              Test Prompt
            </h1>
            <span className="text-xs px-2 py-0.5 rounded-full font-mono bg-gray-100 text-gray-600">v{prompt.version}</span>
            {prompt.isActive && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Active
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-0.5 truncate">{prompt.name}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-xs px-2 py-1 rounded-lg border font-medium ${PROVIDER_COLOR[prompt.modelProvider] ?? "bg-gray-50 text-gray-600 border-gray-100"}`}>
            {prompt.modelProvider}
          </span>
          <span className="text-xs text-gray-400 font-mono">{prompt.modelName}</span>
        </div>
      </div>

      {/* Warning banner */}
      <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
        <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-amber-800">
          <span className="font-semibold">Mock mode active.</span>{" "}
          Output is generated locally based on prompt type. Connect <code className="font-mono bg-amber-100 px-1 rounded">ANTHROPIC_API_KEY</code> in <code className="font-mono bg-amber-100 px-1 rounded">.env.local</code> for real AI responses.
          Each test run is logged as an AIJob.
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Left — Variable Editor */}
        <div className="space-y-4">
          <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
            <div className="bg-gray-50 border-b border-gray-100 px-4 py-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-700">Variable Values</h2>
                <p className="text-xs text-gray-400 mt-0.5">{usedVarNames.length} variable{usedVarNames.length !== 1 ? "s" : ""} used in this prompt</p>
              </div>
              <Button variant="outline" size="sm" onClick={resetToSample} className="gap-1.5 rounded-lg text-xs">
                <RotateCcw className="h-3 w-3" /> Reset
              </Button>
            </div>

            {usedVarNames.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-400">
                No variables found in this prompt.
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {usedVarNames.map((varName) => {
                  const meta = AVAILABLE_VARIABLES.find((v) => v.name === varName);
                  const isEmpty = !vars[varName]?.trim();
                  return (
                    <div key={varName} className="px-4 py-3">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <code className={`text-xs font-mono font-bold ${isEmpty ? "text-red-600" : "text-blue-600"}`}>
                            {`{{${varName}}}`}
                          </code>
                          {meta && <span className="text-xs text-gray-400">{meta.label}</span>}
                          {!meta && <span className="text-xs text-amber-500 bg-amber-50 px-1.5 rounded border border-amber-200">custom</span>}
                        </div>
                        {isEmpty && (
                          <span className="text-xs text-red-500 flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" /> missing
                          </span>
                        )}
                      </div>
                      <Input
                        value={vars[varName] ?? ""}
                        onChange={(e) => setVars((prev) => ({ ...prev, [varName]: e.target.value }))}
                        placeholder={meta?.example ?? `value for {{${varName}}}`}
                        className={`text-sm rounded-lg font-mono ${isEmpty ? "border-red-200 focus:border-red-400" : ""}`}
                      />
                    </div>
                  );
                })}
              </div>
            )}

            {missing.length > 0 && (
              <div className="px-4 pb-4">
                <p className="text-xs text-red-600 flex items-center gap-1.5 mt-2">
                  <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                  {missing.length} missing value(s) — prompt will compile with placeholder text
                </p>
              </div>
            )}
          </div>

          {/* Run button */}
          <Button
            onClick={handleRun}
            disabled={running}
            className="w-full gap-2 bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white rounded-xl py-3 text-base font-semibold"
          >
            {running ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Running test…</>
            ) : (
              <><Play className="h-4 w-4" /> Run Test</>
            )}
          </Button>

          {/* Prompt info card */}
          <div className="bg-white border border-gray-100 rounded-xl p-4 space-y-2">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Prompt Settings</h3>
            <div className="grid grid-cols-2 gap-y-2 text-xs">
              <span className="text-gray-400">Type</span>
              <span className="font-medium text-gray-700">{TYPE_LABELS[prompt.type] ?? prompt.type}</span>
              <span className="text-gray-400">Provider</span>
              <span className="font-medium text-gray-700">{prompt.modelProvider}</span>
              <span className="text-gray-400">Model</span>
              <span className="font-mono text-gray-600 truncate">{prompt.modelName}</span>
              <span className="text-gray-400">Temperature</span>
              <span className="font-medium text-gray-700">{prompt.temperature}</span>
              <span className="text-gray-400">Max Tokens</span>
              <span className="font-medium text-gray-700">{prompt.maxTokens.toLocaleString()}</span>
              <span className="text-gray-400">Prompt Length</span>
              <span className="font-medium text-gray-700">
                {prompt.promptText.length.toLocaleString()} chars · ~{Math.ceil(prompt.promptText.length / 4).toLocaleString()} tokens
              </span>
            </div>
          </div>
        </div>

        {/* Right — Preview + Result */}
        <div className="space-y-4">
          {/* Compiled preview */}
          <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
            <div
              className="bg-gray-50 border-b border-gray-100 px-4 py-3 flex items-center justify-between cursor-pointer select-none"
              onClick={() => setShowPreview((v) => !v)}
            >
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-gray-400" />
                <span className="text-sm font-semibold text-gray-700">Compiled Preview</span>
                <span className="text-xs text-gray-400">
                  {missing.length > 0 ? (
                    <span className="text-red-500 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> {missing.length} missing
                    </span>
                  ) : (
                    <span className="text-green-600 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" /> All filled
                    </span>
                  )}
                </span>
              </div>
              {showPreview ? <EyeOff className="h-4 w-4 text-gray-400" /> : <Eye className="h-4 w-4 text-gray-400" />}
            </div>
            {showPreview && (
              <div className="p-4 bg-gray-50 max-h-72 overflow-auto">
                <HighlightedPreview promptText={prompt.promptText} variables={vars} />
              </div>
            )}
          </div>

          {/* Result panel */}
          {result ? (
            <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
              {/* Stats bar */}
              <div className="bg-teal-50 border-b border-teal-200 px-4 py-3 flex items-center gap-4">
                <span className="flex items-center gap-1.5 text-xs font-medium text-teal-700">
                  <Cpu className="h-3.5 w-3.5" />
                  ~{result.tokenEstimate.toLocaleString()} tokens
                </span>
                <span className="flex items-center gap-1.5 text-xs font-medium text-teal-700">
                  <DollarSign className="h-3.5 w-3.5" />
                  ~${result.costEstimate.toFixed(5)}
                </span>
                {result.missingVariables.length > 0 && (
                  <span className="flex items-center gap-1.5 text-xs font-medium text-amber-600">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {result.missingVariables.length} missing
                  </span>
                )}
                <div className="ml-auto flex items-center gap-2">
                  <button
                    onClick={() => setShowRaw((v) => !v)}
                    className="text-xs text-teal-600 hover:text-teal-800 flex items-center gap-1"
                  >
                    {showRaw ? "Formatted" : "Raw"} ↕
                  </button>
                  <button
                    onClick={copyOutput}
                    className="text-xs text-teal-600 hover:text-teal-800 flex items-center gap-1"
                  >
                    <Copy className="h-3 w-3" /> Copy
                  </button>
                </div>
              </div>

              <div className="p-4 bg-gray-900 max-h-96 overflow-auto">
                {!showRaw && isJsonOutput ? (
                  <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap leading-relaxed">
                    {JSON.stringify(JSON.parse(result.output), null, 2)}
                  </pre>
                ) : (
                  <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap leading-relaxed">
                    {result.output}
                  </pre>
                )}
              </div>

              <div className="px-4 py-2 bg-gray-50 border-t border-gray-100">
                <p className="text-xs text-gray-400 flex items-center gap-1.5">
                  <FlaskConical className="h-3 w-3" />
                  Mock output — structure matches real AI response. Connect API key for live results.
                </p>
              </div>
            </div>
          ) : (
            <div className="bg-white border border-dashed border-gray-300 rounded-xl p-12 text-center">
              <Play className="h-10 w-10 mx-auto mb-3 text-gray-200" />
              <p className="text-sm font-medium text-gray-400">Output will appear here</p>
              <p className="text-xs text-gray-300 mt-1">Fill in variables and click Run Test</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
