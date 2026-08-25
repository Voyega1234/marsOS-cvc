/**
 * WordGod Online — บันทึกสถานะ handoff ลง canonical run
 *
 * POST /api/wordgod/online-research/handoff
 * body: { researchId: string, keywords: string[], status?: 'SELECTED' | 'SENT_TO_KEYWORDS' }
 *
 * ใช้หลังจาก panel ส่งคำที่เลือกเข้า Keyword Page ผ่าน API เดิม
 * (/api/projects/[id]/keyword-bank) สำเร็จแล้ว — route นี้แค่อัปเดต
 * handoffStatus ของแถวใน resultData เพื่อให้ UI/Excel/handoff
 * อ่าน canonical dataset ชุดเดียวกันเสมอ ไม่สร้างข้อมูลใหม่
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import type { OnlineResearchResponse } from '@/lib/wordgod/online/types';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
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
  const researchId = typeof body.researchId === 'string' ? body.researchId : '';
  const keywords: string[] = Array.isArray(body.keywords)
    ? body.keywords.map((k: unknown) => String(k ?? '').trim()).filter(Boolean)
    : [];
  const status = body.status === 'SELECTED' ? 'SELECTED' : 'SENT_TO_KEYWORDS';
  if (!researchId || keywords.length === 0) {
    return NextResponse.json({ error: 'ต้องระบุ researchId และ keywords อย่างน้อย 1 คำ' }, { status: 400 });
  }

  const run = await prisma.localKeywordResearchRun.findUnique({ where: { id: researchId } });
  if (!run || run.organizationId !== orgId || run.mode !== 'online_business') {
    return NextResponse.json({ error: 'ไม่พบผลการวิจัยนี้' }, { status: 404 });
  }
  if (run.status === 'running') {
    return NextResponse.json({ error: 'run นี้ยังประมวลผลไม่เสร็จ' }, { status: 409 });
  }

  let data: OnlineResearchResponse;
  try {
    data = JSON.parse(run.resultData);
  } catch {
    return NextResponse.json({ error: 'ข้อมูลผลการวิจัยเสียหาย' }, { status: 500 });
  }

  const wanted = new Set(keywords.map(k => k.toLowerCase()));
  let updated = 0;
  for (const r of data.results ?? []) {
    if (wanted.has(r.keyword.trim().toLowerCase())) {
      r.handoffStatus = status;
      updated++;
    }
  }
  if (updated > 0) {
    await prisma.localKeywordResearchRun.update({
      where: { id: researchId },
      data: { resultData: JSON.stringify(data) },
    });
  }
  return NextResponse.json({ updated, status });
}
