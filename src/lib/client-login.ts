/**
 * บัญชีลูกค้า (role CLIENT) ที่ทีมสร้างให้ในหน้า "จัดการ Users" — เข้าระบบด้วยชื่อผู้ใช้ + รหัสผ่าน
 *
 * ไฟล์นี้มีแค่ค่าคงที่กับฟังก์ชันล้วน ใช้ได้ทั้งฝั่งเบราว์เซอร์ (หน้า login) และฝั่งเซิร์ฟเวอร์
 * กติกาตัดสินว่าเข้าได้หรือไม่อยู่ที่ src/lib/login-policy.ts
 */

/** หน้า Users เก็บอีเมลของบัญชีที่สร้างเป็น <ชื่อผู้ใช้>@mars.local */
export const CLIENT_LOGIN_EMAIL_DOMAIN = "mars.local";

/**
 * ชื่อ key ใน app_metadata ของบัญชี Supabase ที่ MarsOS สร้างให้ลูกค้า — ค่าคือ id ของ User ใน MarsOS
 * app_metadata เขียนได้ผ่าน admin API (secret key) เท่านั้น ผู้ใช้แก้เองไม่ได้
 */
export const CLIENT_LOGIN_MARKER = "mars_client_user_id";

/**
 * แปลงชื่อผู้ใช้ที่ลูกค้าพิมพ์เป็นอีเมลที่ใช้ login — ต้องได้ผลเท่ากับที่หน้า Users สร้าง
 * (ตัดช่องว่าง ตัวพิมพ์เล็ก ต่อท้าย @mars.local) · พิมพ์อีเมลเต็มมาก็ใช้ตามนั้น
 */
export function clientLoginEmail(username: string): string {
  if (typeof username !== "string") return "";
  const cleaned = username.trim().toLowerCase().replace(/\s+/g, "");
  if (!cleaned) return "";
  return cleaned.includes("@") ? cleaned : `${cleaned}@${CLIENT_LOGIN_EMAIL_DOMAIN}`;
}

/** รหัสผ่านของลูกค้าสั้นสุดเท่านี้ — เท่ากับค่าเริ่มต้นของ Supabase Auth (สั้นกว่านี้สร้างบัญชี login ไม่ผ่าน) */
export const CLIENT_PASSWORD_MIN_LENGTH = 6;
/** Supabase Auth ไม่รับรหัสผ่านยาวเกิน 72 ไบต์ (ข้อจำกัดของ bcrypt) — อักษรไทย 1 ตัว = 3 ไบต์ */
export const CLIENT_PASSWORD_MAX_BYTES = 72;

/**
 * รหัสผ่านของลูกค้าใช้กับระบบ login ได้หรือไม่ — คืนข้อความภาษาไทยเมื่อใช้ไม่ได้ · null = ใช้ได้
 * ตรวจก่อนบันทึก ไม่อย่างนั้น MarsOS จะเก็บรหัสที่ระบบ login ไม่รับ (ลูกค้าได้รหัสที่เข้าไม่ได้)
 */
export function clientPasswordProblem(password: unknown): string | null {
  if (typeof password !== "string" || password.length < CLIENT_PASSWORD_MIN_LENGTH) {
    return `รหัสผ่านต้องยาวอย่างน้อย ${CLIENT_PASSWORD_MIN_LENGTH} ตัวอักษร`;
  }
  if (new TextEncoder().encode(password).length > CLIENT_PASSWORD_MAX_BYTES) {
    return `รหัสผ่านยาวเกินไป — ระบบ login รับได้ไม่เกิน ${CLIENT_PASSWORD_MAX_BYTES} ไบต์ (อักษรไทย 1 ตัวนับ 3)`;
  }
  return null;
}

/** /auth/password รับเฉพาะการกรอกรหัสผ่านเมื่อครู่นี้ — session รหัสผ่านเก่าใช้เปิดทางเข้าใหม่ไม่ได้ */
export const PASSWORD_LOGIN_MAX_AGE_S = 300;
export const PASSWORD_LOGIN_CLOCK_SKEW_S = 60;

