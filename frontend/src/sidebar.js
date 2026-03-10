import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { readDir, rename, copyFile, remove, writeTextFile, exists } from "@tauri-apps/plugin-fs";
import { join, dirname } from "@tauri-apps/api/path";
import { ask } from "@tauri-apps/plugin-dialog";
import { t } from "./i18n.js";

const RECENT_KEY = "sokki-recent-files";
const SIDEBAR_VISIBLE_KEY = "sokki-sidebar-visible";
const SIDEBAR_TAB_KEY = "sokki-sidebar-tab";
const WORKSPACE_FOLDERS_KEY = "sokki-workspace-folders";
const RECENT_COLLAPSED_KEY = "sokki-recent-collapsed";
const RECENT_HEIGHT_KEY = "sokki-recent-height";
const RECENT_MAX = 20;
const RECENT_HEIGHT_DEFAULT = 200;
const RECENT_HEIGHT_MIN = 60;
// CSS: .recent-file-item { font-size: 0.78rem; padding: 3px 8px }
// 0.78rem × 1.4 line-height ≈ 17px + 6px padding = 23px → round to 24
const RECENT_ITEM_HEIGHT_PX = 24;

let tocDebounceTimer = null;
let deps = null;
let recentResizeObserver = null;

// --- Clipboard state for cut/paste ---
let clipboard = null; // { op: 'cut'|'copy', srcPath, name } | null

// --- Context menu DOM node (lazy-created) ---
let ctxMenu = null;

// --- Mouse-based drag state ---
let dragState = null; // { srcPath, startX, startY, ghost, active, srcEl, isFolder }
// Suppress the click event that fires after a completed drag on the same element
let suppressNextClick = false;

// --- Public API ---

export function initSidebar(d) {
  deps = d;

  const visible = localStorage.getItem(SIDEBAR_VISIBLE_KEY) !== "false";
  setSidebarVisible(visible);

  const savedTab = localStorage.getItem(SIDEBAR_TAB_KEY) || "files";
  switchTab(savedTab);

  renderFilesPanel();

  const btnToggle = document.getElementById("btn-sidebar-toggle");
  if (btnToggle) btnToggle.addEventListener("click", toggleSidebar);

  document.querySelectorAll(".sidebar-tab").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  const btnOpenWorkspace = document.getElementById("btn-open-workspace");
  if (btnOpenWorkspace) btnOpenWorkspace.addEventListener("click", handleOpenWorkspace);

  initAboutModal();
}

export function toggleSidebar() {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;
  setSidebarVisible(sidebar.classList.contains("hidden"));
}

export function updateTOC(markdownText) {
  clearTimeout(tocDebounceTimer);
  tocDebounceTimer = setTimeout(() => renderTOC(markdownText), 200);
}

export function addToRecentFiles(filePath) {
  if (!filePath) return;
  let recents = loadRecentFiles();
  recents = recents.filter((p) => p !== filePath);
  recents.unshift(filePath);
  if (recents.length > RECENT_MAX) recents = recents.slice(0, RECENT_MAX);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recents));
  const recentBody = document.getElementById("recent-section-body");
  if (recentBody) requestAnimationFrame(() => renderRecentBody(recentBody));
}

// --- Internal: Files panel ---

function renderFilesPanel() {
  const panel = document.getElementById("sidebar-files");
  if (!panel) return;

  // Remove previously rendered dynamic areas (toolbar stays)
  ["sidebar-workspace-area", "sidebar-resize-handle", "sidebar-recent-area"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });

  const folders = loadWorkspaceFolders();

  // --- Workspace area (scrollable, takes remaining space) ---
  const workspaceArea = document.createElement("div");
  workspaceArea.id = "sidebar-workspace-area";

  if (folders.length === 0) {
    const hint = document.createElement("div");
    hint.className = "sidebar-empty-msg";
    hint.textContent = t("sidebar.noWorkspace");
    workspaceArea.appendChild(hint);
  } else {
    // Count basenames to detect duplicates
    const basenameCounts = new Map();
    for (const p of folders) {
      const base = p.split(/[\\/]/).pop();
      basenameCounts.set(base, (basenameCounts.get(base) || 0) + 1);
    }
    for (const folderPath of folders) {
      const base = folderPath.split(/[\\/]/).pop();
      const parts = folderPath.split(/[\\/]/);
      const parentName = basenameCounts.get(base) > 1 && parts.length >= 2
        ? parts[parts.length - 2]
        : null;
      const folderEl = buildFolderSection(folderPath, parentName);
      workspaceArea.appendChild(folderEl.el);
    }
  }

  panel.appendChild(workspaceArea);

  // Start async tree loads (after appending to DOM for safety)
  if (folders.length > 0) {
    workspaceArea.querySelectorAll(".file-tree-root[data-folder]").forEach((treeRoot) => {
      loadTreeInto(treeRoot, treeRoot.dataset.folder);
    });
  }

  // --- Resize handle ---
  const handle = document.createElement("div");
  handle.id = "sidebar-resize-handle";
  initResizeHandle(handle);
  panel.appendChild(handle);

  // --- Recent Files area (fixed height, resizable) ---
  const recentArea = document.createElement("div");
  recentArea.id = "sidebar-recent-area";
  const savedHeight = parseInt(localStorage.getItem(RECENT_HEIGHT_KEY), 10) || RECENT_HEIGHT_DEFAULT;
  recentArea.style.height = `${Math.max(RECENT_HEIGHT_MIN, savedHeight)}px`;

  const recentCollapsed = localStorage.getItem(RECENT_COLLAPSED_KEY) === "true";
  const recentSection = createSection({
    id: "recent-section",
    title: t("sidebar.recentFiles"),
    collapsed: recentCollapsed,
    onToggle: (collapsed) => localStorage.setItem(RECENT_COLLAPSED_KEY, String(collapsed)),
  });
  recentSection.body.id = "recent-section-body";
  recentArea.appendChild(recentSection.el);
  panel.appendChild(recentArea);

  // Initial render after layout, then observe for size changes
  requestAnimationFrame(() => {
    renderRecentBody(recentSection.body);
    if (recentResizeObserver) recentResizeObserver.disconnect();
    recentResizeObserver = new ResizeObserver(() => {
      const body = document.getElementById("recent-section-body");
      if (body) renderRecentBody(body);
    });
    recentResizeObserver.observe(recentSection.body);
  });
}

