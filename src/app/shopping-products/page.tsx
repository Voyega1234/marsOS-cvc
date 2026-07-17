'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import AppShell from '@/components/layout/AppShell'
import { AccountSelect } from '@/components/ui/AccountSelect'
import { ShoppingBag, TrendingUp, TrendingDown, ChevronUp, ChevronDown, AlertTriangle, Calendar, X } from 'lucide-react'
import { cn, formatCurrency, formatConversions } from '@/lib/utils'

interface ProductPerformance {
  itemId: string
  title: string
  brand: string
  productType: string
  cost: number
  clicks: number
  impressions: number
  conversions: number
  conversionValue: number
  ctr: number
  cpc: number
  roas: number
}

interface Totals {
  productCount: number
  cost: number
  clicks: number
  conversions: number
  conversionValue: number
  roas: number
  avgCpc: number
}

interface Campaign {
  campaignName: string
  campaignId: string
}

type SortKey = keyof ProductPerformance
type SortDir = 'asc' | 'desc'

type DateMode = '1' | '7' | '14' | '30' | 'yesterday' | 'custom'

const PRESET_TABS: { label: string; value: DateMode }[] = [
  { label: 'เมื่อวาน', value: 'yesterday' },
  { label: '7 วัน',   value: '7'         },
  { label: '14 วัน',  value: '14'        },
  { label: '30 วัน',  value: '30'        },
  { label: 'Custom',  value: 'custom'    },
]

function roasBadge(roas: number) {
  if (roas >= 3) return 'bg-emerald-100 text-emerald-700'
  if (roas >= 1) return 'bg-yellow-100 text-yellow-700'
  return 'bg-red-100 text-red-600'
}

function SortIcon({ dir }: { dir: SortDir | null }) {
  if (!dir) return <span className="w-3 h-3 inline-block opacity-30"><ChevronDown className="w-3 h-3" /></span>
  if (dir === 'asc') return <ChevronUp className="w-3 h-3 inline-block text-blue-500" />
  return <ChevronDown className="w-3 h-3 inline-block text-blue-500" />
}

function SkeletonCard() {
  return <div className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse h-24" />
}

function SkeletonRow() {
  return (
    <tr className="border-b border-gray-50">
      {[180, 80, 80, 70, 70, 70, 70, 60, 60].map((w, i) => (
        <td key={i} className="py-3 px-4">
          <div className="h-4 bg-gray-100 rounded animate-pulse" style={{ width: `${w}px` }} />
        </td>
      ))}
    </tr>
  )
}

function toYYYYMMDD(d: Date) {
  return d.toISOString().split('T')[0]
}

function subtractDays(d: Date, n: number) {
  const r = new Date(d)
  r.setDate(r.getDate() - n)
  return r
}

