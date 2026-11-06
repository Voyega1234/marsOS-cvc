// เทสแหล่งอ้างอิง: npx tsx src/lib/upload-article/references.test.ts
import {
  REFERENCES_PROMPT_MAX,
  boxReferencesSection,
  cleanReferenceUrl,
  isOfficialReferenceDomain,
  isReferenceBlocked,
  pickReferencesForPrompt,
  refKey,
  referenceDomain,
  structureOptionsFromDetail,
} from './references'
import { articleStructureSkillBlock } from '@/lib/article-structure'
import { buildFaqFillPrompt, buildWriterUserPrompt, variantBlock } from './writer'
import { buildUploadArticleHtml } from './build-html'
import type { UploadKeyword, UploadReference, UploadTheme } from './types'

let passed = 0
function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  passed++
}

const LIB: UploadReference[] = [
  { title: 'National Cancer Institute: Immunotherapy', url: 'https://www.cancer.gov/immunotherapy', from: 'site' },
  { title: 'Marin D et al. 2024', url: 'https://www.nature.com/articles/s41591-023-02785-8', from: 'site' },
]
const BASE = { library: LIB, title: 'อ้างอิง', language: 'th' as const, onlyListed: true }

function main() {
  // cleanReferenceUrl
  assert(cleanReferenceUrl('https://a.com/x?utm_source=gemini&id=2') === 'https://a.com/x?id=2', 'ตัด utm แต่คงพารามิเตอร์อื่น')
  assert(cleanReferenceUrl('https://pmc.ncbi.nlm.nih.gov/articles/PMC1/?utm.com') === 'https://pmc.ncbi.nlm.nih.gov/articles/PMC1/', 'ตัด utm.x ที่ติดมาจากลิงก์คัดลอก')
  assert(cleanReferenceUrl('javascript:alert(1)') === null, 'ไม่รับ javascript:')
  assert(cleanReferenceUrl('not a url') === null, 'ลิงก์เสียได้ null')

  // ลิงก์ที่ Google ห่อไว้ (Docs / ผลค้นหา) แกะเป็นลิงก์จริง · คำค้นธรรมดาไม่แตะ
  assert(cleanReferenceUrl('https://www.google.com/search?q=https%3A%2F%2Fwww.nccih.nih.gov%2Fhealth%2Fx') === 'https://www.nccih.nih.gov/health/x', 'แกะ google search')
  assert(cleanReferenceUrl('https://www.google.com/url?q=https://who.int/a?utm_source=x&sa=D&ust=1') === 'https://who.int/a', 'แกะ google url (Docs) + ตัด utm')
  assert(cleanReferenceUrl('https://www.google.co.th/url?q=https://cdc.gov/b') === 'https://cdc.gov/b', 'google.co.th ก็แกะ')
  assert(cleanReferenceUrl('https://www.google.com/search?q=nk+cell') === 'https://www.google.com/search?q=nk+cell', 'คำค้นธรรมดาไม่แตะ')
  assert(refKey('https://www.google.com/search?q=https%3A%2F%2Fcdc.gov%2Fb') === refKey('https://cdc.gov/b'), 'refKey เทียบลิงก์ห่อกับลิงก์จริงได้')

  // isOfficialReferenceDomain: ใช้บอกทีมว่าเว็บไหนควรตรวจ
  for (const u of ['https://pubmed.ncbi.nlm.nih.gov/1/', 'https://www.who.int/x', 'https://www.nci.go.th/a', 'https://med.chula.ac.th/a', 'https://www.acog.org/a', 'https://www.nature.com/articles/x', 'https://link.springer.com/a', 'https://www.nhs.uk/a', 'https://www.gov.uk/a'])
    assert(isOfficialReferenceDomain(u), `หน่วยงาน/วารสาร: ${u}`)
  for (const u of ['https://www.bdmswellness.com/a', 'https://shop.samitivejhospitals.com/x', 'https://nature.com.fake.test/a', 'https://mynature.com/a', 'not a url'])
    assert(!isOfficialReferenceDomain(u), `ควรตรวจ: ${u}`)
  // referenceDomain / isReferenceBlocked
  assert(referenceDomain('https://www.BDMSwellness.com/th/x?a=1') === 'bdmswellness.com', 'โดเมนจากลิงก์ ตัด www. ตัวเล็ก')
  assert(referenceDomain('samitivejhospitals.com') === 'samitivejhospitals.com', 'โดเมนที่พิมพ์เอง')
  assert(referenceDomain('localhost') === null && referenceDomain('') === null && referenceDomain('a b.com') === null, 'ค่าเสียได้ null')
  const BLOCKED = ['bdmswellness.com', 'nci.go.th']
  const wrapped = 'https://www.google.com/search?q=https%3A%2F%2Fwww.nccih.nih.gov%2Fhealth%2Fantioxidant'
  assert(referenceDomain(wrapped) === 'nccih.nih.gov', 'ลิงก์ Google ห่อ = โดเมนแหล่งจริง')
  assert(!isReferenceBlocked(wrapped, ['google.com']) && isReferenceBlocked(wrapped, ['nih.gov']), 'บล็อกตามแหล่งจริง ไม่ใช่ google.com')
  assert(referenceDomain('https://www.google.com/maps') === 'google.com', 'ลิงก์ Google ธรรมดายังเป็น google.com')
  assert(isReferenceBlocked('https://www.bdmswellness.com/a', BLOCKED), 'บล็อกโดเมนหลัก')
  assert(isReferenceBlocked('https://shop.bdmswellness.com/a', BLOCKED), 'บล็อกโดเมนย่อยด้วย')
  assert(!isReferenceBlocked('https://notbdmswellness.com/a', BLOCKED), 'ชื่อคล้ายแต่คนละโดเมน ไม่บล็อก')
  assert(!isReferenceBlocked('https://www.cancer.gov/x', BLOCKED) && !isReferenceBlocked('https://a.com', undefined), 'โดเมนอื่น/ไม่มีรายการ ไม่บล็อก')

  // ตัดลิงก์นอกรายการ ชื่อใช้ตามรายการ ไม่แต่งเพิ่ม
  const ai = `<p>เนื้อหา</p><h2>อ้างอิง</h2><ul><li><a href="https://cancer.gov/immunotherapy/?utm_source=gemini">ชื่อที่ AI แต่ง</a></li><li><a href="https://fake-journal.example/study">งานวิจัยปลอม</a></li></ul><p>ย่อหน้าปิดท้าย</p>`
  const boxed = boxReferencesSection(ai, BASE)
  assert(boxed.includes('class="content-references"'), 'ครอบกล่อง')
  assert(boxed.includes('National Cancer Institute: Immunotherapy'), 'ใช้ชื่อจากรายการ')
  assert(!boxed.includes('ชื่อที่ AI แต่ง'), 'ไม่ใช้ชื่อที่ AI แต่ง')
  assert(!boxed.includes('fake-journal'), 'ตัดลิงก์นอกรายการ')
  assert(!/<h2/i.test(boxed), 'ไม่เหลือ H2 อ้างอิง จะได้ไม่เข้าสารบัญ')
  assert(boxed.includes('<p>ย่อหน้าปิดท้าย</p>'), 'ข้อความหลังส่วนอ้างอิงไม่หาย')
  assert(boxReferencesSection(boxed, BASE) === boxed, 'ทำซ้ำได้ผลเท่าเดิม')

  // ไม่เหลือสักแหล่ง = ลบทั้งส่วน
  const onlyFake = '<p>ก</p><h2>อ้างอิง</h2><ul><li><a href="https://fake.example">x</a></li></ul>'
  const gone = boxReferencesSection(onlyFake, BASE)
  assert(!gone.includes('อ้างอิง') && gone.includes('<p>ก</p>'), 'ลิงก์ปลอมล้วน = ไม่มีส่วนอ้างอิง')

  // เอกสารที่ทีมนำเข้า: ครอบกล่องเฉย ๆ เนื้อหาและลิงก์คงเดิม
  const doc = '<p>อ้างอิง</p><ul><li>FDA. <a href="https://www.fda.gov/letter?utm_source=x">Warning Letter</a> [Internet]. 2020</li></ul>'
  const kept = boxReferencesSection(doc, { ...BASE, onlyListed: false })
  assert(kept.includes('content-references'), 'เอกสารนำเข้าได้กล่อง')
  assert(kept.includes('[Internet]. 2020') && kept.includes('www.fda.gov/letter'), 'เอกสารนำเข้าคงข้อความและลิงก์')

  // คำว่าอ้างอิงลอย ๆ ไม่มีรายการลิงก์ตาม = ไม่แตะ
  const plain = '<p>อ้างอิง</p><p>ข้อความธรรมดา</p>'
  assert(boxReferencesSection(plain, BASE) === plain, 'ไม่มีลิงก์ตาม = ไม่แตะ')
  const prose = '<p>อ้างอิงจากประสบการณ์ของแพทย์</p><ul><li><a href="https://x.example">x</a></li></ul>'
  assert(boxReferencesSection(prose, BASE) === prose, 'ประโยคที่ขึ้นต้นด้วยอ้างอิง ไม่ใช่หัวส่วน')

  // รายการซ้อนไม่ทำ HTML ขาด
  const nested = '<h2>References</h2><ul><li><a href="https://cancer.gov/immunotherapy">a</a><ul><li>ย่อย</li></ul></li></ul><p>จบ</p>'
  const nestedOut = boxReferencesSection(nested, { ...BASE, onlyListed: false })
  assert(nestedOut.endsWith('</ul></div><p>จบ</p>'), 'รายการซ้อนจบถูกที่')

  // ลิงก์ซ้ำเหลือข้อเดียว (เทียบแบบไม่สน www และ / ท้าย)
  const dup = '<h2>อ้างอิง</h2><ul><li><a href="https://www.cancer.gov/immunotherapy">a</a></li><li><a href="https://cancer.gov/immunotherapy/">b</a></li></ul>'
  assert((boxReferencesSection(dup, BASE).match(/<li>/g) || []).length === 1, 'ลิงก์ซ้ำเหลือข้อเดียว')

  // ชื่อแหล่งหลบ HTML
  const evil = boxReferencesSection('<h2>อ้างอิง</h2><ul><li><a href="https://e.com/a">x</a></li></ul>', {
    ...BASE,
    library: [{ title: '<script>alert(1)</script>', url: 'https://e.com/a' }],
  })
  assert(!evil.includes('<script>'), 'ชื่อแหล่งถูก escape')

  // เลือกแหล่งเข้า prompt
  const many: UploadReference[] = Array.from({ length: 60 }, (_, i) => ({ title: `แหล่งที่ ${i}`, url: `https://e.com/${i}` }))
  many[50] = { title: 'NK cell therapy review', url: 'https://e.com/nk' }
  const picked = pickReferencesForPrompt(many, 'nk cell ไทย')
  assert(picked.length === REFERENCES_PROMPT_MAX, 'จำกัดจำนวนใน prompt')
  assert(picked[0].url === 'https://e.com/nk', 'แหล่งที่ตรงหัวข้อมาก่อน')

  // ลูกค้าเดิม: ไม่มีค่าชุดนี้ = กฎเดิมทุกตัวอักษร
  assert(structureOptionsFromDetail(undefined, 'x') === undefined, 'ไม่มี detail = undefined')
  assert(structureOptionsFromDetail({ source: 'x' }, 'x') === undefined, 'ไม่มี structure = undefined')
  for (const lang of ['th', 'en'] as const) {
    const legacy = articleStructureSkillBlock(lang)
    assert(articleStructureSkillBlock(lang, undefined) === legacy, `${lang}: undefined เท่าเดิม`)
    assert(articleStructureSkillBlock(lang, {}) === legacy, `${lang}: ว่าง เท่าเดิม`)
    assert(articleStructureSkillBlock(lang, { takeaways: true, toc: true } as never) === legacy, `${lang}: ค่าปกติ เท่าเดิม`)
  }
  assert(articleStructureSkillBlock('th').includes('สรุปประเด็นสำคัญ'), 'กฎเดิมยังมีกล่องสรุป')

  // ลูกค้าที่สแกนแล้ว
  const custom = articleStructureSkillBlock('th', { takeaways: false, faqPlain: true, conclusionBeforeFaq: true, references: true, referencesTitle: 'อ้างอิง', library: LIB })
  assert(custom.includes('ไม่มีกล่องสรุปประเด็นสำคัญ'), 'ปิดกล่องสรุป')
  assert(custom.includes('ห้ามใช้ <details>'), 'FAQ เปิดตลอด')
  assert(custom.includes('บทสรุป'), 'บทสรุปก่อน FAQ')
  assert(custom.includes('https://www.nature.com/articles/s41591-023-02785-8'), 'มีรายการแหล่ง')
  assert(custom.includes('ห้ามแต่ง'), 'ห้ามแต่งแหล่ง')
  const empty = articleStructureSkillBlock('th', { references: true, library: [] })
  assert(empty.includes('ห้ามใส่ส่วนอ้างอิง'), 'ไม่มีรายการ = ห้ามใส่')

  // prompt ของตัวเขียน
  const kw: UploadKeyword = { id: 'k', keyword: 'nk cell', title: 'NK', slug: '', intent: '', articleType: '', note: '', createdAt: '' }
  const legacyUser = buildWriterUserPrompt({ keyword: kw, links: [] })
  assert(legacyUser.includes('กล่องสรุปประเด็นสำคัญ ต่อจากย่อหน้าเปิดเรื่อง'), 'ลูกค้าเดิมยังมีบรรทัดกล่องสรุป')
  assert(buildWriterUserPrompt({ keyword: kw, links: [], structure: undefined }) === legacyUser, 'structure ว่าง = prompt เดิม')
  const scanned = buildWriterUserPrompt({ keyword: kw, links: [], structure: { takeaways: false } })
  assert(!scanned.includes('กล่องสรุปประเด็นสำคัญ ต่อจากย่อหน้าเปิดเรื่อง'), 'ปิดกล่องสรุปแล้วสัญญา output ไม่สั่งอีก')

  // แหล่งข้อเท็จจริง: ไม่มีข้อจำกัด/Comment = ข้อความเดิม
  assert(buildFaqFillPrompt('th').includes('ข้อเท็จจริงต้องมาจาก Business Skill และเนื้อหาบทความเท่านั้น'), 'FAQ fill เดิม')
  assert(buildFaqFillPrompt('th', ['ข้อจำกัด', 'Comment']).includes('Business Skill, ข้อจำกัด, Comment'), 'FAQ fill ใช้ข้อจำกัด/Comment ได้')
  assert(variantBlock({ index: 1, total: 2 }).includes('ยังต้องมาจาก Business Skill เท่านั้น'), 'variant เดิม')
  const noted = { ...kw, note: 'โน้ต' }
  assert(buildWriterUserPrompt({ keyword: noted, links: [] }).includes('แต่ข้อเท็จจริงยังต้องมาจาก Business Skill เท่านั้น)'), 'Note เดิม')
  assert(buildWriterUserPrompt({ keyword: noted, links: [], constraintLayers: ['Comment'] }).includes('Business Skill, Comment เท่านั้น'), 'Note ใช้ Comment ได้')

  // ประกอบบทความ
  const theme = (detail?: UploadTheme['detail']): UploadTheme => ({ theme: '#111111', text: '#222222', border: '#333333', accent: '#444444', background: '', styleMode: 'embed', detail })
  const faqBody = (extra = '') => `<p>เปิดเรื่อง</p><h2>หนึ่ง</h2><p>ก</p><h2>สอง</h2><p>ข</p><h2>สาม</h2><p>ค</p><h2>คำถามที่พบบ่อย</h2><h3>ถามไหม?</h3><p>ตอบ</p>${extra}`
  const opts = { mode: 'html' as const, site: { name: 'S', url: 'https://s.example', language: 'th' as const }, meta: { title: 'T' }, cover: null, breadcrumb: false, cta: undefined, author: null }
  const refs = '<h2>อ้างอิง</h2><ul><li><a href="https://cancer.gov/immunotherapy">x</a></li></ul>'

  const old = buildUploadArticleHtml({ ...opts, sourceHtml: faqBody(refs), theme: theme() })
  assert(old.html.includes('content-toc'), 'ลูกค้าเดิมมีสารบัญ')
  assert(!old.html.includes('class="content-references"'), 'ลูกค้าเดิมไม่มีกล่องอ้างอิง')
  assert(/<h2[^>]*>อ้างอิง<\/h2>/.test(old.html), 'ลูกค้าเดิมคงหัวข้อเดิม')

  const fit = buildUploadArticleHtml({
    ...opts,
    aiSource: true,
    sourceHtml: faqBody(refs),
    theme: theme({ structure: { toc: false, takeaways: false, references: true, referencesTitle: 'อ้างอิง', faqPlain: true }, references: LIB, faq: { display: 'open', layout: 'plain' } }),
  })
  assert(!fit.html.includes('<nav class="content-toc"'), 'เว็บไม่ใช้สารบัญ = ไม่ใส่')
  assert(fit.html.includes('class="content-references"'), 'มีกล่องอ้างอิง')
  assert(fit.html.includes('National Cancer Institute: Immunotherapy'), 'อ้างอิงใช้ชื่อจากรายการ')
  assert(fit.faqCount === 1, `FAQ นับ 1 ข้อ ไม่กลืนกล่องอ้างอิง: ได้ ${fit.faqCount}`)
  assert(fit.html.indexOf('content-faq__item') < fit.html.indexOf('class="content-references"'), 'อ้างอิงอยู่หลัง FAQ')
  const answer = fit.html.slice(fit.html.indexOf('content-faq__answer'), fit.html.indexOf('class="content-references"'))
  assert(!answer.includes('cancer.gov'), 'ลิงก์อ้างอิงไม่เข้าไปในคำตอบ FAQ')
  assert(fit.plainText.includes('National Cancer Institute'), 'plain text มีอ้างอิง')

  const docImport = buildUploadArticleHtml({ ...opts, sourceHtml: faqBody('<p>อ้างอิง</p><ul><li><a href="https://own.example/paper">ของลูกค้า</a></li></ul>'), theme: theme({ structure: { references: true }, references: LIB }) })
  assert(docImport.html.includes('own.example/paper'), 'เอกสารนำเข้าคงลิงก์ของลูกค้า')

  console.log(`references: ${passed} passed`)
}
main()
