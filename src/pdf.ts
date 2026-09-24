import TurndownService from "turndown";
import { getDocumentProxy } from "unpdf";
import type { Article } from "./article.ts";
import { cleanText, sourceLabel } from "./article.ts";

interface Line { text: string; y: number; height: number }

// Only needed for its Markdown escaping: PDF text such as "# 3" or "1. Results" must stay plain text.
const markdown = new TurndownService();

function pageLines(items: readonly unknown[]): Line[] {
  const lines: Line[] = [];
  let current: Line | undefined;
  for (const item of items) {
    if (!item || typeof item !== "object" || !("str" in item)) continue; // marked-content boundaries
    const { str, hasEOL, transform, height } = item as { str: string; hasEOL: boolean; transform: number[]; height: number };
    current ??= { text: "", y: transform[5], height };
    current.text += str;
    current.height = Math.max(current.height, height);
    if (hasEOL) { lines.push(current); current = undefined; }
  }
  if (current) lines.push(current);
  return lines;
}

/** Rebuilds paragraphs from positioned lines: a blank line or a wide vertical gap starts a new one. */
function pageParagraphs(lines: Line[]): string[] {
  const paragraphs: string[] = [];
  let paragraph = "";
  let previous: Line | undefined;
  for (const line of lines) {
    const text = line.text.replace(/\s+/g, " ").trim();
    const gap = previous ? Math.abs(previous.y - line.y) : 0;
    const lineHeight = Math.max(previous?.height || 0, line.height, 1);
    if (!text || (previous && gap > lineHeight * 1.8)) {
      if (paragraph) paragraphs.push(paragraph);
      paragraph = "";
    }
    if (text) {
      // A line ending in a hyphen continues the word ("English-to-German", "exam-ple"): which
      // hyphens were only line breaks can't be told apart, so keep them. Other breaks become spaces.
      if (/\p{L}-$/u.test(paragraph)) paragraph += text;
      else paragraph = paragraph ? `${paragraph} ${text}` : text;
      previous = line;
    }
  }
  if (paragraph) paragraphs.push(paragraph);
  return paragraphs;
}

export async function extractPdf(bytes: Uint8Array, url: string, signal: AbortSignal): Promise<Article> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // pdf.js takes ownership of the buffer it is given, so hand it a copy. Only text is read:
    // no fonts are installed, no system fonts are probed, and nothing is rendered.
    pdf = await getDocumentProxy(new Uint8Array(bytes), {
      disableFontFace: true, useSystemFonts: false,
      verbosity: 0, // errors only: pdf.js warnings would otherwise print over the terminal UI
    });
  } catch (error) {
    throw new Error(`Could not read this PDF: ${(error as Error).message}`);
  }
  try {
    const pages: string[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      signal.throwIfAborted();
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      page.cleanup();
      const paragraphs = pageParagraphs(pageLines(content.items))
        .map((paragraph) => markdown.escape(cleanText(paragraph)).trim())
        .filter(Boolean);
      // Page markers let the reader and the model refer to "page 3".
      if (paragraphs.length) pages.push([`**Page ${number}**`, ...paragraphs].join("\n\n"));
    }
    signal.throwIfAborted();
    if (!pages.length) throw new Error("This PDF has no extractable text. Scanned PDFs (OCR) are not supported.");
    const info = (await pdf.getMetadata().catch(() => undefined))?.info as { Title?: unknown } | undefined;
    const title = typeof info?.Title === "string" ? cleanText(info.Title).replace(/\s+/g, " ").trim() : "";
    // Untitled PDFs are named after their file (paper.pdf, 1706.03762) rather than the site serving them.
    const segment = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
    let file = segment;
    try { file = decodeURIComponent(segment); } catch { /* keep the encoded name */ }
    return { url, title: title || cleanText(file) || sourceLabel(url), markdown: pages.join("\n\n") };
  } finally {
    await pdf.loadingTask.destroy();
  }
}
