import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  BRIEF_JUDGE_INPUTS,
  BRIEF_JUDGE_SYSTEM_PROMPT,
  BRIEF_MATCH_DEFAULT_PROMPT,
  BRIEF_MATCH_ID,
  BRIEF_SYSTEM_HANDLED,
  briefViolationWarnings,
  buildBriefRevisePrompt,
  packHasBriefMatchEntry,
  parseBriefVerdict,
  readBriefMatchConfig,
  verifyBriefViolations,
  writeBriefMatchVariables,
  type BriefLayers,
} from "./ce-brief-match";
import { buildBriefCheckUserMessage, checkAgainstBrief } from "./ce-brief-check";
import { DEFAULT_VALIDATORS } from "../components/settings/content-engine/constants";

const layers: BriefLayers = {
  masterPrompt: "เขียนด้วยน้ำเสียงเป็นกันเอง ใช้สรรพนามว่า “เรา” ตลอดทั้งบทความ\nห้ามใช้คำว่า ดีที่สุด ในทุกกรณี",
  articleBrief: "บทความต้องมีตารางเปรียบเทียบราคาอย่างน้อย 1 ตาราง\nปิดท้ายด้วยหัวข้อ สรุป เสมอ",
  restrictions: "ห้ามกล่าวถึงคู่แข่งชื่อ AcmeClinic ในบทความ\nComment ลูกค้า: ไม่ต้องพูดถึงโปรโมชั่นผ่อน 0%",
  task: "Keyword หลัก: ฟิลเลอร์ใต้ตา\nโครงสร้าง: H2 ฟิลเลอร์ใต้ตาคืออะไร แล้วตามด้วย H2 ราคาฟิลเลอร์ใต้ตา",
};
const html = "<h2>ฟิลเลอร์ใต้ตาคืออะไร</h2><p>คลินิกของเราดีที่สุดในย่านนี้ และมีโปรโมชั่นผ่อน 0% นาน 10 เดือน</p>";

// ── config ──────────────────────────────────────────────────────────────────

test("config: no pack text, free text and a pack saved before the validator existed all run with the default", () => {
  for (const raw of [null, undefined, "", "ตรวจข้อเท็จจริงให้ครบ", JSON.stringify({ validators: [{ id: "business", enabled: true }] }), "[]", "42"]) {
    assert.deepEqual(readBriefMatchConfig(raw), { enabled: true, criteria: BRIEF_MATCH_DEFAULT_PROMPT });
  }
});

test("config: only an explicit enabled:false turns it off", () => {
  const off = JSON.stringify({ validators: [{ id: BRIEF_MATCH_ID, enabled: false, prompt: "x" }] });
  assert.equal(readBriefMatchConfig(off).enabled, false);
  const on = JSON.stringify({ validators: [{ id: BRIEF_MATCH_ID, prompt: "  " }] });
  assert.deepEqual(readBriefMatchConfig(on), { enabled: true, criteria: BRIEF_MATCH_DEFAULT_PROMPT });
});

test("config: the team's edited instruction is used", () => {
  const raw = JSON.stringify({ validators: [{ id: BRIEF_MATCH_ID, enabled: true, prompt: " ตรวจเฉพาะโครงสร้าง " }] });
  assert.deepEqual(readBriefMatchConfig(raw), { enabled: true, criteria: "ตรวจเฉพาะโครงสร้าง" });
});

// ── free-text pack: the switch lives beside the text ─────────────────────────

const FREE_TEXT = "VALIDATOR — ตรวจก่อนส่งทุกครั้ง\nชั้น 1 CRITICAL FAIL";

test("free-text pack: the stored setting switches it off and carries the team's criteria", () => {
  assert.deepEqual(readBriefMatchConfig(FREE_TEXT, JSON.stringify({ briefMatch: { enabled: false } })), {
    enabled: false,
    criteria: BRIEF_MATCH_DEFAULT_PROMPT,
  });
  assert.deepEqual(readBriefMatchConfig(FREE_TEXT, JSON.stringify({ briefMatch: { enabled: true, criteria: " ตรวจเฉพาะโครงสร้าง " } })), {
    enabled: true,
    criteria: "ตรวจเฉพาะโครงสร้าง",
  });
});

