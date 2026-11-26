/**
 * Brief ของผู้เขียนในต้นฉบับ: แบบตาราง (เดิม) + แบบรายการ "SEO Metadata" (เพิ่ม 2026-11-25)
 * Run: npx tsx src/lib/upload-article/doc-meta.test.ts
 */
import { parse } from 'node-html-parser';
import { briefHelperNotes, briefValueText, extractBriefMeta, isBriefHelperNote, parseBriefLine } from './doc-meta';
import { buildUploadArticleHtml } from './build-html';
import { DEFAULT_UPLOAD_THEME } from './types';

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  passed++;
  console.log(`  ✓ ${msg}`);
}

function build(sourceHtml: string, language: 'th' | 'en' = 'en') {
  return buildUploadArticleHtml({
    sourceHtml,
    mode: 'html',
    theme: DEFAULT_UPLOAD_THEME,
    site: { name: 'Site', url: 'https://example.com', language },
    meta: { title: 'What is Business Process Automation?' },
  }).html;
}

const LIST_BRIEF =
  '<p><strong>SEO Metadata</strong></p>' +
  '<ul><li><strong>Primary Keyword:</strong> What is Business Process Automation</li>' +
  '<li><strong>SEO Title (55 characters):</strong> What Is Business Process Automation? Strategy &amp; Guide</li>' +
  '<li><strong>Meta Description (146 characters):</strong> Discover what business process automation (BPA) is, how it transforms enterprise operations, key implementation steps, and how to maximize ROI.</li>' +
  '<li><strong>H1:</strong> What Is Business Process Automation? Core Mechanics, Enterprise Value, and Strategic Implementation</li></ul>';

const BODY =
  '<h1><strong>What is Business Process Automation? A comprehensive guide</strong></h1>' +
  '<p>Business process automation uses software to run repeatable work.</p>' +
  '<h2>Defining BPA</h2><p>Text one.</p><h2>Benefits</h2><p>Text two.</p><h2>Use cases</h2><p>Text three.</p>';

console.log('\nparseBriefLine');
assert(parseBriefLine('SEO Title (55 characters): Hello')?.field === 'seoTitle', 'SEO Title (N characters) = seoTitle');
assert(parseBriefLine('Meta Description (146 characters): Hi')?.field === 'metaDescription', 'Meta Description (N characters) = metaDescription');
assert(parseBriefLine('Primary Keyword: bpa')?.field === 'mainKeyword', 'Primary Keyword = mainKeyword');
assert(parseBriefLine('H1: Title')?.field === 'h1', 'H1 recognised');
assert(parseBriefLine('Step 1: open the app') === null, 'ordinary "x: y" bullet is not a brief line');
assert(parseBriefLine('SEO Title:') === null, 'label without value is ignored');

console.log('\nextractBriefMeta — list format');
const meta = extractBriefMeta(LIST_BRIEF + BODY);
assert(meta.seoTitle === 'What Is Business Process Automation? Strategy & Guide', 'seoTitle from list (entity decoded)');
assert(meta.metaDescription?.startsWith('Discover what business process automation (BPA) is') === true, 'metaDescription from list');
assert(meta.metaDescription?.endsWith('maximize ROI.') === true, 'metaDescription kept whole (146 chars < 160)');
assert(meta.mainKeyword === 'What is Business Process Automation', 'mainKeyword from Primary Keyword');

console.log('\nextractBriefMeta — table wins over list');
const table =
  '<table><tr><td>Title Count : (Max 70)</td><td>Table Title</td></tr><tr><td>Description</td><td>Table Desc</td></tr></table>';
const both = extractBriefMeta(table + LIST_BRIEF + BODY);
assert(both.seoTitle === 'Table Title' && both.metaDescription === 'Table Desc', 'table values kept, list only fills empty fields');
assert(both.mainKeyword === 'What is Business Process Automation', 'list fills the field the table lacks');
assert(extractBriefMeta('<table><tr><td>SEO Title</td><td>T</td></tr></table>').seoTitle === 'T', 'table row "SEO Title" also read');

console.log('\nextractBriefMeta — no false positives');
const article = '<h2>Steps</h2><ul><li>Step 1: map the process</li><li>Step 2: pick a tool</li></ul>';
assert(Object.keys(extractBriefMeta(article)).length === 0, 'ordinary "Step: text" list gives nothing');
const mixed = '<ul><li>Title: one</li><li>Something else entirely</li></ul>';
assert(Object.keys(extractBriefMeta(mixed)).length === 0, 'list with a non-brief item is not a brief');

