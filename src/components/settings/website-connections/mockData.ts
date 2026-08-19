// Mock / config data for Settings > Website Connections.
// Real data (WordPress connections) is normalized separately in buildRealConnectionRows().
// Everything else here is illustrative UI data only (labeled "ตัวอย่าง" in the UI).

import type { ConnectionRow, ProjectLite, RealWpConnection } from "./types";

// ─── Real WordPress rows → normalized ConnectionRow ───────────────────────

export function buildRealConnectionRows(
  wpConnections: RealWpConnection[],
  projects: ProjectLite[]
): ConnectionRow[] {
  return wpConnections.map((wp) => {
    const linkedProjects = projects.filter((p) => p.wordpressConnectionId === wp.id);
    const client = linkedProjects.length
      ? linkedProjects.map((p) => p.clientName || p.name).join(", ")
      : "—";

    let domain = "—";
    try {
      domain = new URL(wp.siteUrl).hostname;
    } catch {
      domain = wp.siteUrl.replace(/^https?:\/\//, "").split("/")[0] || "—";
    }

    return {
      id: wp.id,
      isMock: false,
      name: wp.name,
      client,
      websiteUrl: wp.siteUrl,
      domain,
      platform: "WordPress",
      environment: "Production",
      status: "Active",
      verification: "ยังไม่ตรวจสอบ",
      permissionMode: wp.defaultStatus === "publish" ? "Draft + Publish (Direct)" : "Read + Create Draft",
      readCapability: true,
      writeCapability: true,
      publishCapability: wp.defaultStatus === "publish",
      lastSync: null,
      nextSync: null,
      pageCount: null,
      mediaCount: null,
      authors: null,
      error: null,
      connectorVersion: null,
      createdBy: wp.username || null,
    };
  });
}

// ─── ไม่มี mock connections — แสดงเฉพาะ connection จริงเท่านั้น ─────────────
// (adapter อื่นที่ยังไม่ได้ implement จะขึ้น "เร็วๆ นี้" ใน wizard แทน)

export const MOCK_CONNECTIONS: ConnectionRow[] = [];

export const STATUS_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
  Draft: { bg: "bg-gray-50 border-gray-200", text: "text-gray-600", dot: "bg-gray-400" },
  Verifying: { bg: "bg-blue-50 border-blue-200", text: "text-blue-700", dot: "bg-blue-500" },
  Active: { bg: "bg-emerald-50 border-emerald-200", text: "text-emerald-700", dot: "bg-emerald-500" },
  "Read-only": { bg: "bg-indigo-50 border-indigo-200", text: "text-indigo-700", dot: "bg-indigo-500" },
  "Publish Enabled": { bg: "bg-teal-50 border-teal-200", text: "text-teal-700", dot: "bg-teal-500" },
  "Permission Missing": { bg: "bg-amber-50 border-amber-200", text: "text-amber-700", dot: "bg-amber-500" },
  "Sync Failed": { bg: "bg-rose-50 border-rose-200", text: "text-rose-700", dot: "bg-rose-500" },
  "Authentication Expired": { bg: "bg-rose-50 border-rose-200", text: "text-rose-700", dot: "bg-rose-500" },
  Paused: { bg: "bg-yellow-50 border-yellow-200", text: "text-yellow-700", dot: "bg-yellow-500" },
  Disconnected: { bg: "bg-gray-50 border-gray-200", text: "text-gray-500", dot: "bg-gray-400" },
  Archived: { bg: "bg-gray-50 border-gray-200", text: "text-gray-400", dot: "bg-gray-300" },
  "ยังไม่ตรวจสอบ": { bg: "bg-gray-50 border-gray-200", text: "text-gray-500", dot: "bg-gray-400" },
  "ตรวจสอบแล้ว": { bg: "bg-emerald-50 border-emerald-200", text: "text-emerald-700", dot: "bg-emerald-500" },
  "ตรวจสอบไม่ผ่าน": { bg: "bg-rose-50 border-rose-200", text: "text-rose-700", dot: "bg-rose-500" },
  "กำลังตรวจสอบ": { bg: "bg-blue-50 border-blue-200", text: "text-blue-700", dot: "bg-blue-500" },
};

// ─── Supported adapters (§Q) ───────────────────────────────────────────────

export interface AdapterDef {
  id: string;
  name: string;
  platform: string;
  available: boolean;
  capabilities: string[];
}

