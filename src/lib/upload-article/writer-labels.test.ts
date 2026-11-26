import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUploadArticleHtml } from "./build-html";
import { DEFAULT_UPLOAD_THEME } from "./types";
import { applyHeadingLabelsHtml, stripHeadingLabelText, HEADING_LABEL_RE } from "./writer-labels";

// ─── title ─────────────────────────────────────────────────────────────────

test("stripHeadingLabelText removes the label and nothing else", () => {
  assert.equal(stripHeadingLabelText("H1: Benefits of exercise"), "Benefits of exercise");
  assert.equal(stripHeadingLabelText("h1 : ประโยชน์ของการออกกำลังกาย"), "ประโยชน์ของการออกกำลังกาย");
  assert.equal(stripHeadingLabelText("[H1] Title"), "Title");
  assert.equal(stripHeadingLabelText("(H2) - Title"), "Title");
  assert.equal(stripHeadingLabelText("H1： ชื่อเรื่อง"), "ชื่อเรื่อง");
  for (const same of ["Benefits of exercise", "H2O: what it is", "H1 tag คืออะไร", "H2 - not a label", "Why H1: matters", "", "H7: nope"]) {
    assert.equal(stripHeadingLabelText(same), same);
  }
  // nothing after the label: keep what was typed rather than an empty title
  assert.equal(stripHeadingLabelText("H1:"), "H1:");
});

// ─── blocks ────────────────────────────────────────────────────────────────

test("a document without labels comes back byte for byte", () => {
  for (const html of [
    "",
    "<h1>Title</h1><p>Body &amp; more</p><h2>Part</h2><p>x<br>y</p>",
    '<h2 id="a">H2O in daily life</h2><p>The H1 tag is the main heading.</p>',
    "<h1>Title</h1><table><tr><td>H1: inside a table</td></tr></table>",
    "<ul><li>H2: inside a list</li></ul>",
  ]) {
    assert.equal(applyHeadingLabelsHtml(html), html);
  }
});

test("labelled headings lose the label and take the level of the label", () => {
  assert.equal(applyHeadingLabelsHtml("<h1><a></a>H1: Title</h1>"), "<h1><a></a>Title</h1>");
  assert.equal(applyHeadingLabelsHtml("<h2><a></a>H2: Part one</h2><p>body</p>"), "<h2><a></a>Part one</h2><p>body</p>");
  // the tag says h3, the writer says H2 — the writer is right
  assert.equal(applyHeadingLabelsHtml("<h3><a></a>H2: Part one</h3>"), "<h2><a></a>Part one</h2>");
  assert.equal(applyHeadingLabelsHtml('<h2 id="x">[H3] Detail</h2>'), '<h3 id="x">Detail</h3>');
  assert.equal(applyHeadingLabelsHtml("<h2>H2&nbsp;:&nbsp;Part</h2>"), "<h2>Part</h2>");
});

test("a whole-line bold wrapper around a labelled heading is dropped with the label", () => {
  assert.equal(applyHeadingLabelsHtml("<h3><a></a><strong>H2: Part one</strong></h3>"), "<h2><a></a>Part one</h2>");
  assert.equal(applyHeadingLabelsHtml("<h2><strong>H2:</strong> Part <em>one</em></h2>"), "<h2>Part <em>one</em></h2>");
});

test("two labelled lines in one heading become two headings", () => {
  assert.equal(
    applyHeadingLabelsHtml("<h3><a></a>H2: Part one<br><br>H3: Detail</h3><p>body</p>"),
    "<h2><a></a>Part one</h2><h3>Detail</h3><p>body</p>",
  );
});

