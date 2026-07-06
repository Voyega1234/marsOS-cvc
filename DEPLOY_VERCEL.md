# Deploy to Vercel

## สิ่งที่ต้องเตรียม (Dev ทำ)

### 1. ตั้งค่า Supabase PostgreSQL
ใช้ connection strings 2 อันจาก **Supabase → Project Settings → Database**:
- **Transaction pooler** → ใส่ใน `DATABASE_URL`
- **Direct connection** → ใส่ใน `DIRECT_URL`

สำหรับ Vercel/serverless ต้องให้ `DATABASE_URL` มี PgBouncer params เพื่อไม่ให้ Prisma ชน error `prepared statement "s0" already exists`:

```env
DATABASE_URL="postgresql://postgres.PROJECT_REF:YOUR_PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres?schema=plans_seo_pipeline&pgbouncer=true&connection_limit=1"
DIRECT_URL="postgresql://postgres:YOUR_PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres?schema=plans_seo_pipeline"
```

---

### 2. แก้ `prisma/schema.prisma`

เปลี่ยน datasource block เป็น:

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
  schemas   = ["plans_seo_pipeline"]
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

### 4. ตั้งค่า Google integrations สำหรับ GSC/GA4

ตอนนี้ GSC/GA4 ใช้ `GOOGLE_SERVICE_ACCOUNT_JSON` เป็นหลักก่อน:

```env
GOOGLE_SERVICE_ACCOUNT_JSON=""
```

ถ้า `GOOGLE_SERVICE_ACCOUNT_JSON` ถูกตั้งไว้ ระบบจะใช้ JSON key นี้ก่อนเสมอ แม้จะมี `GCP_*` สำหรับ Vertex/Gemini อยู่ก็ตาม

ทางเลือกภายหลัง: ถ้าจะย้าย GSC/GA4 ไป Vercel OIDC ให้ใช้ `GOOGLE_OIDC_*`

ถ้า GSC/GA4 ใช้ GCP project/service account เดียวกับ Vertex/Gemini ให้ใช้ `GCP_*` ชุดเดียว:

```env
GCP_PROJECT_ID=""
GCP_PROJECT_NUMBER=""
GCP_SERVICE_ACCOUNT_EMAIL=""
GCP_WORKLOAD_IDENTITY_POOL_ID=""
GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID=""
GCP_LOCATION="us-central1"
```

ถ้า GSC/GA4 อยู่คนละ GCP project หรือใช้คนละ service account ให้เพิ่ม `GOOGLE_OIDC_*` สำหรับ GSC/GA4 โดยเฉพาะ:

```env
GOOGLE_OIDC_PROJECT_ID=""
GOOGLE_OIDC_PROJECT_NUMBER=""
GOOGLE_OIDC_SERVICE_ACCOUNT_EMAIL=""
GOOGLE_OIDC_WORKLOAD_IDENTITY_POOL_ID=""
GOOGLE_OIDC_WORKLOAD_IDENTITY_POOL_PROVIDER_ID=""
```

ลำดับการเลือก auth สำหรับ GSC/GA4:
1. `GOOGLE_SERVICE_ACCOUNT_JSON`
2. `GOOGLE_SERVICE_ACCOUNT_PATH` สำหรับ local dev
3. `GOOGLE_OIDC_*`
4. `GCP_*`

สำหรับ GSC/GA4 ให้แชร์สิทธิ์ property ให้ service account ที่ใช้งานอยู่

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
- [ ] `GOOGLE_SERVICE_ACCOUNT_JSON` ใส่แล้ว หรือ GSC/GA4 OIDC env ครบ
- [ ] `ANTHROPIC_API_KEY` ใส่แล้ว
- [ ] ทดสอบ login ได้
- [ ] ทดสอบ Report page ดึง GSC/GA4 ได้

---

### ปัญหาที่พบบ่อย

| อาการ | วิธีแก้ |
|-------|---------|
| Build fail: prisma client not found | ตรวจ Build Command ว่ามี `prisma generate &&` |
| GSC/GA4 ไม่ทำงาน | ตรวจ `GOOGLE_SERVICE_ACCOUNT_JSON` หรือ OIDC env และแชร์ GSC/GA4 property ให้ service account ที่ใช้งาน |
| NextAuth error | `NEXTAUTH_URL` ต้องตรงกับ URL จริง รวมถึง `https://` |
| DB connection timeout | ใช้ Supabase transaction pooler ใน `DATABASE_URL` |
| `prepared statement "s0" already exists` | เพิ่ม `pgbouncer=true&connection_limit=1` ใน `DATABASE_URL` |
