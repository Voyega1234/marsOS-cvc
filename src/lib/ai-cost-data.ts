import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { aiCostModuleOf, aiCostModuleByKey } from "@/lib/ai-cost-modules";
import {
  aiCostCreatedAtFilter, eachDateKey, previousAiCostRange, type AiCostRange,
} from "@/lib/ai-cost-range";
import {
  AI_COST_PAGE_SIZE, hasActiveAiCostFilters, type AiCostFilters, type AiCostSort,
} from "@/lib/ai-cost-filters";
import { UPLOAD_ARTICLE_JOB_INPUT_PREFIX, uaClientIdFromJobInput } from "@/lib/upload-article/ai-job-source";

/**
 * ข้อมูลหน้า Settings → AI Cost (แบบแยกละเอียด)
 * - รวมยอดในฐานข้อมูลด้วย groupBy / aggregate ไม่โหลด AIJob ทั้งหมดเข้าหน่วยความจำ
 * - ทุกคำสั่งผูกกับ organizationId ของ session เสมอ
 * - cost ของ job = estimatedCost (AI) + externalCost (API ภายนอก) เหมือนหน้าเดิม
 */

const OK_STATUSES = ["SUCCESS", "COMPLETED"];
const FAILED_STATUS = "FAILED";
const TABLE = Prisma.raw(`"plans_seo_pipeline"."AIJob"`);

export interface CostAgg { calls: number; cost: number; tokens: number; failed: number; failedCost: number }
export interface BreakdownRow extends CostAgg { key: string; label: string; sub?: string; children?: BreakdownRow[] }
export interface FilterOption { value: string; label: string; count: number; cost: number }
export interface DailyPoint { date: string; cost: number; calls: number; byModule: Record<string, number> }
export interface JobRow {
  id: string;
  createdAt: string;
  jobType: string;
  moduleKey: string;
  moduleLabel: string;
  modelName: string;
  modelProvider: string;
  sourceName: string | null;
  userName: string | null;
  tokens: number | null;
  cost: number;
  status: "ok" | "failed" | "other";
  rawStatus: string;
  errorMessage: string | null;
}

export interface AiCostView {
  summary: CostAgg;
  previous: { cost: number; calls: number } | null;
  options: {
    module: FilterOption[]; type: FilterOption[]; model: FilterOption[]; source: FilterOption[]; user: FilterOption[];
  };
  breakdown: {
    module: BreakdownRow[]; type: BreakdownRow[]; model: BreakdownRow[]; source: BreakdownRow[]; user: BreakdownRow[];
  };
  daily: DailyPoint[];
  jobs: JobRow[];
  page: number;
  pageSize: number;
  totalPages: number;
}

interface GRow { key: string; status: string; calls: number; cost: number; tokens: number }

const n = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const emptyAgg = (): CostAgg => ({ calls: 0, cost: 0, tokens: 0, failed: 0, failedCost: 0 });

function addRow(a: CostAgg, r: GRow) {
  a.calls += r.calls; a.cost += r.cost; a.tokens += r.tokens;
  if (r.status === FAILED_STATUS) { a.failed += r.calls; a.failedCost += r.cost; }
}

function fold(rows: GRow[], keyOf: (r: GRow) => string = (r) => r.key): Map<string, CostAgg> {
  const m = new Map<string, CostAgg>();
  for (const r of rows) {
    const k = keyOf(r);
    const a = m.get(k) ?? emptyAgg();
    addRow(a, r);
    m.set(k, a);
  }
  return m;
}

// ── where ────────────────────────────────────────────────────────────────────

type DateBound = { gte?: Date; lte?: Date } | undefined;

/** jobType ที่ผ่านตัวกรอง "ระบบ" + "ประเภทงาน" — null = ไม่จำกัด, [] = ไม่มีอะไรตรง */
function jobTypeConstraint(f: AiCostFilters, allTypes: string[]): string[] | null {
  let list: string[] | null = null;
  if (f.module) list = allTypes.filter((t) => aiCostModuleOf(t).key === f.module);
  if (f.type) list = list ? list.filter((t) => t === f.type) : [f.type];
  return list;
}

