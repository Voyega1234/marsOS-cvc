'use client';

/**
 * ช่องกรอก "คีย์เวิร์ด/หัวข้อที่มีอยู่แล้ว" และ "คีย์เวิร์ดที่ไม่เอา" ของหน้า Keyword Research
 *
 * - สองช่องนี้แยกกันเสมอ ห้ามรวมเป็นช่องเดียว (ความหมายต่างกัน)
 * - ข้อมูลผูกกับโปรเจกต์ ใช้ร่วมกับหน้า Competitor Gap ผ่าน /api/keyword-guard
 * - คำที่ Competitor Gap ส่งมา (handoff) แสดงให้กดใส่เป็นคำตั้งต้นได้
 */

import { useCallback, useEffect, useState } from 'react';
import type { ExcludeEntry, ExistingEntry, HandoffItem } from '@/lib/keyword-guard/types';

export function existingToText(entries: ExistingEntry[]): string {
  return entries
    .map(e => (e.keyword && e.url ? `${e.keyword} | ${e.url}` : e.url ? e.url : e.keyword))
    .filter(Boolean)
    .join('\n');
}

export function excludeToText(entries: ExcludeEntry[]): string {
  return entries
    .map(e => `${e.mode === 'phrase' ? '*' : ''}${e.keyword}${e.reason ? ` | ${e.reason}` : ''}`)
    .join('\n');
}

export function parseGuardLines(text: string): string[] {
  return text
    .split(/[\r\n]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

interface Props {
  projectId: string;
  existingText: string;
  onExistingText: (value: string) => void;
  excludeText: string;
  onExcludeText: (value: string) => void;
  /** เอาคำที่ Competitor Gap ส่งมาไปใส่เป็นคำตั้งต้นของรอบนี้ */
  onSeeds?: (keywords: string[]) => void;
  fieldClass?: string;
  labelClass?: string;
}

export default function KeywordMemoryFields({
  projectId,
  existingText,
  onExistingText,
  excludeText,
  onExcludeText,
  onSeeds,
  fieldClass = 'w-full rounded-xl border border-[#dbe1ee] px-3 py-2 text-sm',
  labelClass = 'mb-1 block text-[11px] font-semibold text-[#495975]',
}: Props) {
  const [handoff, setHandoff] = useState<HandoffItem[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/keyword-guard?projectId=${encodeURIComponent(projectId)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const existing: ExistingEntry[] = data?.memory?.existing ?? [];
        const exclude: ExcludeEntry[] = data?.memory?.exclude ?? [];
        // ไม่ทับสิ่งที่ผู้ใช้พิมพ์ค้างไว้ — เติมเฉพาะช่องที่ยังว่าง
        if (existing.length > 0) onExistingText(existingToText(existing));
        if (exclude.length > 0) onExcludeText(excludeToText(exclude));
        setHandoff(data?.handoff ?? []);
      } catch {
        /* โหลดไม่ได้ = ใช้ช่องว่าง ไม่ต้องขัดจังหวะผู้ใช้ */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
    // โหลดครั้งเดียวต่อโปรเจกต์
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const save = useCallback(async () => {
    setBusy(true);
    setStatus(null);
    try {
      for (const [action, text] of [['replace_existing', existingText], ['replace_exclude', excludeText]] as const) {
        const res = await fetch('/api/keyword-guard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId, action, text, source: 'keyword_research' }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setStatus('บันทึกเข้าโปรเจกต์แล้ว — หน้า Competitor Gap ใช้รายการเดียวกันนี้');
    } catch (e) {
      setStatus(`บันทึกไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [projectId, existingText, excludeText]);

  const useHandoff = useCallback(async () => {
    const keywords = handoff.map(h => h.keyword).filter(Boolean);
    if (keywords.length === 0) return;
    onSeeds?.(keywords);
    setBusy(true);
    try {
      await fetch('/api/keyword-guard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, action: 'clear_handoff' }),
      });
      setHandoff([]);
      setStatus(`ใส่คำจาก Competitor Gap ${keywords.length} คำเป็นคำตั้งต้นแล้ว`);
    } catch {
      setStatus('ล้างรายการส่งต่อไม่สำเร็จ — คำถูกใส่ในฟอร์มแล้ว');
    } finally {
      setBusy(false);
    }
  }, [handoff, onSeeds, projectId]);

  const existingCount = parseGuardLines(existingText).length;
  const excludeCount = parseGuardLines(excludeText).length;

  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>
          คีย์เวิร์ด/หัวข้อที่มีอยู่แล้ว ({existingCount.toLocaleString('th-TH')} บรรทัด) — บรรทัดละคำ ใส่ URL ได้ด้วยรูปแบบ <code>คีย์เวิร์ด | /url/</code>
        </label>
        <textarea
          rows={4}
          className={fieldClass}
          value={existingText}
          onChange={e => onExistingText(e.target.value)}
          placeholder={'รับทำ SEO | /services/seo\nSEO คืออะไร\n/blog/seo-guide'}
        />
        <p className="mt-1 text-[10px] text-[#91a0b8]">ระบบเทียบคำใหม่กับรายการนี้ก่อนสร้างกลุ่ม/หน้าใหม่เสมอ — ซ้ำมากจะกลายเป็น “รวม/ใช้เป็นคำรอง” แทนหน้าใหม่</p>
      </div>

      <div>
        <label className={labelClass}>
          คีย์เวิร์ดที่ไม่เอา ({excludeCount.toLocaleString('th-TH')} บรรทัด) — คนละช่องกับด้านบน ใส่ <code>*</code> นำหน้าเพื่อจับแบบวลี, ใส่เหตุผลด้วย <code>| เหตุผล</code>
        </label>
        <textarea
          rows={3}
          className={fieldClass}
          value={excludeText}
          onChange={e => onExcludeText(e.target.value)}
          placeholder={'seo ฟรี | ไม่ตรงกลุ่มลูกค้า\n*pantip'}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <button
          type="button"
          onClick={save}
          disabled={busy || !loaded}
          className="rounded-lg border border-[#dbe1ee] px-3 py-1.5 font-semibold text-[#374763] disabled:opacity-40"
        >
          บันทึกเข้าโปรเจกต์
        </button>
        {handoff.length > 0 ? (
          <button
            type="button"
            onClick={useHandoff}
            disabled={busy}
            className="rounded-lg bg-[#155eef] px-3 py-1.5 font-semibold text-white disabled:opacity-40"
            title={handoff.slice(0, 20).map(h => h.keyword).join(', ')}
          >
            ใส่คำจาก Competitor Gap {handoff.length} คำเป็นคำตั้งต้น
          </button>
        ) : null}
        {status ? <span className="text-[#495975]">{status}</span> : null}
      </div>
    </div>
  );
}
