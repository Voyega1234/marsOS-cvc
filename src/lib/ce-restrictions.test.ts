/**
 * Content Engine ข้อจำกัด (Restrictions) — แยกคำต้องห้าม, จับคู่สินค้า, เลือกส่วนของไฟล์, แทนคำ
 * Run: npx tsx src/lib/ce-restrictions.test.ts
 */
import {
  applyBannedReplacements,
  bannedTermsFromTable,
  buildRestrictionsBlock,
  chunkText,
  cleanArticlePatch,
  cleanGeneratedFields,
  cleanPlainText,
  cleanSeoMetaBlock,
  cleanSlug,
  collectBannedSegments,
  findBannedInText,
  findBannedTerms,
  hitWarnings,
  keywordWarnings,
  matchProductRules,
  parseBannedTerms,
  parseRestrictions,
  pickRelevantChunks,
  replaceSegments,
  tallyWarning,
  titleRestrictionsFrom,
  type ProductRule,
  type RestrictionsContext,
} from './ce-restrictions';

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  passed++;
  console.log(`  ✓ ${msg}`);
}

// ── parseBannedTerms ──
const terms = parseBannedTerms('หายขาด => บรรเทาอาการ\n# comment\n\nรักษาได้ 100%\nหายขาด\nbest -> great\nก');
assert(terms.length === 3, 'banned terms: comment/blank/dup/1-char skipped');
assert(terms[0].term === 'หายขาด' && terms[0].replacement === 'บรรเทาอาการ', 'banned terms: => replacement');
assert(terms[1].replacement === null, 'banned terms: no replacement = null');
assert(terms[2].term === 'best' && terms[2].replacement === 'great', 'banned terms: -> replacement');

// ── bannedTermsFromTable ──
const table = bannedTermsFromTable('คำต้องห้าม,คำแทน\nหายขาด,บรรเทา\n"ดีที่สุด, ในโลก",\nปลอดภัย 100%');
assert(table === 'หายขาด => บรรเทา\nดีที่สุด, ในโลก\nปลอดภัย 100%', 'table import: header skipped, quoted comma kept');

// ── parseRestrictions ──
assert(parseRestrictions('ห้ามพูดถึงคู่แข่ง').rules === 'ห้ามพูดถึงคู่แข่ง', 'non-JSON promptText = rules text');
const parsed = parseRestrictions(JSON.stringify({ status: 'Draft', bannedTerms: 'x1', productRules: [{ product: 'A', enabled: false }] }));
assert(parsed.status === 'Draft' && parsed.productRules[0].enabled === false && parsed.productRules[0].fileIds.length === 0, 'JSON parsed with defaults');

// ── findBannedTerms / applyBannedReplacements ──
const html = '<style>.a{content:"หายขาด"}</style><h2 title="หายขาด">โรคนี้หายขาดได้</h2><p>เราคือ the best clinic, bestseller ไม่นับ</p><img alt="x">';
const hits = findBannedTerms(html, terms);
assert(hits.find((h) => h.term === 'หายขาด')?.count === 1, 'find: Thai substring in text only (not style/attr)');
assert(hits.find((h) => h.term === 'best')?.count === 1, 'find: Latin whole word only');
const rep = applyBannedReplacements(html, terms);
assert(rep.html.includes('โรคนี้บรรเทาอาการได้') && rep.html.includes('title="หายขาด"') && rep.html.includes('content:"หายขาด"'), 'replace: text only');
assert(rep.html.includes('the great clinic') && rep.html.includes('bestseller'), 'replace: Latin whole word');
assert(rep.replaced === 2, 'replace: count');

