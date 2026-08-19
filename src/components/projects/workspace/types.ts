// ─────────────────────────────────────────────────────────────────────────────
//  Types ที่ใช้ร่วมกันใน Client Workspace (Overview / Timeline / On-Page / Technical)
//
//  แยกไฟล์ออกมาเพื่อไม่ให้ component ใหม่ต้อง import จาก ClientDetailTabs
//  (จะกลายเป็น circular import)
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkspaceProject {
  id: string;
  name: string;
  clientName: string | null;
  website: string;
  industry: string | null;
  businessType: string;
  language: string;
  notes: string | null;
  projectContext: string | null;
  accentColor?: string;
  gscSiteUrl?: string | null;
  ga4PropertyId?: string | null;
  _count: { articles: number; keywords: number };
}

/** สรุปตัวเลขที่ ClientDetailTabs รู้อยู่แล้ว ส่งต่อให้ Overview ใช้ */
export interface WorkspaceLiveStats {
  keywordCount: number;
  timelineCount: number;
  reviewCount: number;
  approvedCount: number;
  articleCount: number;
}

export type WorkspaceRole = "ADMIN" | "SEO_MANAGER" | "MEMBER" | "CLIENT" | string;

export function canSeeInternalCost(role: WorkspaceRole) {
  return role !== "CLIENT";
}
