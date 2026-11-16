/**
 * นำเข้า "Backlink Budget Tracker" ของทีม จาก Google Sheet → MarsOS (เซิร์ฟเวอร์เท่านั้น)
 * อ่านชีทอย่างเดียว ไม่เขียนกลับ — การตัดสินใจทั้งหมดอยู่ใน sheet-import.ts (ไฟล์บริสุทธิ์) ไฟล์นี้แค่อ่าน Google, โหลดข้อมูลเดิม และเขียนตามแผน
 */
import { createHash, randomUUID } from "crypto";
import { google } from "googleapis";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSheetsServiceAuth } from "@/lib/google-auth";
import { currentPeriod, isValidPeriod, round2 } from "./budget";
import { listAllProjects, type BlmProjectRef } from "./projects";
import { dateOnlyString, parseDateOnly } from "./server";
import { markSheetDirty } from "./sheet-sync";
import { pushRequestChange } from "./asana-sync";
import {
  parseBudgetTab, parseExpenseTab, pickBudgetTab, pickExpenseTab, planImport, sanitizeProjectMap, suggestBudgetPeriod,
  type ExpensePlan, type Grid, type ImportPlan, type ParsedTab, type SheetBudgetRow, type SheetExpenseRow,
} from "./sheet-import";

const REQ_OPTS = { timeout: 20_000 };
/** อ่านเกินเพดานของตัว parser เล็กน้อย เพื่อให้รู้ว่าชีทยาวเกินแล้วถูกตัด */
const READ_ROWS = 6000;
const READ_RANGE = `A1:Z${READ_ROWS}`;
const ASANA_PUSH_CAP = 25;

/** ข้อผิดพลาดที่ตอบผู้ใช้ได้ตรง ๆ พร้อม HTTP status */
export class SheetImportError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface SheetSource {
  spreadsheetId: string;
  title: string;
  budgetTab: string | null;
  expenseTab: string | null;
  budgetGrid: Grid;
  expenseGrid: Grid;
}

export interface SheetImportOptions {
  budgetPeriod?: unknown;
  projectMap?: unknown;
  update: boolean;
  cancelMissing: boolean;
  apply: boolean;
  /** planHash ของตัวอย่างที่ผู้ใช้เห็น — ถ้าแผนตอนเขียนจริงไม่ตรง ให้หยุดแล้วให้ดูตัวอย่างใหม่ */
  expectedHash?: unknown;
}

export interface SheetImportApplyResult {
  projectsCreated: number;
  budgetsCreated: number;
  budgetsUpdated: number;
  requestsCreated: number;
  requestsUpdated: number;
  requestsLinked: number;
  requestsRevived: number;
  requestsCancelled: number;
}

export interface SheetImportResponse {
  ok: true;
  applied: boolean;
  spreadsheet: { title: string; url: string; budgetTab: string | null; expenseTab: string | null };
  budgetPeriod: string;
  suggestedPeriod: string;
  projectMap: Record<string, string>;
  existingProjects: BlmProjectRef[];
  plan: ImportPlan;
  /** ลายนิ้วมือของแผนนี้ ส่งกลับมาตอนกดนำเข้า เพื่อยืนยันว่าเขียนตามที่เห็นในตัวอย่าง */
  planHash: string;
  truncated: { budget: boolean; expense: boolean };
  result?: SheetImportApplyResult;
}

export function spreadsheetUrl(id: string): string {
  return `https://docs.google.com/spreadsheets/d/${id}/edit`;
}

/** ข้อความผิดพลาดตอนอ่านชีท — อ่านอย่างเดียว สิทธิ์ Viewer ก็พอ */
export function sheetReadErrorMessage(e: unknown, serviceEmail: string): string {
  const err = e as { code?: unknown; status?: unknown; message?: unknown; response?: { status?: unknown } } | null;
  const msg = typeof err?.message === "string" ? err.message : "";
  const code = Number(err?.code ?? err?.status ?? err?.response?.status);
  if (msg.includes("has not been used in project") || msg.includes("is disabled")) {
    return "ยังไม่ได้เปิด Google Sheets API ใน Google Cloud project ของ service account";
  }
  if (code === 403 || msg.includes("does not have permission")) {
    return `ยังไม่ได้แชร์ชีทให้ ${serviceEmail || "อีเมลของระบบ"} (สิทธิ์ Viewer ก็พอ)`;
  }
  if (code === 404 || code === 400) return "ไม่พบชีทนี้ ตรวจลิงก์อีกครั้ง";
  return (msg || "อ่าน Google Sheet ไม่สำเร็จ").slice(0, 200);
}

