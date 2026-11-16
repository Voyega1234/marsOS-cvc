import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import {
  CLIENT_LOGIN_EMAIL_DOMAIN,
  CLIENT_LOGIN_MARKER,
  classifyPasswordSignInError,
  isFreshPasswordLogin,
} from "@/lib/client-login";
import { amrTimestamp, checkLoginPolicy, decodeJwtPayload } from "@/lib/login-policy";

/**
 * Supabase admin client (secret key) — ใช้ฝั่งเซิร์ฟเวอร์เท่านั้น ห้าม import จาก client component
 *
 * มีหน้าที่เดียว: ทำให้บัญชีลูกค้า (role CLIENT) ที่ทีมสร้างในหน้า "จัดการ Users" login ด้วยรหัสผ่านได้
 * โดยสร้าง / อัปเดต / ลบบัญชีคู่กันใน Supabase Auth — ตัวตัดสินว่าเข้าได้หรือไม่อยู่ที่ src/lib/login-policy.ts
 *
 * user pool ของ Supabase ใช้ร่วมกับระบบอื่น — ไฟล์นี้จึงแตะเฉพาะอีเมล @mars.local
 * (โดเมนที่ไม่มีอยู่จริง มีแต่หน้า Users ของ MarsOS ที่ใช้) ไม่สร้าง ไม่แก้ ไม่ลบบัญชีของอีเมลจริงเด็ดขาด
 * เพราะบัญชีอีเมลจริงอาจเป็นของคนเดียวกันในระบบอื่น — ลูกค้าที่ใช้อีเมลจริงเข้าด้วย Google ตามเดิม
 *
 * ทุกฟังก์ชันไม่ throw — ล้มเหลวคืน { ok: false, error } ให้หน้า Users แสดงเตือน (บัญชีใน MarsOS ยังถูกสร้างตามปกติ)
 */

export type ClientLoginResult = { ok: true } | { ok: false; error: string };

const LIST_PER_PAGE = 1000;
const LIST_MAX_PAGES = 50;

function createSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  try {
    return createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  } catch {
    return null;
  }
}

const NOT_CONFIGURED = "ยังไม่ได้ตั้งค่า SUPABASE_SECRET_KEY บนเซิร์ฟเวอร์";
const NOT_CLIENT_LOGIN_EMAIL = `login ด้วยรหัสผ่านใช้ได้เฉพาะบัญชี @${CLIENT_LOGIN_EMAIL_DOMAIN} ที่สร้างจากหน้า Users`;

/** อีเมลที่ไฟล์นี้จัดการได้ — @mars.local เท่านั้น (ดูหัวไฟล์) */
export function isClientLoginEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith(`@${CLIENT_LOGIN_EMAIL_DOMAIN}`);
}

function errorText(e: unknown): string {
  return e instanceof Error && e.message ? e.message : "เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ";
}

/** admin API ไม่มีค้นด้วยอีเมล — ไล่ทีละหน้า · complete = false แปลว่าไล่ไม่ครบ ห้ามสรุปว่า "ไม่มี" */
async function findAuthUserByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<{ user: User | null; complete: boolean; error?: string }> {
  for (let page = 1; page <= LIST_MAX_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: LIST_PER_PAGE });
    if (error) return { user: null, complete: false, error: error.message };
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return { user: hit, complete: true };
    if (!data.nextPage || data.users.length === 0) return { user: null, complete: true };
  }
  return { user: null, complete: false };
}

function markerOf(user: User): unknown {
  return (user.app_metadata as Record<string, unknown> | undefined)?.[CLIENT_LOGIN_MARKER];
}

/** บัญชีที่ MarsOS จัดการได้: อีเมล @mars.local เท่านั้น — marker อย่างเดียวไม่พอ */
function isManagedAccount(user: User): boolean {
  return isClientLoginEmail(user.email ?? "");
}

function hasOnlyEmailIdentity(user: User): boolean {
  return (user.identities ?? []).every((i) => i.provider === "email");
}

