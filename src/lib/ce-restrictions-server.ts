// Content Engine ข้อจำกัด — ส่วนที่อ่าน/เช็ค DB (ใช้ฝั่งเซิร์ฟเวอร์เท่านั้น) ดู src/lib/ce-restrictions.ts

import { prisma } from "@/lib/prisma";
import { orChat, OR_MODELS } from "@/lib/openrouter";
import type { CEScope } from "@/lib/content-engine-resolve";
import {
  CE_RESTRICTIONS,
  CE_RESTRICTION_FILE,
  RESTRICTION_FILES_TOTAL_MAX_CHARS,
  RESTRICTION_FILE_MAX_CHARS,
  applyBannedReplacements,
  collectBannedSegments,
  findBannedTerms,
  parseBannedTerms,
  parseRestrictionFileMeta,
  parseRestrictions,
  replaceSegments,
  type BannedHit,
  type BannedTerm,
  type RestrictionFile,
  type RestrictionsContext,
} from "@/lib/ce-restrictions";

/** เพดานไฟล์ข้อจำกัด (ต่อแถว + รวมทั้ง scope) — ผ่าน = null, เกิน = ข้อความแจ้งทีม */
export async function checkRestrictionFileLimits(
  orgId: string,
  projectId: string | null,
  promptText: unknown,
): Promise<string | null> {
  const len = typeof promptText === "string" ? promptText.trim().length : 0;
  if (len > RESTRICTION_FILE_MAX_CHARS) {
    return `ไฟล์ส่วนนี้ยาว ${len.toLocaleString()} ตัวอักษร เกินเพดาน ${RESTRICTION_FILE_MAX_CHARS.toLocaleString()} ต่อส่วน`;
  }
  const rows = projectId
    ? await prisma.$queryRaw<Array<{ total: bigint | number | null }>>`
        SELECT COALESCE(SUM(LENGTH("promptText")), 0) AS total FROM "plans_seo_pipeline"."PromptTemplate"
        WHERE "organizationId" = ${orgId} AND "projectId" = ${projectId} AND "type" = ${CE_RESTRICTION_FILE}`
    : await prisma.$queryRaw<Array<{ total: bigint | number | null }>>`
        SELECT COALESCE(SUM(LENGTH("promptText")), 0) AS total FROM "plans_seo_pipeline"."PromptTemplate"
        WHERE "organizationId" = ${orgId} AND "projectId" IS NULL AND "type" = ${CE_RESTRICTION_FILE}`;
  const used = Number(rows[0]?.total ?? 0);
  if (used + len > RESTRICTION_FILES_TOTAL_MAX_CHARS) {
    return `ไฟล์ข้อจำกัดรวมกันเกิน ${RESTRICTION_FILES_TOTAL_MAX_CHARS.toLocaleString()} ตัวอักษร (ใช้ไปแล้ว ${used.toLocaleString()}) — ลบไฟล์ที่ไม่ใช้ก่อน`;
  }
  return null;
}

/**
 * ไฟล์ข้อจำกัดรวมได้หลาย MB ต่อ scope — เขียนทีละ 10 บทความไม่ควรดึงข้อความเต็มซ้ำทุกบทความ
 * เก็บไว้ในหน่วยความจำของ instance แล้วเทียบลายเซ็น (id + updatedAt ของทุกไฟล์) ทุกครั้งที่โหลด
 * ไฟล์ถูกเพิ่ม/ลบ/แก้ = ลายเซ็นเปลี่ยน = โหลดใหม่ จึงไม่มีทางได้ข้อมูลเก่า
 */
const FILE_CACHE_MAX_SCOPES = 6;
const fileCache = new Map<string, { signature: string; files: RestrictionFile[] }>();

