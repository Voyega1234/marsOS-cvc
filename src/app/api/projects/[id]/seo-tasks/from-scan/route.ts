import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { askJson, addUsage, emptyUsage } from "@/lib/competitor-gap/ai";
import { withOrClient, clientSlugForProject } from "@/lib/orClient";
import { logAIJob } from "@/lib/logAIJob";
import { OR_MODELS, type ORUsage } from "@/lib/openrouter";
import { expandFindings, attachOptions, type ExpandedTask } from "@/lib/seo-task-expand";
import type { SeoFinding, SeoAuditPage } from "@/lib/seo-audit";
import type { SeoAiSuggestKind } from "@/lib/seo-fix-guide";

export const maxDuration = 300;

// ─── สร้างงานรายหน้าจากผลสแกน SEO พร้อม AI แนะนำข้อความ (ไม่บังคับ) ──────────
// (คำสั่งเจ้าของ 2026-09-11) รับ finding ที่ผู้ใช้ติ๊กเลือกจากหน้าสแกน แตกเป็นงาน
// รายหน้าตาม affected แล้วยิง AI แนะนำ title/meta/h1/lead/หัวข้อ ให้เลือกได้ 1-3 แบบ

const MAX_AI_CALLS = 40;
const BATCH_SIZE = 10;

type AiPageInput = {
  url: string;
  title: string;
  metaDescription: string;
  h1: string;
  h2: string[];
  excerpt: string;
  wordCount: number;
  issue: string;
};

type ScanPage = Pick<SeoAuditPage, "url" | "title" | "metaDescription" | "h1" | "h2" | "excerpt" | "wordCount">;

const RULES_BY_KIND: Record<SeoAiSuggestKind, string> = {
  title: "- แต่ละตัวเลือกยาว 50-60 ตัวอักษร ใส่คีย์เวิร์ดหลักไว้ต้นประโยค ห้ามเป็นพาดหัวคลิกเบต และห้ามซ้ำกันเองกับหน้าอื่นในชุดที่ส่งมา",
  metaDescription: "- แต่ละตัวเลือกยาว 120-158 ตัวอักษร มี call to action ชวนคลิก และไม่ซ้ำกันเองกับหน้าอื่นในชุดที่ส่งมา",
  h1: "- แต่ละตัวเลือกเป็นข้อความบรรทัดเดียว สื่อความหมายตรงกับ title ของหน้า ไม่ใส่ HTML",
  lead: "- แต่ละตัวเลือกเป็นย่อหน้า 2-3 ประโยคในบรรทัดเดียว ตอบคำถามหลักของหน้าตรง ๆ ตั้งแต่ประโยคแรก",
  contentTopics: "- แต่ละตัวเลือกเป็นหัวข้อ H2 หนึ่งหัวข้อที่ควรเพิ่มในเนื้อหา (สั้น ไม่ใช่ประโยคเต็มหรือย่อหน้า)",
};

function buildSystemPrompt(kind: SeoAiSuggestKind): string {
  return [
    "คุณเป็น SEO copywriter มืออาชีพ ทำงานให้ทีมการตลาด",
    "เขียนคำแนะนำเป็นภาษาเดียวกับข้อความเดิมของหน้า (หน้าภาษาไทยตอบภาษาไทย หน้าภาษาอังกฤษตอบภาษาอังกฤษ)",
    "ให้ตัวเลือกหน้าละ 3 แบบที่แตกต่างกันจริง (ให้น้อยกว่านั้นได้เฉพาะกรณีทำ 3 แบบที่ต่างกันจริงไม่ได้)",
    RULES_BY_KIND[kind],
    'ตอบกลับเป็น JSON เท่านั้น รูปแบบ { "pages": [ { "url": "...", "options": ["...", "...", "..."] } ] } ห้ามมีข้อความอื่นนอก JSON',
  ].join("\n");
}

const AREAS = new Set(["ONPAGE", "TECHNICAL", "INDEXING"]);
const PRIORITIES = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const str = (v: unknown, max = 4000): string => (typeof v === "string" ? v.slice(0, max) : "");

