'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, RefreshCw, Settings, Wand2 } from 'lucide-react'

// แถบสถานะ "พร้อมเขียนบทความหรือยัง" — ตอบคำถามเดียว: กดปุ่มเขียนแล้วจะได้บทความไหม
// เช็คสองอย่างที่ทำให้เขียนไม่ได้จริงๆ: (1) ต่อ AI ได้ไหม (2) Content Engine มี layer active ครบไหม
// scope: projectId = ของโปรเจกต์นั้น, ไม่ส่ง = ของ Studio

export interface CeLayerStatus {
  type: string
  label: string
  required: boolean
  candidates: number
  isActive: boolean
  activeName: string | null
  activeVersion: number | null
  fixable: boolean
}

export interface CeStatus {
  scope: 'project' | 'studio'
  ready: boolean
  missing: string[]
  needsSetup: string[]
  fixable: string[]
  layers: CeLayerStatus[]
  ai: { claude: boolean; gemini: boolean; mode: string }
}

export function useContentEngineStatus(projectId?: string) {
  const [status, setStatus] = useState<CeStatus | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''
      const res = await fetch(`/api/content-engine/status${qs}`)
      if (res.ok) setStatus(await res.json())
      else setStatus(null)
    } catch { setStatus(null) }
    finally { setLoading(false) }
  }, [projectId])

  useEffect(() => { reload() }, [reload])

  return { status, loading, reload }
}

export default function ContentEngineReadyBar({
  projectId, onOpenSettings, status, loading, reload, compact = false,
}: {
  projectId?: string
  onOpenSettings?: () => void
  status: CeStatus | null
  loading: boolean
  reload: () => void
  compact?: boolean
}) {
  const [fixing, setFixing] = useState(false)

  async function autoActivate() {
    setFixing(true)
    try {
      const res = await fetch('/api/content-engine/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'auto-activate', ...(projectId ? { projectId } : {}) }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data.activated?.length) toast.success(`เปิดใช้งานแล้ว ${data.activated.length} layer`)
      else toast.info('ไม่มี layer ที่เปิดให้อัตโนมัติได้ — ต้องสร้างชุดก่อน')
      reload()
    } catch { toast.error('เปิดใช้งานอัตโนมัติไม่สำเร็จ') }
    finally { setFixing(false) }
  }

  if (loading && !status) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-xs text-gray-400">
        <RefreshCw size={12} className="animate-spin" /> ตรวจสถานะ AI และ Content Engine...
      </div>
    )
  }
  if (!status) return null

  const aiOk = status.ai.claude && status.ai.gemini
  const allOk = aiOk && status.ready

  // พร้อมทุกอย่าง + โหมด compact → แถบเขียวบางๆ ไม่กินที่
  if (allOk && compact) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-[11px] text-emerald-700">
        <CheckCircle2 size={13} className="shrink-0" />
        <span className="font-semibold">พร้อมเขียนบทความ</span>
        <span className="text-emerald-600/70">
          AI ({status.ai.mode.toUpperCase()}) ✓ · Content Engine ครบ {status.layers.filter(l => l.isActive).length} layer
        </span>
        {onOpenSettings && (
          <button onClick={onOpenSettings} className="ml-auto flex items-center gap-1 text-emerald-700 hover:text-emerald-900 font-semibold">
            <Settings size={11} /> Content Engine
          </button>
        )}
      </div>
    )
  }

  return (
    <div className={`rounded-2xl border px-4 py-3 space-y-2.5 ${allOk ? 'border-emerald-200 bg-emerald-50' : 'border-amber-300 bg-amber-50'}`}>
      <div className="flex items-start gap-2 flex-wrap">
        {allOk
          ? <CheckCircle2 size={15} className="text-emerald-600 shrink-0 mt-0.5" />
          : <AlertTriangle size={15} className="text-amber-500 shrink-0 mt-0.5" />}
        <div className="flex-1 min-w-[200px]">
          <p className={`text-xs font-bold ${allOk ? 'text-emerald-800' : 'text-amber-800'}`}>
            {allOk
              ? 'พร้อมเขียนบทความ'
              : !aiOk
                ? 'ยังต่อ AI ไม่ได้ — กดเขียนแล้วจะไม่สำเร็จ'
                : `ยังเขียนบทความไม่ได้ — Content Engine (${status.scope === 'studio' ? 'Studio' : 'โปรเจกต์นี้'}) ขาด: ${status.missing.join(', ')}`}
          </p>
          {!allOk && status.needsSetup.length > 0 && (
            <p className="text-[11px] text-amber-700 mt-0.5">
              ต้องสร้างชุดเองก่อน: <strong>{status.needsSetup.join(', ')}</strong>
            </p>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {status.fixable.length > 0 && (
            <button onClick={autoActivate} disabled={fixing}
              className="flex items-center gap-1.5 text-[11px] font-semibold text-white bg-amber-600 hover:bg-amber-500 disabled:opacity-40 px-3 py-1.5 rounded-lg transition-colors">
              {fixing ? <RefreshCw size={11} className="animate-spin" /> : <Wand2 size={11} />}
              เปิดใช้งานอัตโนมัติ ({status.fixable.length})
            </button>
          )}
          {onOpenSettings && (
            <button onClick={onOpenSettings}
              className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-700 bg-white hover:bg-gray-50 border border-gray-200 px-3 py-1.5 rounded-lg transition-colors">
              <Settings size={11} /> ตั้งค่า Content Engine
            </button>
          )}
          <button onClick={reload} title="ตรวจใหม่"
            className="p-1.5 rounded-lg border border-gray-200 bg-white text-gray-400 hover:text-gray-700 transition-colors">
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* chips: AI + แต่ละ layer พร้อมชื่อชุดที่ Active */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <Chip ok={status.ai.claude} label={`AI Writer ${status.ai.claude ? '' : '(ไม่มี API key)'}`} />
        <Chip ok={status.ai.gemini} label={`AI · ${status.ai.mode.toUpperCase()}`} />
        <span className="w-px h-4 bg-gray-300 mx-0.5" />
        {status.layers.map(l => (
          <Chip
            key={l.type}
            ok={l.isActive}
            dim={!l.required && !l.isActive}
            label={l.isActive ? `${l.label}: ${l.activeName ?? ''} v${l.activeVersion ?? 1}` : `${l.label}${l.required ? '' : ' (ไม่บังคับ)'}`}
          />
        ))}
      </div>
    </div>
  )
}

function Chip({ ok, label, dim = false }: { ok: boolean; label: string; dim?: boolean }) {
  const cls = ok
    ? 'bg-white text-emerald-700 border-emerald-200'
    : dim
      ? 'bg-white text-gray-400 border-gray-200'
      : 'bg-white text-red-600 border-red-200'
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-lg border max-w-[280px] truncate ${cls}`} title={label}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ok ? 'bg-emerald-500' : dim ? 'bg-gray-300' : 'bg-red-400'}`} />
      <span className="truncate">{label}</span>
    </span>
  )
}
