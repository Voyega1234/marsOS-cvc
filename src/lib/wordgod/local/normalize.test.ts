/**
 * Tests for order-free dedup key + forbidden terms (feedback HRC 2026-08).
 * Run: npx tsx src/lib/wordgod/local/normalize.test.ts
 */
import { dedupeKey, hasForbiddenTerm, orderFreeKey } from './normalize';

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  passed++;
  console.log(`  ✓ ${msg}`);
}

console.log('orderFreeKey — คำสลับตำแหน่ง');
assert(
  orderFreeKey('ล้างแอร์ บางนา ราคาถูก') === orderFreeKey('บางนา ล้างแอร์ ราคาถูก'),
  'สลับตำแหน่งพื้นที่ = คีย์เดียวกัน (เคสตัวอย่างจาก feedback)'
);
assert(
  orderFreeKey('สั่งประกอบคอม') === orderFreeKey('คอมสั่งประกอบ'),
  'คำไทยติดกันสลับตำแหน่ง = คีย์เดียวกัน (เคสจริงจาก HRC)'
);
assert(
  orderFreeKey('ซ่อมคอม บางแค') !== orderFreeKey('ซ่อมแอร์ บางแค'),
  'คนละบริการ = คนละคีย์'
);

console.log('orderFreeKey — คำพ้อง/รูปเขียน');
assert(
  orderFreeKey('เน็ตบ้าน wifi หลุดบ่อย') === orderFreeKey('เน็ตบ้าน ไวไฟ หลุดบ่อย'),
  'wifi = ไวไฟ'
);
assert(
  orderFreeKey('wi-fi หลุดบ่อย') === orderFreeKey('wifi หลุดบ่อย'),
  'wi-fi = wifi'
);
assert(
  orderFreeKey('โน๊ตบุ๊ค เชื่อมต่อ wifi ไม่ได้') === orderFreeKey('โน้ตบุ๊ก เชื่อม ไวไฟ ไม่ได้'),
  'โน๊ตบุ๊ค/โน้ตบุ๊ก + เชื่อมต่อ/เชื่อม = คีย์เดียวกัน'
);
assert(
  orderFreeKey('วิธีแก้ wifi ช้า') === orderFreeKey('แก้ปัญหา wifi ช้า'),
  'วิธีแก้ = แก้ปัญหา'
);

console.log('orderFreeKey — ไม่ over-merge');
assert(
  orderFreeKey('เรียนต่อ ญี่ปุ่น') !== orderFreeKey('เรียน เชื่อม ญี่ปุ่น'),
  'ต่อ ไม่ถูก map เป็น เชื่อม (กัน over-merge)'
);
assert(
  orderFreeKey('ประกอบคอม ราคา') !== orderFreeKey('ประกอบคอม ราคาถูก'),
  'ราคา กับ ราคาถูก ยังต่างกัน'
);

console.log('orderFreeKey — เสถียรภาพ');
assert(orderFreeKey('') === dedupeKey(''), 'สตริงว่างไม่พัง');
assert(orderFreeKey('SEO') === orderFreeKey('seo'), 'lowercase');
assert(
  orderFreeKey('ล้างแอร์บางแค') === orderFreeKey('ล้างแอร์ บางแค'),
  'เว้นวรรคไทยไม่มีผล (เทียบเท่า dedupeKey เดิม)'
);

console.log('hasForbiddenTerm — pantip');
assert(hasForbiddenTerm('ประกอบคอม pantip') === true, 'pantip โดนตัด');
assert(hasForbiddenTerm('ประกอบคอม Pantip ดีไหม') === true, 'Pantip ตัวใหญ่โดนตัด');
assert(hasForbiddenTerm('ร้านคอม พันทิป') === true, 'พันทิป โดนตัด');
assert(hasForbiddenTerm('รีวิว พันทิพ') === true, 'พันทิพ โดนตัด');
assert(hasForbiddenTerm('ประกอบคอม พันธุ์ทิพย์ พลาซ่า') === false, 'พันธุ์ทิพย์ (ห้าง) ไม่โดนตัด');
assert(hasForbiddenTerm('ล้างแอร์ บางนา') === false, 'คำปกติผ่าน');

console.log(`\nALL PASSED (${passed} assertions)`);
