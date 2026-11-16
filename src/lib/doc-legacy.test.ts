/**
 * Legacy Word .doc reader — Run: DOC_SAMPLE=/path/to/file.doc npx tsx src/lib/doc-legacy.test.ts
 */
import * as fs from 'fs'
import { cleanDocText, extractDocText, readLegacyDocText } from './doc-legacy'

let passed = 0
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`)
  passed++
  console.log(`  ✓ ${msg}`)
}

function throws(fn: () => unknown): boolean {
  try { fn() } catch { return true }
  return false
}

const u16 = (n: number) => [n & 0xff, (n >>> 8) & 0xff]
const u32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]

interface Piece { text: string; compressed: boolean; at: number }

/** สร้าง stream ของ .doc สังเคราะห์ */
function build(pieces: Piece[], opts: { flags?: number; ccp?: number; prc?: boolean; magic?: number } = {}) {
  const wd = new Uint8Array(0x800)
  const dv = new DataView(wd.buffer)
  dv.setUint16(0, opts.magic ?? 0xa5ec, true)
  dv.setUint16(0x0a, opts.flags ?? 0x0200, true)
  let total = 0
  const cps = [0]
  const pcds: number[] = []
  for (const p of pieces) {
    total += p.text.length
    cps.push(total)
    if (p.compressed) {
      for (let i = 0; i < p.text.length; i++) wd[p.at + i] = p.text.charCodeAt(i) & 0xff
      pcds.push(0, 0, ...u32((p.at * 2) | 0x40000000), 0, 0)
    } else {
      for (let i = 0; i < p.text.length; i++) dv.setUint16(p.at + i * 2, p.text.charCodeAt(i), true)
      pcds.push(0, 0, ...u32(p.at), 0, 0)
    }
  }
  dv.setUint32(0x4c, opts.ccp ?? total, true)
  const plc = [...cps.flatMap((c) => u32(c)), ...pcds]
  const prc = opts.prc ? [0x01, ...u16(4), 9, 9, 9, 9] : []
  const clx = [...prc, 0x02, ...u32(plc.length), ...plc]
  dv.setUint32(0x1a2, 0, true)
  dv.setUint32(0x1a6, clx.length, true)
  return { wd, table: Uint8Array.from(clx) }
}

const THAI = 'ข้อ 4 ห้ามโฆษณา'
const twoPieces: Piece[] = [
  { text: 'Hello\r', compressed: true, at: 0x400 },
  { text: THAI, compressed: false, at: 0x500 },
]

async function main(): Promise<void> {
  console.log('extractDocText')
  {
    const { wd, table } = build(twoPieces)
    assert(extractDocText(wd, null, table) === `Hello\n${THAI}`, 'two pieces (compressed + UTF-16LE Thai) joined with newline')

    const withPrc = build(twoPieces, { prc: true })
    assert(extractDocText(withPrc.wd, null, withPrc.table) === `Hello\n${THAI}`, 'Prc before Pcdt is skipped')

    assert(extractDocText(wd, Uint8Array.from([1, 2, 3]), table) === `Hello\n${THAI}`, 'flag 0x0200 picks table1 (table0 ignored)')
    const f0 = build(twoPieces, { flags: 0 })
    assert(extractDocText(f0.wd, f0.table, null) === `Hello\n${THAI}`, 'without 0x0200 picks table0')
    assert(throws(() => extractDocText(f0.wd, null, f0.table)), 'without 0x0200 and no table0 throws')

    const cut = build(twoPieces, { ccp: 6 + 3 })
    assert(extractDocText(cut.wd, null, cut.table) === `Hello\n${THAI.slice(0, 3)}`, 'ccpText shorter than pieces truncates output')

    const enc = build(twoPieces, { flags: 0x0300 })
    assert(throws(() => extractDocText(enc.wd, null, enc.table)), 'encrypted flag throws')
    const badMagic = build(twoPieces, { magic: 0x1234 })
    assert(throws(() => extractDocText(badMagic.wd, null, badMagic.table)), 'wrong magic throws')
    assert(throws(() => extractDocText(new Uint8Array(0x100), null, table)), 'too-short stream throws')
    assert(throws(() => extractDocText(wd, null, null)), 'missing table throws')
    assert(throws(() => extractDocText(wd, null, new Uint8Array(2))), 'garbage table throws')
  }

  console.log('cleanDocText')
  {
    assert(cleanDocText('a\rb\x0bc\x0cd') === 'a\nb\nc\nd', 'CR, 0x0B, 0x0C -> newline')
    assert(cleanDocText('a\x07b') === 'a | b', '0x07 cell mark -> " | "')
    assert(cleanDocText('x\x13 HYPERLINK "http://x" \x14visible\x15y') === 'xvisibley', 'field keeps only result')
    assert(cleanDocText('\x13 A \x13 B \x14 inner\x15 \x14outer\x15') === 'outer', 'nested fields keep only outer result')
    assert(cleanDocText('a\x01\x02\x08b') === 'ab', 'other control chars removed')
    assert(cleanDocText('a \t \rb  \t\rc') === 'a\nb\nc', 'blanks before a line break removed')
    assert(cleanDocText('a\x07\x07') === 'a |', 'trailing cell marks on the last line kept as a separator')
    assert(cleanDocText('x\x14y\x15z') === 'xyz', 'stray field separator/end marks ignored')
    assert(cleanDocText('\x13 A \x14r1\x13 B \x14r2\x15r3\x15t') === 'r1r2r3t', 'nested field inside a result keeps both results')
    const started = Date.now()
    cleanDocText('a' + ' '.repeat(1_000_000) + 'b')
    cleanDocText('\x13'.repeat(100_000) + 'x'.repeat(500_000))
    assert(Date.now() - started < 5000, 'long blank runs and deep field nesting stay linear')
    assert(cleanDocText('a b') === 'a b', '0xA0 -> space')
  }

  console.log('readLegacyDocText')
  {
    let rejected = false
    try { await readLegacyDocText(new TextEncoder().encode('hello')) } catch (e) { rejected = e instanceof Error }
    assert(rejected, 'non-OLE buffer rejects with an Error')

    const path = process.env.DOC_SAMPLE
    if (path && fs.existsSync(path)) {
      const text = await readLegacyDocText(new Uint8Array(fs.readFileSync(path)))
      assert(text.includes('ประกาศ อย. ข้อ 4 ห้ามโฆษณาว่ารักษาหายขาด'), 'real .doc: Thai sentence read back')
      assert(text.includes('Second line 2567'), 'real .doc: second line read back')
    } else {
      console.log('  - real .doc sample skipped (set DOC_SAMPLE to an existing .doc file)')
    }
  }

  console.log(`\nAll ${passed} assertions passed`)
}

main().catch((e) => { console.error(e); process.exit(1) })
