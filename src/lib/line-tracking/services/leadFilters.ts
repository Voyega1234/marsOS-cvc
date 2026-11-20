// Lead-list filter options shared by server (leadWhere) and client (ChatFilter) code.

/**
 * ตัวกรองการทัก — ช่วงวันที่ปกติกรองตาม "วันที่ lead ถูกสร้าง" (วันแอดครั้งแรก) ลูกค้าเก่า
 * ที่กลับมาทักวันนี้จึงไม่โผล่ในช่วงวันนี้ `recent` ย้ายช่วงวันที่ไปกรองที่ "ทักล่าสุด" แทน
 * (lastMessageAt เก็บแค่ครั้งล่าสุด คนที่ทักในช่วงแล้วทักอีกทีหลังช่วงจะไม่ติดมา)
 */
export const CHAT_FILTERS = {
  recent: "ทักในช่วงวันที่นี้",
  messaged: "เคยทัก",
  added: "แค่แอด ยังไม่ทัก",
} as const;
export type ChatFilter = keyof typeof CHAT_FILTERS;

export function parseChatFilter(v: string | null | undefined): ChatFilter | undefined {
  return v && Object.hasOwn(CHAT_FILTERS, v) ? (v as ChatFilter) : undefined;
}
