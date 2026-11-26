import { test } from "node:test";
import assert from "node:assert/strict";
import { REQUIRED_IMAGE_RATIOS, toImageModelOptions, toTextModelOptions } from "./openrouter-models";

const textRow = (over: Record<string, unknown> = {}) => ({
  id: "vendor/model-a",
  name: "Model A",
  context_length: 128000,
  architecture: { output_modalities: ["text"] },
  pricing: { prompt: "0.000004", completion: "0.00002" },
  top_provider: { max_completion_tokens: 16384 },
  ...over,
});

test("toTextModelOptions: maps fields and converts prices per million", () => {
  const [m] = toTextModelOptions({ data: [textRow()] });
  assert.deepEqual(m, {
    id: "vendor/model-a",
    name: "Model A",
    contextLength: 128000,
    maxOutput: 16384,
    promptPerM: 4,
    completionPerM: 20,
  });
});

test("toTextModelOptions: text-only output filter", () => {
  const out = toTextModelOptions({
    data: [
      textRow({ id: "v/text" }),
      textRow({ id: "v/multi", architecture: { output_modalities: ["text", "image"] } }),
      textRow({ id: "v/audio", architecture: { output_modalities: ["audio"] } }),
      textRow({ id: "v/none", architecture: {} }),
    ],
  });
  assert.deepEqual(out.map((m) => m.id), ["v/text"]);
});

test("toTextModelOptions: malformed input", () => {
  assert.deepEqual(toTextModelOptions(null), []);
  assert.deepEqual(toTextModelOptions("x"), []);
  assert.deepEqual(toTextModelOptions({}), []);
  assert.deepEqual(toTextModelOptions({ data: "nope" }), []);
  assert.deepEqual(toTextModelOptions([textRow()]), []);
  const out = toTextModelOptions({
    data: [null, 5, "s", [], textRow({ id: "" }), textRow({ id: 7 }), textRow({ id: "v/ok", name: 3, context_length: -1, pricing: { prompt: "abc", completion: -1 }, top_provider: null })],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "v/ok");
  assert.equal(out[0].name, "v/ok");
  assert.equal(out[0].contextLength, undefined);
  assert.equal(out[0].maxOutput, undefined);
  assert.equal(out[0].promptPerM, undefined);
  assert.equal(out[0].completionPerM, undefined);
});

test("toTextModelOptions: free price is 0, sorted by name case-insensitively", () => {
  const out = toTextModelOptions({
    data: [
      textRow({ id: "v/z", name: "zeta", pricing: { prompt: "0", completion: 0 } }),
      textRow({ id: "v/a", name: "Alpha" }),
      textRow({ id: "v/b", name: "beta" }),
    ],
  });
  assert.deepEqual(out.map((m) => m.name), ["Alpha", "beta", "zeta"]);
  assert.equal(out[2].promptPerM, 0);
  assert.equal(out[2].completionPerM, 0);
});

const imageRow = (over: Record<string, unknown> = {}) => ({
  id: "img/model-a",
  name: "Img A",
  architecture: { output_modalities: ["image"], input_modalities: ["text", "image"] },
  supported_parameters: { aspect_ratio: { values: ["1:1", "3:2", "2:3", "16:9"] } },
  ...over,
});

test("toImageModelOptions: required ratios", () => {
  assert.deepEqual([...REQUIRED_IMAGE_RATIOS], ["1:1", "3:2", "2:3"]);
  const out = toImageModelOptions({
    data: [
      imageRow({ id: "img/ok" }),
      imageRow({ id: "img/no-23", supported_parameters: { aspect_ratio: { values: ["1:1", "3:2"] } } }),
      imageRow({ id: "img/no-params", supported_parameters: undefined }),
      imageRow({ id: "img/bad-params", supported_parameters: { aspect_ratio: "1:1" } }),
    ],
  });
  assert.deepEqual(out.map((m) => m.id), ["img/ok"]);
});

test("toImageModelOptions: output must include image; imageInput flag", () => {
  const out = toImageModelOptions({
    data: [
      imageRow({ id: "img/text-only", architecture: { output_modalities: ["text"] } }),
      imageRow({ id: "img/with-ref" }),
      imageRow({ id: "img/no-ref", architecture: { output_modalities: ["image"], input_modalities: ["text"] } }),
      imageRow({ id: "img/no-input", architecture: { output_modalities: ["image"] } }),
    ],
  });
  const byId = new Map(out.map((m) => [m.id, m]));
  assert.equal(byId.has("img/text-only"), false);
  assert.equal(byId.get("img/with-ref")?.imageInput, true);
  assert.equal(byId.get("img/no-ref")?.imageInput, false);
  assert.equal(byId.get("img/no-input")?.imageInput, false);
});

test("toImageModelOptions: malformed entries, name fallback, sorting", () => {
  assert.deepEqual(toImageModelOptions(undefined), []);
  assert.deepEqual(toImageModelOptions({ data: [null, 1, imageRow({ id: "" })] }), []);
  const out = toImageModelOptions({ data: [imageRow({ id: "img/b", name: "" }), imageRow({ id: "img/a", name: "Aaa" })] });
  assert.deepEqual(out.map((m) => m.name), ["Aaa", "img/b"]);
});
