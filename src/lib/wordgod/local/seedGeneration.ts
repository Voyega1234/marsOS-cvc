/**
 * WordGod Local SME — ตัวสร้างคีย์เวิร์ดท้องถิ่น
 *
 * หลักการ (§5–§7): คุณภาพมาก่อนปริมาณ
 *  - ไม่มีการคูณไขว้แบบไร้ขอบเขต — modifier เชิงเจตนาต่อคีย์เวิร์ดไม่เกิน 2 ตัว
 *  - เลือกรูปประโยคตามชนิดของคำบริการ ("รับล้างแอร์" ได้ / "รับคลินิกทันตกรรม" ไม่ได้)
 *  - normalize + dedupe ก่อนส่งออก จึงไม่มีคู่ซ้ำแบบเว้นวรรคต่างกัน
 *  - มีเพดานทุกชั้น (ต่อวลีฐาน / ต่อบริการ / รวมทั้งชุด)
 */

import { GENERATION_LIMITS } from './config';
import {
  LOCATION_PATTERNS,
  MODIFIER_DEFINITIONS,
  NEAR_ME_MODIFIERS,
  classifyServiceShape,
  type ModifierDefinition,
  type ServiceShape,
} from './intentModifiers';
import { resolveBusinessTemplate } from './businessTemplates';
import { containsTwice, dedupeKey, displayForm, hasImmediateRepeat, normalizeThaiSpacing } from './normalize';
import { countWords } from '../text/thai';
import type { LocalArea, LocalResearchInput, ModifierGroup } from './types';

export interface GeneratedCandidate {
  keyword: string;
  service: string;
  location: LocalArea | null;
  locationRole: 'primary' | 'nearby' | 'none';
  modifierGroups: ModifierGroup[];
  modifierIds: string[];
  /** คะแนนภายในสำหรับตัดจำนวนเมื่อชนเพดาน (ไม่ใช่ Priority Score) */
  generationWeight: number;
}

/** modifier ที่ใช้ได้จริงกับคำบริการนี้ (รวม template เฉพาะหมวด) */
export function modifiersForService(service: string): { shape: ServiceShape; modifiers: ModifierDefinition[] } {
  const template = resolveBusinessTemplate(service);
  const shape = template?.forceShape ?? classifyServiceShape(service);
  const suppressed = new Set(template?.suppressModifierIds ?? []);
  const base = MODIFIER_DEFINITIONS.filter(def => !suppressed.has(def.id));
  const extra = (template?.extraModifiers ?? []).filter(def => !suppressed.has(def.id));
  // คำเวลา (วันนี้/ตอนนี้/นอกเวลา/24 ชั่วโมง) เลิก permute เอง — เกือบทั้งหมด volume 0
  // และบางบริการเป็นคำที่ไม่มีจริง ("ขูดหินปูน 24 ชั่วโมง") ถ้าคนค้นจริงจะเข้ามาทาง KP/DFS ideas เอง
  const noGenerate = new Set(['today', 'right_now', 'after_hours', 'h24']);
  const modifiers = [...base, ...extra].filter(def => !noGenerate.has(def.id) && def.render('X', shape) !== null);
  return { shape, modifiers };
}

interface BaseSpec {
  text: string;
  location: LocalArea | null;
  locationRole: 'primary' | 'nearby' | 'none';
  /** จำนวน modifier เชิงเจตนาที่ใช้ไปแล้วในวลีฐานนี้ */
  usedModifiers: number;
  modifierGroups: ModifierGroup[];
  modifierIds: string[];
  weight: number;
}

/**
 * กลุ่มที่วางแทรก "ระหว่างบริการกับพื้นที่" แล้วยังเป็นภาษาไทยที่คนพิมพ์จริง
 * เช่น ล้างแอร์ + ด่วน + บางแค → "ล้างแอร์ด่วนบางแค"
 * (กลุ่มราคา/เปรียบเทียบวางแทรกไม่ได้ — "ล้างแอร์ราคาบางแค" ไม่มีคนพิมพ์)
 */
const INFIX_GROUPS: ModifierGroup[] = ['urgency', 'property_context'];

