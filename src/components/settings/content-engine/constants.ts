import type { CardConfig, CEStatus, MasterPromptData, RiskLevel, ValidatorConfig } from "./types";

export const STATUS_OPTIONS: CEStatus[] = ["Draft", "In Review", "Active", "Deprecated", "Archived"];

export const RISK_OPTIONS: RiskLevel[] = ["low", "medium", "high", "critical"];

export const YES_NO = ["Yes", "No"];

export const CONTENT_TYPES = [
  "Knowledge Article",
  "Service Article",
  "Product Comparison",
  "Local SEO Landing Page",
  "Medical Article",
  "Financial Article",
  "Travel Article",
  "Content Refresh",
];

export const STATUS_COLORS: Record<CEStatus, string> = {
  Draft: "bg-gray-100 text-gray-700 border-gray-200",
  "In Review": "bg-amber-100 text-amber-700 border-amber-200",
  Active: "bg-green-100 text-green-700 border-green-200",
  Deprecated: "bg-red-100 text-red-700 border-red-200",
  Archived: "bg-purple-100 text-purple-700 border-purple-200",
};

export const RISK_COLORS: Record<RiskLevel, string> = {
  low: "bg-green-50 text-green-700 border-green-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  high: "bg-orange-50 text-orange-700 border-orange-200",
  critical: "bg-red-50 text-red-700 border-red-200",
};

// ── Master Prompt variables (spec §F) ─────────────────────────────────────────

export const MASTER_PROMPT_VARIABLES = [
  "{{business_skill}}",
  "{{article_brief}}",
  "{{approved_sources}}",
  "{{brand_voice}}",
  "{{approved_claims}}",
  "{{prohibited_claims}}",
  "{{expert_reviewer}}",
  "{{internal_links}}",
  "{{contact_information}}",
  "{{website_inventory}}",
  "{{cms_capabilities}}",
  "{{content_type}}",
  "{{output_format}}",
  "{{language}}",
  "{{risk_level}}",
];

// ── Layer 1: Business Skill form cards (spec §D) ─────────────────────────────

