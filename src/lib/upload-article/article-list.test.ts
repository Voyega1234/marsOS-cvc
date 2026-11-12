/**
 * Regression: หน้า list ของ Upload Article / PBN โหลดเฉพาะคอลัมน์ที่ใช้ แต่ผลที่ส่งออกต้องเท่ากับของเดิมทุกตัวอักษร
 * (ของเดิม = findMany เต็มแถว แล้วผ่าน toUploadArticleDTO(row, false))
 * Run: npx tsx src/lib/upload-article/article-list.test.ts
 */
import { loadUploadArticleListRows, type UploadArticleListDb } from './article-list';
import { toUploadArticleDTO, type UploadArticleRow } from './serialize';

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  passed++;
  console.log(`  ✓ ${msg}`);
}

type FullRow = UploadArticleRow & { organizationId: string };
type Where = Record<string, unknown>;

// ── ฐานข้อมูลจำลอง: ตีความ where แบบ SQL (ค่า NULL เทียบแล้วได้ "ไม่รู้" และแถวนั้นไม่ถูกเลือก) ──
type Tri = true | false | null;
const and3 = (xs: Tri[]): Tri => (xs.includes(false) ? false : xs.includes(null) ? null : true);
const or3 = (xs: Tri[]): Tri => (xs.includes(true) ? true : xs.includes(null) ? null : false);
const not3 = (x: Tri): Tri => (x === null ? null : !x);

function evalField(value: unknown, cond: unknown): Tri {
  if (cond === null) return value === null;
  if (typeof cond !== 'object') return value === null ? null : value === cond;
  const c = cond as Record<string, unknown>;
  const parts: Tri[] = [];
  for (const [op, arg] of Object.entries(c)) {
    if (op === 'not') parts.push(value === null ? null : value !== arg);
    else if (op === 'startsWith') parts.push(value === null ? null : String(value).startsWith(String(arg)));
    else if (op === 'in') parts.push(value === null ? null : (arg as unknown[]).includes(value));
    else throw new Error(`fake db: unsupported operator "${op}"`);
  }
  return and3(parts);
}

function evalWhere(row: FullRow, where: Where): Tri {
  const parts: Tri[] = [];
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'AND') parts.push(and3((cond as Where[]).map((w) => evalWhere(row, w))));
    else if (key === 'OR') parts.push(or3((cond as Where[]).map((w) => evalWhere(row, w))));
    else if (key === 'NOT') parts.push(not3(evalWhere(row, cond as Where)));
    else parts.push(evalField((row as unknown as Record<string, unknown>)[key], cond));
  }
  return and3(parts);
}

interface FakeDb {
  db: UploadArticleListDb;
  calls: Array<{ select: string[]; rows: Record<string, unknown>[] }>;
}

/** `beforeCall[n]` รันก่อน query ลำดับที่ n (เริ่มที่ 1) — ใช้จำลองแถวถูกแก้/ลบระหว่าง query */
function fakeDb(table: FullRow[], beforeCall: Record<number, () => void> = {}): FakeDb {
  const calls: FakeDb['calls'] = [];
  const findMany = async (args: { where: Where; orderBy?: { updatedAt: 'desc' }; select: Record<string, true> }) => {
    beforeCall[calls.length + 1]?.();
    let rows = table.filter((r) => evalWhere(r, args.where) === true);
    if (args.orderBy) rows = [...rows].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    const cols = Object.keys(args.select);
    const picked = rows.map((r) => Object.fromEntries(cols.map((c) => [c, (r as unknown as Record<string, unknown>)[c]])));
    calls.push({ select: cols, rows: picked });
    return picked;
  };
  return { db: { uploadArticle: { findMany } } as unknown as UploadArticleListDb, calls };
}

/** ของเดิม: เต็มแถว + where + orderBy เดิม */
function oldPath(table: FullRow[], where: Where) {
  return table
    .filter((r) => evalWhere(r, where) === true)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .map((r) => toUploadArticleDTO(r, false));
}

