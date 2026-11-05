/**
 * ด่านตรวจเขียนใหม่ — Run: npx tsx src/lib/upload-article/rewrite-guard.test.ts
 */
import { isNormalStopFinish, plainTextLength, rewriteOutputProblem } from './rewrite-guard'

let passed = 0
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`)
  passed++
}

assert(isNormalStopFinish('stop') && isNormalStopFinish('end_turn') && isNormalStopFinish('completed'), 'stop ปกติ')
assert(!isNormalStopFinish('') && !isNormalStopFinish(undefined) && !isNormalStopFinish('content_filter') && !isNormalStopFinish('length'), 'ว่าง/กรอง/ยาวเกิน = ไม่ผ่าน')
assert(plainTextLength('<p>ab  <b>c</b></p><style>x{}</style>') === 4, 'นับข้อความล้วน')

const old = `<h2>หัว</h2><p>${'ก'.repeat(1000)}</p>`
assert(rewriteOutputProblem(old, `<h2>หัว</h2><p>${'ก'.repeat(600)}</p>`) === null, 'ยาวพอ = ผ่าน')
assert(rewriteOutputProblem(old, `<h2>หัว</h2><p>${'ก'.repeat(400)}</p>`) !== null, 'สั้นกว่าครึ่ง = ไม่ผ่าน')
assert(rewriteOutputProblem(old, `<p>${'ก'.repeat(1000)}</p>`) !== null, 'เดิมมี H2 ใหม่ไม่มี = ไม่ผ่าน')
assert(rewriteOutputProblem(`<p>${'ก'.repeat(100)}</p>`, `<p>${'ก'.repeat(100)}</p>`) === null, 'เดิมไม่มี H2 = ไม่บังคับ')
assert(rewriteOutputProblem('', '<p>x</p>') === null, 'ไม่มีของเดิม = ผ่าน')
console.log(`rewrite-guard: ${passed} passed`)
