/**
 * judgeRelatedProducts — ไม่เรียก AI จริง: ส่งตัวปลอมผ่าน opts.chat
 * Run: npx tsx src/lib/ce-restrictions-judge.test.ts
 */
import { judgeRelatedProducts } from './ce-restrictions-server';
import { buildRestrictionsBlock, type ProductRule, type RestrictionsContext } from './ce-restrictions';
import type { orChat } from './openrouter';

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  passed++;
  console.log(`  ✓ ${msg}`);
}

const product: ProductRule = { id: 'i', product: 'ImplantX', triggers: 'รากฟันเทียม', info: 'อัตราสำเร็จ 97%', fileIds: [], enabled: true };
const ctxWith = (productRules: ProductRule[]): RestrictionsContext => ({
  rowId: 'r', files: [], data: { status: 'Active', bannedTerms: '', rules: 'ห้ามวินิจฉัยโรค', productRules, approvedTerms: '', research: [], criticizedSamples: '', strictMode: false },
});
const topic = { keyword: 'ถอนฟันนานแล้ว ใส่ฟันถาวรได้ไหม' };

function fakeChat(reply: string | Error) {
  const calls: Array<Parameters<typeof orChat>[0]> = [];
  const chat = (async (params: Parameters<typeof orChat>[0]) => {
    calls.push(params);
    if (reply instanceof Error) throw reply;
    return { text: reply };
  }) as unknown as typeof orChat;
  return { chat, calls };
}

async function main() {
  const opts = { trace: 'test_match', client: 'c' };

  const none = fakeChat('{"related":["i"]}');
  assert((await judgeRelatedProducts(null, topic, { ...opts, chat: none.chat })).length === 0, 'no restrictions: returns nothing');
  assert((await judgeRelatedProducts(ctxWith([]), topic, { ...opts, chat: none.chat })).length === 0, 'no products: returns nothing');
  await judgeRelatedProducts(ctxWith([product]), { keyword: 'รากฟันเทียม ราคา' }, { ...opts, chat: none.chat });
  assert(none.calls.length === 0, 'no restrictions, no products, or exact word: AI is not called');

  const ok = fakeChat('{"related":["i"]}');
  const ids = await judgeRelatedProducts(ctxWith([product]), topic, { ...opts, chat: ok.chat });
  assert(ids.join() === 'i', 'related product id returned');
  assert(ok.calls.length === 1 && ok.calls[0].jsonMode === true && ok.calls[0].client === 'c', 'one JSON call labelled for the client');
  assert(String(ok.calls[0].model).includes('gemini') || Boolean(process.env.OPENROUTER_DEFAULT_MODEL), 'uses the default gemini model');
  assert(buildRestrictionsBlock(ctxWith([product]), { ...topic, relatedProductIds: ids }).includes('อัตราสำเร็จ 97%'), 'result feeds product data into the block');

  for (const [label, reply] of [['AI error', new Error('timeout')], ['bad JSON', 'ขอโทษครับ'], ['wrong shape', '{"x":1}']] as const) {
    const bad = fakeChat(reply);
    const out = await judgeRelatedProducts(ctxWith([product]), topic, { ...opts, chat: bad.chat });
    assert(out.length === 0, `${label}: falls back without throwing`);
  }

  console.log(`\n${passed} checks passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
