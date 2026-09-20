export function browserPage(nonce: string): string {
  return String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Pi Reader</title>
<style nonce="${nonce}">
:root{color-scheme:dark;--bg:#121212;--text:#e0e0e0;--bright:#fff;--muted:#a0a0a0;--faint:#5e5a52;--line:#333;--accent:#a8d1a8;--danger:#e39191;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
*{box-sizing:border-box}[hidden]{display:none !important}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
.col{max-width:720px;margin:0 auto;padding:40px 20px 64px}
input,textarea{font:inherit;line-height:inherit;color:inherit;background:none;border:0;padding:0;margin:0;width:100%;resize:none;outline:none}
input::placeholder,textarea::placeholder{color:var(--faint)}
/* the only chrome: a wordmark and a bare url line. enter loads, no button. */
.top{display:flex;align-items:baseline;gap:16px;border-bottom:1px solid var(--line);padding-bottom:14px;margin-bottom:44px}
.mark{flex:none;font-size:.95rem;font-weight:600;letter-spacing:-.3px}
.top form{flex:1;min-width:0}#url{font:.82rem/1.7 var(--mono);color:var(--muted);text-overflow:ellipsis}#url:focus{color:var(--text)}
h1{font-size:2.1rem;font-weight:600;color:var(--bright);letter-spacing:-.5px;line-height:1.25;margin:0 0 1.1rem}
.label{font:.78rem/1.7 var(--mono);color:var(--faint);margin:-.6rem 0 1.6rem}.label.recap{color:var(--accent)}
article h2,article h3,article h4{font-weight:600;color:var(--bright);letter-spacing:-.3px;margin:2em 0 .5em}article h2{font-size:1.5rem}article h3{font-size:1.2rem}article h4{font-size:1.05rem}
article p,.ex p,.ex li{margin:0 0 1.5em}article ul,article ol,.ex ul,.ex ol{padding-left:1.3em;margin:0 0 1.5em}article li,.ex li{margin:0 0 .4em}
article a,.ex a{color:var(--accent);text-decoration:none}article a:hover,.ex a:hover{color:var(--bright);text-decoration:underline}
article pre,.ex pre{background:#1e1e1e;border:1px solid var(--line);border-radius:8px;padding:16px;overflow:auto;margin:0 0 1.5em}
article code,.ex code{font:.9em var(--mono);background:#2a2a2a;padding:2px 6px;border-radius:4px}article pre code,.ex pre code{background:none;padding:0}
article blockquote{border-left:4px solid var(--accent);margin:0 0 1.5em;padding-left:20px;color:var(--muted);font-style:italic}
article hr{border:0;border-top:1px solid var(--line);margin:2em 0}
/* the discussion sits under the article in the same column. no sidebar, no divider. */
.thread{border-top:1px solid var(--line);margin-top:36px;padding-top:26px}
.ex{margin-bottom:28px}.ex:last-child{margin-bottom:0}
.ex .q{font-weight:600;color:var(--bright);margin:0 0 .7em}
.ex .n{font:500 .8rem var(--mono);color:var(--accent);margin-right:.6em}
.ex blockquote{border-left:4px solid var(--accent);margin:0 0 1em;padding-left:18px;color:var(--muted);font-style:italic}
.ex.waiting{color:var(--faint)}.ex.waiting .q{color:var(--muted)}
.ask{display:flex;align-items:baseline;gap:10px;border-top:1px solid var(--line);margin-top:36px;padding-top:16px}
.ask .caret{flex:none;color:var(--accent)}.ask form{flex:1;min-width:0}#question{max-height:40vh;overflow:auto}
.quoted{display:flex;gap:10px;font-size:.9rem;color:var(--accent);margin-bottom:.6rem}
.quoted .text{flex:1;min-width:0;font-style:italic;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.quoted .esc{flex:none;font:.74rem var(--mono);color:var(--faint)}
.foot{margin-top:18px;font:.74rem/1.6 var(--mono);color:var(--faint)}.foot.error{color:var(--danger)}.foot.busy{animation:pulse 1.2s ease-in-out infinite alternate}
@keyframes pulse{to{opacity:.45}}
/* follows the live selection; the only action affordance on the page. */
.hint{position:fixed;top:0;left:0;z-index:2;font:.72rem var(--mono);color:var(--accent);background:var(--bg);border:1px solid var(--line);border-radius:4px;padding:2px 7px;pointer-events:none;white-space:nowrap}
::selection{background:rgba(168,209,168,.22)}
@media(max-width:600px){.col{padding:28px 16px 48px}h1{font-size:1.7rem}}
</style>
</head>
<body>
<div class="col">
<div class="top"><span class="mark">reader</span><form id="loadForm"><input id="url" type="url" inputmode="url" list="pages" spellcheck="false" placeholder="paste a url, then press enter" aria-label="Article URL"></form><datalist id="pages"></datalist></div>
<article id="article"></article>
<section class="thread" id="thread" hidden></section>
<div class="ask"><span class="caret">&rsaquo;</span><form id="askForm"><div class="quoted" id="quoted" hidden><span class="text" id="quotedText"></span><span class="esc">esc clears</span></div><textarea id="question" rows="1" placeholder="ask, or /recap" aria-label="Ask about this article"></textarea></form></div>
<div class="foot" id="foot">Connecting to pi…</div>
</div>
<span class="hint" id="hint" hidden>&crarr; explain</span>
<script nonce="${nonce}">
'use strict';
const base=location.pathname.endsWith('/')?location.pathname:location.pathname+'/';
const $=id=>document.getElementById(id); let state; let selected=''; let mode='article'; let requestId=0; let pending=null; let flash=0; let flashTimer=0;
const safeUrl=value=>{try{const u=new URL(value);return u.protocol==='http:'||u.protocol==='https:'?u.href:null}catch{return null}};
function inline(parent,text){const re=/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\x60([^\x60]+)\x60|\*\*([^*]+)\*\*|\*([^*]+)\*/g;let at=0,m;while((m=re.exec(text))){parent.append(document.createTextNode(text.slice(at,m.index)));let node;if(m[1]){node=document.createElement('a');node.textContent=m[1];node.href=safeUrl(m[2])||'#';node.target='_blank';node.rel='noopener noreferrer'}else if(m[3]){node=document.createElement('code');node.textContent=m[3]}else{node=document.createElement(m[4]?'strong':'em');node.textContent=m[4]||m[5]}parent.append(node);at=re.lastIndex}parent.append(document.createTextNode(text.slice(at)))}
function markdown(text,root){root.replaceChildren();const lines=(text||'').split('\n');let i=0;while(i<lines.length){const line=lines[i];if(!line.trim()){i++;continue}if(/^\x60\x60\x60/.test(line)){const code=[];i++;while(i<lines.length&&!/^\x60\x60\x60/.test(lines[i]))code.push(lines[i++]);i++;const pre=document.createElement('pre'),c=document.createElement('code');c.textContent=code.join('\n');pre.append(c);root.append(pre);continue}const heading=line.match(/^(#{1,6})\s+(.+)/);if(heading){const h=document.createElement('h'+Math.min(heading[1].length+1,6));inline(h,heading[2]);root.append(h);i++;continue}if(/^([-*_])(?:\s*\1){2,}\s*$/.test(line)){root.append(document.createElement('hr'));i++;continue}if(/^>\s?/.test(line)){const q=document.createElement('blockquote'),parts=[];while(i<lines.length&&/^>\s?/.test(lines[i]))parts.push(lines[i++].replace(/^>\s?/,''));inline(q,parts.join('\n'));root.append(q);continue}const list=line.match(/^\s*(?:([-+*])|(\d+)\.)\s+(.+)/);if(list){const tag=list[2]?'ol':'ul',el=document.createElement(tag);while(i<lines.length){const item=lines[i].match(/^\s*(?:([-+*])|(\d+)\.)\s+(.+)/);if(!item||Boolean(item[2])!==Boolean(list[2]))break;const li=document.createElement('li');inline(li,item[3]);el.append(li);i++}root.append(el);continue}const parts=[line];i++;while(i<lines.length&&lines[i].trim()&&!/^(#{1,6})\s|^\x60\x60\x60|^>\s?|^\s*(?:[-+*]|\d+\.)\s+/.test(lines[i]))parts.push(lines[i++]);const p=document.createElement('p');inline(p,parts.join(' '));root.append(p)}}
async function api(action='',payload,method=payload?'POST':'GET'){const options={method,headers:{'Accept':'application/json'}};if(payload!==undefined){options.headers['Content-Type']='application/json';options.body=JSON.stringify(payload)}const response=await fetch(base+'api/'+action,options);const data=await response.json().catch(()=>({error:'Invalid response from pi.'}));if(!response.ok)throw new Error(data.error||('Request failed: '+response.status));return data}
function fail(error){state={...state,busy:false,error:true,status:error.message};flashStatus();render()}
// The title is rendered as the page's own heading; drop it from the body to avoid a duplicate.
function withoutTitle(text,title){const m=(text||'').match(/^#\s+(.+)\n?/);return m&&m[1].trim().toLowerCase()===(title||'').trim().toLowerCase()?text.slice(m[0].length):text}
function note(text,extra){const p=document.createElement('p');p.className='label'+(extra?' '+extra:'');p.textContent=text;return p}
function exchange(number,question,quote,answer){const box=document.createElement('section');box.className='ex'+(answer?'':' waiting');const q=document.createElement('p');q.className='q';const n=document.createElement('span');n.className='n';n.textContent='Q'+number;q.append(n,document.createTextNode(question));box.append(q);if(quote){const blockquote=document.createElement('blockquote');blockquote.textContent=quote;box.append(blockquote)}const body=document.createElement('div');if(answer)markdown(answer,body);else body.append(note('waiting for your model… esc cancels'));box.append(body);return box}
function footer(){if(!state)return'';if(state.busy||state.error||flash)return state.status;const pages=state.pages.length;return [state.model,'in memory',pages?pages+' page'+(pages===1?'':'s'):'no pages'].join(' · ')}
function flashStatus(){clearTimeout(flashTimer);flash=1;flashTimer=setTimeout(()=>{flash=0;render()},6000)}
function render(){if(!state)return;const current=state.current;
if(current&&document.activeElement!==$('url'))$('url').value=current.article.url;
const list=$('pages');list.replaceChildren();for(const page of state.pages){const option=document.createElement('option');option.value=page.url;option.label=page.title;list.append(option)}
const body=$('article');body.replaceChildren();
if(current){const h1=document.createElement('h1');h1.textContent=current.article.title;body.append(h1);
if(mode==='summary'){body.append(note('recap · type /article to return to the page','recap'));const recap=document.createElement('div');markdown(current.summary||'*No recap yet. Type /recap to make one.*',recap);body.append(recap)}
else{if(current.article.warning)body.append(note(current.article.warning));const text=document.createElement('div');markdown(withoutTitle(current.article.markdown,current.article.title),text);body.append(text)}}
else body.append(note('paste a url above to begin. nothing is saved; everything lives in this session.'));
const thread=$('thread');thread.replaceChildren();const exchanges=current?current.exchanges:[];
exchanges.forEach((item,index)=>thread.append(exchange(index+1,item.question,item.selection,item.answer)));
if(pending)thread.append(exchange(exchanges.length+1,pending.question,pending.selection,''));
thread.hidden=!thread.childElementCount;
// A passage attached in an earlier tab is still attached here: show it rather than hide the state.
if(current&&current.selection&&!selected)selected=current.selection;showQuote();
$('foot').textContent=footer();$('foot').className='foot'+(state.error?' error':'')+(state.busy?' busy':'')}
function showQuote(){$('quoted').hidden=!selected;$('quotedText').textContent='“'+selected+'”'}
function toBottom(){scrollTo({top:document.body.scrollHeight,behavior:'smooth'})}
function grow(){const question=$('question');question.style.height='auto';question.style.height=question.scrollHeight+'px'}
async function refresh(){state=await api('state');render();if(!state.current)$('url').focus()}
async function run(action,payload,item){const id=++requestId;pending=item||null;
try{state={...state,busy:true,error:false,status:action==='summary'?'Summarizing your reading and discussion… Esc cancels.':action==='load'?'Loading article… Esc cancels.':'Asking your pi model… Esc cancels.'};render();if(item)toBottom();
const result=await api(action,payload);
if(id===requestId){pending=null;state=result;selected=state.current?.selection||'';render();flashStatus();if(item)toBottom()}
return !result.error}
catch(error){if(id===requestId){pending=null;fail(error)}return false}}
async function explain(){if(!selected)return;await run('explain',{selection:selected},{question:'Explain this passage.',selection:selected})}
async function escape(){if(state?.busy){requestId++;pending=null;state=await api('cancel',{});flashStatus();render();return}
if(selected){selected='';$('hint').hidden=true;getSelection()?.removeAllRanges();state=await api('select',{selection:''});render();return}
if(mode==='summary'){mode='article';render()}}
$('loadForm').addEventListener('submit',event=>{event.preventDefault();const url=$('url').value.trim();if(!url)return;selected='';mode='article';$('url').blur();run('load',{url})});
// Picking a loaded page from the url line's list reopens its discussion immediately.
$('url').addEventListener('input',event=>{if(event.inputType!=='insertReplacementText')return;const url=$('url').value.trim();if(state?.pages.some(page=>page.url===url)&&url!==state.current?.article.url){selected='';mode='article';$('url').blur();run('load',{url})}});
$('askForm').addEventListener('submit',event=>{event.preventDefault();const value=$('question').value.trim();if(!value)return;
const command=value.toLowerCase();
if(command==='/recap'||command==='/summary'||command==='/summarize'){$('question').value='';grow();mode='summary';run('summary',{});return}
if(command==='/article'||command==='/read'){$('question').value='';grow();mode='article';render();return}
if(command.charAt(0)==='/'){state={...state,error:true,status:'Unknown command. Type /recap for a recap, /article to return to the page.'};flashStatus();render();return}
run('ask',{question:value,selection:selected},{question:value,selection:selected}).then(sent=>{if(sent){$('question').value='';grow()}})});
$('question').addEventListener('input',grow);
$('question').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();$('askForm').requestSubmit()}});
function captureSelection(){const selection=getSelection();if(!selection||selection.isCollapsed)return;const range=selection.getRangeAt(0);const node=range.commonAncestorContainer.nodeType===1?range.commonAncestorContainer:range.commonAncestorContainer.parentElement;if(!$('article').contains(node))return;const text=selection.toString().replace(/\s+/g,' ').trim().slice(0,20000);if(!text)return;selected=text;showQuote();api('select',{selection:selected}).catch(fail)}
function placeHint(){const hint=$('hint');const selection=getSelection();if(!selection||selection.isCollapsed||!selection.rangeCount){hint.hidden=true;return}const range=selection.getRangeAt(0);const node=range.commonAncestorContainer.nodeType===1?range.commonAncestorContainer:range.commonAncestorContainer.parentElement;const rects=range.getClientRects();const rect=rects[rects.length-1];if(!$('article').contains(node)||!rect){hint.hidden=true;return}hint.hidden=false;hint.style.transform='translate('+Math.round(Math.max(4,Math.min(rect.right+10,innerWidth-96)))+'px,'+Math.round(Math.max(4,rect.top))+'px)'}
$('article').addEventListener('mouseup',captureSelection);$('article').addEventListener('keyup',captureSelection);
document.addEventListener('selectionchange',placeHint);addEventListener('scroll',placeHint,{passive:true});addEventListener('resize',placeHint);
// Every remaining action is a keystroke: enter explains a selection, esc unwinds, any letter starts a question.
addEventListener('keydown',event=>{const typing=event.target===$('question')||event.target===$('url');
if(event.key==='Escape'){event.preventDefault();escape().catch(fail);return}
if(typing||event.metaKey||event.ctrlKey||event.altKey)return;
if(event.key==='Enter'){if(selected){event.preventDefault();explain().catch(fail)}return}
if(event.key.length===1&&event.key!==' '){event.preventDefault();const question=$('question');question.focus();question.value+=event.key;grow()}});
refresh().catch(fail);
</script>
</body></html>`;
}
