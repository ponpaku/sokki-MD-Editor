const LARGE_DOC_CHAR_THRESHOLD = 25_000;
const HUGE_DOC_CHAR_THRESHOLD = 100_000;
const LARGE_DOC_LINE_THRESHOLD = 600;
const HUGE_DOC_LINE_THRESHOLD = 2_500;

const PREVIEW_DELAY_MS = {
  normal: 90,
  large: 180,
  huge: 420,
};

const HISTORY_LIMIT = {
  normal: 200,
  large: 90,
  huge: 30,
};

const HISTORY_BUDGET = {
  normal: 2_000_000,
  large: 1_200_000,
  huge: 700_000,
};

const COALESCE_WINDOW_MS = {
  normal: 600,
  large: 900,
  huge: 1_200,
};

export function classifyDocumentSize(text, lineCount = null) {
  const safeText = typeof text === "string" ? text : "";
  const safeLineCount = Number.isFinite(lineCount)
    ? lineCount
    : safeText.length === 0
      ? 1
      : safeText.split("\n").length;

  if (safeText.length >= HUGE_DOC_CHAR_THRESHOLD || safeLineCount >= HUGE_DOC_LINE_THRESHOLD) {
    return "huge";
  }
  if (safeText.length >= LARGE_DOC_CHAR_THRESHOLD || safeLineCount >= LARGE_DOC_LINE_THRESHOLD) {
    return "large";
  }
  return "normal";
}

export function getPreviewDelayMs(size) {
  return PREVIEW_DELAY_MS[size] ?? PREVIEW_DELAY_MS.normal;
}

export function getTypingPreviewSyncSource(size) {
  return size === "huge" ? "none" : "editor";
}

export function getHistoryLimit(size) {
  return HISTORY_LIMIT[size] ?? HISTORY_LIMIT.normal;
}

export function getHistoryBudget(size) {
  return HISTORY_BUDGET[size] ?? HISTORY_BUDGET.normal;
}

export function getNativeEditCoalesceWindowMs(size) {
  return COALESCE_WINDOW_MS[size] ?? COALESCE_WINDOW_MS.normal;
}

export function estimateSnapshotSize(snapshot) {
  if (!snapshot || typeof snapshot.value !== "string") return 0;
  return snapshot.value.length + 24;
}

export function trimHistoryStack(stack, referenceText) {
  if (!Array.isArray(stack) || stack.length === 0) return stack;

  const size = classifyDocumentSize(referenceText);
  const limit = getHistoryLimit(size);
  const budget = getHistoryBudget(size);

  while (stack.length > limit) {
    stack.shift();
  }

  let total = stack.reduce((sum, snapshot) => sum + estimateSnapshotSize(snapshot), 0);
  while (stack.length > 1 && total > budget) {
    total -= estimateSnapshotSize(stack[0]);
    stack.shift();
  }

  return stack;
}
