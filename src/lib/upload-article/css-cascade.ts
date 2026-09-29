// ─── คำนวณสีจริงของบทความจาก HTML + CSS ของเว็บ (cascade แบบย่อ ไม่ต้องเปิดเบราว์เซอร์) ─────────────
// ใช้ตอนสแกนเว็บปลายทาง: หาว่าผู้อ่านเห็นตัวอักษร/หัวข้อ/ลิงก์สีอะไร และบทความมีพื้นหลังของตัวเองไหม
// รองรับ: selector แบบ tag/.class/#id, descendant/child, :root/:not()/:where()/:is(), ตัวแปร CSS (var()),
// การสืบทอดสี, !important, specificity, ลำดับกฎ และตัด @media ที่ใช้เฉพาะมือถือ/พิมพ์/dark mode
// ข้อจำกัด: ไม่รองรับ selector แบบ attribute/sibling/สถานะ (:hover, :nth-child) — กฎพวกนั้นถูกข้าม

export interface CssRule {
  selector: string
  body: string
}

/** กว้างของจอเดสก์ท็อปที่ใช้ตัดสิน @media (Elementor/ธีมส่วนใหญ่แยกมือถือที่ ≤1024px) */
const VIEWPORT = 1366

export function mediaApplies(prelude: string): boolean {
  const q = prelude.toLowerCase()
  if (/prefers-color-scheme\s*:\s*dark/.test(q)) return false
  if (/\bprint\b|\bspeech\b/.test(q) && !/\bscreen\b|\ball\b/.test(q)) return false
  if (/orientation\s*:\s*portrait|hover\s*:\s*none|pointer\s*:\s*coarse/.test(q)) return false
  const px = (n: string, unit: string) => Number(n) * (unit === 'em' || unit === 'rem' ? 16 : 1)
  for (const m of Array.from(q.matchAll(/max-width\s*:\s*([\d.]+)(px|em|rem)/g))) if (px(m[1], m[2]) < VIEWPORT) return false
  for (const m of Array.from(q.matchAll(/min-width\s*:\s*([\d.]+)(px|em|rem)/g))) if (px(m[1], m[2]) > VIEWPORT) return false
  return true
}

/** แยกกฎ CSS ตามลำดับในไฟล์ — กฎใน @media ที่ไม่ใช้กับจอเดสก์ท็อปถูกตัด, @keyframes/@font-face ถูกข้าม */
export function parseCssRules(css: string): CssRule[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: CssRule[] = []
  const walk = (from: number, to: number, active: boolean) => {
    let i = from
    while (i < to) {
      const open = src.indexOf('{', i)
      if (open === -1 || open >= to) return
      const close = src.indexOf('}', i)
      if (close !== -1 && close < open) {
        // ปีกกาปิดเกิน (CSS พัง) — ข้ามไป
        i = close + 1
        continue
      }
      const prelude = src.slice(i, open).trim()
      if (prelude.startsWith('@')) {
        // หาปีกกาปิดคู่ของ at-rule (นับซ้อน)
        let depth = 1
        let j = open + 1
        while (j < to && depth > 0) {
          const c = src[j]
          if (c === '{') depth++
          else if (c === '}') depth--
          j++
        }
        const name = /^@([\w-]+)/.exec(prelude)?.[1]?.toLowerCase() || ''
        if (name === 'media') walk(open + 1, j - 1, active && mediaApplies(prelude))
        else if (name === 'supports' || name === 'layer' || name === 'container' || name === 'document') walk(open + 1, j - 1, active)
        i = j
        continue
      }
      const end = src.indexOf('}', open)
      if (end === -1 || end > to) return
      const body = src.slice(open + 1, end).trim()
      if (active && prelude && body) out.push({ selector: prelude, body })
      i = end + 1
    }
  }
  walk(0, src.length, true)
  return out
}

// ── HTML element chain ──────────────────────────────────────────────────────

export interface CssEl {
  tag: string
  id: string
  classes: Set<string>
}

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])

export function parseOpenTag(tagHtml: string): CssEl {
  const tag = (/^<([a-zA-Z][\w-]*)/.exec(tagHtml)?.[1] || 'div').toLowerCase()
  const id = /\sid=["']([^"']*)["']/i.exec(tagHtml)?.[1] || ''
  const cls = /\sclass=["']([^"']*)["']/i.exec(tagHtml)?.[1] || ''
  return { tag, id, classes: new Set(cls.split(/\s+/).filter(Boolean)) }
}