/**
 * เวลา login แบบรหัสผ่าน (claim amr ใน token, วินาที) ยังอยู่ในช่วงที่ /auth/password รับหรือไม่
 * เทียบกับนาฬิกาของเซิร์ฟเวอร์ MarsOS — ถ้านาฬิกาของ MarsOS กับ Supabase ต่างกันมาก ทุกการ login จะตกที่นี่
 * ใช้ทั้งใน /auth/password และตัวตรวจของหน้า Users เพื่อให้สองที่ตัดสินเหมือนกัน
 */
export function isFreshPasswordLogin(signedInAt: number | null, nowS: number): boolean {
  if (signedInAt === null) return false;
  if (signedInAt > nowS + PASSWORD_LOGIN_CLOCK_SKEW_S) return false;
  return nowS - signedInAt <= PASSWORD_LOGIN_MAX_AGE_S;
}

const CLIENT_USERNAME_RE = /^[a-z0-9._-]+$/;

/** ชื่อผู้ใช้ของลูกค้า: a-z 0-9 . _ - เท่านั้น (กติกาเดียวกับฟอร์มในหน้า Users) */
export function isValidClientUsername(username: string): boolean {
  return typeof username === "string" && username.length <= 64 && CLIENT_USERNAME_RE.test(username);
}

/** ชื่อผู้ใช้ที่ลูกค้าต้องพิมพ์ตอน login — ส่วนหน้า @mars.local · null = ไม่ใช่อีเมลของบัญชีที่หน้า Users สร้าง */
export function clientLoginUsername(email: string): string | null {
  if (typeof email !== "string") return null;
  const cleaned = email.trim().toLowerCase();
  const suffix = `@${CLIENT_LOGIN_EMAIL_DOMAIN}`;
  if (!cleaned.endsWith(suffix)) return null;
  const username = cleaned.slice(0, -suffix.length);
  return isValidClientUsername(username) ? username : null;
}

/**
 * สาเหตุที่ login ด้วยรหัสผ่านไม่ผ่าน แยกจาก error ของ Supabase Auth
 * "credentials" = ชื่อผู้ใช้หรือรหัสผ่านผิด (Supabase ตอบเหมือนกันทั้งกรณีไม่มีบัญชีและรหัสผิด)
 * ที่เหลือ = ลูกค้าพิมพ์ถูกแล้วแต่ระบบไม่ให้เข้า — ต้องบอกต่างกัน ไม่อย่างนั้นทุกคนเข้าใจว่ารหัสผิด
 */
export type PasswordSignInFailure =
  | "credentials"
  | "password_login_disabled" // โปรเจกต์ Supabase ปิดการเข้าด้วยอีเมล + รหัสผ่าน
  | "captcha"                 // โปรเจกต์ Supabase เปิด CAPTCHA แต่หน้า login ไม่ได้ส่ง token
  | "rate_limited"
  | "not_confirmed"
  | "banned"
  | "network"
  | "unknown";

