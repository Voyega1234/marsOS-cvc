/** โดเมนแบบมาตรฐานของคลังเว็บ: ตัวพิมพ์เล็ก ไม่มี protocol / www / path / port (ไฟล์บริสุทธิ์ ใช้ได้ทั้ง client และ server) */
export function normalizeDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .split(/[\/?#]/)[0]
    .replace(/:\d+$/, "");
}

/** หน้าตาเป็นโดเมนจริง (มีจุด, ไม่มีช่องว่าง, TLD เป็นตัวอักษร) */
export function looksLikeDomain(d: string): boolean {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(d);
}

/** คืน URL เฉพาะ http/https ที่ parse ได้ นอกนั้นคืน "" (กัน javascript: / data: ที่มากับไฟล์) */
export function safeHttpUrl(v: unknown, max = 1000): string {
  if (typeof v !== "string") return "";
  const s = v.trim();
  if (!/^https?:\/\//i.test(s) || s.length > max) return "";
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? s : "";
  } catch {
    return "";
  }
}
