function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function measureElementWithin(container, element) {
  const containerRect = container.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  const top = rect.top - containerRect.top + container.scrollTop;
  const bottom = rect.bottom - containerRect.top + container.scrollTop;
  return {
    top,
    bottom,
    height: Math.max(1, bottom - top),
  };
}

function buildPreviewMap(preview) {
  const elements = Array.from(preview.querySelectorAll("[data-sync-id]"));
  const byId = new Map();
  const indexById = new Map();
  const ordered = [];
  for (const element of elements) {
    const id = element.dataset.syncId;
    const from = Number(element.dataset.srcFrom);
    const to = Number(element.dataset.srcTo);
    const kind = element.dataset.syncKind || "";
    if (!id || !Number.isFinite(from) || !Number.isFinite(to)) continue;
    const item = { id, from, to, kind, element };
    ordered.push(item);
    byId.set(id, item);
  }
  ordered.sort((a, b) => a.from - b.from || a.to - b.to);
  ordered.forEach((item, index) => {
    indexById.set(item.id, index);
  });
  return { ordered, byId, indexById };
}

function findNearestSegmentIndex(segments, pos) {
  if (!segments.length) return null;
  let low = 0;
  let high = segments.length - 1;
  let bestIndex = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const segment = segments[mid];
    if (pos < segment.from) {
      bestIndex = mid;
      high = mid - 1;
      continue;
    }
    if (pos > segment.to) {
      bestIndex = mid;
      low = mid + 1;
      continue;
    }
    return mid;
  }

  return bestIndex;
}

function getTableWindow(items, index) {
  const current = items[index];
  if (!current) return null;
  if (current.kind !== "table_row") {
    return { startIndex: index, endIndex: index };
  }
  let startIndex = index;
  let endIndex = index;
  while (startIndex > 0 && items[startIndex - 1]?.kind === "table_row") {
    startIndex--;
  }
  while (endIndex < items.length - 1 && items[endIndex + 1]?.kind === "table_row") {
    endIndex++;
  }
  return { startIndex, endIndex };
}

function measurePreviewWindow(preview, items, window) {
  const first = items[window.startIndex];
  const last = items[window.endIndex];
  if (!first || !last) return null;
  const firstMeasure = measureElementWithin(preview, first.element);
  const lastMeasure = measureElementWithin(preview, last.element);
  return {
    top: firstMeasure.top,
    bottom: lastMeasure.bottom,
    height: Math.max(1, lastMeasure.bottom - firstMeasure.top),
  };
}

function getEditorWindowY(editor, segments, window) {
  const first = segments[window.startIndex];
  const last = segments[window.endIndex];
  if (!first || !last) return null;
  const startY = editor.posToY(first.from, 1);
  const endY = editor.posToY(last.to, -1);
  if (startY == null && endY == null) return null;
  const safeStart = startY ?? endY ?? 0;
  const safeEnd = endY ?? safeStart + 1;
  return {
    start: safeStart,
    end: Math.max(safeStart + 1, safeEnd),
    height: Math.max(1, safeEnd - safeStart),
  };
}

function getEditorSegmentY(editor, segment) {
  const startY = editor.posToY(segment.from, 1);
  let endY = editor.posToY(segment.to, -1);
  if (startY == null && endY == null) return null;
  const safeStart = startY ?? endY ?? 0;
  const safeEnd = endY ?? safeStart + 1;
  return {
    start: safeStart,
    end: Math.max(safeStart + 1, safeEnd),
    height: Math.max(1, safeEnd - safeStart),
  };
}

function normalizeScrollTop(pane, value) {
  const maxScrollTop = Math.max(0, pane.scrollHeight - pane.clientHeight);
  return clamp(Math.round(value), 0, maxScrollTop);
}

function shouldApplyScroll(currentTop, nextTop) {
  return Math.abs(Math.round(currentTop) - Math.round(nextTop)) >= 2;
}

