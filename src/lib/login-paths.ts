/**
 * The two login pages and which one a visitor is sent to.
 *
 * - /login         the team: Google only
 * - /client-login  customers (role CLIENT): the username + password the team created for them
 *
 * Both pages are public, so nothing here decides who may get in: that stays with /auth/callback,
 * /auth/password and src/lib/auth.ts. This file only picks the page a signed-out visitor lands on.
 *
 * It must not import anything Node-only: the middleware runs on the Edge runtime.
 */
import type { NextResponse } from "next/server";
import { CLIENT_LOGIN_EMAIL_DOMAIN } from "./client-login";

export const TEAM_LOGIN_PATH = "/login";
export const CLIENT_LOGIN_PATH = "/client-login";

/**
 * Remembers that this browser last signed in as a customer, so an expired session goes back to the customer
 * page instead of the Google one. A routing hint only: it grants nothing and both login pages are public.
 */
export const LOGIN_KIND_COOKIE = "mars_login_kind";
export const LOGIN_KIND_CLIENT = "client";

export function isLoginPath(pathname: string): boolean {
  return pathname === TEAM_LOGIN_PATH || pathname === CLIENT_LOGIN_PATH;
}

/** An account the Users page created for a customer signs in with <username>@mars.local. */
function isClientAccountEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && email.toLowerCase().endsWith(`@${CLIENT_LOGIN_EMAIL_DOMAIN}`);
}

/**
 * The login page for a visitor who has to sign in (again).
 * - already on a login page: stay on it
 * - a known account decides by its email (the hint is ignored: it may be left over from someone else)
 * - no account: the hint from the last sign-in, otherwise the team page
 */
export function loginPathFor(opts: { email?: string | null; hint?: string | null; current?: string | null }): string {
  if (opts.current && isLoginPath(opts.current)) return opts.current;
  if (opts.email) return isClientAccountEmail(opts.email) ? CLIENT_LOGIN_PATH : TEAM_LOGIN_PATH;
  return opts.hint === LOGIN_KIND_CLIENT ? CLIENT_LOGIN_PATH : TEAM_LOGIN_PATH;
}

export function setClientLoginHint(res: NextResponse) {
  res.cookies.set(LOGIN_KIND_COOKIE, LOGIN_KIND_CLIENT, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 180 * 24 * 60 * 60,
  });
}

export function clearClientLoginHint(res: NextResponse) {
  res.cookies.set(LOGIN_KIND_COOKIE, "", { path: "/", maxAge: 0 });
}
