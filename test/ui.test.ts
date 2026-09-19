import assert from "node:assert/strict";
import { test } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, visibleWidth } from "@earendil-works/pi-tui";
import { ReaderState } from "../src/reader.ts";
import { ReaderView } from "../src/ui.ts";

const identity = (s: string) => s;
const theme = {
  fg: (_: string, text: string) => text,
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