// ── matchProductRules ──
const rules: ProductRule[] = [
  { id: '1', product: 'Sentricon', triggers: 'เซนทริคอน, ระบบเหยื่อปลวก', info: 'ข้อมูล S', fileIds: ['f1'], enabled: true },
  { id: '2', product: 'ฉีดพ่น', triggers: '', info: 'ข้อมูลฉีด', fileIds: [], enabled: true },
  { id: '3', product: 'ปิดไว้', triggers: 'ปลวก', info: '', fileIds: [], enabled: false },
];
const m = matchProductRules(rules, 'วิธีกำจัดปลวกด้วย ระบบ เหยื่อปลวก');
assert(m.length === 1 && m[0].id === '1', 'match: trigger with spaces ignored, disabled skipped');

// ── chunk + pick ──
const doc = Array.from({ length: 40 }, (_, i) => (i === 25 ? 'ระบบเหยื่อปลวกใช้สารยับยั้งการลอกคราบ ห้ามอ้างว่าปลอดภัย 100%' : `ย่อหน้าที่ ${i} เรื่องการดูแลสวนและต้นไม้ทั่วไป`)).join('\n');
const chunks = chunkText(doc, 200).map((text, index) => ({ fileId: 'f1', fileName: 'doc.pdf', index, text }));
assert(chunks.length > 5, 'chunk: split into many');
const picked = pickRelevantChunks(chunks, 'เหยื่อปลวก', 250);
assert(picked.length >= 1 && picked.some((c) => c.text.includes('ลอกคราบ')), 'pick: relevant chunk chosen');
assert(picked.reduce((n, c) => n + c.text.length, 0) <= 250, 'pick: within budget');

// ── buildRestrictionsBlock ──
const ctx: RestrictionsContext = {
  rowId: 'r',
  data: { status: 'Active', bannedTerms: 'หายขาด => บรรเทาอาการ', rules: 'ห้ามวินิจฉัยโรค', productRules: rules },
  files: [
    { id: 'f1', name: 'sentricon.pdf', meta: { kind: 'reference', chars: doc.length, size: 1 }, text: doc },
    { id: 'f2', name: 'other.pdf', meta: { kind: 'reference', chars: 10, size: 1 }, text: 'ฉีดพ่นสารเคมีรอบบ้าน' },
  ],
};
const block = buildRestrictionsBlock(ctx, { keyword: 'ระบบเหยื่อปลวก', title: 'ระบบเหยื่อปลวกดีไหม' });
assert(block.includes('"หายขาด" → ใช้ "บรรเทาอาการ" แทน'), 'block: banned term line');
assert(block.includes('ห้ามวินิจฉัยโรค'), 'block: rules');
assert(block.includes('#### Sentricon') && block.includes('ข้อมูล S'), 'block: matched product info');
assert(block.includes('- ฉีดพ่น') && !block.includes('ข้อมูลฉีด'), 'block: unmatched product name only');
assert(block.includes('ลอกคราบ'), 'block: product file chunk');
assert(!block.includes('ฉีดพ่นสารเคมี'), 'block: unrelated reference file excluded');
assert(buildRestrictionsBlock({ rowId: null, data: parseRestrictions(''), files: [] }, {}) === '', 'block: empty when nothing set');

// ── collectBannedSegments / replaceSegments ──
const segTerms = parseBannedTerms('รักษาหาย\ncure');
const segHtml = '<style>p{content:"รักษาหาย"}</style><h2>ยาที่รักษาหาย</h2><p>ข้อความปกติ <a href="/รักษาหาย">ลิงก์</a> และ cure ได้ <strong>ทันที</strong></p>';
const segs = collectBannedSegments(segHtml, segTerms);
assert(segs.length === 2, 'segments: only visible text with banned terms (not style/attribute)');
assert(segs[0].text === 'ยาที่รักษาหาย' && segs[1].text === ' และ cure ได้ ', 'segments: exact text pieces');
const fixed = replaceSegments(segHtml, new Map([[segs[0].id, 'ยาที่ช่วยบรรเทา'], [segs[1].id, 'และช่วยได้<b>x</b>']]));
assert(fixed.includes('<h2>ยาที่ช่วยบรรเทา</h2>'), 'replace: heading text swapped');
assert(fixed.includes('</a> และช่วยได้x <strong>'), 'replace: tags stripped, surrounding spaces kept');
assert(fixed.includes('href="/รักษาหาย"') && fixed.includes('content:"รักษาหาย"'), 'replace: attributes and style untouched');
assert(findBannedTerms(fixed, segTerms).length === 0, 'replace: no visible banned terms left');
assert(replaceSegments(segHtml, new Map([[segs[0].id, '   ']])) === segHtml, 'replace: blank rewrite keeps original');
assert(collectBannedSegments(segHtml, segTerms, 1).length === 1, 'segments: max cap');

