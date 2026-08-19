/**
 * ฐานข้อมูลพื้นที่ทั้งประเทศ (77 จังหวัด / 930 อำเภอ / 7,452 ตำบล)
 * จาก thai-province-data (open data กรมการปกครอง) — เป็นชั้น fallback ของ
 * thaiAreas.ts: กทม./ปริมณฑลใช้ฐานเดิม (มีเขตติดกัน+รถไฟฟ้า) พื้นที่อื่นใช้ชุดนี้
 *
 * ข้อจำกัดที่บอกผู้ใช้ตามจริง: ชุดนี้ไม่มีข้อมูล "อำเภอที่ติดกัน" จึงเสนอ
 * ตำบลในอำเภอ + อำเภออื่นในจังหวัดเดียวกัน (relation 'sibling') แทน
 *
 * ข้อมูล ~216KB — import แบบ dynamic เท่านั้น (โหลดเมื่อผู้ใช้พิมพ์พื้นที่
 * ที่ฐานเดิมไม่รู้จัก) เพื่อไม่บวมบันเดิลหน้าแรก
 */

import { normalizeAreaName, type AreaMatch, type AreaSuggestion } from './thaiAreas';

type NationwideTree = Record<string, Record<string, string[]>>;

let tree: NationwideTree | null = null;

async function loadTree(): Promise<NationwideTree> {
  if (!tree) {
    const mod = await import('./thaiAreasNationwide.data.json');
    tree = (mod.default ?? mod) as NationwideTree;
  }
  return tree;
}

const SUGGEST_CAP = 30;

/** หาพื้นที่จากฐานทั้งประเทศ — คืนรูปแบบเดียวกับ findNearbyAreas ของฐานเดิม */
export async function findNearbyAreasNationwide(rawName: string): Promise<AreaMatch | null> {
  const key = normalizeAreaName(rawName || '');
  if (!key) return null;
  const data = await loadTree();

  // 1) ตรงชื่อจังหวัด → เสนออำเภอในจังหวัด
  for (const [province, amphoes] of Object.entries(data)) {
    if (normalizeAreaName(province) !== key) continue;
    const suggestions: AreaSuggestion[] = Object.keys(amphoes)
      .slice(0, SUGGEST_CAP)
      .map(a => ({ name: a, type: 'district', relation: 'subdistrict', parent: province }));
    return { name: province, type: 'province', province, matchedVia: 'district', suggestions };
  }

  // 2) ตรงชื่ออำเภอ (ชื่ออำเภอซ้ำข้ามจังหวัดได้ — เอาอันแรก แนบอันอื่นให้เลือก)
  const amphoeHits: Array<{ province: string; amphoe: string }> = [];
  for (const [province, amphoes] of Object.entries(data)) {
    for (const amphoe of Object.keys(amphoes)) {
      if (normalizeAreaName(amphoe) === key || normalizeAreaName(amphoe) === normalizeAreaName(`เมือง${rawName.trim()}`)) {
        amphoeHits.push({ province, amphoe });
      }
    }
  }
  if (amphoeHits.length > 0) {
    const [first, ...others] = amphoeHits;
    const tambons = data[first.province][first.amphoe] ?? [];
    const siblings = Object.keys(data[first.province]).filter(a => a !== first.amphoe);
    const suggestions: AreaSuggestion[] = [
      // ตำบลชื่อเดียวกับอำเภอ (เช่น อ.หางดง → ต.หางดง) ซ้ำกับทำเลหลัก — ไม่ต้องเสนอ
      ...tambons.filter(t => normalizeAreaName(t) !== key).slice(0, SUGGEST_CAP).map(t => ({ name: t, type: 'subdistrict' as const, relation: 'subdistrict' as const, parent: first.amphoe })),
      ...siblings.slice(0, 12).map(a => ({ name: a, type: 'district' as const, relation: 'sibling' as const, parent: first.province })),
      ...others.map(o => ({ name: `${o.amphoe} (${o.province})`, type: 'district' as const, relation: 'sibling' as const, parent: o.province })),
    ];
    return { name: first.amphoe, type: 'district', province: first.province, matchedVia: 'district', suggestions };
  }

  // 3) ตรงชื่อตำบล → บริบทของอำเภอแม่
  for (const [province, amphoes] of Object.entries(data)) {
    for (const [amphoe, tambons] of Object.entries(amphoes)) {
      if (!tambons.some(t => normalizeAreaName(t) === key)) continue;
      const suggestions: AreaSuggestion[] = [
        ...tambons.filter(t => normalizeAreaName(t) !== key).slice(0, SUGGEST_CAP)
          .map(t => ({ name: t, type: 'subdistrict' as const, relation: 'subdistrict' as const, parent: amphoe })),
        { name: amphoe, type: 'district', relation: 'sibling', parent: province },
      ];
      return { name: amphoe, type: 'district', province, matchedVia: 'subdistrict', suggestions };
    }
  }

  return null;
}
