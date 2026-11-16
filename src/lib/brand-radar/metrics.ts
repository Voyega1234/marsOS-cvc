/**
 * Brand Radar — pure metric engine. No database, no network.
 * Rule: a metric that cannot be computed is null, never 0.
 */
import {
  PROMPT_INTENT_LABEL, PROMPT_INTENTS, PROVIDERS, PROVIDER_KEYS,
  type CitationOwner, type CompetitorInsightsDTO, type EntityShare, type CitedDomainRow, type Kpis,
  type OverviewDTO, type Priority, type PromptDetailDTO, type PromptIntent, type PromptStats, type ProviderKey, type TrendPoint,
} from './types'

export interface RespRow {
  id: string; runId: string; promptId: string; provider: ProviderKey; collectedAt: Date | null
  brandMentioned: boolean | null; brandOccurrences: number | null; brandRecommended: boolean | null; ownedCited: boolean | null; citationCount: number | null
}
export interface MentionRow {
  responseId: string; runId: string; promptId: string; provider: ProviderKey; entityType: 'brand' | 'competitor'
  entityKey: string; competitorId: string | null; entityName: string; occurrences: number; recommended: boolean; compared: boolean; position: number | null
}
export interface CitationRow {
  responseId: string; runId: string; promptId: string; provider: ProviderKey; url: string; normalizedUrl: string
  domain: string; title: string; ownerType: CitationOwner; competitorId: string | null; createdAt: Date | null
}
export interface PromptLite { id: string; text: string; topic: string; intent: PromptIntent; searchVolume: number | null; priority: Priority }
export interface CompLite { id: string; name: string }
export interface RunLite { id: string; startedAt: Date; promptSetHash: string; providers: string }
/** `responses` contains ONLY collected answers (status DONE). Mentions/citations belong to those responses. */
export interface Dataset {
  brandName: string; responses: RespRow[]; mentions: MentionRow[]; citations: CitationRow[]; prompts: PromptLite[]; competitors: CompLite[]
}

const NO_TOPIC = '(no topic)'

// ── Basics ───────────────────────────────────────────────────────────────────

export function rate(n: number, d: number): number | null {
  return d > 0 ? n / d : null
}

/**
 * 95% Wilson score interval for k successes out of n asks. Unlike "p ± 1.96·SE" it never leaves
 * 0..1 and stays honest at 0% or 100% with few asks. null when n is 0 (no data, not 0%).
 */
export function wilsonInterval(k: number, n: number, z = 1.96): { low: number; high: number } | null {
  if (!(n > 0) || k < 0 || k > n) return null
  const p = k / n
  const z2 = z * z
  const denom = 1 + z2 / n
  const center = (p + z2 / (2 * n)) / denom
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) }
}

export function shareOfVoice(brandMentions: number, competitorMentions: number[]): number | null {
  const denom = brandMentions + competitorMentions.reduce((a, b) => a + b, 0)
  return denom > 0 ? brandMentions / denom : null
}

export function filterDataset(ds: Dataset, keep: (r: RespRow) => boolean): Dataset {
  const responses = ds.responses.filter(keep)
  const ids = new Set(responses.map((r) => r.id))
  return {
    ...ds,
    responses,
    mentions: ds.mentions.filter((m) => ids.has(m.responseId)),
    citations: ds.citations.filter((c) => ids.has(c.responseId)),
  }
}

function compIdOf(m: { competitorId: string | null; entityKey: string }): string {
  return m.competitorId ?? m.entityKey
}

/** competitor id -> distinct response ids mentioning it (only competitors listed in ds.competitors) */
function competitorResponseSets(ds: Dataset): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const c of ds.competitors) out.set(c.id, new Set())
  for (const m of ds.mentions) {
    if (m.entityType !== 'competitor') continue
    out.get(compIdOf(m))?.add(m.responseId)
  }
  return out
}

function promptRate(rs: RespRow[]): number | null {
  return rate(rs.filter((r) => r.brandMentioned === true).length, rs.length)
}

function groupBy<T, K>(items: T[], key: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>()
  for (const it of items) {
    const k = key(it)
    const arr = m.get(k)
    if (arr) arr.push(it); else m.set(k, [it])
  }
  return m
}

// ── KPIs ─────────────────────────────────────────────────────────────────────

