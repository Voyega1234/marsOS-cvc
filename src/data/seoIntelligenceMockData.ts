export const mockKeywords = [
  { keyword: "รับทำ seo",             volume: 2400, cpc: 3.80, competition: "High",   difficulty: 62, intent: "Transactional", serpType: "Service Page",   opportunityScore: 88, action: "Create Service Page" },
  { keyword: "seo คืออะไร",           volume: 5400, cpc: 0.90, competition: "Medium", difficulty: 48, intent: "Informational", serpType: "Article",        opportunityScore: 76, action: "Create Article" },
  { keyword: "บริษัท seo",            volume: 1300, cpc: 4.20, competition: "High",   difficulty: 58, intent: "Commercial",    serpType: "List/Service",   opportunityScore: 85, action: "Update Existing Page" },
  { keyword: "seo ราคา",              volume: 1000, cpc: 3.60, competition: "High",   difficulty: 54, intent: "Commercial",    serpType: "Service Page",   opportunityScore: 82, action: "Add FAQ" },
  { keyword: "local seo",             volume: 720,  cpc: 2.40, competition: "Medium", difficulty: 44, intent: "Commercial",    serpType: "Article/Service",opportunityScore: 79, action: "Create Article" },
  { keyword: "seo audit",             volume: 590,  cpc: 3.10, competition: "Medium", difficulty: 39, intent: "Commercial",    serpType: "Tool/Service",   opportunityScore: 81, action: "Create Service Page" },
  { keyword: "technical seo",         volume: 880,  cpc: 2.20, competition: "Medium", difficulty: 51, intent: "Informational", serpType: "Article",        opportunityScore: 72, action: "Create Article" },
  { keyword: "backlink คือ",          volume: 1600, cpc: 0.70, competition: "Low",    difficulty: 35, intent: "Informational", serpType: "Article",        opportunityScore: 68, action: "Create Article" },
  { keyword: "ai search optimization",volume: 320,  cpc: 2.90, competition: "Low",    difficulty: 28, intent: "Emerging",      serpType: "Article",        opportunityScore: 84, action: "Create Article" },
  { keyword: "geo seo",               volume: 210,  cpc: 2.60, competition: "Low",    difficulty: 24, intent: "Emerging",      serpType: "Article/FAQ",    opportunityScore: 83, action: "Add FAQ" },
  { keyword: "keyword research",      volume: 1900, cpc: 1.80, competition: "Medium", difficulty: 46, intent: "Informational", serpType: "Guide",          opportunityScore: 75, action: "Create Article" },
  { keyword: "seo agency thailand",   volume: 480,  cpc: 4.60, competition: "High",   difficulty: 57, intent: "Transactional", serpType: "Service Page",   opportunityScore: 86, action: "Create Service Page" },
]

export const mockCompetitors = [
  { domain: "competitor-a.com", visibility: 78, sharedKeywords: 421, missingKeywords: 36, strongestContent: "Service Pages",    action: "Build service page gap" },
  { domain: "competitor-b.com", visibility: 64, sharedKeywords: 318, missingKeywords: 22, strongestContent: "Blog Guides",      action: "Create content cluster" },
  { domain: "competitor-c.com", visibility: 52, sharedKeywords: 205, missingKeywords: 18, strongestContent: "Comparison Pages", action: "Add comparison content" },
]

export const mockRankings = [
  { keyword: "รับทำ seo",            current: 8,  previous: 12, change: "up",     url: "/seo-service",  priority: "High",   action: "Improve CTA" },
  { keyword: "seo audit",            current: 15, previous: 9,  change: "down",   url: "/seo-audit",    priority: "High",   action: "Refresh content" },
  { keyword: "local seo",            current: 11, previous: 11, change: "stable", url: "/local-seo",    priority: "Medium", action: "Add internal links" },
  { keyword: "ai search optimization",current: 21,previous: 0,  change: "new",    url: "/ai-search-seo",priority: "Medium", action: "Monitor" },
  { keyword: "seo ราคา",             current: 18, previous: 16, change: "down",   url: "/seo-pricing",  priority: "High",   action: "Add FAQ" },
]

export const mockBacklinks = [
  { domain: "industryblog.com",   type: "Editorial",      authority: 72, status: "New",      opportunity: "High relevance",     action: "Keep" },
  { domain: "directory.co",       type: "Directory",      authority: 45, status: "Existing", opportunity: "Local citation",     action: "Monitor" },
  { domain: "competitorlink.com", type: "Competitor Gap", authority: 68, status: "Missing",  opportunity: "Strong opportunity", action: "Outreach" },
  { domain: "oldpartner.net",     type: "Partner",        authority: 51, status: "Lost",     opportunity: "Recoverable",        action: "Contact partner" },
  { domain: "spamdomain.xyz",     type: "Low Quality",    authority: 12, status: "Existing", opportunity: "Risk",               action: "Review" },
]