function buildFolderSection(folderPath, parentName = null) {
  const collapseKey = `sokki-folder-collapsed-${folderPath}`;
  const collapsed = localStorage.getItem(collapseKey) === "true";

  const section = createSection({
    title: folderPath.split(/[\\/]/).pop(),
    subtitle: parentName,
    collapsed,
    actions: [
      { label: "✕", title: t("sidebar.closeFolder"), onClick: () => handleCloseFolder(folderPath) },
    ],
    onToggle: (c) => localStorage.setItem(collapseKey, String(c)),
  });

  const treeRoot = document.createElement("div");
  treeRoot.className = "file-tree-root";
  treeRoot.dataset.folder = folderPath;
  treeRoot.dataset.workspaceRoot = folderPath;

  section.body.appendChild(treeRoot);

  return section;
}

// --- Resize handle ---

function initResizeHandle(handle) {
  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    handle.classList.add("dragging");

    const recentArea = document.getElementById("sidebar-recent-area");
    if (!recentArea) return;

    const startY = e.clientY;
    const startHeight = recentArea.getBoundingClientRect().height;

    // Measure real item height and header height before drag starts
    const sectionHeader = recentArea.querySelector(".sidebar-section-header");
    const headerH = sectionHeader ? sectionHeader.getBoundingClientRect().height : 28;
    const firstItem = recentArea.querySelector(".recent-file-item");
    const itemH = firstItem ? firstItem.getBoundingClientRect().height : RECENT_ITEM_HEIGHT_PX;

    const recentCount = loadRecentFiles().length;
    const maxHeight = recentCount > 0
      ? Math.max(RECENT_HEIGHT_MIN, recentCount * itemH + headerH)
      : RECENT_HEIGHT_MIN;

    const recentBody = document.getElementById("recent-section-body");

    // Pause ResizeObserver during drag — it fires async and would override our renders
    if (recentResizeObserver) recentResizeObserver.disconnect();

    const onMouseMove = (e) => {
      const delta = startY - e.clientY; // drag up = increase height
      const newHeight = Math.min(maxHeight, Math.max(RECENT_HEIGHT_MIN, startHeight + delta));
      recentArea.style.height = `${newHeight}px`;
      // Pass count directly — avoids any DOM measurement during drag
      if (recentBody) {
        const count = Math.floor((newHeight - headerH) / itemH);
        renderRecentBody(recentBody, count);
      }
    };

    const onMouseUp = () => {
      handle.classList.remove("dragging");
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      const recentArea = document.getElementById("sidebar-recent-area");
      if (recentArea) {
        localStorage.setItem(RECENT_HEIGHT_KEY, String(Math.round(recentArea.getBoundingClientRect().height)));
      }
      // Resume ResizeObserver and do a final render
      const body = document.getElementById("recent-section-body");
      if (body) {
        renderRecentBody(body);
        if (recentResizeObserver) recentResizeObserver.observe(body);
      }
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });
}

// --- VSCode-style collapsible section ---

function createSection({ id, title, subtitle = null, collapsed, actions = [], onToggle }) {
  const section = document.createElement("div");
  section.className = "sidebar-section" + (collapsed ? " collapsed" : "");
  if (id) section.id = id;

  const header = document.createElement("div");
  header.className = "sidebar-section-header";

  const chevron = document.createElement("span");
  chevron.className = "sidebar-section-chevron";
  chevron.textContent = "▾";

  const titleEl = document.createElement("span");
  titleEl.className = "sidebar-section-title-text";
  titleEl.textContent = title;
  titleEl.title = title;

  header.appendChild(chevron);
  header.appendChild(titleEl);

  if (subtitle) {
    const subtitleEl = document.createElement("span");
    subtitleEl.className = "sidebar-section-subtitle";
    subtitleEl.textContent = subtitle;
    subtitleEl.title = subtitle;
    header.appendChild(subtitleEl);
  }

  if (actions.length > 0) {
    const actionsEl = document.createElement("span");
    actionsEl.className = "sidebar-section-actions";
    for (const action of actions) {
      const btn = document.createElement("button");
      btn.className = "sidebar-section-action-btn";
      btn.textContent = action.label;
      btn.title = action.title || "";
      btn.addEventListener("click", (e) => { e.stopPropagation(); action.onClick(); });
      actionsEl.appendChild(btn);
    }
    header.appendChild(actionsEl);
  }

  const body = document.createElement("div");
  body.className = "sidebar-section-body";

  header.addEventListener("click", () => {
    const isCollapsed = section.classList.toggle("collapsed");
    if (onToggle) onToggle(isCollapsed);
  });

  section.appendChild(header);
  section.appendChild(body);

  return { el: section, body };
}

// --- Recent files ---

