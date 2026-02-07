import { marked } from "marked";
import "./style.css";
import { actionOpen, actionSave, actionSaveAs } from "./file-ops.js";
import { scheduleSave, clearSnapshot, checkRestore } from "./autosave.js";
import { t, applyTranslations, renderHelp } from "./i18n.js";
import { exportDocx, exportTxt, exportHtml } from "./export.js";
import { openExportModal } from "./export-modal.js";
import { loadSavedStyle, initPreviewStylePanel } from "./preview-style.js";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { readTextFile } from "@tauri-apps/plugin-fs";

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
  preview.innerHTML = marked.parse(editor.value);
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

function handleEnterKey(e) {
  const start = editor.selectionStart;
  const value = editor.value;

  const previousNewline = value.lastIndexOf("\n", start - 1);
  const currentLine = value.substring(previousNewline + 1, start);

  // 1. Table Row Check
  if (currentLine.trim().startsWith("|")) {
    e.preventDefault();
    const colCount = (currentLine.match(/\|/g) || []).length - 1;
    if (colCount > 0) {
      const newRow =
        "\n| " + Array(colCount).fill(" ").join(" | ") + " |";
      insertText(newRow);
      return;
    }
  }

  // 2. List Marker Check
  const listRegex = /^(\s*)([-*]|\d+\.)\s/;
  const match = currentLine.match(listRegex);

  if (match) {
    e.preventDefault();
    const fullMarker = match[0];
    const contentAfterMarker = currentLine
      .substring(fullMarker.length)
      .trim();

    if (contentAfterMarker.length === 0) {
      const lineStart = previousNewline + 1;
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
        insertText("\n" + fullMarker);
      }
    }
    updatePreview();
    markDirty();
  } else {
    e.preventDefault();
    insertText("\n\n");
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
    await actionSave(state.currentPath, editor.value);
    state.dirty = false;
    state.lastSavedAt = Date.now();
    updateTitle();
    await clearSnapshot();
    setStatus(t("status.saved", state.currentPath.split(/[\\/]/).pop()));
  } catch (err) {
    console.error("Save failed:", err);
    setStatus(t("status.saveFailed"));
  }
}

async function handleSaveAs() {
  try {
    const path = await actionSaveAs(editor.value, state.currentPath);
    if (!path) return;
    state.currentPath = path;
    state.dirty = false;
    state.lastSavedAt = Date.now();
    updateTitle();
    await clearSnapshot();
    setStatus(t("status.saved", path.split(/[\\/]/).pop()));
  } catch (err) {
    console.error("Save As failed:", err);
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

  if (e.key === "Tab" || e.key === " ") {
    if (handleShortcutKey(e)) return;
  }

  if (e.key === "Enter") {
    if (e.shiftKey) {
      e.preventDefault();
      insertText("<br>\n");
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
      return;
    }
  } catch (err) {
    console.error("Restore failed:", err);
  }
  updatePreview();
  updateTitle();
}

init();
