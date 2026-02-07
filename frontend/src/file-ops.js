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

export async function actionSaveAs(text, currentPath) {
  const path = await save({
    defaultPath: currentPath || undefined,
    filters: fileFilters(),
  });
  if (!path) return null;
  await writeTextFile(path, text);
  return path;
}

export async function actionSave(path, text) {
  await writeTextFile(path, text);
}
