import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import {
  cleanText, extractArticle, fetchArticle, loadSource, MAX_PAGE_BYTES, MAX_PDF_BYTES, normalizeUrl, resolveSource,
} from "../src/article.ts";

const paragraph = "Bayesian inference updates prior beliefs using observed evidence. The posterior combines the likelihood and prior, with a normalizing constant. Uncertainty is represented using probability distributions rather than just a single estimate.";
/** A minimal valid PDF whose pages each draw the given lines of text (no lines: no text layer). */
function makePdf(pages: string[][], title?: string): Buffer {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body) - 1 + 1;
  const catalog = add("");
  const tree = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const kids = pages.map((lines) => {
    const text = lines.map((line, i) => `BT /F1 12 Tf 72 ${720 - i * 16} Td (${line.replace(/[()\\]/g, "\\$&")}) Tj ET`).join("\n");
    const content = add(`<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`);
    return add(`<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`);
  });
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${tree} 0 R >>`;
  objects[tree - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  const info = title ? add(`<< /Title (${title}) >>`) : 0;
  let out = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => { const at = Buffer.byteLength(out); out += `${i + 1} 0 obj\n${body}\nendobj\n`; return at; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R${info ? ` /Info ${info} 0 R` : ""} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const pdf = makePdf([["Bayesian inference updates prior", "beliefs using evidence."], ["# 3 is not a heading"]], "Priors and posteriors");

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
  // The browser gets the reader view itself; only it may show the image.
  assert.match(article.html!, /<h2>Evidence<\/h2>/);
  assert.match(article.html!, /<img src="https:\/\/example.com\/tracker" alt="Posterior plot">/);
  assert.doesNotMatch(article.html!, /<script|javascript:|readerExecuted/);
});

test("extraction preserves fragments and does not invent links for named anchors", () => {
  const linked = `<html><head><title>Annealing notes</title></head><body><article>
<h1>Annealing notes</h1><p>${paragraph}</p><p>${paragraph}</p>
<p><a href=" #cite_note-1 ">[1]</a> <a name="section">Section target</a>
<a href="/more">More reading</a></p></article></body></html>`;
  const article = extractArticle(linked, "https://example.com/wiki/Annealing");
  assert.match(article.html!, /href="#cite_note-1"/);
  assert.doesNotMatch(article.html!, /<a[^>]+href="https:\/\/example\.com\/wiki\/Annealing"[^>]*>Section target/);
  assert.doesNotMatch(article.markdown, /\[Section target\]\(https:\/\/example\.com\/wiki\/Annealing\)/);
  assert.match(article.html!, /href="https:\/\/example\.com\/more"/);
});

test("images hidden from scripts are recovered for the browser but described to the model", () => {
  const lazy = `<html><head><title>Lazy figures</title></head><body><article><p>${paragraph}</p>
