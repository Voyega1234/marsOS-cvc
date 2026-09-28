/**
 * แปล Activity Log เป็นประโยคภาษาไทยที่คนอ่านรู้เรื่อง — ใช้ได้ทั้งฝั่ง server และ client (ไม่มี prisma)
 *
 * log มี 2 แบบ
 * 1. log อัตโนมัติ (ทุก API ที่แก้ข้อมูล + การเปิดหน้า + login/logout) — action = API_<METHOD> / PAGE_VIEW / LOGIN / LOGOUT
 *    newValue เก็บ JSON {path, method} → แปลเป็นประโยคตอนแสดงผล (แก้ป้ายชื่อทีหลังก็มีผลย้อนหลัง)
 * 2. log เดิมที่แต่ละ route เขียนเอง (CREATE/UPDATE/DELETE/ROLE_CHANGED ...) — แปลตาม action + entityType
 */

export const AUTO_API_PREFIX = 'API_'
export const PAGE_VIEW_ACTION = 'PAGE_VIEW'
export const LOGIN_ACTION = 'LOGIN'
export const LOGOUT_ACTION = 'LOGOUT'

export type ActivityKind = 'action' | 'view' | 'auth' | 'legacy'

export interface ActivityLike {
  action: string
  entityType: string
  entityId: string
  oldValue?: string | null
  newValue?: string | null
}

export function activityKind(action: string): ActivityKind {
  if (action.startsWith(AUTO_API_PREFIX)) return 'action'
  if (action === PAGE_VIEW_ACTION) return 'view'
  if (action === LOGIN_ACTION || action === LOGOUT_ACTION) return 'auth'
  return 'legacy'
}

type MethodLabels = Partial<Record<'POST' | 'PUT' | 'PATCH' | 'DELETE', string>>

