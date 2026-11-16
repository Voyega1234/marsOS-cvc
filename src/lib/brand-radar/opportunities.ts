/**
 * Brand Radar — opportunity engine (pure). Scoring follows OPPORTUNITY_SCORING in types.ts.
 * Keys are stable across scans so the server can upsert.
 */
import { PROVIDER_KEYS, PROVIDERS, type Confidence, type OpportunityType, type Priority, type ProviderKey } from './types'
import { citedDomains, type Dataset, type RespRow } from './metrics'

export interface OpportunityDraft {
  type: OpportunityType; key: string; title: string; detail: string; evidence: Record<string, string | number | null>
  priority: Priority; confidence: Confidence; score: number; suggestedAction: string
  promptId: string | null; domain: string | null; competitorId: string | null
}

const PRIORITY_WEIGHT: Record<Priority, number> = { high: 1, medium: 0.6, low: 0.3 }

export function scoreOpportunity(
  evidenceStrength: number, promptPriority: Priority | null, volume: number | null, maxVolume: number | null,
): number {
  const strength = Math.min(1, Math.max(0, evidenceStrength))
  const pw = promptPriority ? PRIORITY_WEIGHT[promptPriority] : 0.6
  const vw = volume === null || maxVolume === null || !(maxVolume > 0) || !(volume >= 0) ? 0.5 : Math.min(1, volume / maxVolume)
  const raw = 100 * (0.5 * strength + 0.3 * pw + 0.2 * vw)
  return Math.min(100, Math.max(0, Math.round(raw * 10) / 10))
}

export function confidenceFor(responses: number): Confidence {
  return responses >= 10 ? 'high' : responses >= 4 ? 'medium' : 'low'
}

