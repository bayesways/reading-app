import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import vm from "node:vm";
import { JSDOM, VirtualConsole } from "jsdom";
import { BrowserReader, parseReaderCommand, type BrowserSnapshot } from "../src/browser.ts";
import { browserPage } from "../src/browser-page.ts";
import { ReaderState } from "../src/reader.ts";

const article = async (url: string) => ({
  url,
  title: "Browser Reader <script>alert(1)</script>",
  markdown: "# Safe article\n\nSelect a **Bayesian posterior** here.\n\n<script>globalThis.pwned = true</script>",
  html: "<p>Select a <b>Bayesian posterior</b> here.</p><img src=x onerror=globalThis.pwned=true>",
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
  // In script data these end the element early or open the escaped states; the
  // embedded parser is rewritten so neither survives. Nor does a map to 404 on.
  assert.doesNotMatch(source, /<\/script|<!--/i);
  assert.doesNotMatch(page, /sourceMappingURL/);
  assert.doesNotMatch(page, /<script[^>]+src=|<link[^>]+href=|<img/i);
  assert.equal(source.match(/function safeUrl\b/g)?.length, 1); // Markdown and reader HTML share one URL policy.
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
  // Reader-view images load from the web; nothing else the article names can.
  assert.match(csp, /img-src https: http: data:;/);
  assert.equal(pageResponse.headers.get("referrer-policy"), "no-referrer");
  const nonce = page.match(/<script nonce="([^"]+)">/)?.[1];
  assert.ok(nonce);
  assert.match(csp, new RegExp(`script-src 'nonce-${nonce}'`));
  assert.doesNotMatch(page, /Safe article|Bayesian posterior|globalThis\.pwned|Browser Reader <script>/); // Data arrives only through JSON.

  const stateResponse = await fetch(`${result.url}api/state`);
  const initial = await stateResponse.json() as BrowserSnapshot;
  assert.equal(initial.model, "provider/model");
  assert.equal(initial.status, "Source ready.");
  assert.equal("showingSummary" in initial, false);
  assert.equal(initial.current?.article.title, "Browser Reader <script>alert(1)</script>");
  assert.equal(initial.current!.article.content.format, "html");
  assert.match(initial.current!.article.content.text, /onerror/); // Sent as data; the page sanitizes it.
  assert.equal("html" in initial.current!.article, false);
  assert.equal("markdown" in initial.current!.article, false);
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
    model: "provider/model", status: "Source ready.", error: false, busy: false,
    pages: [{ url: "https://example.com/a", title: "Annealing" }],
    current: {
      article: {
        url: "https://example.com/a", title: "Annealing",
        content: { format: "markdown", text: "# Annealing\n\nBody text." },
      },
      exchanges: [{ question: "Why?", answer: "Because.", selection: "worse moves" }],
      summary: "",
    },
  };
}

function emptyFixture(): BrowserSnapshot {
  return {
    model: "provider/model", status: "Paste a URL or file path to begin.", error: false, busy: false,
    pages: [],
  };
}

/** Drives the real client script in jsdom with the pi API stubbed out. */
async function client(t: TestContext, snapshot = fixture(), holdFirstResponse = false) {
  const calls: Array<{ action: string; body?: Record<string, unknown> }> = [];
  let hang = false;
  let nextResponse: Promise<BrowserSnapshot | Error> | undefined;
  let releaseFirst: ((snapshot: BrowserSnapshot | Error) => void) | undefined;
  if (holdFirstResponse) nextResponse = new Promise((done) => { releaseFirst = done; });
  const dom = new JSDOM(browserPage("test-nonce"), {
    runScripts: "dangerously", url: "http://127.0.0.1:1/capability/", virtualConsole: new VirtualConsole(),
    beforeParse(window) {
      window.scrollTo = () => {};
      (window as unknown as { fetch: unknown }).fetch = async (input: string, init?: { body?: string }) => {
        const action = input.split("/api/")[1];
        const body = init?.body ? JSON.parse(init.body) as Record<string, string> : undefined;
        calls.push({ action, ...(body ? { body } : {}) });
        if (nextResponse) {
          const response = nextResponse;
          nextResponse = undefined;
          const result = await response;
          if (result instanceof Error) return { ok: false, status: 500, json: async () => ({ error: result.message }) };
          return { ok: true, json: async () => result };
        }
        if (hang && action !== "cancel") return new Promise(() => {});
        // Mirror the server: a selection change is reflected in the snapshot it returns.
        if ((action === "select" || action === "explain") && snapshot.current) snapshot.current.selection = body!.selection || undefined;
        return { ok: true, json: async () => snapshot };
      };
    },
  });
  const { window } = dom;
  // flashStatus arms a 6s timer on every transition; an unclosed window keeps it, and its listeners, alive.
  t.after(() => window.close());
  const settle = async () => { for (let i = 0; i < 4; i++) await new Promise((done) => window.setTimeout(done, 0)); };
  await settle();
  return {
    window, calls, settle,
    releaseFirst: (response: BrowserSnapshot | Error = snapshot) => { releaseFirst!(response); },
    hangNext: () => { hang = true; },
    deferNext: () => {
      let resolve!: (snapshot: BrowserSnapshot | Error) => void;
      nextResponse = new Promise((done) => { resolve = done; });
      return resolve;
    },
    $: (id: string) => window.document.getElementById(id)!,
    type: (id: string, value: string) => {
      const element = window.document.getElementById(id) as HTMLTextAreaElement;
      element.value = value;
      element.dispatchEvent(new window.InputEvent("input", { inputType: "insertText", bubbles: true }));
    },
    submit: async (id: string) => { (window.document.getElementById(id) as HTMLFormElement).requestSubmit(); await settle(); },
    press: async (key: string, target?: unknown) => {
      ((target as { dispatchEvent: (event: unknown) => void } | undefined) ?? window.document)
        .dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
      await settle();
    },
  };
}