/** ป้ายชื่อ API — เรียงจากเฉพาะเจาะจงไปกว้าง (ตัวแรกที่ตรงชนะ) · [id] = ส่วนใดก็ได้ 1 ช่วง */
const API_LABELS: Array<[string, MethodLabels]> = [
  // ── PBN Backlinks ──
  ['/api/pbn-backlinks/sites/[id]/test', { POST: 'ทดสอบการเชื่อมต่อเว็บ PBN' }],
  ['/api/pbn-backlinks/sites/[id]', { PATCH: 'แก้ไขเว็บ PBN', DELETE: 'ลบเว็บ PBN' }],
  ['/api/pbn-backlinks/sites', { POST: 'เพิ่มเว็บ PBN' }],
  // ── Upload Article ──
  ['/api/upload-article/articles/[id]/card-selection', { PATCH: 'เลือกการ์ดบทความ (Upload Article)' }],
  ['/api/upload-article/articles/[id]/drive-images', { POST: 'ดึงรูปจาก Google Drive เข้าบทความ (Upload Article)' }],
  ['/api/upload-article/articles/[id]/generate', { POST: 'สร้าง HTML บทความ (Upload Article)' }],
  ['/api/upload-article/articles/[id]/images', { POST: 'สร้าง/อัปโหลดรูปบทความ (Upload Article)', DELETE: 'ลบรูปบทความ (Upload Article)' }],
  ['/api/upload-article/articles/[id]/meta', { POST: 'ให้ Mars เขียน SEO Title / Meta (Upload Article)' }],
  ['/api/upload-article/articles/[id]/push', { POST: 'ส่งบทความขึ้นเว็บลูกค้า (Upload Article)' }],
  ['/api/upload-article/articles/[id]/schedule', { PATCH: 'ตั้งเวลาเผยแพร่บทความ (Upload Article)' }],
  ['/api/upload-article/articles/[id]', { PATCH: 'แก้ไขบทความ (Upload Article)', DELETE: 'ลบบทความ (Upload Article)' }],
  ['/api/upload-article/clients/[id]/articles', { POST: 'เพิ่มบทความ (Upload Article)' }],
  ['/api/upload-article/clients/[id]/author', { PUT: 'บันทึก Author Box (Upload Article)' }],
  ['/api/upload-article/clients/[id]/connect-test', { POST: 'ทดสอบการเชื่อมต่อเว็บลูกค้า (Upload Article)' }],
  ['/api/upload-article/clients/[id]/cta', { PUT: 'บันทึก CTA (Upload Article)' }],
  ['/api/upload-article/clients/[id]/drive/import', { POST: 'นำเข้าบทความจาก Google Drive (Upload Article)' }],
  ['/api/upload-article/clients/[id]/drive/list', { POST: 'เปิดดูไฟล์ใน Google Drive (Upload Article)' }],
  ['/api/upload-article/clients/[id]/internal-links/gsc', { POST: 'ดึงลิงก์จาก Search Console (Upload Article)' }],
  ['/api/upload-article/clients/[id]/internal-links', { PUT: 'บันทึก Internal Link (Upload Article)' }],
  ['/api/upload-article/clients/[id]/keywords/ai', { POST: 'ให้ Mars ตั้ง Title / Intent ให้ keyword (Upload Article)' }],
  ['/api/upload-article/clients/[id]/keywords', { POST: 'เพิ่ม keyword (Upload Article)', PATCH: 'แก้ไข keyword (Upload Article)', DELETE: 'ลบ keyword (Upload Article)' }],
  ['/api/upload-article/clients/[id]/prompts/business-skill-scan', { POST: 'สแกน Business Skill (Upload Article)' }],
  ['/api/upload-article/clients/[id]/prompts/layer-scan', { POST: 'สแกน Content Engine (Upload Article)' }],
  ['/api/upload-article/clients/[id]/prompts/master-edit', { POST: 'ให้ Mars แก้ Master Prompt (Upload Article)' }],
  ['/api/upload-article/clients/[id]/prompts/master-from-examples', { POST: 'สร้าง Master Prompt จากตัวอย่าง (Upload Article)' }],
  ['/api/upload-article/clients/[id]/prompts/seed', { POST: 'ตั้งค่า Prompt เริ่มต้น (Upload Article)' }],
  ['/api/upload-article/clients/[id]/prompts', { POST: 'บันทึก Content Engine (Upload Article)' }],
  ['/api/upload-article/clients/[id]/site-scan', { POST: 'สแกนเว็บไซต์ลูกค้า (Upload Article)' }],
  ['/api/upload-article/clients/[id]/test-image', { POST: 'ทดสอบสร้างรูป (Upload Article)' }],
  ['/api/upload-article/clients/[id]/theme-scan', { POST: 'สแกนสีธีมเว็บ (Upload Article)' }],
  ['/api/upload-article/clients/[id]/write', { POST: 'ให้ Mars เขียนบทความ (Upload Article)' }],
  ['/api/upload-article/clients/[id]', { PATCH: 'แก้ไขข้อมูลลูกค้า (Upload Article)', DELETE: 'ลบลูกค้า (Upload Article)' }],
  ['/api/upload-article/clients', { POST: 'เพิ่มลูกค้า (Upload Article)' }],

  // ── บทความ / Studio / Clients ──
  ['/api/article/write', { POST: 'ให้ Mars เขียนบทความ' }],
  ['/api/article/cover', { POST: 'สร้างรูปปกบทความ' }],
  ['/api/article/review', { POST: 'ให้ Mars ตรวจบทความ' }],
  ['/api/articles/by-title', { PATCH: 'แก้ไขบทความ (ตามชื่อเรื่อง)' }],
  ['/api/articles/bulk', { POST: 'จัดการบทความหลายรายการ' }],
  ['/api/articles/[id]/audit', { POST: 'ตรวจ SEO บทความ' }],
  ['/api/articles/[id]/client-review', { POST: 'ส่งความเห็นลูกค้าในบทความ' }],
  ['/api/articles/[id]/comments', { POST: 'แสดงความเห็นในบทความ' }],
  ['/api/articles/[id]/fix', { POST: 'ให้ Mars แก้บทความ' }],
  ['/api/articles/[id]', { PATCH: 'แก้ไขบทความ', DELETE: 'ลบบทความ' }],
  ['/api/articles', { POST: 'สร้างบทความ' }],
  ['/api/studio/article-theme', { PUT: 'บันทึกธีมบทความ (Studio)' }],
  ['/api/content-studio/scrape-style', { POST: 'ดึงสไตล์จากเว็บ (Content Studio)' }],
  ['/api/image-studio/export-pptx', { POST: 'ส่งออก PowerPoint (Image Studio)' }],
  ['/api/wordpress/draft', { POST: 'ส่งบทความเป็น Draft ขึ้น WordPress' }],
  ['/api/push/connect', { POST: 'เชื่อมต่อเว็บเพื่อ Push บทความ' }],
  ['/api/push/publish', { POST: 'Push บทความขึ้นเว็บ' }],
  ['/api/push/scan', { POST: 'สแกนเว็บก่อน Push' }],
  ['/api/reviews', { POST: 'ส่งผลรีวิวบทความ' }],
  ['/api/batch', { POST: 'สั่งงานแบบ Batch' }],

  // ── AI ──
  ['/api/ai/article', { POST: 'ให้ Mars เขียนบทความ (AI)' }],
  ['/api/ai/auto-run', { POST: 'สั่ง Mars ทำงานอัตโนมัติ' }],
  ['/api/ai/content-map', { POST: 'ให้ Mars ทำ Content Map' }],
  ['/api/ai/image-prompt', { POST: 'ให้ Mars เขียน Image Prompt' }],
  ['/api/ai/keyword-research', { POST: 'ให้ Mars หา keyword' }],
  ['/api/ai/outline', { POST: 'ให้ Mars ทำโครงบทความ' }],
  ['/api/ai/seo-check', { POST: 'ให้ Mars ตรวจ SEO' }],
  ['/api/ai/test-prompt', { POST: 'ทดสอบ Prompt' }],

  // ── โปรเจกต์ (Clients) ──
  ['/api/projects/[id]/context-files', { POST: 'อัปโหลดไฟล์ข้อมูลโปรเจกต์' }],
  ['/api/projects/[id]/keyword-bank', { POST: 'บันทึก Keyword Bank' }],
  ['/api/projects/[id]/keywords-cache', { PATCH: 'อัปเดต keyword ที่เก็บไว้', DELETE: 'ล้าง keyword ที่เก็บไว้' }],
  ['/api/projects/[id]/lab-scan', { POST: 'สแกนเว็บไซต์ (Article Lab)' }],
  ['/api/projects/[id]/logo', { POST: 'อัปโหลดโลโก้โปรเจกต์' }],
  ['/api/projects/[id]/members', { POST: 'เพิ่มสมาชิกโปรเจกต์', DELETE: 'นำสมาชิกออกจากโปรเจกต์' }],
  ['/api/projects/[id]/seo-scan', { POST: 'สแกน SEO เว็บไซต์' }],
  ['/api/projects/[id]/seo-tasks/from-scan', { POST: 'สร้าง SEO Task จากผลสแกน' }],
  ['/api/projects/[id]/seo-tasks', { POST: 'สร้าง SEO Task' }],
  ['/api/projects/[id]/setup-checklist', { PATCH: 'อัปเดต Setup Checklist' }],
  ['/api/projects/[id]/style', { PATCH: 'บันทึกสไตล์บทความของโปรเจกต์' }],
  ['/api/projects/[id]', { PUT: 'แก้ไขโปรเจกต์', DELETE: 'ลบโปรเจกต์' }],
  ['/api/projects', { POST: 'สร้างโปรเจกต์' }],
  ['/api/seo-tasks/[id]', { PATCH: 'แก้ไข SEO Task', DELETE: 'ลบ SEO Task' }],

  // ── Keyword ──
  ['/api/keywords/[id]', { PATCH: 'แก้ไข keyword', DELETE: 'ลบ keyword' }],
  ['/api/keywords', { POST: 'เพิ่ม keyword' }],
  ['/api/keyword-guard', { POST: 'ตรวจ keyword ซ้ำ (Keyword Guard)' }],
  ['/api/dataforseo/keywords', { POST: 'ดึงข้อมูล keyword (DataForSEO)' }],
  ['/api/wordgod-v2/crawl-site', { POST: 'ครอลเว็บไซต์ (Keyword Pipeline)' }],
  ['/api/wordgod-v2/pipeline', { POST: 'รัน Keyword Pipeline' }],
  ['/api/wordgod/keywords', { POST: 'หา keyword (WordGod)' }],
  ['/api/wordgod/local-research', { POST: 'รัน Local Research' }],
  ['/api/wordgod/online-research/handoff', { POST: 'ส่งต่อผล Online Research' }],
  ['/api/wordgod/online-research', { POST: 'รัน Online Research' }],
  ['/api/wordgod/timeline', { POST: 'สร้าง Timeline' }],
  ['/api/competitor-gap/run', { POST: 'วิเคราะห์ Competitor Gap' }],

  // ── Content Engine / Prompts ──
  ['/api/content-engine/status', { POST: 'เปิดใช้ Content Engine' }],
  ['/api/prompts/[id]/activate', { POST: 'เปิดใช้ Prompt' }],
  ['/api/prompts/[id]/compile', { POST: 'คอมไพล์ Prompt' }],
  ['/api/prompts/[id]/duplicate', { POST: 'ทำสำเนา Prompt' }],
  ['/api/prompts/[id]/test', { POST: 'ทดสอบ Prompt' }],
  ['/api/prompts/[id]/versions/[id]/restore', { POST: 'ย้อน Prompt กลับเวอร์ชันเก่า' }],
  ['/api/prompts/[id]/versions', { POST: 'บันทึกเวอร์ชัน Prompt' }],
  ['/api/prompts/[id]', { PUT: 'แก้ไข Prompt', DELETE: 'ลบ Prompt' }],
  ['/api/prompts/business-skill-scan', { POST: 'สแกน Business Skill' }],
  ['/api/prompts/layer-scan', { POST: 'สแกน Content Engine' }],
  ['/api/prompts', { POST: 'สร้าง Prompt' }],
  ['/api/templates/[id]', { PUT: 'แก้ไข Template', DELETE: 'ลบ Template' }],
  ['/api/templates', { POST: 'สร้าง Template' }],
  ['/api/data-brain', { POST: 'บันทึก Data Brain' }],
  ['/api/data-sources', { POST: 'เพิ่มแหล่งข้อมูล' }],

  // ── Report / SEO Lab / Rank ──
  ['/api/report/ga4', { POST: 'ดึงรายงาน GA4' }],
  ['/api/report/gsc-ai', { POST: 'ให้ Mars วิเคราะห์ Search Console' }],
  ['/api/report/gsc-insights', { POST: 'ดึง Insight จาก Search Console' }],
  ['/api/report/gsc', { POST: 'ดึงรายงาน Search Console' }],
  ['/api/report/pagespeed', { POST: 'ตรวจ PageSpeed' }],
  ['/api/report/site-link', { POST: 'เชื่อมเว็บกับรายงาน', PATCH: 'แก้ไขการเชื่อมเว็บกับรายงาน' }],
  ['/api/report', { POST: 'สร้างรายงาน' }],
  ['/api/seo-lab/ai-visibility', { POST: 'ตรวจ AI Visibility (SEO Lab)' }],
  ['/api/seo-lab/audit', { POST: 'ตรวจเว็บ (SEO Lab)' }],
  ['/api/seo-lab/backlinks', { POST: 'ตรวจ Backlink (SEO Lab)' }],
  ['/api/seo-lab/competitors', { POST: 'วิเคราะห์คู่แข่ง (SEO Lab)' }],
  ['/api/seo-lab/keywords', { POST: 'วิเคราะห์ keyword (SEO Lab)' }],
  ['/api/seo-lab/rankings', { POST: 'ตรวจอันดับ (SEO Lab)' }],
  ['/api/seo-lab/serp', { POST: 'ดูผล SERP (SEO Lab)' }],
  ['/api/seo-lab/trends', { POST: 'ดู Trends (SEO Lab)' }],
  ['/api/rank', { POST: 'ตรวจอันดับ keyword' }],
  ['/api/refresh/gsc-scan', { POST: 'สแกนบทความที่ควรรีเฟรช' }],
  ['/api/refresh/[id]', { PATCH: 'แก้ไขงานรีเฟรชบทความ', DELETE: 'ลบงานรีเฟรชบทความ' }],
  ['/api/refresh', { POST: 'สร้างงานรีเฟรชบทความ' }],
  ['/api/backlinks/check', { POST: 'ตรวจสถานะ Backlink' }],
  ['/api/backlinks/import-csv', { POST: 'นำเข้า Backlink จาก CSV' }],
  ['/api/backlinks/[id]', { PATCH: 'แก้ไข Backlink', DELETE: 'ลบ Backlink' }],
  ['/api/backlinks', { POST: 'เพิ่ม Backlink' }],

  // ── ตั้งค่า / ผู้ใช้ ──
  ['/api/admin/users/[id]', { PATCH: 'แก้ไขผู้ใช้ (Admin)', DELETE: 'ลบผู้ใช้ (Admin)' }],
  ['/api/admin/users', { POST: 'เพิ่มผู้ใช้ (Admin)' }],
  ['/api/users/me/role', { PATCH: 'เปลี่ยน role ของตัวเอง' }],
  ['/api/users/[id]', { PATCH: 'แก้ไขผู้ใช้', DELETE: 'ลบผู้ใช้' }],
  ['/api/users', { POST: 'เพิ่มผู้ใช้' }],
  ['/api/settings/ai-providers/[id]', { PATCH: 'แก้ไข AI Provider', DELETE: 'ลบ AI Provider' }],
  ['/api/settings/ai-providers', { POST: 'เพิ่ม AI Provider' }],
  ['/api/settings/wordpress/[id]', { PATCH: 'แก้ไขการเชื่อม WordPress', DELETE: 'ลบการเชื่อม WordPress' }],
  ['/api/settings/wordpress', { POST: 'เชื่อม WordPress' }],
  ['/api/site-connections/[id]', { PATCH: 'แก้ไขการเชื่อมเว็บไซต์', DELETE: 'ลบการเชื่อมเว็บไซต์' }],
  ['/api/site-connections', { POST: 'เชื่อมเว็บไซต์' }],
  ['/api/google-connect', { POST: 'เชื่อมบัญชี Google', DELETE: 'ยกเลิกเชื่อมบัญชี Google' }],
  ['/api/scheduler', { PATCH: 'ตั้งค่า Scheduler' }],
  ['/api/notifications/[id]', { PATCH: 'อ่านการแจ้งเตือน', DELETE: 'ลบการแจ้งเตือน' }],
  ['/api/notifications', { DELETE: 'ล้างการแจ้งเตือนทั้งหมด' }],
  ['/api/todos', { POST: 'เพิ่ม To-do', PATCH: 'แก้ไข To-do', DELETE: 'ลบ To-do' }],
]

