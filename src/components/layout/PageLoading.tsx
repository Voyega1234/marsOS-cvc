import { Loader2 } from "lucide-react";

/**
 * สถานะระหว่างรอหน้าโหลด — loading.tsx ของทุก segment ใน (app) ใช้ตัวนี้ตัวเดียว
 * หน้าตาเดียวกับตัวหมุน "กำลังโหลด..." ที่หน้า Upload Article ใช้อยู่แล้ว
 * แสดงในช่องเนื้อหาเท่านั้น (sidebar / แถบบนเป็นของ layout อยู่เหนือ boundary นี้)
 */
export default function PageLoading() {
  return (
    <div role="status" className="flex items-center justify-center py-24 text-gray-400 text-sm gap-2">
      <Loader2 size={16} className="animate-spin" /> กำลังโหลด...
    </div>
  );
}
