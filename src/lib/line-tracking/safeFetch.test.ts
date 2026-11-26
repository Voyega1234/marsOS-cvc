import { test } from "node:test";
import assert from "node:assert/strict";
import { isBlockedAddress, safeFetch, SafeFetchError } from "./safeFetch";

test("blocks private, loopback, link-local and metadata IPv4 addresses", () => {
  for (const ip of [
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1",
    "169.254.169.254", "0.0.0.0", "100.64.0.1", "224.0.0.1", "255.255.255.255",
  ]) {
    assert.equal(isBlockedAddress(ip, 4), true, ip);
  }
});

test("allows public IPv4 addresses", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "93.184.216.34"]) {
    assert.equal(isBlockedAddress(ip, 4), false, ip);
  }
});

test("blocks loopback, unspecified, unique-local, link-local and multicast IPv6", () => {
  for (const ip of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "2001:db8::1", "100::1"]) {
    assert.equal(isBlockedAddress(ip, 6), true, ip);
  }
});

test("blocks IPv4-mapped IPv6 pointing at blocked IPv4, allows mapped public", () => {
  assert.equal(isBlockedAddress("::ffff:127.0.0.1", 6), true);
  assert.equal(isBlockedAddress("::ffff:169.254.169.254", 6), true);
  assert.equal(isBlockedAddress("::ffff:a9fe:a9fe", 6), true); // hex form of 169.254.169.254
  assert.equal(isBlockedAddress("::ffff:10.0.0.1", 6), true);
  assert.equal(isBlockedAddress("::ffff:8.8.8.8", 6), false);
});

test("allows public IPv6", () => {
  assert.equal(isBlockedAddress("2606:4700:4700::1111", 6), false);
  assert.equal(isBlockedAddress("2001:4860:4860::8888", 6), false);
});

test("safeFetch refuses literal internal addresses before connecting", async () => {
  for (const url of [
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://0.0.0.0/",
  ]) {
    await assert.rejects(() => safeFetch(url, { timeoutMs: 1000 }), SafeFetchError, url);
  }
});

test("safeFetch refuses non-http schemes and malformed URLs", async () => {
  await assert.rejects(() => safeFetch("file:///etc/passwd"), SafeFetchError);
  await assert.rejects(() => safeFetch("ftp://example.com/"), SafeFetchError);
  await assert.rejects(() => safeFetch("not a url"), SafeFetchError);
});
