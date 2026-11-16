/**
 * Brand Radar data layer + tenant isolation against the LOCAL database only (no network).
 * Run: L='postgresql://postgres:localdev@127.0.0.1:15432/plans_seo_local?schema=plans_seo_pipeline' \
 *      DATABASE_URL="$L" DIRECT_URL="$L" npx tsx src/lib/brand-radar/access.itest.ts
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

let n = 0
function ok(name: string) { n++; console.log('ok -', name) }

async function main() {
  if (!(process.env.DATABASE_URL || '').includes('127.0.0.1') || !(process.env.DIRECT_URL || '').includes('127.0.0.1')) {
    console.error('Refused: DATABASE_URL and DIRECT_URL must both point at 127.0.0.1 (local database)')
    process.exit(1)
  }
  // server.ts pulls in auth, which needs react.cache (missing under tsx)
  const react = createRequire(`${process.cwd()}/`)('react') as { cache?: unknown }
  if (typeof react.cache !== 'function') react.cache = <T,>(fn: T): T => fn

  const { prisma } = await import('@/lib/prisma')
  const server = await import('./server')
  const q = await import('./queries')
  const { PBN_PREFS_MARK } = await import('@/lib/upload-article/pbn')

  const stamp = Date.now()
  const orgA = `itest-acc-orgA-${stamp}`
  const orgB = `itest-acc-orgB-${stamp}`
  const userA = `itest-acc-userA-${stamp}`
  const userB = `itest-acc-userB-${stamp}`
  const projA = `itest-acc-projA-${stamp}`
  const projB = `itest-acc-projB-${stamp}`
  const filters = { from: '', to: '', country: 'all', language: 'all', provider: 'all' } as import('./types').RadarFilters

  try {
    await prisma.organization.create({ data: { id: orgA, name: 'A', slug: `itest-a-${stamp}` } })
    await prisma.organization.create({ data: { id: orgB, name: 'B', slug: `itest-b-${stamp}` } })
    await prisma.user.create({ data: { id: userA, email: `a-${stamp}@itest.local`, name: 'A', organizationId: orgA } })
    await prisma.user.create({ data: { id: userB, email: `b-${stamp}@itest.local`, name: 'B', organizationId: orgB } })
    for (const [id, org, user] of [[projA, orgA, userA], [projB, orgB, userB]] as const) {
      await prisma.project.create({
        data: { id, organizationId: org, name: 'Acme', website: 'https://acme.com', businessType: 'x', targetAudience: 'y', createdById: user },
      })
    }

    const base = { organizationId: orgA, projectId: projA }
    await prisma.brandRadarProfile.create({
      data: { ...base, brandName: 'Acme', primaryDomain: 'acme.com', ownedDomains: JSON.stringify(['acme.com']), providers: JSON.stringify(['openai']) },
    })
    const rival = await prisma.brandRadarCompetitor.create({ data: { ...base, name: 'Rival', nameKey: 'rival', domains: JSON.stringify(['rival.com']) } })
    const p1 = await prisma.brandRadarPrompt.create({ data: { ...base, text: 'best acme alternative', textKey: 'best acme alternative', status: 'ACTIVE' } })
    const p2 = await prisma.brandRadarPrompt.create({ data: { ...base, text: 'no data prompt', textKey: 'no data prompt', status: 'ACTIVE' } })
    const run = await prisma.brandRadarRun.create({ data: { ...base, status: 'COMPLETED', providers: JSON.stringify(['openai']) } })

    const provs = ['openai', 'gemini', 'perplexity', 'claude']
    const mentioned = [true, true, false, false]
    const resp: string[] = []
    for (let i = 0; i < 4; i++) {
      const r = await prisma.brandRadarResponse.create({
        data: {
          ...base, runId: run.id, promptId: p1.id, provider: provs[i], status: 'DONE', promptText: p1.text,
          brandMentioned: mentioned[i], brandOccurrences: mentioned[i] ? 1 : 0, ownedCited: i === 0, collectedAt: new Date(),
        },
      })
      resp.push(r.id)
    }
    await prisma.brandRadarResponse.create({
      data: { ...base, runId: run.id, promptId: p1.id, provider: 'google_ai_mode', status: 'FAILED', error: 'x', brandMentioned: true },
    })
    for (let i = 0; i < 3; i++) {
      await prisma.brandRadarMention.create({
        data: { ...base, runId: run.id, responseId: resp[i], promptId: p1.id, provider: provs[i], entityType: 'competitor', entityKey: rival.id, competitorId: rival.id, entityName: 'Rival' },
      })
    }
    for (const i of [0, 1]) {
      await prisma.brandRadarMention.create({
        data: { ...base, runId: run.id, responseId: resp[i], promptId: p1.id, provider: provs[i], entityType: 'brand', entityKey: 'brand', entityName: 'Acme' },
      })
    }
    const cite = async (i: number, domain: string, ownerType: string, competitorId: string | null) =>
      prisma.brandRadarCitation.create({
        data: {
          ...base, runId: run.id, responseId: resp[i], promptId: p1.id, provider: provs[i], url: `https://${domain}/a`,
          normalizedUrl: `${domain}/a`, host: domain, domain, ownerType, competitorId,
        },
      })
    await cite(0, 'acme.com', 'own', null)
    await cite(1, 'vendor.com', 'external', null)
    await cite(2, 'vendor.com', 'external', null)
    await cite(1, 'rival.com', 'competitor', rival.id)
    await cite(3, 'pbn-site.com', 'external', null)

    await prisma.blmVendorSite.create({ data: { organizationId: orgA, domain: 'vendor.com', price: 1500, createdById: userA } })
    await prisma.uploadClient.create({
      data: {
        organizationId: orgA, name: 'PBN Backlinks', createdById: userA,
        pushPrefs: JSON.stringify({ kind: 'pbn', pbnSites: [{ id: 's1', name: 'P', siteUrl: 'https://pbn-site.com' }] }),
      },
    })
    assert.ok(JSON.stringify({ kind: 'pbn' }).includes(PBN_PREFS_MARK.replace(/^"|"$/g, '').split(':')[0]))

    const ctxA = await server.loadOwnedProject(orgA, projA)
    assert.ok(ctxA)
    const A = { orgId: orgA, userId: userA, role: 'ADMIN', project: ctxA! }
    const ctxB0 = await server.loadOwnedProject(orgB, projB)
    assert.ok(ctxB0)
    const B = { orgId: orgB, userId: userB, role: 'ADMIN', project: ctxB0! }
    // org B pointing at org A's project
    assert.equal(await server.loadOwnedProject(orgB, projA), null)
    const spoof = { orgId: orgB, userId: userB, role: 'ADMIN', project: ctxA! }
    ok('loadOwnedProject blocks a foreign project')

    // prompt detail
    const d = await q.buildPromptDetail(A, filters, p1.id, false)
    assert.ok(d)
    assert.equal(d!.responses, 4)
    const brand = d!.entities.find((e) => e.entityType === 'brand')!
    assert.equal(brand.mentions, 2)
    assert.equal(brand.mentionRate, 0.5)
    assert.equal(d!.entities.find((e) => e.key === rival.id)!.mentionRate, 0.75)
    const vend = d!.citedDomains.find((r) => r.domain === 'vendor.com')!
    assert.equal(vend.vendor?.price, 1500)
    assert.equal(vend.responses, 2)
    assert.equal(d!.citedDomains.find((r) => r.domain === 'pbn-site.com')!.isOwnPbn, true)
    ok('prompt detail metrics and flags')

    const dv = await q.buildPromptDetail(A, filters, p1.id, true)
    assert.deepEqual(dv!.citedDomains.map((r) => r.domain).sort(), ['pbn-site.com', 'vendor.com'])
    ok('vendorOnly filter')

    // full-answer viewer
    const vo = await q.buildResponseViewer(A, filters, p1.id, null, 'openai')
    assert.ok(vo)
    assert.equal(vo!.runs.length, 1)
    assert.equal(vo!.runId, run.id)
    assert.equal(vo!.provider, 'openai')
    assert.equal(vo!.samples.length, 1)
    const so = vo!.samples[0]
    assert.equal(so.mentions.find((m) => m.key === 'brand')!.linked, true)
    assert.equal(so.mentions.find((m) => m.key === rival.id)!.linked, false)
    assert.equal(vo!.summary.asked, 1)
    assert.equal(vo!.summary.brandMentioned, 1)
    assert.equal(vo!.summary.ownedCited, 1)
    assert.equal(vo!.summary.entities[0].entityType, 'brand')
    const vg = await q.buildResponseViewer(A, filters, p1.id, run.id, 'gemini')
    const sg = vg!.samples[0]
    assert.equal(sg.mentions.find((m) => m.key === rival.id)!.linked, true)
    assert.equal(sg.mentions.find((m) => m.key === 'brand')!.linked, false)
    assert.equal(sg.citations.find((x) => x.domain === 'vendor.com')!.vendor?.price, 1500)
    assert.equal(vg!.summary.domains.find((x) => x.domain === 'vendor.com')!.answers, 1)
    const vc = await q.buildResponseViewer(A, filters, p1.id, null, 'claude')
    assert.equal(vc!.samples[0].citations.find((x) => x.domain === 'pbn-site.com')!.isOwnPbn, true)
    const vf = await q.buildResponseViewer(A, filters, p1.id, null, 'google_ai_mode')
    assert.equal(vf!.samples.length, 1)
    assert.equal(vf!.samples[0].status, 'FAILED')
    assert.equal(vf!.summary.asked, 0)
    const vn = await q.buildResponseViewer(A, filters, p2.id, null, null)
    assert.ok(vn)
    assert.equal(vn!.runs.length, 0)
    assert.equal(vn!.samples.length, 0)
    assert.equal(await q.buildResponseViewer(B, filters, p1.id, null, null), null)
    ok('response viewer: samples, linked flags, vendor/PBN flags, failed attempts, tenant scope')

    // citations
    const c = await q.buildCitations(A, filters, { view: 'external' })
    assert.equal(c.rows.length, 2)
    assert.equal(c.totals.own, 1)
    assert.equal(c.totals.competitor, 1)
    assert.equal(c.totals.external, 2)
    assert.equal(c.totals.gap, 3)
    assert.equal(c.totals.citations, 5)
    assert.equal(c.totals.responsesWithCitations, 4)
    assert.equal(c.totals.responses, 4)
    ok('citations views and totals')

    // prompt list, null rate last both ways
    for (const sort of ['mention_rate_asc', 'mention_rate_desc']) {
      const l = await q.buildPromptList(A, filters, { sort })
      assert.equal(l.rows.length, 2)
      assert.equal(l.rows[1].id, p2.id)
      assert.equal(l.rows[1].stats.mentionRate, null)
      assert.equal(l.rows[0].stats.mentionRate, 0.5)
    }
    ok('prompt list sorts null mention rate last')

    const ov = await q.buildOverview(A, filters)
    assert.equal(ov.configured, true)
    assert.equal(ov.kpis.mentionRate, 0.5)
    ok('overview')

    // isolation
    assert.equal(await q.buildPromptDetail(B, filters, p1.id, false), null)
    assert.equal(await q.buildPromptDetail(spoof, filters, p1.id, false), null)
    assert.equal((await q.buildPromptList(B, filters, {})).rows.length, 0)
    assert.equal((await q.buildPromptList(spoof, filters, {})).rows.length, 0)
    const cb = await q.buildCitations(B, filters, {})
    assert.equal(cb.rows.length, 0)
    assert.equal(cb.totals.citations, 0)
    assert.equal((await q.buildCitations(spoof, filters, {})).rows.length, 0)
    const ob = await q.buildOverview(B, filters)
    assert.equal(ob.configured, false)
    assert.equal(ob.hasData, false)
    assert.equal((await q.buildOverview(spoof, filters)).hasData, false)
    assert.equal((await q.buildOpportunityList(B, {})).total, 0)
    ok('org B sees nothing of org A')

    // opportunities
    await prisma.brandRadarOpportunity.create({ data: { ...base, type: 'itest_stale', key: 'open-stale', status: 'OPEN' } })
    await prisma.brandRadarOpportunity.create({ data: { ...base, type: 'itest_stale', key: 'dismissed-stale', status: 'DISMISSED' } })
    await prisma.brandRadarOpportunity.create({ data: { organizationId: orgB, projectId: projB, type: 'itest_b', key: 'b1', status: 'OPEN' } })
    await q.refreshOpportunities(B)
    assert.equal(await prisma.brandRadarOpportunity.count({ where: { projectId: projA, type: 'itest_stale' } }), 2)
    ok('refresh for org B leaves org A rows alone')
    await prisma.brandRadarOpportunity.deleteMany({ where: { organizationId: orgB } })

    await q.refreshOpportunities(A)
    const stale = await prisma.brandRadarOpportunity.findMany({ where: { projectId: projA, type: 'itest_stale' } })
    assert.equal(stale.length, 1)
    assert.equal(stale[0].key, 'dismissed-stale')
    assert.equal(stale[0].status, 'DISMISSED')
    ok('refresh drops stale OPEN, keeps DISMISSED')

    const made = await prisma.brandRadarOpportunity.findFirst({ where: { projectId: projA, type: { not: 'itest_stale' } } })
    if (made) {
      await prisma.brandRadarOpportunity.update({ where: { id: made.id }, data: { status: 'DISMISSED' } })
      await q.refreshOpportunities(A)
      const again = await prisma.brandRadarOpportunity.findUnique({ where: { id: made.id } })
      assert.equal(again?.status, 'DISMISSED')
      ok('refreshed opportunity keeps DISMISSED status')
    } else {
      console.log('skip - refresh produced no opportunity from the seed data')
    }

    // every route is guarded
    const root = join(process.cwd(), 'src/app/api/brand-radar')
    const files: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(dir)) {
        const p = join(dir, e)
        if (statSync(p).isDirectory()) walk(p)
        else if (e === 'route.ts') files.push(p)
      }
    }
    walk(root)
    assert.ok(files.length > 0)
    const unguarded = files.filter((f) => {
      if (f.includes('/cron/') || f.includes('/runs/due/')) return false
      const s = readFileSync(f, 'utf8')
      return !/requireProject|requireStaff/.test(s)
    })
    assert.deepEqual(unguarded, [])
    ok(`all ${files.length} routes use requireProject or requireStaff (cron and runs/due excluded)`)
  } finally {
    for (const org of [orgA, orgB]) {
      const w = { organizationId: org }
      await prisma.brandRadarCitation.deleteMany({ where: w })
      await prisma.brandRadarMention.deleteMany({ where: w })
      await prisma.brandRadarResponse.deleteMany({ where: w })
      await prisma.brandRadarRun.deleteMany({ where: w })
      await prisma.brandRadarOpportunity.deleteMany({ where: w })
      await prisma.brandRadarPrompt.deleteMany({ where: w })
      await prisma.brandRadarCompetitor.deleteMany({ where: w })
      await prisma.brandRadarProfile.deleteMany({ where: w })
      await prisma.blmVendorSite.deleteMany({ where: w })
      await prisma.uploadClient.deleteMany({ where: w })
      await prisma.project.deleteMany({ where: w })
      await prisma.user.deleteMany({ where: w })
    }
    await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } })
    await prisma.$disconnect()
  }
  console.log(`\n${n} checks passed`)
}

main().catch((e) => { console.error(e); process.exit(1) })
