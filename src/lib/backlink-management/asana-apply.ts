/** ตัดสินผลเมื่อสถานะงานใน Asana เปลี่ยน (ฟังก์ชันล้วน ไม่แตะฐานข้อมูล/เครือข่าย) */
export interface AsanaApplyInput { status: string; liveUrl: string | null | undefined; asanaCompleted: boolean; taskCompleted: boolean }
export interface AsanaApplyDecision {
  /** ค่า asanaCompleted ที่ต้องบันทึก */
  asanaCompleted: boolean;
  /** สถานะใหม่ (null = ไม่เปลี่ยน) */
  nextStatus: "PUBLISHED" | null;
  /** ข้อความ event เมื่อเปลี่ยนสถานะ */
  note: string;
}

export function decideAsanaApply(input: AsanaApplyInput): AsanaApplyDecision {
  const { status, liveUrl, taskCompleted } = input;
  // เปิดงานใหม่ใน Asana — ไม่ย้อนสถานะกลับ
  if (!taskCompleted) return { asanaCompleted: false, nextStatus: null, note: "" };
  // REQUESTED ต้องผ่านขั้นอนุมัติงบก่อน จึงไม่ข้าม
  if (status === "APPROVED" || status === "IN_PROGRESS") {
    const hasUrl = !!(liveUrl ?? "").trim();
    return {
      asanaCompleted: true,
      nextStatus: "PUBLISHED",
      note: hasUrl ? "ปิดงานใน Asana แล้ว" : "ปิดงานใน Asana แล้ว — ยังไม่ได้ใส่ลิงก์ที่เผยแพร่",
    };
  }
  return { asanaCompleted: true, nextStatus: null, note: "" };
}
