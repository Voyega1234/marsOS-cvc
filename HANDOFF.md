# Mars OS — JAWIS SEO Pipeline Console
## Handoff Document (สำหรับย้ายคอม / เปิดใช้คอมใหม่)

---

## 1. ลิ้งค์ทดสอบ (Local)

```
http://localhost:3000 (ไม่ต้อง login)
```

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@example.com | admin123 |
| SEO Manager | manager@example.com | manager123 |
| SEO Planner | planner@example.com | planner123 |
| Writer | writer@example.com | writer123 |
| Reviewer | reviewer@example.com | reviewer123 |
| Publisher | publisher@example.com | publisher123 |

---

## 2. Setup บนคอมใหม่ (ทำครั้งเดียว ~5 นาที)

### Prerequisites
- Node.js 18+ (`node -v`)
- npm (`npm -v`)

### ขั้นตอน

```bash
# 1. แตกไฟล์ zip
unzip mars-os-source.zip -d mars-os
cd mars-os/plans-seo-pipeline

# 2. สร้าง .env.local
cat > .env.local << 'EOF'
DATABASE_URL="file:./dev.db"
NEXTAUTH_SECRET="REPLACE_WITH_NEW_SECRET"
NEXTAUTH_URL="http://localhost:3000"
WP_ENCRYPTION_KEY="REPLACE_WITH_NEW_KEY"
EOF

# Generate secrets:
openssl rand -base64 32   # → ใส่ใน NEXTAUTH_SECRET
openssl rand -hex 32      # → ใส่ใน WP_ENCRYPTION_KEY

# 3. Install + setup DB
npm install
DATABASE_URL="file:./dev.db" npx prisma db push --force-reset
npm run db:seed

# 4. Start
npm run dev
# เปิด http://localhost:3000 (ไม่ต้อง login)
```

---

## 3. สถานะโปรเจค — อะไร Done / อะไรยังค้างอยู่

### ✅ ระบบหลักที่ทำงานได้แล้ว (Full DB + API)

| Feature | Path | หมายเหตุ |
|---------|------|----------|
| Auth / Login | `/login` | NextAuth Credentials, 6 roles |
| Dashboard | `/dashboard` | stats จาก DB จริง |
| Projects CRUD | `/projects` | สร้าง/แก้ไข/ลบ project |
| Articles Pipeline | `/articles`, `/projects/[id]/articles` | 16 stages ครบ |
| Article Detail | `/articles/[id]` | view + stage transitions |
| Keyword Research | `/projects/[id]/keywords` | DB + AI mock/real |
| Content Map | `/projects/[id]/content-map` | AI generated map |
| Prompts Library | `/prompts` | CRUD + versioning + test |
| Templates | `/templates` | brand templates |
| Review Queue | `/review` | reviewer workflow |
| Batch AI Jobs | `/batch` | batch article generation |
| AI Jobs Monitor | `/ai-jobs` | status tracking |
| AI Connect | `/ai-connect` | กรอก API keys (Claude/OpenAI/Gemini) |
| Data Sources | `/data-sources` | upload + tag files |
| WordPress Push | `/articles/[id]` → publish | WordPressPublisherService |
| Backlink Assistant | `/backlink-assistant` | DB + UI ครบ |
| Calendar | `/calendar` | article schedule view |
| Activity Logs | `/activity-logs` | audit trail |
| User Management | `/users` | admin only |
| Settings | `/settings` | org + WP config |
| Website Connect | `/website-connect` | site connection settings |
| Notifications | `/notifications` | in-app notifications |

### 🟡 ทำงานบางส่วน — ใช้ Mock Data (ต้องต่อ DB จริง)

| Feature | Path | สิ่งที่ต้องทำ |
|---------|------|--------------|
| Morning Brief | `/morning-brief` | ใช้ `MOCK_MORNING_BRIEF` hardcoded — ต้องสร้าง API route ที่ query articles/tasks จาก DB แล้ว generate brief |
| Todos / My Tasks | `/todos`, `/my-tasks` | ใช้ `MOCK_TASKS` — ต้องสร้าง `Task` model ใน Prisma + API CRUD |
| Content Studio | `/content-studio` | ใช้ mock content — ต้องต่อกับ article writing flow จริง |
| AI SEO Report | `/ai-seo-report` | ใช้ mock rank data — ต้องต่อ Google Search Console API |
| Rank Tracker | `/api/rank` | API route มีอยู่แต่ยังไม่มี UI page — ต้องสร้าง `/rank` page |

### 🔴 ยังไม่ได้ทำ / Stub เท่านั้น