async function loadRestrictionFiles(orgId: string, projectId: string | null): Promise<RestrictionFile[]> {
  const where = { organizationId: orgId, projectId, type: CE_RESTRICTION_FILE };
  const heads = await prisma.promptTemplate.findMany({
    where,
    orderBy: { createdAt: "asc" },
    select: { id: true, updatedAt: true },
  });
  if (!heads.length) return [];
  const key = `${orgId}:${projectId ?? "studio"}`;
  const signature = heads.map((h) => `${h.id}@${h.updatedAt.getTime()}`).join(",");
  const cached = fileCache.get(key);
  if (cached && cached.signature === signature) {
    fileCache.delete(key);
    fileCache.set(key, cached);
    return cached.files;
  }
  const rows = await prisma.promptTemplate.findMany({
    where,
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, description: true, promptText: true },
  });
  const files: RestrictionFile[] = rows.map((f) => ({
    id: f.id,
    name: f.name,
    meta: parseRestrictionFileMeta(f.description),
    text: f.promptText,
  }));
  // ไฟล์ถูกแก้ระหว่างสองคำสั่ง = ลายเซ็นไม่ตรงกับข้อความที่ได้ — ใช้รอบนี้ได้แต่ไม่เก็บ
  if (rows.length === heads.length && rows.every((r, i) => r.id === heads[i].id)) {
    fileCache.delete(key);
    fileCache.set(key, { signature, files });
    while (fileCache.size > FILE_CACHE_MAX_SCOPES) fileCache.delete(fileCache.keys().next().value as string);
  }
  return files;
}

/**
 * ข้อจำกัดของ scope นี้ (แถว Active ของ CE_RESTRICTIONS + ไฟล์ทุกไฟล์ใน scope เดียวกัน)
 * ไม่มีแถวหรือสถานะ Draft = ไม่มีข้อจำกัด (layer นี้ไม่บังคับ)
 */
export async function loadRestrictions(orgId: string, scope: CEScope): Promise<RestrictionsContext | null> {
  const projectId = scope === "studio" ? null : scope.projectId;
  const row = await prisma.promptTemplate.findFirst({
    where: { organizationId: orgId, projectId, type: CE_RESTRICTIONS, isActive: true },
    orderBy: { updatedAt: "desc" },
    select: { id: true, promptText: true },
  });
  if (!row) return null;
  const data = parseRestrictions(row.promptText);
  if (data.status === "Draft") return null;
  const files = await loadRestrictionFiles(orgId, projectId);
  return { rowId: row.id, data, files };
}

// ── บังคับคำต้องห้ามหลังเขียนเสร็จ ───────────────────────────────────────────

export interface RestrictionEnforcement {
  html: string;
  metaDescription: string;
  /** จำนวนคำที่แทนด้วยคำแทนที่ตั้งไว้ */
  replaced: number;
  /** จำนวนท่อนข้อความที่ AI เขียนใหม่ */
  rewritten: number;
  /** คำต้องห้ามที่ยังเหลือหลังแก้ทุกขั้น (ว่าง = ผ่าน) */
  remaining: BannedHit[];
}

const META_SEGMENT_ID = -1;

function mergeHits(a: BannedHit[], b: BannedHit[]): BannedHit[] {
  const map = new Map<string, BannedHit>();
  for (const h of [...a, ...b]) {
    const prev = map.get(h.term);
    map.set(h.term, prev ? { ...prev, count: prev.count + h.count } : { ...h });
  }
  return Array.from(map.values());
}

