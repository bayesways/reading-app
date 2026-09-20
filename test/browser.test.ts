import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { JSDOM, VirtualConsole } from "jsdom";
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

function fixture(): BrowserSnapshot {
  return {
    model: "provider/model", status: "Article ready. Type below to ask about this page.", error: false, busy: false,
    showingSummary: false, pages: [{ url: "https://example.com/a", title: "Annealing" }],
    current: {
      article: { url: "https://example.com/a", title: "Annealing", markdown: "# Annealing\n\nBody text." },
      exchanges: [{ question: "Why?", answer: "Because.", selection: "worse moves" }],
      summary: "",
    },
  };
}

/** Drives the real client script in jsdom with the pi API stubbed out. */
async function client(snapshot = fixture()) {
  const calls: Array<{ action: string; body?: Record<string, unknown> }> = [];
  let hang = false;
  const dom = new JSDOM(browserPage("test-nonce"), {
    runScripts: "dangerously", url: "http://127.0.0.1:1/capability/", virtualConsole: new VirtualConsole(),
    beforeParse(window) {
      window.scrollTo = () => {};
      (window as unknown as { fetch: unknown }).fetch = async (input: string, init?: { body?: string }) => {
        const action = input.split("/api/")[1];
        const body = init?.body ? JSON.parse(init.body) as Record<string, string> : undefined;
        calls.push({ action, ...(body ? { body } : {}) });
        if (hang && action !== "cancel") return new Promise(() => {});
        // Mirror the server: a selection change is reflected in the snapshot it returns.
        if (action === "select" && snapshot.current) snapshot.current.selection = body!.selection || undefined;
        return { ok: true, json: async () => snapshot };
      };
    },
  });
  const { window } = dom;
  const settle = async () => { for (let i = 0; i < 4; i++) await new Promise((done) => window.setTimeout(done, 0)); };
  await settle();
  return {
    window, calls, settle,
    hangNext: () => { hang = true; },
    $: (id: string) => window.document.getElementById(id)!,
    type: (id: string, value: string) => { (window.document.getElementById(id) as HTMLTextAreaElement).value = value; },
    submit: async (id: string) => { (window.document.getElementById(id) as HTMLFormElement).requestSubmit(); await settle(); },
    press: async (key: string, target?: unknown) => {
      ((target as { dispatchEvent: (event: unknown) => void } | undefined) ?? window.document)
        .dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
      await settle();
    },
  };
}

test("browser page renders one column with no buttons, dropdowns or status bar", async () => {
  const page = browserPage("test-nonce");
  assert.doesNotMatch(page, /<button|<select/i); // Every action is a keystroke or the url/ask line.
  const ui = await client();
  const document = ui.window.document;
  assert.equal(ui.calls[0].action, "state");
  assert.equal(document.querySelector("h1")?.textContent, "Annealing");
  assert.doesNotMatch(document.querySelector("article")!.textContent!, /^Annealing\s*Annealing/); // Title is not repeated.
  assert.match(document.getElementById("thread")!.textContent!, /Q1Why\?/);
  assert.match(document.getElementById("thread")!.textContent!, /worse moves/);
  assert.equal(document.getElementById("foot")!.textContent, "provider/model · in memory · 1 page");
  assert.equal((document.getElementById("url") as HTMLInputElement).value, "https://example.com/a");
  // The ask line and its foot are a bar fixed to the window, not the tail of a long article.
  const dock = document.getElementById("dock")!;
  assert.equal(dock.closest(".col"), null);
  assert.ok(dock.contains(document.getElementById("question")!) && dock.contains(document.getElementById("foot")!));
  assert.match(page, /\.dock\{[^}]*position:fixed[^}]*bottom:0/);
  assert.match(document.body.style.paddingBottom, /px$/); // The column reserves the bar's height.
});

test("browser page asks and runs /recap and /article from the ask line", async () => {
  const ui = await client();
  ui.type("question", "What is annealing?");
  await ui.submit("askForm");
  assert.deepEqual(ui.calls.at(-1), { action: "ask", body: { question: "What is annealing?", selection: "" } });
  assert.equal((ui.$("question") as HTMLTextAreaElement).value, "");

  ui.type("question", "/recap");
  await ui.submit("askForm");
  assert.deepEqual(ui.calls.at(-1), { action: "summary", body: {} });
  assert.match(ui.$("article").textContent!, /recap · type \/article/);

  ui.type("question", "/article");
  await ui.submit("askForm");
  assert.equal(ui.calls.at(-1)!.action, "summary"); // A view switch is local; it never calls pi.
  assert.doesNotMatch(ui.$("article").textContent!, /recap · type \/article/);

  ui.type("question", "/nope");
  await ui.submit("askForm");
  assert.match(ui.$("foot").textContent!, /Unknown command/);
});

