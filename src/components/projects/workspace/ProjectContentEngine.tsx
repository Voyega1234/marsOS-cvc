"use client";

import { useEffect, useState } from "react";
import { Copy, Loader2, Settings2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ContentEngineSettingsClient, type TabKey } from "@/components/settings/content-engine/ContentEngineSettingsClient";
import type { PromptRow } from "@/components/settings/content-engine/types";

// Content Engine ฝังใน Settings (ฟันเฟือง) ของแต่ละ project — scope = { projectId }
// ดึงเฉพาะ prompt ของ project นี้เท่านั้น ห้ามใช้ข้าม scope
const CE_LAYER_TYPES = new Set([
  "CE_BUSINESS_SKILL",
  "CE_MASTER_PROMPT",
  "CE_ARTICLE_BRIEF",
  "CE_VALIDATOR_PACK",
  "CE_IMAGE_PROMPT",
  "CE_RESTRICTIONS",
  "CE_CLIENT_COMMENTS",
]);
// ข้อจำกัดและ Comment ไม่คัดลอกจาก Studio — เป็นของลูกค้ารายนี้ และผูกกับไฟล์ของสโคปตัวเอง
const OPTIONAL_LAYER_TYPES = new Set(["CE_RESTRICTIONS", "CE_CLIENT_COMMENTS"]);
const STUDIO_COPY_TYPES = new Set(Array.from(CE_LAYER_TYPES).filter((t) => !OPTIONAL_LAYER_TYPES.has(t)));

// layer บังคับของ SME — ตรงกับที่ Setup Checklist (setup-checklist/route.ts) ต้องมีให้ครบ
const REQUIRED_TYPES = ["CE_BUSINESS_SKILL", "CE_MASTER_PROMPT", "CE_ARTICLE_BRIEF", "CE_VALIDATOR_PACK", "CE_IMAGE_PROMPT"];
const LAYER_LABELS: Record<string, string> = {
  CE_BUSINESS_SKILL: "Business Skill",
  CE_MASTER_PROMPT: "Master Prompt",
  CE_ARTICLE_BRIEF: "Article Brief",
  CE_VALIDATOR_PACK: "Validator Pack",
  CE_IMAGE_PROMPT: "Image Prompt",
};
/** กดชิป layer → เปิดแท็บของ layer นั้น (เข้าโหมดขั้นสูงให้เอง) — ทางเข้าจาก Checklist "ขาด Business Skill" ฯลฯ */
const LAYER_TAB: Record<string, TabKey> = {
  CE_BUSINESS_SKILL: "business-skills",
  CE_MASTER_PROMPT: "master-prompts",
  CE_ARTICLE_BRIEF: "article-briefs",
  CE_VALIDATOR_PACK: "validator-packs",
  CE_IMAGE_PROMPT: "image-prompts",
};
/** โหมดปกติเห็นแค่แท็บงานประจำ — ที่เหลืออยู่หลังโหมดขั้นสูง (เหมือน Upload Article) */
const SIMPLE_TABS: TabKey[] = ["client-comments", "restrictions"];
const ADVANCED_KEY = "mars_ce_advanced";

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
  // โหมดขั้นสูง: แท็บ CE ครบชุด + ปุ่มคัดลอกจาก Studio — จำไว้ต่อเครื่อง (key เดียวกับ Upload Article)
  const [advanced, setAdvancedState] = useState(false);
  const [ceTab, setCeTab] = useState<TabKey>("client-comments");
  useEffect(() => {
    try { if (localStorage.getItem(ADVANCED_KEY) === "1") setAdvancedState(true); } catch { /* storage ปิด — ใช้โหมดปกติ */ }
  }, []);
  function setAdvanced(on: boolean) {
    setAdvancedState(on);
    if (!on && !SIMPLE_TABS.includes(ceTab)) setCeTab(SIMPLE_TABS[0]);
    try { localStorage.setItem(ADVANCED_KEY, on ? "1" : "0"); } catch { /* ไม่จำก็ได้ */ }
  }
  function openCeTab(t: TabKey) {
    setCeTab(t);
    if (!SIMPLE_TABS.includes(t)) setAdvanced(true);
  }

  useEffect(() => {
    if (!resolvedProjectId) {
      setError("ไม่พบ Project ID — ไม่สามารถโหลด Content Engine ได้");
      return;
    }
    // รีเฟรชหลังบันทึก (refreshKey เปลี่ยน) ห้ามล้าง items — ถ้า items เป็น null
    // จะ unmount ContentEngineSettingsClient แล้ว state แท็บ/ร่างที่กำลังแก้หายหมด
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
        (p: { type: string; isActive: boolean }) => STUDIO_COPY_TYPES.has(p.type) && p.isActive
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

  const missingTypes = REQUIRED_TYPES.filter((t) => !items.some((p) => p.type === t && p.isActive));

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={`text-sm font-semibold ${missingTypes.length === 0 ? "text-emerald-700" : "text-amber-700"}`}>
            {missingTypes.length === 0
              ? "✓ พร้อมเขียนบทความ — layer บังคับครบ"
              : `ยังเขียนบทความไม่ได้: ขาด ${missingTypes.map((t) => LAYER_LABELS[t]).join(", ")}`}
          </p>
          <Button size="sm" variant={advanced ? "default" : "outline"} onClick={() => setAdvanced(!advanced)} aria-pressed={advanced}>
            <Settings2 size={12} className="mr-1.5" /> {advanced ? "ปิดโหมดขั้นสูง" : "โหมดขั้นสูง"}
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {REQUIRED_TYPES.map((t) => {
            const active = items.some((p) => p.type === t && p.isActive);
            return (
              <button
                key={t}
                type="button"
                onClick={() => openCeTab(LAYER_TAB[t])}
                title={`เปิด ${LAYER_LABELS[t]}`}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border hover:underline ${active ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}
              >
                {active ? "✓" : "✕"} {LAYER_LABELS[t]}
              </button>
            );
          })}
        </div>
      </div>
      {/* โปรเจกต์ใหม่ยังไม่มีชุด CE — โชว์ทั้งสองโหมด (ทางลัดตั้งค่าครั้งแรก ไม่ต้องหาในโหมดขั้นสูง) */}
      {userRole !== "CLIENT" && items.every((i) => OPTIONAL_LAYER_TYPES.has(i.type)) && (
        <div className="flex items-center justify-between rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/40 px-4 py-3">
          <p className="text-sm text-indigo-700">Project นี้ยังไม่มีชุด Content Engine — เริ่มต้นได้เร็วขึ้นด้วยการคัดลอกชุด Active จาก Studio</p>
          <Button size="sm" className="gap-1.5" disabled={copying} onClick={copyFromStudio}>
            {copying ? <Loader2 className="size-3.5 animate-spin" /> : <Copy className="size-3.5" />}
            คัดลอกชุดเริ่มต้นจาก Studio
          </Button>
        </div>
      )}
      <ContentEngineSettingsClient
        items={items}
        scope={{ projectId: resolvedProjectId }}
        userRole={userRole}
        onRefresh={() => setRefreshKey((k) => k + 1)}
        tab={ceTab}
        onTabChange={openCeTab}
        visibleTabs={advanced ? undefined : SIMPLE_TABS}
        hideHeader={!advanced}
      />
    </div>
  );
}
