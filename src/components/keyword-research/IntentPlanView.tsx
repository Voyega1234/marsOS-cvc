'use client';

/**
 * แสดงผล Keyword Intent Skill — กลุ่มคีย์เวิร์ด (1 กลุ่ม = 1 URL) จัดเป็น Topic Cluster
 * ใช้ร่วมกันทั้ง WordGodOnlinePanel และ WordGodLocalPanel
 * ถ้ามี researchId จะยิง PATCH /api/wordgod/intent-skill ตอนติ๊ก/ถอนอนุมัติ (optimistic + revert เมื่อพลาด)
 */

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import type {
  FitVerdict,
  IntentMix,
  IntentSkillResult,
  IntentSkillRowFields,
  KeywordGroup,
} from '@/lib/wordgod/intent-skill/types';
import { PAGE_TYPE_LABEL_TH } from '@/lib/wordgod/intent-skill/handoff';

export interface IntentPlanRow {
  keyword: string;
  isk?: IntentSkillRowFields;
}

interface Props {
  result: IntentSkillResult;
  rows?: IntentPlanRow[];
  researchId?: string;
  onApprovalsChange?: (groups: KeywordGroup[]) => void;
}

const INTENT_STYLE: Record<string, string> = {
  I: 'border-blue-200 bg-blue-50 text-blue-700',
  C: 'border-amber-200 bg-amber-50 text-amber-700',
  T: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  N: 'border-slate-200 bg-slate-100 text-slate-600',
};
const INTENT_LABEL: Record<string, string> = {
  I: 'Informational', C: 'Commercial', T: 'Transactional', N: 'Navigational',
};

/** ป้าย intent — I ฟ้า, C เหลือง, T เขียว, N เทา, ผสม (I/C, I/T, C/T) โชว์ label ตรง ๆ */
export function IntentBadge({ mix }: { mix: IntentMix }) {
  const isSingle = mix.length === 1;
  const style = isSingle ? (INTENT_STYLE[mix] ?? '') : 'border-violet-200 bg-violet-50 text-violet-700';
  const title = isSingle ? (INTENT_LABEL[mix] ?? mix) : `ผสม ${mix}`;
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${style}`} title={title}>
      {mix}
    </span>
  );
}

const FIT_STYLE: Record<FitVerdict, string> = {
  FIT: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  ARTICLE_ONLY: 'border-amber-200 bg-amber-50 text-amber-700',
  NOT_RECOMMENDED: 'border-red-200 bg-red-50 text-red-700',
};
const FIT_LABEL: Record<FitVerdict, string> = {
  FIT: 'FIT',
  ARTICLE_ONLY: 'บทความเท่านั้น',
  NOT_RECOMMENDED: 'ไม่แนะนำ',
};

/** ป้าย Fit — FIT เขียว, ARTICLE_ONLY เหลือง "บทความเท่านั้น", NOT_RECOMMENDED แดง "ไม่แนะนำ" */
export function FitBadge({ fit, remark }: { fit: FitVerdict; remark?: string }) {
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${FIT_STYLE[fit]}`} title={remark}>
      {FIT_LABEL[fit]}
    </span>
  );
}

function fmtInt(v: number | null): string {
  return typeof v === 'number' ? v.toLocaleString('th-TH') : '—';
}

