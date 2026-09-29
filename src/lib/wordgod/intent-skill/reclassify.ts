/**
 * Keyword Intent Skill — ให้ AI ช่วยตัดสิน intent ที่ยังกำกวม (needsReview / confidence ต่ำ)
 * ไม่มี ctx.llm หรือ AI ล้มเหลว → เก็บผล rule-based เดิมไว้ ไม่โยน error
 */
import type { IntentCode, IntentMix, IntentSkillContext, IntentSkillInputRow, KeywordIntent } from './types';

const BATCH_SIZE = 80;
const MAX_CALLS = 6; // รันพร้อมกัน — รอบใหญ่ (300+ คำ) ยังได้ AI ตัดสินคำกำกวมครบขึ้น โดยเวลาไม่เพิ่ม

interface LlmClassifyItem {
  keyword: string;
  primary: IntentCode;
  mix: IntentMix;
  reason: string;
}
interface LlmClassifyResponse {
  items?: LlmClassifyItem[];
}

function buildPrompt(batch: IntentSkillInputRow[], ctx: IntentSkillContext): string {
  return [
    'คุณช่วยตัดสิน Search Intent ของคีย์เวิร์ดภาษาไทย/อังกฤษ ตามนิยาม 4 แบบ:',
    '- I (Informational) = หาความรู้/วิธีทำ/สาเหตุ/อาการ เช่น "วิธี...", "...คืออะไร", "ทำไม..."',
    '- C (Commercial) = กำลังชั่งใจ เปรียบเทียบ/หาราคา/หายี่ห้อ เช่น "ราคา", "รีวิว", "ยี่ห้อไหนดี", "เทียบ"',
    '- T (Transactional) = พร้อมซื้อ/จ้าง/ติดต่อ เช่น "รับ...", "บริการ...", "ซื้อ...", "จอง", "ใกล้ฉัน"',
    '- N (Navigational) = ค้นหาแบรนด์เฉพาะเจาะจง (ของเราเองหรือคู่แข่ง)',
    `บริบทธุรกิจ: ${ctx.businessContext || '(ไม่ได้ระบุ)'}`,
    'คีย์เวิร์ดที่ต้องตัดสิน (แต่ละคำให้ตอบ primary ตัวเดียว และ mix ที่อาจผสมได้ เช่น "I/C"):',
    JSON.stringify(batch.map(r => r.keyword)),
    'ตอบกลับเป็น JSON เท่านั้นตามรูปแบบ:',
    '{"items":[{"keyword":"...","primary":"I|C|T|N","mix":"I|C|T|N|I/C|I/T|C/T","reason":"เหตุผลสั้น ๆ ภาษาไทย"}]}',
  ].join('\n');
}

function isValidCode(v: unknown): v is IntentCode {
  return v === 'I' || v === 'C' || v === 'T' || v === 'N';
}
function isValidMix(v: unknown): v is IntentMix {
  return isValidCode(v) || v === 'I/C' || v === 'I/T' || v === 'C/T';
}

/**
 * rows ที่ needsReview หรือ confidence<0.6 เท่านั้นถูกส่งให้ AI ตัดสินซ้ำ
 * intents: key (IntentSkillInputRow.key) → KeywordIntent ที่ได้จาก classifyIntent — mutate ในที่เดิม
 */
export async function reclassifyAmbiguous(
  rows: IntentSkillInputRow[],
  intents: Map<string, KeywordIntent>,
  ctx: IntentSkillContext
): Promise<{ warnings: string[] }> {
  const warnings: string[] = [];
  const llm = ctx.llm;
  if (!llm) return { warnings };

  const ambiguous = rows.filter(r => {
    const it = intents.get(r.key);
    return it && (it.needsReview || it.confidence < 0.6);
  });
  if (!ambiguous.length) return { warnings };

  const batches: IntentSkillInputRow[][] = [];
  for (let i = 0; i < ambiguous.length && batches.length < MAX_CALLS; i += BATCH_SIZE) {
    batches.push(ambiguous.slice(i, i + BATCH_SIZE));
  }

  // แต่ละ batch เป็นชุดคีย์เวิร์ดคนละกลุ่ม (ไม่ทับกัน) — mutate intents map แยกคีย์กันได้ปลอดภัย
  // รันพร้อมกันได้ แต่เก็บ warnings แยกต่อ batch แล้วค่อย push ตามลำดับเดิมให้ deterministic
  const batchWarnings = await Promise.all(batches.map(async batch => {
    const warns: string[] = [];
    try {
      const prompt = buildPrompt(batch, ctx);
      const raw = await llm(prompt, 'intent_skill_classify');
      const parsed = raw as LlmClassifyResponse;
      if (!parsed || !Array.isArray(parsed.items)) {
        warns.push('AI ช่วยตัดสิน intent ที่กำกวมไม่สำเร็จ (รูปแบบผลลัพธ์ไม่ถูกต้อง) — ใช้ผลจาก rule เดิม');
        return warns;
      }

      const byKeyword = new Map(batch.map(r => [r.keyword, r.key] as const));
      for (const item of parsed.items) {
        if (!item || !isValidCode(item.primary) || !isValidMix(item.mix)) continue;
        const key = byKeyword.get(item.keyword);
        if (!key) continue;
        const intent = intents.get(key);
        if (!intent) continue;

        const hadSerpEvidence = intent.evidence.some(e => e.source === 'serp' || e.source === 'dfs');
        if (hadSerpEvidence) {
          if (item.primary === intent.primary) {
            intent.needsReview = false;
            intent.evidence.push({ source: 'llm', detail: `เห็นด้วยกับ SERP: ${item.reason || ''}`.trim() });
          } else {
            // มีหลักฐาน SERP อยู่ก่อน — ยึด SERP เป็นหลัก แต่บันทึกความเห็น AI ไว้ให้คนตรวจ
            intent.evidence.push({
              source: 'llm',
              detail: `ไม่ตรงกับ SERP (AI เสนอ ${item.primary}): ${item.reason || ''}`.trim(),
            });
          }
        } else {
          intent.primary = item.primary;
          intent.mix = item.mix;
          intent.confidence = 0.7;
          intent.needsReview = false;
          intent.evidence.push({ source: 'llm', detail: item.reason || `AI จัด intent เป็น ${item.mix}` });
        }
      }
    } catch {
      warns.push('เรียก AI ช่วยตัดสิน intent ไม่สำเร็จ — ใช้ผลจาก rule เดิม');
    }
    return warns;
  }));
  for (const warns of batchWarnings) warnings.push(...warns);

  return { warnings };
}
