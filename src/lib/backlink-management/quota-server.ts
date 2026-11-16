/**
 * โควต้า Backlink สองทาง (เซิร์ฟเวอร์เท่านั้น) — Google Sheet คือที่เก็บจริง ฐานข้อมูลเป็นแค่สำเนา (cache)
 * ทุกคำสั่งเขียน: อ่านแท็บสดจากชีท → parse → หาแพ็กเกจ/ช่อง → เขียนชีท → อ่านกลับ → อัปเดต cache → คืน view
 * เขียนชีทไม่สำเร็จ = ไม่บันทึกอะไรลง DB (การจอง: จองช่องใน DB ก่อนเพื่อกันจองซ้อน แล้วถอนคืนถ้าเขียนชีทไม่ผ่าน)
 * แพ็กเกจที่หายไปจากชีทไม่ถูกลบเอง — ติดป้าย stale ไว้ให้ผู้จัดการลบ (ชีทอาจแค่อยู่ระหว่างแก้)
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getServiceIdentity } from "@/lib/google-auth";
import { isApprover } from "./types";
import type { StaffCtx } from "./server";
import { findProject, isMissingTable } from "./projects";
import { parseSpreadsheetId } from "./sheet-tables";
import { sheetErrorMessage } from "./sheet-sync";
import { columnLetter, isQuotaTabCandidate, packageStats, parseQuotaTab } from "./quota-sheet";
import type { CellListOptions, SheetsPort, SheetTabInfo } from "./quota-sheets-port";
import {
  QUOTA_DEFAULT_STATUSES, QUOTA_STATUS_IN_PROCESS,
  type ParsedPackage, type ParsedTab, type QuotaColumns, type QuotaPackageInput, type QuotaPackageView,
  type QuotaReservationInput, type QuotaReservationView, type QuotaSlotInput, type QuotaSlotView,
  type QuotaSourceView, type QuotaTotals, type QuotaView, type QuotaWriteResult, type SheetSourcesView,
} from "./quota-types";
import {
  MERGE_SKIPPED_MSG, QuotaError, assertOverwritesApproved, findOverwrites, appendColumnsRequest, appendRowsRequest, checkUnits, cleanText, copySlotFormatRequests, insertRowsRequest,
  isBlankGrid, matchPackages, mergePackageRequests, newPackageStartRow, packageCellsHaveData, packageFingerprint, packageUpdates, planBlockGrowth, planSlot, mayGrow,
  reservationClearUpdates, slotUpdates, standardHeaderUpdate, type CellUpdate, type SlotPlan,
} from "./quota-write";

export { QuotaError } from "./quota-write";

export interface QuotaDeps {
  port: SheetsPort;
  /** ใส่เองได้ (เทส) — ไม่ใส่ = อ่านจาก getServiceIdentity() */
  serviceEmail?: string;
  /** key ของเซลล์ที่ผู้ใช้กดยืนยันให้เขียนทับแล้ว (จาก popup) — ไม่ส่ง = ยังไม่ยืนยันอะไรเลย */
  confirmOverwrite?: string[];
}

export const QUOTA_MISSING_TABLE_MSG = "ยังไม่ได้สร้างตารางโควต้า — ให้ผู้ดูแลรัน scripts/sql/add-blm-quota-asana-tables.sql ใน Supabase";
const NOT_FOUND = "ไม่พบรายการ";
const STALE_MSG = "ไม่พบแพ็กเกจนี้ในชีทแล้ว — โหลดใหม่";
const PACKAGE_CHANGED_MSG = "ข้อมูลแพ็กเกจในชีทเปลี่ยนไปจากที่แสดง — โหลดใหม่แล้วลองอีกครั้ง";
const SLOT_TAKEN_MSG = "ช่องนี้เพิ่งถูกจอง — โหลดใหม่แล้วลองอีกครั้ง";
/** การจองที่เพิ่งสร้าง (ชีทอาจยังเขียนไม่เสร็จ / ยังอ่านกลับไม่ทัน) ไม่ถูกกวาดทิ้งภายในเวลานี้ */
export const RESERVATION_GRACE_MS = 60_000;

type SourceRow = NonNullable<Awaited<ReturnType<typeof prisma.blmSheetSource.findFirst>>>;
type PackageRow = NonNullable<Awaited<ReturnType<typeof prisma.blmQuotaPackage.findFirst>>>;

// ───────────────────────── ตัวช่วยทั่วไป ─────────────────────────

function missingTable(): QuotaError {
  return new QuotaError(503, QUOTA_MISSING_TABLE_MSG, { tableMissing: true });
}

/** unique ชน (Prisma P2002) — ดูจาก code เพราะ import Prisma แบบ type เท่านั้น */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
}

/** เพิ่ม/แก้ไข/ลบแพ็กเกจ = ผู้จัดการเท่านั้น (แก้ช่อง / จอง / ดึงชีท ทำได้ทุกคนในทีม) */
function requireManager(ctx: StaffCtx, action: string): void {
  if (!isApprover(ctx.role)) throw new QuotaError(403, `ไม่มีสิทธิ์${action} — ทำได้เฉพาะ Admin / SEO Manager`);
}

/** ครอบคำสั่ง DB: ตารางไม่มี → QuotaError 503 */
async function db<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isMissingTable(e)) throw missingTable();
    throw e;
  }
}

let emailCache: { at: number; email: string } | null = null;
async function serviceEmail(deps?: QuotaDeps): Promise<string> {
  if (deps?.serviceEmail !== undefined) return deps.serviceEmail;
  if (emailCache && Date.now() - emailCache.at < 5 * 60_000) return emailCache.email;
  try {
    const email = (await getServiceIdentity()).email;
    emailCache = { at: Date.now(), email };
    return email;
  } catch {
    return "";
  }
}

/** แปลง error จาก Google เป็น QuotaError ภาษาไทย (QuotaError เดิมผ่านไปเฉย ๆ) */
async function sheetFail(e: unknown, deps: QuotaDeps): Promise<QuotaError> {
  if (e instanceof QuotaError) return e;
  if (isMissingTable(e)) return missingTable();
  return new QuotaError(502, sheetErrorMessage(e, await serviceEmail(deps)));
}

