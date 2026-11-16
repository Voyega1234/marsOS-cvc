/**
 * Brand Radar runner against the LOCAL database only, with a fake provider (no network).
 * Run: L='postgresql://postgres:localdev@127.0.0.1:15432/plans_seo_local?schema=plans_seo_pipeline' \
 *      DATABASE_URL="$L" DIRECT_URL="$L" npx tsx src/lib/brand-radar/runner.itest.ts
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import type { ProviderCaller, ProviderCallResult } from './providers'

// The post-run opportunity refresh loads server.ts, which pulls in auth (react.cache, missing under tsx)
const react = createRequire(`${process.cwd()}/`)('react') as { cache?: unknown }
if (typeof react.cache !== 'function') react.cache = <T,>(fn: T): T => fn

let n = 0
function ok(name: string) { n++; console.log('ok -', name) }

async function main() {
  if (!(process.env.DATABASE_URL || '').includes('127.0.0.1') || !(process.env.DIRECT_URL || '').includes('127.0.0.1')) {
    console.error('Refused: DATABASE_URL and DIRECT_URL must both point at 127.0.0.1 (local database)')
    process.exit(1)
  }
  // The scan needs "connected" credentials to consider OpenRouter providers usable; the caller is fake so nothing is sent.
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'itest-not-a-real-key'
  delete process.env.DATAFORSEO_LOGIN
  delete process.env.DATAFORSEO_PASSWORD

  const { prisma } = await import('@/lib/prisma')
  const r = await import('./runner')

  const stamp = Date.now()
  const orgId = `itest-br-org-${stamp}`
  const otherOrg = `itest-br-org2-${stamp}`
  const userId = `itest-br-user-${stamp}`
  const projectId = `itest-br-proj-${stamp}`
  const ctx: import('./runner').RunnerCtx = { orgId, userId, project: { id: projectId, name: 'Acme', clientName: 'Acme Co' } }
  const foreign: import('./runner').RunnerCtx = { orgId: otherOrg, userId, project: { id: projectId } }
  const ids = { orgId, userId, projectId }

  const calls: Array<{ key: string; prompt: string }> = []
  let mode: 'ok' | 'flaky' | 'fail' = 'ok'
  const failCount = new Map<string, number>()
  const okResult = (key: string, prompt: string): ProviderCallResult => ({
    status: 'DONE',
    text: `For "${prompt}" I recommend Acme Co. Rival One is also fine. See https://acme.test/page and https://rival.test/x and https://other.test/y`,
    citations: [{ url: 'https://news.test/a', title: 'News' }],
    costUsd: 0.01, inputTokens: 10, outputTokens: 20, model: `fake/${key}`,
  })
  const fake: ProviderCaller = async (key, input) => {
    calls.push({ key, prompt: input.prompt })
    if (mode === 'fail') throw Object.assign(new Error('boom'), { costUsd: 0.001 })
    if (mode === 'flaky') {
      const k = key + input.prompt
      const c = (failCount.get(k) || 0) + 1
      failCount.set(k, c)
      if (c <= 2) throw new Error('transient')
    }
    return okResult(key, input.prompt)
  }

  async function drain(c: typeof ctx, runId: string, caller: ProviderCaller): Promise<void> {
    for (let i = 0; i < 40; i++) {
      const s = await r.stepRun({ orgId: c.orgId, userId, projectId }, runId, caller)
      assert.ok(s)
      if (s!.done) return
    }
    throw new Error('run did not finish')
  }

  try {
    await prisma.organization.create({ data: { id: orgId, name: 'itest br', slug: orgId } })
    await prisma.organization.create({ data: { id: otherOrg, name: 'itest br 2', slug: otherOrg } })
    await prisma.user.create({ data: { id: userId, email: `${userId}@itest.local`, name: 'Tester', organizationId: orgId } })
    await prisma.project.create({
      data: { id: projectId, organizationId: orgId, name: 'Acme', website: 'https://acme.test', businessType: 'x', targetAudience: 'y', createdById: userId, clientName: 'Acme Co' },
    })
    const profile = await prisma.brandRadarProfile.create({
      data: {
        organizationId: orgId, projectId, brandName: 'Acme Co', aliases: '["Acme"]', ownedDomains: '["acme.test"]',
        providers: '["openai","gemini"]', schedule: 'weekly', maxPromptsPerRun: 10, samplesPerPrompt: 1, createdById: userId,
      },
    })
    const comp = await prisma.brandRadarCompetitor.create({
      data: { organizationId: orgId, projectId, name: 'Rival One', nameKey: 'rival one', domains: '["rival.test"]' },
    })
    const p1 = await prisma.brandRadarPrompt.create({ data: { organizationId: orgId, projectId, text: 'best acme alternative', textKey: 'best acme alternative', status: 'ACTIVE', priority: 'low' } })
    const p2 = await prisma.brandRadarPrompt.create({ data: { organizationId: orgId, projectId, text: 'top vendors', textKey: 'top vendors', status: 'ACTIVE', priority: 'high' } })
    await prisma.brandRadarPrompt.create({ data: { organizationId: orgId, projectId, text: 'candidate only', textKey: 'candidate only', status: 'CANDIDATE' } })

    // estimate: no cost history yet -> null total (no google_ai_mode here)
    let est = await r.estimateRun(ctx)
    assert.equal(est.prompts, 2)
    assert.deepEqual(est.providers, ['openai', 'gemini'])
    assert.equal(est.tasks, 4)
    assert.equal(est.estimatedCostUsd, null)
    assert.equal(est.allowed, true)
    ok('estimate without history')

    // start
    const s1 = await r.startRun(ctx, 'manual')
    assert.equal(s1.kind, 'started')
    const run1 = (s1 as { run: { id: string } }).run
    const tasks = await prisma.brandRadarResponse.findMany({ where: { runId: run1.id } })
    assert.equal(tasks.length, 4)
    assert.ok(tasks.every((t) => t.status === 'PENDING'))
    ok('start creates tasks')

    const s2 = await r.startRun(ctx, 'manual')
    assert.equal(s2.kind, 'conflict')
    ok('second start conflicts')

    // a foreign organization cannot load or step the run
    assert.equal(await r.getRun(foreign, run1.id), null)
    assert.equal(await r.stepRun({ orgId: otherOrg, userId, projectId }, run1.id, fake), null)
    assert.equal(await r.cancelRun(foreign, run1.id), null)
    ok('other org cannot see the run')

    // steps -> COMPLETED
    await drain(ctx, run1.id, fake)
    const done1 = await prisma.brandRadarRun.findUniqueOrThrow({ where: { id: run1.id } })
    assert.equal(done1.status, 'COMPLETED')
    assert.equal(done1.doneTasks, 4)
    assert.ok(Math.abs(done1.costUsd - 0.04) < 1e-9)
    const mentions = await prisma.brandRadarMention.findMany({ where: { runId: run1.id } })
    assert.equal(mentions.filter((m) => m.entityType === 'brand').length, 4)
    assert.equal(mentions.filter((m) => m.entityKey === comp.id).length, 4)
    const cites = await prisma.brandRadarCitation.findMany({ where: { runId: run1.id } })
    assert.ok(cites.some((c) => c.ownerType === 'own'))
    assert.ok(cites.some((c) => c.ownerType === 'competitor' && c.competitorId === comp.id))
    assert.ok(cites.some((c) => c.ownerType === 'external'))
    const resp = await prisma.brandRadarResponse.findFirstOrThrow({ where: { runId: run1.id } })
    assert.equal(resp.brandMentioned, true)
    assert.equal(resp.ownedCited, true)
    assert.equal((await prisma.brandRadarProfile.findUniqueOrThrow({ where: { id: profile.id } })).lastRunAt !== null, true)
    ok('steps complete with mentions + citations')

    // estimate now has history -> numeric
    est = await r.estimateRun(ctx)
    assert.ok(est.estimatedCostUsd !== null && Math.abs(est.estimatedCostUsd - 0.04) < 1e-9)
    ok('estimate from history')

    // flaky: fails twice then succeeds
    mode = 'flaky'
    const s3 = await r.startRun(ctx, 'manual')
    assert.equal(s3.kind, 'started')
    const run3 = (s3 as { run: { id: string } }).run
    await drain(ctx, run3.id, fake)
    const d3 = await prisma.brandRadarRun.findUniqueOrThrow({ where: { id: run3.id } })
    assert.equal(d3.status, 'COMPLETED')
    const t3 = await prisma.brandRadarResponse.findMany({ where: { runId: run3.id } })
    assert.ok(t3.every((t) => t.attempts === 3 && t.status === 'DONE'))
    ok('retry succeeds on third attempt')

    // always failing -> FAILED tasks; mix with success for PARTIAL
    mode = 'fail'
    const s4 = await r.startRun(ctx, 'manual')
    const run4 = (s4 as { run: { id: string } }).run
    // let the gemini tasks succeed, openai always fail
    const mixed: ProviderCaller = async (key, input) => (key === 'openai' ? (() => { throw Object.assign(new Error('boom'), { costUsd: 0.001 }) })() : okResult(key, input.prompt))
    await drain(ctx, run4.id, mixed)
    const d4 = await prisma.brandRadarRun.findUniqueOrThrow({ where: { id: run4.id } })
    assert.equal(d4.status, 'PARTIAL')
    assert.equal(d4.doneTasks, 2)
    assert.equal(d4.failedTasks, 2)
    const failed = await prisma.brandRadarResponse.findMany({ where: { runId: run4.id, status: 'FAILED' } })
    assert.ok(failed.every((t) => t.attempts === 3 && t.error === 'boom' && (t.costUsd || 0) > 0.002))
    const detail = await r.getRunDetail(ctx, run4.id)
    assert.equal(detail!.failures.length, 2)
    ok('failing provider -> FAILED tasks + PARTIAL run')

    const s5 = await r.startRun(ctx, 'manual')
    const run5 = (s5 as { run: { id: string } }).run
    await drain(ctx, run5.id, async () => { throw new Error('boom') })
    assert.equal((await prisma.brandRadarRun.findUniqueOrThrow({ where: { id: run5.id } })).status, 'FAILED')
    ok('all failing -> FAILED run')

    // stale claim reclaim
    mode = 'ok'
    const s6 = await r.startRun(ctx, 'manual')
    const run6 = (s6 as { run: { id: string } }).run
    const [a, b] = await prisma.brandRadarResponse.findMany({ where: { runId: run6.id }, orderBy: { id: 'asc' }, take: 2 })
    const old = new Date(Date.now() - 10 * 60_000)
    await prisma.brandRadarResponse.update({ where: { id: a.id }, data: { status: 'RUNNING', attempts: 1, lockedAt: old } })
    await prisma.brandRadarResponse.update({ where: { id: b.id }, data: { status: 'RUNNING', attempts: 3, lockedAt: old } })
    await r.stepRun(ids, run6.id, async () => { throw new Error('noop') }, new Date()) // claims nothing useful; reclaim happens first
    const ra = await prisma.brandRadarResponse.findUniqueOrThrow({ where: { id: a.id } })
    const rb = await prisma.brandRadarResponse.findUniqueOrThrow({ where: { id: b.id } })
    assert.notEqual(ra.status, 'RUNNING')
    assert.equal(rb.status, 'FAILED')
    ok('stale claims reclaimed (attempts left -> retry, none left -> FAILED)')

    // cancel
    const cancelled = await r.cancelRun(ctx, run6.id)
    assert.equal(cancelled!.status, 'CANCELLED')
    const left = await prisma.brandRadarResponse.count({ where: { runId: run6.id, status: 'PENDING' } })
    assert.equal(left, 0)
    ok('cancel')

    // budget
    await prisma.brandRadarProfile.update({ where: { id: profile.id }, data: { monthlyBudgetUsd: 0.01 } })
    est = await r.estimateRun(ctx)
    assert.equal(est.allowed, false)
    assert.match(est.reason, /budget/i)
    const blocked = await r.startRun(ctx, 'manual')
    assert.equal(blocked.kind, 'blocked')
    ok('budget reached blocks start')

    // budget reached mid-run skips the rest
    await prisma.brandRadarProfile.update({ where: { id: profile.id }, data: { monthlyBudgetUsd: null } })
    const s7 = await r.startRun(ctx, 'manual')
    const run7 = (s7 as { run: { id: string } }).run
    await prisma.brandRadarProfile.update({ where: { id: profile.id }, data: { monthlyBudgetUsd: 0.0001 } })
    const st = await r.stepRun(ids, run7.id, fake)
    assert.equal(st!.done, true)
    assert.equal(st!.run.status, 'PARTIAL')
    assert.equal(st!.run.skippedTasks, 4)
    ok('mid-run budget skips remaining tasks')

    // usage
    await prisma.brandRadarProfile.update({ where: { id: profile.id }, data: { monthlyBudgetUsd: null } })
    const u = await r.usage(ctx)
    assert.ok(u.calls > 0 && u.monthSpendUsd > 0)
    assert.equal(u.history.length, 6)
    ok('usage')

    // repeat samples: LLM providers ask N times, observed SERP providers once; sample-major order
    process.env.DATAFORSEO_LOGIN = 'itest-not-real'
    process.env.DATAFORSEO_PASSWORD = 'itest-not-real'
    await prisma.brandRadarProfile.update({
      where: { id: profile.id }, data: { samplesPerPrompt: 3, providers: '["openai","gemini","google_ai_mode"]' },
    })
    est = await r.estimateRun(ctx)
    assert.equal(est.samplesPerPrompt, 3)
    assert.deepEqual(est.perProvider.map((p) => [p.provider, p.samples, p.tasks]), [['openai', 3, 6], ['gemini', 3, 6], ['google_ai_mode', 1, 2]])
    assert.equal(est.tasks, 14)
    const s8 = await r.startRun(ctx, 'manual')
    assert.equal(s8.kind, 'started')
    const run8 = (s8 as { run: { id: string; totalTasks: number; samplesPerPrompt: number } }).run
    assert.equal(run8.totalTasks, 14)
    assert.equal(run8.samplesPerPrompt, 3)
    const queue = await prisma.brandRadarResponse.findMany({ where: { runId: run8.id }, orderBy: [{ createdAt: 'asc' }, { sampleIndex: 'asc' }, { id: 'asc' }] })
    assert.equal(queue.length, 14)
    assert.ok(queue.slice(0, 6).every((t) => t.sampleIndex === 0), 'first ask of every prompt x provider comes first')
    assert.ok(queue.filter((t) => t.provider === 'google_ai_mode').every((t) => t.sampleIndex === 0))
    for (const pid of [p1.id, p2.id]) {
      assert.deepEqual(queue.filter((t) => t.promptId === pid && t.provider === 'openai').map((t) => t.sampleIndex).sort(), [0, 1, 2])
    }
    const callsBefore = calls.length
    await drain(ctx, run8.id, fake)
    const d8 = await prisma.brandRadarRun.findUniqueOrThrow({ where: { id: run8.id } })
    assert.equal(d8.status, 'COMPLETED')
    assert.equal(d8.doneTasks, 14)
    assert.equal(calls.length - callsBefore, 14)
    assert.equal((await r.getRunDTO(ctx, run8.id))!.samplesPerPrompt, 3)
    // each sample is its own response with its own mentions (no unique clash across samples)
    assert.equal(await prisma.brandRadarMention.count({ where: { runId: run8.id, entityType: 'brand' } }), 14)
    await prisma.brandRadarProfile.update({ where: { id: profile.id }, data: { samplesPerPrompt: 1, providers: '["openai","gemini"]' } })
    delete process.env.DATAFORSEO_LOGIN
    delete process.env.DATAFORSEO_PASSWORD
    ok('repeat samples per prompt (LLM x3, Google AI Mode x1)')

    // runDue idempotent
    const due = await prisma.brandRadarProfile.update({ where: { id: profile.id }, data: { nextRunAt: null, monthlyBudgetUsd: null } })
    assert.ok(due)
    await prisma.brandRadarRun.updateMany({ where: { projectId, status: 'RUNNING' }, data: { status: 'CANCELLED' } })
    const d1 = await r.runDue(ctx)
    const d2 = await r.runDue(ctx)
    assert.ok(d1.run)
    assert.equal(d1.reason, 'Scheduled scan started')
    assert.equal(d2.run, null) // not due any more
    assert.equal(await prisma.brandRadarRun.count({ where: { projectId, trigger: 'schedule' } }), 1)
    // even if the profile is forced due again, the period key blocks a second run
    await prisma.brandRadarRun.updateMany({ where: { projectId, status: 'RUNNING' }, data: { status: 'CANCELLED' } })
    await prisma.brandRadarProfile.update({ where: { id: profile.id }, data: { nextRunAt: null } })
    const d3b = await r.runDue(ctx)
    assert.equal(d3b.reason, 'This period was already scanned')
    assert.equal(await prisma.brandRadarRun.count({ where: { projectId, trigger: 'schedule' } }), 1)
    ok('runDue idempotent')

    void p1; void p2
    console.log(`runner.itest.ts: ${n} checks passed`)
  } finally {
    const where = { organizationId: orgId }
    await prisma.brandRadarCitation.deleteMany({ where })
    await prisma.brandRadarMention.deleteMany({ where })
    await prisma.brandRadarResponse.deleteMany({ where })
    await prisma.brandRadarRun.deleteMany({ where })
    await prisma.brandRadarPrompt.deleteMany({ where })
    await prisma.brandRadarCompetitor.deleteMany({ where })
    await prisma.brandRadarProfile.deleteMany({ where })
    await prisma.aIJob.deleteMany({ where })
    await prisma.project.deleteMany({ where: { id: projectId } })
    await prisma.user.deleteMany({ where: { id: userId } })
    await prisma.organization.deleteMany({ where: { id: { in: [orgId, otherOrg] } } })
    await prisma.$disconnect()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
