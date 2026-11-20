// Sales-document PDF reader — extracts document number, total and buyer details from a
// quotation, invoice or receipt PDF (ใบเสนอราคา / ใบแจ้งหนี้ / ใบเสร็จ) that a customer
// sends in LINE chat, so sales don't type them. Mirrors the
// slip OCR in ocrService.ts (which stays the path for slip images) but sends the PDF
// as a document instead of an image.
//
// Provider: Gemini through the MarsOS AI provider (OpenRouter, services/aiRead.ts), with the PDF sent
// inline. No OCR.space fallback: it does not read PDFs synchronously.
import { readFileWithAI, type AiReadContext } from "./aiRead";

/** LINE allows big files; anything larger than this is not a quotation worth sending to the model. */
export const MAX_QUOTATION_PDF_BYTES = 10 * 1024 * 1024;

export type SalesDocType = "quotation" | "invoice" | "receipt" | "other";

export interface QuotationResult {
  ok: boolean;
  text: string;
  docType: SalesDocType;          // "other" = not a sales document (catalog, contract, ...)
  docNumber?: string | null;
  referenceNumber?: string | null; // e.g. the invoice a receipt refers to
  issueDate?: string | null;       // as printed
  total: number | null;            // grand total incl. VAT
  amountPaid?: number | null;      // receipts only
  currency?: string | null;
  isDeposit: boolean;              // every line item is a deposit (มัดจำ), not the full deal
  customerContactName?: string | null; // a person on the buyer side, never the seller's staff
  customerCompany?: string | null;
  customerTaxId?: string | null;
  phone?: string | null;           // buyer's Thai mobile number
  salesContactName?: string | null; // the seller's salesperson ("ติดต่อกลับที่"), for lead.salesOwner
  validUntil?: string | null;      // quotations only, as printed
  itemsSummary?: string | null;
  error?: string;
}

/** True when the buffer starts with the PDF magic bytes. */
export function isPdf(buf: Buffer): boolean {
  return buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-";
}

const QUOTATION_PROMPT = `นี่คือไฟล์ PDF ที่ลูกค้าส่งในแชท LINE อ่านแล้วดึงข้อมูลออกมา ตอบเป็น JSON เท่านั้น ไม่มีข้อความอื่น:
{"docType": "quotation" ถ้าเป็นใบเสนอราคา, "invoice" ถ้าเป็นใบแจ้งหนี้/ใบวางบิล, "receipt" ถ้าเป็นใบเสร็จรับเงิน (รวมใบเสร็จรับเงิน/ใบกำกับภาษี), "other" ถ้าไม่ใช่เอกสารขาย,
 "docNumber": เลขที่เอกสาร (string) หรือ null,
 "referenceNumber": เลขที่เอกสารอ้างอิง เช่น ใบแจ้งหนี้ที่ใบเสร็จนี้อ้างถึง (string) หรือ null,
 "issueDate": วันที่ออกเอกสาร ตามที่พิมพ์ (string) หรือ null,
 "total": จำนวนเงินทั้งสิ้น/ยอดรวมสุทธิ รวม VAT แล้ว (number ไม่มี comma) หรือ null,
 "amountPaid": จำนวนเงินที่ชำระ (เฉพาะใบเสร็จ, number) หรือ null,
 "currency": สกุลเงินแบบ ISO เช่น "THB" หรือ null,
 "isDeposit": true ถ้ารายการทั้งหมดเป็นเงินมัดจำ/มัดจำ/Deposit ไม่งั้น false,
 "customerContactName": ชื่อ-นามสกุลบุคคลฝั่งผู้ซื้อ พร้อมคำนำหน้า (string) หรือ null,
 "customerCompany": ชื่อบริษัท/ร้านฝั่งผู้ซื้อ ตามที่พิมพ์ (string) หรือ null,
 "customerTaxId": เลขประจำตัวผู้เสียภาษี 13 หลักฝั่งผู้ซื้อ (string) หรือ null,
 "phone": เบอร์โทรฝั่งผู้ซื้อ (string) หรือ null,
 "salesContactName": ชื่อเซลส์ฝั่งผู้ขาย คือชื่อบุคคลใต้หัวข้อ "ติดต่อกลับที่" (หรือ "ผู้ติดต่อฝั่งผู้ขาย"/"Sales"/"พนักงานขาย") (string) หรือ null,
 "validUntil": วันที่ยืนราคาถึง (เฉพาะใบเสนอราคา) หรือ null,
 "itemsSummary": สรุปรายการสินค้า/บริการสั้นๆ ไม่เกิน 120 ตัวอักษร (string) หรือ null}
ข้อมูลผู้ซื้อเอาจากส่วน "ลูกค้า", "Customer", "Bill to", "เรียน", "ผู้ติดต่อ", "Attn" เท่านั้น
ห้ามเอาข้อมูลฝั่งผู้ขายมาใส่ในช่องของผู้ซื้อเด็ดขาด ได้แก่ ส่วน "ผู้ขาย"/"Seller"/หัวกระดาษบริษัทผู้ออกเอกสาร, ส่วน "ติดต่อกลับที่", และชื่อในช่องลายเซ็นผู้ออกเอกสาร/ผู้อนุมัติเอกสาร
ช่องที่พิมพ์เป็น "-" หรือว่าง ให้เป็น null ห้ามเดา
total คือยอดรวมสุทธิเท่านั้น ห้ามเอาราคาต่อหน่วย ยอดก่อน VAT หรือเลขที่เอกสารมาใส่ ถ้าไม่แน่ใจให้เป็น null`;

