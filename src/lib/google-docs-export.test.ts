/**
 * ปุ่ม Google Docs — ข้อความ error จาก Google Drive / Google Sign-In และข้อความแจ้งผล
 * Run: npx tsx src/lib/google-docs-export.test.ts
 */
import { driveErrorMessage, tokenErrorMessage, googleDocsResultNotice, isDriveExportConfigured, NEW_DOC_URL } from './google-docs-export'

let passed = 0
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`)
  passed++
  console.log(`  ✓ ${msg}`)
}

// driveErrorMessage
assert(driveErrorMessage(401, null).includes('หมดอายุ'), '401 = token expired')
assert(
  driveErrorMessage(403, { error: { message: 'x', errors: [{ reason: 'accessNotConfigured' }] } }).includes('Google Drive API'),
  '403 accessNotConfigured = Drive API not enabled',
)
assert(
  driveErrorMessage(403, { error: { details: [{ reason: 'SERVICE_DISABLED' }] } }).includes('Google Drive API'),
  '403 SERVICE_DISABLED in details = Drive API not enabled',
)
assert(driveErrorMessage(403, { error: { errors: [{ reason: 'storageQuotaExceeded' }] } }).includes('เต็ม'), 'quota exceeded')
assert(driveErrorMessage(403, { error: { errors: [{ reason: 'insufficientPermissions' }] } }).includes('ติ๊กอนุญาต'), 'scope not granted')
assert(driveErrorMessage(429, null).includes('ถี่'), '429 = rate limit')
assert(driveErrorMessage(413, null).includes('ใหญ่'), '413 = too large')
assert(driveErrorMessage(500, { error: { message: 'Backend Error' } }) === 'Google Drive ตอบกลับ 500: Backend Error', 'unknown error keeps status + message')
assert(driveErrorMessage(502, 'not json') === 'Google Drive ตอบกลับ 502', 'non-object body does not crash')

// tokenErrorMessage
assert(tokenErrorMessage('popup_failed_to_open').includes('popup'), 'popup blocked')
assert(tokenErrorMessage('popup_closed').includes('ปิดหน้าต่าง'), 'popup closed')
assert(tokenErrorMessage('access_denied').includes('ไม่ได้อนุญาต'), 'consent denied')
assert(tokenErrorMessage('scope_not_granted').includes('ติ๊กช่อง Drive'), 'Drive box not ticked')
assert(tokenErrorMessage('timeout').includes('นานเกินไป'), 'consent window timed out')
assert(tokenErrorMessage(undefined) === 'ขอสิทธิ์ Google ไม่สำเร็จ', 'unknown type without suffix')
assert(tokenErrorMessage('weird') === 'ขอสิทธิ์ Google ไม่สำเร็จ (weird)', 'unknown type keeps code')

// googleDocsResultNotice
{
  const n = googleDocsResultNotice({ mode: 'clipboard', url: NEW_DOC_URL, opened: true })
  assert(!n.action && n.message.includes('⌘V'), 'clipboard + tab opened: paste hint, no action')
}
{
  const n = googleDocsResultNotice({ mode: 'clipboard', url: NEW_DOC_URL, opened: false })
  assert(n.action?.url === NEW_DOC_URL, 'clipboard + tab blocked: action opens docs.new')
}
{
  const url = 'https://docs.google.com/document/d/abc/edit'
  assert(!googleDocsResultNotice({ mode: 'drive', url, opened: true }).action, 'drive + tab opened: no action')
  assert(googleDocsResultNotice({ mode: 'drive', url, opened: false }).action?.url === url, 'drive + tab blocked: action opens the doc')
}

// ไม่ตั้ง env = โหมดคัดลอก
assert(isDriveExportConfigured() === Boolean((process.env.NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID || '').trim()), 'configured follows env')

console.log(`\n${passed} passed`)
