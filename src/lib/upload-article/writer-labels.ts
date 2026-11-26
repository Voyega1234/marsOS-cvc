// ─── Upload Article — the writer's own labels ("H1:", "H2:", "[H3]" …) ──────────
// Writers mark what each line is by typing a label in front of it. The Translate tab keeps those
// labels in the source (the customer wants the same file back), but they must never reach the
// site: at Generate every labelled line becomes a real heading of that level and the label goes.
//
// Pure functions, no I/O. A document without a single label is returned byte for byte.

import { parse, HTMLElement, Node, NodeType, TextNode } from 'node-html-parser'

/** Matched against raw HTML text, so a space may be an entity. */
export const LABEL_SPACE = '(?:\\s|&nbsp;|&#160;)*'
/** "H2:", "H2：", "[H2]", "(H2) -" — a heading level typed in front of the heading text. */
export const HEADING_LABEL = `[\\[(]${LABEL_SPACE}H[1-6]${LABEL_SPACE}[\\])]${LABEL_SPACE}[:：–—-]?|H[1-6]${LABEL_SPACE}[:：]`
export const HEADING_LABEL_RE = new RegExp(`^${LABEL_SPACE}(?:${HEADING_LABEL})${LABEL_SPACE}`, 'i')

/** Longest text a labelled line inside a paragraph may have and still become a heading. */
const HEADING_MAX_CHARS = 200
const HEADING_TAG_RE = /^h[1-6]$/
/** Inline wrappers that hold a whole block, e.g. `<h3><strong>H2: …</strong></h3>`. */
const SOLE_WRAPPERS = new Set(['strong', 'b', 'em', 'i', 'u', 'span'])
/** Cheap test before any parsing: is there anything that could be a label at all? */
const ANY_LABEL_RE = /H[1-6](?:\s|&nbsp;|&#160;)*[:：\])]/i
/** The label at the start of a line's HTML; tags opened before it (`<strong>`, an empty `<a></a>`) are kept. */
const LINE_LABEL_RE = new RegExp(`^((?:\\s|&nbsp;|&#160;|<[^>]*>)*?)(${HEADING_LABEL})${LABEL_SPACE}`, 'i')
const EMPTY_INLINE_RE = /<(strong|b|em|i|u|span)>((?:\s|&nbsp;|&#160;)*)<\/\1>/gi

/** "H1: Title" → "Title". Text without a label comes back unchanged. */
export function stripHeadingLabelText(text: string): string {
  if (!text) return text
  const match = HEADING_LABEL_RE.exec(text)
  if (!match) return text
  const rest = text.slice(match[0].length).trim()
  // A title that is nothing but a label stays as typed — an empty title helps nobody.
  return rest || text
}

function tagOf(node: Node): string {
  return node.nodeType === NodeType.ELEMENT_NODE ? ((node as HTMLElement).rawTagName || '').toLowerCase() : ''
}

function isBlank(node: Node): boolean {
  if (node.nodeType === NodeType.TEXT_NODE) return !(node as TextNode).rawText.replace(/&nbsp;|&#160;| /g, ' ').trim()
  if (node.nodeType !== NodeType.ELEMENT_NODE) return true
  // Google Docs leaves an empty bookmark anchor at the start of every heading.
  return tagOf(node) === 'a' && !(node as HTMLElement).childNodes.length
}

interface Line {
  html: string
  /** heading level typed by the writer, 0 = no label */
  level: number
  /** line breaks between the previous line and this one */
  breaksBefore: number
  /** visible characters, label not counted */
  chars: number
  hasImage: boolean
}

interface BlockShape {
  lines: Line[]
  /** tag of the inline element that wrapped the whole block, '' = none */
  wrapper: string
}

function textLength(html: string): number {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;| /g, ' ').replace(/\s+/g, ' ').trim().length
}

function readLine(html: string, breaksBefore: number): Line {
  const hasImage = /<img\b/i.test(html)
  const match = LINE_LABEL_RE.exec(html)
  if (!match) return { html: html.trim(), level: 0, breaksBefore, chars: textLength(html), hasImage }
  const level = Number(/H([1-6])/i.exec(match[2])![1])
  let rest = match[1] + html.slice(match[0].length)
  // `<strong>H2:</strong> text` leaves an empty wrapper behind.
  for (let i = 0; i < 3; i++) rest = rest.replace(EMPTY_INLINE_RE, '$2')
  rest = rest.trim()
  return { html: rest, level, breaksBefore, chars: textLength(rest), hasImage }
}

/** Splits a block into the lines the writer typed (one per `<br>`), looking through a sole inline wrapper. */
function shapeOf(block: HTMLElement): BlockShape {
  let nodes: Node[] = block.childNodes
  let lead = ''
  let wrapper = ''
  for (let depth = 0; depth < 2; depth++) {
    const solid = nodes.filter((n) => !isBlank(n))
    if (solid.length !== 1 || !SOLE_WRAPPERS.has(tagOf(solid[0]))) break
    // Bookmark anchors in front of the wrapper stay in front of the first line.
    lead += nodes.slice(0, nodes.indexOf(solid[0])).map((n) => n.toString()).join('')
    wrapper = wrapper || tagOf(solid[0])
    nodes = (solid[0] as HTMLElement).childNodes
  }
  const lines: Line[] = []
  let current = lead
  // line breaks seen since the last line that held anything
  let gap = 0
  const flush = () => {
    // A blank stretch keeps its bookmark anchors for the next real line.
    if (!current.replace(/<a\b[^>]*><\/a>/gi, '').replace(/&nbsp;|&#160;|\u00a0/g, ' ').trim()) return
    lines.push(readLine(current, lines.length ? gap : 0))
    current = ''
    gap = 0
  }
  for (const node of nodes) {
    if (tagOf(node) === 'br') {
      flush()
      gap++
      continue
    }
    current += node.toString()
  }
  flush()
  return { lines, wrapper }
}

function attrsOf(block: HTMLElement): string {
  return block.rawAttrs ? ` ${block.rawAttrs}` : ''
}

/** A heading block that carries at least one label: every labelled line is a heading of its own level. */
function rebuildHeading(block: HTMLElement, shape: BlockShape): string {
  const out: string[] = []
  let attrs = attrsOf(block)
  let open = -1
  for (const line of shape.lines) {
    if (line.level) {
      out.push(`<h${line.level}${attrs}>${line.html}</h${line.level}>`)
      attrs = ''
      open = out.length - 1
      continue
    }
    // A soft line break inside the heading text itself stays part of that heading.
    if (open === out.length - 1 && open >= 0 && line.breaksBefore === 1 && !line.hasImage && line.chars <= HEADING_MAX_CHARS) {
      out[open] = out[open].replace(/<\/h[1-6]>$/, (close) => `<br>${line.html}${close}`)
      continue
    }
    // Body text that was typed inside the heading style: it is a paragraph.
    out.push(`<p>${line.html}</p>`)
    open = -1
  }
  return out.join('')
}

/** A paragraph that carries at least one label. */
function rebuildParagraph(block: HTMLElement, shape: BlockShape): string {
  const wrap = (html: string) => (shape.wrapper ? `<${shape.wrapper}>${html}</${shape.wrapper}>` : html)
  const out: string[] = []
  let attrs = attrsOf(block)
  for (const line of shape.lines) {
    const heading = line.level > 0 && line.chars > 0 && line.chars <= HEADING_MAX_CHARS && !line.hasImage
    // Too long for a heading: the label still goes, the text stays a paragraph.
    out.push(heading ? `<h${line.level}${attrs}>${line.html}</h${line.level}>` : `<p${attrs}>${wrap(line.html)}</p>`)
    attrs = ''
  }
  return out.join('')
}

/**
 * Turns the writer's labelled lines into real headings and removes the labels.
 * - a labelled line becomes a heading of the level in the label, whatever tag it was typed in
 * - text without a label that sits inside a labelled heading becomes a paragraph
 * - paragraphs are only read when the document uses the convention at all: a real heading carries
 *   a label, or the document has no headings and at least two labelled lines — so an article that
 *   merely talks about "H1: …" in its body text is left alone
 * - blocks without a label are never rewritten
 */
export function applyHeadingLabelsHtml(html: string): string {
  if (!html || !ANY_LABEL_RE.test(html)) return html
  const root = parse(html, { comment: true })
  const blocks = root.childNodes.filter((n): n is HTMLElement => n.nodeType === NodeType.ELEMENT_NODE)
  const shapes = new Map<HTMLElement, BlockShape>()
  let headings = 0
  let labelledHeadings = 0
  let labelledParagraphLines = 0
  for (const block of blocks) {
    const tag = tagOf(block)
    const isHeading = HEADING_TAG_RE.test(tag)
    if (isHeading) headings++
    if (!isHeading && tag !== 'p') continue
    const shape = shapeOf(block)
    const labelled = shape.lines.filter((line) => line.level > 0).length
    if (!labelled) continue
    shapes.set(block, shape)
    if (isHeading) labelledHeadings++
    else labelledParagraphLines += labelled
  }
  if (!shapes.size) return html
  const paragraphsToo = labelledHeadings > 0 || (headings === 0 && labelledParagraphLines >= 2)
  let changed = false
  for (const [block, shape] of Array.from(shapes)) {
    const isHeading = HEADING_TAG_RE.test(tagOf(block))
    if (!isHeading && !paragraphsToo) continue
    block.replaceWith(isHeading ? rebuildHeading(block, shape) : rebuildParagraph(block, shape))
    changed = true
  }
  return changed ? root.toString() : html
}