export const BUSINESS_SKILL_CARDS: CardConfig[] = [
  {
    key: "businessProfile",
    title: "Business Profile",
    fields: [
      { key: "businessName", label: "Business Name", type: "text", placeholder: "เช่น ABC Aesthetic Clinic" },
      { key: "legalBusinessName", label: "Legal Business Name", type: "text" },
      { key: "website", label: "Website", type: "text", placeholder: "https://abcclinic.co.th" },
      { key: "industry", label: "Industry", type: "text", placeholder: "คลินิกเวชกรรม / ผิวหนัง / เลเซอร์" },
      { key: "subIndustry", label: "Sub-industry", type: "text", placeholder: "หัตถการความงาม" },
      { key: "businessType", label: "Business Type", type: "text" },
      { key: "description", label: "Description", type: "textarea" },
      { key: "locations", label: "Locations", type: "textarea", placeholder: "รายชื่อสาขา" },
      { key: "contact", label: "Contact", type: "textarea" },
      { key: "operatingHours", label: "Operating Hours", type: "text" },
      { key: "countryMarket", label: "Country / Market", type: "text", placeholder: "Thailand" },
      { key: "language", label: "Language", type: "text", placeholder: "th" },
      { key: "businessGoal", label: "Business Goal", type: "textarea" },
      { key: "conversionGoal", label: "Conversion Goal", type: "text", placeholder: "นัดหมายผ่านฟอร์ม / โทร" },
    ],
  },
  {
    key: "industryKnowledge",
    title: "Industry Knowledge",
    fields: [
      { key: "approvedDomainKnowledge", label: "Approved Domain Knowledge", type: "textarea", placeholder: "ความรู้เรื่องผิวหนัง, ประเภทของเลเซอร์" },
      { key: "commonCustomerProblems", label: "Common Customer Problems", type: "textarea" },
      { key: "productServiceConcepts", label: "Product / Service Concepts", type: "textarea" },
      { key: "technicalTerms", label: "Technical Terms", type: "textarea" },
      { key: "approvedDefinitions", label: "Approved Definitions", type: "textarea" },
      { key: "requiredContext", label: "Required Context", type: "textarea" },
      { key: "limitations", label: "Limitations", type: "textarea", placeholder: "ข้อจำกัดและความเสี่ยง" },
      { key: "commonMisunderstandings", label: "Common Misunderstandings", type: "textarea" },
      { key: "industryRisk", label: "Industry Risk", type: "select", options: ["low", "medium", "high", "critical"] },
      { key: "ymyl", label: "YMYL", type: "select", options: YES_NO },
    ],
  },
  {
    key: "productsServices",
    title: "Products & Services",
    repeatable: true,
    fields: [
      { key: "name", label: "Name", type: "text" },
      { key: "category", label: "Category", type: "text" },
      { key: "description", label: "Description", type: "textarea" },
      { key: "available", label: "Available", type: "select", options: YES_NO },
      { key: "approvedFeatures", label: "Approved Features", type: "textarea" },
      { key: "approvedBenefits", label: "Approved Benefits", type: "textarea" },
      { key: "limitations", label: "Limitations", type: "textarea" },
      { key: "price", label: "Price", type: "text" },
      { key: "priceDisplayPolicy", label: "Price Display Policy", type: "text" },
      { key: "equipmentTechnology", label: "Equipment / Technology", type: "text" },
      { key: "locationAvailability", label: "Location Availability", type: "text" },
      { key: "cta", label: "CTA", type: "text" },
      { key: "internalLink", label: "Internal Link", type: "text" },
      { key: "evidence", label: "Evidence", type: "textarea" },
      { key: "lastVerified", label: "Last Verified", type: "date" },
    ],
  },
  {
    key: "targetAudience",
    title: "Target Audience",
    fields: [
      { key: "primaryAudience", label: "Primary Audience", type: "textarea" },
      { key: "secondaryAudience", label: "Secondary Audience", type: "textarea" },
      { key: "problems", label: "Problems", type: "textarea" },
      { key: "awarenessLevel", label: "Awareness Level", type: "text" },
      { key: "funnelStage", label: "Funnel Stage", type: "select", options: ["TOFU", "MOFU", "BOFU"] },
      { key: "geography", label: "Geography", type: "text" },
      { key: "language", label: "Language", type: "text" },
      { key: "readingLevel", label: "Reading Level", type: "text" },
      { key: "objections", label: "Objections", type: "textarea" },
      { key: "decisionFactors", label: "Decision Factors", type: "textarea" },
      { key: "prohibitedTargeting", label: "Prohibited Targeting", type: "textarea" },
    ],
  },
  {
    key: "approvedClaims",
    title: "Approved Claims",
    repeatable: true,
    fields: [
      { key: "claim", label: "Claim", type: "textarea" },
      { key: "claimType", label: "Claim Type", type: "text" },
      { key: "evidence", label: "Evidence", type: "textarea" },
      { key: "approvedSource", label: "Approved Source", type: "text" },
      { key: "approvedBy", label: "Approved By", type: "text" },
      { key: "approvalDate", label: "Approval Date", type: "date" },
      { key: "reviewDate", label: "Review Date", type: "date" },
      { key: "allowedContext", label: "Allowed Context", type: "text" },
      { key: "disclaimer", label: "Disclaimer", type: "text" },
      { key: "risk", label: "Risk", type: "select", options: ["low", "medium", "high", "critical"] },
      { key: "status", label: "Status", type: "select", options: ["Draft", "In Review", "Active", "Deprecated", "Archived"] },
    ],
  },
  {
    key: "prohibitedClaims",
    title: "Prohibited Claims",
    repeatable: true,
    fields: [
      { key: "prohibitedClaim", label: "Prohibited Claim", type: "textarea" },
      { key: "reason", label: "Reason", type: "textarea" },
      { key: "regulationPolicy", label: "Regulation / Policy", type: "text" },
      { key: "violationExample", label: "Violation Example", type: "textarea" },
      { key: "safeAlternative", label: "Safe Alternative", type: "textarea" },
      { key: "severity", label: "Severity", type: "select", options: ["low", "medium", "high", "critical"] },
      { key: "contentTypeScope", label: "Content Type Scope", type: "text" },
    ],
  },
  {
    key: "officialSources",
    title: "Official Sources",
    repeatable: true,
    fields: [
      { key: "sourceName", label: "Source Name", type: "text", placeholder: "กระทรวงสาธารณสุข / อย." },
      { key: "organization", label: "Organization", type: "text" },
      { key: "urlDocument", label: "URL / Document", type: "text" },
      { key: "sourceType", label: "Source Type", type: "text" },
      { key: "authorityLevel", label: "Authority Level", type: "text" },
      { key: "approvedTopics", label: "Approved Topics", type: "textarea" },
      { key: "prohibitedUse", label: "Prohibited Use", type: "textarea" },
      { key: "lastVerified", label: "Last Verified", type: "date" },
      { key: "recheckDate", label: "Recheck Date", type: "date" },
      { key: "approvedBy", label: "Approved By", type: "text" },
      { key: "status", label: "Status", type: "select", options: ["Draft", "In Review", "Active", "Deprecated", "Archived"] },
    ],
  },
  {
    key: "brandVoice",
    title: "Brand Voice",
    fields: [
      { key: "tone", label: "Tone", type: "text" },
      { key: "personality", label: "Personality", type: "text" },
      { key: "formality", label: "Formality", type: "text" },
      { key: "readingLevel", label: "Reading Level", type: "text" },
      { key: "preferredTerms", label: "Preferred Terms", type: "textarea" },
      { key: "prohibitedTerms", label: "Prohibited Terms", type: "textarea" },
      { key: "pronouns", label: "Pronouns", type: "text" },
      { key: "sentenceStyle", label: "Sentence Style", type: "text" },
      { key: "ctaStyle", label: "CTA Style", type: "text" },
      { key: "formattingPreferences", label: "Formatting Preferences", type: "textarea" },
      { key: "approvedExamples", label: "Approved Examples", type: "textarea" },
      { key: "rejectedExamples", label: "Rejected Examples", type: "textarea" },
    ],
  },
  {
    key: "compliance",
    title: "Compliance",
    fields: [
      { key: "requiredDisclaimer", label: "Required Disclaimer", type: "textarea", placeholder: "ต้องมีคำเตือนให้ปรึกษาแพทย์" },
      { key: "requiredExpertReview", label: "Required Expert Review", type: "select", options: YES_NO },
      { key: "sensitiveTopics", label: "Sensitive Topics", type: "textarea" },
      { key: "legalMedicalFinancialEscalation", label: "Legal / Medical / Financial Escalation", type: "textarea" },
      { key: "beforeAfterPolicy", label: "Before / After Policy", type: "text", placeholder: "ห้ามใช้ Before/After ที่ไม่ได้รับอนุญาต" },
      { key: "guaranteePolicy", label: "Guarantee Policy", type: "text", placeholder: "ห้ามรับประกันผล" },
      { key: "diagnosisRestrictions", label: "Diagnosis Restrictions", type: "text", placeholder: "ห้ามวินิจฉัยแทนแพทย์" },
      { key: "privacyRestrictions", label: "Privacy Restrictions", type: "text" },
      { key: "imagePermissionPolicy", label: "Image Permission Policy", type: "text" },
      { key: "citationRequirement", label: "Citation Requirement", type: "text" },
    ],
  },
  {
    key: "expertReviewer",
    title: "Expert Reviewer",
    fields: [
      { key: "name", label: "Name", type: "text", placeholder: "Dr. Ann" },
      { key: "role", label: "Role", type: "text" },
      { key: "credential", label: "Credential", type: "text" },
      { key: "specialty", label: "Specialty", type: "text" },
      { key: "reviewScope", label: "Review Scope", type: "text" },
      { key: "riskLevel", label: "Risk Level", type: "select", options: ["low", "medium", "high", "critical"] },
      { key: "approvalSla", label: "Approval SLA", type: "text" },
      { key: "profileUrl", label: "Profile URL", type: "text" },
      { key: "credentialEvidence", label: "Credential Evidence", type: "textarea" },
      { key: "activeStatus", label: "Active Status", type: "select", options: YES_NO },
    ],
  },
];

