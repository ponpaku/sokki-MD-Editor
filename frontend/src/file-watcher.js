import { watch } from "@tauri-apps/plugin-fs";

let unwatchFn = null;
let suppressNext = false;
let suppressTimer = null;
let onExternalChange = null;

export function setExternalChangeHandler(callback) {
  onExternalChange = callback;
}

export function suppressNextChange() {
  suppressNext = true;
  clearTimeout(suppressTimer);
  suppressTimer = setTimeout(() => {
    suppressNext = false;
    suppressTimer = null;
  }, 2000);
}

export function clearSuppression() {
  suppressNext = false;
  clearTimeout(suppressTimer);
  suppressTimer = null;
}

function isContentChange(event) {
  const t = event.type;
  if (typeof t === "object") {
    if ("access" in t) return false;
    if ("modify" in t && typeof t.modify === "object" && t.modify.kind === "metadata") return false;
  }
  return true;
}

export async function startWatching(filePath) {
  await stopWatching();
  clearTimeout(suppressTimer);
  suppressTimer = null;
  suppressNext = false;
  if (!filePath) return;

  try {
    unwatchFn = await watch(filePath, (event) => {
      if (!isContentChange(event)) return;
      if (suppressNext) {
        clearSuppression();
        return;
      }
      if (onExternalChange) {
        onExternalChange(filePath);
      }
    }, { delayMs: 500 });
  } catch (err) {
    console.error("File watch failed:", err);
  }
}

export async function stopWatching() {
  if (unwatchFn) {
    unwatchFn();
    unwatchFn = null;
  }
}
