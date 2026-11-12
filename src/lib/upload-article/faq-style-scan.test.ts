/**
 * วัดหน้าตา FAQ แบบ <details>/<summary> จาก CSS จริง — รัน: npx tsx src/lib/upload-article/faq-style-scan.test.ts
 * โครงตัวอย่างย่อมาจากธีมที่ใช้ร่วมกันหลายเว็บ: ตัวแปรสีอยู่ใน style="" ของ <html> และกฎแยกเว็บด้วย [data-site=…]
 */
import { attrGatedOut, CssCascade, openChainAt, parseCssRules, parseOpenTag } from '@/lib/upload-article/css-cascade'
import { scanFaqStyle } from '@/lib/upload-article/article-style-scan'
import { sanitizeThemeDetail, themeDetailCss } from '@/lib/upload-article/theme-css'

let passed = 0
function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`)
    process.exit(1)
  }
  passed++
}

const CSS = `
:root{--c-primary:#ff0000;--c-bg:#eeeeee;--radius:10px;--shadow:0 4px 16px rgba(0,0,0,.08)}
summary{display:list-item}
.faq details{background:var(--c-surface);border-radius:var(--radius);box-shadow:var(--shadow);margin-bottom:.6rem;padding:.8rem 1rem}
.faq summary{cursor:pointer;font-weight:600}
.faq details p{color:var(--c-muted);margin:.6rem 0 0}
body[data-decor=outline] .card,body[data-decor=outline] .faq details{box-shadow:none;border:2px solid var(--c-text)}
[data-site=finance] .faq details{background:#123456;border-radius:0}
[data-site=health] .faq details{background:var(--c-bg);box-shadow:none;border-radius:14px;padding:1rem 1.25rem}
[data-site=health] .faq details[open]{background:var(--c-primary);color:var(--c-on-primary)}
[data-site=health] .faq details[open] a,[data-site=health] .faq details[open] p{color:var(--c-on-primary)}
`
const PAGE = `<!doctype html><html lang="th" style="--c-primary:#000E44;--c-bg:#FFFFFF;--c-surface:#FFFFFF;--c-text:#000710;--c-muted:#5E6A7D;--c-on-primary:#ffffff"><head><title>x</title></head>
<body data-site="health" data-decor="none"><main><article><p>เนื้อหา</p>
<section class="faq" aria-labelledby="faq-title"><h2 id="faq-title">คำถามที่พบบ่อย</h2>
<details><summary>คำถามแรก</summary><p>คำตอบแรก</p></details>
<details><summary>คำถามสอง</summary><p>คำตอบสอง</p></details>
</section></article></main></body></html>`

const rules = parseCssRules(CSS)

// ── cascade: attribute selector + ตัวแปรใน style="" ──
{
  const at = PAGE.indexOf('<details')
  const chain = [...openChainAt(PAGE, at), parseOpenTag('<details>')]
  const cx = new CssCascade(rules, { watch: /^(?:background|border|box-shadow|color$|--)/, attrs: true })
  // ไม่เปิด attrs = อ่านแบบเดิม: ข้ามกฎ [attribute] และไม่อ่านตัวแปรใน style="" (ระบบอื่นที่ใช้ตัวอ่านเดียวกันได้ผลเท่าเดิม)
  const legacy = new CssCascade(rules, { watch: /^(?:background|border|box-shadow|color$|--)/ })
  assert(legacy.cascaded(chain, ['border-radius'])?.value === '10px', 'แบบเดิม: ไม่ใช้กฎ [data-site=health]')
  assert(legacy.cascaded(chain, ['background-color', 'background']) === null || legacy.cascaded(chain, ['background-color', 'background'])?.value.toLowerCase() !== '#ffffff', 'แบบเดิม: ไม่อ่านตัวแปรใน style=""')
  assert(cx.cascaded(chain, ['background-color', 'background'])?.value.toLowerCase() === '#ffffff', 'ตัวแปรใน style="" ของ <html> ชนะ :root และกฎ [data-site=health] ชนะกฎทั่วไป')
  assert(cx.cascaded(chain, ['border-radius'])?.value === '14px', 'radius จากกฎของเว็บนี้')
  assert(cx.cascaded(chain, ['box-shadow'])?.value === 'none', 'เงาถูกปิดโดยกฎของเว็บนี้')
  const open = [...openChainAt(PAGE, at), parseOpenTag('<details open>')]
  assert(cx.cascaded(open, ['background-color', 'background'])?.value.toLowerCase() === '#000e44', 'details[open] ใช้พื้นสีหลัก')
  const top = { html: parseOpenTag(/<html\b[^>]*>/.exec(PAGE)![0]), body: parseOpenTag(/<body\b[^>]*>/.exec(PAGE)![0]) }
  assert(attrGatedOut('[data-site=finance] .faq details', top), 'กฎของเว็บอื่นถูกตัด')
  assert(!attrGatedOut('[data-site=health] .faq details', top), 'กฎของเว็บนี้ยังอยู่')
  assert(attrGatedOut('body[data-decor=outline] .faq details', top), 'กฎ decor ที่หน้านี้ไม่ได้ใช้ถูกตัด')
  assert(!attrGatedOut('.faq details[open]', top), 'attribute ของ element ข้างในไม่ใช้ตัดกฎ')
}

// ── วัด FAQ ──
const faq = scanFaqStyle({ page: PAGE, rules })
assert(faq, 'วัด FAQ ได้')
if (faq) {
  assert(faq.measured === true, 'ติดป้าย measured')
  assert(faq.layout === 'card' && faq.itemBorderWidth === 0, 'กล่องมีพื้น ไม่มีเส้นขอบ (กฎ decor=outline ไม่ถูกนำมาใช้)')
  assert(faq.itemBackground === '#ffffff', `พื้นกล่อง ${faq.itemBackground}`)
  assert(faq.itemRadius === 14 && faq.itemShadow === false, 'มุมโค้ง 14 ไม่มีเงา')
  assert(faq.itemGap === 9.6, `ระยะห่างข้อ ${faq.itemGap}`)
  assert(faq.questionPadding === '16px 20px', `ระยะคำถาม ${faq.questionPadding}`)
  assert(faq.answerPadding === '0 20px 16px', `ระยะคำตอบ ${faq.answerPadding}`)
  assert(faq.questionWeight === 600, 'น้ำหนักคำถาม 600')
  assert(faq.openQuestionBackground === '#000e44' && faq.openQuestionColor === '#ffffff', 'ตอนเปิด: พื้นสีหลัก ตัวขาว')
  assert(faq.answerBackground === '#000e44' && faq.answerColor === '#ffffff', 'คำตอบ (เห็นเฉพาะตอนเปิด): ขาวบนสีหลัก ไม่ใช่สี muted ของตอนปิด')
  assert(faq.icon === 'caret' && faq.iconPosition === 'left', 'สามเหลี่ยมของเบราว์เซอร์ = caret ด้านซ้าย')
  assert('questionColor' in faq && faq.questionColor === undefined, 'เว็บไม่ได้ตั้งสีคำถาม = ล้างค่าที่ AI เดา')
  assert('iconColor' in faq && faq.iconColor === undefined, 'เว็บไม่ได้ตั้งสีไอคอน = ล้างค่าที่ AI เดา')
}

// ── วัดไม่ได้ = คืน null ให้ใช้ค่า AI ──
assert(scanFaqStyle({ page: '<html><body><article><p>ไม่มี FAQ</p></article></body></html>', rules }) === null, 'ไม่มี details = null')
assert(scanFaqStyle({ page: PAGE, rules: parseCssRules('p{color:#333}') }) === null, 'details ไม่มีหน้าตากล่อง = null')
assert(
  scanFaqStyle({ page: '<html><body><nav class="menu"><details><summary>เมนู</summary><p>x</p></details></nav></body></html>', rules: parseCssRules('details{background:#eee;padding:8px}') }) === null,
  'details ในเมนูไม่นับเป็น FAQ'
)

// ── ธีมห่อ <div> ข้อละใบ + ซ่อนสามเหลี่ยม ──
{
  const page = `<html><body><article><div class="accordion"><div class="acc-item"><details><summary><h3>ถาม</h3></summary><div class="acc-body"><p>ตอบ</p></div></details></div><div class="acc-item"><details><summary><h3>ถาม 2</h3></summary><div class="acc-body"><p>ตอบ</p></div></details></div></div></article></body></html>`
  const css = `.acc-item{border:1px solid #dddddd;border-radius:8px;margin-bottom:12px}.acc-item summary{list-style:none;padding:12px 16px;background:#f5f5f5;color:#222222}.acc-item summary h3{font-size:18px;margin:0}.acc-body{padding:12px 16px;background:#ffffff}`
  const f = scanFaqStyle({ page, rules: parseCssRules(css) })
  assert(f && f.layout === 'card' && f.itemBorderWidth === 1 && f.itemBorderColor === '#dddddd', 'กรอบอยู่ที่ <div> ห่อ')
  assert(f && f.itemRadius === 8 && f.itemGap === 12, 'มุมโค้งและระยะห่างจาก <div> ห่อ')
  assert(f && f.questionBackground === '#f5f5f5' && f.questionColor === '#222222', 'พื้นและสีคำถามจาก summary')
  assert(f && f.questionFontSize === '18px' && f.questionWeight === 700, 'ขนาดจาก h3 ใน summary ตัวหนาตามค่าเริ่มต้นของหัวข้อ')
  assert(f && f.questionPadding === '12px 16px' && f.answerPadding === '12px 16px', `ระยะ ${f?.questionPadding} / ${f?.answerPadding}`)
  assert(f && f.answerBackground === '#ffffff', 'พื้นคำตอบจากกล่องคำตอบ')
  assert(f && !('icon' in f), 'ซ่อนสามเหลี่ยม (ใช้ไอคอนของธีม) = ไม่แตะค่าไอคอนที่ AI อ่าน')
}

// ── renderer ──
{
  const article = { p: { color: '#000710' }, link: { color: '#000e44' } }
  const measured = sanitizeThemeDetail({ source: 'x', faq, article })
  assert(measured?.faq?.measured === true, 'sanitize เก็บ measured')
  const css = themeDetailCss(measured)
  assert(css.includes('.content-article .content-faq__question::after{color:inherit;}'), 'ไอคอนสีตามคำถาม')
  assert(css.includes('.content-article .content-faq__item .content-faq__answer :is(p,li,strong,b){color:inherit;}'), 'สีคำตอบถึงย่อหน้า')
  assert(css.includes('.content-article .content-faq__item .content-faq__answer a{color:inherit;}'), 'ลิงก์สีกลืนพื้นคำตอบ = ใช้สีคำตอบ')
  assert(css.includes('.content-article .content-faq__item .content-faq__answer > :last-child{margin-bottom:0;}'), 'ย่อหน้าสุดท้ายไม่ดันขอบล่าง')
  assert(css.includes('border-radius:14px;') && css.includes('box-shadow:none;') && css.includes('margin:9.6px 0;'), 'ค่ากล่องออกครบ')

  // ข้อมูลเดิม (ไม่มี measured) ต้องได้ CSS เท่าเดิมทุกไบต์
  const { measured: _drop, ...legacyFaq } = measured!.faq!
  const legacy = themeDetailCss(sanitizeThemeDetail({ source: 'x', faq: legacyFaq, article }))
  assert(!legacy.includes('color:inherit') && !legacy.includes(':last-child'), 'ไม่มี measured = ไม่มีกฎใหม่')
  const strip = (s: string) =>
    s
      .replace('.content-article .content-faq__question::after{color:inherit;}', '')
      .replace('.content-article .content-faq__item .content-faq__answer :is(p,li,strong,b){color:inherit;}', '')
      .replace('.content-article .content-faq__item .content-faq__answer a{color:inherit;}', '')
      .replace('.content-article .content-faq__item .content-faq__answer > :last-child{margin-bottom:0;}', '')
      .replace(/\n+/g, '\n')
  assert(strip(css) === legacy.replace(/\n+/g, '\n'), 'ส่วนที่เหลือเหมือนเดิมทุกไบต์')
  assert(sanitizeThemeDetail({ faq: { measured: 'yes', layout: 'card' } })?.faq?.measured === undefined, 'measured รับเฉพาะ true')
}

console.log(`faq-style-scan: ${passed} checks passed`)
