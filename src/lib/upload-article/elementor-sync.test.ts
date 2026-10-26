/**
 * Regression: Re-push ไม่เห็นผลบนเว็บ เพราะโพสต์ถูกเปิดแก้ด้วย Elementor (mfactors 2026-10-26)
 * Elementor แสดง _elementor_data แทน post_content — push ต้องออกจากโหมด builder หรือเขียน data ใหม่เอง
 * Run: npx tsx src/lib/upload-article/elementor-sync.test.ts
 */
import { syncElementorDocument, ELEMENTOR_STUCK_WARNING, ELEMENTOR_WRITE_WARNING } from './wp-push';

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  passed++;
  console.log(`  ✓ ${msg}`);
}

/** WordPress ปลอม — เก็บ meta ของโพสต์เดียว, จด request ทุกตัว */
function fakeWp(opts: { meta: Record<string, unknown> | null; rejectMeta?: string[]; readFails?: boolean }) {
  const meta = opts.meta ? { ...opts.meta } : null;
  const calls: { method: string; url: string; body?: Record<string, unknown> }[] = [];
  const fetcher = async (url: string, init: RequestInit): Promise<Response> => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    if (method === 'GET') {
      if (opts.readFails) return new Response('{}', { status: 401 });
      return new Response(JSON.stringify(meta ? { meta } : {}), { status: 200 });
    }
    const patch = (body?.meta ?? {}) as Record<string, unknown>;
    if (Object.keys(patch).some((k) => opts.rejectMeta?.includes(k))) return new Response('{}', { status: 403 });
    if (meta) Object.assign(meta, patch);
    return new Response('{}', { status: 200 });
  };
  return { fetcher, calls, meta };
}

const base = { wpUrl: 'https://example.com', creds: 'x', postId: 5248, isPage: false, html: '<p>ใหม่</p>' };

async function main() {
  console.log('ไม่ใช้ Elementor + โพสต์ถูกเปิดใน Elementor');
  {
    const wp = fakeWp({ meta: { _elementor_edit_mode: 'builder', _elementor_data: '[{"old":1}]' } });
    const r = await syncElementorDocument({ ...base, useElementor: false, fetcher: wp.fetcher });
    assert(r.supported && !r.warning, 'สลับกลับสำเร็จ ไม่มีคำเตือน');
    assert(wp.meta?._elementor_edit_mode === '', 'ออกจากโหมด builder');
    assert(wp.meta?._elementor_data === '', 'ล้างข้อมูล Elementor เก่า');
    assert(wp.calls.some((c) => c.method === 'POST' && c.body && Object.keys(c.body).length === 0), 'แตะโพสต์อีกรอบให้ cache ล้าง');
    assert(wp.calls.every((c) => c.url.startsWith('https://example.com/wp-json/wp/v2/posts/5248')), 'ยิงแค่ endpoint ของโพสต์นี้');
  }

  console.log('ไม่ใช้ Elementor + โพสต์ปกติ');
  {
    const wp = fakeWp({ meta: { _elementor_edit_mode: '' } });
    const r = await syncElementorDocument({ ...base, useElementor: false, fetcher: wp.fetcher });
    assert(r.supported && !r.warning, 'ไม่มีคำเตือน');
    assert(wp.calls.every((c) => c.method === 'GET'), 'ไม่เขียนอะไรเลย');
  }

  console.log('ไม่ใช้ Elementor + เว็บไม่ยอมให้แก้ meta');
  {
    const wp = fakeWp({ meta: { _elementor_edit_mode: 'builder' }, rejectMeta: ['_elementor_edit_mode', '_elementor_data'] });
    const r = await syncElementorDocument({ ...base, useElementor: false, fetcher: wp.fetcher });
    assert(r.warning === ELEMENTOR_STUCK_WARNING, 'เตือนให้กด "กลับไปใช้ตัวแก้ไข WordPress" เอง');
  }

  console.log('เว็บไม่มี Elementor / อ่าน meta ไม่ได้');
  {
    const none = fakeWp({ meta: { footnotes: '' } });
    const r1 = await syncElementorDocument({ ...base, useElementor: false, fetcher: none.fetcher });
    assert(!r1.supported && !r1.warning, 'ไม่มี meta ของ Elementor = ข้าม');
    assert(none.calls.length === 1, 'ไม่เขียนอะไร');
    const denied = fakeWp({ meta: null, readFails: true });
    const r2 = await syncElementorDocument({ ...base, useElementor: true, fetcher: denied.fetcher });
    assert(!r2.supported, 'อ่านไม่ได้ = supported false (ให้ไปใช้ convert-cake plugin)');
  }

  console.log('ใช้ Elementor');
  {
    const wp = fakeWp({ meta: { _elementor_edit_mode: 'builder', _elementor_data: '[{"old":1}]' } });
    const r = await syncElementorDocument({ ...base, useElementor: true, fetcher: wp.fetcher });
    assert(r.supported && !r.warning, 'เขียนสำเร็จ ไม่มีคำเตือน');
    const data = JSON.parse(String(wp.meta?._elementor_data));
    assert(data[0].elements[0].elements[0].widgetType === 'html', 'ใช้ HTML widget ไม่ใช่ Text Editor');
    assert(data[0].elements[0].elements[0].settings.html === base.html, 'HTML ชุดใหม่อยู่ใน widget');
    assert(wp.meta?._elementor_template_type === 'wp-post', 'template type = wp-post');

    const blocked = fakeWp({ meta: { _elementor_edit_mode: 'builder', _elementor_data: '[{"old":1}]' }, rejectMeta: ['_elementor_data'] });
    const r2 = await syncElementorDocument({ ...base, useElementor: true, fetcher: blocked.fetcher });
    assert(r2.warning === ELEMENTOR_WRITE_WARNING, 'เขียน data ไม่ได้ = เตือน');
  }

  console.log(`\n${passed} passed`);
}

main().catch((e) => { console.error(e); process.exit(1); });