function buildRecentItem(filePath) {
  const btn = document.createElement("button");
  btn.className = "recent-file-item";
  if (deps && deps.getState && deps.getState().currentPath === filePath) {
    btn.classList.add("active");
  }
  const name = document.createElement("span");
  name.className = "recent-file-name";
  name.textContent = filePath.split(/[\\/]/).pop();
  const parts = filePath.split(/[\\/]/);
  const dir = document.createElement("span");
  dir.className = "recent-file-dir";
  dir.textContent = parts.length > 1 ? parts[parts.length - 2] : "";
  dir.title = filePath;
  btn.appendChild(name);
  btn.appendChild(dir);
  btn.title = filePath;
  btn.addEventListener("click", () => { if (deps && deps.openFile) deps.openFile(filePath); });
  return btn;
}

function renderRecentBody(container, maxCount = null) {
  container.innerHTML = "";
  const recents = loadRecentFiles();

  if (recents.length === 0) {
    const msg = document.createElement("div");
    msg.className = "sidebar-empty-msg";
    msg.textContent = t("sidebar.noRecent");
    container.appendChild(msg);
    return;
  }

  let count;
  if (maxCount !== null) {
    // Drag path: count provided directly — no DOM measurement needed
    count = Math.min(recents.length, Math.max(1, maxCount));
  } else {
    // Normal path: probe one item to get the real item height, then measure container
    const probe = buildRecentItem(recents[0]);
    container.appendChild(probe);
    const containerH = container.getBoundingClientRect().height;
    const itemH = probe.getBoundingClientRect().height || RECENT_ITEM_HEIGHT_PX;
    container.innerHTML = "";
    count = containerH > 0 && itemH > 0
      ? Math.min(recents.length, Math.max(1, Math.floor(containerH / itemH)))
      : recents.length;
  }

  const fragment = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    fragment.appendChild(buildRecentItem(recents[i]));
  }
  container.appendChild(fragment);
}

// --- TOC ---

function renderTOC(markdownText) {
  const container = document.getElementById("toc-list");
  if (!container) return;
  container.innerHTML = "";

  const headingRegex = /^(#{1,6})\s+(.+)$/gm;
  const headings = [];
  let match;
  while ((match = headingRegex.exec(markdownText)) !== null) {
    headings.push({ level: match[1].length, text: match[2].trim() });
  }

  if (headings.length === 0) {
    const msg = document.createElement("div");
    msg.className = "sidebar-empty-msg";
    msg.textContent = t("toc.empty");
    container.appendChild(msg);
    return;
  }

  // Track occurrence count per (level, text) pair to handle duplicate headings
  const occurrenceMap = new Map();
  for (const heading of headings) {
    const key = `${heading.level}:${heading.text}`;
    const occurrence = occurrenceMap.get(key) ?? 0;
    occurrenceMap.set(key, occurrence + 1);

    const btn = document.createElement("button");
    btn.className = `toc-item toc-h${heading.level}`;
    btn.textContent = heading.text;
    btn.title = heading.text;
    btn.addEventListener("click", () => scrollToHeading(heading.text, heading.level, occurrence));
    container.appendChild(btn);
  }
}

function scrollToHeading(headingText, level, occurrence = 0) {
  if (deps && deps.getEditor) {
    const editor = deps.getEditor();
    const value = editor.value;
    const hashes = "#".repeat(level);
    const lines = value.split("\n");
    let charPos = 0;
    let matchCount = 0;
    for (const line of lines) {
      const headingMatch = line.trimEnd().match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch && headingMatch[1] === hashes && headingMatch[2].trim() === headingText) {
        if (matchCount === occurrence) {
          editor.focus();
          editor.setSelectionRange(charPos, charPos + line.length);
          const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 24;
          const lineIndex = value.substring(0, charPos).split("\n").length - 1;
          editor.scrollTop = lineIndex * lineHeight - editor.clientHeight / 3;
          break;
        }
        matchCount++;
      }
      charPos += line.length + 1;
    }
  }

  const preview = document.getElementById("preview-pane");
  if (preview) {
    const tag = `h${level}`;
    const candidates = Array.from(preview.querySelectorAll(tag)).filter(
      (el) => el.textContent.trim() === headingText
    );
    const target = candidates[occurrence] ?? candidates[0];
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

// --- File tree ---

async function loadTreeInto(treeRoot, folderPath) {
  if (!folderPath) { treeRoot.innerHTML = ""; return; }
  // Show loading indicator only on first load (no real content yet)
  const hasContent = treeRoot.querySelector(":scope > div:not(.sidebar-empty-msg)") !== null;
  if (!hasContent) {
    treeRoot.innerHTML = `<div class="sidebar-empty-msg">${t("sidebar.loading")}</div>`;
  }
  try {
    const tree = await buildMdTree(folderPath);
    if (tree.length === 0) {
      treeRoot.innerHTML = `<div class="sidebar-empty-msg">${t("sidebar.noMdFiles")}</div>`;
      return;
    }
    const existing = treeRoot.querySelector(":scope > div:not(.sidebar-empty-msg)");
    if (existing) {
      // Diff update — no flash, preserves folder collapse state
      diffContainer(existing, tree, 0);
      // Remove any stale empty-state messages
      treeRoot.querySelectorAll(":scope > .sidebar-empty-msg").forEach((el) => el.remove());
    } else {
      treeRoot.innerHTML = "";
      treeRoot.appendChild(renderTreeNodes(tree));
    }
  } catch (err) {
    console.error("renderFileTree failed:", err);
    treeRoot.innerHTML = `<div class="sidebar-empty-msg">${String(err)}</div>`;
  }
}

async function buildMdTree(dirPath) {
  const entries = await readDir(dirPath);
  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" });
  });
  const result = [];
  for (const entry of entries) {
    if (!entry.name || entry.name.startsWith(".")) continue;
    const entryPath = await join(dirPath, entry.name);
    if (entry.isDirectory) {
      const children = await buildMdTree(entryPath);
      if (children.length > 0) result.push({ name: entry.name, path: entryPath, children });
    } else if (entry.isFile && /\.(md|markdown)$/i.test(entry.name)) {
      result.push({ name: entry.name, path: entryPath, children: null });
    }
  }
  return result;
}

