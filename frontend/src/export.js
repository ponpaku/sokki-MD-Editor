import { marked } from "marked";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  LevelFormat,
  LevelSuffix,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
} from "docx";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { t } from "./i18n.js";
import { resolveExportImages } from "./image-resolver.js";

// --- Plain Text Export ---

/**
 * Strip Markdown formatting, returning plain text.
 * Mirrors the Python version's conversion rules.
 */
export function stripMarkdown(md) {
  let text = md;
  // <br> tags → newline
  text = text.replace(/<br\s*\/?>/gi, "\n");
  // headings: remove leading #s
  text = text.replace(/^#{1,6}\s+/gm, "");
  // bold/italic
  text = text.replace(/\*\*\*(.+?)\*\*\*/g, "$1");
  text = text.replace(/\*\*(.+?)\*\*/g, "$1");
  text = text.replace(/\*(.+?)\*/g, "$1");
  text = text.replace(/___(.+?)___/g, "$1");
  text = text.replace(/__(.+?)__/g, "$1");
  text = text.replace(/_(.+?)_/g, "$1");
  // strikethrough
  text = text.replace(/~~(.+?)~~/g, "$1");
  // inline code
  text = text.replace(/`(.+?)`/g, "$1");
  // images: ![alt](url) → alt
  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");
  // links: [text](url) → text
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  // unordered list markers
  text = text.replace(/^(\s*)[-*+]\s+/gm, "$1");
  // ordered list markers
  text = text.replace(/^(\s*)\d+\.\s+/gm, "$1");
  // blockquotes
  text = text.replace(/^>\s?/gm, "");
  // table separator rows (| --- | --- |)
  text = text.replace(/^\|[\s:-]+\|\s*$/gm, "");
  // table rows: | cell | cell | → cell\tcell
  text = text.replace(/^\|(.+)\|\s*$/gm, (_match, inner) =>
    inner.split("|").map((c) => c.trim()).join("\t")
  );
  // horizontal rules
  text = text.replace(/^[-*_]{3,}\s*$/gm, "");
  // remaining HTML tags
  text = text.replace(/<[^>]+>/g, "");
  return text;
}

// --- DOCX Export ---

/**
 * Process text that may contain **bold** and \n (soft break),
 * returning an array of TextRun objects.
 */
function processFormattedText(text) {
  const runs = [];
  // Split on bold markers first
  const boldParts = text.split(/(\*\*[^*]+\*\*)/);
  for (const part of boldParts) {
    if (!part) continue;
    const boldMatch = part.match(/^\*\*(.+)\*\*$/);
    const isBold = !!boldMatch;
    const content = isBold ? boldMatch[1] : part;

    // Split on newlines to insert soft breaks
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) {
        runs.push(new TextRun({ break: 1 }));
      }
      if (lines[i]) {
        runs.push(new TextRun({ text: lines[i], bold: isBold }));
      }
    }
  }
  return runs;
}

/**
 * Parse a Markdown table block into a docx Table.
 * Expects lines like: | col1 | col2 | with a separator row (| --- | --- |).
 */
function parseMarkdownTable(block) {
  const lines = block.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return null;

  // Accept both "| a | b |" and "a | b" table syntaxes.
  const separator = lines[1].trim();
  if (!/^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?$/.test(separator)) return null;

  const parseRow = (line) => {
    let row = line.trim();
    if (row.startsWith("|")) row = row.slice(1);
    if (row.endsWith("|")) row = row.slice(0, -1);
    return row.split("|").map((cell) => cell.trim());
  };

  const headerCells = parseRow(lines[0]);
  if (headerCells.length === 0) return null;
  const dataRows = lines.slice(2).map(parseRow);

  const colCount = headerCells.length;

  // A4 content width with default margins ≈ 9026 twips (DXA)
  const TABLE_WIDTH = 9026;
  const cellWidth = Math.floor(TABLE_WIDTH / colCount);

  const makeCells = (cells, bold) =>
    cells.slice(0, colCount).map(
      (text) =>
        new TableCell({
          width: { size: cellWidth, type: WidthType.DXA },
          children: [
            new Paragraph({ children: processFormattedText(bold ? `**${text}**` : text) }),
          ],
        })
    );

  // Pad rows that have fewer cells than the header
  const padRow = (cells) => {
    const padded = [...cells];
    while (padded.length < colCount) padded.push("");
    return padded;
  };

  const rows = [
    new TableRow({ children: makeCells(padRow(headerCells), true) }),
    ...dataRows.map(
      (cells) => new TableRow({ children: makeCells(padRow(cells), false) })
    ),
  ];

  return new Table({
    rows,
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    columnWidths: Array(colCount).fill(cellWidth),
  });
}
const HEADING_LEVELS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
];

const MAX_LIST_LEVEL = 8;

function clampListLevel(level) {
  return Math.max(0, Math.min(MAX_LIST_LEVEL, level));
}

function textRunsOrEmpty(text) {
  const runs = processFormattedText(text || "");
  return runs.length > 0 ? runs : [new TextRun("")];
}

function extractListItemText(item) {
  const tokens = Array.isArray(item?.tokens) ? item.tokens : [];
  const parts = [];
  for (const token of tokens) {
    if (!token || token.type === "list" || token.type === "space") continue;
    if (typeof token.text === "string" && token.text.length > 0) {
      parts.push(token.text);
      continue;
    }
    if (typeof token.raw === "string") {
      const raw = token.raw.trim();
      if (raw.length > 0) parts.push(raw);
    }
  }

  let text = parts.join("\n").trim();
  if (!text && typeof item?.text === "string") {
    const firstLine = item.text.split("\n").find((line) => line.trim().length > 0) || "";
    text = firstLine.trim();
  }

  if (item?.task) {
    const checked = item.checked ? "x" : " ";
    text = `[${checked}]${text ? ` ${text}` : ""}`;
  }
  return text;
}

