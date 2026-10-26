/**
 * Regression: ติ๊ก Elementor แล้วต้องเป็นเอกสาร Elementor จริง และหน้าเว็บต้องแสดงเวอร์ชันที่เพิ่ง push (mfactors 2026-10-26)
 * Elementor แสดงผลจาก cache ของตัวเอง ซึ่งการเขียน meta ผ่าน REST ไม่ล้าง — ต้องตรวจหน้าเว็บจริง ล้าง cache หรือถอยกลับโหมดปกติ
 * Run: npx tsx src/lib/upload-article/elementor-sync.test.ts
 */
import {
  syncElementorDocument, applyElementorMode, buildElementorData,
  ELEMENTOR_STUCK_WARNING, ELEMENTOR_WRITE_WARNING, ELEMENTOR_NOT_APPLIED_WARNING,
  ELEMENTOR_STALE_WARNING, ELEMENTOR_UNSUPPORTED_WARNING, ELEMENTOR_PLUGIN_STALE_WARNING,
} from './wp-push';

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  passed++;
  console.log(`  ✓ ${msg}`);
}

const OLD_DATA = buildElementorData('<p>เก่า</p>', 'old0000');

/**
 * WordPress ปลอม — เก็บ meta ของโพสต์เดียว, จด request ทุกตัว
 * หน้าเว็บจริง: โหมด builder = แสดง widget จาก cache ของ Elementor (ค้างที่ data เก่าจนกว่าจะล้าง cache)
 */
function fakeWp(opts: {
  meta: Record<string, unknown> | null
  rejectMeta?: string[]
  readFails?: boolean
  /** อ่าน meta ได้แค่ n ครั้งแรก — จำลอง REST ล้มกลางทาง */
  readFailAfter?: number
  /** cache ของ Elementor ค้างที่ data ตอนเริ่ม */
  staleCache?: boolean
  /** cache ค้างที่ data ชุดนี้ (เว็บที่ REST ไม่เปิด meta ของ Elementor) */
  staleCacheData?: string
  /** Elementor ใส่แค่ class elementor-element-<id> ไม่มี data-id */
  classOnly?: boolean
  /** <style> ของหน้ามี selector ของ data ชุดล่าสุด ทั้งที่ HTML ยังเป็น cache เก่า */
  styleHasCurrentIds?: boolean
  /** DELETE /elementor/v1/cache — ok = ล้างได้ */
  cacheClear?: 'ok' | 'denied' | 'no-effect'
  pageUnreachable?: boolean
  plugin?: boolean
}) {
  const meta = opts.meta ? { ...opts.meta } : null;
  let cachedData: unknown = opts.staleCacheData ?? (opts.staleCache ? meta?._elementor_data : null);
  let reads = 0;
  const calls: { method: string; url: string; body?: Record<string, unknown> }[] = [];
  const pageUrls: string[] = [];
  const fetcher = async (url: string, init: RequestInit): Promise<Response> => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    if (url.endsWith('/wp-json/elementor/v1/cache')) {
      if (opts.cacheClear === 'denied' || !opts.cacheClear) return new Response('{}', { status: 403 });
      if (opts.cacheClear === 'ok') cachedData = null;
      return new Response('true', { status: 200 });
    }
    if (url.includes('/convert-cake/')) {
      if (!opts.plugin) return new Response('{}', { status: 404 });
      // ปลั๊กอินจริงเขียนผ่าน update_post_meta — ไม่ติดสิทธิ์ meta ของ REST
      if (meta && body) {
        meta._elementor_edit_mode = body.edit_mode;
        meta._elementor_template_type = body.template_type;
        meta._elementor_data = Buffer.from(String(body.elementor_data_b64), 'base64').toString();
      }
      return new Response('{}', { status: 200 });
    }
    if (method === 'GET') {
      reads++;
      if (opts.readFails || (opts.readFailAfter != null && reads > opts.readFailAfter)) return new Response('{}', { status: 401 });
      return new Response(JSON.stringify(meta ? { meta } : {}), { status: 200 });
    }
    const patch = (body?.meta ?? {}) as Record<string, unknown>;
    if (Object.keys(patch).some((k) => opts.rejectMeta?.includes(k))) return new Response('{}', { status: 403 });
    if (meta) Object.assign(meta, patch);
    return new Response('{}', { status: 200 });
  };
  const pageFetcher = async (url: string): Promise<string | null> => {
    pageUrls.push(url);
    if (opts.pageUnreachable) return null;
    if (meta?._elementor_edit_mode !== 'builder') return '<article><p>post_content</p></article>';
    const idsOf = (data: unknown) => {
      const ids: string[] = [];
      const walk = (els: { id?: string; elements?: unknown[] }[]) => els.forEach((e) => {
        if (e.id) ids.push(e.id);
        walk((e.elements ?? []) as { id?: string; elements?: unknown[] }[]);
      });
      walk(JSON.parse(String(data ?? '[]')));
      return ids;
    };
    const ids = idsOf(cachedData ?? meta._elementor_data);
    const style = opts.styleHasCurrentIds
      ? `<style>${idsOf(meta._elementor_data).map((id) => `.elementor-element.elementor-element-${id}{}`).join('')}</style>`
      : '';
    const el = (id: string) => opts.classOnly
      ? `<div class="elementor-element elementor-element-${id} elementor-widget"></div>`
      : `<div class="elementor-element elementor-element-${id}" data-id="${id}"></div>`;
    return `${style}<div class="elementor">${ids.map(el).join('')}</div>`;
  };
  return { fetcher, pageFetcher, calls, meta, pageUrls };
}

