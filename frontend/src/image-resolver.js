import { convertFileSrc } from "@tauri-apps/api/core";

/**
 * Normalize a file path: resolve `.` and `..` segments.
 * Preserves the original separator style (backslash on Windows).
 */
function normalizePath(p) {
  const sep = p.includes("\\") ? "\\" : "/";
  const parts = p.replace(/[\\/]/g, "/").split("/");
  const result = [];
  for (const part of parts) {
    if (part === ".") continue;
    if (part === ".." && result.length > 1) {
      result.pop();
    } else {
      result.push(part);
    }
  }
  return result.join(sep);
}

/**
 * Resolve a possibly-relative src to an absolute file path.
 * Returns null if the src is an external URL (http, data, blob).
 */
function resolveSrc(src, dir) {
  const decoded = decodeURIComponent(src);
  if (/^(https?|data|blob):/.test(decoded)) return null;
  // Already absolute (Windows drive letter or UNC path)
  if (/^[A-Za-z]:[\\/]/.test(decoded) || decoded.startsWith("\\\\")) {
    return normalizePath(decoded);
  }
  return normalizePath(dir + "/" + decoded);
}

/**
 * Post-process HTML from marked.parse() to resolve relative image paths
 * into Tauri asset protocol URLs for webview display.
 */
export function resolvePreviewImages(html, currentFilePath) {
  if (!currentFilePath) return html;
  const dir = currentFilePath.replace(/[\\/][^\\/]+$/, "");
  return html.replace(/<img\s+src="([^"]*)"/g, (match, src) => {
    const resolved = resolveSrc(src, dir);
    if (!resolved) return match;
    return `<img src="${convertFileSrc(resolved)}"`;
  });
}

/**
 * Post-process HTML from marked.parse() to resolve relative image paths
 * into file:/// URLs for standalone HTML export.
 */
export function resolveExportImages(html, currentFilePath) {
  if (!currentFilePath) return html;
  const dir = currentFilePath.replace(/[\\/][^\\/]+$/, "");
  return html.replace(/<img\s+src="([^"]*)"/g, (match, src) => {
    const resolved = resolveSrc(src, dir);
    if (!resolved) return match;
    return `<img src="file:///${resolved.replace(/\\/g, "/")}"`;
  });
}
