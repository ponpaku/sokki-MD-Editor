import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { t } from "./i18n.js";

function fileFilters() {
  return [
    { name: t("filter.markdown"), extensions: ["md"] },
    { name: t("filter.text"), extensions: ["txt"] },
  ];
}

export async function actionOpen() {
  const selected = await open({
    multiple: false,
    filters: fileFilters(),
  });
  if (!selected) return null;
  const text = await readTextFile(selected);
  return { path: selected, text };
}

function stripInlineMarkdown(text) {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")        // images → remove entirely
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")      // links → keep label
    .replace(/`([^`]*)`/g, "$1")                  // inline code → keep content
    .replace(/\*\*([^*]*)\*\*/g, "$1")            // bold **
    .replace(/__([^_]*)__/g, "$1")                // bold __
    .replace(/\*([^*]*)\*/g, "$1")                // italic *
    .replace(/_([^_]*)_/g, "$1")                  // italic _
    .replace(/~~([^~]*)~~/g, "$1")                // strikethrough
    .trim();
}

function suggestFilename(text) {
  // First heading takes priority
  const headingMatch = text.match(/^#{1,6}\s+(.+)$/m);
  const raw = headingMatch
    ? stripInlineMarkdown(headingMatch[1])
    : stripInlineMarkdown(text.split("\n").find((l) => l.trim()) || "");
  if (!raw) return null;
  // Strip characters that are invalid in Windows/macOS filenames
  return raw.replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 80) || null;
}

export async function actionPickSaveAsPath(currentPath, text = "") {
  let defaultPath = currentPath || undefined;
  if (!currentPath && text) {
    const name = suggestFilename(text);
    if (name) defaultPath = `${name}.md`;
  }
  const path = await save({
    defaultPath,
    filters: fileFilters(),
  });
  return path || null;
}

export async function actionSaveAs(text, currentPath) {
  const path = await actionPickSaveAsPath(currentPath, text);
  if (!path) return null;
  await writeTextFile(path, text);
  return path;
}

export async function actionSave(path, text) {
  await writeTextFile(path, text);
}
