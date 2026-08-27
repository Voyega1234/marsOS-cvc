/**
 * WordGod Local SME — Volume Trust Layer (Local SEO Intelligence Engine)
 *
 * กติกาที่ห้ามละเมิด (สเปก §26–§31, non-negotiable):
 *  - เก็บ Google Keyword Planner กับ DataForSEO แยกกันเสมอ — ห้ามเฉลี่ยรวมเด็ดขาด
 *  - reference_volume = Google ถ้ามี → ไม่มีค่อยใช้ DFS → ไม่มีทั้งคู่ = NULL พร้อมป้ายบอกที่มา
 *  - ZERO (API ตอบ 0 จริง) ≠ NULL (ไม่มีข้อมูล) ≠ API_ERROR (เรียกไม่สำเร็จ)
 *  - AI ห้ามเป็นแหล่งของตัวเลข volume/CPC/KD/competition ใด ๆ
 *
 * ไฟล์นี้เป็น pure function + type ล้วน ไม่มี I/O — ใช้ร่วมกันทั้ง route, UI (ผ่าน
 * serialization) และ Excel export เพื่อให้ทุกช่องอ่านจากชุดข้อมูล canonical เดียวกัน
 */

/** สถานะของข้อมูลจากแหล่งเดียว — แยก "ศูนย์จริง" ออกจาก "ไม่มีข้อมูล" และ "API พัง" */
export type MetricStatus = 'ok' | 'zero' | 'no_data' | 'api_error' | 'not_requested';

export interface GoogleMetricData {
  /** ค่าเฉลี่ยการค้นหา/เดือนจาก Keyword Planner — null = ไม่มีข้อมูล (ไม่ใช่ 0) */
  avgMonthlySearches: number | null;
  /** ซีรีส์รายเดือน (ล่าสุดอยู่ท้าย) ตามที่ KP ให้มา — ใช้ทำ trend */
  monthlySearchVolumes: number[] | null;
  competition: string | null;        // LOW | MEDIUM | HIGH
  competitionIndex: number | null;   // 0–100
  bidLowMicros: number | null;       // แปลงเป็นหน่วยเงินแล้ว (บาท) — คงชื่อ bid ตามสเปก
  bidHighMicros: number | null;
  /** geo ที่ได้ข้อมูลจริง (อาจกว้างกว่าที่ขอ เช่น ขอ "บางแค" ได้ระดับ "กรุงเทพฯ") */
  geoTarget: string | null;
  geoLevel: string | null;           // district | province | bangkok | national
  language: string;
  retrievedAt: string | null;        // ISO timestamp ตอนดึงข้อมูล
  status: MetricStatus;
  /** รูปคำตัวแทนกลุ่ม close variants จาก Keyword Planner — หลายคำที่ค่านี้ตรงกัน = คำเดียวกันในสายตา Google */
  plannerCanonical?: string | null;
}

export interface DfsMetricData {
  searchVolume: number | null;
  monthlySearches: number[] | null;
  cpc: number | null;                // บาท (แปลงจาก USD ที่ชั้น service แล้ว)
  competition: string | null;
  competitionIndex: number | null;
  keywordDifficulty: number | null;  // 0–100 จาก DataForSEO Labs (SEO difficulty จริง)
  locationCode: number;              // เช่น 2764 = Thailand
  language: string;
  retrievedAt: string | null;
  status: MetricStatus;
}

export type ReferenceSource = 'google_keyword_planner' | 'dataforseo' | 'none';

export type VolumeConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'LOCAL' | 'NO_VOLUME';

export interface ReferenceVolume {
  volume: number | null;
  source: ReferenceSource;
}

export function emptyGoogleMetric(language = 'th'): GoogleMetricData {
  return {
    avgMonthlySearches: null, monthlySearchVolumes: null, competition: null,
    competitionIndex: null, bidLowMicros: null, bidHighMicros: null,
    geoTarget: null, geoLevel: null, language, retrievedAt: null, status: 'not_requested',
  };
}

export function emptyDfsMetric(language = 'th', locationCode = 2764): DfsMetricData {
  return {
    searchVolume: null, monthlySearches: null, cpc: null, competition: null,
    competitionIndex: null, keywordDifficulty: null, locationCode, language,
    retrievedAt: null, status: 'not_requested',
  };
}

/**
 * เลือกค่า reference ตามลำดับความน่าเชื่อ: Google ก่อนเสมอ (Primary Client
 * Reference Volume) → DFS → ไม่มีทั้งคู่ = null พร้อม source 'none'
 * ค่า 0 จริงจากแหล่งใดแหล่งหนึ่งถือว่า "มีข้อมูล" (ZERO ≠ NULL)
 */
export function resolveReferenceVolume(g: GoogleMetricData, d: DfsMetricData): ReferenceVolume {
  if (g.status === 'ok' || g.status === 'zero') {
    return { volume: g.avgMonthlySearches ?? 0, source: 'google_keyword_planner' };
  }
  if (d.status === 'ok' || d.status === 'zero') {
    return { volume: d.searchVolume ?? 0, source: 'dataforseo' };
  }
  return { volume: null, source: 'none' };
}

