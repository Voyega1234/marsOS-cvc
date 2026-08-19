// ─────────────────────────────────────────────────────────────────────────────
//  DataForSEO Integration (ported จาก leadgod/RadarGod)
//
//  ใส่ DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD (หรือ DATAFORSEO_API_KEY แบบ
//  Base64) ใน .env เพื่อเปิดใช้
//
//  นโยบายระบบ: ห้าม fallback เป็น mock — ถ้าไม่มี credentials หรือ API พัง
//  ให้ throw เพื่อให้หน้า UI แสดงสถานะจริงว่า "ยังไม่ได้เชื่อมต่อ DataForSEO"
// ─────────────────────────────────────────────────────────────────────────────

const BASE_URL = "https://api.dataforseo.com/v3";

export function isDataForSeoConfigured(): boolean {
  return Boolean(
    process.env.DATAFORSEO_API_KEY ||
    (process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD)
  );
}

function getAuthHeader(): string {
  if (process.env.DATAFORSEO_API_KEY) return "Basic " + process.env.DATAFORSEO_API_KEY;
  const creds = `${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`;
  return "Basic " + Buffer.from(creds).toString("base64");
}

async function dfsPost(path: string, body: unknown): Promise<unknown> {
  if (!isDataForSeoConfigured()) {
    throw new Error("DATAFORSEO_NOT_CONFIGURED: ใส่ DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD ใน .env ก่อน");
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { Authorization: getAuthHeader(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`DataForSEO ${res.status}: ${await res.text()}`);
  return res.json();
}

export interface SerpResult {
  domain: string;
  url: string;
  title: string;
  rank: number;
  type: string;
}

export interface KeywordIdea {
  keyword: string;
  searchVolume: number;
  cpc: number;
  /** 0-1 (normalize จาก competition_index หรือ LOW/MEDIUM/HIGH) */
  competition: number;
}

// DataForSEO บาง endpoint ส่ง competition เป็น string (LOW/MEDIUM/HIGH)
// บาง endpoint เป็นตัวเลข 0-1 และมี competition_index (0-100) — normalize เป็น 0-1 เสมอ
function normalizeCompetition(raw: unknown, index?: unknown): number {
  if (typeof index === "number") return Math.max(0, Math.min(1, index / 100));
  if (typeof raw === "number") return Math.max(0, Math.min(1, raw));
  if (typeof raw === "string") {
    const map: Record<string, number> = { LOW: 0.25, MEDIUM: 0.55, HIGH: 0.85 };
    return map[raw.toUpperCase()] ?? 0;
  }
  return 0;
}

interface RawSerpItem {
  type: string;
  domain: string;
  url: string;
  title: string;
  description?: string;
  rank_group: number;
}

// ค่าเริ่มต้นสำหรับตลาดไทย
export const DFS_DEFAULT_LOCATION = "Thailand";
export const DFS_DEFAULT_LANGUAGE = "Thai";

// ดึง keyword ideas + volume จริงจาก seed keywords (สูงสุด 20 seed ต่อ call)
export async function fetchKeywordIdeas(params: {
  seeds: string[];
  location?: string;
  language?: string;
}): Promise<KeywordIdea[]> {
  const data = await dfsPost("/keywords_data/google_ads/keywords_for_keywords/live", [
    {
      keywords: params.seeds.slice(0, 20),
      location_name: params.location ?? DFS_DEFAULT_LOCATION,
      language_name: params.language ?? DFS_DEFAULT_LANGUAGE,
    },
  ]) as { tasks?: { result?: { keyword: string; search_volume: number; cpc: number; competition: unknown; competition_index?: number }[] }[] };

  return (data.tasks?.[0]?.result ?? []).map((r) => ({
    keyword: r.keyword,
    searchVolume: r.search_volume ?? 0,
    cpc: r.cpc ?? 0,
    competition: normalizeCompetition(r.competition, r.competition_index),
  }));
}

// ดึง volume จริงของ keyword ที่ระบุ (ไม่ขยายเพิ่ม) — ใช้เติม volume ให้ keyword ที่ AI generate
export async function fetchSearchVolume(params: {
  keywords: string[];
  location?: string;
  language?: string;
}): Promise<KeywordIdea[]> {
  const data = await dfsPost("/keywords_data/google_ads/search_volume/live", [
    {
      keywords: params.keywords.slice(0, 1000),
      location_name: params.location ?? DFS_DEFAULT_LOCATION,
      language_name: params.language ?? DFS_DEFAULT_LANGUAGE,
    },
  ]) as { tasks?: { result?: { keyword: string; search_volume: number; cpc: number; competition: unknown; competition_index?: number }[] }[] };

  return (data.tasks?.[0]?.result ?? []).map((r) => ({
    keyword: r.keyword,
    searchVolume: r.search_volume ?? 0,
    cpc: r.cpc ?? 0,
    competition: normalizeCompetition(r.competition, r.competition_index),
  }));
}

// ดึง SERP organic results สำหรับ keyword (ดูคู่แข่งหน้าแรก)
export async function fetchSerpResults(params: {
  keyword: string;
  location?: string;
  language?: string;
  device?: string;
}): Promise<SerpResult[]> {
  const data = await dfsPost("/serp/google/organic/live/advanced", [
    {
      keyword: params.keyword,
      location_name: params.location ?? DFS_DEFAULT_LOCATION,
      language_name: params.language ?? DFS_DEFAULT_LANGUAGE,
      device: params.device ?? "desktop",
      depth: 50,
    },
  ]) as { tasks?: { result?: { items?: RawSerpItem[] }[] }[] };

  const items = data.tasks?.[0]?.result?.[0]?.items ?? [];
  return items
    .filter((item) => item.type === "organic")
    .map((item) => ({
      domain: item.domain,
      url: item.url,
      title: item.title,
      rank: item.rank_group,
      type: "organic",
    }));
}
