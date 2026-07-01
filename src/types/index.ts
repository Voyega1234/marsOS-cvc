import type {
  User, Organization, Project, Keyword, Article, ArticleVersion,
  PromptTemplate, BrandTemplate, AIJob, ActivityLog, WordPressConnection,
  Review, Comment, ProjectMember,
} from "@prisma/client";

export type { User, Organization, Project, Keyword, Article, ArticleVersion, PromptTemplate, BrandTemplate, AIJob, ActivityLog, WordPressConnection, Review, Comment, ProjectMember };

// ── String-based enums (SQLite-compatible) ────────────────────────────────────

export type Role = "ADMIN" | "USER" | "CLIENT" | "SEO_MANAGER" | "SEO_PLANNER" | "WRITER" | "REVIEWER" | "PUBLISHER";
export type ProjectStatus = "ACTIVE" | "PLANNING" | "PAUSED" | "COMPLETED" | "ARCHIVED";
export type ProjectRole = "PROJECT_ADMIN" | "SEO_MANAGER" | "SEO_PLANNER" | "WRITER" | "REVIEWER" | "PUBLISHER" | "VIEWER";
export type KeywordStatus = "NEW" | "GENERATED" | "APPROVED" | "EXCLUDED" | "ARTICLE_CREATED";
export type UserStatus = "ACTIVE" | "INACTIVE" | "INVITED";
export type ArticleStatus =
  | "NEW" | "KEYWORD_RESEARCHING" | "KEYWORD_DONE" | "CONTENT_MAP_DONE"
  | "OUTLINE_GENERATING" | "OUTLINE_DONE" | "OUTLINE_APPROVED"
  | "ARTICLE_GENERATING" | "ARTICLE_DONE" | "IMAGE_PROMPT_DONE"
  | "SEO_REVIEW" | "SEO_DONE" | "SEO_NEEDS_REVISION" | "REVISION_REQUIRED" | "APPROVED"
  | "CLIENT_REVIEW" | "CLIENT_REVISION"
  | "WORDPRESS_DRAFTED" | "POSTED" | "ERROR" | "ARCHIVED";
export type FunnelStage = "TOFU" | "MOFU" | "BOFU";
export type SearchIntent = "INFORMATIONAL" | "NAVIGATIONAL" | "TRANSACTIONAL" | "COMMERCIAL";
export type PromptType =
  | "KEYWORD_RESEARCH_PROMPT" | "CONTENT_MAP_PROMPT" | "OUTLINE_PROMPT"
  | "ARTICLE_WRITER_PROMPT" | "SEO_CHECK_PROMPT" | "IMAGE_PROMPT_GENERATOR"
  | "WORDPRESS_PUBLISH_PROMPT" | "TEMPLATE_SPECIFIC_PROMPT";
export type ModelProvider = "CLAUDE" | "OPENAI" | "GEMINI" | "CUSTOM";
export type AIJobStatus = "PENDING" | "RUNNING" | "DONE" | "FAILED";
export type AuthorGender = "male" | "female" | "none";

export interface AuthorProfile {
  id: string;         // cuid generated on client
  name: string;
  title: string;
  gender: AuthorGender;
  image: string;      // base64 data URL or ""
}

// ── Enriched types ────────────────────────────────────────────────────────────

export type ArticleWithRelations = Article & {
  project: Project;
  keyword?: Keyword | null;
  assignedTo?: User | null;
  reviewer?: User | null;
  createdBy: User;
  reviews?: Review[];
  _count?: { versions: number; comments: number };
};

export type ProjectWithRelations = Project & {
  organization: Organization;
  createdBy: User;
  owner?: Pick<User, "id" | "name"> | null;
  defaultTemplate?: BrandTemplate | null;
  members?: (ProjectMember & { user: Pick<User, "id" | "name"> })[];
  _count?: { articles: number; keywords: number; members?: number };
  statusMap?: Record<string, number>;
};

// ── UI types ──────────────────────────────────────────────────────────────────

export type UIMode = "simple" | "professional";

export type PipelineStep = {
  key: string;
  label: string;
  labelTh: string;
  status: ArticleStatus[];
  color: string;
  icon: string;
};

export const PIPELINE_STEPS: PipelineStep[] = [
  { key: "keywords",   label: "Keyword Research",  labelTh: "วิจัย Keyword",   status: ["KEYWORD_RESEARCHING", "KEYWORD_DONE"],                               color: "blue",   icon: "Search" },
  { key: "contentmap", label: "Content Map",        labelTh: "Content Map",      status: ["CONTENT_MAP_DONE"],                                                   color: "purple", icon: "Map" },
  { key: "outline",    label: "Outline",            labelTh: "โครงร่าง",         status: ["OUTLINE_GENERATING", "OUTLINE_DONE", "OUTLINE_APPROVED"],             color: "orange", icon: "FileText" },
  { key: "article",    label: "Article HTML",       labelTh: "เขียนบทความ",      status: ["ARTICLE_GENERATING", "ARTICLE_DONE"],                                 color: "green",  icon: "PenLine" },
  { key: "image",      label: "Image Prompt",       labelTh: "Image Prompt",     status: ["IMAGE_PROMPT_DONE"],                                                  color: "pink",   icon: "Image" },
  { key: "review",     label: "SEO Review",         labelTh: "ตรวจ SEO",         status: ["SEO_REVIEW", "REVISION_REQUIRED", "APPROVED"],                       color: "teal",   icon: "CheckCircle" },
  { key: "wordpress",  label: "WordPress",          labelTh: "ส่ง WordPress",    status: ["WORDPRESS_DRAFTED", "POSTED"],                                        color: "indigo", icon: "Globe" },
];

