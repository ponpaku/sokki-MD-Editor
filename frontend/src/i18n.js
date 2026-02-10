const dictionaries = {
  en: {
    // header buttons
    "btn.open": "Open",
    "btn.save": "Save",
    "btn.saveAs": "Save As",
    "btn.themeToggle": "Toggle theme",
    // editor
    "editor.placeholder": "Type here...",
    // status
    "status.ready": "Ready",
    "status.opened": "Opened: {0}",
    "status.saved": "Saved: {0}",
    "status.openFailed": "Open failed",
    "status.saveFailed": "Save failed",
    "status.saveAsFailed": "Save As failed",
    "status.restored": "Restored from snapshot",
    "status.reloaded": "File reloaded (changed externally)",
    // conflict dialog
    "conflict.title": "File Changed",
    "conflict.message": "This file has been changed by another program. Reload the file?",
    "conflict.reload": "Reload",
    "conflict.keep": "Keep mine",
    // title
    "title.untitled": "Untitled",
    "title.suffix": "Sokki MD Editor",
    // export
    "btn.export": "Export",
    "export.word": "Word (.docx)",
    "export.plainText": "Plain Text (.txt)",
    "export.pdf": "PDF",
    "export.html": "HTML",
    "status.exported": "Exported: {0}",
    "status.exportFailed": "Export failed",
    // export modal
    "exportModal.titlePdf": "Export PDF",
    "exportModal.titleHtml": "Export HTML",
    "exportModal.pageSize": "Page Size",
    "exportModal.margins": "Margins (mm)",
    "exportModal.top": "Top",
    "exportModal.right": "Right",
    "exportModal.bottom": "Bottom",
    "exportModal.left": "Left",
    "exportModal.scale": "Scale (%)",
    "exportModal.dpi": "DPI (Resolution)",
    "exportModal.usePreviewStyle": "Use preview style",
    "exportModal.avoidBreakInside": "Avoid breaking inside elements",
    "exportModal.preview": "Preview",
    "exportModal.export": "Export",
    "exportModal.cancel": "Cancel",
    "filter.pdf": "PDF",
    "filter.html": "HTML",
    // preview style
    "previewStyle.title": "Preview Style",
    "previewStyle.preset": "Presets",
    "previewStyle.custom": "Custom CSS",
    "previewStyle.customPlaceholder": "#preview-pane { font-size: 18px; }",
    "previewStyle.apply": "Apply",
    "previewStyle.reset": "Reset",
    "previewStyle.export": "Export",
    "previewStyle.import": "Import",
    "filter.css": "CSS",
    "preset.default": "Default",
    "preset.serif": "Serif",
    "preset.compact": "Compact",
    "preset.github": "GitHub",
    // file filters
    "filter.markdown": "Markdown",
    "filter.text": "Text",
    "filter.word": "Word Document",
    "filter.plainText": "Plain Text",
    // autosave dialog
    "restore.message": "Unsaved data from last session was found. Restore?",
    "restore.title": "Restore Snapshot",
    "restore.ok": "Restore",
    "restore.cancel": "Discard",
    // help panel
    "help.title": "Sokki MD Editor — Help",
    "help.heading": "Heading:",
    "help.headingDesc": "{0} to {1} + {2}",
    "help.table": "Create table:",
    "help.tableDesc": "{0} to {1} + {2}",
    "help.tableCol": "Add column:",
    "help.tableColDesc": "In a table, {0}",
    "help.paragraph": "New paragraph:",
    "help.paragraphDesc": "{0} (inserts blank line)",
    "help.lineBreak": "Line break:",
    "help.lineBreakDesc": "{0} ({1})",
    "help.listContinue": "Continue list/table:",
    "help.listContinueDesc": "{0} at end of line",
    "help.bold": "Bold:",
    "help.italic": "Italic:",
    "help.underline": "Underline:",
    "help.fileOpen": "Open file:",
    "help.fileSave": "Save:",
    "help.fileSaveAs": "Save as:",
    "help.taskList": "Task list:",
    "help.taskListDesc": "{0} + {1}",
    "help.indent": "Indent list:",
    "help.indentDesc": "{0} on a list line",
    "help.outdent": "Outdent list:",
    "help.outdentDesc": "{0} on a list line",
    "help.note": "Also supports full-width #1 and t3.",
  },
  ja: {
    // header buttons
    "btn.open": "開く",
    "btn.save": "保存",
    "btn.saveAs": "名前を付けて保存",
    "btn.themeToggle": "テーマ切替",
    // editor
    "editor.placeholder": "ここに入力...",
    // status
    "status.ready": "準備完了",
    "status.opened": "開きました: {0}",
    "status.saved": "保存しました: {0}",
    "status.openFailed": "ファイルを開けませんでした",
    "status.saveFailed": "保存に失敗しました",
    "status.saveAsFailed": "名前を付けて保存に失敗しました",
    "status.restored": "スナップショットから復元しました",
    "status.reloaded": "ファイルを再読み込みしました（外部で変更）",
    // conflict dialog
    "conflict.title": "ファイルの変更",
    "conflict.message": "このファイルは他のプログラムによって変更されました。再読み込みしますか？",
    "conflict.reload": "再読み込み",
    "conflict.keep": "このまま続ける",
    // title
    "title.untitled": "無題",
    "title.suffix": "Sokki MD Editor",
    // export
    "btn.export": "書き出し",
    "export.word": "Word (.docx)",
    "export.plainText": "プレーンテキスト (.txt)",
    "export.pdf": "PDF",
    "export.html": "HTML",
    "status.exported": "書き出しました: {0}",
    "status.exportFailed": "書き出しに失敗しました",
    // export modal
    "exportModal.titlePdf": "PDF 書き出し",
    "exportModal.titleHtml": "HTML 書き出し",
    "exportModal.pageSize": "用紙サイズ",
    "exportModal.margins": "余白 (mm)",
    "exportModal.top": "上",
    "exportModal.right": "右",
    "exportModal.bottom": "下",
    "exportModal.left": "左",
    "exportModal.scale": "拡大率 (%)",
    "exportModal.dpi": "DPI (解像度)",
    "exportModal.usePreviewStyle": "プレビュースタイルを適用",
    "exportModal.avoidBreakInside": "要素の途中で改ページしない",
    "exportModal.preview": "プレビュー",
    "exportModal.export": "書き出し",
    "exportModal.cancel": "キャンセル",
    "filter.pdf": "PDF",
    "filter.html": "HTML",
    // preview style
    "previewStyle.title": "プレビュースタイル",
    "previewStyle.preset": "プリセット",
    "previewStyle.custom": "カスタム CSS",
    "previewStyle.customPlaceholder": "#preview-pane { font-size: 18px; }",
    "previewStyle.apply": "適用",
    "previewStyle.reset": "リセット",
    "previewStyle.export": "エクスポート",
    "previewStyle.import": "インポート",
    "filter.css": "CSS",
    "preset.default": "デフォルト",
    "preset.serif": "明朝体",
    "preset.compact": "コンパクト",
    "preset.github": "GitHub",
    // file filters
    "filter.markdown": "Markdown",
    "filter.text": "テキスト",
    "filter.word": "Word文書",
    "filter.plainText": "プレーンテキスト",
    // autosave dialog
    "restore.message": "前回の未保存データが見つかりました。復元しますか？",
    "restore.title": "スナップショットの復元",
    "restore.ok": "復元する",
    "restore.cancel": "破棄する",
    // help panel
    "help.title": "Sokki MD Editor 使い方",
    "help.heading": "見出し:",
    "help.headingDesc": "{0}〜{1} + {2}",
    "help.table": "表の作成:",
    "help.tableDesc": "{0}〜{1} + {2}",
    "help.tableCol": "表の列追加:",
    "help.tableColDesc": "表内で {0}",
    "help.paragraph": "段落変え:",
    "help.paragraphDesc": "{0} (空行が入ります)",
    "help.lineBreak": "改行:",
    "help.lineBreakDesc": "{0} ({1})",
    "help.listContinue": "リスト/表の継続:",
    "help.listContinueDesc": "文末で {0}",
    "help.bold": "太字:",
    "help.italic": "斜体:",
    "help.underline": "下線:",
    "help.fileOpen": "ファイルを開く:",
    "help.fileSave": "上書き保存:",
    "help.fileSaveAs": "名前を付けて保存:",
    "help.taskList": "タスクリスト:",
    "help.taskListDesc": "{0} + {1}",
    "help.indent": "リストのインデント:",
    "help.indentDesc": "リスト行で {0}",
    "help.outdent": "リストのアウトデント:",
    "help.outdentDesc": "リスト行で {0}",
    "help.note": "※全角の ＃１ や ｔ３ にも対応しています。",
  },
};