test("free-text pack: the column's default and anything unreadable keep it on", () => {
  for (const variables of [undefined, null, "", "[]", "{}", "not json", "42", '["a"]', '{"briefMatch":[]}', '{"briefMatch":"off"}', '{"briefMatch":{"enabled":"false"}}', '{"briefMatch":{"enabled":0}}']) {
    assert.deepEqual(readBriefMatchConfig(FREE_TEXT, variables), { enabled: true, criteria: BRIEF_MATCH_DEFAULT_PROMPT }, String(variables));
  }
});

test("form pack: its own entry wins over a setting left beside it; a form pack without the entry falls back to it", () => {
  const formOn = JSON.stringify({ validators: [{ id: BRIEF_MATCH_ID, enabled: true, prompt: "เกณฑ์ในฟอร์ม" }] });
  const storedOff = JSON.stringify({ briefMatch: { enabled: false, criteria: "เกณฑ์ข้างนอก" } });
  assert.deepEqual(readBriefMatchConfig(formOn, storedOff), { enabled: true, criteria: "เกณฑ์ในฟอร์ม" });
  assert.equal(packHasBriefMatchEntry(formOn), true);
  const oldForm = JSON.stringify({ validators: [{ id: "business", enabled: true }] });
  assert.equal(packHasBriefMatchEntry(oldForm), false);
  assert.deepEqual(readBriefMatchConfig(oldForm, storedOff), { enabled: false, criteria: "เกณฑ์ข้างนอก" });
  for (const raw of [null, "", FREE_TEXT, "[]", "42"]) assert.equal(packHasBriefMatchEntry(raw), false);
});

test("write: round-trips, keeps other keys, stores the criteria only when it is not the default", () => {
  const off = writeBriefMatchVariables("[]", { enabled: false, criteria: BRIEF_MATCH_DEFAULT_PROMPT });
  assert.equal(off, '{"briefMatch":{"enabled":false}}');
  assert.equal(readBriefMatchConfig(FREE_TEXT, off).enabled, false);

  const edited = writeBriefMatchVariables('{"other":1,"briefMatch":{"enabled":false}}', { enabled: true, criteria: " ตรวจเฉพาะโครงสร้าง " });
  assert.deepEqual(JSON.parse(edited), { other: 1, briefMatch: { enabled: true, criteria: "ตรวจเฉพาะโครงสร้าง" } });
  assert.deepEqual(readBriefMatchConfig(FREE_TEXT, edited), { enabled: true, criteria: "ตรวจเฉพาะโครงสร้าง" });

  // an emptied criteria box means "use the default", and an unreadable old value is replaced
  for (const existing of [null, undefined, "", "not json", "42"]) {
    assert.equal(writeBriefMatchVariables(existing, { enabled: true, criteria: "  " }), '{"briefMatch":{"enabled":true}}');
  }
});

// ── what the settings page shows must be what the judge receives ─────────────

test("judge instruction: the text shown in settings is the text sent, and it did not change by accident", async () => {
  // Pinned on purpose: editing the instruction changes how every article is judged. Update the hash only with that intent.
  assert.equal(createHash("sha256").update(BRIEF_JUDGE_SYSTEM_PROMPT, "utf8").digest("hex"), "fb98660c9da8e35d17fd95165658fe8a5b9789705506dfaa2ca516ab9c116db7");
  let system = "";
  await checkAgainstBrief({
    criteria: "c",
    layers,
    html,
    trace: "t",
    chat: (async (request: { messages: { role: string; content: string }[] }) => {
      system = request.messages.find((m) => m.role === "system")?.content ?? "";
      return { text: '{"violations":[]}', usage: { costUsd: 0, totalTokens: 0 } };
    }) as never,
  });
  assert.equal(system, BRIEF_JUDGE_SYSTEM_PROMPT);
});