const DOC_TYPES: SalesDocType[] = ["quotation", "invoice", "receipt", "other"];

function str(v: unknown): string | null {
  const t = typeof v === "string" ? v.trim() : "";
  return t && t !== "-" ? t : null;
}

function money(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

export function parseQuotationJson(text: string): QuotationResult | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const p = JSON.parse(match[0]) as Record<string, unknown>;
    const phone = str(p.phone)?.replace(/\D/g, "") ?? null;
    const taxId = str(p.customerTaxId)?.replace(/\D/g, "") ?? null;
    return {
      ok: true,
      text,
      docType: DOC_TYPES.includes(p.docType as SalesDocType) ? (p.docType as SalesDocType) : "other",
      docNumber: str(p.docNumber),
      referenceNumber: str(p.referenceNumber),
      issueDate: str(p.issueDate),
      total: money(p.total),
      amountPaid: money(p.amountPaid),
      currency: str(p.currency)?.toUpperCase() ?? null,
      isDeposit: p.isDeposit === true,
      customerContactName: str(p.customerContactName),
      customerCompany: str(p.customerCompany),
      customerTaxId: taxId && taxId.length === 13 ? taxId : null,
      phone: phone && /^0\d{8,9}$/.test(phone) ? phone : null,
      salesContactName: str(p.salesContactName),
      validUntil: str(p.validUntil),
      itemsSummary: str(p.itemsSummary)?.slice(0, 120) ?? null,
    };
  } catch {
    return null;
  }
}

const fail = (error: string, text = ""): QuotationResult => ({ ok: false, text, docType: "other", total: null, isDeposit: false, error });

export async function readQuotationPdf(
  pdf: Buffer,
  filename = "quotation.pdf",
  ctx?: AiReadContext,
): Promise<QuotationResult> {
  if (!isPdf(pdf)) return fail("ไฟล์ไม่ใช่ PDF");
  if (pdf.length > MAX_QUOTATION_PDF_BYTES) return fail(`PDF ใหญ่เกิน ${MAX_QUOTATION_PDF_BYTES / 1024 / 1024}MB`);
  const r = await readFileWithAI({ kind: "quotation", data: pdf, filename: filename || "quotation.pdf", prompt: QUOTATION_PROMPT, ctx });
  if (!r.ok) return fail(r.error, r.text);
  return parseQuotationJson(r.text) ?? fail(`AI: ไม่พบ JSON ในคำตอบ (${r.text.slice(0, 200)})`, r.text);
}
