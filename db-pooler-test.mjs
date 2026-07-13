// Smoke-test the POOLED connection exactly as Vercel runtime would use it
import { PrismaClient } from '@prisma/client'

const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } })
try {
  const t0 = Date.now()
  const users = await p.user.count()
  const projects = await p.project.count()
  const articles = await p.article.findMany({ select: { title: true, status: true }, take: 3 })
  // The exact query shape that dashboard uses (include user on activityLog)
  const act = await p.activityLog.findMany({ include: { user: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 5 })
  console.log(`✓ pooled OK (${Date.now() - t0}ms) — users=${users} projects=${projects}`)
  console.log('✓ articles:', JSON.stringify(articles))
  console.log(`✓ activityLog include user: ${act.length} rows, sample user=${act[0]?.user?.name ?? '(none)'}`)
} catch (e) {
  console.error('❌ POOLED CONNECTION FAILED:', e.message.split('\n').slice(0, 4).join(' | '))
} finally { await p.$disconnect() }