/** ป้ายชื่อหน้า — เทียบ prefix ยาวสุดก่อน */
const PAGE_LABELS: Array<[string, string]> = [
  ['/upload-article', 'Upload Article'],
  ['/pbn-backlinks', 'PBN Backlinks'],
  ['/activity-logs', 'Activity Logs'],
  ['/admin/users', 'จัดการผู้ใช้ (Admin)'],
  ['/projects', 'Clients'],
  ['/articles', 'บทความ'],
  ['/content-studio', 'Content Studio'],
  ['/image-studio', 'Image Studio'],
  ['/content-engine', 'Content Engine'],
  ['/prompts', 'Prompt Library'],
  ['/templates', 'Templates'],
  ['/settings', 'ตั้งค่า'],
  ['/users', 'ผู้ใช้'],
  ['/ai-jobs', 'AI Jobs'],
  ['/ai-connect', 'AI Connect'],
  ['/ai-seo-report', 'AI SEO Report'],
  ['/seo-intelligence-lab', 'SEO Intelligence Lab'],
  ['/backlink-assistant', 'Backlink Assistant'],
  ['/batch', 'Batch'],
  ['/calendar', 'ปฏิทิน'],
  ['/chat', 'Chat'],
  ['/client-portal', 'Client Portal'],
  ['/dashboard', 'Dashboard'],
  ['/data-sources', 'Data Sources'],
  ['/morning-brief', 'Morning Brief'],
  ['/my-tasks', 'งานของฉัน'],
  ['/notifications', 'การแจ้งเตือน'],
  ['/review', 'รีวิวบทความ'],
  ['/setup', 'Setup'],
  ['/todos', 'To-do'],
]

