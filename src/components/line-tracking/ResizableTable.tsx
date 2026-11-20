'use client'

// Drop-in <table> whose columns can be widened or narrowed by dragging the right edge of a
// header cell (double-click the edge to reset). Widths are remembered per browser in
// localStorage under `storageKey`. Until the first drag the table lays out as normal.
//
// The drag handles are an overlay positioned over the header cells and the widths go into
// a <colgroup> this component renders, so callers keep plain <thead>/<th> markup.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'

const MIN_WIDTH = 48

function headerCells(table: HTMLTableElement | null) {
  return table ? Array.from(table.querySelectorAll<HTMLTableCellElement>(':scope > thead > tr:first-child > th')) : []
}

function store(key: string, widths: number[] | null) {
  try {
    if (widths) localStorage.setItem(key, JSON.stringify(widths))
    else localStorage.removeItem(key)
  } catch {
    // Storage unavailable (private window, blocked): widths just are not remembered.
  }
}

type Handle = { left: number; top: number; height: number }

export function ResizableTable({
  storageKey, className, children,
}: { storageKey: string; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLTableElement>(null)
  const [widths, setWidths] = useState<number[] | null>(null)
  const [handles, setHandles] = useState<Handle[]>([])

  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
      // Ignore widths saved for a different set of columns.
      if (
        Array.isArray(saved) &&
        saved.length === headerCells(ref.current).length &&
        saved.every((n) => typeof n === 'number' && n >= MIN_WIDTH)
      ) {
        setWidths(saved)
      }
    } catch {
      // Unreadable or corrupt: keep the default layout.
    }
  }, [storageKey])

  // Place one handle on the right edge of each header cell; re-measure whenever the table resizes.
  useLayoutEffect(() => {
    const table = ref.current
    if (!table) return
    const measure = () => {
      const ths = headerCells(table)
      // Skip header rows with merged cells: their edges do not match the body columns.
      if (ths.some((th) => th.colSpan > 1)) return setHandles([])
      setHandles(ths.map((th) => ({ left: th.offsetLeft + th.offsetWidth, top: th.offsetTop, height: th.offsetHeight })))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(table)
    return () => ro.disconnect()
  }, [widths])

  const start = useCallback((index: number, e: ReactPointerEvent) => {
    e.preventDefault()
    // Freeze every column at its current width, then move only the dragged one.
    const base = headerCells(ref.current).map((th) => th.getBoundingClientRect().width)
    const x0 = e.clientX
    let current = base
    const move = (ev: PointerEvent) => {
      current = base.map((w, j) => (j === index ? Math.max(MIN_WIDTH, Math.round(w + ev.clientX - x0)) : w))
      setWidths(current)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      store(storageKey, current)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [storageKey])

  const reset = useCallback(() => {
    setWidths(null)
    store(storageKey, null)
  }, [storageKey])

  const total = widths?.reduce((a, b) => a + b, 0)
  return (
    // w-max: the wrapper grows with the table, so a scroll container around it sees the new width.
    <div className="relative w-max min-w-full">
      <table
        ref={ref}
        className={`${className ?? ''} ${widths ? 'table-fixed [&_td]:overflow-hidden [&_td]:break-words' : ''}`}
        style={total ? { width: total } : undefined}
      >
        {widths && (
          <colgroup>
            {widths.map((w, i) => <col key={i} style={{ width: w }} />)}
          </colgroup>
        )}
        {children}
      </table>
      {handles.map((h, i) => (
        <span
          key={i}
          role="separator"
          aria-orientation="vertical"
          title="ลากเพื่อปรับความกว้าง · ดับเบิลคลิกเพื่อรีเซ็ต"
          onPointerDown={(e) => start(i, e)}
          onDoubleClick={reset}
          // Touch screens: an 8px drag handle at every column edge would catch horizontal scroll swipes.
          className="absolute z-10 w-2 -translate-x-1/2 [@media(pointer:coarse)]:hidden cursor-col-resize select-none after:absolute after:inset-y-1 after:left-1/2 after:w-px after:bg-slate-200 hover:bg-blue-300/60 active:bg-blue-400/70"
          style={{ left: h.left, top: h.top, height: h.height }}
        />
      ))}
    </div>
  )
}