// ── title / meta / slug / keyword (ข้อความล้วน ไม่ใช่ HTML) ─────────────────────
console.log('\nplain text / slug / meta block');
const pt = parseBannedTerms('ราคาถูก => ราคาประหยัด\ncheap => budget\nสูตรลับ');
const plain = cleanPlainText('โรงแรมราคาถูก <b> & cheap hotel สูตรลับ', pt);
assert(plain.text.includes('ราคาประหยัด') && plain.text.includes('budget hotel'), 'plain: replaces Thai + latin terms');
assert(plain.text.includes('<b> &'), 'plain: no HTML escaping');
assert(plain.remaining.length === 1 && plain.remaining[0].term === 'สูตรลับ', 'plain: term without replacement stays and is reported');
assert(cleanPlainText('cheapest deal', pt).text === 'cheapest deal', 'plain: latin term needs whole word');
assert(cleanPlainText('ไม่มีคำต้องห้าม', pt).replaced === 0, 'plain: clean text untouched');
assert(findBannedInText('ขอสูตรลับ ราคาถูก', pt).length === 2, 'findBannedInText: counts per term');
assert(cleanPlainText('x cheap', []).text === 'x cheap', 'plain: no terms = identity');

assert(cleanSlug('cheap-hotel-bangkok', pt).text === 'budget-hotel-bangkok', 'slug: latin term replaced');
const slugNoRep = cleanSlug('hotel-cheapest', pt);
assert(slugNoRep.text === 'hotel-cheapest' && slugNoRep.remaining.length === 0, 'slug: whole word only');
const slugKeep = cleanSlug('secret-hotel', parseBannedTerms('secret'));
assert(slugKeep.text === 'secret-hotel' && slugKeep.remaining.length === 1, 'slug: no replacement = unchanged + remaining');
assert(cleanSlug('hotel', pt).text === 'hotel', 'slug: no hit = identity');

assert(hitWarnings('title', [{ term: 'cheap', replacement: null, count: 2 }])[0] === 'title: cheap (2)', 'hitWarnings: label + count');
assert(keywordWarnings('cheap hotel', pt)[0] === 'keyword มีคำต้องห้าม: cheap', 'keywordWarnings: names the term');
assert(keywordWarnings('hotel', pt).length === 0, 'keywordWarnings: none when clean');

const metaHtml = '<!-- CONVERT_CAKE_SEO_META\nmeta_title: โรงแรมราคาถูก\nmeta_description: cheap stay สูตรลับ\nen_slug: cheap-hotel\nfocus_keyword: cheap hotel\n-->\n<h1>x</h1>';
const metaOut = cleanSeoMetaBlock(metaHtml, pt);
assert(metaOut.html.includes('meta_title: โรงแรมราคาประหยัด'), 'meta block: meta_title replaced');
assert(metaOut.html.includes('meta_description: budget stay สูตรลับ'), 'meta block: meta_description replaced');
assert(metaOut.html.includes('en_slug: budget-hotel'), 'meta block: en_slug replaced');
assert(metaOut.html.includes('focus_keyword: cheap hotel'), 'meta block: focus_keyword never changed');
assert(metaOut.warnings.some((w) => w.startsWith('meta description') && w.includes('สูตรลับ')), 'meta block: leftover term warned with label');
assert(cleanSeoMetaBlock('<h1>no block</h1>', pt).html === '<h1>no block</h1>', 'meta block: missing block = identity');
assert(cleanSeoMetaBlock(metaHtml, []).html === metaHtml, 'meta block: no terms = identity');

