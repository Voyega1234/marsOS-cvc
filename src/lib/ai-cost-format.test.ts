import { fmtThb, thbToUsd, usdToThb, USD_TO_THB } from "./ai-cost-format";

let passed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  passed++;
}

assert(fmtThb(0) === "฿0", "zero");
assert(fmtThb(null) === "฿0", "null");
assert(fmtThb(NaN) === "฿0", "nan");
assert(fmtThb(0.0001) === "<฿0.01", "tiny");
assert(fmtThb(0.01 / USD_TO_THB) === "฿0.01", "0.01 baht boundary");
assert(fmtThb(1) === "฿33.00", "1 usd");
assert(fmtThb(1 / USD_TO_THB) === "฿1.00", "1 baht");
assert(fmtThb(99.99 / USD_TO_THB) === "฿99.99", "just under 100");
assert(fmtThb(100 / USD_TO_THB) === "฿100", "100 baht");
assert(fmtThb(1000) === "฿33,000", "thousands");
assert(usdToThb(2) === 66, "usdToThb");
assert(usdToThb(Infinity) === 0, "usdToThb inf");
assert(thbToUsd(66) === 2, "thbToUsd");
assert(thbToUsd(NaN) === 0, "thbToUsd nan");

console.log(`ai-cost-format: ${passed} passed`);
