/** Run: npx tsx src/lib/backlink-management/attachments.test.ts */
import {
  ACCEPT_ATTR, ATTACHMENT_TYPES, MAX_FILE_BYTES, MAX_NAME_CHARS,
  asanaFileState, contentDisposition, formatBytes, isImageMime, isSameOriginRequest,
  matchesSignature, sanitizeFileName, validateUpload,
} from "./attachments";

let n = 0;
function assert(cond: unknown, msg: string) {
  n++;
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const bytes = (...b: number[]) => new Uint8Array(b);
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const pad = (head: number[], len = 32) => {
  const u = new Uint8Array(Math.max(len, head.length));
  u.set(head);
  return u;
};
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

// ---- sanitizeFileName
{
  assert(sanitizeFileName(null) === null, "null -> null");
  assert(sanitizeFileName(123) === null, "number -> null");
  assert(sanitizeFileName(undefined) === null, "undefined -> null");
  assert(sanitizeFileName({}) === null, "object -> null");
  assert(sanitizeFileName("noext") === null, "no extension -> null");
  for (const bad of ["a.exe", "a.svg", "a.html", "a.js", "a.png.exe", "a.htm", "a.php"]) {
    assert(sanitizeFileName(bad) === null, `disallowed ${bad}`);
  }
  assert(sanitizeFileName("a.__proto__") === null, "proto ext -> null");
  assert(sanitizeFileName("a.constructor") === null, "constructor ext -> null");

  const p1 = sanitizeFileName("a/b/c.png");
  assert(p1?.fileName === "c.png" && p1.ext === "png", "unix path stripped");
  const p2 = sanitizeFileName("C:\\x\\y.PNG");
  assert(p2?.fileName === "y.png" && p2.ext === "png", "windows path stripped + ext lower-cased");
  const p3 = sanitizeFileName("../../etc/passwd.txt");
  assert(p3?.fileName === "passwd.txt", "traversal stripped");

  const th = sanitizeFileName("รายงาน เดือน ต.ค..pdf");
  assert(!!th && th.fileName.endsWith(".pdf") && th.fileName.includes("รายงาน เดือน"), "Thai kept");
  assert(th?.ext === "pdf", "Thai ext pdf");

  assert(sanitizeFileName("inv\u202Egnp.exe") === null, "bidi-spoofed exe -> null");
  assert(sanitizeFileName("a\u0000b\u202E.png")?.fileName === "ab.png", "control + bidi removed");
  assert(sanitizeFileName("a\u0001\u007f\u0085b.txt")?.fileName === "ab.txt", "C0/DEL/C1 removed");

  const rs = sanitizeFileName('a<b>c:d"e|f?g*h.png');
  assert(rs?.fileName === "a_b_c_d_e_f_g_h.png", "reserved chars replaced");

  assert(sanitizeFileName(".hidden.txt")?.fileName === "hidden.txt", "leading dots removed");
  assert(sanitizeFileName("...x.txt")?.fileName === "x.txt", "multiple leading dots removed");

  const empty = sanitizeFileName(".png");
  assert(empty === null || /^[^.]+\.png$/.test(empty.fileName), ".png never empty stem");
  const empty2 = sanitizeFileName(" .png");
  assert(empty2 === null || /^[^.\s]+\.png$/.test(empty2.fileName), "' .png' never empty stem");
  const empty3 = sanitizeFileName("\u202E.png");
  assert(empty3 === null || /^[^.]+\.png$/.test(empty3.fileName), "bidi-only stem never empty");

  const dbl = sanitizeFileName("x.html.png");
  assert(dbl?.ext === "png" && dbl.fileName === "x.html.png", "double extension allowed with real ext");

  const long = sanitizeFileName(`${"a".repeat(300)}.pdf`);
  assert(!!long && Array.from(long.fileName).length <= MAX_NAME_CHARS, "long name <= MAX_NAME_CHARS");
  assert(long!.fileName.endsWith(".pdf"), "long name keeps ext");
  assert(Array.from(long!.fileName).length === MAX_NAME_CHARS, "long name uses full budget");

  const emoji = sanitizeFileName(`${"😀".repeat(300)}.png`);
  assert(!!emoji && Array.from(emoji.fileName).length <= MAX_NAME_CHARS, "emoji name <= MAX_NAME_CHARS");
  assert(!LONE_SURROGATE.test(emoji!.fileName), "no lone surrogate after cut");
  assert(emoji!.fileName.endsWith(".png"), "emoji name keeps ext");
  const emoji2 = sanitizeFileName(`x${"😀".repeat(300)}.png`);
  assert(!LONE_SURROGATE.test(emoji2!.fileName), "no lone surrogate (odd offset)");

  assert(sanitizeFileName("a   b.txt")?.fileName === "a b.txt", "whitespace collapsed");
  assert(sanitizeFileName("a.png.")?.fileName === "a.png", "trailing dot removed");
}

// ---- matchesSignature
{
  assert(matchesSignature("png", pad(PNG)), "png ok");
  assert(matchesSignature("jpg", pad([0xff, 0xd8, 0xff, 0xe0])), "jpg ok");
  assert(matchesSignature("jpeg", pad([0xff, 0xd8, 0xff, 0xe1])), "jpeg ok");
  assert(matchesSignature("gif", pad(ascii("GIF87a"))), "gif87a ok");
  assert(matchesSignature("gif", pad(ascii("GIF89a"))), "gif89a ok");
  assert(matchesSignature("webp", pad([...ascii("RIFF"), 1, 2, 3, 4, ...ascii("WEBP")])), "webp ok");
  assert(!matchesSignature("webp", pad([...ascii("RIFF"), 1, 2, 3, 4, ...ascii("WAVE")])), "RIFF WAVE not webp");
  assert(matchesSignature("pdf", pad(ascii("%PDF-1.7"))), "pdf ok");
  for (const e of ["docx", "xlsx", "pptx"]) assert(matchesSignature(e, pad(ZIP)), `${e} zip ok`);
  for (const e of ["doc", "xls", "ppt"]) assert(matchesSignature(e, pad(OLE)), `${e} ole ok`);

  assert(!matchesSignature("pdf", pad(PNG)), "PNG bytes named pdf fail");
  assert(!matchesSignature("png", new TextEncoder().encode("<html><script>alert(1)</script></html>")), "HTML named png fail");
  assert(!matchesSignature("doc", pad(ZIP)), "ZIP named doc fail");
  assert(!matchesSignature("docx", pad(OLE)), "OLE named docx fail");
  assert(!matchesSignature("png", pad([0xff, 0xd8, 0xff])), "jpg bytes named png fail");

  assert(matchesSignature("txt", new TextEncoder().encode("สวัสดีชาวโลก\nบรรทัดสอง")), "Thai utf-8 text ok");
  assert(matchesSignature("csv", new TextEncoder().encode("a,b\n1,2")), "csv ok");
  assert(matchesSignature("md", new TextEncoder().encode("# hi")), "md ok");
  assert(!matchesSignature("txt", bytes(0x61, 0x00, 0x62)), "NUL in txt fails");
  assert(!matchesSignature("csv", pad(PNG)), "PNG bytes named csv fail (contains NUL)");
  assert(matchesSignature("txt", bytes(0xff, 0xfe, 0x61, 0x00, 0x62, 0x00)), "UTF-16 LE BOM ok");
  assert(matchesSignature("csv", bytes(0xfe, 0xff, 0x00, 0x61)), "UTF-16 BE BOM ok");

  assert(!matchesSignature("exe", pad([0x4d, 0x5a])), "unknown ext false");
  assert(!matchesSignature("svg", new TextEncoder().encode("<svg/>")), "svg false");
  assert(!matchesSignature("", pad(PNG)), "empty ext false");
  assert(!matchesSignature("png", bytes()), "empty buffer png false");
  assert(!matchesSignature("png", bytes(0x89, 0x50)), "short png false");
  assert(!matchesSignature("pdf", bytes(0x25, 0x50, 0x44)), "short pdf false");
  assert(!matchesSignature("docx", bytes(0x50, 0x4b)), "short docx false");
  assert(!matchesSignature("doc", bytes(0xd0, 0xcf)), "short doc false");
  assert(!matchesSignature("webp", bytes(...ascii("RIFF"))), "short webp false");
}

// ---- validateUpload
{
  const u1 = validateUpload({ name: "a.exe", bytes: pad(PNG) });
  assert(!u1.ok && u1.status === 415, "unsupported type 415");
  const u2 = validateUpload({ name: "a.png", bytes: new Uint8Array(0) });
  assert(!u2.ok && u2.status === 400, "empty 400");
  const u3 = validateUpload({ name: "a.png", bytes: pad(PNG, MAX_FILE_BYTES + 1) });
  assert(!u3.ok && u3.status === 413, "too big 413");
  const u4 = validateUpload({ name: "a.png", bytes: pad(PNG, MAX_FILE_BYTES) });
  assert(u4.ok, "exactly MAX_FILE_BYTES ok");
  const u5 = validateUpload({ name: "a.pdf", bytes: pad(PNG) });
  assert(!u5.ok && u5.status === 415, "mismatched content 415");
  const u6 = validateUpload({ name: 42, bytes: pad(PNG) });
  assert(!u6.ok && u6.status === 415, "non-string name 415");
  const big = validateUpload({ name: "a.exe", bytes: pad(PNG, MAX_FILE_BYTES + 1) });
  assert(!big.ok && big.status === 415, "type checked before size");

  const ok = validateUpload({ name: "C:\\tmp\\Logo.PNG", bytes: pad(PNG) });
  assert(ok.ok && ok.fileName === "Logo.png" && ok.ext === "png" && ok.mimeType === ATTACHMENT_TYPES.png.mime, "success fields");
  for (const e of ["csv", "txt", "md"]) {
    const r = validateUpload({ name: `a.${e}`, bytes: new TextEncoder().encode("hello") });
    assert(r.ok && r.mimeType === "text/plain; charset=utf-8", `${e} mime text/plain`);
  }
  const dx = validateUpload({ name: "a.docx", bytes: pad(ZIP) });
  assert(dx.ok && dx.mimeType !== "application/zip" && dx.mimeType.includes("wordprocessingml"), "docx mime not zip");
}

// ---- contentDisposition
{
  const quoted = (h: string) => /^attachment; filename="([^"]*)"; filename\*=UTF-8''(.*)$/.exec(h);
  const h1 = contentDisposition("report.pdf");
  assert(h1.startsWith('attachment; filename="'), "starts with attachment");
  assert(quoted(h1)?.[1] === "report.pdf", "plain fallback");

  const nasty = 'we"ird\\na;me%x é.pdf';
  const h2 = contentDisposition(nasty);
  const m2 = quoted(h2);
  assert(!!m2, "format parsed with nasty name");
  assert(!/["\\;]/.test(m2![1]), "fallback has no quote/backslash/semicolon");
  assert(/^[\x20-\x7e]*$/.test(m2![1]), "fallback ASCII only");
  assert(decodeURIComponent(m2![2]) === nasty, "filename* decodes to original");

  const th = "รายงานประจำเดือน.pdf";
  const h3 = contentDisposition(th);
  assert(quoted(h3)?.[1] === "file.pdf", "Thai-only falls back to file.pdf");
  assert(quoted(h3)![2] === encodeURIComponent(th), "filename* is RFC 5987 encoding");
  assert(decodeURIComponent(quoted(h3)![2]) === th, "Thai decodes back");

  const sp = "a'b(c)d*e.png";
  const h4 = contentDisposition(sp);
  const enc = quoted(h4)![2];
  assert(!/['()*]/.test(enc), "' ( ) * percent-encoded");
  assert(enc.includes("%27") && enc.includes("%28") && enc.includes("%29") && enc.includes("%2A"), "expected escapes");
  assert(decodeURIComponent(enc) === sp, "special chars round-trip");

  const crlf = "a\r\nSet-Cookie: x=1\r\nb.png";
  const h5 = contentDisposition(crlf);
  assert(!/[\r\n]/.test(h5), "no CR/LF in output");
  assert(/^[\x20-\x7e]*$/.test(h5), "whole header ASCII");

  const noext = contentDisposition("README");
  assert(quoted(noext)?.[1] === "README", "no extension ok");
}

// ---- asanaFileState
{
  assert(asanaFileState({ asanaPushedTaskGid: "1", asanaSyncError: "" }, null) === "none", "no task null");
  assert(asanaFileState({ asanaPushedTaskGid: "1", asanaSyncError: "" }, undefined) === "none", "no task undefined");
  assert(asanaFileState({ asanaPushedTaskGid: "1", asanaSyncError: "" }, "") === "none", "no task empty");
  assert(asanaFileState({ asanaPushedTaskGid: "1", asanaSyncError: "" }, "1") === "sent", "sent");
  assert(asanaFileState({ asanaPushedTaskGid: "1", asanaSyncError: "boom" }, "1") === "sent", "sent wins over stale error");
  assert(asanaFileState({ asanaPushedTaskGid: "1", asanaSyncError: "boom" }, "2") === "error", "error");
  assert(asanaFileState({ asanaPushedTaskGid: "", asanaSyncError: "" }, "2") === "pending", "pending never pushed");
  assert(asanaFileState({ asanaPushedTaskGid: "old", asanaSyncError: "" }, "new") === "pending", "task recreated -> pending");
}

// ---- isSameOriginRequest
{
  assert(isSameOriginRequest({ secFetchSite: "same-origin" }), "same-origin true");
  assert(isSameOriginRequest({ secFetchSite: " Same-Origin " }), "same-origin trimmed/case");
  assert(!isSameOriginRequest({ secFetchSite: "cross-site" }), "cross-site false");
  assert(!isSameOriginRequest({ secFetchSite: "same-site" }), "same-site false");
  assert(!isSameOriginRequest({ secFetchSite: "none" }), "none false");
  assert(!isSameOriginRequest({ secFetchSite: "same-origin-ish" }), "unknown value false");
  assert(!isSameOriginRequest({ secFetchSite: "cross-site", origin: "https://app.example.com", host: "app.example.com" }), "sec-fetch-site wins over matching origin");
  assert(isSameOriginRequest({ origin: "https://App.Example.com", host: "app.example.com" }), "origin = host case-insens");
  assert(isSameOriginRequest({ origin: "https://app.example.com", host: "APP.example.com" }), "host upper-case");
  assert(isSameOriginRequest({ origin: "http://localhost:12123", host: "localhost:12123" }), "port included");
  assert(!isSameOriginRequest({ origin: "https://evil.com", host: "app.example.com" }), "other host false");
  assert(!isSameOriginRequest({ origin: "https://app.example.com.evil.com", host: "app.example.com" }), "suffix host false");
  assert(!isSameOriginRequest({ origin: "not a url", host: "app.example.com" }), "malformed origin false");
  assert(!isSameOriginRequest({ origin: "https://app.example.com" }), "origin without host false");
  assert(!isSameOriginRequest({ origin: "https://app.example.com", host: null }), "origin with null host false");
  assert(isSameOriginRequest({}), "neither header true");
  assert(isSameOriginRequest({ secFetchSite: null, origin: null, host: "x.com" }), "nulls true");
}

// ---- isImageMime / formatBytes
{
  assert(isImageMime("image/png"), "image/png");
  assert(isImageMime(ATTACHMENT_TYPES.webp.mime), "webp is image");
  assert(!isImageMime("application/pdf"), "pdf not image");
  assert(!isImageMime(""), "empty not image");
  assert(formatBytes(0) === "0 B", "0");
  assert(formatBytes(-5) === "0 B", "negative");
  assert(formatBytes(NaN) === "0 B", "NaN");
  assert(formatBytes(512) === "512 B", "512");
  assert(formatBytes(1536) === "1.5 KB", "1536");
  assert(formatBytes(20 * 1024) === "20 KB", "20KB");
  assert(formatBytes(5 * 1024 * 1024) === "5.0 MB", "5MB");
}

// ---- ACCEPT_ATTR
{
  assert(ACCEPT_ATTR.includes(".png"), "accept png");
  assert(ACCEPT_ATTR.includes(".docx"), "accept docx");
  assert(!ACCEPT_ATTR.includes("svg"), "accept no svg");
  assert(!ACCEPT_ATTR.includes("html"), "accept no html");
  assert(!ACCEPT_ATTR.includes(".exe"), "accept no exe");
}

console.log(`${n} passed`);
