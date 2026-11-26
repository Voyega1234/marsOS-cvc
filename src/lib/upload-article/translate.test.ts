import { test } from "node:test";
import assert from "node:assert/strict";
import { extractBriefMeta } from "./doc-meta";
import {
  TranslateInputError,
  TranslateOutputError,
  assembleTranslation,
  buildTranslateSystemPrompt,
  buildValidateSystemPrompt,
  checkUnit,
  languageDoubt,
  missingNumbers,
  planTranslation,
  readBatchAnswer,
  readTranslateDirection,
  readTranslateTone,
  restoreUnit,
  runTranslation,
  stripMarkers,
  translatedSlug,
  type TranslateDeps,
  type TranslatePlan,
  type TranslateTone,
} from "./translate";

const EN_HTML =
  '<h2>Benefits of regular exercise</h2>' +
  '<p>Regular exercise helps you <a href="/sleep">sleep better</a> and live longer.<br>Over 1,500 people joined in 2024.</p>';

function enPlan(extra: Record<string, unknown> = {}): TranslatePlan {
  return planTranslation({ title: "Benefits of exercise", sourceHtml: EN_HTML, direction: "en-th", tone: "semi", ...extra });
}

const TH_HTML = "<h2>ประโยชน์ของการออกกำลังกายเป็นประจำ</h2><p>การออกกำลังกายช่วยให้คุณนอนหลับได้ดีขึ้นและมีอายุยืนยาวขึ้นอย่างเห็นได้ชัด</p>";

// ─── readers ───────────────────────────────────────────────────────────────

test("readTranslateDirection / readTranslateTone", () => {
  assert.equal(readTranslateDirection("th-en"), "th-en");
  assert.equal(readTranslateDirection("en-th"), "en-th");
  for (const bad of ["th", "EN-TH", "", null, undefined, 3, {}, ["th-en"]]) assert.equal(readTranslateDirection(bad), null);
  for (const t of ["formal", "semi", "casual"]) assert.equal(readTranslateTone(t), t);
  for (const bad of ["Formal", "polite", "", null, undefined, 1, {}]) assert.equal(readTranslateTone(bad), null);
});

// ─── slug ──────────────────────────────────────────────────────────────────

test("translatedSlug: suffix, collisions, empty", () => {
  assert.equal(translatedSlug("best-exercise", "en"), "best-exercise-en");
  assert.equal(translatedSlug("best-exercise", "th"), "best-exercise-th");
  assert.equal(translatedSlug("best-exercise", "en", (s) => s === "best-exercise-en"), "best-exercise-en-2");
  assert.equal(
    translatedSlug("best-exercise", "en", (s) => s === "best-exercise-en" || s === "best-exercise-en-2"),
    "best-exercise-en-3",
  );
  assert.equal(translatedSlug("", "en"), "");
  assert.equal(translatedSlug(null, "en"), "");
  assert.equal(translatedSlug(undefined, "th"), "");
  assert.ok(translatedSlug("a".repeat(200), "en").length <= 80);
});

// ─── markers ───────────────────────────────────────────────────────────────

test("stripMarkers", () => {
  assert.equal(stripMarkers("Hello <t1>big</t1> world<x1/>!"), "Hello big world !");
  assert.equal(stripMarkers("  a   b  "), "a b");
});

// ─── planTranslation ───────────────────────────────────────────────────────

test("planTranslation: throws for an article without text", () => {
  for (const html of ["", "<p>   </p>", "<p>12345 !!</p>", '<img src="a.png">']) {
    assert.throws(() => planTranslation({ title: "x", sourceHtml: html, direction: "en-th", tone: "semi" }), TranslateInputError);
  }
});

test("planTranslation: throws when already in target language", () => {
  assert.throws(
    () => planTranslation({ title: "ประโยชน์", sourceHtml: TH_HTML, direction: "en-th", tone: "semi" }),
    TranslateInputError,
  );
  assert.throws(() => enPlan({ direction: "th-en" }), TranslateInputError);
});

