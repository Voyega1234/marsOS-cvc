/**
 * กันความลับหลุดไปฝั่ง browser ผ่าน response ของ API
 * - wpAppPassword: ส่งค่าปิดบังแทน (UI ใช้แค่เช็คว่า "มีรหัสเก็บไว้แล้ว") และ PUT ที่ส่งค่าปิดบังกลับมาจะไม่ทับรหัสจริง
 * - รหัสผ่านผู้ใช้ (password/passwordPlain) ตัดทิ้งเสมอ
 */
export const SECRET_MASK = "********";

export function maskProjectSecrets<T extends { wpAppPassword?: string | null }>(p: T): T {
  return { ...p, wpAppPassword: p.wpAppPassword ? SECRET_MASK : p.wpAppPassword };
}

export function stripUserSecrets<T extends Record<string, unknown>>(u: T | null | undefined): T | null | undefined {
  if (!u) return u;
  const { password: _p, passwordPlain: _pp, ...rest } = u as T & { password?: unknown; passwordPlain?: unknown };
  return rest as unknown as T;
}
