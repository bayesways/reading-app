import assert from "node:assert/strict";
import { test } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, visibleWidth, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { ReaderState } from "../src/reader.ts";
import { cleanText } from "../src/article.ts";
import { ReaderView } from "../src/ui.ts";

const identity = (s: string) => s;
const theme = {
  fg: (_: string, text: string) => text,
  bg: (_: string, text: string) => `\x1b[7m${text}\x1b[27m`,
  bold: identity, italic: identity, strikethrough: identity, underline: identity,
} as unknown as Theme;

const makeState = () => new ReaderState(async () => "# Learning recap\n\nA useful distinction.", async (url) => ({
  url, title: "Wide 中文 article 🧠",
  markdown: "## A heading\n\n" + "This is a paragraph with wide 中文 characters and emoji 🧠.\n\n".repeat(50),
}));

const paste = (view: ReaderView, text: string) => view.handleInput(`\x1b[200~${text}\x1b[201~`);
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("layout respects every width and height, including narrow terminals", async () => {
  const state = makeState();
  await state.load("https://example.com");
  let rows = 30;
  const view = new ReaderView(state, theme, () => rows, () => {}, () => {});
  view.focused = true;
  for (const width of [1, 20, 35, 36, 60, 89, 90, 120, 180]) {
    for (const h of [1, 8, 12, 24, 50]) {
      rows = h;
      const lines = view.render(width);
      assert.ok(lines.length <= rows, `height overflow at ${width}x${h}`);
      assert.ok(lines.every((line) => visibleWidth(line) <= width), `width overflow at ${width}x${h}`);
    }
  }
  view.dispose();
});

test("scrolling, focus, paste, questions, recap and return to article", async () => {
  const state = makeState();
  await state.load("https://example.com");
  let closed = false;
  const view = new ReaderView(state, theme, () => 30, () => {}, () => { closed = true; });
  view.focused = true;
  view.render(120);
  view.handleInput("j");
  assert.equal(state.current!.articleScroll, 1);
  view.handleInput("\t"); // chat
  view.handleInput("\t"); // question
  paste(view, "Explain the main idea");
  assert.equal(state.current!.draft, "Explain the main idea");
  const lines = view.render(120);
  assert.equal(lines.filter((line) => line.includes(CURSOR_MARKER)).length, 1);
  view.handleInput("\r");
  await tick();
  assert.equal(state.current!.exchanges.length, 1);
  assert.equal(state.current!.draft, "");
  view.handleInput("\x13"); // Ctrl+S
  await tick();
  assert.equal(state.showingSummary, true);
  assert.match(view.render(120).join("\n"), /LEARNING RECAP/);
  view.handleInput("\x1b");
  assert.equal(state.showingSummary, false);
  assert.equal(closed, false);
  view.handleInput("\x1b");
  assert.equal(closed, true);
  assert.equal(state.readings.size, 1); // Closing the view is not a session boundary.
});

test("URL input loads a page and cancelled pending work cannot update a disposed view", async () => {
  const state = makeState();
  let renders = 0;
  const view = new ReaderView(state, theme, () => 24, () => { renders++; }, () => {});
  view.focused = true;
  paste(view, "https://example.com/one");
  view.handleInput("\r");
  await tick();
  assert.equal(state.current!.article.url, "https://example.com/one");
  view.dispose();
  const before = renders;
  await state.load("https://example.com/two");
  assert.equal(renders, before);
});

function mouse(type: TuiMouseEvent["type"], x: number, y: number, extra: Partial<TuiMouseEvent> = {}): TuiMouseEvent {
  return { type, button: "left", x, y, screenX: x, screenY: y, width: 120, height: 30, shift: false, alt: false, ctrl: false, ...extra };
}