| Feature | Path | สิ่งที่ต้องทำ |
|---------|------|--------------|
| Chat (Mars Chat) | `/chat` | UI มีแต่ไม่มี backend — ต้องต่อ streaming AI endpoint |
| Asana Webhook | `/api/webhooks/asana` | return "TODO" — ต้องทำ sync logic |
| Slack Webhook | `/api/webhooks/slack` | partial — ต้องทำ slash command handling |
| GSC Integration | `/data-sources` → GSC tab | UI มีแต่ OAuth flow ยังไม่ครบ |
| PDF/DOCX parsing | `/api/data-brain` | comment บอก "placeholder — real extraction requires pdfjs/mammoth" |

---

## 4. งานที่ต้องทำต่อ (Priority Order)

### Priority 1 — ต่อ AI จริง (ทำได้เลย 30 นาที)
1. เปิด `/ai-connect` → กรอก `ANTHROPIC_API_KEY`
2. หรือ เพิ่มใน `.env.local`:
   ```
   ANTHROPIC_API_KEY="sk-ant-api03-..."
   ```
3. ระบบจะ auto-switch จาก mock → Claude จริงทันที (ดู `src/services/ai/provider.ts`)

### Priority 2 — Todos / My Tasks (2-3 ชั่วโมง)
- สร้าง `Task` model ใน `prisma/schema.prisma`
- สร้าง API routes: `GET/POST /api/tasks`, `PATCH /api/tasks/[id]`
- แก้ `src/app/(app)/todos/page.tsx` และ `my-tasks/page.tsx` ให้ใช้ DB จริง
- ลบ `src/lib/mock-data/todos.ts`

### Priority 3 — Morning Brief จาก DB จริง (1-2 ชั่วโมง)
- สร้าง `GET /api/morning-brief` ที่ query:
  - articles ที่ต้อง review วันนี้
  - tasks ที่ overdue
  - AI jobs ที่ pending
- แก้ `src/app/(app)/morning-brief/page.tsx` ให้ fetch จาก API
- ลบ `src/lib/mock-data/morning-brief.ts`

### Priority 4 — Chat / Streaming (3-4 ชั่วโมง)
- สร้าง `POST /api/chat` ที่ return streaming response จาก Claude
- ใช้ Vercel AI SDK หรือ manual SSE
- ต่อกับ `MarsChatArea` component

### Priority 5 — Deploy ถาวร (30 นาที)
ดู section "Deploy to Vercel" ด้านล่าง

---

## 5. Deploy ถาวรบน Vercel + Neon (ฟรี)

### Step 1 — สร้าง PostgreSQL ฟรีที่ Neon
1. ไป https://console.neon.tech → Sign up
2. สร้าง project ชื่อ `plans-seo-pipeline`
3. Copy connection string: `postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require`

### Step 2 — ปรับ schema เป็น PostgreSQL
```bash
# แก้ prisma/schema.prisma บรรทัด provider:
# provider = "sqlite"  →  provider = "postgresql"
```

### Step 3 — Push ขึ้น GitHub
```bash
git init
git add .
git commit -m "initial"
git remote add origin https://github.com/YOUR_USERNAME/mars-os.git
git push -u origin main
```

### Step 4 — Deploy บน Vercel
1. https://vercel.com → New Project → Import GitHub repo
2. ใส่ Environment Variables:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | Neon connection string |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | `https://your-project.vercel.app` |
| `WP_ENCRYPTION_KEY` | `openssl rand -hex 32` |
| `ANTHROPIC_API_KEY` | Optional (AI ทำงาน mock mode ถ้าไม่ใส่) |

3. Deploy → รอ build เสร็จ

### Step 5 — Seed production DB
```bash
DATABASE_URL="postgresql://your-neon-url" npm run db:seed
```

---

## 6. โครงสร้างโปรเจค (สำคัญ)

```
src/
├── app/
│   ├── (app)/          # ทุก page หลัง login
│   ├── (auth)/         # login page
│   └── api/            # API routes
├── components/         # UI components (แยกตาม feature)
├── lib/
│   ├── auth.ts         # NextAuth config
│   ├── prisma.ts       # Prisma client singleton
│   └── mock-data/      # ← ไฟล์ที่ต้องลบหลัง wire DB จริง
├── services/
│   └── ai/
│       ├── provider.ts  # Claude/OpenAI/mock caller
│       ├── runner.ts    # AI job runner
│       └── services/    # per-feature AI services
└── types/
```

---

## 7. Tech Stack สรุป

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **UI**: Tailwind CSS + shadcn/ui
- **DB**: Prisma ORM + SQLite (local) / PostgreSQL (production)
- **Auth**: NextAuth v4 (Credentials)
- **AI**: Anthropic Claude SDK (mock fallback ถ้าไม่มี API key)
- **Port**: 3000

---

## 8. คำสั่งที่ใช้บ่อย

```bash
npm run dev          # Start dev server
npm run build        # Build production
npm run db:seed      # Seed demo data
npm run db:reset     # Reset DB + re-seed
npm run db:studio    # Open Prisma Studio (DB browser GUI)
npm run db:push      # Push schema changes
```