<figure><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-src="/figures/prior.png" alt="Prior density"><figcaption>The prior.</figcaption></figure>
<p>${paragraph}</p>
<figure><img class="lazyload" src="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E" alt=""><noscript><img src="/figures/posterior.png" alt="Posterior density"></noscript><figcaption>The posterior.</figcaption></figure>
<p>${paragraph}</p></article></body></html>`;
  const article = extractArticle(lazy, "https://example.com/post");
  assert.match(article.html!, /src="https:\/\/example.com\/figures\/prior.png"/);
  assert.match(article.html!, /src="https:\/\/example.com\/figures\/posterior.png"/);
  assert.doesNotMatch(article.html!, /noscript/);
  assert.match(article.markdown, /\\\[Image: Prior density\\\]\s+The prior\./);
  assert.match(article.markdown, /\\\[Image: Posterior density\\\]\s+The posterior\./);
  assert.doesNotMatch(article.markdown, /figures|data:/);
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
      case "/pdf": res.setHeader("content-type", "application/pdf"); res.end(pdf); break;
      case "/download": res.setHeader("content-type", "application/octet-stream"); res.end(pdf); break;
      case "/binary": res.setHeader("content-type", "application/octet-stream"); res.end("not a pdf"); break;
      case "/zip": res.setHeader("content-type", "application/zip"); res.end("PK"); break;
      case "/bigpdf": res.setHeader("content-type", "application/pdf"); res.setHeader("content-length", MAX_PDF_BYTES + 1); res.end(); break;
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
    for (const path of ["/pdf", "/download"]) {
      const article = await fetchArticle(base + path, signal);
      assert.equal(article.title, "Priors and posteriors");
      assert.match(article.markdown, /Bayesian inference updates prior beliefs using evidence\./);
    }
    for (const [path, error] of [["/zip", /Unsupported/], ["/binary", /Unsupported/], ["/bigpdf", /25 MiB/], ["/big", /2 MiB/], ["/chunked", /2 MiB/], ["/loop", /too many/], ["/unsafe", /HTTP/], ["/denied", /403/]] as const) {
      await assert.rejects(fetchArticle(base + path, signal), error);
    }
    await assert.rejects(fetchArticle(`${base}/wait`, AbortSignal.timeout(30)), /timeout|abort/i);
  } finally {
    sockets.forEach((s) => s.destroy());
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("PDF text keeps page markers and escapes Markdown syntax; text-less PDFs fail clearly", async () => {
  const dir = await mkdtemp(join(tmpdir(), "reader-pdf-"));
  const signal = new AbortController().signal;
  try {
    await writeFile(join(dir, "paper.pdf"), pdf);
    await writeFile(join(dir, "scan.pdf"), makePdf([[]]));
    await writeFile(join(dir, "broken.pdf"), "%PDF-1.4 nonsense");
    const article = await loadSource(await resolveSource(join(dir, "paper.pdf")), signal);
    assert.equal(article.title, "Priors and posteriors");
    assert.match(article.markdown, /^\*\*Page 1\*\*/);
    assert.match(article.markdown, /\*\*Page 2\*\*\n\n\\# 3 is not a heading/);
    const untitled = await loadSource(pathToFileURL(join(dir, "scan.pdf")).href, signal).catch((error: Error) => error);
    assert.match(String(untitled), /no extractable text/);
    await assert.rejects(loadSource(pathToFileURL(join(dir, "broken.pdf")).href, signal), /PDF/);
    await assert.rejects(loadSource(pathToFileURL(join(dir, "paper.pdf")).href, AbortSignal.abort()), /abort/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("local paths resolve to one canonical file URL and only readable document types load", async () => {
  const dir = await mkdtemp(join(tmpdir(), "reader-local-"));
  const signal = new AbortController().signal;
  try {
    const page = join(dir, "page.html");
    await writeFile(page, html.replace('href="/more"', 'href="notes.html"').replace("<title>A Bayesian introduction</title>", ""));
    await writeFile(join(dir, "notes.txt"), paragraph);
    await writeFile(join(dir, "tool.exe"), "binary");
    await writeFile(join(dir, "huge.html"), "x".repeat(MAX_PAGE_BYTES + 1));
    await mkdir(join(dir, "folder.html"));
    await symlink(join(dir, "tool.exe"), join(dir, "alias.html"));
    const key = await resolveSource(page);
    assert.match(key, /^file:\/\/.*\/page\.html$/);
    for (const spelling of [pathToFileURL(page).href, `  ${page}  `, join(dir, ".", "page.html")]) {
      assert.equal(await resolveSource(spelling), key);
    }
    assert.equal(await resolveSource("./page.html", dir), key);
    assert.equal(await resolveSource("page.html", dir), key);
    if (page.startsWith(homedir())) assert.equal(await resolveSource(`~/${relative(homedir(), page)}`), key);
    // A bare name that isn't on disk is still a web address.
    assert.equal(await resolveSource("example.com/x", dir), "https://example.com/x");

    const article = await loadSource(key, signal);
    assert.equal(article.title, "page.html");
    assert.match(article.markdown, /## Evidence/);
    assert.doesNotMatch(article.markdown, /file:|notes\.html\)/);
    const text = await loadSource(await resolveSource(join(dir, "notes.txt")), signal);
    assert.deepEqual([text.title, text.markdown], ["notes.txt", paragraph]);

    for (const [input, error] of [
      [join(dir, "missing.pdf"), /not found/], [join(dir, "tool.exe"), /Unsupported file type/],
      [join(dir, "folder.html"), /Not a file/], [join(dir, "alias.html"), /Unsupported file type/],
      ["file://remote-host/share/a.pdf", /file URL/],
    ] as const) {
      await assert.rejects(resolveSource(input), error);
    }
    await assert.rejects(loadSource(await resolveSource(join(dir, "huge.html")), signal), /2 MiB/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
