// ─────────────────────────────────────────────────────────────────────────────
//  Content Engine Resolver — แหล่ง prompt เดียวของระบบเขียนบทความ
//
//  กติกา (คำสั่งผู้ใช้ 2026-08-06 — strict):
//  - หน้า Article/Studio ห้ามสร้าง prompt เอง ต้องดึงจาก Content Engine เท่านั้น
//  - เรียงลำดับ: Business Skill → Master Prompt → Article Brief → Validator Pack → Image Prompt
//  - PromptTemplate.projectId = X → เป็นของ project X เท่านั้น
//  - PromptTemplate.projectId = null (CE_* types) → เป็นของ Studio เท่านั้น
//  - ห้าม cross-scope, ห้าม org-level fallback, ห้าม auto-bootstrap
//  - เครื่องมือที่ scope ขาด prompt ที่จำเป็น → FAIL พร้อมข้อความไทยบอกให้ตั้งค่า
//    Content Engine ก่อน (ดู resolveContentEngine.missing)
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";

export interface ResolvedLayer {
  id: string;
  name: string;
  version: number;
  text: string;
}

export type CEScope = { projectId: string } | "studio";

export interface ResolvedCE {
  businessSkill: ResolvedLayer | null;
  masterPrompt: ResolvedLayer | null;
  articleBrief: ResolvedLayer | null;
  validatorPack: ResolvedLayer | null;
  imagePrompt: ResolvedLayer | null;
  /** Thai labels ของ required layer ที่ขาดไป (scope นี้ใช้งานไม่ได้ถ้ามีรายการ) */
  missing: string[];
  scope: "project" | "studio";
}

// ── render promptText (JSON structured หรือ legacy free text) เป็นข้อความ ──────

type Dict = Record<string, unknown>;

function tryParse(text: string): Dict | null {
  try {
    const p = JSON.parse(text);
    return p && typeof p === "object" ? (p as Dict) : null;
  } catch {
    return null;
  }
}

function renderFieldValues(v: unknown, indent = ""): string {
  if (!v || typeof v !== "object") return "";
  return Object.entries(v as Dict)
    .filter(([, val]) => typeof val === "string" && val.trim())
    .map(([k, val]) => `${indent}${k}: ${String(val).trim()}`)
    .join("\n");
}

function renderList(items: unknown, label: string): string {
  if (!Array.isArray(items) || !items.length) return "";
  const body = items
    .map((it, i) => {
      const t = renderFieldValues(it, "  ");
      return t ? `${i + 1}.\n${t}` : "";
    })
    .filter(Boolean)
    .join("\n");
  return body ? `\n[${label}]\n${body}` : "";
}

function section(title: string, body: string): string {
  if (!body.trim()) return "";
  return `\n==================================================\n${title}\n==================================================\n${body.trim()}\n`;
}

function renderBusinessSkill(raw: string): string {
  const d = tryParse(raw);
  if (!d) return raw; // legacy free text
  const parts = [
    d.industry ? `Industry: ${d.industry}` : "",
    d.riskLevel ? `Risk Level: ${d.riskLevel}` : "",
    section("Business Profile", renderFieldValues(d.businessProfile)),
    section("Industry Knowledge", renderFieldValues(d.industryKnowledge)),
    renderList(d.productsServices, "Products & Services"),
    section("Target Audience", renderFieldValues(d.targetAudience)),
    renderList(d.approvedClaims, "Approved Claims (Claim ที่อนุมัติแล้วเท่านั้น)"),
    renderList(d.prohibitedClaims, "Prohibited Claims (ห้ามเขียนเด็ดขาด)"),
    renderList(d.officialSources, "Official Sources (แหล่งอ้างอิงที่อนุมัติ)"),
    section("Brand Voice", renderFieldValues(d.brandVoice)),
    section("Compliance", renderFieldValues(d.compliance)),
    section("Expert Reviewer", renderFieldValues(d.expertReviewer)),
  ];
  return parts.filter(Boolean).join("\n");
}

function renderMasterPrompt(raw: string): string {
  const d = tryParse(raw);
  if (!d) return raw;
  const parts = [
    typeof d.systemInstruction === "string" ? d.systemInstruction : "",
    typeof d.writingInstruction === "string"
      ? section("WRITING REQUIREMENTS", d.writingInstruction)
      : "",
    typeof d.prohibitedBehavior === "string" && d.prohibitedBehavior.trim()
      ? section("PROHIBITED BEHAVIOR (ห้ามทำ)", d.prohibitedBehavior)
      : "",
    typeof d.outputFormat === "string" && d.outputFormat.trim()
      ? section("OUTPUT FORMAT", d.outputFormat)
      : "",
    typeof d.fallbackBehavior === "string" && d.fallbackBehavior.trim()
      ? section("FALLBACK BEHAVIOR (เมื่อข้อมูลไม่พอ)", d.fallbackBehavior)
      : "",
  ];
  return parts.filter(Boolean).join("\n");
}

