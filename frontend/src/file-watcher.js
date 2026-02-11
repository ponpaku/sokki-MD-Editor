import { watch } from "@tauri-apps/plugin-fs";

let unwatchFn = null;
let suppressNext = false;
let onExternalChange = null;

export function setExternalChangeHandler(callback) {
  onExternalChange = callback;
}

export function suppressNextChange() {
  suppressNext = true;
}

export function clearSuppression() {
  suppressNext = false;
}

export async function startWatching(filePath) {
  await stopWatching();
  suppressNext = false;
  if (!filePath) return;

  try {
    unwatchFn = await watch(filePath, (event) => {
      if (suppressNext) {
        suppressNext = false;
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
