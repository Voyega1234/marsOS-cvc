/** Run: npx tsx src/lib/backlink-management/project-logos.test.ts */
import assert from "node:assert/strict";
import { normName } from "./sheet-import";
import { buildLogoIndex, faviconUrl, logoFor } from "./project-logos";

let n = 0;
function t(name: string, fn: () => void) { fn(); n++; console.log("ok -", name); }

const PNG = "data:image/png;base64,AAAA";

t("faviconUrl takes the hostname without www and rejects junk", () => {
  assert.equal(faviconUrl("https://www.suntory.co.th/th/about"), "https://www.google.com/s2/favicons?domain=suntory.co.th&sz=64");
  assert.equal(faviconUrl("amway.co.th"), "https://www.google.com/s2/favicons?domain=amway.co.th&sz=64");
  assert.equal(faviconUrl(""), null);
  assert.equal(faviconUrl("not a site"), null);
  assert.equal(faviconUrl("localhost"), null);
});

t("uploaded logo wins over favicon, invalid data URIs are ignored", () => {
  const idx = buildLogoIndex([
    { projectId: "p1", names: ["Suntory"], logo: null, website: "suntory.co.th" },
    { names: ["Suntory"], logo: PNG, website: "" },
    { projectId: "p2", names: ["Evil"], logo: "data:image/svg+xml;base64,AAAA", website: "" },
  ]);
  assert.equal(idx.byProject.p1, PNG);
  assert.equal(idx.byName.suntory, PNG);
  assert.equal(idx.byProject.p2, undefined);
});

t("manual project with no logo or website gets one through its name", () => {
  const idx = buildLogoIndex([
    { projectId: "sys", names: ["Amway Thailand", "Amway"], logo: null, website: "https://www.amway.co.th" },
    { projectId: "man", names: ["Amway"], logo: null, website: null },
  ]);
  assert.equal(idx.byProject.man, "https://www.google.com/s2/favicons?domain=amway.co.th&sz=64");
});

t("logoFor prefers the linked project, then sheet names", () => {
  const idx = { byProject: { p1: "A" }, byName: { kni: "B" } };
  assert.equal(logoFor(idx, "p1", ["KNI"]), "A");
  assert.equal(logoFor(idx, null, ["", "K N I"]), "B");
  assert.equal(logoFor(idx, "nope", ["zzz"]), null);
  assert.equal(logoFor(null, "p1", []), null);
});

t("stored logo beats upload and reaches a manual project by name", () => {
  const A = "data:image/webp;base64,AAAA";
  const B = "data:image/webp;base64,BBBB";
  const idx = buildLogoIndex([
    { names: ["Acme"], logo: A },
    { names: ["Acme"], logo: B },
    { projectId: "m1", names: ["Acme"] },
  ]);
  assert.equal(idx.byProject.m1, A);
  assert.equal(idx.byName[normName("Acme")], A);
});

t("stored source carrying projectId with a different name still gives byProject", () => {
  const A = "data:image/webp;base64,AAAA";
  const idx = buildLogoIndex([{ projectId: "m1", names: ["Renamed Co"], logo: A }]);
  assert.equal(idx.byProject.m1, A);
});

console.log(`\n${n} tests passed`);