function a1(title: string): string {
  return `'${title.replace(/'/g, "''")}'!${READ_RANGE}`;
}

/** อ่านแท็บงบ + แท็บค่าใช้จ่ายจากชีทต้นทาง (ค่าดิบ: ตัวเลขเป็นตัวเลข วันที่เป็น serial) */
export async function readSourceSheet(spreadsheetId: string): Promise<SheetSource> {
  const auth = await getSheetsServiceAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "properties.title,sheets.properties.title" }, REQ_OPTS);
  const title = meta.data.properties?.title ?? "";
  const titles = (meta.data.sheets ?? []).map((s) => s.properties?.title ?? "").filter(Boolean);
  const budgetTab = pickBudgetTab(titles);
  let expenseTab = pickExpenseTab(titles);
  if (expenseTab && expenseTab === budgetTab) expenseTab = null;
  if (!budgetTab && !expenseTab) {
    throw new SheetImportError(400, `ไม่พบแท็บ "Project Budget" หรือ "Expense Log" ในชีทนี้ (แท็บที่มี: ${titles.slice(0, 12).join(", ") || "-"})`);
  }
  const wanted = [budgetTab, expenseTab].filter((t): t is string => !!t);
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: wanted.map(a1),
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "SERIAL_NUMBER",
  }, REQ_OPTS);
  const ranges = res.data.valueRanges ?? [];
  const gridOf = (tab: string | null): Grid => {
    if (!tab) return [];
    const i = wanted.indexOf(tab);
    return ((ranges[i]?.values ?? []) as Grid);
  };
  return { spreadsheetId, title, budgetTab, expenseTab, budgetGrid: gridOf(budgetTab), expenseGrid: gridOf(expenseTab) };
}

function emptyTab<T>(): ParsedTab<T> {
  return { ok: true, error: "", headerRow: 0, rows: [], truncated: false };
}

/** ลายนิ้วมือของสิ่งที่แผนจะเขียน — ชีทหรือข้อมูลใน MarsOS เปลี่ยนหลังดูตัวอย่าง ค่านี้จะเปลี่ยน */
function hashPlan(plan: ImportPlan, extra: { spreadsheetId: string; update: boolean; cancelMissing: boolean }): string {
  const body = JSON.stringify([
    extra.spreadsheetId, plan.budgetPeriod, extra.update, extra.cancelMissing,
    plan.projects.map((p) => [p.key, p.resolution, p.projectId, p.targetKey]),
    plan.budgets.map((b) => [b.projectKey, b.action, b.amount, b.budgetId, b.note]),
    plan.expenses.map((e) => [
      e.rowKey, e.action, e.requestId, e.rekeyFrom, e.linked, e.retag, e.resetMark,
      e.data ? [e.data.cost, e.data.publishedAt, e.data.budgetPeriod, e.data.liveUrl, e.data.anchorText] : null,
    ]),
    plan.missing.map((m) => [m.rowKey, m.action]),
  ]);
  return createHash("sha256").update(body).digest("hex").slice(0, 32);
}

function requestNotes(e: ExpensePlan): string {
  const d = e.data!;
  return [
    `นำเข้าจาก Google Sheet (Expense Log แถว ${e.row})`,
    d.type ? `ประเภท: ${d.type}` : "",
    d.site ? `เว็บ: ${d.site}` : "",
    d.note,
  ].filter(Boolean).join(" · ").slice(0, 2000);
}

/**
 * วางแผน (และเขียนจริงเมื่อ apply) จากข้อมูลชีทที่อ่านมาแล้ว
 * โยน SheetImportError สำหรับสิ่งที่ผู้ใช้แก้ได้ — error ของ Prisma (ตารางยังไม่มี / ชนกัน) ปล่อยให้ผู้เรียกแปลเป็น 503 / 409
 */
