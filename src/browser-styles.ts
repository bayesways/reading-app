const styles = String.raw`
:root{color-scheme:dark;--bg:#121212;--text:#e0e0e0;--bright:#fff;--muted:#a0a0a0;--faint:#5e5a52;--line:#333;--accent:#a8d1a8;--danger:#e39191;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
*{box-sizing:border-box}[hidden]{display:none !important}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
.col{max-width:720px;margin:0 auto;padding:40px 20px 28px}
input,textarea{font:inherit;line-height:inherit;color:inherit;background:none;border:0;padding:0;margin:0;width:100%;resize:none;outline:none}
input::placeholder,textarea::placeholder{color:var(--faint)}
/* the only chrome: a wordmark and a bare url line. enter loads, no button. */
.top{display:flex;align-items:baseline;gap:16px;border-bottom:1px solid var(--line);padding-bottom:14px;margin-bottom:44px}
.mark{flex:none;font-size:.95rem;font-weight:600;letter-spacing:-.3px}
.top form{flex:1;min-width:0}.field{position:relative;min-width:0}.field input,.field textarea{caret-color:transparent}
.field:focus-within input:placeholder-shown,.field textarea:placeholder-shown{text-indent:12px}
#url{font:.82rem/1.7 var(--mono);color:var(--muted);text-overflow:ellipsis}#url:focus{color:var(--text)}
.field-cursor{position:absolute;left:0;top:0;width:8px;height:1.3em;background:var(--text);opacity:0;pointer-events:none;z-index:1}
.top .field.cursor-active .field-cursor{opacity:1;animation:cursor-blink 1s steps(1,end) infinite}
.ask-field .field-cursor{background:var(--accent);animation:cursor-pulse 2.8s ease-in-out infinite}
@keyframes cursor-blink{50%{opacity:0}}
@keyframes cursor-pulse{0%,100%{opacity:.15}50%{opacity:.46}}
@media(prefers-reduced-motion:reduce){.top .field.cursor-active .field-cursor{animation:none}.ask-field .field-cursor{animation:none;opacity:.24}}
h1{font-size:2.1rem;font-weight:600;color:var(--bright);letter-spacing:-.5px;line-height:1.25;margin:0 0 1.1rem}
.label{font:.78rem/1.7 var(--mono);color:var(--faint);margin:-.6rem 0 1.6rem}.label.recap{color:var(--accent)}
article h2,article h3,article h4{font-weight:600;color:var(--bright);letter-spacing:-.3px;margin:2em 0 .5em}article h2{font-size:1.5rem}article h3{font-size:1.2rem}article h4{font-size:1.05rem}
article p,.ex p,.ex li{margin:0 0 1.5em}article ul,article ol,.ex ul,.ex ol{padding-left:1.3em;margin:0 0 1.5em}article li,.ex li{margin:0 0 .4em}
article a,.ex a{color:var(--accent);text-decoration:none}article a:hover,.ex a:hover{color:var(--bright);text-decoration:underline}
article pre,.ex pre{background:#1e1e1e;border:1px solid var(--line);border-radius:8px;padding:16px;overflow:auto;margin:0 0 1.5em}
article code,.ex code{font:.9em var(--mono);background:#2a2a2a;padding:2px 6px;border-radius:4px}article pre code,.ex pre code{background:none;padding:0}
article blockquote{border-left:4px solid var(--accent);margin:0 0 1.5em;padding-left:20px;color:var(--muted);font-style:italic}
article table,.ex table{display:block;max-width:100%;overflow:auto;border-collapse:collapse;margin:0 0 1.5em}
article th,article td,.ex th,.ex td{border:1px solid var(--line);padding:6px 10px;text-align:left}
article hr{border:0;border-top:1px solid var(--line);margin:2em 0}
/* reader-view pages keep their figures, as in Firefox's reader view. */
article img{max-width:100%;height:auto;vertical-align:middle}article img.formula{filter:invert(.88)}
article figure{margin:0 0 1.5em}article figure img{display:block}
article figcaption,article caption{margin-top:.5em;font-size:.86rem;line-height:1.55;color:var(--muted);text-align:left}
article sup,article sub{font-size:.75em;line-height:0}
article dl{margin:0 0 1.5em}article dt{font-weight:600;color:var(--bright)}article dd{margin:0 0 .6em 1.3em}
article mark{background:rgba(168,209,168,.22);color:inherit}
article kbd{font:.85em var(--mono);border:1px solid var(--line);border-radius:4px;padding:1px 5px}
/* the discussion sits under the article in the same column. no sidebar, no divider. */
.thread{border-top:1px solid var(--line);margin-top:36px;padding-top:26px}
.ex{margin-bottom:28px}.ex:last-child{margin-bottom:0}
.ex .q{font-weight:600;color:var(--bright);margin:0 0 .7em}
.ex .n{font:500 .8rem var(--mono);color:var(--accent);margin-right:.6em}
.ex blockquote{border-left:4px solid var(--accent);margin:0 0 1em;padding-left:18px;color:var(--muted);font-style:italic}
.ex.waiting{color:var(--faint)}.ex.waiting .q{color:var(--muted)}
/* the ask line and its foot stay docked; the article scrolls under them. */
.dock{position:fixed;left:0;right:0;bottom:0;z-index:3;background:var(--bg);border-top:1px solid var(--line)}
.dock::before{content:"";position:absolute;left:0;right:0;bottom:100%;height:36px;background:linear-gradient(to top,var(--bg),transparent);pointer-events:none}
.bar{max-width:720px;margin:0 auto;padding:16px 20px 18px}
.ask form{width:100%;min-width:0}#question{min-height:1.7em;max-height:40vh;overflow:auto}
.quoted{display:flex;gap:10px;font-size:.9rem;color:var(--accent);margin-bottom:.6rem}
.quoted .text{flex:1;min-width:0;font-style:italic;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.quoted .esc{flex:none;font:.74rem var(--mono);color:var(--faint)}
.foot{margin-top:12px;font:.74rem/1.6 var(--mono);color:var(--faint)}.foot.error{color:var(--danger)}.foot.busy{animation:pulse 1.2s ease-in-out infinite alternate}
@keyframes pulse{to{opacity:.45}}
/* follows the live selection; the only action affordance on the page. */
.hint{position:fixed;top:0;left:0;z-index:2;appearance:none;font:.72rem var(--mono);color:var(--accent);background:var(--bg);border:1px solid var(--line);border-radius:4px;padding:2px 7px;white-space:nowrap;cursor:pointer}
.hint:hover,.hint:focus-visible{color:var(--bright);border-color:var(--accent);outline:none}
::selection{background:rgba(168,209,168,.22)}
@media(max-width:600px){.col{padding:28px 16px 24px}.bar{padding:12px 16px 14px}h1{font-size:1.7rem}}
`;

export function browserStyles(): string {
  return styles;
}