export function computeKpis(ds: Dataset, monitoringPrompts: number): Kpis {
  const responses = ds.responses.length
  const brandMentions = ds.responses.filter((r) => r.brandMentioned === true).length
  const brandOccurrences = ds.responses.reduce((a, r) => a + (r.brandOccurrences ?? 0), 0)
  const citationCount = ds.citations.filter((c) => c.ownerType === 'own').length
  const ownedCited = ds.responses.filter((r) => r.ownedCited === true).length
  const anyComp = new Set<string>()
  for (const m of ds.mentions) if (m.entityType === 'competitor') anyComp.add(m.responseId)
  const perComp = Array.from(competitorResponseSets(ds).values()).map((s) => s.size)

  const byPrompt = groupBy(ds.responses, (r) => r.promptId)
  let num = 0
  let den = 0
  let feeding = 0
  for (const p of ds.prompts) {
    const v = p.searchVolume
    const rs = byPrompt.get(p.id)
    if (v === null || v === undefined || !(v > 0) || !rs || rs.length === 0) continue
    num += v * (promptRate(rs) ?? 0)
    den += v
    feeding++
  }

  let last: number | null = null
  for (const r of ds.responses) {
    if (r.collectedAt && (last === null || r.collectedAt.getTime() > last)) last = r.collectedAt.getTime()
  }

  return {
    responses,
    brandMentions,
    mentionRate: rate(brandMentions, responses),
    brandOccurrences,
    citationCount,
    citationRate: rate(ownedCited, responses),
    competitorMentionRate: rate(anyComp.size, responses),
    shareOfVoice: shareOfVoice(brandMentions, perComp),
    brandRecommended: ds.responses.filter((r) => r.brandRecommended === true).length,
    estimatedVisibility: den > 0 ? num / den : null,
    estimatedVisibilityPrompts: feeding,
    monitoringPrompts,
    lastScanAt: last === null ? null : new Date(last).toISOString(),
  }
}

// ── Entities ─────────────────────────────────────────────────────────────────

function mean(xs: number[]): number | null {
  return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length
}

export function entityShares(ds: Dataset): EntityShare[] {
  const total = ds.responses.length
  const brandRows = ds.mentions.filter((m) => m.entityType === 'brand')
  const brandMentions = ds.responses.filter((r) => r.brandMentioned === true).length
  const ownCitedResp = new Set(ds.citations.filter((c) => c.ownerType === 'own').map((c) => c.responseId))
  const brand: EntityShare = {
    entityType: 'brand',
    key: 'brand',
    name: ds.brandName,
    mentions: brandMentions,
    mentionRate: rate(brandMentions, total),
    recommended: ds.responses.filter((r) => r.brandRecommended === true).length,
    cited: ownCitedResp.size,
    occurrences: ds.responses.reduce((a, r) => a + (r.brandOccurrences ?? 0), 0),
    avgPosition: mean(brandRows.map((m) => m.position).filter((p): p is number => p !== null)),
  }

  const comps: EntityShare[] = ds.competitors.map((c) => {
    const rows = ds.mentions.filter((m) => m.entityType === 'competitor' && compIdOf(m) === c.id)
    const mentioned = new Set(rows.map((m) => m.responseId))
    const recommended = new Set(rows.filter((m) => m.recommended).map((m) => m.responseId))
    const cited = new Set(ds.citations.filter((x) => x.competitorId === c.id).map((x) => x.responseId))
    return {
      entityType: 'competitor' as const,
      key: c.id,
      name: c.name,
      mentions: mentioned.size,
      mentionRate: rate(mentioned.size, total),
      recommended: recommended.size,
      cited: cited.size,
      occurrences: rows.reduce((a, m) => a + m.occurrences, 0),
      avgPosition: mean(rows.map((m) => m.position).filter((p): p is number => p !== null)),
    }
  })
  comps.sort((a, b) => b.mentions - a.mentions)
  return [brand, ...comps]
}

