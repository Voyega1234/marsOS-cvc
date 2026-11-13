/**
 * diffWords — word-level diff for client proposals
 * Run: npx tsx src/lib/client-proposal/diff.test.ts
 */
import assert from 'node:assert';
import { diffWords } from './diff';

let passed = 0;
function t(name: string, fn: () => void): void { fn(); passed++; console.log('ok -', name); }
const join = (p: { type: string; text: string }[], ty: string) => p.filter((x) => x.type === ty).map((x) => x.text).join('');

t('identical', () => assert.deepStrictEqual(diffWords('hello world', 'hello world'), [{ type: 'same', text: 'hello world' }]));
t('both empty', () => assert.deepStrictEqual(diffWords('', ''), []));
t('pure insert', () => {
  const p = diffWords('hello world', 'hello big world');
  assert.strictEqual(join(p, 'ins'), 'big ');
  assert.strictEqual(join(p, 'del'), '');
  assert.strictEqual(join(p, 'same') + join(p, 'ins'), 'hello world' + 'big ');
});
t('pure delete', () => {
  const p = diffWords('hello big world', 'hello world');
  assert.strictEqual(join(p, 'del'), 'big ');
  assert.strictEqual(join(p, 'ins'), '');
});
t('replace in the middle', () => {
  const p = diffWords('the quick brown fox', 'the slow brown fox');
  assert.strictEqual(join(p, 'del'), 'quick');
  assert.strictEqual(join(p, 'ins'), 'slow');
  assert.ok(p[0].type === 'same' && p[0].text === 'the ');
  assert.ok(p[p.length - 1].type === 'same' && p[p.length - 1].text === ' brown fox');
});
t('thai sentence one word changed', () => {
  const a = 'บริการดูแลผิวหน้าที่ดีที่สุดในกรุงเทพ';
  const b = 'บริการดูแลผิวหน้าที่ถูกที่สุดในกรุงเทพ';
  const p = diffWords(a, b);
  assert.strictEqual(join(p, 'del') + join(p, 'same'), join(p, 'del') + join(p, 'same'));
  assert.ok(join(p, 'del').length > 0 && join(p, 'ins').length > 0);
  assert.ok(join(p, 'del').length < a.length, 'only a small part is marked deleted');
  // reconstruct both sides
  assert.strictEqual(p.filter((x) => x.type !== 'ins').map((x) => x.text).join(''), a);
  assert.strictEqual(p.filter((x) => x.type !== 'del').map((x) => x.text).join(''), b);
});
t('empty before', () => assert.deepStrictEqual(diffWords('', 'new text'), [{ type: 'ins', text: 'new text' }]));
t('empty after', () => assert.deepStrictEqual(diffWords('old text', ''), [{ type: 'del', text: 'old text' }]));
t('size fallback', () => {
  const a = Array.from({ length: 2500 }, (_, i) => 'a' + i).join(' ');
  const b = Array.from({ length: 2500 }, (_, i) => 'b' + i).join(' ');
  assert.deepStrictEqual(diffWords(a, b), [{ type: 'del', text: a }, { type: 'ins', text: b }]);
});

console.log(`${passed} passed`);