export const ADAPTERS: AdapterDef[] = [
  { id: "wordpress", name: "WordPress REST API + Application Password", platform: "WordPress", available: true, capabilities: ["read_pages", "read_posts", "read_media", "read_authors", "read_categories", "read_tags", "create_draft", "update_draft", "upload_media", "publish"] },
  { id: "webflow", name: "Webflow CMS API", platform: "Webflow", available: false, capabilities: ["read_pages", "read_posts", "read_media", "read_authors", "create_draft", "publish"] },
  { id: "shopify", name: "Shopify Admin API (Blog/Pages)", platform: "Shopify", available: false, capabilities: ["read_pages", "read_posts", "read_authors", "create_draft", "publish"] },
  { id: "headless", name: "Headless CMS Adapter", platform: "Headless CMS", available: false, capabilities: ["read_pages", "read_posts", "read_media", "create_draft", "update_draft", "webhook"] },
  { id: "custom-api", name: "Custom REST API Adapter", platform: "Custom API", available: false, capabilities: ["read_pages", "read_posts", "create_draft", "update_draft"] },
  { id: "sitemap", name: "Sitemap + Crawl Read-only Adapter", platform: "Sitemap Read-only", available: true, capabilities: ["read_pages", "read_redirects", "read_schema"] },
  { id: "manual", name: "Manual Export / Import Adapter", platform: "Manual Import", available: false, capabilities: ["read_pages", "read_posts"] },
  { id: "webhook", name: "Generic Webhook Publisher", platform: "Webhook Publisher", available: false, capabilities: ["webhook", "create_draft", "publish"] },
];

export const CAPABILITY_LABELS: Record<string, string> = {
  read_pages: "อ่านหน้าเว็บ",
  read_posts: "อ่านบทความ",
  read_media: "อ่านสื่อ",
  read_authors: "อ่านผู้เขียน",
  read_categories: "อ่านหมวดหมู่",
  read_tags: "อ่าน Tags",
  read_schema: "อ่าน Schema",
  read_redirects: "อ่าน Redirects",
  create_draft: "สร้าง Draft",
  update_draft: "แก้ไข Draft",
  upload_media: "อัปโหลดสื่อ",
  schedule_publish: "ตั้งเวลาเผยแพร่",
  publish: "เผยแพร่",
  unpublish: "ยกเลิกเผยแพร่",
  rollback: "ย้อนกลับ",
  verify: "ตรวจสอบ",
  webhook: "Webhook",
  preview_url: "Preview URL",
};

// ─── Overview summary cards (§O) ───────────────────────────────────────────

export interface SummaryCardDef {
  key: string;
  label: string;
  value: number;
  mock: boolean;
  tone: "default" | "success" | "warning" | "danger";
}

// ─── CMS & Publishing (§T) ─────────────────────────────────────────────────

export const PUBLISHING_MODES = [
  { id: "draft-only", label: "Draft Only", desc: "สร้างเป็น Draft บน CMS เท่านั้น ไม่เผยแพร่อัตโนมัติ", disabled: false, default: true },
  { id: "draft-human", label: "Draft + Human Publish", desc: "สร้าง Draft แล้วรอผู้มีสิทธิ์กด Publish ด้วยตนเอง", disabled: false, default: false },
  { id: "scheduled", label: "Scheduled Publish", desc: "ตั้งเวลาที่จะเผยแพร่ล่วงหน้าหลัง Approve", disabled: false, default: false },
  { id: "direct", label: "Direct Publish", desc: "เผยแพร่ทันทีหลัง Validator ผ่าน เฉพาะ Low Risk + Policy อนุญาต", disabled: true, default: false, note: "เฉพาะ Low Risk + Policy อนุญาต" },
  { id: "export-only", label: "Export Only", desc: "Export เนื้อหาออกไปโดยไม่ส่งเข้า CMS โดยตรง", disabled: false, default: false },
  { id: "webhook-delivery", label: "Webhook Delivery", desc: "ส่งเนื้อหาผ่าน Webhook ไปยังระบบปลายทางเอง", disabled: false, default: false },
];

export const PUBLISH_FLOW_STEPS = [
  "Approved Content", "CMS Publish Validator", "Create Change Set", "Create CMS Draft",
  "Return Preview URL", "Human Review", "Approve", "Schedule / Publish",
  "Verify URL", "Verify Content", "Verify Meta", "Verify Internal Links",
  "Verify Schema", "Save Published Version", "Create Measurement Record",
];