const tr = titleRestrictionsFrom({ rowId: 'r', files: [], data: { status: 'Active', bannedTerms: 'cheap => budget\nสูตรลับ', rules: 'ห้ามพูดเกินจริง', productRules: [] } });
assert(tr.terms.length === 2 && tr.block.includes('cheap') && tr.block.includes('budget') && tr.block.includes('ห้ามพูดเกินจริง'), 'titleRestrictionsFrom: block lists terms + rules');
assert(titleRestrictionsFrom(null).block === '' && titleRestrictionsFrom(null).terms.length === 0, 'titleRestrictionsFrom: null = none');

const tally = new Map<string, number>();
const gen = cleanGeneratedFields(tr, { title: 'cheap สูตรลับ', metaDescription: 'cheap', slug: 'cheap-x' }, tally);
assert(gen.title === 'budget สูตรลับ' && gen.metaDescription === 'budget' && gen.slug === 'budget-x', 'cleanGeneratedFields: cleans each field');
assert(tally.get('สูตรลับ') === 1 && tally.size === 1, 'cleanGeneratedFields: tally holds leftovers only');
assert(tallyWarning('t', tally) === 't: สูตรลับ (1)' && tallyWarning('t', new Map()) === null, 'tallyWarning: formats / null when empty');

// ── cleanArticlePatch (PATCH /api/articles/[id] แก้มือหน้า Review) ──
const trP = { terms: pt, block: '' };
const draft: Record<string, unknown> = { title: 'cheap hotel', seoTitle: 'โรงแรมราคาถูก', metaDescription: 'สูตรลับ stay', slug: 'cheap-hotel', htmlContent: metaHtml + '<p>cheap body</p>' };
const wDraft = cleanArticlePatch(trP, { wordpressUrl: null, status: 'DRAFT' }, draft);
assert(draft.title === 'budget hotel' && draft.seoTitle === 'โรงแรมราคาประหยัด', 'patch: title/seoTitle replaced');
assert(draft.slug === 'budget-hotel', 'patch: draft slug replaced');
assert(String(draft.htmlContent).includes('en_slug: budget-hotel'), 'patch: draft en_slug replaced');
assert(String(draft.htmlContent).includes('<p>cheap body</p>'), 'patch: body never rewritten');
assert(wDraft.some((w) => w.includes('meta description') && w.includes('สูตรลับ')), 'patch: leftover meta term warned');
assert(wDraft.some((w) => w.startsWith('เนื้อหายังมีคำต้องห้าม') && w.includes('cheap')), 'patch: body hit warned');
assert(new Set(wDraft).size === wDraft.length, 'patch: warnings deduped');

const live: Record<string, unknown> = { slug: 'cheap-hotel', htmlContent: metaHtml };
const wLive = cleanArticlePatch(trP, { wordpressUrl: 'https://x.com/cheap-hotel/', status: 'POSTED' }, live);
assert(live.slug === 'cheap-hotel', 'patch: pushed article slug kept');
assert(String(live.htmlContent).includes('en_slug: cheap-hotel') && String(live.htmlContent).includes('meta_title: โรงแรมราคาประหยัด'), 'patch: pushed keeps en_slug, still cleans meta_title');
assert(wLive.some((w) => w.startsWith('slug มีคำต้องห้าม (บทความขึ้นเว็บแล้ว')), 'patch: pushed slug warned');
const drafted: Record<string, unknown> = { slug: 'cheap-hotel' };
cleanArticlePatch(trP, { wordpressUrl: null, status: 'WORDPRESS_DRAFTED' }, drafted);
assert(drafted.slug === 'cheap-hotel', 'patch: WP draft counts as pushed');
const noTerms: Record<string, unknown> = { title: 'cheap' };
assert(cleanArticlePatch({ terms: [], block: '' }, {}, noTerms).length === 0 && noTerms.title === 'cheap', 'patch: no terms = identity');

console.log(`\n${passed} passed`);