export async function runSheetImport(
  ctx: { orgId: string; userId: string },
  source: SheetSource,
  opts: SheetImportOptions,
): Promise<SheetImportResponse> {
  const budgetParsed: ParsedTab<SheetBudgetRow> = source.budgetTab ? parseBudgetTab(source.budgetGrid) : emptyTab();
  const expenseParsed: ParsedTab<SheetExpenseRow> = source.expenseTab ? parseExpenseTab(source.expenseGrid) : emptyTab();
  if (!budgetParsed.ok) throw new SheetImportError(400, `แท็บ "${source.budgetTab}": ${budgetParsed.error}`);
  if (!expenseParsed.ok) throw new SheetImportError(400, `แท็บ "${source.expenseTab}": ${expenseParsed.error}`);

  const orgId = ctx.orgId;
  const [config, projects, budgetRows, requestRows, importRows] = await Promise.all([
    prisma.blmSheetImportConfig.findUnique({ where: { organizationId: orgId } }),
    listAllProjects(orgId),
    prisma.blmBudget.findMany({
      where: { organizationId: orgId },
      select: { id: true, projectId: true, period: true, approvedAmount: true, note: true },
    }),
    prisma.blmRequest.findMany({
      where: { organizationId: orgId },
      select: {
        id: true, projectId: true, liveUrl: true, status: true, quotedPrice: true, actualPrice: true,
        anchorText: true, publishedAt: true, budgetPeriod: true,
      },
    }),
    prisma.blmSheetImportRow.findMany({
      where: { organizationId: orgId },
      select: { rowKey: true, requestId: true, lastStatus: true, spreadsheetId: true },
    }),
  ]);

  // ค่าที่จำไว้ใช้ต่อเฉพาะเมื่อเป็นชีทเดิม
  const sameSheet = config?.spreadsheetId === source.spreadsheetId;
  const suggestedPeriod = suggestBudgetPeriod(expenseParsed.rows, currentPeriod());
  const budgetPeriod = isValidPeriod(opts.budgetPeriod)
    ? opts.budgetPeriod
    : sameSheet && isValidPeriod(config?.budgetPeriod) ? config.budgetPeriod : suggestedPeriod;
  const projectMap = opts.projectMap && typeof opts.projectMap === "object"
    ? sanitizeProjectMap(opts.projectMap)
    : sameSheet ? sanitizeProjectMap(config?.projectMap) : {};

  // อ่านมาไม่ครบ (ชนเพดานแถว) = บอกไม่ได้ว่าแถวไหน "หายจากชีท" จริง
  const incomplete = budgetParsed.truncated || expenseParsed.truncated
    || source.budgetGrid.length >= READ_ROWS || source.expenseGrid.length >= READ_ROWS;
  const plan = planImport({
    budgets: budgetParsed.rows,
    expenses: expenseParsed.rows,
    projects,
    existingBudgets: budgetRows.map((b) => ({ ...b, note: b.note ?? "" })),
    requests: requestRows.map((r) => ({ ...r, publishedAt: dateOnlyString(r.publishedAt) })),
    importRows,
    projectMap,
    budgetPeriod,
    update: opts.update,
    cancelMissing: opts.cancelMissing,
    spreadsheetId: source.spreadsheetId,
    noCancelReason: incomplete ? "ชีทยาวเกินที่อ่านได้ในรอบเดียว (อ่านมาไม่ครบ) — ไม่ยกเลิกรายการเดิมให้ในรอบนี้" : undefined,
  });
  if (config && !sameSheet && importRows.length > 0) {
    plan.warnings.unshift(`ชีทนี้ไม่ใช่ชีทที่นำเข้าครั้งก่อน ("${config.title || "ไม่มีชื่อ"}") — แถวที่ตรงกันจะถือเป็นรายการเดียวกัน ส่วนรายการจากชีทเดิมที่ไม่มีในชีทนี้จะไม่ถูกแตะ`);
  }
  const planHash = hashPlan(plan, { spreadsheetId: source.spreadsheetId, update: opts.update, cancelMissing: opts.cancelMissing });

  const base: SheetImportResponse = {
    ok: true,
    applied: false,
    spreadsheet: { title: source.title, url: spreadsheetUrl(source.spreadsheetId), budgetTab: source.budgetTab, expenseTab: source.expenseTab },
    budgetPeriod,
    suggestedPeriod,
    projectMap,
    existingProjects: projects,
    plan,
    planHash,
    truncated: { budget: budgetParsed.truncated, expense: expenseParsed.truncated },
  };
  if (!opts.apply) return base;

  if (typeof opts.expectedHash === "string" && opts.expectedHash && opts.expectedHash !== planHash) {
    throw new SheetImportError(409, "ชีทหรือข้อมูลใน MarsOS เปลี่ยนหลังดูตัวอย่าง — กดอ่านชีทอีกครั้งแล้วตรวจก่อนนำเข้า");
  }

  if (plan.blockers.length) throw new SheetImportError(400, `ยังนำเข้าไม่ได้: ${plan.blockers.slice(0, 3).join(" / ")}`);

  const now = new Date();
  const ops: Prisma.PrismaPromise<unknown>[] = [];
  const result: SheetImportApplyResult = {
    projectsCreated: 0, budgetsCreated: 0, budgetsUpdated: 0,
    requestsCreated: 0, requestsUpdated: 0, requestsLinked: 0, requestsRevived: 0, requestsCancelled: 0,
  };

  // ───── โปรเจกต์ใหม่ (1 โปรเจกต์ต่อ targetKey) ─────
  const planByKey = new Map(plan.projects.map((p) => [p.key, p]));
  const manualNames = new Set(projects.filter((p) => p.manual).map((p) => p.name));
  const newIdByTarget = new Map<string, string>();
  const newIdByName = new Map<string, string>();
  const projectCreates: Prisma.BlmProjectCreateManyInput[] = [];
  for (const p of plan.projects) {
    if (p.projectId || p.resolution === "ambiguous" || newIdByTarget.has(p.targetKey)) continue;
    const src = planByKey.get(p.targetKey) ?? p;
    const name = src.sheetName;
    if (!name) throw new SheetImportError(400, "มีแถวที่ชื่อโปรเจกต์ว่าง — แก้ในชีทแล้วลองใหม่");
    if (manualNames.has(name)) {
      throw new SheetImportError(400, `มีโปรเจกต์ที่เพิ่มเองชื่อ "${name}" อยู่แล้ว — เลือกโปรเจกต์นั้นในช่อง "ลงโปรเจกต์" แทนการสร้างใหม่`);
    }
    let id = newIdByName.get(name);
    if (!id) {
      id = randomUUID();
      newIdByName.set(name, id);
      projectCreates.push({ id, organizationId: orgId, name, clientName: src.clientName, note: "นำเข้าจาก Google Sheet", createdById: ctx.userId });
    }
    newIdByTarget.set(p.targetKey, id);
  }
  if (projectCreates.length) ops.push(prisma.blmProject.createMany({ data: projectCreates }));
  result.projectsCreated = projectCreates.length;

  const projectIdOf = (key: string): string | null => {
    const p = planByKey.get(key);
    if (!p) return null;
    return p.projectId ?? newIdByTarget.get(p.targetKey) ?? null;
  };

  // ───── งบ ─────
  for (const b of plan.budgets) {
    if (b.amount === null) continue;
    if (b.action === "create") {
      const projectId = projectIdOf(b.projectKey);
      if (!projectId) continue;
      ops.push(prisma.blmBudget.create({
        data: { id: randomUUID(), organizationId: orgId, projectId, period: budgetPeriod, approvedAmount: b.amount, note: b.note.slice(0, 500), setById: ctx.userId },
      }));
      result.budgetsCreated++;
    } else if (b.action === "update" && b.budgetId) {
      ops.push(prisma.blmBudget.update({
        where: { id: b.budgetId },
        data: { approvedAmount: b.amount, note: b.note.slice(0, 500), setById: ctx.userId },
      }));
      result.budgetsUpdated++;
    }
  }

  // ───── ค่าใช้จ่าย → คำขอ ─────
  const domains = Array.from(new Set(plan.expenses.map((e) => e.data?.vendorDomain ?? "").filter(Boolean)));
  const vendorSites = domains.length
    ? await prisma.blmVendorSite.findMany({ where: { organizationId: orgId, domain: { in: domains } }, select: { id: true, domain: true } })
    : [];
  const vendorIdByDomain = new Map(vendorSites.map((v) => [v.domain, v.id]));
  const currentById = new Map(requestRows.map((r) => [r.id, r]));

  const requestCreates: Prisma.BlmRequestCreateManyInput[] = [];
  const eventCreates: Prisma.BlmRequestEventCreateManyInput[] = [];
  const importRowCreates: Prisma.BlmSheetImportRowCreateManyInput[] = [];
  const statusChanged: { id: string; note: string }[] = [];
  const rememberRow = (e: ExpensePlan, requestId: string, lastStatus: string) => {
    if (e.hasImportRow) {
      ops.push(prisma.blmSheetImportRow.update({
        where: { organizationId_rowKey: { organizationId: orgId, rowKey: e.rowKey } },
        data: { requestId, lastStatus, spreadsheetId: source.spreadsheetId },
      }));
    } else {
      importRowCreates.push({ id: randomUUID(), organizationId: orgId, rowKey: e.rowKey, requestId, lastStatus, spreadsheetId: source.spreadsheetId });
    }
  };

  for (const e of plan.expenses) {
    // แถวถูกแก้ในชีทจน rowKey เปลี่ยน: ย้ายแถวจำเดิมมาเป็น key ใหม่ (ทำแม้คำขอเองไม่ต้องแก้)
    if (e.rekeyFrom) {
      ops.push(prisma.blmSheetImportRow.update({
        where: { organizationId_rowKey: { organizationId: orgId, rowKey: e.rekeyFrom } },
        data: { rowKey: e.rowKey, spreadsheetId: source.spreadsheetId, ...(e.resetMark ? { lastStatus: "PUBLISHED" } : {}) },
      }));
    }
    const d = e.data;
    if (!d || e.action === "skip" || e.action === "same" || e.action === "keep") continue;
    const projectId = projectIdOf(e.projectKey);
    if (!projectId) continue;
    const cost = round2(d.cost);
    const publishedAt = parseDateOnly(d.publishedAt);

    if (e.action === "create") {
      const id = randomUUID();
      requestCreates.push({
        id, organizationId: orgId, projectId,
        vendorSiteId: vendorIdByDomain.get(d.vendorDomain) ?? null,
        vendorDomain: d.vendorDomain,
        targetUrl: "", // ชีทไม่มี URL หน้าลูกค้า — ใส่เพิ่มทีหลังได้ (ตรวจลิงก์อัตโนมัติจะข้ามจนกว่าจะใส่)
        anchorText: d.anchorText.slice(0, 500),
        quotedPrice: cost, actualPrice: cost,
        budgetPeriod: d.budgetPeriod,
        status: "PUBLISHED",
        requestedById: ctx.userId, approvedById: ctx.userId, approvedAt: now,
        notes: requestNotes(e),
        liveUrl: d.liveUrl,
        publishedAt,
      });
      eventCreates.push({
        id: randomUUID(), organizationId: orgId, requestId: id, type: "CREATED", toStatus: "PUBLISHED", amount: cost,
        note: `นำเข้าจาก Google Sheet (Expense Log แถว ${e.row})`, source: "system", actorId: ctx.userId,
      });
      rememberRow(e, id, "PUBLISHED");
      result.requestsCreated++;
      continue;
    }

    if (!e.requestId) continue;
    if (e.action === "link") {
      rememberRow(e, e.requestId, "");
      result.requestsLinked++;
      continue;
    }

    // update / revive: เขียนเฉพาะฟิลด์ที่ชีทเป็นเจ้าของ — สถานะ (ยกเว้น revive) และหมายเหตุไม่แตะ
    const current = currentById.get(e.requestId);
    const owned: Prisma.BlmRequestUpdateInput = {
      projectId, quotedPrice: cost, actualPrice: cost, anchorText: d.anchorText.slice(0, 500), publishedAt, budgetPeriod: d.budgetPeriod,
    };
    if (d.liveUrl && current?.liveUrl !== d.liveUrl) {
      owned.liveUrl = d.liveUrl;
      owned.vendorDomain = d.vendorDomain;
      owned.vendorSiteId = vendorIdByDomain.get(d.vendorDomain) ?? null;
    }
    if (e.action === "revive") {
      ops.push(prisma.blmRequest.update({ where: { id: e.requestId }, data: { ...owned, status: "PUBLISHED" } }));
      eventCreates.push({
        id: randomUUID(), organizationId: orgId, requestId: e.requestId, type: "STATUS", fromStatus: "CANCELLED", toStatus: "PUBLISHED", amount: cost,
        note: `กลับมาอยู่ใน Google Sheet (Expense Log แถว ${e.row}) — เปิดรายการกลับ`, source: "system", actorId: ctx.userId,
      });
      rememberRow(e, e.requestId, "PUBLISHED");
      statusChanged.push({ id: e.requestId, note: "MarsOS: รายการกลับมาอยู่ใน Google Sheet จึงเปิดกลับเป็น Published" });
      result.requestsRevived++;
    } else if (e.action === "update") {
      ops.push(prisma.blmRequest.update({ where: { id: e.requestId }, data: owned }));
      eventCreates.push({
        id: randomUUID(), organizationId: orgId, requestId: e.requestId, type: "NOTE", amount: cost,
        note: `นำเข้าจาก Google Sheet (Expense Log แถว ${e.row}): ${e.changes.join(", ")}`.slice(0, 1000), source: "system", actorId: ctx.userId,
      });
      if (e.linked) rememberRow(e, e.requestId, "");
      result.requestsUpdated++;
    }
  }

  // ───── แถวจำที่ต้องปรับ (ไม่แตะคำขอ): ติดป้ายชีทนี้ / ล้างเครื่องหมาย "ตัวนำเข้ายกเลิก" ─────
  const retagKeys = plan.expenses.filter((e) => e.hasImportRow && e.retag).map((e) => e.rowKey);
  if (retagKeys.length) {
    ops.push(prisma.blmSheetImportRow.updateMany({
      where: { organizationId: orgId, rowKey: { in: retagKeys } },
      data: { spreadsheetId: source.spreadsheetId },
    }));
  }
  const resetKeys = plan.expenses.filter((e) => e.hasImportRow && e.resetMark && !e.rekeyFrom).map((e) => e.rowKey);
  if (resetKeys.length) {
    ops.push(prisma.blmSheetImportRow.updateMany({
      where: { organizationId: orgId, rowKey: { in: resetKeys } },
      data: { lastStatus: "PUBLISHED" },
    }));
  }

  // ───── รายการที่เคยนำเข้าแต่ไม่อยู่ในชีทแล้ว ─────
  for (const m of plan.missing) {
    if (m.action !== "cancel") continue;
    ops.push(prisma.blmRequest.update({ where: { id: m.requestId }, data: { status: "CANCELLED" } }));
    ops.push(prisma.blmSheetImportRow.update({
      where: { organizationId_rowKey: { organizationId: orgId, rowKey: m.rowKey } },
      data: { lastStatus: "CANCELLED" },
    }));
    eventCreates.push({
      id: randomUUID(), organizationId: orgId, requestId: m.requestId, type: "STATUS", fromStatus: m.status, toStatus: "CANCELLED",
      note: "ไม่อยู่ใน Google Sheet แล้ว — ยกเลิกตามชีท", source: "system", actorId: ctx.userId,
    });
    statusChanged.push({ id: m.requestId, note: "MarsOS: รายการนี้ไม่อยู่ใน Google Sheet แล้ว จึงยกเลิกตามชีท" });
    result.requestsCancelled++;
  }

  if (requestCreates.length) ops.push(prisma.blmRequest.createMany({ data: requestCreates }));
  if (eventCreates.length) ops.push(prisma.blmRequestEvent.createMany({ data: eventCreates }));
  if (importRowCreates.length) ops.push(prisma.blmSheetImportRow.createMany({ data: importRowCreates }));

  // จำการจับคู่เป็น id จริงของโปรเจกต์ — ถ้าเก็บ "new" ไว้ รอบถัดไปจะพยายามสร้างโปรเจกต์ชื่อเดิมซ้ำแล้วชนชื่อ
  // ชื่อที่ชี้ไปชื่ออื่นในชีท (alias) เก็บตามเดิม เพราะตามไปหาเป้าหมายที่จำ id ไว้แล้วได้เอง
  const savedMap: Record<string, string> = { ...projectMap };
  for (const p of plan.projects) {
    if (p.resolution === "ambiguous" || p.key !== p.targetKey) continue;
    const id = p.projectId ?? newIdByTarget.get(p.targetKey);
    if (id) savedMap[p.key] = id;
  }

  const configData = {
    spreadsheetId: source.spreadsheetId,
    spreadsheetUrl: spreadsheetUrl(source.spreadsheetId),
    title: source.title.slice(0, 300),
    budgetPeriod,
    projectMap: savedMap as Prisma.InputJsonValue,
    lastImportedAt: now,
    lastImportedById: ctx.userId,
    lastSummary: plan.summary as unknown as Prisma.InputJsonValue,
  };
  ops.push(prisma.blmSheetImportConfig.upsert({
    where: { organizationId: orgId },
    create: { organizationId: orgId, ...configData },
    update: configData,
  }));

  // ทั้งหมดในธุรกรรมเดียว: นำเข้าพร้อมกันสองครั้ง ครั้งที่สองชน unique (organizationId, rowKey) แล้วย้อนกลับทั้งชุด
  await prisma.$transaction(ops);

  await markSheetDirty(orgId);
  // แจ้ง Asana เฉพาะรายการที่สถานะเปลี่ยน (รายการที่นำเข้าใหม่ไม่มีงานใน Asana) — pushRequestChange ไม่ throw
  for (const s of statusChanged.slice(0, ASANA_PUSH_CAP)) await pushRequestChange(orgId, s.id, s.note);

  return { ...base, projectMap: savedMap, applied: true, result };
}
