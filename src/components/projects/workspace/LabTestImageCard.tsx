'use client'

import { ImageIcon, Loader2, RefreshCw } from 'lucide-react'
import { useState } from 'react'

/** ผลจาก POST /api/article/cover (ส่วน meta เพิ่มมาเพื่อหน้านี้โดยเฉพาะ) */
interface CoverResponse {
  imageBase64: string
  mimeType: string
  type: 'cover' | 'mid'
  keyword: string
  title: string
  meta?: {
    model: string
    imagePrompt: { id: string; name: string; version: number }
    referenceImageCount: number
    logoAttached: boolean
    language: 'th' | 'en'
    costUsd: number
  }
}

interface TestResult {
  src: string
  /** นามสกุลไฟล์ตอนดาวน์โหลด — ตาม mimeType ที่เซิร์ฟเวอร์บีบอัดจริง (webp ปกติ, png/jpeg ถ้าบีบไม่ได้) */
  ext: string
  keyword: string
  title: string
  type: 'cover' | 'mid'
  meta: CoverResponse['meta'] | null
  elapsedMs: number
  at: Date
}

/**
 * หน้า Test Image ใน Article Lab — กดสร้างรูปจริงจาก Image Prompt ที่ Active ของโปรเจกต์
 * (พร้อมภาพอ้างอิงสูงสุด 5 ภาพ + โลโก้ที่ตั้งไว้ใน Content Engine) เพื่อดูว่ารูปออกมาตามแบบที่ต้องการไหม
 * ใช้ท่อเดียวกับตอนเขียนบทความจริง (POST /api/article/cover) ไม่มีทางลัด — สิ่งที่เห็นคือสิ่งที่บทความจะได้
 */
export function LabTestImageCard({ projectId, defaultKeyword = '' }: { projectId: string; defaultKeyword?: string }) {
  const [keyword, setKeyword] = useState(defaultKeyword)
  const [title, setTitle] = useState('')
  const [type, setType] = useState<'cover' | 'mid'>('cover')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<TestResult[]>([])

  async function generate() {
    const kw = keyword.trim()
    if (!kw) { setError('ใส่ keyword ก่อน'); return }
    setBusy(true)
    setError(null)
    const started = Date.now()
    try {
      const res = await fetch('/api/article/cover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          keyword: kw,
          // ไม่กรอก title = ใช้ keyword เป็นหัวเรื่อง (เหมือนตอน Image Prompt อ้าง {{title}} จากคีย์เวิร์ด)
          title: title.trim() || kw,
          type,
        }),
      })
      const data: Partial<CoverResponse> & { error?: string; message?: string } = await res.json().catch(() => ({}))
      if (!res.ok || !data.imageBase64) {
        setError(data.message || data.error || `สร้างรูปไม่สำเร็จ (HTTP ${res.status})`)
        return
      }
      const mime = data.mimeType || 'image/webp'
      setResults(prev => [{
        src: `data:${mime};base64,${data.imageBase64}`,
        ext: mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : 'webp',
        keyword: kw,
        title: title.trim() || kw,
        type,
        meta: data.meta ?? null,
        elapsedMs: Date.now() - started,
        at: new Date(),
      }, ...prev].slice(0, 6))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'สร้างรูปไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-purple-50 flex items-center justify-center shrink-0">
            <ImageIcon size={18} className="text-purple-600" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-900">Test Image — ลองสร้างรูปจาก Image Prompt</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              ใช้ Image Prompt ที่ Active ของโปรเจกต์นี้ + ภาพอ้างอิง/โลโก้ที่แนบไว้ใน Content Engine ผ่านท่อเดียวกับตอนเขียนบทความจริง
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-semibold text-gray-600">Keyword</span>
            <input
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              placeholder="เช่น คอนโดใกล้ BTS"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-600">Title <span className="font-normal text-gray-400">(ไม่ใส่ = ใช้ keyword)</span></span>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="หัวเรื่องที่จะขึ้นบนปก"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200"
            />
          </label>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            {(['cover', 'mid'] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                  type === t ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {t === 'cover' ? 'รูปปก (cover)' : 'รูปในบทความ (mid)'}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={generate}
            disabled={busy}
            className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 text-white text-sm font-semibold rounded-xl hover:bg-purple-700 disabled:opacity-50 transition-colors"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {busy ? 'กำลังสร้างรูป...' : 'สร้างรูปทดสอบ'}
          </button>
          <span className="text-[11px] text-gray-400">ใช้เวลาราว 30–90 วินาที และมีค่าใช้จ่ายเหมือนสร้างรูปจริง</span>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 whitespace-pre-wrap">{error}</div>
        )}
      </div>

      {results.map((r, i) => (
        <div key={`${r.at.getTime()}-${i}`} className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="flex flex-col lg:flex-row">
            <div className="lg:w-2/3 bg-gray-50 flex items-center justify-center p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.src} alt={r.title} className="max-w-full max-h-[520px] rounded-lg object-contain" />
            </div>
            <div className="lg:w-1/3 p-4 text-xs space-y-2">
              <div className="font-semibold text-gray-900 text-sm">{r.title}</div>
              <div className="text-gray-500">keyword: {r.keyword} · {r.type === 'cover' ? 'รูปปก' : 'รูปในบทความ'}</div>
              {r.meta ? (
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-gray-700 pt-1">
                  <dt className="text-gray-400">Image Prompt</dt>
                  <dd>{r.meta.imagePrompt.name} (v{r.meta.imagePrompt.version})</dd>
                  <dt className="text-gray-400">ภาพอ้างอิง</dt>
                  <dd>{r.meta.referenceImageCount} ภาพ{r.meta.logoAttached ? ' + โลโก้' : ''}</dd>
                  <dt className="text-gray-400">โมเดล</dt>
                  <dd className="font-mono">{r.meta.model}</dd>
                  <dt className="text-gray-400">ภาษาบนภาพ</dt>
                  <dd>{r.meta.language === 'en' ? 'อังกฤษ' : 'ไทย'}</dd>
                  <dt className="text-gray-400">ค่าใช้จ่าย</dt>
                  <dd>${r.meta.costUsd.toFixed(4)}</dd>
                </dl>
              ) : (
                <div className="text-gray-400">ไม่มีข้อมูล meta จากเซิร์ฟเวอร์</div>
              )}
              <div className="text-gray-400 pt-1">{Math.round(r.elapsedMs / 1000)} วินาที · {r.at.toLocaleTimeString('th-TH')}</div>
              {r.meta && r.meta.referenceImageCount === 0 && (
                <div className="rounded-md bg-amber-50 border border-amber-200 px-2 py-1.5 text-amber-800">
                  Image Prompt ชุดนี้ยังไม่มีภาพอ้างอิง — แนบได้สูงสุด 5 ภาพที่ Content Engine → Image Prompt
                </div>
              )}
              <a href={r.src} download={`test-${r.type}-${r.keyword}.${r.ext}`} className="inline-block text-purple-600 hover:underline pt-1">ดาวน์โหลดรูป</a>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
