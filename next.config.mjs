/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
  experimental: {
    // fontkit อ่านตารางฟอนต์แบบ binary + มีไฟล์ข้อมูล Unicode ของตัวเอง — ถ้าถูก bundle
    // เข้าไฟล์เดียวจะพังตอนรันบน lambda จึงต้องปล่อยให้ require จาก node_modules ตรง ๆ
    serverComponentsExternalPackages: ["fontkit"],
    // ฟอนต์ที่ใช้วาดตัวหนังสือบนภาพปก (src/lib/coverOverlay.ts) ไม่ได้ถูก import
    // เป็นโมดูล Next จึงมองไม่เห็นเอง ต้องสั่ง trace เข้า bundle ของ route ที่สร้างภาพ
    outputFileTracingIncludes: {
      "/api/article/cover": ["./assets/fonts/**"],
      "/api/article/write": ["./assets/fonts/**"],
    },
  },
};

export default nextConfig;
