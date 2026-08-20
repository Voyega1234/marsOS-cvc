'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { RefreshCw, Plus, Trash2, ArrowRight, Sparkles, AlertTriangle, X, Search } from 'lucide-react'

import type { ProjectData, KeywordRow } from '@/components/projects/ClientDetailTabs'

// ─── Keyword Bank — คลัง keyword ถาวรของ project (DB — refresh ไม่หาย) ─────────
// รวม keyword จาก Keyword Research / Keywords Input / เพิ่มเองแบบ manual
// ตาราง Keyword ใน DB, ใช้ endpoint /api/keywords + /api/projects/[id]/keyword-bank

export interface BankKeyword {
  id: string
  projectId: string
  seedKeyword: string
  keyword: string
  relatedKeywords: string
  intent: string
  funnelStage: string
  priority: number
  volume: number | null
  difficulty: number | null
  status: string
  title: string | null
  meta: string
  createdAt: string
  updatedAt: string
}

const INTENT_OPTIONS = ['INFORMATIONAL', 'COMMERCIAL', 'TRANSACTIONAL', 'NAVIGATIONAL', 'UPDATE']
const FUNNEL_OPTIONS = ['TOFU', 'MOFU', 'BOFU']

const FUNNEL_COLOR: Record<string, string> = {
  TOFU: 'bg-blue-100 text-blue-700',
  MOFU: 'bg-amber-100 text-amber-700',
  BOFU: 'bg-red-100 text-red-700',
}

const SOURCE_LABEL: Record<string, string> = {
  'keyword-research': 'Keyword Research',
  'keywords-input': 'Keywords Input',
  manual: 'Manual',
}
const SOURCE_COLOR: Record<string, string> = {
  'Keyword Research': 'bg-blue-50 text-blue-700 border-blue-200',
  'Keywords Input': 'bg-purple-50 text-purple-700 border-purple-200',
  Manual: 'bg-gray-50 text-gray-600 border-gray-200',
}

function parseMeta(meta: string): Record<string, unknown> {
  try { return JSON.parse(meta || '{}') } catch { return {} }
}

function sourceLabel(row: BankKeyword): string {
  const meta = parseMeta(row.meta)
  const s = typeof meta.source === 'string' ? meta.source : undefined
  return SOURCE_LABEL[s ?? ''] ?? 'Manual'
}

/** แปลงแถวในคลัง → KeywordRow ที่ Content Map ใช้ (แหล่งเดียวของ Content Map) */
export function toKeywordRow(row: BankKeyword, idx: number): KeywordRow {
  const meta = parseMeta(row.meta)
  const opportunityScore = typeof meta.opportunity_score === 'number' ? meta.opportunity_score : row.priority
  const priorityLevel: 'high' | 'medium' | 'low' = opportunityScore >= 70 ? 'high' : opportunityScore >= 40 ? 'medium' : 'low'
  return {
    no: idx + 1,
    keyword: row.keyword,
    title: row.title || row.keyword,
    volume: row.volume ?? 0,
    intent: (row.intent || 'informational').toLowerCase(),
    keyword_type: (meta.keyword_type as string) || 'supporting_keyword',
    priority: priorityLevel,
    opportunity_score: opportunityScore,
    content_type: (meta.content_type as string) || 'article',
    page_type: meta.page_type as string | undefined,
    funnel: row.funnelStage || 'TOFU',
    traffic_score: meta.traffic_score as number | undefined,
    authority_score: meta.authority_score as number | undefined,
    lead_score: meta.lead_score as number | undefined,
    sales_score: meta.sales_score as number | undefined,
    retention_score: meta.retention_score as number | undefined,
    primary_objective: meta.primary_objective as string | undefined,
    secondary_objective: meta.secondary_objective as string | undefined,
    article_type: meta.article_type as string | undefined,
    notes: meta.notes as string | undefined,
  }
}

