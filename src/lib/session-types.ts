import type { Role } from "@/types";

/**
 * รูปแบบ session ที่ทั้งแอปใช้ร่วมกัน
 *
 * แยกออกมาเป็นไฟล์ของตัวเองเพราะ client component ต้อง import type นี้ได้
 * โดยไม่ลาก prisma เข้าไปใน bundle ฝั่ง browser
 */
export interface AppSession {
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
    role: Role;
    organizationId: string | null;
  };
}