/** จัดกลุ่ม error จาก supabase.auth.signInWithPassword — รับเป็นโครงหลวม ๆ ไม่ผูกกับ type ของไลบรารี */
export function classifyPasswordSignInError(
  err: { code?: unknown; status?: unknown; message?: unknown; name?: unknown } | null | undefined,
): PasswordSignInFailure {
  if (!err) return "unknown";
  const code = typeof err.code === "string" ? err.code : "";
  // -1 = ไม่มี status (ไม่ใช่ error จากเครือข่าย) · 0 = supabase-js ใช้กับ request ที่ไปไม่ถึงเซิร์ฟเวอร์
  const status = typeof err.status === "number" ? err.status : -1;
  const message = typeof err.message === "string" ? err.message.toLowerCase() : "";
  const name = typeof err.name === "string" ? err.name : "";

  if (code === "invalid_credentials") return "credentials";
  if (code === "email_provider_disabled" || code === "provider_disabled") return "password_login_disabled";
  if (code === "captcha_failed") return "captcha";
  if (code === "over_request_rate_limit" || status === 429) return "rate_limited";
  if (code === "email_not_confirmed") return "not_confirmed";
  if (code === "user_banned") return "banned";
  // ไม่มี code (เซิร์ฟเวอร์ Auth รุ่นเก่า) — ดูจากข้อความ
  if (!code) {
    if (message.includes("invalid login credentials")) return "credentials";
    if (message.includes("logins are disabled")) return "password_login_disabled";
    if (message.includes("captcha")) return "captcha";
    if (message.includes("email not confirmed")) return "not_confirmed";
    if (message.includes("banned")) return "banned";
  }
  if (name === "AuthRetryableFetchError" || status === 0 || status >= 500) return "network";
  return "unknown";
}

/** ข้อความที่หน้า login แสดงให้ลูกค้า — ไม่บอกว่าชื่อผู้ใช้มีอยู่หรือไม่ (กลุ่ม "credentials" ใช้ข้อความเดียว) */
export function passwordSignInMessage(kind: PasswordSignInFailure): string {
  switch (kind) {
    case "credentials":
      return "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง";
    case "password_login_disabled":
    case "captcha":
      return "ระบบยังไม่เปิดให้เข้าด้วยรหัสผ่าน — กรุณาแจ้งทีมงาน Convert Cake";
    case "rate_limited":
      return "ลองเข้าสู่ระบบถี่เกินไป — กรุณารอสักครู่แล้วลองใหม่";
    case "not_confirmed":
    case "banned":
      return "บัญชีนี้ยังใช้งานไม่ได้ — กรุณาแจ้งทีมงาน Convert Cake";
    case "network":
      return "เชื่อมต่อระบบ login ไม่ได้ — กรุณาลองใหม่อีกครั้ง";
    default:
      return "เข้าสู่ระบบไม่สำเร็จ — กรุณาแจ้งทีมงาน Convert Cake";
  }
}

/**
 * เหตุที่ /auth/password ตอบ 401 — ส่งมาคู่กับข้อความกลาง
 * "no_session" = เซิร์ฟเวอร์ไม่ได้รับ session (cookie ไม่มา หรือยืนยัน token ไม่ได้) · "denied" = session ถูกต้องแต่กติกา MarsOS ไม่ให้เข้า
 * ไม่เปิดเผยอะไรเพิ่ม: ถึงขั้นนี้ Supabase ออก session ให้เบราว์เซอร์แล้ว
 */
export type PasswordSessionDenialCode = "no_session" | "denied";

/** ข้อความเมื่อ Supabase รับรหัสผ่านแล้ว แต่ /auth/password ไม่ให้เข้า (แยกตาม HTTP status + code ที่เซิร์ฟเวอร์ส่งมา) */
export function passwordSessionDeniedMessage(status: number, code?: unknown): string {
  if (status === 401 || status === 403) {
    if (code === "denied") return "รหัสผ่านถูกต้อง แต่บัญชีนี้ยังไม่พร้อมใช้งานใน MarsOS — กรุณาแจ้งทีมงาน Convert Cake";
    // ไม่มี session มาถึงเซิร์ฟเวอร์ — ไม่ใช่ปัญหาของบัญชี ห้ามบอกว่าบัญชียังไม่พร้อม
    return "เข้าสู่ระบบไม่สำเร็จ — ระบบไม่ได้รับ session จากเบราว์เซอร์นี้ (ตรวจว่าไม่ได้ปิด cookie) แล้วลองใหม่ หรือแจ้งทีมงาน Convert Cake";
  }
  return "ระบบ login ขัดข้องชั่วคราว — กรุณาลองใหม่อีกครั้ง หรือแจ้งทีมงาน Convert Cake";
}