export function promptStatsMap(ds: Dataset): Map<string, PromptStats> {
  const out = new Map<string, PromptStats>()
  const respByPrompt = groupBy(ds.responses, (r) => r.promptId)
  const mentionsByPrompt = groupBy(ds.mentions.filter((m) => m.entityType === 'competitor'), (m) => m.promptId)
  for (const p of ds.prompts) {
    const rs = respByPrompt.get(p.id) ?? []
    const brandMentions = rs.filter((r) => r.brandMentioned === true).length
    const ownedCited = rs.filter((r) => r.ownedCited === true).length
    let topCompetitor: PromptStats['topCompetitor'] = null
    if (rs.length > 0) {
      const sets = new Map<string, Set<string>>()
      for (const m of mentionsByPrompt.get(p.id) ?? []) {
        const id = compIdOf(m)
        const comp = ds.competitors.find((c) => c.id === id)
        if (!comp) continue
        if (!sets.has(id)) sets.set(id, new Set())
        sets.get(id)!.add(m.responseId)
      }
      for (const c of ds.competitors) {
        const n = sets.get(c.id)?.size ?? 0
        if (n > 0 && (!topCompetitor || n / rs.length > topCompetitor.mentionRate)) {
          topCompetitor = { id: c.id, name: c.name, mentionRate: n / rs.length }
        }
      }
    }
    let last: number | null = null
    for (const r of rs) if (r.collectedAt && (last === null || r.collectedAt.getTime() > last)) last = r.collectedAt.getTime()
    out.set(p.id, {
      responses: rs.length,
      brandMentions,
      mentionRate: rate(brandMentions, rs.length),
      brandRecommended: rs.filter((r) => r.brandRecommended === true).length,
      ownedCited,
      citationRate: rate(ownedCited, rs.length),
      topCompetitor,
      lastCollectedAt: last === null ? null : new Date(last).toISOString(),
    })
  }
  return out
}

// ── Trend ────────────────────────────────────────────────────────────────────

const BANGKOK_MS = 7 * 3600_000

function shortDate(d: Date): string {
  const b = new Date(d.getTime() + BANGKOK_MS)
  return `${String(b.getUTCDate()).padStart(2, '0')}/${String(b.getUTCMonth() + 1).padStart(2, '0')}`
}

function runsWithData(ds: Dataset, runs: RunLite[]): Array<{ run: RunLite; sub: Dataset }> {
  const sorted = [...runs].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
  const out: Array<{ run: RunLite; sub: Dataset }> = []
  for (const run of sorted) {
    const sub = filterDataset(ds, (r) => r.runId === run.id)
    if (sub.responses.length > 0) out.push({ run, sub })
  }
  return out
}

export function trendByRun(ds: Dataset, runs: RunLite[]): TrendPoint[] {
  if (runs.length === 0) return []
  const newest = runs.reduce((a, b) => (b.startedAt.getTime() > a.startedAt.getTime() ? b : a))
  return runsWithData(ds, runs).map(({ run, sub }) => {
    const k = computeKpis(sub, 0)
    return {
      runId: run.id,
      date: run.startedAt.toISOString(),
      label: shortDate(run.startedAt),
      responses: k.responses,
      mentionRate: k.mentionRate,
      citationRate: k.citationRate,
      shareOfVoice: k.shareOfVoice,
      comparable: run.promptSetHash === newest.promptSetHash && run.providers === newest.providers,
    }
  })
}

// ── Breakdowns ───────────────────────────────────────────────────────────────

export function byProvider(ds: Dataset): OverviewDTO['byProvider'] {
  const out: OverviewDTO['byProvider'] = []
  for (const key of PROVIDER_KEYS) {
    const sub = filterDataset(ds, (r) => r.provider === key)
    if (sub.responses.length === 0) continue
    const k = computeKpis(sub, 0)
    out.push({
      provider: key, label: PROVIDERS[key].label, method: PROVIDERS[key].method,
      responses: k.responses, mentionRate: k.mentionRate, citationRate: k.citationRate, shareOfVoice: k.shareOfVoice,
    })
  }
  return out
}

export function byIntent(ds: Dataset): OverviewDTO['byIntent'] {
  const intentOf = new Map(ds.prompts.map((p) => [p.id, p.intent]))
  const out: OverviewDTO['byIntent'] = []
  for (const intent of PROMPT_INTENTS) {
    const rs = ds.responses.filter((r) => intentOf.get(r.promptId) === intent)
    if (rs.length === 0) continue
    out.push({
      intent, label: PROMPT_INTENT_LABEL[intent],
      prompts: new Set(rs.map((r) => r.promptId)).size,
      responses: rs.length, mentionRate: promptRate(rs),
    })
  }
  return out
}

