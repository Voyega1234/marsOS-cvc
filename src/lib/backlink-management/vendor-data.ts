/** แปลง body ของคลังเว็บเป็นฟิลด์ที่บันทึกได้ (ไฟล์บริสุทธิ์) */
export function vendorData(b: Record<string, unknown>) {
  const num = (v: unknown) => (v === null || v === "" || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  const str = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);
  const d: Record<string, unknown> = {};
  if (b.siteUrl !== undefined) d.siteUrl = str(b.siteUrl) ?? "";
  if (b.category !== undefined) d.category = str(b.category, 100) ?? "";
  if (b.price !== undefined) d.price = Math.max(0, num(b.price) ?? 0);
  if (b.domainRating !== undefined) { const n = num(b.domainRating); d.domainRating = n === null ? null : Math.round(n); }
  if (b.traffic !== undefined) { const n = num(b.traffic); d.traffic = n === null ? null : Math.round(n); }
  if (b.linkType !== undefined && ["dofollow", "nofollow", "sponsored"].includes(String(b.linkType))) d.linkType = String(b.linkType);
  if (b.contactName !== undefined) d.contactName = str(b.contactName, 200) ?? "";
  if (b.contactChannel !== undefined) d.contactChannel = str(b.contactChannel, 300) ?? "";
  if (b.notes !== undefined) d.notes = str(b.notes, 2000) ?? "";
  if (b.status !== undefined && ["ACTIVE", "INACTIVE"].includes(String(b.status))) d.status = String(b.status);
  return d;
}
