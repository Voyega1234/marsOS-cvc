import { request as httpRequest } from "http";
import { request as httpsRequest } from "https";
import { resolve4, resolve6 } from "dns/promises";
import { isIP } from "net";
import type { IncomingHttpHeaders, ClientRequest, IncomingMessage, RequestOptions } from "http";

/**
 * Centralized SSRF-safe HTTP client. Every outbound request whose destination
 * (host, or a redirect target) is even partly influenced by a tenant MUST go
 * through this module instead of the global `fetch`.
 *
 * Defenses:
 *  - Only http/https accepted.
 *  - Hostnames are resolved (A + AAAA) here, every candidate address is
 *    checked against loopback/private/link-local/multicast/reserved ranges
 *    (IPv4 and IPv6, incl. IPv4-mapped/compatible forms) — then the exact
 *    validated IP is pinned for the actual connection via a custom `lookup`,
 *    so a second (possibly different, "rebound") DNS answer is never used.
 *  - Redirects are never auto-followed by the underlying transport; each hop
 *    is resolved + validated again before being followed, up to a hop limit.
 *  - A tenant-controlled header can never override Host or other headers
 *    that could be used to smuggle credentials or reach internal services.
 *  - Requests time out and responses are capped in size.
 */

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5MB

/** Headers a caller may never set — we control these ourselves. */
const FORBIDDEN_HEADER_NAMES = new Set([
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "upgrade",
  "proxy-authorization",
  "proxy-authenticate",
  "te",
  "trailer",
  "expect",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
  "forwarded",
]);

export class SafeFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafeFetchError";
  }
}

export interface SafeFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  timeoutMs?: number;
  maxRedirects?: number;
  maxResponseBytes?: number;
  /**
   * Defaults to `true` (existing behavior): redirects are auto-followed,
   * hop by hop, each hop re-validated by `resolvePinnedAddress`/`validateUrl`
   * before it's requested. Set to `false` to get the single hop's raw
   * response back instead — status + headers (incl. `location`) — without
   * following or throwing on a redirect. Callers that need the individual
   * hops of a redirect chain (e.g. a diagnostic tool) call `safeFetch` again
   * themselves for the next hop, so every hop still gets the exact same
   * SSRF validation a normal call gets; nothing here weakens that.
   */
  followRedirects?: boolean;
}

