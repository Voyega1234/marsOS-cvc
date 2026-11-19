// Run: npx tsx src/lib/brand-radar/logo.test.ts
import assert from 'node:assert/strict'
import { brandLogoPath, decodeLogoDataUrl } from './logo'

let passed = 0
function test(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`ok - ${name}`)
}

test('path encodes the project id', () => {
  const p = brandLogoPath('a b&c/d', 1000)
  assert.ok(p.startsWith('/api/brand-radar/logo?projectId=a%20b%26c%2Fd&v='))
})

test('path changes with the version', () => {
  assert.notEqual(brandLogoPath('p1', 1000), brandLogoPath('p1', 2000))
  assert.equal(brandLogoPath('p1', new Date(1000)), brandLogoPath('p1', 1000))
})

test('decode accepts webp, png and jpeg', () => {
  for (const mime of ['image/webp', 'image/png', 'image/jpeg']) {
    const d = decodeLogoDataUrl(`data:${mime};base64,QUJD+/==`)
    assert.deepEqual(d, { mime, base64: 'QUJD+/==' })
  }
})

test('decode rejects anything else', () => {
  assert.equal(decodeLogoDataUrl('data:image/svg+xml;base64,QUJD'), null)
  assert.equal(decodeLogoDataUrl('data:text/html;base64,QUJD'), null)
  assert.equal(decodeLogoDataUrl('data:image/png,QUJD'), null)
  assert.equal(decodeLogoDataUrl('data:image/png;base64,QU JD'), null)
  assert.equal(decodeLogoDataUrl('data:image/png;base64,QUJD<script>'), null)
  assert.equal(decodeLogoDataUrl('data:image/png;base64,'), null)
  assert.equal(decodeLogoDataUrl(''), null)
})

console.log(`${passed} passed`)