async function rewriteSegments(
  items: { id: number; text: string }[],
  terms: BannedTerm[],
  opts: { trace: string; model?: string; timeoutMs?: number },
): Promise<Map<number, string>> {
  const termList = terms.map((t) => (t.replacement ? `- "${t.term}" (ใช้ "${t.replacement}" แทนได้)` : `- "${t.term}"`)).join("\n");
  const system = [
    "คุณคือบรรณาธิการที่แก้ข้อความให้ไม่มีคำต้องห้ามของลูกค้า",
    "เขียนแต่ละท่อนใหม่ให้ไม่มีคำต้องห้ามในรูปแบบใดเลย (รวมสะกดต่าง เว้นวรรค หรือเลี่ยงด้วยสัญลักษณ์)",
    "คงความหมายเดิม ภาษาเดิม ความยาวใกล้เดิม ห้ามเพิ่มข้อมูลหรือคำกล่าวอ้างใหม่",
    "ท่อนอาจเป็นเศษประโยคที่ถูกตัดด้วยตัวหนา/ลิงก์ — เขียนใหม่เฉพาะท่อนนั้นให้ต่อกับข้อความรอบข้างได้",
    "ห้ามใส่ HTML tag ส่วน HTML entity เดิม (เช่น &amp;) ให้คงไว้",
    'ตอบเป็น JSON เท่านั้น: {"segments":[{"id":<id เดิม>,"text":"<ข้อความใหม่>"}]}',
  ].join("\n");
  const user = `คำต้องห้าม:\n${termList}\n\nท่อนที่ต้องแก้:\n${JSON.stringify({ segments: items })}`;
  const res = await orChat({
    trace: opts.trace,
    model: opts.model || OR_MODELS.writer(),
    jsonMode: true,
    temperature: 0.3,
    maxTokens: 12_000,
    timeoutMs: opts.timeoutMs,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  const raw = res.text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const parsed = JSON.parse(raw) as { segments?: Array<{ id?: unknown; text?: unknown }> };
  const allowed = new Set(items.map((i) => i.id));
  const out = new Map<number, string>();
  for (const s of parsed.segments ?? []) {
    if (typeof s.id === "number" && allowed.has(s.id) && typeof s.text === "string" && s.text.trim()) {
      out.set(s.id, s.text);
    }
  }
  return out;
}

/**
 * คำต้องห้ามในบทความที่เขียนเสร็จ: แทนคำที่มีคำแทน → ท่อนที่ยังเหลือให้ AI เขียนใหม่ 1 รอบ → ตรวจซ้ำ
 * ไม่ทำให้การเขียนล้ม — AI ล้มหรือยังเหลือคำ = คืนรายการที่เหลือให้ผู้เรียกแจ้งทีม
 * ผู้เรียกต้องครอบ withOrClient ของลูกค้าไว้แล้ว (ป้าย mars_<client>_<trace>)
 */
export async function enforceRestrictions(params: {
  ctx: RestrictionsContext | null | undefined;
  html: string;
  metaDescription?: string;
  trace: string;
  model?: string;
  timeoutMs?: number;
  /** false = แทนคำอย่างเดียว ไม่เรียก AI (เวลาเหลือน้อย) */
  rewrite?: boolean;
}): Promise<RestrictionEnforcement> {
  const meta0 = params.metaDescription ?? "";
  const terms = params.ctx ? parseBannedTerms(params.ctx.data.bannedTerms) : [];
  if (!terms.length) return { html: params.html, metaDescription: meta0, replaced: 0, rewritten: 0, remaining: [] };

  const r1 = applyBannedReplacements(params.html, terms);
  const r2 = applyBannedReplacements(meta0, terms);
  let html = r1.html;
  let meta = r2.html;
  let rewritten = 0;

  const segments = collectBannedSegments(html, terms);
  const metaDirty = meta && findBannedTerms(meta, terms).length > 0;
  if (params.rewrite !== false && (segments.length || metaDirty)) {
    const items = metaDirty ? [...segments, { id: META_SEGMENT_ID, text: meta }] : segments;
    try {
      const rewrites = await rewriteSegments(items, terms, params);
      const metaNext = rewrites.get(META_SEGMENT_ID);
      rewrites.delete(META_SEGMENT_ID);
      html = replaceSegments(html, rewrites);
      if (metaNext !== undefined) meta = metaNext.replace(/<[^>]*>/g, "").trim() || meta;
      rewritten = rewrites.size + (metaNext !== undefined ? 1 : 0);
    } catch (e) {
      console.warn(`[restrictions] rewrite failed (${params.trace}):`, e instanceof Error ? e.message : e);
    }
  }

  const remaining = mergeHits(findBannedTerms(html, terms), findBannedTerms(meta, terms));
  if (remaining.length) {
    console.warn(`[restrictions] banned terms left (${params.trace}):`, remaining.map((h) => `${h.term}×${h.count}`).join(", "));
  }
  return { html, metaDescription: meta, replaced: r1.replaced + r2.replaced, rewritten, remaining };
}