function priorityFor(score: number): Priority {
  return score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low'
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`
}

export function buildOpportunities(ds: Dataset): OpportunityDraft[] {
  const out: OpportunityDraft[] = []
  const vols = ds.prompts.map((p) => p.searchVolume).filter((v): v is number => v !== null && v > 0)
  const maxVolume = vols.length > 0 ? Math.max(...vols) : null
  const compName = new Map(ds.competitors.map((c) => [c.id, c.name]))

  const respByPrompt = new Map<string, RespRow[]>()
  for (const r of ds.responses) {
    const a = respByPrompt.get(r.promptId)
    if (a) a.push(r); else respByPrompt.set(r.promptId, [r])
  }

  const push = (
    d: Omit<OpportunityDraft, 'priority' | 'score'> & { strength: number; promptPriority: Priority | null; volume: number | null },
  ) => {
    const { strength, promptPriority, volume, ...rest } = d
    const score = scoreOpportunity(strength, promptPriority, volume, maxVolume)
    out.push({ ...rest, score, priority: priorityFor(score) })
  }

  for (const p of ds.prompts) {
    const rs = respByPrompt.get(p.id)
    if (!rs || rs.length === 0) continue
    const n = rs.length
    const ids = new Set(rs.map((r) => r.id))
    const mentions = ds.mentions.filter((m) => ids.has(m.responseId))
    const citations = ds.citations.filter((c) => ids.has(c.responseId))
    const q = `"${p.text}"`
    const base = { promptPriority: p.priority, volume: p.searchVolume, promptId: p.id, domain: null as string | null }

    const brandResp = rs.filter((r) => r.brandMentioned === true).length
    const compMentions = mentions.filter((m) => m.entityType === 'competitor')
    const compResp = new Set(compMentions.map((m) => m.responseId))

    // top competitor by distinct responses
    const perComp = new Map<string, Set<string>>()
    for (const m of compMentions) {
      const id = m.competitorId ?? m.entityKey
      if (!perComp.has(id)) perComp.set(id, new Set())
      perComp.get(id)!.add(m.responseId)
    }
    let topId: string | null = null
    let topN = 0
    for (const [id, s] of Array.from(perComp.entries())) if (s.size > topN) { topId = id; topN = s.size }
    const nameOf = (id: string | null): string =>
      id === null ? '' : (compName.get(id) ?? compMentions.find((m) => (m.competitorId ?? m.entityKey) === id)?.entityName ?? '')

    // 1) missing_brand_mention
    if (brandResp === 0 && compResp.size > 0) {
      const strength = compResp.size / n
      const top = nameOf(topId)
      push({
        ...base, type: 'missing_brand_mention', key: p.id, competitorId: topId, strength,
        confidence: confidenceFor(n),
        title: `แบรนด์ไม่ถูกพูดถึงในคำถาม ${q}`,
        detail: `จาก ${n} คำตอบ ไม่มีคำตอบที่กล่าวถึงแบรนด์ แต่มี ${compResp.size} คำตอบ (${pct(strength)}) กล่าวถึงคู่แข่ง โดย ${top} ถูกกล่าวถึงมากที่สุด (${topN} คำตอบ)`,
        suggestedAction: `ลองพิจารณาตรวจเนื้อหาที่ตอบคำถามนี้ และดูว่า ${top} ถูกอ้างอิงจากแหล่งใด เพื่อวางแผนปรับเนื้อหาหรือหาแหล่งอ้างอิงที่เกี่ยวข้อง`,
        evidence: { responses: n, brandMentions: 0, competitorResponses: compResp.size, competitor: top, competitorMentions: topN, competitorRate: strength },
      })
    }

    // 2) citation_gap
    const compCitingResp = new Set(citations.filter((c) => c.ownerType === 'competitor').map((c) => c.responseId))
    const ownCitingResp = new Set([
      ...citations.filter((c) => c.ownerType === 'own').map((c) => c.responseId),
      ...rs.filter((r) => r.ownedCited === true).map((r) => r.id),
    ])
    if (compCitingResp.size > 0 && ownCitingResp.size === 0) {
      const strength = compCitingResp.size / n
      const cc = new Map<string, number>()
      for (const c of citations) if (c.ownerType === 'competitor') cc.set(c.domain, (cc.get(c.domain) ?? 0) + 1)
      const topDomain = Array.from(cc.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? ''
      const compCit = citations.find((c) => c.ownerType === 'competitor' && c.competitorId)
      push({
        ...base, type: 'citation_gap', key: p.id, competitorId: compCit?.competitorId ?? null, strength,
        confidence: confidenceFor(n),
        title: `คู่แข่งถูกอ้างอิงลิงก์ แต่โดเมนของเราไม่ถูกอ้างอิงในคำถาม ${q}`,
        detail: `จาก ${n} คำตอบ มี ${compCitingResp.size} คำตอบ (${pct(strength)}) อ้างอิงโดเมนของคู่แข่ง (เช่น ${topDomain}) และไม่มีคำตอบที่อ้างอิงโดเมนของเรา`,
        suggestedAction: 'ลองพิจารณาสร้างหรือปรับหน้าเว็บที่ตอบคำถามนี้โดยตรง และตรวจว่า AI เข้าถึงหน้านั้นได้',
        evidence: { responses: n, competitorCitingResponses: compCitingResp.size, ownCitingResponses: 0, topCompetitorDomain: topDomain, competitorCitationRate: strength },
      })
    }

    // 3) recommendation_gap
    const brandRec = rs.filter((r) => r.brandRecommended === true).length
    const compRecSet = new Set(compMentions.filter((m) => m.recommended).map((m) => m.responseId))
    if (compRecSet.size > brandRec) {
      const strength = (compRecSet.size - brandRec) / n
      const recPer = new Map<string, Set<string>>()
      for (const m of compMentions) {
        if (!m.recommended) continue
        const id = m.competitorId ?? m.entityKey
        if (!recPer.has(id)) recPer.set(id, new Set())
        recPer.get(id)!.add(m.responseId)
      }
      let recId: string | null = null
      let recN = 0
      for (const [id, s] of Array.from(recPer.entries())) if (s.size > recN) { recId = id; recN = s.size }
      const recName = nameOf(recId)
      push({
        ...base, type: 'recommendation_gap', key: p.id, competitorId: recId, strength,
        confidence: confidenceFor(n),
        title: `คู่แข่งถูกแนะนำมากกว่าแบรนด์ในคำถาม ${q}`,
        detail: `จาก ${n} คำตอบ คู่แข่งถูกแนะนำใน ${compRecSet.size} คำตอบ ส่วนแบรนด์ถูกแนะนำใน ${brandRec} คำตอบ (ผลการตรวจเป็นการประมาณจากคำที่อยู่ใกล้ชื่อ)`,
        suggestedAction: `ลองพิจารณาเทียบจุดเด่นของแบรนด์กับ ${recName} และเพิ่มข้อมูลที่ช่วยให้ AI อธิบายเหตุผลที่ควรเลือกแบรนด์`,
        evidence: { responses: n, brandRecommended: brandRec, competitorRecommended: compRecSet.size, competitor: recName, gapRate: strength },
      })
    }

    // 4) unlinked_mention
    if (brandResp > 0 && ownCitingResp.size === 0) {
      const strength = brandResp / n
      push({
        ...base, type: 'unlinked_mention', key: p.id, competitorId: null, strength,
        confidence: confidenceFor(n),
        title: `แบรนด์ถูกพูดถึงแต่ไม่มีลิงก์โดเมนของเราในคำถาม ${q}`,
        detail: `จาก ${n} คำตอบ แบรนด์ถูกกล่าวถึงใน ${brandResp} คำตอบ (${pct(strength)}) แต่ไม่มีคำตอบที่อ้างอิงโดเมนของเรา`,
        suggestedAction: 'ลองพิจารณาทำให้หน้าเว็บหลักที่เกี่ยวข้องชัดเจนและอ้างอิงได้ง่ายขึ้น เช่น มีข้อมูลตรงคำถามและ canonical URL ที่ถูกต้อง',
        evidence: { responses: n, brandMentions: brandResp, ownCitingResponses: 0, mentionRate: strength },
      })
    }
  }

  // 5) source_to_pitch
  const withCitation = new Set(ds.citations.map((c) => c.responseId)).size
  if (withCitation > 0) {
    for (const row of citedDomains(ds)) {
      if (row.ownerType !== 'external' || row.responses < 2) continue
      const strength = row.responses / withCitation
      push({
        type: 'source_to_pitch', key: row.domain, domain: row.domain, promptId: null, competitorId: null,
        promptPriority: null, volume: null, strength, confidence: confidenceFor(row.responses),
        title: `เว็บ ${row.domain} ถูกอ้างอิงบ่อยใน AI answers`,
        detail: `${row.domain} ถูกอ้างอิงใน ${row.responses} คำตอบ (${pct(strength)} ของคำตอบที่มีการอ้างอิง) จาก ${row.prompts} คำถาม`,
        suggestedAction: `ลองพิจารณาติดต่อเสนอเนื้อหาหรือซื้อลิงก์บนเว็บ ${row.domain} หลังตรวจคุณภาพและความเหมาะสมของเว็บแล้ว`,
        evidence: { domain: row.domain, citingResponses: row.responses, citations: row.citations, prompts: row.prompts, responsesWithCitations: withCitation, shareOfCitedResponses: strength },
      })
    }
  }

  // 6) weak_platform
  const providers: ProviderKey[] = PROVIDER_KEYS.filter((k) => ds.responses.some((r) => r.provider === k))
  for (const prov of providers) {
    const mine = ds.responses.filter((r) => r.provider === prov)
    const others = ds.responses.filter((r) => r.provider !== prov)
    if (mine.length < 5 || others.length < 5) continue
    const myRate = mine.filter((r) => r.brandMentioned === true).length / mine.length
    const otherRate = others.filter((r) => r.brandMentioned === true).length / others.length
    const gap = otherRate - myRate
    if (gap < 0.2 - 1e-9) continue
    const label = PROVIDERS[prov].label
    push({
      type: 'weak_platform', key: prov, domain: null, promptId: null, competitorId: null,
      promptPriority: null, volume: null, strength: gap, confidence: confidenceFor(mine.length),
      title: `แบรนด์ถูกพูดถึงน้อยบน ${label}`,
      detail: `อัตราการถูกกล่าวถึงบน ${label} คือ ${pct(myRate)} (${mine.length} คำตอบ) ต่ำกว่าแพลตฟอร์มอื่นรวมกันที่ ${pct(otherRate)} (${others.length} คำตอบ) อยู่ ${pct(gap)}`,
      suggestedAction: `ลองพิจารณาตรวจว่า ${label} ใช้แหล่งข้อมูลใดตอบคำถามกลุ่มนี้ และเทียบกับแพลตฟอร์มที่แบรนด์ถูกกล่าวถึงมากกว่า`,
      evidence: { provider: prov, responses: mine.length, mentionRate: myRate, otherResponses: others.length, otherMentionRate: otherRate, gap },
    })
  }

  return out.sort((a, b) => b.score - a.score || a.type.localeCompare(b.type) || a.key.localeCompare(b.key))
}