test("planTranslation: units for title, html and SEO fields", () => {
  const plan = enPlan({ seoTitle: "Exercise benefits", metaDescription: "Why regular exercise matters.", coverAlt: "Runner at dawn" });
  assert.equal(plan.source, "en");
  assert.equal(plan.target, "th");
  assert.equal(plan.tone, "semi");
  assert.ok(plan.fields.title && plan.fields.seoTitle && plan.fields.metaDescription && plan.fields.coverAlt);
  const plain = plan.units.filter((u) => u.kind === "plain").map((u) => u.field);
  assert.deepEqual(plain.sort(), ["coverAlt", "metaDescription", "seoTitle", "title"]);
  assert.equal(plan.units.filter((u) => u.kind === "html").length, 2);
  assert.deepEqual(plan.units.map((u) => u.id), plan.units.map((_u, i) => i + 1));
  assert.ok(plan.template.includes("@@MARSTU_"));
  assert.ok(!plan.template.includes("Benefits of regular exercise"));
  assert.ok(plan.batches.length >= 1);
  assert.equal(plan.batches.flat().length, plan.units.length);
  assert.match(plan.context, /Article title: Benefits of exercise/);
  assert.match(plan.context, /Section headings: Benefits of regular exercise/);
});

test("planTranslation: URL-only fields are skipped; alt text becomes a unit", () => {
  const plan = enPlan({ seoTitle: "https://example.com/page", sourceHtml: EN_HTML + '<img src="a.png" alt="A person running">' });
  assert.equal(plan.fields.seoTitle, undefined);
  assert.ok(plan.units.some((u) => u.field === "alt"));
  assert.ok(plan.template.includes("@@MARSALT_"));
});

test("planTranslation: markers protect inline tags", () => {
  const plan = enPlan();
  const p = plan.units.find((u) => u.text.includes("sleep better"))!;
  assert.match(p.text, /<t1>sleep better<\/t1>/);
  assert.match(p.text, /<x1\/>/);
  assert.equal(p.tags.get(1)?.open, '<a href="/sleep">');
  assert.equal(p.tags.get(1)?.close, "</a>");
  assert.equal(p.atoms.size, 1);
  assert.ok(!p.text.includes("href"));
});

test("planTranslation: rejects internal token in source", () => {
  assert.throws(() => enPlan({ sourceHtml: EN_HTML + "<p>@@MARSTU_1@@</p>" }), TranslateInputError);
});

// ─── restoreUnit ───────────────────────────────────────────────────────────

function pUnit() {
  return enPlan().units.find((u) => u.text.includes("sleep better"))!;
}

test("restoreUnit: round trip and escaping", () => {
  const u = pUnit();
  assert.equal(
    restoreUnit(u, u.text),
    'Regular exercise helps you <a href="/sleep">sleep better</a> and live longer.<br>Over 1,500 people joined in 2024.',
  );
  const th = restoreUnit(u, "การออกกำลังกาย <t1>นอนหลับดีขึ้น</t1> & มากกว่า 1,500 คน<x1/>ใน 2024");
  assert.equal(th, 'การออกกำลังกาย <a href="/sleep">นอนหลับดีขึ้น</a> &amp; มากกว่า 1,500 คน<br>ใน 2024');
});

test("restoreUnit: null on missing, duplicated, unknown or misnested marker", () => {
  const u = pUnit();
  assert.equal(restoreUnit(u, "no markers at all"), null);
  assert.equal(restoreUnit(u, "<t1>a</t1>"), null); // atom missing
  assert.equal(restoreUnit(u, "<t1>a</t1><x1/><x1/>"), null); // atom repeated
  assert.equal(restoreUnit(u, "<t1>a</t1><t1>b</t1><x1/>"), null); // tag repeated
  assert.equal(restoreUnit(u, "<t1>a<x1/>"), null); // unclosed
  assert.equal(restoreUnit(u, "a</t1><x1/>"), null); // close without open
  assert.equal(restoreUnit(u, "<t1>a</t1><t2>b</t2><x1/>"), null); // unknown
});

// ─── readBatchAnswer ───────────────────────────────────────────────────────