export interface SafeFetchResponse {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

/* ------------------------------------------------------------------ */
/* Address range checks                                                */
/* ------------------------------------------------------------------ */

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map((p) => Number(p));
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function ipv4InRange(ip: string, base: string, bits: number): boolean {
  const n = ipv4ToInt(ip);
  const b = ipv4ToInt(base);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (n & mask) === (b & mask);
}

/** Loopback, private, link-local (incl. cloud metadata 169.254.169.254),
 * CGNAT, multicast, reserved, and other non-public IPv4 ranges. */
function isBlockedIPv4(ip: string): boolean {
  return (
    ipv4InRange(ip, "0.0.0.0", 8) ||
    ipv4InRange(ip, "10.0.0.0", 8) ||
    ipv4InRange(ip, "100.64.0.0", 10) ||
    ipv4InRange(ip, "127.0.0.0", 8) ||
    ipv4InRange(ip, "169.254.0.0", 16) ||
    ipv4InRange(ip, "172.16.0.0", 12) ||
    ipv4InRange(ip, "192.0.0.0", 24) ||
    ipv4InRange(ip, "192.0.2.0", 24) ||
    ipv4InRange(ip, "192.168.0.0", 16) ||
    ipv4InRange(ip, "198.18.0.0", 15) ||
    ipv4InRange(ip, "198.51.100.0", 24) ||
    ipv4InRange(ip, "203.0.113.0", 24) ||
    ipv4InRange(ip, "224.0.0.0", 4) ||
    ipv4InRange(ip, "240.0.0.0", 4) ||
    ip === "255.255.255.255"
  );
}

/** Expands any valid textual IPv6 address (incl. embedded IPv4 tail) to 16 bytes. */
function ipv6ToBytes(rawIp: string): Buffer {
  let ip = rawIp;
  const zoneIdx = ip.indexOf("%");
  if (zoneIdx !== -1) ip = ip.slice(0, zoneIdx);

  const expandV4Tail = (parts: string[]): string[] => {
    const last = parts[parts.length - 1];
    if (last && last.includes(".")) {
      const v4 = last.split(".").map(Number);
      const hi = (((v4[0] << 8) | v4[1]) >>> 0).toString(16);
      const lo = (((v4[2] << 8) | v4[3]) >>> 0).toString(16);
      return [...parts.slice(0, -1), hi, lo];
    }
    return parts;
  };

  let headParts: string[];
  let tailParts: string[];
  const dbl = ip.indexOf("::");
  if (dbl !== -1) {
    const head = ip.slice(0, dbl);
    const tail = ip.slice(dbl + 2);
    headParts = head ? head.split(":") : [];
    tailParts = tail ? tail.split(":") : [];
  } else {
    headParts = ip.split(":");
    tailParts = [];
  }

  headParts = expandV4Tail(headParts);
  tailParts = expandV4Tail(tailParts);

  const missing = 8 - (headParts.length + tailParts.length);
  const full = [...headParts, ...Array(Math.max(missing, 0)).fill("0"), ...tailParts];

  const buf = Buffer.alloc(16);
  for (let i = 0; i < 8; i++) {
    const val = parseInt(full[i] || "0", 16) || 0;
    buf.writeUInt16BE(val & 0xffff, i * 2);
  }
  return buf;
}

/** Loopback, unique-local, link-local, multicast, unspecified, discard,
 * documentation, and IPv4-mapped/compatible addresses that resolve to a
 * blocked IPv4 range. */
function isBlockedIPv6(ip: string): boolean {
  const buf = ipv6ToBytes(ip);

  // IPv4-mapped ::ffff:a.b.c.d
  if (buf.subarray(0, 10).every((b) => b === 0) && buf[10] === 0xff && buf[11] === 0xff) {
    const v4 = `${buf[12]}.${buf[13]}.${buf[14]}.${buf[15]}`;
    return isBlockedIPv4(v4);
  }

  // Unspecified ::
  if (buf.every((b) => b === 0)) return true;

  // Loopback ::1
  if (buf.subarray(0, 15).every((b) => b === 0) && buf[15] === 1) return true;

  // IPv4-compatible ::a.b.c.d (deprecated form, everything else all-zero prefix)
  if (buf.subarray(0, 12).every((b) => b === 0)) return true;

  // Link-local fe80::/10
  if (buf[0] === 0xfe && (buf[1] & 0xc0) === 0x80) return true;

  // Unique-local fc00::/7
  if ((buf[0] & 0xfe) === 0xfc) return true;

  // Multicast ff00::/8
  if (buf[0] === 0xff) return true;

  // Discard-only prefix 100::/64
  if (buf[0] === 0x01 && buf[1] === 0x00 && buf.subarray(2, 8).every((b) => b === 0)) return true;

  // Documentation 2001:db8::/32
  if (buf[0] === 0x20 && buf[1] === 0x01 && buf[2] === 0x0d && buf[3] === 0xb8) return true;

  return false;
}

export function isBlockedAddress(address: string, family: 4 | 6): boolean {
  return family === 4 ? isBlockedIPv4(address) : isBlockedIPv6(address);
}

/** `URL#hostname` keeps the surrounding brackets for an IPv6 literal
 * (e.g. "[::1]") — strip them so `net.isIP()` / `dns` / our range checks
 * recognize it as the literal address it is. */
function stripBrackets(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

/* ------------------------------------------------------------------ */
/* DNS pinning                                                         */
/* ------------------------------------------------------------------ */

async function resolvePinnedAddress(rawHostname: string): Promise<{ address: string; family: 4 | 6 }> {
  const hostname = stripBrackets(rawHostname);
  const literal = isIP(hostname);
  if (literal === 4 || literal === 6) {
    const family = literal as 4 | 6;
    if (isBlockedAddress(hostname, family)) {
      throw new SafeFetchError(`ปลายทางนี้เป็นที่อยู่ภายในเครือข่าย ใช้ไม่ได้: ${hostname}`);
    }
    return { address: hostname, family };
  }

  const [v4, v6] = await Promise.allSettled([resolve4(hostname), resolve6(hostname)]);
  const candidates: { address: string; family: 4 | 6 }[] = [];
  if (v4.status === "fulfilled") candidates.push(...v4.value.map((a) => ({ address: a, family: 4 as const })));
  if (v6.status === "fulfilled") candidates.push(...v6.value.map((a) => ({ address: a, family: 6 as const })));

  if (candidates.length === 0) {
    throw new SafeFetchError(`ไม่สามารถ resolve hostname ได้: ${hostname}`);
  }

  const allowed = candidates.filter((c) => !isBlockedAddress(c.address, c.family));
  if (allowed.length === 0) {
    throw new SafeFetchError(`ปลายทางนี้ resolve ไปยังที่อยู่ภายในเครือข่ายเท่านั้น: ${hostname}`);
  }
  return allowed[0];
}

/* ------------------------------------------------------------------ */
/* Header + URL validation                                            */
/* ------------------------------------------------------------------ */

function sanitizeHeaders(headers?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  for (const [k, v] of Object.entries(headers)) {
    if (FORBIDDEN_HEADER_NAMES.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  return out;
}

function validateUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SafeFetchError(`URL ไม่ถูกต้อง: ${rawUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SafeFetchError(`รองรับเฉพาะ http:// และ https:// เท่านั้น: ${rawUrl}`);
  }
  return url;
}

function normalizeIncomingHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined) continue;
    out[k] = Array.isArray(v) ? v.join(", ") : v;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Single hop                                                          */
/* ------------------------------------------------------------------ */

interface HopResult {
  status: number;
  headers: Record<string, string>;
  bodyBuffer: Buffer;
  redirectLocation?: string;
}

function performHop(
  url: URL,
  pinned: { address: string; family: 4 | 6 },
  opts: { method: string; headers: Record<string, string>; body?: Buffer; timeoutMs: number; maxResponseBytes: number }
): Promise<HopResult> {
  const isHttps = url.protocol === "https:";

  return new Promise((resolve, reject) => {
    let settled = false;
    const finishError = (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err instanceof SafeFetchError ? err : new SafeFetchError(err.message));
    };

    const requestOptions: RequestOptions = {
      protocol: url.protocol,
      // Bracket-stripped for the connect-level hostname (IPv6 literals);
      // the Host header below (`url.host`) keeps the brackets it needs.
      hostname: stripBrackets(url.hostname),
      port: url.port ? Number(url.port) : isHttps ? 443 : 80,
      path: `${url.pathname}${url.search}`,
      method: opts.method,
      headers: { ...opts.headers, host: url.host },
      timeout: opts.timeoutMs,
      // Pin the exact address we already validated — defeats DNS rebinding,
      // since no second DNS lookup ever happens for this connection.
      lookup: (_hostname: string, _lookupOpts: unknown, callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void) => {
        callback(null, pinned.address, pinned.family);
      },
    };

    const responseHandler = (res: IncomingMessage) => {
      const status = res.statusCode ?? 0;
      const chunks: Buffer[] = [];
      let received = 0;

      res.on("data", (chunk: Buffer) => {
        if (settled) return;
        received += chunk.length;
        if (received > opts.maxResponseBytes) {
          settled = true;
          req.destroy();
          res.destroy();
          reject(new SafeFetchError("Response เกินขนาดที่อนุญาต"));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        if (settled) return;
        settled = true;
        resolve({
          status,
          headers: normalizeIncomingHeaders(res.headers),
          bodyBuffer: Buffer.concat(chunks),
          redirectLocation: typeof res.headers.location === "string" ? res.headers.location : undefined,
        });
      });
      res.on("error", finishError);
    };

    const req: ClientRequest = isHttps
      ? httpsRequest(requestOptions, responseHandler)
      : httpRequest(requestOptions, responseHandler);

    req.on("timeout", () => {
      finishError(new SafeFetchError("Request timed out"));
      req.destroy();
    });
    req.on("error", finishError);

    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResponse> {
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = opts.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const followRedirects = opts.followRedirects ?? true;

  let currentUrl = validateUrl(rawUrl);
  let currentMethod = (opts.method ?? "GET").toUpperCase();
  let currentBody: Buffer | undefined = typeof opts.body === "string" ? Buffer.from(opts.body) : opts.body;
  const baseHeaders = sanitizeHeaders(opts.headers);

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const pinned = await resolvePinnedAddress(currentUrl.hostname);
    const headers = { ...baseHeaders };
    if (currentBody && !("content-length" in headers)) {
      headers["content-length"] = String(currentBody.length);
    }

    const result = await performHop(currentUrl, pinned, {
      method: currentMethod,
      headers,
      body: currentBody,
      timeoutMs,
      maxResponseBytes,
    });

    const isRedirect = result.status >= 300 && result.status < 400 && !!result.redirectLocation;
    if (isRedirect && followRedirects) {
      if (hop === maxRedirects) {
        throw new SafeFetchError("Redirect เกินจำนวนที่อนุญาต");
      }
      const nextUrl = validateUrl(new URL(result.redirectLocation!, currentUrl).toString());
      // 303 always downgrades to GET; 301/302 downgrade non-GET/HEAD too
      // (matches standard fetch/browser redirect behavior).
      if ([301, 302, 303].includes(result.status) && currentMethod !== "GET" && currentMethod !== "HEAD") {
        currentMethod = "GET";
        currentBody = undefined;
      }
      currentUrl = nextUrl;
      continue;
    }

    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      headers: result.headers,
      text: async () => result.bodyBuffer.toString("utf-8"),
      json: async () => JSON.parse(result.bodyBuffer.toString("utf-8")),
    };
  }

  throw new SafeFetchError("Redirect เกินจำนวนที่อนุญาต");
}
