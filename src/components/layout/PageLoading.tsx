import { Loader2 } from "lucide-react";

/**
 * สถานะระหว่างรอหน้าโหลด — loading.tsx ของทุก segment ใน (app) ใช้ตัวนี้ตัวเดียว
 * หน้าตาเดียวกับตัวหมุน "กำลังโหลด..." ที่หน้า Upload Article ใช้อยู่แล้ว
 * แสดงในช่องเนื้อหาเท่านั้น (sidebar / แถบบนเป็นของ layout อยู่เหนือ boundary นี้)
 */
export default function PageLoading() {
  return (
    <div role="status" className="space-y-5">
      <div className="space-y-2">
        <div className="h-3 w-24 rounded-full bg-white/60 animate-pulse" />
        <div className="h-9 w-64 max-w-full rounded-2xl bg-white/60 animate-pulse" />
        <div className="h-4 w-80 max-w-full rounded-full bg-white/60 animate-pulse" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-2xl bg-white/60 animate-pulse" />
        ))}
      </div>
      <div className="h-80 rounded-2xl bg-white/60 animate-pulse" />
      <div className="flex items-center justify-center text-gray-400 text-sm gap-2">
        <Loader2 size={16} className="animate-spin" /> กำลังโหลด...
      </div>
    </div>
  );
}
