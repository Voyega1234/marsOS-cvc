"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Ban,
  BookOpen,
  CheckCircle2,
  ClipboardList,
  FileCog,
  FlaskConical,
  History,
  Image as ImageIcon,
  LayoutGrid,
  MessageSquareText,
  MinusCircle,
  ShieldCheck,
  XCircle,
} from "lucide-react";

import { CE_FILES_CHANGED_EVENT, commentsLayerStatus, restrictionsLayerStatus, type LayerStatusRow } from "@/lib/ce-layer-status";
import { CE_RESTRICTION_FILE, parseRestrictionFileMeta } from "@/lib/ce-restrictions";
import { SETUP_FLOW, WRITING_FLOW } from "@/lib/ce-run-flow";
import { cn } from "@/lib/utils";
import { CONTENT_TYPES } from "./constants";
import { ArticleBriefsTab } from "./ArticleBriefsTab";
import { BusinessSkillsTab } from "./BusinessSkillsTab";
import { ImagePromptsTab } from "./ImagePromptsTab";
import { MasterPromptsTab } from "./MasterPromptsTab";
import { PromptComposerTab } from "./PromptComposerTab";
import { ClientCommentsTab } from "./ClientCommentsTab";
import { RestrictionsTab } from "./RestrictionsTab";
import { CERefreshContext, SectionCard } from "./shared";
import { ValidatorPacksTab } from "./ValidatorPacksTab";
import { VersionsAuditTab } from "./VersionsAuditTab";
import type { BusinessSkillData, CEScope, MasterPromptData, PromptRow } from "./types";
import { CE_TYPES, scopeProjectId, tryParse } from "./types";

interface Props {
  items: PromptRow[];
  scope: CEScope;
  userRole: string;
  /** ดึงรายการใหม่หลังบันทึก — ไม่ส่ง = router.refresh() (หน้าที่ดึงแถวจาก server component) */
  onRefresh?: () => void;
  /** แท็บที่เปิด (ผู้เรียกคุมเอง) — ไม่ส่ง = คุมในตัว เริ่มที่แท็บแรกที่เห็น */
  tab?: TabKey;
  /** ผู้ใช้กดเปลี่ยนแท็บ — รวมกดไปแท็บที่ซ่อนอยู่ (ผู้เรียกเปิดโหมดเต็มให้ได้) */
  onTabChange?: (tab: TabKey) => void;
  /** แสดงเฉพาะแท็บเหล่านี้ในเมนู — ไม่ส่ง = ทุกแท็บ */
  visibleTabs?: TabKey[];
  /** ซ่อนหัวข้อ + แถบสถานะ layer (ผู้เรียกมีการ์ดสถานะของตัวเอง) */
  hideHeader?: boolean;
}

export type TabKey =
  | "overview"
  | "business-skills"
  | "master-prompts"
  | "article-briefs"
  | "restrictions"
  | "client-comments"
  | "validator-packs"
  | "image-prompts"
  | "prompt-composer"
  | "versions-audit";

/** hint = คำอธิบายภาษาไทยใต้ชื่อแท็บ ให้คนที่ไม่คุ้นศัพท์รู้ว่าแต่ละแท็บคืออะไร */
const TABS: { key: TabKey; label: string; hint: string; icon: typeof LayoutGrid }[] = [
  { key: "overview", label: "Overview", hint: "สถานะทุกส่วน", icon: LayoutGrid },
  { key: "business-skills", label: "Business Skills", hint: "ข้อมูลธุรกิจ", icon: BookOpen },
  { key: "master-prompts", label: "Master Prompts", hint: "สไตล์การเขียน", icon: FileCog },
  { key: "article-briefs", label: "Article Brief Templates", hint: "โครงบทความ", icon: ClipboardList },
  { key: "restrictions", label: "ข้อจำกัด (Restrictions)", hint: "คำต้องห้าม ข้อมูลสินค้า", icon: Ban },
  { key: "client-comments", label: "Comment ลูกค้า", hint: "ข้อติชมที่ลูกค้าสั่ง", icon: MessageSquareText },
  { key: "validator-packs", label: "Validator Packs", hint: "ตัวตรวจคุณภาพ", icon: ShieldCheck },
  { key: "image-prompts", label: "Image Prompts", hint: "แม่แบบรูปภาพ", icon: ImageIcon },
  { key: "prompt-composer", label: "Run Test (ทดสอบการเขียน)", hint: "ดูคำสั่งจริงก่อนเขียน", icon: FlaskConical },
  { key: "versions-audit", label: "Versions & Audit", hint: "ประวัติการแก้", icon: History },
];

