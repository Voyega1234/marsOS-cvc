import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { CLIENT_LOGIN_EMAIL_DOMAIN, CLIENT_LOGIN_MARKER } from "@/lib/client-login";

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
): Promise<{ user: User | null; complete: boolean }> {
  for (let page = 1; page <= LIST_MAX_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: LIST_PER_PAGE });
    if (error) return { user: null, complete: false };
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
