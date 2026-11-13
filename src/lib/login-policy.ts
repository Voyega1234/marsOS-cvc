/**
 * กติกาเข้าระบบ (คำสั่งเจ้าของ 2026-11-13): "เข้าผ่าน Google ได้ แต่ต้องเป็นเมล @convertcake.com เท่านั้น"
 *
 * ไฟล์นี้เป็นฟังก์ชันล้วน (ไม่แตะ DB / network) เพื่อให้เทสได้ — ตัวเรียกจริงอยู่ที่ src/lib/auth.ts
 *
 * ด่านที่ตรวจ เรียงตามลำดับ:
 * 1. session นี้ต้องเกิดจากการ login แบบ OAuth (claim `amr` ใน access token มี method "oauth")
 *    — session ที่ได้จากรหัสผ่าน / OTP / magic link / anonymous ถูกปฏิเสธ แม้อีเมลจะตรง
 * 2. บัญชีต้องมี identity ของ Google ที่ Google ยืนยันอีเมลเดียวกับอีเมลของบัญชี
 *    — กันกรณี login ด้วย Google บัญชีอื่นแล้วเปลี่ยนอีเมลของบัญชี Supabase เป็นของคนในทีม
 *      (identity_data มาจาก Google ผ่านเซิร์ฟเวอร์ Supabase ผู้ใช้แก้เองไม่ได้ ต่างจาก user_metadata)
 * 3. บัญชีต้องไม่มีทางเข้าอื่นผูกอยู่ — identity ทุกตัวต้องเป็น "google" หรือ "email" เท่านั้น
 *    และ identity ของ Google ทุกตัวต้องเป็นอีเมลเดียวกับบัญชี
 *    — claim `amr` บอกแค่ว่าเป็น OAuth ไม่ได้บอกว่าเจ้าไหน / Google บัญชีไหน ข้อนี้จึงปิดช่อง
 *      "ผูก GitHub หรือ Google อีกบัญชีของตัวเองเข้ากับบัญชีที่ใช้อีเมลของคนในทีม แล้วเข้าทางนั้น"
 *      identity แบบ "email" (รหัสผ่าน) มีได้ เพราะ session จากรหัสผ่านถูกข้อ 1 ปฏิเสธอยู่แล้ว
 * 4. อีเมลต้องลงท้าย @convertcake.com ตรงตัว — ใช้กับทุก role ของทีม และการสร้างบัญชีอัตโนมัติ
 *    role CLIENT (ลูกค้า แอดมินเป็นคนเพิ่มเอง เห็นแค่ 3 หน้า) ยกเว้นข้อนี้ เพราะลูกค้าใช้อีเมลของตัวเอง
 *    ถ้าต้องการให้ลูกค้าใช้ @convertcake.com ด้วย เปลี่ยน CLIENT_MUST_USE_COMPANY_EMAIL เป็น true
 *
 * ทางเข้าของลูกค้าด้วยรหัสผ่าน (คำสั่งเจ้าของ 2026-11-13: "เราเป็นคนสร้างรหัสให้ลูกค้า"):
 * ใช้ได้เฉพาะ role CLIENT เท่านั้น — session ที่ `amr` เป็น "password" (ไม่มี "oauth") ผ่านเมื่อ
 * - บัญชี Supabase มี app_metadata.mars_client_user_id เท่ากับ id ของ User คนนี้ใน MarsOS
 *   (ค่านี้เขียนได้ผ่าน admin API ตอนแอดมินสร้าง / รีเซ็ตรหัสในหน้า Users เท่านั้น ผู้ใช้แก้เองไม่ได้)
 *   — บัญชีที่สมัครรหัสผ่านเองไม่มีค่านี้ · เปลี่ยนอีเมลของบัญชีไปเป็นของลูกค้ารายอื่น ค่าก็ไม่ตรง
 *   — เปลี่ยนอีเมลไปเป็นของคนในทีม role ที่หาเจอไม่ใช่ CLIENT จึงตกไปด่าน Google ตามเดิม
 * - บัญชีไม่มีทางเข้าอื่นผูกอยู่ (กติกาเดียวกับข้อ 3)
 * ทีมทุก role และการสร้างบัญชีอัตโนมัติ ยังต้องเป็น Google + @convertcake.com ไม่มีข้อยกเว้น
 *
 * ข้อจำกัดที่รู้อยู่: ไม่ได้ตรวจว่าบัญชี Google อยู่ใน Google Workspace ของบริษัทจริง (claim `hd`)
 * บัญชี Google ส่วนตัวที่สมัครด้วยอีเมล @convertcake.com และ Google ยืนยันอีเมลแล้วจะผ่านข้อ 4 ได้
 * (ยังต้องมี User ที่ ACTIVE ใน MarsOS หรืออยู่ในรายชื่อ ALLOWED_EMAILS อยู่ดี)
 */