test("readBatchAnswer", () => {
  const ok = readBatchAnswer('{"items":[{"id":1,"text":"สวัสดี"},{"id":"2","text":"b","issue":" bad "}]}');
  assert.equal(ok?.get(1)?.text, "สวัสดี");
  assert.equal(ok?.get(2)?.issue, "bad");
  const fenced = readBatchAnswer('```json\n{"items":[{"id":3,"text":"x"}]}\n```');
  assert.equal(fenced?.get(3)?.text, "x");
  const bare = readBatchAnswer('[{"id":4,"text":"y"}]');
  assert.equal(bare?.get(4)?.text, "y");
  const chatty = readBatchAnswer('Here you go: {"items":[{"id":5,"text":"z"}]} done');
  assert.equal(chatty?.get(5)?.text, "z");
  assert.equal(readBatchAnswer("garbage"), null);
  assert.equal(readBatchAnswer(""), null);
  assert.equal(readBatchAnswer("{broken"), null);
  assert.equal(readBatchAnswer('{"foo":1}'), null);
  assert.equal(readBatchAnswer('{"items":[null,{"id":"x"},{"id":6}]}')?.size, 1);
});

// ─── checks ────────────────────────────────────────────────────────────────

test("languageDoubt", () => {
  const en = "This is an English sentence that is long enough to count.";
  assert.equal(languageDoubt(en, en, "th"), true); // left as is
  assert.equal(languageDoubt(en, "นี่คือประโยคภาษาไทยที่แปลมาแล้ว", "th"), false);
  assert.equal(languageDoubt("short", "short", "th"), false); // too little source to judge
  assert.equal(languageDoubt("ประโยคภาษาไทยที่ยาวพอสมควร", "ประโยคภาษาไทยที่ยาวพอสมควร", "en"), true);
  assert.equal(languageDoubt("ภาษาไทย", "This is English", "en"), false);
});

test("missingNumbers", () => {
  assert.deepEqual(missingNumbers("Over 1,500 people in 2024", "มากกว่า 1500 คน ในปี 2024"), []);
  assert.deepEqual(missingNumbers("Over 1,500 people in 2024", "มากกว่า 1,600 คน ในปี 2024"), ["1500"]);
  assert.deepEqual(missingNumbers("Only 12 people", "มี 99 คน"), []); // under 3 digits ignored
  assert.deepEqual(missingNumbers("ปี ๒๐๒๔", "year 2024"), []); // Thai digits
  assert.deepEqual(missingNumbers("100 and 100", "100"), ["100"]); // counted by multiplicity
});

test("checkUnit", () => {
  const u = pUnit();
  assert.deepEqual(checkUnit(u, undefined, "th"), { value: null, problem: "missing" });
  assert.deepEqual(checkUnit(u, "   ", "th"), { value: null, problem: "missing" });
  assert.deepEqual(checkUnit(u, "<t1>ขาด</t1>", "th"), { value: null, problem: "structure" });
  const good = checkUnit(u, "นอน <t1>หลับดี</t1><x1/>มากกว่า 1,500 คน", "th");
  assert.equal(good.problem, null);
  assert.ok(good.value?.includes('<a href="/sleep">'));
  // left in English: usable value but language doubt
  const doubt = checkUnit(u, u.text, "th");
  assert.equal(doubt.problem, "language");
  assert.ok(doubt.value);
  // plain unit
  const title = enPlan().units.find((x) => x.field === "title")!;
  assert.deepEqual(checkUnit(title, "ประโยชน์ของการออกกำลังกาย", "th"), { value: "ประโยชน์ของการออกกำลังกาย", problem: null });
});

// ─── prompts ───────────────────────────────────────────────────────────────

test("prompts: tones differ and direction names the target language", () => {
  const tones: TranslateTone[] = ["formal", "semi", "casual"];
  for (const build of [buildTranslateSystemPrompt, buildValidateSystemPrompt]) {
    for (const [source, target] of [["en", "th"], ["th", "en"]] as const) {
      const prompts = tones.map((tone) => build({ source, target, tone, bannedTerms: [] }));
      assert.equal(new Set(prompts).size, 3);
      const [from, to] = source === "en" ? ["English", "Thai"] : ["Thai", "English"];
      for (const p of prompts) assert.ok(p.includes(`${from} to ${to}`) || p.includes(`${from} → ${to}`), p.slice(0, 160));
    }
  }
  const banned = buildTranslateSystemPrompt({ source: "en", target: "th", tone: "formal", bannedTerms: [{ term: "cheap", replacement: "affordable" } as never] });
  assert.match(banned, /"cheap" → write "affordable"/);
});

// ─── runTranslation ────────────────────────────────────────────────────────

interface Script {
  translate?: (id: number, text: string) => string | undefined;
  validate?: (id: number, source: string, translation: string) => { issue?: string; text: string } | undefined;
  failValidate?: boolean;
}

