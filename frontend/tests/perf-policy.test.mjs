import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyDocumentSize,
  getHistoryBudget,
  getHistoryLimit,
  getNativeEditCoalesceWindowMs,
  getPreviewDelayMs,
  getTypingPreviewSyncSource,
  trimHistoryStack,
} from "../src/perf-policy.js";

test("classifyDocumentSize escalates from normal to large to huge", () => {
  assert.equal(classifyDocumentSize("short", 1), "normal");
  assert.equal(classifyDocumentSize("x".repeat(30_000), 100), "large");
  assert.equal(classifyDocumentSize("x".repeat(120_000), 100), "huge");
  assert.equal(classifyDocumentSize("line\n".repeat(3_000), 3_000), "huge");
});

test("preview and history policies become more conservative for larger documents", () => {
  assert.ok(getPreviewDelayMs("large") > getPreviewDelayMs("normal"));
  assert.ok(getPreviewDelayMs("huge") > getPreviewDelayMs("large"));
  assert.equal(getTypingPreviewSyncSource("huge"), "none");
  assert.ok(getHistoryLimit("large") < getHistoryLimit("normal"));
  assert.ok(getHistoryBudget("huge") < getHistoryBudget("large"));
  assert.ok(getNativeEditCoalesceWindowMs("huge") > getNativeEditCoalesceWindowMs("normal"));
});

test("trimHistoryStack bounds snapshot count and memory budget", () => {
  const stack = Array.from({ length: 80 }, (_, index) => ({
    value: `${index}-${"x".repeat(20_000)}`,
    start: index,
    end: index,
  }));

  trimHistoryStack(stack, "y".repeat(120_000));

  assert.ok(stack.length <= getHistoryLimit("huge"));
  const total = stack.reduce((sum, snapshot) => sum + snapshot.value.length + 24, 0);
  assert.ok(total <= getHistoryBudget("huge"));
});
