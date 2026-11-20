// Widget kit for the glass theme, in Convert Cake colours: gauge, target bar,
// status strip, share bar, action rows, tinted KPI tiles, check chips, heat grid.
// Everything here is presentational and hook-free, so server and client
// components can both import it. Hover detail uses the native `title` tooltip
// for the same reason.
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Check, ChevronRight, Minus, X } from 'lucide-react'

export type Tone = 'blue' | 'green' | 'amber' | 'red' | 'gray'

// Severity fills for meters and status cells. Blue is the neutral accent;
// green, amber and red are reserved for state and never used as a plain series.
export const TONE_HEX: Record<Tone, string> = {
  blue: '#1d48f3',
  green: '#16a34a',
  amber: '#f59e0b',
  red: '#ef4444',
  gray: '#94a3b8',
}

// Empty track of meters and gauges; a CSS var so it follows the colour mode (globals.css).
export const TRACK = 'var(--chart-track)'

// Categorical order for identity (donut slices, share segments). Checked with the
// dataviz palette validator against the light surface: lightness band, chroma,
// colour-blind separation and 3:1 contrast all pass. Assign in this order and
// never cycle; a seventh category folds into OTHER_COLOR.
export const CATEGORICAL = ['#1d48f3', '#d97706', '#0d9488', '#7c3aed', '#e11d48', '#0891b2']
export const OTHER_COLOR = '#94a3b8'

// One-hue ramp for magnitude (heat cells), light to dark.
export const RAMP = ['#eff3fe', '#dde6fc', '#b9c9f9', '#8ea8f5', '#6b8cef', '#3a62f5', '#1d48f3', '#0618df', '#000E3F']

const PASTEL: Record<Tone, string> = {
  blue: 'bg-blue-100 text-blue-700',
  green: 'bg-green-100 text-green-700',
  amber: 'bg-amber-100 text-amber-700',
  red: 'bg-red-100 text-red-700',
  gray: 'bg-gray-100 text-gray-600',
}

const clamp = (n: number, lo = 0, hi = 100) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo)

export interface Figure {
  label: string
  value: ReactNode
}

/** Row of small labelled figures under a widget (the "3 numbers" footer). */
export function FigureRow({ figures, className = '' }: { figures: Figure[]; className?: string }) {
  if (figures.length === 0) return null
  return (
    <div
      className={`grid divide-x divide-gray-100 border-t border-gray-100 pt-3 ${className}`}
      style={{ gridTemplateColumns: `repeat(${figures.length}, minmax(0, 1fr))` }}
    >
      {figures.map((f, i) => (
        <div key={i} className="px-3 first:pl-0 last:pr-0 min-w-0">
          <div className="text-xs text-gray-500 truncate">{f.label}</div>
          <div className="text-sm font-semibold text-gray-900 mt-0.5 truncate">{f.value}</div>
        </div>
      ))}
    </div>
  )
}

/**
 * Half-circle gauge with a needle. `pct` is the position on the dial (0 to 100);
 * `marker` draws a tick for a limit or target on the same scale.
 */
export function Gauge({
  pct,
  tone = 'blue',
  value,
  caption,
  marker,
  footer,
  ariaLabel,
}: {
  pct: number
  tone?: Tone
  value: ReactNode
  caption?: ReactNode
  marker?: number
  footer?: Figure[]
  ariaLabel?: string
}) {
  const p = clamp(pct)
  const angle = Math.PI * (1 - p / 100)
  const tipX = 100 + 58 * Math.cos(angle)
  const tipY = 100 - 58 * Math.sin(angle)
  const m = marker == null ? null : Math.PI * (1 - clamp(marker) / 100)
  return (
    <div>
      <svg viewBox="0 0 200 112" className="mx-auto block w-full max-w-[260px]" role="img" aria-label={ariaLabel ?? `${Math.round(p)}%`}>
        <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" style={{ stroke: TRACK }} strokeWidth={16} strokeLinecap="round" />
        {p > 0 && (
          <path
            d="M 20 100 A 80 80 0 0 1 180 100"
            fill="none"
            stroke={TONE_HEX[tone]}
            strokeWidth={16}
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={`${p} 100`}
          />
        )}
        {m != null && (
          <line
            x1={100 + 66 * Math.cos(m)}
            y1={100 - 66 * Math.sin(m)}
            x2={100 + 94 * Math.cos(m)}
            y2={100 - 94 * Math.sin(m)}
            style={{ stroke: 'var(--chart-ink)' }}
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        )}
        <line x1={100} y1={100} x2={tipX} y2={tipY} style={{ stroke: 'var(--chart-ink)' }} strokeWidth={3} strokeLinecap="round" />
        <circle cx={100} cy={100} r={7} style={{ fill: 'var(--chart-ink)' }} />
        <circle cx={100} cy={100} r={2.5} fill="#fff" />
      </svg>
      <div className="mt-1 text-center">
        <div className="text-3xl font-bold tracking-tight text-gray-900">{value}</div>
        {caption && <div className="mt-0.5 text-xs text-gray-500">{caption}</div>}
      </div>
      {footer && footer.length > 0 && <FigureRow figures={footer} className="mt-4" />}
    </div>
  )
}