const DATA_COVER = `data:image/webp;base64,${'A'.repeat(4000)}`;
const BIG_SOURCE = `<p>${'ต้นฉบับยาวมาก '.repeat(400)}</p>`;

let seq = 0;
function row(id: string, over: Partial<FullRow> = {}): FullRow {
  seq++;
  return {
    id,
    organizationId: 'org1',
    clientId: 'c1',
    title: `บทความ ${id}`,
    sourceType: 'upload',
    sourceName: `${id}.docx`,
    sourceHtml: `<p>source ${id} one two three</p>`,
    outputMode: 'html',
    htmlContent: `<h2>หัวข้อ ${id}</h2><p>generated body four five six seven</p>`,
    seoTitle: `SEO ${id}`,
    metaDescription: `meta ${id}`,
    slug: `slug-${id}`,
    coverImageUrl: null,
    coverAlt: '',
    status: 'GENERATED',
    pushMode: null,
    wordpressUrl: null,
    wordpressPostId: null,
    pushError: null,
    pushedAt: null,
    createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, seq)),
    updatedAt: new Date(Date.UTC(2026, 10, 1, 0, 0, seq)),
    ...over,
  };
}

const SCOPE = { clientId: 'c1', organizationId: 'org1', sourceType: { not: 'ai-rewrite' } };

function buildTable(): FullRow[] {
  seq = 0;
  return [
    row('filled'),
    row('filled-big-source', { sourceHtml: BIG_SOURCE }),
    row('html-null', { htmlContent: null, status: 'IMPORTED', sourceHtml: '<p>alpha beta gamma delta</p>' }),
    row('html-empty', { htmlContent: '', status: 'IMPORTED', sourceHtml: '<p>ไทยล้วนไม่มีเว้นวรรค</p>' }),
    row('both-empty', { htmlContent: null, sourceHtml: '', status: 'IMPORTED' }),
    row('cover-null'),
    row('cover-empty', { coverImageUrl: '' }),
    row('cover-data', { coverImageUrl: DATA_COVER }),
    row('cover-url', { coverImageUrl: 'https://cdn.example.com/a.webp', coverAlt: 'ปก' }),
    row('cover-data-html-null', { coverImageUrl: DATA_COVER, htmlContent: null, status: 'IMPORTED' }),
    row('pushed', { status: 'REVIEWED', wordpressPostId: '9', wordpressUrl: 'https://x.com/a', pushMode: 'publish', pushedAt: new Date(Date.UTC(2026, 10, 5)) }),
    row('push-error', { status: 'FAILED', pushError: 'HTTP 500' }),
    row('text-mode', { outputMode: 'text' }),
    row('shadow', { sourceType: 'ai-rewrite' }),
    row('other-client', { clientId: 'c2' }),
    row('other-org', { organizationId: 'org2' }),
  ];
}