test("browser page renders one column with no dropdowns or status bar", async (t) => {
  const page = browserPage("test-nonce");
  assert.doesNotMatch(page, /<select/i); // Every other action is a keystroke or the url/ask line.
  const ui = await client(t);
  assert.deepEqual([...ui.window.document.querySelectorAll("button")].map((node) => node.id), ["hint"]);
  const document = ui.window.document;
  assert.equal(ui.calls[0].action, "state");
  assert.equal(document.querySelector("h1")?.textContent, "Annealing");
  assert.doesNotMatch(document.querySelector("article")!.textContent!, /^Annealing\s*Annealing/); // Title is not repeated.
  assert.match(document.getElementById("thread")!.textContent!, /Q1Why\?/);
  assert.match(document.getElementById("thread")!.textContent!, /worse moves/);
  assert.equal(document.getElementById("foot")!.textContent, "provider/model");
  assert.equal((document.getElementById("url") as HTMLInputElement).value, "https://example.com/a");
  // jsdom ignores autofocus, but a browser would focus the url line before the first render and keep
  // the article's address out of it.
  assert.equal(document.querySelector("[autofocus]"), null);
  assert.equal(document.activeElement, document.body); // Space and the arrow keys scroll the article.
  // The ask line and its foot are a bar fixed to the window, not the tail of a long article.
  const dock = document.getElementById("dock")!;
  assert.equal(dock.closest(".col"), null);
  assert.ok(dock.contains(document.getElementById("question")!) && dock.contains(document.getElementById("foot")!));
  assert.match(page, /\.dock\{[^}]*position:fixed[^}]*bottom:0/);
  assert.match(document.body.style.paddingBottom, /px$/); // The column reserves the bar's height.
});

test("browser landing page is empty until a source loads, then leaves focus on the page", async (t) => {
  const page = browserPage("test-nonce");
  const ui = await client(t, emptyFixture());
  assert.equal(ui.$("article").textContent, "");
  assert.equal(ui.$("thread").hidden, true);
  assert.equal(ui.$("dock").hidden, true);
  assert.equal(ui.window.document.activeElement, ui.$("url"));
  assert.match(page, /\.field input,\.field textarea\{caret-color:transparent\}/);
  assert.match(page, /\.field-cursor\{[^}]*width:8px/);
  assert.match(page, /\.ask-field \.field-cursor\{[^}]*background:var\(--accent\);animation:cursor-pulse 2\.8s ease-in-out/);
  assert.match(page, /@keyframes cursor-pulse\{0%,100%\{opacity:\.15\}50%\{opacity:\.46\}\}/);
  assert.ok(ui.$("url").parentElement?.classList.contains("cursor-active"));

  const loaded = ui.deferNext();
  ui.type("url", "https://example.com/a");
  await ui.submit("loadForm");
  assert.equal(ui.$("dock").hidden, true);
  loaded(fixture());
  await ui.settle();
  assert.equal(ui.$("dock").hidden, false);
  // Focus stays on the page so it scrolls; the ask line is still one letter away.
  assert.equal(ui.window.document.activeElement, ui.window.document.body);
  assert.equal(ui.$("question").nextElementSibling?.className, "field-cursor");
  await ui.press("t");
  assert.equal(ui.window.document.activeElement, ui.$("question"));
  ui.type("question", "terminal cursor");
  assert.ok(ui.$("question").parentElement?.classList.contains("cursor-active"));
  (ui.$("url") as HTMLInputElement).focus();
  assert.equal(ui.$("question").parentElement?.classList.contains("cursor-active"), false);
  assert.match((ui.$("question").nextElementSibling as HTMLElement).style.left, /px$/);
});

