// npx tsx src/lib/ce-comment-check.test.ts
import assert from "node:assert/strict";
import type { ClientCommentsContext } from "@/lib/ce-client-comments";
import {
  applyCommentViolations,
  checkAgainstComments,
  commentCheckSegments,
  parseCommentViolations,
} from "@/lib/ce-comment-check";
import type { BannedTerm } from "@/lib/ce-restrictions";
import type { orChat } from "@/lib/openrouter";

const comments: ClientCommentsContext = {
  rowId: "c",
  data: { status: "Active", comments: [{ id: "1", text: "ห้ามพูดว่ารักษาหายขาด", date: "", enabled: true }] },
  files: [],
} as unknown as ClientCommentsContext;
const RULES = "ห้ามพูดว่ารักษาหายขาด\nเก็บ Master Cell จำนวน 20 ล้านเซลล์";
const HTML = '<style>p{color:red}</style><!-- META\nmeta_title: x --><h2>หัวข้อหลัก</h2><p class="a">เซลล์ช่วยให้รักษาหายขาด <strong>ได้แน่นอน</strong> ในทุกกรณี</p><p>เก็บ Master Cell จำนวน 10 ล้านเซลล์</p>';

const segOf = (needle: string) => {
  const s = commentCheckSegments(HTML).find((x) => x.text.includes(needle));
  assert.ok(s, needle);
  return s;
};
const chatReturning = (text: string, calls: unknown[] = []) =>
  (async (p: unknown) => {
    calls.push(p);
    return { text, citations: [], usage: { inputTokens: 1, outputTokens: 1, totalTokens: 7, costUsd: 0.003 } };
  }) as unknown as typeof orChat;
const run = (chat: typeof orChat, html = HTML, c: ClientCommentsContext | null = comments, rulesText = RULES) =>
  checkAgainstComments({ comments: c, rulesText, html, bannedTerms: [], trace: "t", chat });