function createFileNode(node, depth) {
  const btn = document.createElement("button");
  btn.className = "file-tree-item";
  btn.style.paddingLeft = `${8 + depth * 12}px`;
  btn.title = node.path;
  btn.dataset.path = node.path;

  const fileIcon = document.createElement("span");
  fileIcon.className = "file-tree-file-icon";
  fileIcon.textContent = "○";

  const nameSpan = document.createElement("span");
  nameSpan.className = "file-tree-name";
  nameSpan.textContent = node.name;

  btn.appendChild(fileIcon);
  btn.appendChild(nameSpan);

  if (deps && deps.getState && deps.getState().currentPath === node.path) {
    btn.classList.add("active");
  }
  btn.addEventListener("click", () => {
    if (suppressNextClick) { suppressNextClick = false; return; }
    if (deps && deps.openFile) deps.openFile(node.path);
  });
  btn.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    showFileCtxMenu(e.clientX, e.clientY, node.path);
  });
  btn.addEventListener("mousedown", (e) => startDrag(e, node.path, btn, false));

  return btn;
}

function createFolderEl(node, depth) {
  const folder = document.createElement("div");
  folder.className = "file-tree-folder";

  const label = document.createElement("div");
  label.className = "file-tree-folder-label";
  label.style.paddingLeft = `${8 + depth * 12}px`;
  label.dataset.folderPath = node.path;

  const icon = document.createElement("span");
  icon.className = "file-tree-folder-icon";
  icon.textContent = "▾";

  const nameSpan = document.createElement("span");
  nameSpan.textContent = node.name;

  label.appendChild(icon);
  label.appendChild(nameSpan);
  folder.appendChild(label);

  const childrenWrapper = document.createElement("div");
  childrenWrapper.className = "file-tree-children";
  const innerContainer = document.createElement("div");
  childrenWrapper.appendChild(innerContainer);
  folder.appendChild(childrenWrapper);

  // Populate children
  for (const child of node.children) {
    if (child.children !== null) {
      innerContainer.appendChild(createFolderEl(child, depth + 1));
    } else {
      innerContainer.appendChild(createFileNode(child, depth + 1));
    }
  }

  label.addEventListener("click", () => {
    if (suppressNextClick) { suppressNextClick = false; return; }
    const isCollapsed = folder.classList.toggle("collapsed");
    childrenWrapper.classList.toggle("collapsed", isCollapsed);
  });
  label.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    showFolderCtxMenu(e.clientX, e.clientY, node.path);
  });
  label.addEventListener("mousedown", (e) => {
    if (e.target.tagName === "INPUT") return;
    startDrag(e, node.path, label, true);
  });

  return folder;
}

function renderTreeNodes(nodes, depth = 0) {
  const container = document.createElement("div");
  for (const node of nodes) {
    if (node.children !== null) {
      container.appendChild(createFolderEl(node, depth));
    } else {
      container.appendChild(createFileNode(node, depth));
    }
  }
  return container;
}

// Diff existing container DOM against new node list.
// Reuses existing elements where paths match, inserts new ones, removes stale ones.
function diffContainer(container, newNodes, depth) {
  // Index existing children by path
  const existingByPath = new Map();
  for (const child of container.children) {
    if (child.classList.contains("file-tree-item") && child.dataset.path) {
      existingByPath.set(normalizePath(child.dataset.path), child);
    } else if (child.classList.contains("file-tree-folder")) {
      const label = child.querySelector(":scope > .file-tree-folder-label");
      if (label && label.dataset.folderPath) {
        existingByPath.set(normalizePath(label.dataset.folderPath), child);
      }
    }
  }

  // Build desired child list, reusing or creating elements
  const desired = [];
  for (const node of newNodes) {
    const key = normalizePath(node.path);
    if (node.children !== null) {
      // Folder
      if (existingByPath.has(key)) {
        const folderEl = existingByPath.get(key);
        existingByPath.delete(key);
        // Update display name if it changed
        const label = folderEl.querySelector(":scope > .file-tree-folder-label");
        const nameSpan = label && label.querySelector("span:not(.file-tree-folder-icon)");
        if (nameSpan && nameSpan.textContent !== node.name) nameSpan.textContent = node.name;
        // Recurse into children container
        const innerContainer = folderEl.querySelector(":scope > .file-tree-children > div");
        if (innerContainer) diffContainer(innerContainer, node.children, depth + 1);
        desired.push(folderEl);
      } else {
        desired.push(createFolderEl(node, depth));
      }
    } else {
      // File
      if (existingByPath.has(key)) {
        const btn = existingByPath.get(key);
        existingByPath.delete(key);
        // Update active state
        if (deps && deps.getState) {
          btn.classList.toggle("active", deps.getState().currentPath === node.path);
        }
        desired.push(btn);
      } else {
        desired.push(createFileNode(node, depth));
      }
    }
  }

  // Remove stale elements
  for (const el of existingByPath.values()) el.remove();

  // Apply desired order with minimal DOM moves
  for (let i = 0; i < desired.length; i++) {
    const el = desired[i];
    if (container.children[i] !== el) container.insertBefore(el, container.children[i] ?? null);
  }
}

