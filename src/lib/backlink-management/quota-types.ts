/**
 * ชนิดข้อมูลกลางของ "โควต้า" Backlink (ไฟล์บริสุทธิ์ — ใช้ได้ทั้งฝั่งเซิร์ฟเวอร์และหน้าจอ ห้าม import prisma / googleapis)
 *
 * รูปแบบชีทโควต้า (1 แท็บ):
 *   หัวตาราง: Type | Website | Price / Link | Unit | Start | EXP. | Link URL | Published Date | Clients | Status | REMARK
 *   - 6 ช่องแรก (Type..EXP.) คือข้อมูล "แพ็กเกจ" — เซลล์ถูก merge ลงมาเท่าจำนวน Unit ค่าจึงอยู่แถวแรกของก้อนเท่านั้น
 *   - 5 ช่องหลัง (Link URL..REMARK) คือ "ช่อง" (slot) 1 แถว = 1 ลิงก์ที่ใช้โควต้า
 */

export type QuotaPackageField = "type" | "website" | "price" | "unit" | "start" | "expire";
export type QuotaSlotField = "linkUrl" | "publishedDate" | "client" | "status" | "remark";
export type QuotaField = QuotaPackageField | QuotaSlotField;

export const QUOTA_PACKAGE_FIELDS: QuotaPackageField[] = ["type", "website", "price", "unit", "start", "expire"];
export const QUOTA_SLOT_FIELDS: QuotaSlotField[] = ["linkUrl", "publishedDate", "client", "status", "remark"];

/** หัวตารางมาตรฐาน (ใช้ตอนสร้างหัวตารางในแท็บว่าง และเป็นลำดับคอลัมน์เริ่มต้น A..K) */
export const QUOTA_HEADERS: Record<QuotaField, string> = {
  type: "Type",
  website: "Website",
  price: "Price / Link",
  unit: "Unit",
  start: "Start",
  expire: "EXP.",
  linkUrl: "Link URL",
  publishedDate: "Published Date",
  client: "Clients",
  status: "Status",
  remark: "REMARK",
};
export const QUOTA_FIELD_ORDER: QuotaField[] = [...QUOTA_PACKAGE_FIELDS, ...QUOTA_SLOT_FIELDS];

/** ช่องไหนอยู่คอลัมน์ไหนของแท็บ (เลขคอลัมน์เริ่มที่ 0 = A) — ช่องที่หาหัวตารางไม่เจอจะไม่มี key */
export type QuotaColumns = Partial<Record<QuotaField, number>>;

/** สถานะที่ชีทใช้อยู่ (dropdown) — ค่าอื่นพิมพ์เองได้ */
export const QUOTA_STATUS_PUBLISHED = "Published";
export const QUOTA_STATUS_IN_PROCESS = "On Process";
export const QUOTA_DEFAULT_STATUSES = [QUOTA_STATUS_PUBLISHED, QUOTA_STATUS_IN_PROCESS];

export interface ParsedSlot {
  /** ลำดับช่องในแพ็กเกจ เริ่มที่ 0 */
  index: number;
  /** เลขแถวในชีท (เริ่มที่ 1) */
  row: number;
  linkUrl: string;
  /** วันที่ลง รูปแบบ YYYY-MM-DD (null = ว่างหรืออ่านไม่ออก) */
  publishedDate: string | null;
  /** ข้อความวันที่ตามที่อยู่ในชีท (เก็บไว้แสดงเมื่ออ่านเป็นวันที่ไม่ได้) */
  publishedText: string;
  client: string;
  status: string;
  remark: string;
  /** มีการใช้ช่องนี้แล้ว = ช่องใดช่องหนึ่งใน 5 ช่อง (linkUrl / publishedDate / client / status / remark) ไม่ว่าง */
  used: boolean;
  /** used และสถานะตรงกับ /publish/i */
  published: boolean;
}

export interface ParsedPackage {
  /** ลำดับแพ็กเกจในแท็บ เริ่มที่ 1 */
  ordinal: number;
  /** "<ชื่อแท็บ>#<ordinal>" */
  key: string;
  tabTitle: string;
  /** แถวแรกของก้อน (เริ่มที่ 1) */
  rowNumber: number;
  /** จำนวนแถวของก้อนในชีท */
  rowCount: number;
  type: string;
  /** ข้อความช่อง Website ทั้งช่อง (หลายบรรทัด) */
  websiteText: string;
  /** บรรทัดแรกที่ไม่ใช่โดเมน เช่น "Nectar" */
  vendorName: string;
  /** บรรทัดที่เป็นโดเมน ตามที่เขียนในชีท เช่น "www.bltbangkok.com (TH-EN)" */
  websites: string[];
  /** ข้อความช่อง Price / Link ทั้งช่อง */
  priceText: string;
  totalPrice: number | null;
  pricePerLink: number | null;
  unitText: string;
  /** จำนวนที่ซื้อ: จากช่อง Unit; ถ้าว่างและมีแพ็กเกจถัดไป = rowCount; ไม่รู้ = null */
  units: number | null;
  startDate: string | null;
  startText: string;
  expireDate: string | null;
  expireText: string;
  slots: ParsedSlot[];
}

export interface ParsedTab {
  tabTitle: string;
  /** แถวของหัวตาราง (เริ่มที่ 1) */
  headerRow: number;
  columns: QuotaColumns;
  packages: ParsedPackage[];
}

// ───────────────────────── รูปแบบที่ API ส่งให้หน้าจอ ─────────────────────────

