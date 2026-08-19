"use client";

import { useEffect, useState } from "react";
import { Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ContentEngineSettingsClient } from "@/components/settings/content-engine/ContentEngineSettingsClient";
import type { PromptRow } from "@/components/settings/content-engine/types";

// Content Engine ฝังใน Settings (ฟันเฟือง) ของแต่ละ project — scope = { projectId }
// ดึงเฉพาะ prompt ของ project นี้เท่านั้น ห้ามใช้ข้าม scope
const CE_LAYER_TYPES = new Set([
  "CE_BUSINESS_SKILL",
  "CE_MASTER_PROMPT",
  "CE_ARTICLE_BRIEF",
  "CE_VALIDATOR_PACK",
  "CE_IMAGE_PROMPT",
]);

function resolveProjectId(explicit?: string): string | null {
  if (explicit) return explicit;
  if (typeof window === "undefined") return null;
  const match = window.location.pathname.match(/\/projects\/([^/]+)/);
  return match ? match[1] : null;
}

function toPromptRow(p: any): PromptRow {
  return {
    id: p.id,
    name: p.name,
    description: p.description ?? null,
    promptText: p.promptText,
    type: p.type,
    isActive: p.isActive,
    version: p.version,
    updatedAt: String(p.updatedAt ?? ""),
    editorName: p.updatedBy?.name ?? p.createdBy?.name ?? null,
  };
}

export function ProjectContentEngine({ projectId, userRole }: { projectId?: string; userRole: string }) {
  const resolvedProjectId = resolveProjectId(projectId);
  const [items, setItems] = useState<PromptRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!resolvedProjectId) {
      setError("ไม่พบ Project ID — ไม่สามารถโหลด Content Engine ได้");
      return;
    }
    setItems(null);
    setError(null);
    fetch(`/api/prompts?projectId=${resolvedProjectId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(res.status === 403 ? "เฉพาะ ADMIN / SEO Manager เท่านั้น" : `โหลด prompts ไม่สำเร็จ (${res.status})`);
        const prompts = await res.json();
        setItems(
          (Array.isArray(prompts) ? prompts : [])
            .filter((p: { type: string }) => CE_LAYER_TYPES.has(p.type))
            .map(toPromptRow)
        );
      })
      .catch((e) => setError((e as Error).message));
  }, [resolvedProjectId, refreshKey]);

  async function copyFromStudio() {
    if (!resolvedProjectId) return;
    setCopying(true);
    try {
      const res = await fetch("/api/prompts?scope=studio");
      if (!res.ok) throw new Error(`โหลดชุด Studio ไม่สำเร็จ (${res.status})`);
      const studioPrompts = await res.json();
      const activeLayers = (Array.isArray(studioPrompts) ? studioPrompts : []).filter(
        (p: { type: string; isActive: boolean }) => CE_LAYER_TYPES.has(p.type) && p.isActive
      );
      if (activeLayers.length === 0) {
        toast.error("Studio ยังไม่มีชุด Active ให้คัดลอก");
        return;
      }
      for (const layer of activeLayers) {
        await fetch("/api/prompts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: `${layer.name} (copy)`,
            description: layer.description ?? "",
            type: layer.type,
            promptText: layer.promptText,
            projectId: resolvedProjectId,
          }),
        });
      }
      toast.success(`คัดลอก ${activeLayers.length} ชุดจาก Studio แล้ว`);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCopying(false);
    }
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
        {error}
      </div>
    );
  }
  if (!items || !resolvedProjectId) {
    return <div className="p-8 text-sm text-gray-400">กำลังโหลด Content Engine...</div>;
  }

  return (
    <div className="space-y-4">
      {userRole === "ADMIN" && items.length === 0 && (
        <div className="flex items-center justify-between rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/40 px-4 py-3">
          <p className="text-sm text-indigo-700">Project นี้ยังไม่มีชุด Content Engine — เริ่มต้นได้เร็วขึ้นด้วยการคัดลอกชุด Active จาก Studio</p>
          <Button size="sm" className="gap-1.5" disabled={copying} onClick={copyFromStudio}>
            {copying ? <Loader2 className="size-3.5 animate-spin" /> : <Copy className="size-3.5" />}
            คัดลอกชุดเริ่มต้นจาก Studio
          </Button>
        </div>
      )}
      <ContentEngineSettingsClient items={items} scope={{ projectId: resolvedProjectId }} userRole={userRole} />
    </div>
  );
}
