// Shared types for Settings > Website Connections
// Scope: local to this feature only — do not import elsewhere.

export type ConnectionStatus =
  | "Draft"
  | "Verifying"
  | "Active"
  | "Read-only"
  | "Publish Enabled"
  | "Permission Missing"
  | "Sync Failed"
  | "Authentication Expired"
  | "Paused"
  | "Disconnected"
  | "Archived";

export type VerificationState = "ยังไม่ตรวจสอบ" | "ตรวจสอบแล้ว" | "ตรวจสอบไม่ผ่าน" | "กำลังตรวจสอบ";

export interface ConnectionRow {
  id: string;
  isMock: boolean;
  name: string;
  client: string;
  websiteUrl: string;
  domain: string;
  platform: string;
  environment: string;
  status: ConnectionStatus;
  verification: VerificationState;
  permissionMode: string;
  readCapability: boolean;
  writeCapability: boolean;
  publishCapability: boolean;
  lastSync: string | null;
  nextSync: string | null;
  pageCount: number | null;
  mediaCount: number | null;
  authors: number | null;
  error: string | null;
  connectorVersion: string | null;
  createdBy: string | null;
  paused?: boolean;
}

// Raw shape returned from prisma.wordPressConnection.findMany (see page.tsx)
export interface RealWpConnection {
  id: string;
  name: string;
  siteUrl: string;
  username: string;
  defaultStatus: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectLite {
  id: string;
  name: string;
  clientName: string | null;
  website: string;
  wordpressConnectionId?: string | null;
}

export type SettingsTabId =
  | "overview"
  | "connections"
  | "cms-publishing"
  | "data-sync"
  | "environments"
  | "permissions"
  | "webhooks"
  | "logs";
