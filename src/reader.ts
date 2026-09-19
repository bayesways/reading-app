import type { Article } from "./article.ts";
import { cleanText, fetchArticle, normalizeUrl } from "./article.ts";

export interface Exchange { question: string; answer: string }
export interface Reading {
  article: Article;
  exchanges: Exchange[];
  summary: string;
  draft: string;
  articleScroll: number;
  chatScroll: number;
  summaryScroll: number;
}
export type ReplyKind = "question" | "summary";
export type Answer = (reading: Reading, question: string, kind: ReplyKind, signal: AbortSignal) => Promise<string>;

/** All state is local to this extension instance. Nothing is appended to pi's session. */
export class ReaderState {
  readonly readings = new Map<string, Reading>();
  private aliases = new Map<string, string>();
  current?: Reading;
  showingSummary = false;
  status = "Paste a URL above to begin. Article text is sent to your pi model only when you ask or summarize.";
  error = false;
  pendingQuestion = "";
  private operation?: AbortController;
  onChange: () => void = () => {};

  constructor(private answer: Answer, private loadArticle = fetchArticle) {}

  get busy(): boolean { return !!this.operation; }

  private notify(message: string, error = false): void {
    this.status = cleanText(message);
    this.error = error;
    this.onChange();
  }

  cancel(): void {
    const operation = this.operation;
    this.operation = undefined;
    operation?.abort();
    this.pendingQuestion = "";
    if (operation) this.notify("Cancelled. Your article and completed discussion are unchanged.");
  }

  clear(): void {
    this.cancel();
    this.readings.clear();
    this.aliases.clear();
    this.current = undefined;
    this.showingSummary = false;
  }

  async load(input: string): Promise<boolean> {
    let key: string;
    try { key = normalizeUrl(input); }
    catch (error) { this.notify((error as Error).message, true); return false; }
    this.cancel();
    const cached = this.readings.get(this.aliases.get(key) ?? key);
    if (cached) {
      this.current = cached;
      this.showingSummary = false;
      this.notify("Restored this page's in-memory discussion.");
      return true;
    }
    const operation = new AbortController();
    this.operation = operation;
    this.notify("Loading article… Esc cancels.");
    try {
      const article = await this.loadArticle(key, operation.signal);
      if (this.operation !== operation) return false;
      const reading = this.readings.get(article.url) ?? {
        article, exchanges: [], summary: "", draft: "", articleScroll: 0, chatScroll: 0, summaryScroll: 0,
      };
      this.readings.set(article.url, reading);
      this.aliases.set(key, article.url);
      this.current = reading;
      this.showingSummary = false;
      this.notify(article.warning ?? "Article ready. Tab to the question box to ask about this page.");
      return true;
    } catch (error) {
      if (this.operation === operation) this.notify(`Could not load page: ${(error as Error).message}`, true);
      return false;
    } finally {
      if (this.operation === operation) {
        this.operation = undefined;
        this.onChange();
      }
    }
  }

  cycleArticle(): void {
    const pages = [...this.readings.values()];
    if (!pages.length) return;
    this.cancel();
    this.current = pages[(pages.indexOf(this.current!) + 1) % pages.length];
    this.showingSummary = false;
    this.notify("Switched page. Questions and answers are scoped to this URL.");
  }

  async ask(question: string, kind: ReplyKind = "question"): Promise<boolean> {
    const reading = this.current;
    if (!reading) { this.notify("Load an article first.", true); return false; }
    if (this.busy) { this.notify("A request is running. Press Esc to cancel it first.", true); return false; }
    question = cleanText(question).trim();
    if (kind === "question" && !question) return false;
    const operation = new AbortController();
    this.operation = operation;
    this.pendingQuestion = kind === "question" ? question : "Summarize my learnings";
    reading.chatScroll = Number.MAX_SAFE_INTEGER;
    this.notify(kind === "summary" ? "Summarizing your reading and discussion… Esc cancels." : "Asking your pi model… Esc cancels.");
    try {
      const text = cleanText(await this.answer(reading, question, kind, operation.signal)).trim();
      if (this.operation !== operation) return false;
      if (!text) throw new Error("The model returned no text. Try again or select another model.");
      if (kind === "summary") {
        reading.summary = text;
        reading.summaryScroll = 0;
        this.showingSummary = true;
        this.notify("Learning summary ready. F3 switches back to the article. Nothing was saved.");
      } else {
        reading.exchanges.push({ question, answer: text });
        // Preserve a new draft entered while the previous question was being answered.
        if (reading.draft.trim() === question) reading.draft = "";
        this.notify("Answer ready. F2 summarizes your learnings so far.");
      }
      reading.chatScroll = Number.MAX_SAFE_INTEGER;
      return true;
    } catch (error) {
      if (this.operation === operation) this.notify(`Model request failed: ${(error as Error).message}`, true);
      return false;
    } finally {
      if (this.operation === operation) {
        this.operation = undefined;
        this.pendingQuestion = "";
        this.onChange();
      }
    }
  }
}
