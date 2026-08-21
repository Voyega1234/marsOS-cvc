/**
 * WordGod Local SME — /api/wordgod/local-research
 *
 * โหมดค้นคีย์เวิร์ดสำหรับธุรกิจบริการในพื้นที่ (SME) แยกจาก pipeline เดิมทั้งหมด
 * เส้นทาง Standard (/api/wordgod-v2/pipeline) ไม่ถูกแตะต้อง
 *
 * ขั้นตอน: สร้างคีย์เวิร์ดท้องถิ่น → ดึง metric จริงจาก Google Keyword Planner
 *          (ถ้าดึงไม่ได้ก็ยังวิเคราะห์เจตนาต่อได้) → ให้คะแนน + จัดคลัสเตอร์
 *
 * กติกา: ห้ามแต่งตัวเลข — คำที่ KP ไม่มีข้อมูล จะส่งออก volume = null เสมอ (§32)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { logAIJob } from '@/lib/logAIJob';
import {
  assembleResults,
  generateLocalCandidates,
  KP_LOOKUP_LIMIT,
  LOCAL_KEYWORD_WEIGHTS,
  runLocalProblemDiscovery,
  type LocalRawItem,
  type MetricRecord,
} from '@/lib/wordgod/local';
import { runProblemToKeywordExpander } from '@/lib/skills/problemFirstSkill';
import { clusterKeywords, type PipelineKeyword } from '@/lib/skills/topicClusterSkill';
import type {
  LocalArea,
  LocalAreaType,
  LocalBusinessType,
  LocalKeywordSource,
  LocalLanguage,
  LocalResearchInput,
  LocalResearchResponse,
} from '@/lib/wordgod/local/types';
import { dedupeKey, normalizeThaiSpacing } from '@/lib/wordgod/local/normalize';
import {
  getAccessToken,
  getHistoricalMetrics,
  getKeywordPlannerRows,
  loadGoogleAdsConfig,
  resolveGeoTargetChain,
  validateGoogleAdsConfig,
  type GeoTargetLevel,
  type MetricEntry,
  type ResolvedGeoTarget,
} from '@/lib/wordgod/services/googleKeywordPlannerService';
import { getDataForSeoVolumes, hasDataForSeoCreds } from '@/lib/wordgod/services/dataForSeoService';
import { callGemini, callGeminiWithGrounding } from '@/lib/wordgod/gemini';
import { DFS_COST_PER_KEYWORD } from '@/lib/logAIJob';
import { KEYWORD_RESEARCH_PROMPT } from '@/lib/skills/keywordResearchSkill';

// โหมดมีหน้าร้าน generate หนักขึ้น (AI ขยาย pool + KP/DFS ดึง volume) เลยยืด
// timeout เท่าโหมดไม่มีหน้าร้าน (Vercel Pro สูงสุด) — กัน request ถูกตัดกลางคัน
export const maxDuration = 800;

const KP_UNAVAILABLE_MESSAGE =
  'ไม่สามารถดึงข้อมูล Search Volume ได้ในขณะนี้ แต่ยังสามารถวิเคราะห์ Local Intent และ Commercial Intent ได้';

const AREA_TYPES: LocalAreaType[] = [
  'district', 'subdistrict', 'province', 'road', 'bts', 'mrt', 'arl', 'landmark',
];

/** รับได้ทั้ง "บางแค" และ { name, type, parent } */
function parseArea(raw: unknown, fallbackType: LocalAreaType, index: number): LocalArea | null {
  if (typeof raw === 'string') {
    const name = normalizeThaiSpacing(raw);
    if (!name) return null;
    return { id: `${fallbackType}-${index}-${dedupeKey(name)}`, name, type: fallbackType };
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const name = normalizeThaiSpacing(String(obj.name ?? ''));
    if (!name) return null;
    const type = AREA_TYPES.includes(obj.type as LocalAreaType)
      ? (obj.type as LocalAreaType)
      : fallbackType;
    const parent = obj.parent ? String(obj.parent) : undefined;
    return {
      id: String(obj.id ?? `${type}-${index}-${dedupeKey(name)}`),
      name,
      type,
      parent,
      latitude: typeof obj.latitude === 'number' ? obj.latitude : undefined,
      longitude: typeof obj.longitude === 'number' ? obj.longitude : undefined,
    };
  }
  return null;
}

function toMetricRecord(entry: MetricEntry): MetricRecord {
  return {
    volume: typeof entry.volume === 'number' ? entry.volume : null,
    competition: entry.competition ?? null,
    competitionIndex: typeof entry.competition_index === 'number' ? entry.competition_index : null,
    bidLow: typeof entry.cpc_low === 'number' && entry.cpc_low > 0 ? entry.cpc_low : null,
    bidHigh: typeof entry.cpc_high === 'number' && entry.cpc_high > 0 ? entry.cpc_high : null,
    trend: Array.isArray(entry.monthly_trend) && entry.monthly_trend.length > 1 ? entry.monthly_trend : undefined,
  };
}