/**
 * ทำให้บัญชีลูกค้า login ด้วยรหัสผ่านนี้ได้ — เรียกตอนสร้าง user และตอนรีเซ็ตรหัสผ่าน
 *
 * 1. ยังไม่มีบัญชีใน Supabase → สร้างใหม่ (ยืนยันอีเมลให้เลย ไม่มีอีเมลส่งออก) พร้อม marker = id ของ User
 * 2. มีอยู่แล้วและเป็นของ User คนนี้ → เปลี่ยนรหัสผ่าน (Supabase ตัด session เดิมทั้งหมดเมื่อรหัสผ่านเปลี่ยน)
 * 3. มีอยู่แล้วแต่ marker ไม่ตรง / ไม่มี marker / มีทางเข้าอื่นผูกอยู่ → ลบทิ้งแล้วสร้างใหม่
 *    (กันคนสมัคร <ชื่อ>@mars.local ดักไว้ก่อน หรือบัญชีค้างจาก User ที่ถูกลบไปแล้ว)
 * 4. อีเมลไม่ใช่ @mars.local → ไม่ทำอะไรเลย คืน error (ไม่สร้างบัญชีรหัสผ่านทับอีเมลจริงของใคร)
 */
export async function syncClientLoginAccount(input: {
  userId: string;
  email: string;
  password: string;
}): Promise<ClientLoginResult> {
  const email = input.email.trim().toLowerCase();
  if (!isClientLoginEmail(email)) return { ok: false, error: NOT_CLIENT_LOGIN_EMAIL };
  const admin = createSupabaseAdmin();
  if (!admin) return { ok: false, error: NOT_CONFIGURED };

  const appMetadata = { [CLIENT_LOGIN_MARKER]: input.userId };
  const create = () =>
    admin.auth.admin.createUser({
      email,
      password: input.password,
      email_confirm: true,
      app_metadata: appMetadata,
    });

  try {
    const first = await create();
    if (!first.error && first.data.user) return { ok: true };
    const firstError = first.error?.message ?? "สร้างบัญชี login ไม่สำเร็จ";

    const found = await findAuthUserByEmail(admin, email);
    if (!found.user) {
      return { ok: false, error: found.complete ? firstError : `${firstError} (ตรวจบัญชีเดิมไม่ครบ)` };
    }
    const existing = found.user;
    if (!isManagedAccount(existing)) {
      return { ok: false, error: "อีเมลนี้มีบัญชี login อยู่แล้วที่ MarsOS ไม่ได้สร้าง — ใช้ชื่อผู้ใช้อื่น" };
    }

    if (markerOf(existing) === input.userId && hasOnlyEmailIdentity(existing)) {
      const updated = await admin.auth.admin.updateUserById(existing.id, {
        password: input.password,
        email_confirm: true,
        app_metadata: appMetadata,
      });
      if (updated.error) return { ok: false, error: updated.error.message };
      return { ok: true };
    }

    const removed = await admin.auth.admin.deleteUser(existing.id);
    if (removed.error) return { ok: false, error: `ลบบัญชี login เดิมไม่สำเร็จ: ${removed.error.message}` };
    const second = await create();
    if (second.error || !second.data.user) {
      return { ok: false, error: second.error?.message ?? "สร้างบัญชี login ไม่สำเร็จ" };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorText(e) };
  }
}

