/**
 * เทสการสแกนหน้าตาบทความจาก CSS จริง (เคสเว็บที่ละเอียดสูง: ตั้งค่าใต้ selector ยาว + clamp + !important)
 * ค่าที่คาดหวังวัดจาก Chrome ที่หน้าจอ 1440
 * รัน: npx tsx src/lib/upload-article/article-style-scan.test.ts
 */
import { parseCssRules } from '@/lib/upload-article/css-cascade'
import { absolutizeFontUrls, evalLength, extractReferencesFromHtml, scanArticleStructure, scanArticleStyle, type ArticleRegion } from '@/lib/upload-article/article-style-scan'
import { sanitizeThemeDetail, themeDetailCss, mergeScannedDetail } from '@/lib/upload-article/theme-css'
import { fontFaceCss } from '@/lib/upload-article/font-faces'

let passed = 0
function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error('FAIL: ' + msg)
  passed++
}

const SCOPE = 'body.single-post article.post .entry-content.single-page'
const CSS = `
@font-face{font-family:Jost;font-weight:400;src:url(../fonts/jost-400.woff2) format("woff2")}
@font-face{font-family:"Full Sans SC";font-weight:400;src:url(../fonts/jost-400.woff2) format("woff2")}
@font-face{font-family:sukhumvit-light;src:url(/fonts/s.woff2) format("woff2")}
@font-face{font-family:Unused;src:url(/fonts/u.woff2) format("woff2")}
body,html{font-family:Jost,sukhumvit-light,sans-serif!important}
h1,h2{font-family:Full Sans SC,sukhumvit-light,sans-serif}
.entry-content{width:1080px!important;background-color:#fff;padding:44px!important;margin:auto;border-radius:8px;border:1px solid rgba(166,135,86,.13)}
${SCOPE} h3:before{content:"";display:block;width:72px;height:1px;margin-bottom:clamp(18px,2vw,26px);background:rgba(197,154,69,0.72)}
${SCOPE} h2,${SCOPE} h3,${SCOPE} h4{margin-top:clamp(46px,6vw,78px)!important;margin-bottom:clamp(18px,2.3vw,28px)!important;color:#34230e!important;font-weight:500!important;line-height:1.24!important}
${SCOPE} h3,${SCOPE} h3 b,${SCOPE} h3 span{color:#34230e!important;font-size:clamp(30px,2.25vw,42px)!important;line-height:1.24!important}
${SCOPE} ol,${SCOPE} ul{margin-top:-6px!important;margin-bottom:clamp(36px,4vw,54px)!important;padding:clamp(24px,3vw,34px) clamp(24px,3.4vw,44px)!important;border:1px solid rgba(114,84,24,0.15);border-radius:8px;background:rgba(255,255,255,0.68)}
${SCOPE} li,${SCOPE} li span,${SCOPE} p,${SCOPE} p span{color:#4c3515!important;font-size:clamp(19px,1.26vw,22px)!important;line-height:1.78!important}
${SCOPE} li{margin-bottom:12px!important;padding-left:4px}
${SCOPE} li::marker{color:#b98931}
${SCOPE} p{margin-bottom:clamp(22px,2.7vw,34px)!important}
${SCOPE} a{color:#8a641d;text-decoration:none}
`

const BODY = `<p>เปิดเรื่อง</p><h2>สาเหตุ</h2><h3>หัวข้อย่อย</h3><p>เนื้อหา <a href="/x">ลิงก์</a></p><ul><li>ข้อหนึ่ง</li></ul>
<h2>สรุป</h2><p>สรุปเรื่อง</p>
<h2>คำถามที่พบบ่อย (FAQ)</h2><h3>ถามอะไรดี?</h3><p>ตอบ</p><h3>ถามอีกข้อ?</h3><p>ตอบ</p>
<p>อ้างอิง</p><ul><li><a href="https://www.cancer.gov/a?utm_source=gemini"><span>National Cancer Institute</span></a></li><li><span>Park H.</span><a href="https://pmc.ncbi.nlm.nih.gov/b/"> <span>NK cell review</span></a><span> 2024.</span></li></ul>`

// body มี class ที่มีคำว่า nav — ต้องไม่ถูกมองว่าเนื้อหาอยู่ในเมนู (เคสที่เคยทำสแกนคืน null)
const OPEN = '<div class="entry-content single-page">'
const PAGE = `<html><head><style>${CSS}</style></head><body class="single-post nav-dropdown-has-arrow nav-dropdown-has-shadow"><main><article class="post">${OPEN}${BODY}</div></article></main></body></html>`

function region(page: string): ArticleRegion {
  const start = page.indexOf(OPEN)
  return { start, end: page.indexOf('</div></article>'), openTag: OPEN }
}