let passed = 0;
const test = async (name: string, fn: () => void | Promise<void>) => {
  try {
    await fn();
    passed++;
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
};

(async () => {
  await test("ไม่มี Comment หรือไม่มีกฎ = ไม่เรียก AI", async () => {
    const calls: unknown[] = [];
    const a = await run(chatReturning("{}", calls), HTML, null);
    const b = await run(chatReturning("{}", calls), HTML, comments, "   ");
    assert.equal(calls.length, 0);
    assert.equal(a.html, HTML);
    assert.equal(b.costUsd, 0);
  });

  await test("ท่อนที่ตรวจไม่รวม style, script และ comment", () => {
    const texts = commentCheckSegments(HTML).map((s) => s.text);
    assert.ok(!texts.some((t) => t.includes("color:red") || t.includes("meta_title")));
    assert.ok(texts.includes("หัวข้อหลัก"));
  });

  await test("แก้เฉพาะท่อนที่ขัด ไม่แตะ tag และท่อนอื่น", async () => {
    const seg = segOf("10 ล้าน");
    const res = await run(
      chatReturning(JSON.stringify({
        violations: [{ id: seg.id, quote: "10 ล้านเซลล์", rule: "เก็บ Master Cell จำนวน 20 ล้านเซลล์", fixed: "เก็บ Master Cell จำนวน 20 ล้านเซลล์" }],
      })),
    );
    assert.ok(res.html.includes("<p>เก็บ Master Cell จำนวน 20 ล้านเซลล์</p>"));
    assert.ok(res.html.includes('<p class="a">เซลล์ช่วยให้รักษาหายขาด <strong>ได้แน่นอน</strong>'));
    assert.ok(res.html.startsWith("<style>p{color:red}</style>"));
    assert.equal(res.fixes.length, 1);
    assert.equal(res.costUsd, 0.003);
    assert.equal(res.tokens, 7);
    assert.deepEqual(res.warnings, ['แก้ตาม Comment แล้ว กรุณาตรวจ: "เก็บ Master Cell จำนวน 20 ล้านเซลล์"']);
  });

  await test("ไม่พบปัญหา = HTML เดิมทุกไบต์", async () => {
    const res = await run(chatReturning('{"violations":[]}'));
    assert.equal(res.html, HTML);
    assert.deepEqual(res.fixes, []);
  });

  const seg = segOf("10 ล้าน");
  const base = { html: HTML, segments: commentCheckSegments(HTML), rulesText: RULES, bannedTerms: [] as BannedTerm[] };
  const good = { id: seg.id, quote: "10 ล้านเซลล์", rule: "เก็บ Master Cell จำนวน 20 ล้านเซลล์", fixed: "เก็บ Master Cell จำนวน 20 ล้านเซลล์" };

  await test("กฎต่างกันแค่เครื่องหมายคำพูดหรือจุดไข่ปลา ยังถือว่าอ้างกฎจริง", () => {
    const rulesText = 'ISSUE: ตอบแบบปัดตก เช่น “ไม่สามารถรับรอง”, “ไม่สามารถบอกได้ว่า….” และ &quot;ไม่รับรองผล&quot; ห้ามใช้';
    const fixed = "เก็บ Master Cell จำนวน 10 ล้านเซลล์ตามแผน";
    for (const rule of ['ตอบแบบปัดตก เช่น "ไม่สามารถรับรอง", "ไม่สามารถบอกได้ว่า..."', '"ไม่รับรองผล" ห้ามใช้']) {
      const res = applyCommentViolations({ ...base, rulesText, violations: [{ ...good, rule, fixed }] });
      assert.equal(res.fixes.length, 1, rule);
      assert.ok(res.html.includes(fixed), rule);
      assert.ok(res.warnings[0].startsWith("แก้ตาม Comment แล้ว"), rule);
      assert.ok(res.warnings[0].includes(fixed), rule);
    }
  });

  await test("อ้างกฎที่ไม่มีจริง หรือท่อนที่ไม่มีจริง = ทิ้งเงียบ", () => {
    for (const v of [{ ...good, rule: "กฎที่แต่งขึ้นเอง" }, { ...good, quote: "ไม่มีในท่อนนี้" }, { ...good, id: 9999 }, { ...good, rule: "ห้าม" }]) {
      const res = applyCommentViolations({ ...base, violations: [v] });
      assert.equal(res.html, HTML);
      assert.deepEqual(res.warnings, []);
    }
  });

  await test("แก้แล้วไม่ผ่านด่าน = ไม่แทน แต่เตือน", () => {
    const banned = [{ term: "ทางเลือกที่ดีที่สุด" }] as unknown as BannedTerm[];
    const cases = [
      { v: { ...good, fixed: "เก็บ Master Cell จำนวน 99 ล้านเซลล์" }, b: [] as BannedTerm[] },
      { v: { ...good, fixed: "สั้น" }, b: [] as BannedTerm[] },
      { v: { ...good, fixed: "ยาวเกินไป ".repeat(30) }, b: [] as BannedTerm[] },
      { v: { ...good, fixed: "   " }, b: [] as BannedTerm[] },
      { v: { ...good, fixed: "Master Cell ทางเลือกที่ดีที่สุด 20 ล้านเซลล์" }, b: banned },
    ];
    for (const { v, b } of cases) {
      const res = applyCommentViolations({ ...base, violations: [v], bannedTerms: b });
      assert.equal(res.html, HTML, v.fixed);
      assert.equal(res.warnings.length, 1, v.fixed);
    }
  });

  await test("คำตอบแก้ HTML ใส่มาไม่ได้", () => {
    const res = applyCommentViolations({ ...base, violations: [{ ...good, fixed: '<img src=x onerror=y>เก็บ Master Cell จำนวน 20 ล้านเซลล์' }] });
    assert.ok(!res.html.includes("onerror"));
    assert.ok(res.html.includes("<p>เก็บ Master Cell จำนวน 20 ล้านเซลล์</p>"));
  });

  await test("คำตอบเสียหรือเรียก AI พลาด: งานไม่ล้ม HTML เดิม เตือน และนับค่าใช้จ่าย", async () => {
    const bad = await run(chatReturning("not json"));
    assert.equal(bad.html, HTML);
    assert.match(bad.warnings[0], /ตรวจกับ Comment หลังเขียนไม่สำเร็จ/);
    assert.equal(bad.costUsd, 0.003);
    const threw = await run((async () => {
      throw Object.assign(new Error("boom"), { usage: { inputTokens: 1, outputTokens: 1, totalTokens: 3, costUsd: 0.001 } });
    }) as unknown as typeof orChat);
    assert.equal(threw.html, HTML);
    assert.equal(threw.costUsd, 0.001);
  });

  await test("รายการผิดรูปแบบถูกข้าม", () => {
    assert.deepEqual(parseCommentViolations('{"violations":[{"id":"1"},null,{"id":2,"quote":"a","rule":"b","fixed":"c"}]}'), [{ id: 2, quote: "a", rule: "b", fixed: "c" }]);
    assert.deepEqual(parseCommentViolations('```json\n{"violations":[]}\n```'), []);
  });

  console.log(`ce-comment-check: ${passed} passed`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
