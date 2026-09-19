import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Input, Markdown, matchesKey, truncateToWidth, visibleWidth,
  type Component, type Focusable, type MarkdownTheme, type TuiMouseEvent, type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { cleanText } from "./article.ts";
import { ReaderState } from "./reader.ts";
import { ArticleSelection, withoutHyperlinks } from "./selection.ts";

type Focus = "url" | "article" | "chat" | "question";
const FOCUS: Focus[] = ["url", "article", "chat", "question"];
const quote = (text: string) => text.split("\n").map((line) => `> ${line.replace(/[\\`*_{}\[\]<>#~|]/g, "\\$&")}`).join("\n");
interface Layout {
  width: number; leftWidth: number; rightWidth: number; wide: boolean;
  bodyBottom: number; questionRow: number; previewRow: number;
  articleVisible: boolean; leftCount: number;
}

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
  private selection = new ArticleSelection();
  private selectionSource = "";
  private selectionWidth = 0;
  private selecting = false;
  private extending = false;
  private dragging = false;
  private dragMoved = false;
  private dragOnText = false;
  private dragStart?: { x: number; y: number };
  private layout?: Layout;

  constructor(
    readonly state: ReaderState,
    private theme: Theme,
    private height: () => number,
    private requestRender: () => void,
    private done: () => void,
    private modelLabel = "Session model",
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
        this.resetSelectionGeometry();
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
    if (focus !== "article") this.selecting = this.extending = false;
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
    this.selecting = this.extending = false;
    const completed = await this.state.ask("", "summary");
    if (completed && !this.disposed) this.setFocus("article");
  }

  private scroll(delta: number, edge?: "top" | "bottom", pane?: "article" | "chat"): void {
    const reading = this.state.current;
    if (!reading) return;
    const chat = pane ? pane === "chat" : this.focus === "chat" || this.focus === "question";
    const key = chat ? "chatScroll" : this.state.showingSummary ? "summaryScroll" : "articleScroll";
    reading[key] = edge === "top" ? 0 : edge === "bottom" ? Number.MAX_SAFE_INTEGER : Math.max(0, reading[key] + delta);
    this.requestRender();
  }

  private resetSelectionGeometry(): void {
    this.selection.clear();
    this.selectionSource = "";
    this.selecting = this.extending = this.dragging = false;
  }

  private clearSelection(): void {
    this.resetSelectionGeometry();
    this.state.selectText("");
    this.requestRender();
  }

  private publishSelection(): void { this.state.selectText(this.selection.text()); }

  private beginSelection(): void {
    if (!this.state.current || !this.layout) return;
    if (this.selecting) {
      this.selecting = this.extending = false;
      this.requestRender();
      return;
    }
    this.state.showingSummary = false;
    this.setFocus("article");
    // Refresh geometry when returning from the recap or from a narrow-screen sidebar.
    this.render(this.layout.width);
    this.selection.clear();
    this.selection.place(this.state.current.articleScroll, 0);
    this.selecting = true;
    this.extending = false;
    this.state.selectText("");
  }

  private askAboutSelection(): void {
    this.selecting = this.extending = false;
    this.setFocus("question");
  }

  private explainSelection(): void {
    this.selecting = this.extending = false;
    void this.state.explainSelection();
  }

  private moveSelection(dx: number, dy: number): void {
    this.selection.move(dx, dy);
    const reading = this.state.current;
    if (reading) {
      if (this.selection.cursor.row < reading.articleScroll) reading.articleScroll = this.selection.cursor.row;
      if (this.selection.cursor.row >= reading.articleScroll + this.bodyHeight) {
        reading.articleScroll = this.selection.cursor.row - this.bodyHeight + 1;
      }
    }
    if (this.extending) this.publishSelection();
    this.requestRender();
  }

  handleInput(data: string): void {
    if (this.disposed) return;
    if (matchesKey(data, "ctrl+c")) { this.close(); return; }
    if (matchesKey(data, "escape")) {
      if (this.state.busy) this.state.cancel();
      else if (this.selecting || this.dragging || this.state.current?.selection) this.clearSelection();
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
    if (matchesKey(data, "f5")) { this.beginSelection(); return; }
    if (matchesKey(data, "f6")) { this.explainSelection(); return; }
    if (matchesKey(data, "f7")) { this.askAboutSelection(); return; }
    if (matchesKey(data, "f8")) { this.clearSelection(); return; }
    if (matchesKey(data, "f2") || matchesKey(data, "ctrl+s")) { void this.summarize(); return; }
    if (matchesKey(data, "f3")) {
      if (this.state.current?.summary) this.state.showingSummary = !this.state.showingSummary;
      this.setFocus("article");
      return;
    }
    if (matchesKey(data, "f4")) { this.state.cycleArticle(); this.setFocus("article"); return; }
    if (this.focus === "article") {
      if (data === "v") { this.beginSelection(); return; }
      if (data === "e") { this.explainSelection(); return; }
      if (data === "a" || matchesKey(data, "enter")) { this.askAboutSelection(); return; }
      if (data === "x") { this.clearSelection(); return; }
      if (this.selecting) {
        if (data === "w") {
          this.selection.word();
          this.selecting = this.extending = false;
          this.publishSelection();
        } else if (matchesKey(data, "space")) {
          this.selection.mark();
          this.extending = true;
          this.publishSelection();
        } else {
          const shifted = (["shift+left", "shift+right", "shift+up", "shift+down"] as const).some((key) => matchesKey(data, key));
          if (shifted && !this.extending) { this.selection.mark(); this.extending = true; }
          if (matchesKey(data, "left") || matchesKey(data, "shift+left") || data === "h") this.moveSelection(-1, 0);
          else if (matchesKey(data, "right") || matchesKey(data, "shift+right") || data === "l") this.moveSelection(1, 0);
          else if (matchesKey(data, "up") || matchesKey(data, "shift+up") || data === "k") this.moveSelection(0, -1);
          else if (matchesKey(data, "down") || matchesKey(data, "shift+down") || data === "j") this.moveSelection(0, 1);
          else if (matchesKey(data, "pageUp")) this.moveSelection(0, -this.bodyHeight);
          else if (matchesKey(data, "pageDown")) this.moveSelection(0, this.bodyHeight);
        }
        this.requestRender();
        return;
      }
    }
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

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    const layout = this.layout;
    if (this.disposed || !layout) return;
    const reading = this.state.current;
    const rightX = layout.wide ? layout.leftWidth + 3 : 0;
    const inBody = event.y >= 4 && event.y < layout.bodyBottom;
    const article = layout.articleVisible && (layout.wide ? event.x < layout.leftWidth : true);
    const handled = { handled: true, render: true };

    // Capture keeps cross-pane and out-of-bounds drags tied to the article that started them.
    if (this.dragging && reading && (event.type === "drag" || event.type === "release")) {
      if (event.x !== this.dragStart?.x || event.y !== this.dragStart?.y) this.dragMoved = true;
      if (event.type === "drag") {
        const delta = event.y < 4 ? -1 : event.y >= layout.bodyBottom ? 1 : 0;
        reading.articleScroll = Math.max(0, Math.min(reading.articleScroll + delta, layout.leftCount - this.bodyHeight));
      }
      const row = reading.articleScroll + Math.max(0, Math.min(event.y - 4, this.bodyHeight - 1));
      this.selection.place(row, Math.max(0, Math.min(event.x, layout.leftWidth - 1)));
      if (event.type === "release") {
        this.dragging = false;
        if (!this.dragMoved) {
          if (this.dragOnText) this.selection.word();
          else this.selection.clear();
        }
      }
      this.publishSelection();
      return handled;
    }
    if (event.type === "wheel") {
      const pane = layout.wide ? event.x < layout.leftWidth ? "article" : "chat" : this.narrowPane;
      this.scroll(event.wheelDelta ?? 0, undefined, pane);
      return handled;
    }
    if (event.button !== "left") return { handled: true };
    if (event.y === 1 && event.x >= 4) {
      this.setFocus("url");
      this.urlInput.handleMouse({ ...event, x: event.x - 4, y: 0, width: layout.width - 4, height: 1 });
      return { ...handled, focus: true };
    }
    if (event.y === layout.questionRow && event.x >= rightX) {
      this.askAboutSelection();
      this.questionInput.handleMouse({ ...event, x: event.x - rightX, y: 0, width: layout.rightWidth, height: 1 });
      return { ...handled, focus: true };
    }
    if (event.y === layout.previewRow && layout.wide && event.x >= rightX) {
      if (event.type === "click") {
        const x = event.x - rightX;
        if (x < 9) this.explainSelection();
        else if (x < 15) this.askAboutSelection();
        else if (x < 23) this.clearSelection();
      }
      return handled;
    }
    if (inBody && article && reading && !this.state.showingSummary) {
      if (event.type === "press") {
        this.setFocus("article");
        this.selecting = this.extending = false;
        this.dragging = true;
        this.dragMoved = false;
        this.dragStart = { x: event.x, y: event.y };
        this.dragOnText = this.selection.contains(reading.articleScroll + event.y - 4, event.x);
        this.selection.place(reading.articleScroll + event.y - 4, event.x, true);
        this.publishSelection();
        return { ...handled, capture: true, focus: true };
      }
      return handled; // A click follows release; keep the word/range selected on release.
    }
    if (inBody && (event.type === "press" || event.type === "click")) {
      this.setFocus(article ? "article" : "chat");
      return { ...handled, focus: true };
    }
    // Do not let blank portions of this full-window overlay select pi's transcript underneath.
    return { handled: true };
  }

  render(width: number): string[] {
    const h = Math.max(1, this.height());
    if (width < 36 || h < 12) {
      this.layout = undefined;
      this.resetSelectionGeometry();
      return ["Reader: enlarge terminal to 36×12.", "Esc closes · Ctrl+C closes"].slice(0, h).map((s) => truncateToWidth(s, width));
    }
    const th = this.theme;
    const reading = this.state.current;
    const wide = width >= 90;
    const leftWidth = wide ? Math.floor((width - 3) * 0.63) : width;
    const rightWidth = wide ? width - leftWidth - 3 : width;
    this.bodyHeight = h - 10;
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
    let chat = reading?.exchanges.map((exchange, i) => `### Q${i + 1}: ${exchange.question}\n\n${exchange.selection ? `Selected passage:\n\n${quote(exchange.selection)}\n\n` : ""}${exchange.answer}`).join("\n\n---\n\n")
      || "## Your questions\n\nAsk for an explanation, challenge an argument, or connect an idea to something you know.\n\nAnswers use this article and this URL's discussion only.\n\nTab to the question box below. Enter sends.";
    if (this.state.pendingQuestion) chat += `\n\n---\n\n**Pending:** ${this.state.pendingQuestion}\n\n${this.state.pendingSelection ? `${quote(this.state.pendingSelection)}\n\n` : ""}*Working… Esc cancels.*`;
    if (reading?.selection) chat += `\n\n---\n\n## Selected passage\n\n${quote(reading.selection)}\n\nF6: Explain · F7: Ask · F8: Clear\n\n*Attached to your next question until cleared.*`;
    this.leftMarkdown.setText(articleText);
    this.rightMarkdown.setText(chat);
    const leftLines = this.leftMarkdown.render(leftWidth).map(withoutHyperlinks);
    const rightLines = this.rightMarkdown.render(rightWidth);
    if (this.selectionSource !== articleText || this.selectionWidth !== leftWidth) {
      // Reflow changes cell positions. Keep the saved quote, but never highlight stale coordinates.
      this.selection.setLines(leftLines);
      this.selectionSource = articleText;
      this.selectionWidth = leftWidth;
      this.selecting = this.extending = this.dragging = false;
    }
    const leftKey = summary ? "summaryScroll" : "articleScroll";
    const leftOffset = Math.min(reading?.[leftKey] ?? 0, Math.max(0, leftLines.length - this.bodyHeight));
    const rightOffset = Math.min(reading?.chatScroll ?? 0, Math.max(0, rightLines.length - this.bodyHeight));
    if (reading) { reading[leftKey] = leftOffset; reading.chatScroll = rightOffset; }
    this.layout = {
      width, leftWidth, rightWidth, wide, bodyBottom: 4 + this.bodyHeight,
      previewRow: 5 + this.bodyHeight, questionRow: 6 + this.bodyHeight,
      articleVisible: wide || this.narrowPane === "article", leftCount: leftLines.length,
    };
    const leftTitle = styledLabel(`${summary ? "LEARNING RECAP" : "ARTICLE"}  ${leftOffset + 1}/${leftLines.length}`, this.focus === "article");
    const rightTitle = styledLabel(`QUESTIONS  ${reading?.exchanges.length ?? 0} answered · ${rightOffset + 1}/${rightLines.length}`, this.focus === "chat" || this.focus === "question");
    const lines = [
      th.fg("accent", th.bold(" π READER ")) + th.fg("muted", cleanText(this.modelLabel)) + th.fg("dim", ` · in memory · ${this.state.readings.size} page(s)`),
      styledLabel("URL ", this.focus === "url") + this.urlInput.render(width - 4)[0],
      th.fg("border", "─".repeat(width)),
      wide ? combine(leftTitle, rightTitle) : `${this.narrowPane === "article" ? leftTitle : rightTitle}  ${th.fg("dim", "[Tab switches panes]")}`,
    ];
    for (let i = 0; i < this.bodyHeight; i++) {
      const original = leftLines[leftOffset + i] ?? "";
      const left = summary ? original : this.selection.highlight(leftOffset + i, original,
        (text) => th.bg("selectedBg", th.fg("accent", text)), this.selecting && this.focus === "article");
      const right = rightLines[rightOffset + i] ?? "";
      lines.push(wide ? combine(left, right) : fit(this.narrowPane === "article" ? left : right, width));
    }
    lines.push(th.fg("border", "─".repeat(width)));
    const preview = reading?.selection
      ? th.fg("accent", `Selected: ${reading.selection.replace(/\s+/g, " ")}`)
      : th.fg("dim", "Select text: v/F5 or mouse (fullscreen)");
    const actions = th.fg("accent", "[Explain] [Ask] [Clear]");
    lines.push(wide ? combine(preview, actions) : preview);
    const question = this.questionInput.render(rightWidth)[0];
    lines.push(wide ? combine(th.fg("dim", `Focus: ${this.focus} · ↑↓ / PgUp PgDn scroll`), question) : question);
    lines.push(this.selecting ? th.fg("accent", "SELECT: arrows move · w word · Space starts range · Enter asks · e explains")
      : th.fg(this.state.error ? "error" : this.state.busy ? "warning" : "muted", this.state.status));
    lines.push(th.fg("dim", "Tab focus · Ctrl+L URL · F2 recap · F3 article/recap · F4 page"));
    lines.push(th.fg("dim", "F5 select · F6 explain · F7 ask · F8 clear · Esc back · Ctrl+C close"));
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