function topicOf(ds: Dataset): Map<string, string> {
  return new Map(ds.prompts.map((p) => [p.id, p.topic.trim() === '' ? NO_TOPIC : p.topic]))
}

export function byTopic(ds: Dataset): OverviewDTO['byTopic'] {
  const tmap = topicOf(ds)
  const groups = groupBy(ds.responses.filter((r) => tmap.has(r.promptId)), (r) => tmap.get(r.promptId)!)
  const out: OverviewDTO['byTopic'] = []
  for (const [topic, rs] of Array.from(groups.entries())) {
    const owned = rs.filter((r) => r.ownedCited === true).length
    out.push({
      topic, prompts: new Set(rs.map((r) => r.promptId)).size, responses: rs.length,
      mentionRate: promptRate(rs), citationRate: rate(owned, rs.length),
    })
  }
  return out.sort((a, b) => b.responses - a.responses || a.topic.localeCompare(b.topic))
}

function providerShort(key: ProviderKey): string {
  return PROVIDERS[key].label.replace(/\s*\(.*\)\s*$/, '')
}

export function topicProviderHeat(ds: Dataset): OverviewDTO['heat'] {
  const topics = byTopic(ds).slice(0, 12).map((t) => t.topic)
  const tmap = topicOf(ds)
  const providers = PROVIDER_KEYS.filter((k) => ds.responses.some((r) => r.provider === k))
  const values = topics.map((topic) =>
    providers.map((prov) => promptRate(ds.responses.filter((r) => r.provider === prov && tmap.get(r.promptId) === topic))),
  )
  return { rows: topics, columns: providers.map(providerShort), values }
}

export function citationOwners(ds: Dataset): OverviewDTO['citationOwners'] {
  const owners: CitationOwner[] = ['own', 'competitor', 'external']
  return owners.map((ownerType) => ({ ownerType, citations: ds.citations.filter((c) => c.ownerType === ownerType).length }))
}

// ── Cited domains ────────────────────────────────────────────────────────────

interface DomainAgg { row: CitedDomainRow; responseIds: Set<string> }

function domainAggregates(ds: Dataset): DomainAgg[] {
  const compName = new Map(ds.competitors.map((c) => [c.id, c.name]))
  const out: DomainAgg[] = []
  for (const [domain, cs] of Array.from(groupBy(ds.citations, (c: CitationRow) => c.domain).entries())) {
    const responseIds = new Set(cs.map((c) => c.responseId))
    const ownerType: CitationOwner = cs.some((c) => c.ownerType === 'own') ? 'own'
      : cs.some((c) => c.ownerType === 'competitor') ? 'competitor' : 'external'
    const compId = ownerType === 'competitor' ? (cs.find((c) => c.ownerType === 'competitor' && c.competitorId)?.competitorId ?? null) : null
    const urls = Array.from(groupBy(cs, (c: CitationRow) => c.normalizedUrl).values()).map((group) => ({
      url: group[0].url, title: group.find((g) => g.title)?.title ?? '', count: group.length,
    })).sort((a, b) => b.count - a.count || a.url.localeCompare(b.url)).slice(0, 5)
    const provs = new Set(cs.map((c) => c.provider))
    let last: number | null = null
    for (const c of cs) if (c.createdAt && (last === null || c.createdAt.getTime() > last)) last = c.createdAt.getTime()
    out.push({
      responseIds,
      row: {
        domain, ownerType, competitorId: compId, competitorName: compId ? (compName.get(compId) ?? '') : '',
        citations: cs.length, responses: responseIds.size, prompts: new Set(cs.map((c) => c.promptId)).size,
        urls, providers: PROVIDER_KEYS.filter((k) => provs.has(k)),
        lastSeenAt: last === null ? null : new Date(last).toISOString(),
        vendor: null, isOwnPbn: false,
      },
    })
  }
  return out.sort((a, b) => b.row.responses - a.row.responses || b.row.citations - a.row.citations || a.row.domain.localeCompare(b.row.domain))
}

export function citedDomains(ds: Dataset): CitedDomainRow[] {
  return domainAggregates(ds).map((a) => a.row)
}

