import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Input, Markdown, matchesKey, truncateToWidth, visibleWidth,
  type Component, type Focusable, type MarkdownTheme,
} from "@earendil-works/pi-tui";
import { cleanText } from "./article.ts";
import { ReaderState } from "./reader.ts";

type Focus = "url" | "article" | "chat" | "question";
const FOCUS: Focus[] = ["url", "article", "chat", "question"];

function markdownTheme(theme: Theme): MarkdownTheme {
  return {
    heading: (s) => theme.bold(theme.fg("mdHeading", s)),
    link: (s) => theme.fg("mdLink", s), linkUrl: (s) => theme.fg("mdLinkUrl", s),
    code: (s) => theme.fg("mdCode", s), codeBlock: (s) => theme.fg("mdCodeBlock", s),
    codeBlockBorder: (s) => theme.fg("mdCodeBlockBorder", s),
    quote: (s) => theme.fg("mdQuote", s), quoteBorder: (s) => theme.fg("mdQuoteBorder", s),
    hr: (s) => theme.fg("mdHr", s), listBullet: (s) => theme.fg("mdListBullet", s),
    bold: (s) => theme.bold(s), italic: (s) => theme.italic(s),
    strikethrough: (s) => theme.strikethrough(s), underline: (s) => theme.underline(s),
  };
}

/** Full-window overlay. Each pane has an independent, width-aware Markdown viewport. */
export class ReaderView implements Component, Focusable {
  private urlInput = new Input({ prompt: "", placeholder: "https://…" });
  private questionInput = new Input({ prompt: "? ", placeholder: "Ask about this article…" });
  private leftMarkdown: Markdown;
  private rightMarkdown: Markdown;
  private focus: Focus = "url";
  private hasFocus = false;
  private bodyHeight = 10;
  private narrowPane: "article" | "chat" = "article";
  private disposed = false;
  private shownReading: ReaderState["current"];
  private listener: () => void;

  constructor(
    readonly state: ReaderState,
    private theme: Theme,
    private height: () => number,
    private requestRender: () => void,
    private done: () => void,
  ) {
    this.shownReading = state.current;
    const mdTheme = markdownTheme(theme);
    this.leftMarkdown = new Markdown("", 0, 0, mdTheme);
    this.rightMarkdown = new Markdown("", 0, 0, mdTheme);
    this.urlInput.setValue(state.current?.article.url ?? "");
    this.questionInput.setValue(state.current?.draft ?? "");
    if (state.current) this.focus = "article";
    this.urlInput.onSubmit = (url) => { void this.open(url); };
    this.questionInput.onSubmit = () => { void this.ask(); };
    this.listener = () => {
      if (this.disposed) return;
      if (this.shownReading !== state.current) {
        this.shownReading = state.current;
        this.urlInput.setValue(state.current?.article.url ?? "");
      }
      const draft = state.current?.draft ?? "";
      if (this.questionInput.getValue() !== draft) this.questionInput.setValue(draft);
      this.requestRender();
    };
    state.onChange = this.listener;
  }

  get focused(): boolean { return this.hasFocus; }
  set focused(value: boolean) { this.hasFocus = value; this.syncFocus(); }

  private syncFocus(): void {
    this.urlInput.focused = this.hasFocus && this.focus === "url";
    this.questionInput.focused = this.hasFocus && this.focus === "question";
  }

  private setFocus(focus: Focus): void {
    this.focus = focus;
    if (focus === "article") this.narrowPane = "article";
    if (focus === "chat" || focus === "question") this.narrowPane = "chat";
    this.syncFocus();
    this.requestRender();
  }

  async open(url: string): Promise<void> {
    this.urlInput.setValue(url);
    const loaded = await this.state.load(url);
    if (this.disposed) return;
    if (loaded) {
      this.urlInput.setValue(this.state.current!.article.url);
      this.setFocus("article");
    }
    this.requestRender();
  }

