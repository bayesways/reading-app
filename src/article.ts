import { realpath, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import TurndownService from "turndown";

export interface Article {
  url: string;
  title: string;
  /** What the model and the terminal read. Images appear only as their descriptions. */
  markdown: string;
  /** The reader-view HTML of a web page, for the browser. Untrusted: it is sanitized where it is shown. */
  html?: string;
  warning?: string;
}

export const MAX_PAGE_BYTES = 2 * 1024 * 1024;
export const MAX_PDF_BYTES = 25 * 1024 * 1024;

// Local reads are limited to documents the reader can render, so a path can never expose other files.
const LOCAL_TYPES: Record<string, "html" | "pdf" | "text"> = {
  ".html": "html", ".htm": "html", ".xhtml": "html", ".pdf": "pdf", ".txt": "text",
};

/** Web pages and model output must not be allowed to emit terminal commands. */
export function cleanText(text: string): string {
  return stripVTControlCharacters(text)
    .replace(/\r\n?/g, "\n")
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "")
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, "");
}

export function normalizeUrl(value: string): string {
  const input = value.trim();
  if (!input) throw new Error("Enter an article URL first.");
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:/i.test(input) ? input : `https://${input}`);
  } catch {
    throw new Error("That URL is not valid. Use an http:// or https:// address.");
  }
  if (!["https:", "http:"].includes(url.protocol)) {
    throw new Error("Only HTTP and HTTPS pages are supported.");
  }
  if (url.username || url.password) throw new Error("URLs containing credentials are not supported.");
  url.hash = "";
  return url.href;
}

/** A readable name for a source: the host of a web page, the file name of a local document. */
export function sourceLabel(url: string): string {
  const parsed = new URL(url);
  return parsed.protocol === "file:" ? basename(fileURLToPath(parsed)) : parsed.hostname;
}

