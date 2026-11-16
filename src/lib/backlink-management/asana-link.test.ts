/** Run: npx tsx src/lib/backlink-management/asana-link.test.ts */
import assert from "node:assert/strict";
import { asanaProjectGidFromInput as g } from "./asana-link";
let n = 0;
function t(name: string, fn: () => void) { fn(); n++; console.log("ok -", name); }

t("ลิงก์รูปแบบใหม่", () => assert.equal(g("https://app.asana.com/1/1199999999999999/project/1208888888888888/list/1207777777777777"), "1208888888888888"));
t("ลิงก์รูปแบบเก่า", () => assert.equal(g("https://app.asana.com/0/1208888888888888/1207777777777777"), "1208888888888888"));
t("gid ตรง ๆ มีช่องว่างรอบ", () => assert.equal(g("  1208888888888888  "), "1208888888888888"));
t("ข้อความว่าง", () => assert.equal(g(""), ""));
t("ข้อความทั่วไป", () => assert.equal(g("hello world"), ""));
t("เลขสั้น", () => assert.equal(g("1234"), ""));
t("URL ที่ไม่ใช่ Asana", () => assert.equal(g("https://example.com/0/1208888888888888"), ""));
t("host ปลอมใน path ถูกปฏิเสธ", () => assert.equal(g("https://evil.example/app.asana.com/0/1208888888888888"), ""));
t("host ปลอมแบบ subdomain ถูกปฏิเสธ", () => assert.equal(g("https://app.asana.com.evil.example/0/1208888888888888/1"), ""));
t("/0/0/list ถูกปฏิเสธ", () => assert.equal(g("https://app.asana.com/0/0/list"), ""));
t("ลิงก์ไม่มี scheme", () => assert.equal(g("app.asana.com/0/1208888888888888/1207777777777777"), "1208888888888888"));
t("scheme แปลกถูกปฏิเสธ", () => assert.equal(g("ftp://app.asana.com/0/1208888888888888"), ""));

console.log(`${n} passed`);