function fakeDeps(script: Script): TranslateDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    translateSystem: "T",
    validateSystem: "V",
    concurrency: 1,
    async call(_system, user, purpose) {
      calls.push(purpose);
      const items = JSON.parse(user.slice(user.indexOf("\n[") + 1)) as Array<Record<string, string | number>>;
      if (purpose === "translate") {
        const out: Array<{ id: number; text: string }> = [];
        for (const it of items) {
          const t = (script.translate ?? defaultTranslate)(it.id as number, it.text as string);
          if (t !== undefined) out.push({ id: it.id as number, text: t });
        }
        return JSON.stringify({ items: out });
      }
      if (script.failValidate) throw new Error("boom");
      const out: Array<Record<string, unknown>> = [];
      for (const it of items) {
        const v = script.validate?.(it.id as number, it.source as string, it.translation as string);
        if (v) out.push({ id: it.id, ...v });
      }
      return JSON.stringify({ items: out });
    },
  };
}

/** a "translation" that is Thai and keeps markers and numbers */
function defaultTranslate(_id: number, text: string): string {
  return "คำแปล " + text.replace(/<\/?[tx]\d+\s*\/?>|[A-Za-z]+/g, (m) => (m.charAt(0) === "<" ? m : "")).replace(/\s+/g, " ").trim() + " ภาษาไทย";
}

function idOf(plan: TranslatePlan, fragment: string): number {
  return plan.units.find((u) => u.text.includes(fragment))!.id;
}

test("runTranslation: happy path", async () => {
  const plan = enPlan();
  const outcome = await runTranslation(plan, fakeDeps({}));
  assert.equal(outcome.values.size, plan.units.length);
  assert.deepEqual(outcome.kept, []);
  assert.deepEqual(outcome.corrected, []);
  assert.deepEqual(outcome.flagged, []);
  assert.equal(outcome.checked, plan.units.length);
  assert.equal(outcome.unverified, 0);
});

test("runTranslation: a unit the model leaves out ends up in kept", async () => {
  const html = Array.from({ length: 10 }, (_v, i) => `<p>Paragraph number ${i} about regular exercise habits.</p>`).join("");
  const plan = planTranslation({ title: "", sourceHtml: html, direction: "en-th", tone: "semi" });
  const dropId = plan.units[3].id;
  const outcome = await runTranslation(plan, fakeDeps({ translate: (id, t) => (id === dropId ? undefined : defaultTranslate(id, t)) }));
  assert.deepEqual(outcome.kept, [dropId]);
  assert.equal(outcome.values.has(dropId), false);
  // original text is kept in the page
  const result = assembleTranslation(plan, outcome, []);
  assert.ok(result.html.includes(plan.units[3].raw));
  assert.ok(result.warnings.some((w) => w.includes("ยังเป็นภาษาอังกฤษ")));
});

test("runTranslation: too many omitted units is a TranslateOutputError", async () => {
  // more than max(3, 15% of units) kept
  const html = Array.from({ length: 10 }, (_v, i) => `<p>Paragraph number ${i} about regular exercise habits.</p>`).join("");
  const plan = planTranslation({ title: "", sourceHtml: html, direction: "en-th", tone: "semi" });
  await assert.rejects(runTranslation(plan, fakeDeps({ translate: () => undefined })), TranslateOutputError);
});

test("runTranslation: checking pass corrects one unit and flags one it cannot", async () => {
  const html = '<p>Alpha exercise paragraph for testing.</p><p>Bravo exercise paragraph for testing.</p><p>Charlie exercise paragraph for testing.</p>';
  const plan = planTranslation({ title: "", sourceHtml: html, direction: "en-th", tone: "semi" });
  const [a, b] = [idOf(plan, "Alpha"), idOf(plan, "Bravo")];
  const outcome = await runTranslation(
    plan,
    fakeDeps({
      validate: (id) => {
        if (id === a) return { issue: "คำผิด", text: "ย่อหน้าที่แก้ไขแล้ว" };
        if (id === b) return { issue: "ความหมายเพี้ยน", text: "still English and broken so cannot be used at all, sorry about it" };
        return undefined;
      },
    }),
  );
  assert.deepEqual(outcome.corrected, [{ id: a, issue: "คำผิด" }]);
  assert.deepEqual(outcome.flagged, [{ id: b, issue: "ความหมายเพี้ยน" }]);
  assert.equal(outcome.values.get(a), "ย่อหน้าที่แก้ไขแล้ว");
  assert.notEqual(outcome.values.get(b), "still English and broken so cannot be used at all, sorry about it");
});

