/**
 * stripEditorialNotes — ข้อความขั้นตอนภายในที่หลุดเข้าบทความ
 * Run: npx tsx src/lib/article-editorial-notes.test.ts
 */
import { HUMAN_BODY_RULES_EN, HUMAN_BODY_RULES_TH, humanVoiceSkillBlock, stripEditorialNotes } from './article-human-voice-skill';

let passed = 0;
function eq(actual: string, expected: string, msg: string): void {
  if (actual !== expected) throw new Error(`FAILED: ${msg}\n  got:  ${actual}\n  want: ${expected}`);
  passed++;
}
function same(html: string, msg: string): void {
  eq(stripEditorialNotes(html), html, msg);
}

// ประโยคจริงจากบทความเทส 2026-11-05
eq(
  stripEditorialNotes('<p><em>บทความนี้ให้ข้อมูลทั่วไป ไม่ใช้แทนการตรวจ วินิจฉัย หรือวางแผนรักษาโดยทันตแพทย์ และควรผ่านการตรวจทานโดยทันตแพทย์ก่อนเผยแพร่ ผู้ที่กำลังพิจารณาใส่ฟันทดแทนควรปรึกษาทันตแพทย์ก่อนตัดสินใจ</em></p>'),
  '<p><em>บทความนี้ให้ข้อมูลทั่วไป ไม่ใช้แทนการตรวจ วินิจฉัย หรือวางแผนรักษาโดยทันตแพทย์ ผู้ที่กำลังพิจารณาใส่ฟันทดแทนควรปรึกษาทันตแพทย์ก่อนตัดสินใจ</em></p>',
  'real leaked clause is cut, reader advice stays',
);
eq(stripEditorialNotes('<p>ก่อน</p><p>บทความนี้ต้องส่ง Expert Review ก่อนเผยแพร่</p><p>หลัง</p>'), '<p>ก่อน</p><p>หลัง</p>', 'paragraph that is only the note is removed');
eq(stripEditorialNotes('<p><em>เนื้อหานี้ควรได้รับการอนุมัติจากแพทย์ก่อนการเผยแพร่</em></p>'), '', 'note wrapped in em leaves no empty paragraph');
eq(
  stripEditorialNotes('<p>This article provides general information and is not a substitute for care, and should be reviewed by a dentist before publication. Talk to your dentist.</p>'),
  '<p>This article provides general information and is not a substitute for care. Talk to your dentist.</p>',
  'English clause is cut',
);
eq(stripEditorialNotes('<p>This article must be approved by a doctor before publishing.</p>'), '', 'English note-only paragraph is removed');

// เรื่องที่พูดถึงการตรวจก่อนเผยแพร่จริง ๆ ต้องอยู่ครบ — ใช้ได้ทุกวงการ
same('<p>ข่าวประชาสัมพันธ์ทุกชิ้นควรผ่านการตรวจทานโดยบรรณาธิการก่อนเผยแพร่</p>', 'press-release topic stays');
same('<p>โฆษณาอาหารเสริมต้องขออนุมัติจาก อย. ก่อนเผยแพร่ ไม่อย่างนั้นอาจถูกปรับ</p>', 'regulatory fact stays');
same('<p>บทความนี้อธิบายว่าทีมคอนเทนต์ควรตรวจทานงานก่อนเผยแพร่อย่างไร</p>', 'article about editing stays');
same('<p>Every press release should be reviewed by an editor before publication.</p>', 'English press-release topic stays');
same('<p><em>บทความนี้ให้ข้อมูลทั่วไป ไม่ใช้แทนการวินิจฉัย ควรปรึกษาทันตแพทย์ก่อนตัดสินใจ</em></p>', 'normal disclaimer stays byte for byte');
same('<h2>ควรตรวจสอบอะไรก่อนเผยแพร่</h2><ul><li>ตัวสะกด</li></ul>', 'headings and lists are not touched');
same('', 'empty input');

// กฎใน prompt ไปถึงตัวเขียนทุกครั้ง โดยไม่แตะข้อแรกที่ใช้เช็คว่า Master Prompt มีกฎแล้ว
eq(HUMAN_BODY_RULES_TH[0].slice(0, 22), 'เขียนเหมือนคนที่รู้เรื่องนั้น'.slice(0, 22), 'first Thai rule is unchanged');
if (!humanVoiceSkillBlock('th').includes('ก่อนเผยแพร่')) throw new Error('FAILED: Thai skill has no internal-workflow rule');
if (!humanVoiceSkillBlock('en').includes('before publication')) throw new Error('FAILED: English skill has no internal-workflow rule');
if (!HUMAN_BODY_RULES_EN.some((r) => r.includes('before publication'))) throw new Error('FAILED: English rule missing');
passed += 3;

console.log(`passed ${passed}`);