test("browser page asks and runs /recap and /article from the ask line", async (t) => {
  const ui = await client(t);
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

test("browser page loads a url, types into the ask line and unwinds with Escape", async (t) => {
  const ui = await client(t);
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

test("browser preserves a new draft while an answer finishes, including edit-away-and-back", async (t) => {
  const ui = await client(t);
  const value = () => (ui.$("question") as HTMLTextAreaElement).value;
  for (const next of ["My next question", "First question"]) {
    ui.type("question", "First question");
    const complete = ui.deferNext();
    await ui.submit("askForm");
    ui.type("question", "Edited draft");
    ui.type("question", next);
    complete(fixture());
    await ui.settle();
    assert.equal(value(), next);
  }
});

test("browser preserves drafts after model failure and cancellation, ignoring late success", async (t) => {
  const ui = await client(t);
  ui.type("question", "Retry this question");
  const fail = ui.deferNext();
  await ui.submit("askForm");
  fail({ ...fixture(), error: true, status: "Model failed" });
  await ui.settle();
  assert.equal((ui.$("question") as HTMLTextAreaElement).value, "Retry this question");

  const complete = ui.deferNext();
  await ui.submit("askForm");
  await ui.press("Escape");
  ui.type("question", "Draft after cancellation");
  complete(fixture());
  await ui.settle();
  assert.equal((ui.$("question") as HTMLTextAreaElement).value, "Draft after cancellation");
});

test("browser restores per-article drafts after canonical URL switches and failed loads", async (t) => {
  const ui = await client(t);
  const a = fixture();
  const b = fixture();
  b.current!.article = {
    url: "https://example.com/canonical-b", title: "B",
    content: { format: "markdown", text: "Second article." },
  };
  const load = async (url: string, response: BrowserSnapshot) => {
    const complete = ui.deferNext();
    ui.type("url", url);
    await ui.submit("loadForm");
    complete(response);
    await ui.settle();
  };
  ui.type("question", "Draft for A");
  const complete = ui.deferNext();
  ui.type("url", "https://example.com/b");
  await ui.submit("loadForm");
  // Until B loads, the visible article and composer still belong to A.
  ui.type("question", "Updated draft for A\nwith another line");
  complete(b);
  await ui.settle();
  assert.equal((ui.$("question") as HTMLTextAreaElement).value, "");
  ui.type("question", "Draft for B");
  await load("https://example.com/missing", { ...b, error: true, status: "Not found" });
  assert.equal((ui.$("question") as HTMLTextAreaElement).value, "Draft for B");
  await load(a.current!.article.url, a);
  assert.equal((ui.$("question") as HTMLTextAreaElement).value, "Updated draft for A\nwith another line");
  await load("https://example.com/b", b);
  assert.equal((ui.$("question") as HTMLTextAreaElement).value, "Draft for B");
});

test("an answer that lands after a page switch clears its own draft, not the new page's", async (t) => {
  const ui = await client(t);
  ui.type("question", "Question for A");
  const answer = ui.deferNext();
  await ui.submit("askForm");
  const load = ui.deferNext();
  ui.type("url", "https://example.com/b");
  await ui.submit("loadForm");
  const b = fixture();
  b.current!.article.url = "https://example.com/b";
  load(b);
  await ui.settle();
  ui.type("question", "Question for B");
  answer(fixture());
  await ui.settle();
  assert.equal((ui.$("question") as HTMLTextAreaElement).value, "Question for B");
  const back = ui.deferNext();
  ui.type("url", "https://example.com/a");
  await ui.submit("loadForm");
  back(fixture());
  await ui.settle();
  // The page switch superseded the response, but the server still answered the
  // question, so leaving it in A's composer would only invite a duplicate ask.
  assert.equal((ui.$("question") as HTMLTextAreaElement).value, "");
});

test("a failed first snapshot shows its error on the landing page", async (t) => {
  const ui = await client(t, fixture(), true);
  ui.releaseFirst(new Error("pi is not running"));
  await ui.settle();
  assert.equal(ui.$("dock").hidden, true);
  assert.equal(ui.$("article").textContent, "pi is not running");
  assert.equal(ui.window.document.activeElement, ui.window.document.body);
});

test("a landing page takes the url line back after a failed load, unless a newer load owns it", async (t) => {
  const ui = await client(t, emptyFixture());
  const failed = ui.deferNext();
  ui.type("url", "https://example.com/missing");
  await ui.submit("loadForm");
  failed(new Error("Could not load that page."));
  await ui.settle();
  assert.equal(ui.window.document.activeElement, ui.$("url"));
  assert.equal((ui.$("url") as HTMLInputElement).value, "https://example.com/missing");

  const first = ui.deferNext();
  ui.type("url", "https://example.com/slow");
  await ui.submit("loadForm");
  ui.hangNext();
  ui.type("url", "https://example.com/a");
  await ui.submit("loadForm");
  first(new Error("Replaced."));
  await ui.settle();
  assert.notEqual(ui.window.document.activeElement, ui.$("url"));
});

test("a question typed while the first snapshot is in flight belongs to the article that arrives", async (t) => {
  const ui = await client(t, fixture(), true);
  ui.type("question", "Typed while connecting");
  ui.releaseFirst();
  await ui.settle();
  assert.equal((ui.$("question") as HTMLTextAreaElement).value, "Typed while connecting");
  const b = fixture();
  b.current!.article.url = "https://example.com/b";
  const load = ui.deferNext();
  ui.type("url", "https://example.com/b");
  await ui.submit("loadForm");
  load(b);
  await ui.settle();
  assert.equal((ui.$("question") as HTMLTextAreaElement).value, "");
});

test("a snapshot that is already busy elsewhere still accepts a question", async (t) => {
  // Nothing re-polls state, so a busy flag from another tab or the TUI would
  // otherwise disable this composer for the life of the page.
  const busy = { ...fixture(), busy: true, status: "Asking your pi model… Esc cancels." };
  const ui = await client(t, busy);
  ui.type("question", "Still answerable");
  await ui.submit("askForm");
  assert.deepEqual(ui.calls.at(-1), { action: "ask", body: { question: "Still answerable", selection: "" } });
});

test("an unknown command reports itself even while a question is in flight", async (t) => {
  const ui = await client(t);
  ui.hangNext();
  ui.type("question", "First question");
  await ui.submit("askForm");
  ui.type("question", "/recp");
  await ui.submit("askForm");
  assert.match(ui.$("foot").textContent!, /Unknown command/);
  assert.equal(ui.calls.filter(({ action }) => action === "ask").length, 1);
});

test("repeated submissions while busy do not replace the request or consume the next draft", async (t) => {
  const ui = await client(t);
  ui.type("question", "First question");
  const complete = ui.deferNext();
  await ui.submit("askForm");
  ui.type("question", "Next question");
  await ui.submit("askForm");
  assert.equal(ui.calls.filter(({ action }) => action === "ask").length, 1);
  assert.match(ui.$("thread").textContent!, /First question/);
  complete(fixture());
  await ui.settle();
  assert.equal((ui.$("question") as HTMLTextAreaElement).value, "Next question");
});

test("browser renders nested Markdown, entities, links, lists, tables and heading levels", async (t) => {
  const snapshot = fixture();
  snapshot.current!.article.content = { format: "markdown", text: String.raw`# Annealing

## Details

_Emphasis_ and **[a _nested_ link](https://example.com/path_(one)?a=1&b=2)** &amp; escaped \[brackets\].

3. Third item
   - Nested item with **strength**
4. Fourth item

> A quote with
>
> another paragraph.

| Name | Value |
| --- | ---: |
| _A_ | 42 |

[Reference][ref] and [relative](/docs).

[ref]: https://example.com/reference "A title"
` };
  const ui = await client(t, snapshot);
  const article = ui.$("article");
  assert.deepEqual([...article.querySelectorAll("h1,h2,h3")].map((h) => [h.tagName, h.textContent]),
    [["H1", "Annealing"], ["H2", "Details"]]);
  assert.equal(article.querySelector("p > em")?.textContent, "Emphasis");
  assert.equal(article.querySelector("strong a em")?.textContent, "nested");
  assert.equal(article.querySelector("strong a")?.getAttribute("href"), "https://example.com/path_(one)?a=1&b=2");
  assert.match(article.textContent!, /& escaped \[brackets\]/);
  assert.equal(article.querySelector("ol")?.start, 3);
  assert.equal(article.querySelector("ol > li > ul > li > strong")?.textContent, "strength");
  assert.equal(article.querySelectorAll("blockquote p").length, 2);
  assert.equal(article.querySelector("table tbody td em")?.textContent, "A");
  assert.equal((article.querySelectorAll("td")[1] as HTMLElement).style.textAlign, "right");
  const reference = article.querySelector('a[title="A title"]') as HTMLAnchorElement;
  assert.equal(reference.href, "https://example.com/reference");
  assert.equal(reference.rel, "noopener noreferrer");
  assert.ok(article.querySelector('a[href="https://example.com/docs"]'));
});

test("the same Markdown renderer formats answers and recaps without interpreting code", async (t) => {
  const snapshot = fixture();
  const markdown = '## Details\n\n**[Source](https://example.com)** and _emphasis_.\n\n```html\n<script>alert(1)</script>\n```\n\n`<img src=x>`';
  snapshot.current!.exchanges[0].answer = markdown;
  snapshot.current!.summary = markdown;
  const ui = await client(t, snapshot);
  const check = (root: HTMLElement) => {
    assert.equal(root.querySelector("h2")?.textContent, "Details");
    assert.equal(root.querySelector("strong a")?.textContent, "Source");
    assert.equal(root.querySelector("em")?.textContent, "emphasis");
    assert.equal(root.querySelector("pre code")?.textContent, "<script>alert(1)</script>\n");
    assert.equal(root.querySelector("p code")?.textContent, "<img src=x>");
    assert.equal(root.querySelector("script,img"), null);
  };
  check(ui.$("thread"));
  ui.type("question", "/recap");
  await ui.submit("askForm");
  check(ui.$("article"));
});

test("Markdown cannot create active HTML, remote images, or unsafe links", async (t) => {
  const snapshot = fixture();
  snapshot.current!.article.content = { format: "markdown", text: String.raw`<script>window.pwned = true</script>

<img src="https://example.com/tracker" onerror="window.pwned = true">

<iframe src="https://example.com"></iframe>

[script](javascript:alert%281%29) [encoded](jav&#x61;script:alert%281%29)

[data](data:text/html,hello) [file](file:///etc/passwd) [credentials](https://user:pass@example.com/)

![chart **description**](https://example.com/tracker.png)

&lt;img src=x onerror=alert(1)&gt;

[safe](https://example.com/?x=%22onclick%3Dalert%281%29 "An innocent title")` };
  const ui = await client(t, snapshot);
  const article = ui.$("article");
  assert.equal(article.querySelector("script,img,iframe,object,embed,svg,style,input"), null);
  assert.equal((ui.window as unknown as { pwned?: boolean }).pwned, undefined);
  assert.match(article.textContent!, /\[Image: chart description\]/);
  assert.match(article.textContent!, /<img src=x onerror=alert\(1\)>/);
  assert.equal(article.querySelectorAll("a").length, 1);
  for (const node of article.querySelectorAll("*")) {
    assert.ok([...node.attributes].every((attr) => !attr.name.startsWith("on")));
  }
});

test("Markdown links with no target in the page stay plain text", async (t) => {
  const snapshot = fixture();
  snapshot.current!.article.content = {
    format: "markdown",
    text: "# Annealing\n\nA [footnote](#fn1), a [backref](#fnref1) and an [empty]() link.\n\n![](https://example.com/x.png)\n",
  };
  const ui = await client(t, snapshot);
  const article = ui.$("article");
  assert.equal(article.querySelectorAll("a").length, 0); // Neither resolves against the source URL.
  assert.match(article.textContent!, /A footnote, a backref and an empty link/);
  assert.match(article.textContent!, /\[Image\]/); // An undescribed image is still marked, not a blank gap.
});

test("reader-view HTML keeps figures, images and tables but nothing active", async (t) => {
  const snapshot = fixture();
  snapshot.current!.article.content = { format: "html", text: String.raw`<div id="readability-page-1" class="page">
<h1>Cooling</h1>
<p id="question" class="lead" style="color:red" onclick="window.pwned = true">Worse moves<sup>1</sup> are <a href="javascript:alert(1)">early</a>,
<a href="/wiki/Temperature" title="Temperature" id="thread">temperature</a> and <a href="#cite_note-1">[1]</a>.</p>
<figure><a href="https://example.com/file"><img src="/chart.png" srcset="/chart-2x.png 2x, javascript:alert(1) 3x" alt="Energy chart" width="500" height="161" onerror="window.pwned = true" style="display:none" class="thumb"></a><figcaption>Energy over time</figcaption></figure>
<p><picture><source srcset="https://example.com/a.avif" type="image/avif"><img src="https://example.com/a.png" srcset="https://cdn.example.com/w_300,h_200/a.png 300w, https://cdn.example.com/w_600,h_400/a.png 600w" alt="Responsive"></picture></p>
<p>Formula <img src="https://wikimedia.org/api/rest_v1/media/math/render/svg/abc" alt="{\displaystyle e_{\mathrm {new} }}"> inline.</p>
<img src="https://tracker.example.com/pixel.gif" width="1" height="1">
<img src="file:///Users/reader/secret.png" alt="Local figure"><img src="data:text/html,<script>window.pwned = true</script>" alt="Bad data">
<img src="data:image/png;base64,iVBORw0KGgo=" alt="Inline data">
<script>window.pwned = true</script><style>body{display:none}</style><iframe src="https://example.com"></iframe>
<svg><script>window.pwned = true</script></svg><form action="https://evil.example"><input name="q"><button>Go</button></form>
<p><math><semantics><mi>x</mi><annotation encoding="application/x-tex">\TeXsource</annotation></semantics></math></p>
<table><tr><th colspan="2" rowspan="x">Head</th></tr><tr><td>A</td><td>B</td></tr></table>
<pre><code><span class="k">def</span> f():
    return 1</code></pre>
<custom-element>Unwrapped text</custom-element><section><p>Sectioned</p></section>
<template><p>Hidden template</p></template><noscript><p>Hidden noscript</p></noscript>
</div>` };
  const ui = await client(t, snapshot);
  const article = ui.$("article");
  assert.equal(article.querySelector("script,style,iframe,svg,form,input,button,template,noscript,math,picture,source"), null);
  assert.equal((ui.window as unknown as { pwned?: boolean }).pwned, undefined);
  for (const node of article.querySelectorAll("*")) {
    for (const { name } of node.attributes) {
      assert.ok(!["id", "style"].includes(name) && !name.startsWith("on"), `${node.tagName} kept ${name}`);
    }
  }
  // The article cannot shadow the page's own elements.
  assert.equal(ui.$("question").tagName, "TEXTAREA");
  assert.equal(ui.$("thread").tagName, "SECTION");
  assert.deepEqual([...article.querySelectorAll("h1,h2")].map((h) => [h.tagName, h.textContent]),
    [["H1", "Annealing"], ["H2", "Cooling"]]);

  const images = [...article.querySelectorAll("img")];
  assert.deepEqual(images.map((img) => img.getAttribute("alt")),
    ["Energy chart", "Responsive", "{\\displaystyle e_{\\mathrm {new} }}", "Inline data"]);
  const [chart, responsive, formula, inline] = images;
  assert.equal(chart.getAttribute("src"), "https://example.com/chart.png");
  assert.equal(chart.getAttribute("srcset"), null); // One unsafe candidate drops the set, not the image.
  assert.deepEqual([chart.getAttribute("width"), chart.getAttribute("height")], ["500", "161"]);
  assert.deepEqual([chart.getAttribute("loading"), chart.getAttribute("referrerpolicy")], ["lazy", "no-referrer"]);
  assert.equal(chart.className, "");
  assert.equal(chart.closest("a")?.getAttribute("href"), "https://example.com/file");
  assert.equal(article.querySelector("figure figcaption")?.textContent, "Energy over time");
  assert.equal(responsive.getAttribute("srcset"),
    "https://cdn.example.com/w_300,h_200/a.png 300w, https://cdn.example.com/w_600,h_400/a.png 600w");
  assert.match(responsive.getAttribute("sizes")!, /680px/);
  assert.equal(chart.getAttribute("sizes"), null);
  assert.equal(formula.className, "formula");
  assert.equal(inline.getAttribute("src"), "data:image/png;base64,iVBORw0KGgo=");
  assert.match(article.textContent!, /\[Image: Local figure\]\s*\[Image: Bad data\]/);

  const links = [...article.querySelectorAll("a")];
  assert.deepEqual(links.map((a) => a.getAttribute("href")), ["https://example.com/wiki/Temperature", "https://example.com/file"]);
  assert.deepEqual([links[0].target, links[0].rel, links[0].title], ["_blank", "noopener noreferrer", "Temperature"]);
  assert.match(article.textContent!, /Worse moves1 are early,\s+temperature and \[1\]\./);
  assert.equal(article.querySelector("sup")?.textContent, "1");
  const head = article.querySelector("th")!;
  assert.deepEqual([head.getAttribute("colspan"), head.getAttribute("rowspan")], ["2", null]);
  assert.equal(article.querySelector("pre > code")?.textContent, "def f():\n    return 1");
  assert.equal(article.querySelector("pre span"), null);
  assert.equal(article.querySelector("div > p:only-child")?.textContent, "Sectioned");
  assert.match(article.textContent!, /Unwrapped text/);
  assert.doesNotMatch(article.textContent!, /Hidden|TeXsource|Go\b/);
});

test("a reader-view article is redrawn only when it changes, so its images are not reloaded", async (t) => {
  const snapshot = fixture();
  snapshot.current!.article.content = {
    format: "html", text: '<p>Body text.</p><img src="https://example.com/chart.png" alt="Chart">',
  };
  const ui = await client(t, snapshot);
  const first = ui.$("article").querySelector("img");
  assert.ok(first);
  ui.type("question", "What does the chart show?");
  await ui.submit("askForm");
  assert.equal(ui.calls.at(-1)?.action, "ask");
  assert.equal(ui.$("article").querySelector("img"), first);
  ui.type("question", "/recap");
  await ui.submit("askForm");
  assert.equal(ui.$("article").querySelector("img"), null);
  ui.type("question", "/article");
  await ui.submit("askForm");
  assert.equal(ui.$("article").querySelector("img")?.getAttribute("alt"), "Chart");
});

test("reader-view HTML recovers extensionless lazy-loaded images and source sets", async (t) => {
  const snapshot = fixture();
  snapshot.current!.article.content = { format: "html", text: `<p>Lazy figures follow.</p>
<img class="lazy" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-src="/image?id=123&amp;format=webp" alt="Lazy URL" width="1" height="1">
<img data-srcset="/image?id=small 320w, /image?id=large 960w" alt="Lazy set">` };
  const ui = await client(t, snapshot);
  const [url, set] = [...ui.$("article").querySelectorAll("img")];
  assert.equal(url.getAttribute("src"), "https://example.com/image?id=123&format=webp");
  assert.deepEqual([url.getAttribute("width"), url.getAttribute("height")], [null, null]);
  assert.equal(set.getAttribute("src"), null);
  assert.equal(set.getAttribute("srcset"),
    "https://example.com/image?id=small 320w, https://example.com/image?id=large 960w");
  assert.match(set.getAttribute("sizes")!, /680px/);
});

test("browser page restores an attached passage, explains it with Enter and clears it with Escape", async (t) => {
  const snapshot = fixture();
  snapshot.current!.selection = "worse moves";
  const ui = await client(t, snapshot);
  assert.equal(ui.$("quoted").hidden, false); // The attached quote is visible, not hidden state.
  assert.match(ui.$("quotedText").textContent!, /worse moves/);
  await ui.press("Enter");
  assert.deepEqual(ui.calls.at(-1), { action: "explain", body: { selection: "worse moves" } });
  await ui.press("Escape");
  assert.deepEqual(ui.calls.at(-1), { action: "select", body: { selection: "" } });
  assert.equal(ui.$("quoted").hidden, true);
});

test("the explain hint is a button that explains the live selection on click", async (t) => {
  const ui = await client(t);
  const { document } = ui.window;
  const paragraph = document.querySelector("article p")!;
  paragraph.textContent = "  worse  moves ";
  const range = document.createRange();
  range.selectNodeContents(paragraph);
  range.getClientRects = () => [{ right: 100, top: 20 }] as unknown as DOMRectList;
  const selection = ui.window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new ui.window.Event("selectionchange"));
  await ui.settle();
  assert.equal(ui.$("hint").hidden, false);

  const sent = ui.calls.length;
  // The press that starts the click is cancelled, or it would collapse the selection being explained.
  const press = new ui.window.MouseEvent("mousedown", { bubbles: true, cancelable: true });
  ui.$("hint").dispatchEvent(press);
  assert.equal(press.defaultPrevented, true);
  ui.$("hint").dispatchEvent(new ui.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  await ui.settle();
  // One request: the click attaches the passage and asks for the explanation in the same call.
  assert.deepEqual(ui.calls.slice(sent), [{ action: "explain", body: { selection: "worse moves" } }]);
  assert.equal(ui.$("quoted").hidden, false);
  assert.match(ui.$("quotedText").textContent!, /worse moves/);

  await ui.press("Escape"); // The passage stays attached until it is cleared, as after Enter.
  assert.deepEqual(ui.calls.at(-1), { action: "select", body: { selection: "" } });
  assert.equal(ui.$("quoted").hidden, true);
});

test("clearing a quote with Escape scrolls back to the passage it came from", async (t) => {
  const markdown = "# Annealing\n\nEarly on it takes worse moves.\n\nFiller.\n\nLate in the run, worse\nmoves are rare.";
  // jsdom has no layout: each article paragraph sits at the top given here, by index.
  const layout = async (snapshot: BrowserSnapshot, tops: number[]) => {
    const ui = await client(t, snapshot);
    const scrolls: unknown[] = [];
    ui.window.scrollTo = ((options: object) => { scrolls.push({ ...options }); }) as typeof ui.window.scrollTo;
    ui.window.Range.prototype.getBoundingClientRect = function (this: Range) {
      const top = tops[[...ui.$("article").querySelectorAll("p")].indexOf(this.startContainer.parentElement as HTMLParagraphElement)];
      return { top, bottom: top + 20 } as DOMRect;
    };
    return { ui, scrolls, third: ui.window.innerHeight / 3 };
  };
  const select = async (ui: Awaited<ReturnType<typeof client>>, paragraph: number) => {
    const node = ui.$("article").querySelectorAll("p")[paragraph];
    const text = node.firstChild as Text;
    const range = ui.window.document.createRange();
    range.setStart(text, text.data.indexOf("worse"));
    range.setEnd(node, node.childNodes.length);
    ui.window.getSelection()!.removeAllRanges();
    ui.window.getSelection()!.addRange(range);
    ui.$("article").dispatchEvent(new ui.window.MouseEvent("mouseup", { bubbles: true }));
    await ui.settle();
  };

  // The words repeat; the scroll goes to the occurrence that was selected, though the
  // article was rebuilt in between and the quote's line break is not in the page text.
  let snapshot = fixture();
  snapshot.current!.article.content = { format: "markdown", text: markdown };
  let { ui, scrolls, third } = await layout(snapshot, [900, 1900, 2900]);
  await select(ui, 2);
  assert.match(ui.$("quotedText").textContent!, /worse moves are rare/);
  await ui.press("Escape");
  assert.equal(ui.$("quoted").hidden, true);
  assert.deepEqual(scrolls, [{ top: 2900 - third, behavior: "smooth" }]);

  // A passage already on screen stays put.
  ({ ui, scrolls } = await layout(snapshot, [100, 1900, 2900]));
  await select(ui, 0);
  await ui.press("Escape");
  assert.deepEqual(scrolls, []);

  // A quote attached in another tab has no selected position, so its first match is used.
  snapshot = fixture();
  snapshot.current!.article.content = { format: "markdown", text: markdown };
  snapshot.current!.selection = "worse moves";
  ({ ui, scrolls } = await layout(snapshot, [900, 1900, 2900]));
  await ui.press("Escape");
  assert.deepEqual(scrolls, [{ top: 900 - third, behavior: "smooth" }]);
});

test("browser page only reopens a saved URL when selected from the URL list", async (t) => {
  const snapshot = fixture();
  snapshot.pages.push({ url: "https://example.com/b", title: "Another page" });
  const ui = await client(t, snapshot);
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

test("browser page reopens a saved URL from a datalist pick whatever events the engine sends", async (t) => {
  const snapshot = fixture();
  snapshot.pages.push({ url: "https://example.com/b", title: "Another page" });
  const ui = await client(t, snapshot);
  const pick = async (events: string[]) => {
    ui.type("url", "https://example.com/b");
    for (const type of events) {
      ui.$("url").dispatchEvent(type === "change"
        ? new ui.window.Event("change", { bubbles: true })
        : new ui.window.InputEvent("input", { inputType: type, bubbles: true }));
    }
    await ui.settle();
    return ui.calls.filter(({ action }) => action === "load").length;
  };
  // Engines that never set insertReplacementText still reopen the page on the committed value.
  assert.equal(await pick(["change"]), 1);
  // Engines that send both describe one pick, so it must not load twice.
  assert.equal(await pick(["insertReplacementText", "change"]), 2);
});

test("browser page shows the URL it is loading, not the page that is still on screen", async (t) => {
  const ui = await client(t);
  ui.hangNext();
  ui.type("url", "https://example.com/b");
  await ui.submit("loadForm");
  assert.deepEqual(ui.calls.at(-1), { action: "load", body: { url: "https://example.com/b" } });
  assert.match(ui.$("foot").textContent!, /Loading source/);
  assert.equal((ui.$("url") as HTMLInputElement).value, "https://example.com/b");
  await ui.press("Escape"); // Cancelling puts the URL of the article still on screen back.
  assert.equal(ui.calls.at(-1)!.action, "cancel");
  assert.equal((ui.$("url") as HTMLInputElement).value, "https://example.com/a");
});

test("a cancelled load cannot clear a retry's loading indicator or duplicate guard", async (t) => {
  const ui = await client(t);
  const url = "https://example.com/b";
  const first = ui.deferNext();
  ui.type("url", url);
  await ui.submit("loadForm");
  await ui.press("Escape");

  const retry = ui.deferNext();
  ui.type("url", url);
  await ui.submit("loadForm");
  first(fixture()); // The cancelled response arrives after a retry of the same URL starts.
  await ui.settle();
  assert.equal((ui.$("url") as HTMLInputElement).value, url);
  assert.match(ui.$("foot").textContent!, /Loading source/);

  await ui.submit("loadForm");
  assert.equal(ui.calls.filter(({ action }) => action === "load").length, 2);

  const completed = fixture();
  completed.current!.article.url = "https://example.com/canonical-b";
  retry(completed);
  await ui.settle();
  assert.equal((ui.$("url") as HTMLInputElement).value, completed.current!.article.url);
  assert.equal(ui.$("foot").classList.contains("busy"), false);
});

test("browser selection capture and hint accept article text and reject outside or collapsed ranges", async (t) => {
  const ui = await client(t);
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
    ui.$("quotedText").textContent = "";
    const sent = ui.calls.length;
    await select(node);
    assert.equal(ui.calls.length, sent + 1); // Each range is captured on its own, not left over from the last.
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

test("text in a previous answer can be selected, explained and asked about like article text", async (t) => {
  const ui = await client(t);
  const { document } = ui.window;
  const selection = ui.window.getSelection()!;
  const select = async (node: Node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    range.getClientRects = () => [{ right: 100, top: 20 }] as unknown as DOMRectList;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new ui.window.Event("selectionchange"));
    ui.$("thread").dispatchEvent(new ui.window.MouseEvent("mouseup", { bubbles: true }));
    await ui.settle();
  };
  // The question line and its quoted passage are not answer text.
  const before = ui.calls.length;
  await select(document.querySelector("#thread .q")!);
  await select(document.querySelector("#thread blockquote")!);
  assert.equal(ui.calls.length, before);
  assert.equal(ui.$("hint").hidden, true);

  await select(document.querySelector("#thread .a p")!.firstChild!);
  assert.deepEqual(ui.calls.at(-1), { action: "select", body: { selection: "Because." } });
  assert.equal(ui.$("hint").hidden, false);
  assert.match(ui.$("quotedText").textContent!, /Because\./);
  await ui.press("Enter");
  assert.deepEqual(ui.calls.at(-1), { action: "explain", body: { selection: "Because." } });

  await select(document.querySelector("#thread .a p")!.firstChild!);
  ui.type("question", "Why does that follow?");
  await ui.submit("askForm");
  assert.deepEqual(ui.calls.at(-1), { action: "ask", body: { question: "Why does that follow?", selection: "Because." } });
});