export function citationGapDomains(ds: Dataset): CitedDomainRow[] {
  const ownedResp = new Set(ds.responses.filter((r) => r.ownedCited === true).map((r) => r.id))
  return domainAggregates(ds)
    .filter((a) => a.row.ownerType !== 'own' && !Array.from(a.responseIds).some((id) => ownedResp.has(id)))
    .map((a) => a.row)
}

// ── Competitor insights ──────────────────────────────────────────────────────

export function headToHead(ds: Dataset): CompetitorInsightsDTO['headToHead'] {
  const byPrompt = groupBy(ds.responses, (r) => r.promptId)
  const brandOn = new Set<string>()
  for (const [pid, rs] of Array.from(byPrompt.entries())) if (rs.some((r) => r.brandMentioned === true)) brandOn.add(pid)
  const compOn = new Map<string, Set<string>>() // competitor id -> prompt ids
  for (const c of ds.competitors) compOn.set(c.id, new Set())
  for (const m of ds.mentions) if (m.entityType === 'competitor') compOn.get(compIdOf(m))?.add(m.promptId)
  const promptIds = Array.from(byPrompt.keys())
  return ds.competitors.map((c) => {
    let both = 0, onlyC = 0, onlyB = 0, neither = 0
    for (const pid of promptIds) {
      const b = brandOn.has(pid)
      const k = compOn.get(c.id)!.has(pid)
      if (b && k) both++
      else if (k) onlyC++
      else if (b) onlyB++
      else neither++
    }
    return { competitorId: c.id, name: c.name, bothMentioned: both, onlyCompetitor: onlyC, onlyBrand: onlyB, neither }
  })
}

export function competitorTrend(ds: Dataset, runs: RunLite[]): CompetitorInsightsDTO['trend'] {
  const points = runsWithData(ds, runs)
  const series: CompetitorInsightsDTO['trend'] = [
    { key: 'brand', name: ds.brandName, points: points.map(({ run, sub }) => ({ runId: run.id, label: shortDate(run.startedAt), mentionRate: promptRate(sub.responses) })) },
  ]
  for (const c of ds.competitors) {
    series.push({
      key: c.id, name: c.name,
      points: points.map(({ run, sub }) => {
        const ids = competitorResponseSets(sub).get(c.id)
        return { runId: run.id, label: shortDate(run.startedAt), mentionRate: rate(ids?.size ?? 0, sub.responses.length) }
      }),
    })
  }
  return series
}

export function competitorByTopic(ds: Dataset): CompetitorInsightsDTO['byTopic'] {
  const topics = byTopic(ds).slice(0, 10).map((t) => t.topic)
  const tmap = topicOf(ds)
  const names = [ds.brandName, ...ds.competitors.map((c) => c.name)]
  const compSets = competitorResponseSets(ds)
  const values: Array<Array<number | null>> = [
    topics.map((t) => promptRate(ds.responses.filter((r) => tmap.get(r.promptId) === t))),
    ...ds.competitors.map((c) =>
      topics.map((t) => {
        const rs = ds.responses.filter((r) => tmap.get(r.promptId) === t)
        return rate(rs.filter((r) => compSets.get(c.id)?.has(r.id)).length, rs.length)
      }),
    ),
  ]
  return { rows: names, columns: topics, values }
}

export function competitorDomains(ds: Dataset): CompetitorInsightsDTO['domains'] {
  return ds.competitors.map((c) => {
    const cs = ds.citations.filter((x) => x.competitorId === c.id)
    const domains = Array.from(groupBy(cs, (x: CitationRow) => x.domain).entries())
      .map(([domain, g]) => ({ domain, citations: g.length }))
      .sort((a, b) => b.citations - a.citations || a.domain.localeCompare(b.domain))
      .slice(0, 10)
    return { competitorId: c.id, name: c.name, domains }
  })
}

export function promptEntityTrend(ds: Dataset, runs: RunLite[]): PromptDetailDTO['trend'] {
  return runsWithData(ds, runs).map(({ run, sub }) => {
    const total = sub.responses.length
    const sets = Array.from(competitorResponseSets(sub).values())
    return {
      runId: run.id,
      date: run.startedAt.toISOString(),
      responses: total,
      brandMentionRate: promptRate(sub.responses),
      topCompetitorRate: sets.length === 0 ? null : rate(Math.max(...sets.map((s) => s.size)), total),
    }
  })
}
