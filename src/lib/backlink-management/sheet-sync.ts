/** ซิงก์ Backlink Management → Google Sheet (เซิร์ฟเวอร์เท่านั้น, ทางเดียว, ไม่ throw ออกไปหาผู้เรียก) */
import { google, type sheets_v4 } from "googleapis";
import { prisma } from "@/lib/prisma";
import { getServiceIdentity, getSheetsServiceAuth } from "@/lib/google-auth";
import { isMissingTable, projectInfo } from "./projects";
import { buildSheetTables, SHEET_TITLES, type SheetTable } from "./sheet-tables";
import { loadVendorDetails } from "./vendor-detail-server";

export type SheetSyncStatus = "not_connected" | "skipped" | "synced" | "error";
export interface SheetSyncResult { status: SheetSyncStatus; error?: string; lastSyncedAt?: string }

export async function getSheetConfig(orgId: string) {
  try {
    return await prisma.blmSheetConfig.findUnique({ where: { organizationId: orgId } });
  } catch (e) {
    if (isMissingTable(e)) return null;
    throw e;
  }
}

/** ติดธงว่ามีข้อมูลเปลี่ยน — ไม่เคย throw (ตารางยังไม่มี/ยังไม่เชื่อม = ไม่ทำอะไร) */
export async function markSheetDirty(orgId: string): Promise<void> {
  try {
    await prisma.blmSheetConfig.updateMany({ where: { organizationId: orgId }, data: { dirtyAt: new Date() } });
  } catch {
    /* เงียบ: ห้ามกระทบคำขอเดิม */
  }
}

export async function loadSheetTables(orgId: string): Promise<SheetTable[]> {
  const [requests, vendors, budgets, details] = await Promise.all([
    prisma.blmRequest.findMany({ where: { organizationId: orgId } }),
    prisma.blmVendorSite.findMany({ where: { organizationId: orgId } }),
    prisma.blmBudget.findMany({ where: { organizationId: orgId } }),
    loadVendorDetails(orgId),
  ]);
  const projectIds = Array.from(new Set([...requests.map((r) => r.projectId), ...budgets.map((b) => b.projectId)]));
  const userIds = Array.from(new Set(requests.flatMap((r) => [r.requestedById, r.assigneeId]).filter((x): x is string => !!x)));
  const [pm, users] = await Promise.all([
    projectInfo(orgId, projectIds),
    userIds.length
      ? prisma.user.findMany({ where: { organizationId: orgId, id: { in: userIds } }, select: { id: true, name: true, email: true } })
      : Promise.resolve([] as { id: string; name: string | null; email: string }[]),
  ]);
  const um = new Map(users.map((u) => [u.id, u.name ?? u.email]));
  return buildSheetTables({
    requests: requests.map((r) => ({
      id: r.id, createdAt: r.createdAt, projectId: r.projectId,
      projectName: pm.get(r.projectId)?.name ?? "", clientName: pm.get(r.projectId)?.clientName ?? "",
      budgetPeriod: r.budgetPeriod, status: r.status, vendorDomain: r.vendorDomain, targetUrl: r.targetUrl,
      anchorText: r.anchorText, keyword: r.keyword, linkType: r.linkType, quotedPrice: r.quotedPrice, actualPrice: r.actualPrice,
      requestedByName: um.get(r.requestedById) ?? "", assigneeName: r.assigneeId ? um.get(r.assigneeId) ?? "" : "",
      dueDate: r.dueDate, liveUrl: r.liveUrl, publishedAt: r.publishedAt, checkStatus: r.checkStatus,
      lastCheckedAt: r.lastCheckedAt, foundRel: r.foundRel, rejectReason: r.rejectReason, notes: r.notes,
      asanaTaskUrl: r.asanaTaskUrl, updatedAt: r.updatedAt,
    })),
    vendors: vendors.map((v) => ({
      domain: v.domain, siteUrl: v.siteUrl, category: v.category, price: v.price, currency: v.currency,
      domainRating: v.domainRating, traffic: v.traffic, linkType: v.linkType, contactName: v.contactName,
      contactChannel: v.contactChannel, notes: v.notes, status: v.status, updatedAt: v.updatedAt,
      ...(details.map.get(v.id) ?? {}),
    })),
    budgets: budgets.map((b) => ({
      projectId: b.projectId, projectName: pm.get(b.projectId)?.name ?? "", clientName: pm.get(b.projectId)?.clientName ?? "",
      period: b.period, approvedAmount: b.approvedAmount, note: b.note,
    })),
  });
}

const REQ_OPTS = { timeout: 20_000 };

async function sheetsClient() {
  const auth = await getSheetsServiceAuth();
  return google.sheets({ version: "v4", auth });
}

/** ตรวจว่าเข้าถึงชีทได้ (ต้องแชร์ให้ service email แล้ว) — คืนชื่อไฟล์ */
export async function checkAccess(spreadsheetId: string): Promise<string> {
  const sheets = await sheetsClient();
  const res = await sheets.spreadsheets.get({ spreadsheetId, fields: "properties.title" }, REQ_OPTS);
  return res.data.properties?.title ?? "";
}

const INFO_FIELDS = "properties.title,sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))";

/** ค่าในเซลล์เป็นข้อความ/ตัวเลขล้วนเสมอ — ไม่มีทางกลายเป็นสูตร (ไม่ใช้ formulaValue) */
function cellData(v: string | number): sheets_v4.Schema$CellData {
  if (typeof v === "number") return { userEnteredValue: { numberValue: v } };
  return v === "" ? {} : { userEnteredValue: { stringValue: v } };
}