console.log('\nbuild-html strips the list brief');
const html = build(LIST_BRIEF + BODY);
assert(!html.includes('SEO Metadata'), 'heading "SEO Metadata" removed');
assert(!html.includes('Primary Keyword') && !html.includes('Meta Description (146'), 'brief list removed');
assert(!html.includes('Core Mechanics, Enterprise Value'), 'brief H1 line removed');
assert(html.includes('A comprehensive guide'), 'real H1 kept');
assert(html.includes('Business process automation uses software'), 'body kept');
const plain = build(article.replace('<h2>', '<h1>T</h1><p>intro</p><h2>'));
assert(plain.includes('Step 1: map the process'), 'ordinary list kept in body');

console.log('\nbrief without the "SEO Metadata" heading (list only)');
const bare = LIST_BRIEF.replace('<p><strong>SEO Metadata</strong></p>', '');
assert(!build(bare + BODY).includes('Primary Keyword'), 'bare brief list also removed');
assert(extractBriefMeta(bare + BODY).seoTitle === 'What Is Business Process Automation? Strategy & Guide', 'bare brief list also read');

console.log('\nbrief as paragraphs under the heading');
const paras =
  '<p><strong>SEO Metadata</strong></p><p><strong>SEO Title:</strong> Para Title</p><p><strong>Meta Description:</strong> Para Desc</p>';
assert(extractBriefMeta(paras + BODY).seoTitle === 'Para Title', 'paragraph brief read');
const pHtml = build(paras + BODY);
assert(!pHtml.includes('Para Title') && !pHtml.includes('SEO Metadata'), 'paragraph brief removed');

console.log('\nTOC label follows site.language');
assert(build(BODY, 'en').includes('>Contents</p>'), 'en article = "Contents"');
assert(build(BODY, 'th').includes('>สารบัญ</p>'), 'th article = "สารบัญ"');

console.log('\nbrief table — helper note in a value cell');
const NOTE = '<p>(ใช้ <a href="https://mrs.digital/tools/meta-length-checker/">https://mrs.digital/tools/meta-length-checker/</a> ในการนับคำ)</p>';
const NOTED_TABLE =
  '<table><tr><td><p>Main</p></td><td><p>API development</p></td></tr>' +
  '<tr><td><p>Title Count:</p><p>(Max 70)</p></td><td><p><strong>What is API Development? A Complete Guide</strong> </p></td></tr>' +
  `<tr><td><p>Description Count :</p><p>(Max 160)</p></td><td>${NOTE}<p>Learn how API development works and why it matters.</p></td></tr>` +
  '<tr><td><p>Slug</p></td><td><p>api-development-guide</p></td></tr></table>';
const noted = extractBriefMeta(NOTED_TABLE + BODY);
assert(noted.seoTitle === 'What is API Development? A Complete Guide', 'title read');
assert(noted.metaDescription === 'Learn how API development works and why it matters.', 'description = the real sentence, not the helper note');
assert(noted.slug === 'api-development-guide', 'slug read');
assert(isBriefHelperNote('(Max 160)') && isBriefHelperNote('[note for the writer]'), 'whole-line brackets = helper note');
assert(!isBriefHelperNote('Learn (quickly) how it works') && !isBriefHelperNote('()'), 'a sentence with brackets inside is not a note');
const cellOf = (inner: string) => parse(`<table><tr><td>${inner}</td></tr></table>`).querySelector('td')!;
assert(briefHelperNotes(cellOf(`${NOTE}<p>Real value</p>`)).length === 1, 'note beside a real value is skipped');
assert(briefHelperNotes(cellOf('<p>(only a bracketed value)</p>')).length === 0, 'a cell that is only a bracketed line keeps it');
assert(briefHelperNotes(cellOf('<p>(one)</p><p>(two)</p>')).length === 0, 'all-bracketed cell keeps everything');
assert(briefValueText(cellOf('<p>(only a bracketed value)</p>')) === '(only a bracketed value)', 'bracketed-only value read as written');
assert(
  briefValueText(cellOf('(use https://example.com/counter to count) Real description here')) === 'Real description here',
  'link note typed on the same line as the value is dropped',
);
assert(briefValueText(cellOf('(Optional) Real description here') ) === '(Optional) Real description here', 'leading brackets without a link stay');

console.log(`\n${passed} passed`);
