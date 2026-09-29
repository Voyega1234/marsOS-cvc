'use client';

/**
 * การ์ดข้อมูลธุรกิจจริง — ใช้ร่วมกันทั้ง WordGodOnlinePanel และ WordGodLocalPanel
 * ผูกกับ Keyword Intent Skill: ยิ่งกรอกครบ ยิ่งคัดคีย์เวิร์ดให้ตรงธุรกิจได้แม่นขึ้น
 * ทุกช่องไม่บังคับ — ถ้าปล่อยว่าง skill จะใช้ rule กลาง (ไม่เจาะจงธุรกิจ)
 */

import { useEffect, useRef, useState } from 'react';
import type { BusinessProfile } from '@/lib/wordgod/intent-skill/types';

interface Props {
  value: BusinessProfile;
  onChange: (next: BusinessProfile) => void;
  quota: number | null;
  onQuotaChange: (next: number | null) => void;
  fieldClass: string;
  labelClass: string;
}

function parseLinesLocal(text: string): string[] {
  return Array.from(new Set(text.split(/[\n,]/).map(line => line.trim()).filter(Boolean)));
}

/** เก็บ textarea เป็น raw text ในตัวเอง — sync กลับจาก props เฉพาะตอนค่าเปลี่ยนจากภายนอก (เช่น prefill จากผลเก่า) */
function useLinesField(value: string[], onChange: (next: string[]) => void): [string, (next: string) => void] {
  const [text, setText] = useState(() => value.join('\n'));
  const lastEmitted = useRef(value);
  useEffect(() => {
    if (value !== lastEmitted.current) {
      setText(value.join('\n'));
      lastEmitted.current = value;
    }
  }, [value]);
  function handleChange(next: string): void {
    setText(next);
    const parsed = parseLinesLocal(next);
    lastEmitted.current = parsed;
    onChange(parsed);
  }
  return [text, handleChange];
}

export default function BusinessProfileCard({ value, onChange, quota, onQuotaChange, fieldClass, labelClass }: Props) {
  const [open, setOpen] = useState(true);

  const [servicesOfferedText, setServicesOfferedText] = useLinesField(
    value.servicesOffered,
    next => onChange({ ...value, servicesOffered: next })
  );
  const [servicesNotOfferedText, setServicesNotOfferedText] = useLinesField(
    value.servicesNotOffered,
    next => onChange({ ...value, servicesNotOffered: next })
  );
  const [branchesText, setBranchesText] = useLinesField(
    value.branches,
    next => onChange({ ...value, branches: next })
  );
  const [competitorBrandsText, setCompetitorBrandsText] = useLinesField(
    value.competitorBrands,
    next => onChange({ ...value, competitorBrands: next })
  );
  const [shopProductsText, setShopProductsText] = useLinesField(
    value.shopProducts,
    next => onChange({ ...value, shopProducts: next })
  );

  return (
    <div className="mt-4 rounded-xl border border-[#eef1f7] bg-[#fafbfe] p-3">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="text-xs font-bold text-[#17233a]">ข้อมูลธุรกิจจริง (ใช้คัดคีย์เวิร์ดให้ตรงธุรกิจ)</span>
        <span className="text-[11px] font-semibold text-[#155eef]">{open ? '▾ ซ่อน' : '▸ แสดง'}</span>
      </button>

      {open ? (
        <div className="mt-3 space-y-3">
          <div>
            <label className={labelClass}>บริการ/สินค้าที่ทำจริง (บรรทัดละรายการ)</label>
            <textarea
              rows={3}
              className={fieldClass}
              value={servicesOfferedText}
              onChange={e => setServicesOfferedText(e.target.value)}
              placeholder={'เช่น\nกำจัดปลวก\nกำจัดมด'}
            />
          </div>

          <div>
            <label className={labelClass}>บริการที่ไม่ได้ทำ</label>
            <textarea
              rows={2}
              className={fieldClass}
              value={servicesNotOfferedText}
              onChange={e => setServicesNotOfferedText(e.target.value)}
              placeholder={'เช่น\nกำจัดหนู'}
            />
            <p className="mt-1 text-[10px] leading-4 text-[#91a0b8]">คีย์เวิร์ดกลุ่มนี้ทำได้แค่บทความ (ไม่แนะนำทำหน้าขาย)</p>
          </div>

          <div>
            <label className={labelClass}>สาขา / พื้นที่ให้บริการจริง (บรรทัดละรายการ)</label>
            <textarea
              rows={2}
              className={fieldClass}
              value={branchesText}
              onChange={e => setBranchesText(e.target.value)}
              placeholder={'เช่น\nกรุงเทพ\nนนทบุรี'}
            />
            <p className="mt-1 text-[10px] leading-4 text-[#91a0b8]">ไม่มีสาขา = ไม่ทำหน้า Location สำหรับพื้นที่นั้น</p>
          </div>

          <div>
            <label className={labelClass}>แบรนด์คู่แข่ง (บรรทัดละชื่อ)</label>
            <textarea
              rows={2}
              className={fieldClass}
              value={competitorBrandsText}
              onChange={e => setCompetitorBrandsText(e.target.value)}
              placeholder={'เช่น\nแบรนด์ A\nแบรนด์ B'}
            />
            <p className="mt-1 text-[10px] leading-4 text-[#91a0b8]">คีย์เวิร์ดที่มีชื่อแบรนด์คู่แข่ง/คำแปลภาษา ไม่แนะนำทำหน้าขาย</p>
          </div>

          <label className="flex items-center gap-2 text-xs font-semibold text-[#495975]">
            <input
              type="checkbox"
              checked={value.hasShop}
              onChange={e => onChange({ ...value, hasShop: e.target.checked })}
            />
            มีร้านขายสินค้า (ออนไลน์/หน้าร้าน)
          </label>

          {value.hasShop ? (
            <div>
              <label className={labelClass}>สินค้าที่ขาย (บรรทัดละรายการ)</label>
              <textarea
                rows={2}
                className={fieldClass}
                value={shopProductsText}
                onChange={e => setShopProductsText(e.target.value)}
                placeholder={'เช่น\nยาฆ่าแมลง'}
              />
              <p className="mt-1 text-[10px] leading-4 text-[#91a0b8]">คีย์เวิร์ดสินค้าที่ไม่มีร้านขาย จะถือว่าไม่แนะนำทำหน้าขาย</p>
            </div>
          ) : null}

          <div>
            <label className={labelClass}>ชื่อแบรนด์ของเรา (ไม่บังคับ)</label>
            <input
              className={fieldClass}
              value={value.ownBrand ?? ''}
              onChange={e => onChange({ ...value, ownBrand: e.target.value })}
              placeholder="เช่น MarsBrand"
            />
          </div>

          <div>
            <label className={labelClass}>จำนวนกลุ่มที่อนุมัติอัตโนมัติ (ว่าง = ทุกกลุ่มที่เหมาะ)</label>
            <input
              type="number"
              min={0}
              className={fieldClass}
              value={quota === null || quota === undefined ? '' : quota}
              onChange={e => {
                const raw = e.target.value.trim();
                if (!raw) { onQuotaChange(null); return; }
                const n = Number(raw);
                onQuotaChange(Number.isFinite(n) ? Math.max(0, Math.round(n)) : null);
              }}
              placeholder="ว่าง = อนุมัติทุกกลุ่มที่ FIT/ARTICLE_ONLY"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