async function sheetCall<T>(deps: QuotaDeps, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw await sheetFail(e, deps);
  }
}

/** วันนี้ตามเวลาไทย YYYY-MM-DD */
export function todayBangkok(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function tabList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

async function findSource(orgId: string, id: string): Promise<SourceRow> {
  const s = await db(() => prisma.blmSheetSource.findFirst({ where: { id, organizationId: orgId } }));
  if (!s) throw new QuotaError(404, NOT_FOUND);
  return s;
}

async function findPackage(orgId: string, id: string): Promise<{ row: PackageRow; source: SourceRow }> {
  const row = await db(() => prisma.blmQuotaPackage.findFirst({ where: { id, organizationId: orgId } }));
  if (!row) throw new QuotaError(404, NOT_FOUND);
  const source = await findSource(orgId, row.sourceId);
  return { row, source };
}

/** แพ็กเกจสำหรับคำสั่งเขียน: แพ็กเกจที่ไม่พบในชีทแล้ว (stale) เขียนไม่ได้ */
async function findLivePackage(orgId: string, id: string): Promise<{ row: PackageRow; source: SourceRow }> {
  const found = await findPackage(orgId, id);
  if (found.row.stale) throw new QuotaError(409, STALE_MSG);
  return found;
}

// ───────────────────────── cache: อัปเดตจากแท็บที่อ่านมา ─────────────────────────

async function deletePackages(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await prisma.blmQuotaReservation.deleteMany({ where: { packageId: { in: ids } } });
  await prisma.blmQuotaPackage.deleteMany({ where: { id: { in: ids } } });
}

/**
 * อัปเดต cache ของ 1 แท็บจากที่เพิ่งอ่านมา
 * - จับคู่แถวเดิมกับแพ็กเกจในชีทด้วย key + ลายนิ้วมือ (matchPackages): ก้อนที่ถูกเลื่อนตำแหน่งยังเป็นแถวเดิม การจองจึงตามไปด้วย
 * - แพ็กเกจที่หายไป (รวมแท็บที่อ่านหัวตารางไม่ได้): ไม่ลบ ติดป้าย stale เก็บการจองไว้ — กลับมาเมื่อไรก็เลิก stale เอง
 * - การจองที่ช่องในชีทไม่ถูกใช้แล้ว: ลบ ยกเว้นที่เพิ่งสร้างไม่เกิน RESERVATION_GRACE_MS
 */
async function applyTab(orgId: string, sourceId: string, tabTitle: string, parsed: ParsedTab | null): Promise<void> {
  try {
    await applyTabOnce(orgId, sourceId, tabTitle, parsed);
  } catch (e) {
    // อีกคำสั่งหนึ่งอัปเดตแท็บเดียวกันพร้อมกันจน key ชน → อ่านสถานะล่าสุดแล้วทำซ้ำ 1 ครั้ง
    if (!isUniqueViolation(e)) throw e;
    await applyTabOnce(orgId, sourceId, tabTitle, parsed);
  }
}

async function applyTabOnce(orgId: string, sourceId: string, tabTitle: string, parsed: ParsedTab | null): Promise<void> {
  const existing = await prisma.blmQuotaPackage.findMany({
    where: { sourceId, tabTitle }, orderBy: [{ ordinal: "asc" }, { createdAt: "asc" }],
    select: { id: true, packageKey: true, data: true, stale: true },
  });
  const pkgs = parsed?.packages ?? [];
  const m = matchPackages(
    existing.map((e) => ({ key: e.packageKey, fingerprint: packageFingerprint(e.data), stale: e.stale })),
    pkgs.map((p) => ({ key: p.key, fingerprint: packageFingerprint(p) })),
  );
  const freshKeys = new Set(pkgs.map((p) => p.key));
  // ทุกขั้นอยู่ใน transaction เดียว: key สลับกันได้ จึงย้ายไป key ชั่วคราวก่อน ไม่ให้ชน unique (sourceId, packageKey)
  // key ชั่วคราว/key ที่พักไว้ไม่มี "#" จึงไม่มีทางซ้ำกับ key จริง (`แท็บ#ลำดับ`)
  const ops: Prisma.PrismaPromise<unknown>[] = [];
  for (const o of m.unmatchedOld) {
    const e = existing[o];
    const park = freshKeys.has(e.packageKey); // key เดิมกำลังจะเป็นของก้อนอื่น
    if (e.stale && !park) continue;
    ops.push(prisma.blmQuotaPackage.update({ where: { id: e.id }, data: { stale: true, ...(park ? { packageKey: `~stale~${e.id}` } : {}) } }));
  }
  for (const [o, n] of m.pairs) {
    const e = existing[o];
    if (e.packageKey !== pkgs[n].key) ops.push(prisma.blmQuotaPackage.update({ where: { id: e.id }, data: { packageKey: `~tmp~${e.id}` } }));
  }
  if (parsed) {
    const columns = parsed.columns as unknown as Prisma.InputJsonValue;
    const fields = (p: ParsedPackage) => ({
      packageKey: p.key, tabTitle, ordinal: p.ordinal, headerRow: parsed.headerRow, columns,
      data: p as unknown as Prisma.InputJsonValue, stale: false,
    });
    for (const [o, n] of m.pairs) ops.push(prisma.blmQuotaPackage.update({ where: { id: existing[o].id }, data: fields(pkgs[n]) }));
    for (const n of m.unmatchedNew) ops.push(prisma.blmQuotaPackage.create({ data: { organizationId: orgId, sourceId, ...fields(pkgs[n]) } }));
  }
  if (ops.length) await prisma.$transaction(ops);

  // การจองของแพ็กเกจที่ยังอยู่: ช่องในชีทไม่ถูกใช้แล้ว = ลบ (เว้นที่เพิ่งสร้าง — ชีทอาจยังเขียนไม่เสร็จ)
  const live = new Map(m.pairs.map(([o, n]) => [existing[o].id, pkgs[n]]));
  if (!live.size) return;
  const res = await prisma.blmQuotaReservation.findMany({
    where: { packageId: { in: Array.from(live.keys()) }, createdAt: { lt: new Date(Date.now() - RESERVATION_GRACE_MS) } },
    select: { id: true, packageId: true, slotIndex: true },
  });
  const dead = res.filter((r) => !live.get(r.packageId)?.slots[r.slotIndex]?.used).map((r) => r.id);
  if (dead.length) await prisma.blmQuotaReservation.deleteMany({ where: { id: { in: dead } } });
}

// ───────────────────────── อ่านแท็บสด ─────────────────────────

interface FreshTab {
  tab: SheetTabInfo;
  rows: unknown[][];
  /** ตารางเดียวกันอ่านแบบ FORMULA — เซลล์ที่เป็นสูตรได้ข้อความสูตร ใช้ตรวจก่อนเขียนทับ / ก่อนรวมเซลล์ */
  formulas: unknown[][];
  parsed: ParsedTab | null;
}

async function freshTab(source: SourceRow, tabTitle: string, deps: QuotaDeps): Promise<FreshTab> {
  return sheetCall(deps, async () => {
    // ดูก่อนว่าแท็บยังอยู่ — อ่านค่าจากแท็บที่ถูกลบ/เปลี่ยนชื่อ Google ตอบ error ซึ่งจะกลายเป็น 502 ที่ผู้ใช้แก้เองไม่ได้
    const ss = await deps.port.getSpreadsheet(source.spreadsheetId);
    const tab = ss.tabs.find((t) => t.title === tabTitle);
    if (!tab) throw new QuotaError(404, "ไม่พบแท็บนี้ในชีทแล้ว — ดึงข้อมูลชีทใหม่");
    const [values, formulas] = await Promise.all([
      deps.port.readTabs(source.spreadsheetId, [tabTitle]),
      deps.port.readTabs(source.spreadsheetId, [tabTitle], { render: "FORMULA" }),
    ]);
    const grid = values[tabTitle] ?? [];
    return { tab, rows: grid, formulas: formulas[tabTitle] ?? [], parsed: parseQuotaTab(tabTitle, grid) };
  });
}

type Located = { parsed: ParsedTab; pkg: ParsedPackage; next: ParsedPackage | null };

/** หาแพ็กเกจในแท็บสดด้วยลำดับ แล้วยืนยันด้วยลายนิ้วมือว่าเป็นก้อนเดียวกับที่ cache (= ที่หน้าจอแสดง) */
function locate(fresh: FreshTab, row: PackageRow): Located {
  if (!fresh.parsed) throw new QuotaError(409, "แท็บนี้ไม่มีหัวตารางโควต้าแล้ว — โหลดใหม่");
  const i = fresh.parsed.packages.findIndex((p) => p.ordinal === row.ordinal);
  if (i < 0) throw new QuotaError(409, STALE_MSG);
  const pkg = fresh.parsed.packages[i];
  // ลำดับเดิมแต่ไม่ใช่ก้อนเดิม (มีคนแทรก/ลบ/แก้แพ็กเกจในชีท) → ห้ามเขียน ไม่งั้นข้อมูลไปลงผิดแพ็กเกจ
  if (packageFingerprint(pkg) !== packageFingerprint(row.data)) throw new QuotaError(409, PACKAGE_CHANGED_MSG);
  return { parsed: fresh.parsed, pkg, next: fresh.parsed.packages[i + 1] ?? null };
}

/** locate — ถ้าชีทไม่ตรงกับ cache (409) อัปเดต cache ให้ตรงชีทก่อนแจ้ง ผู้ใช้โหลดใหม่แล้วเห็นของจริงทันที */
async function locateOrSync(ctx: StaffCtx, source: SourceRow, fresh: FreshTab, row: PackageRow): Promise<Located> {
  try {
    return locate(fresh, row);
  } catch (e) {
    if (e instanceof QuotaError && e.status === 409) await applyTab(ctx.orgId, source.id, row.tabTitle, fresh.parsed).catch(() => {});
    throw e;
  }
}

/** อ่านแท็บกลับ → อัปเดต cache → คืน view ล่าสุด */
async function finish(ctx: StaffCtx, source: SourceRow, tabTitle: string, deps: QuotaDeps, warning?: string): Promise<QuotaWriteResult> {
  const rows = await sheetCall(deps, () => deps.port.readTabs(source.spreadsheetId, [tabTitle]));
  const parsed = parseQuotaTab(tabTitle, rows[tabTitle] ?? []);
  await db(() => applyTab(ctx.orgId, source.id, tabTitle, parsed));
  const view = await loadQuotaView(ctx, deps);
  return warning ? { view, warning } : { view };
}

/** เตรียมโครงสร้างก่อนเขียนช่อง (ต่อท้ายแถว / แทรกแถว + รวมเซลล์ใหม่แบบ best effort) */
async function prepareSlot(
  source: SourceRow, fresh: FreshTab, columns: QuotaColumns, pkg: ParsedPackage, plan: SlotPlan, deps: QuotaDeps,
): Promise<string | undefined> {
  const tab = fresh.tab;
  if (plan.appendRows > 0) {
    await sheetCall(deps, () => deps.port.batchUpdate(source.spreadsheetId, [appendRowsRequest(tab.sheetId, plan.appendRows)]));
  }
  if (plan.insertAt0 !== null) {
    await sheetCall(deps, () => deps.port.batchUpdate(source.spreadsheetId, [insertRowsRequest(tab.sheetId, plan.insertAt0 as number, 1)]));
    const have = Math.max(pkg.rowCount, pkg.slots.length, 1);
    // แถวใหม่ถูกแทรกต่อท้ายก้อน แถวเดิมของก้อนจึงยังอยู่ตำแหน่งเดียวกับที่อ่านมา — มีข้อมูลในแถว 2..n = ไม่รวมเซลล์ (การรวมจะทิ้งข้อมูลนั้น)
    if (packageCellsHaveData(columns, pkg.rowNumber + 1, pkg.rowNumber + have - 1, fresh.rows, fresh.formulas)) return MERGE_SKIPPED_MSG;
    try {
      await deps.port.batchUpdate(source.spreadsheetId, mergePackageRequests(tab.sheetId, columns, pkg.rowNumber, have + 1));
    } catch {
      return "เพิ่มแถวแล้ว แต่รวมเซลล์ของแพ็กเกจใหม่ไม่ได้ — จัดในชีทเองได้";
    }
  }
  return undefined;
}

async function writeCells(source: SourceRow, updates: CellUpdate[], deps: QuotaDeps): Promise<void> {
  if (!updates.length) return;
  await sheetCall(deps, () => deps.port.writeCells(source.spreadsheetId, updates));
}

// ───────────────────────── ชีทต้นทาง ─────────────────────────

function sourceView(s: SourceRow, packageCount: number): QuotaSourceView {
  return {
    id: s.id, spreadsheetUrl: s.spreadsheetUrl, title: s.title, label: s.label, tabs: tabList(s.tabs),
    lastPulledAt: s.lastPulledAt ? s.lastPulledAt.toISOString() : null, lastError: s.lastError, packageCount,
  };
}

async function sourceViews(orgId: string): Promise<QuotaSourceView[]> {
  const [sources, counts] = await Promise.all([
    prisma.blmSheetSource.findMany({ where: { organizationId: orgId }, orderBy: [{ createdAt: "asc" }] }),
    // นับเฉพาะแพ็กเกจที่ยังอยู่ในชีท
    prisma.blmQuotaPackage.groupBy({ by: ["sourceId"], where: { organizationId: orgId, stale: false }, _count: { _all: true } }),
  ]);
  const cm = new Map(counts.map((c) => [c.sourceId, c._count._all]));
  return sources.map((s) => sourceView(s, cm.get(s.id) ?? 0));
}

export async function listSources(ctx: StaffCtx, deps?: QuotaDeps): Promise<SheetSourcesView> {
  const email = await serviceEmail(deps);
  try {
    return { sources: await sourceViews(ctx.orgId), serviceEmail: email, canEdit: isApprover(ctx.role) };
  } catch (e) {
    if (isMissingTable(e)) return { sources: [], serviceEmail: email, canEdit: isApprover(ctx.role), tableMissing: true };
    throw e;
  }
}

export async function addSource(ctx: StaffCtx, input: { url?: unknown; label?: unknown }, deps: QuotaDeps): Promise<SheetSourcesView> {
  const spreadsheetId = parseSpreadsheetId(input.url);
  if (!spreadsheetId) throw new QuotaError(400, "ลิงก์ Google Sheet ไม่ถูกต้อง");
  const dup = await db(() => prisma.blmSheetSource.findUnique({ where: { organizationId_spreadsheetId: { organizationId: ctx.orgId, spreadsheetId } } }));
  if (dup) throw new QuotaError(409, "เพิ่มชีทนี้ไว้แล้ว");
  const ss = await sheetCall(deps, () => deps.port.getSpreadsheet(spreadsheetId));
  const created = await db(() =>
    prisma.blmSheetSource.create({
      data: {
        organizationId: ctx.orgId, spreadsheetId,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
        title: ss.title, label: cleanText(input.label, 200), addedById: ctx.userId,
      },
    }),
  );
  try {
    await pullSource(ctx.orgId, created.id, deps);
  } catch {
    /* ดึงไม่สำเร็จ: lastError ถูกบันทึกไว้ที่ชีทแล้ว ผู้ใช้กดดึงใหม่ได้ */
  }
  return listSources(ctx, deps);
}

export async function removeSource(ctx: StaffCtx, id: string, deps?: QuotaDeps): Promise<SheetSourcesView> {
  const s = await findSource(ctx.orgId, id);
  await db(async () => {
    const pk = await prisma.blmQuotaPackage.findMany({ where: { sourceId: s.id }, select: { id: true } });
    await deletePackages(pk.map((p) => p.id));
    await prisma.blmSheetSource.delete({ where: { id: s.id } });
  });
  return listSources(ctx, deps);
}

/** ดึงชีท 1 ไฟล์เข้า cache — ล้มเหลว: cache เดิมไม่ถูกแตะ, เก็บข้อความไทยใน lastError แล้ว throw QuotaError */
export async function pullSource(orgId: string, sourceId: string, deps: QuotaDeps): Promise<void> {
  const source = await findSource(orgId, sourceId);
  try {
    const ss = await deps.port.getSpreadsheet(source.spreadsheetId);
    const candidates = ss.tabs.map((t) => t.title).filter(isQuotaTabCandidate);
    const raw = await deps.port.readTabs(source.spreadsheetId, candidates);
    const parsedTabs = candidates.map((t) => ({ title: t, parsed: parseQuotaTab(t, raw[t] ?? []) }));
    await db(async () => {
      for (const t of parsedTabs) await applyTab(orgId, source.id, t.title, t.parsed);
      // แท็บที่ถูกลบ/เปลี่ยนชื่อ/ไม่ใช่โควต้าแล้ว: ไม่ลบแพ็กเกจ (อาจเป็นแค่ชั่วคราว) — ติดป้าย stale เก็บการจองไว้
      const old = await prisma.blmQuotaPackage.findMany({ where: { sourceId: source.id, stale: false }, select: { id: true, tabTitle: true } });
      const keep = new Set(candidates);
      const gone = old.filter((o) => !keep.has(o.tabTitle)).map((o) => o.id);
      if (gone.length) await prisma.blmQuotaPackage.updateMany({ where: { id: { in: gone } }, data: { stale: true } });
      await prisma.blmSheetSource.update({
        where: { id: source.id },
        data: { title: ss.title, tabs: candidates, lastPulledAt: new Date(), lastError: "" },
      });
    });
  } catch (e) {
    const err = await sheetFail(e, deps);
    if (!err.tableMissing) {
      await prisma.blmSheetSource.update({ where: { id: source.id }, data: { lastError: err.message.slice(0, 500) } }).catch(() => {});
    }
    throw err;
  }
}

/** ดึงชีทที่ยังไม่เคยดึง/เก่าเกิน maxAgeMs ทีละไฟล์ จนหมดเวลา budgetMs — ไม่ throw */
export async function pullStaleSources(
  orgId: string, opts: { maxAgeMs: number; budgetMs: number; force?: boolean }, deps: QuotaDeps,
): Promise<void> {
  try {
    const started = Date.now();
    const sources = await prisma.blmSheetSource.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: "asc" } });
    for (const s of sources) {
      if (Date.now() - started >= opts.budgetMs) break;
      const fresh = s.lastPulledAt && Date.now() - s.lastPulledAt.getTime() < opts.maxAgeMs;
      if (fresh && !opts.force) continue;
      try {
        await pullSource(orgId, s.id, deps);
      } catch {
        /* เงียบ: ข้อความอยู่ใน lastError */
      }
    }
  } catch {
    /* เงียบ: ตารางไม่มี/DB ล่ม ไม่ให้กระทบหน้าโควต้า */
  }
}

