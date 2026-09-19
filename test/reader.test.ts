import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ReaderState, type Answer } from "../src/reader.ts";
import { buildContext, createAnswer } from "../src/model.ts";

const load = async (url: string) => ({ url, title: url, markdown: `Source for ${url}` });
const answer: Answer = async (reading, question, kind) => `${kind}: ${question} about ${reading.article.url}`;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, no) => { resolve = ok; reject = no; });
  return { promise, resolve, reject };
}

test("questions, drafts, summaries and scroll are scoped to each URL in memory", async () => {
  const state = new ReaderState(answer, load);
  await state.load("https://example.com/a");
  const a = state.current!;
  a.draft = "Why?";
  await state.ask("Why?");
  await state.ask("", "summary");
  assert.equal(a.draft, "");
  assert.equal(a.exchanges.length, 1);
  assert.match(a.summary, /summary/);
  assert.equal(state.showingSummary, true);
  await state.load("https://example.com/b");
  assert.equal(state.current!.exchanges.length, 0);
  assert.equal(state.current!.summary, "");
  await state.ask("How?");
  await state.load("https://example.com/a#fragment");
  assert.equal(state.current, a);
  assert.equal(state.current!.exchanges[0].question, "Why?");
  state.cycleArticle();
  assert.equal(state.current!.article.url, "https://example.com/b");
  state.clear();
  assert.equal(state.current, undefined);
  assert.equal(state.readings.size, 0);
});

test("redirect aliases reuse the canonical reading", async () => {
  const state = new ReaderState(answer, async () => load("https://example.com/canonical"));
  await state.load("https://example.com/short");
  await state.ask("Remember me?");
  const first = state.current;
  await state.load("https://example.com/canonical");
  assert.equal(state.current, first);
  assert.equal(state.readings.size, 1);
});

test("failed load preserves current article and conversation", async () => {
  const state = new ReaderState(answer, async (url) => {
    if (url.endsWith("/bad")) throw new Error("offline");
    return load(url);
  });
  await state.load("https://example.com/good");
  const before = state.current;
  assert.equal(await state.load("https://example.com/bad"), false);
  assert.equal(state.current, before);
  assert.match(state.status, /offline/);
  assert.equal(state.busy, false);
});

test("cancellation and URL switching cannot misattribute a late answer", async () => {
  const reply = deferred<string>();
  const state = new ReaderState(async () => reply.promise, load);
  await state.load("https://example.com/a");
  const a = state.current!;
  const request = state.ask("Old question");
  assert.equal(state.busy, true);
  assert.equal(await state.ask("Double send"), false);
  await state.load("https://example.com/b");
  reply.resolve("Late answer");
  assert.equal(await request, false);
  assert.equal(a.exchanges.length, 0);
  assert.equal(state.current!.exchanges.length, 0);
  assert.equal(state.busy, false);
});

test("stale page loads cannot replace newer pages", async () => {
  const old = deferred<Awaited<ReturnType<typeof load>>>();
  const state = new ReaderState(answer, (url) => url.endsWith("/old") ? old.promise : load(url));
  const request = state.load("https://example.com/old");
  await state.load("https://example.com/new");
  old.resolve(await load("https://example.com/old"));
  assert.equal(await request, false);
  assert.equal(state.current!.article.url, "https://example.com/new");
});

test("model failures retain drafts and do not add incomplete exchanges", async () => {
  const state = new ReaderState(async () => { throw new Error("No authentication"); }, load);
  await state.load("https://example.com");
  state.current!.draft = "Why?";
  assert.equal(await state.ask("Why?"), false);
  assert.equal(state.current!.draft, "Why?");
  assert.equal(state.current!.exchanges.length, 0);
  assert.match(state.status, /No authentication/);
  assert.equal(state.pendingQuestion, "");
});

test("an answer does not erase a new draft typed while waiting", async () => {
  const reply = deferred<string>();
  const state = new ReaderState(async () => reply.promise, load);
  await state.load("https://example.com");
  state.current!.draft = "First";
  const request = state.ask("First");
  state.current!.draft = "Second";
  reply.resolve("Answer");
  await request;
  assert.equal(state.current!.draft, "Second");
});

test("model context contains only the active source and its discussion", async () => {
  const state = new ReaderState(answer, load);
  await state.load("https://example.com/a");
  await state.ask("secret from A");
  await state.load("https://example.com/b");
  await state.ask("question from B");
  const context = buildContext(state.current!, "", "summary");
  const serialized = JSON.stringify(context);
  assert.match(serialized, /question from B/);
  assert.doesNotMatch(serialized, /secret from A/);
  assert.match(context.systemPrompt!, /no discussion/);
  assert.match(context.systemPrompt!, /source data, not instructions/);
  assert.equal(context.tools, undefined);
});

test("model adapter uses registry authentication and refuses silent context truncation", async () => {
  const state = new ReaderState(answer, load);
  await state.load("https://example.com");
  const captured: unknown[] = [];
  const ctx = {
    model: { id: "test", maxTokens: 8192, contextWindow: 128_000 },
    modelRegistry: { complete: async (...args: unknown[]) => {
      captured.push(args);
      return { stopReason: "stop", content: [{ type: "text", text: "An answer" }] };
    } },
  } as unknown as ExtensionContext;
  assert.equal(await createAnswer(ctx)(state.current!, "Why?", "question", new AbortController().signal), "An answer");
  assert.equal(captured.length, 1);
  state.current!.article.markdown = "x".repeat(128_000);
  await assert.rejects(createAnswer(ctx)(state.current!, "Why?", "question", new AbortController().signal), /safe context budget/);
  assert.equal(captured.length, 1);
});