function prismaWhere(orgId: string, createdAt: DateBound, f: AiCostFilters, types: string[] | null): Prisma.AIJobWhereInput {
  const and: Prisma.AIJobWhereInput[] = [];
  if (types) and.push({ jobType: { in: types } });
  if (f.model) and.push({ modelName: f.model });
  if (f.user) and.push({ createdById: f.user });
  if (f.status === "failed") and.push({ status: FAILED_STATUS });
  if (f.status === "ok") and.push({ status: { in: OK_STATUSES } });
  if (f.source) {
    if (f.source === "none") {
      // NOT(... startsWith) ทิ้งแถวที่ input เป็น NULL (SQL three-valued logic) จึงต้องรับ input: null ด้วย
      and.push({ projectId: null }, { OR: [{ input: null }, { NOT: { input: { startsWith: UPLOAD_ARTICLE_JOB_INPUT_PREFIX } } }] });
    } else if (f.source.startsWith("p:")) {
      and.push({ projectId: f.source.slice(2) });
    } else if (f.source.startsWith("ua:")) {
      and.push({ projectId: null }, { input: UPLOAD_ARTICLE_JOB_INPUT_PREFIX + f.source.slice(3) });
    }
  }
  return { organizationId: orgId, ...(createdAt ? { createdAt } : {}), ...(and.length ? { AND: and } : {}) };
}

function sqlWhere(orgId: string, createdAt: DateBound, f: AiCostFilters, types: string[] | null): Prisma.Sql {
  const p: Prisma.Sql[] = [Prisma.sql`"organizationId" = ${orgId}`];
  // createdAt เป็น timestamp (ไม่มีโซน, เก็บเป็น UTC) — ต้องแปลงค่าที่ส่งเข้าไปเป็น UTC ชัดๆ
  // ไม่งั้นเทียบตามโซนของ session ฐานข้อมูล (เช่น Asia/Bangkok) แล้วเลื่อนช่วงเวลาไปหลายชั่วโมง
  if (createdAt?.gte) p.push(Prisma.sql`"createdAt" >= (${createdAt.gte}::timestamptz AT TIME ZONE 'UTC')`);
  if (createdAt?.lte) p.push(Prisma.sql`"createdAt" <= (${createdAt.lte}::timestamptz AT TIME ZONE 'UTC')`);
  if (types) p.push(types.length ? Prisma.sql`"jobType" IN (${Prisma.join(types)})` : Prisma.sql`FALSE`);
  if (f.model) p.push(Prisma.sql`"modelName" = ${f.model}`);
  if (f.user) p.push(Prisma.sql`"createdById" = ${f.user}`);
  if (f.status === "failed") p.push(Prisma.sql`"status" = ${FAILED_STATUS}`);
  if (f.status === "ok") p.push(Prisma.sql`"status" IN (${Prisma.join(OK_STATUSES)})`);
  if (f.source) {
    if (f.source === "none") {
      p.push(Prisma.sql`"projectId" IS NULL`, Prisma.sql`("input" IS NULL OR "input" NOT LIKE 'upload-article:%')`);
    } else if (f.source.startsWith("p:")) {
      p.push(Prisma.sql`"projectId" = ${f.source.slice(2)}`);
    } else if (f.source.startsWith("ua:")) {
      p.push(Prisma.sql`"projectId" IS NULL`, Prisma.sql`"input" = ${UPLOAD_ARTICLE_JOB_INPUT_PREFIX + f.source.slice(3)}`);
    }
  }
  return Prisma.join(p, " AND ");
}

// ── grouped totals ───────────────────────────────────────────────────────────

type Sums = { estimatedCost: number | null; externalCost: number | null; tokenUsed: number | null };
const toG = (key: string, status: string, calls: number, s: Sums): GRow => ({
  key, status, calls, cost: n(s.estimatedCost) + n(s.externalCost), tokens: n(s.tokenUsed),
});
const SUMS = { estimatedCost: true, externalCost: true, tokenUsed: true } as const;

interface Groups { type: GRow[]; model: GRow[]; user: GRow[]; source: GRow[] }

