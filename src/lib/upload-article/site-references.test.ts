// เทสดึงอ้างอิงจากบทความทั้งเว็บ: npx tsx src/lib/upload-article/site-references.test.ts
import { SITE_REFERENCES_MAX, collectSiteReferences } from './site-references'

let passed = 0
function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  passed++
}

const refsBlock = (links: Array<[string, string]>) =>
  `<p>เนื้อหา</p><h2>อ้างอิง</h2><ul>${links.map(([t, u]) => `<li><a href="${u}">${t}</a></li>`).join('')}</ul>`
const post = (content: string) => ({ link: 'https://vaanaa.test/p', content: { rendered: content } })

async function main() {
  const pages: Record<number, unknown[]> = {
    1: [
      post(refsBlock([
        ['WHO: Ageing and health', 'https://www.who.int/news-room/fact-sheets/detail/ageing-and-health'],
        ['BDMS Wellness', 'https://www.bdmswellness.com/th/blog/nk-cell'],
        ['บทความเราเอง', 'https://vaanaa.test/other'],
      ])),
      post('<p>ไม่มีส่วนอ้างอิง</p>'),
      post(`<div class="content-article">${refsBlock([['ของระบบเรา', 'https://ai-written.test/x']])}</div>`),
      ...Array.from({ length: 17 }, (_, i) => post(refsBlock([['PubMed ' + i, `https://pubmed.ncbi.nlm.nih.gov/${100 + i}/`]]))),
    ],
    2: [post(refsBlock([
      ['WHO ซ้ำ', 'https://who.int/news-room/fact-sheets/detail/ageing-and-health/'],
      ['NIH Stem Cell Info', 'https://stemcells.nih.gov/info/basics'],
      ['Samitivej', 'https://shop.samitivejhospitals.com/x'],
    ]))],
  }
  const asked: string[] = []
  const fetchText = async (url: string) => {
    asked.push(url)
    const page = Number(new URL(url).searchParams.get('page'))
    return pages[page] ? JSON.stringify(pages[page]) : '{"code":"rest_post_invalid_page_number"}'
  }

  const r = await collectSiteReferences({ site: 'vaanaa.test', blocked: ['bdmswellness.com', 'samitivejhospitals.com'], fetchText })
  assert(asked[0].startsWith('https://vaanaa.test/wp-json/wp/v2/posts?per_page=20&page=1'), `เรียก REST ของเว็บ: ${asked[0]}`)
  assert(asked.length === 2, `หน้าสองมีน้อยกว่า 20 = หยุด: ${asked.length}`)
  const urls = r.references.map((x) => x.url)
  assert(urls.includes('https://www.who.int/news-room/fact-sheets/detail/ageing-and-health'), 'ได้ WHO')
  assert(urls.filter((u) => u.includes('who.int')).length === 1, 'WHO ซ้ำ (www / ท้าย /) นับครั้งเดียว')
  assert(urls.includes('https://stemcells.nih.gov/info/basics'), 'ได้จากหน้าสอง')
  assert(!urls.some((u) => u.includes('bdmswellness') || u.includes('samitivej')), 'คู่แข่ง (รวมโดเมนย่อย) ไม่เข้า')
  assert(!urls.some((u) => u.includes('vaanaa.test')), 'ลิงก์เว็บตัวเองไม่ใช่อ้างอิง')
  assert(!urls.includes('https://ai-written.test/x'), 'บทความที่ระบบเราเขียนถูกข้าม')
  assert(r.references.every((x) => x.from === 'import'), 'แท็ก import ทุกรายการ')
  assert(r.skippedBlocked === 2 && r.skippedOwn === 1, `นับข้าม: blocked ${r.skippedBlocked} own ${r.skippedOwn}`)
  assert(r.posts === 20 && r.postsWithReferences === 19, `นับบทความ: ${r.posts}/${r.postsWithReferences}`)
  assert(r.references.length === 19 && !r.truncated, `รวม 19 รายการ ไม่เกินเพดาน: ${r.references.length}`)

  // เว็บไม่เปิด REST = แจ้งชัด ไม่คืนรายการว่างเงียบ ๆ
  let threw = ''
  await collectSiteReferences({ site: 'https://closed.test', fetchText: async () => null }).catch((e) => { threw = String(e) })
  assert(threw.includes('WordPress REST'), `เว็บปิด REST แจ้ง error: ${threw}`)

  // เพดานจำนวนหน้าและจำนวนรายการ
  const many = async (url: string) => {
    const page = Number(new URL(url).searchParams.get('page'))
    return JSON.stringify(Array.from({ length: 20 }, (_, i) => post(refsBlock([[`Paper ${page}-${i}`, `https://journal.test/${page}/${i}`], [`Extra ${page}-${i}`, `https://journal.test/x/${page}/${i}`]]))))
  }
  const capped = await collectSiteReferences({ site: 'big.test', fetchText: many })
  assert(capped.references.length === SITE_REFERENCES_MAX && capped.truncated, `ตัดที่ ${SITE_REFERENCES_MAX} และบอกว่าอ่านไม่ครบ: ${capped.references.length}`)
  const pagesOnly = await collectSiteReferences({ site: 'big.test', fetchText: many, maxPages: 2 })
  assert(pagesOnly.references.length === 80 && pagesOnly.truncated, `ครบเพดานหน้า = truncated: ${pagesOnly.references.length}`)

  console.log(`site-references: ${passed} passed`)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