// ───────────────────────── มุมมองโควต้า ─────────────────────────

function emptyTotals(): QuotaTotals {
  return { bought: 0, used: 0, published: 0, inProcess: 0, reserved: 0, remaining: 0, usable: 0, unknownUnits: 0, expiringSoon: 0 };
}

export function computeTotals(pkgs: Pick<QuotaPackageView, "units" | "used" | "published" | "inProcess" | "reserved" | "remaining" | "usable" | "expired" | "expireDate">[], today: string): QuotaTotals {
  const t = emptyTotals();
  const soon = addDays(today, 30);
  for (const p of pkgs) {
    t.used += p.used; t.published += p.published; t.inProcess += p.inProcess; t.reserved += p.reserved;
    if (p.units == null) { t.unknownUnits++; continue; }
    t.bought += p.units; t.remaining += p.remaining ?? 0; t.usable += p.usable ?? 0;
    if (!p.expired && p.expireDate && p.expireDate >= today && p.expireDate <= soon) t.expiringSoon += p.usable ?? 0;
  }
  return t;
}

function emptyView(canManage: boolean, email: string, tableMissing: boolean): QuotaView {
  return {
    sources: [], packages: [], totals: emptyTotals(), clientOptions: [], statusOptions: [...QUOTA_DEFAULT_STATUSES],
    serviceEmail: email, canManage, ...(tableMissing ? { tableMissing: true } : {}),
  };
}

