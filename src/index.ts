import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createAnswer } from "./model.ts";
import { ReaderState, type Answer } from "./reader.ts";
import { ReaderView } from "./ui.ts";

export default function readerExtension(pi: ExtensionAPI): void {
  let state: ReaderState | undefined;
  let answer: Answer | undefined;
  let view: ReaderView | undefined;

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
  };
  pi.on("session_start", reset);
  pi.on("session_shutdown", reset);

  pi.registerCommand("reader", {
    description: "Read an article with per-URL Q&A and learning recaps: /reader [URL]",
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/reader needs pi's interactive terminal UI.", "error");
        return;
      }
      if (view) return;
      answer = createAnswer(ctx);
      const modelLabel = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "No session model selected";
      state ??= new ReaderState((...params) => {
        if (!answer) throw new Error("The reader session has ended.");
        return answer(...params);
      });
      try {
        await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
          view = new ReaderView(state!, theme, () => tui.terminal.rows, () => tui.requestRender(), () => done(), modelLabel);
          if (args.trim()) void view.open(args.trim());
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
