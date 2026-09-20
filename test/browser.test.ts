import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { BrowserReader, parseReaderCommand, type BrowserSnapshot } from "../src/browser.ts";
import { browserPage } from "../src/browser-page.ts";
import { ReaderState } from "../src/reader.ts";

const article = async (url: string) => ({
  url,
  title: "Browser Reader <script>alert(1)</script>",
  markdown: "# Safe article\n\nSelect a **Bayesian posterior** here.\n\n<script>globalThis.pwned = true</script>",
});

async function post(base: string, action: string, body: unknown, origin = new URL(base).origin): Promise<Response> {
  return fetch(`${base}api/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
}

test("browser client is self-contained, syntactically valid and avoids HTML injection sinks", () => {
  const page = browserPage("test-nonce");
  const source = page.match(/<script nonce="test-nonce">([\s\S]+)<\/script>/)?.[1];
  assert.ok(source);
  new vm.Script(source);
  assert.doesNotMatch(source, /\.innerHTML\s*=|insertAdjacentHTML|document\.write|\beval\s*\(|new Function/);
  assert.doesNotMatch(page, /<script[^>]+src=|<link[^>]+href=|<img/i);
});

test("browser reader is loopback-only, capability protected and CSP restricted", async (t) => {
  const requests: Array<{ question: string; kind: string; selection?: string }> = [];
  const state = new ReaderState(async (_reading, question, kind, _signal, selection) => {
    requests.push({ question, kind, selection });
    return kind === "summary" ? "# Learning recap\n\nA safe recap." : "A grounded **answer**.";
  }, article);
  let launched = "";
  const reader = new BrowserReader(state, "provider/model", { launch: (url) => { launched = url; } });
  t.after(() => reader.dispose());
  const result = await reader.open("https://example.com/article");
  assert.equal(result.launched, true);
  assert.equal(launched, result.url);
  assert.match(result.url, /^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]{43}\/$/);

  const pageResponse = await fetch(result.url);
  assert.equal(pageResponse.status, 200);
  const page = await pageResponse.text();
  const csp = pageResponse.headers.get("content-security-policy")!;
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /connect-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(pageResponse.headers.get("referrer-policy"), "no-referrer");
  const nonce = page.match(/<script nonce="([^"]+)">/)?.[1];
  assert.ok(nonce);
  assert.match(csp, new RegExp(`script-src 'nonce-${nonce}'`));
  assert.doesNotMatch(page, /Safe article|globalThis\.pwned|Browser Reader <script>/); // Data arrives only through JSON.

  const stateResponse = await fetch(`${result.url}api/state`);
  const initial = await stateResponse.json() as BrowserSnapshot;
  assert.equal(initial.model, "provider/model");
  assert.equal(initial.current?.article.title, "Browser Reader <script>alert(1)</script>");
  assert.equal(initial.pages.length, 1);

  const wrong = result.url.replace(/\/[^/]+\/$/, "/wrong-token/");
  assert.equal((await fetch(`${wrong}api/state`)).status, 404);
  assert.equal((await fetch(`${result.url}api/state`, { headers: { Origin: "https://evil.example" } })).status, 404);
  assert.equal((await post(result.url, "select", { selection: "x" }, "https://evil.example")).status, 404);
});

test("browser API loads, selects, asks, explains, summarizes and keeps URL discussions separate", async (t) => {
  const requests: Array<{ url: string; question: string; kind: string; selection?: string }> = [];
  const state = new ReaderState(async (reading, question, kind, _signal, selection) => {
    requests.push({ url: reading.article.url, question, kind, selection });
    return kind === "summary" ? "# Learning recap\n\nPosterior explored." : `Answer about ${selection ?? "article"}.`;
  }, article);
  const reader = new BrowserReader(state, "provider/model", { launch: () => {} });
  t.after(() => reader.dispose());
  const base = (await reader.open()).url;

  let response = await post(base, "load", { url: "https://example.com/a" });
  assert.equal(response.status, 200);
  response = await post(base, "ask", { question: "What is this?", selection: "Bayesian posterior" });
  let data = await response.json() as BrowserSnapshot;
  assert.equal(data.current?.selection, "Bayesian posterior");
  assert.equal(data.current?.exchanges[0].selection, "Bayesian posterior");
  assert.deepEqual(requests[0], {
    url: "https://example.com/a", question: "What is this?", kind: "question", selection: "Bayesian posterior",
  });

  response = await post(base, "explain", { selection: "posterior" });
  data = await response.json() as BrowserSnapshot;
  assert.equal(data.current?.exchanges.length, 2);
  assert.equal(requests[1].selection, "posterior");
  assert.match(requests[1].question, /Explain the selected passage/);

  response = await post(base, "summary", {});
  data = await response.json() as BrowserSnapshot;
  assert.match(data.current!.summary, /Learning recap/);
  assert.equal(requests[2].kind, "summary");
  assert.equal(requests[2].selection, undefined);

  await post(base, "load", { url: "https://example.com/b" });
  data = await (await fetch(`${base}api/state`)).json() as BrowserSnapshot;
  assert.equal(data.pages.length, 2);
  assert.equal(data.current?.exchanges.length, 0);
  await post(base, "load", { url: "https://example.com/a" });
  data = await (await fetch(`${base}api/state`)).json() as BrowserSnapshot;
  assert.equal(data.current?.exchanges.length, 2);
  assert.equal(data.current?.selection, "posterior");
  data = await (await post(base, "select", { selection: "" })).json() as BrowserSnapshot;
  assert.equal(data.current?.selection, undefined);
});

test("browser API snapshots a sent selection and supports cancellation from a second request", async (t) => {
  let resolve!: (value: string) => void;
  const waiting = new Promise<string>((done) => { resolve = done; });
  let started!: () => void;
  const began = new Promise<void>((done) => { started = done; });
  const state = new ReaderState(async () => { started(); return waiting; }, article);
  const reader = new BrowserReader(state, "provider/model", { launch: () => {} });
  t.after(() => reader.dispose());
  const base = (await reader.open("https://example.com/a")).url;
  const asking = post(base, "ask", { question: "First?", selection: "first passage" });
  await began;
  let data = await (await post(base, "select", { selection: "new passage" })).json() as BrowserSnapshot;
  assert.equal(data.busy, true);
  assert.equal(data.current?.selection, "new passage");
  resolve("First answer");
  data = await (await asking).json() as BrowserSnapshot;
  assert.equal(data.current?.exchanges[0].selection, "first passage");
  assert.equal(data.current?.selection, "new passage");

  let aborted = false;
  const cancellable = new ReaderState(async (_r, _q, _k, signal) => new Promise<string>((_done, reject) => {
    signal.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); }, { once: true });
  }), article);
  const cancelReader = new BrowserReader(cancellable, "provider/model", { launch: () => {} });
  t.after(() => cancelReader.dispose());
  const cancelBase = (await cancelReader.open("https://example.com/a")).url;
  const pending = post(cancelBase, "ask", { question: "Cancel me", selection: "" });
  while (!cancellable.busy) await new Promise((done) => setTimeout(done, 1));
  data = await (await post(cancelBase, "cancel", {})).json() as BrowserSnapshot;
  assert.equal(data.busy, false);
  await pending;
  assert.equal(aborted, true);
  assert.equal(cancellable.current?.exchanges.length, 0);
});

test("browser API validates methods, content types, body size and input lengths", async (t) => {
  const reader = new BrowserReader(new ReaderState(async () => "answer", article), "provider/model", { launch: () => {} });
  t.after(() => reader.dispose());
  const base = await reader.start();
  assert.equal((await fetch(`${base}api/state`, { method: "PUT" })).status, 405);
  assert.equal((await fetch(`${base}api/load`, { method: "POST", body: "{}" })).status, 415);
  assert.equal((await post(base, "load", { url: "" })).status, 400);
  assert.equal((await post(base, "ask", { question: "q".repeat(10_001), selection: "" })).status, 400);
  const oversized = await fetch(`${base}api/load`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: "x".repeat(70_000) }),
  });
  assert.equal(oversized.status, 400);
  assert.equal((await post(base, "unknown", {})).status, 404);
});

test("stopping rotates the capability and disposal clears all in-memory data", async () => {
  const state = new ReaderState(async () => "answer", article);
  const opened: string[] = [];
  const reader = new BrowserReader(state, "provider/model", { launch: (url) => { opened.push(url); } });
  const first = (await reader.open("https://example.com/a")).url;
  await reader.stop();
  assert.equal(reader.running, false);
  assert.equal(state.readings.size, 1);
  const second = (await reader.open()).url;
  assert.notEqual(first, second);
  assert.equal(opened.length, 2);
  await reader.dispose();
  assert.equal(state.readings.size, 0);
  assert.equal(state.current, undefined);
  await assert.rejects(fetch(`${second}api/state`));
});

test("reader command parser makes browser mode explicit", () => {
  assert.deepEqual(parseReaderCommand("https://example.com"), { browser: false, stopBrowser: false, url: "https://example.com" });
  assert.deepEqual(parseReaderCommand("--tui https://example.com"), { browser: false, stopBrowser: false, url: "https://example.com" });
  assert.deepEqual(parseReaderCommand("--browser https://example.com/a?q=1"), { browser: true, stopBrowser: false, url: "https://example.com/a?q=1" });
  assert.deepEqual(parseReaderCommand("-b"), { browser: true, stopBrowser: false, url: "" });
  assert.deepEqual(parseReaderCommand("--browser-stop"), { browser: true, stopBrowser: true, url: "" });
  assert.throws(() => parseReaderCommand("--browser-stop nope"), /does not accept/);
});
