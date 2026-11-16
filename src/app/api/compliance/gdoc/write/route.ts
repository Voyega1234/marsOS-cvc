import { NextRequest, NextResponse } from 'next/server'
import { Readable } from 'node:stream'
import { google } from 'googleapis'
import { getDriveServiceAuth, getServiceIdentity } from '@/lib/google-auth'
import { errMsg, requireStaff } from '@/lib/compliance/server'
import { DOCX_MIME, GDOC_MAX_BYTES, GDOC_TOO_BIG, gdocErrorMessage } from '@/lib/compliance/gdoc'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const FILE_ID_RE = /^[A-Za-z0-9_-]{20,}$/

async function serviceEmailSafe(): Promise<string> {
  try {
    return (await getServiceIdentity()).email
  } catch {
    return ''
  }
}

/** เขียน .docx (Track Changes + Comment) ทับ Google Doc เดิม — Drive แปลงเป็น Suggesting + comment, ฉบับเก่าอยู่ใน Version history */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireStaff()
    if (ctx instanceof NextResponse) return ctx
    const body = (await req.json().catch(() => ({}))) as { fileId?: unknown; expectedVersion?: unknown; docxBase64?: unknown }
    const fileId = typeof body.fileId === 'string' ? body.fileId : ''
    const expectedVersion = body.expectedVersion == null ? '' : String(body.expectedVersion)
    if (!FILE_ID_RE.test(fileId) || !expectedVersion || typeof body.docxBase64 !== 'string' || !body.docxBase64) {
      return NextResponse.json({ error: 'ข้อมูลไม่ครบ' }, { status: 400 })
    }
    if (body.docxBase64.length > Math.ceil(GDOC_MAX_BYTES * 4 / 3) + 8) {
      return NextResponse.json({ error: GDOC_TOO_BIG }, { status: 413 })
    }
    const buf = Buffer.from(body.docxBase64, 'base64')
    if (buf.length === 0 || buf.length > GDOC_MAX_BYTES) {
      return NextResponse.json({ error: buf.length ? GDOC_TOO_BIG : 'ไฟล์ว่าง' }, { status: buf.length ? 413 : 400 })
    }
    if (buf[0] !== 0x50 || buf[1] !== 0x4b) return NextResponse.json({ error: 'ไฟล์ไม่ใช่ .docx' }, { status: 400 })

    const serviceEmail = await serviceEmailSafe()
    try {
      const drive = google.drive({ version: 'v3', auth: await getDriveServiceAuth() })
      const meta = await drive.files.get({ fileId, fields: 'id,version,capabilities(canEdit)', supportsAllDrives: true })
      if (meta.data.capabilities?.canEdit !== true) {
        return NextResponse.json({ error: `เขียนลง Google Doc ไม่ได้ — แชร์ไฟล์ให้ ${serviceEmail || 'service account'} เป็น Editor (ตอนนี้เป็นแค่ผู้ดู)`, serviceEmail }, { status: 403 })
      }
      if (String(meta.data.version ?? '') !== expectedVersion) {
        return NextResponse.json({ error: 'Google Doc ถูกแก้ไขหลังจากดึงมาตรวจ — ดึงใหม่แล้วตรวจอีกครั้ง' }, { status: 409 })
      }
      await drive.files.update({
        fileId,
        supportsAllDrives: true,
        media: { mimeType: DOCX_MIME, body: Readable.from(buf) },
      })
      const after = await drive.files.get({ fileId, fields: 'id,version,webViewLink', supportsAllDrives: true })
      return NextResponse.json({
        ok: true,
        version: String(after.data.version ?? ''),
        webViewLink: after.data.webViewLink ?? `https://docs.google.com/document/d/${fileId}/edit`,
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
