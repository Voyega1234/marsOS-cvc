// ปิดปุ่มเขียนบทความแบบเก่า (/api/ai/article, /api/ai/auto-run, /api/articles/[id]/fix)
// เพราะไม่ดึงข้อจำกัดของ Content Engine (คำต้องห้าม/กฎ) — เขียนผ่าน /api/article/write หรือ Upload Article แทน
export const LEGACY_AI_WRITER_ENABLED = false;