test("runTranslation: changed number is reported; failed checking pass is unverified", async () => {
  const html = "<p>More than 1,500 people joined the exercise class last year.</p>";
  const plan = planTranslation({ title: "", sourceHtml: html, direction: "en-th", tone: "semi" });
  const outcome = await runTranslation(plan, fakeDeps({ translate: () => "มีผู้เข้าร่วมมากกว่า 1,600 คนในปีที่แล้ว", failValidate: true }));
  assert.deepEqual(outcome.numbers, [{ id: plan.units[0].id, issue: "1500" }]);
  assert.equal(outcome.unverified, 1);
  assert.equal(outcome.checked, 0);
});

test("runTranslation: unreadable answers twice throw TranslateOutputError", async () => {
  const plan = enPlan();
  const deps: TranslateDeps = { translateSystem: "T", validateSystem: "V", call: async () => "garbage" };
  await assert.rejects(runTranslation(plan, deps), TranslateOutputError);
});

// ─── assembleTranslation ───────────────────────────────────────────────────

test("assembleTranslation: html, fields and validation counts", async () => {
  const plan = enPlan({ seoTitle: "Exercise benefits", metaDescription: "Why exercise matters." });
  const outcome = await runTranslation(plan, fakeDeps({}));
  const r = assembleTranslation(plan, outcome, []);
  assert.deepEqual(r.validation, { checked: outcome.checked, corrected: 0, flagged: 0, unverified: 0 });
  assert.ok(r.title.includes("คำแปล"));
  assert.ok(r.seoTitle.includes("คำแปล"));
  assert.ok(!r.html.includes("@@MARS"));
  assert.ok(r.html.includes('<a href="/sleep">') && r.html.includes("<br>"));
  assert.deepEqual(r.warnings, []);
});

test("assembleTranslation: warnings mention kept and flagged units", () => {
  const plan = enPlan();
  const kept = idOf(plan, "Benefits of regular");
  const flagged = idOf(plan, "sleep better");
  const r = assembleTranslation(
    plan,
    {
      values: new Map(),
      kept: [kept],
      doubts: [],
      corrected: [{ id: 99, issue: "x" }],
      flagged: [{ id: flagged, issue: "ความหมายเพี้ยน" }],
      numbers: [],
      checked: 3,
      unverified: 2,
    },
    [],
  );
  assert.deepEqual(r.validation, { checked: 3, corrected: 1, flagged: 1, unverified: 2 });
  assert.ok(r.warnings.some((w) => w.includes("1 ท่อนยังเป็นภาษาอังกฤษ") && w.includes("Benefits of regular")));
  assert.ok(r.warnings.some((w) => w.includes("ความหมายเพี้ยน") && w.includes("Regular exercise helps")));
  assert.ok(r.warnings.some((w) => w.includes("ตรวจคำแปลไม่ครบ")));
  // untranslated units fall back to the original text
  assert.ok(r.html.includes("Benefits of regular exercise"));
  assert.equal(r.title, "Benefits of exercise");
});

// ─── writer's labels and the brief table ───────────────────────────────────

/** every opening / closing tag in order — a translation must not move, add or drop any */
function tagSequence(html: string): string[] {
  return (html.match(/<\/?[a-z][a-z0-9]*/gi) || []).map((t) => t.toLowerCase());
}

const LABELLED_HTML =
  '<h1><a></a>H1: What is API Development? A Complete Guide</h1>' +
  "<h2>H2: How an API Works</h2>" +
  "<h3><a></a><strong>H2: Understanding API Development and Why It Matters</strong></h3>" +
  "<h3><a></a>H2: How an API Works in practice<br><br>H3: The Request and Response Cycle, Explained Simply</h3>" +
  "<h2><a></a><br>H2: Best Practices for Product Teams</h2>" +
  "<p>[Alt :The API Development Process ]</p>" +
  "<p>(Alt: A developer testing an endpoint)</p>" +
  "<p>H2O is the formula of water and alternatives: none are known.</p>" +
  "<p>Teams build interfaces every day and ship them to customers.</p>";

