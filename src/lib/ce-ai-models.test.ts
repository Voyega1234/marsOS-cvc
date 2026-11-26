import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CE_MODEL_KINDS,
  EMPTY_CE_AI_MODELS,
  MAX_MODEL_ID_CHARS,
  STUDIO_SCOPE_KEY,
  ceAiModelsSettingKey,
  ceScopeKey,
  isModelIdSyntax,
  isValidScopeKey,
  parseCeAiModels,
  readCeAiModelsInput,
  scopeOwnerId,
} from "./ce-ai-models";

test("CE_MODEL_KINDS includes translate", () => {
  assert.deepEqual([...CE_MODEL_KINDS], ["write", "regenerate", "image", "translate"]);
  assert.deepEqual(Object.keys(EMPTY_CE_AI_MODELS).sort(), [...CE_MODEL_KINDS].sort());
});

test("isValidScopeKey", () => {
  assert.equal(isValidScopeKey("abc123"), true);
  assert.equal(isValidScopeKey("client_1~set-2"), true);
  assert.equal(isValidScopeKey("studio"), true);
  assert.equal(isValidScopeKey(""), false);
  assert.equal(isValidScopeKey("a~b~c"), false);
  assert.equal(isValidScopeKey("a b"), false);
  assert.equal(isValidScopeKey("a".repeat(65)), false);
  assert.equal(isValidScopeKey(42), false);
  assert.equal(isValidScopeKey(null), false);
});

test("ceScopeKey", () => {
  assert.equal(ceScopeKey(null), STUDIO_SCOPE_KEY);
  assert.equal(ceScopeKey(undefined), STUDIO_SCOPE_KEY);
  assert.equal(ceScopeKey("studio"), STUDIO_SCOPE_KEY);
  assert.equal(ceScopeKey("p1"), "p1");
  assert.equal(ceScopeKey({ projectId: "p2" }), "p2");
});

test("scopeOwnerId and ceAiModelsSettingKey", () => {
  assert.equal(scopeOwnerId("client~set"), "client");
  assert.equal(scopeOwnerId("client"), "client");
  assert.equal(ceAiModelsSettingKey("org1", "client~set"), "ce_ai_models:org1:client~set");
});

test("isModelIdSyntax", () => {
  assert.equal(isModelIdSyntax("google/gemini-3.7-flash"), true);
  assert.equal(isModelIdSyntax("openai/gpt-5.6-sol:nitro"), true);
  assert.equal(isModelIdSyntax("nomodel"), false);
  assert.equal(isModelIdSyntax("Vendor/model"), false);
  assert.equal(isModelIdSyntax("a/b c"), false);
  assert.equal(isModelIdSyntax(""), false);
  assert.equal(isModelIdSyntax(5), false);
  assert.equal(isModelIdSyntax("a/" + "b".repeat(MAX_MODEL_ID_CHARS)), false);
});

test("parseCeAiModels: nothing stored, junk, partial", () => {
  assert.deepEqual(parseCeAiModels(null), EMPTY_CE_AI_MODELS);
  assert.deepEqual(parseCeAiModels(undefined), EMPTY_CE_AI_MODELS);
  assert.deepEqual(parseCeAiModels(""), EMPTY_CE_AI_MODELS);
  assert.deepEqual(parseCeAiModels("{not json"), EMPTY_CE_AI_MODELS);
  assert.deepEqual(parseCeAiModels("null"), EMPTY_CE_AI_MODELS);
  assert.deepEqual(parseCeAiModels("42"), EMPTY_CE_AI_MODELS);
  const got = parseCeAiModels(
    JSON.stringify({ write: "openai/gpt-5.6-sol", translate: "google/gemini-3.7-flash", image: "bad id", regenerate: 7, extra: "x/y" }),
  );
  assert.deepEqual(got, { write: "openai/gpt-5.6-sol", regenerate: "", image: "", translate: "google/gemini-3.7-flash" });
  // result is a copy, not the shared constant
  parseCeAiModels(null).write = "x/y";
  assert.equal(EMPTY_CE_AI_MODELS.write, "");
});

const full = { write: "a/b", regenerate: "", image: "c/d", translate: "e/f" };

test("readCeAiModelsInput: accepts valid input without known list", () => {
  const r = readCeAiModelsInput(full, null);
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.value, full);
});

test("readCeAiModelsInput: trims, and empty means default", () => {
  const r = readCeAiModelsInput({ write: "  a/b  ", regenerate: "  ", image: "", translate: "" }, null);
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.value, { write: "a/b", regenerate: "", image: "", translate: "" });
});

test("readCeAiModelsInput: rejects non-object, missing kind (incl. translate), bad syntax", () => {
  for (const bad of [null, undefined, "x", 5]) assert.equal(readCeAiModelsInput(bad, null).ok, false);
  const { translate: _t, ...noTranslate } = full;
  const missing = readCeAiModelsInput(noTranslate, null);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.error, /Translate/);
  assert.equal(readCeAiModelsInput({ ...full, write: 5 }, null).ok, false);
  const syntax = readCeAiModelsInput({ ...full, write: "not a model" }, null);
  assert.equal(syntax.ok, false);
});

test("readCeAiModelsInput: known lists are enforced per kind", () => {
  const known = { text: new Set(["a/b", "e/f"]), image: new Set(["c/d"]) };
  assert.equal(readCeAiModelsInput(full, known).ok, true);
  // unknown text model
  assert.equal(readCeAiModelsInput({ ...full, translate: "x/unknown" }, known).ok, false);
  // text model used for image
  assert.equal(readCeAiModelsInput({ ...full, image: "a/b" }, known).ok, false);
  // image model used for text
  assert.equal(readCeAiModelsInput({ ...full, write: "c/d" }, known).ok, false);
  // empty is still fine
  assert.equal(readCeAiModelsInput({ write: "", regenerate: "", image: "", translate: "" }, known).ok, true);
});
