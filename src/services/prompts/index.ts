import { prisma } from "@/lib/prisma";
import { compilePrompt, extractVariables, AVAILABLE_VARIABLES } from "@/services/ai/compiler";
import type { PromptVariables } from "@/services/ai/compiler";

// ── Role guards ───────────────────────────────────────────────────────────────

export function canViewPrompts(role: string) {
  return ["ADMIN", "SEO_MANAGER"].includes(role);
}

export function canEditPrompts(role: string) {
  return role === "ADMIN";
}

export function canActivatePrompts(role: string) {
  return role === "ADMIN";
}

// ── Snapshot helper ───────────────────────────────────────────────────────────

export async function snapshotPrompt(
  promptId: string,
  userId: string,
  changeNote?: string
) {
  const p = await prisma.promptTemplate.findUniqueOrThrow({ where: { id: promptId } });
  return prisma.promptVersion.create({
    data: {
      promptTemplateId: p.id,
      versionNumber: p.version,
      name: p.name,
      type: p.type,
      description: p.description,
      promptText: p.promptText,
      variables: p.variables,
      modelProvider: p.modelProvider,
      modelName: p.modelName,
      temperature: p.temperature,
      maxTokens: p.maxTokens,
      changeNote: changeNote ?? null,
      createdById: userId,
    },
  });
}

// ── Activate / deactivate ─────────────────────────────────────────────────────

export async function activatePrompt(promptId: string, orgId: string, userId: string) {
  const prompt = await prisma.promptTemplate.findFirst({
    where: { id: promptId, organizationId: orgId },
  });
  if (!prompt) throw new Error("Prompt not found");
  if (prompt.isActive) return prompt;

  // Deactivate every other prompt of the same type in this org
  await prisma.promptTemplate.updateMany({
    where: { organizationId: orgId, type: prompt.type, isActive: true },
    data: { isActive: false },
  });

  const updated = await prisma.promptTemplate.update({
    where: { id: promptId },
    data: { isActive: true, updatedById: userId },
  });

  await prisma.activityLog.create({
    data: {
      organizationId: orgId,
      userId,
      action: "ACTIVATE_PROMPT",
      entityType: "PromptTemplate",
      entityId: promptId,
      newValue: JSON.stringify({ type: prompt.type, name: prompt.name }),
    },
  });

  return updated;
}

export async function deactivatePrompt(promptId: string, orgId: string, userId: string) {
  const prompt = await prisma.promptTemplate.findFirst({
    where: { id: promptId, organizationId: orgId },
  });
  if (!prompt) throw new Error("Prompt not found");

  const updated = await prisma.promptTemplate.update({
    where: { id: promptId },
    data: { isActive: false, updatedById: userId },
  });

  await prisma.activityLog.create({
    data: {
      organizationId: orgId,
      userId,
      action: "DEACTIVATE_PROMPT",
      entityType: "PromptTemplate",
      entityId: promptId,
      oldValue: JSON.stringify({ type: prompt.type, name: prompt.name }),
    },
  });

  return updated;
}

// ── Test runner ───────────────────────────────────────────────────────────────

const SAMPLE_DEFAULTS = AVAILABLE_VARIABLES.reduce(
  (acc, v) => ({ ...acc, [v.name]: v.example }),
  {} as Record<string, string>
);

