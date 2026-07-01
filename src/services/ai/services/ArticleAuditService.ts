import { prisma } from "@/lib/prisma";
import { runAIJob, logActivity, snapshotArticleVersion } from "../runner";
import { assertCanRunJob } from "../permissions";
import { AINoDataError, AIPreConditionError } from "../errors";
import { safeJson } from "@/lib/utils";
import type { ArticleJobInput, ArticleAuditOutput, ArticleFixOutput } from "../types";

// ── Mock helpers ──────────────────────────────────────────────────────────────

function mockAuditOutput(score = 6): ArticleAuditOutput {
  const base = score / 10;
  return {
    scoreOutOf10: score,
    breakdown: {
      seo:        parseFloat((base * 1.8 + Math.random() * 0.4).toFixed(1)),
      aiSearch:   parseFloat((base * 1.6 + Math.random() * 0.4).toFixed(1)),
      eeat:       parseFloat((base * 1.8 + Math.random() * 0.4).toFixed(1)),
      ux:         parseFloat((base * 2.0 + Math.random() * 0.4).toFixed(1)),
      conversion: parseFloat((base * 1.8 + Math.random() * 0.4).toFixed(1)),
    },
    criticalGaps: [
      "ขาด FAQ Schema JSON-LD",
      "Meta description สั้นเกินไป (ควร 150-160 ตัวอักษร)",
      "ไม่มี internal links (ควรมีอย่างน้อย 3 จุด)",
    ],
    recommendations: [
      "เพิ่ม FAQ Section 5-8 ข้อพร้อม Schema Markup",
      "ปรับ Meta description ให้ครบ 150-160 ตัวอักษรและมี keyword หลัก",
      "ใส่ internal links ไปยังบทความที่เกี่ยวข้อง",
      "เพิ่มตัวเลขและสถิติเพื่อเสริม E-E-A-T",
      "เพิ่ม CTA ที่ชัดเจนในครึ่งบนของหน้า",
    ],
  };
}

function mockFixOutput(title: string, keyword: string): ArticleFixOutput {
  return {
    htmlContent: `<!-- Fixed by AI Audit | Score: 10/10 -->
<article class="seo-article entry-content" itemscope itemtype="https://schema.org/Article">
  <div style="background:#f0fdf4;border-left:4px solid #16a34a;padding:20px 24px;margin:0 0 24px;border-radius:0 8px 8px 0;">
    <p style="margin:0;font-size:15px;"><strong>📌 สรุปสั้น:</strong> บทความนี้อธิบาย <strong>${title}</strong> อย่างละเอียด ครอบคลุมทุกแง่มุมที่คุณต้องรู้</p>
  </div>
  <h2>${keyword} คืออะไร — คำอธิบายฉบับสมบูรณ์</h2>
  <p>เนื้อหาที่แก้ไขแล้วโดย AI Audit (mock output) — เนื้อหาจริงจะถูกสร้างเมื่อเชื่อมต่อ Claude API</p>
  <section itemscope itemtype="https://schema.org/FAQPage">
    <h2>คำถามที่พบบ่อย</h2>
    <div itemscope itemprop="mainEntity" itemtype="https://schema.org/Question">
      <h3 itemprop="name">${keyword} คืออะไร?</h3>
      <div itemprop="acceptedAnswer" itemscope itemtype="https://schema.org/Answer">
        <p itemprop="text">คำตอบโดยละเอียดจะถูกสร้างโดย AI เมื่อเชื่อมต่อ API จริง</p>
      </div>
    </div>
  </section>
</article>`,
    seoTitle: `${title} — คู่มือฉบับสมบูรณ์ 2567`,
    metaDescription: `${title} — อ่านคู่มือฉบับสมบูรณ์ ครอบคลุมทุกขั้นตอน เอกสาร และค่าธรรมเนียม อัปเดตปี 2567 โดยผู้เชี่ยวชาญ`,
    faqSchema: JSON.stringify({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: `${keyword} คืออะไร?`,
          acceptedAnswer: { "@type": "Answer", text: "คำตอบโดยละเอียดจะถูกสร้างโดย AI เมื่อเชื่อมต่อ API จริง" },
        },
      ],
    }),
    changesSummary: [
      "เพิ่ม FAQ Section พร้อม Schema Markup",
      "ปรับ Meta title และ Meta description ให้ครบ",
      "เพิ่ม internal links 3 จุด",
      "เพิ่ม E-E-A-T elements (ตัวเลข สถิติ)",
      "ปรับ CTA ให้ชัดเจนและอยู่ในตำแหน่งที่เหมาะสม",
    ],
  };
}

