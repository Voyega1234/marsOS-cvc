# Deploy to Vercel

โปรเจกต์นี้ใช้ PostgreSQL, NextAuth และ Vertex AI ผ่าน Vercel OIDC โดยไม่ต้องใช้ `GEMINI_API_KEY`

## 1. เตรียม PostgreSQL

สร้างฐานข้อมูล PostgreSQL (เช่น Neon) แล้วเก็บ connection string สองค่า:

- `DATABASE_URL`: pooled connection
- `DIRECT_URL`: direct connection สำหรับ Prisma schema operations

รัน schema และ seed ก่อน deploy:

```bash
DATABASE_URL="postgresql://..." DIRECT_URL="postgresql://..." npx prisma db push
DATABASE_URL="postgresql://..." DIRECT_URL="postgresql://..." npx tsx prisma/seed.ts
```

## 2. เปิด Vercel OIDC

ใน Vercel ไปที่ **Project > Settings > Security > Secure backend access with OIDC federation** แล้วเลือก **Team issuer mode**

จดค่า:

- Vercel team slug
- Vercel project name
- environment ที่อนุญาต: `production` และ/หรือ `preview`

## 3. ตั้ง Google Cloud Workload Identity Federation

1. เปิด API ต่อไปนี้ใน GCP project:
   - Vertex AI API
   - IAM Service Account Credentials API
   - Security Token Service API
2. ไปที่ **IAM & Admin > Workload Identity Federation** แล้วสร้าง pool เช่น ID `vercel`
3. เพิ่ม OIDC provider เช่น ID `vercel`
4. ตั้ง Issuer URL เป็น `https://oidc.vercel.com/TEAM_SLUG`
5. เลือก **Default audience** (รูปแบบ `https://iam.googleapis.com/projects/.../providers/...`)
6. ตั้ง attribute mapping: `google.subject` = `assertion.sub`
7. สร้าง service account สำหรับ Vercel และให้ role `Vertex AI User` (`roles/aiplatform.user`)
8. ให้ principal ของ deployment มี role `Workload Identity User` บน service account โดย subject มีรูปแบบ:

```text
owner:TEAM_SLUG:project:VERCEL_PROJECT_NAME:environment:production
```

ถ้าใช้ Preview ให้เพิ่ม principal อีกตัวที่ลงท้ายด้วย `environment:preview`

## 4. Environment Variables บน Vercel

ตั้งค่าจาก `.env.production.example` อย่างน้อยดังนี้:

| Variable | ใช้สำหรับ |
| --- | --- |
| `DATABASE_URL` | PostgreSQL pooled connection |
| `DIRECT_URL` | PostgreSQL direct connection |
| `NEXTAUTH_SECRET` | session signing secret |
| `NEXTAUTH_URL` | production URL |
| `ANTHROPIC_API_KEY` | article generation ที่ยังใช้ Claude |
| `GCP_PROJECT_ID` | Google Cloud project ID |
| `GCP_PROJECT_NUMBER` | Google Cloud numeric project number |
| `GCP_SERVICE_ACCOUNT_EMAIL` | service account ที่ OIDC impersonate |
| `GCP_WORKLOAD_IDENTITY_POOL_ID` | เช่น `vercel` |
| `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID` | เช่น `vercel` |
| `GCP_VERTEX_LOCATION` | ค่าเริ่มต้น `us-central1` |
| `VERTEX_TEXT_MODEL` | ค่าเริ่มต้น `gemini-2.5-flash` |
| `VERTEX_IMAGE_MODEL` | ค่าเริ่มต้น `gemini-3.1-flash-image-preview` |

อย่าตั้ง `GEMINI_API_KEY` หรือ `GOOGLE_AI_API_KEY` ใน Vercel อีก หลังย้ายแล้วให้ลบค่าทั้ง Production, Preview และ Development

`GOOGLE_SERVICE_ACCOUNT_JSON` ยังเป็นคนละส่วนกับ Vertex AI: โปรเจกต์เดิมใช้ค่านี้สำหรับ GSC/GA4 หากต้องใช้ report เหล่านั้นยังต้องตั้งค่าต่อไป

## 5. Vercel Build Settings

| Setting | Value |
| --- | --- |
| Framework Preset | Next.js |
| Build Command | `npm run build` |
| Output Directory | `.next` |
| Install Command | `npm install` |
| Node.js Version | 20.x |

`postinstall` จะรัน `prisma generate` ให้อัตโนมัติ

## 6. Local development ที่ใช้ OIDC

```bash
vercel link
vercel env pull .env.local
npm run dev
```

`vercel env pull` จะนำ OIDC token สำหรับ development มาไว้ใน `.env.local` ชั่วคราว ห้าม commit ไฟล์นี้

## 7. Checklist ก่อน Go Live

- [ ] `npm run build` ผ่าน
- [ ] PostgreSQL schema และ seed เสร็จแล้ว
- [ ] Vercel OIDC เปิดใช้งานและ issuer ตรงกับ GCP provider
- [ ] GCP principal subject ตรงกับ team, project และ environment จริงทุกตัวอักษร
- [ ] service account มี `roles/aiplatform.user`
- [ ] ตั้งค่า GCP OIDC variables ครบ 5 ค่า
- [ ] ลบ `GEMINI_API_KEY` และ `GOOGLE_AI_API_KEY` จากทุก Vercel environment
- [ ] `NEXTAUTH_URL` ตรงกับ production domain แล้ว redeploy
- [ ] ทดสอบ keyword research, cover image และ article image ใน deployment จริง

เอกสารอ้างอิง: [Vercel OIDC for GCP](https://vercel.com/docs/oidc/gcp), [Vercel OIDC reference](https://vercel.com/docs/oidc/reference)