// --- Context Menu Infrastructure ---

function ensureCtxMenu() {
  if (ctxMenu) return ctxMenu;
  ctxMenu = document.createElement("div");
  ctxMenu.id = "ctx-menu";
  document.body.appendChild(ctxMenu);

  document.addEventListener("mousedown", (e) => {
    if (ctxMenu && !ctxMenu.contains(e.target)) {
      hideCtxMenu();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideCtxMenu();
  });

  return ctxMenu;
}

function showCtxMenu(x, y, items) {
  const menu = ensureCtxMenu();
  menu.innerHTML = "";

  for (const item of items) {
    if (item.separator) {
      const sep = document.createElement("div");
      sep.className = "ctx-menu-separator";
      menu.appendChild(sep);
      continue;
    }
    const btn = document.createElement("button");
    btn.className = "ctx-menu-item";
    btn.textContent = item.label;
    if (item.disabled) btn.disabled = true;
    btn.addEventListener("click", () => {
      hideCtxMenu();
      item.onClick();
    });
    menu.appendChild(btn);
  }

  menu.classList.add("open");

  // Position within viewport
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  menu.style.left = "0";
  menu.style.top = "0";
  requestAnimationFrame(() => {
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    const left = x + mw > vw ? Math.max(0, vw - mw) : x;
    const top = y + mh > vh ? Math.max(0, vh - mh) : y;
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  });
}

function hideCtxMenu() {
  if (ctxMenu) ctxMenu.classList.remove("open");
}

function showFileCtxMenu(x, y, filePath) {
  const hasPaste = clipboard !== null;
  showCtxMenu(x, y, [
    { label: t("ctx.rename"), onClick: () => { const el = findFileItemByPath(filePath); if (el) triggerInlineRename(filePath, el); } },
    { label: t("ctx.duplicate"), onClick: () => handleDuplicate(filePath) },
    { separator: true },
    { label: t("ctx.cut"), onClick: () => { clipboard = { op: "cut", srcPath: filePath, name: filePath.split(/[\\/]/).pop() }; } },
    { label: t("ctx.paste"), disabled: !hasPaste, onClick: async () => { const dir = await dirname(filePath); await handlePaste(dir); } },
    { separator: true },
    { label: t("ctx.delete"), onClick: () => handleDeleteFile(filePath) },
  ]);
}

function showFolderCtxMenu(x, y, folderPath) {
  const hasPaste = clipboard !== null;
  showCtxMenu(x, y, [
    { label: t("ctx.newFile"), onClick: () => handleNewFileInFolder(folderPath) },
    { separator: true },
    { label: t("ctx.renameFolder"), onClick: () => { const el = findFolderLabelByPath(folderPath); if (el) triggerFolderInlineRename(folderPath, el); } },
    { label: t("ctx.paste"), disabled: !hasPaste, onClick: () => handlePaste(folderPath) },
    { separator: true },
    { label: t("ctx.deleteFolder"), onClick: () => handleDeleteFolder(folderPath) },
  ]);
}

// --- FS Helpers ---

function normalizePath(p) {
  return p.replace(/\\/g, "/");
}

function findWorkspaceRootForPath(anyPath) {
  const normalized = normalizePath(anyPath);
  const roots = document.querySelectorAll(".file-tree-root[data-workspace-root]");
  for (const root of roots) {
    const rootPath = normalizePath(root.dataset.workspaceRoot);
    if (normalized.startsWith(rootPath)) return root;
  }
  return null;
}

async function refreshTreeForPath(anyPath) {
  const root = findWorkspaceRootForPath(anyPath);
  if (root) {
    await loadTreeInto(root, root.dataset.folder);
  }
}

// Remove a file or folder (and all paths under it) from recent files
function removeFromRecentFileOrFolder(deletedPath) {
  const normDel = normalizePath(deletedPath);
  const recents = loadRecentFiles();
  const filtered = recents.filter((p) => {
    const n = normalizePath(p);
    return n !== normDel && !n.startsWith(normDel + "/");
  });
  if (filtered.length === recents.length) return;
  localStorage.setItem(RECENT_KEY, JSON.stringify(filtered));
  const body = document.getElementById("recent-section-body");
  if (body) requestAnimationFrame(() => renderRecentBody(body));
}

// Update paths in recent files when a file or folder is renamed/moved
function updateRecentFileOrFolder(oldPath, newPath) {
  const normOld = normalizePath(oldPath);
  const normNew = normalizePath(newPath);
  let changed = false;
  const recents = loadRecentFiles().map((p) => {
    const n = normalizePath(p);
    if (n === normOld) { changed = true; return newPath; }
    if (n.startsWith(normOld + "/")) { changed = true; return normNew + n.slice(normOld.length); }
    return p;
  });
  if (!changed) return;
  localStorage.setItem(RECENT_KEY, JSON.stringify(recents));
  const body = document.getElementById("recent-section-body");
  if (body) requestAnimationFrame(() => renderRecentBody(body));
}

async function generateCopyPath(dirPath, baseName) {
  const dotIdx = baseName.lastIndexOf(".");
  const stem = dotIdx > 0 ? baseName.slice(0, dotIdx) : baseName;
  const ext = dotIdx > 0 ? baseName.slice(dotIdx) : "";

  let candidate = await join(dirPath, `${stem}_copy${ext}`);
  if (!await exists(candidate)) return candidate;

  let i = 2;
  while (true) {
    candidate = await join(dirPath, `${stem}_copy${i}${ext}`);
    if (!await exists(candidate)) return candidate;
    i++;
  }
}

async function handleDeleteFile(filePath) {
  const name = filePath.split(/[\\/]/).pop();
  const confirmed = await ask(t("ctx.confirmDelete", name), {
    title: t("ctx.delete"),
    kind: "warning",
    okLabel: t("ctx.delete"),
    cancelLabel: t("new.cancel"),
  });
  if (!confirmed) return;
  try {
    await remove(filePath);
    removeFromRecentFileOrFolder(filePath);
    showStatus(t("status.deleted", name));
    if (deps && deps.onFileDeleted && deps.getState && deps.getState().currentPath === filePath) {
      deps.onFileDeleted();
    }
    await refreshTreeForPath(filePath);
  } catch (err) {
    console.error("Delete file failed:", err);
    showStatus(t("status.fsError", String(err)));
  }
}

async function handleDuplicate(filePath) {
  try {
    const dir = await dirname(filePath);
    const name = filePath.split(/[\\/]/).pop();
    const destPath = await generateCopyPath(dir, name);
    await copyFile(filePath, destPath);
    showStatus(t("status.duplicated", destPath.split(/[\\/]/).pop()));
    await refreshTreeForPath(filePath);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = findFileItemByPath(destPath);
        if (el) triggerInlineRename(destPath, el);
      });
    });
  } catch (err) {
    console.error("Duplicate failed:", err);
    showStatus(t("status.fsError", String(err)));
  }
}