/** ไอเดียจาก KP ต้องเกี่ยวกับบริการหรือพื้นที่ที่ผู้ใช้ระบุ ไม่งั้นทิ้ง */
function isRelevantIdea(keyword: string, serviceKeys: string[], areaKeys: string[]): boolean {
  const key = dedupeKey(keyword);
  if (!key) return false;
  const hitsService = serviceKeys.some(s => s && key.includes(s));
  const hitsArea = areaKeys.some(a => a && key.includes(a));
  return hitsService && (areaKeys.length === 0 || hitsArea || /ใกล้ฉัน|ใกล้บ้าน/.test(keyword));
}

// กริยา/คำนำหน้าบริการที่พบบ่อย — ตัดออกเพื่อหา "คำแกน" ของบริการ
// เช่น "ล้างแอร์" → "แอร์" ทำให้คำโอกาสขายอย่าง "แอร์ไม่เย็น" ไม่ถูกทิ้ง
const SERVICE_VERB_PREFIXES = [
  'บริการ', 'รับจ้าง', 'รับ', 'ร้าน', 'ช่าง', 'ล้าง', 'ซ่อม', 'ติดตั้ง', 'เช่า',
  'ขาย', 'ทำความสะอาด', 'ทำ', 'ตรวจเช็ค', 'ตรวจ', 'เปลี่ยน', 'ย้าย', 'เติม', 'ดูแล', 'กำจัด',
];