/** ชื่อไทยของ layer บนแถบสถานะ */
const LAYER_THAI: Record<string, string> = {
  business: "ข้อมูลธุรกิจ",
  master: "สไตล์การเขียน",
  brief: "โครงบทความ",
  validator: "ตัวตรวจคุณภาพ",
  image: "แม่แบบรูปภาพ",
};

/** หมวดของเมนูซ้าย — ทุกแท็บยังอยู่ครบ แค่จัดกลุ่ม */
const TAB_GROUPS: { label: string; keys: TabKey[] }[] = [
  { label: "ภาพรวม", keys: ["overview"] },
  { label: "ข้อมูลธุรกิจ", keys: ["business-skills"] },
  { label: "วิธีเขียน", keys: ["master-prompts", "article-briefs"] },
  { label: "กฎและข้อจำกัด", keys: ["restrictions", "client-comments"] },
  { label: "คุณภาพและรูป", keys: ["validator-packs", "image-prompts"] },
  { label: "ทดสอบ", keys: ["prompt-composer"] },
  { label: "ประวัติ", keys: ["versions-audit"] },
];

/** on = ใช้งาน · inactive = มีแถวแต่ไม่ Active · blocked = อัปไฟล์แต่ layer ปิด · missing = บังคับแต่ไม่มี · off = ไม่ได้ใช้ */
type LayerState = "on" | "inactive" | "blocked" | "missing" | "off";

interface LayerInfo {
  key: string;
  label: string;
  tab: TabKey;
  required: boolean;
  state: LayerState;
  /** ชื่อ/สรุปที่แสดงข้างสถานะ */
  text: string;
  rowCount: number;
}

const LAYER_STATE_LABEL: Record<LayerState, string> = {
  on: "ใช้งาน",
  inactive: "ยังไม่ Active",
  blocked: "ไฟล์ไม่ถูกส่ง",
  missing: "ยังไม่ตั้ง",
  off: "ไม่ได้ใช้",
};

function StateIcon({ state, className }: { state: LayerState; className?: string }) {
  const Icon = state === "on" ? CheckCircle2 : state === "missing" ? XCircle : state === "off" ? MinusCircle : AlertTriangle;
  return (
    <Icon
      aria-hidden
      className={cn(
        "shrink-0",
        state === "on" && "text-emerald-600",
        state === "missing" && "text-red-600",
        state === "off" && "text-gray-400",
        (state === "inactive" || state === "blocked") && "text-amber-600",
        className
      )}
    />
  );
}

/** นับไฟล์ที่อัปโหลด — ไฟล์เดียวอาจแบ่งหลายแถว รวมตาม group */
function countFiles(rows: LayerStatusRow[]): { restrictions: number; comments: number } {
  const seen = new Set<string>();
  let restrictions = 0;
  let comments = 0;
  for (const r of rows) {
    if (r.type !== CE_RESTRICTION_FILE) continue;
    const meta = parseRestrictionFileMeta(r.description);
    const key = meta.group ?? r.id;
    if (seen.has(key)) continue;
    seen.add(key);
    if (meta.kind === "comment") comments++;
    else restrictions++;
  }
  return { restrictions, comments };
}