/**
 * Horizontal bar with an optional limit marker. `value`, `target` and `max` share
 * one scale; pass tone="red" when the value is past the limit.
 */
export function TargetBar({
  value,
  max,
  target,
  targetLabel,
  tone = 'blue',
  size = 'md',
  title,
}: {
  value: number
  max: number
  target?: number | null
  targetLabel?: string
  tone?: Tone
  size?: 'sm' | 'md'
  title?: string
}) {
  const scale = max > 0 ? max : 1
  const v = clamp((value / scale) * 100)
  const t = target == null ? null : clamp((target / scale) * 100)
  // Keep the label inside the bar at either end.
  const labelAlign = t == null ? '' : t > 82 ? '-translate-x-full' : t < 18 ? '' : '-translate-x-1/2'
  return (
    <div title={title}>
      {t != null && targetLabel && (
        <div className="relative mb-1 h-4">
          <span className={`absolute whitespace-nowrap text-xs text-gray-500 ${labelAlign}`} style={{ left: `${t}%` }}>
            {targetLabel}
          </span>
        </div>
      )}
      <div className={`relative rounded-full ${size === 'sm' ? 'h-1.5' : 'h-2.5'}`} style={{ background: TRACK }}>
        {v > 0 && <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${v}%`, background: TONE_HEX[tone] }} />}
        {t != null && (
          <div className="absolute -bottom-1 -top-1 w-0.5 -translate-x-1/2 rounded-full" style={{ left: `${t}%`, background: 'var(--chart-ink)' }} />
        )}
      </div>
    </div>
  )
}

export interface StripCell {
  tone: Tone | 'empty'
  title?: string
}

/** Row of status cells (one per day, run or step) with a labelled legend. */
export function StatusStrip({
  cells,
  legend,
  className = '',
}: {
  cells: StripCell[]
  legend?: { tone: Tone | 'empty'; label: string }[]
  className?: string
}) {
  const fill = (tone: Tone | 'empty') => (tone === 'empty' ? TRACK : TONE_HEX[tone])
  return (
    <div className={className}>
      <div className="flex gap-0.5">
        {cells.map((c, i) => (
          <div key={i} title={c.title} className="h-7 min-w-[4px] flex-1 rounded-[4px]" style={{ background: fill(c.tone) }} />
        ))}
      </div>
      {legend && legend.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {legend.map((l, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 text-xs text-gray-500">
              <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: fill(l.tone) }} />
              {l.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export interface ShareItem {
  label: string
  value: number
  /** Formatted value shown at the right of the legend row. */
  valueLabel?: ReactNode
  color?: string
}

/** Segmented share bar with a legend list: name, share and value per part. */
export function ShareBar({ items, emptyText = '—' }: { items: ShareItem[]; emptyText?: string }) {
  const total = items.reduce((s, it) => s + (it.value > 0 ? it.value : 0), 0)
  if (total <= 0) return <div className="text-sm text-gray-500">{emptyText}</div>
  const colorOf = (it: ShareItem, i: number) => it.color ?? CATEGORICAL[i] ?? OTHER_COLOR
  const valueOf = (it: ShareItem) => it.valueLabel ?? it.value.toLocaleString()
  // One width for every value cell, sized to the longest value, so the names get the rest of the row.
  const valueWidth = `${Math.max(...items.map((it) => { const v = valueOf(it); return typeof v === 'string' || typeof v === 'number' ? String(v).length : 8 })) + 1}ch`
  return (
    <div>
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full">
        {items.map((it, i) =>
          it.value > 0 ? (
            <div
              key={i}
              title={`${it.label}: ${((it.value / total) * 100).toFixed(1)}%`}
              style={{ width: `${(it.value / total) * 100}%`, background: colorOf(it, i) }}
            />
          ) : null,
        )}
      </div>
      <ul className="mt-3 divide-y divide-gray-100">
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-2 py-2 text-sm">
            <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: colorOf(it, i) }} />
            <span className="min-w-0 flex-1 break-words leading-snug text-gray-700">{it.label}</span>
            <span className="w-14 shrink-0 text-right tabular-nums text-gray-500">{((Math.max(it.value, 0) / total) * 100).toFixed(1)}%</span>
            <span className="shrink-0 whitespace-nowrap text-right font-medium tabular-nums text-gray-900" style={{ minWidth: valueWidth }}>{valueOf(it)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** List wrapper for ActionRow. */
export function ActionList({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`divide-y divide-gray-100 ${className}`}>{children}</div>
}

/**
 * "Needs a decision" row: icon tile, title, one line of detail, then either
 * custom actions (`right`) or a chevron when the whole row is a link.
 */
export function ActionRow({
  icon,
  tone = 'blue',
  title,
  sub,
  right,
  href,
  external,
}: {
  icon: ReactNode
  tone?: Tone
  title: ReactNode
  sub?: ReactNode
  right?: ReactNode
  href?: string
  external?: boolean
}) {
  const body = (
    <>
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${PASTEL[tone]}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-gray-900">{title}</span>
        {sub && <span className="mt-0.5 block text-xs text-gray-500">{sub}</span>}
      </span>
    </>
  )
  if (href && !right) {
    const cls = 'flex items-center gap-3 px-1 py-3 rounded-xl hover:bg-gray-50 transition-colors'
    const chevron = <ChevronRight className="h-4 w-4 shrink-0 text-gray-500" />
    return external ? (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        {body}
        {chevron}
      </a>
    ) : (
      <Link href={href} className={cls}>
        {body}
        {chevron}
      </Link>
    )
  }
  return (
    <div className="flex items-center gap-3 px-1 py-3">
      {body}
      {right && <span className="flex shrink-0 flex-wrap items-center justify-end gap-2">{right}</span>}
    </div>
  )
}

const TILE: Record<'blue' | 'mint' | 'neutral' | 'amber' | 'red', string> = {
  blue: 'bg-sand-butter/70 border-white/60',
  mint: 'bg-sand-mint/70 border-white/60',
  neutral: 'bg-white border-gray-200',
  amber: 'bg-amber-50 border-amber-100',
  red: 'bg-red-50 border-red-100',
}

/**
 * Tinted KPI tile. `delta` is a percent change; `deltaGood` says whether the
 * change is good news (defaults to "up is good"). Children go under the value:
 * a Sparkline, a TargetBar or a short note.
 */
export function TintTile({
  tint = 'neutral',
  label,
  value,
  delta,
  deltaGood,
  sub,
  children,
  className = '',
}: {
  tint?: keyof typeof TILE
  label: ReactNode
  value: ReactNode
  delta?: number | null
  /** true = green, false = red, null = neutral gray (a change that is neither good nor bad, e.g. spend). Default: up is good. */
  deltaGood?: boolean | null
  sub?: ReactNode
  children?: ReactNode
  className?: string
}) {
  const good = deltaGood ?? (delta != null && delta >= 0)
  return (
    <div className={`rounded-2xl border p-4 ${TILE[tint]} ${className}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm text-gray-600">{label}</div>
        {delta != null && Number.isFinite(delta) && (
          <span className={`text-xs font-semibold ${deltaGood === null ? 'text-gray-500' : good ? 'text-green-600' : 'text-red-500'}`}>
            {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
          </span>
        )}
      </div>
      <div className="mt-1 text-2xl font-bold tracking-tight text-gray-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-gray-500">{sub}</div>}
      {children && <div className="mt-3">{children}</div>}
    </div>
  )
}

/** Tiny trend line for a tile. Shape only; the tile's number carries the value. */
export function Sparkline({
  values,
  color = '#1d48f3',
  fill = true,
  className = 'h-9 w-full',
}: {
  values: number[]
  color?: string
  fill?: boolean
  className?: string
}) {
  const pts = values.filter(v => Number.isFinite(v))
  if (pts.length < 2) return null
  const min = Math.min(...pts)
  const max = Math.max(...pts)
  const span = max - min || 1
  const xy = pts.map((v, i) => [(i / (pts.length - 1)) * 100, 30 - ((v - min) / span) * 26] as const)
  const line = xy.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ')
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className={className} aria-hidden="true">
      {fill && <path d={`${line} L100 32 L0 32 Z`} fill={color} opacity={0.12} />}
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export interface MiniBar {
  label: string
  value: number
  title?: string
}

/**
 * Small bar chart with one emphasised bar (the peak unless `highlight` is given)
 * and the rest in a pale step of the same hue.
 */
export function MiniBars({
  bars,
  highlight,
  labelEvery = 1,
  height = 96,
}: {
  bars: MiniBar[]
  highlight?: number
  labelEvery?: number
  height?: number
}) {
  if (bars.length === 0) return null
  const max = Math.max(...bars.map(b => b.value), 0) || 1
  const hi = highlight ?? bars.reduce((best, b, i) => (b.value > bars[best].value ? i : best), 0)
  return (
    <div>
      <div className="flex items-end gap-0.5" style={{ height }}>
        {bars.map((b, i) => (
          <div
            key={i}
            title={b.title ?? `${b.label}: ${b.value.toLocaleString()}`}
            className="min-w-[3px] flex-1 rounded-t-[4px]"
            style={{ height: `${Math.max((b.value / max) * 100, b.value > 0 ? 3 : 0)}%`, background: i === hi ? '#1d48f3' : '#b9c9f9' }}
          />
        ))}
      </div>
      <div className="mt-1 flex gap-0.5">
        {bars.map((b, i) => (
          <div key={i} className={`min-w-[3px] flex-1 truncate text-center text-xs ${i === hi ? 'font-semibold text-gray-900' : 'text-gray-500'}`}>
            {i % labelEvery === 0 || i === hi ? b.label : ''}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Round pass / fail / not-set chip for checklist tables. */
export function CheckChip({ state, title }: { state: 'ok' | 'bad' | 'none'; title?: string }) {
  const cls = state === 'ok' ? PASTEL.green : state === 'bad' ? PASTEL.red : PASTEL.gray
  const Icon = state === 'ok' ? Check : state === 'bad' ? X : Minus
  return (
    <span title={title} className={`inline-flex h-6 w-6 items-center justify-center rounded-full ${cls}`}>
      <Icon className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
      {title && <span className="sr-only">{title}</span>}
    </span>
  )
}

/** Pill with a dot: a status label, or a score such as "5/9". */
export function DotPill({ tone = 'gray', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${PASTEL[tone]}`}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: TONE_HEX[tone] }} />
      {children}
    </span>
  )
}

/** "n/total" score pill: green when complete, amber from half, red below. */
export function ScorePill({ done, total, title }: { done: number; total: number; title?: string }) {
  const tone: Tone = total <= 0 ? 'gray' : done >= total ? 'green' : done / total >= 0.5 ? 'amber' : 'red'
  return (
    <DotPill tone={tone} title={title}>
      <span className="tabular-nums">
        {done}/{total}
      </span>
    </DotPill>
  )
}

/** Small reason tag ("CPA สูง", "งบเกิน"). */
export function TagChip({ tone = 'gray', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${PASTEL[tone]}`}>{children}</span>
}

export interface UnderlineTab {
  key: string
  label: ReactNode
  count?: number
  href?: string
}

/**
 * Underline tabs with optional count badges. With `onSelect` the tabs are
 * buttons (client components only); with `href` on each item they are links.
 */
export function UnderlineTabs({
  tabs,
  active,
  onSelect,
  className = '',
}: {
  tabs: UnderlineTab[]
  active: string
  onSelect?: (key: string) => void
  className?: string
}) {
  return (
    <div className={`flex gap-5 overflow-x-auto border-b border-gray-200 ${className}`}>
      {tabs.map(t => {
        const on = t.key === active
        const cls = `-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-0.5 pb-2.5 pt-1 text-sm font-medium transition-colors ${
          on ? 'border-blue-600 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'
        }`
        const inner = (
          <>
            {t.label}
            {t.count != null && (
              <span className={`rounded-full px-1.5 text-xs tabular-nums ${on ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{t.count}</span>
            )}
          </>
        )
        return t.href ? (
          <Link key={t.key} href={t.href} className={cls} aria-current={on ? 'page' : undefined}>
            {inner}
          </Link>
        ) : (
          <button key={t.key} type="button" onClick={onSelect ? () => onSelect(t.key) : undefined} className={cls} aria-pressed={on}>
            {inner}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Lead block for a pacing section: one large number, a long progress bar with an
 * optional limit marker, and a row of supporting figures.
 */
export function HeroProgress({
  label,
  value,
  sub,
  pct,
  marker,
  markerLabel,
  tone = 'blue',
  figures,
}: {
  label: ReactNode
  value: ReactNode
  sub?: ReactNode
  pct: number
  marker?: number | null
  markerLabel?: string
  tone?: Tone
  figures?: Figure[]
}) {
  const p = clamp(pct)
  const m = marker == null ? null : clamp(marker)
  const fill = tone === 'blue' ? 'linear-gradient(90deg, #6b8cef, #1d48f3)' : TONE_HEX[tone]
  return (
    <div>
      <div className="text-sm text-gray-500">{label}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <div className="text-5xl font-bold tracking-tight text-gray-900">{value}</div>
        {sub && <div className="text-sm text-gray-500">{sub}</div>}
      </div>
      <div className="mt-4">
        {m != null && markerLabel && (
          <div className="relative mb-1 h-4">
            <span
              className={`absolute whitespace-nowrap text-xs text-gray-500 ${m > 82 ? '-translate-x-full' : m < 18 ? '' : '-translate-x-1/2'}`}
              style={{ left: `${m}%` }}
            >
              {markerLabel}
            </span>
          </div>
        )}
        <div className="relative h-3 rounded-full" style={{ background: TRACK }}>
          {p > 0 && <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${p}%`, background: fill }} />}
          {m != null && <div className="absolute -bottom-1 -top-1 w-0.5 -translate-x-1/2 rounded-full" style={{ left: `${m}%`, background: 'var(--chart-ink)' }} />}
        </div>
      </div>
      {figures && figures.length > 0 && <FigureRow figures={figures} className="mt-4" />}
    </div>
  )
}

/**
 * Heat grid: rows by columns, one blue ramp for magnitude. Values print inside
 * the cells when `showValues` is set (keep it off for dense grids such as
 * 7 days by 24 hours and rely on the tooltip).
 */
export function HeatGrid({
  rows,
  cols,
  values,
  format = v => v.toLocaleString(),
  showValues = false,
  lowLabel = 'น้อย',
  highLabel = 'มาก',
}: {
  rows: string[]
  cols: string[]
  values: number[][]
  format?: (v: number) => string
  showValues?: boolean
  lowLabel?: string
  highLabel?: string
}) {
  const max = Math.max(0, ...values.flat().filter(v => Number.isFinite(v))) || 1
  const step = (v: number) => (v > 0 ? Math.min(RAMP.length - 1, 1 + Math.floor((v / max) * (RAMP.length - 2) + 0.0001)) : 0)
  return (
    <div className="overflow-x-auto">
      <div className="inline-grid min-w-full gap-0.5" style={{ gridTemplateColumns: `auto repeat(${cols.length}, minmax(${showValues ? 30 : 16}px, 1fr))` }}>
        <div />
        {cols.map((c, i) => (
          <div key={i} className="pb-1 text-center text-xs text-gray-500">
            {c}
          </div>
        ))}
        {rows.map((r, ri) => (
          <div key={ri} className="contents">
            <div className="flex items-center whitespace-nowrap pr-2 text-xs text-gray-500">{r}</div>
            {cols.map((c, ci) => {
              const v = values[ri]?.[ci] ?? 0
              const s = step(v)
              return (
                <div
                  key={ci}
                  title={`${r} · ${c}: ${format(v)}`}
                  className={`flex h-8 items-center justify-center rounded-[5px] text-xs font-medium tabular-nums ${s >= 5 ? 'text-white' : 'text-gray-900'}`}
                  style={{ background: RAMP[s] }}
                >
                  {showValues ? format(v) : ''}
                </div>
              )
            })}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-xs text-gray-500">
        {lowLabel}
        {RAMP.map((c, i) => (
          <span key={i} className="h-2.5 w-4 rounded-[3px]" style={{ background: c }} />
        ))}
        {highLabel}
      </div>
    </div>
  )
}