test("judge inputs: the list shown in settings matches the message, heading for heading and in order", () => {
  const message = buildBriefCheckUserMessage({ criteria: "c", layers, html, systemHandled: [...BRIEF_SYSTEM_HANDLED] });
  const headings = message.split("\n").filter((line) => line.startsWith("# ")).map((line) => line.slice(2));
  assert.deepEqual(headings, BRIEF_JUDGE_INPUTS.map((input) => input.heading));
  for (const line of BRIEF_SYSTEM_HANDLED) assert.ok(message.includes(`- ${line}`));
});

test("defaults: the Validator Pack ships with Brief Match switched on, last in order", () => {
  const entry = DEFAULT_VALIDATORS.find((v) => v.id === BRIEF_MATCH_ID);
  assert.ok(entry);
  assert.equal(entry.enabled, true);
  assert.equal(entry.blocking, true);
  assert.equal(entry.prompt, BRIEF_MATCH_DEFAULT_PROMPT);
  assert.equal(entry.executionOrder, Math.max(...DEFAULT_VALIDATORS.map((v) => v.executionOrder)));
  assert.equal(new Set(DEFAULT_VALIDATORS.map((v) => v.executionOrder)).size, DEFAULT_VALIDATORS.length);
  // a pack saved from the UI stores the entry, and the reader picks it up
  assert.equal(readBriefMatchConfig(JSON.stringify({ validators: DEFAULT_VALIDATORS })).enabled, true);
});

// ── verdict parsing ─────────────────────────────────────────────────────────

test("parse: code fences, missing fields and junk entries", () => {
  const raw = '```json\n{"violations":[{"rule":" ห้ามใช้คำว่า  ดีที่สุด ","quote":"ดีที่สุด"},{"quote":"no rule"},null,{"rule":"x","problem":5}]}\n```';
  assert.deepEqual(parseBriefVerdict(raw), [
    { rule: "ห้ามใช้คำว่า ดีที่สุด", quote: "ดีที่สุด", problem: "", fix: "" },
    { rule: "x", quote: "", problem: "", fix: "" },
  ]);
  assert.deepEqual(parseBriefVerdict('{"violations":"none"}'), []);
  assert.throws(() => parseBriefVerdict("not json"));
});

// ── verification against the real texts ─────────────────────────────────────

test("verify: a real rule with a real quote is kept and labelled by the layer it came from", () => {
  const out = verifyBriefViolations({
    layers,
    html,
    violations: [
      { rule: "ห้ามใช้คำว่า ดีที่สุด ในทุกกรณี", quote: "คลินิกของเราดีที่สุดในย่านนี้", problem: "ใช้คำต้องห้าม", fix: "ตัดคำออก" },
      { rule: "Comment ลูกค้า: ไม่ต้องพูดถึงโปรโมชั่นผ่อน 0%", quote: "โปรโมชั่นผ่อน 0% นาน 10 เดือน", problem: "", fix: "" },
      { rule: "บทความต้องมีตารางเปรียบเทียบราคาอย่างน้อย 1 ตาราง", quote: "", problem: "ไม่มีตาราง", fix: "เพิ่มตาราง" },
      { rule: "ตามด้วย H2 ราคาฟิลเลอร์ใต้ตา", quote: "", problem: "ขาดหัวข้อ", fix: "" },
    ],
  });
  assert.deepEqual(out.map((v) => v.source), ["master", "restriction", "brief", "template"]);
});

test("verify: an invented rule or an invented quote never reaches the writer", () => {
  const out = verifyBriefViolations({
    layers,
    html,
    violations: [
      { rule: "บทความต้องยาวอย่างน้อย 3,000 คำ", quote: "", problem: "สั้นไป", fix: "" },
      { rule: "ห้ามใช้คำว่า ดีที่สุด ในทุกกรณี", quote: "เราเป็นอันดับหนึ่งของประเทศ", problem: "", fix: "" },
      { rule: "ห้าม", quote: "", problem: "กฎสั้นเกินจะพิสูจน์", fix: "" },
      { rule: "ห้ามใช้คำว่า ดีที่สุด ในทุกกรณี", quote: "ดี", problem: "quote สั้นเกิน", fix: "" },
    ],
  });
  assert.deepEqual(out, []);
});