export const BUSINESS_SKILL_TOTAL_FIELDS = BUSINESS_SKILL_CARDS.reduce(
  (sum, c) => sum + (c.repeatable ? 1 : c.fields.length),
  0
);

// ── Layer 3: Article Brief form cards (spec §H) ──────────────────────────────

export const ARTICLE_BRIEF_CARDS: CardConfig[] = [
  {
    key: "coreTopic",
    title: "Core Topic",
    fields: [
      { key: "workingTitle", label: "Working Title", type: "text", placeholder: "รักษาหลุมสิวแบบไหนดี เลือกวิธีอย่างไรให้เหมาะกับสภาพผิว" },
      { key: "searchOpportunity", label: "Search Opportunity", type: "text", placeholder: "รักษาหลุมสิว" },
      { key: "primaryKeyword", label: "Primary Keyword", type: "text", placeholder: "รักษาหลุมสิว" },
      { key: "secondaryKeywords", label: "Secondary Keywords", type: "textarea", placeholder: "เลเซอร์หลุมสิว\nหลุมสิวรักษาหายไหม" },
      { key: "topicCluster", label: "Topic Cluster", type: "text" },
      { key: "parentTopic", label: "Parent Topic", type: "text" },
      { key: "contentType", label: "Content Type", type: "select", options: CONTENT_TYPES },
      { key: "pageType", label: "Page Type", type: "text" },
      { key: "existingPage", label: "Existing Page", type: "text" },
      { key: "newOrRefresh", label: "New / Refresh", type: "select", options: ["New", "Refresh"] },
      { key: "targetWebsiteConnection", label: "Target Website Connection", type: "text" },
      { key: "targetCms", label: "Target CMS", type: "text" },
      { key: "targetUrl", label: "Target URL", type: "text" },
    ],
  },
  {
    key: "searchIntent",
    title: "Search Intent",
    fields: [
      { key: "primaryIntent", label: "Primary Intent", type: "select", options: ["Informational", "Commercial Investigation", "Transactional", "Navigational"] },
      { key: "secondaryIntent", label: "Secondary Intent", type: "text" },
      { key: "funnelStage", label: "Funnel Stage", type: "select", options: ["TOFU", "MOFU", "BOFU"] },
      { key: "userGoal", label: "User Goal", type: "textarea" },
      { key: "problem", label: "Problem", type: "textarea" },
      { key: "expectedAction", label: "Expected Action", type: "text" },
      { key: "serpPattern", label: "SERP Pattern", type: "text" },
      { key: "competitorGap", label: "Competitor Gap", type: "textarea" },
    ],
  },
  {
    key: "audience",
    title: "Audience",
    fields: [
      { key: "audience", label: "Audience", type: "textarea", placeholder: "ผู้ที่มีปัญหาหลุมสิวและกำลังเปรียบเทียบวิธีรักษา" },
      { key: "problem", label: "Problem", type: "textarea" },
      { key: "awareness", label: "Awareness", type: "text" },
      { key: "objections", label: "Objections", type: "textarea" },
      { key: "decisionFactors", label: "Decision Factors", type: "textarea" },
      { key: "geography", label: "Geography", type: "text" },
      { key: "language", label: "Language", type: "text" },
    ],
  },
  {
    key: "seoCoverage",
    title: "SEO Coverage",
    fields: [
      { key: "primaryKeyword", label: "Primary Keyword", type: "text" },
      { key: "supportingKeywords", label: "Supporting Keywords", type: "textarea" },
      { key: "entities", label: "Entities", type: "textarea" },
      { key: "subtopics", label: "Subtopics", type: "textarea" },
      { key: "requiredSections", label: "Required Sections", type: "textarea" },
      { key: "excludedTopics", label: "Excluded Topics", type: "textarea" },
      { key: "cannibalizationRisk", label: "Cannibalization Risk", type: "select", options: ["low", "medium", "high", "critical"] },
      { key: "metaDirection", label: "Meta Direction", type: "textarea" },
    ],
  },
  {
    key: "aeoCoverage",
    title: "AEO Coverage",
    fields: [
      { key: "directAnswerQuestion", label: "Direct Answer Question", type: "textarea", placeholder: "หลุมสิวมีกี่ประเภท" },
      { key: "paaQuestions", label: "PAA Questions", type: "textarea" },
      { key: "faq", label: "FAQ", type: "textarea", placeholder: "ต้องรักษากี่ครั้ง\nมีผลข้างเคียงอะไรบ้าง" },
      { key: "steps", label: "Steps", type: "textarea" },
      { key: "comparison", label: "Comparison", type: "textarea" },
      { key: "answerFormat", label: "Answer Format", type: "text" },
    ],
  },
  {
    key: "geoCoverage",
    title: "GEO Coverage",
    fields: [
      { key: "entities", label: "Entities", type: "textarea", placeholder: "Acne scar types" },
      { key: "evidence", label: "Evidence", type: "textarea" },
      { key: "expertInsight", label: "Expert Insight", type: "textarea" },
      { key: "organizationAttribution", label: "Organization Attribution", type: "text" },
      { key: "citationReadyFacts", label: "Citation-ready Facts", type: "textarea" },
      { key: "firstPartyData", label: "First-party Data", type: "textarea" },
      { key: "sourceRequirement", label: "Source Requirement", type: "textarea" },
      { key: "aiSearchTopic", label: "AI Search Topic", type: "text" },
    ],
  },
  {
    key: "internalLinksSection",
    title: "Internal Links",
    fields: [
      { key: "websiteInventoryLookup", label: "Website Inventory Lookup", type: "textarea" },
      { key: "requiredLinks", label: "Required Links", type: "textarea", placeholder: "บริการรักษาหลุมสิว\nเลเซอร์ผิวหน้า\nติดต่อคลินิก" },
      { key: "recommendedLinks", label: "Recommended Links", type: "textarea" },
      { key: "anchor", label: "Anchor", type: "text" },
      { key: "targetUrl", label: "Target URL", type: "text" },
      { key: "purpose", label: "Purpose", type: "text" },
      { key: "ctaLink", label: "CTA Link", type: "text" },
      { key: "linkVerificationStatus", label: "Link Verification Status", type: "select", options: ["Verified", "Unverified", "Broken"] },
    ],
  },
  {
    key: "conversion",
    title: "Conversion",
    fields: [
      { key: "primaryCta", label: "Primary CTA", type: "text", placeholder: "นัดหมายเพื่อให้แพทย์ประเมินสภาพผิว" },
      { key: "secondaryCta", label: "Secondary CTA", type: "text" },
      { key: "placement", label: "Placement", type: "text" },
      { key: "event", label: "Event", type: "text" },
      { key: "trackingRequirement", label: "Tracking Requirement", type: "text" },
    ],
  },
  {
    key: "sourcesReview",
    title: "Sources & Review",
    fields: [
      { key: "requiredSources", label: "Required Sources", type: "textarea" },
      { key: "approvedSourceSet", label: "Approved Source Set", type: "textarea" },
      { key: "freshness", label: "Freshness", type: "text" },
      { key: "expertReview", label: "Expert Review", type: "select", options: ["Required", "Not Required"] },
      { key: "reviewer", label: "Reviewer", type: "text" },
      { key: "compliance", label: "Compliance", type: "textarea" },
      { key: "risk", label: "Risk", type: "select", options: ["low", "medium", "high", "critical"] },
    ],
  },
  {
    key: "publishing",
    title: "Publishing",
    fields: [
      { key: "websiteConnection", label: "Website Connection", type: "text" },
      { key: "cms", label: "CMS", type: "text" },
      { key: "environment", label: "Environment", type: "select", options: ["Production", "Staging", "Development", "Preview"] },
      { key: "contentStatus", label: "Content Status", type: "select", options: ["Draft", "In Review", "Active", "Deprecated", "Archived"] },
      { key: "author", label: "Author", type: "text" },
      { key: "category", label: "Category", type: "text" },
      { key: "tags", label: "Tags", type: "text" },
      { key: "featuredImage", label: "Featured Image", type: "text" },
      { key: "schemaType", label: "Schema Type", type: "text" },
      { key: "urlSlug", label: "URL Slug", type: "text" },
      { key: "publishMode", label: "Publish Mode", type: "select", options: ["Draft Only", "Draft + Human Publish", "Scheduled Publish", "Direct Publish", "Export Only", "Webhook Delivery"] },
      { key: "approvalFlow", label: "Approval Flow", type: "text" },
    ],
  },
];

