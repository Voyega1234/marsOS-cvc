// ─────────────────────────────────────────────────────────────────────────────
//  ฟิลด์ผล compile ของ Content Engine — ส่วนที่ไม่แตะ network
//  แยกจาก ce-compile.ts เพื่อให้ component ฝั่ง client import ได้โดยไม่ลาก
//  openrouter/prisma เข้าไปด้วย
// ─────────────────────────────────────────────────────────────────────────────

export const CE_COMPILED_KEY = '_compiledPrompt'
export const CE_COMPILED_AT_KEY = '_compiledAt'
export const CE_COMPILED_SOURCE_KEY = '_compiledFrom'

export type CECompilableType =
  | 'CE_BUSINESS_SKILL'
  | 'CE_MASTER_PROMPT'
  | 'CE_ARTICLE_BRIEF'
  | 'CE_VALIDATOR_PACK'

export const CE_COMPILABLE_TYPES: CECompilableType[] = [
  'CE_BUSINESS_SKILL',
  'CE_MASTER_PROMPT',
  'CE_ARTICLE_BRIEF',
  'CE_VALIDATOR_PACK',
]

export function isCompilableType(type: string): type is CECompilableType {
  return (CE_COMPILABLE_TYPES as string[]).includes(type)
}

/** JSON ที่ส่งให้ compiler ต้องไม่มีผล compile รอบก่อนปนอยู่ */
export function stripCompiledKeys(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) {
    if (k === CE_COMPILED_KEY || k === CE_COMPILED_AT_KEY || k === CE_COMPILED_SOURCE_KEY) continue
    out[k] = v
  }
  return out
}

/** ลายเซ็นของคำตอบฟอร์ม ใช้บอกว่า compiled ที่เก็บไว้ตรงกับฟอร์มปัจจุบันหรือยัง */
export function ceFormSignature(data: Record<string, unknown>): string {
  const clean = stripCompiledKeys(data)
  const json = JSON.stringify(clean, Object.keys(clean).sort())
  let h = 0
  for (let i = 0; i < json.length; i++) {
    h = (h * 31 + json.charCodeAt(i)) | 0
  }
  return String(h >>> 0)
}

/** ฝังผล compile กลับเข้า JSON เดิม */
export function withCompiled(
  data: Record<string, unknown>,
  compiled: string,
): Record<string, unknown> {
  return {
    ...data,
    [CE_COMPILED_KEY]: compiled,
    [CE_COMPILED_AT_KEY]: new Date().toISOString(),
    [CE_COMPILED_SOURCE_KEY]: ceFormSignature(data),
  }
}

/** ผล compile ที่เก็บไว้ — ไม่มีคืน null */
export function readCompiled(data: Record<string, unknown>): string | null {
  const v = data[CE_COMPILED_KEY]
  if (typeof v !== 'string' || !v.trim()) return null
  return v
}

/** compiled ที่เก็บไว้ล้าสมัยแล้วหรือยัง (ฟอร์มถูกแก้หลัง compile) */
export function isCompiledStale(data: Record<string, unknown>): boolean {
  if (!readCompiled(data)) return false
  const sig = data[CE_COMPILED_SOURCE_KEY]
  if (typeof sig !== 'string') return true
  return sig !== ceFormSignature(data)
}