function renderArticleBrief(raw: string): string {
  const d = tryParse(raw);
  if (!d) return raw;
  const parts = [
    section("Core Topic", renderFieldValues(d.coreTopic)),
    section("Search Intent", renderFieldValues(d.searchIntent)),
    section("Audience", renderFieldValues(d.audience)),
    section("SEO Coverage", renderFieldValues(d.seoCoverage)),
    section("AEO Coverage", renderFieldValues(d.aeoCoverage)),
    section("GEO Coverage", renderFieldValues(d.geoCoverage)),
    section("Internal Links", renderFieldValues(d.internalLinksSection)),
    section("Conversion", renderFieldValues(d.conversion)),
    section("Sources & Review", renderFieldValues(d.sourcesReview)),
    section("Publishing", renderFieldValues(d.publishing)),
  ];
  return parts.filter(Boolean).join("\n");
}

function renderValidatorPack(raw: string): string {
  const d = tryParse(raw);
  if (!d) return raw;
  const validators = Array.isArray(d.validators) ? (d.validators as Dict[]) : [];
  const enabled = validators
    .filter((v) => v.enabled !== false)
    .sort((a, b) => Number(a.executionOrder ?? 0) - Number(b.executionOrder ?? 0));
  if (!enabled.length) return raw;
  return enabled
    .map((v, i) => {
      const blocking = v.blocking ? " [BLOCKING — ไม่ผ่านห้ามส่งงาน]" : "";
      const prompt = typeof v.prompt === "string" && v.prompt.trim() ? `\n${v.prompt.trim()}` : "";
      return `${i + 1}. ${v.name ?? v.id}${blocking}${prompt}`;
    })
    .join("\n\n");
}

function renderImagePrompt(raw: string): string {
  const d = tryParse(raw);
  if (!d) return raw; // legacy free text — Studio quick-editor บันทึกแบบนี้
  const text =
    (typeof d.promptText === "string" && d.promptText) ||
    (typeof d.template === "string" && d.template) ||
    (typeof d.text === "string" && d.text) ||
    "";
  return text || raw;
}

const RENDERERS: Record<string, (raw: string) => string> = {
  CE_BUSINESS_SKILL: renderBusinessSkill,
  CE_MASTER_PROMPT: renderMasterPrompt,
  CE_ARTICLE_BRIEF: renderArticleBrief,
  CE_VALIDATOR_PACK: renderValidatorPack,
  CE_IMAGE_PROMPT: renderImagePrompt,
};

// ── main resolver ─────────────────────────────────────────────────────────────

interface CERow {
  id: string;
  name: string;
  type: string;
  version: number;
  isActive: boolean;
  promptText: string;
}

function toLayer(row: CERow | undefined | null): ResolvedLayer | null {
  if (!row) return null;
  const render = RENDERERS[row.type] ?? ((t: string) => t);
  const text = render(row.promptText).trim();
  if (!text) return null;
  return { id: row.id, name: row.name, version: row.version, text };
}

const CE_TYPES = [
  "CE_BUSINESS_SKILL",
  "CE_MASTER_PROMPT",
  "CE_ARTICLE_BRIEF",
  "CE_VALIDATOR_PACK",
  "CE_IMAGE_PROMPT",
];

const LABELS: Record<string, string> = {
  CE_BUSINESS_SKILL: "Business Skill",
  CE_MASTER_PROMPT: "Master Prompt",
  CE_ARTICLE_BRIEF: "Article Brief",
  CE_VALIDATOR_PACK: "Validator Pack",
  CE_IMAGE_PROMPT: "Image Prompt",
};

export async function resolveContentEngine(orgId: string, scope: CEScope): Promise<ResolvedCE> {
  const isStudio = scope === "studio";
  const scopeProjectId = isStudio ? null : scope.projectId;

  const rows = (await prisma.promptTemplate.findMany({
    where: { organizationId: orgId, projectId: scopeProjectId, type: { in: CE_TYPES } },
    select: { id: true, name: true, type: true, version: true, isActive: true, promptText: true },
  })) as CERow[];

  const activeOf = (type: string) => rows.find((r) => r.type === type && r.isActive) ?? null;

  const businessSkillRow = activeOf("CE_BUSINESS_SKILL");
  const masterRow = activeOf("CE_MASTER_PROMPT");
  const briefRow = activeOf("CE_ARTICLE_BRIEF");
  const validatorRow = activeOf("CE_VALIDATOR_PACK");
  const imagePromptRow = activeOf("CE_IMAGE_PROMPT");

  const businessSkill = toLayer(businessSkillRow);
  const masterPrompt = toLayer(masterRow);
  const articleBrief = toLayer(briefRow);
  const validatorPack = toLayer(validatorRow);
  const imagePrompt = toLayer(imagePromptRow);

  // Required sets: project scope → ALL 5. studio scope → ทุกอย่างยกเว้น Business Skill
  const requiredTypes = isStudio
    ? ["CE_MASTER_PROMPT", "CE_ARTICLE_BRIEF", "CE_VALIDATOR_PACK", "CE_IMAGE_PROMPT"]
    : CE_TYPES;

  const resolvedByType: Record<string, ResolvedLayer | null> = {
    CE_BUSINESS_SKILL: businessSkill,
    CE_MASTER_PROMPT: masterPrompt,
    CE_ARTICLE_BRIEF: articleBrief,
    CE_VALIDATOR_PACK: validatorPack,
    CE_IMAGE_PROMPT: imagePrompt,
  };

  const missing = requiredTypes.filter((t) => !resolvedByType[t]).map((t) => LABELS[t]);

  return {
    businessSkill,
    masterPrompt,
    articleBrief,
    validatorPack,
    imagePrompt,
    missing,
    scope: isStudio ? "studio" : "project",
  };
}