let currentLang = "en";

function detectLang() {
  const stored = localStorage.getItem("sokki-lang");
  if (stored && dictionaries[stored]) return stored;
  return navigator.language.startsWith("ja") ? "ja" : "en";
}

currentLang = detectLang();

export function getLang() {
  return currentLang;
}

export function t(key, ...args) {
  const dict = dictionaries[currentLang] || dictionaries.en;
  let str = dict[key] ?? dictionaries.en[key] ?? key;
  for (let i = 0; i < args.length; i++) {
    str = str.replace(`{${i}}`, args[i]);
  }
  return str;
}

export function applyTranslations() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
}

function kbd(text) {
  return `<kbd>${text}</kbd>`;
}

export function renderHelp() {
  const panel = document.getElementById("help-panel");
  if (!panel) return;

  const items = [
    { label: t("help.heading"), desc: t("help.headingDesc", kbd("#1"), kbd("#6"), kbd("Space/Tab")) },
    { label: t("help.table"), desc: t("help.tableDesc", kbd("t1"), kbd("t9"), kbd("Space/Tab")) },
    { label: t("help.tableCol"), desc: t("help.tableColDesc", kbd("Ctrl") + " + " + kbd(".")) },
    { label: t("help.taskList"), desc: t("help.taskListDesc", kbd("[]"), kbd("Space/Tab")) },
    { label: t("help.paragraph"), desc: t("help.paragraphDesc", kbd("Enter")) },
    { label: t("help.lineBreak"), desc: t("help.lineBreakDesc", kbd("Shift") + " + " + kbd("Enter"), `<code>&lt;br&gt;</code>`) },
    { label: t("help.listContinue"), desc: t("help.listContinueDesc", kbd("Enter")) },
    { label: t("help.indent"), desc: t("help.indentDesc", kbd("Tab")) },
    { label: t("help.outdent"), desc: t("help.outdentDesc", kbd("Shift") + " + " + kbd("Tab")) },
    { label: t("help.bold"), desc: kbd("Ctrl") + " + " + kbd("B") },
    { label: t("help.italic"), desc: kbd("Ctrl") + " + " + kbd("I") },
    { label: t("help.underline"), desc: kbd("Ctrl") + " + " + kbd("U") },
    { label: t("help.fileOpen"), desc: kbd("Ctrl") + " + " + kbd("O") },
    { label: t("help.fileSave"), desc: kbd("Ctrl") + " + " + kbd("S") },
    { label: t("help.fileSaveAs"), desc: kbd("Ctrl") + " + " + kbd("Shift") + " + " + kbd("S") },
  ];

  const listItems = items.map((item) => `<li><strong>${item.label}</strong> ${item.desc}</li>`).join("");

  panel.innerHTML = `
    <h3>${t("help.title")}</h3>
    <ul>${listItems}</ul>
    <p style="font-size: 0.75rem; color: var(--fg-help-note); border-top: 1px solid var(--border-help-note); padding-top: 8px; margin-top: 10px;">
      ${t("help.note")}
    </p>
  `;
}
