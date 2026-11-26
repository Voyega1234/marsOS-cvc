import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_TRANSLATE_SOURCES, addTranslateSources, hiddenTranslateSourceIds, readTranslateSources } from './translate-sources'

test('readTranslateSources keeps unique non-empty string ids only', () => {
  assert.deepEqual(readTranslateSources(undefined), [])
  assert.deepEqual(readTranslateSources('a'), [])
  assert.deepEqual(readTranslateSources(['a', ' a ', '', 3, null, 'b', 'x'.repeat(65)]), ['a', 'b'])
})

test('readTranslateSources caps the list', () => {
  const many = Array.from({ length: MAX_TRANSLATE_SOURCES + 50 }, (_, i) => `id${i}`)
  const out = readTranslateSources(many)
  assert.equal(out.length, MAX_TRANSLATE_SOURCES)
  assert.equal(out[0], 'id0')
})

test('addTranslateSources puts new ids first without duplicates', () => {
  assert.deepEqual(addTranslateSources(['a', 'b'], ['c', 'a']), ['c', 'a', 'b'])
  assert.deepEqual(addTranslateSources('broken', ['c']), ['c'])
})

test('hiddenTranslateSourceIds hides marked rows only while they are IMPORTED', () => {
  const rows = [
    { id: 'src', status: 'IMPORTED' },
    { id: 'src-generated', status: 'GENERATED' },
    { id: 'translation', status: 'GENERATED' },
    { id: 'other-import', status: 'IMPORTED' },
  ]
  const hidden = hiddenTranslateSourceIds(rows, ['src', 'src-generated'])
  assert.deepEqual(Array.from(hidden), ['src'])
  assert.equal(hiddenTranslateSourceIds(rows, undefined).size, 0)
  assert.equal(hiddenTranslateSourceIds(rows, []).size, 0)
})