/** element ที่ยังเปิดอยู่ ณ ตำแหน่ง index ของหน้า (html → body → ... → element ที่ครอบ index) */
export function openChainAt(html: string, index: number): CssEl[] {
  const stack: CssEl[] = []
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)\b[^>]*>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) && m.index < index) {
    if (!m[2]) continue
    const tag = m[2].toLowerCase()
    if (m[1]) {
      // แท็กปิด — ถอยจนเจอแท็กคู่ (HTML จริงปิดไม่ครบได้)
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k].tag === tag) {
          stack.length = k
          break
        }
      }
      continue
    }
    if (tag === 'script' || tag === 'style' || tag === 'textarea') {
      const end = html.toLowerCase().indexOf(`</${tag}`, re.lastIndex)
      if (end === -1 || end > index) break
      re.lastIndex = end
      continue
    }
    if (VOID_TAGS.has(tag) || m[0].endsWith('/>')) continue
    stack.push(parseOpenTag(m[0]))
  }
  return stack
}

// ── selector matching ───────────────────────────────────────────────────────

interface Compound {
  tag: string | null
  ids: string[]
  classes: string[]
  /** :not(...) — เก็บไว้ตรวจว่าไม่ match */
  nots: Compound[][]
  /** :where()/:is() — ต้อง match อย่างน้อยหนึ่งตัว */
  anyOf: Array<{ list: Compound[]; counts: boolean }>
  root: boolean
}

interface ParsedSelector {
  parts: Compound[]
  combs: Array<' ' | '>'>
  spec: number
}