  private async ask(): Promise<void> {
    if (this.state.current) this.state.current.draft = this.questionInput.getValue();
    await this.state.ask(this.questionInput.getValue());
  }

  private async summarize(): Promise<void> {
    const completed = await this.state.ask("", "summary");
    if (completed && !this.disposed) this.setFocus("article");
  }

  private scroll(delta: number, edge?: "top" | "bottom"): void {
    const reading = this.state.current;
    if (!reading) return;
    const key = this.focus === "chat" || this.focus === "question"
      ? "chatScroll" : this.state.showingSummary ? "summaryScroll" : "articleScroll";
    reading[key] = edge === "top" ? 0 : edge === "bottom" ? Number.MAX_SAFE_INTEGER : Math.max(0, reading[key] + delta);
    this.requestRender();
  }

  handleInput(data: string): void {
    if (matchesKey(data, "ctrl+c")) { this.close(); return; }
    if (matchesKey(data, "escape")) {
      if (this.state.busy) this.state.cancel();
      else if (this.state.showingSummary) {
        this.state.showingSummary = false;
        this.setFocus("article");
      } else this.close();
      this.requestRender();
      return;
    }
    if (matchesKey(data, "tab") || matchesKey(data, "shift+tab")) {
      const direction = matchesKey(data, "tab") ? 1 : -1;
      this.setFocus(FOCUS[(FOCUS.indexOf(this.focus) + direction + FOCUS.length) % FOCUS.length]);
      return;
    }
    if (matchesKey(data, "ctrl+l")) { this.setFocus("url"); return; }
    if (matchesKey(data, "f2") || matchesKey(data, "ctrl+s")) { void this.summarize(); return; }
    if (matchesKey(data, "f3")) {
      if (this.state.current?.summary) this.state.showingSummary = !this.state.showingSummary;
      this.setFocus("article");
      return;
    }
    if (matchesKey(data, "f4")) { this.state.cycleArticle(); this.setFocus("article"); return; }
    if (matchesKey(data, "pageUp")) { this.scroll(-this.bodyHeight); return; }
    if (matchesKey(data, "pageDown")) { this.scroll(this.bodyHeight); return; }
    if (this.focus === "article" || this.focus === "chat") {
      if (matchesKey(data, "up") || data === "k") this.scroll(-1);
      else if (matchesKey(data, "down") || data === "j") this.scroll(1);
      else if (matchesKey(data, "home") || data === "g") this.scroll(0, "top");
      else if (matchesKey(data, "end") || data === "G") this.scroll(0, "bottom");
      return;
    }
    const input = this.focus === "url" ? this.urlInput : this.questionInput;
    input.handleInput(data);
    const value = cleanText(input.getValue()).replace(/\n/g, " ");
    if (value !== input.getValue()) input.setValue(value);
    if (this.focus === "question" && this.state.current) this.state.current.draft = value;
    this.requestRender();
  }

