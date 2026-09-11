// ─────────────────────────────────────────────────────────────────────────────
//  Content Engine Prompt Compiler
//
//  ปัญหาที่แก้ (คำสั่งเจ้าของ 2026-09-11):
//  โหมด "กรอกฟอร์ม" เก็บคำตอบเป็น JSON แล้วตอนเขียนบทความถูกแปลงเป็นบรรทัด
//  "key: value" แห้ง ๆ ซึ่งคุณภาพสู้โหมด "วาง Prompt ดิบ" ไม่ได้
//  ชั้นนี้ให้ LLM เรียบเรียงคำตอบจากฟอร์มเป็น prompt เต็มรูปแบบหนึ่งครั้งตอนบันทึก
//  แล้วเก็บผลไว้ในฟิลด์ _compiledPrompt ของ JSON เดิม (ไม่ต้อง migrate ตาราง)
//
//  ตอนเขียนบทความ content-engine-resolve.ts จะหยิบ _compiledPrompt ก่อนเสมอ
//  ทีมยังเปิดดู/แก้/สั่ง compile ใหม่ได้จากหน้า Content Engine
// ─────────────────────────────────────────────────────────────────────────────

import { stripCompiledKeys, type CECompilableType } from '@/lib/ce-compiled-fields'
import { orChat, OR_MODELS } from '@/lib/openrouter'

export * from '@/lib/ce-compiled-fields'

const LAYER_BRIEF: Record<CECompilableType, string> = {
  CE_BUSINESS_SKILL: `ชั้นนี้คือ "Business Skill" — ความรู้เรื่องธุรกิจและกติกาการพูดถึงแบรนด์
ผลลัพธ์ต้องอ่านแล้วรู้ทันทีว่าธุรกิจนี้ทำอะไร ขายใคร พูดอะไรได้ พูดอะไรไม่ได้
ส่วน Approved Claims / Prohibited Claims / Compliance ต้องคงข้อความเดิมแบบคำต่อคำ ห้ามเรียบเรียงใหม่ ห้ามตัดทิ้ง`,
  CE_MASTER_PROMPT: `ชั้นนี้คือ "Master Prompt" — คำสั่งหลักที่กำหนดบทบาท วิธีเขียน และรูปแบบผลลัพธ์
ผลลัพธ์ต้องเป็นคำสั่งตรง ๆ ถึงนักเขียน AI เริ่มด้วยการกำหนดบทบาท แล้วไล่เป็นข้อกำหนดการเขียน ข้อห้าม และรูปแบบ output`,
  CE_ARTICLE_BRIEF: `ชั้นนี้คือ "Article Brief" — โจทย์ของบทความแต่ละชิ้น
ผลลัพธ์ต้องบอกชัดว่าบทความต้องครอบคลุมอะไร ตอบ search intent แบบไหน โครงสร้างประมาณไหน และต้องมี SEO/AEO/GEO อะไรบ้าง`,
  CE_VALIDATOR_PACK: `ชั้นนี้คือ "Validator Pack" — เกณฑ์ตรวจงานก่อนส่ง
ผลลัพธ์ต้องเป็นเช็กลิสต์ที่นักเขียนใช้ตรวจตัวเองได้ ระบุชัดว่าข้อไหนไม่ผ่านแล้วห้ามส่งงาน (BLOCKING)
คงเกณฑ์ตัวเลข (คะแนนผ่าน/เตือน) ไว้ตามเดิมทุกตัว`,
}

const COMPILER_SYSTEM = `คุณคือ Prompt Engineer ที่แปลง "คำตอบจากแบบฟอร์ม" ให้เป็น "prompt ใช้งานจริง"

งานของคุณ: รับ JSON ที่ทีมกรอกไว้ แล้วเรียบเรียงเป็น prompt ภาษาไทยที่อ่านรู้เรื่อง
เหมือน prompt ที่คนเขียนเองแล้ววางลงในช่อง ไม่ใช่รายการ key: value

กฎเหล็ก
1. ห้ามเพิ่มข้อเท็จจริงที่ไม่มีใน JSON เด็ดขาด ห้ามเดา ห้ามยกตัวอย่างที่ทีมไม่ได้ให้มา
2. ห้ามตัดข้อมูลทิ้ง ทุกค่าที่มีใน JSON ต้องปรากฏในผลลัพธ์ในรูปใดรูปหนึ่ง
3. ตัวเลข ชื่อแบรนด์ ชื่อสินค้า URL ข้อความ claim และข้อห้าม ต้องคงคำเดิมเป๊ะ
4. ฟิลด์ที่ว่างให้ข้ามไปเงียบ ๆ ห้ามเขียนว่า "ไม่ระบุ"
5. เขียนเป็นคำสั่ง/ข้อกำหนดที่ AI นักเขียนทำตามได้ทันที ใช้หัวข้อและ bullet ได้
6. ตอบกลับเป็นตัว prompt อย่างเดียว ห้ามมีคำนำ ห้ามมีคำอธิบาย ห้ามครอบ code fence
7. ภาษาไทยเป็นหลัก ศัพท์เทคนิค SEO/AEO/GEO คงภาษาอังกฤษไว้`

export interface CECompileResult {
  text: string
  model: string
}

/**
 * เรียบเรียง JSON จากฟอร์มเป็น prompt เต็ม
 * โยน error เมื่อ LLM ล้ม — ผู้เรียกตัดสินใจเองว่าจะบันทึกต่อโดยไม่มี compiled หรือไม่
 */
export async function compileCePrompt(params: {
  type: CECompilableType
  data: Record<string, unknown>
  /** ชื่อ layer ใช้ประกอบบริบทให้โมเดล */
  name?: string
  client?: string
}): Promise<CECompileResult> {
  const clean = stripCompiledKeys(params.data)
  const model = process.env.OPENROUTER_MODEL_CE_COMPILE || OR_MODELS.writer()

  const user = [
    LAYER_BRIEF[params.type],
    params.name ? `ชื่อชั้นนี้: ${params.name}` : '',
    '',
    'คำตอบจากแบบฟอร์ม (JSON):',
    JSON.stringify(clean, null, 2),
    '',
    'เรียบเรียงเป็น prompt ใช้งานจริงตามกฎเหล็กทั้งหมด',
  ]
    .filter(Boolean)
    .join('\n')

  const res = await orChat({
    trace: 'ce_prompt_compile',
    client: params.client,
    model,
    temperature: 0.3,
    maxTokens: 8000,
    timeoutMs: 180_000,
    messages: [
      { role: 'system', content: COMPILER_SYSTEM },
      { role: 'user', content: user },
    ],
  })

  const text = stripFence(res.text).trim()
  if (!text) throw new Error('compiler ตอบว่าง')
  return { text, model }
}

/** ตัด code fence ที่บางโมเดลชอบครอบมาให้ */
function stripFence(v: string): string {
  const m = v.trim().match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/)
  return m ? m[1] : v
}
