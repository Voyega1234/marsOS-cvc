/**
 * Content Engine ข้อจำกัด (Restrictions) — แยกคำต้องห้าม, จับคู่สินค้า, เลือกส่วนของไฟล์, แทนคำ
 * Run: npx tsx src/lib/ce-restrictions.test.ts
 */
import {
  applyBannedReplacements,
  bannedTermsFromTable,
  buildRestrictionsBlock,
  chunkText,
  collectBannedSegments,
  findBannedTerms,
  matchProductRules,
  parseBannedTerms,
  parseRestrictions,
  pickRelevantChunks,
  replaceSegments,
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

console.log(`\n${passed} passed`);
