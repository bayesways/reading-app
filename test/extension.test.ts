import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import readerExtension from "../src/index.ts";
import type { ReaderView } from "../src/ui.ts";

const identity = (s: string) => s;
const theme = {
  fg: (_: string, text: string) => text,
  bold: identity, italic: identity, strikethrough: identity, underline: identity,
} as unknown as Theme;

test("extension opens, answers, summarizes, reopens and forgets state at session boundaries", async () => {
  const hooks = new Map<string, () => void>();
  let command!: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
  // No session mutation APIs: this test fails if the extension tries to persist a message/entry.
  readerExtension({
    on: (name: string, handler: () => void) => hooks.set(name, handler),
    registerCommand: (name: string, options: { handler: typeof command }) => {
      assert.equal(name, "reader");
      command = options.handler;
    },
  } as unknown as ExtensionAPI);
  let view!: ReaderView;
  let calls = 0;
  const firstModel = { provider: "custom-provider", id: "test-model", contextWindow: 128_000, maxTokens: 8192 };
  const nextModel = { ...firstModel, id: "next-model" };
  let selectedModel = firstModel;
  const requestModels: unknown[] = [];
  const notifications: string[] = [];
  const ctx = {
    mode: "tui",
    get model() { return selectedModel; },
    modelRegistry: { complete: async (model: unknown) => {
      requestModels.push(model);
      return { stopReason: "stop", content: [{ type: "text", text: ++calls === 1 ? "An explanation." : "# Learning recap\n\nYour key distinction." }] };
    } },
    ui: {
      notify: (message: string) => notifications.push(message),
      custom: (factory: (...args: unknown[]) => ReaderView) => new Promise<void>((resolve) => {
        view = factory({ terminal: { rows: 30 }, requestRender: () => {} }, theme, {}, resolve);
      }),
    },
  } as unknown as ExtensionCommandContext;

  hooks.get("session_start")!();
  let pending = command("", ctx);
  assert.match(view.render(120)[0], /custom-provider\/test-model/);
  selectedModel = nextModel; // Even a changed context getter cannot silently switch this reader's model.
  view.state.current = {
    article: { url: "https://example.com", title: "Example", markdown: "A source about uncertainty." },
    exchanges: [], summary: "", draft: "", articleScroll: 0, chatScroll: 0, summaryScroll: 0,
  };
  view.state.readings.set("https://example.com", view.state.current);
  assert.equal(await view.state.ask("What does uncertainty mean?"), true);
  assert.equal(await view.state.ask("", "summary"), true);
  assert.equal(calls, 2);
  assert.deepEqual(requestModels, [firstModel, firstModel]);
  assert.match(view.render(120)[0], /custom-provider\/test-model/);
  assert.match(view.render(120).join("\n"), /Learning recap/);
  view.close();
  await pending;

  pending = command("", ctx);
  assert.equal(view.state.current!.exchanges.length, 1);
  assert.match(view.render(120)[0], /custom-provider\/next-model/);
  await view.state.ask("Another question");
  assert.equal(requestModels[2], nextModel); // Reopening binds to the new launching model.
  const previousState = view.state;
  view.close();
  await pending;

  const oldOpen = process.env.PI_READER_BROWSER_OPEN;
  process.env.PI_READER_BROWSER_OPEN = "0";
  await command("--browser", ctx);
  if (oldOpen === undefined) delete process.env.PI_READER_BROWSER_OPEN;
  else process.env.PI_READER_BROWSER_OPEN = oldOpen;
  const browserUrl = notifications.at(-1)!.match(/http:\/\/127\.0\.0\.1:\d+\/[^ ]+\//)![0];
  const webState = await (await fetch(`${browserUrl}api/state`)).json() as { model: string };
  assert.equal(webState.model, "custom-provider/next-model");

  hooks.get("session_shutdown")!();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await assert.rejects(fetch(`${browserUrl}api/state`));
  assert.equal(previousState.readings.size, 0);
  assert.equal(previousState.current, undefined);

  hooks.get("session_start")!();
  pending = command("", ctx);
  assert.equal(view.state.current, undefined);
  assert.notEqual(view.state, previousState);
  view.close();
  await pending;
});
