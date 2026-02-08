import { marked } from "marked";
import html2pdf from "html2pdf.js";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { t } from "./i18n.js";
import { resolvePreviewImages } from "./image-resolver.js";

// --- DOM refs ---
const overlay = document.getElementById("export-modal");
const titleEl = document.getElementById("em-title");
const closeBtn = document.getElementById("em-close");
const cancelBtn = document.getElementById("em-cancel");
const exportBtn = document.getElementById("em-export");
const marginTop = document.getElementById("em-margin-top");
const marginRight = document.getElementById("em-margin-right");
const marginBottom = document.getElementById("em-margin-bottom");
const marginLeft = document.getElementById("em-margin-left");
const scaleRange = document.getElementById("em-scale");
const scaleLabel = document.getElementById("em-scale-label");
const dpiSelect = document.getElementById("em-dpi");
const pageSizeSelect = document.getElementById("em-page-size");
const usePreviewStyleCheck = document.getElementById("em-use-preview-style");
const avoidBreakCheck = document.getElementById("em-avoid-break-inside");
const previewFrame = document.getElementById("em-preview-frame");

let currentMd = "";
let currentFilePath = null;
let onExportDone = null;

// --- CSS helpers ---
function getPreviewCustomCss() {
  const el = document.getElementById("preview-custom-style");
  return el ? el.textContent : "";
}

// Base markdown styles (element selectors — work inside .page div)
const BASE_CSS = `
  h1, h2, h3 { border-bottom: 1px solid #eaecef; padding-bottom: .3em; }
  code { background-color: #f6f8fa; padding: 0.2em 0.4em; border-radius: 3px; font-family: monospace; }
  pre { background-color: #f6f8fa; padding: 16px; overflow: auto; border-radius: 6px; }
  blockquote { border-left: 4px solid #dfe2e5; color: #6a737d; padding-left: 1em; margin: 0; }
  ul, ol { padding-left: 2em; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #eaecef; padding: 6px 13px; }
  img { max-width: 100%; }
`;

