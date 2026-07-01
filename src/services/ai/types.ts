import type { Role } from "@/types";
import type { PromptVariables } from "./compiler";

// ── Job & Prompt Types ────────────────────────────────────────────────────────

export type JobType =
  | "KEYWORD_RESEARCH"
  | "CONTENT_MAP"
  | "OUTLINE"
  | "ARTICLE_HTML"
  | "SEO_METADATA"
  | "IMAGE_PROMPT"
  | "SEO_CHECK"
  | "WORDPRESS_DRAFT"
  | "ARTICLE_AUDIT"
  | "ARTICLE_FIX";

export type PromptType =
  | "KEYWORD_RESEARCH_PROMPT"
  | "CONTENT_MAP_PROMPT"
  | "OUTLINE_PROMPT"
  | "ARTICLE_WRITER_PROMPT"
  | "SEO_CHECK_PROMPT"
  | "IMAGE_PROMPT_GENERATOR"
  | "WORDPRESS_PUBLISH_PROMPT"
  | "TEMPLATE_SPECIFIC_PROMPT"
  | "ARTICLE_AUDIT_PROMPT"
  | "ARTICLE_FIX_PROMPT";

// ── runAIJob options ──────────────────────────────────────────────────────────

export interface RunAIJobOptions {
  organizationId: string;
  projectId?: string;
  articleId?: string;
  jobType: JobType;
  promptType: PromptType;
  variables: PromptVariables;
  userId: string;
  /** Return mock output when no real API key is configured. */
  mockFn: (compiledPrompt: string) => unknown;
}

export interface AIJobResult<T = unknown> {
  jobId: string;
  output: T;
  tokensUsed: number;
  estimatedCost: number;
  isMock: boolean;
}

// ── Service input shapes ──────────────────────────────────────────────────────

export interface ServiceContext {
  organizationId: string;
  userId: string;
  userRole: Role;
}

export interface KeywordResearchInput extends ServiceContext {
  projectId: string;
  seedKeyword: string;
}

export interface ContentMapInput extends ServiceContext {
  projectId: string;
  /** Keywords to plan content around */
  keywords: string[];
}

export interface ArticleJobInput extends ServiceContext {
  articleId: string;
}

// ── Domain output types ───────────────────────────────────────────────────────

export interface KeywordOutput {
  mainKeyword: string;
  relatedKeywords: string[];
  longTailKeywords: string[];
  intent: string;
  funnelStage: string;
  estimatedVolume: number;
  difficulty: number;
  contentIdeas: string[];
}

export interface ContentMapEntry {
  funnelStage: "TOFU" | "MOFU" | "BOFU";
  intent: string;
  keyword: string;
  proposedTitle: string;
  contentType: string;
  wordCountTarget: number;
  priority: number;
  notes?: string;
}

export interface ContentMapOutput {
  totalArticles: number;
  tofu: ContentMapEntry[];
  mofu: ContentMapEntry[];
  bofu: ContentMapEntry[];
}

export interface OutlineSection {
  h2: string;
  h3s: string[];
  keyPoints: string[];
  estimatedWords: number;
}

export interface OutlineOutput {
  title: string;
  seoTitle: string;
  metaDescription: string;
  estimatedWordCount: number;
  sections: OutlineSection[];
  faqItems: { question: string; answer: string }[];
}

export interface SeoCheckOutput {
  seoScore: number;
  aeoScore: number;
  conversionScore: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  // issues may be flat strings (new prompt) or objects with severity (legacy mock)
  issues: Array<string | { severity: "error" | "warning" | "info"; message: string }>;
  // new prompt returns recommendations; legacy mock returns suggestions
  recommendations?: string[];
  suggestions?: string[];
  summary?: string;
  approvalRecommendation?: "APPROVE" | "REVISION_REQUIRED";
  passed?: boolean;
}

export interface ImagePromptOutput {
  coverPrompt: string;
  altText: string;
  negativePrompt: string;
  style: string;
  aspectRatio: string;
  inlinePrompts: Array<{ purpose: string; prompt: string }>;
}

export interface WordPressOutput {
  wordpressUrl: string;
  wordpressId: number;
  status: "draft";
  slug: string;
  categories: string[];
  tags: string[];
}

export interface AuditBreakdown {
  seo: number;
  aiSearch: number;
  eeat: number;
  ux: number;
  conversion: number;
}

export interface ArticleAuditOutput {
  scoreOutOf10: number;
  breakdown: AuditBreakdown;
  criticalGaps: string[];
  recommendations: string[];
}

export interface ArticleFixOutput {
  htmlContent: string;
  seoTitle: string;
  metaDescription: string;
  faqSchema: string;
  changesSummary: string[];
}
