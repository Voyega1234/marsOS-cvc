// ค่าเวลาของ writer ที่ฝั่ง client ใช้ได้ด้วย (ไม่ดึงโค้ด server) — writer.ts re-export ต่อ
/** เวลาสูงสุดที่ route เขียนทำงานได้ (= maxDuration ของ write route, วินาที) */
export const WRITER_MAX_DURATION_S = 800
/** WRITING ที่ค้างเกินนี้ถือว่าตาย (proc ตายกลางทาง) — ต้องมากกว่า maxDuration ของ route + เผื่อ กันลบแถวที่ยังเขียนอยู่ */
export const WRITER_STALE_MS = WRITER_MAX_DURATION_S * 1000 + 2 * 60 * 1000
