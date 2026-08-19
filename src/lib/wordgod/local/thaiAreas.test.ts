/**
 * ทดสอบฐานข้อมูลพื้นที่ — รันด้วย: npx tsx src/lib/wordgod/local/thaiAreas.test.ts
 */

import { findNearbyAreas, normalizeAreaName, AREA_DB_COVERAGE } from './thaiAreas';

let failures = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${message}`);
  }
}

console.log('normalizeAreaName');
assert(normalizeAreaName('เขตบางแค') === 'บางแค', 'ตัดคำนำหน้า "เขต"');
assert(normalizeAreaName(' แขวง บางหว้า ') === 'บางหว้า', 'ตัด "แขวง" และช่องว่าง');
assert(normalizeAreaName('อ.บางกรวย') === 'บางกรวย', 'ตัด "อ."');

console.log('\nจับคู่จากชื่อเขต');
const bangkae = findNearbyAreas('บางแค');
assert(bangkae !== null, 'รู้จัก "บางแค"');
assert(bangkae?.province === 'กรุงเทพมหานคร', 'บางแคอยู่ กทม.');
assert(bangkae?.matchedVia === 'district', 'จับคู่จากชื่อเขต');
assert(
  bangkae?.suggestions.some(s => s.relation === 'subdistrict' && s.name === 'หลักสอง') === true,
  'เสนอแขวงหลักสอง'
);
assert(
  bangkae?.suggestions.some(s => s.relation === 'adjacent' && s.name === 'หนองแขม') === true,
  'เสนอเขตหนองแขม (ติดกัน)'
);
assert(
  bangkae?.suggestions.some(s => s.relation === 'transit' && s.name === 'MRT หลักสอง') === true,
  'เสนอ MRT หลักสอง'
);
assert(
  bangkae?.suggestions.find(s => s.name === 'MRT หลักสอง')?.type === 'mrt',
  'สถานี MRT ได้ type = mrt'
);

assert(
  bangkae?.suggestions.every(s => normalizeAreaName(s.name) !== 'บางแค') === true,
  'ไม่เสนอแขวงชื่อเดียวกับเขต (แขวงบางแค)'
);

console.log('\nจับคู่ย้อนจากชื่อแขวง');
const bangwa = findNearbyAreas('บางหว้า');
assert(bangwa?.name === 'ภาษีเจริญ', '"บางหว้า" ย้อนขึ้นเขตภาษีเจริญ');
assert(bangwa?.matchedVia === 'subdistrict', 'ระบุว่าจับคู่จากแขวง');
assert(
  bangwa?.suggestions.every(s => normalizeAreaName(s.name) !== 'บางหว้า') === true,
  'ไม่เสนอชื่อตัวเองซ้ำ'
);
assert(
  bangwa?.suggestions.some(s => s.name === 'BTS บางหว้า') === true,
  'ยังเสนอ BTS บางหว้า (คนละชื่อกับแขวง)'
);

console.log('\nข้ามจังหวัด');
const bangkruai = findNearbyAreas('บางกรวย');
assert(bangkruai?.province === 'นนทบุรี', 'บางกรวยอยู่ นนทบุรี');
assert(
  bangkruai?.suggestions.find(s => s.name === 'ตลิ่งชัน')?.parent === 'กรุงเทพมหานคร',
  'เขตข้างเคียงข้ามจังหวัดใช้จังหวัดของเขตนั้นจริง'
);

console.log('\nไม่รู้จัก');
assert(findNearbyAreas('เชียงคาน') === null, 'พื้นที่นอกขอบเขต คืน null (ไม่เดา)');
assert(findNearbyAreas('') === null, 'ค่าว่าง คืน null');

console.log('\nความครอบคลุม');
assert(AREA_DB_COVERAGE.districts >= 50, `มีเขต/อำเภอ ${AREA_DB_COVERAGE.districts} รายการ`);
for (const name of ['พระนคร', 'ห้วยขวาง', 'ทุ่งครุ', 'บางบอน', 'สายไหม', 'ทวีวัฒนา']) {
  assert(findNearbyAreas(name) !== null, `รู้จักเขต${name}`);
}

console.log(failures === 0 ? '\nผ่านทั้งหมด' : `\nไม่ผ่าน ${failures} ข้อ`);
process.exit(failures === 0 ? 0 : 1);
