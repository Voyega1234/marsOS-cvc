/**
 * /api/keyword-guard — Existing / Exclude Keywords + Handoff ระดับโปรเจกต์
 *
 * ใช้ร่วมกันสองหน้าเท่านั้น: Keyword Research (wordgod) และ Competitor Gap
 * ข้อมูลเก็บใน AppSetting (JSON) — ไม่มีตารางใหม่ ไม่มี migration
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  addHandoff,
  clearHandoff,
  loadHandoff,
  loadMemory,
  mergeExclude,
  mergeExisting,
  parseExcludeLines,
  parseExistingLines,
  removeExclude,
  removeExisting,
  saveMemory,
} from '@/lib/keyword-guard/store';
import type { ExcludeEntry, ExistingEntry, HandoffItem } from '@/lib/keyword-guard/types';

async function requireProject(projectId: string | null, orgId: string): Promise<boolean> {
  if (!projectId) return false;
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId: orgId } });
  return !!project;
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const projectId = req.nextUrl.searchParams.get('projectId');
  if (!(await requireProject(projectId, orgId))) return NextResponse.json({ error: 'ไม่พบโปรเจกต์' }, { status: 404 });

  const [memory, handoff] = await Promise.all([loadMemory(projectId), loadHandoff(projectId)]);
  return NextResponse.json({ memory, handoff });
}

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

  const projectId = body.projectId ? String(body.projectId) : null;
  if (!(await requireProject(projectId, orgId))) return NextResponse.json({ error: 'ไม่พบโปรเจกต์' }, { status: 404 });
  const action = String(body.action ?? '');
  const source = body.source ? String(body.source) : 'manual';

  const memory = await loadMemory(projectId);

  switch (action) {
    case 'add_existing': {
      const incoming: ExistingEntry[] = Array.isArray(body.entries)
        ? (body.entries as any[]).map(e => ({
            keyword: String(e?.keyword ?? '').trim(),
            url: e?.url ? String(e.url) : null,
            kind: (['keyword', 'topic', 'page', 'group', 'approved'].includes(e?.kind) ? e.kind : 'keyword') as ExistingEntry['kind'],
            source,
            addedAt: new Date().toISOString(),
          })).filter(e => e.keyword || e.url)
        : parseExistingLines(String(body.text ?? ''), 'keyword', source);
      memory.existing = mergeExisting(memory.existing, incoming);
      break;
    }
    case 'add_exclude': {
      const incoming: ExcludeEntry[] = Array.isArray(body.entries)
        ? (body.entries as any[]).map(e => ({
            keyword: String(e?.keyword ?? '').trim(),
            mode: (e?.mode === 'phrase' ? 'phrase' : 'exact') as ExcludeEntry['mode'],
            reason: e?.reason ? String(e.reason) : null,
            source,
            addedAt: new Date().toISOString(),
          })).filter(e => e.keyword)
        : parseExcludeLines(String(body.text ?? ''), source);
      memory.exclude = mergeExclude(memory.exclude, incoming);
      break;
    }
    case 'replace_existing':
      memory.existing = mergeExisting([], parseExistingLines(String(body.text ?? ''), 'keyword', source));
      break;
    case 'replace_exclude':
      memory.exclude = mergeExclude([], parseExcludeLines(String(body.text ?? ''), source));
      break;
    case 'remove_existing':
      memory.existing = removeExisting(memory.existing, (body.keywords ?? []).map((k: unknown) => String(k)));
      break;
    case 'remove_exclude':
      memory.exclude = removeExclude(memory.exclude, (body.keywords ?? []).map((k: unknown) => String(k)));
      break;
    case 'send_to_research': {
      const items: HandoffItem[] = (Array.isArray(body.items) ? body.items : []).map((i: any) => ({
        keyword: String(i?.keyword ?? '').trim(),
        source: 'competitor_gap' as const,
        competitor: i?.competitor ? String(i.competitor) : null,
        intent: i?.intent ? String(i.intent) : null,
        topic: i?.topic ? String(i.topic) : null,
        suggestedAction: i?.suggestedAction ? String(i.suggestedAction) : null,
        existingMatch: i?.existingMatch ? String(i.existingMatch) : null,
        existingUrl: i?.existingUrl ? String(i.existingUrl) : null,
        cannibalizationScore: Number.isFinite(Number(i?.cannibalizationScore)) ? Number(i.cannibalizationScore) : null,
        volume: Number.isFinite(Number(i?.volume)) ? Number(i.volume) : null,
        sentAt: new Date().toISOString(),
      })).filter((i: HandoffItem) => i.keyword);
      const handoff = await addHandoff(projectId!, items);
      return NextResponse.json({ ok: true, memory, handoff });
    }
    case 'clear_handoff': {
      const handoff = await clearHandoff(projectId!, Array.isArray(body.keywords) ? body.keywords.map((k: unknown) => String(k)) : undefined);
      return NextResponse.json({ ok: true, memory, handoff });
    }
    default:
      return NextResponse.json({ error: `ไม่รู้จัก action: ${action}` }, { status: 400 });
  }

  const saved = await saveMemory(projectId!, memory);
  if (!saved) return NextResponse.json({ error: 'บันทึกไม่สำเร็จ' }, { status: 500 });
  const handoff = await loadHandoff(projectId);
  return NextResponse.json({ ok: true, memory, handoff });
}
