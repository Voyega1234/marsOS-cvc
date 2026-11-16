/** ทำความสะอาดชื่อโปรเจกต์: ไม่ใช่ข้อความ → "", ตัดช่องว่างหัวท้าย, ยุบช่องว่างซ้อน, จำกัด 120 ตัวอักษร */
export function cleanProjectName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().replace(/\s+/g, " ").slice(0, 120);
}
