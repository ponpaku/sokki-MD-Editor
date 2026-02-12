import { marked } from "marked";
import "./style.css";
import { actionOpen, actionSave, actionPickSaveAsPath } from "./file-ops.js";
import { scheduleSave, clearSnapshot, checkRestore } from "./autosave.js";
import { t, applyTranslations, renderHelp } from "./i18n.js";
import { exportDocx, exportTxt, exportHtml } from "./export.js";
import { openExportModal } from "./export-modal.js";
import { loadSavedStyle, initPreviewStylePanel } from "./preview-style.js";
import { ask } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { resolvePreviewImages } from "./image-resolver.js";
import { startWatching, stopWatching, suppressNextChange, clearSuppression, setExternalChangeHandler } from "./file-watcher.js";

// --- DOM Elements ---
const editor = document.getElementById("editor");
const preview = document.getElementById("preview-pane");
const status = document.getElementById("status");
const helpToggle = document.getElementById("help-toggle");
const helpPanel = document.getElementById("help-panel");
const btnOpen = document.getElementById("btn-open");
const btnSave = document.getElementById("btn-save");
const btnSaveAs = document.getElementById("btn-save-as");
const themeToggle = document.getElementById("theme-toggle");
const btnExport = document.getElementById("btn-export");
const exportDropdown = document.getElementById("export-dropdown");
const exportDocxBtn = document.getElementById("export-docx");
const exportTxtBtn = document.getElementById("export-txt");
const exportPdfBtn = document.getElementById("export-pdf");
const exportHtmlBtn = document.getElementById("export-html");

// --- App State ---
export const state = {
  currentPath: null,
  dirty: false,
  lastSavedAt: null,
};

// --- Markdown Rendering ---
export function updatePreview() {
  let html = marked.parse(editor.value);
  html = resolvePreviewImages(html, state.currentPath);
  // チェックボックスに data-index を付与し disabled を除去
  let cbIndex = 0;
  html = html.replace(/<input [^>]*type="checkbox"[^>]*>/g, (match) => {
    const checked = match.includes("checked");
    return `<input type="checkbox" data-index="${cbIndex++}"${checked ? " checked" : ""}>`;
  });
  preview.innerHTML = html;
}

// --- Status ---
export function setStatus(text) {
  status.textContent = text;
}

function markDirty() {
  state.dirty = true;
  updateTitle();
  scheduleSave(editor.value, state.currentPath);
}

// --- Task List Checkbox Toggle ---
preview.addEventListener("click", (e) => {
  if (e.target.tagName === "INPUT" && e.target.type === "checkbox" && e.target.dataset.index != null) {
    const cbIdx = parseInt(e.target.dataset.index);
    const text = editor.value;
    let count = 0;
    const newText = text.replace(/- \[([ xX])\]/g, (match, p1) => {
      if (count++ === cbIdx) {
        return p1.trim() === "" ? "- [x]" : "- [ ]";
      }
      return match;
    });
    editor.value = newText;
    updatePreview();
    markDirty();
  }
});

// --- Help Toggle ---
helpToggle.addEventListener("click", () => {
  const isVisible = helpPanel.style.display === "block";
  helpPanel.style.display = isVisible ? "none" : "block";
});

document.addEventListener("click", (e) => {
  if (!helpToggle.contains(e.target) && !helpPanel.contains(e.target)) {
    helpPanel.style.display = "none";
  }
  if (!btnExport.contains(e.target) && !exportDropdown.contains(e.target)) {
    exportDropdown.classList.remove("open");
  }
});

// --- Theme Switching ---
function applyTheme(theme) {
  document.body.dataset.theme = theme;
  themeToggle.textContent = theme === "dark" ? "\u2600" : "\u263D";
  localStorage.setItem("sokki-theme", theme);
}

themeToggle.addEventListener("click", () => {
  applyTheme(document.body.dataset.theme === "dark" ? "light" : "dark");
});