const LABEL_START_RE = /^(?:<\/?[tx]\d+\s*\/?>|\s)*[\[(]?\s*(?:H[1-6]\s*[:：\])]|alt(?:\s*text)?\s*[:：])/i;

test("labels: 'H1:' / 'H2:' / 'Alt:' never reach the model", () => {
  const plan = planTranslation({ title: "H1: What is API Development? A Complete Guide", sourceHtml: LABELLED_HTML, direction: "en-th", tone: "semi" });
  for (const u of plan.units) assert.ok(!LABEL_START_RE.test(u.text), `unit starts with a label: ${u.text}`);
  // ordinary text that only looks like a label is left alone
  assert.ok(plan.units.some((u) => u.text.startsWith("H2O is the formula")));
  // two headings typed into one block are two units
  assert.ok(plan.units.some((u) => u.text === "How an API Works in practice"));
  assert.ok(plan.units.some((u) => u.text === "The Request and Response Cycle, Explained Simply"));
  const title = plan.units[plan.fields.title!];
  assert.equal(title.text, "What is API Development? A Complete Guide");
});

test("labels: the translated article keeps every label and the original's tags", async () => {
  const plan = planTranslation({ title: "H1: What is API Development? A Complete Guide", sourceHtml: LABELLED_HTML, direction: "en-th", tone: "semi" });
  const r = assembleTranslation(plan, await runTranslation(plan, fakeDeps({})), []);
  assert.deepEqual(tagSequence(r.html), tagSequence(LABELLED_HTML));
  assert.ok(r.html.includes("<h1><a></a>H1: คำแปล"));
  assert.ok(r.html.includes("<h2>H2: คำแปล"));
  assert.ok(r.html.includes("<h3><a></a><strong>H2: คำแปล"));
  assert.match(r.html, /<h3><a><\/a>H2: คำแปล[^<]*<br><br>H3: คำแปล[^<]*<\/h3>/);
  assert.ok(r.html.includes("<h2><a></a><br>H2: คำแปล"));
  assert.match(r.html, /<p>\[Alt :คำแปล[^<\]]* \]<\/p>/);
  assert.match(r.html, /<p>\(Alt: คำแปล[^<)]*\)<\/p>/);
  assert.ok(!/[A-Za-z]{4,}/.test(r.html.replace(/<[^>]+>/g, " ").replace(/\b(?:Alt|H2O)\b/g, "")), "no source sentence left behind");
  assert.ok(r.title.startsWith("H1: คำแปล"));
  assert.deepEqual(r.warnings, []);
});

test("labels: a title without a label is translated whole", async () => {
  const plan = enPlan();
  const r = assembleTranslation(plan, await runTranslation(plan, fakeDeps({})), []);
  assert.ok(r.title.startsWith("คำแปล"));
});

const HELPER_NOTE = '<p>(ใช้ <a href="https://mrs.digital/tools/meta-length-checker/">https://mrs.digital/tools/meta-length-checker/</a> ในการนับคำ)</p>';
const BRIEF_TABLE =
  "<table><thead>" +
  "<tr><th></th><th><p>Keyword</p></th><th><p>Search Volume</p></th></tr>" +
  "<tr><th><p>Main</p></th><th><p>API development</p></th><th><p>30</p></th></tr>" +
  "<tr><th><p>Secondary</p></th><th><p>API developer, REST API development</p></th></tr>" +
  "<tr><th><p>Title Count:</p><p>(Max 70)</p></th><th><p><strong>What is API Development? A Complete Guide</strong> </p></th></tr>" +
  `<tr><th><p>Description Count :</p><p>(Max 160)</p></th><th>${HELPER_NOTE}<p>Learn how API development works and why it matters for modern software teams.</p></th></tr>` +
  "<tr><th><p>Slug</p></th><th><p>api-development-guide</p></th></tr>" +
  "<tr><th><p>Interlink require</p></th><th><p>5 Links (Internal link option)</p></th></tr>" +
  "<tr><th><p>Note:</p></th><th><p>Long tail keyword add require<br>Alt text for the image</p><p>Reference link</p></th></tr>" +
  "</thead></table>";
const BRIEF_BODY = "<h2>H2: Overview of the work</h2><p>Teams build interfaces every day and ship them to customers.</p>";

