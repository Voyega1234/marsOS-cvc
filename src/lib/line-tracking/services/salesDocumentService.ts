// Applies a sales-document PDF (quotation / invoice / receipt) read by quotationService to
// a lead: fills empty fields, writes a history note and — for auto-PAID projects — moves
// the lead to PAID (Purchase). Shared by the LINE webhook (new messages) and the
// backfill page (PDFs already recorded in lt_webhook_log before the feature existed).
import type { Lead, LtProject as Project } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { changeLeadStatus } from "@/lib/line-tracking/services/leadService";
import { downloadLineContent } from "@/lib/line-tracking/services/lineService";
import { getConnectionConfig } from "@/lib/line-tracking/services/connectionStore";
import { readQuotationPdf, MAX_QUOTATION_PDF_BYTES, type QuotationResult } from "@/lib/line-tracking/services/quotationService";
import type { LineConfig } from "@/lib/line-tracking/connectors";
import type { LeadStatus } from "@/lib/line-tracking/enums";

import { isAutoPaidProject } from "@/lib/line-tracking/services/autoPaidProjects";

export { isAutoPaidProject };

// KOWA slips: 900 THB is the booking deposit (BOOKED); any other amount closes the deal
// straight to PAID (KOWA does not use WON, to avoid a second purchase conversion). A
// quotation also moves the lead to PAID with the quotation total (see applySalesDocument).
export const KOWA_BOOKING_AMOUNT = 900;

const STATUS_RANK: Record<LeadStatus, number> = {
  LOST: -1, NEW: 0, CONTACTED: 1, QUALIFIED: 2, QUOTED: 3, BOOKED: 4, WON: 5, PAID: 6,
};

/**
 * Status a KOWA slip moves the lead to, or null to leave it alone: never for a slip the
 * OCR flagged as suspicious (the team checks it first), and never backwards (a booking
 * slip arriving after the deal closed must not pull the lead back to BOOKED).
 */
export function kowaSlipTargetStatus(current: LeadStatus, amount: number, suspicious: boolean): LeadStatus | null {
  if (suspicious || !(amount > 0)) return null;
  const target: LeadStatus = Math.abs(amount - KOWA_BOOKING_AMOUNT) < 0.005 ? "BOOKED" : "PAID";
  return STATUS_RANK[target] > (STATUS_RANK[current] ?? -1) ? target : null;
}

/** Marker appended to the history note so a LINE message is never applied twice. */
function messageMarker(messageId: string): string {
  return `#pdf:${messageId}`;
}

/**
 * Message ids (of `pdfs`) already applied to their lead. Matches the `#pdf:` marker, plus
 * notes from the first webhook release, which wrote no marker: an OCR "📄 ได้รับ…" note
 * naming the same file, written at or after the message was sent.
 */
export async function appliedPdfMessageIds(pdfs: (Pick<LoggedPdf, "messageId" | "fileName" | "sentAt"> & { leadId: string })[]): Promise<Set<string>> {
  const leadIds = Array.from(new Set(pdfs.map((p) => p.leadId)));
  if (!leadIds.length) return new Set();
  const notes = await prisma.leadStatusHistory.findMany({
    where: { leadId: { in: leadIds }, changedBy: "OCR (Gemini)", note: { contains: "📄 ได้รับ" } },
    select: { leadId: true, note: true, createdAt: true },
  });
  const applied = new Set<string>();
  for (const p of pdfs) {
    const sentAt = new Date(p.sentAt).getTime();
    const hit = notes.some((h) =>
      h.leadId === p.leadId &&
      ((h.note ?? "").includes(messageMarker(p.messageId)) ||
        (!(h.note ?? "").includes("#pdf:") && (h.note ?? "").includes(`(${p.fileName})`) && h.createdAt.getTime() >= sentAt)),
    );
    if (hit) applied.add(p.messageId);
  }
  return applied;
}

export type ApplyOutcome = { autoPaid: boolean; note: string };

