/**
 * ตราประทับการเขียน — Run: npx tsx src/lib/upload-article/write-stamp.test.ts
 */
import { buildWriteStampInput, averageCost, computeWriteStamp, diffWriteStamp, hashText, legacyChangedLayers, readWriteStamp } from './write-stamp'

let passed = 0
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`)
  passed++
}

const base = { businessSkill: 'bs', masterPrompt: 'mp', articleBrief: 'ab', validatorPack: 'vp', restrictions: { a: 1, b: [1, 2] }, comments: null, keyword: 'k', language: 'th', note: '', intent: 'info', articleType: 'how', structure: { toc: true }, references: [{ title: 'x', url: 'u' }] }
const s0 = computeWriteStamp(base)

assert(diffWriteStamp(s0, computeWriteStamp({ ...base })).length === 0, 'เหมือนเดิม = ไม่เปลี่ยน')
assert(hashText({ a: 1, b: 2 }) === hashText({ b: 2, a: 1 }), 'ลำดับ key ไม่มีผล')
const d1 = diffWriteStamp(s0, computeWriteStamp({ ...base, masterPrompt: 'mp2' }))
assert(d1.length === 1 && d1[0].key === 'masterPrompt', 'แก้ Master = เปลี่ยน 1 layer')
const s1 = computeWriteStamp({ ...base, masterPrompt: 'mp2' })
assert(diffWriteStamp(s1, computeWriteStamp(base)).length === 1, 'เวอร์ชันใหม่ -> เก่าก็นับว่าเปลี่ยน')
assert(diffWriteStamp(computeWriteStamp(base), computeWriteStamp({ ...base, masterPrompt: 'mp' })).length === 0, 'กู้คืนข้อความเดิม = ไม่เปลี่ยน')
assert(diffWriteStamp(s0, computeWriteStamp({ ...base, restrictions: null })).some((c) => c.key === 'restrictions'), 'ข้อจำกัดหาย = เปลี่ยน')
assert(diffWriteStamp(s0, computeWriteStamp({ ...base, structure: { toc: false }, references: [] })).length === 2, 'structure+references เปลี่ยน')
assert(diffWriteStamp({ masterPrompt: s0.masterPrompt }, computeWriteStamp({ ...base, keyword: 'z' })).length === 0, 'ตราเก่าที่ไม่มี key = ไม่นับ')

assert(diffWriteStamp({ ...s0, title: 'old' }, s0).length === 0, 'ตราเก่ามี key title = ข้าม')
const { language: _l, ...noLang } = s0
assert(diffWriteStamp(noLang, computeWriteStamp({ ...base, language: 'en' })).length === 0, 'ตราเก่าไม่มี language = ข้าม')
assert(diffWriteStamp(s0, computeWriteStamp({ ...base, language: 'en' })).some((c) => c.key === 'language'), 'ภาษาเปลี่ยน = เปลี่ยน')
const ce0 = { businessSkill: null, masterPrompt: null, articleBrief: null, validatorPack: null }
const mk = (structure: unknown, references: unknown) => computeWriteStamp(buildWriteStampInput({ ce: ce0, restrictions: null, clientComments: null, keyword: { keyword: 'k' }, detail: { structure, references } as never, topic: 't' }))
assert(mk({ references: false }, [{ a: 1 }]).references === mk({ references: false }, []).references, 'references ปิด = ไม่นับห้องสมุด')
assert(mk({ references: true }, [{ a: 1 }]).references !== mk({ references: true }, []).references, 'references เปิด = นับห้องสมุด')

const mk2 = (structure: unknown, extra: Record<string, unknown>) => computeWriteStamp(buildWriteStampInput({ ce: ce0, restrictions: null, clientComments: null, keyword: { keyword: 'k' }, detail: { structure, ...extra } as never, topic: 't' }))
const st = { takeaways: true, references: true }
assert(diffWriteStamp(mk2({ ...st, posts: [1], toc: { a: 1 } }, { references: [{ title: 'a', url: 'https://a.com' }] }), mk2({ ...st, posts: [2, 3], toc: { a: 2 } }, { references: [{ title: 'a', url: 'https://a.com' }] })).length === 0, 'posts/toc เปลี่ยนจาก re-scan = ไม่เปลี่ยน')
assert(diffWriteStamp(mk2(st, {}), mk2({ ...st, takeaways: false }, {})).some((c) => c.key === 'structure'), 'ตัวเลือกที่ตัวเขียนเห็นเปลี่ยน = เปลี่ยน')

assert(readWriteStamp({ articleWriteStamps: { a1: s0 } }, 'a1')?.masterPrompt === s0.masterPrompt, 'อ่านตรา')
assert(readWriteStamp({}, 'a1') === null && readWriteStamp({ articleWriteStamps: { a1: 5 } }, 'a1') === null, 'ไม่มี/ผิดรูป = null')

const created = new Date('2026-10-01')
const lg = legacyChangedLayers([
  { key: 'masterPrompt', updatedAt: new Date('2026-10-05') },
  { key: 'articleBrief', updatedAt: new Date('2026-09-01') },
  { key: 'businessSkill', updatedAt: null },
], created)
assert(lg.length === 1 && lg[0].key === 'masterPrompt', 'legacy: เฉพาะที่แก้หลังบทความถูกสร้าง')

assert(averageCost([]) === null && averageCost([0, null]) === null, 'ไม่มีข้อมูลต้นทุน = null')
const ac = averageCost([0.2, 0.4, null, 0])
assert(ac !== null && Math.abs(ac.avg - 0.3) < 1e-9 && ac.samples === 2, 'เฉลี่ยต้นทุน')

console.log(`write-stamp: ${passed} passed`)
