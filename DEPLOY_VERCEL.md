# Deploy to Vercel

## สิ่งที่ต้องเตรียม (Dev ทำ)

### 1. สร้าง Supabase PostgreSQL Database
เปิด **https://supabase.com/dashboard** → New Project → Project Settings → Database → Copy connection strings 2 อัน:
- **Pooled URL** (port `6543`, host เป็น `pooler.supabase.com`) → ใส่ใน `DATABASE_URL`
- **Direct URL** (host เป็น `db.PROJECT_REF.supabase.co`, port `5432`) → ใส่ใน `DIRECT_URL`

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

ถ้าต้องการใช้ Supabase SQL Editor แทน Prisma CLI ให้ใช้ไฟล์ `supabase/schema.sql` ใน repo นี้ ซึ่ง generate มาจาก `prisma/schema.prisma`

---

### 4. เตรียม Google Vertex AI ผ่าน Vercel OIDC

ไม่ต้องใช้ `GEMINI_API_KEY` แล้ว ให้ตั้งค่า Google Cloud Workload Identity Federation ให้ Vercel impersonate service account ได้ แล้วใส่ env เหล่านี้ใน Vercel:

| Key | Value |
|-----|-------|
| `GCP_PROJECT_ID` | Google Cloud project ID |
| `GCP_PROJECT_NUMBER` | Google Cloud project number |
| `GCP_SERVICE_ACCOUNT_EMAIL` | Service account ที่ให้ Vertex AI access |
| `GCP_WORKLOAD_IDENTITY_POOL_ID` | Workload Identity Pool ID |
| `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID` | Workload Identity Provider ID |
| `GCP_LOCATION` | เช่น `us-central1` |
| `GEMINI_MODEL` | เช่น `gemini-2.5-flash` |
| `VERTEX_GEMINI_IMAGE_MODEL` | เช่น `gemini-2.5-flash-image` |

---

### 5. ตั้งค่า Vercel

**Vercel Dashboard → Project → Settings → Environment Variables**  
ใส่ค่าทุกอย่างจากไฟล์ `.env.production` (แนบมาด้วยกัน)

**Build Settings:**
| Setting | Value |
|---------|-------|
| Build Command | `npm run vercel-build` |
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
- [ ] `ANTHROPIC_API_KEY` ใส่แล้ว
- [ ] Google Vertex AI OIDC env ครบ (`GCP_*`, `GEMINI_MODEL`, `VERTEX_GEMINI_IMAGE_MODEL`)
- [ ] ทดสอบ login ได้
- [ ] ทดสอบ Report page ดึง GSC/GA4 ได้

---

### ปัญหาที่พบบ่อย

| อาการ | วิธีแก้ |
|-------|---------|
| Build fail: prisma client not found | ตรวจ Build Command ว่ามี `prisma generate &&` |
| Vertex/Gemini ไม่ทำงาน | ตรวจว่า Vercel OIDC env ครบ และ service account มีสิทธิ์ Vertex AI User |
| NextAuth error | `NEXTAUTH_URL` ต้องตรงกับ URL จริง รวมถึง `https://` |
| DB connection timeout | ใช้ Supabase pooled URL ใน `DATABASE_URL` และ direct URL ใน `DIRECT_URL` |