// --- Text Insertion Helpers ---
function insertText(text) {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  editor.value =
    editor.value.substring(0, start) + text + editor.value.substring(end);
  editor.selectionStart = editor.selectionEnd = start + text.length;
  updatePreview();
  markDirty();
}

function toggleFormat(prefix, suffix) {
  if (!suffix) suffix = prefix;

  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const value = editor.value;

  const selectedText = value.substring(start, end);
  const before = value.substring(0, start);
  const after = value.substring(end);

  const newText = prefix + selectedText + suffix;
  editor.value = before + newText + after;

  if (start === end) {
    editor.selectionStart = editor.selectionEnd = start + prefix.length;
  } else {
    editor.selectionStart = start;
    editor.selectionEnd = start + newText.length;
  }

  updatePreview();
  markDirty();
}

// --- Shorthand Logic ---
function handleShortcutKey(e) {
  const start = editor.selectionStart;
  const value = editor.value;
  const textBefore = value.substring(0, start);

  // 1. Header Shortcut (#1 to #6)
  const headerMatch = textBefore.match(/[#＃]([1-6１-６])$/);
  if (headerMatch) {
    e.preventDefault();
    let levelChar = headerMatch[1];
    if ("１２３４５６".includes(levelChar)) {
      const fullWidthDigits = "１２３４５６";
      levelChar = (fullWidthDigits.indexOf(levelChar) + 1).toString();
    }
    const level = parseInt(levelChar);
    const hashes = "#".repeat(level) + " ";
    const beforeMatch = value.substring(
      0,
      start - headerMatch[0].length,
    );
    const afterMatch = value.substring(start);
    editor.value = beforeMatch + hashes + afterMatch;
    editor.selectionStart = editor.selectionEnd =
      beforeMatch.length + hashes.length;
    updatePreview();
    markDirty();
    return true;
  }

  // 2. Table Shortcut (t1 to t9)
  const tableMatch = textBefore.match(/[tｔ]([1-9１-９])$/);
  if (tableMatch) {
    e.preventDefault();
    let numChar = tableMatch[1];
    if ("１２３４５６７８９".includes(numChar)) {
      numChar = ("１２３４５６７８９".indexOf(numChar) + 1).toString();
    }
    const cols = parseInt(numChar);

    const headerRow =
      "| " + Array(cols).fill("Header").join(" | ") + " |\n";
    const separatorRow =
      "| " + Array(cols).fill("---").join(" | ") + " |\n";
    const bodyRow = "| " + Array(cols).fill(" ").join(" | ") + " |";
    const tableTemplate = headerRow + separatorRow + bodyRow;

    const beforeMatch = value.substring(
      0,
      start - tableMatch[0].length,
    );
    const afterMatch = value.substring(start);

    editor.value = beforeMatch + tableTemplate + afterMatch;
    const cursorOffset = headerRow.length + separatorRow.length + 2;
    editor.selectionStart = editor.selectionEnd =
      beforeMatch.length + cursorOffset;

    updatePreview();
    markDirty();
    return true;
  }

  // 3. Task List Shortcut ([] → - [ ] )
  const taskMatch = textBefore.match(/\[\]$/);
  if (taskMatch) {
    e.preventDefault();
    const beforeMatch = value.substring(0, start - taskMatch[0].length);
    const afterMatch = value.substring(start);
    const taskMarker = "- [ ] ";
    editor.value = beforeMatch + taskMarker + afterMatch;
    editor.selectionStart = editor.selectionEnd =
      beforeMatch.length + taskMarker.length;
    updatePreview();
    markDirty();
    return true;
  }
  return false;
}

function addColumn(e) {
  const start = editor.selectionStart;
  const value = editor.value;
  const lines = value.split("\n");

  let currentLineIdx = value.substring(0, start).split("\n").length - 1;
  let currentLine = lines[currentLineIdx];

  if (!currentLine.trim().startsWith("|")) return false;
  e.preventDefault();

  let startLine = currentLineIdx;
  while (startLine > 0 && lines[startLine - 1].trim().startsWith("|")) {
    startLine--;
  }
  let endLine = currentLineIdx;
  while (
    endLine < lines.length - 1 &&
    lines[endLine + 1].trim().startsWith("|")
  ) {
    endLine++;
  }

  const textBeforeCursorInLine = currentLine.substring(
    0,
    start - (value.lastIndexOf("\n", start - 1) + 1),
  );
  const colIdx = (textBeforeCursorInLine.match(/\|/g) || []).length;

  for (let i = startLine; i <= endLine; i++) {
    let rowParts = lines[i].split("|");
    let insertValue = "   ";
    if (lines[i].includes("---")) {
      insertValue = " --- ";
    }
    rowParts.splice(colIdx + 1, 0, insertValue);
    lines[i] = rowParts.join("|");
  }

  editor.value = lines.join("\n");
  updatePreview();
  markDirty();
  return true;
}

function parseListLine(line) {
  const match = line.match(/^(\s*)([-*](?:\s\[[ xX]\])?|\d+\.)\s(.*)$/);
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

function markerFromTemplate(source, template) {
  if (template.type === "ordered") return "1.";
  if (template.type === "task") {
    const checked = source.type === "task" && source.checked;
    return `${template.bulletChar} [${checked ? "x" : " "}]`;
  }
  return template.bulletChar;
}

function findTemplateAtIndent(fullLines, lineIndex, targetIndentLen, excludedStart, excludedEnd) {
  let blockStart = lineIndex;
  while (blockStart > 0 && fullLines[blockStart - 1].trim().length > 0) {
    blockStart--;
  }
  let blockEnd = lineIndex;
  while (
    blockEnd < fullLines.length - 1 &&
    fullLines[blockEnd + 1].trim().length > 0
  ) {
    blockEnd++;
  }

  for (let dist = 1; blockStart <= lineIndex - dist || lineIndex + dist <= blockEnd; dist++) {
    const up = lineIndex - dist;
    if (up >= blockStart && (up < excludedStart || up >= excludedEnd)) {
      const parsedUp = parseListLine(fullLines[up]);
      if (parsedUp && parsedUp.indentLen === targetIndentLen) return parsedUp;
    }
    const down = lineIndex + dist;
    if (down <= blockEnd && (down < excludedStart || down >= excludedEnd)) {
      const parsedDown = parseListLine(fullLines[down]);
      if (parsedDown && parsedDown.indentLen === targetIndentLen) return parsedDown;
    }
  }
  return null;
}

function findPreviousOrderedNumberAtIndent(fullLines, lineIndex, targetIndentLen, excludedStart, excludedEnd) {
  let blockStart = lineIndex;
  while (blockStart > 0 && fullLines[blockStart - 1].trim().length > 0) {
    blockStart--;
  }
  for (let i = lineIndex - 1; i >= blockStart; i--) {
    if (i >= excludedStart && i < excludedEnd) continue;
    const parsed = parseListLine(fullLines[i]);
    if (!parsed || parsed.indentLen !== targetIndentLen || parsed.type !== "ordered") continue;
    return parsed.orderedNumber;
  }
  return null;
}

function handleListIndent(e) {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const value = editor.value;
  const fullLines = value.split("\n");

  // Get range of lines covered by selection
  const firstLineStart = value.lastIndexOf("\n", start - 1) + 1;
  const firstLineIndex = value.substring(0, firstLineStart).split("\n").length - 1;
  // When selection ends at a line boundary, exclude the next line
  const adjustedEnd = end > start && end > 0 && value[end - 1] === "\n" ? end - 1 : end;
  const lastLineEnd = value.indexOf("\n", adjustedEnd);
  const blockEnd = lastLineEnd === -1 ? value.length : lastLineEnd;
  const block = value.substring(firstLineStart, blockEnd);
  const lines = block.split("\n");

  const listRegex = /^(\s*)([-*](?:\s\[[ xX]\])?|\d+\.)\s/;
  const hasListLine = lines.some((line) => listRegex.test(line));
  if (!hasListLine) return false;

  e.preventDefault();

  let newLines;
  let cursorDelta = 0;
  const orderedCounters = new Map();

  function resolveMarkerForTarget(parsed, template, targetIndentLen, lineIndex) {
    if (!template) return parsed.marker;
    if (template.type !== "ordered") {
      return markerFromTemplate(parsed, template);
    }
    const counterKey = `${targetIndentLen}`;
    const assigned = orderedCounters.get(counterKey);
    if (assigned != null) {
      const next = assigned + 1;
      orderedCounters.set(counterKey, next);
      return `${next}.`;
    }
    const previousNumber = findPreviousOrderedNumberAtIndent(
      fullLines,
      lineIndex,
      targetIndentLen,
      firstLineIndex,
      firstLineIndex + lines.length,
    );
    if (previousNumber != null) {
      const next = previousNumber + 1;
      orderedCounters.set(counterKey, next);
      return `${next}.`;
    }
    const seed = template.orderedNumber || 1;
    orderedCounters.set(counterKey, seed);
    return `${seed}.`;
  }

  if (e.shiftKey) {
    // Outdent: remove up to 4 leading spaces from list lines
    newLines = lines.map((line, i) => {
      if (!listRegex.test(line)) return line;
      const parsed = parseListLine(line);
      if (!parsed) return line;
      const removed = line.match(/^( {1,4})/);
      if (removed) {
        const count = removed[1].length;
        if (i === 0) cursorDelta = -count;
        const targetIndentLen = parsed.indentLen - count;
        const template = findTemplateAtIndent(
          fullLines,
          firstLineIndex + i,
          targetIndentLen,
          firstLineIndex,
          firstLineIndex + lines.length,
        );
        const marker = resolveMarkerForTarget(parsed, template, targetIndentLen, firstLineIndex + i);
        return `${" ".repeat(targetIndentLen)}${marker} ${parsed.content}`;
      }
      return line;
    });
  } else {
    // Indent: add 4 spaces to list lines
    newLines = lines.map((line, i) => {
      if (!listRegex.test(line)) return line;
      const parsed = parseListLine(line);
      if (!parsed) return line;
      if (i === 0) cursorDelta = 4;
      const targetIndentLen = parsed.indentLen + 4;
      const template = findTemplateAtIndent(
        fullLines,
        firstLineIndex + i,
        targetIndentLen,
        firstLineIndex,
        firstLineIndex + lines.length,
      );
      const marker = resolveMarkerForTarget(parsed, template, targetIndentLen, firstLineIndex + i);
      return `${" ".repeat(targetIndentLen)}${marker} ${parsed.content}`;
    });
  }

  const newBlock = newLines.join("\n");
  if (newBlock === block) return true;

  editor.value = value.substring(0, firstLineStart) + newBlock + value.substring(blockEnd);

  // Adjust cursor
  const newStart = Math.max(firstLineStart, start + cursorDelta);
  const newEnd = Math.max(firstLineStart, end + (newBlock.length - block.length));
  editor.selectionStart = newStart;
  editor.selectionEnd = newEnd;

  updatePreview();
  markDirty();
  return true;
}

function findListContext(value, cursorPos) {
  const textBefore = value.substring(0, cursorPos);
  const lines = textBefore.split("\n");
  const listRegex = /^(\s*)([-*](?:\s\[[ xX]\])?|\d+\.)\s/;

  // Start from the line before current (current line is lines[lines.length-1])
  // Each line must end with <br> to be part of the continuation chain.
  for (let i = lines.length - 2; i >= 0; i--) {
    const line = lines[i];
    if (!line.trimEnd().endsWith("<br>")) return null;
    // This line ends with <br> — check if it's also a list marker (origin)
    const match = line.match(listRegex);
    if (match) return match;
    // <br> continuation but not a list marker — keep searching upward
  }
  return null;
}

function findParentListItem(value, cursorPos, currentIndentLen) {
  const textBefore = value.substring(0, cursorPos);
  const lines = textBefore.split("\n");
  const listRegex = /^(\s*)([-*](?:\s\[[ xX]\])?|\d+\.)\s/;

  for (let i = lines.length - 2; i >= 0; i--) {
    const line = lines[i];
    if (line.trim().length === 0) break;
    const match = line.match(listRegex);
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

function getShiftEnterContinuationIndent(value, cursorPos) {
  const lineStart = value.lastIndexOf("\n", cursorPos - 1) + 1;
  const currentLine = value.substring(lineStart, cursorPos);
  const listRegex = /^(\s*)([-*](?:\s\[[ xX]\])?|\d+\.)\s/;
  const lineMatch = currentLine.match(listRegex);
  if (lineMatch) {
    return " ".repeat(lineMatch[0].length);
  }
  const brListMatch = findListContext(value, cursorPos);
  if (brListMatch) {
    return " ".repeat(brListMatch[0].length);
  }
  return "";
}

function handleEnterKey(e) {
  const start = editor.selectionStart;
  const value = editor.value;

  const previousNewline = value.lastIndexOf("\n", start - 1);
  const lineStart = previousNewline + 1;
  const nextNewline = value.indexOf("\n", start);
  const lineEnd = nextNewline === -1 ? value.length : nextNewline;
  const fullCurrentLine = value.substring(lineStart, lineEnd);
  const currentLine = value.substring(previousNewline + 1, start);

  // 1. Table Row Check
  if (fullCurrentLine.trim().startsWith("|")) {
    e.preventDefault();
    const pipeCount = (fullCurrentLine.match(/\|/g) || []).length;
    const isEmptyTableRow =
      pipeCount >= 2 &&
      fullCurrentLine.replace(/\|/g, "").trim().length === 0;
    if (isEmptyTableRow) {
      editor.value = value.substring(0, lineStart) + value.substring(lineEnd);
      editor.selectionStart = editor.selectionEnd = lineStart;
      updatePreview();
      markDirty();
      return;
    }
    const colCount = pipeCount - 1;
    if (colCount > 0) {
      const newRow =
        "\n| " + Array(colCount).fill(" ").join(" | ") + " |";
      insertText(newRow);
      return;
    }
  }

  // 2. List Marker Check (includes task list: - [ ] / - [x])
  const listRegex = /^(\s*)([-*](?:\s\[[ xX]\])?|\d+\.)\s/;
  const match = currentLine.match(listRegex);

  if (match) {
    e.preventDefault();
    const fullMarker = match[0];
    const contentAfterMarker = currentLine
      .substring(fullMarker.length)
      .trim();

    if (contentAfterMarker.length === 0) {
      const lineStart = previousNewline + 1;
      const currentIndentLen = match[1].length;
      // If indented, try to outdent to parent list level
      if (currentIndentLen > 0) {
        const parentMatch = findParentListItem(value, start, currentIndentLen);
        if (parentMatch) {
          let nextMarker;
          if (parentMatch[2].match(/\d+\./)) {
            const parentNum = parseInt(parentMatch[2]);
            nextMarker = `${parentMatch[1]}${parentNum + 1}. `;
          } else {
            nextMarker = parentMatch[0].replace(/\[[xX]\]/, "[ ]");
          }
          editor.value = value.substring(0, lineStart) + nextMarker + value.substring(start);
          editor.selectionStart = editor.selectionEnd = lineStart + nextMarker.length;
          updatePreview();
          markDirty();
          return;
        }
      }
      editor.value =
        value.substring(0, lineStart) + value.substring(start);
      editor.selectionStart = editor.selectionEnd = lineStart;
    } else {
      if (match[2].match(/\d+\./)) {
        const currentNum = parseInt(match[2]);
        const prefix = match[1];
        const nextMarker = `\n${prefix}${currentNum + 1}. `;
        insertText(nextMarker);
      } else {
        // Task list: always continue with unchecked checkbox
        const nextMarker = fullMarker.replace(/\[[xX]\]/, "[ ]");
        insertText("\n" + nextMarker);
      }
    }
    updatePreview();
    markDirty();
  } else {
    // 3. Check if we're in a <br> continuation of a list
    const brListMatch = findListContext(value, start);
    if (brListMatch) {
      e.preventDefault();
      const contentOnLine = currentLine.trim();
      if (contentOnLine.length === 0) {
        // Empty continuation line — end the list with a paragraph break
        insertText("\n");
      } else {
        if (brListMatch[2].match(/\d+\./)) {
          const currentNum = parseInt(brListMatch[2]);
          const prefix = brListMatch[1];
          const nextMarker = `\n${prefix}${currentNum + 1}. `;
          insertText(nextMarker);
        } else {
          const nextMarker = brListMatch[0].replace(/\[[xX]\]/, "[ ]");
          insertText("\n" + nextMarker);
        }
      }
      updatePreview();
      markDirty();
    } else {
      e.preventDefault();
      const hasNextLine = lineEnd < value.length;
      const nextLineStart = hasNextLine ? lineEnd + 1 : value.length;
      const nextLineBreak = hasNextLine ? value.indexOf("\n", nextLineStart) : -1;
      const nextLineEnd = nextLineBreak === -1 ? value.length : nextLineBreak;
      const nextLine = value.substring(nextLineStart, nextLineEnd);
      const isBlockSeparator =
        fullCurrentLine.trim().length === 0 &&
        nextLine.trim().length > 0;
      if (isBlockSeparator) {
        // Keep the cursor on a separator line while adding one blank line above/below it.
        editor.value = value.substring(0, start) + "\n\n" + value.substring(start);
        editor.selectionStart = editor.selectionEnd = start + 1;
        updatePreview();
        markDirty();
      } else {
        insertText("\n\n");
      }
    }
  }
}

// --- File Operations ---
function updateTitle() {
  const filename = state.currentPath
    ? state.currentPath.split(/[\\/]/).pop()
    : t("title.untitled");
  const dirtyMark = state.dirty ? " *" : "";
  document.title = `${filename}${dirtyMark} - ${t("title.suffix")}`;
}

async function handleOpen() {
  try {
    const result = await actionOpen();
    if (!result) return;
    state.currentPath = result.path;
    state.dirty = false;
    state.lastSavedAt = Date.now();
    editor.value = result.text;
    updatePreview();
    updateTitle();
    setStatus(t("status.opened", result.path.split(/[\\/]/).pop()));
    await startWatching(result.path);
  } catch (err) {
    console.error("Open failed:", err);
    setStatus(t("status.openFailed"));
  }
}

async function handleSave() {
  if (!state.currentPath) {
    return handleSaveAs();
  }
  try {
    suppressNextChange();
    await actionSave(state.currentPath, editor.value);
    state.dirty = false;
    state.lastSavedAt = Date.now();
    updateTitle();
    await clearSnapshot();
    setStatus(t("status.saved", state.currentPath.split(/[\\/]/).pop()));
  } catch (err) {
    console.error("Save failed:", err);
    clearSuppression();
    setStatus(t("status.saveFailed"));
  }
}

async function handleSaveAs() {
  let suppressedSamePathSave = false;
  try {
    const previousPath = state.currentPath;
    const path = await actionPickSaveAsPath(previousPath);
    if (!path) return;
    const wasWatchingSamePath = previousPath === path;
    if (wasWatchingSamePath) {
      suppressNextChange();
      suppressedSamePathSave = true;
    }
    await actionSave(path, editor.value);
    state.currentPath = path;
    state.dirty = false;
    state.lastSavedAt = Date.now();
    updateTitle();
    await clearSnapshot();
    setStatus(t("status.saved", path.split(/[\\/]/).pop()));
    if (!wasWatchingSamePath) {
      await startWatching(path);
    }
  } catch (err) {
    console.error("Save As failed:", err);
    if (suppressedSamePathSave) {
      clearSuppression();
    }
    setStatus(t("status.saveAsFailed"));
  }
}

// --- Button Handlers ---
btnOpen.addEventListener("click", handleOpen);
btnSave.addEventListener("click", handleSave);
btnSaveAs.addEventListener("click", handleSaveAs);

// --- Export Dropdown ---
btnExport.addEventListener("click", (e) => {
  e.stopPropagation();
  exportDropdown.classList.toggle("open");
});

async function handleExportDocx() {
  exportDropdown.classList.remove("open");
  try {
    const path = await exportDocx(editor.value, state.currentPath);
    if (path) setStatus(t("status.exported", path.split(/[\\/]/).pop()));
  } catch (err) {
    console.error("Export DOCX failed:", err);
    setStatus(t("status.exportFailed"));
  }
}

async function handleExportTxt() {
  exportDropdown.classList.remove("open");
  try {
    const path = await exportTxt(editor.value, state.currentPath);
    if (path) setStatus(t("status.exported", path.split(/[\\/]/).pop()));
  } catch (err) {
    console.error("Export TXT failed:", err);
    setStatus(t("status.exportFailed"));
  }
}

exportDocxBtn.addEventListener("click", handleExportDocx);
exportTxtBtn.addEventListener("click", handleExportTxt);

async function handleExportPdf() {
  exportDropdown.classList.remove("open");
  try {
    const path = await openExportModal(editor.value, state.currentPath);
    if (path) setStatus(t("status.exported", path.split(/[\\/]/).pop()));
  } catch (err) {
    console.error("Export PDF failed:", err);
    setStatus(t("status.exportFailed"));
  }
}

async function handleExportHtml() {
  exportDropdown.classList.remove("open");
  try {
    const path = await exportHtml(editor.value, state.currentPath);
    if (path) setStatus(t("status.exported", path.split(/[\\/]/).pop()));
  } catch (err) {
    console.error("Export HTML failed:", err);
    setStatus(t("status.exportFailed"));
  }
}

exportPdfBtn.addEventListener("click", handleExportPdf);
exportHtmlBtn.addEventListener("click", handleExportHtml);

// --- Keyboard Event Handler ---
editor.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey) {
    const key = e.key.toLowerCase();
    if (key === "o") {
      e.preventDefault();
      handleOpen();
      return;
    } else if (key === "s") {
      e.preventDefault();
      if (e.shiftKey) {
        handleSaveAs();
      } else {
        handleSave();
      }
      return;
    } else if (key === "b") {
      e.preventDefault();
      toggleFormat("**");
      return;
    } else if (key === "i") {
      e.preventDefault();
      toggleFormat("*");
      return;
    } else if (key === "u") {
      e.preventDefault();
      toggleFormat("<u>", "</u>");
      return;
    } else if (e.key === "." || e.key === ">") {
      if (addColumn(e)) return;
    }
  }

  if (e.key === "Tab") {
    if (handleListIndent(e)) return;
    if (!e.shiftKey && handleShortcutKey(e)) return;
  }
  if (e.key === " ") {
    if (handleShortcutKey(e)) return;
  }

  if (e.key === "Enter") {
    if (e.shiftKey) {
      e.preventDefault();
      const continuationIndent = getShiftEnterContinuationIndent(editor.value, editor.selectionStart);
      insertText("<br>\n" + continuationIndent);
    } else {
      handleEnterKey(e);
    }
  }
});

// --- User Input ---
editor.addEventListener("input", () => {
  updatePreview();
  markDirty();
});

// --- Scroll Sync ---
let activePane = null;

editor.addEventListener("mouseover", () => {
  activePane = editor;
});
preview.addEventListener("mouseover", () => {
  activePane = preview;
});

editor.addEventListener("scroll", () => {
  if (activePane === editor) {
    const percentage =
      editor.scrollTop / (editor.scrollHeight - editor.clientHeight);
    if (isFinite(percentage)) {
      preview.scrollTop =
        percentage * (preview.scrollHeight - preview.clientHeight);
    }
  }
});

preview.addEventListener("scroll", () => {
  if (activePane === preview) {
    const percentage =
      preview.scrollTop / (preview.scrollHeight - preview.clientHeight);
    if (isFinite(percentage)) {
      editor.scrollTop =
        percentage * (editor.scrollHeight - editor.clientHeight);
    }
  }
});

// --- Draggable Divider ---
const divider = document.getElementById("divider");
const editorPane = document.getElementById("editor-pane");
const previewWrapper = document.getElementById("preview-wrapper");
const container = document.querySelector(".container");

divider.addEventListener("mousedown", (e) => {
  e.preventDefault();
  divider.classList.add("dragging");
  const onMouseMove = (e) => {
    const rect = container.getBoundingClientRect();
    const offset = e.clientX - rect.left;
    const total = rect.width - divider.offsetWidth;
    const ratio = Math.max(0.1, Math.min(0.9, offset / rect.width));
    editorPane.style.flex = "none";
    previewWrapper.style.flex = "none";
    editorPane.style.width = `${ratio * total}px`;
    previewWrapper.style.width = `${(1 - ratio) * total}px`;
  };
  const onMouseUp = () => {
    divider.classList.remove("dragging");
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
  };
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onMouseUp);
});

// --- Expose for file-ops module ---
export function getEditorValue() {
  return editor.value;
}

export function setEditorValue(text) {
  editor.value = text;
  updatePreview();
}

// --- Open file from path (file association / single-instance) ---
async function openFileFromPath(filePath) {
  try {
    const text = await readTextFile(filePath);
    editor.value = text;
    state.currentPath = filePath;
    state.dirty = false;
    state.lastSavedAt = Date.now();
    updatePreview();
    updateTitle();
    setStatus(t("status.opened", filePath.split(/[\\/]/).pop()));
    await startWatching(filePath);
  } catch (err) {
    console.error("Failed to open file from path:", err);
    setStatus(t("status.openFailed"));
  }
}

// --- Listen for file-open events from backend (single-instance) ---
listen("file-open", (event) => {
  openFileFromPath(event.payload);
});

// --- Startup: restore snapshot if available ---
async function init() {
  applyTranslations();
  renderHelp();
  loadSavedStyle();
  initPreviewStylePanel();

  const savedTheme = localStorage.getItem("sokki-theme") || "light";
  applyTheme(savedTheme);

  // External file change handler
  setExternalChangeHandler(async (filePath) => {
    try {
      const text = await readTextFile(filePath);
      if (filePath !== state.currentPath) return;
      if (!state.dirty) {
        // No unsaved changes — silently reload
        editor.value = text;
        updatePreview();
        setStatus(t("status.reloaded"));
      } else {
        // Unsaved changes — ask user
        const reload = await ask(t("conflict.message"), {
          title: t("conflict.title"),
          kind: "warning",
          okLabel: t("conflict.reload"),
          cancelLabel: t("conflict.keep"),
        });
        if (filePath !== state.currentPath) return;
        if (reload) {
          editor.value = text;
          state.dirty = false;
          updatePreview();
          updateTitle();
          await clearSnapshot();
          setStatus(t("status.reloaded"));
        }
      }
    } catch (err) {
      console.error("External change reload failed:", err);
    }
  });

  // Check if launched with a file argument (file association / drag-drop)
  try {
    const initialFile = await invoke("get_initial_file");
    if (initialFile) {
      await openFileFromPath(initialFile);
      return;
    }
  } catch (err) {
    console.error("get_initial_file failed:", err);
  }

  try {
    const restored = await checkRestore();
    if (restored) {
      editor.value = restored.text;
      state.currentPath = restored.currentPath;
      state.dirty = true;
      updatePreview();
      updateTitle();
      setStatus(t("status.restored"));
      if (restored.currentPath) await startWatching(restored.currentPath);
      return;
    }
  } catch (err) {
    console.error("Restore failed:", err);
  }
  updatePreview();
  updateTitle();
}

init();
