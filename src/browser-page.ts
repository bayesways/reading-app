import { browserMarkdown } from "./browser-markdown.ts";

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
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
.col{max-width:720px;margin:0 auto;padding:40px 20px 28px}
input,textarea,select,button{font:inherit;line-height:inherit;color:inherit}input,textarea{background:none;border:0;padding:0;margin:0;width:100%;resize:none;outline:none}
input::placeholder,textarea::placeholder{color:var(--faint)}
select,button{background:#1b1b1b;border:1px solid var(--line);border-radius:5px;padding:5px 8px}button{cursor:pointer}button:hover,button:focus-visible,select:focus-visible{border-color:var(--accent);outline:none}button:disabled,select:disabled{opacity:.5;cursor:default}
/* the only chrome: a wordmark and a bare url line. enter loads, no button. */
.top{display:flex;align-items:baseline;gap:16px;border-bottom:1px solid var(--line);padding-bottom:14px;margin-bottom:44px}
.mark{flex:none;font-size:.95rem;font-weight:600;letter-spacing:-.3px}
.top form{flex:1;min-width:0}#url{font:.82rem/1.7 var(--mono);color:var(--muted);text-overflow:ellipsis}#url:focus{color:var(--text)}
.assistant{font:.78rem/1.55 var(--mono);border:1px solid var(--line);border-radius:8px;padding:12px 14px;margin:-24px 0 38px;color:var(--muted)}
.model-line,.setup-line{display:flex;align-items:center;gap:8px}.model-line label{flex:1;min-width:0}.model-line select{width:100%}.assistant button{flex:none}.setup{border-top:1px solid var(--line);margin-top:11px;padding-top:11px}.setup-line select{min-width:0;flex:1}.setup-copy{margin:10px 0 0}.setup-copy.error,.setup-note.error{color:var(--danger)}.auth-link{display:inline-block;color:var(--accent);margin-top:7px}.code{display:block;color:var(--bright);font-size:1.05rem;letter-spacing:.08em;margin-top:5px}.prompt{margin-top:10px}.prompt label{display:block;margin-bottom:6px}.prompt input,.prompt select{border:1px solid var(--line);border-radius:5px;padding:6px 8px;background:#1b1b1b}.prompt-actions{display:flex;gap:8px;margin-top:8px}.setup-note{margin:9px 0 0;color:var(--faint)}
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
.ask{display:flex;align-items:baseline;gap:10px}
.ask .caret{flex:none;color:var(--accent)}.ask form{flex:1;min-width:0}#question{max-height:40vh;overflow:auto}
.quoted{display:flex;gap:10px;font-size:.9rem;color:var(--accent);margin-bottom:.6rem}
.quoted .text{flex:1;min-width:0;font-style:italic;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.quoted .esc{flex:none;font:.74rem var(--mono);color:var(--faint)}
.foot{margin-top:12px;font:.74rem/1.6 var(--mono);color:var(--faint)}.foot.error{color:var(--danger)}.foot.busy{animation:pulse 1.2s ease-in-out infinite alternate}
@keyframes pulse{to{opacity:.45}}
/* follows the live selection; the only action affordance on the page. */
.hint{position:fixed;top:0;left:0;z-index:2;appearance:none;font:.72rem var(--mono);color:var(--accent);background:var(--bg);border:1px solid var(--line);border-radius:4px;padding:2px 7px;white-space:nowrap;cursor:pointer}
.hint:hover,.hint:focus-visible{color:var(--bright);border-color:var(--accent);outline:none}
::selection{background:rgba(168,209,168,.22)}
@media(max-width:600px){.col{padding:28px 16px 24px}.bar{padding:12px 16px 14px}h1{font-size:1.7rem}.model-line,.setup-line{align-items:stretch;flex-direction:column}.model-line button,.setup-line button{width:100%}}
</style>
</head>
<body>
<div class="col">
<div class="top"><span class="mark">reader</span><form id="loadForm"><input id="url" type="url" inputmode="url" list="pages" spellcheck="false" placeholder="paste a url, then press enter" aria-label="Article URL"></form><datalist id="pages"></datalist></div>
<section class="assistant" id="assistant" hidden aria-label="Assistant setup">
<div class="model-line"><label><span class="sr-only">Assistant model</span><select id="model" aria-label="Assistant model"></select></label><button id="providerToggle" type="button">connect provider</button></div>
<div class="setup" id="setup" hidden>
<div class="setup-line" id="providerControls"><select id="provider" aria-label="Model provider"></select><select id="authMethod" aria-label="Sign-in method"></select><button id="connect" type="button">connect</button></div>
<p class="setup-note" id="setupNote">Credentials are stored locally in Pi's credential store on this computer.</p>
<div id="authPanel" hidden aria-live="polite"><p class="setup-copy" id="authMessage"></p><a class="auth-link" id="authLink" target="_blank" rel="noopener noreferrer" hidden>open provider sign-in</a><strong class="code" id="deviceCode" hidden></strong>
<form class="prompt" id="authForm" hidden><label id="promptLabel" for="authValue"></label><div id="promptField"></div><div class="prompt-actions"><button type="submit">continue</button></div></form>
<div class="prompt-actions"><button id="cancelAuth" type="button" hidden>cancel</button><button id="dismissAuth" type="button" hidden>done</button></div></div>
</div></section>
<article id="article"></article>
<section class="thread" id="thread" hidden></section>
</div>
<div class="dock" id="dock"><div class="bar"><div class="ask"><span class="caret">&rsaquo;</span><form id="askForm"><div class="quoted" id="quoted" hidden><span class="text" id="quotedText"></span><span class="esc">esc clears</span></div><textarea id="question" rows="1" placeholder="ask, or /recap" aria-label="Ask about this article"></textarea></form></div>
<div class="foot" id="foot">Connecting to pi…</div>
</div></div>
<button class="hint" id="hint" type="button" hidden aria-label="Explain the selected passage">&crarr; explain</button>
<script nonce="${nonce}">
'use strict';
${browserMarkdown()}
const base=location.pathname.endsWith('/')?location.pathname:location.pathname+'/';
const $=id=>document.getElementById(id); let state; let selected=''; let mode='article'; let requestId=0; let pending=null; let flash=0; let flashTimer=0; let loading=null; let setupOpen=false; let authPoll=0;
// This tab's own in-flight request, and the one Escape cancelled. A snapshot can
// arrive busy because another tab is asking, and that flag never clears on its own.
let busyId=0; let cancelled=0;
// Browser drafts are local to this tab, keyed by the server's canonical article URL.
const drafts = new Map();
let draftUrl = '';
function saveDraft() {
  const text = $('question').value;
  const previous = drafts.get(draftUrl);
  if (!previous || previous.text !== text) {
    drafts.set(draftUrl, { text, revision: (previous?.revision || 0) + 1 });
  }
  return drafts.get(draftUrl);
}
function restoreDraft(url) {
  if (url === draftUrl) return;
  const previous = saveDraft();
  // Text typed before the first snapshot belongs to no article yet; the first one
  // to arrive adopts it rather than leaving it stranded under the empty key.
  if (!draftUrl && url && previous.text) { drafts.set(url, previous); drafts.delete(''); }
  draftUrl = url;
  $('question').value = drafts.get(url)?.text || '';
  grow();
}
function clearSubmittedDraft(url, submitted) {
  // Every edit stores a new record, so holding the submitted one still means
  // untouched. The first snapshot may have re-keyed a draft typed before it.
  const key = drafts.get(url) === submitted ? url : draftUrl;
  if (drafts.get(key) !== submitted) return;
  drafts.set(key, { text: '', revision: submitted.revision + 1 });
  if (draftUrl === key) { $('question').value = ''; grow(); }
}
async function api(action='',payload,method=payload?'POST':'GET'){const options={method,headers:{'Accept':'application/json'}};if(payload!==undefined){options.headers['Content-Type']='application/json';options.body=JSON.stringify(payload)}const response=await fetch(base+'api/'+action,options);const data=await response.json().catch(()=>({error:'Invalid response from pi.'}));if(!response.ok)throw new Error(data.error||('Request failed: '+response.status));return data}
function fail(error){state={...state,busy:false,error:true,status:error.message};flashStatus();render()}
// The title is rendered as the page's own heading; drop it from the body to avoid a duplicate.
function withoutTitle(text,title){const m=(text||'').match(/^#\s+(.+)\n?/);return m&&m[1].trim().toLowerCase()===(title||'').trim().toLowerCase()?text.slice(m[0].length):text}
function note(text,extra){const p=document.createElement('p');p.className='label'+(extra?' '+extra:'');p.textContent=text;return p}
function exchange(number,question,quote,answer,sourceUrl){const box=document.createElement('section');box.className='ex'+(answer?'':' waiting');const q=document.createElement('p');q.className='q';const n=document.createElement('span');n.className='n';n.textContent='Q'+number;q.append(n,document.createTextNode(question));box.append(q);if(quote){const blockquote=document.createElement('blockquote');blockquote.textContent=quote;box.append(blockquote)}const body=document.createElement('div');if(answer)markdown(answer,body,sourceUrl);else body.append(note('waiting for your model… esc cancels'));box.append(body);return box}
function footer(){if(!state)return'';if(state.busy||state.error||flash)return state.status;const pages=state.pages.length;return [state.model,'in memory',pages?pages+' page'+(pages===1?'':'s'):'no pages'].join(' · ')}
function flashStatus(){clearTimeout(flashTimer);flash=1;flashTimer=setTimeout(()=>{flash=0;render()},6000)}
function addOption(select,value,label,selectedValue){const option=document.createElement('option');option.value=value;option.textContent=label;option.selected=value===selectedValue;select.append(option)}
function updateMethods(){const assistant=state?.assistant;const provider=assistant?.providers.find(item=>item.id===$('provider').value);const current=$('authMethod').value;$('authMethod').replaceChildren();for(const method of provider?.methods||[])addOption($('authMethod'),method.type,method.label,current);$('connect').disabled=!provider?.methods.length}
function safeLink(value){try{const url=new URL(value);return url.protocol==='https:'||url.protocol==='http:'?url.href:''}catch{return''}}
function scheduleAuthPoll(auth){clearTimeout(authPoll);if(auth?.status==='running')authPoll=setTimeout(()=>{api('state').then(next=>{state=next;render()}).catch(fail)},500)}
function renderAssistant(){const assistant=state.assistant;$('assistant').hidden=!assistant;if(!assistant)return;
const selectedModel=assistant.selected?.value||'';const model=$('model');model.replaceChildren();if(!assistant.models.length)addOption(model,'','connect a provider to choose a model','');else{addOption(model,'','choose an assistant model',selectedModel);for(const item of assistant.models)addOption(model,item.value,item.label,selectedModel)}model.disabled=!assistant.models.length||state.busy;
const selectedProvider=$('provider').value||assistant.auth?.providerId||assistant.providers[0]?.id||'';$('provider').replaceChildren();for(const provider of assistant.providers)addOption($('provider'),provider.id,provider.name+(provider.configured?' · connected':''),selectedProvider);updateMethods();
$('setupNote').textContent=assistant.error||"Credentials are stored locally in Pi's credential store on this computer.";$('setupNote').className='setup-note'+(assistant.error?' error':'');
const auth=assistant.auth;if(auth)setupOpen=true;$('setup').hidden=!setupOpen;$('providerControls').hidden=!!auth;$('authPanel').hidden=!auth;
if(auth){$('authMessage').textContent=auth.message||'';$('authMessage').className='setup-copy'+(auth.status==='error'?' error':'');const infoLink=auth.links?.[0];const link=safeLink(auth.authUrl||infoLink?.url||'');$('authLink').hidden=!link;$('authLink').href=link;$('authLink').textContent=infoLink?.label||'open provider sign-in';$('deviceCode').hidden=!auth.deviceCode;$('deviceCode').textContent=auth.deviceCode||'';
const prompt=auth.prompt;const form=$('authForm');const previous=$('authValue');const typed=prompt&&form.dataset.promptId===String(prompt.id)?previous?.value||'':'';form.hidden=!prompt;$('promptField').replaceChildren();if(prompt){form.dataset.promptId=String(prompt.id);$('promptLabel').textContent=prompt.message;let field;if(prompt.type==='select'){field=document.createElement('select');for(const option of prompt.options||[])addOption(field,option.id,option.description?option.label+' — '+option.description:option.label,typed)}else{field=document.createElement('input');field.type=prompt.type==='secret'?'password':'text';field.placeholder=prompt.placeholder||'';field.value=typed}field.id='authValue';field.autocomplete='off';$('promptField').append(field)}else delete form.dataset.promptId;$('cancelAuth').hidden=auth.status!=='running';$('dismissAuth').hidden=auth.status==='running';scheduleAuthPoll(auth)}else scheduleAuthPoll();}
function render(){if(!state)return;const current=state.current;
restoreDraft(current?.article.url || '');
const shown=loading?.url||(current?current.article.url:'');
if(shown&&document.activeElement!==$('url'))$('url').value=shown;
const list=$('pages');list.replaceChildren();for(const page of state.pages){const option=document.createElement('option');option.value=page.url;option.label=page.title;list.append(option)}
const body=$('article');body.replaceChildren();
if(current){const h1=document.createElement('h1');h1.textContent=current.article.title;body.append(h1);
if(mode==='summary'){body.append(note('recap · type /article to return to the page','recap'));const recap=document.createElement('div');markdown(current.summary||'*No recap yet. Type /recap to make one.*',recap,current.article.url);body.append(recap)}
else{if(current.article.warning)body.append(note(current.article.warning));const text=document.createElement('div');markdown(withoutTitle(current.article.markdown,current.article.title),text,current.article.url);body.append(text)}}
else body.append(note('paste a url above to begin. nothing is saved; everything lives in this session.'));
const thread=$('thread');thread.replaceChildren();const exchanges=current?current.exchanges:[];
exchanges.forEach((item,index)=>thread.append(exchange(index+1,item.question,item.selection,item.answer,current?.article.url)));
if(pending)thread.append(exchange(exchanges.length+1,pending.question,pending.selection,''));
thread.hidden=!thread.childElementCount;
// A passage attached in an earlier tab is still attached here: show it rather than hide the state.
if(current&&current.selection&&!selected)selected=current.selection;showQuote();renderAssistant();
$('foot').textContent=footer();$('foot').className='foot'+(state.error?' error':'')+(state.busy?' busy':'');dockSpace()}
function showQuote(){$('quoted').hidden=!selected;$('quotedText').textContent='“'+selected+'”'}
function toBottom(){scrollTo({top:document.body.scrollHeight,behavior:'smooth'})}
function grow(){const question=$('question');question.style.height='auto';question.style.height=question.scrollHeight+'px';dockSpace()}
// The bar is fixed, so the column has to reserve its height to keep the last lines readable.
function dockSpace(){document.body.style.paddingBottom=$('dock').offsetHeight+'px'}
async function refresh(){state=await api('state');render();if(!state.current)$('url').focus()}
async function run(action,payload,item){const id=++requestId;busyId=id;pending=item||null;
try{state={...state,busy:true,error:false,status:action==='summary'?'Summarizing your reading and discussion… Esc cancels.':action==='load'?'Loading article… Esc cancels.':'Asking your pi model… Esc cancels.'};render();if(item)toBottom();
const result=await api(action,payload);
if(id===requestId){pending=null;state=result;selected=state.current?.selection||'';render();flashStatus();if(item)toBottom()}
// Loading another page supersedes a request the server still finished; only Escape undoes it.
return id!==cancelled&&!result.error}
catch(error){if(id===requestId){pending=null;fail(error)}return false}
finally{if(busyId===id)busyId=0}}
async function explain(){if(busyId)return;const live=selectionText();if(live){selected=live;showQuote()}if(!selected)return;await run('explain',{selection:selected},{question:'Explain this passage.',selection:selected})}
async function escape(){if(state?.busy||busyId){cancelled=requestId;requestId++;busyId=0;pending=null;loading=null;state=await api('cancel',{});flashStatus();render();return}
if(state?.assistant?.auth?.status==='running'){state=await api('auth/cancel',{});render();return}
if(setupOpen){setupOpen=false;render();return}
if(selected){selected='';$('hint').hidden=true;getSelection()?.removeAllRanges();state=await api('select',{selection:''});render();return}
if(mode==='summary'){mode='article';render()}}
// run('load') restores the selection from the snapshot it returns, so nothing is cleared here.
function loadArticle(url){
  if(url===loading?.url)return;
  const operation={url};
  loading=operation;
  mode='article';
  $('url').blur();
  run('load',{url}).finally(()=>{if(loading===operation){loading=null;render()}});
}
$('loadForm').addEventListener('submit',event=>{
  event.preventDefault();
  const url=$('url').value.trim();
  if(url)loadArticle(url);
});
// Picking a loaded page from the url line's list reopens its discussion immediately.
function reopenSaved(){
  const url=$('url').value.trim();
  if(state?.pages.some(page=>page.url===url)&&url!==state.current?.article.url)loadArticle(url);
}
$('url').addEventListener('input',event=>{if(event.inputType==='insertReplacementText')reopenSaved()});
// Not every engine marks a datalist pick as insertReplacementText; change is the backstop, and
// loadArticle ignores the repeat when the two fire for one pick.
$('url').addEventListener('change',reopenSaved);
$('model').addEventListener('change',()=>{const model=$('model').value;if(!model)return;api('model',{model}).then(next=>{state=next;render()}).catch(fail)});
$('providerToggle').addEventListener('click',()=>{setupOpen=!setupOpen;render()});
$('provider').addEventListener('change',updateMethods);
$('connect').addEventListener('click',()=>{api('auth/start',{provider:$('provider').value,type:$('authMethod').value}).then(next=>{state=next;render()}).catch(fail)});
$('authForm').addEventListener('submit',event=>{event.preventDefault();const prompt=state?.assistant?.auth?.prompt;const field=$('authValue');if(!prompt||!field)return;api('auth/respond',{promptId:prompt.id,value:field.value}).then(next=>{state=next;render()}).catch(fail)});
$('cancelAuth').addEventListener('click',()=>{api('auth/cancel',{}).then(next=>{state=next;render()}).catch(fail)});
$('dismissAuth').addEventListener('click',()=>{api('auth/dismiss',{}).then(next=>{state=next;setupOpen=false;render()}).catch(fail)});
$('askForm').addEventListener('submit',event=>{event.preventDefault();const value=$('question').value.trim();if(!value)return;
const command=value.toLowerCase();
if(command==='/article'||command==='/read'){$('question').value='';saveDraft();grow();mode='article';render();return}
if(command==='/recap'||command==='/summary'||command==='/summarize'){if(busyId)return;$('question').value='';saveDraft();grow();mode='summary';run('summary',{});return}
if(command.charAt(0)==='/'){state={...state,error:true,status:'Unknown command. Type /recap for a recap, /article to return to the page.'};flashStatus();render();return}
if(busyId)return;
const url=draftUrl;
const submitted=saveDraft();
run('ask',{question:value,selection:selected},{question:value,selection:selected}).then(sent=>{if(sent)clearSubmittedDraft(url,submitted)})});
$('question').addEventListener('input',()=>{saveDraft();grow()});
$('question').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();$('askForm').requestSubmit()}});
function articleSelection(){
  const selection=getSelection();
  if(!selection||selection.isCollapsed||!selection.rangeCount)return;
  const range=selection.getRangeAt(0);
  if(!$('article').contains(range.commonAncestorContainer))return;
  return {selection,range};
}
function selectionText(){
  const current=articleSelection();
  return current?current.selection.toString().replace(/\s+/g,' ').trim().slice(0,20000):'';
}
function captureSelection(){
  const text=selectionText();
  if(!text)return;
  selected=text;
  showQuote();
  api('select',{selection:selected}).catch(fail);
}
function placeHint(){
  const hint=$('hint');
  const current=articleSelection();
  const rects=current?.range.getClientRects();
  const rect=rects?.[rects.length-1];
  hint.hidden=!rect;
  if(rect)hint.style.transform='translate('+Math.round(Math.max(4,Math.min(rect.right+10,innerWidth-96)))+'px,'+Math.round(Math.max(4,rect.top))+'px)';
}
$('article').addEventListener('mouseup',captureSelection);$('article').addEventListener('keyup',captureSelection);
// The hint is a button: pressing it must not collapse the selection it is about to explain.
$('hint').addEventListener('mousedown',event=>event.preventDefault());
$('hint').addEventListener('click',()=>{explain().catch(fail)});
document.addEventListener('selectionchange',placeHint);addEventListener('scroll',placeHint,{passive:true});addEventListener('resize',placeHint);addEventListener('resize',dockSpace);
// Apart from the hint, every action is a keystroke: enter explains a selection, esc unwinds, any letter starts a question.
addEventListener('keydown',event=>{const typing=event.target?.matches?.('input,textarea,select,button,a');
if(event.key==='Escape'){event.preventDefault();escape().catch(fail);return}
if(typing||event.metaKey||event.ctrlKey||event.altKey)return;
if(event.key==='Enter'){if(selected){event.preventDefault();explain().catch(fail)}return}
if(event.key.length===1&&event.key!==' '){event.preventDefault();const question=$('question');question.focus();question.value+=event.key;saveDraft();grow()}});
dockSpace();
refresh().catch(fail);
</script>
</body></html>`;
}