async function main(): Promise<void> {
  // 1) ผลเท่าของเดิม — ไม่กรองสถานะ
  {
    const table = buildTable();
    const { db, calls } = fakeDb(table);
    const got = (await loadUploadArticleListRows(db, SCOPE)).map((r) => toUploadArticleDTO(r, false));
    const want = oldPath(table, SCOPE);
    assert(want.length === 13, 'fixture: 13 rows in scope (shadow / other client / other org left out)');
    assert(JSON.stringify(got) === JSON.stringify(want), 'list output equals the old full-row output (all fields, same order)');
    assert(calls.length === 3, 'no race = exactly 3 queries');

    const returned = JSON.stringify(calls.map((c) => c.rows));
    assert(!returned.includes(DATA_COVER), 'data-URI covers are never read from the database');
    assert(!returned.includes(BIG_SOURCE), 'sourceHtml of a row that has htmlContent is never read');
    assert(!calls[0].select.includes('sourceHtml') && !calls[0].select.includes('coverImageUrl'), 'main query selects neither sourceHtml nor coverImageUrl');
    const outsideScope = ['shadow', 'other-client', 'other-org'];
    assert(calls.every((c) => c.rows.every((r) => !outsideScope.includes(String(r.id)))), 'side queries stay inside the same client / organization / non-shadow scope');
  }

  // 2) กรองสถานะ (ค่าเดียวกับ ?status= ของ API)
  for (const status of ['IMPORTED', 'GENERATED', 'REVIEWED', 'NOPE']) {
    const table = buildTable();
    const where = { ...SCOPE, status };
    const got = (await loadUploadArticleListRows(fakeDb(table).db, where)).map((r) => toUploadArticleDTO(r, false));
    assert(JSON.stringify(got) === JSON.stringify(oldPath(table, where)), `status filter "${status}": equals the old output`);
  }

  // 3) จำนวนคำ: ยังมาจาก htmlContent ก่อน ถ้าว่างค่อยใช้ sourceHtml
  {
    const table = buildTable();
    const got = (await loadUploadArticleListRows(fakeDb(table).db, SCOPE)).map((r) => toUploadArticleDTO(r, false));
    const wc = (id: string) => got.find((d) => d.id === id)?.wordCount;
    assert(wc('html-null') === 4, 'word count: htmlContent null uses sourceHtml');
    assert(wc('html-empty') === oldPath(table, SCOPE).find((d) => d.id === 'html-empty')?.wordCount && (wc('html-empty') ?? 0) > 0, 'word count: htmlContent "" uses sourceHtml (Thai text)');
    assert(wc('both-empty') === 0, 'word count: both empty = 0');
    assert(wc('filled-big-source') === wc('filled'), 'word count: a filled row ignores its sourceHtml');
  }

  // 4) ปก
  {
    const table = buildTable();
    const got = (await loadUploadArticleListRows(fakeDb(table).db, SCOPE)).map((r) => toUploadArticleDTO(r, false));
    const cover = (id: string) => got.find((d) => d.id === id)?.coverImageUrl;
    assert(cover('cover-null') === null, 'cover: null stays null');
    assert(cover('cover-empty') === '', 'cover: empty string stays empty string');
    assert(cover('cover-data') === null, 'cover: data URI is sent as null (same as before)');
    assert(cover('cover-url') === 'https://cdn.example.com/a.webp', 'cover: normal URL is kept');
  }

  // 5) ลูกค้าไม่มีบทความ
  {
    const got = await loadUploadArticleListRows(fakeDb(buildTable()).db, { ...SCOPE, clientId: 'nobody' });
    assert(got.length === 0, 'client without articles = empty list');
  }

  // 6) แถวถูกเขียน htmlContent ระหว่าง query: อ่านซ้ำ แล้วนับคำจากเนื้อหาที่เพิ่งเขียน
  {
    const table = buildTable();
    const target = table.find((r) => r.id === 'html-null')!;
    const { db, calls } = fakeDb(table, { 2: () => { target.htmlContent = '<p>one two three four five six</p>'; } });
    const got = (await loadUploadArticleListRows(db, SCOPE)).map((r) => toUploadArticleDTO(r, false));
    assert(calls.length === 4, 'race: one extra query for the row the side query missed');
    assert(got.length === 13, 'race: the row is still listed');
    assert(got.find((d) => d.id === 'html-null')?.wordCount === 6, 'race: word count comes from the freshly written htmlContent');
  }

  // 7) แถวถูกลบระหว่าง query: ตัดออกจาก list ไม่ส่งแถวครึ่ง ๆ กลาง ๆ
  {
    const table = buildTable();
    const { db } = fakeDb(table, { 2: () => { table.splice(table.findIndex((r) => r.id === 'html-null'), 1); } });
    const got = await loadUploadArticleListRows(db, SCOPE);
    assert(got.length === 12 && !got.some((r) => r.id === 'html-null'), 'race: a row deleted in between is dropped');
  }

  // 8) ลำดับ: updatedAt ใหม่ไปเก่า
  {
    const table = buildTable();
    const got = await loadUploadArticleListRows(fakeDb(table).db, SCOPE);
    assert(got.every((r, i) => i === 0 || got[i - 1].updatedAt.getTime() >= r.updatedAt.getTime()), 'order: newest updatedAt first');
  }

  console.log(`\n${passed} passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