/** วลีฐานของหนึ่งบริการ: คำบริการล้วน + คำบริการ×พื้นที่ทุกรูปแบบ */
function buildBases(
  service: string,
  input: LocalResearchInput,
  shape: ServiceShape,
  modifiers: ModifierDefinition[]
): BaseSpec[] {
  const bases: BaseSpec[] = [
    {
      text: service,
      location: null,
      locationRole: 'none',
      usedModifiers: 0,
      modifierGroups: [],
      modifierIds: [],
      weight: 60,
    },
  ];

  const nearby = (input.nearbyLocations ?? []).slice(0, GENERATION_LIMITS.maxNearbyLocations);
  const areas: Array<{ area: LocalArea; role: 'primary' | 'nearby' }> = [
    { area: input.primaryLocation, role: 'primary' },
    ...nearby.map(area => ({ area, role: 'nearby' as const })),
  ];

  for (const { area, role } of areas) {
    // พื้นที่หลักใช้ครบทุกรูปแบบ; พื้นที่ใกล้เคียงใช้เฉพาะ 2 รูปแบบแรก
    // เพื่อไม่ให้จำนวนคีย์เวิร์ดบานตามจำนวนพื้นที่
    const patterns = role === 'primary' ? LOCATION_PATTERNS : LOCATION_PATTERNS.slice(0, 2);
    for (const pattern of patterns) {
      bases.push({
        text: pattern.render(service, area.name),
        location: area,
        locationRole: role,
        usedModifiers: 1, // ตัวพื้นที่นับเป็นชั้นความจำเพาะหนึ่งชั้นแล้ว
        modifierGroups: [role === 'primary' ? 'local_exact' : 'nearby_location'],
        modifierIds: [`loc_${pattern.id}`],
        weight: (role === 'primary' ? 100 : 84) * (pattern.weight / 100),
      });
    }
  }

  // แบบแทรกกลาง: [บริการ][คำขยาย][พื้นที่หลัก] — ใช้โควตา modifier ครบ 2 ช่องแล้ว
  const suffixPattern = LOCATION_PATTERNS[0];
  for (const def of modifiers) {
    if (!INFIX_GROUPS.includes(def.group)) continue;
    const modifiedService = def.render(service, shape);
    if (!modifiedService) continue;
    bases.push({
      text: suffixPattern.render(modifiedService, input.primaryLocation.name),
      location: input.primaryLocation,
      locationRole: 'primary',
      usedModifiers: GENERATION_LIMITS.maxModifiersPerKeyword,
      modifierGroups: ['local_exact', def.group],
      modifierIds: [`loc_${suffixPattern.id}`, def.id],
      // เทียบชั้นกับรูป [บริการ][พื้นที่][คำขยาย] แต่ให้ต่ำกว่า 1 แต้มเป็นตัวตัดสินเสมอ
      weight: 100 * 0.6 + def.weight * 0.4 - 1,
    });
  }

  return bases;
}

function isNaturalThai(keyword: string, service: string, location: LocalArea | null): boolean {
  if (!keyword.trim()) return false;
  if (hasImmediateRepeat(keyword)) return false;
  if (containsTwice(keyword, service)) return false;
  if (location && containsTwice(keyword, location.name)) return false;
  if (countWords(keyword, 'th') > GENERATION_LIMITS.maxKeywordWords) return false;
  // "ใกล้ฉัน" ระบุพื้นที่ในตัวอยู่แล้ว — ไม่ควรพ่วงชื่อเขตซ้อนเข้าไปอีก
  if (/ใกล้ฉัน|ใกล้บ้าน|ใกล้ที่ทำงาน/.test(keyword) && location) return false;
  return true;
}

/**
 * สร้างชุดคีย์เวิร์ดผู้สมัคร แล้ว dedupe/ตัดจำนวนตามเพดาน
 * ผลลัพธ์เรียงจาก generationWeight มากไปน้อย (ตัวที่ตัดออกคือหางที่อ่อนที่สุด)
 */
