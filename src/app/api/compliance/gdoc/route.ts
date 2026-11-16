import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { getDriveServiceAuth, getServiceIdentity } from '@/lib/google-auth'
import { errMsg, requireStaff } from '@/lib/compliance/server'
import { DOCX_MIME, GDOC_MAX_BYTES, GDOC_MIME, GDOC_TOO_BIG, gdocErrorMessage, parseGdocId } from '@/lib/compliance/gdoc'

export const dynamic = 'force-dynamic'

async function serviceEmailSafe(): Promise<string> {
  try {
    return (await getServiceIdentity()).email
  } catch {
    return ''
  }
}

/** อ่าน Google Doc (export เป็น .docx) ด้วย service account */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireStaff()
    if (ctx instanceof NextResponse) return ctx
    const body = (await req.json().catch(() => ({}))) as { url?: unknown }
    const fileId = typeof body.url === 'string' ? parseGdocId(body.url) : null
    if (!fileId) {
      return NextResponse.json({ error: 'ลิงก์ไม่ถูกต้อง — วางลิงก์ Google Docs (docs.google.com/document/d/...)' }, { status: 400 })
    }
    const serviceEmail = await serviceEmailSafe()
    try {
      const drive = google.drive({ version: 'v3', auth: await getDriveServiceAuth() })
      const meta = await drive.files.get({
        fileId,
        fields: 'id,name,mimeType,version,modifiedTime,capabilities(canEdit)',
        supportsAllDrives: true,
      })
      if (meta.data.mimeType !== GDOC_MIME) {
        return NextResponse.json({ error: 'ลิงก์นี้ไม่ใช่ Google Docs (ไฟล์ Word/PDF ที่อัปไว้ให้ใช้ตัวเลือก "ไฟล์ Word")', serviceEmail }, { status: 400 })
      }
      const exp = await drive.files.export({ fileId, mimeType: DOCX_MIME }, { responseType: 'arraybuffer' })
      const buf = Buffer.from(exp.data as ArrayBuffer)
      if (buf.length > GDOC_MAX_BYTES) return NextResponse.json({ error: GDOC_TOO_BIG, serviceEmail }, { status: 413 })
      return NextResponse.json({
        fileId,
        name: meta.data.name ?? 'Google Doc',
        version: String(meta.data.version ?? ''),
        canEdit: meta.data.capabilities?.canEdit === true,
        docxBase64: buf.toString('base64'),
        serviceEmail,
      })
    } catch (e) {
      const err = e as { code?: unknown; status?: unknown; response?: { status?: unknown } }
      const code = Number(err?.code ?? err?.status ?? err?.response?.status)
      return NextResponse.json({ error: gdocErrorMessage(e, serviceEmail), serviceEmail }, { status: code === 403 || code === 404 ? 403 : 502 })
    }
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 500 })
  }
}
