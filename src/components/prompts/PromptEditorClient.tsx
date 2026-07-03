"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { AVAILABLE_VARIABLES, tokenizePrompt, getMissingVariables, extractVariables } from "@/services/ai/compiler";
import {
  Save, ChevronLeft, Copy, CheckCircle2, XCircle, Zap, History,
  FlaskConical, Eye, Pencil, AlertTriangle, Info, MoreHorizontal,
  CheckCircle, Circle,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDate } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PromptVersion {
  id: string;
  versionNumber: number;
  name: string;
  type: string;
  description?: string | null;
  promptText: string;
  modelProvider: string;
  modelName: string;
  temperature: number;
  maxTokens: number;
  changeNote?: string | null;
  createdAt: Date;
  createdBy: { name: string | null; email: string };
}

export interface ActivityEntry {
  id: string;
  action: string;
  createdAt: Date;
  user: { name: string | null; email: string } | null;
  newValue?: string | null;
}

export interface PromptData {
  id?: string;
  name: string;
  type: string;
  description: string;
  promptText: string;
  variables: string;
  modelProvider: string;
  modelName: string;
  temperature: number;
  maxTokens: number;
  isActive: boolean;
  version: number;
}

interface Props {
  prompt: PromptData | null;
  orgId: string;
  userRole: string;
  versions?: PromptVersion[];
  activity?: ActivityEntry[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PROMPT_TYPES = [
  { value: "KEYWORD_RESEARCH_PROMPT",  label: "Keyword Research" },
  { value: "CONTENT_MAP_PROMPT",       label: "Content Map" },
  { value: "OUTLINE_PROMPT",           label: "Outline" },
  { value: "ARTICLE_WRITER_PROMPT",    label: "Article Writer" },
  { value: "SEO_CHECK_PROMPT",         label: "SEO Check" },
  { value: "IMAGE_PROMPT_GENERATOR",   label: "Image Prompt" },
  { value: "WORDPRESS_PUBLISH_PROMPT", label: "WordPress Publish" },
  { value: "TEMPLATE_SPECIFIC_PROMPT", label: "Template Specific" },
];

const MODEL_OPTIONS: Record<string, string[]> = {
  CLAUDE: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
  OPENAI: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
  GEMINI: ["gemini-1.5-pro", "gemini-1.5-flash"],
  CUSTOM: [],
};

const SAMPLE_VARS = AVAILABLE_VARIABLES.reduce(
  (acc, v) => ({ ...acc, [v.name]: v.example }),
  {} as Record<string, string>
);

const VAR_GROUPS = ["Project", "Keywords", "Article", "Brand"];

const ACTION_LABELS: Record<string, string> = {
  CREATE_PROMPT: "Created prompt",
  UPDATE_PROMPT: "Saved new version",
  ACTIVATE_PROMPT: "Activated",
  DEACTIVATE_PROMPT: "Deactivated",
  DUPLICATE_PROMPT: "Duplicated",
  DELETE_PROMPT: "Deleted",
  SNAPSHOT_PROMPT: "Saved snapshot",
  RESTORE_PROMPT_VERSION: "Restored version",
  TEST_PROMPT: "Ran test",
};

// ── Highlighted Preview ───────────────────────────────────────────────────────

function HighlightedPromptPreview({
  promptText,
  variables,
}: {
  promptText: string;
  variables: Record<string, string>;
}) {
  const tokens = useMemo(() => tokenizePrompt(promptText), [promptText]);
  return (
    <span className="whitespace-pre-wrap font-mono text-sm leading-relaxed">
      {tokens.map((tok, i) => {
        if (tok.type === "text") return <span key={i}>{tok.value}</span>;
        const val = variables[tok.value];
        if (val) {
          return (
            <span
              key={i}
              className="bg-green-100 text-green-800 rounded px-0.5 border border-green-200"
              title={`{{${tok.value}}}`}
            >
              {val}
            </span>
          );
        }
        return (
          <span
            key={i}
            className="bg-red-100 text-red-700 rounded px-0.5 border border-red-300 font-bold"
            title="Missing variable — no value provided"
          >
            {`{{${tok.value}}}`}
          </span>
        );
      })}
    </span>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function PromptEditorClient({ prompt, orgId, userRole, versions = [], activity = [] }: Props) {
  const router = useRouter();
  const isAdmin = userRole === "ADMIN";
  const isNew = !prompt?.id;

  const [tab, setTab] = useState<"edit" | "preview" | "versions" | "activity">("edit");
  const [saving, setSaving] = useState(false);
  const [changeNote, setChangeNote] = useState("");
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [activating, setActivating] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const [form, setForm] = useState<PromptData>({
    id: prompt?.id,
    name: prompt?.name ?? "",
    type: prompt?.type ?? "KEYWORD_RESEARCH_PROMPT",
    description: prompt?.description ?? "",
    promptText: prompt?.promptText ?? "",
    variables: prompt?.variables ?? "[]",
    modelProvider: prompt?.modelProvider ?? "CLAUDE",
    modelName: prompt?.modelName ?? "claude-sonnet-4-6",
    temperature: prompt?.temperature ?? 0.7,
    maxTokens: prompt?.maxTokens ?? 4000,
    isActive: prompt?.isActive ?? false,
    version: prompt?.version ?? 1,
  });

  const usedVars = useMemo(() => extractVariables(form.promptText), [form.promptText]);
  const missingInPreview = useMemo(() => getMissingVariables(form.promptText, SAMPLE_VARS), [form.promptText]);
  const knownVarNames = new Set(AVAILABLE_VARIABLES.map((v) => v.name));
  const unknownVars = usedVars.filter((v) => !knownVarNames.has(v));

  function insertVariable(varName: string) {
    const tag = `{{${varName}}}`;
    setForm((f) => ({ ...f, promptText: f.promptText + tag }));
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  async function doSave() {
    setSaving(true);
    try {
      const endpoint = form.id ? `/api/prompts/${form.id}` : "/api/prompts";
      const method = form.id ? "PUT" : "POST";
      const res = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, changeNote: changeNote || undefined }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to save");
      }
      const saved = await res.json();
      toast.success(isNew ? "Prompt created!" : `Saved as v${saved.version}`);
      setShowSaveDialog(false);
      setChangeNote("");
      if (isNew) {
        router.push(`/prompts/${saved.id}`);
      } else {
        setForm((f) => ({ ...f, version: saved.version }));
        router.refresh();
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function handleSaveClick() {
    if (!form.name.trim() || !form.promptText.trim()) {
      toast.error("Name and Prompt Text are required");
      return;
    }
    if (isNew) {
      doSave();
    } else {
      setShowSaveDialog(true);
    }
  }

  // ── Activate / Deactivate ─────────────────────────────────────────────────

  async function toggleActive(targetActive: boolean) {
    if (!form.id) return;
    setActivating(true);
    try {
      const res = await fetch(`/api/prompts/${form.id}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: targetActive ? "activate" : "deactivate" }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setForm((f) => ({ ...f, isActive: targetActive }));
      toast.success(targetActive ? "Prompt activated" : "Prompt deactivated");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setActivating(false);
    }
  }

  // ── Duplicate ─────────────────────────────────────────────────────────────

  async function handleDuplicate() {
    if (!form.id) return;
    const res = await fetch(`/api/prompts/${form.id}/duplicate`, { method: "POST" });
    if (!res.ok) { toast.error("Failed to duplicate"); return; }
    const copy = await res.json();
    toast.success("Duplicated — editing copy");
    router.push(`/prompts/${copy.id}`);
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async function handleDelete() {
    if (!form.id) return;
    const res = await fetch(`/api/prompts/${form.id}`, { method: "DELETE" });
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed to delete"); return; }
    toast.success("Prompt deleted");
    router.push("/prompts");
  }

  // ── Restore version ───────────────────────────────────────────────────────

  async function handleRestore(versionId: string, vNum: number) {
    if (!form.id) return;
    if (!confirm(`Restore version ${vNum}? Current state will be auto-snapshotted.`)) return;
    const res = await fetch(`/api/prompts/${form.id}/versions/${versionId}/restore`, { method: "POST" });
    if (!res.ok) { toast.error("Failed to restore"); return; }
    const restored = await res.json();
    toast.success(`Restored to v${vNum} — now at v${restored.version}`);
    router.refresh();
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const modelOptions = MODEL_OPTIONS[form.modelProvider] ?? [];

  return (
    <div className="space-y-0">
      {/* ── Sticky Header ── */}
      <div className="bg-white border-b border-gray-100 px-6 py-4 sticky top-0 z-20">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/prompts" className="text-gray-400 hover:text-gray-600 flex-shrink-0">
              <ChevronLeft className="h-5 w-5" />
            </Link>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base font-bold text-gray-900 truncate">
                  {form.name || "New Prompt"}
                </h1>
                {!isNew && (
                  <span className="text-xs font-mono bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full flex-shrink-0">
                    v{form.version}
                  </span>
                )}
                {form.isActive ? (
                  <span className="flex items-center gap-1 text-xs font-medium text-green-600 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                    <CheckCircle2 className="h-3 w-3" /> Active
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs font-medium text-gray-400 bg-gray-50 border border-gray-100 px-2 py-0.5 rounded-full">
                    <Circle className="h-3 w-3" /> Inactive
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-0.5">{form.type}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Activate / Deactivate — Admin only */}
            {!isNew && isAdmin && (
              form.isActive ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => toggleActive(false)}
                  disabled={activating}
                  className="gap-1.5 rounded-lg text-red-600 border-red-200 hover:bg-red-50"
                >
                  <XCircle className="h-3.5 w-3.5" />
                  Deactivate
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => toggleActive(true)}
                  disabled={activating}
                  className="gap-1.5 rounded-lg text-green-600 border-green-200 hover:bg-green-50"
                >
                  <CheckCircle className="h-3.5 w-3.5" />
                  Activate
                </Button>
              )
            )}

            {/* Quick links */}
            {!isNew && (
              <>
                <Link href={`/prompts/${form.id}/test`}>
                  <Button variant="outline" size="sm" className="gap-1.5 rounded-lg">
                    <FlaskConical className="h-3.5 w-3.5" /> Test
                  </Button>
                </Link>
                <Link href={`/prompts/${form.id}/versions`}>
                  <Button variant="outline" size="sm" className="gap-1.5 rounded-lg">
                    <History className="h-3.5 w-3.5" /> History ({versions.length})
                  </Button>
                </Link>
              </>
            )}

            {/* Save */}
            {isAdmin && (
              <Button
                onClick={handleSaveClick}
                disabled={saving}
                className="gap-2 bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white rounded-lg"
              >
                <Save className="h-4 w-4" />
                {saving ? "Saving…" : isNew ? "Create Prompt" : "Save"}
              </Button>
            )}

            {/* More */}
            {!isNew && isAdmin && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="rounded-lg">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44 rounded-xl">
                  <DropdownMenuItem onClick={handleDuplicate} className="gap-2 text-sm">
                    <Copy className="h-3.5 w-3.5" /> Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => setShowDeleteDialog(true)}
                    className="gap-2 text-sm text-red-600 focus:text-red-700 focus:bg-red-50"
                    disabled={form.isActive}
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    {form.isActive ? "Cannot delete (active)" : "Delete"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 mt-4 border-b border-gray-100 -mb-4">
          {(["edit", "preview", "versions", "activity"] as const).map((t) => {
            const labels = { edit: "✏️ Edit", preview: "👁️ Preview", versions: `📜 Versions (${versions.length})`, activity: `📋 Activity (${activity.length})` };
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2.5 text-sm font-medium border-b border-gray-100-2 transition-colors ${tab === t
                  ? "border-green-600 text-green-700"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                  }`}
              >
                {labels[t]}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Tab Content ── */}
      <div className="p-6">
        {/* Edit Tab */}
        {tab === "edit" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Left — Form */}
            <div className="lg:col-span-2 space-y-4">
              {/* Meta */}
              <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-4">
                <h2 className="text-sm font-semibold text-gray-700">Prompt Info</h2>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2 sm:col-span-1">
                    <Label className="text-xs font-medium text-gray-600">Name *</Label>
                    <Input
                      className="mt-1 rounded-lg"
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="Keyword Research — Default"
                      disabled={!isAdmin}
                    />
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <Label className="text-xs font-medium text-gray-600">Prompt Type *</Label>
                    <Select
                      value={form.type}
                      onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}
                      disabled={!isAdmin}
                    >
                      <SelectTrigger className="mt-1 rounded-lg"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PROMPT_TYPES.map((t) => (
                          <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs font-medium text-gray-600">Description</Label>
                    <Input
                      className="mt-1 rounded-lg"
                      value={form.description}
                      onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                      placeholder="What does this prompt do?"
                      disabled={!isAdmin}
                    />
                  </div>
                </div>

                {/* Model config */}
                <div className="border-t border-gray-100 pt-4">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Model Settings</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <Label className="text-xs font-medium text-gray-600">Provider</Label>
                      <Select
                        value={form.modelProvider}
                        onValueChange={(v) => setForm((f) => ({ ...f, modelProvider: v, modelName: MODEL_OPTIONS[v]?.[0] ?? "" }))}
                        disabled={!isAdmin}
                      >
                        <SelectTrigger className="mt-1 rounded-lg text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="CLAUDE">Claude</SelectItem>
                          <SelectItem value="OPENAI">OpenAI</SelectItem>
                          <SelectItem value="GEMINI">Gemini</SelectItem>
                          <SelectItem value="CUSTOM">Custom</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs font-medium text-gray-600">Model</Label>
                      {modelOptions.length > 0 ? (
                        <Select
                          value={form.modelName}
                          onValueChange={(v) => setForm((f) => ({ ...f, modelName: v }))}
                          disabled={!isAdmin}
                        >
                          <SelectTrigger className="mt-1 rounded-lg text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {modelOptions.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          className="mt-1 rounded-lg text-sm"
                          value={form.modelName}
                          onChange={(e) => setForm((f) => ({ ...f, modelName: e.target.value }))}
                          disabled={!isAdmin}
                        />
                      )}
                    </div>
                    <div>
                      <Label className="text-xs font-medium text-gray-600">Temperature</Label>
                      <Input
                        className="mt-1 rounded-lg text-sm"
                        type="number"
                        min="0"
                        max="2"
                        step="0.05"
                        value={form.temperature}
                        onChange={(e) => setForm((f) => ({ ...f, temperature: parseFloat(e.target.value) || 0 }))}
                        disabled={!isAdmin}
                      />
                    </div>
                    <div>
                      <Label className="text-xs font-medium text-gray-600">Max Tokens</Label>
                      <Input
                        className="mt-1 rounded-lg text-sm"
                        type="number"
                        min="100"
                        max="200000"
                        value={form.maxTokens}
                        onChange={(e) => setForm((f) => ({ ...f, maxTokens: parseInt(e.target.value) || 4000 }))}
                        disabled={!isAdmin}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Prompt Textarea */}
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-gray-700">Prompt Text *</h2>
                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    <span>{form.promptText.length.toLocaleString()} chars</span>
                    <span>~{Math.ceil(form.promptText.length / 4).toLocaleString()} tokens</span>
                    {usedVars.length > 0 && (
                      <span className="text-blue-600">{usedVars.length} variables</span>
                    )}
                  </div>
                </div>
                <Textarea
                  value={form.promptText}
                  onChange={(e) => setForm((f) => ({ ...f, promptText: e.target.value }))}
                  placeholder={`Write your prompt here. Use {{variable}} syntax for dynamic values.\n\nExample:\nYou are an SEO expert for {{project_name}}.\nResearch keywords for: {{seed_keyword}}\nTarget audience: {{target_audience}}`}
                  className="font-mono text-sm min-h-[360px] resize-none rounded-lg leading-relaxed"
                  disabled={!isAdmin}
                />

                {/* Validation hints */}
                {unknownVars.length > 0 && (
                  <div className="mt-3 flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
                    <div className="text-xs text-amber-700">
                      <span className="font-semibold">Unknown variables:</span>{" "}
                      {unknownVars.map((v) => <code key={v} className="font-mono mx-0.5">{`{{${v}}}`}</code>)}
                      <span className="ml-1">— not in the standard variable list, but will still work.</span>
                    </div>
                  </div>
                )}
                {missingInPreview.length > 0 && (
                  <div className="mt-2 flex items-start gap-2 p-3 bg-white border border-gray-100 rounded-lg">
                    <Info className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-blue-700">
                      <span className="font-semibold">Preview has {missingInPreview.length} missing value(s).</span>{" "}
                      These will show as red in Preview tab — they need sample data.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Right — Variables Panel */}
            <div className="space-y-4">
              {/* Used variables */}
              {usedVars.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-100 p-4">
                  <h3 className="text-xs font-semibold text-gray-700 mb-3 uppercase tracking-wider">
                    Variables in this prompt ({usedVars.length})
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {usedVars.map((v) => {
                      const known = knownVarNames.has(v);
                      return (
                        <span
                          key={v}
                          className={`text-xs px-2 py-1 rounded-md font-mono ${known
                            ? "bg-green-100 text-green-700 border border-green-200"
                            : "bg-amber-100 text-amber-700 border border-amber-200"
                            }`}
                        >
                          {`{{${v}}}`}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Available variables by group */}
              {VAR_GROUPS.map((group) => {
                const vars = AVAILABLE_VARIABLES.filter((v) => v.group === group);
                return (
                  <div key={group} className="bg-white rounded-xl border border-gray-100 p-4">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{group}</h3>
                    <div className="space-y-1">
                      {vars.map((v) => {
                        const inUse = usedVars.includes(v.name);
                        return (
                          <button
                            key={v.name}
                            onClick={() => isAdmin && insertVariable(v.name)}
                            disabled={!isAdmin}
                            className={`w-full text-left flex items-center justify-between p-2 rounded-lg transition-colors ${isAdmin ? "cursor-pointer hover:bg-gray-50" : "cursor-default"} ${inUse ? "bg-green-50" : ""}`}
                          >
                            <div className="min-w-0 flex-1">
                              <code className={`text-xs font-mono font-semibold block ${inUse ? "text-green-700" : "text-blue-600"}`}>
                                {`{{${v.name}}}`}
                              </code>
                              <span className="text-xs text-gray-400 truncate block">{v.label}</span>
                            </div>
                            {inUse ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0 ml-2" />
                            ) : (
                              isAdmin && <Copy className="h-3 w-3 text-gray-300 flex-shrink-0 ml-2" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Preview Tab */}
        {tab === "preview" && (
          <div className="max-w-4xl space-y-4">
            {missingInPreview.length > 0 && (
              <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                <span>
                  <strong>{missingInPreview.length} variable(s)</strong> have no sample data:{" "}
                  {missingInPreview.map((v) => <code key={v} className="font-mono mx-0.5 text-red-600">{`{{${v}}}`}</code>)}
                  . They&apos;re highlighted in red below.
                </span>
              </div>
            )}
            <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
              <div className="bg-gray-50 border-b border-gray-100 px-5 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Eye className="h-4 w-4 text-gray-400" />
                  <span className="text-sm font-medium text-gray-700">Compiled Preview</span>
                  <span className="text-xs text-gray-400">using sample variable values</span>
                </div>
                <Link href={`/prompts/${form.id}/test`} className="text-xs text-green-600 hover:text-green-700 flex items-center gap-1">
                  <FlaskConical className="h-3.5 w-3.5" /> Test with custom values →
                </Link>
              </div>
              <div className="p-5 bg-blue-50/30 min-h-48 overflow-auto max-h-[600px]">
                <HighlightedPromptPreview promptText={form.promptText} variables={SAMPLE_VARS} />
              </div>
            </div>

            {/* Variable values used in preview */}
            <div className="bg-white border border-gray-100 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Sample Values Used</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {usedVars.map((v) => {
                  const sample = SAMPLE_VARS[v];
                  return (
                    <div key={v} className="flex items-start gap-2 text-xs">
                      <code className={`font-mono font-bold flex-shrink-0 mt-0.5 ${sample ? "text-green-700" : "text-red-600"}`}>
                        {`{{${v}}}`}
                      </code>
                      <span className="text-gray-500 truncate">{sample ?? "— missing —"}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Versions Tab */}
        {tab === "versions" && (
          <div className="max-w-3xl space-y-3">
            {versions.length === 0 ? (
              <div className="bg-white border border-gray-100 rounded-xl p-12 text-center">
                <History className="h-10 w-10 mx-auto mb-3 text-gray-200" />
                <p className="text-sm text-gray-500">No version history yet.</p>
                <p className="text-xs text-gray-400 mt-1">Snapshots are created automatically each time you save.</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm text-gray-500">{versions.length} snapshot(s) saved</p>
                  <Link href={`/prompts/${form.id}/versions`}>
                    <Button variant="outline" size="sm" className="rounded-lg gap-1.5">
                      <History className="h-3.5 w-3.5" /> Full History Page
                    </Button>
                  </Link>
                </div>
                {versions.map((v, idx) => (
                  <div key={v.id} className={`bg-white border rounded-xl p-4 ${idx === 0 ? "border-green-200 bg-green-50/30" : "border-gray-100"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-mono font-bold text-gray-700">v{v.versionNumber}</span>
                          {idx === 0 && <Badge variant="outline" className="text-xs text-green-600 border-green-300 bg-green-50">Latest snapshot</Badge>}
                          <span className="text-xs text-gray-400">{formatDate(v.createdAt)}</span>
                          <span className="text-xs text-gray-500">by {v.createdBy.name ?? v.createdBy.email}</span>
                        </div>
                        {v.changeNote && (
                          <p className="text-xs text-gray-600 mt-1.5 italic">&ldquo;{v.changeNote}&rdquo;</p>
                        )}
                        <p className="text-xs text-gray-400 mt-1 font-mono truncate">{v.promptText.slice(0, 80)}…</p>
                      </div>
                      {isAdmin && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRestore(v.id, v.versionNumber)}
                          className="rounded-lg flex-shrink-0 gap-1"
                        >
                          <History className="h-3.5 w-3.5" /> Restore
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* Activity Tab */}
        {tab === "activity" && (
          <div className="max-w-3xl space-y-2">
            {activity.length === 0 ? (
              <div className="bg-white border border-gray-100 rounded-xl p-12 text-center">
                <Pencil className="h-10 w-10 mx-auto mb-3 text-gray-200" />
                <p className="text-sm text-gray-500">No activity yet.</p>
              </div>
            ) : (
              activity.map((log) => (
                <div key={log.id} className="flex items-start gap-3 bg-white border border-gray-100 rounded-xl p-4">
                  <div className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-500 flex-shrink-0">
                    {(log.user?.name ?? log.user?.email ?? "?")[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-gray-800">
                        {ACTION_LABELS[log.action] ?? log.action}
                      </span>
                      <span className="text-xs text-gray-400">{formatDate(log.createdAt)}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{log.user?.name ?? log.user?.email ?? "System"}</p>
                    {log.newValue && (() => {
                      try {
                        const parsed = JSON.parse(log.newValue);
                        if (parsed.changeNote) return <p className="text-xs italic text-gray-400 mt-1">&ldquo;{parsed.changeNote}&rdquo;</p>;
                      } catch { }
                      return null;
                    })()}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* ── Save with note dialog ── */}
      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Save className="h-4 w-4 text-green-600" /> Save new version
            </DialogTitle>
            <DialogDescription>
              Current state (v{form.version}) will be snapshotted before saving.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-sm font-medium">Change note (optional)</Label>
              <Input
                className="mt-1 rounded-xl"
                placeholder="e.g. Added funnel_stage context, improved Thai output"
                value={changeNote}
                onChange={(e) => setChangeNote(e.target.value)}
                autoFocus
              />
            </div>
            <p className="text-xs text-gray-400">
              Leave blank to save without a note. You can still restore this version later.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveDialog(false)} className="rounded-xl">Cancel</Button>
            <Button
              onClick={doSave}
              disabled={saving}
              className="bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white rounded-xl gap-2"
            >
              {saving ? "Saving…" : `Save as v${form.version + 1}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete dialog ── */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="sm:max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-red-600">Delete Prompt?</DialogTitle>
            <DialogDescription>
              This will permanently delete &ldquo;{form.name}&rdquo; and all its version history. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)} className="rounded-xl">Cancel</Button>
            <Button onClick={handleDelete} className="bg-red-600 hover:bg-red-700 text-white rounded-xl">
              Delete Permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