/** แยก selector ตามคอมมาระดับบนสุด (ไม่ตัดในวงเล็บ) */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const c of s) {
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    if (c === sep && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out.map((x) => x.trim()).filter(Boolean)
}

const ALWAYS_PSEUDO = new Set(['link', 'any-link'])

function parseCompound(src: string): { c: Compound; spec: number } | null {
  const c: Compound = { tag: null, ids: [], classes: [], nots: [], anyOf: [], root: false }
  let spec = 0
  let i = 0
  const tm = /^(\*|[a-zA-Z][\w-]*)/.exec(src)
  if (tm) {
    if (tm[1] !== '*') {
      c.tag = tm[1].toLowerCase()
      spec += 1
    }
    i = tm[0].length
  }
  while (i < src.length) {
    const rest = src.slice(i)
    let m: RegExpExecArray | null
    if ((m = /^\.(-?[_a-zA-Z][\w-]*)/.exec(rest))) {
      c.classes.push(m[1])
      spec += 100
    } else if ((m = /^#(-?[_a-zA-Z][\w-]*)/.exec(rest))) {
      c.ids.push(m[1])
      spec += 10000
    } else if ((m = /^:(not|where|is)\(/i.exec(rest))) {
      // หา ) คู่
      let depth = 1
      let j = m[0].length
      while (j < rest.length && depth > 0) {
        if (rest[j] === '(') depth++
        else if (rest[j] === ')') depth--
        j++
      }
      const inner = rest.slice(m[0].length, j - 1)
      const list: Compound[] = []
      let innerSpec = 0
      for (const part of splitTop(inner, ',')) {
        const p = parseCompound(part)
        if (!p) return null
        list.push(p.c)
        innerSpec = Math.max(innerSpec, p.spec)
      }
      const kind = m[1].toLowerCase()
      if (kind === 'not') {
        c.nots.push(list)
        spec += innerSpec
      } else {
        c.anyOf.push({ list, counts: kind === 'is' })
        if (kind === 'is') spec += innerSpec
      }
      i += j
      continue
    } else if ((m = /^:root\b/i.exec(rest))) {
      c.root = true
      spec += 100
    } else if ((m = /^:([\w-]+)/.exec(rest)) && ALWAYS_PSEUDO.has(m[1].toLowerCase())) {
      spec += 100
    } else {
      // attribute / pseudo-class สถานะ / pseudo-element — ไม่รองรับ
      return null
    }
    i += m[0].length
  }
  return { c, spec }
}

export function parseSelector(sel: string): ParsedSelector | null {
  const parts: Compound[] = []
  const combs: Array<' ' | '>'> = []
  let spec = 0
  // แยก compound ด้วยช่องว่าง/> ที่ไม่อยู่ในวงเล็บ
  const tokens: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of sel.trim()) {
    if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth--
    if (depth === 0 && (ch === ' ' || ch === '>' || ch === '+' || ch === '~' || ch === '\n' || ch === '\t')) {
      if (cur) tokens.push(cur)
      cur = ''
      if (ch === '>' || ch === '+' || ch === '~') tokens.push(ch)
      continue
    }
    cur += ch
  }
  if (cur) tokens.push(cur)
  let pending: ' ' | '>' | null = null
  for (const t of tokens) {
    if (t === '+' || t === '~') return null
    if (t === '>') {
      pending = '>'
      continue
    }
    const p = parseCompound(t)
    if (!p) return null
    if (parts.length) combs.push(pending || ' ')
    pending = null
    parts.push(p.c)
    spec += p.spec
  }
  return parts.length ? { parts, combs, spec } : null
}

function compoundMatches(c: Compound, el: CssEl, isRoot: boolean): boolean {
  if (c.root && !isRoot) return false
  if (c.tag && c.tag !== el.tag) return false
  for (const id of c.ids) if (el.id !== id) return false
  for (const cl of c.classes) if (!el.classes.has(cl)) return false
  for (const list of c.nots) if (list.some((n) => compoundMatches(n, el, isRoot))) return false
  for (const a of c.anyOf) if (!a.list.some((n) => compoundMatches(n, el, isRoot))) return false
  return true
}

function matchAt(s: ParsedSelector, pi: number, chain: CssEl[], ei: number): boolean {
  if (!compoundMatches(s.parts[pi], chain[ei], ei === 0 && chain[0].tag === 'html')) return false
  if (pi === 0) return true
  if (s.combs[pi - 1] === '>') return ei > 0 && matchAt(s, pi - 1, chain, ei - 1)
  for (let j = ei - 1; j >= 0; j--) if (matchAt(s, pi - 1, chain, j)) return true
  return false
}

// ── cascade ─────────────────────────────────────────────────────────────────

interface Decl {
  prop: string
  value: string
  important: boolean
}

function parseDecls(body: string): Decl[] {
  const out: Decl[] = []
  for (const part of splitTop(body, ';')) {
    const k = part.indexOf(':')
    if (k <= 0) continue
    const prop = part.slice(0, k).trim()
    let value = part.slice(k + 1).trim()
    const important = /!\s*important\s*$/i.test(value)
    if (important) value = value.replace(/!\s*important\s*$/i, '').trim()
    out.push({ prop: prop.startsWith('--') ? prop : prop.toLowerCase(), value, important })
  }
  return out
}

const WATCHED = /^(?:color|background|background-color|font-family|--)/

interface Winner {
  value: string
  imp: boolean
  spec: number
  order: number
}

function beats(cand: Winner, best: Winner): boolean {
  if (cand.imp !== best.imp) return cand.imp
  return cand.spec > best.spec || (cand.spec === best.spec && cand.order >= best.order)
}

export class CssCascade {
  /** กฎแยกตาม property — ค้นเฉพาะกฎที่ประกาศ property นั้นจริง */
  private byProp = new Map<string, Array<{ selectors: ParsedSelector[]; decl: Decl; order: number }>>()

  constructor(rules: CssRule[]) {
    rules.forEach((r, order) => {
      const decls = parseDecls(r.body).filter((d) => WATCHED.test(d.prop))
      if (!decls.length) return
      const selectors = splitTop(r.selector, ',')
        .map(parseSelector)
        .filter((s): s is ParsedSelector => !!s)
      if (!selectors.length) return
      // property เดียวกันซ้ำในกฎเดียว — ตัวหลังชนะ (ยกเว้นตัวหน้าเป็น !important)
      const last = new Map<string, Decl>()
      for (const d of decls) {
        const prev = last.get(d.prop)
        if (!prev || d.important || !prev.important) last.set(d.prop, d)
      }
      last.forEach((decl, prop) => {
        const list = this.byProp.get(prop) || []
        list.push({ selectors, decl, order })
        this.byProp.set(prop, list)
      })
    })
  }

  /** กฎที่ชนะของ property บน element สุดท้ายใน chain (ไม่รวมการสืบทอด) */
  private winner(chain: CssEl[], prop: string): Winner | null {
    let best: Winner | null = null
    const ei = chain.length - 1
    for (const r of this.byProp.get(prop) || []) {
      const d = r.decl
      let spec = -1
      for (const s of r.selectors) if (s.spec > spec && matchAt(s, s.parts.length - 1, chain, ei)) spec = s.spec
      if (spec < 0) continue
      const cand = { value: d.value, imp: d.important, spec, order: r.order }
      if (!best || beats(cand, best)) best = cand
    }
    return best
  }

  /** ค่าที่ชนะของ property บน element สุดท้ายใน chain (ไม่รวมการสืบทอด) */
  declared(chain: CssEl[], prop: string): string | null {
    return this.winner(chain, prop)?.value ?? null
  }

  /** ค่าตัวแปร CSS ที่ element เห็น (ตัวแปรสืบทอดจากบรรพบุรุษ) */
  variable(chain: CssEl[], name: string, depth = 0): string | null {
    for (let i = chain.length; i > 0; i--) {
      const v = this.declared(chain.slice(0, i), name)
      if (v !== null) return depth > 6 ? v : this.resolve(v, chain.slice(0, i), depth + 1)
    }
    return null
  }

  resolve(value: string, chain: CssEl[], depth = 0): string {
    let out = value
    for (let n = 0; n < 4 && out.includes('var('); n++) {
      out = out.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g, (all, name: string, fb?: string) => {
        const v = depth > 6 ? null : this.variable(chain, name, depth + 1)
        return v ?? fb?.trim() ?? ''
      })
    }
    return out.trim()
  }

  /** ค่าที่ใช้จริงของ property ที่สืบทอดได้ (color, font-family) */
  inherited(chain: CssEl[], prop: 'color' | 'font-family'): { value: string; at: number } | null {
    for (let i = chain.length; i > 0; i--) {
      const sub = chain.slice(0, i)
      const raw = this.declared(sub, prop)
      if (raw === null) continue
      const v = this.resolve(raw, sub)
      if (!v || /^(?:inherit|unset|currentcolor)$/i.test(v)) continue
      return { value: v, at: i - 1 }
    }
    return null
  }

  /** สีพื้นของ element (ไม่สืบทอด) — null = ไม่ได้ตั้ง/โปร่งใส */
  background(chain: CssEl[]): string | null {
    // background (shorthand) กับ background-color — ใช้ตัวที่ชนะตาม cascade จริง
    const a = this.winner(chain, 'background-color')
    const b = this.winner(chain, 'background')
    const win = a && b ? (beats(b, a) ? b : a) : a || b
    if (!win) return null
    const v = this.resolve(win.value, chain)
    const color = firstColor(v)
    if (color) return color === 'transparent' ? null : color
    return null
  }
}

// ── colors ──────────────────────────────────────────────────────────────────

const NAMED: Record<string, string> = {
  white: '#ffffff', black: '#000000', red: '#ff0000', green: '#008000', blue: '#0000ff', gray: '#808080', grey: '#808080',
  silver: '#c0c0c0', navy: '#000080', teal: '#008080', maroon: '#800000', orange: '#ffa500', yellow: '#ffff00',
  purple: '#800080', whitesmoke: '#f5f5f5', gainsboro: '#dcdcdc', lightgray: '#d3d3d3', lightgrey: '#d3d3d3',
  darkgray: '#a9a9a9', darkgrey: '#a9a9a9', dimgray: '#696969', dimgrey: '#696969',
}

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')

function hslToHex(h: number, s: number, l: number): string {
  s /= 100
  l /= 100
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return `#${hex2(f(0) * 255)}${hex2(f(8) * 255)}${hex2(f(4) * 255)}`
}

/** แปลงสี CSS หนึ่งค่าเป็น #rrggbb — alpha ต่ำกว่า 0.15 ถือว่าโปร่งใส ('transparent'), อ่านไม่ออก = null */
export function toHex(raw: string): string | null {
  const v = raw.trim().toLowerCase()
  if (v === 'transparent') return 'transparent'
  if (NAMED[v]) return NAMED[v]
  let m: RegExpExecArray | null
  if ((m = /^#([0-9a-f]{3,8})$/.exec(v))) {
    const h = m[1]
    if (h.length === 3 || h.length === 4) {
      if (h.length === 4 && parseInt(h[3] + h[3], 16) / 255 < 0.15) return 'transparent'
      return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`
    }
    if (h.length === 6) return `#${h}`
    if (h.length === 8) return parseInt(h.slice(6), 16) / 255 < 0.15 ? 'transparent' : `#${h.slice(0, 6)}`
    return null
  }
  if ((m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(v))) {
    if (m[4] !== undefined) {
      const a = m[4].endsWith('%') ? Number(m[4].slice(0, -1)) / 100 : Number(m[4])
      if (a < 0.15) return 'transparent'
    }
    return `#${hex2(+m[1])}${hex2(+m[2])}${hex2(+m[3])}`
  }
  if ((m = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(v))) {
    if (m[4] !== undefined) {
      const a = m[4].endsWith('%') ? Number(m[4].slice(0, -1)) / 100 : Number(m[4])
      if (a < 0.15) return 'transparent'
    }
    return hslToHex(+m[1], +m[2], +m[3])
  }
  return null
}

/** สีตัวแรกในค่า shorthand เช่น background: #fff url(...) no-repeat */
function firstColor(v: string): string | null {
  const direct = toHex(v)
  if (direct) return direct
  if (/gradient\(|url\(/i.test(v)) return null
  const tokens = v.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\b[a-z]+\b/gi) || []
  for (const t of tokens) {
    const c = toHex(t)
    if (c) return c
  }
  return null
}

/** ความสว่างสัมพัทธ์ (0 = ดำ, 1 = ขาว) */
export function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return 1
  const ch = [0, 2, 4].map((i) => {
    const c = parseInt(m[1].slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}

export function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
