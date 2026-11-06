/**
 * enforceRestrictions + checkAgainstComments กับ title / meta description — ไม่เรียก AI จริง
 * Run: npx tsx src/lib/ce-restrictions-fields.test.ts
 */
import { enforceRestrictions } from './ce-restrictions-server';
import { checkAgainstComments, FIELD_SEGMENT_IDS } from './ce-comment-check';
import type { ClientCommentsContext } from './ce-client-comments';
import type { RestrictionsContext } from './ce-restrictions';
import type { orChat } from './openrouter';

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  passed++;
  console.log(`  ✓ ${msg}`);
}

const ctx: RestrictionsContext = {
  rowId: 'r', files: [],
  data: { status: 'Active', bannedTerms: 'ชะลอวัย\nหายขาด => บรรเทาอาการ', rules: '', productRules: [], approvedTerms: '', research: [], criticizedSamples: '', strictMode: false },
};
const HTML = '<h2>หัวข้อ</h2><p>บทความนี้พูดเรื่องสุขภาพ</p>';

function fakeChat(reply: (user: string) => string) {
  const calls: string[] = [];
  const chat = (async (p: { messages?: Array<{ role: string; content: string }> }) => {
    const user = p.messages?.find((m) => m.role === 'user')?.content ?? '';
    calls.push(user);
    return { text: reply(user), citations: [], usage: { inputTokens: 1, outputTokens: 1, totalTokens: 5, costUsd: 0.001 } };
  }) as unknown as typeof orChat;
  return { chat, calls };
}

async function main() {
  // ไม่ส่ง title = ผลเหมือนเดิม ไม่มี title ในผล
  const plain = fakeChat(() => '{"segments":[]}');
  const r0 = await enforceRestrictions({ ctx, html: HTML, metaDescription: 'สุขภาพดี', trace: 't', chat: plain.chat });
  assert(r0.title === undefined, 'no title param: result has no title');
  assert(plain.calls.length === 0, 'clean body and meta: AI not called');

  // คำแทนที่มีคำแทน แก้ใน title แบบไม่เรียก AI
  const rep = fakeChat(() => '{"segments":[]}');
  const r1 = await enforceRestrictions({ ctx, html: HTML, title: 'รักษาหายขาดได้ไหม', trace: 't', chat: rep.chat });
  assert(r1.title === 'รักษาบรรเทาอาการได้ไหม', 'replacement applied to title');
  assert(rep.calls.length === 0, 'replacement only: AI not called');

  // คำไม่มีคำแทน ใน title ส่งให้ AI เป็นท่อน id -2
  const ai = fakeChat((user) => {
    const items = JSON.parse(user.slice(user.indexOf('{'))).segments as Array<{ id: number; text: string }>;
    return JSON.stringify({ segments: items.map((i) => ({ id: i.id, text: i.id === -2 ? 'การดูแลสุขภาพตามวัยคืออะไร' : i.text })) });
  });
  const r2 = await enforceRestrictions({ ctx, html: HTML, title: 'เวชศาสตร์ชะลอวัยคืออะไร', trace: 't', chat: ai.chat });
  assert(ai.calls.length === 1 && ai.calls[0].includes('"id":-2'), 'banned title sent to AI as segment -2');
  assert(r2.title === 'การดูแลสุขภาพตามวัยคืออะไร', 'title rewritten');
  assert(r2.remaining.length === 0, 'nothing remaining after title fix');

  // AI ล้ม = ชื่อเดิม เตือนคำที่เหลือ
  const fail = (async () => { throw new Error('boom'); }) as unknown as typeof orChat;
  const r3 = await enforceRestrictions({ ctx, html: HTML, title: 'เวชศาสตร์ชะลอวัย', trace: 't', chat: fail });
  assert(r3.title === 'เวชศาสตร์ชะลอวัย', 'AI failure: title kept');
  assert(r3.remaining.some((h) => h.term === 'ชะลอวัย'), 'AI failure: banned title term reported');

  // Comment check ตรวจ title / meta ด้วย
  const comments = {
    rowId: 'c', files: [],
    data: { status: 'Active', comments: [{ id: '1', text: 'FAQ ห้ามขึ้นต้นคำตอบด้วย ไม่ได้', date: '', enabled: true }] },
  } as unknown as ClientCommentsContext;
  const RULES = 'ต้องวาง VAANAA เป็นทางออกตั้งแต่ต้นบทความ\nห้ามเขียนแบบเป็นกลางเปรียบเทียบผู้ให้บริการ';
  const cc = fakeChat(() => JSON.stringify({ violations: [
    { id: FIELD_SEGMENT_IDS.title, quote: 'เปรียบเทียบผู้ให้บริการ', rule: 'ห้ามเขียนแบบเป็นกลางเปรียบเทียบผู้ให้บริการ', fixed: 'ฝาก NK Cell กับ VAANAA ดีอย่างไร' },
    { id: FIELD_SEGMENT_IDS.metaDescription, quote: 'หลายเจ้า', rule: 'ต้องวาง VAANAA เป็นทางออกตั้งแต่ต้นบทความ', fixed: 'VAANAA เก็บ NK Cell ให้คุณ ดูขั้นตอนและราคา' },
  ] }));
  const c1 = await checkAgainstComments({
    comments, rulesText: RULES, html: HTML,
    fields: { title: 'NK Cell เปรียบเทียบผู้ให้บริการ', metaDescription: 'เทียบหลายเจ้าในไทย ดูราคา' },
    bannedTerms: [], trace: 't', chat: cc.chat,
  });
  assert(cc.calls[0].includes('"id":-2') && cc.calls[0].includes('"id":-1'), 'title and meta sent as segments');
  assert(c1.fields?.title === 'ฝาก NK Cell กับ VAANAA ดีอย่างไร', 'comment fix applied to title');
  assert(c1.fields?.metaDescription === 'VAANAA เก็บ NK Cell ให้คุณ ดูขั้นตอนและราคา', 'comment fix applied to meta');
  assert(c1.html === HTML, 'body untouched when only fields fixed');

  // ไม่ส่ง fields = ไม่มีท่อนติดลบ ผลไม่มี fields
  const cc2 = fakeChat(() => '{"violations":[]}');
  const c2 = await checkAgainstComments({ comments, rulesText: RULES, html: HTML, bannedTerms: [], trace: 't', chat: cc2.chat });
  assert(!cc2.calls[0].includes('"id":-'), 'no fields: no negative segments');
  assert(c2.fields === undefined, 'no fields: result has no fields');

  console.log(`ce-restrictions-fields: ${passed} passed`);
}

main().catch((e) => { console.error(e); process.exit(1); });
