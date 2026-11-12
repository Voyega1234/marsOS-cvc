/**
 * PBN Backlinks: เว็บโครง magazine (khaoduan.com / roothan.com) — หมวด, รูปแบบไฟล์, backlink dofollow, รูป webp
 * Run: npx tsx src/lib/upload-article/pbn-magazine.test.ts
 */
import assert from 'node:assert/strict'
import sharp from 'sharp'
import {
  bangkokDate,
  buildMagazineFile,
  findMagazineCluster,
  isMagazineSite,
  magazineBody,
  magazineConfigPath,
  parseMagazineConfig,
} from './pbn-magazine'
import { buildMagazinePush, checkMagazinePush, loadMagazineClusters, magazineImageDir } from './pbn-magazine-push'
import { mergePbnSiteInput, readPbnPushes, toPbnSiteDTO, type PbnSite } from './pbn'
import { cleanPbnCluster, readPbnArticleTargets } from './pbn-sets'

let n = 0
async function t(name: string, fn: () => void | Promise<void>) {
  await fn()
  n++
  console.log(`ok ${n} - ${name}`)
}

const CONFIG = {
  clusters: { 'coffee-guide': 'คู่มือกาแฟ', 'home-care': 'ดูแลบ้าน', travel: 'ท่องเที่ยว', orphan: 'หมวดลอย' },
  magazine: {
    sections: [
      { key: 'life', navLabel: 'ไลฟ์สไตล์', label: 'Lifestyle', clusters: ['coffee-guide', 'home-care', 'not-in-map'] },
      { key: 'go', label: 'เดินทาง', clusters: ['travel', 'coffee-guide'] },
    ],
  },
}

const SITE: PbnSite = {
  id: 's1',
  name: 'khaoduan',
  siteUrl: 'https://khaoduan.com',
  platform: 'github',
  ghOwner: 'acme',
  ghRepo: 'pbn',
  ghBranch: 'main',
  ghDir: 'general-1/content/articles',
  ghImageDir: 'general-1/public/images',
  ghLayout: 'magazine',
} as PbnSite

const TARGET = { owner: 'acme', repo: 'pbn', branch: 'main', token: 'ghp_test' }
/** ปกแบบ data URI — checkMagazinePush ดูแค่รูปแบบ ไม่ถอดรูป */
const COVER = 'data:image/png;base64,QUJD'

/** GitHub ปลอม: site.config.json + รายชื่อไฟล์ที่มีอยู่แล้วใน repo */
function fakeGithub(existing: string[] = [], config: unknown = CONFIG): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    const path = decodeURIComponent(url.split('/contents/')[1]?.split('?')[0] || '')
    if (path.endsWith('site.config.json')) return new Response(JSON.stringify(config), { status: 200 })
    if (existing.includes(path)) return new Response('{}', { status: 200 })
    return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 })
  }) as typeof fetch
}

async function png(r = 200): Promise<string> {
  const buf = await sharp({ create: { width: 2000, height: 1200, channels: 3, background: { r, g: 80, b: 40 } } }).png().toBuffer()
  return `data:image/png;base64,${buf.toString('base64')}`
}