test("verify: tolerant of quote marks, spacing and an ellipsis in the quoted rule; dedupes; caps at 10", () => {
  const out = verifyBriefViolations({
    layers,
    html,
    violations: [
      { rule: 'เขียนด้วยน้ำเสียงเป็นกันเอง ... ใช้สรรพนามว่า "เรา" ตลอดทั้งบทความ', quote: "", problem: "a", fix: "" },
      { rule: "เขียนด้วยน้ำเสียงเป็นกันเอง…ใช้สรรพนามว่า เรา ตลอดทั้งบทความ", quote: "", problem: "b", fix: "" },
    ],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].source, "master");

  const many = Array.from({ length: 14 }, (_, i) => ({
    rule: "ปิดท้ายด้วยหัวข้อ สรุป เสมอ",
    quote: ["ฟิลเลอร์", "ใต้ตาคือ", "คลินิก", "ของเรา", "ดีที่สุด", "ในย่านนี้", "โปรโมชั่น", "ผ่อน 0%", "นาน 10", "10 เดือน", "และมี", "คืออะไร", "ย่านนี้ และ", "มีโปรโมชั่น"][i],
    problem: "",
    fix: "",
  }));
  assert.equal(verifyBriefViolations({ layers, html, violations: many }).length, 10);
});

test("verify: text inside tags, comments, script and style is not article text", () => {
  const out = verifyBriefViolations({
    layers,
    html: '<style>.x{content:"ดีที่สุดแน่นอน"}</style><!-- ดีที่สุดแน่นอน --><p class="ดีที่สุดแน่นอน">เนื้อหาปกติ</p>',
    violations: [{ rule: "ห้ามใช้คำว่า ดีที่สุด ในทุกกรณี", quote: "ดีที่สุดแน่นอน", problem: "", fix: "" }],
  });
  assert.deepEqual(out, []);
});

// ── texts for the team and for the writer ───────────────────────────────────

test("warnings: one line per violation, capped, with the remainder counted", () => {
  const violations = verifyBriefViolations({
    layers,
    html,
    violations: [
      { rule: "ห้ามใช้คำว่า ดีที่สุด ในทุกกรณี", quote: "ดีที่สุด", problem: "ใช้คำต้องห้าม", fix: "" },
      { rule: "ปิดท้ายด้วยหัวข้อ สรุป เสมอ", quote: "", problem: "", fix: "" },
      { rule: "บทความต้องมีตารางเปรียบเทียบราคาอย่างน้อย 1 ตาราง", quote: "", problem: "ไม่มีตาราง", fix: "" },
    ],
  });
  const lines = briefViolationWarnings(violations, 2);
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^ยังไม่ตรง Master Prompt: "ห้ามใช้คำว่า ดีที่สุด ในทุกกรณี" — ใช้คำต้องห้าม$/);
  assert.match(lines[1], /^ยังไม่ตรง Article Brief: .* — ขาดส่วนที่กำหนด$/);
  assert.equal(lines[2], "ยังไม่ตรง Brief อีก 1 จุด กรุณาตรวจเอง");
  assert.deepEqual(briefViolationWarnings([]), []);
});

test("revise prompt: lists every violation and asks for a full rewrite in the same format", () => {
  const violations = verifyBriefViolations({
    layers,
    html,
    violations: [{ rule: "ห้ามใช้คำว่า ดีที่สุด ในทุกกรณี", quote: "ดีที่สุดในย่านนี้", problem: "ใช้คำต้องห้าม", fix: "ตัดคำออก" }],
  });
  const prompt = buildBriefRevisePrompt(violations);
  assert.match(prompt, /1\. \[Master Prompt\] คำสั่ง: "ห้ามใช้คำว่า ดีที่สุด ในทุกกรณี"/);
  assert.match(prompt, /ในบทความ: "ดีที่สุดในย่านนี้"/);
  assert.match(prompt, /ต้องแก้: ตัดคำออก/);
  assert.match(prompt, /เขียนบทความใหม่ทั้งบทความ/);
  assert.match(prompt, /รูปแบบผลลัพธ์เดิม/);
});

