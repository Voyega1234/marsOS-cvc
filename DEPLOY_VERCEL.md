# Deploy to Vercel

## สิ่งที่ต้องเตรียม (Dev ทำ)

### 1. สร้าง PostgreSQL Database
สมัคร **https://neon.tech** (free) → New Project → Copy connection strings 2 อัน:
- **Pooled URL** → ใส่ใน `DATABASE_URL`
- **Direct URL** (host ไม่มี `-pooler`) → ใส่ใน `DIRECT_URL`

---

### 2. แก้ `prisma/schema.prisma`

เปลี่ยน datasource block เป็น:

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

---

### 3. Run Migration

```bash
# ตั้ง env ก่อน แล้วรัน
DATABASE_URL="postgresql://..." DIRECT_URL="postgresql://..." npx prisma db push
DATABASE_URL="postgresql://..." DIRECT_URL="postgresql://..." npx tsx prisma/seed.ts
```

---

### 4. เตรียม `GOOGLE_SERVICE_ACCOUNT_JSON`

รันคำสั่งนี้ใน terminal บนเครื่อง Mac ของทีม แล้ว copy output ทั้งหมด:

```bash
cat credentials/service-account.json | python3 -m json.tool --compact
```

นำ output (single-line JSON) ไปใส่ใน env var `GOOGLE_SERVICE_ACCOUNT_JSON` บน Vercel

---

### 5. ตั้งค่า Vercel

**Vercel Dashboard → Project → Settings → Environment Variables**  
ใส่ค่าทุกอย่างจากไฟล์ `.env.production` (แนบมาด้วยกัน)

**Build Settings:**
| Setting | Value |
|---------|-------|
| Build Command | `prisma generate && next build` |
| Output Directory | `.next` |
| Node.js Version | 20.x |

---

### 6. หลัง Deploy — อัปเดต NEXTAUTH_URL

เมื่อได้ URL จาก Vercel แล้ว:
- แก้ `NEXTAUTH_URL` ใน Environment Variables ให้ตรงกับ URL จริง เช่น `https://myapp.vercel.app`
- Redeploy 1 ครั้ง

---

### 7. Checklist ก่อน Go Live

- [ ] PostgreSQL สร้างแล้ว และ `prisma db push` ผ่าน
- [ ] `npm run db:seed` รันแล้ว (ได้ admin user)
- [ ] `NEXTAUTH_URL` ตรงกับ domain จริง
- [ ] `GOOGLE_SERVICE_ACCOUNT_JSON` ใส่แล้ว (valid JSON)
- [ ] `ANTHROPIC_API_KEY` ใส่แล้ว
- [ ] ทดสอบ login ได้
- [ ] ทดสอบ Report page ดึง GSC/GA4 ได้

---

### ปัญหาที่พบบ่อย

| อาการ | วิธีแก้ |
|-------|---------|
| Build fail: prisma client not found | ตรวจ Build Command ว่ามี `prisma generate &&` |
| GSC/GA4 ไม่ทำงาน | ตรวจ `GOOGLE_SERVICE_ACCOUNT_JSON` วาง JSON ใน browser console แล้ว `JSON.parse(...)` ต้องไม่ error |
| NextAuth error | `NEXTAUTH_URL` ต้องตรงกับ URL จริง รวมถึง `https://` |
| DB connection timeout | เพิ่ม `?connect_timeout=30` ต่อท้าย `DATABASE_URL` |
