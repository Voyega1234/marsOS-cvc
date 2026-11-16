// เทสตัวช่วยของบัญชีลูกค้า (login ด้วยรหัสผ่าน): npx tsx src/lib/client-login.test.ts
import {
  CLIENT_PASSWORD_MAX_BYTES,
  CLIENT_PASSWORD_MIN_LENGTH,
  PASSWORD_LOGIN_CLOCK_SKEW_S,
  PASSWORD_LOGIN_MAX_AGE_S,
  classifyPasswordSignInError,
  clientLoginEmail,
  clientLoginUsername,
  clientPasswordProblem,
  isFreshPasswordLogin,
  isValidClientUsername,
  passwordSessionDeniedMessage,
  passwordSignInMessage,
} from './client-login'

let passed = 0
function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`FAIL: ${msg}\n  actual:   ${a}\n  expected: ${e}`)
  passed++
}

// ชื่อผู้ใช้ที่ลูกค้าพิมพ์ต้องได้อีเมลเดียวกับที่หน้า Users สร้าง
eq(clientLoginEmail('mfactor'), 'mfactor@mars.local', 'ชื่อผู้ใช้ธรรมดา')
eq(clientLoginEmail('  MFactor '), 'mfactor@mars.local', 'ตัวพิมพ์ใหญ่ + ช่องว่างหัวท้าย')
eq(clientLoginEmail('m factor'), 'mfactor@mars.local', 'ช่องว่างกลางชื่อถูกตัด')
eq(clientLoginEmail('mfactor@mars.local'), 'mfactor@mars.local', 'พิมพ์อีเมลเต็มมาใช้ตามนั้น')
eq(clientLoginEmail(''), '', 'ว่าง')

eq(isValidClientUsername('mfactor'), true, 'ตัวอักษรล้วน')
eq(isValidClientUsername('m.factor_2-a'), true, 'จุด ขีดล่าง ขีดกลาง ตัวเลข')
eq(isValidClientUsername('MFactor'), false, 'ตัวพิมพ์ใหญ่ไม่ผ่าน')
eq(isValidClientUsername('m factor'), false, 'ช่องว่างไม่ผ่าน')
eq(isValidClientUsername('ลูกค้า'), false, 'ภาษาไทยไม่ผ่าน')
eq(isValidClientUsername('a@b'), false, '@ ไม่ผ่าน')
eq(isValidClientUsername(''), false, 'ว่างไม่ผ่าน')
eq(isValidClientUsername('a'.repeat(65)), false, 'ยาวเกิน 64')

eq(clientLoginUsername('mfactor@mars.local'), 'mfactor', 'ตัดโดเมนออก')
eq(clientLoginUsername(' MFactor@Mars.Local '), 'mfactor', 'ไม่สนตัวพิมพ์')
eq(clientLoginUsername('someone@convertcake.com'), null, 'อีเมลจริงไม่ใช่บัญชีรหัสผ่าน')
eq(clientLoginUsername('@mars.local'), null, 'ไม่มีชื่อผู้ใช้')
eq(clientLoginUsername('ลูกค้า@mars.local'), null, 'ชื่อผู้ใช้ผิดกติกา')
eq(clientLoginUsername('a@b@mars.local'), null, 'มี @ ซ้อน')

