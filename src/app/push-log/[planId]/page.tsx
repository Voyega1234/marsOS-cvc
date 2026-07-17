'use client'

import AppShell from '@/components/layout/AppShell'
import PushLogTimeline from '@/components/push/PushLogTimeline'
import PushStatusBadge from '@/components/push/PushStatusBadge'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { PushResult } from '@/types'
import { Loader, Send, AlertTriangle, RotateCcw, PauseCircle, Trash2, ShieldAlert, X, CheckCircle2 } from 'lucide-react'
import { AccountSelect } from '@/components/ui/AccountSelect'

interface AdAccount {
  id: string
  name: string
}

export default function PushLogPage() {
  const params = useParams()
  const planId = params.planId as string
  const [pushResult, setPushResult] = useState<PushResult | null>(null)
  const [blueprintId, setBlueprintId] = useState<string | null>(null)
  const [pushing, setPushing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [customerId, setCustomerId] = useState('')
  const [adAccounts, setAdAccounts] = useState<AdAccount[]>([])
  const [mode, setMode] = useState<'PAUSED' | 'ENABLED'>('PAUSED')
  const [error, setError] = useState<string | null>(null)
  const [rollbackLoading, setRollbackLoading] = useState(false)
  const [rollbackResult, setRollbackResult] = useState<{ paused: number; failed: number } | null>(null)
  const [showRollbackConfirm, setShowRollbackConfirm] = useState(false)

  useEffect(() => {
    fetchBlueprint()
    fetchAccounts()
  }, [planId])

  async function fetchAccounts() {
    try {
      const res = await fetch('/api/clients')
      if (res.ok) {
        const data = await res.json()
        const accounts: AdAccount[] = (data.accounts ?? data ?? []).map((a: Record<string, string>) => ({
          id: a.id ?? a.customerId ?? '',
          name: a.name ?? a.descriptiveName ?? a.id ?? '',
        }))
        setAdAccounts(accounts)
        if (accounts.length > 0 && !customerId) {
          setCustomerId(accounts[0].id)
        }
      }
    } catch {}
  }

  async function fetchBlueprint() {
    try {
      const res = await fetch(`/api/campaign-blueprints/${planId}`)
      if (res.ok) {
        const data = await res.json()
        setBlueprintId(data.id)
        // Pre-select account from the brief linked to this plan
        if (data.brief?.googleAdsCustomerId) {
          setCustomerId(data.brief.googleAdsCustomerId)
        }
        if (data.pushJobs && data.pushJobs.length > 0) {
          const lastJob = data.pushJobs[0]
          if (lastJob.resultJson) {
            setPushResult(JSON.parse(lastJob.resultJson))
          }
        }
      }
    } catch {}
    setLoading(false)
  }

  async function rollbackCampaigns() {
    if (!pushResult || !customerId) return
    const resourceNames = pushResult.campaigns
      .filter(c => c.status === 'success' && c.resourceName)
      .map(c => c.resourceName!)
    if (resourceNames.length === 0) return
    setRollbackLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/google-ads/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId, resourceNames }),
      })
      const data = await res.json() as { paused?: number; failed?: number; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Rollback failed')
      setRollbackResult({ paused: data.paused ?? 0, failed: data.failed ?? 0 })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rollback failed')
    } finally {
      setRollbackLoading(false)
      setShowRollbackConfirm(false)
    }
  }

  async function pushNow() {
    if (!blueprintId || !customerId) return
    setPushing(true)
    setError(null)
    try {
      const res = await fetch('/api/google-ads/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blueprintId, customerId, mode }),
      })
      if (!res.ok) throw new Error('Push failed')
      const data = await res.json()
      setPushResult(data.result)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Push failed')
    } finally {
      setPushing(false)
    }
  }

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Push to Google Ads</h1>
          <p className="text-gray-500 mt-1">Push Campaign Blueprint ขึ้น Google Ads API</p>
        </div>
        {pushResult && <PushStatusBadge status={pushResult.status} />}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader className="w-8 h-8 text-blue-500 animate-spin" />
        </div>
      ) : !blueprintId ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
          <div className="text-5xl mb-4">⚠️</div>
          <h3 className="text-lg font-semibold text-gray-700 mb-2">ไม่พบ Campaign Blueprint</h3>
          <p className="text-gray-500">กรุณาสร้าง Campaign Blueprint ก่อน</p>
        </div>
      ) : (
        <div className="max-w-2xl space-y-6">
          {/* Push Settings */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-900 mb-4">Push Settings</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Google Ads Account <span className="text-red-500">*</span>
                </label>
                {adAccounts.length > 0 ? (
                  <AccountSelect
                    accounts={adAccounts}
                    value={customerId}
                    onChange={setCustomerId}
                    placeholder="-- เลือก Account --"
                    className={`w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                      !customerId ? 'border-red-300' : 'border-gray-300'
                    }`}
                  />
                ) : (
                  <input
                    value={customerId}
                    onChange={(e) => setCustomerId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="123-456-7890"
                  />
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Campaign Status หลัง Push</label>
                <div className="flex gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      checked={mode === 'PAUSED'}
                      onChange={() => setMode('PAUSED')}
                      className="text-blue-600"
                    />
                    <span className="text-sm text-gray-700">PAUSED (แนะนำ)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      checked={mode === 'ENABLED'}
                      onChange={() => setMode('ENABLED')}
                      className="text-blue-600"
                    />
                    <span className="text-sm text-gray-700">ENABLED (เปิดทันที)</span>
                  </label>
                </div>
              </div>

              {mode === 'ENABLED' && (
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-yellow-600 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-yellow-700">
                    ENABLED จะเริ่มใช้งบประมาณทันที กรุณาตรวจสอบ conversion tracking ก่อน
                  </p>
                </div>
              )}

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                  {error}
                </div>
              )}

              <button
                onClick={pushNow}
                disabled={pushing || !customerId}
                className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:bg-blue-400 transition-colors"
              >
                {pushing ? (
                  <>
                    <Loader className="w-4 h-4 animate-spin" />
                    กำลัง Push ขึ้น Google Ads...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Push to Google Ads
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Push Result */}
          {pushResult && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-900">Push Results</h2>
                <PushStatusBadge status={pushResult.status} />
              </div>
              <div className="flex gap-4 text-sm text-gray-600 mb-4">
                <span>Mode: <strong>{pushResult.mode}</strong></span>
                <span>Created: <strong>{pushResult.totalCreated}</strong></span>
                <span>Errors: <strong className={pushResult.totalErrors > 0 ? 'text-red-600' : ''}>{pushResult.totalErrors}</strong></span>
              </div>
              <PushLogTimeline
                campaigns={pushResult.campaigns}
                status={pushResult.status}
                startedAt={pushResult.startedAt}
                finishedAt={pushResult.finishedAt}
              />

              {/* Rollback Section */}
              {pushResult.totalCreated > 0 && !rollbackResult && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                    <RotateCcw className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-amber-900">ต้องการยกเลิก?</p>
                      <p className="text-xs text-amber-700 mt-0.5">
                        Pause campaigns ทั้ง {pushResult.totalCreated} แคมเปญที่เพิ่งสร้าง — campaigns จะถูก PAUSED ไม่มีการใช้งบโฆษณา
                      </p>
                    </div>
                    <button
                      onClick={() => setShowRollbackConfirm(true)}
                      disabled={rollbackLoading}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:bg-amber-300 transition-colors shrink-0"
                    >
                      <PauseCircle className="w-3.5 h-3.5" />
                      Pause All
                    </button>
                  </div>
                </div>
              )}

              {/* Rollback Result */}
              {rollbackResult && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-800">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    Paused {rollbackResult.paused} campaigns สำเร็จ
                    {rollbackResult.failed > 0 && (
                      <span className="text-red-600 ml-2">({rollbackResult.failed} ไม่สำเร็จ)</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Rollback Confirm Modal */}
          {showRollbackConfirm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
              <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full mx-4 overflow-hidden">
                <div className="bg-amber-50 border-b border-amber-100 px-5 py-4 flex items-center gap-3">
                  <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0" />
                  <h2 className="text-sm font-bold text-amber-900">ยืนยัน Pause Campaigns</h2>
                  <button onClick={() => setShowRollbackConfirm(false)} className="ml-auto text-amber-400 hover:text-amber-600">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="px-5 py-4 text-sm text-gray-700 space-y-2">
                  <p>จะ PAUSE campaigns ทั้งหมดที่เพิ่งสร้าง ({pushResult?.totalCreated} campaigns) ใน account <strong>{customerId}</strong></p>
                  <p className="text-xs text-gray-500">Campaigns จะถูก pause ไม่ถูกลบ สามารถ enable ใหม่ใน Google Ads ได้ตลอดเวลา</p>
                </div>
                <div className="px-5 pb-4 flex gap-2">
                  <button onClick={() => setShowRollbackConfirm(false)} className="flex-1 px-3 py-2 border border-gray-300 text-sm text-gray-700 rounded-lg hover:bg-gray-50">
                    ยกเลิก
                  </button>
                  <button onClick={rollbackCampaigns} disabled={rollbackLoading} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 disabled:bg-amber-300">
                    {rollbackLoading ? <Loader className="w-4 h-4 animate-spin" /> : <PauseCircle className="w-4 h-4" />}
                    Pause All
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </AppShell>
  )
}