export async function loadQuotaView(ctx: StaffCtx, deps?: QuotaDeps): Promise<QuotaView> {
  const canManage = isApprover(ctx.role);
  const email = await serviceEmail(deps);
  try {
    const [sources, rows, resv] = await Promise.all([
      sourceViews(ctx.orgId),
      prisma.blmQuotaPackage.findMany({ where: { organizationId: ctx.orgId } }),
      prisma.blmQuotaReservation.findMany({ where: { organizationId: ctx.orgId } }),
    ]);
    const userIds = Array.from(new Set(resv.map((r) => r.reservedById).filter(Boolean)));
    const users = userIds.length
      ? await prisma.user.findMany({ where: { organizationId: ctx.orgId, id: { in: userIds } }, select: { id: true, name: true, email: true } })
      : [];
    const um = new Map(users.map((u) => [u.id, u.name ?? u.email]));
    const sm = new Map(sources.map((s) => [s.id, s]));
    const byPkg = new Map<string, Map<number, QuotaReservationView>>();
    for (const r of resv) {
      const m = byPkg.get(r.packageId) ?? new Map<number, QuotaReservationView>();
      m.set(r.slotIndex, {
        id: r.id, reservedById: r.reservedById, reservedByName: um.get(r.reservedById) ?? "", website: r.website,
        projectId: r.projectId, projectName: r.projectName, note: r.note, createdAt: r.createdAt.toISOString(),
      });
      byPkg.set(r.packageId, m);
    }
    const today = todayBangkok();
    const clients = new Set<string>();
    const statuses: string[] = [...QUOTA_DEFAULT_STATUSES];
    const packages: QuotaPackageView[] = [];
    for (const row of rows) {
      const data = row.data as unknown as ParsedPackage;
      const src = sm.get(row.sourceId);
      if (!data || !Array.isArray(data.slots) || !src) continue;
      const rm = byPkg.get(row.id) ?? new Map<number, QuotaReservationView>();
      const st = packageStats(data, today, new Set(rm.keys()));
      const slots: QuotaSlotView[] = data.slots.map((s) => ({ ...s, reservation: rm.get(s.index) ?? null }));
      for (const s of data.slots) {
        if (s.client) clients.add(s.client);
        if (s.status && !statuses.includes(s.status)) statuses.push(s.status);
      }
      const { slots: _drop, ...rest } = data;
      void _drop;
      packages.push({
        ...rest, id: row.id, sourceId: row.sourceId, sourceTitle: src.label || src.title, spreadsheetUrl: src.spreadsheetUrl,
        stale: row.stale, ...st, slots,
      });
    }
    packages.sort((a, b) =>
      a.sourceTitle.localeCompare(b.sourceTitle, "th") || a.tabTitle.localeCompare(b.tabTitle, "th") || a.ordinal - b.ordinal);
    return {
      // แพ็กเกจที่ไม่พบในชีทแล้วยังแสดงในรายการ (ติดป้าย) แต่ไม่นับในยอดรวม
      sources, packages, totals: computeTotals(packages.filter((p) => !p.stale), today),
      clientOptions: Array.from(clients).sort((a, b) => a.localeCompare(b, "th")),
      statusOptions: statuses, serviceEmail: email, canManage,
    };
  } catch (e) {
    if (isMissingTable(e)) return emptyView(canManage, email, true);
    throw e;
  }
}

