/**
 * WordGod — Keyword Intent Skill approval endpoint
 *
 * PATCH /api/wordgod/intent-skill
 * body: { researchId: string, approvals: Record<string, boolean> }
 *
 * ใช้ตั้งค่า approve/unapprove ของแต่ละ Keyword Group ใน resultData.intentSkill
 * ของ research run ที่บันทึกไว้แล้ว (ทำงานได้ทั้งโหมด online_business และ local_storefront
 * เพราะทั้งคู่ใช้ LocalKeywordResearchRun ตัวเดียวกันและ resultData.intentSkill รูปแบบเดียวกัน)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import type { IntentSkillResult } from '@/lib/wordgod/intent-skill/types';

const MAX_APPROVALS = 2000;

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session!.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const researchId = typeof body?.researchId === 'string' ? body.researchId : '';
  if (!researchId) {
    return NextResponse.json({ error: 'ต้องระบุ researchId' }, { status: 400 });
  }
  const approvalsRaw = body?.approvals;
  if (!approvalsRaw || typeof approvalsRaw !== 'object' || Array.isArray(approvalsRaw)) {
    return NextResponse.json({ error: 'ต้องระบุ approvals เป็น object' }, { status: 400 });
  }
  const approvals = Object.entries(approvalsRaw as Record<string, unknown>).slice(0, MAX_APPROVALS);

  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const run = await prisma.localKeywordResearchRun.findFirst({ where: { id: researchId, organizationId: orgId } });
    if (!run) {
      return NextResponse.json({ error: 'ไม่พบผลการวิจัยนี้' }, { status: 404 });
    }
    if (run.status === 'running') {
      return NextResponse.json({ error: 'รอบนี้ยังประมวลผลอยู่' }, { status: 409 });
    }

    let data: any;
    try {
      data = JSON.parse(run.resultData);
    } catch {
      return NextResponse.json({ error: 'ข้อมูลผลการวิจัยเสียหาย' }, { status: 500 });
    }

    const intentSkill: IntentSkillResult | undefined = data?.intentSkill;
    if (!intentSkill) {
      return NextResponse.json({ error: 'run นี้ไม่มีผล Keyword Intent Skill' }, { status: 404 });
    }

    const groupsById = new Map(intentSkill.groups.map(g => [g.id, g] as const));
    for (const [groupId, value] of approvals) {
      const group = groupsById.get(groupId);
      if (!group) continue;
      group.approved = Boolean(value);
    }

    const results: Array<{ isk?: { groupId: string; approved: boolean } }> = Array.isArray(data?.results) ? data.results : [];
    for (const row of results) {
      const isk = row?.isk;
      if (!isk) continue;
      const group = groupsById.get(isk.groupId);
      if (!group) continue;
      isk.approved = group.approved;
    }

    intentSkill.quota = {
      ...intentSkill.quota,
      approved: intentSkill.groups.filter(g => g.approved).length,
    };
    data.intentSkill = intentSkill;

    const { count } = await prisma.localKeywordResearchRun.updateMany({
      where: { id: run.id, updatedAt: run.updatedAt },
      data: { resultData: JSON.stringify(data) },
    });
    if (count > 0) {
      return NextResponse.json({ ok: true, approved: intentSkill.quota.approved });
    }
    // มีการเขียนแทรกระหว่างนี้ — อ่านใหม่แล้วลองใหม่
  }

  return NextResponse.json({ error: 'มีการแก้ไขข้อมูลพร้อมกัน กรุณาลองใหม่อีกครั้ง' }, { status: 409 });
}
