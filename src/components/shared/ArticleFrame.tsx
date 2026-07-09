'use client'

import { useEffect, useRef } from 'react'

/**
 * Renders AI-generated article HTML inside an isolated <iframe>.
 *
 * WHY: the article HTML begins with a `<style>` block (see the article-write
 * prompt). Injecting it into the app DOM via `dangerouslySetInnerHTML` lets that
 * CSS leak to the WHOLE page — its `body`/`.container`/`h1` rules override the
 * app layout and squeeze every column (Thai text then wraps one word per line).
 * An iframe gives the article its own document, so its styles can never escape.
 *
 * Read-only by design. The iframe auto-sizes to its content height.
 */
export default function ArticleFrame({
  html,
  className = '',
  minHeight = 200,
}: {
  html: string
  className?: string
  minHeight?: number
}) {
  const ref = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    const iframe = ref.current
    if (!iframe) return
    const doc = iframe.contentDocument
    if (!doc) return

    const resize = () => {
      try {
        const h = doc.documentElement?.scrollHeight || doc.body?.scrollHeight || 0
        if (h) iframe.style.height = Math.max(h, minHeight) + 'px'
      } catch { /* cross-doc access can throw during teardown — ignore */ }
    }

    doc.open()
    doc.write(
      `<!DOCTYPE html><html><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<base target="_blank">` +
      `<style>` +
        `html,body{margin:0;padding:24px;box-sizing:border-box;` +
        `font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;` +
        `color:#1e293b;background:#fff;line-height:1.7;` +
        `word-break:break-word;overflow-wrap:break-word;}` +
        `img{max-width:100%;height:auto;}` +
        `table{width:100%;border-collapse:collapse;display:block;overflow-x:auto;}` +
      `</style></head><body>${html || ''}</body></html>`
    )
    doc.close()

    resize()

    // Re-measure once images finish loading (they change the height).
    const imgs = Array.from(doc.images || [])
    imgs.forEach(img => { if (!img.complete) img.addEventListener('load', resize, { once: true }) })

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null
    if (ro && doc.body) ro.observe(doc.body)
    const t = setTimeout(resize, 300)

    return () => { ro?.disconnect(); clearTimeout(t) }
  }, [html, minHeight])

  return (
    <iframe
      ref={ref}
      title="article-preview"
      // allow-same-origin lets us write into / measure the document.
      // NO allow-scripts: article HTML must never execute code in our origin.
      sandbox="allow-same-origin allow-popups"
      className={className}
      style={{ width: '100%', border: 'none', minHeight, display: 'block', background: '#fff' }}
    />
  )
}