export const STATUS_CONFIG: Record<ArticleStatus, { label: string; labelTh: string; color: string; bg: string }> = {
  NEW:                  { label: "New",                labelTh: "บทความใหม่",           color: "text-gray-600",    bg: "bg-gray-100" },
  KEYWORD_RESEARCHING:  { label: "Researching",        labelTh: "กำลังวิจัย Keyword",   color: "text-blue-600",    bg: "bg-blue-100" },
  KEYWORD_DONE:         { label: "Keywords Done",      labelTh: "Keyword พร้อม",         color: "text-blue-700",    bg: "bg-blue-200" },
  CONTENT_MAP_DONE:     { label: "Content Map Done",   labelTh: "วางแผนเนื้อหาแล้ว",    color: "text-purple-600",  bg: "bg-purple-100" },
  OUTLINE_GENERATING:   { label: "Generating Outline", labelTh: "กำลังสร้างโครงร่าง",   color: "text-orange-500",  bg: "bg-orange-100" },
  OUTLINE_DONE:         { label: "Outline Done",       labelTh: "รอ Approve โครงร่าง",  color: "text-orange-600",  bg: "bg-orange-100" },
  OUTLINE_APPROVED:     { label: "Outline Approved",   labelTh: "โครงร่างอนุมัติแล้ว",  color: "text-amber-600",   bg: "bg-amber-100" },
  ARTICLE_GENERATING:   { label: "Writing...",         labelTh: "AI กำลังเขียน...",      color: "text-green-500",   bg: "bg-green-100" },
  ARTICLE_DONE:         { label: "Article Done",       labelTh: "เขียนเสร็จ รอ Review",  color: "text-green-600",   bg: "bg-green-100" },
  IMAGE_PROMPT_DONE:    { label: "Image Prompt Done",  labelTh: "พร้อมทำรูปภาพ",         color: "text-pink-600",    bg: "bg-pink-100" },
  SEO_REVIEW:           { label: "In Review",          labelTh: "รอตรวจ SEO",            color: "text-teal-600",    bg: "bg-teal-100" },
  SEO_DONE:             { label: "SEO Done",           labelTh: "ผ่าน SEO แล้ว",         color: "text-teal-700",    bg: "bg-teal-100" },
  SEO_NEEDS_REVISION:   { label: "SEO Needs Revision", labelTh: "ต้องแก้ SEO",           color: "text-orange-600",  bg: "bg-orange-100" },
  REVISION_REQUIRED:    { label: "Revision Required",  labelTh: "ต้องแก้ไขก่อน",         color: "text-red-600",     bg: "bg-red-100" },
  APPROVED:             { label: "Approved",           labelTh: "อนุมัติแล้ว ✓",          color: "text-emerald-600", bg: "bg-emerald-100" },
  CLIENT_REVIEW:        { label: "Client Review",      labelTh: "รอ Client Approve",       color: "text-violet-600",  bg: "bg-violet-100" },
  CLIENT_REVISION:      { label: "Client Revision",    labelTh: "Client ขอแก้ไข",          color: "text-rose-600",    bg: "bg-rose-100" },
  WORDPRESS_DRAFTED:    { label: "WP Draft",           labelTh: "Draft ใน WordPress",    color: "text-indigo-600",  bg: "bg-indigo-100" },
  POSTED:               { label: "Posted",             labelTh: "เผยแพร่แล้ว ✓",          color: "text-green-800",   bg: "bg-green-200" },
  ERROR:                { label: "Error",              labelTh: "เกิดข้อผิดพลาด",        color: "text-red-700",     bg: "bg-red-200" },
  ARCHIVED:             { label: "Archived",           labelTh: "เก็บถาวร",              color: "text-gray-500",    bg: "bg-gray-100" },
};

export const FUNNEL_CONFIG: Record<FunnelStage, { label: string; labelTh: string; color: string; bg: string }> = {
  TOFU: { label: "TOFU", labelTh: "TOFU — ดึงคนเข้าเว็บ",     color: "text-sky-600",    bg: "bg-sky-100" },
  MOFU: { label: "MOFU", labelTh: "MOFU — คนสนใจแล้ว",        color: "text-violet-600", bg: "bg-violet-100" },
  BOFU: { label: "BOFU", labelTh: "BOFU — ใกล้ตัดสินใจซื้อ",  color: "text-rose-600",   bg: "bg-rose-100" },
};

export const ROLE_CONFIG: Record<Role, { label: string; color: string }> = {
  ADMIN:       { label: "Admin",       color: "text-red-600" },
  USER:        { label: "User",        color: "text-blue-600" },
  CLIENT:      { label: "Client",      color: "text-teal-600" },
  SEO_MANAGER: { label: "SEO Manager", color: "text-purple-600" },
  SEO_PLANNER: { label: "SEO Planner", color: "text-blue-600" },
  WRITER:      { label: "Writer",      color: "text-green-600" },
  REVIEWER:    { label: "Reviewer",    color: "text-orange-600" },
  PUBLISHER:   { label: "Publisher",   color: "text-indigo-600" },
};