export function generateLocalCandidates(input: LocalResearchInput): GeneratedCandidate[] {
  const services = input.services
    .map(s => normalizeThaiSpacing(s))
    .filter(Boolean)
    .slice(0, GENERATION_LIMITS.maxServices);

  const byKey = new Map<string, GeneratedCandidate>();

  const push = (candidate: GeneratedCandidate) => {
    const key = dedupeKey(candidate.keyword);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, candidate);
      return;
    }
    // เจอซ้ำ: เก็บตัวที่น้ำหนักสูงกว่า และรวมกลุ่ม modifier ที่ตรวจพบเข้าด้วยกัน
    if (candidate.generationWeight > existing.generationWeight) {
      byKey.set(key, {
        ...candidate,
        modifierGroups: Array.from(new Set([...existing.modifierGroups, ...candidate.modifierGroups])),
      });
    } else {
      existing.modifierGroups = Array.from(new Set([...existing.modifierGroups, ...candidate.modifierGroups]));
    }
  };

  for (const service of services) {
    const { shape, modifiers } = modifiersForService(service);
    const bases = buildBases(service, input, shape, modifiers);
    const perService: GeneratedCandidate[] = [];

    const collect = (candidate: GeneratedCandidate) => {
      if (!isNaturalThai(candidate.keyword, candidate.service, candidate.location)) return;
      perService.push({ ...candidate, keyword: displayForm(candidate.keyword) });
    };

    for (const base of bases) {
      // 1) ตัววลีฐานเอง
      collect({
        keyword: base.text,
        service,
        location: base.location,
        locationRole: base.locationRole,
        modifierGroups: base.modifierGroups,
        modifierIds: base.modifierIds,
        generationWeight: base.weight,
      });

      // 2) พ่วง modifier ได้อีกกี่ตัว — เหลือโควตาเท่าไรก็เท่านั้น
      const remaining = GENERATION_LIMITS.maxModifiersPerKeyword - base.usedModifiers;
      if (remaining <= 0) continue;

      const fromBase: GeneratedCandidate[] = [];
      for (const def of modifiers) {
        const rendered = def.render(base.text, shape);
        if (!rendered) continue;
        fromBase.push({
          keyword: rendered,
          service,
          location: base.location,
          locationRole: base.locationRole,
          modifierGroups: Array.from(new Set([...base.modifierGroups, def.group])),
          modifierIds: [...base.modifierIds, def.id],
          generationWeight: base.weight * 0.6 + def.weight * 0.4,
        });
      }
      fromBase
        .sort((a, b) => b.generationWeight - a.generationWeight)
        .slice(0, GENERATION_LIMITS.maxCandidatesPerBase)
        .forEach(collect);
    }

    // 3) กลุ่ม "ใกล้ฉัน" — ต่อกับคำบริการล้วนเท่านั้น
    for (const def of NEAR_ME_MODIFIERS) {
      const rendered = def.render(service, shape);
      if (!rendered) continue;
      collect({
        keyword: rendered,
        service,
        location: null,
        locationRole: 'none',
        modifierGroups: ['near_me'],
        modifierIds: [def.id],
        generationWeight: 70 + def.weight * 0.25,
      });
      // "รับล้างแอร์ใกล้ฉัน" — provider + near me เป็นคู่ที่คนค้นจริง
      if (shape === 'action') {
        const provider = modifiers.find(m => m.id === 'accept_job');
        const withProvider = provider?.render(service, shape);
        if (withProvider) {
          const combined = def.render(withProvider, shape);
          if (combined) {
            collect({
              keyword: combined,
              service,
              location: null,
              locationRole: 'none',
              modifierGroups: ['near_me', 'service_provider'],
              modifierIds: [provider!.id, def.id],
              generationWeight: 78 + def.weight * 0.2,
            });
          }
        }
      }
    }

    perService
      .sort((a, b) => b.generationWeight - a.generationWeight)
      .slice(0, GENERATION_LIMITS.maxCandidatesPerService)
      .forEach(push);
  }

  return Array.from(byKey.values())
    .sort((a, b) => b.generationWeight - a.generationWeight)
    .slice(0, GENERATION_LIMITS.maxTotalCandidates);
}
