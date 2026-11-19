// เทสช่วงเวลาของหน้า AI Cost: npx tsx src/lib/ai-cost-range.test.ts
import { aiCostCreatedAtFilter, aiCostRangeDays, aiCostRangeQuery, bangkokDateKey, eachDateKey, isDateKey, previousAiCostRange, resolveAiCostRange } from './ai-cost-range'

let passed = 0
function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`FAIL: ${msg}\n  actual:   ${a}\n  expected: ${e}`)
  passed++
}

// 2026-11-16 10:00 เวลาไทย
const NOW = new Date('2026-11-16T03:00:00.000Z')

// วันตามเวลาไทย ไม่ใช่ UTC: 2026-10-31 18:30 UTC = 1 พ.ย. 01:30 เวลาไทย
eq(bangkokDateKey(new Date('2026-10-31T18:30:00.000Z')), '2026-11-01', 'วันข้ามเที่ยงคืนไทยแล้วต้องเป็นวันใหม่')
eq(bangkokDateKey(new Date('2026-10-31T16:59:59.000Z')), '2026-10-31', 'ก่อนเที่ยงคืนไทยยังเป็นวันเดิม')

eq(isDateKey('2026-11-16'), true, 'วันปกติ')
eq(isDateKey('2026-02-31'), false, 'วันที่ไม่มีจริง')
eq(isDateKey('16/11/2026'), false, 'รูปแบบผิด')
eq(isDateKey(''), false, 'ว่าง')

// ค่าเริ่มต้น = เดือนนี้
eq(resolveAiCostRange(undefined, NOW), { preset: 'this_month', from: '2026-11-01', to: '2026-11-16', label: 'เดือนนี้' }, 'ไม่ส่งอะไร = เดือนนี้')
eq(resolveAiCostRange({ range: 'อะไรก็ไม่รู้' }, NOW).preset, 'this_month', 'range อ่านไม่ออก = เดือนนี้')

eq(resolveAiCostRange({ range: 'today' }, NOW), { preset: 'today', from: '2026-11-16', to: '2026-11-16', label: 'วันนี้' }, 'วันนี้')
eq(resolveAiCostRange({ range: '7d' }, NOW), { preset: '7d', from: '2026-11-10', to: '2026-11-16', label: '7 วันล่าสุด' }, '7 วันรวมวันนี้')
eq(resolveAiCostRange({ range: '30d' }, NOW), { preset: '30d', from: '2026-10-18', to: '2026-11-16', label: '30 วันล่าสุด' }, '30 วันรวมวันนี้')
eq(resolveAiCostRange({ range: 'last_month' }, NOW), { preset: 'last_month', from: '2026-10-01', to: '2026-10-31', label: 'เดือนที่แล้ว' }, 'เดือนที่แล้ว')
eq(resolveAiCostRange({ range: 'all' }, NOW), { preset: 'all', from: null, to: null, label: 'ทั้งหมด' }, 'ทั้งหมด')

// เดือนที่แล้วข้ามปี + กุมภาพันธ์
eq(resolveAiCostRange({ range: 'last_month' }, new Date('2027-01-05T03:00:00.000Z')), { preset: 'last_month', from: '2026-12-01', to: '2026-12-31', label: 'เดือนที่แล้ว' }, 'เดือนที่แล้วข้ามปี')
eq(resolveAiCostRange({ range: 'last_month' }, new Date('2028-03-10T03:00:00.000Z')).to, '2028-02-29', 'กุมภาพันธ์ปีอธิกสุรทิน')
// ต้นเดือนตามเวลาไทย ขณะที่ UTC ยังเป็นเดือนก่อน
eq(resolveAiCostRange(undefined, new Date('2026-10-31T18:30:00.000Z')), { preset: 'this_month', from: '2026-11-01', to: '2026-11-01', label: 'เดือนนี้' }, 'เดือนนี้ยึดเวลาไทย')