export const PUBLISH_PROHIBITED = [
  "Publish เมื่อ Validator Block",
  "Publish เมื่อ Website Connection Inactive",
  "Publish เมื่อ Permission ไม่พอ",
  "Publish เมื่อ Target URL Conflict",
  "Publish High-risk Content โดยไม่มี Human Approval",
  "Publish YMYL โดยไม่มี Expert Approval",
  "Overwrite Published Page โดยไม่มี Diff และ Snapshot",
];

// ─── Website Data Sync (§S) ────────────────────────────────────────────────

export const SYNCED_FIELDS = [
  "URL", "Page ID", "CMS Object ID", "Title", "Slug", "Status", "Content Type",
  "HTML / Content Snapshot", "Excerpt", "Meta Title", "Meta Description", "Canonical",
  "Author", "Reviewer", "Category", "Tags", "Featured Image", "Internal Links",
  "External Links", "Schema", "Publish Date", "Modified Date", "Language",
  "Parent Page", "Redirect", "Indexability", "CTA", "Contact Data", "Template", "CMS Version",
];

export const SYNC_MODES = [
  { id: "initial-full", label: "Initial Full Sync", desc: "ดึงข้อมูลทั้งหมดครั้งแรกตอนเชื่อมต่อเว็บไซต์" },
  { id: "incremental", label: "Incremental Sync", desc: "ดึงเฉพาะข้อมูลที่เปลี่ยนแปลงตั้งแต่ครั้งล่าสุด" },
  { id: "on-demand", label: "On-demand Sync", desc: "ผู้ใช้กด Sync Now ด้วยตนเอง" },
  { id: "webhook", label: "Webhook Sync", desc: "Sync อัตโนมัติเมื่อ CMS ยิง Webhook เข้ามา" },
  { id: "scheduled", label: "Scheduled Sync", desc: "Sync ตามรอบเวลาที่ตั้งไว้" },
  { id: "post-publish", label: "Post-publish Verification Sync", desc: "Sync เพื่อยืนยันหลัง Publish สำเร็จ" },
];

export const SYNC_PIPELINE = [
  "Website Adapter", "Fetch", "Validate", "Normalize", "Store Snapshot",
  "Update Page Inventory", "Detect Change", "Update Internal Link Library",
  "Notify Content Engine", "Audit",
];

export interface SyncRun {
  id: string;
  connection: string;
  mode: string;
  startedAt: string;
  completedAt: string | null;
  rowsRead: number;
  rowsWritten: number;
  rowsFailed: number;
  status: "Success" | "Partial" | "Failed" | "Running";
  error: string | null;
}

// ยังไม่มีระบบเก็บข้อมูลส่วนนี้จริง — แสดง empty state แทน mock
export const MOCK_SYNC_RUNS: SyncRun[] = [];

// ─── Environments (§U) ──────────────────────────────────────────────────────

export interface EnvironmentDef {
  id: string;
  name: string;
  url: string;
  connection: string;
  credentialRef: string;
  capabilities: string[];
  syncStatus: string;
  publishPermission: string;
  robotsWarning: string | null;
  lastDeploy: string;
  version: string;
}

export const ENVIRONMENTS: EnvironmentDef[] = [
  { id: "production", name: "Production", url: "https://abcclinic.co.th", connection: "ABC Clinic WordPress", credentialRef: "cred-ref-prod-••••41a2", capabilities: ["read_pages", "create_draft", "publish", "rollback"], syncStatus: "Up to date", publishPermission: "Requires Approval", robotsWarning: null, lastDeploy: "วันนี้ 08:40", version: "v14" },
  { id: "staging", name: "Staging", url: "https://abc-clinic.staging.webflow.io", connection: "ABC Clinic Webflow (Staging)", credentialRef: "cred-ref-stg-••••90bc", capabilities: ["read_pages", "read_media"], syncStatus: "Up to date", publishPermission: "Read-only", robotsWarning: "ห้าม Submit Index / ห้ามสร้าง Canonical ไป Staging", lastDeploy: "วันนี้ 07:15", version: "v9" },
  { id: "development", name: "Development", url: "https://dev.abcclinic.internal", connection: "ยังไม่เชื่อมต่อ", credentialRef: "—", capabilities: [], syncStatus: "ไม่มีข้อมูล", publishPermission: "ปิดใช้งาน", robotsWarning: "ห้ามใช้ Internal Link ของ Staging ใน Production Content", lastDeploy: "—", version: "—" },
  { id: "preview", name: "Preview", url: "https://preview.abcclinic.co.th", connection: "ABC Clinic WordPress", credentialRef: "cred-ref-prev-••••7f3d", capabilities: ["read_pages", "preview_url"], syncStatus: "Sync Partial", publishPermission: "Read-only", robotsWarning: "ห้าม Submit Index", lastDeploy: "2 วันก่อน", version: "v14" },
];

