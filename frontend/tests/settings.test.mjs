import test from "node:test";
import assert from "node:assert/strict";

import { getDefaultSettings, normalizeSettings } from "../src/settings.js";

test("normalizeSettings clamps font size and falls back invalid values", () => {
  const settings = normalizeSettings({
    fontSize: 99,
    displayFont: "",
    uiLanguage: "fr",
    showLineNumbers: "yes",
    lineWrapping: false,
  });

  const defaults = getDefaultSettings();
  assert.equal(settings.fontSize, 28);
  assert.equal(settings.displayFont, defaults.displayFont);
  assert.equal(settings.uiLanguage, defaults.uiLanguage);
  assert.equal(settings.showLineNumbers, true);
  assert.equal(settings.lineWrapping, false);
});

test("normalizeSettings accepts supported values as-is", () => {
  const settings = normalizeSettings({
    fontSize: 14,
    displayFont: "Yu Gothic UI",
    uiLanguage: "ja",
    showLineNumbers: false,
    lineWrapping: true,
  });

  assert.deepEqual(settings, {
    fontSize: 14,
    displayFont: "Yu Gothic UI",
    uiLanguage: "ja",
    showLineNumbers: false,
    lineWrapping: true,
  });
});