// กำหนดวันเอง
eq(resolveAiCostRange({ from: '2026-11-03', to: '2026-11-09' }, NOW), { preset: 'custom', from: '2026-11-03', to: '2026-11-09', label: '03/11/2026 – 09/11/2026' }, 'กำหนดวันเอง')
eq(resolveAiCostRange({ from: '2026-11-09', to: '2026-11-03' }, NOW).from, '2026-11-03', 'ใส่กลับด้านต้องสลับ')
eq(resolveAiCostRange({ from: '2026-11-03', to: '2026-11-03' }, NOW).label, '03/11/2026', 'วันเดียว')
eq(resolveAiCostRange({ from: '2026-11-03' }, NOW), { preset: 'custom', from: '2026-11-03', to: null, label: 'ตั้งแต่ 03/11/2026' }, 'มีแต่วันเริ่ม')
eq(resolveAiCostRange({ to: '2026-11-03' }, NOW), { preset: 'custom', from: null, to: '2026-11-03', label: 'ถึง 03/11/2026' }, 'มีแต่วันสิ้นสุด')
eq(resolveAiCostRange({ range: 'all', from: '2026-11-03', to: '2026-11-09' }, NOW).preset, 'custom', 'from/to ชนะ range')
eq(resolveAiCostRange({ from: '2026-02-31', to: 'x' }, NOW).preset, 'this_month', 'วันผิดทั้งคู่ = เดือนนี้')
eq(resolveAiCostRange({ from: ['2026-11-03', '2026-11-05'], to: '2026-11-09' }, NOW).from, '2026-11-03', 'ค่าซ้ำใน query ใช้ตัวแรก')

// ขอบเขตเวลาสำหรับฐานข้อมูล = เที่ยงคืนถึงสิ้นวันตามเวลาไทย
eq(aiCostCreatedAtFilter({ from: '2026-11-01', to: '2026-11-16' }), { gte: '2026-10-31T17:00:00.000Z', lte: '2026-11-16T16:59:59.999Z' }, 'ขอบเขตวันแบบเวลาไทย')
eq(aiCostCreatedAtFilter({ from: null, to: null }), undefined, 'ทั้งหมด = ไม่กรองเวลา')
eq(aiCostCreatedAtFilter({ from: '2026-11-01', to: null }), { gte: '2026-10-31T17:00:00.000Z' }, 'มีแต่ขอบล่าง')

// query string
eq(aiCostRangeQuery({ preset: 'this_month' }), '', 'ค่าเริ่มต้นไม่ต้องมี query')
eq(aiCostRangeQuery({ preset: '7d' }), '?range=7d', 'preset')
eq(aiCostRangeQuery({ from: '2026-11-03', to: '2026-11-09' }), '?from=2026-11-03&to=2026-11-09', 'กำหนดวันเอง')

console.log(`ai-cost-range: ${passed} passed`)

// ช่วงก่อนหน้า (ไว้เทียบ) + รายวัน
eq(previousAiCostRange({ from: '2026-11-01', to: '2026-11-16' }), { from: '2026-10-16', to: '2026-10-31' }, 'ช่วงก่อนหน้ายาวเท่ากัน 16 วัน')
eq(previousAiCostRange({ from: '2026-11-16', to: '2026-11-16' }), { from: '2026-11-15', to: '2026-11-15' }, 'วันเดียว = เมื่อวาน')
eq(previousAiCostRange({ from: null, to: null }), null, 'ทั้งหมด = ไม่มีช่วงก่อนหน้า')
eq(aiCostRangeDays({ from: '2026-11-10', to: '2026-11-16' }), 7, 'นับรวมสองฝั่ง')
eq(eachDateKey('2026-02-27', '2026-03-02'), ['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02'], 'ข้ามเดือน')
eq(eachDateKey('2020-01-01', '2026-01-01'), [], 'ยาวเกินเพดาน = ว่าง')
console.log(`ai-cost-range extra checks passed`)

// URL แปลก ๆ: ก่อน 2020 ไม่รับ, อนาคตตัดเหลือวันนี้
const crafted = resolveAiCostRange({ from: '0001-01-01', to: '2026-11-16' }, NOW)
eq(crafted.from, null, 'from ก่อน 2020 = ไม่รับ')
eq(crafted.to, '2026-11-16', 'to ปกติยังอยู่')
eq(previousAiCostRange(crafted), null, 'ไม่มี from = ไม่มีช่วงก่อนหน้า')
const future = resolveAiCostRange({ from: '2026-11-01', to: '2099-01-01' }, NOW)
eq(future.to, '2026-11-16', 'to อนาคต = วันนี้')
eq(previousAiCostRange({ from: '0001-01-01', to: '2026-11-16' }), null, 'ช่วงก่อนหน้าต่ำกว่าปี 0 = null')
console.log(`ai-cost-range crafted checks passed`)