function renderListToken(listToken, level, paragraphs, state) {
  const listLevel = clampListLevel(level);
  const items = Array.isArray(listToken?.items) ? listToken.items : [];
  if (listToken?.ordered) {
    state.hasNumberedList = true;
  }

  for (const item of items) {
    const itemText = extractListItemText(item);
    if (listToken?.ordered) {
      paragraphs.push(
        new Paragraph({
          numbering: { reference: "default-numbering", level: listLevel },
          children: textRunsOrEmpty(itemText),
        })
      );
    } else {
      paragraphs.push(
        new Paragraph({
          bullet: { level: listLevel },
          children: textRunsOrEmpty(itemText),
        })
      );
    }

    const nestedLists = (Array.isArray(item?.tokens) ? item.tokens : []).filter((token) => token?.type === "list");
    for (const nested of nestedLists) {
      renderListToken(nested, listLevel + 1, paragraphs, state);
    }
  }
}

function renderMarkdownTokens(tokens, paragraphs, state) {
  for (const token of tokens || []) {
    if (!token || token.type === "space") continue;

    if (token.type === "heading") {
      const level = Math.max(0, Math.min(HEADING_LEVELS.length - 1, (token.depth || 1) - 1));
      paragraphs.push(
        new Paragraph({
          heading: HEADING_LEVELS[level],
          children: textRunsOrEmpty(token.text || ""),
        })
      );
      continue;
    }

    if (token.type === "table") {
      const table = parseMarkdownTable(token.raw || "");
      if (table) {
        paragraphs.push(table);
      } else {
        const fallback = (token.raw || "").trim();
        if (fallback) {
          paragraphs.push(
            new Paragraph({
              children: textRunsOrEmpty(fallback),
            })
          );
        }
      }
      continue;
    }

    if (token.type === "list") {
      renderListToken(token, 0, paragraphs, state);
      continue;
    }

    if (token.type === "blockquote") {
      paragraphs.push(
        new Paragraph({
          indent: { left: 720 },
          children: textRunsOrEmpty(token.text || token.raw || ""),
        })
      );
      continue;
    }

    if (token.type === "paragraph" || token.type === "text") {
      paragraphs.push(
        new Paragraph({
          children: textRunsOrEmpty(token.text || ""),
        })
      );
      continue;
    }

    if (token.type === "code") {
      paragraphs.push(
        new Paragraph({
          children: textRunsOrEmpty(token.text || ""),
        })
      );
      continue;
    }

    const fallbackText =
      typeof token.text === "string"
        ? token.text
        : typeof token.raw === "string"
          ? token.raw.trim()
          : "";
    if (!fallbackText) continue;
    paragraphs.push(
      new Paragraph({
        children: textRunsOrEmpty(fallbackText),
      })
    );
  }
}

/**
 * Convert Markdown string to a docx Document.
 */
export function markdownToDocx(md) {
  // Normalize <br> to newline before processing
  const text = md.replace(/<br\s*\/?>/gi, "\n");

  const tokens = marked.lexer(text);
  const paragraphs = [];
  const state = { hasNumberedList: false };
  renderMarkdownTokens(tokens, paragraphs, state);

  const numbering = state.hasNumberedList
    ? {
        config: [
          {
            reference: "default-numbering",
            levels: Array.from({ length: MAX_LIST_LEVEL + 1 }, (_, level) => ({
              level,
              format: LevelFormat.DECIMAL,
              suffix: LevelSuffix.SPACE,
              text: `%${level + 1}.`,
              alignment: AlignmentType.START,
              style: {
                paragraph: {
                  indent: {
                    left: 720 * (level + 1),
                    hanging: 360,
                  },
                },
              },
            })),
          },
        ],
      }
    : undefined;

  return new Document({
    numbering,
    sections: [{ children: paragraphs }],
  });
}
// --- Export Actions ---

function replaceExt(filePath, newExt) {
  if (!filePath) return undefined;
  return filePath.replace(/\.[^.\\/]+$/, "." + newExt);
}

export async function exportDocx(md, currentPath) {
  const path = await save({
    defaultPath: replaceExt(currentPath, "docx"),
    filters: [{ name: t("filter.word"), extensions: ["docx"] }],
  });
  if (!path) return null;

  const doc = markdownToDocx(md);
  const arrayBuffer = await Packer.toArrayBuffer(doc);
  await writeFile(path, new Uint8Array(arrayBuffer));
  return path;
}

export async function exportHtml(md, currentPath) {
  const path = await save({
    defaultPath: replaceExt(currentPath, "html"),
    filters: [{ name: t("filter.html"), extensions: ["html"] }],
  });
  if (!path) return null;

  const html = resolveExportImages(marked.parse(md), currentPath);
  const content = `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<title>Exported</title>
</head><body>${html}</body></html>`;
  await writeTextFile(path, content);
  return path;
}

export async function exportTxt(md, currentPath) {
  const path = await save({
    defaultPath: replaceExt(currentPath, "txt"),
    filters: [{ name: t("filter.plainText"), extensions: ["txt"] }],
  });
  if (!path) return null;

  const plainText = stripMarkdown(md);
  await writeTextFile(path, plainText);
  return path;
}