// ───────────────────────── เขียน: ช่อง ─────────────────────────

export async function updateSlot(ctx: StaffCtx, packageId: string, slotIndex: number, input: QuotaSlotInput, deps: QuotaDeps): Promise<QuotaWriteResult> {
  if (!Number.isInteger(slotIndex) || slotIndex < 0) throw new QuotaError(400, "ไม่มีช่องนี้ในแพ็กเกจ");
  const { row, source } = await findLivePackage(ctx.orgId, packageId);
  const fresh = await freshTab(source, row.tabTitle, deps);
  const { parsed, pkg, next } = await locateOrSync(ctx, source, fresh, row);
  const plan = planSlot(pkg, next, slotIndex, fresh.tab.rowCount);
  if (!plan) throw new QuotaError(400, "ไม่มีช่องนี้ในแพ็กเกจ");
  const updates = slotUpdates(row.tabTitle, parsed.columns, plan.row, input); // ตรวจค่า/คอลัมน์ก่อนแตะชีท
  // แถวที่กำลังจะแทรกใหม่ยังไม่มีข้อมูลของตัวเอง (ตำแหน่งนั้นในชีทตอนนี้เป็นของแพ็กเกจถัดไป)
  assertOverwritesApproved(plan.insertAt0 !== null ? [] : findOverwrites(row.tabTitle, parsed.columns, fresh.rows, updates, fresh.formulas), deps.confirmOverwrite);
  const warning = await prepareSlot(source, fresh, parsed.columns, pkg, plan, deps);
  await writeCells(source, updates, deps);
  return finish(ctx, source, row.tabTitle, deps, warning);
}

