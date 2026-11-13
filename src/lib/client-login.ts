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
