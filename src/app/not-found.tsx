import Link from "next/link";
import { FileSearch } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-5 text-center px-4 bg-[#f9f9f8]">
      <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center">
        <FileSearch className="h-7 w-7 text-gray-400" />
      </div>
      <div>
        <h1 className="text-4xl font-semibold text-gray-900">404</h1>
        <p className="text-sm text-gray-500 mt-2">ไม่พบหน้าที่คุณต้องการ</p>
      </div>
      <Link
        href="/dashboard"
        className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors"
      >
        กลับหน้าหลัก
      </Link>
    </div>
  );
}
