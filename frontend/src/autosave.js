import {
  readTextFile,
  writeTextFile,
  exists,
  mkdir,
} from "@tauri-apps/plugin-fs";
import { appDataDir } from "@tauri-apps/api/path";
import { ask } from "@tauri-apps/plugin-dialog";
import { t } from "./i18n.js";

const AUTOSAVE_DIR = "autosave";
const AUTOSAVE_FILE = "snapshot.md~";
const AUTOSAVE_META = "snapshot.json";
const DEBOUNCE_MS = 500;

let debounceTimer = null;
let basePath = null;

async function getBasePath() {
  if (basePath) return basePath;
  basePath = await appDataDir();
  return basePath;
}

async function ensureDir() {
  const base = await getBasePath();
  const dir = `${base}${AUTOSAVE_DIR}`;
  if (!(await exists(dir))) {
    await mkdir(dir, { recursive: true });
  }
  return dir;
}

export async function saveSnapshot(text, currentPath) {
  try {
    const dir = await ensureDir();
    await writeTextFile(`${dir}\\${AUTOSAVE_FILE}`, text);
    await writeTextFile(
      `${dir}\\${AUTOSAVE_META}`,
      JSON.stringify({
        currentPath: currentPath || null,
        savedAt: Date.now(),
      }),
    );
  } catch (err) {
    console.error("Autosave failed:", err);
  }
}

export function scheduleSave(text, currentPath) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    saveSnapshot(text, currentPath);
  }, DEBOUNCE_MS);
}

export async function clearSnapshot() {
  try {
    const dir = await ensureDir();
    await writeTextFile(`${dir}\\${AUTOSAVE_FILE}`, "");
    await writeTextFile(`${dir}\\${AUTOSAVE_META}`, "{}");
  } catch {
    // ignore
  }
}

export async function checkRestore() {
  try {
    const dir = await ensureDir();
    const snapshotPath = `${dir}\\${AUTOSAVE_FILE}`;
    const metaPath = `${dir}\\${AUTOSAVE_META}`;

    if (!(await exists(snapshotPath))) return null;

    const text = await readTextFile(snapshotPath);
    if (!text || text.trim().length === 0) return null;

    let meta = {};
    try {
      if (await exists(metaPath)) {
        meta = JSON.parse(await readTextFile(metaPath));
      }
    } catch {
      // ignore meta parse errors
    }

    const confirmed = await ask(
      t("restore.message"),
      {
        title: t("restore.title"),
        kind: "warning",
        okLabel: t("restore.ok"),
        cancelLabel: t("restore.cancel"),
      },
    );

    if (confirmed) {
      return { text, currentPath: meta.currentPath || null };
    } else {
      await clearSnapshot();
      return null;
    }
  } catch (err) {
    console.error("Restore check failed:", err);
    return null;
  }
}