test("browser page loads a url, types into the ask line and unwinds with Escape", async () => {
  const ui = await client();
  ui.type("url", "https://example.com/b");
  await ui.submit("loadForm");
  assert.deepEqual(ui.calls.at(-1), { action: "load", body: { url: "https://example.com/b" } });

  await ui.press("k", ui.window.document.body); // Any printable key starts a question.
  assert.equal(ui.window.document.activeElement, ui.$("question"));
  assert.equal((ui.$("question") as HTMLTextAreaElement).value, "k");

  ui.hangNext();
  ui.type("question", "Slow question");
  await ui.submit("askForm");
  assert.match(ui.$("thread").textContent!, /waiting for your model/); // The pending question is visible.
  await ui.press("Escape");
  assert.equal(ui.calls.at(-1)!.action, "cancel");
  assert.doesNotMatch(ui.$("thread").textContent!, /waiting for your model/);
});

test("browser page restores an attached passage, explains it with Enter and clears it with Escape", async () => {
  const snapshot = fixture();
  snapshot.current!.selection = "worse moves";
  const ui = await client(snapshot);
  assert.equal(ui.$("quoted").hidden, false); // The attached quote is visible, not hidden state.
  assert.match(ui.$("quotedText").textContent!, /worse moves/);
  await ui.press("Enter");
  assert.deepEqual(ui.calls.at(-1), { action: "explain", body: { selection: "worse moves" } });
  await ui.press("Escape");
  assert.deepEqual(ui.calls.at(-1), { action: "select", body: { selection: "" } });
  assert.equal(ui.$("quoted").hidden, true);
});

test("browser page only reopens a saved URL when selected from the URL list", async (t) => {
  const snapshot = fixture();
  snapshot.pages.push({ url: "https://example.com/b", title: "Another page" });
  const ui = await client(snapshot);
  t.after(() => ui.window.close());
  const input = async (url: string, inputType: string) => {
    ui.type("url", url);
    ui.$("url").dispatchEvent(new ui.window.InputEvent("input", { inputType, bubbles: true }));
    await ui.settle();
  };
  await input("https://example.com/b", "insertText");
  await input("https://example.com/a", "insertReplacementText");
  await input("https://example.com/unknown", "insertReplacementText");
  assert.deepEqual(ui.calls.map(({ action }) => action), ["state"]);

  ui.type("question", "/recap");
  await ui.submit("askForm");
  ui.$("url").focus();
  await input(" https://example.com/b ", "insertReplacementText");
  assert.deepEqual(ui.calls.at(-1), { action: "load", body: { url: "https://example.com/b" } });
  assert.notEqual(ui.window.document.activeElement, ui.$("url"));
  assert.doesNotMatch(ui.$("article").textContent!, /recap · type \/article/);
});

test("browser selection capture and hint accept article text and reject outside or collapsed ranges", async (t) => {
  const ui = await client();
  t.after(() => ui.window.close());
  const { document } = ui.window;
  const selection = ui.window.getSelection()!;
  const select = async (node: Node, collapse = false) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    if (collapse) range.collapse(true);
    // jsdom has no layout engine; supply the same rectangle for each real DOM range.
    range.getClientRects = () => [{ right: 100, top: 20 }] as unknown as DOMRectList;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new ui.window.Event("selectionchange"));
    ui.$("article").dispatchEvent(new ui.window.MouseEvent("mouseup", { bubbles: true }));
    await ui.settle();
  };
  const paragraph = document.querySelector("article p")!;
  paragraph.textContent = "  Body\n text.  ";
  for (const node of [paragraph.firstChild!, paragraph]) {
    await select(node);
    assert.deepEqual(ui.calls.at(-1), { action: "select", body: { selection: "Body text." } });
    assert.equal(ui.$("hint").hidden, false);
    assert.equal(ui.$("hint").style.transform, "translate(110px,20px)");
    assert.match(ui.$("quotedText").textContent!, /Body text\./);
  }
  const before = ui.calls.length;
  await select(ui.$("thread"));
  assert.equal(ui.$("hint").hidden, true);
  await select(paragraph, true);
  assert.equal(ui.$("hint").hidden, true);
  assert.equal(ui.calls.length, before);
});
