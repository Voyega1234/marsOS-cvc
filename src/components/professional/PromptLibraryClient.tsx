"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import { formatDate } from "@/lib/utils";
import { compilePrompt, AVAILABLE_VARIABLES } from "@/services/ai/compiler";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import {
  Search, Plus, CheckCircle2, XCircle, Copy, Play, Eye,
  Pencil, Trash2, MoreHorizontal, History, FlaskConical,
  ChevronDown, Zap, Circle,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Prompt {
  id: string;
  name: string;
  type: string;
  description?: string | null;
  promptText: string;
  modelProvider: string;
  modelName: string;
  temperature: number;
  maxTokens: number;
  isActive: boolean;
  version: number;
  updatedAt: Date;
  versionCount: number;
  createdBy: { name: string | null };
  updatedBy?: { name: string | null } | null;
}

interface Props {
  prompts: Prompt[];
  userRole: string;
}

// ── Config ────────────────────────────────────────────────────────────────────

const PROMPT_TYPE_META: Record<string, { label: string; color: string; bg: string }> = {
  KEYWORD_RESEARCH_PROMPT:  { label: "Keyword Research",  color: "text-blue-700",   bg: "bg-blue-100" },
  CONTENT_MAP_PROMPT:       { label: "Content Map",       color: "text-violet-700", bg: "bg-violet-100" },
  OUTLINE_PROMPT:           { label: "Outline",           color: "text-orange-700", bg: "bg-orange-100" },
  ARTICLE_WRITER_PROMPT:    { label: "Article Writer",    color: "text-green-700",  bg: "bg-green-100" },
  SEO_CHECK_PROMPT:         { label: "SEO Check",         color: "text-teal-700",   bg: "bg-teal-100" },
  IMAGE_PROMPT_GENERATOR:   { label: "Image Prompt",      color: "text-pink-700",   bg: "bg-pink-100" },
  WORDPRESS_PUBLISH_PROMPT: { label: "WordPress",         color: "text-indigo-700", bg: "bg-indigo-100" },
  TEMPLATE_SPECIFIC_PROMPT: { label: "Template Specific", color: "text-gray-700",   bg: "bg-gray-100" },
};

const MODEL_BADGE: Record<string, string> = {
  CLAUDE: "bg-orange-50 text-orange-600 border border-orange-200",
  OPENAI: "bg-green-50 text-green-600 border border-green-200",
  GEMINI: "bg-blue-50 text-blue-600 border border-blue-200",
  CUSTOM: "bg-gray-50 text-gray-600 border border-gray-100",
};

const SAMPLE_VARS = AVAILABLE_VARIABLES.reduce(
  (acc, v) => ({ ...acc, [v.name]: v.example }),
  {} as Record<string, string>
);

// ── Component ─────────────────────────────────────────────────────────────────

export function PromptLibraryClient({ prompts: initialPrompts, userRole }: Props) {
  const router = useRouter();
  const isAdmin = userRole === "ADMIN";

  const [prompts, setPrompts] = useState(initialPrompts);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [modelFilter, setModelFilter] = useState("ALL");
  const [activeFilter, setActiveFilter] = useState("ALL");
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [previewPrompt, setPreviewPrompt] = useState<Prompt | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Prompt | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ── Derived stats ──────────────────────────────────────────────────────────

  const typeStats = useMemo(() => {
    const map: Record<string, { total: number; active: number }> = {};
    for (const p of prompts) {
      if (!map[p.type]) map[p.type] = { total: 0, active: 0 };
      map[p.type].total++;
      if (p.isActive) map[p.type].active++;
    }
    return map;
  }, [prompts]);

  const filtered = useMemo(() => prompts.filter((p) => {
    if (q && !p.name.toLowerCase().includes(q.toLowerCase()) && !p.description?.toLowerCase().includes(q.toLowerCase())) return false;
    if (typeFilter !== "ALL" && p.type !== typeFilter) return false;
    if (modelFilter !== "ALL" && p.modelProvider !== modelFilter) return false;
    if (activeFilter === "ACTIVE" && !p.isActive) return false;
    if (activeFilter === "INACTIVE" && p.isActive) return false;
    return true;
  }), [prompts, q, typeFilter, modelFilter, activeFilter]);

  // ── Actions ────────────────────────────────────────────────────────────────

  async function activate(prompt: Prompt, activate: boolean) {
    setLoadingId(prompt.id);
    try {
      const res = await fetch(`/api/prompts/${prompt.id}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: activate ? "activate" : "deactivate" }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      // If activating: deactivate all others of same type in local state
      setPrompts((prev) => prev.map((p) => {
        if (p.id === prompt.id) return { ...p, isActive: activate };
        if (activate && p.type === prompt.type) return { ...p, isActive: false };
        return p;
      }));
      toast.success(activate ? `"${prompt.name}" is now the active ${PROMPT_TYPE_META[prompt.type]?.label ?? prompt.type} prompt` : "Prompt deactivated");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoadingId(null);
    }
  }

  async function duplicate(prompt: Prompt) {
    setLoadingId(prompt.id + "-dup");
    try {
      const res = await fetch(`/api/prompts/${prompt.id}/duplicate`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to duplicate");
      const copy = await res.json();
      setPrompts((prev) => [copy, ...prev]);
      toast.success("Duplicated — opening copy");
      router.push(`/prompts/${copy.id}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoadingId(null);
    }
  }

  async function doDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/prompts/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to delete");
      setPrompts((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      toast.success(`"${deleteTarget.name}" deleted`);
      setDeleteTarget(null);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* Type summary grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Object.entries(PROMPT_TYPE_META).map(([type, meta]) => {
          const stats = typeStats[type] ?? { total: 0, active: 0 };
          const hasActive = stats.active > 0;
          return (
            <button
              key={type}
              onClick={() => setTypeFilter(typeFilter === type ? "ALL" : type)}
              className={`text-left p-3 rounded-xl border transition-all ${typeFilter === type
                ? `${meta.bg} border-current ring-2 ring-offset-1 ring-current`
                : "bg-white border-gray-100 hover:border-gray-300 hover:shadow-sm"
                }`}
            >
              <div className="flex items-start justify-between">
                <span className={`text-lg font-bold ${meta.color}`}>{stats.total}</span>
                {hasActive && (
                  <span className="flex items-center gap-0.5 text-xs font-medium text-green-600">
                    <CheckCircle2 className="h-3 w-3" /> {stats.active}
                  </span>
                )}
              </div>
              <p className={`text-xs font-medium mt-0.5 ${meta.color}`}>{meta.label}</p>
              {!hasActive && stats.total > 0 && (
                <p className="text-xs text-amber-500 mt-0.5">No active</p>
              )}
            </button>
          );
        })}
      </div>

      {/* Filter bar */}
      <div className="bg-white border border-gray-100 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search prompts…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9 text-sm rounded-xl"
            />
          </div>
          <Select value={modelFilter} onValueChange={setModelFilter}>
            <SelectTrigger className="w-32 text-sm rounded-xl"><SelectValue placeholder="Model" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Models</SelectItem>
              <SelectItem value="CLAUDE">Claude</SelectItem>
              <SelectItem value="OPENAI">OpenAI</SelectItem>
              <SelectItem value="GEMINI">Gemini</SelectItem>
              <SelectItem value="CUSTOM">Custom</SelectItem>
            </SelectContent>
          </Select>
          <Select value={activeFilter} onValueChange={setActiveFilter}>
            <SelectTrigger className="w-32 text-sm rounded-xl"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Status</SelectItem>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="INACTIVE">Inactive</SelectItem>
            </SelectContent>
          </Select>
          {isAdmin && (
            <Link
              href="/prompts/new"
              className="flex items-center gap-1.5 px-4 py-2 bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white text-sm font-semibold rounded-xl transition-colors ml-auto"
            >
              <Plus className="h-4 w-4" /> New Prompt
            </Link>
          )}
        </div>

        {/* Type pills */}
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={() => setTypeFilter("ALL")}
            className={`text-xs px-2.5 py-1 rounded-full font-medium transition-all ${typeFilter === "ALL" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
          >
            All ({prompts.length})
          </button>
          {Object.entries(PROMPT_TYPE_META).map(([k, meta]) => {
            const cnt = prompts.filter((p) => p.type === k).length;
            if (!cnt) return null;
            return (
              <button
                key={k}
                onClick={() => setTypeFilter(typeFilter === k ? "ALL" : k)}
                className={`text-xs px-2.5 py-1 rounded-full font-medium transition-all ${typeFilter === k
                  ? `${meta.bg} ${meta.color} ring-2 ring-offset-1 ring-current`
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
              >
                {meta.label} ({cnt})
              </button>
            );
          })}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Name</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Type</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Model</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Ver.</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Updated</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-14 text-gray-400">
                  <Search className="h-8 w-8 mx-auto mb-2 text-gray-200" />
                  <p className="text-sm">No prompts match your filters</p>
                </td>
              </tr>
            )}
            {filtered.map((prompt) => {
              const typeMeta = PROMPT_TYPE_META[prompt.type];
              const isLoading = loadingId === prompt.id;
              return (
                <tr key={prompt.id} className="hover:bg-gray-50/50 transition-colors group">
                  {/* Name */}
                  <td className="px-4 py-3 max-w-xs">
                    <Link href={`/prompts/${prompt.id}`} className="text-sm font-semibold text-gray-900 hover:text-green-700 transition-colors block truncate">
                      {prompt.name}
                    </Link>
                    {prompt.description && (
                      <p className="text-xs text-gray-400 mt-0.5 truncate">{prompt.description}</p>
                    )}
                  </td>

                  {/* Type */}
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded-lg font-medium whitespace-nowrap ${typeMeta?.bg ?? "bg-gray-100"} ${typeMeta?.color ?? "text-gray-600"}`}>
                      {typeMeta?.label ?? prompt.type}
                    </span>
                  </td>

                  {/* Model */}
                  <td className="px-4 py-3">
                    <div>
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${MODEL_BADGE[prompt.modelProvider] ?? "bg-gray-100 text-gray-600"}`}>
                        {prompt.modelProvider}
                      </span>
                      <p className="text-xs text-gray-400 mt-0.5 font-mono truncate max-w-[120px]">{prompt.modelName}</p>
                    </div>
                  </td>

                  {/* Version */}
                  <td className="px-4 py-3 text-center">
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-xs font-mono bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">v{prompt.version}</span>
                      {prompt.versionCount > 0 && (
                        <Link href={`/prompts/${prompt.id}/versions`} className="text-xs text-gray-400 hover:text-blue-600 flex items-center gap-0.5">
                          <History className="h-2.5 w-2.5" />{prompt.versionCount}
                        </Link>
                      )}
                    </div>
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3 text-center">
                    {prompt.isActive ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600 bg-green-50 border border-green-200 px-2 py-1 rounded-full">
                        <CheckCircle2 className="h-3 w-3" /> Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-400 bg-gray-50 border border-gray-100 px-2 py-1 rounded-full">
                        <Circle className="h-3 w-3" /> Inactive
                      </span>
                    )}
                  </td>

                  {/* Updated */}
                  <td className="px-4 py-3 text-xs text-gray-400">
                    <p>{formatDate(prompt.updatedAt)}</p>
                    {prompt.updatedBy?.name && <p className="text-gray-300">{prompt.updatedBy.name}</p>}
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {/* Preview */}
                      <button
                        onClick={() => setPreviewPrompt(prompt)}
                        className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
                        title="Preview compiled"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      {/* Test */}
                      <Link
                        href={`/prompts/${prompt.id}/test`}
                        className="p-1.5 rounded-lg hover:bg-teal-50 text-gray-400 hover:text-teal-700 transition-colors"
                        title="Test prompt"
                      >
                        <FlaskConical className="h-3.5 w-3.5" />
                      </Link>
                      {/* Edit */}
                      <Link
                        href={`/prompts/${prompt.id}`}
                        className="p-1.5 rounded-lg hover:bg-blue-50 text-gray-400 hover:text-blue-700 transition-colors"
                        title="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Link>
                      {/* More */}
                      {isAdmin && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors">
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48 rounded-xl">
                            {/* Activate / Deactivate */}
                            {prompt.isActive ? (
                              <DropdownMenuItem
                                onClick={() => activate(prompt, false)}
                                disabled={isLoading}
                                className="gap-2 text-sm"
                              >
                                <XCircle className="h-3.5 w-3.5 text-red-400" /> Deactivate
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                onClick={() => activate(prompt, true)}
                                disabled={isLoading}
                                className="gap-2 text-sm"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> Set as Active
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              onClick={() => duplicate(prompt)}
                              disabled={!!loadingId}
                              className="gap-2 text-sm"
                            >
                              <Copy className="h-3.5 w-3.5" /> Duplicate
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <Link href={`/prompts/${prompt.id}/versions`} className="gap-2 text-sm flex items-center">
                                <History className="h-3.5 w-3.5" /> Version History
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => !prompt.isActive && setDeleteTarget(prompt)}
                              disabled={prompt.isActive}
                              className={`gap-2 text-sm ${prompt.isActive ? "opacity-40 cursor-not-allowed" : "text-red-600 focus:text-red-700 focus:bg-red-50"}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              {prompt.isActive ? "Can't delete (active)" : "Delete"}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Preview Modal */}
      <Dialog open={!!previewPrompt} onOpenChange={() => setPreviewPrompt(null)}>
        <DialogContent className="max-w-2xl rounded-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Eye className="h-4 w-4 text-gray-400" />
              {previewPrompt?.name}
              <span className="text-xs font-mono bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">v{previewPrompt?.version}</span>
            </DialogTitle>
            <DialogDescription>Compiled with sample variables — green = filled, red = missing</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto space-y-4 min-h-0">
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Raw Template</p>
              <pre className="text-xs bg-gray-900 text-green-400 p-4 rounded-xl overflow-auto max-h-44 whitespace-pre-wrap font-mono">
                {previewPrompt?.promptText}
              </pre>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Compiled Preview</p>
              <div className="text-sm bg-white border border-gray-100 p-4 rounded-xl text-gray-700 whitespace-pre-wrap max-h-52 overflow-auto leading-relaxed font-mono">
                {previewPrompt ? compilePrompt(previewPrompt.promptText, SAMPLE_VARS) : ""}
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPreviewPrompt(null)} className="rounded-xl">Close</Button>
            <Link href={`/prompts/${previewPrompt?.id}/test`}>
              <Button variant="outline" className="rounded-xl gap-2">
                <FlaskConical className="h-4 w-4" /> Test
              </Button>
            </Link>
            <Link href={`/prompts/${previewPrompt?.id}`}>
              <Button className="bg-[#1A1A1A] hover:bg-[#2D2D2D] rounded-xl gap-2">
                <Pencil className="h-4 w-4" /> Edit
              </Button>
            </Link>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-red-600">Delete Prompt?</DialogTitle>
            <DialogDescription>
              &ldquo;{deleteTarget?.name}&rdquo; (v{deleteTarget?.version}) and all its version history will be permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} className="rounded-xl">Cancel</Button>
            <Button onClick={doDelete} disabled={deleting} className="bg-red-600 hover:bg-red-700 text-white rounded-xl">
              {deleting ? "Deleting…" : "Delete Permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
