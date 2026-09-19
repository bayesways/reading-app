import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { cleanText } from "../src/article.ts";
import { ArticleSelection, withoutHyperlinks } from "../src/selection.ts";

const reverse = (text: string) => `\x1b[7m${text}\x1b[27m`;

test("word selection uses displayed characters rather than ANSI offsets", () => {
  const selection = new ArticleSelection();
  const line = "A \x1b[1mBayesian\x1b[22m explanation.";
  selection.setLines([line]);
  selection.place(0, 5);
  selection.word();
  assert.equal(selection.text(), "Bayesian");
  const marked = selection.highlight(0, line, reverse, false);
  assert.match(marked, /\x1b\[7mBayesian/);
  assert.equal(cleanText(marked), cleanText(line));
  assert.equal(visibleWidth(marked), visibleWidth(line));
});

test("forward and reverse ranges span wrapped lines without including padding", () => {
  const selection = new ArticleSelection();
  selection.setLines(["one two   ", "three four", "five six"]);
  selection.place(0, 4, true);
  selection.place(2, 3);
  assert.equal(selection.text(), "two\nthree four\nfive");
  selection.place(2, 3, true);
  selection.place(0, 4);
  assert.equal(selection.text(), "two\nthree four\nfive");
});

test("wide characters, emoji sequences and combining marks are never split", () => {
  const selection = new ArticleSelection();
  const line = "A 中文 👩🏽‍💻 e\u0301 tail";
  selection.setLines([line]);
  selection.place(0, 3, true); // Second display cell of 中.
  selection.place(0, 8); // Second display cell of emoji.
  assert.equal(selection.text(), "中文 👩🏽‍💻");
  assert.equal(cleanText(selection.highlight(0, line, reverse, false)), line);
  assert.equal(visibleWidth(selection.highlight(0, line, reverse, false)), visibleWidth(line));
  selection.place(0, 10, true);
  assert.equal(selection.text(), "e\u0301");
  selection.move(1, 0);
  assert.equal(selection.text(), "e\u0301"); // Trailing space trimmed from excerpt.
  selection.move(1, 0);
  assert.equal(selection.text(), "e\u0301 t");
});

test("keyboard movement and pointer positions clamp safely at document boundaries", () => {
  const selection = new ArticleSelection();
  selection.setLines(["start", "", "end"]);
  selection.place(-100, -100, true);
  selection.move(-1, 0);
  assert.equal(selection.text(), "s");
  selection.place(200, 200);
  assert.equal(selection.text(), "start\n\nend");
  selection.move(1, 0);
  assert.equal(selection.text(), "start\n\nend");
  selection.setLines([]);
  selection.place(5, 5, true);
  selection.move(10, 10);
  assert.equal(selection.text(), "");
});

test("reflow discards geometry, and links cannot steal selection clicks", () => {
  const selection = new ArticleSelection();
  const link = "\x1b[34m\x1b]8;;https://example.com\x07link\x1b]8;;\x1b\\\x1b[39m";
  const stripped = withoutHyperlinks(link);
  assert.equal(stripped, "\x1b[34mlink\x1b[39m");
  selection.setLines([stripped]);
  selection.place(0, 0, true);
  selection.word();
  assert.equal(selection.text(), "link");
  selection.setLines(["li", "nk"]);
  assert.equal(selection.text(), "");
});
