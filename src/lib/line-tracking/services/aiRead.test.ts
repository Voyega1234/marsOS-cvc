import { test } from "node:test";
import assert from "node:assert/strict";
import { ocrModel, OCR_MODEL_DEFAULT } from "./aiRead";

test("ocrModel: Gemini when nothing is configured", () => {
  assert.equal(ocrModel({}), OCR_MODEL_DEFAULT);
  assert.match(OCR_MODEL_DEFAULT, /^google\/gemini-/);
});

test("ocrModel: does not follow the MarsOS default model", () => {
  assert.equal(ocrModel({ OPENROUTER_MODEL_DEFAULT: "openai/gpt-5.6-sol" }), OCR_MODEL_DEFAULT);
});

test("ocrModel: LINE_TRACKING_OCR_MODEL may name another Gemini model", () => {
  assert.equal(ocrModel({ LINE_TRACKING_OCR_MODEL: " google/gemini-3.7-pro " }), "google/gemini-3.7-pro");
});

test("ocrModel: a model that is not Gemini is ignored", () => {
  assert.equal(ocrModel({ LINE_TRACKING_OCR_MODEL: "openai/gpt-5.6-sol" }), OCR_MODEL_DEFAULT);
  assert.equal(ocrModel({ LINE_TRACKING_OCR_MODEL: "gemini-3.5-flash" }), OCR_MODEL_DEFAULT);
  assert.equal(ocrModel({ LINE_TRACKING_OCR_MODEL: "   " }), OCR_MODEL_DEFAULT);
});
