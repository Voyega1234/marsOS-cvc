/**
 * Mars SEO News Digest — สรุปข่าว SEO ประจำวันสำหรับทีม (ภาษาไทย)
 *
 * อ่านเนื้อข่าวจริง (excerpt จาก RSS) แล้วให้ AI สรุปว่า "วันนี้มีอะไรอัพเดตบ้าง"
 * — ไม่ใช่แค่หัวข้อ · แคชผลรายวันใน AppSetting (regenerate เมื่อขึ้นวันใหม่ หรือ ?refresh=1)
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildNewsResponse, type NewsItem } from '@/lib/marsNews'
import { orChat, OR_MODELS } from '@/lib/openrouter'

export const maxDuration = 120

const SETTING_KEY = 'mars_news_digest'

interface DigestPoint {
  summary: string
  sources: Array<{ title: string; url: string; source: string }>
}

interface DigestSection {
  title: string
  points: DigestPoint[]
}

interface MarsNewsDigest {
  dateKey: string // YYYY-MM-DD (เวลาไทย)
  generatedAt: string
  intro: string
  sections: DigestSection[]
}

function bangkokDateKey(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date())
}

async function generateDigest(items: NewsItem[]): Promise<Omit<MarsNewsDigest, 'dateKey' | 'generatedAt'>> {
  // เอาข่าวใหม่สุด ~28 ชิ้น (เน้น 72 ชม.ล่าสุด) พร้อมเนื้อย่อ
  const cutoff = Date.now() - 72 * 3600_000
  const fresh = items.filter(i => new Date(i.publishedAt).getTime() >= cutoff)
  const pool = (fresh.length >= 8 ? fresh : items).slice(0, 28)

  const numbered = pool.map((it, i) =>
    `[${i + 1}] (${it.category} · ${it.source}) ${it.title}${it.excerpt ? `\nเนื้อย่อ: ${it.excerpt}` : ''}`
  ).join('\n\n')

  const prompt = `คุณคือบรรณาธิการข่าว SEO ของทีมการตลาด สรุป "อัพเดตวงการ SEO วันนี้" เป็นภาษาไทยจากข่าวด้านล่าง สำหรับให้ทีมอ่านตอนเช้า

กติกา:
- สรุปจากเนื้อข่าวจริงเท่านั้น ห้ามเดาหรือแต่งข้อมูลเพิ่ม
- จัดกลุ่มเป็นหมวด (เช่น Google Algorithm/ฟีเจอร์ Search, AI Search, เครื่องมือ SEO, อื่นๆ) เฉพาะหมวดที่มีข่าวจริง
- แต่ละประเด็นสรุป 1-3 ประโยค บอกใจความว่าเกิดอะไรขึ้นและมีผลกับคนทำ SEO ยังไง
- ประเด็นเดียวกันจากหลายสำนักข่าวให้รวมเป็นข้อเดียว
- อ้างอิงข่าวด้วยเลขในวงเล็บเหลี่ยม เช่น [3] หรือ [3,7]
- เขียน intro 1-2 ประโยคสรุปภาพรวมของวัน

ตอบเป็น JSON เท่านั้น รูปแบบ:
{"intro":"...","sections":[{"title":"...","points":[{"summary":"...","refs":[1,2]}]}]}

ข่าววันนี้:
${numbered}`

  type ParsedDigest = {
    intro?: string
    sections?: Array<{ title?: string; points?: Array<{ summary?: string; refs?: number[] }> }>
  }

  // JSON จากโมเดลเพี้ยนได้ (trailing comma / โค้ดเฟนซ์) — ซ่อมก่อน แล้วค่อย retry อีกรอบ
  const tryParse = (text: string): ParsedDigest | null => {
    const m = text.replace(/```(?:json)?/g, '').match(/\{[\s\S]*\}/)
    if (!m) return null
    const candidates = [m[0], m[0].replace(/,\s*([\]}])/g, '$1')]
    for (const c of candidates) {
      try { return JSON.parse(c) as ParsedDigest } catch { /* next */ }
    }
    return null
  }

  let parsed: ParsedDigest | null = null
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    try {
      const result = await orChat({
        trace: 'mars_news_digest',
        model: OR_MODELS.default(),
        maxTokens: 3000,
        jsonMode: true,
        messages: [{ role: 'user', content: prompt }],
      })
      parsed = tryParse(result.text)
    } catch {
      // ตอบว่าง/พังชั่วคราว — ปล่อยให้ลูป retry รอบถัดไป (เดิม orChat คืน '' ลูปจึงวนได้เอง)
    }
  }
  if (!parsed) throw new Error('AI ไม่คืน JSON สรุปข่าวที่อ่านได้')

  const sections: DigestSection[] = (parsed.sections ?? [])
    .map(sec => ({
      title: String(sec.title ?? '').trim(),
      points: (sec.points ?? [])
        .map(pt => ({
          summary: String(pt.summary ?? '').trim(),
          sources: (Array.isArray(pt.refs) ? pt.refs : [])
            .map(n => pool[n - 1])
            .filter(Boolean)
            .slice(0, 4)
            .map(it => ({ title: it.title, url: it.url, source: it.source })),
        }))
        .filter(pt => pt.summary),
    }))
    .filter(sec => sec.title && sec.points.length > 0)

  if (sections.length === 0) throw new Error('AI สรุปข่าวไม่สำเร็จ (ไม่มีหมวดข่าว)')
  return { intro: String(parsed.intro ?? '').trim(), sections }
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const forceRefresh = new URL(req.url).searchParams.get('refresh') === '1'
  const dateKey = bangkokDateKey()

  // แคชรายวันใน AppSetting — รอดข้าม restart/instance
  if (!forceRefresh) {
    try {
      const row = await prisma.appSetting.findUnique({ where: { key: SETTING_KEY } })
      if (row) {
        const cached = JSON.parse(row.value) as MarsNewsDigest
        if (cached.dateKey === dateKey && cached.sections?.length) {
          return NextResponse.json(cached)
        }
      }
    } catch { /* regenerate */ }
  }

  try {
    const news = await buildNewsResponse()
    if (news.items.length === 0) {
      return NextResponse.json({ error: 'ดึงข่าวไม่ได้ในขณะนี้ — ลองใหม่อีกครั้ง' }, { status: 502 })
    }
    const digestBody = await generateDigest(news.items)
    const digest: MarsNewsDigest = {
      dateKey,
      generatedAt: new Date().toISOString(),
      ...digestBody,
    }
    await prisma.appSetting.upsert({
      where: { key: SETTING_KEY },
      create: { key: SETTING_KEY, value: JSON.stringify(digest) },
      update: { value: JSON.stringify(digest) },
    }).catch(() => {})
    return NextResponse.json(digest)
  } catch (e) {
    return NextResponse.json({ error: `สรุปข่าวไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 })
  }
}
