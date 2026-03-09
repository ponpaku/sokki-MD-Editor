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

function suggestFilename(text) {
  // First heading takes priority
  const headingMatch = text.match(/^#{1,6}\s+(.+)$/m);
  const raw = headingMatch
    ? headingMatch[1].trim()
    : (text.split("\n").find((l) => l.trim()) || "").trim();
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
