/**
 * Competitor Gap — Keyword Opportunity Recommendation
 *
 * COMPETITOR GAP DECISION RULE (คำสั่งเจ้าของระบบ):
 * "คู่แข่งติดอันดับคำนี้ = หลักฐานว่ามีโอกาส ไม่ใช่หลักฐานว่าต้องสร้างหน้าใหม่"
 *
 * ชั้นนี้เอาแถว keyword gap ที่มีอยู่แล้วมาเทียบกับของเดิมของลูกค้า (คีย์เวิร์ด/หัวข้อ/หน้า
 * ที่บันทึกไว้ในโปรเจกต์ + คำที่เว็บเราติดอันดับอยู่จริง) ด้วย Keyword Guard ตัวเดียวกับ
 * หน้า Keyword Research แล้วสรุปว่าควรทำอะไรกับคำนั้น — ไม่มีการเรียก AI และไม่มีค่าใช้จ่าย
 */

import { KeywordGuard } from '@/lib/keyword-guard/guard'
import { SUB_INTENT_LABEL_TH } from '@/lib/keyword-guard/intent'
import type { GuardVerdict } from '@/lib/keyword-guard/types'
import type { KeywordGapResult, KeywordGapRow, KeywordOpportunityAction } from './types'

const VOLUME_CEILING = 10_000

function volumeScore(volume: number | null): number {
  if (volume === null || volume <= 0) return 0
  return Math.min(100, (Math.log10(volume + 1) / Math.log10(VOLUME_CEILING)) * 100)
}

/** ยิ่งเราอยู่ไกลหน้าแรก ช่องว่างยิ่งใหญ่ — คำที่เราติดท็อป 3 อยู่แล้วแทบไม่เหลือช่องว่าง */
function gapScore(ourPosition: number | null): number {
  if (ourPosition === null) return 100
  if (ourPosition > 20) return 80
  if (ourPosition > 10) return 60
  if (ourPosition > 3) return 35
  return 10
}

function intentBonus(verdict: GuardVerdict): number {
  switch (verdict.fingerprint.intent.primaryIntent) {
    case 'TRANSACTIONAL': return 15
    case 'COMMERCIAL': return 10
    default: return 0
  }
}

function decideAction(row: KeywordGapRow, verdict: GuardVerdict): { action: KeywordOpportunityAction; reasons: string[] } {
  const reasons = [...verdict.reasons]
  const weRank = row.ourPosition !== null
  const hasDemand = (row.searchVolume ?? 0) > 0

  if (verdict.decision === 'EXCLUDE') {
    return { action: 'IGNORE', reasons: [...reasons, 'อยู่ในรายการคำที่ไม่เอาของโปรเจกต์นี้แล้ว'] }
  }
  if (verdict.risk >= 80) {
    if (weRank) {
      reasons.push(`เว็บเราติดอันดับคำนี้อยู่แล้ว (อันดับ ${row.ourPosition}) — เสริมหน้าเดิมให้แข็งขึ้น ไม่สร้างหน้าใหม่`)
      return { action: 'ADD_TO_EXISTING', reasons }
    }
    if (verdict.match?.url) {
      reasons.push('มีหน้าเดิมรองรับคำนี้อยู่แล้ว — ผูกคำเข้ากับหน้าเดิมแทนการทำหน้าใหม่')
      return { action: 'MERGE_WITH_EXISTING_TOPIC', reasons }
    }
    reasons.push('ซ้ำกับคีย์เวิร์ดที่ลูกค้ามีอยู่แล้ว — เก็บเป็นคำเดิม ไม่ตั้งเป็นหัวข้อใหม่')
    return { action: 'ADD_TO_EXISTING_KEYWORDS', reasons }
  }
  if (verdict.risk >= 60) {
    if (weRank) return { action: 'ADD_TO_EXISTING', reasons }
    reasons.push('ความเสี่ยงกินกันเองอยู่ระดับ “น่าจะกิน” — ให้คนตัดสินก่อน ไม่สร้างหน้าใหม่อัตโนมัติ')
    return { action: 'NEEDS_REVIEW', reasons }
  }
  if (verdict.risk >= 40) {
    reasons.push('ความเสี่ยงอยู่ช่วงต้องตรวจ (40–59) — ตามกติกาให้ตรวจก่อนเสมอ')
    return { action: 'NEEDS_REVIEW', reasons }
  }

  // ความเสี่ยงต่ำ — ตัดสินจากสถานะการแข่งขันจริง
  if (row.state === 'WINNING' || row.state === 'DEFEND') {
    reasons.push('เรานำอยู่แล้ว — งานคือรักษาอันดับด้วยหน้าเดิม')
    return { action: 'ADD_TO_EXISTING', reasons }
  }
  if (weRank) {
    reasons.push(`เราติดอันดับ ${row.ourPosition} อยู่แล้ว — ดันหน้าเดิมคุ้มกว่าทำหน้าใหม่`)
    return { action: 'ADD_TO_EXISTING', reasons }
  }
  if (!hasDemand && row.competitorCoverage <= 1) {
    reasons.push('ไม่มี volume ยืนยันและคู่แข่งติดแค่เจ้าเดียว — ยังไม่คุ้มลงแรง')
    return { action: 'IGNORE', reasons }
  }
  reasons.push('คู่แข่งติดคำนี้แต่เรายังไม่มีอะไรรองรับ — ส่งเข้า Keyword Research เพื่อตรวจ intent/volume ให้ครบก่อนตัดสินว่าจะทำหน้าใหม่ไหม')
  return { action: 'SEND_TO_KEYWORD_RESEARCH', reasons }
}

export function annotateKeywordOpportunities(params: {
  gap: KeywordGapResult
  /** ชื่อโดเมนคู่แข่งเรียงตรงกับ row.competitorPositions */
  competitorDomains: string[]
  guard: KeywordGuard
}): KeywordGapResult {
  const { gap, competitorDomains, guard } = params
  if (!gap.available || gap.rows.length === 0) return gap

  const rows: KeywordGapRow[] = gap.rows.map(row => {
    const verdict = guard.evaluate(row.keyword)
    const { action, reasons } = decideAction(row, verdict)

    let bestDomain: string | null = null
    let best = Number.POSITIVE_INFINITY
    row.competitorPositions.forEach((p, i) => {
      if (p !== null && p < best) { best = p; bestDomain = competitorDomains[i] ?? null }
    })

    const raw =
      0.4 * volumeScore(row.searchVolume) +
      0.2 * Math.min(100, row.competitorCoverage * 33) +
      0.4 * gapScore(row.ourPosition) +
      intentBonus(verdict)
    const opportunityScore = Math.max(0, Math.min(100, Math.round(raw - verdict.risk * 0.4)))

    return {
      ...row,
      bestCompetitorDomain: bestDomain,
      guardIntent: SUB_INTENT_LABEL_TH[verdict.fingerprint.intent.subIntent],
      guardTopic: verdict.fingerprint.intent.topic,
      existingMatch: verdict.match?.keyword ?? null,
      existingUrl: verdict.match?.url ?? row.ourUrl ?? null,
      cannibalizationRisk: verdict.risk,
      opportunityScore,
      recommendedAction: action,
      actionReasons: reasons,
    }
  })

  return { ...gap, rows }
}
