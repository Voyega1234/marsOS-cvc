import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { safeFetch, portAllowed } from '@/lib/upload-article/safe-fetch'
import { FONT_FILE_RE, MAX_FONT_BYTES, fontMimeFromBytes } from '@/lib/upload-article/font-faces'

/**
 * ส่งไฟล์ฟอนต์ของเว็บลูกค้าให้พรีวิวในระบบ — เบราว์เซอร์โหลดฟอนต์ข้ามโดเมนไม่ได้ถ้าเว็บนั้นไม่เปิด CORS
 * ต้อง login · https เท่านั้น · กัน SSRF ทุก hop · ตรวจชนิดไฟล์จากเนื้อไฟล์ ไม่เชื่อ header ปลายทาง
 * เราไม่เก็บไฟล์ฟอนต์ไว้ที่เซิร์ฟเวอร์
 */
// ข้อผิดพลาดทุกแบบหลังยิงออกไปใช้ข้อความเดียวกัน กันใช้เป็นตัวสอบถามพอร์ต/โฮสต์ภายใน
// แคชสั้น ๆ กันหน้าพรีวิวยิงไฟล์ที่พังซ้ำทุกครั้งที่ re-render
const ERR_HEADERS = { 'Cache-Control': 'private, max-age=300' }
const upstreamFail = () => NextResponse.json({ error: 'โหลดฟอนต์ไม่ได้' }, { status: 502, headers: ERR_HEADERS })

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const raw = req.nextUrl.searchParams.get('u') || ''
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return NextResponse.json({ error: 'URL ไม่ถูกต้อง' }, { status: 400 })
  }
  if (url.protocol !== 'https:' || url.username || url.password || !FONT_FILE_RE.test(url.pathname) || !portAllowed(url, true)) {
    return NextResponse.json({ error: 'รับเฉพาะไฟล์ฟอนต์ https' }, { status: 400, headers: ERR_HEADERS })
  }

  try {
    const res = await safeFetch(
      url.toString(),
      {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ArticlePreview/1.0)', Accept: 'font/woff2,font/woff,*/*;q=0.5', Referer: `${url.origin}/` },
        signal: AbortSignal.timeout(12_000),
      },
      { requireHttps: true, strictPorts: true },
    )
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => {})
      return upstreamFail()
    }
    if (Number(res.headers.get('content-length') || 0) > MAX_FONT_BYTES) {
      await res.body.cancel().catch(() => {})
      return upstreamFail()
    }

    // อ่านทีละก้อน หยุดทันทีเมื่อเกินเพดาน (content-length ปลอมได้)
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_FONT_BYTES) {
        await reader.cancel().catch(() => {})
        return upstreamFail()
      }
      chunks.push(value)
    }
    const body = new Uint8Array(size)
    let at = 0
    for (const c of chunks) {
      body.set(c, at)
      at += c.byteLength
    }

    const mime = fontMimeFromBytes(body)
    if (!mime) return upstreamFail()
    return new NextResponse(body, {
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'",
      },
    })
  } catch {
    return upstreamFail()
  }
}
