/**
 * โลโก้ลูกค้า — validator ฝั่ง PATCH
 * Run: npx tsx src/lib/upload-article/client-logo.test.ts
 */
import { CLIENT_LOGO_MAX_CHARS, readClientLogo, validateClientLogoInput } from './client-logo'

let passed = 0
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`)
  passed++
}

const ok = 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA'
assert(validateClientLogoInput(ok).ok === true, 'webp ผ่าน')
assert(validateClientLogoInput('data:image/png;base64,AAAA').ok === true, 'png ผ่าน')
assert(validateClientLogoInput('data:image/jpeg;base64,AAAA==').ok === true, 'jpeg ผ่าน')
const nul = validateClientLogoInput(null)
assert(nul.ok === true && nul.value === null, 'null = ล้าง')
assert(validateClientLogoInput('data:image/svg+xml;base64,AAAA').ok === false, 'svg ไม่ผ่าน')
assert(validateClientLogoInput('data:image/gif;base64,AAAA').ok === false, 'gif ไม่ผ่าน')
assert(validateClientLogoInput('data:image/png;base64,AA"onerror="x').ok === false, 'อักขระแปลกไม่ผ่าน')
assert(validateClientLogoInput('data:image/png;base64,').ok === false, 'ว่างไม่ผ่าน')
assert(validateClientLogoInput('https://x.com/a.png').ok === false, 'URL ไม่ผ่าน')
assert(validateClientLogoInput('javascript:alert(1)').ok === false, 'js ไม่ผ่าน')
assert(validateClientLogoInput(123).ok === false, 'ตัวเลขไม่ผ่าน')
assert(validateClientLogoInput(undefined).ok === false, 'undefined ไม่ผ่าน')
assert(validateClientLogoInput({}).ok === false, 'object ไม่ผ่าน')
const big = 'data:image/png;base64,' + 'A'.repeat(CLIENT_LOGO_MAX_CHARS)
assert(validateClientLogoInput(big).ok === false, 'ใหญ่เกิน 40KB ไม่ผ่าน')
assert(validateClientLogoInput('data:image/png;base64,AAAA\n<script>').ok === false, 'ขึ้นบรรทัดใหม่ไม่ผ่าน')
assert(readClientLogo(ok) === ok, 'read ค่าถูก')
assert(readClientLogo('data:image/svg+xml;base64,AAAA') === null, 'read svg = null')
assert(readClientLogo(undefined) === null, 'read undefined = null')

console.log(`client-logo: ${passed} passed`)
