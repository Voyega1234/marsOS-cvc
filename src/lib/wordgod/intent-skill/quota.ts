/**
 * Keyword Intent Skill — Auto-approve ตาม quota (ขั้นสุดท้าย)
 */
import type { KeywordGroup } from './types';

/**
 * อนุมัติกลุ่มอัตโนมัติตาม quota — NOT_RECOMMENDED ไม่อนุมัติเด็ดขาด
 * quota null/undefined/<=0 = อนุมัติทุกกลุ่มที่ FIT/ARTICLE_ONLY
 * ลำดับ: FIT ก่อน ARTICLE_ONLY แล้วเรียงตาม highestSv มากไปน้อย
 * คืนจำนวนกลุ่มที่อนุมัติ (mutate group.approved ให้ด้วย)
 */
export function autoApprove(groups: KeywordGroup[], quota: number | null | undefined): number {
  for (const g of groups) g.approved = false;

  const candidates = groups
    .filter(g => g.fit !== 'NOT_RECOMMENDED')
    .sort((a, b) => {
      if (a.fit !== b.fit) return a.fit === 'FIT' ? -1 : 1;
      return (b.highestSv ?? -1) - (a.highestSv ?? -1);
    });

  const limit = quota === null || quota === undefined || quota <= 0 ? candidates.length : quota;
  const approved = candidates.slice(0, limit);
  for (const g of approved) g.approved = true;
  return approved.length;
}
