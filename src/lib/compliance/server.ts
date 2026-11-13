/** Compliance — helper ฝั่งเซิร์ฟเวอร์ร่วมของทุก route */
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { RuleLite, RuleType, Severity } from './types'

export interface StaffCtx { orgId: string; userId: string; role: string }

/** ไม่มี organizationId → 401, role CLIENT → 403 */
export async function requireStaff(): Promise<StaffCtx | NextResponse> {
  const session = await getSession()
  const u = session?.user
  if (!u?.organizationId || !u.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (u.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return { orgId: u.organizationId, userId: u.id, role: String(u.role) }
}

export function parseJsonArray(s: string | null | undefined): unknown[] {
  try {
    const v = JSON.parse(s || '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export function parseJsonObject(s: string | null | undefined): Record<string, unknown> {
  try {
    const v = JSON.parse(s || '{}')
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export function parseTermsJson(s: string | null | undefined): string[] {
  return parseJsonArray(s).filter((t): t is string => typeof t === 'string')
}

interface RuleRow {
  id: string
  version: number
  industry: string
  code: string
  title: string
  description: string
  ruleType: string
  terms: string
  severity: string
  guidance: string
  sourceName: string
  sourceUrl: string
  sourceRef: string
  effectiveDate: Date | null
}

export function toRuleLite(row: RuleRow): RuleLite {
  return {
    id: row.id,
    version: row.version,
    industry: row.industry,
    code: row.code,
    title: row.title,
    description: row.description,
    ruleType: row.ruleType as RuleType,
    terms: parseTermsJson(row.terms),
    severity: row.severity as Severity,
    guidance: row.guidance,
    sourceName: row.sourceName,
    sourceUrl: row.sourceUrl,
    sourceRef: row.sourceRef,
    effectiveDate: row.effectiveDate ? row.effectiveDate.toISOString().slice(0, 10) : null,
  }
}

export async function audit(params: {
  orgId: string
  actorId: string
  action: string
  checkId?: string | null
  ruleId?: string | null
  detail?: Record<string, unknown>
}): Promise<void> {
  try {
    await prisma.complianceAuditLog.create({
      data: {
        organizationId: params.orgId,
        actorId: params.actorId,
        action: params.action,
        checkId: params.checkId ?? null,
        ruleId: params.ruleId ?? null,
        detail: JSON.stringify(params.detail ?? {}),
      },
    })
  } catch (err) {
    console.error('[compliance] audit failed:', err)
  }
}

/** id → ชื่อผู้ใช้ (เฉพาะ id ที่ระบุ) */
export async function userNames(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const uniq = Array.from(new Set(ids.filter((x): x is string => !!x)))
  if (!uniq.length) return new Map()
  const users = await prisma.user.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true, email: true } })
  return new Map(users.map((u) => [u.id, u.name || u.email || u.id]))
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
