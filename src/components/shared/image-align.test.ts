/**
 * Regression: ปุ่มจัดวางจัดรูปไม่ได้ (2026-10-29) — Tailwind preflight ทำ img เป็น block, text-align ของ figure จึงไม่มีผล
 * วัดตำแหน่งจริงใน Chromium (Playwright)
 * Run: npx tsx src/components/shared/image-align.test.ts
 */
import { chromium } from 'playwright';
import { alignImage } from './image-align';

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  passed++;
  console.log(`  ✓ ${msg}`);
}

const IMG = `<img src="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"></svg>')}" alt="x">`;
const PAGE = (css: string, body: string) =>
  `<!doctype html><style>body{margin:0}figure{margin:0}#root{width:600px;padding:0}${css}</style><div id="root" contenteditable>${body}</div>`;
const PREFLIGHT = 'img{display:block;max-width:100%;height:auto}';
const ARTICLE = '.content-figure{margin:0;text-align:center}';

async function main() {
  // เครื่องที่ยังไม่ได้ npx playwright install ใช้ Google Chrome ที่ติดตั้งไว้
  const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
  const page = await browser.newPage();
  const fnSrc = alignImage.toString();

  // จัดรูปที่ selector ตามลำดับ แล้วคืน x / ความกว้างของรูป + style ที่ได้
  async function run(css: string, body: string, steps: string[], opts: { stripDisplay?: boolean; sel?: string } = {}) {
    await page.setContent(PAGE(css, body));
    await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete));
    return page.evaluate(({ fnSrc, steps, opts }) => {
      const alignImage = new Function(`return (${fnSrc})`)();
      const root = document.getElementById('root')!;
      const img = root.querySelector<HTMLElement>(opts.sel || 'img')!;
      for (const s of steps) alignImage(img, s, root);
      if (opts.stripDisplay) img.style.removeProperty('display');
      const r = img.getBoundingClientRect();
      return { x: Math.round(r.left), w: Math.round(r.width), html: root.innerHTML };
    }, { fnSrc, steps, opts });
  }

  const FIG = `<figure class="content-figure">${IMG}</figure>`;

  console.log('สาเหตุเดิม');
  {
    const r = await run(PREFLIGHT + ARTICLE, FIG, []);
    assert(r.x === 0, 'preflight ทำ img เป็น block → figure text-align:center แล้วรูปยังชิดซ้าย');
  }

  console.log('จัดรูปใน figure');
  {
    assert((await run(PREFLIGHT + ARTICLE, FIG, ['center'])).x === 200, 'กึ่งกลาง');
    assert((await run(PREFLIGHT + ARTICLE, FIG, ['right'])).x === 400, 'ชิดขวา');
    assert((await run(PREFLIGHT + ARTICLE, FIG, ['center', 'left'])).x === 0, 'กลับชิดซ้าย');
    const full = await run(PREFLIGHT + ARTICLE, FIG, ['full']);
    assert(full.w === 600 && full.x === 0, 'เต็มแนว = กว้างเต็มบทความ');
    const back = await run(PREFLIGHT + ARTICLE, FIG, ['full', 'center']);
    assert(back.w === 200 && back.x === 200, 'เต็มแนวแล้วกลับกึ่งกลาง = ขนาดเดิม');
    const r = await run('', FIG, ['center']);
    assert(r.x === 200 && /<figure class="content-figure" style="text-align: center;">/.test(r.html), 'โหมด clean (ไม่มี CSS) ก็จัดได้ + text-align ไปอยู่ที่ figure');
  }

  console.log('รอดเมื่อเว็บตัด display ทิ้ง');
  {
    assert((await run('', FIG, ['center'], { stripDisplay: true })).x === 200, 'img inline → text-align ของ figure จัดให้');
    assert((await run(PREFLIGHT, FIG, ['right'], { stripDisplay: true })).x === 400, 'ธีมทำ img เป็น block → margin จัดให้');
  }

  console.log('รูปไม่มี figure');
  {
    const r = await run(PREFLIGHT, `<p>ข้อความ ${IMG}</p>`, ['center']);
    assert(r.x === 200, 'รูปใน <p> จัดกึ่งกลางได้');
    assert(r.html.startsWith('<p>ข้อความ'), 'ไม่แตะ text-align ของย่อหน้า');
  }

  console.log('CSS ของ editor');
  {
    const r = await run(PREFLIGHT + ARTICLE + '#root img{display:inline;}', FIG, []);
    assert(r.x === 200, 'คืน img เป็น inline → รูปเดิมที่ CSS บทความจัดกลางไว้ เห็นกลางใน editor เหมือนบนเว็บ');
  }

  await browser.close();
  console.log(`\n${passed} passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