export const ARTICLE_BRIEF_TOTAL_FIELDS = ARTICLE_BRIEF_CARDS.reduce((sum, c) => sum + c.fields.length, 0);

// ── Layer 4: Validator Pack defaults (spec §J/§K/§L) ─────────────────────────

const V = (
  id: string,
  name: string,
  executionOrder: number,
  prompt: string,
  blocking: boolean,
  autoFixLocked: boolean
): ValidatorConfig => ({
  id,
  name,
  enabled: true,
  blocking,
  blockingLocked: blocking,
  passThreshold: 80,
  warningThreshold: 60,
  autoFixAllowed: false,
  autoFixLocked,
  humanReviewRequired: blocking,
  prompt,
  executionOrder,
});

export const DEFAULT_VALIDATORS: ValidatorConfig[] = [
  V(
    "fact_source",
    "Fact & Source Validator",
    1,
    "ตรวจข้อเท็จจริง วันที่ แหล่งอ้างอิง ลิงก์ สถิติ Claim และข้อมูลที่เปลี่ยนแปลงได้ ห้ามใช้ความรู้โมเดลเติมช่องว่าง YMYL ไม่มี Source ให้ Fail",
    true,
    true
  ),
  V(
    "business",
    "Business Validator",
    2,
    "ตรวจบริการ ราคา เครื่องมือ สาขา Contact จุดเด่น CTA และข้อมูลธุรกิจ ตรวจความขัดแย้งระหว่าง Draft, Business Skill และ Website Data",
    true,
    false
  ),
  V(
    "compliance",
    "Compliance Validator",
    3,
    "ตรวจ Claim เกินจริง รับประกันผล วินิจฉัย Disclaimer Before/After และ Expert Review High-risk ห้าม Auto-fix",
    true,
    true
  ),
  V(
    "human_first",
    "Human-First Quality Validator",
    4,
    "ตรวจ Original Value, Completeness, Clarity, Usefulness, Trust, Duplication และ Template Repetition",
    false,
    false
  ),
  V(
    "seo",
    "SEO Validator",
    5,
    "ตรวจ Intent, Title, Meta, H1-H3, Topic Coverage, Cannibalization, Indexability และ Target URL",
    false,
    false
  ),
  V(
    "aeo",
    "AEO Validator",
    6,
    "ตรวจ Direct Answer, Question Alignment, FAQ, Table, Steps และ Visible Content / Schema Match",
    false,
    false
  ),
  V(
    "geo",
    "GEO Validator",
    7,
    "ตรวจ Specificity, Entity, Evidence, Expert Attribution, Organization Attribution และ Citation-ready Facts",
    false,
    false
  ),
  V(
    "internal_link",
    "Internal Link Validator",
    8,
    "ตรวจว่า URL มีอยู่จริงใน Website Inventory ตรวจ Anchor, Target, Broken URL, Redirect และ Missing Required Link ห้ามสร้าง URL เอง",
    false,
    true
  ),
  V(
    "schema_html",
    "Schema & HTML Validator",
    9,
    "ตรวจ HTML, Heading, Mobile-safe Table, Accessibility, JSON-LD และ Visible Content Match",
    true,
    false
  ),
  V(
    "brand_voice",
    "Brand Voice Validator",
    10,
    "ตรวจ Tone, Terms, CTA Style, Pronoun และ Reading Level",
    false,
    false
  ),
  V(
    "cms_publish",
    "CMS Publish Validator",
    11,
    "ตรวจ Target Website Connection Active, CMS Capability, Author Exists, Category/Tag Exists, Slug Valid, URL Conflict, Featured Image, Media Permission, Schema Supported, Internal Links Valid, Content Status, Approval Complete, Publish Permission, Environment, Rollback Snapshot — Block Publish ถ้า Connection ไม่ Active, Permission ไม่พอ, URL Conflict หรือ Approval ไม่ครบ",
    true,
    true
  ),
];