/** คัดกรอง finding จาก body: ทิ้งตัวที่ไม่มี id/area/category ที่ใช้ได้ และบังคับทุก field เป็นชนิดที่ถูก */
function sanitizeFindings(raw: unknown[]): SeoFinding[] {
  const out: SeoFinding[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const f = item as Record<string, unknown>;
    const id = str(f.id, 80);
    const area = str(f.area, 20);
    const category = str(f.category, 80);
    if (!id || !AREAS.has(area) || !category) continue;
    const affected = Array.isArray(f.affected)
      ? f.affected
          .filter((a): a is Record<string, unknown> => Boolean(a) && typeof a === "object")
          .map((a) => ({ url: str(a.url, 2000), current: str(a.current, 1000), issue: str(a.issue, 1000) }))
          .filter((a) => a.url)
      : [];
    const aiSuggest = str(f.aiSuggest, 30) as SeoAiSuggestKind;
    out.push({
      id,
      area: area as SeoFinding["area"],
      category,
      title: str(f.title, 300) || id,
      detail: str(f.detail),
      evidence: str(f.evidence, 8000),
      priority: (PRIORITIES.has(str(f.priority, 20)) ? f.priority : "MEDIUM") as SeoFinding["priority"],
      severity: f.severity === "fail" ? "fail" : "warn",
      url: str(f.url, 2000) || undefined,
      count: typeof f.count === "number" ? f.count : affected.length || 1,
      affected,
      fix: str(f.fix),
      aiSuggest: ["title", "metaDescription", "h1", "lead", "contentTopics"].includes(aiSuggest) ? aiSuggest : undefined,
    });
  }
  return out;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session!.user.role === "CLIENT") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const project = await prisma.project.findFirst({ where: { id: params.id, organizationId: orgId }, select: { id: true } });
  if (!project) return NextResponse.json({ error: "ไม่พบโปรเจกต์" }, { status: 404 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  // ข้อมูล finding มาจาก client — เก็บเฉพาะที่มีโครงถูกต้อง แล้วบังคับชนิดของแต่ละ field กัน crash กลางทาง
  const findings: SeoFinding[] = Array.isArray(body.findings) ? sanitizeFindings(body.findings) : [];
  const pages: ScanPage[] = Array.isArray(body.pages) ? (body.pages as ScanPage[]) : [];
  const useAi = body.useAi !== false;
  const website = typeof body.website === "string" ? body.website : "";

  if (!findings.length) return NextResponse.json({ error: "ไม่มีรายการที่เลือก" }, { status: 400 });

  const scannedAt = new Date().toISOString();
  let tasks = expandFindings(findings, { website, scannedAt });

  const aiErrors: string[] = [];
  let totalUsage: ORUsage = emptyUsage();
  let aiCalls = 0;
  let anyAttempt = false;
  let anySuccess = false;

  if (useAi) {
    const pageByUrl = new Map(pages.map((p) => [p.url, p]));

    // จัดกลุ่ม task ที่มี aiKey ตาม findingId — เรียก AI เป็นชุด ไม่ยิงทีละหน้า
    const byFinding = new Map<string, { finding: SeoFinding; tasks: ExpandedTask[] }>();
    for (const t of tasks) {
      if (!t.aiKey) continue;
      const entry = byFinding.get(t.aiKey.findingId);
      if (entry) {
        entry.tasks.push(t);
      } else {
        const finding = findings.find((f) => f.id === t.aiKey!.findingId);
        if (finding) byFinding.set(t.aiKey.findingId, { finding, tasks: [t] });
      }
    }

    const optionsByKey = new Map<string, string[]>(); // key = `${findingId}::${url}`
    let capped = false;

    const orClientSlug = await clientSlugForProject(params.id);
    await withOrClient(orClientSlug, async () => {
      outer: for (const { finding, tasks: ftasks } of Array.from(byFinding.values())) {
        if (!finding.aiSuggest) continue;
        for (let i = 0; i < ftasks.length; i += BATCH_SIZE) {
          if (aiCalls >= MAX_AI_CALLS) {
            capped = true;
            break outer;
          }
          const batch = ftasks.slice(i, i + BATCH_SIZE);
          const aiPages: AiPageInput[] = batch.map((t) => {
            const p = pageByUrl.get(t.url ?? "");
            const affected = (finding.affected ?? []).find((a) => a.url === t.url);
            return {
              url: t.url ?? "",
              title: p?.title ?? "",
              metaDescription: p?.metaDescription ?? "",
              h1: p?.h1 ?? "",
              h2: p?.h2 ?? [],
              excerpt: p?.excerpt ?? "",
              wordCount: p?.wordCount ?? 0,
              issue: affected?.issue ?? "",
            };
          });

          aiCalls++;
          anyAttempt = true;
          const res = await askJson<{ pages: Array<{ url: string; options: string[] }> }>({
            trace: "seo_task_suggest",
            system: buildSystemPrompt(finding.aiSuggest),
            user: JSON.stringify({ website, pages: aiPages }),
            maxTokens: 3000,
            temperature: 0.5,
            timeoutMs: 90_000,
          });
          totalUsage = addUsage(totalUsage, res.usage);

          if (!res.data) {
            aiErrors.push(`${finding.title}: ${res.error ?? "AI ไม่ตอบกลับ"}`);
            continue;
          }
          if (res.error) aiErrors.push(`${finding.title}: ${res.error}`);
          anySuccess = true;

          for (const p of res.data.pages ?? []) {
            if (!p?.url) continue;
            const opts = Array.isArray(p.options) ? p.options.map((o) => String(o).trim()).filter(Boolean) : [];
            const deduped = Array.from(new Set(opts)).slice(0, 3);
            if (deduped.length) optionsByKey.set(`${finding.id}::${p.url}`, deduped);
          }
        }
      }
    });

    if (capped) {
      aiErrors.push(`เกินโควตา AI ต่อคำขอ (${MAX_AI_CALLS} ครั้ง) — งานที่เหลือใช้คำแนะนำแบบ static`);
    }

    tasks = tasks.map((t) => {
      if (!t.aiKey) return t;
      const opts = optionsByKey.get(`${t.aiKey.findingId}::${t.aiKey.url}`);
      return opts ? attachOptions(t, opts) : t;
    });

    if (anyAttempt) {
      await logAIJob({
        organizationId: orgId,
        projectId: params.id,
        jobType: "SEO_TASK_SUGGEST",
        modelProvider: "OPENROUTER",
        modelName: OR_MODELS.default(),
        status: anySuccess ? "SUCCESS" : "FAILED",
        tokenUsed: totalUsage.totalTokens,
        estimatedCost: totalUsage.costUsd,
        createdById: session!.user.id,
        inputSummary: `${findings.length} findings, ${aiCalls} calls, ${pages.length} pages`,
      });
    }
  }

  // กันสร้างงานซ้ำ — เทียบ area + title (case-insensitive, trim) กับที่มีอยู่แล้วในโปรเจกต์นี้
  const areas = Array.from(new Set(tasks.map((t) => t.area)));
  const existing = areas.length
    ? await prisma.seoTask.findMany({
        where: { projectId: params.id, area: { in: areas } },
        select: { area: true, title: true },
      })
    : [];
  const existingKeys = new Set(existing.map((e) => `${e.area}::${e.title.trim().toLowerCase()}`));

  let skipped = 0;
  const seenNew = new Set<string>();
  const toCreate: ExpandedTask[] = [];
  for (const t of tasks) {
    const key = `${t.area}::${t.title.trim().toLowerCase()}`;
    if (existingKeys.has(key) || seenNew.has(key)) {
      skipped++;
      continue;
    }
    seenNew.add(key);
    toCreate.push(t);
  }

  const created = toCreate.length
    ? await prisma.seoTask.createMany({
        data: toCreate.map((t) => ({
          organizationId: orgId,
          projectId: params.id,
          area: t.area,
          category: t.category,
          title: t.title.trim(),
          detail: t.detail,
          url: t.url,
          priority: t.priority,
          evidence: t.evidence,
        })),
      })
    : { count: 0 };

  return NextResponse.json(
    { count: created.count, skipped, aiCostUsd: totalUsage.costUsd, aiErrors },
    { status: 201 }
  );
}