export default function ShoppingProductsPage() {
  const [accounts,     setAccounts]     = useState<Array<{ id: string; name: string }>>([])
  const [campaigns,    setCampaigns]    = useState<Campaign[]>([])
  const [selectedAcc,  setSelectedAcc]  = useState('')
  const [selectedCamp, setSelectedCamp] = useState('__all__')
  const [dateMode,     setDateMode]     = useState<DateMode>('30')
  const [customStart,  setCustomStart]  = useState('')
  const [customEnd,    setCustomEnd]    = useState('')
  const [showCustom,   setShowCustom]   = useState(false)
  const [products,     setProducts]     = useState<ProductPerformance[]>([])
  const [totals,       setTotals]       = useState<Totals | null>(null)
  const [loading,      setLoading]      = useState(false)
  const [campLoading,  setCampLoading]  = useState(false)
  const [sortKey,      setSortKey]      = useState<SortKey>('cost')
  const [sortDir,      setSortDir]      = useState<SortDir>('desc')
  const customRef = useRef<HTMLDivElement>(null)

  // Close custom picker on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (customRef.current && !customRef.current.contains(e.target as Node)) {
        setShowCustom(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Load accounts
  useEffect(() => {
    fetch('/api/clients')
      .then(r => r.json())
      .then(d => {
        const list = (d.accounts ?? []).map((a: { id: string; descriptiveName?: string; name?: string }) => ({
          id: a.id,
          name: a.descriptiveName ?? a.name ?? a.id,
        }))
        setAccounts(list)
        if (list.length > 0) setSelectedAcc(list[0].id)
      })
      .catch(() => {})
  }, [])

  // When account changes, load Shopping/PMax campaign list with real IDs
  useEffect(() => {
    if (!selectedAcc) return
    setCampLoading(true)
    fetch(`/api/performance/account?customerId=${selectedAcc}&days=30`)
      .then(r => r.json())
      .then(d => {
        const camps: Campaign[] = (d.campaigns ?? [])
          .filter((c: { campaignName: string }) => {
            const n = c.campaignName.toLowerCase()
            return n.includes('shopping') || n.includes('pmax') || n.includes('performance max') || n.includes('max')
          })
          .map((c: { campaignName: string; campaignId?: string }) => ({
            campaignName: c.campaignName,
            campaignId: c.campaignId ?? '',
          }))
        setCampaigns(camps)
        setSelectedCamp('__all__')
      })
      .catch(() => {})
      .finally(() => setCampLoading(false))
  }, [selectedAcc])

  // Build query params for date range
  function buildDateParams(): string {
    if (dateMode === 'yesterday') return 'dateRange=YESTERDAY'
    if (dateMode === 'custom' && customStart && customEnd) {
      return `startDate=${customStart}&endDate=${customEnd}`
    }
    return `days=${dateMode}`
  }

  const fetchProducts = useCallback(async () => {
    if (!selectedAcc) return
    setLoading(true)
    try {
      const campParam = selectedCamp && selectedCamp !== '__all__' ? `&campaignId=${encodeURIComponent(selectedCamp)}` : ''
      const dateParam = buildDateParams()
      const res = await fetch(
        `/api/performance/shopping-products?customerId=${selectedAcc}${campParam}&${dateParam}`
      )
      const d = await res.json()
      setProducts(d.products ?? [])
      setTotals(d.totals ?? null)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAcc, selectedCamp, dateMode, customStart, customEnd])

  useEffect(() => {
    if (dateMode === 'custom' && (!customStart || !customEnd)) return
    fetchProducts()
  }, [fetchProducts, dateMode, customStart, customEnd])

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sorted = [...products].sort((a, b) => {
    const av = a[sortKey], bv = b[sortKey]
    if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av
    if (typeof av === 'string' && typeof bv === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    return 0
  })

  const topRoas = products.length > 0 ? Math.max(...products.map(p => p.roas)) : 0

  type ColDef = { key: SortKey; label: string; align: 'left' | 'right' }
  const columns: ColDef[] = [
    { key: 'title',           label: 'Product',     align: 'left'  },
    { key: 'brand',           label: 'Brand',       align: 'left'  },
    { key: 'productType',     label: 'Type',        align: 'left'  },
    { key: 'cost',            label: 'Cost',        align: 'right' },
    { key: 'clicks',          label: 'Clicks',      align: 'right' },
    { key: 'conversions',     label: 'Conv.',       align: 'right' },
    { key: 'conversionValue', label: 'Conv. Value', align: 'right' },
    { key: 'roas',            label: 'ROAS',        align: 'right' },
    { key: 'ctr',             label: 'CTR',         align: 'right' },
  ]

  // Date label for subtitle
  function dateLabel() {
    if (dateMode === 'yesterday') return 'เมื่อวาน'
    if (dateMode === 'custom' && customStart && customEnd) return `${customStart} – ${customEnd}`
    return `${dateMode} วัน`
  }

  return (
    <AppShell>
      <div className="space-y-6">

        {/* Lead Gen context warning */}
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-amber-800">เมนูนี้สำหรับ e-commerce เท่านั้น</p>
            <p className="text-sm text-amber-700 mt-0.5">
              Product Performance ใช้ได้กับ Shopping Campaigns และ PMax ที่มี Product Feed เท่านั้น
            </p>
          </div>
        </div>

        {/* Header */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center flex-shrink-0">
              <ShoppingBag className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Product Performance</h1>
              <p className="text-xs text-gray-400 mt-0.5">Shopping / PMax product-level metrics</p>
            </div>
          </div>

          {/* Selectors */}
          <div className="flex flex-wrap items-center gap-2">

            {/* Account */}
            <AccountSelect
              accounts={accounts}
              value={selectedAcc}
              onChange={setSelectedAcc}
              emptyLabel="กำลังโหลด..."
              className="text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />

            {/* Campaign — includes All */}
            <select
              value={selectedCamp}
              onChange={e => setSelectedCamp(e.target.value)}
              disabled={campLoading}
              className="text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-300 max-w-[260px] disabled:opacity-60"
            >
              <option value="__all__">ทุก Campaign</option>
              {campaigns.map(c => (
                <option key={c.campaignId || c.campaignName} value={c.campaignId || c.campaignName}>
                  {c.campaignName}
                </option>
              ))}
            </select>

            {/* Date tabs + custom */}
            <div className="relative" ref={customRef}>
              <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
                {PRESET_TABS.map(t => (
                  <button
                    key={t.value}
                    onClick={() => {
                      if (t.value === 'custom') {
                        // Set default custom range = last 30 days
                        const today = new Date()
                        if (!customStart) setCustomStart(toYYYYMMDD(subtractDays(today, 30)))
                        if (!customEnd)   setCustomEnd(toYYYYMMDD(subtractDays(today, 1)))
                        setShowCustom(v => !v)
                      } else {
                        setDateMode(t.value)
                        setShowCustom(false)
                      }
                    }}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1',
                      (dateMode === t.value || (t.value === 'custom' && dateMode === 'custom'))
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    )}
                  >
                    {t.value === 'custom' && <Calendar className="w-3 h-3" />}
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Custom date picker dropdown */}
              {showCustom && (
                <div className="absolute right-0 top-full mt-2 z-50 bg-white border border-gray-200 rounded-2xl shadow-lg p-4 min-w-[280px]">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-semibold text-gray-700">กำหนดช่วงวัน</p>
                    <button onClick={() => setShowCustom(false)} className="text-gray-300 hover:text-gray-500">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs font-medium text-gray-500 block mb-1">วันเริ่มต้น</label>
                      <input
                        type="date"
                        value={customStart}
                        max={customEnd || toYYYYMMDD(new Date())}
                        onChange={e => setCustomStart(e.target.value)}
                        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 block mb-1">วันสิ้นสุด</label>
                      <input
                        type="date"
                        value={customEnd}
                        min={customStart}
                        max={toYYYYMMDD(new Date())}
                        onChange={e => setCustomEnd(e.target.value)}
                        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
                      />
                    </div>
                    {/* Quick shortcuts */}
                    <div className="flex flex-wrap gap-1.5 pt-1 border-t border-gray-100">
                      {[
                        { label: 'เดือนนี้', fn: () => {
                          const now = new Date()
                          setCustomStart(toYYYYMMDD(new Date(now.getFullYear(), now.getMonth(), 1)))
                          setCustomEnd(toYYYYMMDD(subtractDays(now, 1)))
                        }},
                        { label: 'เดือนที่แล้ว', fn: () => {
                          const now = new Date()
                          const first = new Date(now.getFullYear(), now.getMonth() - 1, 1)
                          const last  = new Date(now.getFullYear(), now.getMonth(), 0)
                          setCustomStart(toYYYYMMDD(first))
                          setCustomEnd(toYYYYMMDD(last))
                        }},
                        { label: '90 วัน', fn: () => {
                          const now = new Date()
                          setCustomStart(toYYYYMMDD(subtractDays(now, 90)))
                          setCustomEnd(toYYYYMMDD(subtractDays(now, 1)))
                        }},
                      ].map(s => (
                        <button key={s.label} onClick={s.fn}
                          className="text-xs px-2 py-1 bg-gray-100 hover:bg-blue-50 hover:text-blue-600 rounded-lg transition-colors">
                          {s.label}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => {
                        if (customStart && customEnd) {
                          setDateMode('custom')
                          setShowCustom(false)
                        }
                      }}
                      disabled={!customStart || !customEnd}
                      className="w-full py-2 text-sm font-semibold bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                      ดูข้อมูล
                    </button>
                  </div>
                </div>
              )}
            </div>

          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {loading || !totals ? (
            [1, 2, 3, 4].map(i => <SkeletonCard key={i} />)
          ) : (
            <>
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <p className="text-xs text-gray-400 font-medium">Total Products</p>
                <p className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">{totals.productCount}</p>
                <p className="text-[11px] text-gray-400 mt-1">active SKUs</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <p className="text-xs text-gray-400 font-medium">Top Product ROAS</p>
                <p className={cn('text-2xl font-bold mt-1 tabular-nums', topRoas >= 3 ? 'text-emerald-600' : topRoas >= 1 ? 'text-yellow-600' : 'text-red-600')}>
                  {topRoas.toFixed(2)}x
                </p>
                <p className="text-[11px] text-gray-400 mt-1">best performer</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <p className="text-xs text-gray-400 font-medium">Total Cost</p>
                <p className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">{formatCurrency(totals.cost)}</p>
                <p className="text-[11px] text-gray-400 mt-1">ทุก SKU รวมกัน</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <p className="text-xs text-gray-400 font-medium">Total Conv. Value</p>
                <p className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">{formatCurrency(totals.conversionValue)}</p>
                <p className="text-[11px] text-gray-400 mt-1">ROAS {totals.roas.toFixed(2)}x overall</p>
              </div>
            </>
          )}
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">รายละเอียดสินค้า</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {sorted.length} products · {dateLabel()} · คลิก header เพื่อเรียง
              {selectedCamp !== '__all__' && campaigns.find(c => (c.campaignId || c.campaignName) === selectedCamp) &&
                ` · ${campaigns.find(c => (c.campaignId || c.campaignName) === selectedCamp)!.campaignName}`
              }
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  {columns.map(col => (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      className={cn(
                        'py-3 px-4 text-xs font-semibold uppercase tracking-wide cursor-pointer select-none whitespace-nowrap hover:bg-gray-100 transition-colors',
                        col.align === 'right' ? 'text-right' : 'text-left',
                        sortKey === col.key ? 'text-blue-600' : 'text-gray-500'
                      )}
                    >
                      <span className="inline-flex items-center gap-1">
                        {col.label}
                        <SortIcon dir={sortKey === col.key ? sortDir : null} />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading
                  ? [1,2,3,4,5,6,7,8].map(i => <SkeletonRow key={i} />)
                  : sorted.length === 0
                    ? (
                      <tr>
                        <td colSpan={9} className="py-12 text-center text-gray-400 text-sm">
                          <ShoppingBag className="w-6 h-6 mx-auto mb-2 opacity-30" />
                          ไม่พบข้อมูล — เลือก account และช่วงเวลาให้ถูกต้อง
                        </td>
                      </tr>
                    )
                    : sorted.map(p => (
                      <tr
                        key={p.itemId}
                        className={cn('border-b border-gray-50 hover:bg-gray-50 transition-colors', p.roas < 1 && 'bg-red-50 hover:bg-red-100')}
                      >
                        <td className="py-3 px-4 max-w-[220px]">
                          <p className="font-medium text-gray-900 truncate">{p.title}</p>
                          <p className="text-[11px] text-gray-400 mt-0.5">{p.itemId}</p>
                        </td>
                        <td className="py-3 px-4 text-gray-600 whitespace-nowrap">{p.brand}</td>
                        <td className="py-3 px-4 text-gray-500 text-xs whitespace-nowrap max-w-[160px]">
                          <span className="truncate block">{p.productType.split(' > ').pop()}</span>
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums font-medium text-gray-900">{formatCurrency(p.cost)}</td>
                        <td className="py-3 px-4 text-right tabular-nums text-gray-700">{p.clicks.toLocaleString()}</td>
                        <td className="py-3 px-4 text-right tabular-nums text-gray-700">{formatConversions(p.conversions)}</td>
                        <td className="py-3 px-4 text-right tabular-nums text-gray-700">{formatCurrency(p.conversionValue)}</td>
                        <td className="py-3 px-4 text-right">
                          <span className={cn('inline-block rounded px-2 py-0.5 text-xs tabular-nums', roasBadge(p.roas))}>
                            {p.roas.toFixed(2)}x
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums text-gray-600">{p.ctr.toFixed(2)}%</td>
                      </tr>
                    ))
                }
              </tbody>
              {!loading && totals && sorted.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-gray-200 bg-gray-50">
                    <td className="py-3 px-4 font-bold text-gray-700" colSpan={3}>รวม</td>
                    <td className="py-3 px-4 text-right font-bold text-gray-900 tabular-nums">{formatCurrency(totals.cost)}</td>
                    <td className="py-3 px-4 text-right font-bold text-gray-900 tabular-nums">{totals.clicks.toLocaleString()}</td>
                    <td className="py-3 px-4 text-right font-bold text-gray-900 tabular-nums">{formatConversions(totals.conversions)}</td>
                    <td className="py-3 px-4 text-right font-bold text-gray-900 tabular-nums">{formatCurrency(totals.conversionValue)}</td>
                    <td className="py-3 px-4 text-right">
                      <span className={cn('inline-block rounded px-2 py-0.5 text-xs font-bold tabular-nums', roasBadge(totals.roas))}>
                        {totals.roas.toFixed(2)}x
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-gray-900 tabular-nums">
                      {totals.clicks > 0 && products.reduce((a, p) => a + p.impressions, 0) > 0
                        ? `${((totals.clicks / products.reduce((a, p) => a + p.impressions, 0)) * 100).toFixed(2)}%`
                        : '—'}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span className="inline-block w-4 h-4 rounded bg-red-50 border border-red-200" />
          <span>แถวสีชมพู = ROAS &lt; 1x (ขาดทุน)</span>
          <span className="ml-4 inline-flex items-center gap-1">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-500" /> ROAS ≥ 3x
          </span>
          <span className="inline-flex items-center gap-1">
            <TrendingDown className="w-3.5 h-3.5 text-yellow-500" /> ROAS 1–3x
          </span>
        </div>

      </div>
    </AppShell>
  )
}