export function ContentEngineSettingsClient({ items, scope, userRole, onRefresh, tab: tabProp, onTabChange, visibleTabs, hideHeader }: Props) {
  const router = useRouter();
  const [innerTab, setInnerTab] = useState<TabKey>(() => visibleTabs?.[0] ?? "overview");
  const wanted = tabProp ?? innerTab;
  // แท็บที่ถูกซ่อน (เช่นกดจากการ์ดภาพรวม) — โชว์แท็บแรกที่เห็นแทน ผู้เรียกตัดสินเองผ่าน onTabChange
  const tab: TabKey = visibleTabs && visibleTabs.length && !visibleTabs.includes(wanted) ? visibleTabs[0] : wanted;
  const setTab = useCallback((t: TabKey) => {
    setInnerTab(t);
    onTabChange?.(t);
  }, [onTabChange]);
  const tabGroups = useMemo(
    () => (visibleTabs?.length
      ? TAB_GROUPS.map((g) => ({ ...g, keys: g.keys.filter((k) => visibleTabs.includes(k)) })).filter((g) => g.keys.length)
      : TAB_GROUPS),
    [visibleTabs]
  );
  const [fileRows, setFileRows] = useState<LayerStatusRow[]>([]);
  const refresh = useCallback(() => {
    if (onRefresh) onRefresh();
    else router.refresh();
  }, [onRefresh, router]);
  const canEdit = userRole !== "CLIENT";

  const businessSkills = useMemo(() => items.filter((i) => i.type === CE_TYPES.BUSINESS_SKILL), [items]);
  const masterPrompts = useMemo(() => items.filter((i) => i.type === CE_TYPES.MASTER_PROMPT), [items]);
  const briefTemplates = useMemo(() => items.filter((i) => i.type === CE_TYPES.ARTICLE_BRIEF), [items]);
  const restrictions = useMemo(() => items.filter((i) => i.type === CE_TYPES.RESTRICTIONS), [items]);
  const clientComments = useMemo(() => items.filter((i) => i.type === CE_TYPES.CLIENT_COMMENTS), [items]);
  const validatorPacks = useMemo(() => items.filter((i) => i.type === CE_TYPES.VALIDATOR_PACK), [items]);
  const imagePrompts = useMemo(() => items.filter((i) => i.type === CE_TYPES.IMAGE_PROMPT), [items]);

  // แถวไฟล์ข้อจำกัด/Comment ไม่อยู่ใน items — โหลดเองเพื่อให้สถานะและจำนวนไฟล์ครบ
  const scopeQuery = useMemo(() => {
    const id = scopeProjectId(scope);
    return id ? `projectId=${encodeURIComponent(id)}` : "scope=studio";
  }, [scope]);
  useEffect(() => {
    let alive = true;
    fetch(`/api/prompts?${scopeQuery}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: LayerStatusRow[]) => {
        if (alive) setFileRows((Array.isArray(rows) ? rows : []).filter((r) => r.type === CE_RESTRICTION_FILE));
      })
      .catch(() => {
        if (alive) setFileRows([]);
      });
    const onFiles = (e: Event) => setFileRows((e as CustomEvent<LayerStatusRow[]>).detail ?? []);
    window.addEventListener(CE_FILES_CHANGED_EVENT, onFiles);
    return () => {
      alive = false;
      window.removeEventListener(CE_FILES_CHANGED_EVENT, onFiles);
    };
  }, [scopeQuery]);

  const layers = useMemo<LayerInfo[]>(() => {
    const standard = (key: string, label: string, rows: PromptRow[], tabKey: TabKey, required: boolean): LayerInfo => {
      const active = rows.find((r) => r.isActive);
      if (active) return { key, label, tab: tabKey, required, state: "on", text: `${active.name} v${active.version}`, rowCount: rows.length };
      if (rows.length) return { key, label, tab: tabKey, required, state: "inactive", text: `มี ${rows.length} แถว แต่ไม่มีตัว Active`, rowCount: rows.length };
      return { key, label, tab: tabKey, required, state: required ? "missing" : "off", text: required ? "ยังไม่ตั้ง" : "ไม่บังคับ", rowCount: 0 };
    };
    const statusRows: LayerStatusRow[] = [...restrictions, ...clientComments, ...fileRows];
    const optional = (key: string, label: string, rows: PromptRow[], tabKey: TabKey, st: ReturnType<typeof restrictionsLayerStatus>): LayerInfo => ({
      key,
      label,
      tab: tabKey,
      required: false,
      state: st.state,
      text: st.state === "off" && st.detail === "ไม่ได้ใช้" ? "ไม่บังคับ" : st.detail,
      rowCount: rows.length,
    });
    return [
      standard("business", "Business Skill", businessSkills, "business-skills", scope !== "studio"),
      standard("master", "Master Prompt", masterPrompts, "master-prompts", true),
      standard("brief", "Article Brief", briefTemplates, "article-briefs", true),
      optional("restrictions", "ข้อจำกัด", restrictions, "restrictions", restrictionsLayerStatus(statusRows)),
      optional("comments", "Comment ลูกค้า", clientComments, "client-comments", commentsLayerStatus(statusRows)),
      standard("validator", "Validator Pack", validatorPacks, "validator-packs", true),
      standard("image", "Image Prompt", imagePrompts, "image-prompts", true),
    ];
  }, [businessSkills, masterPrompts, briefTemplates, restrictions, clientComments, validatorPacks, imagePrompts, fileRows, scope]);

  return (
    <CERefreshContext.Provider value={refresh}>
    <div className="space-y-4">
      {!hideHeader && (
      <>
      <div>
        <h1 className="text-xl font-semibold text-brand-navy">Content Engine</h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-500">
          ทุกส่วนด้านล่างรวมกันเป็นคำสั่งที่ AI ใช้เขียนบทความและสร้างรูป ของสโคปนี้เท่านั้น: ข้อมูลธุรกิจ (Business Skill),
          สไตล์การเขียน (Master Prompt), โครงบทความ (Article Brief), ตัวตรวจคุณภาพ (Validator Pack), แม่แบบรูปภาพ (Image Prompt)
          ส่วนข้อจำกัดและ Comment ลูกค้าไม่บังคับ กด Run Test เพื่อดูคำสั่งจริงที่ส่งให้ AI
        </p>
      </div>

      {/* ── แถบสรุป: สถานะจริงของแต่ละ layer (เห็นทุกแท็บ) ──────────────────────── */}
      <div className="flex flex-wrap gap-1.5">
        {layers.map((l) => (
          <button
            key={l.key}
            type="button"
            onClick={() => setTab(l.tab)}
            title={`${l.label} · ${LAYER_STATE_LABEL[l.state]} · ${l.text}`}
            className={cn(
              "flex max-w-[260px] items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
              l.state === "on" && "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
              l.state === "off" && "border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100",
              (l.state === "inactive" || l.state === "blocked") && "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100",
              l.state === "missing" && "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
            )}
          >
            <StateIcon state={l.state} className="size-3 text-current" />
            <span className="shrink-0">
              {LAYER_THAI[l.key] ?? l.label}
              {LAYER_THAI[l.key] && <span className="ml-1 font-normal opacity-60">{l.label}</span>}:
            </span>
            <span className="truncate">{l.text}</span>
          </button>
        ))}
      </div>
      </>
      )}

      <div className="flex flex-col gap-4 md:flex-row">
        {/* ── Left rail nav แบ่งหมวดด้วยเส้นคั่น (ชื่อหมวดอยู่ใน aria-label ไม่โชว์ — คำไทยใต้ชื่อแท็บพอแล้ว) — แถบเลื่อนแนวนอนบนมือถือ ── */}
        <nav className="flex shrink-0 items-stretch gap-2 overflow-x-auto rounded-2xl border border-gray-200 bg-white p-1.5 md:w-56 md:flex-col md:gap-1 md:overflow-visible md:p-2">
          {tabGroups.map((g) => (
            <div
              key={g.label}
              role="group"
              aria-label={g.label}
              className="flex shrink-0 items-center gap-1 border-l border-gray-200 pl-2 first:border-l-0 first:pl-0 md:flex-col md:items-stretch md:border-l-0 md:pl-0 md:[&:not(:first-child)]:border-t md:[&:not(:first-child)]:pt-1.5"
            >
              {g.keys.map((k) => {
                const t = TABS.find((x) => x.key === k)!;
                const Icon = t.icon;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTab(t.key)}
                    aria-current={tab === t.key ? "page" : undefined}
                    title={t.hint}
                    className={cn(
                      "flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors md:w-full",
                      tab === t.key ? "bg-indigo-600 text-white" : "text-gray-600 hover:bg-gray-100"
                    )}
                  >
                    <Icon className="size-3.5 shrink-0" />
                    <span className="flex flex-col leading-tight">
                      {t.label}
                      <span className={cn("text-[10px] font-normal", tab === t.key ? "text-indigo-100" : "text-gray-400")}>{t.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="min-w-0 flex-1">
          {tab === "overview" && (
            <OverviewTab
              scope={scope}
              layers={layers}
              businessSkills={businessSkills}
              masterPrompts={masterPrompts}
              briefTemplates={briefTemplates}
              restrictions={restrictions}
              clientComments={clientComments}
              validatorPacks={validatorPacks}
              imagePrompts={imagePrompts}
              fileCounts={countFiles(fileRows)}
              onJump={setTab}
            />
          )}
          {tab === "business-skills" && <BusinessSkillsTab items={businessSkills} scope={scope} canEdit={canEdit} />}
          {tab === "master-prompts" && <MasterPromptsTab items={masterPrompts} scope={scope} canEdit={canEdit} />}
          {tab === "article-briefs" && <ArticleBriefsTab items={briefTemplates} scope={scope} canEdit={canEdit} />}
          {tab === "restrictions" && <RestrictionsTab items={restrictions} scope={scope} canEdit={canEdit} />}
          {tab === "client-comments" && <ClientCommentsTab items={clientComments} scope={scope} canEdit={canEdit} />}
          {tab === "validator-packs" && <ValidatorPacksTab items={validatorPacks} scope={scope} canEdit={canEdit} />}
          {tab === "image-prompts" && <ImagePromptsTab items={imagePrompts} scope={scope} canEdit={canEdit} />}
          {tab === "prompt-composer" && (
            <PromptComposerTab
              scope={scope}
              businessSkills={businessSkills}
              masterPrompts={masterPrompts}
              briefTemplates={briefTemplates}
              restrictions={restrictions}
              clientComments={clientComments}
              validatorPacks={validatorPacks}
              imagePrompts={imagePrompts}
            />
          )}
          {tab === "versions-audit" && <VersionsAuditTab items={items} />}
        </div>
      </div>
    </div>
    </CERefreshContext.Provider>
  );
}

function OverviewTab({
  scope,
  layers,
  businessSkills,
  masterPrompts,
  briefTemplates,
  restrictions,
  clientComments,
  validatorPacks,
  imagePrompts,
  fileCounts,
  onJump,
}: {
  scope: CEScope;
  layers: LayerInfo[];
  businessSkills: PromptRow[];
  masterPrompts: PromptRow[];
  briefTemplates: PromptRow[];
  restrictions: PromptRow[];
  clientComments: PromptRow[];
  validatorPacks: PromptRow[];
  imagePrompts: PromptRow[];
  fileCounts: { restrictions: number; comments: number };
  onJump: (tab: TabKey) => void;
}) {
  const activeMasterPrompts = masterPrompts.filter((i) => i.isActive);

  const activePromptContentTypes = new Set(
    activeMasterPrompts.map((i) => tryParse<MasterPromptData>(i.promptText)?.contentType).filter(Boolean)
  );
  const contentTypesMissingPrompt = CONTENT_TYPES.filter((ct) => !activePromptContentTypes.has(ct)).length;

  const draftsWaitingApproval = [
    ...businessSkills,
    ...masterPrompts,
    ...briefTemplates,
    ...restrictions,
    ...clientComments,
    ...validatorPacks,
    ...imagePrompts,
  ].filter((i) => tryParse<{ status?: string }>(i.promptText)?.status === "In Review").length;

  const highRiskMissingReviewer = businessSkills.filter((i) => {
    const d = tryParse<BusinessSkillData>(i.promptText);
    if (!d) return false;
    const highRisk = d.riskLevel === "high" || d.riskLevel === "critical";
    return highRisk && !d.expertReviewer?.name?.trim();
  }).length;

  const activeCount = (key: string) => (layers.find((l) => l.key === key)?.state === "on" ? 1 : 0);
  const activeOf = (rows: PromptRow[]) => rows.filter((i) => i.isActive).length;

  // เฉพาะตัวเลขที่คำนวณจากข้อมูลจริงเท่านั้น — ไม่มี mock
  const cards: { label: string; value: number | string; onClick?: () => void }[] = [
    { label: "Active Business Skills", value: activeOf(businessSkills), onClick: () => onJump("business-skills") },
    { label: "Active Master Prompts", value: activeMasterPrompts.length, onClick: () => onJump("master-prompts") },
    { label: "Active Brief Templates", value: activeOf(briefTemplates), onClick: () => onJump("article-briefs") },
    { label: "ข้อจำกัดที่ใช้งาน (ส่งเข้า AI)", value: activeCount("restrictions"), onClick: () => onJump("restrictions") },
    { label: "Comment ลูกค้าที่ใช้งาน (ส่งเข้า AI)", value: activeCount("comments"), onClick: () => onJump("client-comments") },
    { label: "Active Validator Packs", value: activeOf(validatorPacks), onClick: () => onJump("validator-packs") },
    { label: "Active Image Prompts", value: activeOf(imagePrompts), onClick: () => onJump("image-prompts") },
    { label: "ไฟล์ข้อจำกัดที่อัปโหลด", value: fileCounts.restrictions, onClick: () => onJump("restrictions") },
    { label: "ไฟล์ Comment ที่อัปโหลด", value: fileCounts.comments, onClick: () => onJump("client-comments") },
    { label: "Content Types Missing Prompt", value: contentTypesMissingPrompt, onClick: () => onJump("master-prompts") },
    { label: "Draft Versions Waiting Approval", value: draftsWaitingApproval },
    { label: "High-Risk Business Skills Missing Expert Reviewer", value: highRiskMissingReviewer, onClick: () => onJump("business-skills") },
  ];

  const quickActions: { label: string; onClick: () => void }[] = [
    { label: "Create Business Skill", onClick: () => onJump("business-skills") },
    { label: "Create Master Prompt", onClick: () => onJump("master-prompts") },
    { label: "Create Brief Template", onClick: () => onJump("article-briefs") },
    { label: "ตั้งข้อจำกัด / อัปไฟล์", onClick: () => onJump("restrictions") },
    { label: "เพิ่ม Comment ลูกค้า", onClick: () => onJump("client-comments") },
    { label: "Create Validator Pack", onClick: () => onJump("validator-packs") },
    { label: "Create Image Prompt", onClick: () => onJump("image-prompts") },
    { label: "Run Test การเขียน (ไม่เสียเงิน)", onClick: () => onJump("prompt-composer") },
  ];

  const required = layers.filter((l) => l.required);
  const requiredCount = required.length;
  const readyRequiredCount = required.filter((l) => l.state === "on").length;
  const isReady = readyRequiredCount === requiredCount;
  const layerByLabel = new Map(layers.map((l) => [l.tab as string, l]));

  return (
    <div className="space-y-4">
      <SectionCard
        title="ความพร้อมของชุด prompt"
        description={
          scope === "studio"
            ? "สโคป Studio — ต้องมี Layer บังคับพร้อมใช้งาน (Business Skill, ข้อจำกัด, Comment ไม่บังคับ)"
            : "สโคป Project — Business Skill, Master Prompt, Article Brief, Validator Pack, Image Prompt ต้องพร้อมก่อนใช้เครื่องมือ (ข้อจำกัด, Comment ไม่บังคับ)"
        }
        action={
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold",
              isReady ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
            )}
          >
            {isReady ? <CheckCircle2 className="size-3.5" aria-hidden /> : <AlertTriangle className="size-3.5" aria-hidden />}
            {readyRequiredCount}/{requiredCount} บังคับพร้อม
          </span>
        }
      >
        <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))]">
          {layers.map((l) => (
            <button
              key={l.key}
              type="button"
              onClick={() => onJump(l.tab)}
              className="flex items-start gap-2 rounded-md border border-gray-100 px-3 py-2 text-left text-xs transition-colors hover:border-indigo-300 hover:bg-indigo-50/40"
            >
              <StateIcon state={l.state} className="mt-0.5 size-4" />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-1.5">
                  <span className="font-semibold text-gray-800">{l.label}</span>
                  <span className={cn("rounded px-1 text-[10px] font-medium", l.required ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600")}>
                    {l.required ? "บังคับ" : "ไม่บังคับ"}
                  </span>
                </span>
                <span className="mt-0.5 block text-gray-700">{LAYER_STATE_LABEL[l.state]}</span>
                <span className="block break-words text-gray-500">{l.text}</span>
              </span>
            </button>
          ))}
        </div>
      </SectionCard>

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr))]">
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
            <p className="mt-1 break-words text-xs text-gray-500">{c.label}</p>
          </button>
        ))}
      </div>

      <SectionCard title="Configuration Flow" description="ลำดับตั้งค่า (กดเพื่อไปแท็บนั้น) และลำดับที่ระบบทำตอนเขียนบทความจริง">
        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-xs font-semibold text-gray-700">1. ตั้งค่า</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {SETUP_FLOW.map((c, idx) => {
                const info = layerByLabel.get(c.tab);
                return (
                  <div key={c.label} className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onJump(c.tab as TabKey)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-700 transition-colors hover:border-indigo-300 hover:bg-indigo-50"
                    >
                      {info && <StateIcon state={info.state} className="size-3.5" />}
                      {c.label}
                      {c.hint && <span className="font-normal text-gray-500">({c.hint})</span>}
                      {c.optional && <span className="font-normal text-gray-500">(ไม่บังคับ)</span>}
                    </button>
                    {idx < SETUP_FLOW.length - 1 && <span aria-hidden className="text-gray-300">→</span>}
                  </div>
                );
              })}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-semibold text-gray-700">2. ตอนเขียนบทความ</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {WRITING_FLOW.map((c, idx) => (
                <div key={c.label} className="flex items-center gap-1.5">
                  {c.label === "Run Test" ? (
                    <button
                      type="button"
                      onClick={() => onJump("prompt-composer")}
                      className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-800 hover:bg-indigo-100"
                    >
                      <FlaskConical className="size-3.5" aria-hidden /> {c.label}
                      {c.hint && <span className="font-normal">({c.hint})</span>}
                    </button>
                  ) : (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
                        c.inTest ? "border-indigo-200 bg-indigo-50 text-indigo-800" : "border-dashed border-gray-300 bg-white text-gray-700"
                      )}
                    >
                      {c.label}
                      {c.hint && <span className="font-normal text-gray-500">({c.hint})</span>}
                    </span>
                  )}
                  {idx < WRITING_FLOW.length - 1 && <span aria-hidden className="text-gray-300">→</span>}
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-gray-500">พื้นฟ้า = Run Test ทำให้ดูได้ · เส้นประ = เกิดตอนกดเขียนจริงเท่านั้น</p>
          </div>
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