async function loadGroups(where: Prisma.AIJobWhereInput, wsql: Prisma.Sql): Promise<Groups> {
  const [t, m, u, s] = await Promise.all([
    prisma.aIJob.groupBy({ by: ["jobType", "status"], where, _count: { id: true }, _sum: SUMS }),
    prisma.aIJob.groupBy({ by: ["modelName", "status"], where, _count: { id: true }, _sum: SUMS }),
    prisma.aIJob.groupBy({ by: ["createdById", "status"], where, _count: { id: true }, _sum: SUMS }),
    // ที่มา = Project (p:) / ลูกค้า Upload Article ที่เก็บใน input (ua:) / ไม่ผูก (none) — ใช้ raw เพราะ key มาจากสองคอลัมน์
    prisma.$queryRaw<Array<{ key: string; status: string; calls: number; est: number; ext: number; tokens: number }>>`
      SELECT
        CASE WHEN "projectId" IS NOT NULL THEN 'p:' || "projectId"
             WHEN "input" LIKE 'upload-article:%' THEN 'ua:' || substring("input" from 16)
             ELSE 'none' END AS key,
        "status",
        COUNT(*)::int AS calls,
        COALESCE(SUM("estimatedCost"), 0)::float8 AS est,
        COALESCE(SUM("externalCost"), 0)::float8 AS ext,
        COALESCE(SUM("tokenUsed"), 0)::float8 AS tokens
      FROM ${TABLE}
      WHERE ${wsql}
      GROUP BY 1, 2`,
  ]);
  return {
    type: t.map((r) => toG(r.jobType, r.status, r._count.id, r._sum)),
    model: m.map((r) => toG(r.modelName, r.status, r._count.id, r._sum)),
    user: u.map((r) => toG(r.createdById, r.status, r._count.id, r._sum)),
    source: s.map((r) => ({ key: r.key, status: r.status, calls: Number(r.calls), cost: n(r.est) + n(r.ext), tokens: n(r.tokens) })),
  };
}

// ── names ────────────────────────────────────────────────────────────────────

interface Names { project: Map<string, string>; upload: Map<string, string>; user: Map<string, string> }

async function resolveNames(orgId: string, sourceKeys: string[], userIds: string[]): Promise<Names> {
  const projectIds = sourceKeys.filter((k) => k.startsWith("p:")).map((k) => k.slice(2));
  const uploadIds = sourceKeys.filter((k) => k.startsWith("ua:") && k.length > 3).map((k) => k.slice(3));
  const [projects, uploads, users] = await Promise.all([
    projectIds.length ? prisma.project.findMany({ where: { id: { in: projectIds }, organizationId: orgId }, select: { id: true, name: true, clientName: true } }) : Promise.resolve([]),
    uploadIds.length ? prisma.uploadClient.findMany({ where: { id: { in: uploadIds }, organizationId: orgId }, select: { id: true, name: true } }) : Promise.resolve([]),
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : Promise.resolve([]),
  ]);
  return {
    project: new Map(projects.map((p) => [p.id, p.clientName ?? p.name])),
    upload: new Map(uploads.map((c) => [c.id, c.name])),
    user: new Map(users.map((u) => [u.id, u.name || u.email])),
  };
}

function sourceLabel(key: string, names: Names): { label: string; sub?: string } {
  if (key === "none") return { label: "ไม่ผูกโปรเจกต์/ลูกค้า", sub: "Studio · Compliance · อื่นๆ" };
  if (key.startsWith("p:")) return { label: names.project.get(key.slice(2)) ?? "โปรเจกต์ที่ถูกลบ", sub: "Project" };
  if (key.startsWith("ua:")) {
    const id = key.slice(3);
    return { label: id ? names.upload.get(id) ?? "ลูกค้าที่ถูกลบ" : "ไม่ระบุลูกค้า (log ก่อนอัปเดต)", sub: "Upload Article" };
  }
  return { label: key };
}

// ── main ─────────────────────────────────────────────────────────────────────