export interface QuotaReservationView {
  id: string;
  reservedById: string;
  reservedByName: string;
  website: string;
  projectId: string;
  projectName: string;
  note: string;
  createdAt: string;
}

export interface QuotaSlotView extends ParsedSlot {
  reservation: QuotaReservationView | null;
}

export interface QuotaPackageView extends Omit<ParsedPackage, "slots"> {
  id: string;
  sourceId: string;
  sourceTitle: string;
  spreadsheetUrl: string;
  /** หมดอายุแล้ว (expireDate < วันนี้) */
  expired: boolean;
  /** ไม่พบในชีทแล้วตอนดึงครั้งล่าสุด */
  stale: boolean;
  /** ช่องที่ใช้แล้วทั้งหมด = published + inProcess */
  used: number;
  published: number;
  inProcess: number;
  /** ช่องที่ใช้แล้ว ยังไม่มีลิงก์ และมีการจองใน MarsOS (นับอยู่ใน inProcess ด้วย) */
  reserved: number;
  /** units - used (ไม่ต่ำกว่า 0); null เมื่อไม่รู้ units */
  remaining: number | null;
  /** remaining ที่ยังใช้ได้จริง = 0 เมื่อหมดอายุ; null เมื่อไม่รู้ units */
  usable: number | null;
  slots: QuotaSlotView[];
}

export interface QuotaSourceView {
  id: string;
  spreadsheetUrl: string;
  title: string;
  label: string;
  tabs: string[];
  lastPulledAt: string | null;
  lastError: string;
  packageCount: number;
}

export interface QuotaTotals {
  bought: number;
  used: number;
  published: number;
  inProcess: number;
  reserved: number;
  remaining: number;
  usable: number;
  /** จำนวนแพ็กเกจที่ยังไม่รู้ Unit (ไม่ถูกนับในตัวเลขด้านบน) */
  unknownUnits: number;
  /** ช่องที่ยังเหลือในแพ็กเกจที่จะหมดอายุภายใน 30 วัน */
  expiringSoon: number;
}

export interface QuotaView {
  sources: QuotaSourceView[];
  packages: QuotaPackageView[];
  totals: QuotaTotals;
  /** ค่าที่เคยใช้ในช่อง Clients / Status ของทุกชีท (ไว้เป็นตัวเลือก) */
  clientOptions: string[];
  statusOptions: string[];
  serviceEmail: string;
  /** เพิ่ม/ลบลิงก์ชีทได้ (ADMIN / SEO_MANAGER) */
  canManage: boolean;
  /** ยังไม่ได้สร้างตารางในฐานข้อมูล (ต้องรัน scripts/sql/add-blm-quota-asana-tables.sql) */
  tableMissing?: boolean;
}

/** GET /api/backlink-management/sheet/sources */
export interface SheetSourcesView {
  sources: QuotaSourceView[];
  serviceEmail: string;
  canEdit: boolean;
  tableMissing?: boolean;
}

// ───────────────────────── body ของคำสั่งเขียน ─────────────────────────

/** POST /quota/packages (สร้างแพ็กเกจใหม่ต่อท้ายแท็บ) และ PATCH /quota/packages/[id] (ทุกช่องเป็น optional) */
export interface QuotaPackageInput {
  sourceId?: string;
  tabTitle?: string;
  type?: string;
  websiteText?: string;
  priceText?: string;
  units?: number | null;
  /** YYYY-MM-DD หรือ "" เพื่อล้าง */
  startDate?: string;
  expireDate?: string;
}

/** PATCH /quota/packages/[id]/slots/[index] — ส่งเฉพาะช่องที่จะแก้; "" = ล้างช่อง */
export interface QuotaSlotInput {
  linkUrl?: string;
  /** YYYY-MM-DD หรือ "" */
  publishedDate?: string;
  client?: string;
  status?: string;
  remark?: string;
}

/** POST /quota/reservations */
export interface QuotaReservationInput {
  packageId: string;
  /** ไม่ส่ง = ช่องว่างช่องแรกของแพ็กเกจ */
  slotIndex?: number;
  reservedById: string;
  website?: string;
  projectId?: string;
  /** ค่าที่จะเขียนลงช่อง Clients */
  client: string;
  /** ค่าที่จะเขียนลงช่อง Status (ไม่ส่ง = "On Process") */
  status?: string;
  /** ค่าที่จะเขียนลงช่อง REMARK */
  remark?: string;
  note?: string;
}

/** คำตอบของทุกคำสั่งเขียนโควต้า: มุมมองล่าสุดหลังดึงชีทกลับมาใหม่ */
export interface QuotaWriteResult {
  view: QuotaView;
  /** คำเตือนที่ไม่ทำให้คำสั่งล้มเหลว เช่น จัดรูปแบบแถวใหม่ไม่ได้ */
  warning?: string;
}

/** เซลล์ที่มีข้อมูลอยู่แล้วและกำลังจะถูกเขียนทับ — ส่งกลับใน 409 ให้ผู้ใช้กดยืนยันก่อน */
export interface QuotaOverwrite {
  tabTitle: string;
  /** ตำแหน่งแบบ A1 เช่น "G5" */
  cell: string;
  /** ชื่อคอลัมน์ตามหัวตารางมาตรฐาน เช่น "Link URL" */
  header: string;
  oldValue: string;
  /** "" = ล้างช่อง */
  newValue: string;
  /** ผูกตำแหน่ง + ค่าเดิม + ค่าใหม่ — ผู้ใช้ยืนยันด้วยการส่ง key กลับมา (ชีทเปลี่ยนระหว่างทาง = key ไม่ตรง = ถามใหม่) */
  key: string;
}
