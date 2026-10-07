import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { orChat } from '@/lib/openrouter'
import { withOrClient, slugifyClient } from '@/lib/orClient'
import { UPLOAD_PLATFORM_LABEL, type UploadPlatformId } from '@/lib/upload-article/platform-info'
import { connectGuideText, redactSecrets } from '@/lib/upload-article/connect-guide'

export const maxDuration = 60

const PLATFORMS: UploadPlatformId[] = ['wordpress', 'webflow', 'wix', 'shopify', 'custom']
const FAIL_MSG = 'AI ช่วยไม่ได้ตอนนี้ — ลองดูวิธีเอาค่าด้านขวา'

function parseHelp(raw: string): { cause: string; steps: string[]; checkAgain: string } | null {
  let text = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const a = text.indexOf('{')
  const b = text.lastIndexOf('}')
  if (a >= 0 && b > a) text = text.slice(a, b + 1)
  try {
    const j = JSON.parse(text) as Record<string, unknown>
    const cause = typeof j.cause === 'string' ? j.cause.trim() : ''
    const steps = Array.isArray(j.steps) ? j.steps.filter((s): s is string => typeof s === 'string' && !!s.trim()).map(s => s.trim()) : []
    const checkAgain = typeof j.checkAgain === 'string' ? j.checkAgain.trim() : ''
    if (!cause && steps.length === 0) return null
    return { cause, steps, checkAgain }
  } catch {
    return null
  }
}

/** POST /api/upload-article/clients/[id]/connect-help — AI อธิบาย error ตอนเชื่อมต่อ/push เป็นภาษาคนทั่วไป (ไม่ส่ง secret ให้ AI) */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const client = await prisma.uploadClient.findFirst({ where: { id: params.id, organizationId: session.user.organizationId } })
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as {
    context?: string
    platform?: string
    error?: string
    filled?: Record<string, unknown>
    articleTitle?: string
  }
  const error = redactSecrets(typeof body.error === 'string' ? body.error : '')
  if (!error.trim()) return NextResponse.json({ error: 'ไม่มีข้อความ error' }, { status: 400 })
  const context = body.context === 'push' ? 'push' : 'connect'

  const fromClient = client.websitePlatform as UploadPlatformId
  const platform: UploadPlatformId = PLATFORMS.includes(body.platform as UploadPlatformId)
    ? (body.platform as UploadPlatformId)
    : PLATFORMS.includes(fromClient)
      ? fromClient
      : 'wordpress'
  const label = UPLOAD_PLATFORM_LABEL[platform]

  const filledLines = Object.entries(body.filled ?? {})
    .slice(0, 30)
    .map(([k, v]) => `- ${String(k).slice(0, 60)}: ${v === true ? 'กรอกแล้ว' : 'ยังว่าง'}`)
    .join('\n')
  const title = typeof body.articleTitle === 'string' ? redactSecrets(body.articleTitle, 200) : ''

  const system = `คุณเป็นผู้ช่วยซัพพอร์ตของทีมคอนเทนต์ที่ไม่ใช่สายเทคนิค กำลังเชื่อมต่อเว็บ ${label} เข้ากับ MarsOS
ใช้เฉพาะข้อมูลใน "คู่มือ" และ "error" ที่ให้เท่านั้น ห้ามเดาชื่อเมนูที่ไม่มีในคู่มือ ถ้าไม่แน่ใจให้บอกว่าควรเช็คอะไร
ตอบเป็น JSON เท่านั้น รูปแบบ {"cause": string, "steps": string[], "checkAgain": string}
- cause: สาเหตุที่น่าจะเป็น 1-2 ประโยค ภาษาไทย ใช้คำง่าย
- steps: วิธีแก้ทีละคลิก ใช้ชื่อเมนูตรงตามคู่มือ
- checkAgain: หลังแก้แล้วให้กดปุ่มอะไรใน MarsOS เพื่อเช็คอีกครั้ง`

  const user = `แพลตฟอร์ม: ${label}
สถานการณ์: ${context === 'push' ? 'Push บทความขึ้นเว็บไม่สำเร็จ' : 'ทดสอบการเชื่อมต่อไม่สำเร็จ'}
${title ? `บทความ: ${title}\n` : ''}ช่องที่กรอกแล้ว (ไม่แสดงค่า):
${filledLines || '- (ไม่มีข้อมูล)'}

error:
${error}

คู่มือ:
${connectGuideText(platform)}`

  try {
    const r = await withOrClient(`upload-${slugifyClient(client.name)}`, () =>
      orChat({
        trace: 'connect_help',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        maxTokens: 900,
        temperature: 0.2,
        jsonMode: true,
      }),
    )
    const parsed = parseHelp(r.text ?? '')
    if (!parsed) return NextResponse.json({ error: FAIL_MSG }, { status: 502 })
    return NextResponse.json(parsed)
  } catch {
    return NextResponse.json({ error: FAIL_MSG }, { status: 502 })
  }
}