export async function loadAiCostView(
  orgId: string,
  range: AiCostRange,
  filters: AiCostFilters,
  opts: { sort: AiCostSort; page: number },
): Promise<AiCostView> {
  const createdAt = aiCostCreatedAtFilter(range);
  const active = hasActiveAiCostFilters(filters);

  // ขั้นที่ 1: ทุกอย่างในช่วงเวลา (ไม่กรองอย่างอื่น) — ใช้ทำตัวเลือกของตัวกรอง และเป็นยอดแยกเมื่อไม่มีตัวกรอง
  const rangeP = loadGroups(prismaWhere(orgId, createdAt, {}, null), sqlWhere(orgId, createdAt, {}, null));
  // allTypes ใช้เฉพาะตอนมีตัวกรองระบบ — ไม่มี = ไม่ต้องรอขั้นที่ 1
  const allTypes = filters.module ? Array.from(new Set((await rangeP).type.map((r) => r.key))) : [];
  const types = jobTypeConstraint(filters, allTypes);
  const where = prismaWhere(orgId, createdAt, filters, types);
  const wsql = sqlWhere(orgId, createdAt, filters, types);

  const prevRange = previousAiCostRange(range);
  const prevAt = prevRange ? aiCostCreatedAtFilter(prevRange) : undefined;

  let page = Math.max(1, opts.page);
  const skip = (page - 1) * AI_COST_PAGE_SIZE;

  // ขั้นที่ 2: ส่วนที่ขึ้นกับตัวกรอง — ยิงพร้อมกัน
  const [rangeGroups, groups, prevAgg, dailyRows, firstListRows] = await Promise.all([
    rangeP,
    active ? loadGroups(where, wsql) : rangeP,
    prevAt
      ? (async () => {
          // ช่วงก่อนหน้าต้องใช้ jobType ของช่วงนั้นเอง ไม่ใช่ของช่วงปัจจุบัน
          let prevTypes = types;
          if (filters.module) {
            const pt = await prisma.aIJob.groupBy({ by: ["jobType"], where: prismaWhere(orgId, prevAt, {}, null) });
            prevTypes = jobTypeConstraint(filters, pt.map((r) => r.jobType));
          }
          return prisma.aIJob.aggregate({
            where: prismaWhere(orgId, prevAt, filters, prevTypes),
            _count: { id: true },
            _sum: { estimatedCost: true, externalCost: true },
          });
        })()
      : Promise.resolve(null),
    prisma.$queryRaw<Array<{ day: string; jobType: string; calls: number; cost: number }>>`
      SELECT
        to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS day,
        "jobType",
        COUNT(*)::int AS calls,
        (COALESCE(SUM("estimatedCost"), 0) + COALESCE(SUM("externalCost"), 0))::float8 AS cost
      FROM ${TABLE}
      WHERE ${wsql}
      GROUP BY 1, 2
      ORDER BY 1`,
    loadJobRows(orgId, where, wsql, opts.sort, skip),
  ]);

  // summary ต้องรู้ก่อนเพื่อกันหน้าเกินหน้าสุดท้าย
  const summary = emptyAgg();
  for (const r of groups.type) addRow(summary, r);
  const totalPages = Math.max(1, Math.ceil(summary.calls / AI_COST_PAGE_SIZE));
  let listRows = firstListRows;
  if (page > totalPages) {
    page = totalPages;
    listRows = await loadJobRows(orgId, where, wsql, opts.sort, (page - 1) * AI_COST_PAGE_SIZE);
  }

  // ชื่อ: ครอบคลุมทุก key ที่อยู่ในช่วง + แถวในตาราง
  const sourceKeys = Array.from(new Set([...rangeGroups.source.map((r) => r.key), ...listRows.map((j) => j.sourceKey)]));
  const userIds = Array.from(new Set([...rangeGroups.user.map((r) => r.key), ...listRows.map((j) => j.createdById)]));
  const names = await resolveNames(orgId, sourceKeys, userIds);

  // ── ตัวเลือกตัวกรอง (นับตามช่วงเวลา) ──
  const byCost = (a: { cost: number }, b: { cost: number }) => b.cost - a.cost;
  const optsFrom = (m: Map<string, CostAgg>, label: (k: string) => string): FilterOption[] =>
    Array.from(m, ([value, a]) => ({ value, label: label(value), count: a.calls, cost: a.cost })).sort(byCost);

  const rangeType = fold(rangeGroups.type);
  const rangeModule = fold(rangeGroups.type, (r) => aiCostModuleOf(r.key).key);
  const options = {
    module: optsFrom(rangeModule, (k) => aiCostModuleByKey(k).label),
    type: optsFrom(rangeType, (k) => k),
    model: optsFrom(fold(rangeGroups.model), (k) => k),
    source: optsFrom(fold(rangeGroups.source), (k) => sourceLabel(k, names).label),
    user: optsFrom(fold(rangeGroups.user), (k) => names.user.get(k) ?? "ผู้ใช้ที่ถูกลบ"),
  };

  // ── breakdown (ตามตัวกรองปัจจุบัน) ──
  const rows = (m: Map<string, CostAgg>, label: (k: string) => { label: string; sub?: string }): BreakdownRow[] =>
    Array.from(m, ([key, a]) => ({ key, ...label(key), ...a })).sort(byCost);

  const typeMap = fold(groups.type);
  const typeRows = rows(typeMap, (k) => ({ label: k, sub: aiCostModuleOf(k).label }));
  const moduleMap = fold(groups.type, (r) => aiCostModuleOf(r.key).key);
  const moduleRows: BreakdownRow[] = rows(moduleMap, (k) => ({ label: aiCostModuleByKey(k).label })).map((r) => ({
    ...r,
    children: typeRows.filter((t) => aiCostModuleOf(t.key).key === r.key).map((t) => ({ ...t, sub: undefined })),
  }));
  const breakdown = {
    module: moduleRows,
    type: typeRows,
    model: rows(fold(groups.model), (k) => ({ label: k })),
    source: rows(fold(groups.source), (k) => sourceLabel(k, names)),
    user: rows(fold(groups.user), (k) => ({ label: names.user.get(k) ?? "ผู้ใช้ที่ถูกลบ" })),
  };

  // ── รายวัน ──
  const dailyMap = new Map<string, DailyPoint>();
  for (const r of dailyRows) {
    const d = dailyMap.get(r.day) ?? { date: r.day, cost: 0, calls: 0, byModule: {} };
    const mk = aiCostModuleOf(r.jobType).key;
    d.cost += n(r.cost); d.calls += Number(r.calls);
    d.byModule[mk] = (d.byModule[mk] ?? 0) + n(r.cost);
    dailyMap.set(r.day, d);
  }
  const keys = Array.from(dailyMap.keys()).sort();
  const dFrom = range.from ?? keys[0];
  const dTo = range.to ?? keys[keys.length - 1];
  const dayList = dFrom && dTo ? eachDateKey(dFrom, dTo) : [];
  const daily = dayList.length
    ? dayList.map((date) => dailyMap.get(date) ?? { date, cost: 0, calls: 0, byModule: {} })
    : keys.map((k) => dailyMap.get(k)!);

  // ── ตารางรายการ ──
  const jobs: JobRow[] = listRows.map((j) => {
    const m = aiCostModuleOf(j.jobType);
    return {
      id: j.id,
      createdAt: j.createdAt.toISOString(),
      jobType: j.jobType,
      moduleKey: m.key,
      moduleLabel: m.label,
      modelName: j.modelName,
      modelProvider: j.modelProvider,
      sourceName: j.sourceKey === "none" ? null : sourceLabel(j.sourceKey, names).label,
      userName: names.user.get(j.createdById) ?? null,
      tokens: j.tokenUsed,
      cost: n(j.estimatedCost) + n(j.externalCost),
      status: j.status === FAILED_STATUS ? "failed" : OK_STATUSES.includes(j.status) ? "ok" : "other",
      rawStatus: j.status,
      errorMessage: j.status === FAILED_STATUS ? (j.errorMessage?.slice(0, 500) ?? null) : null,
    };
  });

  return {
    summary,
    previous: prevAgg ? { cost: n(prevAgg._sum.estimatedCost) + n(prevAgg._sum.externalCost), calls: prevAgg._count.id } : null,
    options,
    breakdown,
    daily,
    jobs,
    page,
    pageSize: AI_COST_PAGE_SIZE,
    totalPages,
  };
}

