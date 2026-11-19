/**
 * Brand Radar runner against the LOCAL database only, with a fake provider (no network).
 * Run: L='postgresql://postgres:localdev@127.0.0.1:15432/plans_seo_local?schema=plans_seo_pipeline' \
 *      DATABASE_URL="$L" DIRECT_URL="$L" npx tsx src/lib/brand-radar/runner.itest.ts
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import type { ProviderCaller, ProviderCallResult } from './providers'
import type { InsightAnalyzer } from './sentiment'

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
  // The scan needs "connected" credentials to consider a provider usable; the caller is fake so nothing is sent.
  // ChatGPT and Gemini are DataForSEO scraper calls, so the DataForSEO pair must look connected for the whole test.
  // Fixed placeholder values, set before anything can load an env file: a real credential is never picked up here.
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'itest-not-a-real-key'
  process.env.DATAFORSEO_LOGIN = 'itest-not-real'
  process.env.DATAFORSEO_PASSWORD = 'itest-not-real'

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

    // estimate: no cost history yet -> the DataForSEO list price per ask (ChatGPT and Gemini are scraper calls)
    let est = await r.estimateRun(ctx)
    assert.equal(est.prompts, 2)
    assert.deepEqual(est.providers, ['openai', 'gemini'])
    assert.equal(est.tasks, 4)
    assert.equal(est.estimatedCostUsd, 0.016)
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
    ok('repeat samples per prompt (LLM x3, Google AI Mode x1)')

    // insight: search queries + sentiment + Search Query Groups (own runs, fake analyzer: nothing leaves the machine)
    await prisma.brandRadarRun.updateMany({ where: { projectId, status: 'RUNNING' }, data: { status: 'CANCELLED' } })
    await prisma.brandRadarProfile.update({ where: { id: profile.id }, data: { monthlyBudgetUsd: null } })
    const withQueries: ProviderCaller = async (key, input) => ({
      ...okResult(key, input.prompt),
      searchQueries: [`${input.prompt} reviews`, `  ${input.prompt.toUpperCase()}   REVIEWS `, 'acme pricing'],
    })
    const seen = { sentiment: 0, group: 0, grouped: [] as string[] }
    const fakeAnalyzer: InsightAnalyzer = {
      async sentiment(input) {
        seen.sentiment++
        const brand = input.targets.find((t) => t.entityType === 'brand')
        return {
          model: 'fake/analyzer', costUsd: 0.002, tokens: 5,
          sentiment: {
            factors: ['price'],
            entities: brand
              ? [{ entityType: 'brand', key: 'brand', name: brand.name, tone: 'positive', positioning: ['trusted'], factors: [{ code: 'price', polarity: 'positive' }], summary: 'Recommended first', descriptors: ['top pick'] }]
              : [],
          },
        }
      },
      async groupQueries(input) {
        seen.group++
        seen.grouped.push(...input.queries)
        return { model: 'fake/analyzer', costUsd: 0.001, tokens: 3, groups: input.queries.map((q) => ({ query: q, groupName: q.includes('pricing') ? 'Pricing' : 'Reviews' })) }
      },
    }

    // without an analyzer: the queries are stored, no analysis call is made
    const s9 = await r.startRun(ctx, 'manual')
    assert.equal(s9.kind, 'started')
    const run9 = (s9 as { run: { id: string } }).run
    await drain(ctx, run9.id, withQueries)
    const plain = await prisma.brandRadarInsight.findMany({ where: { runId: run9.id } })
    assert.equal(plain.length, 4)
    assert.ok(plain.every((i) => i.sentiment === null && i.sentimentModel === ''))
    assert.ok(plain.every((i) => (JSON.parse(i.searchQueries) as string[]).includes('acme pricing')))
    assert.ok(plain.every((i) => (JSON.parse(i.searchQueries) as string[]).length === 2), 'the same query in another spelling is stored once')
    assert.equal(seen.sentiment + seen.group, 0)
    assert.equal(await prisma.brandRadarQueryGroup.count({ where: { projectId } }), 0)
    const d9 = await prisma.brandRadarRun.findUniqueOrThrow({ where: { id: run9.id } })
    assert.ok(Math.abs(d9.costUsd - 0.04) < 1e-9)
    ok('search queries stored without an analyzer (no analysis call)')

    // with an analyzer: sentiment per answer, one grouping call, cost carried by the answers
    const s10 = await r.startRun(ctx, 'manual')
    assert.equal(s10.kind, 'started')
    const run10 = (s10 as { run: { id: string } }).run
    for (let i = 0; i < 40; i++) {
      const st = await r.stepRun({ orgId, userId, projectId }, run10.id, withQueries, new Date(), fakeAnalyzer)
      assert.ok(st)
      if (st!.done) break
    }
    const d10 = await prisma.brandRadarRun.findUniqueOrThrow({ where: { id: run10.id } })
    assert.equal(d10.status, 'COMPLETED')
    const analysed = await prisma.brandRadarInsight.findMany({ where: { runId: run10.id } })
    assert.equal(analysed.length, 4)
    assert.equal(seen.sentiment, 4)
    for (const i of analysed) {
      const sent = JSON.parse(i.sentiment || 'null') as { factors: string[]; entities: Array<{ key: string; tone: string }> }
      assert.deepEqual(sent.factors, ['price'])
      assert.equal(sent.entities[0].key, 'brand')
      assert.equal(sent.entities[0].tone, 'positive')
      assert.equal(i.sentimentModel, 'fake/analyzer')
    }
    // only providers that expose their real searches feed the groups (openai here, not gemini): 2 prompts + 1 shared query
    assert.equal(seen.group, 1)
    assert.equal(seen.grouped.length, 3)
    const groups = await prisma.brandRadarQueryGroup.findMany({ where: { projectId }, orderBy: { queryKey: 'asc' } })
    assert.deepEqual(groups.map((g) => g.queryKey), ['acme pricing', 'best acme alternative reviews', 'top vendors reviews'])
    assert.deepEqual(groups.map((g) => g.groupName), ['Pricing', 'Reviews', 'Reviews'])
    assert.ok(groups.every((g) => g.organizationId === orgId))
    // 4 answers x 0.01 + 4 sentiment calls x 0.002 + 1 grouping call x 0.001
    const sum10 = await prisma.brandRadarResponse.aggregate({ where: { runId: run10.id }, _sum: { costUsd: true } })
    assert.ok(Math.abs((sum10._sum.costUsd || 0) - 0.049) < 1e-9)
    assert.ok(Math.abs(d10.costUsd - 0.049) < 1e-9)
    assert.equal(await prisma.aIJob.count({ where: { organizationId: orgId, jobType: 'BRAND_RADAR_SENTIMENT', status: 'SUCCESS' } }), 4)
    assert.equal(await prisma.aIJob.count({ where: { organizationId: orgId, jobType: 'BRAND_RADAR_QUERY_GROUPS', status: 'SUCCESS' } }), 1)
    ok('sentiment + Search Query Groups stored, cost added to the answers')

    // a second scan with the same queries makes no new grouping call; a failing analyzer never fails the answer
    const s11 = await r.startRun(ctx, 'manual')
    assert.equal(s11.kind, 'started')
    const run11 = (s11 as { run: { id: string } }).run
    const broken: InsightAnalyzer = {
      async sentiment() { throw new Error('analysis down') },
      async groupQueries(input) { return fakeAnalyzer.groupQueries(input) },
    }
    for (let i = 0; i < 40; i++) {
      const st = await r.stepRun({ orgId, userId, projectId }, run11.id, withQueries, new Date(), broken)
      assert.ok(st)
      if (st!.done) break
    }
    const d11 = await prisma.brandRadarRun.findUniqueOrThrow({ where: { id: run11.id } })
    assert.equal(d11.status, 'COMPLETED')
    assert.equal(d11.doneTasks, 4)
    assert.equal(seen.group, 1)
    assert.equal(await prisma.brandRadarQueryGroup.count({ where: { projectId } }), 3)
    assert.equal(await prisma.brandRadarInsight.count({ where: { runId: run11.id, sentiment: null } }), 4)
    assert.equal(await prisma.aIJob.count({ where: { organizationId: orgId, jobType: 'BRAND_RADAR_SENTIMENT', status: 'FAILED' } }), 4)
    ok('known queries are not regrouped; analysis failure leaves the answer DONE')

    // found but not cited: classified like citations, a page that is also cited is not stored as found
    const withFound: ProviderCaller = async (key, input) => ({
      ...okResult(key, input.prompt),
      foundSources: [
        { url: 'https://acme.test/found', title: 'Our page' },
        { url: 'https://elsewhere.test/found', title: 'Elsewhere' },
        { url: 'https://news.test/a', title: 'News' }, // also cited -> must not be stored
        { url: 'javascript:alert(1)', title: 'bad' },
      ],
    })
    const s12 = await r.startRun(ctx, 'manual')
    assert.equal(s12.kind, 'started')
    const run12 = (s12 as { run: { id: string } }).run
    await drain(ctx, run12.id, withFound)
    const foundRows = await prisma.brandRadarInsight.findMany({ where: { runId: run12.id } })
    assert.ok(foundRows.length > 0)
    for (const i of foundRows) {
      const f = JSON.parse(i.foundSources) as Array<{ url: string; ownerType: string }>
      assert.deepEqual(f.map((x) => [x.url, x.ownerType]), [['https://acme.test/found', 'own'], ['https://elsewhere.test/found', 'external']])
    }
    ok('found-but-not-cited pages stored with owner type; cited and non-http pages left out')

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

    // chosen weekdays: Tuesday noon in Bangkok -> a scan starts, next one is Wednesday 00:00 Bangkok
    await prisma.brandRadarRun.updateMany({ where: { projectId, status: 'RUNNING' }, data: { status: 'CANCELLED' } })
    await prisma.brandRadarProfile.update({ where: { id: profile.id }, data: { schedule: 'days:1,3', nextRunAt: null } })
    const tuesday = new Date('2026-11-17T05:00:00Z')
    const w1 = await r.runDue(ctx, tuesday)
    assert.equal(w1.reason, 'Scheduled scan started')
    assert.equal((await prisma.brandRadarProfile.findUniqueOrThrow({ where: { id: profile.id } })).nextRunAt?.toISOString(), '2026-11-17T17:00:00.000Z')
    assert.equal((await r.runDue(ctx, tuesday)).reason, 'Not due yet')
    ok('weekday schedule: starts when due, next run on the next chosen weekday')

    // every 3 days: counted from the Bangkok day the scan ran
    await prisma.brandRadarRun.updateMany({ where: { projectId, status: 'RUNNING' }, data: { status: 'CANCELLED' } })
    await prisma.brandRadarProfile.update({ where: { id: profile.id }, data: { schedule: 'every:3', nextRunAt: null } })
    const friday = new Date('2026-11-20T05:00:00Z')
    const e1 = await r.runDue(ctx, friday)
    assert.equal(e1.reason, 'Scheduled scan started')
    assert.equal((await prisma.brandRadarProfile.findUniqueOrThrow({ where: { id: profile.id } })).nextRunAt?.toISOString(), '2026-11-22T17:00:00.000Z')
    assert.equal((await r.runDue(ctx, new Date('2026-11-22T16:59:00Z'))).reason, 'Not due yet')
    ok('interval schedule: next run N days after the scan day')

    // a stored value this version cannot read never starts a scan
    await prisma.brandRadarRun.updateMany({ where: { projectId, status: 'RUNNING' }, data: { status: 'CANCELLED' } })
    await prisma.brandRadarProfile.update({ where: { id: profile.id }, data: { schedule: 'every:0', nextRunAt: null } })
    assert.equal((await r.runDue(ctx)).reason, 'Schedule is manual')
    ok('unreadable schedule counts as manual')

    void p1; void p2
    console.log(`runner.itest.ts: ${n} checks passed`)
  } finally {
    const where = { organizationId: orgId }
    await prisma.brandRadarInsight.deleteMany({ where })
    await prisma.brandRadarQueryGroup.deleteMany({ where })
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
