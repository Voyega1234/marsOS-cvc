/**
 * นำเข้าคำจากไฟล์ และแปลงไฟล์เป็นข้อความ — ไม่เรียก AI
 * Run: npx tsx src/lib/restriction-table.test.ts
 */
import {
  applyClientConflicts,
  approvedLinesFrom,
  bannedLinesFrom,
  csvToText,
  decodeTextBytes,
  docxHtmlToText,
  htmlTablesToRows,
  linesToCandidates,
  looksLikeBadTermImport,
  officeXmlToText,
  parseCsv,
  parseGenericTermRows,
  parseLegalRows,
  pdfItemsToRows,
  replacementFromNote,
  rtfToText,
  tableToRecords,
  type PdfTextItem,
} from './restriction-table';

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  passed++;
}

// ── ตารางกฎหมาย: หัวตารางอยู่แถวที่ 3 และช่องซ้ายสุดคือหมวด/ลำดับ ซึ่งเป็นต้นเหตุของ "ก. => 1" ──
const LEGAL = [
  ['แนวทางข้อความการโฆษณา', '', '', '', '', '', ''],
  ['', '', '', '', '', '', ''],
  ['หมวด', 'ลำดับ', 'ข้อความ/คำ/แนวทางที่ใช้ในการโฆษณา', 'สามารถโฆษณาได้', 'ไม่สามารถโฆษณาได้', 'หลักเกณฑ์/เหตุผล', 'หมายเหตุ'],
  ['ก.', '1', 'เก่งที่สุด', '', 'X', 'โอ้อวด', ''],
  ['ก.', '2', 'กูรู, GURU', '', 'X', '', ''],
  ['', '3', 'ดูแลโดยแพทย์', '✓', '', '', ''],
  ['', '4', 'แก้จมูก', '', 'X', '', 'ให้ใช้คำว่า "เสริมจมูก"'],
];
const legal = parseLegalRows(LEGAL);
assert(legal !== null, 'พบหัวตารางกฎหมาย');
const legalTerms = legal!.map((c) => c.term);
assert(!legalTerms.includes('ก.') && !legalTerms.includes('1') && !legalTerms.includes('หมวด'), 'ไม่เอาหมวด/ลำดับมาเป็นคำ');
assert(legalTerms.includes('เก่งที่สุด') && legalTerms.includes('กูรู') && legalTerms.includes('GURU'), 'อ่านคำจากคอลัมน์ข้อความและแยกตัวแปร');
assert(legal!.find((c) => c.term === 'ดูแลโดยแพทย์')?.kind === 'approved', '✓ เป็นคำที่ใช้ได้');
assert(legal!.find((c) => c.term === 'เก่งที่สุด')?.kind === 'banned', 'X เป็นคำห้าม');
assert(legal!.find((c) => c.term === 'แก้จมูก')?.replacement === 'เสริมจมูก', 'เอาคำแทนจากหมายเหตุ');
assert(parseLegalRows([['a', 'b'], ['1', '2']]) === null, 'ตารางทั่วไปไม่ถือเป็นตารางกฎหมาย');

assert(replacementFromNote('ให้ใช้คำว่า "ดีขึ้น"', 'x') === 'ดีขึ้น', 'คำแทนจากคำสั่งชัดเจน');
assert(replacementFromNote('ควรระวัง "ดีขึ้น"', 'x') === null, 'ไม่มีคำสั่งแทนคำ ไม่เดาคำแทน');