async function loadJobRows(orgId: string, where: Prisma.AIJobWhereInput, wsql: Prisma.Sql, sort: AiCostSort, skip: number) {
  const select = {
    id: true, createdAt: true, jobType: true, status: true, modelName: true, modelProvider: true,
    tokenUsed: true, estimatedCost: true, externalCost: true, errorMessage: true,
    projectId: true, input: true, createdById: true,
  } satisfies Prisma.AIJobSelect;

  let rows;
  if (sort === "cost") {
    // เรียงตามค่าใช้จ่ายรวม (AI + API) ต้องคิดในฐานข้อมูล — Prisma orderBy บวกสองคอลัมน์ไม่ได้
    const ids = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM ${TABLE}
      WHERE ${wsql}
      ORDER BY (COALESCE("estimatedCost", 0) + COALESCE("externalCost", 0)) DESC, "createdAt" DESC, "id" DESC
      LIMIT ${AI_COST_PAGE_SIZE} OFFSET ${skip}`;
    const found = await prisma.aIJob.findMany({ where: { organizationId: orgId, id: { in: ids.map((r) => r.id) } }, select });
    const order = new Map(ids.map((r, i) => [r.id, i]));
    rows = found.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  } else {
    rows = await prisma.aIJob.findMany({ where, select, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip, take: AI_COST_PAGE_SIZE });
  }
  return rows.map((r) => ({
    ...r,
    sourceKey: r.projectId ? `p:${r.projectId}` : r.input?.startsWith(UPLOAD_ARTICLE_JOB_INPUT_PREFIX) ? `ua:${uaClientIdFromJobInput(r.input) ?? ""}` : "none",
  }));
}

