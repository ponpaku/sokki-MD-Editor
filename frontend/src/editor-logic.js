const LIST_REGEX = /^(\s*)([-*](?:\s\[[ xX]\])?|\d+\.)\s/;
const LIST_LINE_REGEX = /^(\s*)([-*](?:\s\[[ xX]\])?|\d+\.)\s(.*)$/;
const COALESCIBLE_INPUT_TYPES = new Set([
  "insertText",
  "deleteContentBackward",
  "deleteContentForward",
]);

export function parseListLine(line) {
  const match = line.match(LIST_LINE_REGEX);
  if (!match) return null;
  const marker = match[2];
  const orderedMatch = marker.match(/^(\d+)\.$/);
  const taskMatch = marker.match(/^([-*])\s\[([ xX])\]$/);
  return {
    indentLen: match[1].length,
    marker,
    content: match[3],
    type: /^\d+\.$/.test(marker) ? "ordered" : taskMatch ? "task" : "bullet",
    orderedNumber: orderedMatch ? parseInt(orderedMatch[1], 10) : null,
    bulletChar: marker[0],
    checked: taskMatch ? taskMatch[2].toLowerCase() === "x" : false,
  };
}

export function normalizeListIndentWidth(rawIndent) {
  const expanded = rawIndent.replace(/\t/g, "    ");
  return Math.max(0, Math.round(expanded.length / 4) * 4);
}

export function findListContext(value, cursorPos) {
  const textBefore = value.substring(0, cursorPos);
  const lines = textBefore.split("\n");

  for (let i = lines.length - 2; i >= 0; i--) {
    const line = lines[i];
    if (!line.trimEnd().endsWith("<br>")) return null;
    const match = line.match(LIST_REGEX);
    if (match) return match;
  }
  return null;
}

export function findParentListItem(value, cursorPos, currentIndentLen) {
  const textBefore = value.substring(0, cursorPos);
  const lines = textBefore.split("\n");

  for (let i = lines.length - 2; i >= 0; i--) {
    const line = lines[i];
    if (line.trim().length === 0) break;
    const match = line.match(LIST_REGEX);
    if (match && match[1].length < currentIndentLen) {
      return match;
    }
    if (match) continue;
    const continuationIndent = line.match(/^(\s*)/)[1].length;
    if (continuationIndent >= currentIndentLen) continue;
    if (line.trimEnd().endsWith("<br>")) continue;
    break;
  }
  return null;
}

export function findPreviousOrderedNumberAtIndent(
  fullLines,
  lineIndex,
  targetIndentLen,
  excludedStart,
  excludedEnd,
) {
  let blockStart = lineIndex;
  while (blockStart > 0 && fullLines[blockStart - 1].trim().length > 0) {
    blockStart--;
  }
  for (let i = lineIndex - 1; i >= blockStart; i--) {
    if (i >= excludedStart && i < excludedEnd) continue;
    const parsed = parseListLine(fullLines[i]);
    if (!parsed) continue;
    if (parsed.indentLen < targetIndentLen) break;
    if (parsed.indentLen !== targetIndentLen || parsed.type !== "ordered") continue;
    return parsed.orderedNumber;
  }
  return null;
}

export function getTableCellRanges(line) {
  const pipePositions = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "|") pipePositions.push(i);
  }
  if (pipePositions.length < 2) return [];
  const ranges = [];
  for (let i = 0; i < pipePositions.length - 1; i++) {
    ranges.push({
      start: pipePositions[i] + 1,
      end: pipePositions[i + 1],
    });
  }
  return ranges;
}

export function isEmptyTableRow(line) {
  const pipeCount = (line.match(/\|/g) || []).length;
  return pipeCount >= 2 && line.replace(/\|/g, "").trim().length === 0;
}

export function isCoalescibleNativeEditType(inputType) {
  return COALESCIBLE_INPUT_TYPES.has(inputType);
}

export function shouldCoalesceNativeEdit(previousGroup, inputType, deltaMs) {
  return (
    !!previousGroup &&
    previousGroup.inputType === inputType &&
    isCoalescibleNativeEditType(inputType) &&
    deltaMs <= 600
  );
}

export function resolveTableTabTarget(rows, rowIndex, cellIndex, shiftKey) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const safeRow = Math.max(0, Math.min(rowIndex, rows.length - 1));
  const rowCells = Math.max(1, rows[safeRow]);
  let targetRow = safeRow;
  let targetCell = cellIndex + (shiftKey ? -1 : 1);

  if (shiftKey && targetCell < 0) {
    if (safeRow > 0) {
      targetRow = safeRow - 1;
      targetCell = Math.max(0, rows[targetRow] - 1);
    } else {
      targetCell = 0;
    }
  } else if (!shiftKey && targetCell >= rowCells) {
    if (safeRow < rows.length - 1) {
      targetRow = safeRow + 1;
      targetCell = 0;
    } else {
      targetCell = rowCells - 1;
    }
  }

  return { rowIndex: targetRow, cellIndex: targetCell };
}