function looksLikePath(input: string): boolean {
  return /^(?:[\\/]|~(?:[\\/]|$)|\.{1,2}[\\/]|[a-z]:[\\/])/i.test(input);
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

/**
 * Canonical key for what the user typed: an http(s) URL, or a file: URL for a local
 * document given as a path or file:// URL. Different spellings of one file share a key.
 */
export async function resolveSource(value: string, cwd = process.cwd()): Promise<string> {
  const input = value.trim();
  let path: string | undefined;
  if (/^file:/i.test(input)) {
    try { path = fileURLToPath(input); }
    catch { throw new Error("That file URL is not valid. Use file:///absolute/path."); }
  } else if (looksLikePath(input)) {
    path = input.replace(/^~(?=[\\/]|$)/, homedir());
  } else if (input && !/^[a-z][a-z\d+.-]*:\/\//i.test(input) && await exists(resolve(cwd, input))) {
    path = input; // A bare relative path such as docs/paper.pdf, only when it exists.
  }
  if (path === undefined) return normalizeUrl(input);
  const absolute = isAbsolute(path) ? path : resolve(cwd, path);
  let real: string;
  try { real = await realpath(absolute); }
  catch { throw new Error(`File not found: ${absolute}`); }
  if (!(await stat(real)).isFile()) throw new Error(`Not a file: ${absolute}`);
  if (!LOCAL_TYPES[extname(real).toLowerCase()]) {
    throw new Error("Unsupported file type. Open an .html, .htm, .xhtml, .pdf, or .txt file.");
  }
  return pathToFileURL(real).href;
}

/** Images cannot reach the model or the terminal. Keep descriptive alt text, not tracking URLs. */
function describeImages(html: string, document: Document): string {
  const holder = document.createElement("div");
  holder.innerHTML = html;
  holder.querySelectorAll("img").forEach((img) => {
    img.replaceWith(document.createTextNode(img.alt ? `[Image: ${img.alt}]` : ""));
  });
  return holder.innerHTML;
}

export function extractArticle(html: string, url: string): Article {
  // No runScripts or resources option: scripts never execute, subresources never load.
  const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
  try {
    const document = dom.window.document;
    // <noscript> stays for now: Readability recovers the images lazy-loading pages hide in it.
    document.querySelectorAll("script,style,iframe,object,embed,svg,form,button,input,base").forEach((n) => n.remove());
    document.querySelectorAll("a").forEach((a) => {
      const raw = a.getAttribute("href");
      if (raw === null) return;
      const href = raw.trim();
      if (!href) {
        a.removeAttribute("href");
        return;
      }
      // Reader output has no source-page anchors. Keep fragments recognizable so
      // the browser renderer can turn them into text instead of external links.
      if (href.startsWith("#")) {
        a.setAttribute("href", href);
        return;
      }
      try {
        const target = new URL(href, url);
        if (!["http:", "https:"].includes(target.protocol)) throw new Error("Unsafe link");
        a.setAttribute("href", target.href);
      } catch {
        a.removeAttribute("href");
      }
    });
    const parsed = new Readability(document.cloneNode(true) as Document, {
      charThreshold: 100,
      maxElemsToParse: 50_000,
    }).parse();
    // Readability drops <noscript> itself; the fallback has no such pass.
    document.querySelectorAll("noscript").forEach((n) => n.remove());
    const fallback = document.querySelector("article,main") ?? document.body;
    const content = cleanText(parsed?.content ?? fallback?.innerHTML ?? "");
    const converter = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
    const markdown = cleanText(converter.turndown(describeImages(content, document))).trim();
    if (markdown.length < 40) {
      throw new Error("No readable article found. This page may require JavaScript, login, or a subscription.");
    }
    return {
      url,
      title: cleanText(parsed?.title || document.title || sourceLabel(url)).replace(/\s+/g, " ").trim(),
      markdown,
      html: content,
      warning: parsed ? undefined : "Reader extraction was unavailable; showing simplified page content.",
    };
  } finally {
    dom.window.close();
  }
}

function sizeError(limit: number): Error {
  return new Error(`This ${limit === MAX_PDF_BYTES ? "PDF" : "page"} exceeds the ${limit / 1024 / 1024} MiB limit.`);
}

async function boundedBytes(response: Response, limit: number): Promise<Buffer> {
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw sizeError(limit);
  }
  if (!response.body) throw new Error("The server returned an empty page.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw sizeError(limit);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

function decodeBody(response: Response, bytes: Buffer): string {
  const charset = response.headers.get("content-type")?.match(/charset=["']?([^;\s"']+)/i)?.[1] ?? "utf-8";
  let decoder: TextDecoder;
  try { decoder = new TextDecoder(charset); } catch { decoder = new TextDecoder(); }
  return decoder.decode(bytes);
}

function textArticle(text: string, url: string): Article {
  const markdown = cleanText(text).trim();
  if (!markdown) throw new Error("The page is empty.");
  return { url, title: sourceLabel(url), markdown };
}

async function pdfArticle(bytes: Uint8Array, url: string, signal: AbortSignal): Promise<Article> {
  // Loaded on demand: pdf.js is large and most sessions never open a PDF.
  const { extractPdf } = await import("./pdf.ts");
  return extractPdf(bytes, url, signal);
}

async function readLocalFile(url: string, signal: AbortSignal): Promise<Article> {
  const path = fileURLToPath(url);
  const type = LOCAL_TYPES[extname(path).toLowerCase()];
  if (!type) throw new Error("Unsupported file type. Open an .html, .htm, .xhtml, .pdf, or .txt file.");
  const limit = type === "pdf" ? MAX_PDF_BYTES : MAX_PAGE_BYTES;
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`Not a file: ${path}`);
  if (info.size > limit) throw sizeError(limit);
  const bytes = await readFile(path, { signal });
  if (bytes.byteLength > limit) throw sizeError(limit);
  signal.throwIfAborted();
  if (type === "pdf") return pdfArticle(bytes, url, signal);
  if (type === "text") return textArticle(bytes.toString("utf8"), url);
  return extractArticle(bytes.toString("utf8"), url);
}

/** Loads a key produced by resolveSource: a local document or a web page. */
export async function loadSource(key: string, signal: AbortSignal): Promise<Article> {
  return key.startsWith("file:") ? readLocalFile(key, signal) : fetchArticle(key, signal);
}

export async function fetchArticle(input: string, signal: AbortSignal): Promise<Article> {
  let url = normalizeUrl(input);
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
  for (let redirect = 0; redirect <= 5; redirect++) {
    requestSignal.throwIfAborted();
    const response = await fetch(url, {
      signal: requestSignal,
      redirect: "manual",
      headers: { Accept: "text/html, application/pdf;q=0.9, text/plain;q=0.8", "User-Agent": "PiTerminalReader/0.1" },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location) throw new Error("The page redirected without a destination.");
      url = normalizeUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Page request failed (HTTP ${response.status}). Login and paywalls are not supported.`);
    }
    const mime = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    // Some servers label PDFs as generic binary downloads; those are checked for the PDF signature.
    const binary = mime === "application/octet-stream" || mime === "binary/octet-stream";
    if (mime && !binary && !["text/html", "application/xhtml+xml", "text/plain", "application/pdf"].includes(mime)) {
      await response.body?.cancel();
      throw new Error(`Unsupported page type: ${mime}. Load an HTML article or a PDF.`);
    }
    const bytes = await boundedBytes(response, mime === "application/pdf" || binary ? MAX_PDF_BYTES : MAX_PAGE_BYTES);
    requestSignal.throwIfAborted();
    if (mime === "application/pdf" || bytes.subarray(0, 5).toString("latin1") === "%PDF-") {
      return pdfArticle(bytes, url, requestSignal);
    }
    if (binary) throw new Error(`Unsupported page type: ${mime}. Load an HTML article or a PDF.`);
    if (bytes.byteLength > MAX_PAGE_BYTES) throw sizeError(MAX_PAGE_BYTES);
    const body = decodeBody(response, bytes);
    if (mime === "text/plain") return textArticle(body, url);
    return extractArticle(body, url);
  }
  throw new Error("The page redirected too many times.");
}