test("click a word, inspect it, ask a custom question; mouse buttons explain and clear", async () => {
  const state = makeState();
  await state.load("https://example.com");
  const view = new ReaderView(state, theme, () => 30, () => {}, () => {}, "my-provider/my-model");
  view.focused = true;
  const lines = view.render(120).map(cleanText);
  assert.match(lines[0], /my-provider\/my-model/);
  const y = lines.findIndex((line) => line.includes("This is a paragraph"));
  const x = lines[y].indexOf("paragraph") + 2;
  assert.equal(view.handleMouse(mouse("press", x, y))?.capture, true);
  view.handleMouse(mouse("release", x, y));
  view.handleMouse(mouse("click", x, y));
  assert.equal(state.current!.selection, "paragraph");
  const marked = view.render(120);
  assert.match(marked[y], /\x1b\[7mparagraph/);
  assert.match(marked.join("\n"), /Selected: paragraph/);
  assert.match(marked.join("\n"), /Selected passage/);

  // Click question input, not an article cell; then type a custom question.
  view.handleMouse(mouse("press", 90, 26));
  paste(view, "What does this mean?");
  view.handleInput("\r");
  await tick();
  assert.equal(state.current!.exchanges[0].selection, "paragraph");
  assert.equal(state.current!.exchanges[0].question, "What does this mean?");
  view.render(120);
  view.handleMouse(mouse("click", 80, 25)); // [Explain]
  await tick();
  assert.equal(state.current!.exchanges.length, 2);
  assert.match(state.current!.exchanges[1].question, /Explain the selected passage/);
  view.handleMouse(mouse("click", 96, 25)); // [Clear]
  assert.equal(state.current!.selection, undefined);
  view.render(120);
  view.handleMouse(mouse("press", 70, 4)); // Blank padding to the right of the article title.
  view.handleMouse(mouse("release", 70, 4));
  assert.equal(state.current!.selection, undefined);
  view.dispose();
});

test("keyboard word and range selection work without mouse reporting", async () => {
  const state = makeState();
  await state.load("https://example.com");
  const view = new ReaderView(state, theme, () => 24, () => {}, () => {});
  view.render(120);
  view.handleInput("v");
  assert.match(view.render(120).join("\n"), /SELECT: arrows/);
  view.handleInput("w");
  assert.equal(state.current!.selection, "Wide");
  view.handleInput("e");
  await tick();
  assert.equal(state.current!.exchanges[0].selection, "Wide");
  view.handleInput("x");
  assert.equal(state.current!.selection, undefined);
  view.render(120);
  view.handleInput("v");
  view.handleInput(" ");
  for (let i = 0; i < 5; i++) view.handleInput("\x1b[C");
  assert.equal(state.current!.selection, "Wide 中");
  view.handleInput("\r"); // Attach; do not send without a question.
  assert.equal(state.current!.exchanges.length, 1);
  paste(view, "Why this phrase?");
  view.handleInput("\r");
  await tick();
  assert.equal(state.current!.exchanges[1].selection, "Wide 中");
  view.dispose();
});

test("cross-pane drag, scrolling and reflow never select sidebar text", async () => {
  const state = makeState();
  await state.load("https://example.com");
  const view = new ReaderView(state, theme, () => 30, () => {}, () => {});
  const lines = view.render(120).map(cleanText);
  const y = lines.findIndex((line) => line.includes("This is a paragraph"));
  view.handleMouse(mouse("press", 0, y));
  view.handleMouse(mouse("drag", 119, y + 2));
  view.handleMouse(mouse("release", 119, y + 2));
  assert.match(state.current!.selection!, /This is a paragraph/);
  assert.doesNotMatch(state.current!.selection!, /Ask for|QUESTIONS|Q1|explanation, challenge/);
  const selection = state.current!.selection;
  view.handleMouse(mouse("wheel", 10, y, { wheelDelta: 3 }));
  assert.equal(state.current!.articleScroll, 3);
  view.render(120);
  const narrow = view.render(60);
  assert.equal(state.current!.selection, selection); // Quote survives reflow; cell ranges do not.
  assert.ok(narrow.every((line) => visibleWidth(line) <= 60));
  view.handleInput("\x1b"); // Clear the selection, not close the reader.
  assert.equal(state.current!.selection, undefined);
  view.handleInput("\x1b[15~"); // F5 from any pane starts keyboard selection.
  view.handleInput("w");
  view.render(60);
  await state.load("https://example.com/another");
  view.render(60);
  assert.equal(state.current!.selection, undefined);
  view.dispose();
});

test("keyboard selection scrolls beyond viewport and resize preserves quote with safe widths", async () => {
  const state = makeState();
  await state.load("https://example.com");
  let rows = 16;
  const view = new ReaderView(state, theme, () => rows, () => {}, () => {});
  view.render(120);
  view.handleInput("v");
  view.handleInput(" ");
  for (let i = 0; i < 10; i++) { view.handleInput("j"); view.render(120); }
  assert.ok(state.current!.articleScroll > 0);
  assert.ok(state.current!.selection!.includes("This is"));
  const selection = state.current!.selection;
  for (const width of [35, 36, 72, 90, 180]) {
    for (const h of [10, 12, 30]) {
      rows = h;
      const lines = view.render(width);
      assert.ok(lines.length <= h);
      assert.ok(lines.every((line) => visibleWidth(line) <= width));
      assert.equal(state.current!.selection, selection);
    }
  }
  view.dispose();
});
