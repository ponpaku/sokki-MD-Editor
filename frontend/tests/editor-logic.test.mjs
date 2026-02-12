import test from "node:test";
import assert from "node:assert/strict";
import {
  findListContext,
  findParentListItem,
  findPreviousOrderedNumberAtIndent,
  getTableCellRanges,
  isEmptyTableRow,
  normalizeListIndentWidth,
  parseListLine,
  resolveTableTabTarget,
  shouldCoalesceNativeEdit,
} from "../src/editor-logic.js";

test("findListContext resolves <br> continuation list marker", () => {
  const value = "- parent\n    - child<br>\ncontinued";
  const match = findListContext(value, value.length);
  assert.ok(match);
  assert.equal(match[1], "    ");
  assert.equal(match[2], "-");
});

test("findListContext does not treat normal line as continuation", () => {
  const value = "- parent\nnormal line";
  const match = findListContext(value, value.length);
  assert.equal(match, null);
});

test("findParentListItem keeps parent lookup within current block", () => {
  const value = "- parent\n    note\n    - ";
  const match = findParentListItem(value, value.length, 4);
  assert.ok(match);
  assert.equal(match[0], "- ");
});

test("findParentListItem stops at blank line boundary", () => {
  const value = "- parent\n\n    - ";
  const match = findParentListItem(value, value.length, 4);
  assert.equal(match, null);
});

test("ordered numbering restarts when parent context changed", () => {
  const lines = [
    "- root",
    "    - child-a",
    "        1. one",
    "        2. two",
    "    - child-b",
    "        - move-target",
  ];
  const prev = findPreviousOrderedNumberAtIndent(lines, 5, 8, 5, 6);
  assert.equal(prev, null);
});

test("ordered numbering continues within same parent context", () => {
  const lines = [
    "- root",
    "    - child-a",
    "        1. one",
    "        2. two",
    "        - move-target",
  ];
  const prev = findPreviousOrderedNumberAtIndent(lines, 4, 8, 4, 5);
  assert.equal(prev, 2);
});

test("table helpers detect cell ranges and empty rows", () => {
  const ranges = getTableCellRanges("| a | b |");
  assert.equal(ranges.length, 2);
  assert.deepEqual(ranges[0], { start: 1, end: 4 });
  assert.deepEqual(ranges[1], { start: 5, end: 8 });
  assert.equal(isEmptyTableRow("|   |   |"), true);
  assert.equal(isEmptyTableRow("| a |   |"), false);
});

test("list helpers parse marker and normalize indent", () => {
  const parsed = parseListLine("\t- [x] task");
  assert.ok(parsed);
  assert.equal(parsed.type, "task");
  assert.equal(parsed.checked, true);
  assert.equal(normalizeListIndentWidth("\t "), 4);
});

test("native coalescing applies only to matching input type within window", () => {
  const group = { inputType: "insertText", lastAt: 1000 };
  assert.equal(shouldCoalesceNativeEdit(group, "insertText", 300), true);
  assert.equal(shouldCoalesceNativeEdit(group, "deleteContentBackward", 300), false);
  assert.equal(shouldCoalesceNativeEdit(group, "insertFromPaste", 300), false);
  assert.equal(shouldCoalesceNativeEdit(group, "insertText", 900), false);
});

test("table tab target resolves row/cell movement and edge behavior", () => {
  const rows = [3, 3];
  assert.deepEqual(resolveTableTabTarget(rows, 0, 0, false), { rowIndex: 0, cellIndex: 1 });
  assert.deepEqual(resolveTableTabTarget(rows, 0, 2, false), { rowIndex: 1, cellIndex: 0 });
  assert.deepEqual(resolveTableTabTarget(rows, 1, 0, true), { rowIndex: 0, cellIndex: 2 });
  assert.deepEqual(resolveTableTabTarget(rows, 0, 0, true), { rowIndex: 0, cellIndex: 0 });
  assert.deepEqual(resolveTableTabTarget(rows, 1, 2, false), { rowIndex: 1, cellIndex: 2 });
});