export const VALIDATOR_OUTPUT_SCHEMA = `{
  "validator": "",
  "version": "",
  "status": "pass|warning|fail|blocked",
  "score": 0,
  "blocking": false,
  "findings": [],
  "missing_information": [],
  "sources_checked": [],
  "summary": ""
}`;

// ── Layer 5: Image Prompt (spec §M) ──────────────────────────────────────────

export const IMAGE_PROMPT_VARIABLES = [
  "{{keyword}}",
  "{{title}}",
  "{{site_name}}",
  "{{brand_tone}}",
  "{{accent_color}}",
];

export const IMAGE_PROMPT_PLACEHOLDER = `ตัวอย่าง:

สร้างภาพประกอบบทความหัวข้อ "{{title}}" สำหรับเว็บไซต์ {{site_name}}

Keyword หลัก: {{keyword}}
โทนแบรนด์: {{brand_tone}}
สีเน้น: {{accent_color}}

สไตล์: clean, modern, ไม่มีตัวอักษรบนภาพ
ต้องมี: cover image 1 ภาพ อัตราส่วน 16:9
คืนค่าเป็น JSON พร้อม alt_text ภาษาไทย`;

// ── Layer 2: Default Master Prompt (spec §G) ─────────────────────────────────

export const DEFAULT_MASTER_PROMPT_NAME = "Human-First SEO/AEO/GEO Article Master Prompt";