export default function KeywordBankTab({ project, onSendToContentMap, userRole = 'MEMBER' }: {
  project: ProjectData
  onSendToContentMap: (rows: KeywordRow[]) => void
  userRole?: string
}) {
  const isReadOnly = userRole === 'CLIENT'

  const [rows, setRows] = useState<BankKeyword[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const [search, setSearch] = useState('')
  const [filterIntent, setFilterIntent] = useState('All')
  const [filterFunnel, setFilterFunnel] = useState('All')

  // จำนวน keyword ที่จะส่งเข้า Content Map (ใช้เมื่อไม่ได้ติ๊กเลือกเอง) — Infinity = ทั้งหมด
  const [sendCount, setSendCount] = useState<number>(20)
  // เรียงตาม Volume จากหัวตาราง: none → desc → asc → none
  const [volSort, setVolSort] = useState<'none' | 'desc' | 'asc'>('none')

  const [editingCell, setEditingCell] = useState<{ id: string; field: 'keyword' | 'title' | 'volume' | 'priority' } | null>(null)
  const [editValue, setEditValue] = useState('')

  const [showAddForm, setShowAddForm] = useState(false)
  const [addKeyword, setAddKeyword] = useState('')
  const [addTitle, setAddTitle] = useState('')
  const [addVolume, setAddVolume] = useState('')
  const [addLoading, setAddLoading] = useState(false)

  const [dfsConfigured, setDfsConfigured] = useState<boolean | null>(null)
  const [dfsLoading, setDfsLoading] = useState(false)

  async function loadRows() {
    setLoading(true)
    try {
      const res = await fetch(`/api/keywords?projectId=${project.id}`)
      if (res.ok) setRows(await res.json())
    } catch { /* ignore — table stays empty, user can retry */ }
    finally { setLoading(false) }
  }

  useEffect(() => { loadRows() }, [project.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetch('/api/dataforseo/keywords')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setDfsConfigured(!!d.configured) })
      .catch(() => setDfsConfigured(false))
  }, [])

  const filtered = useMemo(() => rows.filter(r => {
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      if (!r.keyword.toLowerCase().includes(q) && !(r.title ?? '').toLowerCase().includes(q)) return false
    }
    if (filterIntent !== 'All' && r.intent !== filterIntent) return false
    if (filterFunnel !== 'All' && r.funnelStage !== filterFunnel) return false
    return true
  }), [rows, search, filterIntent, filterFunnel])

  // เรียงตาม Volume (คัดลอกก่อน sort — ไม่แตะ state) — แถวที่ไม่มี volume (null/0) อยู่ท้ายเสมอ
  const sorted = useMemo(() => {
    if (volSort === 'none') return filtered
    const dir = volSort === 'desc' ? -1 : 1
    const val = (r: BankKeyword) => (r.volume != null && r.volume > 0 ? r.volume : null)
    return [...filtered].sort((a, b) => {
      const av = val(a), bv = val(b)
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      return dir * (av - bv)
    })
  }, [filtered, volSort])

  const intentFilterOptions = useMemo(() => ['All', ...Array.from(new Set(rows.map(r => r.intent)))], [rows])
  const funnelFilterOptions = useMemo(() => ['All', ...Array.from(new Set(rows.map(r => r.funnelStage)))], [rows])

  const allSelected = filtered.length > 0 && filtered.every(r => selectedIds.has(r.id))
  const someSelected = filtered.some(r => selectedIds.has(r.id)) && !allSelected

  function toggleAll() {
    if (allSelected) {
      setSelectedIds(prev => { const n = new Set(prev); filtered.forEach(r => n.delete(r.id)); return n })
    } else {
      setSelectedIds(prev => { const n = new Set(prev); filtered.forEach(r => n.add(r.id)); return n })
    }
  }
  function toggleOne(id: string) {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  async function patchRow(id: string, data: Record<string, unknown>) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...data } as BankKeyword : r))
    try {
      await fetch(`/api/keywords/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
    } catch { toast.error('บันทึกไม่สำเร็จ') }
  }

  function startEdit(row: BankKeyword, field: 'keyword' | 'title' | 'volume' | 'priority') {
    if (isReadOnly) return
    setEditingCell({ id: row.id, field })
    setEditValue(
      field === 'keyword' ? row.keyword :
      field === 'title' ? (row.title ?? row.keyword) :
      field === 'volume' ? String(row.volume ?? '') :
      String(row.priority ?? 0)
    )
  }

  function commitEdit(row: BankKeyword) {
    if (!editingCell) return
    const field = editingCell.field
    setEditingCell(null)
    if (field === 'keyword') {
      // keyword คือคีย์ที่ใช้ dedupe ในคลัง — ห้ามว่างและห้ามซ้ำกับแถวอื่น
      const value = editValue.trim()
      if (!value || value === row.keyword) return
      if (rows.some(r => r.id !== row.id && r.keyword.toLowerCase() === value.toLowerCase())) {
        toast.error(`"${value}" มีอยู่ในคลังแล้ว`)
        return
      }
      patchRow(row.id, { keyword: value })
    } else if (field === 'title') {
      const value = editValue.trim()
      if (value === (row.title ?? row.keyword)) return
      patchRow(row.id, { title: value })
    } else {
      const value = Number(editValue) || 0
      if (field === 'volume' && value === (row.volume ?? 0)) return
      if (field === 'priority' && value === row.priority) return
      patchRow(row.id, { [field]: value })
    }
  }

  async function deleteRow(row: BankKeyword) {
    if (isReadOnly) return
    if (!confirm(`ลบ "${row.keyword}" ออกจากคลัง keyword?`)) return
    // ลบทุกแถวที่เป็น keyword เดียวกัน — คลังเคยสะสมแถวซ้ำจาก import ซ้ำ
    // ลบตัวเดียวแล้วตัวซ้ำยังอยู่ = ผู้ใช้เห็นเหมือน "กดแล้วไม่ลบจริง"
    const key = row.keyword.trim().toLowerCase()
    const ids = rows.filter(r => r.keyword.trim().toLowerCase() === key).map(r => r.id)
    setRows(prev => prev.filter(r => !ids.includes(r.id)))
    setSelectedIds(prev => { const n = new Set(prev); ids.forEach(id => n.delete(id)); return n })
    try { await Promise.all(ids.map(id => fetch(`/api/keywords/${id}`, { method: 'DELETE' }))) }
    catch { toast.error('ลบไม่สำเร็จ') }
  }

  async function bulkDelete() {
    if (isReadOnly || !selectedIds.size) return
    if (!confirm(`ลบ ${selectedIds.size} keywords ที่เลือก?`)) return
    // รวม keyword ของแถวที่เลือก แล้วลบทุกแถวที่ตรง keyword (รวมตัวซ้ำที่ไม่ได้ติ๊ก)
    const keys = new Set(rows.filter(r => selectedIds.has(r.id)).map(r => r.keyword.trim().toLowerCase()))
    const ids = rows.filter(r => keys.has(r.keyword.trim().toLowerCase())).map(r => r.id)
    setRows(prev => prev.filter(r => !ids.includes(r.id)))
    setSelectedIds(new Set())
    try {
      await Promise.all(ids.map(id => fetch(`/api/keywords/${id}`, { method: 'DELETE' })))
      toast.success(`ลบ ${ids.length} keywords แล้ว`)
    } catch { toast.error('ลบบางรายการไม่สำเร็จ') }
  }

  async function submitAdd() {
    if (!addKeyword.trim()) return
    setAddLoading(true)
    try {
      const res = await fetch(`/api/projects/${project.id}/keyword-bank`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: [{
            keyword: addKeyword.trim(),
            title: addTitle.trim() || undefined,
            volume: addVolume ? Number(addVolume) : undefined,
          }],
          source: 'manual',
        }),
      })
      if (res.ok) {
        toast.success('เพิ่ม keyword แล้ว')
        setAddKeyword(''); setAddTitle(''); setAddVolume(''); setShowAddForm(false)
        await loadRows()
      } else {
        toast.error('เพิ่ม keyword ไม่สำเร็จ')
      }
    } catch { toast.error('เพิ่ม keyword ไม่สำเร็จ') }
    finally { setAddLoading(false) }
  }

  async function fillVolume() {
    if (isReadOnly || !selectedIds.size || !dfsConfigured) return
    setDfsLoading(true)
    try {
      const selRows = rows.filter(r => selectedIds.has(r.id))
      const res = await fetch('/api/dataforseo/keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'volume', keywords: selRows.map(r => r.keyword) }),
      })
      if (res.status === 503) { toast.error('ยังไม่ได้เชื่อมต่อ DataForSEO'); return }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      // DataForSEO อาจ normalize ตัวพิมพ์ของ keyword — เทียบแบบ lowercase กันพลาด
      const resultMap = new Map<string, { searchVolume?: number; cpc?: number; competition?: number }>(
        (data.results ?? []).map((r: { keyword: string; searchVolume?: number; cpc?: number; competition?: number }) => [r.keyword.trim().toLowerCase(), r])
      )
      let updated = 0
      for (const row of selRows) {
        const r = resultMap.get(row.keyword.trim().toLowerCase())
        if (!r) continue
        const meta = parseMeta(row.meta)
        await patchRow(row.id, {
          volume: r.searchVolume ?? row.volume ?? 0,
          ...(r.competition != null ? { difficulty: Math.round(r.competition * 100) } : {}),
          meta: JSON.stringify({ ...meta, ...(r.cpc != null ? { cpc: r.cpc } : {}) }),
        })
        updated++
      }
      toast.success(`เติม volume จริงแล้ว ${updated} keywords`)
    } catch { toast.error('ดึงข้อมูล DataForSEO ไม่สำเร็จ') }
    finally { setDfsLoading(false) }
  }

  function sendToContentMap() {
    // ติ๊กเลือกไว้ → ส่งเฉพาะที่เลือก (count ถูกละเว้น) | ไม่ได้เลือก → ส่ง top N ตามลำดับที่แสดง
    const source = selectedIds.size
      ? sorted.filter(r => selectedIds.has(r.id))
      : (sendCount === Infinity ? sorted : sorted.slice(0, sendCount))
    if (!source.length) return
    onSendToContentMap(source.map((r, i) => toKeywordRow(r, i)))
  }

  return (
    <div className="space-y-4 w-full">

      {/* Header note */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <p className="text-xs text-gray-400 max-w-2xl leading-relaxed">
          คลัง keyword ถาวรของโปรเจกต์ — รวมจาก Keyword Research และ Keywords Input, refresh ไม่หาย
        </p>
        {!isReadOnly && (
          <button onClick={() => setShowAddForm(v => !v)}
            className="flex items-center gap-1.5 text-xs font-semibold text-white bg-brand-blue hover:bg-brand-deep px-3 py-1.5 rounded-lg transition-colors shrink-0">
            <Plus size={12} /> เพิ่ม keyword
          </button>
        )}
      </div>

      {/* Manual add form */}
      {showAddForm && !isReadOnly && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[160px]">
            <label className="block text-[10px] font-semibold text-gray-500 mb-1">Keyword *</label>
            <input value={addKeyword} onChange={e => setAddKeyword(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && addKeyword.trim() && !addLoading) submitAdd() }}
              placeholder="เช่น รับทำ SEO"
              className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-gray-200" />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-[10px] font-semibold text-gray-500 mb-1">Title (H1)</label>
            <input value={addTitle} onChange={e => setAddTitle(e.target.value)}
              placeholder="ไม่บังคับ"
              className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-gray-200" />
          </div>
          <div className="w-28">
            <label className="block text-[10px] font-semibold text-gray-500 mb-1">Volume</label>
            <input type="number" value={addVolume} onChange={e => setAddVolume(e.target.value)}
              placeholder="0"
              className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-gray-200" />
          </div>
          <button onClick={submitAdd} disabled={addLoading || !addKeyword.trim()}
            className="flex items-center gap-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 px-3 py-1.5 rounded-lg transition-colors">
            {addLoading ? <RefreshCw size={12} className="animate-spin" /> : <Plus size={12} />} เพิ่ม
          </button>
          <button onClick={() => setShowAddForm(false)}
            className="text-xs text-gray-400 hover:text-gray-700 px-2 py-1.5">ยกเลิก</button>
        </div>
      )}

      {/* DataForSEO not-configured notice */}
      {dfsConfigured === false && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
          <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
          <p className="text-[11px] text-amber-700 leading-relaxed">ยังไม่ได้เชื่อมต่อ DataForSEO — ใส่ DATAFORSEO_LOGIN/PASSWORD ใน .env</p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-24 text-gray-300">
          <RefreshCw size={20} className="animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center text-gray-300 select-none py-24 bg-white border border-gray-200 rounded-2xl">
          <Sparkles size={28} className="mb-3 opacity-30" />
          <p className="text-sm text-gray-400">ยังไม่มี keyword ในคลัง — เพิ่มจากหน้า Keyword Research หรือ Keywords Input</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          {/* Toolbar */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 flex-wrap">
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-300" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="ค้นหา keyword หรือ title..."
                className="text-xs border border-gray-200 rounded-lg pl-7 pr-2.5 py-1.5 w-56 focus:outline-none focus:ring-2 focus:ring-gray-200" />
            </div>
            <select value={filterIntent} onChange={e => setFilterIntent(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-gray-200">
              {intentFilterOptions.map(o => <option key={o} value={o}>{o === 'All' ? 'ทุก Intent' : o}</option>)}
            </select>
            <select value={filterFunnel} onChange={e => setFilterFunnel(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-gray-200">
              {funnelFilterOptions.map(o => <option key={o} value={o}>{o === 'All' ? 'ทุก Funnel' : o}</option>)}
            </select>

            <span className="text-xs text-gray-400 ml-1">
              {filtered.length !== rows.length ? `${filtered.length} / ` : ''}{rows.length} keywords
            </span>

            <div className="ml-auto flex items-center gap-2 flex-wrap">
              {selectedIds.size > 0 && (
                <span className="text-[11px] font-bold text-blue-700 bg-blue-100 px-2.5 py-1 rounded-full">
                  {selectedIds.size} selected
                </span>
              )}
              {!isReadOnly && dfsConfigured && (
                <button onClick={fillVolume} disabled={dfsLoading || !selectedIds.size}
                  className="flex items-center gap-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-40 px-3 py-1.5 rounded-lg border border-blue-200 transition-colors">
                  {dfsLoading ? <RefreshCw size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  เติม Volume จริง (DataForSEO)
                </button>
              )}
              {!isReadOnly && selectedIds.size > 0 && (
                <button onClick={bulkDelete}
                  className="flex items-center gap-1.5 text-xs font-medium text-red-500 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 border border-red-200 rounded-lg transition-colors">
                  <Trash2 size={12} /> ลบที่เลือก
                </button>
              )}
              {!isReadOnly && (
                <select value={sendCount === Infinity ? 'all' : String(sendCount)}
                  onChange={e => setSendCount(e.target.value === 'all' ? Infinity : Number(e.target.value))}
                  disabled={selectedIds.size > 0}
                  title={selectedIds.size > 0 ? 'มีการติ๊กเลือกไว้แล้ว — จะส่งเฉพาะที่เลือก' : 'จำนวน keyword ที่จะส่ง (เรียงตามลำดับที่แสดง)'}
                  className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-gray-200 disabled:opacity-40">
                  {[10, 20, 30, 50, 100].map(n => <option key={n} value={n}>ส่ง {n} อันดับแรก</option>)}
                  <option value="all">ส่งทั้งหมด</option>
                </select>
              )}
              <button onClick={sendToContentMap} disabled={filtered.length === 0}
                className="flex items-center gap-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 px-3 py-1.5 rounded-lg transition-colors">
                ส่งเข้า Content Map <ArrowRight size={12} />
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-3 py-3 w-8">
                    <input type="checkbox" checked={allSelected} ref={el => { if (el) el.indeterminate = someSelected }}
                      onChange={toggleAll} disabled={isReadOnly}
                      className="rounded border-gray-300 text-brand-blue focus:ring-blue-500 cursor-pointer" />
                  </th>
                  {['Keyword', 'Title', 'Volume', 'Intent', 'Funnel', 'Priority', 'Status', 'ที่มา', 'อัปเดตล่าสุด', ''].map(h => (
                    h === 'Volume' ? (
                      <th key={h} onClick={() => setVolSort(s => s === 'none' ? 'desc' : s === 'desc' ? 'asc' : 'none')}
                        className="text-left px-3 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:text-gray-600">
                        <span className="inline-flex items-center gap-1">Volume {volSort === 'desc' ? '▼' : volSort === 'asc' ? '▲' : ''}</span>
                      </th>
                    ) : (
                      <th key={h} className="text-left px-3 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    )
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {sorted.map(row => {
                  const src = sourceLabel(row)
                  const intentOpts = INTENT_OPTIONS.includes(row.intent) ? INTENT_OPTIONS : [row.intent, ...INTENT_OPTIONS]
                  const funnelOpts = FUNNEL_OPTIONS.includes(row.funnelStage) ? FUNNEL_OPTIONS : [row.funnelStage, ...FUNNEL_OPTIONS]
                  return (
                    <tr key={row.id} className={selectedIds.has(row.id) ? 'bg-blue-50/60' : 'hover:bg-gray-50/80'}>
                      <td className="px-3 py-2.5 w-8">
                        <input type="checkbox" checked={selectedIds.has(row.id)} onChange={() => toggleOne(row.id)}
                          disabled={isReadOnly}
                          className="rounded border-gray-300 text-brand-blue focus:ring-blue-500 cursor-pointer" />
                      </td>
                      {/* Keyword — inline editable (คีย์หลักที่ส่งต่อไป Content Map / บทความ) */}
                      <td className="px-3 py-2.5 font-semibold text-brand-navy min-w-[160px]" onClick={() => startEdit(row, 'keyword')}>
                        {editingCell?.id === row.id && editingCell.field === 'keyword' ? (
                          <input autoFocus value={editValue} onChange={e => setEditValue(e.target.value)}
                            onBlur={() => commitEdit(row)}
                            onKeyDown={e => { if (e.key === 'Enter') commitEdit(row); if (e.key === 'Escape') setEditingCell(null) }}
                            className="w-full text-xs font-semibold border border-blue-300 rounded px-1.5 py-1 focus:outline-none" />
                        ) : (
                          <span className={isReadOnly ? '' : 'cursor-text hover:bg-gray-50 rounded px-1 -mx-1'}>{row.keyword}</span>
                        )}
                      </td>

                      {/* Title (article keyword) — inline editable */}
                      <td className="px-3 py-2.5 text-gray-600 min-w-[220px]" onClick={() => startEdit(row, 'title')}>
                        {editingCell?.id === row.id && editingCell.field === 'title' ? (
                          <input autoFocus value={editValue} onChange={e => setEditValue(e.target.value)}
                            onBlur={() => commitEdit(row)}
                            onKeyDown={e => { if (e.key === 'Enter') commitEdit(row); if (e.key === 'Escape') setEditingCell(null) }}
                            className="w-full text-xs border border-blue-300 rounded px-1.5 py-1 focus:outline-none" />
                        ) : (
                          <span className={isReadOnly ? '' : 'cursor-text hover:bg-gray-50 rounded px-1 -mx-1'}>{row.title || row.keyword}</span>
                        )}
                      </td>

                      {/* Volume — inline editable */}
                      <td className="px-3 py-2.5 text-gray-500 tabular-nums font-mono" onClick={() => startEdit(row, 'volume')}>
                        {editingCell?.id === row.id && editingCell.field === 'volume' ? (
                          <input autoFocus type="number" value={editValue} onChange={e => setEditValue(e.target.value)}
                            onBlur={() => commitEdit(row)}
                            onKeyDown={e => { if (e.key === 'Enter') commitEdit(row); if (e.key === 'Escape') setEditingCell(null) }}
                            className="w-20 text-xs border border-blue-300 rounded px-1.5 py-1 focus:outline-none" />
                        ) : (
                          <span className={isReadOnly ? '' : 'cursor-text hover:bg-gray-50 rounded px-1 -mx-1'}>
                            {row.volume != null && row.volume > 0 ? row.volume.toLocaleString() : <span className="text-gray-300">—</span>}
                          </span>
                        )}
                      </td>

                      {/* Intent — select */}
                      <td className="px-3 py-2.5">
                        <select value={row.intent} disabled={isReadOnly}
                          onChange={e => patchRow(row.id, { intent: e.target.value })}
                          className="text-[10px] font-semibold border border-gray-200 rounded-lg px-1.5 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-gray-200 disabled:bg-transparent disabled:border-transparent">
                          {intentOpts.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </td>

                      {/* Funnel — select */}
                      <td className="px-3 py-2.5">
                        <select value={row.funnelStage} disabled={isReadOnly}
                          onChange={e => patchRow(row.id, { funnelStage: e.target.value })}
                          className={`text-[10px] font-bold rounded-full px-2 py-0.5 border-none focus:outline-none focus:ring-2 focus:ring-gray-200 disabled:bg-transparent ${FUNNEL_COLOR[row.funnelStage] ?? 'bg-gray-100 text-gray-600'}`}>
                          {funnelOpts.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </td>

                      {/* Priority — inline editable number */}
                      <td className="px-3 py-2.5 tabular-nums font-mono" onClick={() => startEdit(row, 'priority')}>
                        {editingCell?.id === row.id && editingCell.field === 'priority' ? (
                          <input autoFocus type="number" value={editValue} onChange={e => setEditValue(e.target.value)}
                            onBlur={() => commitEdit(row)}
                            onKeyDown={e => { if (e.key === 'Enter') commitEdit(row); if (e.key === 'Escape') setEditingCell(null) }}
                            className="w-16 text-xs border border-blue-300 rounded px-1.5 py-1 focus:outline-none" />
                        ) : (
                          <span className={isReadOnly ? '' : 'cursor-text hover:bg-gray-50 rounded px-1 -mx-1'}>{row.priority}</span>
                        )}
                      </td>

                      {/* Status badge */}
                      <td className="px-3 py-2.5">
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-lg bg-gray-100 text-gray-600 whitespace-nowrap">{row.status}</span>
                      </td>

                      {/* ที่มา */}
                      <td className="px-3 py-2.5">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-lg border whitespace-nowrap ${SOURCE_COLOR[src] ?? 'bg-gray-50 text-gray-500 border-gray-200'}`}>{src}</span>
                      </td>

                      <td className="px-3 py-2.5 text-gray-400 whitespace-nowrap">
                        {new Date(row.updatedAt).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' })}
                      </td>

                      <td className="px-3 py-2.5">
                        {!isReadOnly && (
                          <button onClick={() => deleteRow(row)}
                            className="text-gray-300 hover:text-red-500 transition-colors">
                            <X size={13} />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