export async function testPrompt(
  promptId: string,
  orgId: string,
  userId: string,
  overrides: Record<string, string> = {}
) {
  const prompt = await prisma.promptTemplate.findFirst({
    where: { id: promptId, organizationId: orgId },
  });
  if (!prompt) throw new Error("Prompt not found");

  const vars: PromptVariables = { ...SAMPLE_DEFAULTS, ...overrides };
  const compiled = compilePrompt(prompt.promptText, vars);
  const usedVars = extractVariables(prompt.promptText);
  const missingVars = usedVars.filter((v) => !vars[v] || vars[v] === "");

  const mockOutput = buildMockOutput(prompt.type, compiled, vars);
  const tokenEstimate = Math.ceil(compiled.length / 4);
  const costEstimate = parseFloat(((tokenEstimate / 1_000_000) * 3).toFixed(6));

  // Record the test run as an AIJob so it appears in AI Jobs log
  await prisma.aIJob.create({
    data: {
      organizationId: orgId,
      jobType: "PROMPT_TEST",
      status: "DONE",
      modelProvider: prompt.modelProvider,
      modelName: prompt.modelName,
      input: compiled.slice(0, 2000),
      output: mockOutput.slice(0, 4000),
      tokenUsed: tokenEstimate,
      estimatedCost: costEstimate,
      createdById: userId,
    },
  });

  await prisma.activityLog.create({
    data: {
      organizationId: orgId,
      userId,
      action: "TEST_PROMPT",
      entityType: "PromptTemplate",
      entityId: promptId,
      newValue: JSON.stringify({ overrideCount: Object.keys(overrides).length }),
    },
  });

  return {
    compiled,
    output: mockOutput,
    missingVariables: missingVars,
    tokenEstimate,
    costEstimate,
  };
}

// ── Mock output generators ────────────────────────────────────────────────────

