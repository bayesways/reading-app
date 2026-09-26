import { browserClient } from "./browser-client.ts";
import { browserStyles } from "./browser-styles.ts";

export function browserPage(nonce: string): string {
  return String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Pi Reader</title>
<style nonce="${nonce}">${browserStyles()}</style>
</head>
<body>
<div class="col">
<div class="top"><span class="mark">reader</span><form id="loadForm"><div class="field"><input id="url" type="text" list="pages" spellcheck="false" autocomplete="off" placeholder="paste a url or file path, then press enter" aria-label="Article URL or file path"><span class="field-cursor" aria-hidden="true"></span></div></form><datalist id="pages"></datalist></div>
<article id="article"></article>
<section class="thread" id="thread" hidden></section>
</div>
<div class="dock" id="dock" hidden><div class="bar"><div class="ask"><form id="askForm"><div class="quoted" id="quoted" hidden><span class="text" id="quotedText"></span><span class="esc">esc clears</span></div><div class="field ask-field"><textarea id="question" rows="1" placeholder="ask, or /recap" aria-label="Ask about this article"></textarea><span class="field-cursor" aria-hidden="true"></span></div></form></div>
<div class="foot" id="foot">Connecting to pi…</div>
</div></div>
<button class="hint" id="hint" type="button" hidden aria-label="Explain the selected passage">&crarr; explain</button>
<script nonce="${nonce}">'use strict';${browserClient()}</script>
</body></html>`;
}
