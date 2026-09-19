# Pi Terminal Reader

Read an article and explore it with your selected pi model, entirely inside the terminal.

```text
 π READER · in memory only · 2 page(s)
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

Use your normal pi `/login` and `/model` before opening the reader. Reading itself needs no model credentials. Asking and summarizing use the currently selected model through pi's model registry; no separate API key is needed.

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
| Esc | Cancel a request; otherwise return from recap; otherwise close |
| Ctrl+C | Close immediately, cancelling any request |

Questions are single-line inputs; pasted newlines become spaces. Responses arrive when the model finishes (not token-streamed). You can keep reading and scrolling while it works. Closing/reopening `/reader` preserves state **only during the current session**. Revisiting a URL restores its discussion, draft, and scroll position; fragments share a conversation, distinct query strings do not.

At **90 columns or wider**, the Q&A panel stays on the right. Smaller terminals show one pane at a time; Tab switches panes. Minimum usable size: 36×12. Keyboard navigation works in both regular and fullscreen pi modes. On macOS, you may need Fn+F2/F3/F4; Ctrl+S also generates a recap.

## Learning recaps

Recaps use the loaded article and that URL's completed discussion, focusing on ideas explored, clarifications, open questions, and takeaways. With no questions yet, the model is instructed to label its output as article takeaways rather than invent personal learning. A recap appears as rendered Markdown; it is not written to a file or posted to the main pi chat.

## Privacy and limits

- Articles, conversations, and recaps are **in memory only**. They are discarded on session switch, new session, fork, reload, or pi exit. Nothing is appended to pi's saved conversation. Terminal scrollback/logging is outside the extension's control.
- Loading fetches only the requested HTTP(S) page and up to five redirects. No browser cookies, login sessions, page scripts, or subresources are used. Fetching can reach local HTTP services if you explicitly supply their URL.
- Asking or summarizing sends the extracted article and its discussion to your selected model provider. Provider retention/billing policies still apply; these direct model calls are not included in pi's normal conversation usage totals.
- Mozilla Readability extracts the main content; Turndown converts it to Markdown. Layout, images (except alt text), interactive elements, and exact browser styling are not preserved. Links are displayed, not navigated within the reader; paste another URL to load it.
- Paywalls, JavaScript-only sites, PDFs, and login-required pages are unsupported. Some publishers block automated requests. Extraction can omit content; use the original source when accuracy is critical.
- Downloads are limited to **2 MiB / 20 seconds**, model requests to **3 minutes**. Oversized model context is rejected with an error rather than silently truncating the source or discussion. Select a larger-context model outside the reader if needed.
- Article text is treated as untrusted reference material, terminal control sequences are removed, and the reading model receives **no tools**.

## Development

```sh
npm run check
npm test
python3 test/smoke-terminal.py  # real pi in a PTY; local HTTP fixture, no LLM calls
```

`src/article.ts` handles extraction, `src/reader.ts` owns ephemeral per-URL state, `src/model.ts` handles model requests, and `src/ui.ts` renders the split-pane workspace. `src/index.ts` connects command and session lifecycle hooks.

Tests cover extraction, fetch limits/redirects, URL isolation, cancellation races, model errors/context limits, lifecycle cleanup, keyboard input, Unicode widths, and terminal resizing. Model behavior is tested with a mocked registry, not paid provider calls.
