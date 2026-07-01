// Compiles prompt templates by replacing {{variable}} placeholders

export type PromptVariables = Record<string, string | string[] | undefined | null>;

export function compilePrompt(promptText: string, variables: PromptVariables): string {
  let compiled = promptText;
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{{${key}}}`;
    const replacement = Array.isArray(value) ? value.join(", ") : (value ?? "");
    compiled = compiled.replaceAll(placeholder, replacement);
  }
  return compiled;
}

export function extractVariables(promptText: string): string[] {
  const matches = promptText.match(/\{\{(\w+)\}\}/g) ?? [];
  const unique = new Set(matches.map((m) => m.slice(2, -2)));
  return Array.from(unique);
}

// Returns which variables in the template are not supplied (or empty) in `variables`
export function getMissingVariables(promptText: string, variables: PromptVariables): string[] {
  return extractVariables(promptText).filter((v) => {
    const val = variables[v];
    if (val === undefined || val === null) return true;
    if (Array.isArray(val)) return val.length === 0;
    return String(val).trim() === "";
  });
}

// Splits template into alternating [plainText, {{varName}}, …] segments
// used by React components to render each part with appropriate styling.
export function tokenizePrompt(promptText: string): Array<{ type: "text" | "var"; value: string }> {
  const parts = promptText.split(/(\{\{[^}]+\}\})/g);
  return parts.map((p) => {
    const m = p.match(/^\{\{(\w+)\}\}$/);
    return m ? { type: "var" as const, value: m[1] } : { type: "text" as const, value: p };
  });
}

export const AVAILABLE_VARIABLES = [
  { name: "project_name",     label: "Project Name",     example: "Co Journey Visa",                         group: "Project" },
  { name: "website",          label: "Website",          example: "cojourneyvisa.com",                       group: "Project" },
  { name: "business_type",    label: "Business Type",    example: "Visa Agency",                             group: "Project" },
  { name: "target_audience",  label: "Target Audience",  example: "คนไทยที่ต้องการยื่นวีซ่า",                  group: "Project" },
  { name: "language",         label: "Language",         example: "th",                                      group: "Project" },
  { name: "seed_keyword",     label: "Seed Keyword",     example: "วีซ่าเชงเก้น",                             group: "Keywords" },
  { name: "main_keyword",     label: "Main Keyword",     example: "วีซ่าเชงเก้นคืออะไร",                      group: "Keywords" },
  { name: "related_keywords", label: "Related Keywords", example: "schengen visa, วีซ่ายุโรป",               group: "Keywords" },
  { name: "funnel_stage",     label: "Funnel Stage",     example: "TOFU",                                    group: "Keywords" },
  { name: "search_intent",    label: "Search Intent",    example: "INFORMATIONAL",                           group: "Keywords" },
  { name: "article_title",    label: "Article Title",    example: "วีซ่าเชงเก้นคืออะไร ใช้เดินทางที่ไหนได้", group: "Article" },
  { name: "brand_voice",      label: "Brand Voice",      example: "ภาษาทางการ น่าเชื่อถือ เชี่ยวชาญ",        group: "Brand" },
  { name: "html_template",    label: "HTML Template",    example: "elementor-ready",                         group: "Brand" },
  { name: "reference_rules",  label: "Reference Rules",  example: "อ้างอิงสถานทูตและแหล่งทางการเท่านั้น",     group: "Brand" },
  { name: "cta_text",                 label: "CTA Text",                 example: "ติดต่อทีมงาน Co Journey Visa ฟรี",         group: "Brand" },
  { name: "contact_block",           label: "Contact Block",            example: "<div>Line: @cojourneytravel</div>",         group: "Brand" },
  { name: "brand_name",              label: "Brand Name",               example: "Co Journey Visa",                          group: "Brand" },
  { name: "forbidden_claims",        label: "Forbidden Claims",         example: "ห้ามรับประกันผลวีซ่า",                      group: "Brand" },
  { name: "compliance_notes",        label: "Compliance Notes",         example: "FAQPage JSON-LD required",                 group: "Brand" },
  { name: "internal_links",          label: "Internal Links",           example: "/visa-guide, /contact",                    group: "Content" },
  { name: "outline",                 label: "Article Outline",          example: "JSON outline from outline generator",       group: "Content" },
  { name: "html_content",            label: "HTML Content",             example: "<article>...</article>",                   group: "Content" },
  { name: "seo_title",               label: "SEO Title",                example: "วีซ่าเชงเก้นคืออะไร | Co Journey",         group: "Content" },
  { name: "meta_description",        label: "Meta Description",         example: "อ่านคู่มือวีซ่าเชงเก้นฉบับสมบูรณ์",       group: "Content" },
  { name: "faq_schema",              label: "FAQ Schema",               example: "{\"@type\":\"FAQPage\"...}",                group: "Content" },
  { name: "industry",                label: "Industry",                 example: "Visa Agency",                              group: "Brand" },
  { name: "content_goal",            label: "Content Goal",             example: "Educate readers on visa requirements",      group: "Content" },
  { name: "conversion_goal",         label: "Conversion Goal",          example: "Contact for free consultation",            group: "Content" },
  { name: "product_or_service",      label: "Product / Service",        example: "Schengen visa application service",        group: "Brand" },
  { name: "unique_selling_points",   label: "Unique Selling Points",    example: "ผู้เชี่ยวชาญกว่า 10 ปี อนุมัติสูง",        group: "Brand" },
  { name: "trust_signals",           label: "Trust Signals",            example: "NAATI certified, licensed agent",           group: "Brand" },
  { name: "author_profile",          label: "Author Profile",           example: "Visa specialist, 10 years experience",     group: "Brand" },
  { name: "reviewer_profile",        label: "Reviewer Profile",         example: "Senior SEO editor at Co Journey",          group: "Brand" },
  { name: "official_sources",        label: "Official Sources",         example: "สถานทูตฝรั่งเศส, กรมการกงสุล",             group: "Brand" },
  { name: "external_reference_rules",label: "External Reference Rules", example: "อ้างอิงแหล่งทางการเท่านั้น",               group: "Brand" },
  { name: "site_url",                label: "Site URL",                 example: "https://cojourneyvisa.com",                group: "Project" },
];