test("body text typed inside a labelled heading becomes a paragraph", () => {
  assert.equal(
    applyHeadingLabelsHtml("<h2><a></a>A long body paragraph that was typed in the heading style.<br><br>H2: Real heading</h2>"),
    "<p><a></a>A long body paragraph that was typed in the heading style.</p><h2>Real heading</h2>",
  );
  assert.equal(applyHeadingLabelsHtml("<h2><a></a><br>H2: Real heading</h2>"), "<h2><a></a>Real heading</h2>");
  // one soft line break right after the label line stays inside that heading
  assert.equal(applyHeadingLabelsHtml("<h2>H2: Line one<br>line two</h2>"), "<h2>Line one<br>line two</h2>");
  // a blank line in between means it is a new paragraph
  assert.equal(applyHeadingLabelsHtml("<h2>H2: Heading<br><br>Body text here.</h2>"), "<h2>Heading</h2><p>Body text here.</p>");
});

test("a heading without a label is never rewritten, even next to labelled ones", () => {
  const long = "<h3><a></a>A long paragraph with no label that the writer left in a heading style.</h3>";
  assert.equal(applyHeadingLabelsHtml(`<h2>H2: Part</h2>${long}`), `<h2>Part</h2>${long}`);
});

test("labelled paragraphs become headings only when the document uses the convention", () => {
  // a real heading carries a label → paragraphs are read too
  assert.equal(
    applyHeadingLabelsHtml("<h1>H1: Title</h1><p>intro</p><p>H2: Part one</p><p>body</p>"),
    "<h1>Title</h1><p>intro</p><h2>Part one</h2><p>body</p>",
  );
  // no headings at all, the writer typed everything as plain lines
  assert.equal(
    applyHeadingLabelsHtml("<p>H1: Title</p><p>intro</p><p><strong>H2: Part one</strong></p><p>body</p>"),
    "<h1>Title</h1><p>intro</p><h2>Part one</h2><p>body</p>",
  );
  // heading and body in one paragraph, split by a line break
  assert.equal(
    applyHeadingLabelsHtml("<h1>H1: Title</h1><p>H2: Part one<br>Body of part one.</p>"),
    "<h1>Title</h1><h2>Part one</h2><p>Body of part one.</p>",
  );
  // an article that only talks about heading tags: real headings, none labelled → untouched
  const about = "<h1>How to use headings</h1><h2>The basics</h2><p>H1: use it once per page.</p><p>H2: use it for sections.</p>";
  assert.equal(applyHeadingLabelsHtml(about), about);
  // a single labelled line in a document without headings is not enough to call it a convention
  const single = "<p>Intro</p><p>H1: use it once per page.</p>";
  assert.equal(applyHeadingLabelsHtml(single), single);
});

test("a labelled paragraph too long to be a heading keeps its text and loses the label", () => {
  const body = "word ".repeat(60).trim();
  assert.equal(applyHeadingLabelsHtml(`<h1>H1: Title</h1><p>H2: ${body}</p>`), `<h1>Title</h1><p>${body}</p>`);
});

test("no words are lost or added", () => {
  const src =
    "<h1><a></a>H1: Title here</h1><p>Intro text.</p>" +
    "<h3><a></a>H2: Part one<br><br>H3: Detail</h3><p>Body.</p>" +
    "<h2><a></a>Paragraph in heading style.<br><br>H2: Part two</h2><p>[Alt : a picture ]</p>";
  const words = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\bH[1-6]:\s*/g, "").replace(/\s+/g, " ").trim();
  assert.equal(words(applyHeadingLabelsHtml(src)), words(src));
});

test("the constant shared with the translator still matches the same labels", () => {
  for (const yes of ["H1: x", " h2 : x", "[H3] x", "(H4) – x", "H5：x", "&nbsp;H2:&nbsp;x"]) assert.ok(HEADING_LABEL_RE.test(yes), yes);
  for (const no of ["H2 - x", "H2O: x", "The H2: x", "H7: x", "Alt: x"]) assert.ok(!HEADING_LABEL_RE.test(no), no);
});

// ─── through Generate ──────────────────────────────────────────────────────