/** จุดที่ทำให้ลูกค้า login ไม่ได้ — หน้า Users ใช้แสดงผลของปุ่ม "ตรวจ login" */
export type ClientLoginCheckCode =
  | "ok"
  | "not_client_login_email"   // อีเมลไม่ใช่ @mars.local
  | "not_configured"           // เซิร์ฟเวอร์ไม่มี secret key ของ Supabase
  | "admin_api_failed"         // เรียก admin API ไม่ผ่าน (key ผิด / หมดอายุ / Supabase ล่ม)
  | "lookup_incomplete"        // admin API ใช้ได้ แต่ไล่รายชื่อบัญชีไม่ครบ (บัญชีใน pool มากเกินเพดาน) — สรุปไม่ได้ว่ามีบัญชีหรือไม่
  | "no_account"              // ไม่มีบัญชีคู่กันใน Supabase Auth
  | "marker_mismatch"          // บัญชีมีอยู่ แต่ไม่ได้ผูกกับ User คนนี้
  | "extra_identity"           // บัญชีมีทางเข้าอื่นผูกอยู่
  | "not_confirmed"
  | "banned"
  | "no_stored_password"       // MarsOS ไม่มีรหัสผ่านเก็บไว้ ลองเข้าแทนไม่ได้
  | "wrong_password"           // รหัสใน MarsOS ไม่ตรงกับรหัสของบัญชี login
  | "password_login_disabled"  // โปรเจกต์ Supabase ปิดการเข้าด้วยรหัสผ่าน
  | "captcha"                  // โปรเจกต์ Supabase เปิด CAPTCHA
  | "rate_limited"
  | "sign_in_failed"
  | "policy_denied";           // เข้า Supabase ได้ แต่กติกาของ MarsOS ไม่ให้ผ่าน

export interface ClientLoginCheck {
  ok: boolean;
  code: ClientLoginCheckCode;
  /** ประโยคภาษาไทยพร้อมแสดง */
  message: string;
  /** ข้อความดิบจาก Supabase (ถ้ามี) */
  detail?: string;
  /** true = รัน syncClientLoginAccount ซ้ำ (ปุ่ม "ซ่อม") น่าจะแก้ได้ */
  repairable: boolean;
}

/**
 * ตรวจว่าลูกค้าคนนี้ login ด้วยรหัสผ่านที่ MarsOS เก็บไว้ได้จริงหรือไม่ — ทำตามเส้นทางเดียวกับหน้า login ทีละขั้น
 * แล้วบอกขั้นแรกที่พัง: มี key · มีบัญชี · บัญชีผูกกับ User นี้ · Supabase รับรหัสผ่าน · กติกา MarsOS ให้ผ่าน
 *
 * ขั้น "Supabase รับรหัสผ่าน" คือการ login จริงหนึ่งครั้งจากเซิร์ฟเวอร์ด้วย client แยก (ไม่แตะ cookie ของแอดมิน)
 * แล้วออกจากระบบเฉพาะ session นั้นทันที — session ที่ลูกค้าใช้อยู่ไม่ถูกตัด
 * แตะเฉพาะบัญชี @mars.local เช่นเดียวกับทั้งไฟล์ · ไม่ throw
 */
