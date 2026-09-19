# Pi Terminal Reader

Read an article and explore it with your selected pi model, entirely inside the terminal.

```text
 π READER provider/model · in memory · 2 page(s)
 URL https://example.com/article
 ──────────────────────────────────────────────────────────────────
 ARTICLE                                  │ QUESTIONS
                                          │
 Article title                            │ Q1: Why does this matter?
                                          │
 Readable headings, paragraphs, lists,     │ An explanation grounded in
 links and code.                          │ the article and our discussion.
                                          │
 ──────────────────────────────────────────────────────────────────
 Selected: posterior                     │ [Explain] [Ask] [Clear]
 Focus: article · ↑↓ / PgUp PgDn scroll    │ ? Ask about this article…
 F2 summarize · F3 article/recap · F4 next page · Esc close
```

## Start here

Requires Node.js 22+ and **pi 0.85.1+** (`@earendil-works/pi-coding-agent`).

From this project:

```sh
npm install
pi
```

Trust this project's extension when prompted. In an already-running pi session, use:

```text
/reload
/reader https://example.com/article
```

Or `/reader` to open an empty URL bar or return to the current reading.
The project entry point is `.pi/extensions/reader.ts`.

To use it from other projects, install this directory as a pi package:

```sh
pi install /absolute/path/to/reading-app
```

For a one-off test without project discovery:

```sh
pi --no-extensions -e ./src/index.ts
```

Use your normal pi `/login` and `/model` before opening the reader. Reading itself needs no model credentials. **The header shows the launching session's `provider/model`**, and both questions and recaps use that exact model through pi's model registry with your existing authentication. It is bound for the lifetime of the reader window, with no fallback to another model. To switch, close the reader, use `/model`, then reopen `/reader`; your in-memory reading discussion remains available. The reader uses a separate reading conversation, not the coding session's chat history.

## Controls

| Key | Action |
| --- | --- |
| Tab / Shift+Tab | Cycle URL → article → discussion → question input |
| Ctrl+L | Focus the URL bar (Ctrl+U clears it) |
| Enter | Load URL or send question, depending on focus |
| ↑ / ↓ or j / k | Scroll the focused article/discussion pane |
| PgUp / PgDn | Scroll by a page; in the question box, scrolls discussion |
| Home / End or g / G | Top / bottom of a focused reading pane |
| F2 or Ctrl+S | Generate a **learning recap**, displayed in the main pane |
| F3 | Switch between the article and its latest recap |
| F4 | Cycle through loaded URLs and their separate conversations |
| F5 or v in the article | Enter keyboard selection mode |
| F6 or e in the article | Explain the selected word/passage in context |
| F7 or a / Enter in the article | Focus the question input with the selection attached |
| F8 or x in the article | Clear the attached selection |
| Esc | Cancel a request; otherwise clear selection; otherwise return from recap; otherwise close |
| Ctrl+C | Close immediately, cancelling any request |

Questions are single-line inputs; pasted newlines become spaces. Responses arrive when the model finishes (not token-streamed). You can keep reading and scrolling while it works. Closing/reopening `/reader` preserves state **only during the current session**. Revisiting a URL restores its discussion, draft, selected quote, and scroll position; fragments share a conversation, distinct query strings do not.

At **90 columns or wider**, the Q&A panel stays on the right. Smaller terminals show one pane at a time; Tab switches panes. Minimum usable size: 36×12. Keyboard navigation works in both regular and fullscreen pi modes. On macOS, you may need Fn with function keys; the letter shortcuts work while the article has focus, and Ctrl+S also generates a recap.

## Select a word or passage

### Mouse (fullscreen mode)

Start pi with mouse reporting enabled:

```sh
pi --tui-mode fullscreen
```

Then open `/reader URL`:

1. **Click a word** to select it, or **drag across a passage**. The highlight belongs to the reader, not the terminal's clipboard selection.
2. Inspect **Selected:** above the question box. The full excerpt is also shown in the scrollable right-hand discussion panel.
3. Press **F6** (or click **Explain**) for a contextual definition/explanation. Alternatively, press **F7** (or click **Ask**), type your own question, and press Enter.
4. Press **F8** (or click **Clear**) to stop attaching the excerpt to new questions.

