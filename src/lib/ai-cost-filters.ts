/**
 * ตัวกรองของหน้า AI Cost — อ่าน/เขียนจาก query string (แชร์ลิงก์ได้ ปุ่ม back ใช้ได้)
 * ฟังก์ชันล้วน ใช้ได้ทั้งเซิร์ฟเวอร์และเบราว์เซอร์
 */
import { AI_COST_MODULES } from "@/lib/ai-cost-modules";
import { AI_COST_DEFAULT_PRESET, type AiCostRange } from "@/lib/ai-cost-range";

export const AI_COST_PAGE_SIZE = 50;

export type AiCostStatusFilter = "ok" | "failed";
export type AiCostSort = "time" | "cost";

export interface AiCostFilters {
  module?: string;
  type?: string;
  model?: string;
  /** p:<projectId> | ua:<uploadClientId> | none */
  source?: string;
  user?: string;
  status?: AiCostStatusFilter;
}

export const AI_COST_FILTER_KEYS = ["module", "type", "model", "source", "user", "status"] as const;
export type AiCostFilterKey = (typeof AI_COST_FILTER_KEYS)[number];

type ParamValue = string | string[] | undefined;
export type AiCostSearchParams = Record<string, ParamValue> | undefined;
const first = (v: ParamValue): string => ((Array.isArray(v) ? v[0] : v) ?? "").trim();

const SAFE_ID = /^[A-Za-z0-9_-]{0,64}$/;
/** ข้อความอิสระ (ชื่อ type/model) — ห้ามอักขระควบคุม ยาวไม่เกิน 200 */
const isSafeText = (s: string) => s.length >= 1 && s.length <= 200 && !/[\r\n\t]/.test(s);

export function parseAiCostFilters(sp: AiCostSearchParams): AiCostFilters {
  const f: AiCostFilters = {};
  const module = first(sp?.module);
  if (AI_COST_MODULES.some((m) => m.key === module)) f.module = module;
  const type = first(sp?.type);
  if (isSafeText(type)) f.type = type;
  const model = first(sp?.model);
  if (isSafeText(model)) f.model = model;
  const source = first(sp?.source);
  if (source === "none" || (source.startsWith("p:") && source.length > 2 && SAFE_ID.test(source.slice(2))) || (source.startsWith("ua:") && SAFE_ID.test(source.slice(3)))) {
    f.source = source;
  }
  const user = first(sp?.user);
  if (user && SAFE_ID.test(user)) f.user = user;
  const status = first(sp?.status);
  if (status === "ok" || status === "failed") f.status = status;
  return f;
}

export function parseAiCostSort(sp: AiCostSearchParams): AiCostSort {
  return first(sp?.sort) === "cost" ? "cost" : "time";
}

export function parseAiCostPage(sp: AiCostSearchParams): number {
  const n = Number.parseInt(first(sp?.page), 10);
  return Number.isFinite(n) && n >= 1 && n <= 100000 ? n : 1;
}

export function hasActiveAiCostFilters(f: AiCostFilters): boolean {
  return AI_COST_FILTER_KEYS.some((k) => f[k] !== undefined);
}

/** query string เต็มของมุมมองหนึ่ง ๆ — ค่าเริ่มต้นไม่ใส่เพื่อให้ URL สั้น */
export function buildAiCostQuery(
  range: Pick<AiCostRange, "preset" | "from" | "to">,
  filters: AiCostFilters,
  opts: { sort?: AiCostSort; page?: number } = {},
): string {
  const q = new URLSearchParams();
  if (range.preset === "custom") {
    if (range.from) q.set("from", range.from);
    if (range.to) q.set("to", range.to);
  } else if (range.preset !== AI_COST_DEFAULT_PRESET) {
    q.set("range", range.preset);
  }
  for (const k of AI_COST_FILTER_KEYS) {
    const v = filters[k];
    if (v) q.set(k, v);
  }
  if (opts.sort === "cost") q.set("sort", "cost");
  if (opts.page && opts.page > 1) q.set("page", String(opts.page));
  const s = q.toString();
  return s ? `?${s}` : "";
}
