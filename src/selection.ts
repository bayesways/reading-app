import { sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";
import { cleanText } from "./article.ts";

interface Position { row: number; index: number }
interface Cell { text: string; column: number; width: number; offset: number }
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const words = new Intl.Segmenter(undefined, { granularity: "word" });

/** Selection coordinates refer to rendered article text, never the sidebar or ANSI bytes. */
export class ArticleSelection {
  private lines: string[] = [];
  private cells = new Map<number, Cell[]>();
  cursor: Position = { row: 0, index: 0 };
  anchor?: Position;

  setLines(lines: string[]): void {
    this.lines = lines.map((line) => cleanText(line).trimEnd());
    this.cells.clear();
    this.clear();
  }

  clear(): void {
    this.anchor = undefined;
    this.cursor = { row: 0, index: 0 };
  }

  private rowCells(row: number): Cell[] {
    let cells = this.cells.get(row);
    if (!cells) {
      let column = 0;
      cells = [...graphemes.segment(this.lines[row] ?? "")].map(({ segment, index }) => {
        const cell = { text: segment, offset: index, column, width: visibleWidth(segment) };
        column += cell.width;
        return cell;
      });
      this.cells.set(row, cells);
    }
    return cells;
  }

  private at(row: number, column: number): Position {
    row = Math.max(0, Math.min(row, this.lines.length - 1));
    const cells = this.rowCells(row);
    const found = cells.findIndex((cell) => cell.column + cell.width > column);
    return { row, index: found < 0 ? Math.max(0, cells.length - 1) : found };
  }

  place(row: number, column: number, mark = false): void {
    this.cursor = this.at(row, column);
    if (mark) this.anchor = { ...this.cursor };
  }

  contains(row: number, column: number): boolean {
    return row >= 0 && row < this.lines.length && column >= 0 && column < visibleWidth(this.lines[row]);
  }

  mark(): void { this.anchor = { ...this.cursor }; }

  move(dx: number, dy: number): void {
    if (dy) {
      const column = this.rowCells(this.cursor.row)[this.cursor.index]?.column ?? 0;
      this.cursor = this.at(this.cursor.row + dy, column);
      return;
    }
    let { row, index } = this.cursor;
    index += dx;
    if (index < 0 && row > 0) {
      row--;
      index = this.rowCells(row).length - 1;
    } else if (index >= this.rowCells(row).length && row < this.lines.length - 1) {
      row++;
      index = 0;
    }
    this.cursor = { row, index: Math.max(0, Math.min(index, this.rowCells(row).length - 1)) };
  }

  word(): void {
    const { row, index } = this.cursor;
    const cells = this.rowCells(row);
    const offset = cells[index]?.offset ?? 0;
    const word = [...words.segment(this.lines[row] ?? "")].find((w) => offset >= w.index && offset < w.index + w.segment.length);
    if (!word) { this.anchor = undefined; return; }
    const start = cells.findIndex((cell) => cell.offset >= word.index);
    const after = cells.findIndex((cell) => cell.offset >= word.index + word.segment.length);
    this.anchor = { row, index: Math.max(0, start) };
    this.cursor = { row, index: after < 0 ? Math.max(0, cells.length - 1) : after - 1 };
  }

  private bounds(): [Position, Position] | undefined {
    if (!this.anchor) return;
    const a = this.anchor;
    const b = this.cursor;
    return a.row < b.row || (a.row === b.row && a.index <= b.index) ? [a, b] : [b, a];
  }

  private range(row: number): [number, number] | undefined {
    const bounds = this.bounds();
    if (!bounds || row < bounds[0].row || row > bounds[1].row) return;
    return [row === bounds[0].row ? bounds[0].index : 0,
      row === bounds[1].row ? bounds[1].index : this.rowCells(row).length - 1];
  }

  text(): string {
    const bounds = this.bounds();
    if (!bounds) return "";
    const parts: string[] = [];
    for (let row = bounds[0].row; row <= bounds[1].row; row++) {
      const [start, end] = this.range(row)!;
      parts.push(this.rowCells(row).slice(start, end + 1).map((cell) => cell.text).join(""));
    }
    return parts.join("\n").trim();
  }

  highlight(row: number, line: string, style: (text: string) => string, showCursor: boolean): string {
    const range = this.range(row) ?? (showCursor && row === this.cursor.row ? [this.cursor.index, this.cursor.index] : undefined);
    if (!range) return line;
    const cells = this.rowCells(row);
    const start = cells[range[0]];
    const end = cells[range[1]];
    if (!start || !end) return line;
    const afterColumn = end.column + end.width;
    const selected = cells.slice(range[0], range[1] + 1).map((cell) => cell.text).join("");
    // Reapply each fragment's styling. SGR resets inside Markdown must not erase the highlight.
    return sliceByColumn(line, 0, start.column) + "\x1b[0m" + style(selected) + "\x1b[0m"
      + sliceByColumn(line, afterColumn, Math.max(0, visibleWidth(line) - afterColumn));
  }
}

/** Reader links remain readable, but don't intercept mouse presses intended to select text. */
export function withoutHyperlinks(line: string): string {
  return line.replace(/\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)/g, "");
}