export const STAGING_WARNINGS = [
  "ห้าม Submit Index",
  "ห้ามสร้าง Canonical ไป Staging",
  "ห้ามใช้ Internal Link ของ Staging ใน Production Content",
];

export const PROMOTE_FLOW_STEPS = [
  "Draft", "Staging", "Verify", "Production Approval", "Production Publish", "Verify", "Rollback if Failed",
];

// ─── Permissions & Security (§V) ───────────────────────────────────────────

export const PERMISSION_ROLES = [
  "Admin", "Content Director", "SEO Manager", "Content Writer", "Developer", "Client Approver", "Client Viewer",
] as const;

export const PERMISSION_CAPABILITIES = [
  "Read Website Data", "Read Drafts", "Read Media", "Create Draft", "Update Draft",
  "Upload Media", "Schedule Publish", "Publish", "Unpublish", "Rollback",
  "Manage Schema", "Manage Redirects",
] as const;

// role -> set of allowed capabilities
export const ROLE_CAPABILITY_MATRIX: Record<string, string[]> = {
  Admin: [...PERMISSION_CAPABILITIES],
  "Content Director": ["Read Website Data", "Read Drafts", "Read Media", "Create Draft", "Update Draft", "Upload Media", "Schedule Publish", "Publish"],
  "SEO Manager": ["Read Website Data", "Read Drafts", "Read Media", "Create Draft", "Update Draft", "Schedule Publish", "Publish", "Manage Redirects"],
  "Content Writer": ["Read Website Data", "Read Drafts", "Read Media", "Create Draft", "Update Draft"],
  Developer: ["Read Website Data", "Read Drafts", "Read Media", "Create Draft", "Update Draft", "Upload Media", "Rollback", "Manage Schema", "Manage Redirects"],
  "Client Approver": ["Read Website Data", "Read Drafts"],
  "Client Viewer": ["Read Website Data"],
};

export const SECURITY_CHECKLIST = [
  "Server-side encrypted secrets", "Least privilege", "OAuth where possible", "Secret rotation",
  "Revoke access", "IP / access logging", "Client isolation", "No secrets in logs",
  "No secrets in front-end", "CSRF protection", "Webhook signature verification",
  "Rate limiting", "Retry with backoff", "Audit permission changes",
];

export interface PermissionAuditEntry {
  id: string;
  timestamp: string;
  actor: string;
  connection: string;
  change: string;
}

// ยังไม่มีระบบเก็บข้อมูลส่วนนี้จริง — แสดง empty state แทน mock
export const MOCK_PERMISSION_AUDIT: PermissionAuditEntry[] = [];

// ─── Webhooks & Automation (§W) ────────────────────────────────────────────

export interface AutomationRule {
  id: string;
  name: string;
  trigger: string;
  connection: string;
  owner: string;
  enabledDefault: boolean;
  lastRun: string;
  status: "Healthy" | "Retrying" | "Failed";
}