import { CLIENT_LOGIN_MARKER } from "./client-login";

export const COMPANY_EMAIL_DOMAIN = "convertcake.com";

/** false = ลูกค้า (role CLIENT) ใช้อีเมลโดเมนของตัวเองได้ · true = ลูกค้าก็ต้องเป็น @convertcake.com */
export const CLIENT_MUST_USE_COMPANY_EMAIL = false;

export type LoginDenyReason =
  | "not_oauth_session"          // session ไม่ได้มาจาก Google OAuth (หรืออ่าน token ไม่ได้)
  | "google_identity_mismatch"   // ไม่มี identity ของ Google ที่อีเมลตรงกับบัญชี
  | "untrusted_identity"         // บัญชีมีทางเข้าอื่นผูกอยู่ (OAuth เจ้าอื่น หรือ Google อีกบัญชี)
  | "email_domain"               // อีเมลไม่ใช่ @convertcake.com
  | "client_password_not_provisioned"; // ลูกค้า login ด้วยรหัสผ่าน แต่บัญชีไม่ได้ถูกสร้างจากหน้า Users ให้ User คนนี้

export type LoginDecision = { ok: true } | { ok: false; reason: LoginDenyReason };

/** ส่วนของ user จาก Supabase ที่กติกานี้ใช้ — เขียนเป็นโครงหลวม ๆ ไม่ผูกกับ type ของไลบรารี */
export interface PolicyAuthUser {
  id: string;
  identities?: Array<{
    provider?: string | null;
    identity_data?: Record<string, unknown> | null;
  }> | null;
  /** เขียนได้ผ่าน admin API เท่านั้น (ต่างจาก user_metadata ที่ผู้ใช้แก้เองได้) */
  app_metadata?: Record<string, unknown> | null;
}

/** โดเมนของอีเมล (ตัวพิมพ์เล็ก) — ตัดที่ @ ตัวสุดท้าย · รูปแบบผิดคืน null */
export function emailDomain(email: string): string | null {
  if (typeof email !== "string") return null;
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}

/** เทียบโดเมนตรงตัว — x@convertcake.com.evil.com และ x@sub.convertcake.com ไม่ผ่าน */
export function isCompanyEmail(email: string): boolean {
  return emailDomain(email) === COMPANY_EMAIL_DOMAIN;
}

/**
 * อ่าน payload ของ JWT โดยไม่ตรวจลายเซ็น
 * ใช้ได้เฉพาะกับ token ที่ Supabase ยืนยันแล้วในคำขอเดียวกัน (auth.getUser(token)) เท่านั้น
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** วิธี login ที่บันทึกใน claim `amr` — Supabase ส่งเป็น [{ method, timestamp }] (รองรับแบบ string[] ด้วย) */
export function amrMethods(claims: Record<string, unknown> | null): string[] {
  const amr = claims?.amr;
  if (!Array.isArray(amr)) return [];
  const out: string[] = [];
  for (const entry of amr) {
    if (typeof entry === "string") out.push(entry);
    else if (entry && typeof entry === "object" && typeof (entry as { method?: unknown }).method === "string") {
      out.push((entry as { method: string }).method);
    }
  }
  return out;
}

/**
 * เวลา (วินาที) ล่าสุดที่ session นี้ login ด้วยวิธีที่ระบุ ตาม claim `amr` · ไม่มี / รูปแบบไม่มีเวลา คืน null
 * ใช้ตรวจว่าเพิ่งพิมพ์รหัสผ่านจริง ไม่ใช่ session เก่าที่ถูกนำกลับมาใช้
 */
