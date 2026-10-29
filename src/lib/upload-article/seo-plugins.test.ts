/**
 * Regression: SEO title/description ต้องลงช่องของปลั๊กอินที่เว็บใช้จริง (UME ใช้ AIOSEO ไม่ใช่ Yoast — 2026-10-29)
 * เว็บที่ไม่มีปลั๊กอินพวกนี้ต้องไม่โดนยิงอะไรเพิ่ม นอกจากอ่าน /wp-json/ ครั้งเดียว
 * Run: npx tsx src/lib/upload-article/seo-plugins.test.ts
 */
import { detectSeoPluginsFromHtml, detectSeoPluginsFromNamespaces, seoPluginNote, syncSeoPluginMeta } from './seo-plugins';

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  passed++;
  console.log(`  ✓ ${msg}`);
}

interface Call { url: string; method: string; body?: Record<string, unknown> }

/** WordPress ปลอม: namespaces = null แปลว่า /wp-json/ อ่านไม่ได้ */
function fakeWp(opts: { namespaces: string[] | null; status?: Record<string, number>; slimSeo?: Record<string, unknown> }) {
  const calls: Call[] = [];
  const fetcher = async (url: string, init: RequestInit): Promise<Response> => {
    const method = init.method || 'GET';
    calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (url.endsWith('/wp-json/?_fields=namespaces')) return opts.namespaces ? json({ namespaces: opts.namespaces }) : json({}, 403);
    for (const [part, status] of Object.entries(opts.status ?? {})) if (url.includes(part) && method !== 'GET') return json({ code: 'rest_forbidden' }, status);
    if (url.includes('context=edit')) return json({ meta: { slim_seo: opts.slimSeo ?? {} } });
    return json({ ok: true });
  };
  return { fetcher, calls, writes: () => calls.filter((c) => c.method !== 'GET') };
}

const base = { wpUrl: 'https://example.com', creds: 'eDp5', postId: 2803, isPage: false, title: 'หัวข้อ SEO', description: 'คำอธิบาย' };