// แยกสาเหตุจาก error ของ Supabase Auth
eq(classifyPasswordSignInError({ code: 'invalid_credentials', status: 400 }), 'credentials', 'รหัสผิด')
eq(classifyPasswordSignInError({ code: 'email_provider_disabled', status: 400 }), 'password_login_disabled', 'ปิดทางรหัสผ่าน')
eq(classifyPasswordSignInError({ code: 'captcha_failed', status: 400 }), 'captcha', 'CAPTCHA')
eq(classifyPasswordSignInError({ code: 'over_request_rate_limit', status: 429 }), 'rate_limited', 'ถี่เกิน')
eq(classifyPasswordSignInError({ status: 429 }), 'rate_limited', '429 ไม่มี code')
eq(classifyPasswordSignInError({ code: 'email_not_confirmed', status: 400 }), 'not_confirmed', 'ยังไม่ยืนยันอีเมล')
eq(classifyPasswordSignInError({ code: 'user_banned', status: 400 }), 'banned', 'ถูกแบน')
eq(classifyPasswordSignInError({ status: 400, message: 'Invalid login credentials' }), 'credentials', 'ไม่มี code ดูจากข้อความ')
eq(classifyPasswordSignInError({ status: 400, message: 'Email logins are disabled' }), 'password_login_disabled', 'ข้อความปิดทางรหัสผ่าน')
eq(classifyPasswordSignInError({ name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' }), 'network', 'เน็ตหลุด')
eq(classifyPasswordSignInError({ status: 503 }), 'network', 'เซิร์ฟเวอร์ล่ม')
eq(classifyPasswordSignInError({ code: 'something_new', status: 400 }), 'unknown', 'code ที่ไม่รู้จัก')
eq(classifyPasswordSignInError({ message: 'boom' }), 'unknown', 'error ทั่วไป')
eq(classifyPasswordSignInError(null), 'unknown', 'null')
// code ชนะข้อความ — ข้อความที่มีคำว่า captcha แต่ code บอกว่ารหัสผิด ต้องเป็นรหัสผิด
eq(classifyPasswordSignInError({ code: 'invalid_credentials', message: 'captcha' }), 'credentials', 'code ชนะข้อความ')

// ข้อความ: กลุ่มรหัสผิดต้องเป็นข้อความเดิม (ไม่บอกว่าชื่อผู้ใช้มีอยู่หรือไม่) กลุ่มอื่นต้องไม่ใช่ข้อความนั้น
const GENERIC = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'
eq(passwordSignInMessage('credentials'), GENERIC, 'รหัสผิดใช้ข้อความเดิม')
for (const kind of ['password_login_disabled', 'captcha', 'rate_limited', 'not_confirmed', 'banned', 'network', 'unknown'] as const) {
  eq(passwordSignInMessage(kind) !== GENERIC && passwordSignInMessage(kind).length > 0, true, `${kind} ต้องมีข้อความของตัวเอง`)
}
// /auth/password ตอบ 401 สองแบบ: "denied" = กติกาไม่ให้เข้า · "no_session" (หรือไม่มี code) = ไม่มี session มาถึงเซิร์ฟเวอร์
eq(passwordSessionDeniedMessage(401, 'denied').includes('ยังไม่พร้อมใช้งาน'), true, '401 denied = บัญชียังไม่พร้อม')
eq(passwordSessionDeniedMessage(403, 'denied').includes('ยังไม่พร้อมใช้งาน'), true, '403 denied = บัญชียังไม่พร้อม')
eq(passwordSessionDeniedMessage(401, 'no_session').includes('session'), true, '401 no_session = ไม่ได้รับ session')
eq(passwordSessionDeniedMessage(401, 'no_session').includes('ยังไม่พร้อมใช้งาน'), false, 'no_session ห้ามโทษบัญชี')
eq(passwordSessionDeniedMessage(401).includes('ยังไม่พร้อมใช้งาน'), false, '401 ไม่มี code ห้ามโทษบัญชี')
eq(passwordSessionDeniedMessage(401, { a: 1 }).includes('ยังไม่พร้อมใช้งาน'), false, 'code ที่ไม่ใช่ข้อความ ห้ามโทษบัญชี')
eq(passwordSessionDeniedMessage(503).includes('ขัดข้อง'), true, '503 = ระบบขัดข้อง')
eq(passwordSessionDeniedMessage(503, 'denied').includes('ขัดข้อง'), true, '503 ไม่สน code')
eq(passwordSessionDeniedMessage(0).includes('ขัดข้อง'), true, 'เรียกไม่ถึงเซิร์ฟเวอร์ = ระบบขัดข้อง')
for (const code of ['denied', 'no_session', undefined]) {
  eq(passwordSessionDeniedMessage(401, code) !== GENERIC, true, `401 ${code} ไม่ใช่ข้อความรหัสผิด`)
}

// รหัสผ่านของลูกค้า: สั้นสุด 6 ตัวอักษร ยาวสุด 72 ไบต์ (Supabase Auth)
eq(clientPasswordProblem('abcdef'), null, '6 ตัวผ่าน')
eq(clientPasswordProblem('abcde') !== null, true, '5 ตัวไม่ผ่าน')
eq(clientPasswordProblem('') !== null, true, 'ว่างไม่ผ่าน')
eq(clientPasswordProblem(123456) !== null, true, 'ไม่ใช่ข้อความไม่ผ่าน')
eq(clientPasswordProblem(null) !== null, true, 'null ไม่ผ่าน')
eq(clientPasswordProblem('a'.repeat(CLIENT_PASSWORD_MAX_BYTES)), null, '72 ไบต์ผ่าน')
eq(clientPasswordProblem('a'.repeat(CLIENT_PASSWORD_MAX_BYTES + 1)) !== null, true, '73 ไบต์ไม่ผ่าน')
eq(clientPasswordProblem('ก'.repeat(24)), null, 'ไทย 24 ตัว = 72 ไบต์ผ่าน')
eq(clientPasswordProblem('ก'.repeat(25)) !== null, true, 'ไทย 25 ตัว = 75 ไบต์ไม่ผ่าน')
eq(clientPasswordProblem('a'.repeat(73))!.includes('ยาวเกิน'), true, 'ข้อความบอกว่ายาวเกิน')
eq(clientPasswordProblem('abc')!.includes(String(CLIENT_PASSWORD_MIN_LENGTH)), true, 'ข้อความบอกความยาวขั้นต่ำ')

// ช่วงเวลาที่ /auth/password รับการกรอกรหัสผ่าน — ต้องเท่ากับที่ตัวตรวจในหน้า Users ใช้
const NOW = 1_800_000_000
eq(isFreshPasswordLogin(NOW, NOW), true, 'เพิ่ง login')
eq(isFreshPasswordLogin(null, NOW), false, 'ไม่มี claim amr')
eq(isFreshPasswordLogin(NOW - PASSWORD_LOGIN_MAX_AGE_S, NOW), true, 'ครบ 300 วินาทีพอดียังผ่าน')
eq(isFreshPasswordLogin(NOW - PASSWORD_LOGIN_MAX_AGE_S - 1, NOW), false, 'เกิน 300 วินาทีไม่ผ่าน')
eq(isFreshPasswordLogin(NOW + PASSWORD_LOGIN_CLOCK_SKEW_S, NOW), true, 'นาฬิกา Supabase เร็วกว่า 60 วินาทียังผ่าน')
eq(isFreshPasswordLogin(NOW + PASSWORD_LOGIN_CLOCK_SKEW_S + 1, NOW), false, 'เร็วกว่าเกิน 60 วินาทีไม่ผ่าน')
eq(PASSWORD_LOGIN_MAX_AGE_S, 300, 'ช่วงเวลาเดิม 300 วินาที')
eq(PASSWORD_LOGIN_CLOCK_SKEW_S, 60, 'ส่วนต่างนาฬิกาเดิม 60 วินาที')

console.log(`client-login: ${passed} passed`)
