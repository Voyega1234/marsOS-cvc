/**
 * จับ AIJob.jobType เข้า "ระบบ" (module) ของ MarsOS สำหรับหน้า AI Cost
 * ฟังก์ชันล้วน ไม่แตะฐานข้อมูล — กฎเรียงจากบนลงล่าง ตัวแรกที่ตรงชนะ
 * jobType ที่ไม่รู้จักตกที่ "อื่นๆ" (ชื่อ type ดิบยังแสดงในคอลัมน์ประเภทงาน)
 */

export interface AiCostModule { key: string; label: string }

export const AI_COST_MODULES: readonly AiCostModule[] = [
  { key: "upload_article", label: "Upload Article" },
  { key: "sme", label: "SEO SME / Content Studio" },
  { key: "content_engine", label: "Content Engine" },
  { key: "pbn", label: "PBN" },
  { key: "keyword_research", label: "Keyword Research" },
  { key: "brand_radar", label: "Brand Radar" },
  { key: "compliance", label: "Compliance" },
  { key: "backlink", label: "Backlink Management" },
  { key: "line_tracking", label: "LINE Tracking" },
  { key: "article_lab", label: "Article Lab" },
  { key: "image", label: "รูปภาพ/ปก" },
  { key: "report", label: "Report / SEO Lab" },
  { key: "other", label: "อื่นๆ" },
] as const;

const OTHER = AI_COST_MODULES[AI_COST_MODULES.length - 1];
const byKey = (key: string): AiCostModule => AI_COST_MODULES.find((m) => m.key === key) ?? OTHER;

export function aiCostModuleByKey(key: string): AiCostModule { return byKey(key); }

/** [กฎ, key] — กฎเป็น prefix หรือชื่อเต็ม (เทียบแบบตัวพิมพ์ใหญ่) */
const RULES: ReadonlyArray<{ test: (t: string) => boolean; key: string }> = [
  { test: (t) => t.startsWith("BRAND_RADAR_"), key: "brand_radar" },
  { test: (t) => t.startsWith("COMPLIANCE_"), key: "compliance" },
  { test: (t) => t.startsWith("PBN_"), key: "pbn" },
  { test: (t) => t.startsWith("BLM_") || t.startsWith("BACKLINK_"), key: "backlink" },
  { test: (t) => t.startsWith("LINE_TRACKING_"), key: "line_tracking" },
  { test: (t) => t.startsWith("UPLOAD_"), key: "upload_article" },
  { test: (t) => t.startsWith("SME_"), key: "sme" },
  { test: (t) => t.startsWith("LAB_"), key: "article_lab" },
  { test: (t) => t.startsWith("IMAGE_"), key: "image" },
  { test: (t) => t.startsWith("SEO_LAB_") || t.startsWith("COMPETITOR_GAP_") || t === "DATA_BRAIN_SUMMARY" || t === "SEO_TASK_SUGGEST", key: "report" },
  { test: (t) => t.startsWith("KEYWORD_") || t === "KP_VOLUME_LOOKUP" || t === "DFS_VOLUME_LOOKUP" || t === "DFS_INTEL_LOOKUP" || t === "RESEARCH_LLM", key: "keyword_research" },
  { test: (t) => t.startsWith("CE_") || t === "BUSINESS_SKILL_SCAN" || t === "CONTEXT_FILES_ANALYZE" || t === "PROMPT_TEST", key: "content_engine" },
  {
    test: (t) => t.startsWith("ARTICLE_") || ["OUTLINE", "CONTENT_MAP", "SEO_REVIEW", "SEO_CHECK", "SEO_METADATA", "WORDPRESS_DRAFT"].includes(t),
    key: "sme",
  },
];

export function aiCostModuleOf(jobType: string): AiCostModule {
  const t = (jobType ?? "").trim().toUpperCase();
  for (const r of RULES) if (r.test(t)) return byKey(r.key);
  return OTHER;
}