  render(width: number): string[] {
    const h = Math.max(1, this.height());
    if (width < 36 || h < 12) {
      return ["Reader: enlarge terminal to 36×12.", "Esc closes · Ctrl+C closes"].slice(0, h).map((s) => truncateToWidth(s, width));
    }
    const th = this.theme;
    const reading = this.state.current;
    const wide = width >= 90;
    const leftWidth = wide ? Math.floor((width - 3) * 0.63) : width;
    const rightWidth = wide ? width - leftWidth - 3 : width;
    this.bodyHeight = h - 9;
    const fit = (text: string, w: number) => {
      const clipped = truncateToWidth(text, w);
      return clipped + " ".repeat(Math.max(0, w - visibleWidth(clipped)));
    };
    const combine = (left: string, right: string) => fit(left, leftWidth) + th.fg("border", " │ ") + fit(right, rightWidth);
    const styledLabel = (text: string, active: boolean) => th.fg(active ? "accent" : "muted", text);
    const summary = this.state.showingSummary && !!reading?.summary;
    const articleText = reading
      ? summary ? reading.summary : `# ${reading.article.title}\n\n${reading.article.markdown}`
      : "# A little room to read\n\nPaste an article URL into the bar above and press Enter.\n\nRead on the left; explore your questions on the right.\n\n**F2** turns your discussion into a learning recap.\n\nNothing is saved to your pi session. Close and reopen /reader to return during this session.\n\nHTML and plain text only. No browser scripts, logins, or PDFs.";
    let chat = reading?.exchanges.map((exchange, i) => `### Q${i + 1}: ${exchange.question}\n\n${exchange.answer}`).join("\n\n---\n\n")
      || "## Your questions\n\nAsk for an explanation, challenge an argument, or connect an idea to something you know.\n\nAnswers use this article and this URL's discussion only.\n\nTab to the question box below. Enter sends.";
    if (this.state.pendingQuestion) chat += `\n\n---\n\n**Pending:** ${this.state.pendingQuestion}\n\n*Working… Esc cancels.*`;
    this.leftMarkdown.setText(articleText);
    this.rightMarkdown.setText(chat);
    const leftLines = this.leftMarkdown.render(leftWidth);
    const rightLines = this.rightMarkdown.render(rightWidth);
    const leftKey = summary ? "summaryScroll" : "articleScroll";
    const leftOffset = Math.min(reading?.[leftKey] ?? 0, Math.max(0, leftLines.length - this.bodyHeight));
    const rightOffset = Math.min(reading?.chatScroll ?? 0, Math.max(0, rightLines.length - this.bodyHeight));
    if (reading) { reading[leftKey] = leftOffset; reading.chatScroll = rightOffset; }
    const leftTitle = styledLabel(`${summary ? "LEARNING RECAP" : "ARTICLE"}  ${leftOffset + 1}/${leftLines.length}`, this.focus === "article");
    const rightTitle = styledLabel(`QUESTIONS  ${reading?.exchanges.length ?? 0} answered · ${rightOffset + 1}/${rightLines.length}`, this.focus === "chat" || this.focus === "question");
    const lines = [
      th.fg("accent", th.bold(" π READER ")) + th.fg("dim", `· in memory only · ${this.state.readings.size} page(s)`),
      styledLabel("URL ", this.focus === "url") + this.urlInput.render(width - 4)[0],
      th.fg("border", "─".repeat(width)),
      wide ? combine(leftTitle, rightTitle) : `${this.narrowPane === "article" ? leftTitle : rightTitle}  ${th.fg("dim", "[Tab switches panes]")}`,
    ];
    for (let i = 0; i < this.bodyHeight; i++) {
      const left = leftLines[leftOffset + i] ?? "";
      const right = rightLines[rightOffset + i] ?? "";
      lines.push(wide ? combine(left, right) : fit(this.narrowPane === "article" ? left : right, width));
    }
    lines.push(th.fg("border", "─".repeat(width)));
    const question = this.questionInput.render(rightWidth)[0];
    lines.push(wide ? combine(th.fg("dim", `Focus: ${this.focus} · ↑↓ / PgUp PgDn scroll`), question) : question);
    lines.push(th.fg(this.state.error ? "error" : this.state.busy ? "warning" : "muted", this.state.status));
    lines.push(th.fg("dim", "Tab focus · Ctrl+L URL · Enter load/ask · F2/Ctrl+S summarize"));
    lines.push(th.fg("dim", "F3 article/recap · F4 next page · Esc cancel/back/close · Ctrl+C close"));
    return lines.map((line) => fit(line, width)).slice(0, h);
  }

  invalidate(): void {
    this.leftMarkdown.invalidate();
    this.rightMarkdown.invalidate();
    this.urlInput.invalidate();
    this.questionInput.invalidate();
  }

  close(): void {
    if (this.disposed) return;
    this.dispose();
    this.done();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.state.onChange === this.listener) this.state.onChange = () => {};
    this.state.cancel();
  }
}
