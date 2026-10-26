// ปิดปุ่มเขียนบทความแบบเก่า (/api/ai/article, /api/ai/auto-run, /api/articles/[id]/fix)
// เพราะไม่ดึงข้อจำกัดของ Content Engine (คำต้องห้าม/กฎ) — เขียนผ่าน /api/article/write หรือ Upload Article แทน
export const LEGACY_AI_WRITER_ENABLED = false;

// ข้อความที่ route/service เก่าตอบกลับเมื่อถูกเรียกตรง (client-safe — service import ได้โดยไม่ลาก next/server)
export const LEGACY_WRITER_GONE_MESSAGE =
  "เส้นทางเขียนบทความแบบเก่าถูกปิดแล้ว เพราะไม่ใช้ข้อจำกัดของ Content Engine (คำต้องห้าม/กฎ/ข้อมูลสินค้า) — เขียนผ่านแท็บ Article ของ client หรือ Upload Article แทน";