/**
 * เขียน 3 แท็บของ MarsOS ทับทั้งแท็บ คืนชื่อไฟล์ชีท
 * ทุกแท็บเขียนใน batchUpdate คำสั่งเดียว (Google ทำทั้งชุดหรือไม่ทำเลย) — ถ้าคำขอถูกตัดกลางทาง
 * ชีทจะยังเป็นข้อมูลชุดเดิม ไม่มีช่วงที่แท็บว่าง
 */
export async function writeTables(spreadsheetId: string, tables: SheetTable[]): Promise<string> {
  const sheets = await sheetsClient();
  let info = await sheets.spreadsheets.get({ spreadsheetId, fields: INFO_FIELDS }, REQ_OPTS);
  const have = new Set((info.data.sheets ?? []).map((s) => s.properties?.title ?? ""));
  const missing = tables.filter((t) => !have.has(t.title));
  if (missing.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: missing.map((t) => ({ addSheet: { properties: { title: t.title } } })) },
    }, REQ_OPTS);
    info = await sheets.spreadsheets.get({ spreadsheetId, fields: INFO_FIELDS }, REQ_OPTS);
  }
  const byTitle = new Map((info.data.sheets ?? []).map((s) => [s.properties?.title ?? "", s.properties]));
  const requests: sheets_v4.Schema$Request[] = [];
  for (const t of tables) {
    const p = byTitle.get(t.title);
    if (!p || typeof p.sheetId !== "number") throw new Error(`ไม่พบแท็บ ${t.title} ในชีท`);
    const sheetId = p.sheetId;
    // ขยายตารางให้พอ (ไม่ย่อ) — อย่างน้อย 2 แถวเพื่อให้ตรึงแถวหัวได้
    const rowCount = Math.max(p.gridProperties?.rowCount ?? 0, t.rows.length + 1, 2);
    const columnCount = Math.max(p.gridProperties?.columnCount ?? 0, t.header.length);
    requests.push({
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { rowCount, columnCount, frozenRowCount: 1 } },
        fields: "gridProperties(rowCount,columnCount,frozenRowCount)",
      },
    });
    // range = ทั้งแท็บ: เซลล์ที่ไม่มีข้อมูลใหม่จะถูกล้างค่า (เฉพาะ userEnteredValue)
    requests.push({
      updateCells: {
        range: { sheetId },
        fields: "userEnteredValue",
        rows: [t.header, ...t.rows].map((r) => ({ values: r.map(cellData) })),
      },
    });
  }
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } }, REQ_OPTS);
  return info.data.properties?.title ?? "";
}

export function sheetErrorMessage(e: unknown, serviceEmail: string): string {
  const err = e as { code?: unknown; status?: unknown; message?: unknown; response?: { status?: unknown } } | null;
  const msg = typeof err?.message === "string" ? err.message : "";
  const code = Number(err?.code ?? err?.status ?? err?.response?.status);
  if (msg.includes("has not been used in project") || msg.includes("is disabled")) {
    return "ยังไม่ได้เปิด Google Sheets API ใน Google Cloud project ของ service account";
  }
  if (code === 403 || msg.includes("does not have permission")) return `ยังไม่ได้แชร์ชีทให้ ${serviceEmail} เป็น Editor`;
  if (code === 404 || code === 400) return "ไม่พบชีทนี้ ตรวจลิงก์อีกครั้ง";
  return (msg || "เขียน Google Sheet ไม่สำเร็จ").slice(0, 200);
}

async function serviceEmailSafe(): Promise<string> {
  try {
    return (await getServiceIdentity()).email;
  } catch {
    return "";
  }
}

export async function syncSheet(orgId: string, opts: { force?: boolean } = {}): Promise<SheetSyncResult> {
  try {
    const cfg = await getSheetConfig(orgId);
    if (!cfg) return { status: "not_connected" };
    if (!opts.force && !cfg.dirtyAt && cfg.lastSyncedAt) return { status: "skipped" };
    const startDirty = cfg.dirtyAt;
    try {
      const tables = await loadSheetTables(orgId);
      const title = await writeTables(cfg.spreadsheetId, tables);
      const now = new Date();
      await prisma.blmSheetConfig.update({ where: { id: cfg.id }, data: { lastSyncedAt: now, lastError: "", title } });
      await prisma.blmSheetConfig.updateMany({ where: { id: cfg.id, dirtyAt: startDirty }, data: { dirtyAt: null } });
      return { status: "synced", lastSyncedAt: now.toISOString() };
    } catch (e) {
      const message = sheetErrorMessage(e, await serviceEmailSafe());
      await prisma.blmSheetConfig.update({ where: { id: cfg.id }, data: { lastError: message } }).catch(() => {});
      return { status: "error", error: message };
    }
  } catch (e) {
    return { status: "error", error: (e instanceof Error ? e.message : "sync ไม่สำเร็จ").slice(0, 200) };
  }
}

/** sync แต่รอไม่เกิน ms มิลลิวินาที (ใช้ใน webhook) — ไม่ throw */
export async function syncSheetWithin(orgId: string, ms: number): Promise<void> {
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((r) => { timer = setTimeout(r, ms); });
    await Promise.race([syncSheet(orgId).then(() => undefined), timeout]);
    if (timer) clearTimeout(timer);
  } catch {
    /* เงียบ */
  }
}
