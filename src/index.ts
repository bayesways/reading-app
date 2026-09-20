import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { BrowserReader, parseReaderCommand } from "./browser.ts";
import { createAnswer } from "./model.ts";
import { ReaderState, type Answer } from "./reader.ts";
import { ReaderView } from "./ui.ts";

export default function readerExtension(pi: ExtensionAPI): void {
  let state: ReaderState | undefined;
  let answer: Answer | undefined;
  let view: ReaderView | undefined;
  let browser: BrowserReader | undefined;

  const disposeView = () => {
    view?.dispose();
    view = undefined;
  };
  const reset = () => {
    view?.close();
    view = undefined;
    state?.clear();
    state = undefined;
    answer = undefined;
    const activeBrowser = browser;
    browser = undefined;
    void activeBrowser?.dispose();
  };
  pi.on("session_start", reset);
  pi.on("session_shutdown", reset);

  pi.registerCommand("reader", {
    description: "Read with per-URL Q&A: /reader [URL] or /reader --browser [URL]",
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/reader needs pi's interactive terminal UI.", "error");
        return;
      }
      let command;
      try { command = parseReaderCommand(args); }
      catch (error) { ctx.ui.notify((error as Error).message, "error"); return; }
      if (command.stopBrowser) {
        if (!browser) { ctx.ui.notify("No browser reader is running.", "info"); return; }
        await browser.dispose();
        browser = undefined;
        ctx.ui.notify("Browser reader stopped and its in-memory data was cleared.", "info");
        return;
      }
      const modelLabel = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "No session model selected";
      if (command.browser) {
        browser ??= new BrowserReader(new ReaderState(createAnswer(ctx)), modelLabel);
        const result = await browser.open(command.url);
        if (result.launched) ctx.ui.notify(`Browser reader opened at ${result.url}`, "info");
        else ctx.ui.notify(`Could not launch a browser (${result.error}). Open ${result.url}`, "warning");
        return;
      }
      if (view) return;
      answer = createAnswer(ctx);
      state ??= new ReaderState((...params) => {
        if (!answer) throw new Error("The reader session has ended.");
        return answer(...params);
      });
      try {
        await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
          view = new ReaderView(state!, theme, () => tui.terminal.rows, () => tui.requestRender(), () => done(), modelLabel);
          if (command.url) void view.open(command.url);
          return view;
        }, {
          overlay: true,
          overlayOptions: { width: "100%", maxHeight: "100%", margin: 0, anchor: "top-left" },
        });
      } finally {
        disposeView();
      }
    },
  });
}