// ── คำห้ามที่ชนสินค้าต้องไม่ถูกติ๊กให้ก่อน เพราะระบบจะแก้คำนั้นออกจากบทความจริง ──
const stem = parseLegalRows([
  ['ข้อความ', 'สามารถโฆษณาได้', 'ไม่สามารถโฆษณาได้'],
  ['สเต็มเซลล์', '', 'X'],
  ['หายขาด', '', 'X'],
])!;
assert(stem.every((c) => c.ticked), 'ก่อนตรวจชนสินค้าติ๊กไว้');
const clash = applyClientConflicts(stem, { usedTerms: [], productKeywords: 'สเต็มเซลล์, เซลล์ต้นกำเนิด' });
assert(clash.find((c) => c.term === 'สเต็มเซลล์')?.ticked === false, 'คำหลักของสินค้าไม่ถูกติ๊ก');
assert(clash.find((c) => c.term === 'สเต็มเซลล์')!.warnings.length > 0, 'คำที่ชนมีป้ายเตือน');
assert(clash.find((c) => c.term === 'หายขาด')?.ticked === true, 'คำอื่นคงเดิม');
const used = applyClientConflicts(stem, { usedTerms: ['หายขาด'], productKeywords: '' });
assert(used.find((c) => c.term === 'หายขาด')?.ticked === false, 'คำที่พบในไฟล์สินค้าไม่ถูกติ๊ก');
const noConflict = applyClientConflicts(stem, { usedTerms: [], productKeywords: '' });
assert(noConflict[0] === stem[0], 'ไม่ชน = คืนรายการเดิม');

// ── ใส่ลงช่อง ──
const banned = bannedLinesFrom(legal!, 'เก่งที่สุด\nแก้จมูก => เดิม');
assert(!banned.includes('เก่งที่สุด') && !banned.some((l) => l.startsWith('แก้จมูก')), 'ข้ามคำที่มีอยู่แล้ว');
assert(banned.includes('กูรู'), 'เพิ่มคำใหม่');
assert(bannedLinesFrom(legal!, '').includes('แก้จมูก => เสริมจมูก'), 'คำแทนลงรูปแบบ =>');
assert(approvedLinesFrom(legal!, '').includes('ดูแลโดยแพทย์'), 'คำใช้ได้ลงช่องของตัวเอง');
assert(!approvedLinesFrom(legal!, '').includes('เก่งที่สุด'), 'คำห้ามไม่ลงช่องคำใช้ได้');

// ── จับรายการเก่าที่นำเข้าผิด ──
assert(looksLikeBadTermImport('หมวด => ลำดับ\nก. => 1\nก. => 2\nก. => 3\nก. => 4\nก. => 5'), 'จับ ก. => 1 ได้');
assert(!looksLikeBadTermImport('หายขาด => ดีขึ้น\nเก่งที่สุด\nกูรู\nแก้จมูก\nรักษาได้ 100%'), 'รายการปกติไม่ถูกจับ');

// ── ตารางทั่วไป / รายการบรรทัด ──
const generic = parseGenericTermRows([['คำแทน', 'คำต้องห้าม', 'หมายเหตุ'], ['ดีขึ้น', 'หายขาด', 'ก'], ['', 'ที่สุด', 'ข']]);
assert(generic?.find((c) => c.term === 'หายขาด')?.replacement === 'ดีขึ้น', 'คอลัมน์คำแทนไม่ถูกอ่านเป็นคำห้าม แม้มาก่อน');
assert(parseGenericTermRows([['คำต้องห้าม', 'คำแทน'], ['หายขาด', 'ดีขึ้น']]) === null, 'ตาราง 2 คอลัมน์ใช้ตัวอ่านเดิม');
const lines = linesToCandidates('หายขาด => ดีขึ้น\nกูรู\n# หมายเหตุ\n');
assert(lines.length === 2 && lines[0].replacement === 'ดีขึ้น', 'รายการบรรทัดข้ามหมายเหตุ');

