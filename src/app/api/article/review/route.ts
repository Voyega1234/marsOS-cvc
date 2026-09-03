import { NextRequest, NextResponse } from 'next/server'
import { orChat, OR_MODELS } from '@/lib/openrouter'
import { clientSlugForProject } from '@/lib/orClient'
import { getSession } from '@/lib/auth'
import { logAIJob } from '@/lib/logAIJob'
import { resolveContentEngine, type CEScope } from '@/lib/content-engine-resolve'

// AI ทั้งระบบผ่าน OpenRouter — จุดนี้อยู่กลุ่ม "จุดอื่น ๆ" = MODEL_DEFAULT (gemini-3.7-flash)


/**
 * โครงสร้าง JSON ที่ UI ต้องการ — เป็น API contract ไม่ใช่ prompt
 * เกณฑ์การตรวจทั้งหมดมาจาก Validator Pack ใน Content Engine เท่านั้น
 */
const OUTPUT_CONTRACT = `
==================================================
OUTPUT FORMAT (บังคับ — ระบบ parse ค่านี้ไปแสดงผล)
==================================================
ตอบกลับเป็น JSON เท่านั้น ห้ามมี markdown fence ห้ามมีคำอธิบายนอก JSON:
{
  "suggestions": [{"id":"s1","category":"SEO","priority":"High","title":"...","description":"...","applied":false}],
  "links": [{"id":"l1","anchor":"...","url":"/path","reason":"...","added":false}]
}

category ต้องเป็นหนึ่งใน: SEO, E-E-A-T, Readability, Conversion
priority ต้องเป็นหนึ่งใน: High, Medium, Low
ให้ suggestions 4-8 ข้อ และ internal link opportunities 3-5 ข้อ
ข้อความทั้งหมดเป็นภาษาไทย`

export async function POST(req: NextRequest) {
  const session = await getSession()
  const orgId  = session?.user?.organizationId ?? null
  const userId = session?.user?.id ?? null

  try {
    const { content, siteUrl = '', articleId, projectId } = await req.json()
    if (!content?.trim()) return NextResponse.json({ error: 'No content provided' }, { status: 400 })
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const model = OR_MODELS.default()

    // ── เกณฑ์ตรวจบทความมาจาก Content Engine ของ scope นั้นเท่านั้น ──
    // ห้ามมี fallback ในไฟล์, ห้าม hardcode, ห้ามดึงข้าม scope (กติกาเดียวกับ /api/article/write)
    const ceScope: CEScope = projectId ? { projectId } : 'studio'
    const ce = await resolveContentEngine(orgId, ceScope)
    if (!ce.validatorPack) {
      const where = ce.scope === 'studio' ? 'ของ Studio' : 'ของโปรเจกต์นี้'
      const setAt = ce.scope === 'studio' ? ' Studio > Content Engine' : ' ฟันเฟือง > Content Engine ของโปรเจกต์'
      return NextResponse.json({
        error: 'CONTENT_ENGINE_NOT_CONFIGURED',
        missing: ['Validator Pack'],
        message: `ยังไม่ได้ตั้งค่า Content Engine (${where}) — ขาด: Validator Pack · ตั้งค่าที่${setAt}`,
        suggestions: [], links: [],
      }, { status: 400 })
    }

    const ceBlocks = [
      ce.businessSkill && `==================================================\nBUSINESS SKILL (บริบทธุรกิจ — ใช้ตัดสินว่า claim ไหนเขียนได้)\n==================================================\n${ce.businessSkill.text}`,
      ce.articleBrief && `==================================================\nARTICLE BRIEF (เกณฑ์เนื้อหาที่บทความนี้ต้องครอบคลุม)\n==================================================\n${ce.articleBrief.text}`,
      `==================================================\nVALIDATOR PACK (เกณฑ์ตรวจ — ใช้ชุดนี้เป็นหลักในการให้ suggestion)\n==================================================\n${ce.validatorPack.text}`,
    ].filter(Boolean).join('\n\n')

    const prompt = `${ceBlocks}

==================================================
ARTICLE TO REVIEW
==================================================
${content.slice(0, 8000)}
${siteUrl ? `\nSite URL: ${siteUrl}` : ''}
${OUTPUT_CONTRACT}`

    // 2000 ไม่พอแล้วหลังต่อ Content Engine เข้ามา (suggestion ภาษาไทยกินโทเคนเยอะ)
    // ตอบไม่จบ → JSON ขาดกลาง → parse ไม่ผ่าน
    const message = await orChat({
      trace: 'article_review',
      client: await clientSlugForProject(projectId),
      model,
      maxTokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    })

    // Log cost
    if (orgId && userId) {
      const totalTokens  = message.usage.totalTokens
      const cost = message.usage.costUsd
      logAIJob({
        organizationId: orgId, createdById: userId,
        projectId: projectId ?? null, articleId: articleId ?? null,
        jobType: 'SEO_REVIEW', modelProvider: 'OPENROUTER', modelName: model,
        status: 'SUCCESS', tokenUsed: totalTokens, estimatedCost: cost,
        inputSummary: `SEO Review — ${content.slice(0, 80)}...`,
      }).catch(() => {})
    }

    const raw = message.text
    const parsed = parseReviewJson(raw)
    if (!parsed) {
      return NextResponse.json({
        error: 'REVIEW_PARSE_FAILED',
        message: 'โมเดลตอบกลับไม่เป็น JSON ที่อ่านได้ — ลองรีวิวใหม่อีกครั้ง',
        suggestions: [], links: [],
      }, { status: 502 })
    }
    return NextResponse.json({
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      links: Array.isArray(parsed.links) ? parsed.links : [],
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e), suggestions: [], links: [] }, { status: 500 })
  }
}

