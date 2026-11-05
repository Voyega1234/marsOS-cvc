/**
 * Comment ลูกค้าใน Content Engine — ไม่กรอก/ปิด ต้องได้ prompt เท่าเดิม
 * Run: npx tsx src/lib/ce-client-comments.test.ts
 */
import {
  CLIENT_COMMENT_BUDGET,
  buildClientCommentsBlock,
  clientCommentsValidatorNote,
  emptyClientComments,
  hasClientComments,
  joinPromptBlocks,
  parseClientComments,
  type ClientCommentsContext,
} from './ce-client-comments';
import type { RestrictionFile } from './ce-restrictions';

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  passed++;
}

const topic = { keyword: 'สเต็มเซลล์เข่า', title: 'สเต็มเซลล์', outline: '' };
const ctx = (data: Partial<ClientCommentsContext['data']>, files: RestrictionFile[] = []): ClientCommentsContext => ({
  rowId: 'r',
  data: { ...emptyClientComments(), ...data },
  files,
});
const file = (name: string, text: string): RestrictionFile =>
  ({ id: name, name, text, meta: { kind: 'comment', chars: text.length, size: text.length } }) as unknown as RestrictionFile;

// ไม่มีข้อมูล = ไม่เพิ่มอะไรใน prompt
assert(buildClientCommentsBlock(null, topic) === '', 'ไม่มีแถว = ไม่มีบล็อก');
assert(buildClientCommentsBlock(ctx({}), topic) === '', 'แถวว่าง = ไม่มีบล็อก');
assert(clientCommentsValidatorNote(null) === '', 'ไม่มีแถว = ไม่มี validator note');
assert(joinPromptBlocks('', null, undefined, '  ') === '', 'ไม่มีบล็อกเลยได้ค่าว่าง');
assert(joinPromptBlocks('ก', '', 'ข') === 'ก\n\nข', 'รวมเฉพาะบล็อกที่มี');

// อ่านค่าเก่าและข้อมูลเสีย
assert(parseClientComments('').comments.length === 0, 'ค่าว่าง');
assert(parseClientComments('ข้อความล้วน').comments[0].text === 'ข้อความล้วน', 'ข้อความล้วนเป็น comment เดียว');
assert(parseClientComments('{"status":"Draft","comments":[]}').status === 'Draft', 'อ่านสถานะ');
assert(parseClientComments('{"comments":[{"text":"ก"},null]}').comments.length === 1, 'ข้ามค่าที่ไม่ใช่ object');

// comment ที่ปิดอยู่ไม่เข้า prompt
const off = ctx({ comments: [{ id: '1', text: 'ปิดอยู่', date: '', enabled: false }] });
assert(!hasClientComments(off), 'comment ที่ปิดไม่นับ');
assert(buildClientCommentsBlock(off, topic) === '', 'comment ที่ปิดไม่เข้า prompt');

// ล่าสุดมาก่อน และกฎลำดับความสำคัญอยู่ครบ
const two = buildClientCommentsBlock(
  ctx({ comments: [
    { id: '1', text: 'เก่า', date: '2026-01-01', enabled: true },
    { id: '2', text: 'ใหม่', date: '2026-02-01', enabled: true },
  ] }),
  topic,
);
assert(two.indexOf('ใหม่') < two.indexOf('เก่า') && two.includes('[2026-02-01]'), 'เรียงใหม่ไปเก่า');
assert(two.includes('ให้ยึดข้อจำกัด'), 'ขัดกันให้ยึดข้อจำกัด');
assert(two.includes('ห้ามแต่งข้อมูล'), 'ห้ามแต่งข้อมูลเพื่อทำตาม Comment');
assert(two.includes('ห้ามเขียนลงบทความ'), 'ส่วนที่ลูกค้าบอกว่าพูดไม่ได้ ห้ามลงบทความ');

// งบข้อความ
const big = buildClientCommentsBlock(
  ctx({ comments: [
    { id: '1', text: 'เก่าสุด'.repeat(2000), date: '', enabled: true },
    { id: '2', text: 'ล่าสุด'.repeat(1000), date: '', enabled: true },
  ] }),
  topic,
);
assert(big.length < CLIENT_COMMENT_BUDGET.text + 1500, 'ข้อความไม่เกินงบ');
assert(big.includes('ล่าสุด'), 'ล้นงบยังเหลือ comment ล่าสุด');

