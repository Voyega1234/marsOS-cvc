"use client";

import { useMemo, useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  ClipboardList,
  FileCog,
  FlaskConical,
  History,
  Image as ImageIcon,
  LayoutGrid,
  ShieldCheck,
  XCircle,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { CONTENT_TYPES } from "./constants";
import { ArticleBriefsTab } from "./ArticleBriefsTab";
import { BusinessSkillsTab } from "./BusinessSkillsTab";
import { ImagePromptsTab } from "./ImagePromptsTab";
import { MasterPromptsTab } from "./MasterPromptsTab";
import { PromptComposerTab } from "./PromptComposerTab";
import { SectionCard } from "./shared";
import { ValidatorPacksTab } from "./ValidatorPacksTab";
import { VersionsAuditTab } from "./VersionsAuditTab";
import type { BusinessSkillData, CEScope, MasterPromptData, PromptRow } from "./types";
import { CE_TYPES, tryParse } from "./types";

interface Props {
  items: PromptRow[];
  scope: CEScope;
  userRole: string;
}

type TabKey =
  | "overview"
  | "business-skills"
  | "master-prompts"
  | "article-briefs"
  | "validator-packs"
  | "image-prompts"
  | "prompt-composer"
  | "versions-audit";

const TABS: { key: TabKey; label: string; icon: typeof LayoutGrid }[] = [
  { key: "overview", label: "Overview", icon: LayoutGrid },
  { key: "business-skills", label: "Business Skills", icon: BookOpen },
  { key: "master-prompts", label: "Master Prompts", icon: FileCog },
  { key: "article-briefs", label: "Article Brief Templates", icon: ClipboardList },
  { key: "validator-packs", label: "Validator Packs", icon: ShieldCheck },
  { key: "image-prompts", label: "Image Prompts", icon: ImageIcon },
  { key: "prompt-composer", label: "Prompt Composer & Test", icon: FlaskConical },
  { key: "versions-audit", label: "Versions & Audit", icon: History },
];

const CONFIG_FLOW = [
  "Business Skill",
  "Content Type",
  "Master Prompt",
  "Article Brief",
  "Validator Pack",
  "Image Prompt",
  "Website Connection",
  "Prompt Compilation",
  "Draft",
  "Validation",
  "Approval",
  "CMS Draft",
  "Publish",
  "Verify",
];

export function ContentEngineSettingsClient({ items, scope, userRole }: Props) {
  const [tab, setTab] = useState<TabKey>("overview");
  const canEdit = userRole === "ADMIN";

  const businessSkills = useMemo(() => items.filter((i) => i.type === CE_TYPES.BUSINESS_SKILL), [items]);
  const masterPrompts = useMemo(() => items.filter((i) => i.type === CE_TYPES.MASTER_PROMPT), [items]);
  const briefTemplates = useMemo(() => items.filter((i) => i.type === CE_TYPES.ARTICLE_BRIEF), [items]);
  const validatorPacks = useMemo(() => items.filter((i) => i.type === CE_TYPES.VALIDATOR_PACK), [items]);
  const imagePrompts = useMemo(() => items.filter((i) => i.type === CE_TYPES.IMAGE_PROMPT), [items]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-brand-navy">Content Engine</h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-500">
          กำหนด 5 Layer ที่ประกอบกันเป็นคำสั่งเขียนบทความและสร้างภาพ — Business Skill (ความรู้ระดับธุรกิจ) + Master Prompt
          (มาตรฐานระดับเอเจนซี่) + Article Brief (คำสั่งเฉพาะบทความ) + Validator Pack (ชุดตรวจคุณภาพ) + Image Prompt
          (แม่แบบสร้างภาพประกอบ) ={" "}
          <span className="font-medium text-gray-700">Compiled Writing Instruction</span> ที่ใช้สร้าง Draft, ตรวจสอบ,
          และอนุมัติก่อน Publish — เฉพาะสโคปนี้เท่านั้น
        </p>
      </div>

      {/* ── แถบสรุป: Active prompt ของแต่ละ layer (เห็นทุกแท็บ) ────────────────── */}
      <div className="flex flex-wrap gap-1.5">
        {([
          { label: "Business Skill", rows: businessSkills, optional: scope === "studio", jump: "business-skills" as TabKey },
          { label: "Master Prompt", rows: masterPrompts, optional: false, jump: "master-prompts" as TabKey },
          { label: "Article Brief", rows: briefTemplates, optional: false, jump: "article-briefs" as TabKey },
          { label: "Validator", rows: validatorPacks, optional: false, jump: "validator-packs" as TabKey },
          { label: "Image Prompt", rows: imagePrompts, optional: false, jump: "image-prompts" as TabKey },
        ]).map((l) => {
          const active = l.rows.find((r) => r.isActive);
          return (
            <button
              key={l.label}
              type="button"
              onClick={() => setTab(l.jump)}
              title={active ? `Active: ${active.name} v${active.version}` : "ยังไม่มีตัว Active — คลิกเพื่อตั้งค่า"}
              className={cn(
                "flex max-w-[260px] items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                active
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                  : l.optional
                    ? "border-gray-200 bg-gray-50 text-gray-400 hover:bg-gray-100"
                    : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
              )}
            >
              {active ? <CheckCircle2 className="size-3 shrink-0" /> : <XCircle className="size-3 shrink-0" />}
              <span className="shrink-0">{l.label}:</span>
              <span className="truncate">
                {active ? `${active.name} v${active.version}` : l.optional ? "ไม่บังคับ" : "ยังไม่ตั้ง"}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-4 md:flex-row">
        {/* ── Left rail nav (Apollo-style) — horizontal scroll strip on mobile ── */}
        <nav className="flex shrink-0 gap-1 overflow-x-auto rounded-2xl border border-gray-200 bg-white p-1.5 md:w-56 md:flex-col md:overflow-visible md:p-2">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn(
                  "flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm font-medium transition-colors md:w-full",
                  tab === t.key ? "bg-indigo-600 text-white" : "text-gray-600 hover:bg-gray-100"
                )}
              >
                <Icon className="size-3.5 shrink-0" /> {t.label}
              </button>
            );
          })}
        </nav>

        <div className="min-w-0 flex-1">
          {tab === "overview" && (
            <OverviewTab
              scope={scope}
              businessSkills={businessSkills}
              masterPrompts={masterPrompts}
              briefTemplates={briefTemplates}
              validatorPacks={validatorPacks}
              imagePrompts={imagePrompts}
              onJump={setTab}
            />
          )}
          {tab === "business-skills" && <BusinessSkillsTab items={businessSkills} scope={scope} canEdit={canEdit} />}
          {tab === "master-prompts" && <MasterPromptsTab items={masterPrompts} scope={scope} canEdit={canEdit} />}
          {tab === "article-briefs" && <ArticleBriefsTab items={briefTemplates} scope={scope} canEdit={canEdit} />}
          {tab === "validator-packs" && <ValidatorPacksTab items={validatorPacks} scope={scope} canEdit={canEdit} />}
          {tab === "image-prompts" && <ImagePromptsTab items={imagePrompts} scope={scope} canEdit={canEdit} />}
          {tab === "prompt-composer" && (
            <PromptComposerTab
              businessSkills={businessSkills}
              masterPrompts={masterPrompts}
              briefTemplates={briefTemplates}
              validatorPacks={validatorPacks}
            />
          )}
          {tab === "versions-audit" && <VersionsAuditTab items={items} />}
        </div>
      </div>
    </div>
  );
}

