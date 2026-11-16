/** ดึง gid ของโปรเจกต์จากลิงก์ Asana หรือเลข gid ตรง ๆ — อ่านไม่ออกคืน "" */
export function asanaProjectGidFromInput(text: string): string {
  const t = text.trim();
  if (/^\d{8,}$/.test(t)) return t;
  if (!t) return "";
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`);
  } catch {
    return "";
  }
  if ((u.protocol !== "https:" && u.protocol !== "http:") || u.hostname !== "app.asana.com") return "";
  const m = u.pathname.match(/^\/\d+\/\d+\/project\/(\d+)/) ?? u.pathname.match(/^\/0\/(\d+)/);
  const gid = m ? m[1] : "";
  return gid.length >= 8 && gid !== "0" ? gid : "";
}