export async function applySalesDocument(params: {
  project: Pick<Project, "name">;
  lead: Lead;
  q: QuotationResult;
  fileName: string;
  messageId: string;
  /** Extra text for the note, e.g. "ย้อนหลัง" for the backfill. */
  origin?: string;
}): Promise<ApplyOutcome> {
  const { project, lead, q, fileName, messageId } = params;
  const label = { quotation: "ใบเสนอราคา", invoice: "ใบแจ้งหนี้", receipt: "ใบเสร็จรับเงิน", other: "เอกสาร PDF" }[q.docType];
  const currency = q.currency ?? lead.currency;
  const amount = q.amountPaid ?? q.total;
  const autoPaid = isAutoPaidProject(project) && amount != null;
  // KOWA quotations carry the full deal price, so their total replaces any slip amount
  // (e.g. the 900 THB booking deposit) as the lead value.
  const quoteIsDealValue = isAutoPaidProject(project) && q.docType === "quotation";
  // Only fill empty fields. The document amount becomes the lead value until a slip
  // arrives (a slip is real payment and is never overwritten). A deposit is only part
  // of the deal, so it is noted but not used as the value — except in auto-PAID
  // projects, where the document is the purchase record.
  const data: Record<string, unknown> = {};
  const notes: string[] = [];
  if (q.docNumber) notes.push(`เลขที่ ${q.docNumber}${q.referenceNumber ? ` (อ้างอิง ${q.referenceNumber})` : ""}`);
  if (q.total) {
    if (quoteIsDealValue && currency === lead.currency) data.value = q.total;
    else if ((autoPaid || !q.isDeposit) && lead.slipAmount == null && currency === lead.currency) data.value = autoPaid ? amount : q.total;
    notes.push(`${q.isDeposit ? "มัดจำ" : "ยอดรวม"} ${q.total.toLocaleString()} ${currency}`);
  }
  if (q.amountPaid && q.amountPaid !== q.total) notes.push(`ชำระ ${q.amountPaid.toLocaleString()} ${currency}`);
  // B2B documents often name only the buyer company; use it when no person is named.
  const buyer = q.customerContactName ?? q.customerCompany;
  if (buyer) {
    if (!lead.fullName) data.fullName = buyer;
    notes.push(`ผู้ซื้อ ${buyer}`);
  }
  if (q.customerContactName && q.customerCompany) notes.push(`บริษัท ${q.customerCompany}`);
  if (q.customerTaxId) notes.push(`เลขภาษี ${q.customerTaxId}`);
  if (q.phone && !lead.phone) { data.phone = q.phone; notes.push(`เบอร์ ${q.phone}`); }
  if (q.salesContactName) {
    if (!lead.salesOwner) data.salesOwner = q.salesContactName;
    notes.push(`เซลส์ ${q.salesContactName}`);
  }
  if (q.validUntil) notes.push(`ยืนราคาถึง ${q.validUntil}`);
  if (q.itemsSummary) notes.push(`รายการ: ${q.itemsSummary}`);
  if (Object.keys(data).length) {
    await prisma.lead.update({ where: { id: lead.id }, data });
  }
  const summary = `📄 ได้รับ${label}${params.origin ? ` (${params.origin})` : ""} (${fileName}) — อ่านให้อัตโนมัติ: ${notes.length ? notes.join(" · ") : "ไม่พบข้อมูลที่อ่านได้"}`;
  const marker = messageMarker(messageId);
  if (autoPaid && lead.status !== "PAID") {
    // Value is written first: changeLeadStatus re-reads the lead, so the queued purchase
    // conversion carries the document amount.
    const note = `${summary} → อัปเดตเป็น Purchase อัตโนมัติ ${marker}`;
    await changeLeadStatus(lead.id, "PAID", { changedBy: "OCR (Gemini)", note });
    return { autoPaid: true, note };
  }
  const note = `${summary} (เซลส์ตรวจสอบก่อนเปลี่ยนสถานะ) ${marker}`;
  await prisma.leadStatusHistory.create({
    data: { leadId: lead.id, newStatus: lead.status, changedBy: "OCR (Gemini)", note },
  });
  return { autoPaid: false, note };
}

// ── Backfill: PDFs recorded in lt_webhook_log ─────────────────────────────────

export type LoggedPdf = {
  messageId: string;
  fileName: string;
  fileSize: number | null;
  sentAt: string; // ISO
  lineUserId: string;
};

type LoggedEvent = {
  type?: string;
  timestamp?: number;
  source?: { userId?: string };
  message?: { type?: string; id?: string; fileName?: string; fileSize?: number };
};

/** Every PDF file message ever logged for the project, newest first, de-duplicated by message id. */
export async function listLoggedPdfs(projectId: string): Promise<LoggedPdf[]> {
  const logs = await prisma.webhookLog.findMany({
    // REJECTED = signature did not verify, so its events may be forged; skip them.
    where: { projectId, source: "LINE", status: { not: "REJECTED" }, payload: { contains: '"type":"file"' } },
    select: { payload: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const seen = new Map<string, LoggedPdf>();
  for (const log of logs) {
    let events: LoggedEvent[] = [];
    try {
      events = (JSON.parse(log.payload ?? "{}") as { events?: LoggedEvent[] }).events ?? [];
    } catch {
      continue;
    }
    for (const e of events) {
      const m = e.message;
      if (e.type !== "message" || m?.type !== "file" || !m.id || !e.source?.userId) continue;
      if (!/\.pdf$/i.test(m.fileName ?? "") || seen.has(m.id)) continue;
      seen.set(m.id, {
        messageId: m.id,
        fileName: m.fileName ?? "document.pdf",
        fileSize: typeof m.fileSize === "number" ? m.fileSize : null,
        sentAt: new Date(e.timestamp ?? log.createdAt.getTime()).toISOString(),
        lineUserId: e.source.userId,
      });
    }
  }
  return Array.from(seen.values());
}

export async function findLeadForLineUser(projectId: string, lineUserId: string): Promise<Lead | null> {
  const lineUser = await prisma.lineUser.findFirst({ where: { projectId, lineUserId }, select: { id: true } });
  if (!lineUser) return null;
  return prisma.lead.findFirst({ where: { projectId, lineUserId: lineUser.id }, orderBy: { createdAt: "desc" } });
}

export type BackfillRead =
  | { ok: true; q: QuotationResult }
  | { ok: false; error: string };

/** Download a logged PDF from LINE and read it. LINE deletes user content after a while; that shows as a download failure. */
export async function readLoggedPdf(projectId: string, pdf: LoggedPdf): Promise<BackfillRead> {
  if ((pdf.fileSize ?? 0) > MAX_QUOTATION_PDF_BYTES) return { ok: false, error: "ไฟล์ใหญ่เกิน 10MB" };
  const lineConfig = await getConnectionConfig<LineConfig>(projectId, "LINE");
  if (!lineConfig.messagingAccessToken) return { ok: false, error: "โปรเจกต์ยังไม่ได้ตั้ง LINE access token" };
  const buf = await downloadLineContent(lineConfig.messagingAccessToken, pdf.messageId);
  if (!buf) return { ok: false, error: "ดาวน์โหลดไม่ได้ — LINE อาจลบไฟล์นี้ไปแล้ว (ไฟล์เก่า)" };
  const q = await readQuotationPdf(buf, pdf.fileName, { projectId });
  if (!q.ok) return { ok: false, error: q.error ?? "อ่าน PDF ไม่สำเร็จ" };
  return { ok: true, q };
}
