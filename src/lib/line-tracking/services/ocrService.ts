// Slip OCR — reads the transfer amount from a payment-slip image so sales don't
// type it. The model also gives a soft "looks edited?" signal (suspicious/suspiciousReason)
// but this is NOT a real authenticity check — a human still confirms PAID (OCR can
// misread / a well-made fake can still pass the suspicious check).
//
// Provider order:
//  1) Gemini through the MarsOS AI provider (OpenRouter, services/aiRead.ts). It reads the
//     slip image directly and returns amount/phone/name in one call, which copes with
//     different bank slip layouts better than plain OCR plus regex.
//  2) OCR.space (OCR_SPACE_API_KEY), only when that key is set and the AI read failed.
import { readFileWithAI, type AiReadContext } from "./aiRead";

export interface OcrResult {
  ok: boolean;
  text: string;
  amount: number | null;
  phone?: string | null;   // เบอร์ที่ OCR เดาได้จากสลิป (เซลส์ยืนยัน)
  name?: string | null;    // ชื่อที่ OCR เดาได้ (มีคำนำหน้า) — เซลส์ยืนยัน
  // Soft signal only (Gemini path only — Vision/OCR.space can't judge this from
  // plain text) — a sophisticated fake can still slip through. NOT a substitute
  // for the human PAID confirmation, just an extra flag for sales to look twice.
  suspicious?: boolean | null;
  suspiciousReason?: string | null;
  error?: string;
}

/** Thai mobile number from slip text (เซลส์ยืนยันอีกที). */
export function parsePhone(text: string): string | null {
  const m = text.match(/0[689][\d\s-]{8,12}/);
  if (!m) return null;
  const digits = m[0].replace(/\D/g, "");
  return digits.length === 10 ? digits : null;
}

/** Conservative Thai-name guess — only when a title prefix is present (avoids bank labels). */
export function parseName(text: string): string | null {
  const m = text.match(/(นางสาว|น\.ส\.|นาย|นาง|คุณ)\s?([ก-๙]{2,}(?:\s[ก-๙]{2,})?)/);
  return m ? `${m[1]} ${m[2]}`.replace(/\s+/g, " ").trim() : null;
}

function extractSlip(text: string) {
  return { amount: parseAmount(text), phone: parsePhone(text), name: parseName(text) };
}

/** Pull the most likely transfer amount out of OCR text. */
export function parseAmount(text: string): number | null {
  // Amounts look like 1,234.00 / 1234.00 / 12,000 — numbers with a thousands
  // comma or a 2-decimal. Account numbers (long plain digit runs) are ignored.
  const re = /(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{2})/g;
  const found: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = parseFloat(m[1].replace(/,/g, ""));
    if (n > 0 && n < 100_000_000) found.push(n);
  }
  if (!found.length) return null;
  // The transfer amount is typically the largest such number on the slip.
  return Math.max(...found);
}

const SLIP_PROMPT = `นี่คือรูปสลิปโอนเงิน อ่านแล้วดึงข้อมูลออกมา ตอบเป็น JSON เท่านั้น ไม่มีข้อความอื่น:
{"amount": ตัวเลขยอดโอนจริง (number ไม่มี comma) หรือ null ถ้าไม่เจอ,
 "phone": เบอร์มือถือไทย 10 หลัก (string) หรือ null ถ้าไม่เจอ,
 "name": ชื่อผู้โอนหรือผู้รับ พร้อมคำนำหน้า (string) หรือ null ถ้าไม่เจอ,
 "suspicious": true ถ้าเห็นสัญญาณว่าอาจเป็นภาพตัดต่อ/แก้ไข เช่น ฟอนต์ของตัวเลขยอดเงินไม่ตรงกับฟอนต์ส่วนอื่นของสลิป, ตัวหนังสือ/ตัวเลขเบี้ยว-เยื้อง-ซ้อนทับผิดตำแหน่ง, พื้นหลังเบลอหรือมีรอยต่อเฉพาะบริเวณตัวเลข, สีพื้นหลังไม่สม่ำเสมอเฉพาะจุด — ให้เป็น false ถ้าดูเป็นสลิปปกติทั่วไป (ไม่ใช่ null ให้เดาไปทางใดทางหนึ่ง),
 "suspiciousReason": ถ้า suspicious=true อธิบายสั้นๆ ว่าสงสัยตรงจุดไหน (string) ไม่งั้นเป็น null}
amount คือยอดเงินที่โอนจริงเท่านั้น ห้ามเอาเลขบัญชีหรือเลขอ้างอิงธุรกรรมมาใส่
หมายเหตุ: suspicious เป็นแค่การสังเกตเบื้องต้น ไม่ใช่การยืนยันแน่นอนว่าสลิปปลอมหรือของจริง ถ้าไม่แน่ใจให้ตอบ false`;

function parseSlipJson(text: string): OcrResult | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as {
      amount?: number | null; phone?: string | null; name?: string | null;
      suspicious?: boolean | null; suspiciousReason?: string | null;
    };
    return {
      ok: true,
      text,
      amount: typeof parsed.amount === "number" ? parsed.amount : null,
      phone: parsed.phone || null,
      name: parsed.name || null,
      suspicious: parsed.suspicious === true,
      suspiciousReason: parsed.suspicious === true ? (parsed.suspiciousReason || null) : null,
    };
  } catch { return null; }
}

async function ocrWithAI(image: Buffer, filename: string, ctx?: AiReadContext): Promise<OcrResult> {
  const r = await readFileWithAI({ kind: "slip", data: image, filename, prompt: SLIP_PROMPT, ctx });
  if (!r.ok) return { ok: false, text: r.text, amount: null, error: r.error };
  return parseSlipJson(r.text)
    ?? { ok: false, text: r.text, amount: null, error: `AI: ไม่พบ JSON ในคำตอบ (${r.text.slice(0, 200)})` };
}

export async function ocrSlip(image: Buffer, filename = "slip.jpg", ctx?: AiReadContext): Promise<OcrResult> {
  const g = await ocrWithAI(image, filename, ctx);
  if (g.ok) return g;
  const apikey = process.env.OCR_SPACE_API_KEY?.trim();
  if (!apikey) return g;
  console.warn("[ocr] AI อ่านสลิปไม่สำเร็จ ใช้ OCR.space แทน:", g.error);
  try {
    const form = new FormData();
    form.append("apikey", apikey);
    form.append("language", "eng");
    form.append("OCREngine", "2");
    form.append("scale", "true");
    form.append("isTable", "true");
    form.append("file", new Blob([new Uint8Array(image)]), filename);

    const res = await fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await res.json()) as {
      ParsedResults?: { ParsedText?: string }[];
      IsErroredOnProcessing?: boolean;
      ErrorMessage?: string | string[];
    };
    if (json.IsErroredOnProcessing) {
      const err = Array.isArray(json.ErrorMessage) ? json.ErrorMessage.join("; ") : json.ErrorMessage;
      return { ok: false, text: "", amount: null, error: err || "OCR failed" };
    }
    const text = json.ParsedResults?.[0]?.ParsedText ?? "";
    return { ok: true, text, ...extractSlip(text) };
  } catch (err) {
    return { ok: false, text: "", amount: null, error: err instanceof Error ? err.message : String(err) };
  }
}
