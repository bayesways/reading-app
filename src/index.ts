import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createAnswer } from "./model.ts";
import { ReaderState } from "./reader.ts";
import { ReaderView } from "./ui.ts";

export default function readerExtension(pi: ExtensionAPI): void {
  let state: ReaderState | undefined;
  let context: ExtensionContext | undefined;
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
    context = undefined;
  };
  pi.on("session_start", reset);
  pi.on("session_shutdown", reset);
  pi.on("model_select", (_event, ctx) => { context = ctx; });

  pi.registerCommand("reader", {
    description: "Read an article with per-URL Q&A and learning recaps: /reader [URL]",
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/reader needs pi's interactive terminal UI.", "error");
        return;
      }
      if (view) return;
      context = ctx;
      state ??= new ReaderState((...params) => {
        if (!context) throw new Error("The reader session has ended.");
        return createAnswer(context)(...params);
      });
      try {
        await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
          view = new ReaderView(state!, theme, () => tui.terminal.rows, () => tui.requestRender(), () => done());
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
