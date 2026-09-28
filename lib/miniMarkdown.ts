/* ------------------------------------------------------------------ *
 * A renderer for exactly one file: content/evaluation-scoring-guide.md
 *
 * Not a markdown library. The guide uses five constructs, headings
 * (levels 1-3), bold inline, unordered lists, one table, and paragraphs,
 * and this handles those five and nothing else. Anything the guide does
 * not use, a link, a code block, a nested list, is never recognized, so
 * a future edit that reaches for one of those renders as literal text
 * instead of breaking. That is the right failure for a one-page doc a
 * coach edits without touching code.
 *
 * Pure: no React, no file I/O. The page reads the file and hands the
 * source string in here; this only turns text into nodes.
 * ------------------------------------------------------------------ */

export type MarkdownNode =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "table"; header: string[]; rows: string[][] };

const HEADING_RE = /^(#{1,3})\s+(.+)$/;
const LIST_ITEM_RE = /^-\s+(.+)$/;
const SEPARATOR_CELL_RE = /^:?-+:?$/;

function isTableRow(line: string): boolean {
  return line.trim().startsWith("|");
}

/** "| a | b |" -> ["a", "b"], tolerant of a missing leading or trailing pipe. */
function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((cell) => cell.trim());
}

/** A `| --- | --- |` style row: every cell is dashes, optionally colon-capped. */
function isSeparatorRow(line: string): boolean {
  if (!isTableRow(line)) return false;
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => SEPARATOR_CELL_RE.test(cell));
}

/**
 * Turn the guide's markdown source into a flat list of block nodes.
 *
 * Bold inline (`**text**`) is left untouched in every text field here; it
 * is a presentation concern for whatever renders the nodes, not a parsing
 * concern for a block-level pass.
 */
export function renderMarkdown(src: string): MarkdownNode[] {
  const lines = src.split("\n");
  const nodes: MarkdownNode[] = [];
  let paragraphLines: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    nodes.push({ kind: "paragraph", text: paragraphLines.join(" ").trim() });
    paragraphLines = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      flushParagraph();
      i++;
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushParagraph();
      nodes.push({
        kind: "heading",
        level: heading[1].length as 1 | 2 | 3,
        text: heading[2].trim(),
      });
      i++;
      continue;
    }

    const listItem = LIST_ITEM_RE.exec(line);
    if (listItem) {
      flushParagraph();
      const items = [listItem[1].trim()];
      i++;
      while (i < lines.length) {
        const nextItem = LIST_ITEM_RE.exec(lines[i]);
        if (!nextItem) break;
        items.push(nextItem[1].trim());
        i++;
      }
      nodes.push({ kind: "list", items });
      continue;
    }

    if (isTableRow(line) && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
      flushParagraph();
      const header = splitTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      nodes.push({ kind: "table", header, rows });
      continue;
    }

    paragraphLines.push(line.trim());
    i++;
  }

  flushParagraph();
  return nodes;
}