export const AUTOMATION_RULES: AutomationRule[] = [
  { id: "auto-1", name: "Scheduled Website Sync", trigger: "Schedule (ทุก 12 ชม.)", connection: "ABC Clinic WordPress", owner: "system", enabledDefault: true, lastRun: "วันนี้ 08:40", status: "Healthy" },
  { id: "auto-2", name: "Sync after Publish", trigger: "post.published", connection: "ABC Clinic WordPress", owner: "system", enabledDefault: true, lastRun: "วันนี้ 08:41", status: "Healthy" },
  { id: "auto-3", name: "Sync after External CMS Edit", trigger: "page.updated", connection: "ABC Clinic Webflow (Staging)", owner: "system", enabledDefault: true, lastRun: "วันนี้ 07:16", status: "Healthy" },
  { id: "auto-4", name: "Update Internal Link Inventory", trigger: "sync.completed", connection: "ABC Clinic WordPress", owner: "system", enabledDefault: true, lastRun: "วันนี้ 08:41", status: "Healthy" },
  { id: "auto-5", name: "Detect Deleted Page", trigger: "sync.completed", connection: "ABC Clinic WordPress", owner: "system", enabledDefault: true, lastRun: "วันนี้ 08:41", status: "Healthy" },
  { id: "auto-6", name: "Detect URL Change", trigger: "sync.completed", connection: "ABC Clinic WordPress", owner: "system", enabledDefault: true, lastRun: "วันนี้ 08:41", status: "Healthy" },
  { id: "auto-7", name: "Detect Author Change", trigger: "author.updated", connection: "ABC Clinic WordPress", owner: "system", enabledDefault: false, lastRun: "—", status: "Healthy" },
  { id: "auto-8", name: "Detect Category Change", trigger: "sync.completed", connection: "ABC Clinic WordPress", owner: "system", enabledDefault: false, lastRun: "—", status: "Healthy" },
  { id: "auto-9", name: "Detect Content Conflict", trigger: "sync.completed", connection: "ABC Clinic WordPress", owner: "system", enabledDefault: true, lastRun: "วันนี้ 08:41", status: "Retrying" },
  { id: "auto-10", name: "Create CMS Draft after Approval", trigger: "content.approved", connection: "ABC Clinic WordPress", owner: "content-director", enabledDefault: true, lastRun: "เมื่อวาน 18:02", status: "Healthy" },
  { id: "auto-11", name: "Verify Published URL", trigger: "post.published", connection: "ABC Clinic WordPress", owner: "system", enabledDefault: true, lastRun: "เมื่อวาน 18:05", status: "Healthy" },
  { id: "auto-12", name: "Reopen Task when Publish Failed", trigger: "publish.failed", connection: "ABC Clinic WordPress", owner: "system", enabledDefault: true, lastRun: "—", status: "Healthy" },
  { id: "auto-13", name: "Alert Credential Expiry", trigger: "credential.expiring", connection: "ABC Clinic WordPress", owner: "system", enabledDefault: true, lastRun: "—", status: "Healthy" },
  { id: "auto-14", name: "Alert Permission Change", trigger: "permission.changed", connection: "ABC Clinic WordPress", owner: "system", enabledDefault: true, lastRun: "วันนี้ 09:12", status: "Healthy" },
  { id: "auto-15", name: "Alert Stale Data", trigger: "sync.stale", connection: "Competitor Sitemap Crawl", owner: "system", enabledDefault: true, lastRun: "6 วันก่อน", status: "Failed" },
];

export const WEBHOOK_EVENTS = [
  "post.created", "post.updated", "post.published", "post.deleted", "page.updated",
  "media.uploaded", "author.updated", "redirect.changed", "connection.expired",
];

export interface WebhookDelivery {
  id: string;
  timestamp: string;
  event: string;
  connection: string;
  statusCode: number;
  attempt: number;
  signatureValid: boolean;
}

// ยังไม่มีระบบเก็บข้อมูลส่วนนี้จริง — แสดง empty state แทน mock
export const MOCK_WEBHOOK_DELIVERIES: WebhookDelivery[] = [];

// ─── Field Mapping defaults (§R Step 7) ────────────────────────────────────

export interface FieldMappingRow {
  cmsField: string;
  sourceField: string;
}

export const DEFAULT_FIELD_MAPPING: FieldMappingRow[] = [
  { cmsField: "Title", sourceField: "article.title" },
  { cmsField: "Slug", sourceField: "article.slug" },
  { cmsField: "Body", sourceField: "article.body_html" },
  { cmsField: "Excerpt / Meta Description", sourceField: "article.meta_description" },
  { cmsField: "Featured Image", sourceField: "article.featured_image" },
  { cmsField: "Author", sourceField: "publish_config.default_author" },
  { cmsField: "Category", sourceField: "publish_config.default_category" },
  { cmsField: "Tags", sourceField: "article.tags" },
  { cmsField: "Schema", sourceField: "article.schema_jsonld" },
  { cmsField: "Canonical", sourceField: "article.canonical_url" },
  { cmsField: "Status", sourceField: "publish_config.default_status" },
  { cmsField: "Publish Date", sourceField: "publish_run.scheduled_at" },
  { cmsField: "Custom Fields", sourceField: "article.custom_fields" },
  { cmsField: "SEO Plugin Fields", sourceField: "article.seo_meta" },
];

// ─── Logs & Audit (combined) ────────────────────────────────────────────────

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actor: string;
  connection: string;
  action: string;
  result: "Success" | "Failed" | "Blocked";
  runId: string | null;
  detail: string;
}

// ยังไม่มีระบบเก็บข้อมูลส่วนนี้จริง — แสดง empty state แทน mock
export const MOCK_AUDIT_LOG: AuditLogEntry[] = [];