/**
 * ระดับความเชื่อมั่นของตัวเลข volume (สเปก §29–§31):
 *  - สองแหล่งตรงกัน (ratio ≤1.5) → HIGH, ≤3 → MEDIUM, >3 → LOW
 *  - มีแหล่งเดียว → MEDIUM
 *  - volume = 0/ไม่มี แต่มีหลักฐาน local จริง → LOCAL (โอกาสท้องถิ่น ไม่ใช่คำไร้ค่า)
 *  - ไม่มีข้อมูลเลย → NO_VOLUME
 */
export function computeVolumeConfidence(
  g: GoogleMetricData,
  d: DfsMetricData,
  opts?: { zeroVolumeLocalOpportunity?: boolean }
): VolumeConfidence {
  const gv = (g.status === 'ok' || g.status === 'zero') ? (g.avgMonthlySearches ?? 0) : null;
  const dv = (d.status === 'ok' || d.status === 'zero') ? (d.searchVolume ?? 0) : null;

  if (gv !== null && dv !== null) {
    if (gv > 0 && dv > 0) {
      const ratio = Math.max(gv, dv) / Math.min(gv, dv);
      if (ratio <= 1.5) return 'HIGH';
      if (ratio <= 3) return 'MEDIUM';
      return 'LOW';
    }
    if (gv === 0 && dv === 0) {
      return opts?.zeroVolumeLocalOpportunity ? 'LOCAL' : 'NO_VOLUME';
    }
    // แหล่งหนึ่ง 0 อีกแหล่งมีตัวเลข — ขัดกันเกิน 3 เท่าโดยนิยาม
    return 'LOW';
  }

  if (gv !== null || dv !== null) {
    const only = gv ?? dv ?? 0;
    if (only === 0) return opts?.zeroVolumeLocalOpportunity ? 'LOCAL' : 'NO_VOLUME';
    return 'MEDIUM';
  }

  return opts?.zeroVolumeLocalOpportunity ? 'LOCAL' : 'NO_VOLUME';
}

/** โทษคะแนนจากความไม่แน่นอนของข้อมูล — ใช้ใน Final Opportunity Score */
export function confidencePenalty(confidence: VolumeConfidence): number {
  switch (confidence) {
    case 'HIGH': return 0;
    case 'MEDIUM': return 2;
    case 'LOW': return 6;
    case 'LOCAL': return 0;      // โอกาสท้องถิ่นที่มีหลักฐาน — ไม่ลงโทษ
    case 'NO_VOLUME': return 8;
  }
}

// ── Search Intent (จาก DataForSEO — ไม่ใช่ AI เดา) ───────────────────────────

export interface SearchIntentData {
  intent: string | null;             // informational | navigational | commercial | transactional
  probability: number | null;        // 0–1
  retrievedAt: string | null;
  status: MetricStatus;
}

export function emptySearchIntent(): SearchIntentData {
  return { intent: null, probability: null, retrievedAt: null, status: 'not_requested' };
}

// ── Local SERP signals (จาก DataForSEO SERP API) ─────────────────────────────

export interface SerpSignals {
  hasLocalPack: boolean;
  localPackPosition: number | null;
  /** จำนวนผลแต่ละประเภทใน top 10 — นับจากข้อมูล SERP จริง */
  servicePageCount: number;
  articleCount: number;
  directoryCount: number;
  topUrls: string[];                 // URL top 10 ใช้ทำ SERP overlap clustering
  topDomains: string[];
  serpIntent: string | null;         // อ่านจากส่วนผสมของ SERP: service | mixed | informational
  serpOpportunityScore: number | null; // 0–100
  serpCheckedAt: string | null;
  status: MetricStatus;
}

export function emptySerpSignals(): SerpSignals {
  return {
    hasLocalPack: false, localPackPosition: null, servicePageCount: 0,
    articleCount: 0, directoryCount: 0, topUrls: [], topDomains: [],
    serpIntent: null, serpOpportunityScore: null, serpCheckedAt: null, status: 'not_requested',
  };
}

/** โดเมนที่ไม่นับเป็น "คู่แข่งธุรกิจ" ตอนขุดคีย์เวิร์ดจากคู่แข่ง (สเปก §22) */
export const NON_COMPETITOR_DOMAINS = [
  'wikipedia.org', 'wikimedia.org', 'youtube.com', 'facebook.com', 'instagram.com',
  'tiktok.com', 'pantip.com', 'go.th', 'wongnai.com', 'google.com', 'shopee.co.th',
  'lazada.co.th', 'twitter.com', 'x.com', 'line.me',
];

export function isCompetitorDomain(domain: string): boolean {
  const d = domain.toLowerCase();
  return !NON_COMPETITOR_DOMAINS.some(skip => d === skip || d.endsWith(`.${skip}`) || d.endsWith(skip));
}

/** ป้ายที่มาแบบอ่านง่ายสำหรับ UI/Excel */
export function referenceSourceLabel(source: ReferenceSource): string {
  switch (source) {
    case 'google_keyword_planner': return 'Google';
    case 'dataforseo': return 'DFS';
    case 'none': return 'N/A';
  }
}