// ───────────────────────── เขียน: แพ็กเกจ ─────────────────────────

export async function updatePackage(ctx: StaffCtx, packageId: string, input: QuotaPackageInput, deps: QuotaDeps): Promise<QuotaWriteResult> {
  requireManager(ctx, "แก้ไขแพ็กเกจ");
  const { row, source } = await findLivePackage(ctx.orgId, packageId);
  const fresh = await freshTab(source, row.tabTitle, deps);
  // เทียบลายนิ้วมือกับ cache ก่อนแก้ — หลังเขียน finish จะอัปเดต cache เป็นค่าที่แก้แล้ว คำสั่งถัดไปจึงยังตรง
  const { parsed, pkg, next } = await locateOrSync(ctx, source, fresh, row);
  const edit: QuotaPackageInput = {
    type: input.type, websiteText: input.websiteText, priceText: input.priceText,
    units: input.units, startDate: input.startDate, expireDate: input.expireDate,
  };
  for (const k of Object.keys(edit) as (keyof QuotaPackageInput)[]) if (edit[k] === undefined) delete edit[k];
  if (typeof edit.units === "number") {
    checkUnits(edit.units);
    const usedCount = pkg.slots.filter((s) => s.used).length;
    if (edit.units < usedCount) throw new QuotaError(400, "ลด Unit ต่ำกว่าจำนวนที่ใช้ไปแล้วไม่ได้");
  }
  const updates = packageUpdates(row.tabTitle, parsed.columns, pkg.rowNumber, edit);
  assertOverwritesApproved(findOverwrites(row.tabTitle, parsed.columns, fresh.rows, updates, fresh.formulas), deps.confirmOverwrite);
  let warning: string | undefined;
  if (typeof edit.units === "number") {
    const g = planBlockGrowth(pkg, next, fresh.tab.rowCount, edit.units);
    const reqs: object[] = [];
    if (g.appendRows > 0) reqs.push(appendRowsRequest(fresh.tab.sheetId, g.appendRows));
    if (g.insertAt0 !== null && g.insertCount > 0) reqs.push(insertRowsRequest(fresh.tab.sheetId, g.insertAt0, g.insertCount));
    if (reqs.length) {
      await sheetCall(deps, () => deps.port.batchUpdate(source.spreadsheetId, reqs));
      // แถวที่จะถูกรวม ตามตำแหน่งที่อ่านมาก่อนแก้: แทรก = แถวเดิมของก้อน (แถวใหม่ว่างแน่นอน), ต่อท้าย = ทุกแถวที่ก้อนจะขยายไปถึง
      const have = Math.max(pkg.rowCount, pkg.slots.length, 1);
      const lastOld = pkg.rowNumber + (g.insertAt0 !== null ? have : g.newRowCount) - 1;
      if (packageCellsHaveData(parsed.columns, pkg.rowNumber + 1, lastOld, fresh.rows, fresh.formulas)) {
        warning = MERGE_SKIPPED_MSG;
      } else {
        try {
          await deps.port.batchUpdate(source.spreadsheetId, mergePackageRequests(fresh.tab.sheetId, parsed.columns, pkg.rowNumber, g.newRowCount));
        } catch {
          warning = "เพิ่มแถวแล้ว แต่รวมเซลล์ของแพ็กเกจไม่ได้ — จัดในชีทเองได้";
        }
      }
    }
  }
  await writeCells(source, updates, deps);
  return finish(ctx, source, row.tabTitle, deps, warning);
}

/**
 * รายการ dropdown ของช่อง Type ในชีท (ถ้าชีทตั้ง Data validation ไว้) — ใช้ในฟอร์มแพ็กเกจให้เลือกค่าที่ชีทยอมรับ
 * แก้แพ็กเกจ: อ่านเซลล์ Type ของแถวแรกของก้อนนั้น · เพิ่มแพ็กเกจ: อ่านเซลล์ Type ของแพ็กเกจแรกในแท็บที่เลือก
 * อ่านอย่างเดียว ไม่เขียนชีท · อ่านไม่ได้ = null (ฟอร์มยังพิมพ์เองได้)
 */
export async function packageTypeOptions(
  ctx: StaffCtx,
  q: { packageId?: string; sourceId?: string; tabTitle?: string },
  deps: QuotaDeps,
): Promise<{ type: CellListOptions | null }> {
  if (!deps.port.readCellOptions) return { type: null };
  let row: PackageRow | null = null;
  let source: SourceRow;
  if (q.packageId) {
    ({ row, source } = await findPackage(ctx.orgId, q.packageId));
  } else {
    if (!q.sourceId || !q.tabTitle) return { type: null };
    source = await findSource(ctx.orgId, q.sourceId);
    row = await db(() => prisma.blmQuotaPackage.findFirst({
      where: { organizationId: ctx.orgId, sourceId: source.id, tabTitle: q.tabTitle, stale: false },
      orderBy: { ordinal: "asc" },
    }));
  }
  if (!row) return { type: null };
  const col = (row.columns as QuotaColumns | null)?.type;
  const rowNumber = (row.data as { rowNumber?: unknown } | null)?.rowNumber;
  if (col === undefined || typeof rowNumber !== "number") return { type: null };
  try {
    const cell = `${columnLetter(col)}${rowNumber}`;
    return { type: await deps.port.readCellOptions(source.spreadsheetId, row.tabTitle, cell) };
  } catch (e) {
    console.error("[quota] read Type dropdown failed", e instanceof Error ? e.message : e);
    return { type: null };
  }
}