async function main() {
  console.log('ตรวจจาก HTML / namespaces');
  {
    assert(detectSeoPluginsFromHtml('<!-- All in One SEO 4.8 - aioseo.com -->').join() === 'aioseo', 'คอมเมนต์ AIOSEO');
    assert(detectSeoPluginsFromHtml('<!-- This site is optimized with the Yoast SEO plugin -->').join() === 'yoast', 'คอมเมนต์ Yoast');
    assert(detectSeoPluginsFromHtml('<!-- Search Engine Optimization by Rank Math -->').join() === 'rankmath', 'คอมเมนต์ Rank Math');
    assert(detectSeoPluginsFromHtml('<link href="/wp-content/plugins/wp-seopress/x.css">').join() === 'seopress', 'path ปลั๊กอิน SEOPress');
    assert(detectSeoPluginsFromHtml('<p>ไม่มีอะไร</p>').length === 0, 'ไม่มีร่องรอย = ว่าง');
    assert(detectSeoPluginsFromNamespaces(['wp/v2', 'aioseo/v1', 'rankmath/v1']).join() === 'rankmath,aioseo', 'namespace หลายตัว เรียงตามลำดับที่กำหนด');
    assert(detectSeoPluginsFromNamespaces('x').length === 0, 'namespaces ไม่ใช่ array = ว่าง');
    assert(!seoPluginNote([]).warn && seoPluginNote([]).text.includes('เหมือนเดิม'), 'ไม่เจอปลั๊กอิน = ข้อความเหมือนเดิม ไม่เตือน');
    assert(seoPluginNote(['tsf']).warn, 'มีแต่ตัวที่เขียนไม่ได้ = เตือน');
  }

  console.log('เว็บเดิม (ไม่มีปลั๊กอิน / Yoast) ไม่โดนยิงเพิ่ม');
  {
    const none = fakeWp({ namespaces: ['wp/v2', 'oembed/1.0'] });
    const r = await syncSeoPluginMeta({ ...base, fetcher: none.fetcher });
    assert(r.plugins.length === 0 && none.writes().length === 0 && !r.warning, 'ไม่มีปลั๊กอิน SEO = ไม่เขียนอะไร ไม่เตือน');
    assert(none.calls.length === 1, 'อ่าน /wp-json/ ครั้งเดียว');
    const yoast = fakeWp({ namespaces: ['wp/v2', 'yoast/v1'] });
    const ry = await syncSeoPluginMeta({ ...base, fetcher: yoast.fetcher });
    assert(ry.plugins.join() === 'yoast' && yoast.writes().length === 0 && !ry.warning, 'Yoast = ไฟล์นี้ไม่แตะ (wp-push ส่งแบบเดิม)');
  }

  console.log('เขียนลงช่องของแต่ละปลั๊กอิน');
  {
    const aio = fakeWp({ namespaces: ['wp/v2', 'aioseo/v1'] });
    const r = await syncSeoPluginMeta({ ...base, fetcher: aio.fetcher });
    const w = aio.writes();
    assert(r.written.join() === 'aioseo' && w.length === 1, 'AIOSEO เขียน 1 คำขอ');
    assert(w[0].url === 'https://example.com/wp-json/wp/v2/posts/2803' && JSON.stringify(w[0].body) === JSON.stringify({ aioseo_meta_data: { title: 'หัวข้อ SEO', description: 'คำอธิบาย' } }), 'AIOSEO = aioseo_meta_data ของ wp/v2 แยกจากคำขอสร้างโพสต์');
    const page = fakeWp({ namespaces: ['aioseo/v1'] });
    await syncSeoPluginMeta({ ...base, isPage: true, fetcher: page.fetcher });
    assert(page.writes()[0].url.endsWith('/wp/v2/pages/2803'), 'เพจใช้ endpoint pages');

    const rm = fakeWp({ namespaces: ['rankmath/v1'] });
    await syncSeoPluginMeta({ ...base, description: '', fetcher: rm.fetcher });
    const rw = rm.writes()[0];
    assert(rw.url.endsWith('/rankmath/v1/updateMeta') && rw.body?.objectID === 2803 && rw.body?.objectType === 'post', 'Rank Math = updateMeta');
    assert(JSON.stringify(rw.body?.meta) === JSON.stringify({ rank_math_title: 'หัวข้อ SEO' }), 'ค่าว่างไม่ส่ง — Rank Math ลบค่าเดิมถ้าส่งว่าง');

    const sp = fakeWp({ namespaces: ['seopress/v1'] });
    await syncSeoPluginMeta({ ...base, fetcher: sp.fetcher });
    assert(sp.writes()[0].method === 'PUT' && sp.writes()[0].url.endsWith('/seopress/v1/posts/2803/title-description-metas'), 'SEOPress = PUT title-description-metas');

    const slim = fakeWp({ namespaces: ['slim-seo'], slimSeo: { canonical: 'https://example.com/a/', noindex: 1, title: 'เก่า' } });
    await syncSeoPluginMeta({ ...base, fetcher: slim.fetcher });
    const sw = slim.writes()[0];
    assert(JSON.stringify(sw.body) === JSON.stringify({ meta: { slim_seo: { canonical: 'https://example.com/a/', noindex: 1, title: 'หัวข้อ SEO', description: 'คำอธิบาย' } } }), 'Slim SEO รวมกับค่าเดิม — canonical/noindex ไม่หาย');

    const long = fakeWp({ namespaces: ['aioseo/v1'] });
    await syncSeoPluginMeta({ ...base, description: 'ก'.repeat(300), fetcher: long.fetcher });
    assert(((long.writes()[0].body?.aioseo_meta_data as { description: string }).description).length === 160, 'description ตัดที่ 160');

    const empty = fakeWp({ namespaces: ['aioseo/v1'] });
    const re = await syncSeoPluginMeta({ ...base, title: null, description: undefined, fetcher: empty.fetcher });
    assert(re.plugins.join() === 'aioseo' && empty.writes().length === 0, 'ไม่มี title/description = ไม่เขียน');
  }

  console.log('อ่าน /wp-json/ ไม่ได้ / ล้ม / ตัวที่เขียนไม่ได้');
  {
    const blocked = fakeWp({ namespaces: null });
    const r = await syncSeoPluginMeta({ ...base, hint: ['aioseo', 'ของแปลก'], fetcher: blocked.fetcher });
    assert(r.written.join() === 'aioseo', 'REST อ่านไม่ได้ = ใช้ผลสแกนที่เก็บไว้ (กรองค่าแปลกทิ้ง)');
    const fromPost = fakeWp({ namespaces: null });
    const rp = await syncSeoPluginMeta({ ...base, post: { id: 2803, aioseo_meta_data: {} }, fetcher: fromPost.fetcher });
    assert(rp.written.join() === 'aioseo', 'ร่องรอยใน response ของโพสต์ก็ใช้ได้');
    const nsWins = fakeWp({ namespaces: ['wp/v2'] });
    const rn = await syncSeoPluginMeta({ ...base, hint: ['rankmath'], fetcher: nsWins.fetcher });
    assert(rn.plugins.length === 0 && nsWins.writes().length === 0, 'อ่าน /wp-json/ ได้ = เชื่อของจริง ไม่ใช้ผลสแกนเก่า');

    const denied = fakeWp({ namespaces: ['aioseo/v1'], status: { '/wp/v2/posts/': 403 } });
    const rd = await syncSeoPluginMeta({ ...base, fetcher: denied.fetcher });
    assert(rd.written.length === 0 && !!rd.warning?.includes('All in One SEO') && !!rd.warning?.includes('HTTP 403'), 'ไม่มีสิทธิ์ = เตือน ไม่ throw');

    const tsf = fakeWp({ namespaces: ['wp/v2'] });
    const rt = await syncSeoPluginMeta({ ...base, post: {}, fetcher: tsf.fetcher });
    assert(!rt.warning, 'ไม่มีอะไรเลย = ไม่เตือน');
    const tsfOnly = fakeWp({ namespaces: null });
    const rto = await syncSeoPluginMeta({ ...base, hint: ['tsf'], fetcher: tsfOnly.fetcher });
    assert(tsfOnly.writes().length === 0 && !!rto.warning?.includes('กรอกเองในหลังบ้าน'), 'The SEO Framework = เตือนให้กรอกเอง');

    const throws = async (): Promise<Response> => { throw new Error('network down'); };
    const rx = await syncSeoPluginMeta({ ...base, hint: ['aioseo'], fetcher: throws });
    assert(rx.written.length === 0 && !!rx.warning?.includes('network down'), 'เน็ตล่ม = เตือน ไม่ throw');
  }

  console.log(`\n${passed} passed`);
}

main().catch((e) => { console.error(e); process.exit(1); });
