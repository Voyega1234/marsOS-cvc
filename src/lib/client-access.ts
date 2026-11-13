import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session-types";

/**
 * ขอบเขตของ role CLIENT (คำสั่งเจ้าของ 2026-09-03, ปรับเป็นพอร์ทัล 3 แท็บ)
 *
 * ลูกค้าที่ล็อกอินเข้ามาเห็นพอร์ทัลที่ /projects/<id> แค่ 3 แท็บ:
 *   1. Review     (ตรวจบทความ: อ่าน คอมเมนต์ เสนอแก้ข้อความ อนุมัติ)
 *   2. Published  (ลิงก์บทความที่เผยแพร่แล้ว)
 *   3. Report     (รายงาน)
 * และต้องเจาะเข้าส่วนอื่นไม่ได้ แม้จะพิมพ์ URL หรือยิง API ตรง ๆ
 *
 * ไฟล์นี้เป็นจุดเดียวที่นิยาม allowlist ทั้งหน้าเว็บและ API — deny by default
 * ทุกอย่างที่ไม่อยู่ในลิสต์นี้ถูกปฏิเสธ ไม่มีผลกับ role อื่น (ทีมงานใช้งานเหมือนเดิมทุกประการ)
 */

/** subtab ที่ CLIENT เปิดได้ในหน้า project (ต้องตรงกับ CLIENT_TABS ใน ClientDetailTabs) */
export const CLIENT_TAB_IDS = ["timeline-view", "review", "publish", "report"] as const;

/**
 * โน้ตตรวจงานภายในทีม (หน้า Review Queue เขียนขึ้นต้นแบบนี้) — ลูกค้าไม่ควรเห็น
 * คอมเมนต์อื่น (ลูกค้าเขียนเอง, ทีมตอบในแท็บ Review, "[✅ ทีมแก้ไขแล้ว]") เป็นบทสนทนากับลูกค้า ส่งตามเดิม
 */
export const INTERNAL_COMMENT_PREFIXES = ["[✓ Approved]", "[✗ Revision]"] as const;

/** เงื่อนไข Prisma สำหรับคอมเมนต์ที่ CLIENT อ่านได้ */
export const CLIENT_VISIBLE_COMMENT_WHERE = {
  NOT: INTERNAL_COMMENT_PREFIXES.map((prefix) => ({ body: { startsWith: prefix } })),
};

/** หน้าเว็บที่ CLIENT เข้าได้: รายการโปรเจกต์ (จะ redirect ต่อเอง) + หน้า project ของตัวเอง */
const CLIENT_PAGE_PATTERNS: RegExp[] = [
  /^\/projects$/,
  /^\/projects\/[^/]+$/,
];

/** API ที่ CLIENT เรียกได้ แยกตาม method — นอกลิสต์นี้คือ 401 ทั้งหมด */
const CLIENT_API_RULES: { pattern: RegExp; methods: string[] }[] = [
  { pattern: /^\/api\/articles\/published$/,            methods: ["GET"] },
  { pattern: /^\/api\/articles\/by-title$/,             methods: ["GET"] },
  { pattern: /^\/api\/articles\/[^/]+\/client-review$/, methods: ["POST"] },
  { pattern: /^\/api\/report\/(gsc|gsc-ai|gsc-insights|ga4|pagespeed)$/, methods: ["POST"] },
  // จด Activity Log ของตัวเอง (เปิดหน้า / ออกจากระบบ) — เขียนได้แค่ log ของ session ตัวเอง อ่านอะไรไม่ได้
  { pattern: /^\/api\/activity-logs\/track$/,           methods: ["POST"] },
];

function normalize(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

export function isClientPageAllowed(pathname: string): boolean {
  const p = normalize(pathname);
  return CLIENT_PAGE_PATTERNS.some((re) => re.test(p));
}

export function isClientApiAllowed(pathname: string, method: string): boolean {
  const p = normalize(pathname);
  const m = method.toUpperCase();
  return CLIENT_API_RULES.some((r) => r.pattern.test(p) && r.methods.includes(m));
}

/** id ของโปรเจกต์ที่ CLIENT คนนี้ถูก assign ให้ดู */
export async function clientProjectIds(userId: string): Promise<string[]> {
  const rows = await prisma.clientProjectAccess.findMany({
    where: { userId },
    select: { projectId: true },
  });
  return rows.map((r) => r.projectId);
}

/**
 * ด่านของ route: ถ้าเป็น CLIENT ต้องมีสิทธิ์ในโปรเจกต์นี้เท่านั้น
 * role อื่นคืน true เสมอ (พฤติกรรมเดิมไม่เปลี่ยน)
 */
export async function clientCanAccessProject(
  session: AppSession | null,
  projectId: string | null | undefined,
): Promise<boolean> {
  if (session?.user?.role !== "CLIENT") return true;
  if (!projectId) return false;
  const access = await prisma.clientProjectAccess.findFirst({
    where: { userId: session.user.id, projectId },
    select: { id: true },
  });
  return Boolean(access);
}

/**
 * Report ส่งมาแค่ siteUrl / propertyId (ไม่มี projectId) — CLIENT จึงต้องถูกเช็คว่า
 * ค่านั้นเป็นของโปรเจกต์ที่ตัวเองเข้าถึงได้จริง ไม่งั้นจะดึงข้อมูล GSC/GA4 ของลูกค้ารายอื่นได้
 */
function hostOf(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^sc-domain:/, "")
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

async function clientProjects(userId: string) {
  const ids = await clientProjectIds(userId);
  if (!ids.length) return [];
  return prisma.project.findMany({
    where: { id: { in: ids } },
    select: { gscSiteUrl: true, ga4PropertyId: true, website: true },
  });
}

/** siteUrl / url ของ report (GSC, PageSpeed) — เทียบระดับ host กับเว็บของโปรเจกต์ตัวเอง */
export async function clientCanAccessSite(
  session: AppSession | null,
  value: string | null | undefined,
): Promise<boolean> {
  if (session?.user?.role !== "CLIENT") return true;
  if (!value) return false;
  const wanted = hostOf(value);
  if (!wanted) return false;
  const projects = await clientProjects(session.user.id);
  return projects.some((p) =>
    [p.gscSiteUrl, p.website].some((own) => own && hostOf(own) === wanted),
  );
}

/** GA4 property id ต้องตรงกับของโปรเจกต์ตัวเองเป๊ะ ๆ */
export async function clientCanAccessGa4(
  session: AppSession | null,
  propertyId: string | null | undefined,
): Promise<boolean> {
  if (session?.user?.role !== "CLIENT") return true;
  if (!propertyId) return false;
  const wanted = String(propertyId).trim().replace(/^properties\//, "");
  // ค่าว่าง (เช่น "properties/") ห้ามไปเท่ากับโปรเจกต์ที่ยังไม่ได้ตั้ง GA4
  if (!wanted) return false;
  const projects = await clientProjects(session.user.id);
  return projects.some(
    (p) => (p.ga4PropertyId ?? "").trim().replace(/^properties\//, "") === wanted,
  );
}
