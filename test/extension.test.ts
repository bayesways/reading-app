import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import readerExtension from "../src/index.ts";
import type { ReaderView } from "../src/ui.ts";

const identity = (s: string) => s;
const theme = {
  fg: (_: string, text: string) => text,
  bold: identity, italic: identity, strikethrough: identity, underline: identity,
} as unknown as Theme;

test("extension opens, answers, summarizes, reopens and forgets state at session boundaries", async (t) => {
  // Exercise the stubbed session model regardless of the user's reader configuration.
  const directory = await mkdtemp(join(tmpdir(), "pi-reader-extension-"));
  const hooks = new Map<string, () => void>();
  // node:test runs after hooks in registration order, so this one shuts the extension down
  // while its config still exists; the env restores registered below run after it.
  t.after(async () => {
    hooks.get("session_shutdown")?.();
    await rm(directory, { recursive: true, force: true });
  });
  // Every override is restored even when an assertion throws part way through the test.
  const useEnv = (name: string, value: string) => {
    const previous = process.env[name];
    t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
    process.env[name] = value;
  };
  const configPath = join(directory, "reader.json");
  await writeFile(configPath, JSON.stringify({ defaultModel: null, defaultThinkingLevel: "medium" }));
  useEnv("PI_READER_CONFIG", configPath);
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
  const firstModel = { provider: "custom-provider", id: "test-model", api: "openai-responses", reasoning: true, contextWindow: 128_000, maxTokens: 32_000 };
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

  // Bounded: a /reader that returns without opening a view must fail here by name, not wedge the runner.
  const waitForView = async (previous?: ReaderView) => {
    const deadline = Date.now() + 10_000;
    while (!view || view === previous) {
      assert.ok(Date.now() < deadline, `/reader opened no view. Last notice: ${notifications.at(-1) ?? "none"}`);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  };

  hooks.get("session_start")!();
  let pending = command("", ctx);
  await waitForView();
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

  const firstView = view;
  pending = command("", ctx);
  await waitForView(firstView);
  assert.equal(view.state.current!.exchanges.length, 1);
  assert.match(view.render(120)[0], /custom-provider\/next-model/);
  await view.state.ask("Another question");
  assert.equal(requestModels[2], nextModel); // Reopening binds to the new launching model.
  const previousState = view.state;
  view.close();
  await pending;

  useEnv("PI_READER_BROWSER_OPEN", "0");
  await command("--browser", ctx);
  const browserUrl = notifications.at(-1)!.match(/http:\/\/127\.0\.0\.1:\d+\/[^ ]+\//)![0];
  const webState = await (await fetch(`${browserUrl}api/state`)).json() as { model: string };
  assert.equal(webState.model, "custom-provider/next-model · thinking:medium");

  hooks.get("session_shutdown")!();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await assert.rejects(fetch(`${browserUrl}api/state`));
  assert.equal(previousState.readings.size, 0);
  assert.equal(previousState.current, undefined);

  hooks.get("session_start")!();
  const secondView = view;
  pending = command("", ctx);
  await waitForView(secondView);
  assert.equal(view.state.current, undefined);
  assert.notEqual(view.state, previousState);
  view.close();
  await pending;
});
