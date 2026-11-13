// รัน: npx tsx src/lib/login-policy.test.ts
import {
  amrMethods, amrTimestamp, checkLoginPolicy, decodeJwtPayload, emailDomain, hasMatchingGoogleIdentity, hasOnlyTrustedIdentities,
  isCompanyEmail, CLIENT_MUST_USE_COMPANY_EMAIL, type PolicyAuthUser,
} from './login-policy'
import { clientLoginEmail, CLIENT_LOGIN_EMAIL_DOMAIN, CLIENT_LOGIN_MARKER } from './client-login'

let passed = 0
let failed = 0
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { passed++; return }
  failed++
  console.error(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)
}

/** JWT ปลอมสำหรับเทส — ฟังก์ชันที่เทสอ่านแค่ payload ไม่ตรวจลายเซ็น */
function jwt(payload: unknown): string {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig`
}
function googleUser(id: string, email: string, extra: Record<string, unknown> = {}): PolicyAuthUser {
  return { id, identities: [{ provider: 'google', identity_data: { email, email_verified: true, ...extra } }] }
}
const OAUTH = [{ method: 'oauth', timestamp: 1763000000 }]
const OK = { ok: true }
const deny = (reason: string) => ({ ok: false, reason })

// ── emailDomain / isCompanyEmail ──
eq('domain plain', emailDomain('karn@convertcake.com'), 'convertcake.com')
eq('domain upper', emailDomain('Karn@ConvertCake.COM'), 'convertcake.com')
eq('domain last @', emailDomain('"a@convertcake.com"@evil.com'), 'evil.com')
eq('domain none', emailDomain('karn'), null)
eq('domain empty local', emailDomain('@convertcake.com'), null)
eq('domain trailing @', emailDomain('karn@'), null)
eq('company ok', isCompanyEmail('apps@convertcake.com'), true)
eq('company upper', isCompanyEmail('APPS@CONVERTCAKE.COM'), true)
eq('gmail', isCompanyEmail('someone@gmail.com'), false)
eq('suffix attack', isCompanyEmail('x@convertcake.com.evil.com'), false)
eq('prefix attack', isCompanyEmail('x@evilconvertcake.com'), false)
eq('subdomain', isCompanyEmail('x@mail.convertcake.com'), false)
eq('local part trick', isCompanyEmail('x@convertcake.com@evil.com'), false)
eq('trailing dot', isCompanyEmail('x@convertcake.com.'), false)
eq('trailing space', isCompanyEmail('x@convertcake.com '), false)
eq('lookalike', isCompanyEmail('x@convertcake.c0m'), false)
eq('empty', isCompanyEmail(''), false)

// ── decodeJwtPayload ──
eq('decode ok', decodeJwtPayload(jwt({ sub: 'u1', amr: OAUTH })), { sub: 'u1', amr: OAUTH })
eq('decode thai', decodeJwtPayload(jwt({ name: 'กานต์' })), { name: 'กานต์' })
eq('decode 2 parts', decodeJwtPayload('a.b'), null)
eq('decode empty', decodeJwtPayload(''), null)
eq('decode garbage', decodeJwtPayload('x.%%%.y'), null)
eq('decode array payload', decodeJwtPayload(jwt([1, 2])), null)
eq('decode string payload', decodeJwtPayload(jwt('oauth')), null)
eq('decode non-string', decodeJwtPayload(undefined as unknown as string), null)

// ── amrMethods ──
eq('amr objects', amrMethods({ amr: [{ method: 'oauth', timestamp: 1 }, { method: 'token_refresh', timestamp: 2 }] }), ['oauth', 'token_refresh'])
eq('amr strings', amrMethods({ amr: ['password'] }), ['password'])
eq('amr missing', amrMethods({}), [])
eq('amr null claims', amrMethods(null), [])
eq('amr not array', amrMethods({ amr: 'oauth' }), [])
eq('amr junk entries', amrMethods({ amr: [null, 5, { method: 7 }, {}] }), [])

// ── hasMatchingGoogleIdentity ──
eq('identity ok', hasMatchingGoogleIdentity(googleUser('u1', 'karn@convertcake.com'), 'karn@convertcake.com'), true)
eq('identity case', hasMatchingGoogleIdentity(googleUser('u1', 'Karn@ConvertCake.com'), 'karn@convertcake.com'), true)
eq('identity other email', hasMatchingGoogleIdentity(googleUser('u1', 'attacker@gmail.com'), 'karn@convertcake.com'), false)
eq('identity unverified', hasMatchingGoogleIdentity(googleUser('u1', 'karn@convertcake.com', { email_verified: false }), 'karn@convertcake.com'), false)
eq('identity email provider only', hasMatchingGoogleIdentity(
  { id: 'u1', identities: [{ provider: 'email', identity_data: { email: 'karn@convertcake.com', email_verified: true } }] },
  'karn@convertcake.com'), false)
eq('identity none', hasMatchingGoogleIdentity({ id: 'u1' }, 'karn@convertcake.com'), false)
eq('identity null list', hasMatchingGoogleIdentity({ id: 'u1', identities: null }, 'karn@convertcake.com'), false)
eq('identity no data', hasMatchingGoogleIdentity({ id: 'u1', identities: [{ provider: 'google' }] }, 'karn@convertcake.com'), false)
eq('identity second matches', hasMatchingGoogleIdentity(
  { id: 'u1', identities: [
    { provider: 'email', identity_data: { email: 'karn@convertcake.com' } },
    { provider: 'google', identity_data: { email: 'karn@convertcake.com', email_verified: true } },
  ] }, 'karn@convertcake.com'), true)
eq('identity email_verified missing', hasMatchingGoogleIdentity(
  { id: 'u1', identities: [{ provider: 'google', identity_data: { email: 'karn@convertcake.com' } }] }, 'karn@convertcake.com'), false)
eq('identity email_verified string', hasMatchingGoogleIdentity(googleUser('u1', 'karn@convertcake.com', { email_verified: 'true' }), 'karn@convertcake.com'), false)

// ── hasOnlyTrustedIdentities ──
const KARN = 'karn@convertcake.com'
const karnGoogle = { provider: 'google', identity_data: { email: KARN, email_verified: true } }
eq('trusted google only', hasOnlyTrustedIdentities({ id: 'u1', identities: [karnGoogle] }, KARN), true)
eq('trusted google + email', hasOnlyTrustedIdentities(
  { id: 'u1', identities: [{ provider: 'email', identity_data: { email: KARN } }, karnGoogle] }, KARN), true)
eq('trusted google case', hasOnlyTrustedIdentities(googleUser('u1', 'Karn@ConvertCake.com'), KARN), true)
eq('untrusted github', hasOnlyTrustedIdentities(
  { id: 'u1', identities: [karnGoogle, { provider: 'github', identity_data: { email: KARN, email_verified: true } }] }, KARN), false)
eq('untrusted second google', hasOnlyTrustedIdentities(
  { id: 'u1', identities: [karnGoogle, { provider: 'google', identity_data: { email: 'attacker@gmail.com', email_verified: true } }] }, KARN), false)
eq('untrusted google without email', hasOnlyTrustedIdentities({ id: 'u1', identities: [karnGoogle, { provider: 'google' }] }, KARN), false)
eq('untrusted provider null', hasOnlyTrustedIdentities({ id: 'u1', identities: [karnGoogle, { provider: null }] }, KARN), false)
eq('untrusted phone', hasOnlyTrustedIdentities({ id: 'u1', identities: [karnGoogle, { provider: 'phone' }] }, KARN), false)

// ── checkLoginPolicy: ทีม ──
const team = googleUser('u1', 'karn@convertcake.com')
const teamToken = jwt({ sub: 'u1', amr: OAUTH })
eq('team google ok', checkLoginPolicy({ email: 'karn@convertcake.com', role: 'SEO_MANAGER', accessToken: teamToken, authUser: team }), OK)
eq('admin google ok', checkLoginPolicy({ email: 'karn@convertcake.com', role: 'ADMIN', accessToken: teamToken, authUser: team }), OK)
eq('auto-provision ok', checkLoginPolicy({ email: 'karn@convertcake.com', role: null, accessToken: teamToken, authUser: team }), OK)
eq('oauth after refresh ok', checkLoginPolicy({
  email: 'karn@convertcake.com', role: 'SEO_MANAGER', authUser: team,
  accessToken: jwt({ sub: 'u1', amr: [{ method: 'token_refresh', timestamp: 2 }, { method: 'oauth', timestamp: 1 }] }),
}), OK)

// session ที่ไม่ได้มาจาก Google
for (const method of ['password', 'otp', 'magiclink', 'email/signup', 'recovery', 'invite', 'anonymous', 'token_refresh']) {
  eq(`team ${method} session denied`, checkLoginPolicy({
    email: 'karn@convertcake.com', role: 'SEO_MANAGER', authUser: team,
    accessToken: jwt({ sub: 'u1', amr: [{ method, timestamp: 1 }] }),
  }), deny('not_oauth_session'))
}
eq('no amr denied', checkLoginPolicy({ email: 'karn@convertcake.com', role: 'ADMIN', accessToken: jwt({ sub: 'u1' }), authUser: team }), deny('not_oauth_session'))
eq('empty token denied', checkLoginPolicy({ email: 'karn@convertcake.com', role: 'ADMIN', accessToken: '', authUser: team }), deny('not_oauth_session'))
eq('token of another user denied', checkLoginPolicy({ email: 'karn@convertcake.com', role: 'ADMIN', accessToken: jwt({ sub: 'u2', amr: OAUTH }), authUser: team }), deny('not_oauth_session'))
eq('token without sub denied', checkLoginPolicy({ email: 'karn@convertcake.com', role: 'ADMIN', accessToken: jwt({ amr: OAUTH }), authUser: team }), deny('not_oauth_session'))

// สมัครด้วยรหัสผ่านในชื่ออีเมลของคนในทีม (ไม่มี identity ของ Google)
eq('password signup as teammate denied', checkLoginPolicy({
  email: 'karn@convertcake.com', role: 'SEO_MANAGER', accessToken: jwt({ sub: 'u9', amr: [{ method: 'password', timestamp: 1 }] }),
  authUser: { id: 'u9', identities: [{ provider: 'email', identity_data: { email: 'karn@convertcake.com', email_verified: true } }] },
}), deny('not_oauth_session'))
// login Google ด้วยบัญชีอื่น แล้วเปลี่ยนอีเมลของบัญชี Supabase เป็นของคนในทีม
eq('email swapped to teammate denied', checkLoginPolicy({
  email: 'karn@convertcake.com', role: 'SEO_MANAGER', accessToken: jwt({ sub: 'u9', amr: OAUTH }),
  authUser: googleUser('u9', 'attacker@gmail.com'),
}), deny('google_identity_mismatch'))
eq('oauth session without identities denied', checkLoginPolicy({
  email: 'karn@convertcake.com', role: 'SEO_MANAGER', accessToken: jwt({ sub: 'u9', amr: OAUTH }), authUser: { id: 'u9' },
}), deny('google_identity_mismatch'))
// สมัครด้วยรหัสผ่านในชื่ออีเมลของคนในทีม ผูก Google / GitHub ของตัวเองไว้ แล้วรอให้เจ้าของอีเมล login Google จริง
// บัญชีจะมี identity ของ Google ที่ตรงอีเมล (ของเจ้าของจริง) + ทางเข้าของผู้บุกรุก — ต้องปฏิเสธทั้งบัญชี
eq('account with attacker google linked denied', checkLoginPolicy({
  email: KARN, role: 'ADMIN', accessToken: jwt({ sub: 'u9', amr: OAUTH }),
  authUser: { id: 'u9', identities: [
    { provider: 'email', identity_data: { email: KARN } },
    { provider: 'google', identity_data: { email: 'attacker@gmail.com', email_verified: true } },
    karnGoogle,
  ] },
}), deny('untrusted_identity'))
eq('account with github linked denied', checkLoginPolicy({
  email: KARN, role: 'SEO_MANAGER', accessToken: jwt({ sub: 'u9', amr: OAUTH }),
  authUser: { id: 'u9', identities: [karnGoogle, { provider: 'github', identity_data: { email: KARN, email_verified: true } }] },
}), deny('untrusted_identity'))
eq('auto-provision with github linked denied', checkLoginPolicy({
  email: KARN, role: null, accessToken: jwt({ sub: 'u9', amr: OAUTH }),
  authUser: { id: 'u9', identities: [karnGoogle, { provider: 'github', identity_data: { email: KARN } }] },
}), deny('untrusted_identity'))
// บัญชีเก่าที่เคยตั้งรหัสผ่านแล้วมา login Google ทีหลัง — ยังเข้าได้เมื่อ session นี้มาจาก Google
eq('google + email identity via google ok', checkLoginPolicy({
  email: KARN, role: 'SEO_MANAGER', accessToken: teamToken,
  authUser: { id: 'u1', identities: [{ provider: 'email', identity_data: { email: KARN } }, karnGoogle] },
}), OK)
eq('google email_verified missing denied', checkLoginPolicy({
  email: KARN, role: 'SEO_MANAGER', accessToken: teamToken,
  authUser: { id: 'u1', identities: [{ provider: 'google', identity_data: { email: KARN } }] },
}), deny('google_identity_mismatch'))

// ทีมที่ไม่ใช่ @convertcake.com
const gmail = googleUser('u3', 'freelancer@gmail.com')
const gmailToken = jwt({ sub: 'u3', amr: OAUTH })
eq('team gmail denied', checkLoginPolicy({ email: 'freelancer@gmail.com', role: 'SEO_SPECIALIST', accessToken: gmailToken, authUser: gmail }), deny('email_domain'))
eq('admin gmail denied', checkLoginPolicy({ email: 'freelancer@gmail.com', role: 'ADMIN', accessToken: gmailToken, authUser: gmail }), deny('email_domain'))
eq('auto-provision gmail denied', checkLoginPolicy({ email: 'freelancer@gmail.com', role: null, accessToken: gmailToken, authUser: gmail }), deny('email_domain'))
eq('unknown role gmail denied', checkLoginPolicy({ email: 'freelancer@gmail.com', role: 'client', accessToken: gmailToken, authUser: gmail }), deny('email_domain'))
eq('lookalike domain denied', checkLoginPolicy({
  email: 'karn@convertcake.com.evil.com', role: 'ADMIN', accessToken: jwt({ sub: 'u4', amr: OAUTH }),
  authUser: googleUser('u4', 'karn@convertcake.com.evil.com'),
}), deny('email_domain'))

// ── checkLoginPolicy: ลูกค้า (role CLIENT) ──
eq('client flag default', CLIENT_MUST_USE_COMPANY_EMAIL, false)
eq('client own domain via google ok', checkLoginPolicy({ email: 'freelancer@gmail.com', role: 'CLIENT', accessToken: gmailToken, authUser: gmail }), OK)
// session รหัสผ่านของบัญชีที่ไม่ได้ถูกสร้างจากหน้า Users (ไม่มี marker / ไม่ส่ง userId)
eq('client password session denied', checkLoginPolicy({
  email: 'freelancer@gmail.com', role: 'CLIENT', authUser: gmail,
  accessToken: jwt({ sub: 'u3', amr: [{ method: 'password', timestamp: 1 }] }),
}), deny('client_password_not_provisioned'))
eq('client swapped email denied', checkLoginPolicy({
  email: 'owner@client.co.th', role: 'CLIENT', accessToken: gmailToken, authUser: gmail,
}), deny('google_identity_mismatch'))
eq('client with facebook linked denied', checkLoginPolicy({
  email: 'freelancer@gmail.com', role: 'CLIENT', accessToken: gmailToken,
  authUser: { id: 'u3', identities: [
    { provider: 'google', identity_data: { email: 'freelancer@gmail.com', email_verified: true } },
    { provider: 'facebook', identity_data: { email: 'freelancer@gmail.com' } },
  ] },
}), deny('untrusted_identity'))

// ── clientLoginEmail (ต้องได้ผลเท่ากับที่หน้า Users สร้าง) ──
eq('client domain const', CLIENT_LOGIN_EMAIL_DOMAIN, 'mars.local')
eq('client marker const', CLIENT_LOGIN_MARKER, 'mars_client_user_id')
eq('username plain', clientLoginEmail('acme'), 'acme@mars.local')
eq('username upper + spaces', clientLoginEmail('  Acme Corp '), 'acmecorp@mars.local')
eq('username thai', clientLoginEmail('ลูกค้า เอ'), 'ลูกค้าเอ@mars.local')
eq('username full email kept', clientLoginEmail(' Owner@Client.co.th '), 'owner@client.co.th')
eq('username empty', clientLoginEmail('   '), '')
eq('username non-string', clientLoginEmail(undefined as unknown as string), '')

// ── amrTimestamp ──
eq('amr ts password', amrTimestamp({ amr: [{ method: 'password', timestamp: 1763000000 }] }, 'password'), 1763000000)
eq('amr ts latest wins', amrTimestamp({ amr: [{ method: 'password', timestamp: 5 }, { method: 'password', timestamp: 9 }] }, 'password'), 9)
eq('amr ts other method', amrTimestamp({ amr: OAUTH }, 'password'), null)
eq('amr ts string entries', amrTimestamp({ amr: ['password'] }, 'password'), null)
eq('amr ts not a number', amrTimestamp({ amr: [{ method: 'password', timestamp: '1763000000' }] }, 'password'), null)
eq('amr ts missing', amrTimestamp({}, 'password'), null)
eq('amr ts null claims', amrTimestamp(null, 'password'), null)

// ── checkLoginPolicy: ลูกค้าเข้าด้วยรหัสผ่านที่ทีมสร้างให้ ──
const PASSWORD = [{ method: 'password', timestamp: 1763000000 }]
const ACME = 'acme@mars.local'
const acmeAuth = (marker: unknown, identities: PolicyAuthUser['identities'] = [{ provider: 'email', identity_data: { email: ACME } }]): PolicyAuthUser =>
  ({ id: 's1', identities, app_metadata: { provider: 'email', [CLIENT_LOGIN_MARKER]: marker } })
const acmeToken = jwt({ sub: 's1', amr: PASSWORD })
eq('client password ok', checkLoginPolicy({ email: ACME, role: 'CLIENT', userId: 'mars-1', accessToken: acmeToken, authUser: acmeAuth('mars-1') }), OK)
eq('client password ok without identities', checkLoginPolicy({ email: ACME, role: 'CLIENT', userId: 'mars-1', accessToken: acmeToken, authUser: acmeAuth('mars-1', null) }), OK)
eq('client password ok after refresh', checkLoginPolicy({
  email: ACME, role: 'CLIENT', userId: 'mars-1', authUser: acmeAuth('mars-1'),
  accessToken: jwt({ sub: 's1', amr: [{ method: 'token_refresh', timestamp: 2 }, ...PASSWORD] }),
}), OK)
eq('client password no userId denied', checkLoginPolicy({ email: ACME, role: 'CLIENT', accessToken: acmeToken, authUser: acmeAuth('mars-1') }), deny('client_password_not_provisioned'))
eq('client password empty userId denied', checkLoginPolicy({ email: ACME, role: 'CLIENT', userId: '', accessToken: acmeToken, authUser: acmeAuth('') }), deny('client_password_not_provisioned'))
// เปลี่ยนอีเมลของบัญชีตัวเองไปเป็นของลูกค้ารายอื่น — marker ยังเป็นของตัวเอง ไม่ตรงกับ User ที่อีเมลชี้ไป
eq('client password marker of another client denied', checkLoginPolicy({ email: 'other@mars.local', role: 'CLIENT', userId: 'mars-2', accessToken: acmeToken, authUser: acmeAuth('mars-1') }), deny('client_password_not_provisioned'))
// สมัครรหัสผ่านเองในชื่ออีเมลของลูกค้า — ไม่มี marker
eq('client password self signup denied', checkLoginPolicy({
  email: ACME, role: 'CLIENT', userId: 'mars-1', accessToken: acmeToken,
  authUser: { id: 's1', identities: [{ provider: 'email', identity_data: { email: ACME } }], app_metadata: { provider: 'email' } },
}), deny('client_password_not_provisioned'))
eq('client password no app_metadata denied', checkLoginPolicy({
  email: ACME, role: 'CLIENT', userId: 'mars-1', accessToken: acmeToken, authUser: { id: 's1' },
}), deny('client_password_not_provisioned'))
eq('client password marker not a string denied', checkLoginPolicy({ email: ACME, role: 'CLIENT', userId: 'mars-1', accessToken: acmeToken, authUser: acmeAuth(['mars-1']) }), deny('client_password_not_provisioned'))
// marker อยู่ใน user_metadata (ผู้ใช้แก้เองได้) ไม่นับ
eq('client password marker in user_metadata denied', checkLoginPolicy({
  email: ACME, role: 'CLIENT', userId: 'mars-1', accessToken: acmeToken,
  authUser: { id: 's1', identities: [], user_metadata: { [CLIENT_LOGIN_MARKER]: 'mars-1' } } as PolicyAuthUser,
}), deny('client_password_not_provisioned'))
eq('client password with github linked denied', checkLoginPolicy({
  email: ACME, role: 'CLIENT', userId: 'mars-1', accessToken: acmeToken,
  authUser: acmeAuth('mars-1', [{ provider: 'email', identity_data: { email: ACME } }, { provider: 'github', identity_data: { email: ACME } }]),
}), deny('untrusted_identity'))
eq('client password with other google linked denied', checkLoginPolicy({
  email: ACME, role: 'CLIENT', userId: 'mars-1', accessToken: acmeToken,
  authUser: acmeAuth('mars-1', [{ provider: 'google', identity_data: { email: 'attacker@gmail.com', email_verified: true } }]),
}), deny('untrusted_identity'))
eq('client password token of another user denied', checkLoginPolicy({ email: ACME, role: 'CLIENT', userId: 'mars-1', accessToken: jwt({ sub: 's2', amr: PASSWORD }), authUser: acmeAuth('mars-1') }), deny('not_oauth_session'))
// ทีมและการสร้างบัญชีอัตโนมัติ ใช้รหัสผ่านไม่ได้ แม้บัญชีจะมี marker ตรง
for (const role of ['ADMIN', 'SEO_MANAGER', 'SEO_SPECIALIST', 'USER', 'client', null]) {
  eq(`password + marker as ${role} denied`, checkLoginPolicy({ email: ACME, role, userId: 'mars-1', accessToken: acmeToken, authUser: acmeAuth('mars-1') }), deny('not_oauth_session'))
}
// session แบบอื่นของลูกค้า (ลืมรหัสผ่าน / magic link / OTP) ไม่ใช่ทางเข้าด้วยรหัสผ่าน
for (const method of ['recovery', 'magiclink', 'otp', 'email/signup', 'invite', 'anonymous', 'token_refresh']) {
  eq(`client ${method} session denied`, checkLoginPolicy({
    email: ACME, role: 'CLIENT', userId: 'mars-1', authUser: acmeAuth('mars-1'),
    accessToken: jwt({ sub: 's1', amr: [{ method, timestamp: 1 }] }),
  }), deny('not_oauth_session'))
}
// ลูกค้าที่เข้าด้วย Google ยังใช้ด่าน Google ตามเดิม (marker ไม่เกี่ยว)
eq('client google with userId ok', checkLoginPolicy({ email: 'freelancer@gmail.com', role: 'CLIENT', userId: 'mars-3', accessToken: gmailToken, authUser: gmail }), OK)

console.log(`${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