// ── PDF: แถวยึดจากเครื่องหมาย และหัวตารางซ้ำทุกหน้าต้องไม่ติดมากับคำ ──
const it = (str: string, x: number, y: number, width = 20): PdfTextItem => ({ str, x, y, width });
const page: PdfTextItem[] = [
  it('ลำดับที่', 27, 864),
  it('ข้อควำม', 103, 872, 30), it('/', 135, 872, 3), it('คำ', 140, 872, 10), it('แนวทำง', 172, 872, 30),
  it('ที่ใช้ในกำรโฆษณำ', 110, 856, 60),
  it('1', 30, 820, 5), it('หน้านางฟ้า', 100, 820, 60), it('X', 300, 820, 6),
  it('2', 30, 780, 5), it('เวทย์มนต์เสกให้สวย', 100, 780, 90), it('X', 300, 780, 6),
  it('3', 30, 740, 5), it('ดูแลโดยแพทย์', 100, 740, 70), it('✓', 256, 740, 6),
  it('4', 30, 700, 5), it('เก่งที่สุด', 100, 700, 50), it('X', 300, 700, 6),
  it('5', 30, 660, 5), it('กูรู', 100, 660, 20), it('X', 300, 660, 6),
];
const pdfRows = pdfItemsToRows([page]);
assert(pdfRows !== null, 'PDF ตารางถูก/ผิดอ่านเป็นแถวได้');
const pdfCandidates = parseLegalRows(pdfRows!, { fromPdf: true })!;
const pdfTerms = pdfCandidates.map((c) => c.term);
assert(pdfTerms.includes('หน้านางฟ้า'), 'คำแถวแรกใต้หัวตารางไม่มีหัวตารางติดมา');
assert(!pdfTerms.some((t) => /ข้อควำม|แนวทำง|ที่ใช้ในกำร/.test(t)), 'ไม่มีหัวตารางในคำ');
assert(pdfCandidates.find((c) => c.term === 'ดูแลโดยแพทย์')?.kind === 'approved', 'เครื่องหมาย ✓ ใน PDF');
assert(pdfItemsToRows([[it('ข้อความธรรมดา', 10, 10)]]) === null, 'PDF ที่ไม่ใช่ตารางคืน null');

// ── แปลงไฟล์เป็นข้อความ ──
const csv = 'หมวด,ข้อความ,หมายเหตุ\nก.,"บรรทัดหนึ่ง\nบรรทัดสอง",เหตุผล\n,,\nข.,อีกแถว,';
assert(parseCsv(csv).length === 4, 'CSV ช่องหลายบรรทัดอยู่แถวเดียว');
const records = csvToText(csv);
assert(records.includes('หมวด: ก. | ข้อความ: บรรทัดหนึ่ง'), 'CSV เป็นระเบียนที่มีชื่อคอลัมน์');
assert(records.split('\n').filter((l) => l.startsWith('หมวด:')).length === 2, 'ข้ามแถวว่าง');
assert(tableToRecords([['a'], ['b']]) === null, 'ตารางคอลัมน์เดียวไม่ทำเป็นระเบียน');

const docxHtml = '<h1>หัวข้อ</h1><p>บรรทัด<br/>ใหม่</p><ul><li>ข้อหนึ่ง</li></ul><table><tr><td>ก</td><td>ข</td></tr></table><p>A&amp;B</p>';
const docxText = docxHtmlToText(docxHtml);
assert(docxText.includes('บรรทัด\nใหม่'), 'คงการขึ้นบรรทัด');
assert(docxText.includes('- ข้อหนึ่ง'), 'คงหัวข้อรายการ');
assert(docxText.includes('ก | ข'), 'คงช่องตาราง');
assert(docxText.includes('A&B'), 'ถอด entity');
assert(docxHtmlToText('<h1>หัวข้อ</h1><p>เนื้อหา</p>').includes('หัวข้อ\nเนื้อหา'), 'หัวข้อกับย่อหน้าไม่ติดกัน');
assert(htmlTablesToRows('<table><tr><td>ก</td><td>ข</td></tr></table>')?.[0][1] === 'ข', 'ตารางใน HTML/Word เป็นแถว');

assert(decodeTextBytes(new TextEncoder().encode('ไทย')) === 'ไทย', 'UTF-8');
assert(decodeTextBytes(new Uint8Array([0xff, 0xfe, 0x44, 0x0e])).includes('ไ'), 'UTF-16 จาก BOM');
assert(decodeTextBytes(new Uint8Array([0xe4, 0xb7, 0xc2])) === 'ไทย', 'Windows-874 จาก Excel ไทย');
assert(rtfToText('{\\rtf1 \\u3652?\\u3607?\\u3618?\\par second}').includes('second'), 'RTF');
assert(officeXmlToText('<a:p><a:t>หนึ่ง</a:t></a:p><a:p><a:t>สอง</a:t></a:p>').includes('หนึ่ง'), 'ข้อความจาก XML ของ PPTX/ODT');

console.log(`restriction-table: ${passed} passed`);
