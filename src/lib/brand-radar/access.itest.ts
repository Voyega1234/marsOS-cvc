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

    // projects created inside Brand Radar: the profile is the project, no Project row
    const t = await import('./types')
    const manualId = `${t.MANUAL_PROJECT_PREFIX}itest${stamp}`
    await prisma.brandRadarProfile.create({
      data: {
        organizationId: orgA, projectId: manualId, brandName: 'Solo Brand', primaryDomain: 'solo.example',
        ownedDomains: JSON.stringify(['solo.example']), providers: JSON.stringify(['openai']),
      },
    })
    const m = await server.loadOwnedProject(orgA, manualId)
    assert.ok(m)
    assert.equal(m!.id, manualId)
    assert.equal(m!.name, 'Solo Brand')
    assert.equal(m!.clientName, 'Solo Brand')
    assert.equal(m!.website, 'solo.example')
    assert.equal(await server.loadOwnedProject(orgB, manualId), null)
    assert.equal(await server.loadOwnedProject(orgA, `${t.MANUAL_PROJECT_PREFIX}missing${stamp}`), null)
    const optsA = await q.buildProjectOptions(orgA)
    const optM = optsA.find((o) => o.id === manualId)
    assert.ok(optM)
    assert.equal(optM!.manual, true)
    assert.equal(optM!.name, 'Solo Brand')
    assert.equal(optM!.hasProfile, true)
    assert.equal(optsA.find((o) => o.id === projA)!.manual, false)
    assert.equal((await q.buildProjectOptions(orgB)).some((o) => o.id === manualId), false)
    const M = { orgId: orgA, userId: userA, role: 'ADMIN', project: m! }
    const om = await q.buildOverview(M, filters)
    assert.equal(om.configured, true)
    assert.equal(om.hasData, false)
    assert.equal((await q.buildPromptList(M, filters, {})).rows.length, 0)
    assert.equal(t.isManualProjectId(manualId), true)
    assert.equal(t.isManualProjectId(projA), false)
    assert.equal(t.aiJobProjectId(manualId), null)
    assert.equal(t.aiJobProjectId(projA), projA)
    ok('manual project: loads for its organization only, listed with manual flag, AI cost logged without a project id')

    // ── Customer (CLIENT) read-only view ─────────────────────────────────────
    const { clientRadarProjectIds, profiledProjectIds } = server
    const clientId = `itest-acc-client-${stamp}`
    const loneId = `itest-acc-lone-${stamp}`
    const staffName = `STAFFNAME_${stamp}`
    await prisma.user.create({ data: { id: clientId, email: `c-${stamp}@itest.local`, name: 'C', role: 'CLIENT', organizationId: orgA } })
    await prisma.user.create({ data: { id: loneId, email: `l-${stamp}@itest.local`, name: 'L', role: 'CLIENT', organizationId: orgA } })
    const xorgId = `itest-acc-xorg-${stamp}`
    await prisma.user.create({ data: { id: xorgId, email: `x-${stamp}@itest.local`, name: 'X', role: 'CLIENT', organizationId: orgA } })
    const ghost = `itest-acc-ghost-${stamp}`
    await prisma.brandRadarClientAccess.createMany({
      data: [
        { userId: clientId, projectId: projA, organizationId: orgA },
        { userId: clientId, projectId: ghost, organizationId: orgA },
        { userId: xorgId, projectId: projA, organizationId: orgB }, // foreign-organization row pointing at an org A project
        { userId: clientId, projectId: projB, organizationId: orgA }, // org A row pointing at an org B project
      ],
    })
    assert.deepEqual(await clientRadarProjectIds(clientId, orgA), [projA])
    assert.deepEqual(await clientRadarProjectIds(clientId, orgB), [])
    assert.deepEqual(await clientRadarProjectIds(loneId, orgA), [])
    assert.deepEqual(await clientRadarProjectIds(xorgId, orgA), [])
    assert.deepEqual(await clientRadarProjectIds(xorgId, orgB), [])
    assert.deepEqual(await clientRadarProjectIds('', orgA), [])
    assert.deepEqual(await profiledProjectIds(orgA, [projA, manualId, projB, ghost, 42, '']), [projA, manualId])
    assert.deepEqual(await profiledProjectIds(orgB, [projA, projB]), [])
    const bareProj = `itest-acc-bare-${stamp}`
    await prisma.project.create({
      data: { id: bareProj, organizationId: orgA, name: 'Bare', website: 'https://bare.com', businessType: 'x', targetAudience: 'y', createdById: userA },
    })
    assert.deepEqual(await profiledProjectIds(orgA, [bareProj, projA]), [projA])
    ok('client access rows: own organization and existing projects only; profiledProjectIds keeps profiled owned ids')

    // list scoping
    assert.deepEqual((await q.buildProjectOptions(orgA, [projA])).map((o) => o.id), [projA])
    assert.deepEqual(await q.buildProjectOptions(orgA, []), [])
    assert.ok((await q.buildProjectOptions(orgA, null)).length >= 2)
    assert.ok((await q.buildProjectOptions(orgA)).length >= 2)
    assert.deepEqual(await q.buildProjectOptions(orgA, [projB]), [])
    const sumA = await q.buildBrandSummaries(orgA, new Date(), [projA])
    assert.ok(sumA.length >= 1)
    assert.ok(sumA.every((b) => b.id === projA))
    assert.deepEqual(await q.buildBrandSummaries(orgA, new Date(), []), [])
    assert.ok(!(await q.buildBrandSummaries(orgA, new Date(), [projA, projB])).some((b) => b.id === projB))
    assert.deepEqual(await q.buildBrandSummaries(orgA, new Date(), [projB]), [])
    assert.ok((await q.buildBrandSummaries(orgA)).some((b) => b.id === manualId))
    ok('project options and brand summaries are limited to the allowed ids ([] = nothing, orgB id = nothing)')

    // staff-only seed data
    await prisma.user.update({ where: { id: userA }, data: { name: staffName } })
    const note = `STAFFNOTE_${stamp}`
    const kw = `STAFFKW_${stamp}`
    const err = `STAFFERR_${stamp}`
    const model = `STAFFMODEL_${stamp}`
    const runErr = `STAFFRUNERR_${stamp}`
    const pS = await prisma.brandRadarPrompt.create({
      data: { ...base, text: `visible prompt ${stamp}`, textKey: `visible prompt ${stamp}`, status: 'ACTIVE', note, keyword: kw, searchVolume: 777, source: 'gsc' },
    })
    const pC = await prisma.brandRadarPrompt.create({ data: { ...base, text: `CANDTEXT_${stamp}`, textKey: `candtext ${stamp}`, status: 'CANDIDATE' } })
    const pR = await prisma.brandRadarPrompt.create({ data: { ...base, text: `REJTEXT_${stamp}`, textKey: `rejtext ${stamp}`, status: 'REJECTED' } })
    const runS = await prisma.brandRadarRun.create({
      data: { ...base, status: 'COMPLETED', providers: JSON.stringify(['openai']), costUsd: 4.25, estimatedCostUsd: 5.5, error: runErr, createdById: userA, trigger: 'schedule' },
    })
    const rS = await prisma.brandRadarResponse.create({
      data: {
        ...base, runId: runS.id, promptId: pS.id, provider: 'openai', status: 'DONE', promptText: pS.text, model, costUsd: 0.37,
        brandMentioned: true, brandOccurrences: 1, collectedAt: new Date(),
      },
    })
    await prisma.brandRadarResponse.create({
      data: { ...base, runId: runS.id, promptId: pS.id, provider: 'google_ai_mode', status: 'FAILED', error: err, model, costUsd: 0.11, collectedAt: new Date() },
    })
    for (const pp of [pC, pR]) {
      await prisma.brandRadarResponse.create({
        data: {
          ...base, runId: runS.id, promptId: pp.id, provider: 'openai', status: 'DONE', promptText: pp.text, model,
          brandMentioned: true, brandOccurrences: 1, collectedAt: new Date(),
        },
      })
    }
    void rS

    const C = { ...A, clientView: true }
    const results: Record<string, unknown> = {
      overview: await q.buildOverview(C, filters),
      feed: await q.buildAnswerFeed(C, filters, {}),
      citations: await q.buildCitations(C, filters, {}),
      competitors: await q.buildCompetitorInsights(C, filters),
      detail: await q.buildPromptDetail(C, filters, pS.id, false),
      detailP1: await q.buildPromptDetail(C, filters, p1.id, false),
      viewer: await q.buildResponseViewer(C, filters, pS.id, null, 'openai'),
      viewerFailed: await q.buildResponseViewer(C, filters, pS.id, null, 'google_ai_mode'),
    }
    assert.ok(results.detail, 'client can read an ACTIVE prompt')
    assert.equal(await q.buildPromptDetail(C, filters, pC.id, false), null, 'CANDIDATE prompt hidden from client')
    assert.equal(await q.buildPromptDetail(C, filters, pR.id, false), null, 'REJECTED prompt hidden from client')
    assert.equal(await q.buildResponseViewer(C, filters, pC.id, null, null), null)
    assert.equal(await q.buildResponseViewer(C, filters, pR.id, null, null), null)
    const staffDetailC = await q.buildPromptDetail(A, filters, pC.id, false)
    assert.ok(staffDetailC, 'staff still see CANDIDATE prompt')

    const walk2 = (v: unknown, fn: (o: Record<string, unknown>) => void) => {
      if (Array.isArray(v)) { v.forEach((x) => walk2(x, fn)); return }
      if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>
        fn(o)
        Object.values(o).forEach((x) => walk2(x, fn))
      }
    }
    let seenResponses = 0, seenRuns = 0, seenPrompts = 0, seenLabels = 0
    const forbidden = [note, kw, err, model, runErr, staffName, `CANDTEXT_${stamp}`, `REJTEXT_${stamp}`]
    for (const [name, res] of Object.entries(results)) {
      const json = JSON.stringify(res)
      for (const f of forbidden) assert.ok(!json.includes(f), `client ${name} leaks ${f}`)
      walk2(res, (o) => {
        if ('model' in o && 'status' in o && 'responseText' in o) {
          seenResponses++
          assert.equal(o.status, 'DONE', `${name}: only DONE answers`)
          assert.equal(o.costUsd ?? null, null, `${name}: response costUsd`)
          assert.equal(o.error, '', `${name}: response error`)
          assert.equal(o.model, '', `${name}: response model`)
        }
        if ('estimatedCostUsd' in o && 'totalTasks' in o) {
          seenRuns++
          assert.equal(o.costUsd, 0, `${name}: run costUsd`)
          assert.equal(o.estimatedCostUsd, null, `${name}: run estimatedCostUsd`)
          assert.equal(o.error, '', `${name}: run error`)
          assert.equal(o.createdByName, '', `${name}: run staff name`)
        }
        if ('note' in o && 'keyword' in o && 'searchVolume' in o && 'status' in o) {
          seenPrompts++
          assert.equal(o.note, '', `${name}: prompt note`)
          assert.equal(o.keyword, '', `${name}: prompt keyword`)
          assert.equal(o.searchVolume, null, `${name}: prompt searchVolume`)
          assert.equal(o.source, 'manual', `${name}: prompt source`)
          assert.ok(o.status === 'ACTIVE' || o.status === 'INACTIVE', `${name}: prompt status ${String(o.status)}`)
        }
        for (const k of ['providerLabel', 'label']) {
          if (typeof o[k] === 'string' && ('provider' in o || k === 'providerLabel')) {
            seenLabels++
            assert.ok(!/[()]/.test(o[k] as string), `${name}: provider label "${String(o[k])}"`)
          }
        }
      })
    }
    assert.ok(seenResponses > 0 && seenRuns > 0 && seenPrompts > 0 && seenLabels > 0, `walker saw nothing: ${seenResponses}/${seenRuns}/${seenPrompts}/${seenLabels}`)
    const vf2 = results.viewerFailed as { provider: string | null; samples: Array<{ status: string }> } | null
    assert.ok(vf2)
    assert.notEqual(vf2!.provider, 'google_ai_mode', 'client cannot select a platform that only has FAILED attempts')
    assert.ok(vf2!.samples.every((x) => x.status === 'DONE'), 'client sees no FAILED attempts')
    ok('client view strips staff data (notes, keywords, errors, models, costs, staff names, CANDIDATE/REJECTED prompts, labels)')

    // staff output unchanged
    const sDetail = JSON.stringify(await q.buildPromptDetail(A, filters, pS.id, false))
    assert.ok(sDetail.includes(note) && sDetail.includes(kw) && sDetail.includes(model))
    const sViewerF = JSON.stringify(await q.buildResponseViewer(A, filters, pS.id, null, 'google_ai_mode'))
    assert.ok(sViewerF.includes(err) && sViewerF.includes(model))
    const sOv = JSON.stringify(await q.buildOverview(A, filters))
    assert.ok(sOv.includes(staffName) && sOv.includes(runErr))
    assert.ok(JSON.stringify(await q.buildPromptList(A, filters, {})).includes(`CANDTEXT_${stamp}`))
    assert.ok(JSON.stringify(await q.buildAnswerFeed(A, filters, {})).includes(model))
    const sProvLabel = (await q.buildOverview(A, filters)).byProvider.map((r) => r.label)
    assert.ok(sProvLabel.some((l) => l.includes('(')), 'staff provider labels keep their (method) wording')
    ok('staff output still contains notes, keywords, errors, models, run costs and candidate prompts')

    // client view: inactive competitors are hidden from mention chips, staff still see them; run trigger is not leaked
    const goneName = `GONECOMP_${stamp}`
    const gone = await prisma.brandRadarCompetitor.create({
      data: { ...base, name: goneName, nameKey: `gonecomp ${stamp}`, domains: JSON.stringify([]), status: 'INACTIVE' },
    })
    await prisma.brandRadarMention.create({
      data: { ...base, runId: runS.id, responseId: rS.id, promptId: pS.id, provider: 'openai', entityType: 'competitor', entityKey: gone.id, competitorId: gone.id, entityName: goneName, positionPct: 0.2 },
    })
    const cViewer = await q.buildResponseViewer(C, filters, pS.id, null, 'openai')
    const sViewer = await q.buildResponseViewer(A, filters, pS.id, null, 'openai')
    assert.ok(!JSON.stringify(cViewer).includes(goneName), 'client viewer hides INACTIVE competitor mentions and summary entries')
    assert.ok(JSON.stringify(sViewer).includes(goneName), 'staff viewer still shows INACTIVE competitor mention')
    const cOverview = await q.buildOverview(C, filters)
    let clientRuns = 0
    walk2(cOverview, (o) => {
      if ('estimatedCostUsd' in o && 'totalTasks' in o) { clientRuns++; assert.equal(o.trigger, 'manual', 'client run trigger') }
    })
    assert.ok(clientRuns > 0, 'client overview has runs')
    ok('client view: INACTIVE competitor mentions hidden (staff still see them), run trigger is manual')

    const cp = await prisma.brandRadarProfile.findFirstOrThrow({ where: { organizationId: orgA, projectId: manualId } })
    const prof = await prisma.brandRadarProfile.update({
      where: { id: cp.id },
      data: { ambiguousAliases: JSON.stringify(['amb']), contextTerms: JSON.stringify(['ctx']), promptSources: JSON.stringify(['gsc']), monthlyBudgetUsd: 50, maxPromptsPerRun: 20 },
    })
    const cdto = q.toClientProfileDTO(prof as Parameters<typeof q.toClientProfileDTO>[0])
    assert.equal(cdto.monthlyBudgetUsd, null)
    assert.equal(cdto.maxPromptsPerRun, 0)
    assert.equal(cdto.nextRunAt, null)
    assert.deepEqual(cdto.ambiguousAliases, [])
    assert.deepEqual(cdto.contextTerms, [])
    assert.deepEqual(cdto.promptSources, [])
    assert.equal(cdto.brandName, 'Solo Brand')
    const sdto = q.toProfileDTO(prof as Parameters<typeof q.toProfileDTO>[0])
    assert.equal(sdto.monthlyBudgetUsd, 50)
    assert.deepEqual(sdto.contextTerms, ['ctx'])
    ok('toClientProfileDTO removes budget, schedule and matching rules; staff DTO unchanged')

    // client-access allowlist
    const { isClientApiAllowed, isClientPageAllowed } = await import('@/lib/client-access')
    const readerPaths = [
      '/api/brand-radar/projects', '/api/brand-radar/brands', '/api/brand-radar/profile', '/api/brand-radar/overview',
      '/api/brand-radar/responses', '/api/brand-radar/citations', '/api/brand-radar/competitors/insights',
      '/api/brand-radar/prompts/abc123/detail', '/api/brand-radar/prompts/abc123/responses', '/api/brand-radar/logo',
    ]
    for (const path of readerPaths) {
      assert.equal(isClientApiAllowed(path, 'GET'), true, `GET ${path}`)
      for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(isClientApiAllowed(path, m), false, `${m} ${path}`)
    }
    for (const path of ['prompts', 'runs', 'opportunities', 'citation-analysis', 'competitors', 'providers/test', 'providers/sample-test', 'cron']) {
      assert.equal(isClientApiAllowed(`/api/brand-radar/${path}`, 'GET'), false, `GET ${path} denied`)
    }
    assert.equal(isClientApiAllowed('/api/brand-radar/site-readiness', 'GET'), false, 'GET site-readiness denied for clients')
    assert.equal(isClientPageAllowed('/brand-radar'), true)
    for (const path of ['/brand-radar/anything', '/settings', '/admin/users']) assert.equal(isClientPageAllowed(path), false, path)
    ok('client allowlist: ten GET-only report endpoints, nothing else')

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
    const rel = (f: string) => f.slice(root.length + 1)
    const readerSet = ['projects', 'brands', 'profile', 'overview', 'responses', 'citations', 'competitors/insights', 'prompts/[id]/detail', 'prompts/[id]/responses', 'logo']
      .map((r) => `${r}/route.ts`).sort()
    const unguarded = files.filter((f) => {
      if (f.includes('/cron/') || f.includes('/runs/due/')) return false
      return !/\brequire(Project|Staff|ProjectReader|Reader)\(/.test(readFileSync(f, 'utf8'))
    })
    assert.deepEqual(unguarded, [])
    const readers = files.filter((f) => /\brequire(ProjectReader|Reader)\(/.test(readFileSync(f, 'utf8'))).map(rel).sort()
    assert.deepEqual(readers, readerSet)
    const pr = readFileSync(join(root, 'profile/route.ts'), 'utf8')
    assert.ok(/\brequireProject\(/.test(pr), 'profile PUT keeps requireProject')
    const pj = readFileSync(join(root, 'projects/route.ts'), 'utf8')
    assert.ok(/\brequireStaff\(/.test(pj), 'projects POST keeps requireStaff')
    for (const r of readerSet) {
      const s = readFileSync(join(root, r), 'utf8')
      const handlers = Array.from(s.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)).map((x) => x[1])
      assert.ok(handlers.includes('GET'), `${r} exports GET`)
      const extra = handlers.filter((h) => h !== 'GET')
      if (extra.length > 0) assert.ok(/\brequire(Project|Staff)\(/.test(s), `${r} exports ${extra.join(',')} without requireProject/requireStaff`)
    }
    ok(`all ${files.length} routes guarded; exactly the 10 report routes use the reader guards; write handlers keep staff guards (cron and runs/due excluded)`)
  } finally {
    for (const org of [orgA, orgB]) {
      const w = { organizationId: org }
      await prisma.brandRadarClientAccess.deleteMany({ where: w })
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
