'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'

// LIFF entry page — the target behind https://liff.line.me/{liffId}?src=...
// Opens inside LINE, records the click + LINE userId via /api/liff/{slug},
// then forwards straight to the OA add-friend URL. The user just sees a brief
// spinner before LINE's add-friend screen.
//
// Fail-open by design: if ANYTHING here fails (SDK, token, our API), the user
// is still forwarded to the add-friend URL — tracking must never block an add.

interface LiffSdk {
  init(config: { liffId: string }): Promise<void>
  isLoggedIn(): boolean
  login(options?: { redirectUri?: string }): void
  getAccessToken(): string | null
}

declare global {
  interface Window { liff?: LiffSdk }
}

function loadLiffSdk(): Promise<LiffSdk> {
  return new Promise((resolve, reject) => {
    if (window.liff) { resolve(window.liff); return }
    const s = document.createElement('script')
    s.src = 'https://static.line-scdn.net/liff/edge/2/sdk.js'
    s.onload = () => window.liff ? resolve(window.liff) : reject(new Error('LIFF SDK not available'))
    s.onerror = () => reject(new Error('โหลด LIFF SDK ไม่สำเร็จ'))
    document.head.appendChild(s)
  })
}

export default function LiffEntryPage() {
  const params = useParams()
  const slug = String(params.projectSlug ?? '')
  const [message, setMessage] = useState('กำลังพาไปหน้าเพิ่มเพื่อน LINE…')
  const [failed, setFailed] = useState(false)
  const ran = useRef(false)

  useEffect(() => {
    if (!slug || ran.current) return
    ran.current = true

    let addFriendUrl = ''
    const forward = () => {
      if (addFriendUrl) window.location.replace(addFriendUrl)
      else {
        setFailed(true)
        setMessage('โปรเจกต์นี้ยังไม่ได้ตั้งค่า Add Friend URL — ติดต่อผู้ดูแลระบบ')
      }
    }

    ;(async () => {
      // 1) Project config (public: liffId + add-friend URL)
      const cfgRes = await fetch(`/api/liff/${encodeURIComponent(slug)}`)
      const cfg = await cfgRes.json() as { liffId?: string | null; addFriendUrl?: string | null; error?: string }
      if (!cfgRes.ok) throw new Error(cfg.error ?? 'project not found')
      addFriendUrl = cfg.addFriendUrl ?? ''
      if (!cfg.liffId) { forward(); return } // no LIFF configured — behave like a plain redirect

      // 2) LIFF init + login (inside LINE this is seamless)
      const liff = await loadLiffSdk()
      await liff.init({ liffId: cfg.liffId })
      if (!liff.isLoggedIn()) { liff.login({ redirectUri: window.location.href }); return }
      const accessToken = liff.getAccessToken()
      if (!accessToken) { forward(); return }

      // 3) Record click + stamp userId (server verifies the token with LINE)
      const query: Record<string, string> = {}
      new URLSearchParams(window.location.search).forEach((v, k) => { query[k] = v })
      try {
        const res = await fetch(`/api/liff/${encodeURIComponent(slug)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accessToken,
            query,
            landingUrl: window.location.href,
            referrer: document.referrer,
          }),
        })
        const data = await res.json() as { addFriendUrl?: string | null }
        if (data.addFriendUrl) addFriendUrl = data.addFriendUrl
      } catch { /* fail-open — still forward */ }

      forward()
    })().catch(() => {
      // SDK/init/network failure — never trap the user on this page.
      forward()
    })
  }, [slug])

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-lg">
        {!failed && (
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
        )}
        <p className="text-sm text-gray-600">{message}</p>
      </div>
    </main>
  )
}
