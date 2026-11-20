// Which login page a visitor is sent to: npx tsx src/lib/login-paths.test.ts
import { CLIENT_LOGIN_PATH, LOGIN_KIND_CLIENT, TEAM_LOGIN_PATH, isLoginPath, loginPathFor } from './login-paths'

let passed = 0
function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`FAIL: ${msg}\n  actual:   ${a}\n  expected: ${e}`)
  passed++
}

// Only the two exact paths are login pages: a prefix must never count (the middleware treats them as public).
eq(isLoginPath('/login'), true, 'team page')
eq(isLoginPath('/client-login'), true, 'customer page')
eq(isLoginPath('/login/'), false, 'trailing slash is another path')
eq(isLoginPath('/login/anything'), false, 'no prefix match on the team page')
eq(isLoginPath('/client-login/anything'), false, 'no prefix match on the customer page')
eq(isLoginPath('/client-login-admin'), false, 'no prefix match without a slash')
eq(isLoginPath('/projects'), false, 'an app page')
eq(isLoginPath(''), false, 'empty')

// No account, no hint: the team page, as before the pages were split.
eq(loginPathFor({}), TEAM_LOGIN_PATH, 'nothing known')
eq(loginPathFor({ hint: null, email: null }), TEAM_LOGIN_PATH, 'nulls')
eq(loginPathFor({ hint: 'team' }), TEAM_LOGIN_PATH, 'unknown hint value')
eq(loginPathFor({ hint: '' }), TEAM_LOGIN_PATH, 'empty hint')

// A browser that last signed in as a customer goes back to the customer page.
eq(loginPathFor({ hint: LOGIN_KIND_CLIENT }), CLIENT_LOGIN_PATH, 'customer hint')

// A known account decides by its email, whatever the hint says.
eq(loginPathFor({ email: 'mfactor@mars.local' }), CLIENT_LOGIN_PATH, 'customer account')
eq(loginPathFor({ email: 'MFactor@MARS.LOCAL' }), CLIENT_LOGIN_PATH, 'customer account, upper case')
eq(loginPathFor({ email: 'someone@convertcake.com' }), TEAM_LOGIN_PATH, 'team account')
eq(loginPathFor({ email: 'someone@convertcake.com', hint: LOGIN_KIND_CLIENT }), TEAM_LOGIN_PATH, 'team account beats a stale hint')
eq(loginPathFor({ email: 'mfactor@mars.local', hint: null }), CLIENT_LOGIN_PATH, 'customer account without a hint')
eq(loginPathFor({ email: 'mars.local@convertcake.com' }), TEAM_LOGIN_PATH, 'the domain must be the end of the address')
eq(loginPathFor({ email: 'x@notmars.local' }), TEAM_LOGIN_PATH, 'a longer domain is not the customer domain')

// Already on a login page: stay there.
eq(loginPathFor({ current: '/client-login', email: 'someone@convertcake.com' }), CLIENT_LOGIN_PATH, 'stays on the customer page')
eq(loginPathFor({ current: '/login', email: 'mfactor@mars.local', hint: LOGIN_KIND_CLIENT }), TEAM_LOGIN_PATH, 'stays on the team page')
eq(loginPathFor({ current: '/projects', hint: LOGIN_KIND_CLIENT }), CLIENT_LOGIN_PATH, 'an app page does not count as current')

console.log(`login-paths: ${passed} checks passed`)