async function handleDeleteFolder(folderPath) {
  const name = folderPath.split(/[\\/]/).pop();
  const confirmed = await ask(t("ctx.confirmDeleteFolder", name), {
    title: t("ctx.deleteFolder"),
    kind: "warning",
    okLabel: t("ctx.deleteFolder"),
    cancelLabel: t("new.cancel"),
  });
  if (!confirmed) return;
  try {
    await remove(folderPath, { recursive: true });
    removeFromRecentFileOrFolder(folderPath);
    showStatus(t("status.deleted", name));
    await refreshTreeForPath(folderPath);
  } catch (err) {
    console.error("Delete folder failed:", err);
    showStatus(t("status.fsError", String(err)));
  }
}

async function handlePaste(destDir) {
  if (!clipboard) return;
  const { op, srcPath, name } = clipboard;
  try {
    const destPath = await join(destDir, name);
    if (await exists(destPath)) {
      const confirmed = await ask(t("ctx.confirmOverwrite", name), {
        title: t("ctx.overwrite"),
        kind: "warning",
        okLabel: t("ctx.overwrite"),
        cancelLabel: t("new.cancel"),
      });
      if (!confirmed) return;
    }
    if (op === "cut") {
      await rename(srcPath, destPath);
      clipboard = null;
      updateRecentFileOrFolder(srcPath, destPath);
      if (deps && deps.onFileRenamed && deps.getState && deps.getState().currentPath === srcPath) {
        await deps.onFileRenamed(srcPath, destPath);
      }
      showStatus(t("status.moved", name));
      await refreshTreeForPath(srcPath);
      await refreshTreeForPath(destPath);
    } else {
      await copyFile(srcPath, destPath);
      showStatus(t("status.duplicated", name));
      await refreshTreeForPath(destPath);
    }
  } catch (err) {
    console.error("Paste failed:", err);
    showStatus(t("status.fsError", String(err)));
  }
}

async function handleNewFileInFolder(folderPath) {
  try {
    const fileName = t("tree.newFileName");
    let newPath = await join(folderPath, fileName);
    // Avoid overwriting existing file
    if (await exists(newPath)) {
      newPath = await generateCopyPath(folderPath, fileName);
    }
    await writeTextFile(newPath, "");
    await refreshTreeForPath(newPath);
    // Trigger inline rename after tree refresh; cancel deletes the empty file
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = findFileItemByPath(newPath);
        if (el) triggerInlineRename(newPath, el, {
          onCancel: async () => {
            try {
              await remove(newPath);
              await refreshTreeForPath(newPath);
            } catch { /* ignore */ }
          },
        });
      });
    });
  } catch (err) {
    console.error("New file failed:", err);
    showStatus(t("status.fsError", String(err)));
  }
}

// --- Mouse-based Drag & Drop ---

function startDrag(e, srcPath, srcEl, isFolder) {
  if (e.button !== 0) return;
  e.preventDefault();
  dragState = { srcPath, startX: e.clientX, startY: e.clientY, ghost: null, active: false, srcEl, isFolder };
  document.addEventListener("mousemove", onDragMouseMove);
  document.addEventListener("mouseup", onDragMouseUp);
}

function onDragMouseMove(e) {
  if (!dragState) return;
  if (!dragState.active) {
    if (Math.hypot(e.clientX - dragState.startX, e.clientY - dragState.startY) < 6) return;
    dragState.active = true;
    dragState.srcEl.classList.add("dragging");
    const ghost = document.createElement("div");
    ghost.className = "drag-ghost";
    ghost.textContent = dragState.srcPath.split(/[\\/]/).pop();
    document.body.appendChild(ghost);
    dragState.ghost = ghost;
    document.body.style.userSelect = "none";
    document.body.classList.add("dragging-file");
  }
  e.preventDefault();
  if (dragState.ghost) {
    dragState.ghost.style.left = `${e.clientX + 14}px`;
    dragState.ghost.style.top = `${e.clientY - 8}px`;
  }
  // Update drag-over highlight
  clearDragOver();
  // Temporarily hide ghost to hit-test the element underneath
  if (dragState.ghost) dragState.ghost.style.display = "none";
  const el = document.elementFromPoint(e.clientX, e.clientY);
  if (dragState.ghost) dragState.ghost.style.display = "";
  if (el) {
    const folderLabel = el.closest(".file-tree-folder-label");
    const treeRoot = el.closest(".file-tree-root");
    const srcNorm = normalizePath(dragState.srcPath);
    if (folderLabel && folderLabel.dataset.folderPath) {
      const targetNorm = normalizePath(folderLabel.dataset.folderPath);
      // Skip if dragging onto self or a descendant of the dragged folder
      const isSelfOrChild = dragState.isFolder && (targetNorm === srcNorm || targetNorm.startsWith(srcNorm + "/"));
      if (!isSelfOrChild) folderLabel.classList.add("drag-over");
    } else if (treeRoot) {
      const rootNorm = normalizePath(treeRoot.dataset.folder || "");
      // Skip if the workspace root is the dragged folder itself
      const isSelf = dragState.isFolder && rootNorm === srcNorm;
      if (!isSelf) treeRoot.classList.add("drag-over");
    }
  }
}