export const DEFAULT_MASTER_PROMPT: MasterPromptData = {
  status: "Draft",
  contentType: "Knowledge Article",
  industryScope: "All Industries",
  riskLevel: "medium",
  requiredVariables: [
    "{{business_skill}}",
    "{{article_brief}}",
    "{{approved_sources}}",
    "{{brand_voice}}",
    "{{approved_claims}}",
    "{{prohibited_claims}}",
    "{{expert_reviewer}}",
    "{{content_type}}",
    "{{risk_level}}",
    "{{language}}",
    "{{output_format}}",
  ],
  optionalVariables: ["{{internal_links}}", "{{contact_information}}", "{{website_inventory}}", "{{cms_capabilities}}"],
  systemInstruction: `คุณเป็น Content Production Assistant ของเอเจนซี่
คุณไม่ใช่แพทย์ ทนาย นักวิเคราะห์การเงิน หรือผู้เชี่ยวชาญที่มีใบอนุญาต
เขียนโดยใช้เฉพาะ Business Skill, Article Brief, Approved Sources และ Website Context ที่ได้รับ
ห้ามสร้าง Claim ราคา บริการ เครื่องมือ สาขา Credential สถิติ URL หรือแหล่งข้อมูลขึ้นเอง
หากข้อมูลไม่พอ ให้ระบุ MISSING_INFORMATION
สำหรับ YMYL ให้ใช้ภาษาข้อมูลทั่วไป ไม่วินิจฉัย ไม่รับประกันผล และส่ง Expert Review
ห้ามสร้าง First-hand Experience หากไม่มีข้อมูลจริง
ห้ามยัด Keyword
ห้ามใช้ Template ซ้ำโดยไม่จำเป็น`,
  writingInstruction: `INPUT
Business Skill:
{{business_skill}}

Article Brief:
{{article_brief}}

Approved Sources:
{{approved_sources}}

Brand Voice:
{{brand_voice}}

Approved Claims:
{{approved_claims}}

Prohibited Claims:
{{prohibited_claims}}

Expert Reviewer:
{{expert_reviewer}}

Website Inventory:
{{website_inventory}}

Approved Internal Links:
{{internal_links}}

Contact Information:
{{contact_information}}

CMS Capabilities:
{{cms_capabilities}}

Content Type:
{{content_type}}

Risk:
{{risk_level}}

Language:
{{language}}

WRITING REQUIREMENTS
1. ตอบ Search Intent ให้เร็ว
2. ใช้ H1 หนึ่งครั้ง
3. H2/H3 มีลำดับ
4. ใช้ Direct Answer เมื่อเหมาะสม
5. ใช้ตารางและ Checklist เมื่อมีประโยชน์
6. FAQ ต้องมาจาก Brief
7. Internal Link ใช้เฉพาะ URL ที่ Website Connection ยืนยันและได้รับอนุมัติ
8. CTA ใช้ข้อมูลธุรกิจจริง
9. Source Section ใช้ Approved Sources เท่านั้น
10. Schema ต้องตรง Visible Content และ CMS Capability
11. ระบุ Author / Reviewer ตามข้อมูลจริง
12. Mobile-readable
13. ห้าม Claim เกิน Approved Claims
14. ห้าม Prohibited Claims
15. หาก Website Inventory ขัดกับ Business Skill ให้ FLAGGED_CONFLICT
16. หาก Target URL มีอยู่แล้ว ให้คำนึงถึง Content Refresh / Cannibalization
17. ห้ามสร้าง URL ใหม่เองหากไม่มี URL Policy

INTERNAL QUALITY NOTES (ห้ามแสดงในบทความ Final)
- Missing Information
- Claims Requiring Review
- Sources Used
- Expert Review Required
- Compliance Risk
- Website Conflict`,
  outputFormat: "{{output_format}}",
  prohibitedBehavior: `ห้ามสร้าง Claim ราคา บริการ เครื่องมือ สาขา Credential สถิติ URL หรือแหล่งข้อมูลขึ้นเอง
ห้ามตั้ง AI ว่า "คุณคือแพทย์/ทนาย/ที่ปรึกษาการเงิน" แล้วให้ตอบจากความรู้โมเดลโดยตรง
ห้ามสร้าง First-hand Experience หากไม่มีข้อมูลจริง
ห้ามยัด Keyword หรือใช้ Template ซ้ำโดยไม่จำเป็น`,
  fallbackBehavior: "หากข้อมูลไม่พอสำหรับ variable ใด ให้ระบุ MISSING_INFORMATION แทนการเดา และหยุดสร้างส่วนที่เกี่ยวข้อง",
  testCases: "",
  versionNote: "Default Master Prompt ตาม spec §G",
};
