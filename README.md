# Pi Terminal Reader

Read an article and explore it with your selected pi model in either pi's terminal UI or an optional local browser workspace. Pi remains the Q&A backend in both modes.

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
```

Configure the reader defaults in the repo-root [`reader.config.json`](reader.config.json):

```json
{
  "defaultModel": "openai/gpt-5.2",
  "defaultThinkingLevel": "medium"
}
```

`defaultModel` is a pi `provider/model` identifier (including custom models from pi's `models.json`). Use `pi --list-models` or `/model` to find one, and authenticate it once with pi's `/login` or the provider's API-key environment variable. Set it to `null` to inherit the active pi model in extension mode and pi's configured default model in standalone mode.

`defaultThinkingLevel` accepts `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, or `null`. `null` inherits pi's current/per-model/default setting. Pi clamps unsupported levels to the nearest level the chosen model exposes; the effective value is visible beside the model in both reader headers. The checked-in default is `medium` with no model override.

The config is read whenever a reader starts. A running browser server keeps its bound model and effort; stop and restart it to apply edits. Set `PI_READER_CONFIG=/path/to/config.json` to use another file.

To use the extension, start pi:

```sh
pi
```

Trust this project's extension when prompted. In an already-running pi session, use:

```text
/reload
/reader https://example.com/article
```

Or `/reader` to open an empty URL bar or return to the current terminal reading.

For the browser reader:

```text
/reader --browser https://example.com/article
```

This starts a private loopback server, opens the reader in your default browser, and immediately returns control to pi. `/reader -b URL` is equivalent. Run `/reader --browser` again to reopen the same browser workspace, or `/reader --browser-stop` to stop it and clear its browser-side in-memory data.

The project entry point is `.pi/extensions/reader.ts`.

To use it from other projects, install this directory as a pi package:

```sh
pi install /absolute/path/to/reading-app
```

For a one-off test without project discovery:

```sh
pi --no-extensions -e ./src/index.ts
```

Reading itself needs no model credentials. Questions and recaps use the configured model through pi's model registry and existing authentication. If `defaultModel` is `null`, extension mode uses the model selected by `/model`; otherwise the repo config overrides it **for reader requests only** and does not alter the main pi session. The header shows the effective `provider/model · thinking:level`. There is no fallback to another model after launch. To switch a running browser reader, use `/reader --browser-stop`, edit the config or use `/model` when inheriting, then start it again. Reader conversations remain separate from the coding session's chat history.

## Launch directly from the terminal

The standalone command opens the browser reader without opening pi's TUI:

```sh
npm start -- https://example.com/article
```

To install the command globally from this checkout:

```sh
npm link
pi-reader https://example.com/article
```

You can also invoke it directly as `./bin/pi-reader.mjs URL`. It uses pi's SDK model runtime, model catalog, custom `models.json`, and credentials; it does not create or save a pi chat session. Keep the terminal process running while using the page and press Ctrl+C to stop the loopback server.

```text
pi-reader [--no-open] [--config /path/to/reader.json] [URL]
```

`--no-open` prints the protected localhost URL without opening a browser. Run `pi-reader --help` for the complete usage text.

## Browser reader

`/reader --browser URL` serves an extracted reader-mode page—not the publisher's live site—with the article on the left and URL-scoped Q&A on the right. The browser UI provides:

- Native mouse or keyboard text selection. Select a word or passage, then choose **Explain**, or type a custom question and choose **Ask**.
- A persistent selected-passage preview; **Clear** stops attaching it to future questions.
- Per-URL article switching and separate discussions.
- **Summarize my learnings**, with Article/Recap view buttons.
- A Cancel button for article/model requests.
- Responsive single-column layout on narrow browser windows.

The browser tab talks only to the extension's random localhost address. Closing the tab does not stop the server, so `/reader --browser` can reopen it with the current session's state. It shuts down automatically on session switch, reload, or pi exit. Use `/reader --browser-stop` to stop it immediately and erase its browser workspace.

If pi cannot launch a browser—for example over SSH—it prints the localhost URL in a notification so you can open it on the same machine. Set `PI_READER_BROWSER_OPEN=0` to always print the URL without launching a browser.

The terminal and browser workspaces are intentionally separate, so running one cannot alter the other frontend's selected passage or pending request.

## Terminal controls

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

- Articles, selected passages, conversations, and recaps are **in memory only**. They are discarded on session switch, new session, fork, reload, or pi exit. `/reader --browser-stop` also clears the browser workspace. Nothing is appended to pi's saved conversation. Terminal scrollback and browser history are outside the extension's control.
- Loading fetches only the requested HTTP(S) page and up to five redirects. No browser cookies, login sessions, page scripts, or subresources are used. Fetching can reach local HTTP services if you explicitly supply their URL.
- Asking sends the extracted article, any attached passage, and its discussion to the configured pi model provider. Summarizing sends the article and completed discussion, including excerpts recorded in that discussion. Provider retention/billing policies still apply; these direct model calls are not included in pi's normal conversation usage totals.
- Mozilla Readability extracts the main content; Turndown converts it to Markdown. Layout, images (except alt text), interactive elements, and exact browser styling are not preserved. Links are displayed, not navigated within the reader; paste another URL to load it.
- Paywalls, JavaScript-only sites, PDFs, and login-required pages are unsupported. Some publishers block automated requests. Extraction can omit content; use the original source when accuracy is critical.
- Downloads are limited to **2 MiB / 20 seconds**, model requests to **3 minutes**. Oversized model context is rejected with an error rather than silently truncating the source or discussion. Select a larger-context model outside the reader if needed.
- Article text is treated as untrusted reference material, terminal control sequences are removed, and the reading model receives **no tools**.
- Browser mode binds only to `127.0.0.1` on a random port and uses a new 256-bit capability URL whenever it starts. API calls require that capability and the matching origin/host. Responses disable caching and MIME sniffing; the page uses a nonce-based Content Security Policy, sends no referrer, loads no remote scripts/styles/images, and renders article/model text through DOM text nodes rather than raw HTML. Anyone who obtains the capability URL while it is running can access that in-memory browser workspace, so do not share it.

## Development

```sh
npm run check
npm test
python3 test/smoke-terminal.py  # real pi in a PTY; local HTTP fixture, no LLM calls
python3 test/smoke-terminal.py --fullscreen  # includes real SGR mouse click/drag selection
python3 test/smoke-terminal.py --browser  # real pi command plus protected loopback API
python3 test/smoke-cli.py  # standalone command, config resolution, and clean shutdown
```

`src/article.ts` handles extraction, `src/reader.ts` owns ephemeral per-URL state, `src/config.ts` validates repo defaults, `src/model.ts` handles model/thinking requests, `src/selection.ts` maps grapheme-safe terminal selections, `src/ui.ts` renders the terminal workspace, and `src/browser.ts`/`src/browser-page.ts` provide the loopback web workspace. `src/index.ts` connects pi commands and lifecycle hooks; `src/cli.ts` and `bin/pi-reader.mjs` provide standalone launch.

Tests cover extraction, fetch limits/redirects, URL isolation, cancellation races, model/thinking configuration and context limits, lifecycle cleanup, selected-passage snapshots, terminal keyboard/mouse selection, Unicode widths, browser API authorization/CSP/input limits, standalone startup, and responsive terminal rendering. Model behavior is tested with a mocked registry, not paid provider calls.