async function onDragMouseUp(e) {
  document.removeEventListener("mousemove", onDragMouseMove);
  document.removeEventListener("mouseup", onDragMouseUp);
  if (!dragState) return;
  const { srcPath, active, ghost, srcEl, isFolder } = dragState;
  dragState = null;
  if (ghost) ghost.remove();
  srcEl.classList.remove("dragging");
  document.body.style.userSelect = "";
  document.body.classList.remove("dragging-file");
  clearDragOver();
  if (!active) return;
  // Suppress the click that fires on mouseup on the same element
  suppressNextClick = true;
  // Find drop target via hit-test
  const el = document.elementFromPoint(e.clientX, e.clientY);
  if (!el) return;
  const folderLabel = el.closest(".file-tree-folder-label[data-folder-path]");
  const fileItem = el.closest(".file-tree-item[data-path]");
  const treeRoot = el.closest(".file-tree-root[data-folder]");
  if (folderLabel) {
    await handleDropMove(srcPath, folderLabel.dataset.folderPath, isFolder);
  } else if (fileItem && normalizePath(fileItem.dataset.path) !== normalizePath(srcPath)) {
    const destDir = await dirname(fileItem.dataset.path);
    await handleDropMove(srcPath, destDir, isFolder);
  } else if (treeRoot) {
    await handleDropMove(srcPath, treeRoot.dataset.folder, isFolder);
  }
}

function clearDragOver() {
  document.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
}

async function handleDropMove(srcPath, destDir, isFolder = false) {
  try {
    const normSrc = normalizePath(srcPath);
    const normDest = normalizePath(destDir);
    // Prevent circular move (folder into itself or a descendant)
    if (isFolder && (normDest === normSrc || normDest.startsWith(normSrc + "/"))) {
      showStatus(t("ctx.circularMove"));
      return;
    }
    const srcDir = normalizePath(await dirname(srcPath));
    if (srcDir === normDest) return; // same folder, skip
    const name = srcPath.split(/[\\/]/).pop();
    const destPath = await join(destDir, name);
    if (await exists(destPath)) {
      const confirmed = await ask(t("ctx.confirmOverwrite", name), {
        title: t("ctx.overwrite"),
        kind: "warning",
        okLabel: t("ctx.overwrite"),
        cancelLabel: t("new.cancel"),
      });
      if (!confirmed) return;
    }
    await rename(srcPath, destPath);
    updateRecentFileOrFolder(srcPath, destPath);
    if (deps && deps.onFileRenamed && deps.getState && deps.getState().currentPath === srcPath) {
      await deps.onFileRenamed(srcPath, destPath);
    }
    showStatus(t("status.moved", name));
    await refreshTreeForPath(srcPath);
    await refreshTreeForPath(destPath);
  } catch (err) {
    console.error("Drop move failed:", err);
    showStatus(t("status.fsError", String(err)));
  }
}

// --- DOM Finders ---

function findFileItemByPath(filePath) {
  const items = document.querySelectorAll(".file-tree-item[data-path]");
  for (const item of items) {
    if (normalizePath(item.dataset.path) === normalizePath(filePath)) return item;
  }
  return null;
}

function findFolderLabelByPath(folderPath) {
  const labels = document.querySelectorAll(".file-tree-folder-label[data-folder-path]");
  for (const label of labels) {
    if (normalizePath(label.dataset.folderPath) === normalizePath(folderPath)) return label;
  }
  return null;
}

// --- Inline Rename ---

function triggerInlineRename(filePath, btn, { onCancel } = {}) {
  const nameSpan = btn.querySelector(".file-tree-name");
  if (!nameSpan) return;

  const oldName = filePath.split(/[\\/]/).pop();
  const input = document.createElement("input");
  input.type = "text";
  input.className = "file-tree-rename-input";
  input.value = oldName;

  // Select stem (before extension)
  const dotIdx = oldName.lastIndexOf(".");
  const stemEnd = dotIdx > 0 ? dotIdx : oldName.length;

  // Prevent button click from firing while input is active
  btn.style.pointerEvents = "none";
  input.style.pointerEvents = "all";

  nameSpan.replaceWith(input);
  input.focus();
  input.setSelectionRange(0, stemEnd);

  let committed = false;

  async function commit() {
    if (committed) return;
    committed = true;
    const newName = input.value.trim();
    input.replaceWith(nameSpan);
    btn.style.pointerEvents = "";
    if (!newName || newName === oldName) return;
    try {
      const dir = await dirname(filePath);
      const newPath = await join(dir, newName);
      await rename(filePath, newPath);
      updateRecentFileOrFolder(filePath, newPath);
      if (deps && deps.onFileRenamed && deps.getState && deps.getState().currentPath === filePath) {
        await deps.onFileRenamed(filePath, newPath);
      }
      showStatus(t("status.renamed", newName));
      await refreshTreeForPath(newPath);
    } catch (err) {
      console.error("Rename failed:", err);
      showStatus(t("status.fsError", String(err)));
      await refreshTreeForPath(filePath);
    }
  }

  function revert() {
    if (committed) return;
    committed = true;
    input.replaceWith(nameSpan);
    btn.style.pointerEvents = "";
    if (onCancel) onCancel();
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    else if (e.key === "Escape") { e.preventDefault(); revert(); }
    e.stopPropagation();
  });
  input.addEventListener("blur", () => commit());
}