/** สกัดคำแกนของบริการ (ตัดกริยานำหน้า + แตกคำตามช่องว่าง) ไว้จับคู่แบบกว้าง */
function buildServiceCoreKeys(services: string[]): string[] {
  const out = new Set<string>();
  for (const service of services) {
    for (const token of service.split(/\s+/)) {
      let core = dedupeKey(token);
      let stripped = true;
      while (stripped) {
        stripped = false;
        for (const prefix of SERVICE_VERB_PREFIXES) {
          if (core.length > prefix.length && core.startsWith(prefix)) {
            core = core.slice(prefix.length);
            stripped = true;
          }
        }
      }
      if (core.length >= 3) out.add(core);
    }
  }
  return Array.from(out);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session!.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const userId = session!.user.id;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const services: string[] = Array.isArray(body.services)
    ? body.services.map((s: unknown) => normalizeThaiSpacing(String(s ?? ''))).filter(Boolean)
    : [];
  if (services.length === 0) {
    return NextResponse.json({ error: 'ต้องระบุบริการ / คำหลักอย่างน้อย 1 รายการ' }, { status: 400 });
  }

  const primaryLocation = parseArea(body.primaryLocation, 'district', 0);
  if (!primaryLocation) {
    return NextResponse.json({ error: 'ต้องระบุพื้นที่หลัก' }, { status: 400 });
  }

  const nearbyLocations = (Array.isArray(body.nearbyLocations) ? body.nearbyLocations : [])
    .map((raw: unknown, i: number) => parseArea(raw, 'district', i + 1))
    .filter(Boolean) as LocalArea[];

  const businessType: LocalBusinessType =
    body.businessType === 'storefront' || body.businessType === 'hybrid'
      ? body.businessType
      : 'service_area';
  // จำนวนคีย์เวิร์ดที่ผู้ใช้ต้องการ (เลือกได้เหมือนโหมดไม่มีหน้าร้าน)
  const targetCount = Math.min(Math.max(Number(body.targetCount) || 50, 10), 1000);
  const language: LocalLanguage = body.language === 'th_en' ? 'th_en' : 'th';

  const input: LocalResearchInput = {
    services,
    primaryLocation,
    nearbyLocations,
    businessType,
    serviceRadiusKm: typeof body.serviceRadiusKm === 'number' ? body.serviceRadiusKm : null,
    language,
    businessContext: body.businessContext ? String(body.businessContext) : undefined,
  };

  const warnings: string[] = [];
  const candidates = generateLocalCandidates(input);

  const items = new Map<string, LocalRawItem>();
  for (const candidate of candidates) {
    items.set(dedupeKey(candidate.keyword), {
      keyword: candidate.keyword,
      sources: ['generated'] as LocalKeywordSource[],
      candidate,
      metric: null,
    });
  }

  // ── Problem-first: แตก topic universe → ปัญหาลูกค้า → คำ solution/วิธี/ความรู้ ──
  // วิธีเดียวกับโหมด "ไม่มีหน้าร้าน" แต่ยิงผ่าน OpenRouter (คงโฟกัส location โดยไม่
  // เติมชื่อเขตต่อท้าย) — คำจากขั้นนี้เป็น "ครึ่ง traffic / บทความ" ของผลลัพธ์
  // และจะถูกดึง volume จริงต่อไปเหมือนคำอื่น (คำไหน volume=0 ก็ถูกตัดตามกติกา §32)
  const generatedTrafficKeys = new Set<string>();
  const useProblemFirst = body.useProblemFirst !== false;
  if (useProblemFirst) {
    try {
      const niche = services.join(' / ');
      const excludeSet = new Set(Array.from(items.keys()));
      const groundedCb = (p: string) => callGeminiWithGrounding(p, true);
      const { problems } = await runLocalProblemDiscovery(
        { services, primaryLocation, nearbyLocations, businessContext: input.businessContext, language },
        { callGeminiWithGrounding: groundedCb }
      );
      if (problems.length > 0) {
        const expanded = await runProblemToKeywordExpander(problems, niche, excludeSet, () => {}, groundedCb);
        let addedPf = 0;
        for (const pk of expanded.keywords) {
          const keyword = normalizeThaiSpacing(pk.keyword);
          const key = dedupeKey(keyword);
          if (!key || items.has(key)) continue;
          items.set(key, { keyword, sources: ['generated'] as LocalKeywordSource[], metric: null });
          generatedTrafficKeys.add(key);
          addedPf++;
        }
        if (addedPf > 0) {
          warnings.push(`เพิ่มคำปัญหา/วิธี/ความรู้ (topic universe) ${addedPf} คำ จาก ${problems.length} ปัญหาจริงของลูกค้า — เป็นคำ traffic/บทความ จะดึง volume จริงต่อไป`);
        }
      }
    } catch (err) {
      warnings.push(`สร้างคำปัญหา/บทความอัตโนมัติไม่สำเร็จ: ${err instanceof Error ? err.message.slice(0, 80) : String(err)}`);
    }
  }

  // ── AI expansion: ขยาย pool คำที่ "เกี่ยวกับธุรกิจ + มีโอกาสขาย" ให้ใกล้เป้า ──
  // ยกวิธีจากโหมด "ไม่มีหน้าร้าน": pool ใหญ่ = มีคำให้ KP/DFS ดึง volume จริงมากขึ้น
  // (นี่คือ fix ตัวจริงของอาการ "ตั้ง 1000 ได้ 2 คำ" — เดิม pool เล็ก + ตัด volume=0 ทิ้ง)
  // ใช้ intent ratio แบบ Lead-Gen/Service (commercial 35 + transactional 20 = เน้นขาย)
  // AI ประเมิน volume เอาไม่ได้ (§32) — ตั้ง metric=null ให้ KP/DFS ยืนยัน volume จริงต่อ
  const useAiExpand = body.useAiExpand !== false;
  if (useAiExpand) {
    // คุม pool ไม่ให้เกิน budget ดึง volume (KP ~400 + DFS ~700) มากนัก เพื่อให้
    // candidate ส่วนใหญ่ได้เช็ค volume จริง — คำที่ไม่ได้เช็คจะกลายเป็นส่วนรองเท่านั้น
    const poolTarget = Math.min(Math.ceil(targetCount * 1.3), 900);
    if (items.size < poolTarget) {
      const salesRatio = { informational: 40, commercial: 35, transactional: 20, navigational: 5, update: 0 };
      const genNiche = `${services.join(' / ')}${input.businessContext ? ` — ${input.businessContext}` : ''}`;
      const genSeed = services[0];
      const BATCH = 50;
      const PARALLEL = targetCount <= 100 ? 2 : targetCount <= 400 ? 4 : 6;
      const MAX_WAVES = 6;
      let genAdded = 0;
      let genFailed = 0;
      for (let wave = 0; wave < MAX_WAVES && items.size < poolTarget; wave++) {
        const need = poolTarget - items.size;
        const batches = Math.min(PARALLEL, Math.max(1, Math.ceil(need / BATCH)));
        const exclude = Array.from(items.values()).map(it => it.keyword);
        const prompts = Array.from({ length: batches }, () =>
          KEYWORD_RESEARCH_PROMPT(genNiche, genSeed, BATCH, exclude, [], salesRatio, false)
        );
        const settled = await Promise.allSettled(prompts.map(p => callGemini(p)));
        let waveAdded = 0;
        for (const s of settled) {
          if (s.status !== 'fulfilled') { genFailed++; continue; }
          const text = typeof s.value === 'string' ? s.value : JSON.stringify(s.value);
          const m = text.match(/\{[\s\S]*\}/);
          if (!m) continue;
          let parsed: { keywords?: Array<{ keyword?: string }> };
          try { parsed = JSON.parse(m[0]); } catch { continue; }
          for (const row of parsed.keywords ?? []) {
            const kw = normalizeThaiSpacing(String(row?.keyword ?? '').trim());
            const key = dedupeKey(kw);
            if (!key || items.has(key)) continue;
            items.set(key, { keyword: kw, sources: ['generated'] as LocalKeywordSource[], metric: null });
            generatedTrafficKeys.add(key);
            waveAdded++; genAdded++;
          }
        }
        if (waveAdded === 0) break; // กันลูปเปล่า (AI ตอบซ้ำ/ล้มเหลวทั้งหมด)
      }
      if (genAdded > 0) {
        warnings.push(`ขยายคำที่เกี่ยวกับธุรกิจ (เน้นโอกาสขาย) ด้วย AI อีก ${genAdded} คำ (pool รวม ${items.size} คำ) — จะดึง Search Volume จริงต่อไป`);
      } else if (genFailed > 0) {
        warnings.push('ขยายคำด้วย AI ไม่สำเร็จรอบนี้ — ใช้คำจาก seed/ปัญหาลูกค้าที่มีอยู่');
      }
    }
  }

  // ── Google Keyword Planner ────────────────────────────────────────────────
  let kpStatus: 'ok' | 'partial' | 'unavailable' | 'skipped' = 'skipped';
  let kpMessage: string | undefined;
  let kpCalls = 0;
  let enrichedCount = 0;
  let geoTarget: { requested: string; resolved: string; level: GeoTargetLevel } = {
    requested: primaryLocation.name,
    resolved: 'Thailand',
    level: 'country',
  };
  let resolvedGeo: ResolvedGeoTarget | null = null;

  const useKeywordPlanner = body.useKeywordPlanner !== false;

  if (useKeywordPlanner) {
    const config = loadGoogleAdsConfig();
    const { valid, errors } = validateGoogleAdsConfig(config);
    if (!valid || !config) {
      kpStatus = 'unavailable';
      kpMessage = KP_UNAVAILABLE_MESSAGE;
      warnings.push(`Google Keyword Planner ไม่พร้อมใช้งาน: ${errors.join('; ')}`);
    } else {
      try {
        const accessToken = await getAccessToken(config);

        // ลำดับพื้นที่: เขต/อำเภอ → จังหวัด → กรุงเทพฯ → ประเทศไทย (§8)
        const geoCandidates = [primaryLocation.name];
        if (primaryLocation.parent) geoCandidates.push(primaryLocation.parent);
        if (/กรุงเทพ|กทม|bangkok/i.test(`${primaryLocation.name} ${primaryLocation.parent ?? ''}`)) {
          geoCandidates.push('Bangkok');
        }
        // แยกให้ออกว่า "Google ไม่รู้จักพื้นที่นี้" กับ "ยิง API ไม่ผ่าน" — สองเรื่องนี้
        // ต้องบอกผู้ใช้ต่างกัน ไม่งั้นจะเข้าใจผิดว่าพื้นที่ตัวเองไม่มีข้อมูล
        let geoApiError: string | null = null;
        resolvedGeo = await resolveGeoTargetChain(config, accessToken, geoCandidates, detail => {
          if (!geoApiError) geoApiError = detail;
          console.warn('[local-research] geo target lookup failed:', detail);
        });
        geoTarget = {
          requested: primaryLocation.name,
          resolved: resolvedGeo.name,
          level: resolvedGeo.level,
        };
        if (resolvedGeo.level === 'country') {
          warnings.push(
            geoApiError
              ? `เจาะจงพื้นที่ "${primaryLocation.name}" ไม่ได้เพราะเรียก Google Ads ไม่สำเร็จ — ใช้ข้อมูลระดับประเทศแทน (${geoApiError})`
              : `Keyword Planner ไม่มีพื้นที่ "${primaryLocation.name}" ให้เจาะจง — ใช้ข้อมูลระดับประเทศแทน`
          );
        }

        const lookupKeywords = Array.from(items.values())
          .slice(0, KP_LOOKUP_LIMIT)
          .map(item => item.keyword);
        if (candidates.length > KP_LOOKUP_LIMIT) {
          warnings.push(
            `ดึง Search Volume เฉพาะ ${KP_LOOKUP_LIMIT} คำแรกที่คะแนนสูงสุด (ทั้งหมด ${candidates.length} คำ)`
          );
        }

        const metrics = await getHistoricalMetrics(
          lookupKeywords,
          config,
          accessToken,
          'th',
          'Thailand',
          warning => warnings.push(warning),
          resolvedGeo.resourceName
        );
        kpCalls = lookupKeywords.length;

        for (const item of Array.from(items.values())) {
          const entry = metrics.get(item.keyword.trim().toLowerCase());
          if (!entry) continue;
          item.metric = toMetricRecord(entry);
          item.sources = Array.from(new Set([...item.sources, 'keyword_planner' as LocalKeywordSource]));
          enrichedCount++;
        }

        kpStatus = enrichedCount > 0
          ? (enrichedCount < lookupKeywords.length ? 'partial' : 'ok')
          : 'partial';
        if (enrichedCount === 0) {
          kpMessage = 'Keyword Planner ไม่มีข้อมูลปริมาณการค้นหาสำหรับคำในชุดนี้';
        }

        // ── volume ระดับประเทศสำหรับคำ problem/traffic (บทความ) ──
        // คำหาความรู้/วิธี/ปัญหา แทบไม่มี volume ระดับเขต ถ้าใช้ geo เขตจะโดนตัดทิ้งหมด
        // จึงยิงซ้ำที่ระดับประเทศ (Thailand) เฉพาะคำกลุ่มนี้ที่ยังไม่มี metric
        if (generatedTrafficKeys.size > 0) {
          const pfKeywords = Array.from(items.values())
            .filter(it => generatedTrafficKeys.has(dedupeKey(it.keyword)) && !it.metric)
            .map(it => it.keyword)
            .slice(0, KP_LOOKUP_LIMIT);
          if (pfKeywords.length > 0) {
            const natMetrics = await getHistoricalMetrics(
              pfKeywords, config, accessToken, 'th', 'Thailand', warning => warnings.push(warning)
            );
            let natEnriched = 0;
            for (const item of Array.from(items.values())) {
              if (item.metric) continue;
              const entry = natMetrics.get(item.keyword.trim().toLowerCase());
              if (!entry) continue;
              item.metric = toMetricRecord(entry);
              item.sources = Array.from(new Set([...item.sources, 'keyword_planner' as LocalKeywordSource]));
              enrichedCount++;
              natEnriched++;
            }
            kpCalls += pfKeywords.length;
            if (natEnriched > 0) warnings.push(`ดึง Search Volume ระดับประเทศให้คำ traffic/บทความ ${natEnriched} คำ`);
          }
        }

        // ── ขยายผลด้วยไอเดียจริงจาก KP (ตัวเลือกเสริม) ────────────────────
        if (body.expandWithKeywordPlanner !== false) {
          const ideas = await getKeywordPlannerRows({
            seed_keywords: services.slice(0, 5).map(s => `${s}${primaryLocation.name}`),
            target_language: 'th',
            target_country: 'Thailand',
            google_ads_geo_target_resources: [resolvedGeo.resourceName],
            number_of_results: 200,
            force_refresh: !!body.forceRefresh,
          });
          if (ideas.warnings?.length) warnings.push(...ideas.warnings);
          if (ideas.success) {
            const serviceKeys = services.map(dedupeKey);
            const areaKeys = [primaryLocation, ...nearbyLocations].map(a => dedupeKey(a.name));
            let added = 0;
            for (const row of ideas.rows) {
              const keyword = normalizeThaiSpacing(row.keyword);
              const key = dedupeKey(keyword);
              if (!key) continue;
              const existing = items.get(key);
              if (existing) {
                existing.sources = Array.from(new Set([...existing.sources, 'keyword_planner' as LocalKeywordSource]));
                if (!existing.metric) {
                  existing.metric = {
                    volume: row.volume,
                    competition: row.competition ?? null,
                    competitionIndex: typeof row.competition_index === 'number' ? row.competition_index : null,
                    bidLow: row.low_cpc > 0 ? row.low_cpc : null,
                    bidHigh: row.high_cpc > 0 ? row.high_cpc : null,
                    trend: Array.isArray(row.monthly_trend) ? row.monthly_trend : undefined,
                  };
                  enrichedCount++;
                }
                continue;
              }
              if (!isRelevantIdea(keyword, serviceKeys, areaKeys)) continue;
              if (added >= 150) break;
              items.set(key, {
                keyword,
                sources: ['keyword_planner'],
                metric: {
                  volume: row.volume,
                  competition: row.competition ?? null,
                  competitionIndex: typeof row.competition_index === 'number' ? row.competition_index : null,
                  bidLow: row.low_cpc > 0 ? row.low_cpc : null,
                  bidHigh: row.high_cpc > 0 ? row.high_cpc : null,
                  trend: Array.isArray(row.monthly_trend) ? row.monthly_trend : undefined,
                },
              });
              added++;
              enrichedCount++;
            }
            kpCalls += ideas.rows.length;
          } else if (ideas.error) {
            warnings.push(`ขยายผลจาก Keyword Planner ไม่สำเร็จ: ${ideas.error}`);
          }

          // ── รอบสอง: คำกว้างไม่ติดทำเล — ดึง traffic/โอกาสขาย/คำที่แข่ง SEO ได้ ──
          // (เช่น "ล้างแอร์ ราคา", "แอร์ไม่เย็น ทำไง")
          // สำคัญ: ห้ามล็อก geo ระดับเขต/อำเภอที่นี่ — volume ท้องถิ่นของคำกว้าง
          // มักเป็น 0 ทำให้ทั้งชุดโดนตัดทิ้ง ใช้ตัวเลขระดับประเทศแทน
          const broadIdeas = await getKeywordPlannerRows({
            seed_keywords: services.slice(0, 5),
            target_language: 'th',
            target_country: 'Thailand',
            number_of_results: Math.max(300, targetCount * 3),
            force_refresh: !!body.forceRefresh,
          });
          if (broadIdeas.warnings?.length) warnings.push(...broadIdeas.warnings);
          if (broadIdeas.success) {
            const serviceKeys = services.map(dedupeKey);
            const coreKeys = buildServiceCoreKeys(services);
            type BroadRow = (typeof broadIdeas.rows)[number];
            const direct: BroadRow[] = [];
            const unsure: BroadRow[] = [];
            for (const row of broadIdeas.rows) {
              if (!row.volume || row.volume <= 0) continue;
              const key = dedupeKey(normalizeThaiSpacing(row.keyword));
              if (!key || items.has(key)) continue;
              if (serviceKeys.some(sv => sv && key.includes(sv)) || coreKeys.some(ck => key.includes(ck))) {
                direct.push(row);
              } else {
                unsure.push(row);
              }
            }

            // คำที่ไม่เข้าเกณฑ์สตริง ให้ AI คัดความเกี่ยวข้อง/โอกาสขายเป็น batch เดียว
            // (คัดเฉพาะความเกี่ยวข้อง — ตัวเลข volume มาจาก KP จริงเสมอ ไม่มีการแต่ง)
            let approved: BroadRow[] = [];
            const unsureBatch = unsure.slice(0, 100);
            if (unsureBatch.length > 0) {
              try {
                const relevancePrompt = `ธุรกิจ: ${services.join(', ')}${body.businessContext ? ` — ${body.businessContext}` : ''}
จากรายการ keyword ต่อไปนี้ เลือกเฉพาะคำที่เกี่ยวข้องกับธุรกิจนี้ ทั้งคำที่มีโอกาสสร้างยอดขาย/ดึงลูกค้า (ราคา อาการเสีย เปรียบเทียบ) และคำหาความรู้/วิธี/ข้อมูลที่ดึง traffic เข้าเว็บ (เช่น วิธี..., ...คืออะไร, ...บ่อยแค่ไหน) ตัดเฉพาะคำที่เป็นคนละธุรกิจทิ้ง
ตอบเป็น JSON array ของ keyword ที่เลือกเท่านั้น: ["...","..."]
Keywords:
${unsureBatch.map(r => `- ${r.keyword}`).join('\n')}`;
                const raw = await callGemini(relevancePrompt);
                const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
                const jsonMatch = text.match(/\[[\s\S]*\]/);
                if (jsonMatch) {
                  const picked = new Set(
                    (JSON.parse(jsonMatch[0]) as unknown[]).map(k => dedupeKey(String(k ?? '')))
                  );
                  approved = unsureBatch.filter(r => picked.has(dedupeKey(normalizeThaiSpacing(r.keyword))));
                }
              } catch (err) {
                warnings.push(`AI คัดคำโอกาสขายไม่สำเร็จ — ใช้เฉพาะคำที่ตรงบริการ (${err instanceof Error ? err.message.slice(0, 60) : String(err)})`);
              }
            }

            let added = 0;
            for (const row of [...direct, ...approved]) {
              if (added >= targetCount * 2) break;
              const keyword = normalizeThaiSpacing(row.keyword);
              const key = dedupeKey(keyword);
              if (!key || items.has(key)) continue;
              items.set(key, {
                keyword,
                sources: ['keyword_planner'],
                metric: {
                  volume: row.volume,
                  competition: row.competition ?? null,
                  competitionIndex: typeof row.competition_index === 'number' ? row.competition_index : null,
                  bidLow: row.low_cpc > 0 ? row.low_cpc : null,
                  bidHigh: row.high_cpc > 0 ? row.high_cpc : null,
                  trend: Array.isArray(row.monthly_trend) ? row.monthly_trend : undefined,
                },
              });
              added++;
              enrichedCount++;
            }
            kpCalls += broadIdeas.rows.length;
            if (added > 0) warnings.push(`เพิ่มคำโอกาสขาย/traffic จากบริการหลัก (ไม่ติดทำเล) อีก ${added} คำ — volume ระดับประเทศจาก Keyword Planner จริงทุกคำ`);
          } else if (broadIdeas.error) {
            warnings.push(`ดึงคำโอกาสขายจากบริการหลักไม่สำเร็จ: ${broadIdeas.error}`);
          }
        }
      } catch (err: any) {
        // KP ล้มเหลวต้องไม่ทำให้ทั้งหน้าพัง — คืนผลวิเคราะห์เจตนาต่อไป (§31)
        kpStatus = 'unavailable';
        kpMessage = KP_UNAVAILABLE_MESSAGE;
        warnings.push(`Google Keyword Planner: ${err?.message || String(err)}`);
      }
    }
  }

  // ── DFS fallback: คำที่ KP ไม่มี volume → ถาม DataForSEO (กติกาเดียวกับโหมดไม่มีหน้าร้าน) ──
  let dfsCalls = 0;
  if (hasDataForSeoCreds()) {
    const needVolume = Array.from(items.values())
      .filter(item => !item.metric || !item.metric.volume)
      .map(item => item.keyword)
      .slice(0, 700);
    if (needVolume.length > 0) {
      try {
        const dfsMap = await getDataForSeoVolumes(needVolume, 'th', 2764, w => warnings.push(w));
        dfsCalls = needVolume.length;
        for (const item of Array.from(items.values())) {
          const hit = dfsMap.get(item.keyword.trim().toLowerCase());
          if (!hit || !hit.volume) continue;
          item.metric = {
            volume: hit.volume,
            competition: hit.competition ?? null,
            competitionIndex: hit.competition_index ?? null,
            bidLow: null,
            bidHigh: hit.cpc > 0 ? hit.cpc : null,
          };
          item.sources = Array.from(new Set([...item.sources, 'keyword_planner' as LocalKeywordSource]));
          enrichedCount++;
        }
      } catch (err) {
        warnings.push(`DataForSEO fallback ไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // ── เลือกผลลัพธ์: คำ "มี volume จริง" มาก่อนเสมอ แล้วค่อยเติมด้วยคำ AI ──
  // user จัดลำดับความสำคัญไว้ชัด: (1) เกี่ยวกับธุรกิจ + มีโอกาสขาย = อันดับ 1
  // (2) ต้องมี volume จริง — "ไม่มี volume ทำไปก็ไม่มีประโยชน์"
  // → เอาคำมี volume (เรียงตามคะแนนโอกาส/relevance ตาม §18) ให้ครบเป้าก่อน
  //   ถ้ายังขาดค่อยเติมด้วยคำ AI ที่เกี่ยวกับธุรกิจ แต่ติดป้ายชัดว่า "ยังไม่มี volume"
  //   (เดิมตัดคำ volume=0 ทิ้งทั้งหมด ทำให้คำ local ไทยได้น้อยมาก — ตั้ง 1000 ได้ 2)
  const allItems = Array.from(items.values());
  const rankedAll = assembleResults(allItems, input); // เรียงตาม score.total แล้ว (§18)
  const withVol = rankedAll.results.filter(r => (r.volume ?? 0) > 0);
  const withoutVol = rankedAll.results.filter(r => (r.volume ?? 0) <= 0);

  // 1) คำมี volume จริงมาก่อน (สูงสุดถึงเป้า) — นี่คือผลลัพธ์หลักที่ "มีประโยชน์จริง"
  const volPick = withVol.slice(0, targetCount);
  // 2) ยังไม่ครบเป้า → เติมด้วยคำ AI ที่เกี่ยวกับธุรกิจ (volume ยังไม่ยืนยัน = ส่วนรอง)
  const remain = targetCount - volPick.length;
  const aiPick = remain > 0 ? withoutVol.slice(0, remain) : [];
  const picked = [...volPick, ...aiPick];

  const keepKeywords = new Set(picked.map(r => dedupeKey(r.keyword)));
  const finalItems = allItems.filter(item => keepKeywords.has(dedupeKey(item.keyword)));

  // รายงานองค์ประกอบผลลัพธ์ตามจริง (แทนข้อความ "ตัดคำ volume=0 ทิ้ง" เดิม)
  const finalWithVol = volPick.length;
  const finalAi = aiPick.length;
  if (withVol.length === 0) {
    warnings.push('ยังไม่มีคำไหนมี Search Volume รายงานในพื้นที่นี้ — คำในตารางเป็นคำ AI แนะนำที่เกี่ยวกับธุรกิจ (ยังไม่ยืนยัน volume) แนะนำกด "ค้นหา" ซ้ำหรือขยายทำเล/บริการ');
  } else if (finalAi > 0) {
    warnings.push(`ได้ ${picked.length}/${targetCount} คำ — คำมี Search Volume จริง ${finalWithVol} คำ (KP/DataForSEO) มาก่อน + เติมคำ AI ที่เกี่ยวกับธุรกิจอีก ${finalAi} คำ (ยังไม่ยืนยัน volume ให้ตรวจก่อนใช้)`);
  } else if (withVol.length > targetCount) {
    warnings.push(`แสดง ${targetCount} คำที่มี Search Volume สูงสุดตามคะแนนโอกาส (มีคำที่ volume จริงทั้งหมด ${withVol.length} คำ)`);
  }

  const { results, clusters } = assembleResults(finalItems, input);

  // ── เขียน SEO title + slug ให้ทุกคำ (แบบเดียวกับโหมดไม่มีหน้าร้าน) ──
  try {
    const kwList = results.map(r => r.keyword);
    if (kwList.length > 0) {
      const titlePrompt = `คุณคือผู้เชี่ยวชาญ SEO ไทย เขียนหัวข้อบทความ/หน้าเพจ (SEO title) และ English slug ให้ keyword ของธุรกิจนี้:
ธุรกิจ: ${services.join(', ')} ในพื้นที่ ${primaryLocation.name}${body.businessContext ? ` — ${body.businessContext}` : ''}
กติกา: title ภาษาไทย ≤60 ตัวอักษร มี keyword อยู่ในหัวข้อ เน้นให้คนอยากคลิกและสื่อว่าให้บริการจริง / slug เป็นอังกฤษล้วน ตัวเล็ก คั่นด้วย hyphen สั้นกระชับ
ตอบเป็น JSON array เท่านั้น: [{"keyword":"...","title":"...","slug":"..."}]
Keywords:
${kwList.map(k => `- ${k}`).join('\n')}`;
      const raw = await callGemini(titlePrompt);
      const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const titled = JSON.parse(jsonMatch[0]) as Array<{ keyword?: string; title?: string; slug?: string }>;
        const byKey = new Map(titled.map(t => [dedupeKey(String(t.keyword ?? '')), t]));
        for (const r of results) {
          const hit = byKey.get(dedupeKey(r.keyword));
          if (hit?.title) r.suggestedTitle = String(hit.title).slice(0, 120);
          if (hit?.slug) r.slug = String(hit.slug).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
        }
      }
    }
  } catch (err) {
    warnings.push(`เขียน title/slug อัตโนมัติไม่สำเร็จ: ${err instanceof Error ? err.message.slice(0, 80) : String(err)}`);
  }

  // ── โครงสร้างเว็บทั้งไซต์: จัด pillar/cluster แบบเดียวกับโหมด "ไม่มีหน้าร้าน" ──
  // (degradable — ถ้า LLM ล้มเหลว sitemap ยังใช้ category จาก local cluster ได้)
  // ไม่ยุบบทความ: ยังคง 1 keyword = 1 บทความ แค่ติดป้ายว่าอยู่ pillar/cluster ไหน
  type ClusterMembership = { clusterId: number; clusterName: string; role: 'pillar' | 'supporting'; pillarSlug: string };
  const clusterByKey = new Map<string, ClusterMembership>();
  let topicClusters: Array<{ clusterId: number; name: string; pillarSlug: string; memberSlugs: string[]; totalVolume: number }> = [];
  const buildTopicClusters = body.buildTopicClusters !== false;
  if (buildTopicClusters && results.length > 1) {
    try {
      const pipelineKws: PipelineKeyword[] = results.map(r => ({
        keyword: r.keyword,
        title: r.suggestedTitle || r.keyword,
        volume: r.volume ?? 0,
        opportunity_score: r.score?.total ?? 0,
        priority: String(r.score?.total ?? ''),
        intent: r.intents?.[0] ?? 'informational',
        aeo_question: '',
      }));
      const niche = services.join(' / ');
      const clusterResult = await clusterKeywords(pipelineKws, niche, (p: string) => callGemini(p));
      for (const c of clusterResult.clusters) {
        const pillarSlug = c.pillar.slug;
        clusterByKey.set(dedupeKey(c.pillar.keyword), { clusterId: c.cluster_id, clusterName: c.cluster_name, role: 'pillar', pillarSlug });
        for (const s of c.supporting) {
          clusterByKey.set(dedupeKey(s.keyword), { clusterId: c.cluster_id, clusterName: c.cluster_name, role: 'supporting', pillarSlug });
        }
      }
      topicClusters = clusterResult.clusters.map(c => ({
        clusterId: c.cluster_id,
        name: c.cluster_name,
        pillarSlug: c.pillar.slug,
        memberSlugs: [c.pillar.slug, ...c.supporting.map(s => s.slug)],
        totalVolume: c.total_volume,
      }));
    } catch (err) {
      warnings.push(`จัดโครงสร้าง pillar/cluster ไม่สำเร็จ — ใช้หมวดจาก local cluster แทน (${err instanceof Error ? err.message.slice(0, 60) : String(err)})`);
    }
  }

  // ── แบ่ง sitemap: 1 keyword = 1 บทความ/หน้า ──
  // โมเดลของโปรเจกต์คือ "หนึ่งคีย์เวิร์ดต่อหนึ่งบทความ" จึงไม่จับหลายคำรวมเป็นหน้าเดียว
  // (การกันคำซ้ำ/ทับหัวข้อทำที่ชั้น selection แล้ว — 50/50 + cap ต่อ cluster + แยก intent)
  // คำ traffic/ปัญหา (topic universe) → บทความ (blog) ให้ชัด "เน้นบทความ" ตามที่ขอ
  const seenSitemapKey = new Set<string>();
  const sitemap = results
    .filter(r => {
      const k = dedupeKey(r.keyword);
      if (!k || seenSitemapKey.has(k)) return false;
      seenSitemapKey.add(k);
      return true;
    })
    .map(r => {
      const key = dedupeKey(r.keyword);
      const membership = clusterByKey.get(key);
      const isArticle = generatedTrafficKeys.has(key);
      const pageType = isArticle ? 'blog' : (r.suggestedPage ?? 'blog');
      const slug = r.slug || key.replace(/\s+/g, '-');
      return {
        page: r.suggestedTitle || r.keyword,
        pageType: String(pageType),
        slug,
        category: membership?.clusterName ?? r.cluster ?? r.service,
        clusterId: membership?.clusterId,
        pillarSlug: membership?.pillarSlug,
        role: membership?.role ?? 'standalone' as 'pillar' | 'supporting' | 'standalone',
        keywords: [{ keyword: r.keyword, volume: r.volume ?? null, title: r.suggestedTitle }],
      };
    })
    .sort((a, b) => (b.keywords[0].volume ?? 0) - (a.keywords[0].volume ?? 0));

  const response: LocalResearchResponse & { sitemap: typeof sitemap; topicClusters: typeof topicClusters } = {
    results,
    clusters,
    sitemap,
    topicClusters,
    meta: {
      generatedCount: candidates.length,
      enrichedCount,
      keywordPlannerStatus: kpStatus,
      keywordPlannerMessage: kpMessage,
      locationTarget: geoTarget,
      weights: LOCAL_KEYWORD_WEIGHTS,
      warnings,
      generatedAt: new Date().toISOString(),
    },
  };

  if (dfsCalls > 0) {
    logAIJob({
      organizationId: orgId,
      projectId: body.projectId || null,
      jobType: 'DFS_VOLUME_LOOKUP',
      modelProvider: 'DATAFORSEO',
      modelName: 'dataforseo/search_volume/live',
      status: 'SUCCESS',
      externalCost: dfsCalls * DFS_COST_PER_KEYWORD,
      externalCalls: dfsCalls,
      externalApi: 'DataForSEO',
      createdById: userId,
      inputSummary: `WordGod Local SME DFS fallback — ${dfsCalls} lookups`,
    }).catch(() => {});
  }

  if (kpCalls > 0) {
    logAIJob({
      organizationId: orgId,
      projectId: body.projectId || null,
      jobType: 'KP_VOLUME_LOOKUP',
      modelProvider: 'GOOGLE',
      modelName: 'google_ads/keyword_planner',
      status: kpStatus === 'unavailable' ? 'FAILED' : 'SUCCESS',
      externalCost: 0,
      externalCalls: kpCalls,
      externalApi: 'GoogleKeywordPlanner',
      createdById: userId,
      inputSummary: `WordGod Local SME — ${services.join(', ')} @ ${primaryLocation.name} · ${kpCalls} lookups`,
    }).catch(() => {});
  }

  return NextResponse.json(response);
}