export const mockAuditIssues = [
  { issue: "Missing title tags",        pages: 12, severity: "High",   why: "Weak search snippet and relevance",     fix: "Add unique SEO titles" },
  { issue: "Duplicate meta descriptions",pages: 18,severity: "Medium", why: "Lower CTR potential",                   fix: "Rewrite descriptions" },
  { issue: "Slow pages",                pages: 7,  severity: "High",   why: "May hurt UX and conversion",            fix: "Optimize assets" },
  { issue: "Broken internal links",     pages: 9,  severity: "Medium", why: "Hurts crawl flow",                      fix: "Fix links" },
  { issue: "Thin content",              pages: 14, severity: "Medium", why: "Weak topical authority",                fix: "Expand content" },
  { issue: "Missing schema",            pages: 22, severity: "Medium", why: "Lower rich result potential",           fix: "Add structured data" },
  { issue: "Poor heading structure",    pages: 16, severity: "Low",    why: "Harder for users and crawlers",         fix: "Fix H1/H2 hierarchy" },
  { issue: "Images without alt text",   pages: 31, severity: "Low",    why: "Accessibility and image SEO issue",     fix: "Add descriptive alt text" },
]

export const mockAiPrompts = [
  { prompt: "Best SEO agency for ecommerce brands",          brandAppears: false, competitorAppears: true,  citationGap: "High",   contentAction: "Create ecommerce SEO service page" },
  { prompt: "Which company should I hire for local SEO?",    brandAppears: false, competitorAppears: true,  citationGap: "Medium", contentAction: "Build local SEO comparison content" },
  { prompt: "Best visa agency in Thailand",                  brandAppears: false, competitorAppears: true,  citationGap: "High",   contentAction: "Improve service proof and FAQ" },
  { prompt: "How to choose a digital marketing agency?",     brandAppears: true,  competitorAppears: true,  citationGap: "Medium", contentAction: "Add comparison guide" },
  { prompt: "What is AI Search Optimization?",               brandAppears: false, competitorAppears: false, citationGap: "Medium", contentAction: "Create educational article" },
]

export const mockOpportunities = [
  {
    id: 1,
    title: "High-intent keyword gap",
    priority: "High",
    evidence: "Competitors rank for several transactional keywords where the target domain has no optimized service page.",
    impact: "The client may be losing leads from users who are already close to purchase.",
    recommendation: "Create or improve service landing pages for these high-intent keywords.",
  },
  {
    id: 2,
    title: "AI answer visibility gap",
    priority: "Medium",
    evidence: "Competitors appear in AI-generated recommendations, but the target brand is missing from common decision-making prompts.",
    impact: "The brand may lose visibility in AI Search / GEO discovery journeys.",
    recommendation: "Improve entity clarity, FAQ content, comparison pages, service proof, and citation-worthy content.",
  },
  {
    id: 3,
    title: "Technical SEO cleanup",
    priority: "Medium",
    evidence: "Several pages have missing metadata, slow performance signals, weak internal links, and missing schema.",
    impact: "Good content may not perform fully because technical SEO is limiting visibility.",
    recommendation: "Run a full audit before the next content sprint.",
  },
]

export const DEMO_BRIEF = {
  title: "Demo SEO Brief",
  topic: "AI Search Optimization for Service Businesses",
  intent: "Informational + Commercial",
  whyItMatters: "Users are starting to ask AI tools for recommendations before searching Google. If the brand is not clearly understood by AI systems, it may lose visibility during early decision-making.",
  suggestedH1: "AI Search Optimization คืออะไร และธุรกิจบริการควรเตรียมตัวยังไง",
  sections: [
    "AI Search Optimization คืออะไร",
    "ต่างจาก SEO แบบเดิมอย่างไร",
    "ทำไมธุรกิจบริการต้องสนใจ",
    "AI ใช้ข้อมูลแบบไหนในการแนะนำแบรนด์",
    "วิธีเพิ่มโอกาสให้แบรนด์ถูกพูดถึงใน AI Answer",
    "FAQ ที่ควรมี",
    "Checklist สำหรับทีม SEO",
  ],
  cta: "Request an SEO visibility audit before planning your next content sprint.",
  note: "This can later be sent to WordGod, Tasks, or Reports. For now, this is demo-only.",
}