function triggerFolderInlineRename(folderPath, label) {
  const nameSpan = label.querySelector("span:not(.file-tree-folder-icon)");
  if (!nameSpan) return;

  const oldName = folderPath.split(/[\\/]/).pop();
  const input = document.createElement("input");
  input.type = "text";
  input.className = "file-tree-rename-input";
  input.value = oldName;

  nameSpan.replaceWith(input);
  input.focus();
  input.setSelectionRange(0, oldName.length);

  let committed = false;

  async function commit() {
    if (committed) return;
    committed = true;
    const newName = input.value.trim();
    input.replaceWith(nameSpan);
    if (!newName || newName === oldName) return;
    try {
      const dir = await dirname(folderPath);
      const newPath = await join(dir, newName);
      await rename(folderPath, newPath);
      updateRecentFileOrFolder(folderPath, newPath);
      // Migrate localStorage collapse key
      const oldKey = `sokki-folder-collapsed-${folderPath}`;
      const newKey = `sokki-folder-collapsed-${newPath}`;
      const val = localStorage.getItem(oldKey);
      if (val !== null) {
        localStorage.setItem(newKey, val);
        localStorage.removeItem(oldKey);
      }
      showStatus(t("status.renamed", newName));
      await refreshTreeForPath(newPath);
    } catch (err) {
      console.error("Folder rename failed:", err);
      showStatus(t("status.fsError", String(err)));
      await refreshTreeForPath(folderPath);
    }
  }

  function revert() {
    if (committed) return;
    committed = true;
    input.replaceWith(nameSpan);
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    else if (e.key === "Escape") { e.preventDefault(); revert(); }
    e.stopPropagation();
  });
  input.addEventListener("blur", () => commit());
}

// --- Status helper ---

function showStatus(msg) {
  if (deps && deps.setStatus) deps.setStatus(msg);
}

// --- Workspace folder list ---

function loadWorkspaceFolders() {
  try {
    // Migrate legacy single-folder key
    const legacy = localStorage.getItem("sokki-workspace-folder");
    if (legacy) {
      localStorage.removeItem("sokki-workspace-folder");
      const folders = [legacy];
      localStorage.setItem(WORKSPACE_FOLDERS_KEY, JSON.stringify(folders));
      return folders;
    }
    const raw = localStorage.getItem(WORKSPACE_FOLDERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveWorkspaceFolders(folders) {
  localStorage.setItem(WORKSPACE_FOLDERS_KEY, JSON.stringify(folders));
}

async function handleOpenWorkspace() {
  try {
    const folder = await dialogOpen({ directory: true, multiple: false });
    if (!folder) return;
    const folders = loadWorkspaceFolders();
    if (!folders.includes(folder)) {
      folders.push(folder);
      saveWorkspaceFolders(folders);
    }
    renderFilesPanel();
  } catch (err) {
    console.error("Open workspace failed:", err);
  }
}

function handleCloseFolder(folderPath) {
  const folders = loadWorkspaceFolders().filter((p) => p !== folderPath);
  saveWorkspaceFolders(folders);
  localStorage.removeItem(`sokki-folder-collapsed-${folderPath}`);
  renderFilesPanel();
}

// --- Misc ---

function setSidebarVisible(visible) {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;
  sidebar.classList.toggle("hidden", !visible);
  localStorage.setItem(SIDEBAR_VISIBLE_KEY, String(visible));
}

function switchTab(tab) {
  document.querySelectorAll(".sidebar-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
  document.querySelectorAll(".sidebar-panel").forEach((panel) => {
    panel.classList.add("hidden");
  });
  const activePanel = document.getElementById(tab === "files" ? "sidebar-files" : "sidebar-toc");
  if (activePanel) activePanel.classList.remove("hidden");
  localStorage.setItem(SIDEBAR_TAB_KEY, tab);
}

function loadRecentFiles() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// --- About Modal ---

function initAboutModal() {
  const btnAbout = document.getElementById("btn-about");
  const modal = document.getElementById("about-modal");
  const btnClose = document.getElementById("about-close");
  const btnCopy = document.getElementById("about-copy-url");
  const urlEl = document.getElementById("about-repo-url");
  if (!btnAbout || !modal) return;

  function openModal() { modal.classList.add("open"); }
  function closeModal() { modal.classList.remove("open"); }

  btnAbout.addEventListener("click", openModal);
  btnClose?.addEventListener("click", closeModal);

  // Close on overlay click (outside dialog)
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  // Close on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.classList.contains("open")) closeModal();
  });

  // Copy URL to clipboard
  btnCopy?.addEventListener("click", async () => {
    const url = urlEl?.textContent?.trim() ?? "";
    try {
      await navigator.clipboard.writeText(url);
      const original = btnCopy.textContent;
      btnCopy.textContent = t("about.copied");
      setTimeout(() => { btnCopy.textContent = original; }, 1800);
    } catch {
      // Fallback: select the text
      if (urlEl) {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(urlEl);
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  });
}
