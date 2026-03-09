import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { readDir } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
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

let tocDebounceTimer = null;
let deps = null;

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
  if (recentBody) renderRecentBody(recentBody);
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
    for (const folderPath of folders) {
      const folderEl = buildFolderSection(folderPath);
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
  renderRecentBody(recentSection.body);
  recentArea.appendChild(recentSection.el);
  panel.appendChild(recentArea);
}

function buildFolderSection(folderPath) {
  const collapseKey = `sokki-folder-collapsed-${folderPath}`;
  const collapsed = localStorage.getItem(collapseKey) === "true";

  const section = createSection({
    title: folderPath.split(/[\\/]/).pop(),
    collapsed,
    actions: [
      { label: "✕", title: t("sidebar.closeFolder"), onClick: () => handleCloseFolder(folderPath) },
    ],
    onToggle: (c) => localStorage.setItem(collapseKey, String(c)),
  });

  const treeRoot = document.createElement("div");
  treeRoot.className = "file-tree-root";
  treeRoot.dataset.folder = folderPath;
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

    const onMouseMove = (e) => {
      const delta = startY - e.clientY; // drag up = increase height
      const newHeight = Math.max(RECENT_HEIGHT_MIN, startHeight + delta);
      recentArea.style.height = `${newHeight}px`;
    };

    const onMouseUp = () => {
      handle.classList.remove("dragging");
      const recentArea = document.getElementById("sidebar-recent-area");
      if (recentArea) {
        localStorage.setItem(RECENT_HEIGHT_KEY, String(Math.round(recentArea.getBoundingClientRect().height)));
      }
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });
}

// --- VSCode-style collapsible section ---

function createSection({ id, title, collapsed, actions = [], onToggle }) {
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

function renderRecentBody(container) {
  container.innerHTML = "";
  const recents = loadRecentFiles();
  if (recents.length === 0) {
    const msg = document.createElement("div");
    msg.className = "sidebar-empty-msg";
    msg.textContent = t("sidebar.noRecent");
    container.appendChild(msg);
    return;
  }
  for (const filePath of recents) {
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
    container.appendChild(btn);
  }
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

  for (const heading of headings) {
    const btn = document.createElement("button");
    btn.className = `toc-item toc-h${heading.level}`;
    btn.textContent = heading.text;
    btn.title = heading.text;
    btn.addEventListener("click", () => scrollToHeading(heading.text, heading.level));
    container.appendChild(btn);
  }
}

function scrollToHeading(headingText, level) {
  if (deps && deps.getEditor) {
    const editor = deps.getEditor();
    const value = editor.value;
    const hashes = "#".repeat(level);
    const lines = value.split("\n");
    let charPos = 0;
    for (const line of lines) {
      const headingMatch = line.trimEnd().match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch && headingMatch[1] === hashes && headingMatch[2].trim() === headingText) {
        editor.focus();
        editor.setSelectionRange(charPos, charPos + line.length);
        const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 24;
        const lineIndex = value.substring(0, charPos).split("\n").length - 1;
        editor.scrollTop = lineIndex * lineHeight - editor.clientHeight / 3;
        break;
      }
      charPos += line.length + 1;
    }
  }

  const preview = document.getElementById("preview-pane");
  if (preview) {
    const headingId = headingText
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    const el = preview.querySelector(`#${CSS.escape(headingId)}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

// --- File tree ---

async function loadTreeInto(treeRoot, folderPath) {
  treeRoot.innerHTML = '<div class="sidebar-empty-msg">読み込み中...</div>';
  if (!folderPath) { treeRoot.innerHTML = ""; return; }
  try {
    const tree = await buildMdTree(folderPath);
    treeRoot.innerHTML = "";
    if (tree.length === 0) {
      treeRoot.innerHTML = '<div class="sidebar-empty-msg">.md ファイルなし</div>';
      return;
    }
    treeRoot.appendChild(renderTreeNodes(tree));
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

function renderTreeNodes(nodes, depth = 0) {
  const container = document.createElement("div");
  for (const node of nodes) {
    if (node.children !== null) {
      const folder = document.createElement("div");
      folder.className = "file-tree-folder";

      const label = document.createElement("div");
      label.className = "file-tree-folder-label";
      label.style.paddingLeft = `${8 + depth * 12}px`;

      const icon = document.createElement("span");
      icon.className = "file-tree-folder-icon";
      icon.textContent = "▾";

      const nameSpan = document.createElement("span");
      nameSpan.textContent = node.name;

      label.appendChild(icon);
      label.appendChild(nameSpan);
      folder.appendChild(label);

      const children = document.createElement("div");
      children.className = "file-tree-children";
      children.appendChild(renderTreeNodes(node.children, depth + 1));
      folder.appendChild(children);

      label.addEventListener("click", () => {
        const isCollapsed = folder.classList.toggle("collapsed");
        children.classList.toggle("collapsed", isCollapsed);
      });

      container.appendChild(folder);
    } else {
      const btn = document.createElement("button");
      btn.className = "file-tree-item";
      btn.style.paddingLeft = `${8 + depth * 12}px`;
      btn.title = node.path;

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
      btn.addEventListener("click", () => { if (deps && deps.openFile) deps.openFile(node.path); });
      container.appendChild(btn);
    }
  }
  return container;
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