export async function createPackage(ctx: StaffCtx, input: QuotaPackageInput, deps: QuotaDeps): Promise<QuotaWriteResult> {
  requireManager(ctx, "เพิ่มแพ็กเกจ");
  if (!input.sourceId) throw new QuotaError(400, "ต้องเลือกชีท");
  const source = await findSource(ctx.orgId, input.sourceId);
  const tabTitle = input.tabTitle ?? "";
  if (!tabTitle || !tabList(source.tabs).includes(tabTitle)) throw new QuotaError(400, "แท็บนี้ไม่ใช่แท็บโควต้าของชีทนี้");
  const units = checkUnits(input.units);
  const fresh = await freshTab(source, tabTitle, deps);

  const reqs: object[] = [];
  const updates: CellUpdate[] = [];
  let columns: QuotaColumns;
  let headerRow: number;
  let packages: ParsedPackage[];
  if (fresh.parsed) {
    ({ columns, headerRow, packages } = fresh.parsed);
  } else if (isBlankGrid(fresh.rows)) {
    const h = standardHeaderUpdate(tabTitle);
    columns = h.columns; headerRow = 1; packages = [];
    updates.push(h.update);
    if (fresh.tab.columnCount < 11) reqs.push(appendColumnsRequest(fresh.tab.sheetId, 11 - fresh.tab.columnCount));
  } else {
    throw new QuotaError(400, "แท็บนี้ไม่มีหัวตารางโควต้า");
  }
  const startRow = newPackageStartRow(headerRow, packages);
  const lastRow = startRow + units - 1;
  if (lastRow > fresh.tab.rowCount) reqs.unshift(appendRowsRequest(fresh.tab.sheetId, lastRow - fresh.tab.rowCount));
  updates.push(...packageUpdates(tabTitle, columns, startRow, {
    units,
    ...(input.type ? { type: input.type } : {}),
    ...(input.websiteText ? { websiteText: input.websiteText } : {}),
    ...(input.priceText ? { priceText: input.priceText } : {}),
    ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
    ...(input.expireDate !== undefined ? { expireDate: input.expireDate } : {}),
  }));
  assertOverwritesApproved(findOverwrites(tabTitle, columns, fresh.rows, updates, fresh.formulas), deps.confirmOverwrite);

  if (reqs.length) await sheetCall(deps, () => deps.port.batchUpdate(source.spreadsheetId, reqs));
  await writeCells(source, updates, deps);

  // จัดรูปแบบแถวใหม่ (best effort ทั้งชุด)
  let warning: string | undefined;
  try {
    const fmt: object[] = [];
    if (packages.length) {
      const prev = packages.reduce((a, b) => (b.rowNumber > a.rowNumber ? b : a));
      fmt.push(...copySlotFormatRequests(fresh.tab.sheetId, columns, prev.rowNumber, startRow, units));
    }
    // แถว 2..n ของก้อนใหม่มีข้อมูลอยู่ (เช่นสูตรที่ผลว่าง) = ไม่รวมเซลล์ การรวมจะทิ้งข้อมูลนั้น
    if (packageCellsHaveData(columns, startRow + 1, lastRow, fresh.rows, fresh.formulas)) warning = MERGE_SKIPPED_MSG;
    else fmt.push(...mergePackageRequests(fresh.tab.sheetId, columns, startRow, units));
    if (fmt.length) await deps.port.batchUpdate(source.spreadsheetId, fmt);
  } catch {
    warning = "เพิ่มแพ็กเกจแล้ว แต่จัดรูปแบบแถวไม่ได้ (รวมเซลล์ / dropdown) — จัดในชีทเองได้";
  }
  return finish(ctx, source, tabTitle, deps, warning);
}

/**
 * ลบแพ็กเกจที่ไม่พบในชีทแล้ว (stale) พร้อมการจองของมัน — ผู้จัดการเท่านั้น, ลบเฉพาะใน DB ไม่แตะชีท
 * แพ็กเกจที่ยังอยู่ในชีทลบจากที่นี่ไม่ได้ (ต้องลบในชีท)
 */
export async function removeStalePackage(ctx: StaffCtx, packageId: string, deps?: QuotaDeps): Promise<QuotaWriteResult> {
  requireManager(ctx, "ลบแพ็กเกจ");
  const row = await db(() => prisma.blmQuotaPackage.findFirst({ where: { id: packageId, organizationId: ctx.orgId }, select: { id: true, stale: true } }));
  if (!row) throw new QuotaError(404, NOT_FOUND);
  if (!row.stale) throw new QuotaError(400, "ลบได้เฉพาะแพ็กเกจที่ไม่พบในชีทแล้ว — แพ็กเกจนี้ยังอยู่ในชีท");
  await db(async () => {
    // ลบแบบมีเงื่อนไข: ถ้าแพ็กเกจเพิ่งกลับมาในชีท (เลิก stale) ระหว่างนี้ จะไม่ถูกลบ
    const gone = await prisma.blmQuotaPackage.deleteMany({ where: { id: row.id, stale: true } });
    if (gone.count) await prisma.blmQuotaReservation.deleteMany({ where: { packageId: row.id } });
  });
  return { view: await loadQuotaView(ctx, deps) };
}

// ───────────────────────── เขียน: การจอง ─────────────────────────

async function checkUser(orgId: string, id: string): Promise<void> {
  const u = id ? await prisma.user.findFirst({ where: { id, organizationId: orgId }, select: { id: true } }) : null;
  if (!u) throw new QuotaError(400, "ไม่พบผู้จองในองค์กร");
}