function OverviewTab({
  scope,
  businessSkills,
  masterPrompts,
  briefTemplates,
  validatorPacks,
  imagePrompts,
  onJump,
}: {
  scope: CEScope;
  businessSkills: PromptRow[];
  masterPrompts: PromptRow[];
  briefTemplates: PromptRow[];
  validatorPacks: PromptRow[];
  imagePrompts: PromptRow[];
  onJump: (tab: TabKey) => void;
}) {
  const activeBusinessSkills = businessSkills.filter((i) => i.isActive);
  const activeMasterPrompts = masterPrompts.filter((i) => i.isActive);
  const activeBriefTemplates = briefTemplates.filter((i) => i.isActive);
  const activeValidatorPacks = validatorPacks.filter((i) => i.isActive);
  const activeImagePrompts = imagePrompts.filter((i) => i.isActive);

  const activePromptContentTypes = new Set(
    activeMasterPrompts.map((i) => tryParse<MasterPromptData>(i.promptText)?.contentType).filter(Boolean)
  );
  const contentTypesMissingPrompt = CONTENT_TYPES.filter((ct) => !activePromptContentTypes.has(ct)).length;

  const draftsWaitingApproval = [...businessSkills, ...masterPrompts, ...briefTemplates, ...validatorPacks, ...imagePrompts].filter(
    (i) => tryParse<{ status?: string }>(i.promptText)?.status === "In Review"
  ).length;

  const highRiskMissingReviewer = businessSkills.filter((i) => {
    const d = tryParse<BusinessSkillData>(i.promptText);
    if (!d) return false;
    const highRisk = d.riskLevel === "high" || d.riskLevel === "critical";
    return highRisk && !d.expertReviewer?.name?.trim();
  }).length;

  // เฉพาะตัวเลขที่คำนวณจากข้อมูลจริงเท่านั้น — ไม่มี mock
  const cards: { label: string; value: number | string; onClick?: () => void }[] = [
    { label: "Active Business Skills", value: activeBusinessSkills.length, onClick: () => onJump("business-skills") },
    { label: "Active Master Prompts", value: activeMasterPrompts.length, onClick: () => onJump("master-prompts") },
    { label: "Active Brief Templates", value: activeBriefTemplates.length, onClick: () => onJump("article-briefs") },
    { label: "Active Validator Packs", value: activeValidatorPacks.length, onClick: () => onJump("validator-packs") },
    { label: "Active Image Prompts", value: activeImagePrompts.length, onClick: () => onJump("image-prompts") },
    { label: "Content Types Missing Prompt", value: contentTypesMissingPrompt, onClick: () => onJump("master-prompts") },
    { label: "Draft Versions Waiting Approval", value: draftsWaitingApproval },
    { label: "High-Risk Business Skills Missing Expert Reviewer", value: highRiskMissingReviewer, onClick: () => onJump("business-skills") },
  ];

  const quickActions: { label: string; onClick: () => void }[] = [
    { label: "Create Business Skill", onClick: () => onJump("business-skills") },
    { label: "Create Master Prompt", onClick: () => onJump("master-prompts") },
    { label: "Create Brief Template", onClick: () => onJump("article-briefs") },
    { label: "Create Validator Pack", onClick: () => onJump("validator-packs") },
    { label: "Create Image Prompt", onClick: () => onJump("image-prompts") },
    { label: "Test Prompt Compilation", onClick: () => onJump("prompt-composer") },
  ];

  const readinessLayers: { label: string; ready: boolean; required: boolean }[] = [
    { label: "Business Skill", ready: activeBusinessSkills.length > 0, required: scope !== "studio" },
    { label: "Master Prompt", ready: activeMasterPrompts.length > 0, required: true },
    { label: "Article Brief", ready: activeBriefTemplates.length > 0, required: true },
    { label: "Validator Pack", ready: activeValidatorPacks.length > 0, required: true },
    { label: "Image Prompt", ready: activeImagePrompts.length > 0, required: true },
  ];
  const requiredCount = readinessLayers.filter((l) => l.required).length;
  const readyRequiredCount = readinessLayers.filter((l) => l.required && l.ready).length;
  const isReady = readyRequiredCount === requiredCount;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((c) => (
          <button
            key={c.label}
            type="button"
            onClick={c.onClick}
            disabled={!c.onClick}
            className={cn(
              "rounded-2xl border border-gray-200 bg-white p-4 text-left transition-colors",
              c.onClick && "hover:border-indigo-300 hover:bg-indigo-50/40"
            )}
          >
            <p className="text-2xl font-semibold text-brand-navy">{c.value}</p>
            <p className="mt-1 text-xs text-gray-500">{c.label}</p>
          </button>
        ))}
      </div>

      <SectionCard
        title="ความพร้อมของชุด prompt"
        description={
          scope === "studio"
            ? "สโคป Studio — ต้องมี 4 Layer พร้อมใช้งาน (Business Skill ไม่บังคับ)"
            : "สโคป Project — ต้องมีครบทั้ง 5 Layer ก่อนใช้เครื่องมือ"
        }
        action={
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-semibold",
              isReady ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
            )}
          >
            {readyRequiredCount}/{requiredCount} พร้อม
          </span>
        }
      >
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {readinessLayers.map((l) => (
            <div key={l.label} className="flex items-center justify-between rounded-md border border-gray-100 px-3 py-2 text-xs">
              <span className="text-gray-600">
                {l.label}
                {!l.required && <span className="ml-1 text-gray-400">(ไม่บังคับ)</span>}
              </span>
              {l.ready ? (
                <CheckCircle2 className="size-4 text-green-600" />
              ) : (
                <XCircle className={cn("size-4", l.required ? "text-red-500" : "text-gray-300")} />
              )}
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-gray-400">ต้องครบก่อนใช้เครื่องมือ</p>
      </SectionCard>

      <SectionCard title="Configuration Flow">
        <div className="flex flex-wrap items-center gap-1.5">
          {CONFIG_FLOW.map((step, idx) => (
            <div key={step} className="flex items-center gap-1.5">
              <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-600">{step}</span>
              {idx < CONFIG_FLOW.length - 1 && <span className="text-gray-300">→</span>}
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Quick Actions">
        <div className="grid gap-2 sm:grid-cols-2">
          {quickActions.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={a.onClick}
              className="rounded-lg border border-gray-200 px-3 py-2 text-left text-xs font-medium text-gray-700 transition-colors hover:border-indigo-300 hover:bg-indigo-50/40"
            >
              {a.label}
            </button>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