function buildMockOutput(type: string, _compiled: string, vars: PromptVariables): string {
  const kw = (vars.main_keyword as string) ?? (vars.seed_keyword as string) ?? "keyword";
  const title = (vars.article_title as string) ?? kw;
  const lang = (vars.language as string) ?? "th";

  switch (type) {
    case "KEYWORD_RESEARCH_PROMPT":
      return JSON.stringify({
        seed_keyword: kw,
        keywords: [
          { keyword: `${kw} คืออะไร`, volume: 2400, difficulty: 35, intent: "INFORMATIONAL", funnel: "TOFU" },
          { keyword: `${kw} ต้องใช้เอกสารอะไร`, volume: 1800, difficulty: 28, intent: "INFORMATIONAL", funnel: "MOFU" },
          { keyword: `${kw} ราคาเท่าไหร่`, volume: 900, difficulty: 42, intent: "COMMERCIAL", funnel: "MOFU" },
          { keyword: `สมัคร ${kw} ด้วยตัวเอง`, volume: 600, difficulty: 55, intent: "TRANSACTIONAL", funnel: "BOFU" },
          { keyword: `${kw} กี่วันได้`, volume: 1200, difficulty: 30, intent: "INFORMATIONAL", funnel: "TOFU" },
        ],
        note: "[MOCK] Connect ANTHROPIC_API_KEY for real keyword suggestions",
      }, null, 2);

    case "CONTENT_MAP_PROMPT":
      return JSON.stringify({
        content_map: [
          { funnel: "TOFU", title: `${kw} คืออะไร ต้องรู้ก่อนยื่น`, intent: "INFORMATIONAL", priority: 1 },
          { funnel: "TOFU", title: `เอกสารที่ต้องใช้ในการยื่น ${kw}`, intent: "INFORMATIONAL", priority: 2 },
          { funnel: "MOFU", title: `ขั้นตอนการยื่น ${kw} ทีละขั้น`, intent: "NAVIGATIONAL", priority: 3 },
          { funnel: "MOFU", title: `ค่าใช้จ่าย ${kw} มีอะไรบ้าง`, intent: "COMMERCIAL", priority: 4 },
          { funnel: "BOFU", title: `จ้างบริษัทยื่น ${kw} ดีไหม เปรียบเทียบ`, intent: "TRANSACTIONAL", priority: 5 },
        ],
        note: "[MOCK] Connect ANTHROPIC_API_KEY for real content map",
      }, null, 2);

    case "OUTLINE_PROMPT":
      return JSON.stringify({
        title,
        outline: [
          { h2: "Introduction", h3s: [`${kw} คืออะไร`, "ทำไมต้องรู้เรื่องนี้"] },
          { h2: "Section 1 — ภาพรวม", h3s: ["ข้อมูลสำคัญ", "ตัวเลขและสถิติ"] },
          { h2: "Section 2 — รายละเอียด", h3s: ["ขั้นตอน", "ข้อควรระวัง"] },
          { h2: "FAQ", h3s: [`${kw} ใช้เวลานานแค่ไหน`, "ต้องการเอกสารอะไรบ้าง"] },
          { h2: "สรุป + CTA", h3s: [] },
        ],
        seo_title: `${title} | ครบทุกข้อมูลที่ควรรู้`,
        meta_description: `เรียนรู้ทุกเรื่องเกี่ยวกับ${kw} ฉบับสมบูรณ์ พร้อมขั้นตอนและคำแนะนำจากผู้เชี่ยวชาญ`,
        note: "[MOCK] Connect ANTHROPIC_API_KEY for real outline",
      }, null, 2);

    case "ARTICLE_WRITER_PROMPT":
      return `<article lang="${lang}">
<h1>${title}</h1>
<p class="intro">บทความนี้เป็น <strong>mock output</strong> สำหรับทดสอบระบบ Prompt Library เท่านั้น</p>

<h2>Section 1 — ภาพรวม${kw}</h2>
<p>เนื้อหาในส่วนนี้จะพูดถึงภาพรวมของ ${kw} โดยละเอียด...</p>

<h2>Section 2 — ขั้นตอนและวิธีการ</h2>
<ol>
  <li>ขั้นตอนที่ 1: เตรียมเอกสาร</li>
  <li>ขั้นตอนที่ 2: ยื่นคำร้อง</li>
  <li>ขั้นตอนที่ 3: รอผล</li>
</ol>

<div class="faq-section">
  <h2>คำถามที่พบบ่อย</h2>
  <details><summary>ใช้เวลานานแค่ไหน?</summary><p>โดยทั่วไปใช้เวลา 5-10 วันทำการ</p></details>
</div>
</article>
<!-- [MOCK] Connect ANTHROPIC_API_KEY for real article generation -->`;

    case "SEO_CHECK_PROMPT":
      return JSON.stringify({
        seo_score: 78,
        aeo_score: 65,
        conversion_score: 70,
        risk_level: "LOW",
        issues: [
          { severity: "warning", message: "Meta description อาจสั้นเกินไป (< 120 chars)" },
          { severity: "info", message: "พิจารณาเพิ่ม FAQ Schema markup" },
        ],
        suggestions: [
          "เพิ่ม internal links ไปยังบทความที่เกี่ยวข้อง",
          "ปรับ heading structure ให้มี H3 มากขึ้น",
        ],
        note: "[MOCK] Connect ANTHROPIC_API_KEY for real SEO analysis",
      }, null, 2);

    case "IMAGE_PROMPT_GENERATOR":
      return JSON.stringify({
        image_prompts: [
          { purpose: "cover", prompt: `Professional infographic about ${kw}, clean minimal design, Thai text labels, blue and white color scheme, high resolution` },
          { purpose: "step-diagram", prompt: `Step-by-step diagram showing ${kw} process, numbered steps, icons, Thai language, corporate style` },
        ],
        alt_texts: [
          `ขั้นตอนการ${kw} ฉบับสมบูรณ์`,
          `แผนภาพแสดงกระบวนการ${kw}`,
        ],
        note: "[MOCK] Connect ANTHROPIC_API_KEY for real image prompts",
      }, null, 2);

    case "WORDPRESS_PUBLISH_PROMPT":
      return JSON.stringify({
        wp_payload: {
          title,
          status: "draft",
          categories: ["uncategorized"],
          tags: [kw, "seo", "content"],
          meta: {
            _yoast_wpseo_title: `${title} | SEO Title`,
            _yoast_wpseo_metadesc: `คำอธิบายสำหรับ ${kw} ครบถ้วนพร้อมข้อมูลเชิงลึก`,
          },
        },
        note: "[MOCK] Connect ANTHROPIC_API_KEY for real WordPress payload",
      }, null, 2);

    default:
      return JSON.stringify({
        result: `Mock output for prompt type: ${type}`,
        compiled_length: _compiled.length,
        note: "[MOCK] Connect ANTHROPIC_API_KEY for real AI response",
      }, null, 2);
  }
}