export async function createReservation(ctx: StaffCtx, input: QuotaReservationInput, deps: QuotaDeps): Promise<QuotaWriteResult> {
  const client = cleanText(input.client);
  if (!client) throw new QuotaError(400, "ต้องระบุ Clients");
  await db(() => checkUser(ctx.orgId, cleanText(input.reservedById)));
  const { row, source } = await findLivePackage(ctx.orgId, input.packageId);
  const project = input.projectId ? await db(() => findProject(ctx.orgId, cleanText(input.projectId))) : null;
  if (input.projectId && !project) throw new QuotaError(400, "ไม่พบโปรเจกต์");

  const fresh = await freshTab(source, row.tabTitle, deps);
  const { parsed, pkg, next } = await locateOrSync(ctx, source, fresh, row);
  if (pkg.expireDate && pkg.expireDate < todayBangkok()) throw new QuotaError(400, "แพ็กเกจหมดอายุแล้ว");

  let index: number;
  if (input.slotIndex !== undefined && input.slotIndex !== null) {
    index = input.slotIndex;
    if (pkg.slots[index]?.used) throw new QuotaError(409, "ช่องนี้ถูกใช้ไปแล้ว — โหลดใหม่");
  } else {
    const free = pkg.slots.find((s) => !s.used);
    if (free) index = free.index;
    else if (mayGrow(pkg, !next)) index = pkg.slots.length;
    else throw new QuotaError(400, "โควต้าแพ็กเกจนี้เต็มแล้ว");
  }
  const plan = planSlot(pkg, next, index, fresh.tab.rowCount);
  if (!plan) throw new QuotaError(400, "โควต้าแพ็กเกจนี้เต็มแล้ว");
  const updates = slotUpdates(row.tabTitle, parsed.columns, plan.row, {
    client,
    status: cleanText(input.status) || QUOTA_STATUS_IN_PROCESS,
    ...(input.remark !== undefined ? { remark: cleanText(input.remark) } : {}),
  });
  // ตรวจการเขียนทับก่อนจอง: รอบที่ต้องถามผู้ใช้ (409 + overwrites) ต้องไม่ทิ้งการจองไว้ใน DB
  assertOverwritesApproved(plan.insertAt0 !== null ? [] : findOverwrites(row.tabTitle, parsed.columns, fresh.rows, updates, fresh.formulas), deps.confirmOverwrite);

  // จองใน DB ก่อนแตะชีท: unique (packageId, slotIndex) เป็นตัวตัดสินว่าใครได้ช่อง — คนที่แพ้ยังไม่ได้เขียนอะไรลงชีท
  let claimId: string;
  try {
    claimId = await db(async () => {
      // ช่องนี้ว่างในชีท (ตรวจแล้วข้างบน) แต่ cache ยังมีการจองเก่าค้าง (ถูกล้างในชีทไปแล้ว ยังไม่ถึงรอบกวาด) → ลบของเก่าก่อน
      // การจองที่เพิ่งสร้างไม่เกิน RESERVATION_GRACE_MS ไม่ถูกลบ — นั่นคือคนที่กำลังเขียนชีทอยู่
      await prisma.blmQuotaReservation.deleteMany({
        where: { packageId: row.id, slotIndex: index, createdAt: { lt: new Date(Date.now() - RESERVATION_GRACE_MS) } },
      });
      const created = await prisma.blmQuotaReservation.create({
        data: {
          organizationId: ctx.orgId, packageId: row.id, slotIndex: index, reservedById: cleanText(input.reservedById),
          website: cleanText(input.website, 500), projectId: project?.id ?? "", projectName: project?.name ?? "",
          note: cleanText(input.note, 1000), createdById: ctx.userId,
        },
        select: { id: true },
      });
      return created.id;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new QuotaError(409, SLOT_TAKEN_MSG);
    throw e;
  }
  let warning: string | undefined;
  try {
    warning = await prepareSlot(source, fresh, parsed.columns, pkg, plan, deps);
    await writeCells(source, updates, deps);
  } catch (e) {
    // เขียนชีทไม่สำเร็จ → ถอนการจองใน DB คืน (ไม่เขียนล้างเซลล์ในชีท: ไม่รู้แล้วว่าเซลล์นั้นตอนนี้เป็นข้อมูลของใคร)
    await prisma.blmQuotaReservation.deleteMany({ where: { id: claimId } }).catch(() => {});
    throw e;
  }
  return finish(ctx, source, row.tabTitle, deps, warning);
}

export async function updateReservation(
  ctx: StaffCtx, id: string, input: { reservedById?: string; website?: string; projectId?: string; note?: string }, deps?: QuotaDeps,
): Promise<QuotaWriteResult> {
  const r = await db(() => prisma.blmQuotaReservation.findFirst({ where: { id, organizationId: ctx.orgId } }));
  if (!r) throw new QuotaError(404, NOT_FOUND);
  await findLivePackage(ctx.orgId, r.packageId);
  const data: Prisma.BlmQuotaReservationUpdateInput = {};
  if (input.reservedById !== undefined) {
    await db(() => checkUser(ctx.orgId, cleanText(input.reservedById)));
    data.reservedById = cleanText(input.reservedById);
  }
  if (input.website !== undefined) data.website = cleanText(input.website, 500);
  if (input.note !== undefined) data.note = cleanText(input.note, 1000);
  if (input.projectId !== undefined) {
    const pid = cleanText(input.projectId);
    const p = pid ? await db(() => findProject(ctx.orgId, pid)) : null;
    if (pid && !p) throw new QuotaError(400, "ไม่พบโปรเจกต์");
    data.projectId = p?.id ?? "";
    data.projectName = p?.name ?? "";
  }
  await db(() => prisma.blmQuotaReservation.update({ where: { id: r.id }, data }));
  return { view: await loadQuotaView(ctx, deps) };
}

export async function cancelReservation(ctx: StaffCtx, id: string, deps: QuotaDeps): Promise<QuotaWriteResult> {
  const r = await db(() => prisma.blmQuotaReservation.findFirst({ where: { id, organizationId: ctx.orgId } }));
  if (!r) throw new QuotaError(404, NOT_FOUND);
  const { row, source } = await findLivePackage(ctx.orgId, r.packageId);
  const fresh = await freshTab(source, row.tabTitle, deps);
  const { parsed, pkg } = await locateOrSync(ctx, source, fresh, row);
  const slot = pkg.slots[r.slotIndex];
  if (slot?.linkUrl) throw new QuotaError(400, "ช่องนี้มีลิงก์แล้ว ยกเลิกการจองไม่ได้ — แก้ที่ช่องโดยตรง");
  if (slot) {
    const updates = reservationClearUpdates(row.tabTitle, parsed.columns, slot.row);
    assertOverwritesApproved(findOverwrites(row.tabTitle, parsed.columns, fresh.rows, updates, fresh.formulas), deps.confirmOverwrite);
    await writeCells(source, updates, deps);
  }
  await db(() => prisma.blmQuotaReservation.delete({ where: { id: r.id } }));
  return finish(ctx, source, row.tabTitle, deps);
}
