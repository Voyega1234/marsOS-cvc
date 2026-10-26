// รัน: npx tsx src/lib/safe-redirect.test.ts
import { safeNextPath } from './safe-redirect'

let passed = 0
let failed = 0
function eq(name: string, got: unknown, want: unknown) {
  if (got === want) { passed++; return }
  failed++
  console.error(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)
}

// path ภายในปกติ
eq('plain path', safeNextPath('/projects'), '/projects')
eq('path + query', safeNextPath('/projects/abc?tab=push'), '/projects/abc?tab=push')
eq('root', safeNextPath('/'), '/')
eq('thai query', safeNextPath('/upload-article?q=%E0%B8%9A'), '/upload-article?q=%E0%B8%9A')
eq('encoded tab stays encoded (same site)', safeNextPath('/%09/evil.com'), '/%09/evil.com')

// พาออกนอกเว็บ
eq('protocol-relative', safeNextPath('//evil.com'), null)
eq('backslash', safeNextPath('/\\evil.com'), null)
eq('decoded tab', safeNextPath('/\t/evil.com'), null)
eq('newline', safeNextPath('/\n/evil.com'), null)
eq('cr', safeNextPath('/\r/evil.com'), null)
eq('space', safeNextPath('/ /evil.com'), null)
eq('dot-segments to //', safeNextPath('/a/../..//evil.com'), null)
eq('absolute url', safeNextPath('https://evil.com'), null)
eq('javascript', safeNextPath('javascript:alert(1)'), null)
eq('no leading slash', safeNextPath('evil.com'), null)
eq('empty', safeNextPath(''), null)
eq('null', safeNextPath(null), null)
eq('undefined', safeNextPath(undefined), null)
eq('too long', safeNextPath('/' + 'a'.repeat(3000)), null)

console.log(`${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