const METHOD_FALLBACK: Record<string, string> = {
  POST: 'สั่งงาน / สร้างข้อมูล',
  PUT: 'บันทึกข้อมูล',
  PATCH: 'แก้ไขข้อมูล',
  DELETE: 'ลบข้อมูล',
}

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .split('/')
    .map((seg) => (seg === '[id]' ? '[^/]+' : seg.replace(/[.*+?^${}()|\\]/g, '\\$&')))
    .join('/')
  return new RegExp(`^${escaped}/?$`)
}

const API_MATCHERS = API_LABELS.map(([p, labels]) => ({ re: patternToRegex(p), labels }))

/** ป้ายชื่อของ request ที่แก้ข้อมูล — ไม่รู้จัก path = ชื่อกลุ่ม + ประเภทการกระทำ */
export function describeApiRequest(path: string, method: string): string {
  const m = method.toUpperCase() as keyof MethodLabels
  for (const { re, labels } of API_MATCHERS) {
    if (re.test(path) && labels[m]) return labels[m]!
  }
  const group = path.replace(/^\/api\//, '').split('/')[0] || 'api'
  return `${METHOD_FALLBACK[m] ?? m} (${group})`
}

export function describePage(path: string): string {
  const hit = PAGE_LABELS.filter(([p]) => path === p || path.startsWith(`${p}/`)).sort((a, b) => b[0].length - a[0].length)[0]
  if (hit) return `เปิดหน้า ${hit[1]}`
  if (path === '/' || path === '') return 'เปิดหน้าแรก'
  return `เปิดหน้า ${path}`
}

const LEGACY_ACTIONS: Record<string, string> = {
  CREATE: 'สร้าง',
  CREATED: 'สร้าง',
  UPDATE: 'แก้ไข',
  UPDATED: 'แก้ไข',
  DELETE: 'ลบ',
  DELETED: 'ลบ',
  RUN: 'รัน',
  PUBLISH: 'เผยแพร่',
  PUBLISHED: 'เผยแพร่',
  STATUS_CHANGED: 'เปลี่ยนสถานะ',
  ROLE_CHANGED: 'เปลี่ยน role',
  ASSIGNED: 'มอบหมายงาน',
  COMMENTED: 'แสดงความเห็น',
}

/** path ที่เก็บไว้ใน newValue ของ log อัตโนมัติ */
export function readAutoPath(newValue: string | null | undefined): { path: string; method: string } | null {
  if (!newValue) return null
  try {
    const v = JSON.parse(newValue) as { path?: unknown; method?: unknown }
    if (typeof v.path === 'string') return { path: v.path, method: typeof v.method === 'string' ? v.method : '' }
  } catch { /* ไม่ใช่ JSON */ }
  return null
}

export function describeActivity(log: ActivityLike): string {
  const kind = activityKind(log.action)
  if (kind === 'action') {
    const auto = readAutoPath(log.newValue)
    const method = auto?.method || log.action.slice(AUTO_API_PREFIX.length)
    return describeApiRequest(auto?.path ?? '', method)
  }
  if (kind === 'view') return describePage(readAutoPath(log.newValue)?.path ?? log.entityId)
  if (log.action === LOGIN_ACTION) return 'เข้าสู่ระบบ'
  if (log.action === LOGOUT_ACTION) return 'ออกจากระบบ'

  const verb = LEGACY_ACTIONS[log.action.toUpperCase()] ?? log.action.replace(/_/g, ' ').toLowerCase()
  const change = log.oldValue || log.newValue
    ? ` (${log.oldValue ? `${log.oldValue.slice(0, 60)} → ` : ''}${(log.newValue ?? '').slice(0, 60)})`
    : ''
  return `${verb} ${log.entityType}${change}`
}
