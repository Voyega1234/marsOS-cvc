/** Run: npx tsx src/lib/backlink-management/safe-fetch.test.ts */
import assert from "node:assert/strict";
import { isBlockedAddress, safeFetchHtml } from "./safe-fetch";

let n = 0;
async function t(name: string, fn: () => void | Promise<void>) { await fn(); n++; console.log("ok -", name); }

(async () => {
  await t("blocked IPv4", () => {
    for (const ip of ["0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.5.5", "172.31.255.1", "192.0.0.1", "192.168.1.1", "198.18.0.1", "224.0.0.1", "240.0.0.1", "255.255.255.255"]) {
      assert.equal(isBlockedAddress(ip), true, ip);
    }
  });
  await t("blocked IPv6", () => {
    for (const ip of ["::", "::1", "fc00::1", "fd12::1", "fe80::1", "ff02::1"]) assert.equal(isBlockedAddress(ip), true, ip);
  });
  await t("embedded IPv4", () => {
    for (const ip of ["::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "64:ff9b::7f00:1", "64:ff9b::a9fe:a9fe", "2002:7f00:1::1"]) assert.equal(isBlockedAddress(ip), true, ip);
    assert.equal(isBlockedAddress("::ffff:8.8.8.8"), false);
    assert.equal(isBlockedAddress("2002:808:808::1"), false);
  });
  await t("public allowed", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "2606:4700:4700::1111"]) assert.equal(isBlockedAddress(ip), false, ip);
  });
  await t("garbage blocked", () => assert.equal(isBlockedAddress("not-an-ip"), true));
  await t("safeFetchHtml blocks without network", async () => {
    for (const u of ["http://127.0.0.1/", "http://localhost/", "ftp://x", "http://user:pw@example.com", "http://[::1]/", "http://169.254.169.254/latest", "http://example.com:8080/"]) {
      const r = await safeFetchHtml(u);
      assert.equal(r.ok, false, u);
      if (!r.ok) assert.equal(r.reason, "BLOCKED", u);
    }
  });
  console.log(`${n} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