Mouse wheel scrolls the pane under the pointer. Dragging across the divider never captures Q&A text. Move beyond the article's top/bottom edge to extend the selection while scrolling. On narrow screens, use F6/F7/F8 instead of the mouse action buttons.

### Keyboard (regular or fullscreen mode)

With the article focused:

1. Press **v** (or **F5**). A selection cursor appears at the top of the visible article.
2. Use **arrow keys** (or h/j/k/l) to move to a word. Press **w** to select that word.
3. For a longer passage, press **Space** to set the starting point, then move with arrows or PgUp/PgDn to extend it. Shift+arrows also start/extend a range.
4. Press **e** to explain, or **Enter** / **a** to focus the question box. These letters behave normally when typing a question.

Selections do **not** send a model request until you choose Explain or submit a question. Each completed exchange records the exact excerpt sent, and recaps include those exchanges. A new selection made while an answer is pending cannot change the already-sent question. The excerpt stays attached until cleared, including across closing/reopening the reader during the same session.

After a resize, page switch, or article/recap switch, the quoted excerpt is retained per URL but its old cell highlight is discarded to avoid highlighting the wrong text. Select it again if you want a fresh highlight. Long excerpts can be inspected by scrolling the discussion panel.

Ordinary terminal-native drag selection in **regular** pi mode cannot be read by the extension. Use keyboard selection there, or restart pi in fullscreen mode for integrated mouse selection.

## Learning recaps

Recaps use the loaded article and that URL's completed discussion (including the selected passages you asked about), focusing on ideas explored, clarifications, open questions, and takeaways. With no questions yet, the model is instructed to label its output as article takeaways rather than invent personal learning. A recap appears as rendered Markdown; it is not written to a file or posted to the main pi chat.

## Privacy and limits

- Articles, selected passages, conversations, and recaps are **in memory only**. They are discarded on session switch, new session, fork, reload, or pi exit. Nothing is appended to pi's saved conversation. Terminal scrollback/logging is outside the extension's control.
- Loading fetches only the requested HTTP(S) page and up to five redirects. No browser cookies, login sessions, page scripts, or subresources are used. Fetching can reach local HTTP services if you explicitly supply their URL.
- Asking sends the extracted article, any attached passage, and its discussion to the launching session's model provider. Summarizing sends the article and completed discussion, including excerpts recorded in that discussion. Provider retention/billing policies still apply; these direct model calls are not included in pi's normal conversation usage totals.
- Mozilla Readability extracts the main content; Turndown converts it to Markdown. Layout, images (except alt text), interactive elements, and exact browser styling are not preserved. Links are displayed, not navigated within the reader; paste another URL to load it.
- Paywalls, JavaScript-only sites, PDFs, and login-required pages are unsupported. Some publishers block automated requests. Extraction can omit content; use the original source when accuracy is critical.
- Downloads are limited to **2 MiB / 20 seconds**, model requests to **3 minutes**. Oversized model context is rejected with an error rather than silently truncating the source or discussion. Select a larger-context model outside the reader if needed.
- Article text is treated as untrusted reference material, terminal control sequences are removed, and the reading model receives **no tools**.

## Development

```sh
npm run check
npm test
python3 test/smoke-terminal.py  # real pi in a PTY; local HTTP fixture, no LLM calls
python3 test/smoke-terminal.py --fullscreen  # includes real SGR mouse click/drag selection
```

`src/article.ts` handles extraction, `src/reader.ts` owns ephemeral per-URL state, `src/model.ts` handles model requests, `src/selection.ts` maps grapheme-safe selections to rendered article cells, and `src/ui.ts` renders the split-pane workspace. `src/index.ts` connects command and session lifecycle hooks.

Tests cover extraction, fetch limits/redirects, URL isolation, cancellation races, model identity/context limits, lifecycle cleanup, selected-passage snapshots, keyboard and mouse selection, Unicode widths, and terminal resizing. Model behavior is tested with a mocked registry, not paid provider calls.