function getCustomCss(usePreviewStyle) {
  if (!usePreviewStyle) return "";
  // Remap #preview-pane to .page for preview, or to the wrapper div for PDF
  return getPreviewCustomCss().replace(/#preview-pane/g, ".page");
}

// --- Page sizes (mm) ---
const PAGE_SIZES = {
  a4:     { w: 210,   h: 297,   jsPdf: "a4" },
  a3:     { w: 297,   h: 420,   jsPdf: "a3" },
  b4:     { w: 250,   h: 353,   jsPdf: [250, 353] },
  b5:     { w: 176,   h: 250,   jsPdf: [176, 250] },
  letter: { w: 215.9, h: 279.4, jsPdf: "letter" },
  legal:  { w: 215.9, h: 355.6, jsPdf: "legal" },
};
const MM2PX = 3.78; // 1mm ≈ 3.78px at 96dpi

function getSettings() {
  return {
    marginTop: parseInt(marginTop.value) || 15,
    marginRight: parseInt(marginRight.value) || 15,
    marginBottom: parseInt(marginBottom.value) || 15,
    marginLeft: parseInt(marginLeft.value) || 15,
    scale: parseInt(scaleRange.value) || 100,
    dpi: parseInt(dpiSelect.value) || 2,
    pageSize: PAGE_SIZES[pageSizeSelect.value] || PAGE_SIZES.a4,
    usePreviewStyle: usePreviewStyleCheck.checked,
    avoidBreakInside: avoidBreakCheck.checked,
  };
}

// --- Preview: shows scaled pages on gray background ---
function updatePreview() {
  const opts = getSettings();
  const html = resolvePreviewImages(marked.parse(currentMd), currentFilePath);
  const customCss = getCustomCss(opts.usePreviewStyle);

  const pageW = opts.pageSize.w * MM2PX;
  const pageH = opts.pageSize.h * MM2PX;

  const pageCSS = `
    width: ${pageW}px;
    background: #fff;
    color: #333;
    font-family: sans-serif;
    line-height: 1.6;
    font-size: ${opts.scale}%;
    padding: ${opts.marginTop}mm ${opts.marginRight}mm ${opts.marginBottom}mm ${opts.marginLeft}mm;
    box-shadow: 0 2px 12px rgba(0,0,0,0.4);
    transform-origin: top center;
    flex-shrink: 0;
    overflow: hidden;
  `;

  const doc = previewFrame.contentDocument;
  doc.open();
  doc.write(`<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: #555;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px;
  gap: 16px;
  overflow-y: auto;
}
.page { ${pageCSS} height: ${pageH}px; }
.page-measure { ${pageCSS} height: auto; position: absolute; visibility: hidden; }
${BASE_CSS}
${customCss}
</style>
</head><body>
<div class="page-measure">${html}</div>
</body></html>`);
  doc.close();

  requestAnimationFrame(() => {
    const measure = doc.querySelector(".page-measure");
    if (!measure) return;

    const style = doc.defaultView.getComputedStyle(measure);
    const padTop = parseFloat(style.paddingTop);
    const contentH = pageH - padTop - parseFloat(style.paddingBottom);
    const fullH = measure.scrollHeight - padTop;
    const HEADING_RESERVE = 80;

    if (fullH <= contentH) {
      // Single page
      measure.remove();
      const p = doc.createElement("div");
      p.className = "page";
      p.innerHTML = html;
      doc.body.appendChild(p);
      fitPages(doc, pageW, pageH);
      return;
    }

    // Collect heading positions for heading-orphan protection
    const children = Array.from(measure.children);
    const headings = [];
    for (const child of children) {
      if (/^H[1-6]$/i.test(child.tagName)) {
        headings.push({
          top: child.offsetTop - padTop,
          bottom: child.offsetTop - padTop + child.offsetHeight,
        });
      }
    }

    if (opts.avoidBreakInside) {
      // --- Strict mode: break only between elements ---
      const pageGroups = [[]];
      let pageTop = 0;

      for (let i = 0; i < children.length; i++) {
        const el = children[i];
        const elTop = el.offsetTop - padTop;
        const elBottom = elTop + el.offsetHeight;
        const isHeading = /^H[1-6]$/i.test(el.tagName);

        if (elBottom > pageTop + contentH && pageGroups[pageGroups.length - 1].length > 0) {
          pageTop = elTop;
          pageGroups.push([]);
        }

        pageGroups[pageGroups.length - 1].push(el);

        if (isHeading && i < children.length - 1) {
          const remaining = (pageTop + contentH) - elBottom;
          if (remaining < HEADING_RESERVE) {
            pageGroups[pageGroups.length - 1].pop();
            pageTop = elTop;
            pageGroups.push([el]);
          }
        }
      }

      measure.remove();
      for (const group of pageGroups) {
        const pageDiv = doc.createElement("div");
        pageDiv.className = "page";
        for (const el of group) pageDiv.appendChild(el);
        doc.body.appendChild(pageDiv);
      }
    } else {
      // --- Default: pixel-based, but snap to line gaps & protect headings ---
      const docView = doc.defaultView;

      // Snap a Y position to the nearest line boundary (round down)
      function snapToLineGap(y) {
        for (const child of children) {
          const elTop = child.offsetTop - padTop;
          const elBottom = elTop + child.offsetHeight;
          if (y <= elTop || y >= elBottom) continue;

          // Break falls inside this element — find line boundary
          const cs = docView.getComputedStyle(child);
          const lineH = parseFloat(cs.lineHeight);
          if (!lineH || lineH <= 0) return y;

          const elPad = parseFloat(cs.paddingTop) || 0;
          const elBorder = parseFloat(cs.borderTopWidth) || 0;
          const textStart = elTop + elPad + elBorder;
          const into = y - textStart;

          if (into <= 0) return elTop;

          // Round down to a complete line
          return textStart + Math.floor(into / lineH) * lineH;
        }
        return y;
      }

      const breaks = [0];
      let pos = 0;

      while (pos + contentH < fullH) {
        let nextBreak = pos + contentH;

        // If a heading sits near this break point, break before it
        for (const h of headings) {
          if (h.top > pos && h.top < nextBreak && (nextBreak - h.top) < HEADING_RESERVE) {
            nextBreak = h.top;
            break;
          }
        }

        // Snap to line gap so text doesn't get cut mid-character
        nextBreak = snapToLineGap(nextBreak);
        if (nextBreak <= pos) nextBreak = pos + contentH;

        breaks.push(nextBreak);
        pos = nextBreak;
      }

      measure.remove();
      for (let i = 0; i < breaks.length; i++) {
        const clipH = (i < breaks.length - 1) ? breaks[i + 1] - breaks[i] : fullH - breaks[i];
        const pageDiv = doc.createElement("div");
        pageDiv.className = "page";
        pageDiv.innerHTML = `<div style="overflow:hidden;height:${clipH}px"><div style="margin-top:${-breaks[i]}px">${html}</div></div>`;
        doc.body.appendChild(pageDiv);
      }
    }

    fitPages(doc, pageW, pageH);
  });
}

function fitPages(doc, pageW, pageH) {
  const iframeW = previewFrame.clientWidth;
  const fitScale = (iframeW - 32) / pageW;
  if (fitScale < 1) {
    doc.querySelectorAll(".page").forEach(p => {
      p.style.transform = `scale(${fitScale})`;
      p.style.marginBottom = `${-(pageH * (1 - fitScale))}px`;
    });
  }
}

// --- Public: open modal ---
function replaceExt(filePath, newExt) {
  if (!filePath) return undefined;
  return filePath.replace(/\.[^.\\/]+$/, "." + newExt);
}

export function openExportModal(md, currentPath) {
  currentMd = md;
  currentFilePath = currentPath || null;
  titleEl.textContent = t("exportModal.titlePdf");
  overlay.classList.add("open");
  updatePreview();

  return new Promise((resolve) => {
    onExportDone = resolve;
  });
}

function closeModal(result) {
  overlay.classList.remove("open");
  if (onExportDone) {
    onExportDone(result);
    onExportDone = null;
  }
}

// --- PDF Export ---
async function doExport() {
  const opts = getSettings();
  const path = await save({
    defaultPath: replaceExt(currentFilePath, "pdf"),
    filters: [{ name: t("filter.pdf"), extensions: ["pdf"] }],
  });
  if (!path) return null;

  const html = resolvePreviewImages(marked.parse(currentMd), currentFilePath);
  const customCss = getCustomCss(opts.usePreviewStyle).replace(/\.page/g, "div");

  const htmlString = `<div style="font-family:sans-serif;line-height:1.6;color:#333;font-size:${opts.scale}%;">
    <style>${BASE_CSS}${customCss}</style>
    ${html}
  </div>`;

  const pdfBlob = await html2pdf()
    .set({
      margin: [opts.marginTop, opts.marginRight, opts.marginBottom, opts.marginLeft],
      image: { type: "jpeg", quality: 0.95 },
      html2canvas: { scale: opts.dpi, useCORS: true },
      jsPDF: { unit: "mm", format: opts.pageSize.jsPdf, orientation: "portrait" },
    })
    .from(htmlString, "string")
    .outputPdf("arraybuffer");

  await writeFile(path, new Uint8Array(pdfBlob));
  return path;
}

// --- Event listeners ---
function onSettingChange() {
  scaleLabel.textContent = scaleRange.value;
  updatePreview();
}

closeBtn.addEventListener("click", () => closeModal(null));
cancelBtn.addEventListener("click", () => closeModal(null));
overlay.addEventListener("click", (e) => {
  if (e.target === overlay) closeModal(null);
});

exportBtn.addEventListener("click", async () => {
  const result = await doExport();
  closeModal(result);
});

marginTop.addEventListener("input", onSettingChange);
marginRight.addEventListener("input", onSettingChange);
marginBottom.addEventListener("input", onSettingChange);
marginLeft.addEventListener("input", onSettingChange);
scaleRange.addEventListener("input", onSettingChange);
dpiSelect.addEventListener("change", onSettingChange);
pageSizeSelect.addEventListener("change", onSettingChange);
usePreviewStyleCheck.addEventListener("change", onSettingChange);
avoidBreakCheck.addEventListener("change", onSettingChange);