/**
 * แกะ JSON จากคำตอบของโมเดล
 *
 * ถ้าคำตอบถูกตัดกลางคัน (ชน max_tokens) JSON จะไม่ปิดวงเล็บ — parse ตรง ๆ พัง
 * จึงลองปิดวงเล็บที่ค้างให้ แล้วตัด element สุดท้ายที่ไม่สมบูรณ์ทิ้ง
 * ได้ suggestion เท่าที่โมเดลเขียนจบดีกว่าคืนค่าว่างทั้งหมด
 */
function parseReviewJson(raw: string): { suggestions?: unknown; links?: unknown } | null {
  const start = raw.indexOf('{')
  if (start < 0) return null
  const body = raw.slice(start)

  const attempt = (text: string) => {
    try { return JSON.parse(text) } catch { return null }
  }

  const direct = attempt(body.slice(0, body.lastIndexOf('}') + 1))
  if (direct) return direct

  // ไล่ปิดโครงสร้างที่ค้างอยู่ โดยไม่นับวงเล็บที่อยู่ใน string
  let depthCurly = 0, depthSquare = 0, inString = false, escaped = false
  let lastSafe = -1
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (escaped) { escaped = false; continue }
    if (ch === '\\') { escaped = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') depthCurly++
    else if (ch === '}') depthCurly--
    else if (ch === '[') depthSquare++
    else if (ch === ']') depthSquare--
    // จบ element ของ array ตัวหนึ่งพอดี — ตัดตรงนี้ได้อย่างปลอดภัย
    if (ch === '}' && depthCurly === 2 && depthSquare === 1) lastSafe = i
  }
  if (lastSafe < 0) return null

  const truncated = body.slice(0, lastSafe + 1)
  // ปิด array และ object ที่ยังค้าง (นับใหม่จากข้อความที่ตัดแล้ว)
  let c = 0, s = 0, str = false, esc = false
  for (const ch of truncated) {
    if (esc) { esc = false; continue }
    if (ch === '\\') { esc = true; continue }
    if (ch === '"') { str = !str; continue }
    if (str) continue
    if (ch === '{') c++; else if (ch === '}') c--
    else if (ch === '[') s++; else if (ch === ']') s--
  }
  return attempt(truncated + ']'.repeat(Math.max(0, s)) + '}'.repeat(Math.max(0, c)))
}