async function main() {
  await t('isMagazineSite', () => {
    assert.equal(isMagazineSite(SITE), true)
    assert.equal(isMagazineSite({ platform: 'github' }), false)
    assert.equal(isMagazineSite({ platform: 'wordpress', ghLayout: 'magazine' }), false)
    assert.equal(isMagazineSite(null), false)
  })

  await t('magazineConfigPath: derived + explicit', () => {
    assert.equal(magazineConfigPath({ ghDir: 'general-1/content/articles' }), 'general-1/site.config.json')
    assert.equal(magazineConfigPath({ ghDir: 'content/articles' }), 'site.config.json')
    assert.equal(magazineConfigPath({ ghDir: 'posts' }), null)
    assert.equal(magazineConfigPath({ ghDir: 'posts', ghConfigPath: 'general-2/site.config.json' }), 'general-2/site.config.json')
    assert.equal(magazineConfigPath({ ghDir: 'posts', ghConfigPath: '../secret.json' }), null)
  })

  await t('parseMagazineConfig: sections, labels, dedupe; clusters outside sections are not offered', () => {
    const c = parseMagazineConfig(CONFIG)
    assert.ok(c)
    assert.equal(c.count, 4)
    assert.deepEqual(c.sections.map((s) => [s.key, s.label]), [['life', 'ไลฟ์สไตล์'], ['go', 'เดินทาง']])
    assert.deepEqual(c.sections[0].clusters, [
      { slug: 'coffee-guide', label: 'คู่มือกาแฟ' },
      { slug: 'home-care', label: 'ดูแลบ้าน' },
      { slug: 'not-in-map', label: 'not-in-map' },
    ])
    assert.deepEqual(c.sections[1].clusters, [{ slug: 'travel', label: 'ท่องเที่ยว' }])
    // หมวดที่ไม่อยู่ในหมวดใหญ่ใดเลย: script merge ของ repo ไม่รับ จึงไม่ให้เลือก
    assert.equal(findMagazineCluster(c, 'orphan'), null)
    assert.equal(findMagazineCluster(c, 'travel')?.label, 'ท่องเที่ยว')
    assert.equal(findMagazineCluster(c, 'nope'), null)
  })

  await t('parseMagazineConfig: no sections / bad input', () => {
    const c = parseMagazineConfig({ clusters: { a: 'เอ', 'Bad Slug': 'x' } })
    assert.deepEqual(c, { sections: [{ key: '_other', label: 'หมวดทั้งหมด', clusters: [{ slug: 'a', label: 'เอ' }] }], count: 1 })
    assert.equal(parseMagazineConfig({}), null)
    assert.equal(parseMagazineConfig(null), null)
    assert.equal(parseMagazineConfig([]), null)
  })

  await t('bangkokDate uses UTC+7', () => {
    assert.equal(bangkokDate('2026-11-12T16:59:59Z'), '2026-11-12')
    assert.equal(bangkokDate('2026-11-12T17:00:00Z'), '2026-11-13')
    assert.match(bangkokDate('garbage'), /^\d{4}-\d{2}-\d{2}$/)
  })

  await t('buildMagazineFile: contract frontmatter', () => {
    const f = buildMagazineFile({
      title: 'กาแฟ "ดริป": เริ่มยังไง',
      description: 'คำอธิบาย',
      keyword: 'กาแฟดริป',
      slug: 'drip-coffee',
      cluster: 'coffee-guide',
      date: '2026-11-12',
      updated: '2026-11-12',
      seoTitle: 'กาแฟ "ดริป": เริ่มยังไง',
      html: '<p>เนื้อหา</p>',
    })
    assert.equal(
      f,
      [
        '---',
        'title: "กาแฟ \\"ดริป\\": เริ่มยังไง"',
        'description: "คำอธิบาย"',
        'keyword: "กาแฟดริป"',
        'slug: "drip-coffee"',
        'cluster: "coffee-guide"',
        'date: "2026-11-12"',
        'format: "html"',
        'origin: "marsos"',
        '---',
        '',
        '<p>เนื้อหา</p>',
        '',
      ].join('\n'),
    )
    const g = buildMagazineFile({ title: 'a', description: 'b', keyword: 'c', slug: 's', cluster: 'x', date: '2026-11-01', updated: '2026-11-12', seoTitle: 'SEO', html: '' })
    assert.ok(g.includes('updated: "2026-11-12"\nseoTitle: "SEO"\nformat: "html"'))
  })

  await t('magazineBody: strips style/script/toc/h1, dofollow only on target outside system blocks', () => {
    const target = 'https://money.example.com/google-ads'
    const html = `<style>.x{color:red}</style><script>alert(1)</script>`
      + `<nav class="content-toc"><a href="#a">หัวข้อ</a></nav>`
      + `<h1>ชื่อบทความ</h1><p>อ่าน <a href="${target}/">รับทำ google ads</a> และ <a href="https://other.example.com/">อื่น</a></p>`
      + `<h1>หัวข้อรอง</h1><h2 id="a">หัวข้อ</h2>`
      + `<div class="content-cta"><a href="${target}">ติดต่อ</a></div>`
    const r = magazineBody(html, { slug: 'drip-coffee', targetUrl: target })
    assert.equal(r.dofollow, 1)
    assert.ok(!/<style|<script|<nav|<h1/i.test(r.html))
    assert.ok(!r.html.includes('ชื่อบทความ'))
    assert.ok(r.html.includes('<h2>หัวข้อรอง</h2>'))
    assert.ok(r.html.includes(`<a href="${target}/" rel="dofollow">รับทำ google ads</a>`))
    assert.ok(r.html.includes('<a href="https://other.example.com/">อื่น</a>'))
    assert.ok(r.html.includes(`<div class="content-cta"><a href="${target}">ติดต่อ</a></div>`))
  })

  await t('magazineBody: no target = no dofollow', () => {
    const r = magazineBody('<p><a href="https://a.example.com/">x</a></p>', { slug: 's' })
    assert.equal(r.dofollow, 0)
    assert.ok(!r.html.includes('dofollow'))
  })

  await t('magazineBody: data images become /images/<slug>-<n>.webp, https images stay', () => {
    const html = '<p>a</p><figure><img src="data:image/png;base64,QUJD" srcset="x 2x" alt="หนึ่ง"><figcaption>cap</figcaption></figure>'
      + '<p><img src="https://cdn.example.com/x.jpg"></p><p><img src="data:image/jpeg;base64,REVG"></p>'
    const r = magazineBody(html, { slug: 'drip-coffee' })
    assert.deepEqual(r.images, [
      { name: 'drip-coffee-1', mime: 'image/png', base64: 'QUJD' },
      { name: 'drip-coffee-2', mime: 'image/jpeg', base64: 'REVG' },
    ])
    assert.ok(r.html.includes('src="/images/drip-coffee-1.webp"') && r.html.includes('src="/images/drip-coffee-2.webp"'))
    assert.ok(r.html.includes('https://cdn.example.com/x.jpg'))
    assert.ok(!r.html.includes('data:') && !r.html.includes('srcset'))
    assert.equal(r.droppedImages, 0)

    const d = magazineBody(html, { slug: 'drip-coffee', keepImages: false })
    assert.equal(d.droppedImages, 2)
    assert.equal(d.images.length, 0)
    assert.ok(!d.html.includes('figure') && !d.html.includes('cap') && !d.html.includes('data:'))
    assert.ok(d.html.includes('https://cdn.example.com/x.jpg'))
  })

  await t('site input: ghLayout + ghConfigPath round trip', () => {
    const base = { name: 'khaoduan', siteUrl: 'https://khaoduan.com', platform: 'github', ghOwner: 'acme', ghRepo: 'pbn', ghToken: 'ghp_x' }
    const m = mergePbnSiteInput({ ...base, ghLayout: 'magazine', ghConfigPath: '/general-1/site.config.json/' }, null, (s) => `enc:${s}`, () => 'id1')
    const site = m.site
    assert.ok(site, JSON.stringify(m))
    assert.equal(site.ghLayout, 'magazine')
    assert.equal(site.ghConfigPath, 'general-1/site.config.json')
    const dto = toPbnSiteDTO(site)
    assert.equal(dto.ghLayout, 'magazine')
    assert.equal(dto.ghConfigPath, 'general-1/site.config.json')
    const back = mergePbnSiteInput({ ghLayout: 'generic', ghConfigPath: '' }, site, (s) => `enc:${s}`, () => 'id2').site
    assert.ok(back)
    assert.equal(back.ghLayout, undefined)
    assert.equal(back.ghConfigPath, undefined)
    assert.equal(toPbnSiteDTO(back).ghLayout, 'generic')
  })

  await t('readPbnPushes keeps cluster + date', () => {
    const p = readPbnPushes({ pbnPushes: { a1: { s1: { url: 'https://khaoduan.com/x/', postId: 'p', at: '2026-11-12T00:00:00Z', cluster: 'travel', date: '2026-11-12' }, s2: { at: '2026-11-12T00:00:00Z', date: 'bad' } } } })
    assert.equal(p.a1.s1.cluster, 'travel')
    assert.equal(p.a1.s1.date, '2026-11-12')
    assert.equal(p.a1.s2.date, undefined)
  })

  await t('loadMagazineClusters reads site.config.json next to content/', async () => {
    const r = await loadMagazineClusters(SITE, TARGET, fakeGithub())
    assert.ok(r.ok)
    if (!r.ok) return
    assert.equal(r.configPath, 'general-1/site.config.json')
    assert.equal(r.clusters.count, 4)
    const bad = await loadMagazineClusters({ ...SITE, ghDir: 'posts' }, TARGET, fakeGithub())
    assert.equal(bad.ok, false)
  })

  await t('checkMagazinePush: rejects draft, bad slug, missing/unknown cluster, bad image dir', async () => {
    const base = { site: SITE, target: TARGET, articleSlug: 'drip-coffee', cluster: 'travel', publishMode: 'publish' as const, cover: COVER }
    const fx = fakeGithub()
    // หมวดที่อยู่ใน clusters แต่ไม่อยู่ในหมวดใหญ่ = เลือกไม่ได้
    assert.equal((await checkMagazinePush({ ...base, cluster: 'orphan' }, fx)).ok, false)
    assert.equal((await checkMagazinePush({ ...base, publishMode: 'draft' }, fx)).ok, false)
    assert.equal((await checkMagazinePush({ ...base, articleSlug: 'กาแฟดริป' }, fx)).ok, false)
    assert.equal((await checkMagazinePush({ ...base, articleSlug: '' }, fx)).ok, false)
    assert.equal((await checkMagazinePush({ ...base, cluster: '' }, fx)).ok, false)
    assert.equal((await checkMagazinePush({ ...base, cluster: 'nope' }, fx)).ok, false)
    assert.equal((await checkMagazinePush({ ...base, site: { ...SITE, ghImageDir: 'public/images/blog' } }, fx)).ok, false)
    const ok = await checkMagazinePush(base, fx)
    assert.ok(ok.ok)
    if (!ok.ok) return
    assert.deepEqual(ok.check, {
      slug: 'drip-coffee',
      cluster: 'travel',
      clusterLabel: 'ท่องเที่ยว',
      articlePath: 'general-1/content/articles/drip-coffee.md',
      imageDir: 'general-1/public/images',
    })
  })

  await t('checkMagazinePush: rejects what the site repo checks reject (home- slug, no image folder, no cover)', async () => {
    const base = { site: SITE, target: TARGET, articleSlug: 'drip-coffee', cluster: 'travel', publishMode: 'publish' as const, cover: COVER }
    const fx = fakeGithub()
    const err = async (over: Partial<Parameters<typeof checkMagazinePush>[0]>) => {
      const r = await checkMagazinePush({ ...base, ...over }, fx)
      return r.ok ? '' : r.error
    }
    assert.match(await err({ articleSlug: 'home-decor-ideas' }), /home-/)
    // "home" กลางคำ/ไม่มีขีด ไม่โดนห้าม
    assert.equal(await err({ articleSlug: 'homemade-coffee' }), '')
    assert.equal(await err({ articleSlug: 'my-home-cafe' }), '')
    assert.match(await err({ site: { ...SITE, ghImageDir: '' } }), /โฟลเดอร์รูป/)
    assert.match(await err({ site: { ...SITE, ghImageDir: undefined } }), /โฟลเดอร์รูป/)
    assert.match(await err({ cover: null }), /ยังไม่มีรูปปก/)
    assert.match(await err({ cover: '' }), /ยังไม่มีรูปปก/)
    assert.match(await err({ cover: 'https://cdn.example.com/cover.jpg' }), /ลิงก์ภายนอก/)
    // ไม่ผ่าน = ยังไม่แตะ GitHub (ตรวจก่อนอ่าน repo)
    let calls = 0
    const counting = (async (...a: Parameters<typeof fetch>) => { calls++; return fx(...a) }) as typeof fetch
    await checkMagazinePush({ ...base, cover: null }, counting)
    await checkMagazinePush({ ...base, articleSlug: 'home-x' }, counting)
    assert.equal(calls, 0)
  })

  await t('magazineImageDir: required, must end with public/images', () => {
    assert.deepEqual(magazineImageDir(SITE), { ok: true, dir: 'general-1/public/images' })
    assert.deepEqual(magazineImageDir({ name: 'x', ghImageDir: '/public/images/' }), { ok: true, dir: 'public/images' })
    assert.equal(magazineImageDir({ name: 'x', ghImageDir: '' }).ok, false)
    assert.equal(magazineImageDir({ name: 'x' }).ok, false)
    assert.equal(magazineImageDir({ name: 'x', ghImageDir: 'public/images/blog' }).ok, false)
    assert.equal(magazineImageDir({ name: 'x', ghImageDir: '../public/images' }).ok, false)
  })

  await t('checkMagazinePush: never overwrites an article it did not push', async () => {
    const base = { site: SITE, target: TARGET, articleSlug: 'drip-coffee', cluster: 'travel', publishMode: 'publish' as const, cover: COVER }
    const taken = fakeGithub(['general-1/content/articles/drip-coffee.md'])
    const r = await checkMagazinePush(base, taken)
    assert.equal(r.ok, false)
    // push ซ้ำไฟล์ที่เรา push เอง = ผ่าน
    const again = await checkMagazinePush({ ...base, prevPush: { postId: 'general-1/content/articles/drip-coffee.md', at: '2026-11-01T00:00:00Z' } }, taken)
    assert.equal(again.ok, true)
    // เคย push ไว้ที่ slug อื่น แล้วเปลี่ยน slug มาชนไฟล์ของเว็บ = ไม่ผ่าน
    const moved = await checkMagazinePush({ ...base, prevPush: { postId: 'general-1/content/articles/old.md', at: '2026-11-01T00:00:00Z' } }, taken)
    assert.equal(moved.ok, false)
  })

  await t('buildMagazinePush: file + cover 1600 + thumb 640 + inline webp', async () => {
    const cover = await png()
    const inline = await png(20)
    const check = { slug: 'drip-coffee', cluster: 'travel', clusterLabel: 'ท่องเที่ยว', articlePath: 'general-1/content/articles/drip-coffee.md', imageDir: 'general-1/public/images' }
    const target = 'https://money.example.com/google-ads'
    const r = await buildMagazinePush({
      check,
      title: 'กาแฟดริป',
      seoTitle: 'กาแฟดริป เริ่มยังไง',
      description: 'คำอธิบาย',
      html: `<style>.a{}</style><h1>กาแฟดริป</h1><p><a href="${target}">รับทำ google ads</a></p><p><img src="${cover}"></p><p><img src="${inline}"></p>`,
      cover,
      keyword: 'รับทำ google ads',
      targetUrl: target,
      publishAt: '2026-12-01T03:00:00Z',
    })
    assert.equal(r.date, '2026-12-01')
    assert.deepEqual(r.warnings, [])
    assert.deepEqual(r.extraFiles.map((f) => f.path), [
      'general-1/public/images/drip-coffee-1.webp',
      'general-1/public/images/drip-coffee.webp',
      'general-1/public/images/drip-coffee-640.webp',
    ])
    const widths = await Promise.all(r.extraFiles.map(async (f) => {
      const meta = await sharp(Buffer.from(f.contentBase64, 'base64')).metadata()
      return [meta.format, meta.width]
    }))
    assert.deepEqual(widths, [['webp', 1200], ['webp', 1600], ['webp', 640]])
    assert.ok(r.fileContent.startsWith('---\ntitle: "กาแฟดริป"\ndescription: "คำอธิบาย"\nkeyword: "รับทำ google ads"\nslug: "drip-coffee"\ncluster: "travel"\ndate: "2026-12-01"\nseoTitle: "กาแฟดริป เริ่มยังไง"\nformat: "html"\norigin: "marsos"\n---\n'))
    assert.ok(r.fileContent.includes(`<a href="${target}" rel="dofollow">รับทำ google ads</a>`))
    assert.ok(r.fileContent.includes('src="/images/drip-coffee-1.webp"'))
    assert.ok(!/data:|<style|<h1/.test(r.fileContent))
  })

  await t('buildMagazinePush: re-push keeps first date, adds updated; warns when there is no backlink', async () => {
    const check = { slug: 'x', cluster: 'travel', clusterLabel: 'ท่องเที่ยว', articlePath: 'general-1/content/articles/x.md', imageDir: 'general-1/public/images' }
    const r = await buildMagazinePush({
      check,
      title: 'หัวข้อ',
      html: '<p>ไม่มีลิงก์</p>',
      cover: await png(),
      prevPush: { postId: check.articlePath, at: '2026-01-05T10:00:00Z', date: '2026-01-05' },
    })
    assert.equal(r.date, '2026-01-05')
    assert.ok(r.fileContent.includes('date: "2026-01-05"\nupdated: "'))
    assert.ok(r.fileContent.includes('description: "หัวข้อ"\nkeyword: "หัวข้อ"'))
    assert.deepEqual(r.extraFiles.map((f) => f.path), ['general-1/public/images/x.webp', 'general-1/public/images/x-640.webp'])
    assert.equal(r.warnings.length, 1)
    assert.ok(!r.fileContent.includes('data:'))
  })

  await t('buildMagazinePush: never builds an article without a usable cover', async () => {
    const check = { slug: 'x', cluster: 'travel', clusterLabel: 'ท่องเที่ยว', articlePath: 'general-1/content/articles/x.md', imageDir: 'general-1/public/images' }
    const base = { check, title: 'หัวข้อ', html: '<p>เนื้อหา</p>' }
    await assert.rejects(buildMagazinePush(base), /ยังไม่มีรูปปก/)
    await assert.rejects(buildMagazinePush({ ...base, cover: 'https://cdn.example.com/cover.jpg' }), /ยังไม่มีรูปปก/)
    // ปกเป็น data URI แต่ไม่ใช่รูปจริง = แปลงไม่ได้ ต้องหยุด ไม่ push บทความไร้ปก
    await assert.rejects(buildMagazinePush({ ...base, cover: COVER }), /แปลงรูปปก/)
    await assert.rejects(buildMagazinePush({ ...base, check: { ...check, imageDir: '' }, cover: await png() }), /โฟลเดอร์รูป/)
    // รูปในเนื้อหาเสีย = หยุดเหมือนเดิม
    await assert.rejects(
      buildMagazinePush({ ...base, cover: await png(), html: '<p><img src="data:image/png;base64,QUJD"></p>' }),
      /แปลงรูปในเนื้อหา/,
    )
  })

  await t('article target: category chosen at write time is kept, bad values are dropped', () => {
    assert.equal(cleanPbnCluster(' acne-blemishes '), 'acne-blemishes')
    assert.equal(cleanPbnCluster('Acne Blemishes'), '')
    assert.equal(cleanPbnCluster('../etc'), '')
    assert.equal(cleanPbnCluster(undefined), '')
    const targets = readPbnArticleTargets({
      pbnArticleTargets: {
        a1: { siteId: 's1', profileId: 'main', cluster: 'used-cars' },
        a2: { siteId: 's1', profileId: 'main' },
        a3: { siteId: 's1', profileId: 'main', cluster: '<script>' },
        a4: { siteId: '', cluster: 'used-cars' },
      },
    })
    assert.deepEqual(targets.a1, { siteId: 's1', profileId: 'main', cluster: 'used-cars' })
    // ไม่ได้เลือกหมวด / หมวดรูปแบบผิด = ไม่มี field cluster (ไปเลือกตอน push เหมือนเดิม)
    assert.deepEqual(targets.a2, { siteId: 's1', profileId: 'main' })
    assert.deepEqual(targets.a3, { siteId: 's1', profileId: 'main' })
    assert.equal(targets.a4, undefined)
  })

  await t('parseMagazineConfig: sections declared but unusable never falls back to every cluster', () => {
    // หมวดใหญ่ประกาศไว้แต่อ่านไม่ได้ = ไม่เสนอหมวดเลย (push ถูกกันไว้) ดีกว่าเสนอหมวดที่ script merge ของเว็บปฏิเสธ
    assert.equal(parseMagazineConfig({ clusters: { a: 'A', b: 'B' }, magazine: { sections: [{ key: 'x', clusters: ['Not Valid'] }] } }), null)
    // ไม่มีหมวดใหญ่เลย = ใช้ทุกหมวดใน clusters เหมือนเดิม
    assert.equal(parseMagazineConfig({ clusters: { a: 'A', b: 'B' }, magazine: { sections: [] } })?.count, 2)
    assert.equal(parseMagazineConfig({ clusters: { a: 'A', b: 'B' } })?.count, 2)
  })

  console.log(`\n${n} passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
