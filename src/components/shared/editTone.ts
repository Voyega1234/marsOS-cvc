// โทนสีตอนแก้ไขบทความ (ใช้ร่วมกันระหว่าง Upload Review และ SME Review)
// ทั้งหมดอยู่นอกตัว editor จึงไม่ถูกบันทึกลงบทความ

const PAGE_BG_RE = /^(?:#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\))$/i;

/** พื้นหลังตอนแก้ไขให้ตรงกับ Preview (สีพื้นหน้าเว็บปลายทาง) — รับเฉพาะ hex/rgb */
export function editBackground(pageBackground?: string): string {
  const bg = (pageBackground || "").trim();
  return bg && PAGE_BG_RE.test(bg) ? bg : "#fff";
}

/** โหมด "สีอ่านง่าย" — บังคับตัวอักษรเข้มบนพื้นขาว อยู่นอกตัว editor จึงไม่ถูกบันทึกลงบทความ */
export const EDIT_READABLE_CSS = `
.ua-edit-readable .cc-scoped-editor,
.ua-edit-readable .cc-scoped-editor *:not(img):not(svg) {
  color: #111827 !important;
  background-color: transparent !important;
  -webkit-text-fill-color: #111827 !important;
}
.ua-edit-readable .cc-scoped-editor a, .ua-edit-readable .cc-scoped-editor a * {
  color: #1d4ed8 !important;
  -webkit-text-fill-color: #1d4ed8 !important;
}
`;
