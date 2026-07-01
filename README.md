# Plans SEO Pipeline

An AI-powered SEO article production platform for content teams. Manage projects, keywords, and articles through a 16-stage pipeline from research to publication.

## Features

- **16-stage article pipeline**: NEW → KEYWORD_RESEARCHING → KEYWORD_DONE → BRIEFING → BRIEF_DONE → OUTLINING → OUTLINE_DONE → OUTLINE_APPROVED → WRITING → DRAFT_DONE → REVIEWING → APPROVED → FORMATTING → FORMATTED → PUBLISHING → POSTED
- **6 user roles**: Admin, SEO Manager, SEO Planner, Writer, Reviewer, Publisher
- **Two UI modes**: Simple Team Workspace (top nav) and Professional Admin Console (sidebar)
- **AI service architecture**: Mock responses ready for Claude/OpenAI integration
- **Prompt Library**: CRUD management for AI prompts with variable helpers
- **Brand Templates**: Pre-built templates with Thai SEO sample data

## Tech Stack

- Next.js 14 (App Router)
- TypeScript
- Tailwind CSS + shadcn/ui
- Prisma ORM + Supabase Postgres
- NextAuth v4 (Credentials)

## Local Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Create `.env.local` in the project root:

```env
DATABASE_URL="postgresql://your-supabase-pooler-url"
DIRECT_URL="postgresql://your-supabase-direct-url"
NEXTAUTH_SECRET="your-secret-here"
NEXTAUTH_URL="http://localhost:3000"
```

Generate a secret with: `openssl rand -base64 32`

### 3. Set up the database

```bash
DATABASE_URL="postgresql://your-supabase-pooler-url" DIRECT_URL="postgresql://your-supabase-direct-url" npm run db:push
DATABASE_URL="postgresql://your-supabase-pooler-url" DIRECT_URL="postgresql://your-supabase-direct-url" npm run db:seed
```

> **Note**: Prisma CLI reads `DATABASE_URL` from `.env`, not `.env.local`. If you get a missing database URL error when running Prisma commands directly, prefix with the variable:
> ```bash
> DATABASE_URL="postgresql://your-supabase-pooler-url" DIRECT_URL="postgresql://your-supabase-direct-url" npx prisma db push
> ```

### 4. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Test Accounts

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@example.com | admin123 |
| SEO Manager | manager@example.com | manager123 |
| SEO Planner | planner@example.com | planner123 |
| Writer | writer@example.com | writer123 |
| Reviewer | reviewer@example.com | reviewer123 |

## Database Commands

| Command | Description |
|---------|-------------|
| `npm run db:push` | Push schema changes to database |
| `npm run db:seed` | Seed demo data |
| `npm run db:reset` | Drop and re-seed database |
| `npm run db:studio` | Open Prisma Studio (DB browser) |
| `npm run db:generate` | Regenerate Prisma client |

## AI Integration

The app ships with mock AI responses. To connect real AI providers, edit `src/services/ai/provider.ts` and replace the mock logic with your Claude or OpenAI API calls. Prompt templates are managed in the **Prompts** section of the app.

## Supabase SQL

The app schema is in `prisma/schema.prisma`. Prefer `npm run db:push` for setup, or use `supabase/schema.sql` in Supabase SQL Editor if you need a manual SQL install.

## Project Structure

```
src/
├── app/
│   ├── (app)/          # Authenticated app pages
│   │   ├── articles/
│   │   ├── dashboard/
│   │   ├── projects/
│   │   ├── prompts/
│   │   ├── review/
│   │   ├── settings/
│   │   └── templates/
│   └── api/            # API routes
├── components/
│   ├── articles/
│   ├── layout/
│   ├── prompts/
│   ├── shared/
│   └── ui/
├── contexts/           # React contexts (UIMode)
├── lib/                # Auth, Prisma client
├── services/
│   └── ai/             # AI service layer + compiler
└── types/              # TypeScript type aliases
```

# marsOS-cvc