// ไฟล์
const short = buildClientCommentsBlock(ctx({}, [file('c.docx', 'ลูกค้าติโทนคนกลาง')]), topic);
assert(short.includes('[c.docx]') && short.includes('ลูกค้าติโทนคนกลาง'), 'ไฟล์สั้นส่งครบ');
const long = 'เรื่องอื่นที่ไม่เกี่ยวข้อง\n'.repeat(800) + '\n\nสเต็มเซลล์เข่าต้องเขียนแบบผู้เชี่ยวชาญ';
const picked = buildClientCommentsBlock(ctx({}, [file('long.docx', long)]), topic);
assert(picked.includes('สเต็มเซลล์เข่าต้องเขียนแบบผู้เชี่ยวชาญ'), 'ไฟล์ยาวเลือกส่วนที่ตรงหัวข้อ');
assert(picked.length < CLIENT_COMMENT_BUDGET.files + 1500, 'ไฟล์ไม่เกินงบ');
const unrelated = buildClientCommentsBlock(ctx({}, [file('other.docx', 'ข้อความทั่วไป\n'.repeat(1500))]), topic);
assert(unrelated.includes('ข้อความทั่วไป'), 'ไม่ตรงหัวข้อเลยยังส่งจากต้นไฟล์');
assert(clientCommentsValidatorNote(ctx({}, [file('c.docx', 'x')])).includes('BLOCKING'), 'มีไฟล์ = validator ตรวจ');

// งบไฟล์ใช้ร่วมกัน: ไฟล์สั้นไม่กันงบไฟล์ยาว และไม่มีไฟล์ไหนถูกทิ้ง
const pooled = buildClientCommentsBlock(
  ctx({}, [
    file('short.docx', 'ลูกค้าติโทนคนกลาง'),
    file('long.docx', 'สเต็มเซลล์เข่าต้องเขียนแบบผู้เชี่ยวชาญ\n\n'.repeat(1200)),
  ]),
  topic,
);
assert(pooled.includes('[short.docx]') && pooled.includes('[long.docx]'), 'ไฟล์สั้นและยาวเข้าครบทั้งคู่');
assert(pooled.length > CLIENT_COMMENT_BUDGET.files * 0.6, 'ไฟล์ยาวได้งบที่ไฟล์สั้นไม่ใช้');
assert(pooled.length < CLIENT_COMMENT_BUDGET.files + 1500, 'รวมแล้วไม่เกินงบ');
const three = buildClientCommentsBlock(
  ctx({}, ['ก', 'ข', 'ค'].map((n) => file(`${n}.docx`, `สเต็มเซลล์เข่า ${n}\n\n`.repeat(1500)))),
  topic,
);
assert(['ก', 'ข', 'ค'].every((n) => three.includes(`[${n}.docx]`)), 'ไฟล์ยาวหลายไฟล์ได้งบทุกไฟล์');
assert(three.length < CLIENT_COMMENT_BUDGET.files + 1500, 'ไฟล์ยาวหลายไฟล์ไม่เกินงบ');

// ลำดับความสำคัญ
const rules = buildClientCommentsBlock(ctx({ comments: [{ id: '1', text: 'ขอโทนผู้เชี่ยวชาญ', date: '', enabled: true }] } as never), topic);
assert(rules.includes('Comment ชนะ Master Prompt'), 'Comment ชนะ Master เรื่องมุมมอง');
assert(rules.includes('ให้ยึดข้อจำกัด'), 'ข้อจำกัดชนะ Comment');
assert(rules.includes('ข้อมูลจริงที่ลูกค้าให้ไว้ใน Comment'), 'ใช้ข้อมูลจริงใน Comment ได้');
assert(rules.includes('ห้ามแต่งข้อมูล'), 'ห้ามแต่งเพื่อทำตาม Comment');
assert(rules.includes('ห้ามเอ่ยถึง Comment'), 'ห้ามเอ่ยถึง Comment ในบทความ');
assert(rules.includes('พูดไม่ได้'), 'ส่วนที่พูดไม่ได้ห้ามเขียน');

console.log(`ce-client-comments: ${passed} passed`);
