import { marked } from "marked";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  LevelFormat,
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

  // Verify separator row (2nd line must be like | --- | --- |)
  if (!/^\|[\s:-]+\|/.test(lines[1])) return null;

  const parseRow = (line) =>
    line
      .split("|")
      .slice(1, -1) // remove empty first/last from leading/trailing |
      .map((cell) => cell.trim());

  const headerCells = parseRow(lines[0]);
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

/**
 * Convert Markdown string to a docx Document.
 */
export function markdownToDocx(md) {
  // Normalize <br> to newline before processing
  let text = md.replace(/<br\s*\/?>/gi, "\n");

  // Split into blocks by double newline
  const blocks = text.split(/\n{2,}/);
  const paragraphs = [];

  // Track ordered list numbering reference
  let hasNumberedList = false;

  // First pass: check if we need numbered list config
  for (const block of blocks) {
    const trimmed = block.trim();
    if (/^\d+\.\s/.test(trimmed)) {
      hasNumberedList = true;
      break;
    }
  }

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    // Heading
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      const level = headingMatch[1].length - 1; // 0-indexed
      const headingText = headingMatch[2];
      paragraphs.push(
        new Paragraph({
          heading: HEADING_LEVELS[level],
          children: processFormattedText(headingText),
        })
      );
      continue;
    }

    // Table
    if (/^\|/.test(trimmed)) {
      const table = parseMarkdownTable(trimmed);
      if (table) {
        paragraphs.push(table);
        continue;
      }
    }

    // Unordered list (may have multiple lines)
    if (/^[-*+]\s/.test(trimmed)) {
      const items = trimmed.split("\n");
      for (const item of items) {
        const itemText = item.replace(/^[-*+]\s+/, "");
        paragraphs.push(
          new Paragraph({
            bullet: { level: 0 },
            children: processFormattedText(itemText),
          })
        );
      }
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(trimmed)) {
      const items = trimmed.split("\n");
      for (const item of items) {
        const itemText = item.replace(/^\d+\.\s+/, "");
        paragraphs.push(
          new Paragraph({
            numbering: { reference: "default-numbering", level: 0 },
            children: processFormattedText(itemText),
          })
        );
      }
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(trimmed)) {
      const quoteText = trimmed.replace(/^>\s?/gm, "");
      paragraphs.push(
        new Paragraph({
          indent: { left: 720 },
          children: processFormattedText(quoteText),
        })
      );
      continue;
    }

    // Normal paragraph
    paragraphs.push(
      new Paragraph({
        children: processFormattedText(trimmed),
      })
    );
  }

  const numbering = hasNumberedList
    ? {
        config: [
          {
            reference: "default-numbering",
            levels: [
              {
                level: 0,
                format: LevelFormat.DECIMAL,
                text: "%1.",
                alignment: AlignmentType.START,
              },
            ],
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

export async function exportDocx(md) {
  const path = await save({
    filters: [{ name: t("filter.word"), extensions: ["docx"] }],
  });
  if (!path) return null;

  const doc = markdownToDocx(md);
  const arrayBuffer = await Packer.toArrayBuffer(doc);
  await writeFile(path, new Uint8Array(arrayBuffer));
  return path;
}

export async function exportHtml(md) {
  const path = await save({
    filters: [{ name: t("filter.html"), extensions: ["html"] }],
  });
  if (!path) return null;

  const html = marked.parse(md);
  const content = `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<title>Exported</title>
</head><body>${html}</body></html>`;
  await writeTextFile(path, content);
  return path;
}

export async function exportTxt(md) {
  const path = await save({
    filters: [{ name: t("filter.plainText"), extensions: ["txt"] }],
  });
  if (!path) return null;

  const plainText = stripMarkdown(md);
  await writeTextFile(path, plainText);
  return path;
}
