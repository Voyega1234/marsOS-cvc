'use client'

// Wide tables: adds a horizontal scrollbar above the content (sticky while the page
// scrolls down) kept in sync with the content's own scrollbar at the bottom.
import { useEffect, useRef, useState, type ReactNode } from 'react'

export function TopScrollbar({ className, children }: { className?: string; children: ReactNode }) {
  const topRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [overflowing, setOverflowing] = useState(false)

  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    const measure = () => {
      setWidth(body.scrollWidth)
      setOverflowing(body.scrollWidth > body.clientWidth + 1)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(body)
    if (body.firstElementChild) ro.observe(body.firstElementChild)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const top = topRef.current
    const body = bodyRef.current
    if (!top || !body) return
    // Only write when different, so the echoed scroll event is a no-op.
    const link = (from: HTMLDivElement, to: HTMLDivElement) => () => {
      if (to.scrollLeft !== from.scrollLeft) to.scrollLeft = from.scrollLeft
    }
    const onTop = link(top, body)
    const onBody = link(body, top)
    top.addEventListener('scroll', onTop, { passive: true })
    body.addEventListener('scroll', onBody, { passive: true })
    return () => {
      top.removeEventListener('scroll', onTop)
      body.removeEventListener('scroll', onBody)
    }
  }, [])

  return (
    <div className="min-w-0">
      <div
        ref={topRef}
        aria-hidden
        className={`sticky top-0 z-10 overflow-x-auto overflow-y-hidden bg-white/90 ${overflowing ? '' : 'hidden'}`}
      >
        <div style={{ width, height: 1 }} />
      </div>
      <div ref={bodyRef} className={className}>
        {children}
      </div>
    </div>
  )
}
