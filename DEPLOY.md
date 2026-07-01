# Deploy Guide — JAWIS SEO Pipeline Console

## Demo Accounts

| Email | Password | Role |
|---|---|---|
| admin@example.com | admin123 | Admin |
| manager@example.com | manager123 | SEO Manager |
| planner@example.com | planner123 | SEO Planner |
| writer@example.com | writer123 | Writer |
| reviewer@example.com | reviewer123 | Reviewer |
| publisher@example.com | publisher123 | Publisher |

---

## Option A — Quick Share with ngrok (5 minutes, no deployment)

Use this if you just want friends to try it right now. Your computer must stay on.

**1. Start the local app**
```bash
# In the project folder:
# First, set up the database (one-time)
npm install
# Set DATABASE_URL and DIRECT_URL in .env.local to your Supabase URLs (see Option B Step 1)
npx prisma db push
npm run db:seed

# Then start:
npm run dev
```

**2. Install ngrok & expose your app**
```bash
# Install ngrok: https://ngrok.com/download (or brew install ngrok)
ngrok http 3000
```

ngrok will give you a URL like `https://abc123.ngrok.io` — share that with friends.

---

## Option B — Deploy to Vercel + Supabase (permanent URL, free tier)

### Step 1 — Create a Supabase PostgreSQL database

1. Go to **https://supabase.com/dashboard** → Sign up or log in
2. Create a new project: name it `plans-seo-pipeline`
3. Go to **Project Settings → Database → Connection string**
4. Copy the **pooled** connection string for `DATABASE_URL`  
   Format: `postgresql://postgres.PROJECT_REF:pass@aws-0-region.pooler.supabase.com:6543/postgres?pgbouncer=true`
5. Copy the **direct** connection string for `DIRECT_URL`  
   Format: `postgresql://postgres:pass@db.PROJECT_REF.supabase.co:5432/postgres`
6. Update `.env.local`:
   ```
   DATABASE_URL="postgresql://your-supabase-pooler-url"
   DIRECT_URL="postgresql://your-supabase-direct-url"
   ```

### Step 2 — Push schema & seed demo data

```bash
DATABASE_URL="postgresql://your-supabase-pooler-url" DIRECT_URL="postgresql://your-supabase-direct-url" npx prisma db push
DATABASE_URL="postgresql://your-supabase-pooler-url" DIRECT_URL="postgresql://your-supabase-direct-url" npm run db:seed
```

You should see: `✅ Seed complete!`

If you prefer Supabase SQL Editor, this repo also includes `supabase/schema.sql`, generated from `prisma/schema.prisma`. Use Prisma `db push` when possible because it keeps the database in sync with the app schema.

### Step 3 — Push to GitHub

```bash
# Create a new repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/plans-seo-pipeline.git
git push -u origin main
```

### Step 4 — Deploy to Vercel

1. Go to **https://vercel.com** → New Project → Import your GitHub repo
2. Vercel auto-detects Next.js — no framework changes needed
3. Click **"Environment Variables"** and add:

| Key | Value |
|---|---|
| `DATABASE_URL` | Your Supabase pooled connection string |
| `DIRECT_URL` | Your Supabase direct connection string |
| `NEXTAUTH_SECRET` | Run `openssl rand -base64 32` to generate |
| `NEXTAUTH_URL` | Your Vercel URL e.g. `https://plans-seo.vercel.app` |
| `WP_ENCRYPTION_KEY` | Run `openssl rand -hex 32` to generate |
| `ANTHROPIC_API_KEY` | Optional — AI features work in mock mode without it |
| `OPENAI_API_KEY` | Optional |
| `GCP_PROJECT_ID` | Google Cloud project ID for Vertex AI |
| `GCP_PROJECT_NUMBER` | Google Cloud project number |
| `GCP_SERVICE_ACCOUNT_EMAIL` | Service account Vercel will impersonate |
| `GCP_WORKLOAD_IDENTITY_POOL_ID` | Workload Identity Pool ID |
| `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID` | Workload Identity Provider ID |
| `GCP_LOCATION` | Vertex region, e.g. `us-central1` |
| `GEMINI_MODEL` | Text model, e.g. `gemini-2.5-flash` |
| `VERTEX_GEMINI_IMAGE_MODEL` | Image model, e.g. `gemini-2.5-flash-image` |

4. Click **Deploy** — this repo's `vercel.json` runs `npm run vercel-build`, which regenerates Prisma Client and builds Next.js with a larger Node heap.

### Step 5 — Seed the production database

After the first deploy, run the seed from your local machine (pointing at the production DB):

```bash
# Temporarily set DATABASE_URL and DIRECT_URL to your Supabase production URLs:
DATABASE_URL="postgresql://your-supabase-pooler-url" DIRECT_URL="postgresql://your-supabase-direct-url" npm run db:seed
```

Or pull Vercel env vars locally then seed:
```bash
npx vercel env pull .env.vercel.local
# Then copy DATABASE_URL and DIRECT_URL from .env.vercel.local into .env.local and run:
npm run db:seed
```

### Step 6 — Share the URL

Send your friends: `https://your-project.vercel.app`

Login with any of the demo accounts above.

---

## Generating a NEXTAUTH_SECRET

```bash
openssl rand -base64 32
```

## Generating a WP_ENCRYPTION_KEY

```bash
openssl rand -hex 32
```

---

## Troubleshooting

**`PrismaClientInitializationError`** — DATABASE_URL is not set or wrong format  
→ Check that `DATABASE_URL` is the Supabase pooled URL and `DIRECT_URL` is the direct URL.

**`next build` fails on Vercel** — Environment variables not set  
→ Check all required env vars are in Vercel project settings

**Login fails after deploy** — NEXTAUTH_URL mismatch  
→ Set `NEXTAUTH_URL` to your exact Vercel URL (no trailing slash)

**Seed data not showing** — Need to run db:seed against production DB  
→ See Step 5 above
