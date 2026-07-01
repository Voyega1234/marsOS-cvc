"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { History, ChevronLeft, ChevronDown, ChevronUp, RotateCcw, GitBranch, User, Clock, FileText } from "lucide-react";

interface Version {
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

interface Props {
  promptId: string;
  promptName: string;
  currentVersion: number;
  versions: Version[];
  isAdmin: boolean;
}

export function VersionHistoryClient({ promptId, promptName, currentVersion, versions, isAdmin }: Props) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<Version | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [comparing, setComparing] = useState<{ a: Version; b: Version } | null>(null);

  async function handleRestore() {
    if (!restoreTarget) return;
    setRestoring(true);
    try {
      const res = await fetch(`/api/prompts/${promptId}/versions/${restoreTarget.id}/restore`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Restore failed");
      }
      const restored = await res.json();
      toast.success(`Restored to v${restoreTarget.versionNumber} — now at v${restored.version}`);
      setRestoreTarget(null);
      router.push(`/prompts/${promptId}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href={`/prompts/${promptId}`}
          className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <History className="h-5 w-5 text-gray-500" />
            Version History
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            <span className="font-medium">{promptName}</span>
            {" · "}current: v{currentVersion}
            {" · "}
            {versions.length} snapshot{versions.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-gray-500 bg-white border border-gray-100 rounded-xl px-4 py-3">
        <span className="flex items-center gap-1.5"><GitBranch className="h-3.5 w-3.5 text-blue-500" /> Each save auto-creates a snapshot</span>
        <span className="flex items-center gap-1.5"><RotateCcw className="h-3.5 w-3.5 text-green-500" /> Restoring auto-snapshots the current state first</span>
        <span className="flex items-center gap-1.5"><FileText className="h-3.5 w-3.5 text-gray-400" /> Snapshot stores the state BEFORE the save</span>
      </div>

      {versions.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-xl p-16 text-center">
          <History className="h-12 w-12 mx-auto mb-3 text-gray-200" />
          <p className="text-sm font-medium text-gray-500">No snapshots yet</p>
          <p className="text-xs text-gray-400 mt-1">Edit and save the prompt to create the first snapshot.</p>
        </div>
      ) : (
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-5 top-5 bottom-5 w-0.5 bg-gray-200 rounded-full" />

          <div className="space-y-3">
            {versions.map((v, idx) => {
              const isExpanded = expanded === v.id;
              const isLatest = idx === 0;

              return (
                <div key={v.id} className="relative pl-12">
                  {/* Dot */}
                  <div className={`absolute left-3.5 top-4 w-3 h-3 rounded-full border-2 ${isLatest
                    ? "bg-blue-500 border-b border-gray-100lue-500"
                    : "bg-white border-gray-300"
                    }`} />

                  <div className={`bg-white border rounded-xl overflow-hidden transition-shadow hover:shadow-sm ${isLatest ? "border-blue-200" : "border-gray-100"
                    }`}>
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          {/* Version badge + date */}
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`text-sm font-bold font-mono ${isLatest ? "text-blue-700" : "text-gray-700"}`}>
                              v{v.versionNumber}
                            </span>
                            {isLatest && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">
                                Latest snapshot
                              </span>
                            )}
                            <span className="flex items-center gap-1 text-xs text-gray-400">
                              <Clock className="h-3 w-3" />
                              {formatDate(v.createdAt)}
                            </span>
                            <span className="flex items-center gap-1 text-xs text-gray-500">
                              <User className="h-3 w-3" />
                              {v.createdBy.name ?? v.createdBy.email}
                            </span>
                          </div>

                          {/* Change note */}
                          {v.changeNote && (
                            <p className="text-sm text-gray-600 mt-1.5 italic">
                              &ldquo;{v.changeNote}&rdquo;
                            </p>
                          )}

                          {/* Model info */}
                          <div className="flex items-center gap-2 mt-1.5">
                            <span className="text-xs px-1.5 py-0.5 rounded bg-orange-50 text-orange-600 border border-orange-100 font-medium">
                              {v.modelProvider}
                            </span>
                            <span className="text-xs text-gray-400">{v.modelName}</span>
                            <span className="text-xs text-gray-400">temp: {v.temperature}</span>
                            <span className="text-xs text-gray-400">max: {v.maxTokens.toLocaleString()}</span>
                          </div>

                          {/* Prompt preview */}
                          <p className="text-xs font-mono text-gray-400 mt-2 line-clamp-2 bg-gray-50 rounded p-2 border border-gray-100">
                            {v.promptText.slice(0, 140)}{v.promptText.length > 140 ? "…" : ""}
                          </p>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {isAdmin && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setRestoreTarget(v)}
                              className="gap-1.5 rounded-lg text-xs"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                              Restore
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setExpanded(isExpanded ? null : v.id)}
                            className="gap-1 rounded-lg text-xs text-gray-500"
                          >
                            {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            {isExpanded ? "Hide" : "Full text"}
                          </Button>
                        </div>
                      </div>
                    </div>

                    {/* Expanded — full prompt text */}
                    {isExpanded && (
                      <div className="border-t border-gray-100 bg-gray-900 p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                            Full Prompt Text — v{v.versionNumber}
                          </span>
                          <span className="text-xs text-gray-500">{v.promptText.length.toLocaleString()} chars</span>
                        </div>
                        <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap overflow-auto max-h-80 leading-relaxed">
                          {v.promptText}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Restore confirm dialog */}
      <Dialog open={!!restoreTarget} onOpenChange={() => setRestoreTarget(null)}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-4 w-4 text-green-600" />
              Restore v{restoreTarget?.versionNumber}?
            </DialogTitle>
            <DialogDescription>
              The current state (v{currentVersion}) will be auto-snapshotted first, then replaced with the content from v{restoreTarget?.versionNumber}.
              The restored prompt will become v{currentVersion + 1}.
            </DialogDescription>
          </DialogHeader>

          {restoreTarget && (
            <div className="space-y-3">
              <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                <p className="text-xs font-semibold text-gray-500 mb-1">Will restore to:</p>
                <p className="text-xs text-gray-600">
                  Model: <span className="font-mono">{restoreTarget.modelProvider} / {restoreTarget.modelName}</span>
                </p>
                <pre className="text-xs text-gray-500 font-mono mt-1 line-clamp-3">
                  {restoreTarget.promptText.slice(0, 200)}…
                </pre>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoreTarget(null)} className="rounded-xl">
              Cancel
            </Button>
            <Button
              onClick={handleRestore}
              disabled={restoring}
              className="bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white rounded-xl gap-2"
            >
              <RotateCcw className="h-4 w-4" />
              {restoring ? "Restoring…" : "Restore"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