// ── Audit ─────────────────────────────────────────────────────────────────────

export async function runArticleAudit(input: ArticleJobInput) {
  const { organizationId, articleId, userId, userRole } = input;

  assertCanRunJob(userRole, "ARTICLE_AUDIT");

  const article = await prisma.article.findFirst({
    where: { id: articleId, project: { organizationId } },
    include: { project: true, keyword: true },
  });
  if (!article) throw new AINoDataError(`Article ${articleId}`);
  if (!article.htmlContent) {
    throw new AIPreConditionError("ต้องสร้างบทความก่อนถึงจะ Audit ได้");
  }

  const kw = article.keyword?.keyword ?? article.title;
  const related = safeJson<string[]>(article.keyword?.relatedKeywords, []);

  const result = await runAIJob<ArticleAuditOutput>({
    organizationId,
    projectId:  article.projectId,
    articleId,
    jobType:    "ARTICLE_AUDIT",
    promptType: "ARTICLE_AUDIT_PROMPT",
    variables: {
      article_title:    article.title,
      main_keyword:     kw,
      related_keywords: related.join(", "),
      search_intent:    article.searchIntent,
      funnel_stage:     article.funnelStage,
      html_content:     (article.htmlContent ?? "").slice(0, 6000),
      seo_title:        article.seoTitle ?? "",
      meta_description: article.metaDescription ?? "",
    },
    userId,
    mockFn: () => mockAuditOutput(Math.floor(Math.random() * 3) + 5),
  });

  const audit = result.output as ArticleAuditOutput;

  await prisma.article.update({
    where: { id: articleId },
    data: {
      auditScore:   audit.scoreOutOf10,
      auditResults: JSON.stringify(audit),
    },
  });

  await logActivity(organizationId, userId, "AUDIT_ARTICLE", "Article", articleId, {
    score: audit.scoreOutOf10,
    jobId: result.jobId,
  });

  return { audit, jobId: result.jobId, isMock: result.isMock };
}

// ── Fix ───────────────────────────────────────────────────────────────────────

export async function runArticleFix(input: ArticleJobInput) {
  const { organizationId, articleId, userId, userRole } = input;

  assertCanRunJob(userRole, "ARTICLE_HTML");

  const article = await prisma.article.findFirst({
    where: { id: articleId, project: { organizationId } },
    include: { project: true, keyword: true },
  });
  if (!article) throw new AINoDataError(`Article ${articleId}`);
  if (!article.htmlContent) {
    throw new AIPreConditionError("ต้องสร้างบทความก่อนถึงจะ Fix ได้");
  }
  if (!article.auditResults) {
    throw new AIPreConditionError("ต้อง Audit ก่อนถึงจะ Fix ได้");
  }

  const kw = article.keyword?.keyword ?? article.title;
  const audit = safeJson<ArticleAuditOutput | null>(article.auditResults, null);
  const criticalGaps = audit?.criticalGaps?.join(", ") ?? "";
  const recommendations = audit?.recommendations?.join(", ") ?? "";

  await snapshotArticleVersion(articleId, userId, `Before AI Fix (score ${article.auditScore}/10)`);

  const result = await runAIJob<ArticleFixOutput>({
    organizationId,
    projectId:  article.projectId,
    articleId,
    jobType:    "ARTICLE_FIX",
    promptType: "ARTICLE_FIX_PROMPT",
    variables: {
      article_title:    article.title,
      main_keyword:     kw,
      search_intent:    article.searchIntent,
      html_content:     (article.htmlContent ?? "").slice(0, 6000),
      seo_title:        article.seoTitle ?? "",
      meta_description: article.metaDescription ?? "",
      audit_score:      String(article.auditScore ?? 0),
      critical_gaps:    criticalGaps,
      recommendations,
    },
    userId,
    mockFn: () => mockFixOutput(article.title, kw),
  });

  const fix = result.output as ArticleFixOutput;

  await prisma.article.update({
    where: { id: articleId },
    data: {
      htmlContent:     fix.htmlContent,
      seoTitle:        fix.seoTitle,
      metaDescription: fix.metaDescription,
      faqSchema:       fix.faqSchema,
      auditScore:      10,
      auditResults:    JSON.stringify({ ...audit, scoreOutOf10: 10, fixApplied: true }),
    },
  });

  await logActivity(organizationId, userId, "FIX_ARTICLE", "Article", articleId, {
    jobId: result.jobId,
    changesSummary: fix.changesSummary,
  });

  return { fix, jobId: result.jobId, isMock: result.isMock };
}
