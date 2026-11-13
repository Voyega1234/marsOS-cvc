/** ดึง HTML แบบกัน SSRF (node เท่านั้น ไม่พึ่ง dependency) */
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";

const blocked = new net.BlockList();
const V4: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
];
for (const [a, p] of V4) blocked.addSubnet(a, p, "ipv4");
blocked.addAddress("::", "ipv6");
blocked.addAddress("::1", "ipv6");
blocked.addSubnet("fc00::", 7, "ipv6");
blocked.addSubnet("fe80::", 10, "ipv6");
blocked.addSubnet("ff00::", 8, "ipv6");

/** แปลง IPv6 เป็น 8 กลุ่ม 16 บิต (null ถ้า parse ไม่ได้) */
function expandV6(ip: string): number[] | null {
  let s = ip.split("%")[0].toLowerCase();
  // รูปแบบ ...:a.b.c.d
  const m = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (m) {
    const o = m[2].split(".").map(Number);
    if (o.length !== 4 || o.some((n) => !(n >= 0 && n <= 255))) return null;
    s = `${m[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  let groups: string[];
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    groups = [...head, ...Array(fill).fill("0"), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  const out = groups.map((g) => parseInt(g, 16));
  if (out.some((n) => !Number.isFinite(n) || n < 0 || n > 0xffff)) return null;
  return out;
}

export function isBlockedAddress(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return blocked.check(ip, "ipv4");
  if (kind === 6) {
    const g = expandV6(ip);
    if (!g) return true;
    const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
    // ::ffff:a.b.c.d
    if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return blocked.check(v4(g[6], g[7]), "ipv4");
    // 64:ff9b::/96
    if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return blocked.check(v4(g[6], g[7]), "ipv4");
    // 2002::/16 (6to4)
    if (g[0] === 0x2002) return blocked.check(v4(g[1], g[2]), "ipv4");
    return blocked.check(ip.split("%")[0], "ipv6");
  }
  return true; // ไม่ใช่ IP = ไม่ปล่อย
}

export type SafeFetchResult =
  | { ok: true; status: number; finalUrl: string; html: string }
  | { ok: false; reason: "BLOCKED" | "TIMEOUT" | "HTTP_ERROR" | "NOT_HTML" | "NETWORK"; status?: number; detail: string };

interface Opts { timeoutMs?: number; maxBytes?: number; maxRedirects?: number }

class Fail extends Error {
  constructor(public reason: "BLOCKED" | "TIMEOUT" | "HTTP_ERROR" | "NOT_HTML" | "NETWORK", public detail: string, public status?: number) {
    super(detail);
  }
}

function validateUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Fail("BLOCKED", "URL ไม่ถูกต้อง"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Fail("BLOCKED", "รองรับเฉพาะ http/https");
  if (u.username || u.password) throw new Fail("BLOCKED", "ไม่รองรับ URL ที่มี username/password");
  if (u.port && u.port !== "80" && u.port !== "443") throw new Fail("BLOCKED", "ไม่รองรับพอร์ตนี้");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!host) throw new Fail("BLOCKED", "URL ไม่ถูกต้อง");
  if (net.isIP(host) && isBlockedAddress(host)) throw new Fail("BLOCKED", "ที่อยู่ปลายทางไม่ได้รับอนุญาต");
  if (host.toLowerCase() === "localhost" || host.toLowerCase().endsWith(".localhost")) throw new Fail("BLOCKED", "ที่อยู่ปลายทางไม่ได้รับอนุญาต");
  return u;
}

/** lookup ที่ตรวจทุก address ก่อนส่งให้ socket (กัน DNS rebinding) */
function guardedLookup(hostname: string, options: any, cb: (...a: any[]) => void) {
  dns.lookup(hostname, { all: true }, (err, addrs) => {
    if (err) return cb(err);
    if (!addrs || addrs.length === 0) return cb(new Error("ENOTFOUND"));
    if (addrs.some((a) => isBlockedAddress(a.address))) {
      const e: any = new Error("BLOCKED_ADDRESS");
      e.code = "BLOCKED_ADDRESS";
      return cb(e);
    }
    const first = addrs[0];
    if (options && options.all) return cb(null, addrs);
    cb(null, first.address, first.family);
  });
}

function requestOnce(u: URL, deadline: number, maxBytes: number): Promise<{ status: number; location?: string; contentType: string; body: Buffer | null }> {
  return new Promise((resolve, reject) => {
    const left = deadline - Date.now();
    if (left <= 0) return reject(new Fail("TIMEOUT", "หมดเวลา"));
    const mod = u.protocol === "https:" ? https : http;
    let settled = false;
    const done = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); fn(); } };
    const req = mod.request(
      u,
      {
        method: "GET",
        lookup: guardedLookup as any,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; MarsOS-LinkCheck/1.0)",
          Accept: "text/html",
          "Accept-Encoding": "gzip, deflate, br",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = typeof res.headers.location === "string" ? res.headers.location : undefined;
        const contentType = String(res.headers["content-type"] ?? "").toLowerCase();
        if (status >= 300 && status < 400 && location) {
          res.resume();
          return done(() => resolve({ status, location, contentType, body: null }));
        }
        if (status >= 400 || status < 200) {
          res.resume();
          return done(() => reject(new Fail("HTTP_ERROR", `เว็บตอบกลับสถานะ ${status}`, status)));
        }
        if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
          res.resume();
          return done(() => reject(new Fail("NOT_HTML", "ปลายทางไม่ใช่หน้า HTML", status)));
        }
        const enc = String(res.headers["content-encoding"] ?? "").toLowerCase();
        let stream: NodeJS.ReadableStream = res;
        if (enc === "gzip" || enc === "x-gzip") stream = res.pipe(zlib.createGunzip());
        else if (enc === "deflate") stream = res.pipe(zlib.createInflate());
        else if (enc === "br") stream = res.pipe(zlib.createBrotliDecompress());
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on("data", (c: Buffer) => {
          chunks.push(c);
          size += c.length;
          if (size >= maxBytes) {
            req.destroy();
            done(() => resolve({ status, contentType, body: Buffer.concat(chunks).subarray(0, maxBytes) }));
          }
        });
        stream.on("end", () => done(() => resolve({ status, contentType, body: Buffer.concat(chunks) })));
        stream.on("error", (e: Error) => done(() => reject(new Fail("NETWORK", e.message, status))));
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      done(() => reject(new Fail("TIMEOUT", "หมดเวลา")));
    }, left);
    req.on("error", (e: any) => {
      done(() => {
        if (e?.code === "BLOCKED_ADDRESS") reject(new Fail("BLOCKED", "ที่อยู่ปลายทางไม่ได้รับอนุญาต"));
        else reject(new Fail("NETWORK", e?.code ? String(e.code) : String(e?.message ?? e)));
      });
    });
    req.end();
  });
}

export async function safeFetchHtml(url: string, opts: Opts = {}): Promise<SafeFetchResult> {
  const { timeoutMs = 10_000, maxBytes = 2_000_000, maxRedirects = 5 } = opts;
  const deadline = Date.now() + timeoutMs;
  try {
    let current = validateUrl(url);
    for (let i = 0; i <= maxRedirects; i++) {
      const r = await requestOnce(current, deadline, maxBytes);
      if (r.location) {
        let next: URL;
        try { next = new URL(r.location, current); } catch { throw new Fail("NETWORK", "Location ไม่ถูกต้อง"); }
        current = validateUrl(next.toString());
        continue;
      }
      return { ok: true, status: r.status, finalUrl: current.toString(), html: (r.body ?? Buffer.alloc(0)).toString("utf8") };
    }
    throw new Fail("NETWORK", "redirect มากเกินไป");
  } catch (e) {
    if (e instanceof Fail) return { ok: false, reason: e.reason, status: e.status, detail: e.detail };
    return { ok: false, reason: "NETWORK", detail: e instanceof Error ? e.message : String(e) };
  }
}
