// ─────────────────────────────────────────────────────────────────────────────
//  Settings > Content Engine — shared types
//
//  ทุก Layer (Business Skill / Master Prompt / Article Brief / Validator Pack)
//  ถูกเก็บเป็นแถวเดียวใน PromptTemplate (type ขึ้นต้นด้วย CE_) — promptText
//  เก็บ object โครงสร้างของ layer นั้นเป็น JSON string
// ─────────────────────────────────────────────────────────────────────────────

export type CEStatus = "Draft" | "In Review" | "Active" | "Deprecated" | "Archived";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export const CE_TYPES = {
  BUSINESS_SKILL: "CE_BUSINESS_SKILL",
  MASTER_PROMPT: "CE_MASTER_PROMPT",
  ARTICLE_BRIEF: "CE_ARTICLE_BRIEF",
  VALIDATOR_PACK: "CE_VALIDATOR_PACK",
  IMAGE_PROMPT: "CE_IMAGE_PROMPT",
} as const;

export type CELayerType =
  | typeof CE_TYPES.BUSINESS_SKILL
  | typeof CE_TYPES.MASTER_PROMPT
  | typeof CE_TYPES.ARTICLE_BRIEF
  | typeof CE_TYPES.VALIDATOR_PACK
  | typeof CE_TYPES.IMAGE_PROMPT;

// ── Scope: projectId=X → เฉพาะ project X, "studio" (projectId=null) → เฉพาะ Studio ──
// ห้ามใช้ข้าม scope

export type CEScope = { projectId: string } | "studio";

// ── Editor mode: ฟอร์ม (structured fields) vs ดิบ (raw promptText) ────────────

export type CEMode = "form" | "raw";

export function scopeProjectId(scope: CEScope): string | null {
  return scope === "studio" ? null : scope.projectId;
}

/** แถวดิบตามที่ page.tsx ดึงจาก prisma.promptTemplate */
export interface PromptRow {
  id: string;
  name: string;
  description: string | null;
  promptText: string;
  type: string;
  isActive: boolean;
  version: number;
  updatedAt: string;
  editorName: string | null;
}

export interface ProjectLite {
  id: string;
  name: string;
  clientName: string | null;
  industry: string | null;
  website: string;
}

// ── Field-config driven form renderer ─────────────────────────────────────────

export type FieldType = "text" | "textarea" | "select" | "date";

export interface FieldConfig {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  placeholder?: string;
}

export interface CardConfig {
  key: string;
  title: string;
  /** true = data[key] คือ array ของแถว (add/remove ได้) */
  repeatable?: boolean;
  fields: FieldConfig[];
}

export type FieldValues = Record<string, string>;

// ── Layer 1: Business Skill ───────────────────────────────────────────────────

export interface BusinessSkillData {
  status: CEStatus;
  industry: string;
  riskLevel: RiskLevel;
  businessProfile: FieldValues;
  industryKnowledge: FieldValues;
  productsServices: FieldValues[];
  targetAudience: FieldValues;
  approvedClaims: FieldValues[];
  prohibitedClaims: FieldValues[];
  officialSources: FieldValues[];
  brandVoice: FieldValues;
  compliance: FieldValues;
  expertReviewer: FieldValues;
}

export function emptyBusinessSkill(): BusinessSkillData {
  return {
    status: "Draft",
    industry: "",
    riskLevel: "medium",
    businessProfile: {},
    industryKnowledge: {},
    productsServices: [],
    targetAudience: {},
    approvedClaims: [],
    prohibitedClaims: [],
    officialSources: [],
    brandVoice: {},
    compliance: {},
    expertReviewer: {},
  };
}

// ── Layer 2: Master Prompt ────────────────────────────────────────────────────

export interface MasterPromptData {
  status: CEStatus;
  contentType: string;
  industryScope: string;
  riskLevel: RiskLevel;
  requiredVariables: string[];
  optionalVariables: string[];
  systemInstruction: string;
  writingInstruction: string;
  outputFormat: string;
  prohibitedBehavior: string;
  fallbackBehavior: string;
  testCases: string;
  versionNote: string;
}

export function emptyMasterPrompt(): MasterPromptData {
  return {
    status: "Draft",
    contentType: "Knowledge Article",
    industryScope: "",
    riskLevel: "medium",
    requiredVariables: [],
    optionalVariables: [],
    systemInstruction: "",
    writingInstruction: "",
    outputFormat: "",
    prohibitedBehavior: "",
    fallbackBehavior: "",
    testCases: "",
    versionNote: "",
  };
}

// ── Layer 3: Article Brief Template ──────────────────────────────────────────

export interface ArticleBriefData {
  status: CEStatus;
  contentType: string;
  coreTopic: FieldValues;
  searchIntent: FieldValues;
  audience: FieldValues;
  seoCoverage: FieldValues;
  aeoCoverage: FieldValues;
  geoCoverage: FieldValues;
  internalLinksSection: FieldValues;
  conversion: FieldValues;
  sourcesReview: FieldValues;
  publishing: FieldValues;
}

export function emptyArticleBrief(): ArticleBriefData {
  return {
    status: "Draft",
    contentType: "Knowledge Article",
    coreTopic: {},
    searchIntent: {},
    audience: {},
    seoCoverage: {},
    aeoCoverage: {},
    geoCoverage: {},
    internalLinksSection: {},
    conversion: {},
    sourcesReview: {},
    publishing: {},
  };
}

// ── Layer 4: Validator Pack ───────────────────────────────────────────────────

export interface ValidatorConfig {
  id: string;
  name: string;
  enabled: boolean;
  blocking: boolean;
  blockingLocked: boolean;
  passThreshold: number;
  warningThreshold: number;
  autoFixAllowed: boolean;
  autoFixLocked: boolean;
  humanReviewRequired: boolean;
  prompt: string;
  executionOrder: number;
}

export interface ValidatorPackData {
  status: CEStatus;
  industryScope: string;
  riskScope: RiskLevel;
  validators: ValidatorConfig[];
}

// ── Safe JSON parse helpers (legacy free-text guard) ─────────────────────────

export function tryParse<T>(text: string): T | null {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") return parsed as T;
    return null;
  } catch {
    return null;
  }
}
