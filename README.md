# Pi Terminal Reader

Read web articles, PDFs, and local HTML/PDF files in pi's terminal UI or a local browser workspace, then ask questions grounded in the article. Articles and discussions stay in memory for the current pi session.

## Requirements

- Node.js 22+
- pi 0.85.1+

```sh
npm install
```

## Configure a model

The reader uses pi's existing model configuration and credentials. Log in and choose a model in pi first:

```text
/login
/model
```

By default, [`reader.config.json`](reader.config.json) inherits that selected model:

```json
{
  "defaultModel": null,
  "defaultThinkingLevel": "medium"
}
```

To always use a particular model for reader requests, set `defaultModel` to an identifier shown by `pi --list-models`. The provider name must match exactly. For example, a Codex model uses `openai-codex`, not `openai`:

```json
{
  "defaultModel": "openai-codex/gpt-5.6-terra",
  "defaultThinkingLevel": "high"
}
```

Set `defaultThinkingLevel` to `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, or `null` to inherit pi's setting. Set `PI_READER_CONFIG=/path/to/config.json` to use another config file.

## Use from pi

Start pi in this project and trust the extension when prompted:

```sh
pi
```

Then run one of these commands:

```text
/reader https://example.com/article       # terminal reader
/reader --browser https://example.com/article  # local browser reader
/reader ~/Downloads/paper.pdf             # a local PDF or HTML file
/reader --browser-stop                    # stop the browser server
```

The browser server listens only on a random `127.0.0.1` URL. Keep pi running while using it. To apply a model/configuration change, stop and reopen the browser reader.

## Run the browser reader directly

```sh
npm start -- https://example.com/article
# or
./bin/pi-reader.mjs https://example.com/article
./bin/pi-reader.mjs https://arxiv.org/pdf/1706.03762
./bin/pi-reader.mjs ./notes/chapter.html
```

Use `--no-open` to print the local URL without opening a browser, and `--config PATH` to select a config file.

## Sources

Anywhere a URL is accepted (the command line, `/reader`, the terminal URL bar, and the browser's top line) you can also give a path to a local file:

- Web pages: HTML and plain text, up to 2 MiB.
- PDFs, by URL or path, up to 25 MiB. The text layer is extracted page by page with **Page N** markers. The title comes from the PDF's metadata, or the file name if the metadata has none. Scanned PDFs without a text layer are not supported (no OCR).
- Local files: `.html`, `.htm`, `.xhtml`, `.pdf`, and `.txt`. Accepted forms are `/absolute/path`, `~/path`, `./relative` or `../relative`, `file:///…`, or a bare relative path like `docs/paper.pdf` if that file exists. Relative paths resolve against the directory the reader (or pi) was started in. Links inside a local HTML file to other local files are dropped. Links to the web are kept.

Each file keeps its own discussion. Different spellings of the same file (including symlinks) share one.

## Controls

### Browser

Select text in the article and an **↵ explain** button appears beside it: click it, or press `Enter`, to ask for an explanation of that passage. The passage stays attached to your next question until `Esc` clears it. Type in the ask line at the bottom to ask anything, `/recap` for a recap of the article and its completed Q&A, and `/article` to return to the page. Paste a URL or file path in the top line to load a page; each source keeps its own discussion.

Unsent questions stay with their article as you switch pages in the same browser tab. You can draft the next question while an answer is loading; completing the answer will not erase your edits. Drafts are held in the tab's memory and are cleared when it reloads or closes.

### Terminal

- `Tab`: move between panes
- `Enter`: load a URL or send a question
- `F2` / `Ctrl+S`: summarize
- `F3`: switch article/recap
- `F4`: switch loaded pages
- `F5` / `v`: begin keyboard selection
- `F6` / `e`: explain selection
- `F7` / `a`: ask about selection
- `F8` / `x`: clear selection
- `Esc`: cancel a request or close the reader

Start pi with `pi --tui-mode fullscreen` for mouse selection in the terminal.

## Notes

- Loading an article does not require model credentials; questions and recaps do.
- The reader sends the extracted article, selected passage, and prior Q&A for that URL to the selected model provider.
- Content is held in memory only and is cleared when the pi session ends, reloads, or the browser reader is stopped.
- Reader extraction supports ordinary HTTP(S) pages, PDFs with a text layer, and local HTML/PDF/text files. JavaScript-only pages, scanned PDFs, paywalls, and login-required pages may not work.
- The reader only opens local files you name, and only the document types listed above.

## Development

```sh
npm run check
npm test
python3 test/smoke-terminal.py
python3 test/smoke-terminal.py --browser
python3 test/smoke-cli.py
```