const base = { wpUrl: 'https://example.com', creds: 'x', postId: 5248, isPage: false, html: '<p>ใหม่</p>' };
const live = 'https://example.com/article/';
const widgetOf = (data: unknown) => JSON.parse(String(data))[0].elements[0].elements[0];
const cacheCalls = (calls: { url: string }[]) => calls.filter((c) => c.url.endsWith('/elementor/v1/cache')).length;

async function main() {
  console.log('buildElementorData');
  {
    const data = JSON.parse(buildElementorData('<p>x</p>', 'abc1234'));
    assert(data[0].settings.layout === 'full_width' && data[0].settings.gap === 'no', 'section เต็มความกว้าง ไม่มีช่องไฟ — หน้าตาเท่าตอนไม่ใช้ Elementor');
    assert(data[0].elements[0].elements[0].id === 'abc1234', 'id ของ widget ใช้เป็นตัวตรวจหน้าเว็บ');
    assert(data[0].elements[0].elements[0].widgetType === 'html', 'HTML widget ไม่ใช่ Text Editor');
  }

  console.log('ไม่ใช้ Elementor + โพสต์ถูกเปิดใน Elementor');
  {
    const wp = fakeWp({ meta: { _elementor_edit_mode: 'builder', _elementor_data: OLD_DATA } });
    const r = await syncElementorDocument({ ...base, useElementor: false, fetcher: wp.fetcher });
    assert(r.supported && !r.warning, 'สลับกลับสำเร็จ ไม่มีคำเตือน');
    assert(wp.meta?._elementor_edit_mode === '', 'ออกจากโหมด builder');
    assert(widgetOf(wp.meta?._elementor_data).settings.html === base.html, 'แทนข้อมูล Elementor เก่าด้วย HTML widget ชุดใหม่');
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
    const w = fakeWp({ meta: { _elementor_edit_mode: 'builder' }, rejectMeta: ['_elementor_data'] });
    const r2 = await syncElementorDocument({ ...base, useElementor: false, fetcher: w.fetcher });
    assert(r2.warning === ELEMENTOR_WRITE_WARNING && w.meta?._elementor_edit_mode === '', 'data ถูกปฏิเสธ แต่ยังออกจาก builder ได้');
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

  console.log('ใช้ Elementor + โพสต์ใหม่ที่ publish แล้ว');
  {
    const wp = fakeWp({ meta: { _elementor_edit_mode: '' }, cacheClear: 'ok' });
    const r = await syncElementorDocument({ ...base, useElementor: true, liveUrl: live, fetcher: wp.fetcher, pageFetcher: wp.pageFetcher });
    assert(r.supported && r.builder === true && !r.warning, 'เป็นเอกสาร Elementor ไม่มีคำเตือน');
    assert(wp.meta?._elementor_edit_mode === 'builder', 'โหมด builder');
    assert(wp.meta?._elementor_template_type === 'wp-post', 'template type = wp-post');
    const widget = widgetOf(wp.meta?._elementor_data);
    assert(widget.widgetType === 'html' && widget.settings.html === base.html, 'HTML ชุดเดียวกับ content อยู่ใน widget');
    assert(wp.pageUrls[0] === `${live}?mars_v=${widget.id}`, 'เปิดหน้าเว็บจริงพร้อม query กัน page cache');
    assert(cacheCalls(wp.calls) === 0, 'หน้าเว็บถูกแล้ว = ไม่ล้าง cache ทั้งเว็บ');
    const dataIdx = wp.calls.findIndex((c) => (c.body?.meta as Record<string, unknown> | undefined)?._elementor_data);
    const builderIdx = wp.calls.findIndex((c) => (c.body?.meta as Record<string, unknown> | undefined)?._elementor_edit_mode === 'builder');
    assert(dataIdx >= 0 && dataIdx < builderIdx, 'เขียน data ก่อนเปิด builder');
  }

  console.log('ใช้ Elementor + re-push โพสต์ Elementor เดิม (cache ค้าง)');
  {
    const wp = fakeWp({ meta: { _elementor_edit_mode: 'builder', _elementor_data: OLD_DATA }, staleCache: true, cacheClear: 'ok' });
    const r = await syncElementorDocument({ ...base, useElementor: true, isUpdate: true, liveUrl: live, fetcher: wp.fetcher, pageFetcher: wp.pageFetcher });
    assert(r.builder === true && !r.warning, 'ล้าง cache แล้วหน้าเว็บเป็นเวอร์ชันใหม่');
    assert(cacheCalls(wp.calls) === 1, 'ล้าง cache ของ Elementor 1 ครั้ง');
    assert(wp.pageUrls.length === 2, 'ตรวจหน้าเว็บซ้ำหลังล้าง cache');
    assert(wp.meta?._elementor_edit_mode === 'builder', 'ยังเป็นเอกสาร Elementor');
  }

  console.log('ใช้ Elementor + cache ค้าง ล้างไม่ได้');
  for (const cacheClear of ['denied', 'no-effect'] as const) {
    const wp = fakeWp({ meta: { _elementor_edit_mode: 'builder', _elementor_data: OLD_DATA }, staleCache: true, cacheClear });
    const r = await syncElementorDocument({ ...base, useElementor: true, isUpdate: true, liveUrl: live, fetcher: wp.fetcher, pageFetcher: wp.pageFetcher });
    assert(r.builder === false && r.warning === ELEMENTOR_STALE_WARNING, `${cacheClear}: เตือนว่าถอยกลับโหมดปกติ`);
    assert(wp.meta?._elementor_edit_mode === '', `${cacheClear}: ออกจาก builder — หน้าเว็บแสดงเวอร์ชันใหม่ ไม่ค้างของเก่า`);
    assert(widgetOf(wp.meta?._elementor_data).settings.html === base.html, `${cacheClear}: data ใหม่ยังอยู่ กด Edit with Elementor ได้เวอร์ชันนี้`);
  }

  console.log('ใช้ Elementor + ถอยกลับไม่ได้');
  {
    const wp = fakeWp({ meta: { _elementor_edit_mode: 'builder', _elementor_data: OLD_DATA }, staleCache: true, cacheClear: 'denied', rejectMeta: ['_elementor_edit_mode'] });
    const r = await syncElementorDocument({ ...base, useElementor: true, isUpdate: true, liveUrl: live, fetcher: wp.fetcher, pageFetcher: wp.pageFetcher });
    assert(r.warning === ELEMENTOR_STUCK_WARNING, 'ค้าง builder + cache เก่า = เตือน STUCK (ไปลองปลั๊กอินต่อ)');
  }

  console.log('ใช้ Elementor + ตรวจหน้าเว็บไม่ได้');
  {
    const upd = fakeWp({ meta: { _elementor_edit_mode: 'builder', _elementor_data: OLD_DATA }, cacheClear: 'ok', pageUnreachable: true });
    const r1 = await syncElementorDocument({ ...base, useElementor: true, isUpdate: true, liveUrl: live, fetcher: upd.fetcher, pageFetcher: upd.pageFetcher });
    assert(r1.builder === true && !r1.warning && cacheCalls(upd.calls) === 1, 're-push = ล้าง cache ไว้ก่อน');
    const draft = fakeWp({ meta: { _elementor_edit_mode: 'builder', _elementor_data: OLD_DATA }, cacheClear: 'ok' });
    const r2 = await syncElementorDocument({ ...base, useElementor: true, isUpdate: true, fetcher: draft.fetcher, pageFetcher: draft.pageFetcher });
    assert(r2.builder === true && cacheCalls(draft.calls) === 1 && draft.pageUrls.length === 0, 'draft re-push = ไม่เปิดหน้าเว็บ แต่ล้าง cache');
    const fresh = fakeWp({ meta: { _elementor_edit_mode: '' }, cacheClear: 'ok' });
    const r3 = await syncElementorDocument({ ...base, useElementor: true, fetcher: fresh.fetcher, pageFetcher: fresh.pageFetcher });
    assert(r3.builder === true && cacheCalls(fresh.calls) === 0, 'โพสต์ใหม่ draft = ไม่ล้าง cache ทั้งเว็บ');
  }

  console.log('ใช้ Elementor + เว็บไม่ยอมให้เขียน');
  {
    const wp = fakeWp({ meta: { _elementor_edit_mode: '' }, rejectMeta: ['_elementor_data'] });
    const r = await syncElementorDocument({ ...base, useElementor: true, liveUrl: live, fetcher: wp.fetcher, pageFetcher: wp.pageFetcher });
    assert(r.warning === ELEMENTOR_NOT_APPLIED_WARNING && wp.meta?._elementor_edit_mode === '', 'data ไม่เข้า = ไม่เปิด builder (หน้าเว็บไม่ว่าง)');
    const was = fakeWp({ meta: { _elementor_edit_mode: 'builder', _elementor_data: OLD_DATA }, rejectMeta: ['_elementor_data'] });
    const r2 = await syncElementorDocument({ ...base, useElementor: true, liveUrl: live, fetcher: was.fetcher, pageFetcher: was.pageFetcher });
    assert(r2.warning === ELEMENTOR_NOT_APPLIED_WARNING && was.meta?._elementor_edit_mode === '', 'โพสต์ Elementor เดิม + data ไม่เข้า = ออกจาก builder ไม่ค้างของเก่า');
    const noBuilder = fakeWp({ meta: { _elementor_edit_mode: '' }, rejectMeta: ['_elementor_edit_mode'] });
    const r3 = await syncElementorDocument({ ...base, useElementor: true, fetcher: noBuilder.fetcher, pageFetcher: noBuilder.pageFetcher });
    assert(r3.warning === ELEMENTOR_NOT_APPLIED_WARNING, 'เปิด builder ไม่ได้ = เตือน');
  }

  console.log('applyElementorMode — ปลั๊กอิน convert-cake');
  {
    const noRest = fakeWp({ meta: { footnotes: '' }, plugin: true });
    const w1 = await applyElementorMode({ ...base, useElementor: true, yoastMeta: {}, fetcher: noRest.fetcher, pageFetcher: noRest.pageFetcher });
    assert(w1 === undefined && noRest.calls.some((c) => c.url.includes('/convert-cake/v1/elementor-meta')), 'REST ไม่มี = ใช้ปลั๊กอิน');
    const nothing = fakeWp({ meta: { footnotes: '' } });
    const w2 = await applyElementorMode({ ...base, useElementor: true, yoastMeta: {}, fetcher: nothing.fetcher, pageFetcher: nothing.pageFetcher });
    assert(w2 === ELEMENTOR_UNSUPPORTED_WARNING, 'ไม่มีทั้ง REST และปลั๊กอิน = เตือน ไม่เงียบ');
    const ok = fakeWp({ meta: { _elementor_edit_mode: '' }, plugin: true });
    const w3 = await applyElementorMode({ ...base, useElementor: true, liveUrl: live, yoastMeta: {}, fetcher: ok.fetcher, pageFetcher: ok.pageFetcher });
    assert(w3 === undefined && !ok.calls.some((c) => c.url.includes('/convert-cake/')), 'REST สำเร็จ = ไม่เรียกปลั๊กอิน');
    const off = fakeWp({ meta: { footnotes: '' }, plugin: true });
    const w4 = await applyElementorMode({ ...base, useElementor: false, yoastMeta: {}, fetcher: off.fetcher, pageFetcher: off.pageFetcher });
    assert(w4 === undefined && !off.calls.some((c) => c.url.includes('/convert-cake/')), 'ไม่ติ๊ก Elementor = applyElementorMode ไม่เรียกปลั๊กอิน (ไม่ตั้ง builder ให้เอง)');
    const stale = fakeWp({ meta: { _elementor_edit_mode: 'builder', _elementor_data: OLD_DATA }, staleCache: true, cacheClear: 'denied', plugin: true });
    const w5 = await applyElementorMode({ ...base, useElementor: true, isUpdate: true, liveUrl: live, yoastMeta: {}, fetcher: stale.fetcher, pageFetcher: stale.pageFetcher });
    assert(w5 === ELEMENTOR_STALE_WARNING && !stale.calls.some((c) => c.url.includes('/convert-cake/')), 'ถอยกลับโหมดปกติแล้ว = ไม่ให้ปลั๊กอินเปิด builder ทับ');
  }

  console.log('ตรวจหน้าเว็บ: class แทน data-id / selector ใน <style> ไม่นับ');
  {
    const cls = fakeWp({ meta: { _elementor_edit_mode: '' }, classOnly: true });
    const r1 = await syncElementorDocument({ ...base, useElementor: true, liveUrl: live, fetcher: cls.fetcher, pageFetcher: cls.pageFetcher });
    assert(r1.builder === true && !r1.warning && cacheCalls(cls.calls) === 0, 'Elementor ไม่ใส่ data-id ก็ตรวจจาก class elementor-element-<id> ได้');
    const css = fakeWp({ meta: { _elementor_edit_mode: 'builder', _elementor_data: OLD_DATA }, staleCache: true, cacheClear: 'denied', styleHasCurrentIds: true });
    const r2 = await syncElementorDocument({ ...base, useElementor: true, isUpdate: true, liveUrl: live, fetcher: css.fetcher, pageFetcher: css.pageFetcher });
    assert(r2.warning === ELEMENTOR_STALE_WARNING && css.meta?._elementor_edit_mode === '', 'CSS ใหม่แต่ HTML ยังเก่า = ยังถือว่าค้าง');
  }

  console.log('ใช้ Elementor + re-push draft + ล้าง cache ไม่ได้');
  {
    const wp = fakeWp({ meta: { _elementor_edit_mode: 'builder', _elementor_data: OLD_DATA }, staleCache: true, cacheClear: 'denied' });
    const r = await syncElementorDocument({ ...base, useElementor: true, isUpdate: true, fetcher: wp.fetcher, pageFetcher: wp.pageFetcher });
    assert(r.warning === ELEMENTOR_STALE_WARNING && wp.meta?._elementor_edit_mode === '', 'ยืนยันไม่ได้ + ล้างไม่ได้ = กลับโหมดปกติ ไม่รอค้างตอน publish');
  }

  console.log('อ่าน meta ไม่ได้กลางทาง');
  {
    const on = fakeWp({ meta: { _elementor_edit_mode: '' }, readFailAfter: 2 });
    const r1 = await syncElementorDocument({ ...base, useElementor: true, liveUrl: live, fetcher: on.fetcher, pageFetcher: on.pageFetcher });
    assert(r1.warning === ELEMENTOR_STUCK_WARNING, 'เปิด builder แล้วอ่านสถานะไม่ได้ = ไม่ถือว่าสำเร็จ');
    const off = fakeWp({ meta: { _elementor_edit_mode: 'builder', _elementor_data: OLD_DATA }, readFailAfter: 1 });
    const r2 = await syncElementorDocument({ ...base, useElementor: false, fetcher: off.fetcher });
    assert(r2.warning === ELEMENTOR_STUCK_WARNING, 'ไม่ติ๊ก + อ่านสถานะหลังสลับไม่ได้ = เตือน ไม่เงียบ');
  }

  console.log('applyElementorMode — ปลั๊กอินเป็นทางสำรอง');
  {
    const restRefused = fakeWp({ meta: { _elementor_edit_mode: '' }, rejectMeta: ['_elementor_data'], plugin: true });
    const w1 = await applyElementorMode({ ...base, useElementor: true, liveUrl: live, yoastMeta: {}, fetcher: restRefused.fetcher, pageFetcher: restRefused.pageFetcher });
    assert(w1 === undefined && restRefused.meta?._elementor_edit_mode === 'builder', 'REST ไม่รับ data = ปลั๊กอินเขียนแทน เป็นเอกสาร Elementor');
    assert(widgetOf(restRefused.meta?._elementor_data).settings.html === base.html, 'data จากปลั๊กอินเป็น HTML ชุดเดียวกัน');
    const stuck = fakeWp({ meta: { _elementor_edit_mode: 'builder', _elementor_data: OLD_DATA }, staleCache: true, cacheClear: 'denied', rejectMeta: ['_elementor_edit_mode'], plugin: true });
    const w2 = await applyElementorMode({ ...base, useElementor: true, isUpdate: true, liveUrl: live, yoastMeta: {}, fetcher: stuck.fetcher, pageFetcher: stuck.pageFetcher });
    assert(w2 === ELEMENTOR_STUCK_WARNING, 'ค้าง builder + ปลั๊กอินก็ไม่ช่วย = ยังเตือน STUCK ไม่กลืนคำเตือน');
    const fixed = fakeWp({ meta: { _elementor_edit_mode: 'builder', _elementor_data: OLD_DATA }, staleCache: true, cacheClear: 'ok', rejectMeta: ['_elementor_edit_mode', '_elementor_data'], plugin: true });
    const w3 = await applyElementorMode({ ...base, useElementor: true, isUpdate: true, liveUrl: live, yoastMeta: {}, fetcher: fixed.fetcher, pageFetcher: fixed.pageFetcher });
    assert(w3 === undefined && fixed.meta?._elementor_edit_mode === 'builder', 'ค้าง builder + ปลั๊กอินเขียนชุดใหม่ + ล้าง cache ได้ = สำเร็จ');
    const noRest = fakeWp({ meta: { footnotes: '' }, staleCacheData: OLD_DATA, cacheClear: 'denied', plugin: true });
    const w4 = await applyElementorMode({ ...base, useElementor: true, isUpdate: true, liveUrl: live, yoastMeta: {}, fetcher: noRest.fetcher, pageFetcher: noRest.pageFetcher });
    assert(w4 === ELEMENTOR_PLUGIN_STALE_WARNING, 'REST ไม่มี + ปลั๊กอินเขียนแล้วแต่หน้าเว็บค้าง = เตือนให้ Regenerate');
    const noRestOk = fakeWp({ meta: { footnotes: '' }, plugin: true });
    const w5 = await applyElementorMode({ ...base, useElementor: true, liveUrl: live, yoastMeta: {}, fetcher: noRestOk.fetcher, pageFetcher: noRestOk.pageFetcher });
    assert(w5 === undefined && noRestOk.pageUrls.length === 1, 'REST ไม่มี + ปลั๊กอิน = ตรวจหน้าเว็บด้วย');
  }

  console.log(`\n${passed} passed`);
}

main().catch((e) => { console.error(e); process.exit(1); });
