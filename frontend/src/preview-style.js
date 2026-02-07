import { t } from "./i18n.js";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

const STORAGE_KEY = "sokki-preview-style";
const STORAGE_PRESET_KEY = "sokki-preview-preset";

const presets = {
  default: "",
  serif: `#preview-pane {
  font-family: "Georgia", "Times New Roman", "YuMincho", "Yu Mincho", serif;
  font-size: 17px;
  line-height: 1.8;
}
#preview-pane h1, #preview-pane h2, #preview-pane h3,
#preview-pane h4, #preview-pane h5, #preview-pane h6 {
  font-family: "Georgia", "Times New Roman", "YuMincho", "Yu Mincho", serif;
}`,
  compact: `#preview-pane {
  font-size: 14px;
  line-height: 1.4;
  padding: 12px;
}
#preview-pane h1 { font-size: 1.4em; }
#preview-pane h2 { font-size: 1.2em; }
#preview-pane h3 { font-size: 1.1em; }
#preview-pane p, #preview-pane li { margin: 0.3em 0; }`,
  github: `#preview-pane {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  font-size: 16px;
  line-height: 1.5;
}
#preview-pane h1 { font-size: 2em; padding-bottom: .3em; }
#preview-pane h2 { font-size: 1.5em; padding-bottom: .3em; }
#preview-pane h3 { font-size: 1.25em; }
#preview-pane code {
  font-size: 85%;
  padding: .2em .4em;
  border-radius: 6px;
}
#preview-pane pre { padding: 16px; border-radius: 6px; line-height: 1.45; }
#preview-pane blockquote {
  padding: 0 1em;
  border-left-width: .25em;
}
#preview-pane table { border-collapse: collapse; width: 100%; }
#preview-pane th, #preview-pane td {
  border: 1px solid var(--border-heading);
  padding: 6px 13px;
}`,
};

let styleEl = null;
let currentPreset = "default";
let customCss = "";

function getStyleEl() {
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "preview-custom-style";
    document.head.appendChild(styleEl);
  }
  return styleEl;
}

export function applyPreviewStyle(css) {
  getStyleEl().textContent = css;
}

export function loadSavedStyle() {
  currentPreset = localStorage.getItem(STORAGE_PRESET_KEY) || "default";
  customCss = localStorage.getItem(STORAGE_KEY) || "";

  if (customCss) {
    applyPreviewStyle(customCss);
  } else if (currentPreset !== "default") {
    applyPreviewStyle(presets[currentPreset] || "");
  }
}

function saveStyle() {
  localStorage.setItem(STORAGE_PRESET_KEY, currentPreset);
  localStorage.setItem(STORAGE_KEY, customCss);
}

export function initPreviewStylePanel() {
  const panel = document.getElementById("preview-style-panel");
  const toggle = document.getElementById("preview-style-toggle");
  if (!panel || !toggle) return;

  renderPanel(panel);

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.classList.toggle("open");
  });

  document.addEventListener("click", (e) => {
    if (!panel.contains(e.target) && !toggle.contains(e.target)) {
      panel.classList.remove("open");
    }
  });
}

function renderPanel(panel) {
  const presetKeys = Object.keys(presets);

  panel.innerHTML = `
    <h4 class="psp-title">${t("previewStyle.title")}</h4>
    <div class="psp-section-label">${t("previewStyle.preset")}</div>
    <div class="psp-presets">
      ${presetKeys
        .map(
          (key) => `
        <button class="psp-preset-card ${key === currentPreset && !customCss ? "active" : ""}"
                data-preset="${key}">
          ${t("preset." + key)}
        </button>`
        )
        .join("")}
    </div>
    <div class="psp-section-label">${t("previewStyle.custom")}</div>
    <textarea class="psp-textarea" id="psp-css-editor"
              placeholder="${t("previewStyle.customPlaceholder")}"
              spellcheck="false">${customCss}</textarea>
    <div class="psp-actions">
      <button class="psp-btn psp-btn-secondary" id="psp-import">${t("previewStyle.import")}</button>
      <button class="psp-btn psp-btn-secondary" id="psp-export">${t("previewStyle.export")}</button>
    </div>
    <hr class="psp-divider">
    <div class="psp-actions">
      <button class="psp-btn" id="psp-apply">${t("previewStyle.apply")}</button>
      <button class="psp-btn psp-btn-secondary" id="psp-reset">${t("previewStyle.reset")}</button>
    </div>
  `;

  // Preset card clicks
  panel.querySelectorAll(".psp-preset-card").forEach((card) => {
    card.addEventListener("click", () => {
      const key = card.dataset.preset;
      currentPreset = key;
      customCss = "";
      applyPreviewStyle(presets[key] || "");
      saveStyle();

      // Update active state
      panel.querySelectorAll(".psp-preset-card").forEach((c) => c.classList.remove("active"));
      card.classList.add("active");
      panel.querySelector("#psp-css-editor").value = "";
    });
  });

  // Live preview on input
  const cssEditor = panel.querySelector("#psp-css-editor");
  cssEditor.addEventListener("input", () => {
    applyPreviewStyle(cssEditor.value);
  });

  // Apply button — save custom CSS
  panel.querySelector("#psp-apply").addEventListener("click", () => {
    customCss = cssEditor.value;
    if (customCss) {
      currentPreset = "default";
      panel.querySelectorAll(".psp-preset-card").forEach((c) => c.classList.remove("active"));
    }
    applyPreviewStyle(customCss || presets[currentPreset] || "");
    saveStyle();
  });

  // Reset button
  panel.querySelector("#psp-reset").addEventListener("click", () => {
    currentPreset = "default";
    customCss = "";
    cssEditor.value = "";
    applyPreviewStyle("");
    saveStyle();

    panel.querySelectorAll(".psp-preset-card").forEach((c) => c.classList.remove("active"));
    panel.querySelector('[data-preset="default"]').classList.add("active");
  });

  // Export CSS
  panel.querySelector("#psp-export").addEventListener("click", async () => {
    const css = cssEditor.value || presets[currentPreset] || "";
    if (!css) return;
    const path = await save({
      filters: [{ name: t("filter.css"), extensions: ["css"] }],
    });
    if (!path) return;
    await writeTextFile(path, css);
  });

  // Import CSS
  panel.querySelector("#psp-import").addEventListener("click", async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: t("filter.css"), extensions: ["css"] }],
    });
    if (!selected) return;
    const css = await readTextFile(selected);
    cssEditor.value = css;
    customCss = css;
    currentPreset = "default";
    applyPreviewStyle(css);
    saveStyle();
    panel.querySelectorAll(".psp-preset-card").forEach((c) => c.classList.remove("active"));
  });
}
