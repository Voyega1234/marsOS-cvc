import { fmtCost, fmtThb, fmtUsd, thbToUsd, usdToThb, USD_TO_THB } from "./ai-cost-format";

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

assert(fmtUsd(0) === "$0", "usd zero");
assert(fmtUsd(null) === "$0", "usd null");
assert(fmtUsd(NaN) === "$0", "usd nan");
assert(fmtUsd(0.00005) === "<$0.0001", "usd tiny");
assert(fmtUsd(0.0001) === "$0.0001", "usd 0.0001 boundary");
assert(fmtUsd(0.0038) === "$0.0038", "usd 4 decimals");
assert(fmtUsd(0.5) === "$0.5000", "usd 0.5");
assert(fmtUsd(1) === "$1.00", "usd 1");
assert(fmtUsd(12.4) === "$12.40", "usd 2 decimals");
assert(fmtUsd(99.994) === "$99.99", "usd just under 100");
assert(fmtUsd(100) === "$100", "usd 100");
assert(fmtUsd(1240.4) === "$1,240", "usd thousands");
assert(fmtCost(0) === "$0 (฿0)", "cost zero");
assert(fmtCost(null) === "$0 (฿0)", "cost null");
assert(fmtCost(NaN) === "$0 (฿0)", "cost nan");
assert(fmtCost(0.0038) === "$0.0038 (฿0.13)", "cost small");
assert(fmtCost(1) === "$1.00 (฿33.00)", "cost one dollar");
assert(fmtCost(1240.4) === "$1,240 (฿40,933)", "cost large");

console.log(`ai-cost-format: ${passed} passed`);
