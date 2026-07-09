'use client'

import { useEffect } from 'react'

/**
 * A contentEditable region that renders article HTML which may contain a
 * `<style>` block, WITHOUT letting those styles leak to the whole page.
 *
 * Preview uses <iframe> (see ArticleFrame) for full isolation, but the editor
 * must stay a real contentEditable in the main document so `document.execCommand`
 * (bold/lists/headings…) and the existing refs keep working. So instead of
 * isolating the DOM we scope the CSS: after each render we rewrite the CSSOM
 * selectors of any inner <style> to be prefixed with `.cc-scoped-editor`.
 *
 * Crucially this only edits the LIVE stylesheet rules — never the <style>
 * element's text — so `editorRef.current.innerHTML` (what gets saved/published)
 * still contains the original, un-scoped global styles. All operations are
 * wrapped in try/catch: worst case a rule fails to scope (styles behave as
 * before) — nothing breaks.
 */
export default function ScopedEditable({
  html,
  editorRef,
  className,
  onInput,
}: {
  html: string
  editorRef: React.RefObject<HTMLDivElement>
  className?: string
  onInput?: () => void
}) {
  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    el.classList.add('cc-scoped-editor')
    const scopeSel = '.cc-scoped-editor'

    const scopeGroup = (rules: CSSRuleList) => {
      for (const r of Array.from(rules)) {
        const anyR = r as unknown as { selectorText?: string; cssRules?: CSSRuleList }
        if (anyR.selectorText != null) {
          try {
            anyR.selectorText = String(anyR.selectorText)
              .split(',')
              .map(s => {
                const t = s.trim()
                // Map root selectors onto the editor element itself.
                const stripped = t.replace(/^(html|body|:root)\b/i, '').trim()
                return `${scopeSel} ${stripped}`.trim()
              })
              .join(', ')
          } catch { /* some selectors can't be reassigned — leave them */ }
        } else if (anyR.cssRules) {
          scopeGroup(anyR.cssRules) // @media / @supports groups
        }
      }
    }

    el.querySelectorAll('style').forEach(styleEl => {
      const sheet = (styleEl as HTMLStyleElement).sheet
      if (sheet) {
        try { scopeGroup(sheet.cssRules) } catch { /* cross-doc / not-yet-parsed */ }
      }
    })
  }, [html, editorRef])

  return (
    <div
      ref={editorRef}
      contentEditable
      suppressContentEditableWarning
      onInput={onInput}
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
