// โลโก้ลูกค้าสำหรับรายชื่อโปรเจกต์ใน Backlink Management (หน้า Report)
// ลำดับ: โลโก้ที่ทีมอัปไว้ (Project.logoUrl / UploadClient pushPrefs.clientLogo) ก่อน แล้วค่อย favicon ของเว็บลูกค้า
// ฟังก์ชันล้วน ใช้ได้ทั้งฝั่ง server และ unit test — ผลลัพธ์ใช้กับ <img src> เท่านั้น
import { readClientLogo } from "@/lib/upload-article/client-logo";
import { normName } from "./sheet-import";

export interface LogoSource {
  /** id โปรเจกต์ใน BLM (Project หรือ BlmProject) — ว่างถ้าเป็นลูกค้า Upload */
  projectId?: string;
  names: string[];
  logo?: string | null;
  website?: string | null;
}

export interface LogoIndex {
  byProject: Record<string, string>;
  byName: Record<string, string>;
}

/** favicon ของเว็บลูกค้า (โดเมนสาธารณะเท่านั้น) — null ถ้าแยก hostname ไม่ได้ */
export function faviconUrl(website: string | null | undefined): string | null {
  const raw = (website ?? "").trim();
  if (!raw) return null;
  let host = "";
  try {
    host = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch {
    return null;
  }
  host = host.replace(/^www\./, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return null;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
}

/**
 * รวมแหล่งโลโก้เป็น index: byProject[id] และ byName[normName(ชื่อ)]
 * โลโก้ที่อัปเองชนะ favicon เสมอ · แหล่งที่มาก่อนชนะเมื่อชนิดเท่ากัน
 * โปรเจกต์ที่ไม่มีโลโก้/เว็บของตัวเอง (เช่น โปรเจกต์ที่เพิ่มเอง) ได้โลโก้จากชื่อที่ตรงกัน
 */
export function buildLogoIndex(sources: LogoSource[]): LogoIndex {
  const own = new Map<string, { url: string; uploaded: boolean }>();
  const named = new Map<string, { url: string; uploaded: boolean }>();
  const put = (m: Map<string, { url: string; uploaded: boolean }>, k: string, v: { url: string; uploaded: boolean }) => {
    const cur = m.get(k);
    if (!cur || (v.uploaded && !cur.uploaded)) m.set(k, v);
  };
  for (const s of sources) {
    const uploaded = readClientLogo(s.logo);
    const fav = uploaded ? null : faviconUrl(s.website);
    const v = uploaded ? { url: uploaded, uploaded: true } : fav ? { url: fav, uploaded: false } : null;
    if (!v) continue;
    if (s.projectId) put(own, s.projectId, v);
    for (const n of s.names) {
      const k = normName(n || "");
      if (k) put(named, k, v);
    }
  }
  const byName: Record<string, string> = {};
  named.forEach((v, k) => { byName[k] = v.url; });
  const byProject: Record<string, string> = {};
  for (const s of sources) {
    if (!s.projectId) continue;
    const mine = own.get(s.projectId);
    // โลโก้ที่อัปไว้ใต้ชื่อเดียวกัน (เช่น ลูกค้า Upload) ชนะ favicon ของโปรเจกต์เอง
    let best = mine;
    for (const n of s.names) {
      const hit = named.get(normName(n || ""));
      if (hit && (!best || (hit.uploaded && !best.uploaded))) best = hit;
    }
    if (best) byProject[s.projectId] = best.url;
  }
  return { byProject, byName };
}

/** โลโก้ของแถวในชีท: โปรเจกต์ที่ผูกไว้ก่อน แล้วค่อยชื่อโปรเจกต์/ลูกค้าในชีท */
export function logoFor(index: LogoIndex | null | undefined, projectId: string | null | undefined, names: string[]): string | null {
  if (!index) return null;
  if (projectId && index.byProject[projectId]) return index.byProject[projectId];
  for (const n of names) {
    const k = normName(n || "");
    if (k && index.byName[k]) return index.byName[k];
  }
  return null;
}