export function createScrollSync({ editor, preview, getSegments }) {
  let activePane = "editor";
  let ignoredPane = null;
  let previewMap = buildPreviewMap(preview);
  let pendingEditorFrame = 0;
  let pendingPreviewFrame = 0;
  let pendingEditorMode = "scroll";
  const paneAnimations = {
    editor: { frame: 0, startTop: 0, targetTop: 0, startedAt: 0, duration: 0 },
    preview: { frame: 0, startTop: 0, targetTop: 0, startedAt: 0, duration: 0 },
  };

  function setPaneScrollTop(pane, value) {
    if (pane === "editor") {
      editor.scrollTop = value;
    } else {
      preview.scrollTop = value;
    }
  }

  function getPaneScrollTop(pane) {
    return pane === "editor" ? editor.scrollTop : preview.scrollTop;
  }

  function clearIgnoredPane(pane) {
    if (ignoredPane === pane) {
      ignoredPane = null;
    }
  }

  function stopPaneAnimation(pane) {
    const animation = paneAnimations[pane];
    if (animation.frame) {
      cancelAnimationFrame(animation.frame);
      animation.frame = 0;
    }
  }

  function setPaneScrollImmediate(pane, nextTop) {
    const targetPane = pane === "editor" ? editor : preview;
    const normalizedTop = normalizeScrollTop(targetPane, nextTop);
    stopPaneAnimation(pane);
    if (!shouldApplyScroll(getPaneScrollTop(pane), normalizedTop)) {
      clearIgnoredPane(pane);
      return;
    }
    ignoredPane = pane;
    setPaneScrollTop(pane, normalizedTop);
    requestAnimationFrame(() => {
      clearIgnoredPane(pane);
    });
  }

  function animatePaneScroll(pane, nextTop, duration = 140) {
    const targetPane = pane === "editor" ? editor : preview;
    const normalizedTop = normalizeScrollTop(targetPane, nextTop);
    if (!shouldApplyScroll(getPaneScrollTop(pane), normalizedTop)) {
      stopPaneAnimation(pane);
      clearIgnoredPane(pane);
      return;
    }

    const animation = paneAnimations[pane];
    stopPaneAnimation(pane);
    animation.startTop = getPaneScrollTop(pane);
    animation.targetTop = normalizedTop;
    animation.startedAt = performance.now();
    animation.duration = duration;
    ignoredPane = pane;

    const step = (now) => {
      const elapsed = now - animation.startedAt;
      const progress = clamp(elapsed / animation.duration, 0, 1);
      const eased = 1 - (1 - progress) * (1 - progress);
      const nextValue = animation.startTop + (animation.targetTop - animation.startTop) * eased;
      setPaneScrollTop(pane, normalizeScrollTop(targetPane, nextValue));

      if (progress >= 1) {
        animation.frame = 0;
        requestAnimationFrame(() => {
          clearIgnoredPane(pane);
        });
        return;
      }

      animation.frame = requestAnimationFrame(step);
    };

    animation.frame = requestAnimationFrame(step);
  }

  function setActivePane(nextPane) {
    activePane = nextPane;
    stopPaneAnimation(nextPane);
    clearIgnoredPane(nextPane);
  }

  function refreshPreviewMap() {
    previewMap = buildPreviewMap(preview);
  }

  function syncEditorToPreview(mode = "scroll") {
    const segments = getSegments();
    if (!segments.length) return;

    const selectionPos = editor.selectionEnd;
    const useSelectionAnchor = mode === "selection" && editor.isPosVisible(selectionPos);
    const anchorPos = useSelectionAnchor
      ? selectionPos
      : editor.posAtViewportY(editor.clientHeight / 2);
    const segmentIndex = findNearestSegmentIndex(segments, anchorPos);
    if (segmentIndex == null) return;
    const segment = segments[segmentIndex];
    const previewIndex = previewMap.indexById.get(segment?.id);
    if (!segment || previewIndex == null) return;

    const segmentWindow = getTableWindow(segments, segmentIndex);
    const previewWindow = getTableWindow(previewMap.ordered, previewIndex);
    if (!segmentWindow || !previewWindow) return;

    const editorY = getEditorWindowY(editor, segments, segmentWindow);
    const previewY = measurePreviewWindow(preview, previewMap.ordered, previewWindow);
    if (!editorY || !previewY) return;

    const anchorDocY = editor.posToY(anchorPos, 1) ?? editorY.start;
    const viewportOffset = useSelectionAnchor
      ? anchorDocY - editor.scrollTop
      : editor.clientHeight / 2;
    const progress = clamp((anchorDocY - editorY.start) / editorY.height, 0, 1);
    const targetDocY = previewY.top + previewY.height * progress;
    const nextScrollTop = Math.max(0, targetDocY - viewportOffset);
    if (mode === "selection") {
      animatePaneScroll("preview", nextScrollTop, 150);
      return;
    }
    setPaneScrollImmediate("preview", nextScrollTop);
  }

  function syncPreviewToEditor() {
    const segments = getSegments();
    if (!segments.length || !previewMap.ordered.length) return;

    const centerDocY = preview.scrollTop + preview.clientHeight / 2;
    let bestIndex = 0;
    let bestMeasure = measureElementWithin(preview, previewMap.ordered[0].element);
    for (let index = 0; index < previewMap.ordered.length; index++) {
      const item = previewMap.ordered[index];
      const measure = measureElementWithin(preview, item.element);
      if (centerDocY >= measure.top && centerDocY <= measure.bottom) {
        bestIndex = index;
        bestMeasure = measure;
        break;
      }
      if (measure.top <= centerDocY) {
        bestIndex = index;
        bestMeasure = measure;
      }
    }

    const previewWindow = getTableWindow(previewMap.ordered, bestIndex);
    if (!previewWindow) return;
    const windowMeasure = measurePreviewWindow(preview, previewMap.ordered, previewWindow);
    const segmentIndex = previewMap.indexById.get(previewMap.ordered[bestIndex]?.id);
    if (segmentIndex == null) return;
    const segmentWindow = getTableWindow(segments, segmentIndex);
    const editorY = segmentWindow ? getEditorWindowY(editor, segments, segmentWindow) : null;
    if (!windowMeasure || !editorY) return;

    const progress = clamp((centerDocY - windowMeasure.top) / windowMeasure.height, 0, 1);
    const targetDocY = editorY.start + editorY.height * progress;
    const nextScrollTop = Math.max(0, targetDocY - editor.clientHeight / 2);
    setPaneScrollImmediate("editor", nextScrollTop);
  }

  function scheduleFromEditor(mode = "scroll") {
    pendingEditorMode = mode;
    if (pendingEditorFrame) return;
    pendingEditorFrame = requestAnimationFrame(() => {
      pendingEditorFrame = 0;
      const modeToUse = pendingEditorMode;
      pendingEditorMode = "scroll";
      syncEditorToPreview(modeToUse);
    });
  }

  function scheduleFromPreview() {
    if (pendingPreviewFrame) return;
    pendingPreviewFrame = requestAnimationFrame(() => {
      pendingPreviewFrame = 0;
      syncPreviewToEditor();
    });
  }

  function scheduleFromActivePane() {
    if (activePane === "preview") {
      scheduleFromPreview();
    } else {
      scheduleFromEditor();
    }
  }

  return {
    setActivePane,
    shouldIgnorePaneScroll(pane) {
      return ignoredPane === pane;
    },
    refreshPreviewMap,
    scheduleFromEditor,
    scheduleFromPreview,
    scheduleFromActivePane,
    syncFromEditor: syncEditorToPreview,
    syncFromPreview: syncPreviewToEditor,
  };
}
