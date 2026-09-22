# Pi Terminal Reader

Read web articles in a local browser workspace, then ask questions grounded in the article. The package includes its own command and can also run as a pi extension. Articles and discussions stay in memory for the current process.

## Requirements

- Node.js 22+

## Install

```sh
npm install --global pi-terminal-reader
```

From a downloaded checkout, use `npm install` followed by `npm link`, or run `npm start` without linking it globally.

## Start the reader

```sh
pi-reader
```

The command opens an empty reader. Paste an article URL into the top line when you are ready; no URL argument or example link is required. Passing a URL remains optional:

```sh
pi-reader https://example.com/article
```

Use `--no-open` to print the local URL without opening a browser, and `--config PATH` to select a config file. The process stays alive until you press `Ctrl+C`.

## Connect a model

Use **connect provider** in the reader to sign in with a provider or enter an API key, then choose the model in the model menu. OAuth, device-code, manual-code, and API-key prompts are handled in the local reader. You do not need to open pi first.

The package uses Pi's model runtime in the background and stores credentials in Pi's local credential store. If Pi is already configured, the reader recognizes those credentials and initially selects Pi's default model when it is available. Selecting another model in the reader affects the current reader process and does not change Pi's default.

By default, [`reader.config.json`](reader.config.json) inherits Pi's selected model when it is available. Otherwise, choose a model in the reader:

```json
{
  "defaultModel": null,
  "defaultThinkingLevel": "medium"
}
```

To prefer a particular model for reader requests, set `defaultModel` to its `provider/model` identifier. The provider name must match exactly. For example, a Codex model uses `openai-codex`:

```json
{
  "defaultModel": "openai-codex/gpt-5.6-terra",
  "defaultThinkingLevel": "high"
}
```

Set `defaultThinkingLevel` to `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, or `null` to inherit Pi's setting. Set `PI_READER_CONFIG=/path/to/config.json` to use another config file.

## Use from pi

Start pi in this project and trust the extension when prompted:

```sh
pi
```

Then run one of these commands:

```text
/reader https://example.com/article       # terminal reader
/reader --browser https://example.com/article  # local browser reader
/reader --browser-stop                    # stop the browser server
```

The browser server listens only on a random, capability-protected `127.0.0.1` URL. Keep Pi running while using extension mode.

## Controls

### Browser

Select text in the article and an **↵ explain** button appears beside it: click it, or press `Enter`, to ask for an explanation of that passage. The passage stays attached to your next question until `Esc` clears it. Type in the ask line at the bottom to ask anything, `/recap` for a recap of the article and its completed Q&A, and `/article` to return to the page. Paste a URL in the top line to load a page; each URL keeps its own discussion.

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

- Starting the reader and loading an article do not require model credentials; questions and recaps do.
- The reader sends the extracted article, selected passage, and prior Q&A for that URL to the selected model provider.
- Provider credentials are stored by Pi on the local computer. Article content, discussions, and the reader's model choice are held in memory and clear when the process ends.
- Reader extraction supports ordinary HTTP(S) pages. JavaScript-only pages, PDFs, paywalls, and login-required pages may not work.

## Development

```sh
npm run check
npm test
python3 test/smoke-terminal.py
python3 test/smoke-terminal.py --browser
python3 test/smoke-cli.py
```