export async function checkClientLoginAccount(input: {
  userId: string;
  email: string;
  password: string | null;
}): Promise<ClientLoginCheck> {
  const fail = (code: ClientLoginCheckCode, message: string, repairable: boolean, detail?: string): ClientLoginCheck => ({
    ok: false, code, message, repairable, ...(detail ? { detail } : {}),
  });

  const email = input.email.trim().toLowerCase();
  if (!isClientLoginEmail(email)) return fail("not_client_login_email", NOT_CLIENT_LOGIN_EMAIL, false);
  const admin = createSupabaseAdmin();
  if (!admin) return fail("not_configured", `${NOT_CONFIGURED} — บัญชี login ของลูกค้าจึงยังไม่ถูกสร้าง`, false);

  try {
    const found = await findAuthUserByEmail(admin, email);
    if (!found.user && !found.complete && !found.error) {
      // admin API ตอบปกติทุกหน้า แต่ถึงเพดานจำนวนหน้าก่อนเจอ — ไม่ใช่ปัญหาของ key ห้ามบอกให้ไปแก้ key
      return fail(
        "lookup_incomplete",
        `ค้นบัญชี login ใน Supabase ไม่ครบ — บัญชีทั้งหมดมีมากกว่า ${LIST_PER_PAGE * LIST_MAX_PAGES} รายการ จึงสรุปไม่ได้ว่ามีบัญชีของลูกค้าคนนี้หรือไม่ (ดูที่ Supabase Dashboard → Authentication → Users)`,
        false,
      );
    }
    if (!found.user && !found.complete) {
      return fail(
        "admin_api_failed",
        "เซิร์ฟเวอร์เรียก Supabase ด้วย secret key ไม่ผ่าน — ตรวจค่า SUPABASE_SECRET_KEY บน Vercel ว่าถูกต้องและเป็นของโปรเจกต์เดียวกัน",
        false,
        found.error,
      );
    }
    if (!found.user) {
      return fail("no_account", "ยังไม่มีบัญชี login ของลูกค้าคนนี้ใน Supabase (ตอนสร้างทำไม่สำเร็จ) — กด “ซ่อม” เพื่อสร้าง", true);
    }
    const account = found.user;
    if (markerOf(account) !== input.userId) {
      return fail("marker_mismatch", "มีบัญชี login ชื่อนี้อยู่ แต่ไม่ได้ผูกกับ User คนนี้ — กด “ซ่อม” เพื่อสร้างใหม่ให้ตรง", true);
    }
    if (!hasOnlyEmailIdentity(account)) {
      return fail("extra_identity", "บัญชี login นี้มีทางเข้าอื่นผูกอยู่ — กด “ซ่อม” เพื่อสร้างใหม่", true);
    }
    if (!account.email_confirmed_at) {
      return fail("not_confirmed", "บัญชี login ยังไม่ถูกยืนยันอีเมล — กด “ซ่อม” เพื่อยืนยันให้", true);
    }
    const bannedUntil = (account as { banned_until?: string | null }).banned_until;
    if (bannedUntil && new Date(bannedUntil).getTime() > Date.now()) {
      return fail("banned", "บัญชี login นี้ถูกระงับใน Supabase — ปลดที่ Supabase Dashboard → Authentication → Users", false, `banned_until ${bannedUntil}`);
    }
    if (!input.password) {
      return fail("no_stored_password", "MarsOS ไม่มีรหัสผ่านของลูกค้าคนนี้เก็บไว้ — กด “รีเซ็ต” ตั้งรหัสใหม่ก่อน", false);
    }

    // ── ลอง login จริงแบบเดียวกับหน้า login (publishable key + รหัสผ่าน) ──
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) return fail("not_configured", "เซิร์ฟเวอร์ไม่มีค่า Supabase สำหรับหน้า login", false);
    const probe = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const signedIn = await probe.auth.signInWithPassword({ email, password: input.password });
    if (signedIn.error || !signedIn.data.session || !signedIn.data.user) {
      const kind = classifyPasswordSignInError(signedIn.error);
      const detail = signedIn.error
        ? [signedIn.error.code, signedIn.error.message].filter(Boolean).join(": ")
        : undefined;
      switch (kind) {
        case "credentials":
          return fail("wrong_password", "รหัสผ่านใน MarsOS ไม่ตรงกับบัญชี login — กด “ซ่อม” เพื่อตั้งให้ตรงกัน", true, detail);
        case "password_login_disabled":
          return fail(
            "password_login_disabled",
            "โปรเจกต์ Supabase ปิดการเข้าด้วยอีเมล + รหัสผ่าน — เปิดที่ Supabase Dashboard → Authentication → Sign In / Providers → Email",
            false,
            detail,
          );
        case "captcha":
          return fail(
            "captcha",
            "โปรเจกต์ Supabase เปิด CAPTCHA ไว้ หน้า login ของ MarsOS ไม่ได้ส่ง CAPTCHA — ดูที่ Supabase Dashboard → Authentication → Attack Protection",
            false,
            detail,
          );
        case "rate_limited":
          return fail("rate_limited", "Supabase จำกัดจำนวนครั้งที่ลอง login — รอสักครู่แล้วตรวจใหม่", false, detail);
        case "not_confirmed":
          return fail("not_confirmed", "บัญชี login ยังไม่ถูกยืนยันอีเมล — กด “ซ่อม” เพื่อยืนยันให้", true, detail);
        case "banned":
          return fail("banned", "บัญชี login นี้ถูกระงับใน Supabase", false, detail);
        default:
          return fail("sign_in_failed", "Supabase ไม่รับการ login ด้วยรหัสผ่านนี้", false, detail);
      }
    }

    const accessToken = signedIn.data.session.access_token;
    const decision = checkLoginPolicy({
      email,
      role: "CLIENT",
      accessToken,
      authUser: signedIn.data.user,
      userId: input.userId,
    });
    const passwordAt = amrTimestamp(decodeJwtPayload(accessToken), "password");
    // เวลาของเซิร์ฟเวอร์ MarsOS ทันทีหลัง login — /auth/password เทียบกับนาฬิกาเดียวกันนี้
    const now = Math.floor(Date.now() / 1000);
    // ออกเฉพาะ session ที่เพิ่งสร้าง — scope "local" ไม่ตัด session อื่นของลูกค้า
    await probe.auth.signOut({ scope: "local" }).catch(() => {});

    if (!decision.ok) {
      return fail("policy_denied", "Supabase รับรหัสผ่านแล้ว แต่กติกาเข้าระบบของ MarsOS ไม่ให้ผ่าน", decision.reason === "client_password_not_provisioned", decision.reason);
    }
    if (passwordAt === null) {
      return fail("policy_denied", "Supabase รับรหัสผ่านแล้ว แต่ token ไม่มีเวลา login แบบรหัสผ่าน (claim amr) ที่ MarsOS ใช้ตรวจ", false, "stale_password_login");
    }
    // ใช้ช่วงเวลาเดียวกับ /auth/password — เพิ่ง login เมื่อครู่แต่ยังตก แปลว่านาฬิกาสองฝั่งไม่ตรงกัน ลูกค้าจะโดนปฏิเสธทุกครั้ง
    if (!isFreshPasswordLogin(passwordAt, now)) {
      return fail(
        "policy_denied",
        "Supabase รับรหัสผ่านแล้ว แต่เวลา login ใน token ห่างจากนาฬิกาของเซิร์ฟเวอร์ MarsOS เกินช่วงที่ยอมรับ — ลูกค้าจะเข้าไม่ได้ทุกครั้งจนกว่านาฬิกาสองฝั่งจะตรงกัน",
        false,
        `stale_password_login (amr ${passwordAt}, now ${now}, ต่างกัน ${now - passwordAt} วินาที)`,
      );
    }
    return { ok: true, code: "ok", message: "login ได้ — ชื่อผู้ใช้และรหัสผ่านนี้เข้าระบบได้", repairable: false };
  } catch (e) {
    return fail("sign_in_failed", "ตรวจ login ไม่สำเร็จ", false, errorText(e));
  }
}

/** ลบบัญชี login ของลูกค้าที่ถูกลบออกจาก MarsOS — ลบเฉพาะบัญชีที่ MarsOS จัดการ */
export async function deleteClientLoginAccount(emailInput: string): Promise<ClientLoginResult> {
  const email = emailInput.trim().toLowerCase();
  if (!isClientLoginEmail(email)) return { ok: false, error: NOT_CLIENT_LOGIN_EMAIL };
  const admin = createSupabaseAdmin();
  if (!admin) return { ok: false, error: NOT_CONFIGURED };

  try {
    const found = await findAuthUserByEmail(admin, email);
    if (!found.user) return found.complete ? { ok: true } : { ok: false, error: "ตรวจบัญชี login ไม่ครบ" };
    if (!isManagedAccount(found.user)) return { ok: false, error: "บัญชีนี้ MarsOS ไม่ได้สร้าง — ไม่ลบ" };
    const removed = await admin.auth.admin.deleteUser(found.user.id);
    if (removed.error) return { ok: false, error: removed.error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorText(e) };
  }
}
