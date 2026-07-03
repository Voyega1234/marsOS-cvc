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
# Set DATABASE_URL in .env.local to your Neon URL (see Option B Step 1)
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

## Option B — Deploy to Vercel + Neon (permanent URL, free tier)

### Step 1 — Create a Neon PostgreSQL database (FREE)

1. Go to **https://console.neon.tech** → Sign up (free)
2. Create a new project: name it `plans-seo-pipeline`
3. Click **"Connection string"** → Copy the URL  
   Format: `postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require`
4. Update `.env.local`:
   ```
   DATABASE_URL="postgresql://your-neon-url-here"
   ```

### Step 2 — Push schema & seed demo data

```bash
npx prisma db push
npm run db:seed
```

You should see: `✅ Seed complete!`

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
| `DATABASE_URL` | Your Neon connection string |
| `NEXTAUTH_SECRET` | Run `openssl rand -base64 32` to generate |
| `NEXTAUTH_URL` | Your Vercel URL e.g. `https://plans-seo.vercel.app` |
| `WP_ENCRYPTION_KEY` | Run `openssl rand -hex 32` to generate |
| `ANTHROPIC_API_KEY` | Optional — AI features work in mock mode without it |
| `OPENAI_API_KEY` | Optional |

4. Click **Deploy** — Vercel runs `npm install` → `prisma generate` → `next build` automatically

### Step 5 — Seed the production database

After the first deploy, run the seed from your local machine (pointing at the production DB):

```bash
# Temporarily set DATABASE_URL to your Neon production URL:
DATABASE_URL="postgresql://your-neon-url" npm run db:seed
```

Or pull Vercel env vars locally then seed:
```bash
npx vercel env pull .env.vercel.local
# Then copy DATABASE_URL from .env.vercel.local into .env.local and run:
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
→ Check the Neon URL includes `?sslmode=require` at the end

**`next build` fails on Vercel** — Environment variables not set  
→ Check all required env vars are in Vercel project settings

**Login fails after deploy** — NEXTAUTH_URL mismatch  
→ Set `NEXTAUTH_URL` to your exact Vercel URL (no trailing slash)

**Seed data not showing** — Need to run db:seed against production DB  
→ See Step 5 above
