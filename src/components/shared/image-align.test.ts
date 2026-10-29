/**
 * Regression: ปุ่มจัดวางจัดรูปไม่ได้ (2026-10-29) — Tailwind preflight ทำ img เป็น block, text-align ของ figure จึงไม่มีผล
 * วัดตำแหน่งจริงใน Chromium (Playwright)
 * Run: npx tsx src/components/shared/image-align.test.ts
 */
import { chromium } from 'playwright';
import { alignImage, setImageWidth } from './image-align';

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  passed++;
  console.log(`  ✓ ${msg}`);
}

const svg = (w: number, h: number) =>
  `<img src="data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"></svg>`)}" alt="x">`;
const IMG = svg(200, 100);
// รูป AI 1536×1024 — ใหญ่กว่ากรอบ max-width:100% คุมให้เต็ม
const BIG = svg(1536, 1024);
const PAGE = (css: string, body: string) =>
  `<!doctype html><style>body{margin:0}figure{margin:0}#root{width:600px;padding:0}${css}</style><div id="root" contenteditable>${body}</div>`;
const PREFLIGHT = 'img{display:block;max-width:100%;height:auto}';
const ARTICLE = '.content-figure{margin:0;text-align:center}';

async function main() {
  // เครื่องที่ยังไม่ได้ npx playwright install ใช้ Google Chrome ที่ติดตั้งไว้
  const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
  const page = await browser.newPage();
  const fnSrc = alignImage.toString();
  const wSrc = setImageWidth.toString();

  // จัดรูปที่ selector ตามลำดับ แล้วคืน x / ความกว้างของรูป + style ที่ได้
  async function run(css: string, body: string, steps: string[], opts: { stripDisplay?: boolean; sel?: string } = {}) {
    await page.setContent(PAGE(css, body));
    await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete));
    return page.evaluate(({ fnSrc, wSrc, steps, opts }) => {
      const alignImage = new Function(`return (${fnSrc})`)();
      const setImageWidth = new Function(`return (${wSrc})`)();
      const root = document.getElementById('root')!;
      const img = root.querySelector<HTMLElement>(opts.sel || 'img')!;
      // 'w50' = ปรับขนาด 50%, อื่น ๆ = จัดวาง
      for (const s of steps) {
        const m = /^w(\d+)$/.exec(s);
        if (m) setImageWidth(img, Number(m[1]));
        else alignImage(img, s, root);
      }
      if (opts.stripDisplay) img.style.removeProperty('display');
      const r = img.getBoundingClientRect();
      return { x: Math.round(r.left), w: Math.round(r.width), html: root.innerHTML };
    }, { fnSrc, wSrc, steps, opts });
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

  console.log('รูปใหญ่เต็มกรอบ (รูป AI)');
  {
    const BIGFIG = `<figure class="content-figure">${BIG}</figure>`;
    const full = await run(PREFLIGHT + ARTICLE, BIGFIG, ['center']);
    assert(full.w === 600 && full.x === 0, 'กว้างเต็มกรอบ → กดกึ่งกลางแล้วไม่เห็นต่าง (อาการที่เจ้าของเจอ)');
    const half = await run(PREFLIGHT + ARTICLE, BIGFIG, ['w50']);
    assert(half.w === 300, 'ย่อ 50% = ครึ่งบทความ');
    assert((await run(PREFLIGHT + ARTICLE, BIGFIG, ['w50', 'center'])).x === 150, 'ย่อแล้วกึ่งกลาง');
    assert((await run(PREFLIGHT + ARTICLE, BIGFIG, ['w50', 'right'])).x === 300, 'ย่อแล้วชิดขวา');
    assert((await run(PREFLIGHT + ARTICLE, BIGFIG, ['w50', 'left'])).x === 0, 'ย่อแล้วชิดซ้าย');
    assert((await run(PREFLIGHT + ARTICLE, BIGFIG, ['center', 'w25'])).x === 225, 'จัดกึ่งกลางก่อนแล้วค่อยย่อ ก็ยังกลาง');
    const back = await run(PREFLIGHT + ARTICLE, BIGFIG, ['w50', 'center', 'w100']);
    const style = /<img[^>]*style="([^"]*)"/.exec(back.html)?.[1] ?? '';
    assert(back.w === 600 && !/width|height/.test(style), 'ขนาดเดิม = ล้าง width กลับเต็มกรอบ');
    const r = await run('', BIGFIG, ['w50', 'center'], { stripDisplay: true });
    assert(r.w === 300 && r.x === 150, 'เว็บตัด display ทิ้ง → ย่อ + กึ่งกลางยังได้');
    const html = (await run(PREFLIGHT + ARTICLE, BIGFIG, ['w50', 'center'])).html;
    assert(/width: 50%/.test(html) && /height: auto/.test(html), 'ขนาดเป็น inline style (รอดตอน push)');
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