function briefPlan(extra: Record<string, unknown> = {}): TranslatePlan {
  return planTranslation({
    title: "H1: What is API Development?",
    sourceHtml: BRIEF_TABLE + BRIEF_BODY,
    direction: "en-th",
    tone: "semi",
    briefSlug: "api-development-guide-th",
    ...extra,
  });
}

test("brief table: only the title and description values are translated", () => {
  const plan = briefPlan();
  const meta = plan.units.filter((u) => u.metaField);
  assert.deepEqual(meta.map((u) => u.metaField).sort(), ["metaDescription", "seoTitle"]);
  assert.ok(meta.find((u) => u.metaField === "seoTitle")!.text.includes("What is API Development? A Complete Guide"));
  assert.ok(meta.find((u) => u.metaField === "metaDescription")!.text.startsWith("Learn how API development works"));
  assert.ok(meta.find((u) => u.metaField === "seoTitle")!.note!.includes("70"));
  assert.ok(meta.find((u) => u.metaField === "metaDescription")!.note!.includes("160"));
  for (const fixed of ["Keyword", "Search Volume", "Secondary", "REST API", "Max 70", "Max 160", "meta-length-checker", "Interlink", "5 Links", "Long tail", "Reference link", "api-development-guide"]) {
    assert.ok(!plan.units.some((u) => u.text.includes(fixed)), `"${fixed}" must stay out of the units`);
  }
});

test("brief table: comes back as written, with the new slug, and feeds the meta fields", async () => {
  const plan = briefPlan({ seoTitle: "Stored title that is stale", metaDescription: "(ใช้ https://mrs.digital/tools/meta-length-checker/ ในการนับคำ) Learn how" });
  // the table supplies both values, so the stored (possibly polluted) ones are not translated at all
  assert.equal(plan.fields.seoTitle, undefined);
  assert.equal(plan.fields.metaDescription, undefined);
  const r = assembleTranslation(plan, await runTranslation(plan, fakeDeps({})), []);
  assert.deepEqual(tagSequence(r.html), tagSequence(BRIEF_TABLE + BRIEF_BODY));
  for (const kept of [
    "<p>Keyword</p>", "<p>Search Volume</p>", "<p>Main</p>", "<p>API development</p>", "<p>30</p>",
    "<p>API developer, REST API development</p>", "<p>Title Count:</p><p>(Max 70)</p>", "<p>Description Count :</p><p>(Max 160)</p>",
    HELPER_NOTE, "<p>api-development-guide-th</p>", "<p>5 Links (Internal link option)</p>",
    "<p>Long tail keyword add require<br>Alt text for the image</p><p>Reference link</p>",
  ]) assert.ok(r.html.includes(kept), `kept as written: ${kept}`);
  assert.ok(!r.html.includes("What is API Development? A Complete Guide"));
  assert.ok(!r.html.includes("Learn how API development works"));
  assert.ok(r.seoTitle.includes("คำแปล") && !r.seoTitle.includes("Stored"));
  assert.ok(r.metaDescription.includes("คำแปล") && !r.metaDescription.includes("mrs.digital"));
  // what Generate reads back from the translated source is what the row stores
  const back = extractBriefMeta(r.html);
  assert.equal(back.seoTitle, r.seoTitle);
  assert.equal(back.metaDescription, r.metaDescription);
  assert.equal(back.slug, "api-development-guide-th");
  assert.ok(r.html.includes("<h2>H2: คำแปล"));
});

test("brief table: without a table the stored SEO fields are still translated", () => {
  const plan = planTranslation({ title: "Overview", sourceHtml: BRIEF_BODY, seoTitle: "Exercise benefits", metaDescription: "Why exercise matters.", direction: "en-th", tone: "semi" });
  assert.notEqual(plan.fields.seoTitle, undefined);
  assert.notEqual(plan.fields.metaDescription, undefined);
});

test("brief table: an ordinary table with one labelled row is translated like before", () => {
  const html = "<table><tr><td>Slug</td><td>monthly-plan</td></tr><tr><td>Package name</td><td>Monthly price for small teams</td></tr></table>" + BRIEF_BODY;
  const plan = planTranslation({ title: "Overview", sourceHtml: html, direction: "en-th", tone: "semi" });
  assert.ok(plan.units.some((u) => u.text === "Monthly price for small teams"));
  assert.ok(!plan.units.some((u) => u.metaField));
});