export function amrTimestamp(claims: Record<string, unknown> | null, method: string): number | null {
  const amr = claims?.amr;
  if (!Array.isArray(amr)) return null;
  let latest: number | null = null;
  for (const entry of amr) {
    if (!entry || typeof entry !== "object") continue;
    const { method: m, timestamp } = entry as { method?: unknown; timestamp?: unknown };
    if (m !== method || typeof timestamp !== "number" || !Number.isFinite(timestamp)) continue;
    if (latest === null || timestamp > latest) latest = timestamp;
  }
  return latest;
}

/** บัญชีมี identity ของ Google ที่ Google ยืนยันอีเมลเดียวกับอีเมลของบัญชี */
export function hasMatchingGoogleIdentity(authUser: PolicyAuthUser, email: string): boolean {
  const want = email.toLowerCase();
  for (const identity of authUser.identities ?? []) {
    if (identity?.provider !== "google") continue;
    const data = identity.identity_data;
    if (!data || typeof data.email !== "string") continue;
    if (data.email.toLowerCase() !== want) continue;
    // ต้องเป็น true ตรงตัว — ค่าที่หายไป / เป็น string ไม่นับว่ายืนยันแล้ว
    // (Supabase Auth เขียน email_verified ลง identity_data ทุกครั้ง ไม่มี omitempty)
    if (data.email_verified !== true) continue;
    return true;
  }
  return false;
}

/**
 * บัญชีไม่มีทางเข้าอื่นนอกจาก Google ของอีเมลนี้ (และ identity แบบรหัสผ่าน)
 * false เมื่อมี identity ของผู้ให้บริการอื่น หรือมี Google อีกบัญชีที่อีเมลไม่ตรงผูกอยู่
 */
export function hasOnlyTrustedIdentities(authUser: PolicyAuthUser, email: string): boolean {
  const want = email.toLowerCase();
  for (const identity of authUser.identities ?? []) {
    if (identity?.provider === "email") continue;
    if (identity?.provider !== "google") return false;
    const identityEmail = identity.identity_data?.email;
    if (typeof identityEmail !== "string" || identityEmail.toLowerCase() !== want) return false;
  }
  return true;
}

/**
 * ตัดสินว่า session นี้เข้า MarsOS ได้หรือไม่
 * @param role role ของ User ใน MarsOS · null = ยังไม่มี User (กำลังจะสร้างบัญชีอัตโนมัติ) นับเป็นทีม
 * @param userId id ของ User ใน MarsOS ที่อีเมลนี้ชี้ไป — ใช้เฉพาะทางเข้าด้วยรหัสผ่านของลูกค้า
 */
export function checkLoginPolicy(input: {
  email: string;
  role: string | null;
  accessToken: string;
  authUser: PolicyAuthUser;
  userId?: string | null;
}): LoginDecision {
  const { email, role, accessToken, authUser, userId } = input;

  const claims = decodeJwtPayload(accessToken);
  // token ต้องเป็นของ user คนเดียวกับที่ Supabase ยืนยัน และต้องเป็น session แบบ OAuth
  if (!claims || !authUser?.id || claims.sub !== authUser.id) return { ok: false, reason: "not_oauth_session" };
  const methods = amrMethods(claims);

  // ── ลูกค้าเข้าด้วยรหัสผ่านที่ทีมสร้างให้ — เฉพาะ role CLIENT ตรงตัว role อื่นและ null ไม่เข้าทางนี้ ──
  if (role === "CLIENT" && methods.includes("password") && !methods.includes("oauth")) {
    const marker = authUser.app_metadata?.[CLIENT_LOGIN_MARKER];
    if (!userId || typeof marker !== "string" || marker !== userId) {
      return { ok: false, reason: "client_password_not_provisioned" };
    }
    if (!hasOnlyTrustedIdentities(authUser, email)) return { ok: false, reason: "untrusted_identity" };
    return { ok: true };
  }

  if (!methods.includes("oauth")) return { ok: false, reason: "not_oauth_session" };

  if (!hasMatchingGoogleIdentity(authUser, email)) return { ok: false, reason: "google_identity_mismatch" };
  if (!hasOnlyTrustedIdentities(authUser, email)) return { ok: false, reason: "untrusted_identity" };

  const needsCompanyEmail = role !== "CLIENT" || CLIENT_MUST_USE_COMPANY_EMAIL;
  if (needsCompanyEmail && !isCompanyEmail(email)) return { ok: false, reason: "email_domain" };

  return { ok: true };
}
