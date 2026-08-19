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
  type LocalRawItem,
  type MetricRecord,
} from '@/lib/wordgod/local';
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
import { callGemini } from '@/lib/wordgod/gemini';
import { DFS_COST_PER_KEYWORD } from '@/lib/logAIJob';

export const maxDuration = 300;

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
  const targetCount = Math.min(Math.max(Number(body.targetCount) || 50, 10), 200);
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
จากรายการ keyword ต่อไปนี้ เลือกเฉพาะคำที่เกี่ยวข้องกับธุรกิจนี้และมีโอกาสสร้างยอดขาย/ดึงลูกค้า (รวมคำเชิงปัญหา เช่น อาการเสีย, ราคา, เปรียบเทียบ) ตัดคำที่เป็นคนละธุรกิจทิ้ง
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

  // ── กติกาหน้านี้: เอาเฉพาะคำที่มี volume จริงเท่านั้น (KP หรือ DFS) ──
  const allItems = Array.from(items.values());
  const volumeBacked = allItems.filter(item => (item.metric?.volume ?? 0) > 0);
  const droppedNoVolume = allItems.length - volumeBacked.length;
  if (droppedNoVolume > 0) {
    warnings.push(`ตัดคำที่ไม่มี Search Volume ออก ${droppedNoVolume} คำ — แสดงเฉพาะ ${volumeBacked.length} คำที่มีข้อมูลจริงจาก Keyword Planner/DataForSEO`);
  }
  if (volumeBacked.length === 0) {
    warnings.push('ไม่มีคำไหนมี volume รายงานในพื้นที่นี้เลย — ลองขยายทำเลรอง หรือใช้คำบริการที่กว้างขึ้น');
  }

  // จัดอันดับรอบแรกเพื่อเลือก top-N ตาม targetCount แล้วประกอบใหม่ให้ cluster สอดคล้อง
  if (volumeBacked.length < targetCount) {
    const expansionFailed = warnings.some(w => w.includes('ไม่สำเร็จ'));
    if (expansionFailed) {
      warnings.unshift(
        `ได้ ${volumeBacked.length}/${targetCount} คำ เพราะรอบขยายผลจาก Google Keyword Planner ขัดข้องชั่วคราว — กด "ค้นหา" ซ้ำอีกครั้งเพื่อดึงให้ครบ`
      );
    }
  }

  const ranked = assembleResults(volumeBacked, input);
  const keepKeywords = new Set(ranked.results.slice(0, targetCount).map(r => dedupeKey(r.keyword)));
  const finalItems = volumeBacked.filter(item => keepKeywords.has(dedupeKey(item.keyword)));
  if (ranked.results.length > targetCount) {
    warnings.push(`แสดง ${targetCount} คำแรกตามคะแนนโอกาส (จากทั้งหมด ${ranked.results.length} คำที่มี volume)`);
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

  // ── แบ่ง sitemap: จัดหน้าเว็บจาก suggestedPage + cluster ──
  const sitemapMap = new Map<string, { page: string; pageType: string; slug: string; keywords: Array<{ keyword: string; volume: number | null; title?: string }> }>();
  for (const r of results) {
    const pageType = r.suggestedPage ?? 'blog';
    const groupName = r.cluster ?? `${r.service}`;
    const key = `${pageType}::${groupName}`;
    if (!sitemapMap.has(key)) {
      const top = r.slug || dedupeKey(groupName).replace(/\s+/g, '-');
      sitemapMap.set(key, { page: groupName, pageType: String(pageType), slug: top, keywords: [] });
    }
    sitemapMap.get(key)!.keywords.push({ keyword: r.keyword, volume: r.volume ?? null, title: r.suggestedTitle });
  }
  const sitemap = Array.from(sitemapMap.values()).sort((a, b) => b.keywords.length - a.keywords.length);

  const response: LocalResearchResponse & { sitemap: typeof sitemap } = {
    results,
    clusters,
    sitemap,
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
