'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface AccountSelectOption {
  id: string
  name?: string | null
  descriptiveName?: string | null
  testAccount?: boolean
  currencyCode?: string | null
}

interface AccountSelectProps {
  accounts: AccountSelectOption[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
  emptyLabel?: string
  className?: string
  disabled?: boolean
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[-\s]/g, '')
}

function labelFor(a: AccountSelectOption): string {
  return a.descriptiveName || a.name || a.id
}

// ค้นหาได้ทั้งด้วยชื่อ (บางส่วน) และเลข CID (มี/ไม่มีขีดคั่นก็ได้)
export function AccountSelect({
  accounts,
  value,
  onChange,
  placeholder = '— เลือก Account —',
  emptyLabel = 'ไม่พบ account',
  className,
  disabled,
}: AccountSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = useMemo(() => accounts.find(a => a.id === value) ?? null, [accounts, value])

  const filtered = useMemo(() => {
    const q = normalize(query)
    if (!q) return accounts
    return accounts.filter(a => normalize(labelFor(a)).includes(q) || normalize(a.id).includes(q))
  }, [accounts, query])

  useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        className={cn(
          'flex items-center justify-between gap-2 text-left disabled:opacity-60 disabled:cursor-not-allowed',
          className,
        )}
      >
        <span className={cn('truncate', !selected && 'text-gray-400')}>
          {selected ? `${labelFor(selected)} (${selected.id})` : accounts.length === 0 ? emptyLabel : placeholder}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[260px] bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
          <div className="flex items-center gap-2 px-2.5 py-2 border-b border-gray-100">
            <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="ค้นหาชื่อ หรือ CID..."
              className="flex-1 text-sm outline-none bg-transparent"
            />
          </div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-sm text-gray-400">ไม่พบ account ที่ตรงกับ &quot;{query}&quot;</li>
            )}
            {filtered.map(a => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(a.id)
                    setOpen(false)
                    setQuery('')
                  }}
                  className={cn(
                    'w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center justify-between gap-2',
                    a.id === value && 'bg-blue-50 text-blue-700 font-medium',
                  )}
                >
                  <span className="truncate">{labelFor(a)}{a.testAccount ? ' (Test)' : ''}</span>
                  <span className="text-xs text-gray-400 shrink-0">
                    {a.id}{a.currencyCode ? ` · ${a.currencyCode}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
