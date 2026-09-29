// ─── Upload Article — โหลดบทความในระบบมาแปลงเป็นลิงก์ภายใน (ฝั่งเซิร์ฟเวอร์ ใช้ prisma) ──────────
// PBN Backlinks (pushPrefs.kind === 'pbn') ไม่เอาบทความมาเป็นลิงก์อัตโนมัติ — คนละเว็บ คนละโดเมน

import { prisma } from '@/lib/prisma'
import { isPbnPrefs } from './pbn'
import { articleLinkPairs, articleLinkRows, type ArticleLinkRow } from './internal-links'
import type { UploadKeyword, UploadLinkPair } from './types'

function readPlan(prefs: Record<string, unknown> | null): UploadKeyword[] {
  const raw = prefs?.keywordPlan
  return Array.isArray(raw) ? (raw as UploadKeyword[]) : []
}

/** บทความทั้งหมดของลูกค้านี้ (ใหม่สุดก่อน สูงสุด 500 แถว) แปลงเป็นรายการลิงก์ภายใน — PBN คืน [] เสมอ */
export async function loadArticleLinkRows(
  clientId: string,
  orgId: string,
  prefs: Record<string, unknown> | null,
): Promise<ArticleLinkRow[]> {
  if (isPbnPrefs(prefs)) return []
  const rows = await prisma.uploadArticle.findMany({
    where: { clientId, organizationId: orgId },
    select: { id: true, title: true, sourceName: true, status: true, pushMode: true, wordpressUrl: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 500,
  })
  return articleLinkRows(rows, readPlan(prefs))
}

/** เฉพาะคู่ลิงก์ที่เผยแพร่แล้วจริง — ใช้เติม pool ตอนเขียน/ generate บทความ */
export async function loadArticleLinkPairs(
  clientId: string,
  orgId: string,
  prefs: Record<string, unknown> | null,
): Promise<UploadLinkPair[]> {
  return articleLinkPairs(await loadArticleLinkRows(clientId, orgId, prefs))
}