function main() {
  const css = absolutizeFontUrls(CSS, 'https://site.test/wp-content/themes/t/css/a.css')
  assert(css.includes('url("https://site.test/wp-content/themes/t/fonts/jost-400.woff2")') || css.includes('url(https://site.test/wp-content/themes/t/fonts/jost-400.woff2)'), 'ทำ URL ฟอนต์เป็น URL เต็ม')

  const a = scanArticleStyle({ page: PAGE, region: region(PAGE), rules: parseCssRules(css), rawCss: css, sourceUrl: 'https://site.test/post/', pageBackground: 'rgb(248,243,237)' })
  assert(a, 'body class nav-* ต้องสแกนได้')
  if (!a) return

  assert(a.source === 'https://site.test/post/', 'จำหน้าที่สแกน')
  assert(a.pageBackground === 'rgb(248,243,237)', 'พื้นหลังหน้า')
  assert(a.container?.width === '1080px' && a.container?.radius === '8px', 'กรอบเนื้อหา')
  assert(a.container?.background === '#fff', 'พื้นกรอบ')

  const ctx = { em: 16, rem: 16 }
  const px = (v: string | undefined) => (v === undefined ? null : evalLength(v, ctx))
  assert(a.h2?.color === '#34230e' && a.h2?.fontWeight === 500, 'h2 สี/น้ำหนัก')
  assert(/^Full Sans SC/.test(a.h2?.fontFamily || ''), 'h2 ฟอนต์จริงตาม stack')
  assert(a.h3?.fontSize === 'clamp(30px,2.25vw,42px)', 'h3 ขนาดเก็บ clamp ไว้ ไม่แปลงเป็นค่าตายตัว')
  assert(px(a.h3?.fontSize) !== null && Math.abs((px(a.h3?.fontSize) as number) - 32.4) < 0.01, 'h3 ที่จอ 1440 = 32.4px ตรง Chrome')
  assert(a.h3?.lineHeight === '1.24', 'h3 line-height')
  assert(a.h3?.ornament?.width === '72px' && a.h3?.ornament?.height === '1px', 'เส้นตกแต่งเหนือ H3')
  assert(a.h3?.ornament?.color === 'rgba(197,154,69,0.72)', 'สีเส้นเก็บ alpha')
  assert(a.p?.color === '#4c3515' && a.p?.lineHeight === '1.78', 'p สี/line-height')
  assert(Math.abs((px(a.p?.marginBottom) as number) - 34) < 0.01, 'p ระยะล่าง = 34px ที่จอ 1440')
  assert(a.ul?.background === 'rgba(255,255,255,0.68)' && a.ul?.radius === '8px', 'กรอบ list')
  assert(a.li?.markerColor === '#b98931', 'สีจุด list')
  assert(a.link?.color === '#8a641d' && a.link?.decoration === 'none', 'ลิงก์')

  // ไฟล์ฟอนต์เดียวกันแต่คนละ family ต้องเก็บทั้งคู่ (เคส Full Sans SC ใช้ไฟล์ Jost)
  const fams = (a.fontFaces || []).map((f) => f.family)
  assert(fams.includes('Jost') && fams.includes('Full Sans SC') && fams.includes('sukhumvit-light'), 'ฟอนต์ที่ใช้จริงครบ')
  assert(!fams.includes('Unused'), 'ฟอนต์ที่บทความไม่ใช้ไม่เก็บ')
  assert((a.fontFaces || []).every((f) => f.url.startsWith('https://site.test/')), 'URL ฟอนต์เต็ม')

  const s = scanArticleStructure([BODY], false)
  assert(s?.structure.toc === false, 'ไม่มีสารบัญ')
  assert(s?.structure.takeaways === false, 'ไม่มีกล่องสรุป')
  assert(s?.structure.conclusionBeforeFaq === true, 'สรุปก่อน FAQ')
  assert(s?.structure.faqPlain === true, 'FAQ เป็น H3 + ย่อหน้า')
  assert(s?.structure.references === true && s?.structure.referencesTitle === 'อ้างอิง', 'มีส่วนอ้างอิง + ชื่อหัวตามเว็บ')
  assert(s?.references?.length === 2, 'อ้างอิงครบ 2 รายการ')
  assert(s?.references?.every((r) => r.from === 'site' && !r.url.includes('utm_')), 'ตัด utm + ระบุที่มา')
  assert(extractReferencesFromHtml('<p>ไม่มีอะไร</p>') === null, 'ไม่มีส่วนอ้างอิง = null')

  // อ้างอิงแบบย่อหน้า (APA) ที่เว็บเขียนเอง — ข้อละ <p> หรือหลายข้อคั่น <br>, ลิงก์ Google ห่อ / utm ถูกแกะ
  const apa = extractReferencesFromHtml([
    '<p>ติดต่อ <a href="https://line.me/x">LINE</a></p>',
    '<p><span>อ้างอิง</span></p>',
    '<p><span><br /> </span><span>AIMS Press, (2018), Biological properties of mesenchymal stem cells. Retrieved 14 Jul 2026, //////// from </span><a href="https://www.aimspress.com/article/doi/10.3934/celltissue.2018.2.78?viewType=HTML&amp;utm_.com">https://www.aimspress.com/article/doi/10.3934/celltissue.2018.2.78</a> .<br /> <br />ACOG, (2019), Umbilical Cord Blood Banking. Retrieved 14 Jul 2026, //////// from <a href="https://www.acog.org/x?utm_source=chatgpt.com">https://www.acog.org/x</a> .</p>',
    '<p>&nbsp;</p>',
    '<p>nccih, Antioxidant Supplements. Retrieved 2026 from <a href="https://www.google.com/search?q=https%3A%2F%2Fwww.nccih.nih.gov%2Fhealth%2Fantioxidant">https://www.nccih.nih.gov/health/antioxidant</a></p>',
    '<p>ขอบคุณที่อ่าน</p>',
    '<p><a href="https://not-a-ref.test/">ไม่ใช่อ้างอิง</a></p>',
  ].join(''))
  assert(apa?.items.length === 3, `ย่อหน้าอ้างอิง 3 ข้อ: ${apa?.items.length}`)
  assert(apa?.items[0].title === 'AIMS Press, (2018), Biological properties of mesenchymal stem cells', `ชื่อตัดท่อน Retrieved: ${apa?.items[0].title}`)
  assert(apa?.items[0].url === 'https://www.aimspress.com/article/doi/10.3934/celltissue.2018.2.78?viewType=HTML', `ตัด utm_ เสีย: ${apa?.items[0].url}`)
  assert(apa?.items[1].title.startsWith('ACOG, (2019), Umbilical Cord Blood Banking') && apa.items[1].url === 'https://www.acog.org/x', 'ข้อที่คั่น <br> แยกเป็นอีกข้อ')
  assert(apa?.items[2].url === 'https://www.nccih.nih.gov/health/antioxidant', `แกะลิงก์ Google ห่อ: ${apa?.items[2].url}`)
  assert(!apa?.items.some((r) => r.url.includes('not-a-ref') || r.url.includes('line.me')), 'ย่อหน้าข้อความไม่มีลิงก์ = จบส่วนอ้างอิง ลิงก์ก่อนหัวข้อไม่นับ')
  const bare = extractReferencesFromHtml('<p><b>References</b></p><p><a href="https://stemcells.nih.gov/info/basics">https://stemcells.nih.gov/info/basics</a></p>')
  assert(bare?.items[0].title === 'https://stemcells.nih.gov/info/basics', 'มีแต่ลิงก์ = ใช้ลิงก์เป็นชื่อ')

  // ทั้งเส้นทางผ่าน sanitize แล้วยังครบ และ CSS ที่ออกใช้ค่าจริง
  const d = sanitizeThemeDetail({ article: a, structure: s?.structure, references: s?.references, faq: { display: 'open', layout: 'plain' } })
  assert(d?.article?.h3?.ornament?.width === '72px', 'sanitize ไม่ทำเส้นตกแต่งหาย')
  assert((d?.article?.fontFaces?.length ?? 0) >= 3, 'sanitize ไม่ทำฟอนต์หาย')
  const out = themeDetailCss(d)
  assert(out.includes('clamp(30px,2.25vw,42px)'), 'CSS มีขนาด H3 จริง')
  assert(out.includes('#b98931'), 'CSS มีสีจุด list')
  assert(!out.includes('@font-face'), 'CSS ของ push ไม่มีไฟล์ฟอนต์ เว็บลูกค้ามีเอง')
  assert(fontFaceCss(d?.article?.fontFaces).includes('@font-face'), 'พรีวิวสร้าง @font-face ได้')

  // โปรเจกต์เดิม: ไม่มีผลสแกน CSS ไม่มีกฎหน้าตาบทความ
  assert(themeDetailCss(undefined) === '', 'ไม่มี detail = ไม่มี CSS')
  assert(!themeDetailCss(sanitizeThemeDetail({ faq: { layout: 'card' } })).includes('.content-article{font-family'), 'มีแค่ faq = ไม่มีกฎรากบทความ')

  // สแกนซ้ำ: อ้างอิงที่ทีมเพิ่มต้องอยู่ต่อ
  const team = { title: 'ทีมเพิ่ม', url: 'https://who.int/x', from: 'team' as const }
  const site = { title: 'เว็บ', url: 'https://a.test/', from: 'site' as const }
  const merged = mergeScannedDetail({ references: [team, site] }, { references: [{ title: 'ใหม่', url: 'https://b.test/', from: 'site' }] })
  assert(merged?.references?.length === 2 && merged.references[0].url === team.url && merged.references[1].url === 'https://b.test/', 'เก็บของทีม ของเว็บตามผลใหม่')
  assert(mergeScannedDetail({ references: [site] }, null)?.references?.[0].url === site.url, 'ไม่มีผลสแกน = คงของเดิม')
  const scanned = { faq: { display: 'open' as const } }
  assert(mergeScannedDetail({ references: [site] }, scanned) === scanned, 'ไม่มีของทีม = ใช้ผลสแกนตรง ๆ')
  assert(mergeScannedDetail({ references: [{ ...team, url: 'https://b.test/' }] }, { references: [{ title: 'ใหม่', url: 'https://b.test/', from: 'site' }] })?.references?.length === 1, 'URL ซ้ำไม่นับสอง')

  // ดึงจากทุกบทความ (import) อยู่ต่อเหมือนของทีม · โดเมนที่บล็อกไม่กลับเข้าคลัง
  const imported = { title: 'PubMed', url: 'https://pubmed.ncbi.nlm.nih.gov/1/', from: 'import' as const }
  const rescan = mergeScannedDetail(
    { references: [imported, site], referencesBlocked: ['bdmswellness.com'] },
    { references: [{ title: 'คู่แข่ง', url: 'https://www.bdmswellness.com/x', from: 'site' }, { title: 'WHO', url: 'https://who.int/y', from: 'site' }] },
  )
  assert(rescan?.references?.length === 2 && rescan.references[0].url === imported.url && rescan.references[1].url === 'https://who.int/y', 'import อยู่ต่อ คู่แข่งจากสแกนใหม่ถูกตัด')
  assert(rescan?.referencesBlocked?.[0] === 'bdmswellness.com', 'รายการบล็อกอยู่ต่อหลังสแกนใหม่')
  const onlyBlocked = mergeScannedDetail({ referencesBlocked: ['samitivejhospitals.com'] }, { references: [{ title: 'x', url: 'https://samitivejhospitals.com/a', from: 'site' }] })
  assert(onlyBlocked && !onlyBlocked.references && onlyBlocked.referencesBlocked?.length === 1, 'บล็อกครบทุกรายการ = ไม่มีคีย์ references')
  const blockedTeam = mergeScannedDetail({ references: [{ title: 't', url: 'https://nci.go.th/a', from: 'team' }], referencesBlocked: ['nci.go.th'] }, { faq: { display: 'open' } })
  assert(!blockedTeam?.references, 'ของทีมในโดเมนที่บล็อกก็ถูกตัด')

  // sanitizer: แท็ก import ผ่าน, โดเมนบล็อกปรับเป็นรูปเดียวกัน ตัดซ้ำ ตัดค่าเสีย
  const clean = sanitizeThemeDetail({
    references: [{ title: 'PubMed', url: 'https://pubmed.ncbi.nlm.nih.gov/1/', from: 'import' }, { title: 'แปลก', url: 'https://x.test/', from: 'hacker' }],
    referencesBlocked: ['https://www.BDMSwellness.com/th/', 'bdmswellness.com', 'not a domain', 42, 'samitivejhospitals.com'],
  })
  assert(clean?.references?.[0].from === 'import', 'from:import ผ่าน sanitizer')
  assert(clean?.references?.[1] && clean.references[1].from === undefined, 'from แปลกถูกตัด')
  assert(JSON.stringify(clean?.referencesBlocked) === JSON.stringify(['bdmswellness.com', 'samitivejhospitals.com']), `โดเมนบล็อก: ${JSON.stringify(clean?.referencesBlocked)}`)
  assert(sanitizeThemeDetail({ referencesBlocked: ['nope'] })?.referencesBlocked === undefined, 'ไม่มีโดเมนใช้ได้ = ไม่มีคีย์')
  const healed = sanitizeThemeDetail({ references: [
    { title: 'NCCIH', url: 'https://www.google.com/search?q=https%3A%2F%2Fwww.nccih.nih.gov%2Fhealth%2Fx' },
    { title: 'NCCIH ซ้ำ', url: 'https://nccih.nih.gov/health/x/?utm_source=a' },
    { title: 'Nature', url: 'https://www.nature.com/a?utm.x=1' },
  ] })?.references
  assert(healed?.length === 2 && healed[0].url === 'https://www.nccih.nih.gov/health/x' && healed[1].url === 'https://www.nature.com/a', 'บันทึกแล้วแกะ Google ตัด utm และตัดลิงก์ซ้ำ')

  console.log(`article-style-scan: ${passed} passed`)
}
main()
