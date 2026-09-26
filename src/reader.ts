import type { Article } from "./article.ts";
import { cleanText, loadSource, resolveSource } from "./article.ts";

export interface Exchange { question: string; answer: string; selection?: string }
export interface Reading {
  article: Article;
  exchanges: Exchange[];
  summary: string;
  draft: string;
  selection?: string;
  articleScroll: number;
  chatScroll: number;
  summaryScroll: number;
}
export type ReplyKind = "question" | "summary";
export type Answer = (reading: Reading, question: string, kind: ReplyKind, signal: AbortSignal, selection?: string) => Promise<string>;
type ResolveInput = (input: string) => Promise<string>;

/** All state is local to this extension instance. Nothing is appended to pi's session. */
export class ReaderState {
  readonly readings = new Map<string, Reading>();
  private aliases = new Map<string, string>();
  current?: Reading;
  showingSummary = false;
  status = "Paste a URL or file path above to begin. Article text is sent to your pi model only when you ask or summarize.";
  error = false;
  pendingQuestion = "";
  pendingSelection?: string;
  private operation?: AbortController;
  // Counts load requests so a slow path lookup can't replace a newer load. Resolving an input
  // cancels nothing: a mistyped URL or missing file must not abort a running answer.
  private loadGeneration = 0;
  private resolving = false;
  onChange: () => void = () => {};

  constructor(
    private answer: Answer,
    private loadArticle = loadSource,
    private resolveInput: ResolveInput = resolveSource,
  ) {}

  get busy(): boolean { return !!this.operation || this.resolving; }

  private notify(message: string, error = false): void {
    this.status = cleanText(message);
    this.error = error;
    this.onChange();
  }

  selectText(text: string): void {
    if (!this.current) return;
    const selection = cleanText(text).trim() || undefined;
    if (selection !== this.current.selection) this.current.chatScroll = Number.MAX_SAFE_INTEGER;
    this.current.selection = selection;
    this.onChange();
  }

  cancel(): void {
    this.loadGeneration++;
    this.resolving = false;
    const operation = this.operation;
    this.operation = undefined;
    operation?.abort();
    this.pendingQuestion = "";
    this.pendingSelection = undefined;
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
    const generation = ++this.loadGeneration;
    this.resolving = true;
    let key: string;
    try { key = await this.resolveInput(input); }
    catch (error) {
      if (generation !== this.loadGeneration) return false;
      this.resolving = false;
      this.notify((error as Error).message, true);
      return false;
    }
    if (generation !== this.loadGeneration) return false;
    this.resolving = false;
    this.cancel();
    const operation = new AbortController();
    this.operation = operation;
    this.notify("Loading source… Esc cancels.");
    try {
      const cached = this.readings.get(this.aliases.get(key) ?? key);
      if (cached) {
        this.current = cached;
        this.showingSummary = false;
        this.notify("Restored this source's in-memory discussion.");
        return true;
      }
      const article = await this.loadArticle(key, operation.signal);
      if (this.operation !== operation) return false;
      const reading = this.readings.get(article.url) ?? {
        article, exchanges: [], summary: "", draft: "", articleScroll: 0, chatScroll: 0, summaryScroll: 0,
      };
      this.readings.set(article.url, reading);
      this.aliases.set(key, article.url);
      this.current = reading;
      this.showingSummary = false;
      this.notify(article.warning ?? "Source ready.");
      return true;
    } catch (error) {
      if (this.operation === operation) this.notify(`Could not load source: ${(error as Error).message}`, true);
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
    this.notify("Switched source. Questions and answers are scoped to this source.");
  }

  async explainSelection(): Promise<boolean> {
    if (!this.current?.selection) {
      this.notify("Select a passage first.", true);
      return false;
    }
    return this.ask("Explain the selected passage in the context of this article and our discussion. If it is a word or term, define it simply and give a short example.");
  }

  async ask(question: string, kind: ReplyKind = "question"): Promise<boolean> {
    const reading = this.current;
    if (!reading) { this.notify("Load an article first.", true); return false; }
    if (this.busy) { this.notify("A request is running. Press Esc to cancel it first.", true); return false; }
    question = cleanText(question).trim();
    if (kind === "question" && !question) return false;
    // Snapshot the selected passage before awaiting: new selections must not change a sent question.
    const selection = kind === "question" ? reading.selection : undefined;
    const operation = new AbortController();
    this.operation = operation;
    this.pendingQuestion = kind === "question" ? question : "Summarize my learnings";
    this.pendingSelection = selection;
    reading.chatScroll = Number.MAX_SAFE_INTEGER;
    this.notify(kind === "summary" ? "Summarizing your reading and discussion… Esc cancels." : "Asking your pi model… Esc cancels.");
    try {
      const text = cleanText(await this.answer(reading, question, kind, operation.signal, selection)).trim();
      if (this.operation !== operation) return false;
      if (!text) throw new Error("The model returned no text. Try again or select another model.");
      if (kind === "summary") {
        reading.summary = text;
        reading.summaryScroll = 0;
        this.showingSummary = true;
        this.notify("Learning summary ready. Nothing was saved.");
      } else {
        reading.exchanges.push({ question, answer: text, ...(selection ? { selection } : {}) });
        // Preserve a new draft entered while the previous question was being answered.
        if (reading.draft.trim() === question) reading.draft = "";
        this.notify("Answer ready.");
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
        this.pendingSelection = undefined;
        this.onChange();
      }
    }
  }
}