export default function IntentPlanView({ result, rows, researchId, onApprovalsChange }: Props) {
  const [approvals, setApprovals] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(result.groups.map(g => [g.id, g.approved]))
  );
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [pendingGroupId, setPendingGroupId] = useState<string | null>(null);

  const groupsByCluster = useMemo(() => {
    const map = new Map<string, KeywordGroup[]>();
    for (const g of result.groups) {
      const list = map.get(g.clusterId) ?? [];
      list.push(g);
      map.set(g.clusterId, list);
    }
    return map;
  }, [result.groups]);

  const groupsById = useMemo(() => new Map(result.groups.map(g => [g.id, g])), [result.groups]);

  const approvedCount = result.groups.filter(g => approvals[g.id]).length;
  const taggedRows = rows?.filter(r => r.isk).length ?? null;

  function toggleCluster(id: string): void {
    setExpandedClusters(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleGroupKeywords(id: string): void {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function toggleApproval(group: KeywordGroup): Promise<void> {
    const current = approvals[group.id] ?? group.approved;
    const next = !current;
    const prevApprovals = approvals;
    const nextApprovals = { ...approvals, [group.id]: next };
    setApprovals(nextApprovals);
    onApprovalsChange?.(result.groups.map(g => (g.id === group.id ? { ...g, approved: next } : g)));

    if (!researchId) return;
    setPendingGroupId(group.id);
    try {
      const res = await fetch('/api/wordgod/intent-skill', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ researchId, approvals: { [group.id]: next } }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) throw new Error(json?.error || 'อัปเดตการอนุมัติไม่สำเร็จ');
    } catch (error) {
      setApprovals(prevApprovals);
      onApprovalsChange?.(result.groups);
      toast.error(error instanceof Error ? error.message : 'อัปเดตการอนุมัติไม่สำเร็จ');
    } finally {
      setPendingGroupId(null);
    }
  }

  return (
    <div className="space-y-4 p-4">
      {/* Stats chips */}
      <div className="flex flex-wrap gap-2 text-[11px]">
        <span className="rounded-lg border border-[#dbe1ee] bg-white px-2.5 py-1.5 font-semibold text-[#17233a]">กลุ่ม {result.stats.groups.toLocaleString('th-TH')}</span>
        <span className="rounded-lg border border-[#dbe1ee] bg-white px-2.5 py-1.5 font-semibold text-[#17233a]">Cluster {result.stats.clusters.toLocaleString('th-TH')}</span>
        <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 font-semibold text-emerald-700">FIT {result.stats.fit.toLocaleString('th-TH')}</span>
        <span className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 font-semibold text-amber-700">บทความเท่านั้น {result.stats.articleOnly.toLocaleString('th-TH')}</span>
        <span className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 font-semibold text-red-700">ไม่แนะนำ {result.stats.notRecommended.toLocaleString('th-TH')}</span>
        <span className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 font-semibold text-blue-700">ให้คนตรวจ {result.stats.needsReview.toLocaleString('th-TH')}</span>
        <span className="rounded-lg border border-[#17233a]/20 bg-[#17233a] px-2.5 py-1.5 font-semibold text-white">
          อนุมัติแล้ว {approvedCount.toLocaleString('th-TH')}/{result.groups.length.toLocaleString('th-TH')}
        </span>
        {taggedRows !== null ? (
          <span className="rounded-lg border border-[#dbe1ee] bg-white px-2.5 py-1.5 font-semibold text-[#71809c]">คำที่ผ่าน skill {taggedRows.toLocaleString('th-TH')}</span>
        ) : null}
      </div>

      {/* Warnings */}
      {result.warnings.length > 0 ? (
        <details className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
          <summary className="cursor-pointer font-bold">คำเตือนจาก Intent Skill ({result.warnings.length})</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </details>
      ) : null}

      {/* Clusters */}
      <div className="space-y-2">
        {result.clusters.map(cluster => {
          const groups = groupsByCluster.get(cluster.id) ?? [];
          const open = expandedClusters.has(cluster.id);
          const pillar = groupsById.get(cluster.pillarGroupId);
          return (
            <div key={cluster.id} className="rounded-xl border border-[#dbe1ee] bg-white">
              <button
                type="button"
                onClick={() => toggleCluster(cluster.id)}
                className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left"
              >
                <span className="text-[11px] font-bold text-[#155eef]">{open ? '▾' : '▸'}</span>
                <span className="text-sm font-bold text-[#17233a]">{cluster.name}</span>
                <span className="text-[11px] text-[#91a0b8]">/{cluster.section}</span>
                <span className="text-[11px] text-[#495975]">{groups.length.toLocaleString('th-TH')} กลุ่ม</span>
                {pillar ? <span className="text-[11px] text-[#71809c]">Pillar: <span className="font-semibold text-[#17233a]">{pillar.head}</span></span> : null}
                <span className="text-[11px] text-[#71809c]">Pillar Intent: <IntentBadge mix={cluster.pillarIntent} /></span>

                {/* intent mix bar */}
                <span className="ml-auto flex items-center gap-2">
                  <span className="flex h-2 w-32 overflow-hidden rounded-full bg-[#eef1f7]">
                    <span className="h-full bg-blue-400" style={{ width: `${cluster.mix.I}%` }} title={`Informational ${cluster.mix.I}%`} />
                    <span className="h-full bg-amber-400" style={{ width: `${cluster.mix.C}%` }} title={`Commercial ${cluster.mix.C}%`} />
                    <span className="h-full bg-emerald-400" style={{ width: `${cluster.mix.T}%` }} title={`Transactional ${cluster.mix.T}%`} />
                    <span className="h-full bg-slate-300" style={{ width: `${cluster.mix.N}%` }} title={`Navigational ${cluster.mix.N}%`} />
                  </span>
                  <span className="text-[10px] text-[#91a0b8]">{cluster.mix.I}%I · {cluster.mix.C}%C · {cluster.mix.T}%T · {cluster.mix.N}%N</span>
                </span>
              </button>

              {cluster.gaps.length > 0 ? (
                <div className="border-t border-amber-100 bg-amber-50 px-4 py-2 text-[11px] text-amber-800">
                  {cluster.gaps.join(' · ')}
                </div>
              ) : null}

              {open ? (
                <div className="overflow-x-auto border-t border-[#eef1f7]">
                  <table className="w-full min-w-[1100px] text-left text-xs">
                    <thead>
                      <tr className="border-b border-[#eef1f7] text-[10px] uppercase tracking-wide text-[#91a0b8]">
                        <th className="px-3 py-2">อนุมัติ</th>
                        <th className="px-3 py-2">Keyword Group</th>
                        <th className="px-3 py-2">Highest SV</th>
                        <th className="px-3 py-2">Keywords</th>
                        <th className="px-3 py-2">Intent</th>
                        <th className="px-3 py-2">Page Type</th>
                        <th className="px-3 py-2">Tier</th>
                        <th className="px-3 py-2">Slug</th>
                        <th className="px-3 py-2">Page Title</th>
                        <th className="px-3 py-2">Remark</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map(group => {
                        const approved = approvals[group.id] ?? group.approved;
                        const kwOpen = expandedGroups.has(group.id);
                        return (
                          <tr key={group.id} className="border-b border-[#f4f6fb] align-top">
                            <td className="px-3 py-2.5">
                              <input
                                type="checkbox"
                                checked={approved}
                                disabled={pendingGroupId === group.id}
                                onChange={() => toggleApproval(group)}
                              />
                            </td>
                            <td className="max-w-[200px] px-3 py-2.5">
                              <p className="truncate font-semibold text-[#17233a]" title={group.head}>{group.head}</p>
                              {group.needsReview ? (
                                <span className="mt-1 inline-block rounded bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold text-blue-700">ให้คนตรวจ</span>
                              ) : null}
                            </td>
                            <td className="px-3 py-2.5 tabular-nums">{fmtInt(group.highestSv)}</td>
                            <td className="max-w-[220px] px-3 py-2.5">
                              <button type="button" onClick={() => toggleGroupKeywords(group.id)} className="text-[11px] font-semibold text-[#155eef]">
                                {group.keywords.length.toLocaleString('th-TH')} คำ {kwOpen ? '▾' : '▸'}
                              </button>
                              {kwOpen ? (
                                <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto text-[10px] text-[#495975]">
                                  {group.keywords.map(k => <li key={k} className="truncate" title={k}>{k}</li>)}
                                </ul>
                              ) : null}
                            </td>
                            <td className="px-3 py-2.5"><IntentBadge mix={group.intent} /></td>
                            <td className="px-3 py-2.5 text-[#495975]">{PAGE_TYPE_LABEL_TH[group.pageType] ?? group.pageType}</td>
                            <td className="px-3 py-2.5 text-[#495975]">{group.tier}</td>
                            <td className="max-w-[160px] truncate px-3 py-2.5 font-mono text-[11px] text-[#495975]" title={group.nestedSlug}>/{group.nestedSlug}</td>
                            <td className="max-w-[220px] truncate px-3 py-2.5 text-[#374763]" title={group.pageTitle}>{group.pageTitle}</td>
                            <td className="max-w-[220px] px-3 py-2.5">
                              <FitBadge fit={group.fit} remark={group.remark} />
                              <p className="mt-1 truncate text-[10px] text-[#91a0b8]" title={group.remark}>{group.remark}</p>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
