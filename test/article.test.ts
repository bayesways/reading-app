import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { cleanText, extractArticle, fetchArticle, MAX_PAGE_BYTES, normalizeUrl } from "../src/article.ts";

const paragraph = "Bayesian inference updates prior beliefs using observed evidence. The posterior combines the likelihood and prior, with a normalizing constant. Uncertainty is represented using probability distributions rather than just a single estimate.";
const html = `<html><head><title>A Bayesian introduction</title></head><body><nav>Home</nav><article><h1>Updating beliefs</h1><p>${paragraph}</p><h2>Evidence</h2><p>${paragraph}</p><a href="/more">More reading</a><a href="javascript:alert(1)">Bad link</a><img src="/tracker" alt="Posterior plot"><script>globalThis.readerExecuted = true</script></article></body></html>`;

test("URLs are canonicalized without collapsing meaningful queries", () => {
  assert.equal(normalizeUrl("example.com/article#section"), "https://example.com/article");
  assert.equal(normalizeUrl("https://EXAMPLE.com:443/a?q=1#x"), "https://example.com/a?q=1");
  for (const bad of ["", "file:///etc/passwd", "javascript:alert(1)", "ftp://example.com", "https://u:p@example.com"]) {
    assert.throws(() => normalizeUrl(bad));
  }
});

test("extracts Markdown, resolves links, strips scripts and keeps image descriptions", () => {
  const article = extractArticle(html, "https://example.com/article");
  assert.match(article.title, /Bayesian/);
  assert.match(article.markdown, /## Evidence/);
  assert.match(article.markdown, /https:\/\/example.com\/more/);
  assert.match(article.markdown, /Posterior plot/);
  assert.doesNotMatch(article.markdown, /javascript:|readerExecuted|tracker/);
  assert.equal((globalThis as Record<string, unknown>).readerExecuted, undefined);
});

test("terminal commands and bidi overrides never reach rendered text", () => {
  const result = cleanText("hello\x1b[2J\x1b]52;c;ZXZpbA==\x07world\u202eevil\x00");
  assert.equal(result, "helloworldevil");
});

test("empty/JS-only pages fail with an actionable message", () => {
  assert.throws(() => extractArticle("<script>document.write('hi')</script>", "https://example.com"), /No readable article/);
});

test("HTTP fetch: redirect, plain text, errors, size limits, timeout cancellation", async () => {
  const sockets = new Set<import("node:net").Socket>();
  const server = createServer((req, res) => {
    switch (req.url) {
      case "/redirect": res.writeHead(302, { location: "/article" }); res.end(); break;
      case "/loop": res.writeHead(302, { location: "/loop" }); res.end(); break;
      case "/unsafe": res.writeHead(302, { location: "file:///tmp/page" }); res.end(); break;
      case "/article": res.setHeader("content-type", "text/html; charset=utf-8"); res.end(html); break;
      case "/text": res.setHeader("content-type", "text/plain"); res.end(paragraph); break;
      case "/pdf": res.setHeader("content-type", "application/pdf"); res.end("fake pdf"); break;
      case "/big": res.setHeader("content-length", MAX_PAGE_BYTES + 1); res.end(); break;
      case "/chunked": res.setHeader("content-type", "text/plain"); res.write("x".repeat(MAX_PAGE_BYTES)); res.end("extra"); break;
      case "/wait": break;
      default: res.writeHead(403); res.end();
    }
  });
  server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  const signal = new AbortController().signal;
  try {
    assert.equal((await fetchArticle(`${base}/redirect`, signal)).url, `${base}/article`);
    assert.equal((await fetchArticle(`${base}/text`, signal)).markdown, paragraph);
    for (const [path, error] of [["/pdf", /Unsupported/], ["/big", /2 MiB/], ["/chunked", /2 MiB/], ["/loop", /too many/], ["/unsafe", /HTTP/], ["/denied", /403/]] as const) {
      await assert.rejects(fetchArticle(base + path, signal), error);
    }
    await assert.rejects(fetchArticle(`${base}/wait`, AbortSignal.timeout(30)), /timeout|abort/i);
  } finally {
    sockets.forEach((s) => s.destroy());
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