function build(sourceHtml: string, extra: { title?: string; aiSource?: boolean; mode?: "html" | "text" } = {}) {
  return buildUploadArticleHtml({
    sourceHtml,
    mode: extra.mode ?? "html",
    theme: DEFAULT_UPLOAD_THEME,
    site: { name: "Test", url: "https://example.com", language: "en" },
    meta: { title: extra.title ?? "H1: Benefits of exercise" },
    aiSource: extra.aiSource,
  });
}

const DOC =
  "<h1><a></a>H1: Benefits of exercise</h1><p>Intro paragraph.</p>" +
  "<h2><a></a>H2: Sleep better</h2><p>a</p><h3><a></a>H2: Live longer<br><br>H3: The numbers</h3><p>b</p>" +
  "<h2><a></a>H2: Feel happier</h2><p>c</p><h2><a></a>H2: Save money</h2><p>d</p>";

test("Generate: no label in headings, table of contents, schema or plain text", () => {
  for (const mode of ["html", "text"] as const) {
    const out = build(DOC, { mode });
    assert.ok(!/H[1-6]\s*:/.test(out.html.replace(/<style[\s\S]*?<\/style>/g, "")), `label left in ${mode} output`);
    assert.ok(!/H[1-6]\s*:/.test(out.plainText), `label left in ${mode} plain text`);
    assert.equal((out.html.match(/<h1\b/g) || []).length, 1);
    assert.ok(/<h1[^>]*>(<a><\/a>)?Benefits of exercise<\/h1>/.test(out.html));
    assert.equal(out.h2Count, 4);
    assert.ok(/<h3[^>]*>The numbers<\/h3>/.test(out.html));
  }
  const html = build(DOC).html;
  assert.ok(html.includes('"headline":"Benefits of exercise"') || html.includes('"headline": "Benefits of exercise"'), "schema headline is the clean title");
});

test("Generate: a title that carries the label does not put it back when the source has no H1", () => {
  const out = build("<p>Intro.</p><h2>H2: Part</h2><p>x</p>", { title: "H1: Clean me" });
  assert.ok(out.html.includes("Clean me"));
  assert.ok(!/H[1-6]\s*:/.test(out.html.replace(/<style[\s\S]*?<\/style>/g, "")));
});

test("Generate: an article the AI wrote goes through exactly as before", () => {
  const src = "<h1>H1: Title</h1><p>intro</p><h2>H2: Part</h2><p>x</p>";
  const out = build(src, { aiSource: true, title: "H1: Title" });
  assert.ok(out.html.includes("H1: Title"));
  assert.ok(out.html.includes("H2: Part"));
});

test("Generate: a document without labels builds the same HTML as before the label pass", () => {
  const src = "<h1>Title</h1><p>Intro.</p><h2>Part one</h2><p>a</p><h2>Part two</h2><p>b</p><h2>Part three</h2><p>c</p>";
  const viaAiPath = build(src, { aiSource: true, title: "Title" }).html;
  const viaHumanPath = build(src, { title: "Title" }).html;
  assert.equal(viaHumanPath, viaAiPath);
});

test("Generate: [Alt : …] under a picture becomes that picture's alt text and leaves the article", () => {
  const src =
    '<h1>H1: Title</h1><p><img src="a.png"></p><p>[Alt : a runner at sunrise ]</p><p>Intro.</p>' +
    "<h2>H2: Part</h2><p>[Alt : no picture above this line ]</p>";
  const out = build(src, { title: "H1: Title" }).html;
  assert.ok(out.includes('alt="a runner at sunrise"'));
  assert.ok(!out.includes("[Alt : a runner"));
  // no picture to attach it to: the line is the writer's text, it stays
  assert.ok(out.includes("[Alt : no picture above this line ]"));
  // an article the AI wrote is not read for labels
  assert.ok(build(src, { aiSource: true, title: "Title" }).html.includes("[Alt : a runner at sunrise ]"));
});
