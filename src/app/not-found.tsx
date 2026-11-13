import Link from "next/link";
import NextImage from "next/image";

export default function NotFound() {
  return (
    <div className="flex items-center justify-center min-h-screen px-4">
    <div className="glass-strong rounded-3xl flex flex-col items-center gap-5 text-center px-10 py-10 w-full max-w-sm">
      <NextImage src="/logos/convertcake-mark.png" alt="Convert Cake" width={64} height={64} priority unoptimized />
      <div>
        <h1 className="text-4xl font-semibold text-brand-navy">404</h1>
        <p className="text-sm text-gray-500 mt-2">ไม่พบหน้าที่คุณต้องการ</p>
      </div>
      <Link
        href="/dashboard"
        className="px-4 py-2 bg-brand-blue text-white text-sm font-medium rounded-full hover:bg-brand-deep transition-colors"
      >
        กลับหน้าหลัก
      </Link>
    </div>
    </div>
  );
}
