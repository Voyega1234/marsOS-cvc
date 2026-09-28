// ─── Upload Article — แนบกฎ "ภาษามนุษย์" ใน Master Prompt ของลูกค้า ─────────
// เจ้าของสั่ง 2026-09-28: บทความต้องอ่านแล้วเหมือนคนเขียน ไม่ใช่ AI โดยเฉพาะ Title/H1 แต่ใช้กับทุกส่วน
// ไม่ใช่ prompt สำรองแทน Content Engine — เป็นข้อบังคับรูปแบบภาษาเพิ่มจาก layer ใน DB เสมอ (เหมือนสัญญารูปแบบ HTML)

// กฎทั้งหมดย้ายไปอยู่ใน Mars Human Voice Skill (ใช้ร่วมทุกหน้าที่เขียนบทความ) — ไฟล์นี้ re-export ให้โค้ดเดิมของ Upload Article
import { HUMAN_BODY_RULES_TH, HUMAN_TITLE_RULES_TH, humanBodyRulesBlock, humanTitleRulesBlock } from '@/lib/article-human-voice-skill'

export {
  AI_TELL_PHRASES_TH,
  HUMAN_TITLE_RULES_TH,
  HUMAN_BODY_RULES_TH,
  humanTitleRulesBlock,
  humanBodyRulesBlock,
  titleLooksMachineWritten,
} from '@/lib/article-human-voice-skill'

// ─── แนบกฎภาษามนุษย์ไว้ใน Master Prompt ของลูกค้า (เก็บใน DB แก้ต่อได้ใน Content Engine) ───
// เจ้าของสั่ง 2026-09-28: ไม่ฝังตอนเขียน แต่แนบใน Master Prompt ทุกอันแทน
// แนบตอน seed จาก Studio / เพิ่ม layer ใหม่ / สร้างจากบทความตัวอย่าง / สั่ง AI แก้ — ถ้ามีหัวข้อนี้อยู่แล้วไม่แนบซ้ำ

export const HUMAN_VOICE_HEADING = '════ ภาษาต้องอ่านแล้วเหมือนคนเขียน ไม่ใช่ AI ════'
const HUMAN_VOICE_JSON_KEY = 'human_voice_rules'

export function humanVoiceSection(): string {
  return [
    HUMAN_VOICE_HEADING,
    'บังคับทุกส่วน รวมถึง H1 หัวข้อ H2/H3 คำถาม FAQ และ Meta Description',
    humanBodyRulesBlock(),
    'กฎตั้งชื่อ H1 / Title:',
    humanTitleRulesBlock(),
  ].join('\n')
}

/** แนบกฎภาษามนุษย์ท้าย Master Prompt ถ้ายังไม่มี — Master Prompt แบบ JSON ใส่เป็น key แยก */
export function withHumanVoice(promptText: string): string {
  const text = promptText.trim()
  if (!text || text.includes(HUMAN_VOICE_HEADING)) return text
  if (text.startsWith('{')) {
    try {
      const obj = JSON.parse(text) as Record<string, unknown>
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        if (HUMAN_VOICE_JSON_KEY in obj) return text
        return JSON.stringify({ ...obj, [HUMAN_VOICE_JSON_KEY]: [...HUMAN_BODY_RULES_TH, ...HUMAN_TITLE_RULES_TH.map((r) => `H1/Title: ${r}`)] }, null, 2)
      }
    } catch {
      /* ไม่ใช่ JSON จริง — แนบเป็นข้อความตามปกติ */
    }
  }
  return `${text}\n\n${humanVoiceSection()}`
}

/**
 * ใช้ตอนเขียนบทความ — Master Prompt ที่สร้างก่อนมีกฎนี้ หรือถูกแก้ผ่านหน้า Content Engine (PUT /api/prompts/[id] ไม่แนบให้)
 * อาจไม่มีกฎภาษามนุษย์ ถ้า text ที่ resolve แล้วยังไม่มีทั้งหัวข้อและกฎข้อแรก ให้แนบท้ายก่อนส่งให้ writer
 */
export function ensureHumanVoiceText(masterPromptText: string): string {
  const text = masterPromptText.trim()
  if (text.includes(HUMAN_VOICE_HEADING) || text.includes(HUMAN_BODY_RULES_TH[0])) return text
  return `${text}\n\n${humanVoiceSection()}`
}
