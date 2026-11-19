// เทสการจับ jobType เข้าระบบของหน้า AI Cost: npx tsx src/lib/ai-cost-modules.test.ts
import assert from 'node:assert'
import { aiCostModuleOf, AI_COST_MODULES } from './ai-cost-modules'

const EXPECT: Record<string, string> = {
  // Upload Article
  UPLOAD_ARTICLE_WRITE: 'upload_article', UPLOAD_ARTICLE_META: 'upload_article', UPLOAD_ARTICLE_KEYWORDS_AI: 'upload_article',
  UPLOAD_ARTICLE_CONNECT_HELP: 'upload_article', UPLOAD_ARTICLE_TEST_IMAGE: 'upload_article',
  UPLOAD_ARTICLE_IMAGE_COVER: 'upload_article', UPLOAD_ARTICLE_IMAGE_INLINE: 'upload_article',
  UPLOAD_SITE_SCAN: 'upload_article', UPLOAD_THEME_SCAN: 'upload_article',
  // SEO SME / Content Studio
  SME_ARTICLE_META: 'sme', ARTICLE_WRITE: 'sme', ARTICLE_HTML: 'sme', ARTICLE_AUDIT: 'sme', ARTICLE_FIX: 'sme',
  OUTLINE: 'sme', CONTENT_MAP: 'sme', SEO_REVIEW: 'sme', SEO_CHECK: 'sme', SEO_METADATA: 'sme', WORDPRESS_DRAFT: 'sme',
  // Content Engine
  CE_COMPILE: 'content_engine', CE_FILE_PAGE_READ: 'content_engine', CE_LAYER_SCAN: 'content_engine',
  CE_MASTER_PROMPT_EDIT: 'content_engine', CE_MASTER_PROMPT_FROM_EXAMPLES: 'content_engine',
  BUSINESS_SKILL_SCAN: 'content_engine', CONTEXT_FILES_ANALYZE: 'content_engine', PROMPT_TEST: 'content_engine',
  // Keyword Research
  KEYWORD_RESEARCH: 'keyword_research', KEYWORD_CLASSIFY: 'keyword_research', KP_VOLUME_LOOKUP: 'keyword_research',
  DFS_VOLUME_LOOKUP: 'keyword_research', DFS_INTEL_LOOKUP: 'keyword_research', RESEARCH_LLM: 'keyword_research',
  // Brand Radar
  BRAND_RADAR_PROMPT_GEN: 'brand_radar', BRAND_RADAR_QUERY_GROUPS: 'brand_radar', BRAND_RADAR_SCAN: 'brand_radar', BRAND_RADAR_SENTIMENT: 'brand_radar',
  // Compliance
  COMPLIANCE_CHECK: 'compliance', COMPLIANCE_RULE_UPDATE: 'compliance', COMPLIANCE_RULE_FILL: 'compliance',
  // Article Lab
  LAB_SITE_SCAN: 'article_lab',
  // รูปภาพ/ปก
  IMAGE_COVER: 'image', IMAGE_MID: 'image', IMAGE_PROMPT: 'image',
  // Report / SEO Lab
  SEO_LAB_AI_VISIBILITY: 'report', SEO_LAB_AUDIT: 'report', SEO_LAB_BACKLINKS: 'report', SEO_LAB_COMPETITORS: 'report',
  SEO_LAB_KEYWORDS: 'report', SEO_LAB_RANKINGS: 'report', SEO_LAB_SERP: 'report', SEO_LAB_TRENDS: 'report',
  DATA_BRAIN_SUMMARY: 'report', SEO_TASK_SUGGEST: 'report',
  competitor_gap_: 'report', competitor_gap_classify: 'report', competitor_gap_crawl: 'report', competitor_gap_phase1: 'report',
  competitor_gap_phase2: 'report', competitor_gap_ranked_keywords: 'report', competitor_gap_serp: 'report',
  competitor_gap_structure: 'report', competitor_gap_topics: 'report',
  // อื่นๆ
  NEWS_DIGEST: 'other', SOMETHING_NEW: 'other', '': 'other',
  // prefix ที่ยังไม่มี job จริงแต่เตรียมไว้
  PBN_WRITE: 'pbn', BLM_REQUEST: 'backlink', BACKLINK_CHECK: 'backlink',
}

let passed = 0
for (const [type, key] of Object.entries(EXPECT)) {
  assert.strictEqual(aiCostModuleOf(type).key, key, `${type} -> ${key}`)
  passed++
}
// ทุก key ที่คืนต้องอยู่ในรายการระบบ และมี label
for (const type of Object.keys(EXPECT)) {
  const m = aiCostModuleOf(type)
  assert.ok(AI_COST_MODULES.some((x) => x.key === m.key) && m.label.length > 0)
  passed++
}
assert.strictEqual(aiCostModuleOf('SOMETHING_NEW').label, 'อื่นๆ'); passed++
console.log(`ai-cost-modules: ${passed} checks passed`)
