import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { checkCredentialUrl } from '@/lib/upload-article/safe-fetch'
import { normalizeSavedWpUrl, testWordPressConnection } from '@/lib/upload-article/wp-push'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({})) as { siteUrl?: unknown; username?: unknown; appPassword?: unknown }
  const siteUrl = normalizeSavedWpUrl(typeof body.siteUrl === 'string' ? body.siteUrl : '')
  const username = typeof body.username === 'string' ? body.username.trim() : ''
  const appPassword = typeof body.appPassword === 'string' ? body.appPassword.trim() : ''
  if (!siteUrl || !username || !appPassword) {
    return NextResponse.json({ error: 'กรุณากรอก URL, Username และ Application Password ให้ครบ' }, { status: 400 })
  }

  const urlErr = await checkCredentialUrl(siteUrl)
  if (urlErr) return NextResponse.json({ error: urlErr }, { status: 400 })

  const result = await testWordPressConnection(siteUrl, username, appPassword)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true, name: result.name ?? username })
}
