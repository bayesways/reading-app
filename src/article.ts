import { stripVTControlCharacters } from "node:util";
import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import TurndownService from "turndown";

export interface Article {
  url: string;
  title: string;
  markdown: string;
  warning?: string;
}

export const MAX_PAGE_BYTES = 2 * 1024 * 1024;

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

export function extractArticle(html: string, url: string): Article {
  // No runScripts or resources option: scripts never execute, subresources never load.
  const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
  try {
    const document = dom.window.document;
    document.querySelectorAll("script,style,noscript,iframe,object,embed,svg,form,button,input,base").forEach((n) => n.remove());
    document.querySelectorAll("a").forEach((a) => {
      try {
        const target = new URL(a.getAttribute("href") ?? "", url);
        if (!["http:", "https:"].includes(target.protocol)) throw new Error("Unsafe link");
        a.setAttribute("href", target.href);
      } catch {
        a.removeAttribute("href");
      }
    });
    // Images cannot render in reader mode. Keep descriptive alt text, not tracking URLs.
    document.querySelectorAll("img").forEach((img) => {
      img.replaceWith(document.createTextNode(img.alt ? `[Image: ${img.alt}]` : ""));
    });
    const parsed = new Readability(document.cloneNode(true) as Document, {
      charThreshold: 100,
      maxElemsToParse: 50_000,
    }).parse();
    const fallback = document.querySelector("article,main") ?? document.body;
    const content = parsed?.content ?? fallback?.innerHTML ?? "";
    const converter = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
    const markdown = cleanText(converter.turndown(content)).trim();
    if (markdown.length < 40) {
      throw new Error("No readable article found. This page may require JavaScript, login, or a subscription.");
    }
    return {
      url,
      title: cleanText(parsed?.title || document.title || new URL(url).hostname).replace(/\s+/g, " ").trim(),
      markdown,
      warning: parsed ? undefined : "Reader extraction was unavailable; showing simplified page content.",
    };
  } finally {
    dom.window.close();
  }
}

async function boundedBody(response: Response): Promise<string> {
  if (Number(response.headers.get("content-length")) > MAX_PAGE_BYTES) {
    await response.body?.cancel();
    throw new Error("This page exceeds the 2 MiB download limit.");
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
      if (length > MAX_PAGE_BYTES) throw new Error("This page exceeds the 2 MiB download limit.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const charset = response.headers.get("content-type")?.match(/charset=["']?([^;\s"']+)/i)?.[1] ?? "utf-8";
  let decoder: TextDecoder;
  try { decoder = new TextDecoder(charset); } catch { decoder = new TextDecoder(); }
  return decoder.decode(Buffer.concat(chunks));
}

export async function fetchArticle(input: string, signal: AbortSignal): Promise<Article> {
  let url = normalizeUrl(input);
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
  for (let redirect = 0; redirect <= 5; redirect++) {
    requestSignal.throwIfAborted();
    const response = await fetch(url, {
      signal: requestSignal,
      redirect: "manual",
      headers: { Accept: "text/html, text/plain;q=0.8", "User-Agent": "PiTerminalReader/0.1" },
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
    if (mime && !["text/html", "application/xhtml+xml", "text/plain"].includes(mime)) {
      await response.body?.cancel();
      throw new Error(`Unsupported page type: ${mime}. Load an HTML article, not a PDF or download.`);
    }
    const body = await boundedBody(response);
    requestSignal.throwIfAborted();
    if (mime === "text/plain") {
      const markdown = cleanText(body).trim();
      if (!markdown) throw new Error("The page is empty.");
      return { url, title: new URL(url).hostname, markdown };
    }
    return extractArticle(body, url);
  }
  throw new Error("The page redirected too many times.");
}