// ── the AI call (injected, no network) ──────────────────────────────────────

const usage = { inputTokens: 900, outputTokens: 100, totalTokens: 1000, costUsd: 0.002 };
type Chat = NonNullable<Parameters<typeof checkAgainstBrief>[0]["chat"]>;
const fakeChat = (text: string, seen?: { args?: Parameters<Chat>[0] }): Chat =>
  (async (args: Parameters<Chat>[0]) => {
    if (seen) seen.args = args;
    return { text, usage, citations: [] };
  }) as unknown as Chat;

test("check: pass, fail and the request the judge receives", async () => {
  const seen: { args?: Parameters<Chat>[0] } = {};
  const pass = await checkAgainstBrief({ criteria: "เกณฑ์ของทีม", layers, html, trace: "t", chat: fakeChat('{"violations":[]}', seen) });
  assert.deepEqual(pass, { status: "pass", violations: [], costUsd: 0.002, tokens: 1000 });
  assert.equal(seen.args?.jsonMode, true);
  assert.equal(seen.args?.temperature, 0);
  assert.equal(seen.args?.trace, "t");
  const userMessage = String(seen.args?.messages?.[1]?.content ?? "");
  for (const part of ["เกณฑ์ของทีม", "# Master Prompt", "# Article Brief", "# ข้อจำกัด และ Comment ลูกค้า", "# โจทย์และโครงสร้างของบทความนี้", "สารบัญ (Table of Contents)", html]) {
    assert.ok(userMessage.includes(part), part);
  }

  const fail = await checkAgainstBrief({
    criteria: "c",
    layers,
    html,
    trace: "t",
    chat: fakeChat(JSON.stringify({ violations: [
      { rule: "ห้ามใช้คำว่า ดีที่สุด ในทุกกรณี", quote: "ดีที่สุดในย่านนี้", problem: "p", fix: "f" },
      { rule: "กฎที่ผู้ตรวจแต่งขึ้นเองทั้งหมด", quote: "", problem: "p", fix: "f" },
    ] })),
  });
  assert.equal(fail.status, "fail");
  assert.equal(fail.violations.length, 1);
  assert.equal(fail.violations[0].source, "master");
});

test("check: a judge that only invents rules does not fail the article", async () => {
  const res = await checkAgainstBrief({
    criteria: "c", layers, html, trace: "t",
    chat: fakeChat('{"violations":[{"rule":"บทความต้องมีวิดีโอประกอบทุกหัวข้อ","quote":"","problem":"p","fix":"f"}]}'),
  });
  assert.equal(res.status, "pass");
});

test("check: a broken reply or a failed call is an error, never a throw, and keeps the cost", async () => {
  const broken = await checkAgainstBrief({ criteria: "c", layers, html, trace: "t", chat: fakeChat("ขออภัย ตรวจไม่ได้") });
  assert.deepEqual(broken, { status: "error", violations: [], costUsd: 0.002, tokens: 1000 });

  const failing = (async () => {
    throw Object.assign(new Error("timeout"), { usage });
  }) as unknown as Chat;
  const failed = await checkAgainstBrief({ criteria: "c", layers, html, trace: "t", chat: failing });
  assert.deepEqual(failed, { status: "error", violations: [], costUsd: 0.002, tokens: 1000 });
});

test("user message: extra system-handled items and an empty restrictions layer", () => {
  const message = buildBriefCheckUserMessage({ criteria: "c", layers: { ...layers, restrictions: " " }, html, systemHandled: ["ส่วน FAQ ที่ขาด"] });
  assert.ok(message.includes("# ข้อจำกัด และ Comment ลูกค้า\n(ไม่มี)"));
  assert.ok(message.includes("- ส่วน FAQ ที่ขาด"));
});
