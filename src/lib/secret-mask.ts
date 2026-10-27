/**
 * กันความลับหลุดไปฝั่ง browser ผ่าน response ของ API
 * - wpAppPassword: ส่งค่าปิดบังแทน (UI ใช้แค่เช็คว่า "มีรหัสเก็บไว้แล้ว") และ PUT ที่ส่งค่าปิดบังกลับมาจะไม่ทับรหัสจริง
 * - siteConnection: secret ของแต่ละแพลตฟอร์ม (API key/token) เป็น "••••" ช่องที่ไม่ใช่ secret (โดเมน/ID) แสดงค่าจริง
 * - รหัสผ่านผู้ใช้ (password/passwordPlain) ตัดทิ้งเสมอ
 */
import { NON_SECRET_SITE_CONN_FIELDS } from "@/lib/upload-article/serialize";

export const SECRET_MASK = "********";
/** ค่าปิดบัง secret ใน siteConnection — ตัวเดียวกับ Upload Article */
export const SITE_SECRET_MASK = "••••";

type SiteConn = Record<string, Record<string, string>>;

function parseSiteConn(raw: unknown): SiteConn {
  let v: unknown = raw;
  if (typeof raw === "string") { try { v = JSON.parse(raw || "{}"); } catch { return {}; } }
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: SiteConn = {};
  for (const [platform, cfg] of Object.entries(v as Record<string, unknown>)) {
    if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) continue;
    const fields: Record<string, string> = {};
    for (const [k, val] of Object.entries(cfg as Record<string, unknown>)) if (typeof val === "string") fields[k] = val;
    out[platform] = fields;
  }
  return out;
}

/** siteConnection (JSON string) ที่ปิด secret แล้ว — ใช้ส่งให้ browser เท่านั้น */
export function maskSiteConnectionJson(raw: string | null | undefined): string {
  const conn = parseSiteConn(raw);
  for (const cfg of Object.values(conn)) {
    for (const k of Object.keys(cfg)) if (cfg[k] && !NON_SECRET_SITE_CONN_FIELDS.has(k)) cfg[k] = SITE_SECRET_MASK;
  }
  return JSON.stringify(conn);
}

/** แพลตฟอร์มที่ secret ผูกกับโดเมน — เปลี่ยนโดเมนโดยไม่ใส่ secret ใหม่ ต้องล้าง secret เดิม (ตรงกับ Upload Article) */
const DOMAIN_BOUND_SECRETS: Record<string, { domain: string; secrets: string[] }> = {
  shopify: { domain: "storeDomain", secrets: ["accessToken"] },
  custom: { domain: "webhookUrl", secrets: ["secret"] },
};

/**
 * รวม siteConnection ที่ browser ส่งมากับค่าเดิมใน DB ก่อนบันทึก
 * secret ที่ว่าง/ยังเป็นค่าปิดบัง = คงค่าเดิม, ช่องที่ไม่ใช่ secret ใช้ค่าที่ส่งมา (ล้างได้)
 */
export function mergeSiteConnectionSecrets(currentRaw: string | null | undefined, incomingRaw: unknown): string {
  const current = parseSiteConn(currentRaw);
  const incoming = parseSiteConn(incomingRaw);
  const merged: SiteConn = { ...current };
  for (const [platform, cfg] of Object.entries(incoming)) {
    const prev = current[platform] ?? {};
    const next: Record<string, string> = { ...prev };
    for (const [k, val] of Object.entries(cfg)) {
      if (NON_SECRET_SITE_CONN_FIELDS.has(k)) next[k] = val;
      else if (val && !val.startsWith(SITE_SECRET_MASK)) next[k] = val;
    }
    const rule = DOMAIN_BOUND_SECRETS[platform];
    if (rule) {
      const domainChanged = (next[rule.domain] ?? "") !== "" && (next[rule.domain] ?? "") !== (prev[rule.domain] ?? "");
      const resupplied = rule.secrets.some(s => !!cfg[s] && !cfg[s].startsWith(SITE_SECRET_MASK));
      if (domainChanged && !resupplied) for (const s of rule.secrets) delete next[s];
    }
    merged[platform] = next;
  }
  return JSON.stringify(merged);
}

/**
 * เปลี่ยนโดเมน (Shopify storeDomain / custom webhookUrl) โดยไม่ใส่ secret ใหม่ ทั้งที่มี secret เดิมเก็บไว้
 * → คืนข้อความให้ผู้ใช้ใส่ secret ใหม่ (ห้ามส่ง secret เดิมไปโดเมนใหม่ และห้ามลบทิ้งเงียบ ๆ)
 */
export function domainBoundSecretMissing(currentRaw: string | null | undefined, incomingRaw: unknown): string | null {
  const current = parseSiteConn(currentRaw);
  const incoming = parseSiteConn(incomingRaw);
  for (const [platform, rule] of Object.entries(DOMAIN_BOUND_SECRETS)) {
    const cfg = incoming[platform];
    if (!cfg || !(rule.domain in cfg)) continue;
    const prev = current[platform] ?? {};
    const nextDomain = cfg[rule.domain] ?? "";
    if (!nextDomain || nextDomain === (prev[rule.domain] ?? "")) continue;
    const hadSecret = rule.secrets.some(s => !!prev[s]);
    const resupplied = rule.secrets.some(s => !!cfg[s] && !cfg[s].startsWith(SITE_SECRET_MASK));
    if (hadSecret && !resupplied) {
      return platform === "shopify"
        ? "เปลี่ยน Store Domain แล้ว — ต้องใส่ Access Token ของร้านใหม่ด้วย"
        : "เปลี่ยน Webhook URL แล้ว — ต้องใส่ Secret ใหม่ด้วย";
    }
  }
  return null;
}

export function maskProjectSecrets<T extends { wpAppPassword?: string | null; siteConnection?: string | null }>(p: T): T {
  return {
    ...p,
    wpAppPassword: p.wpAppPassword ? SECRET_MASK : p.wpAppPassword,
    ...(typeof p.siteConnection === "string" ? { siteConnection: maskSiteConnectionJson(p.siteConnection) } : {}),
  };
}

export function stripUserSecrets<T extends Record<string, unknown>>(u: T | null | undefined): T | null | undefined {
  if (!u) return u;
  const { password: _p, passwordPlain: _pp, ...rest } = u as T & { password?: unknown; passwordPlain?: unknown };
  return rest as unknown as T;
}
