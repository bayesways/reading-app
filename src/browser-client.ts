import { browserHtml } from "./browser-html.ts";
import { browserMarkdown } from "./browser-markdown.ts";
import { browserUrl } from "./browser-url.ts";

const client = String.raw`
const base=location.pathname.endsWith('/')?location.pathname:location.pathname+'/';
const $=id=>document.getElementById(id); let state; let selected=''; let mode='article'; let requestId=0; let pending=null; let flash=0; let flashTimer=0; let loading=null;
// This tab's own in-flight request, and the one Escape cancelled. A snapshot can
// arrive busy because another tab is asking, and that flag never clears on its own.
let busyId=0; let cancelled=0;
// What the article pane shows. Rebuilding it reloads its images and drops a live selection,
// so it is redrawn only when this changes.
let shownView=null;
function caretPoint(control,position){
  const style=getComputedStyle(control);const mirror=document.createElement('div');const marker=document.createElement('span');
  mirror.setAttribute('aria-hidden','true');
  Object.assign(mirror.style,{position:'fixed',visibility:'hidden',pointerEvents:'none',left:'-10000px',top:'0',margin:'0',padding:style.padding,border:style.border,boxSizing:style.boxSizing,font:style.font,letterSpacing:style.letterSpacing,wordSpacing:style.wordSpacing,textTransform:style.textTransform,tabSize:style.tabSize,whiteSpace:control.tagName==='TEXTAREA'?'pre-wrap':'pre',overflowWrap:'break-word',width:control.tagName==='TEXTAREA'?control.clientWidth+'px':'max-content'});
  mirror.textContent=control.value.slice(0,position);marker.textContent='\u200b';mirror.append(marker);document.body.append(mirror);
  const point={left:marker.offsetLeft-control.scrollLeft,top:marker.offsetTop-control.scrollTop,lineHeight:parseFloat(style.lineHeight)||control.clientHeight||24};mirror.remove();return point;
}
function placeFieldCursor(control){
  const field=control.parentElement;const cursor=control.nextElementSibling;
  const active=document.activeElement===control;field.classList.toggle('cursor-active',active);
  if((!active&&control!==$('question'))||control.selectionStart===null)return;
  const point=caretPoint(control,active?control.selectionStart:control.value.length);const maxLeft=Math.max(0,control.clientWidth-cursor.offsetWidth);const maxTop=Math.max(0,control.clientHeight-cursor.offsetHeight);
  cursor.style.left=Math.max(0,Math.min(maxLeft,point.left))+'px';cursor.style.top=Math.max(0,Math.min(maxTop,point.top+(point.lineHeight-cursor.offsetHeight)/2))+'px';
}
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
// A failure before the first snapshot still leaves a well-formed state for render to show it on.
function fail(error){state={pages:[],...state,busy:false,error:true,status:error.message};flashStatus();render()}
// The title is rendered as the page's own heading; drop it from the body to avoid a duplicate.
function withoutTitle(text,title){const m=(text||'').match(/^#\s+(.+)\n?/);return m&&m[1].trim().toLowerCase()===(title||'').trim().toLowerCase()?text.slice(m[0].length):text}
function note(text,extra){const p=document.createElement('p');p.className='label'+(extra?' '+extra:'');p.textContent=text;return p}
function exchange(number,question,quote,answer,sourceUrl){const box=document.createElement('section');box.className='ex'+(answer?'':' waiting');const q=document.createElement('p');q.className='q';const n=document.createElement('span');n.className='n';n.textContent='Q'+number;q.append(n,document.createTextNode(question));box.append(q);if(quote){const blockquote=document.createElement('blockquote');blockquote.textContent=quote;box.append(blockquote)}const body=document.createElement('div');if(answer){body.className='a';markdown(answer,body,sourceUrl)}else body.append(note('waiting for your model… esc cancels'));box.append(body);return box}
function footer(){if(!state)return'';if(state.busy||state.error||flash)return state.status;return state.model}
function flashStatus(){clearTimeout(flashTimer);flash=1;flashTimer=setTimeout(()=>{flash=0;render()},6000)}
function render(){if(!state)return;const current=state.current;$('dock').hidden=!current;
restoreDraft(current?.article.url || '');
const shown=loading?.url||(current?current.article.url:'');
if(shown&&document.activeElement!==$('url'))$('url').value=shown;
const list=$('pages');list.replaceChildren();for(const page of state.pages){const option=document.createElement('option');option.value=page.url;option.label=page.title;list.append(option)}
const view=current
  ? JSON.stringify([mode,current.article.url,current.article.title,current.article.warning,current.article.content.format,mode==='summary'?current.summary:current.article.content.text])
  : JSON.stringify([state.busy||state.error||flash?state.status:'']);
if(view!==shownView){shownView=view;const body=$('article');body.replaceChildren();
if(current){const h1=document.createElement('h1');h1.textContent=current.article.title;body.append(h1);
if(mode==='summary'){body.append(note('recap · type /article to return to the page','recap'));const recap=document.createElement('div');markdown(current.summary||'*No recap yet. Type /recap to make one.*',recap,current.article.url);body.append(recap)}
else{if(current.article.warning)body.append(note(current.article.warning));const text=document.createElement('div');const content=current.article.content;
if(content.format==='html')readerHtml(content.text,text,current.article.url);else markdown(withoutTitle(content.text,current.article.title),text,current.article.url);body.append(text)}}
else if(state.busy||state.error||flash)body.append(note(state.status))}
const thread=$('thread');thread.replaceChildren();const exchanges=current?current.exchanges:[];
exchanges.forEach((item,index)=>thread.append(exchange(index+1,item.question,item.selection,item.answer,current?.article.url)));
if(pending)thread.append(exchange(exchanges.length+1,pending.question,pending.selection,''));
thread.hidden=!thread.childElementCount;
// A passage attached in an earlier tab is still attached here: show it rather than hide the state.
if(current&&current.selection&&!selected)selected=current.selection;showQuote();
$('foot').textContent=footer();$('foot').className='foot'+(state.error?' error':'')+(state.busy?' busy':'');dockSpace()}
function showQuote(){$('quoted').hidden=!selected;$('quotedText').textContent='“'+selected+'”'}
function toBottom(){scrollTo({top:document.body.scrollHeight,behavior:'smooth'})}
function grow(){const question=$('question');question.style.height='auto';question.style.height=question.scrollHeight+'px';dockSpace();placeFieldCursor(question)}
// The bar is fixed, so the column has to reserve its height to keep the last lines readable.
function dockSpace(){document.body.style.paddingBottom=($('dock').hidden?0:$('dock').offsetHeight)+'px'}
// Focus stays on the page when there is an article, so space and the arrow keys scroll it;
// any letter still starts a question.
async function refresh(){state=await api('state');render();if(!state.current)$('url').focus()}
async function run(action,payload,item){const id=++requestId;busyId=id;pending=item||null;
try{state={...state,busy:true,error:false,status:action==='summary'?'Summarizing your reading and discussion… Esc cancels.':action==='load'?'Loading source… Esc cancels.':'Asking your pi model… Esc cancels.'};render();if(item)toBottom();
const result=await api(action,payload);
if(id===requestId){pending=null;state=result;selected=state.current?.selection||'';render();flashStatus();if(item)toBottom()}
// Loading another page supersedes a request the server still finished; only Escape undoes it.
return id!==cancelled&&!result.error}
catch(error){if(id===requestId){pending=null;fail(error)}return false}
finally{if(busyId===id)busyId=0}}
async function explain(){if(busyId)return;holdSelection();if(!selected)return;await run('explain',{selection:selected},{question:'Explain this passage.',selection:selected})}
async function escape(){if(state?.busy||busyId){cancelled=requestId;requestId++;busyId=0;pending=null;loading=null;state=await api('cancel',{});flashStatus();render();return}
if(selected){const quote=selected;selected='';$('hint').hidden=true;getSelection()?.removeAllRanges();state=await api('select',{selection:''});render();revealQuote(quote);return}
if(mode==='summary'){mode='article';render()}}
// run('load') restores the selection from the snapshot it returns, so nothing is cleared here.
function loadArticle(url){
  if(url===loading?.url)return;
  const operation={url};
  loading=operation;
  mode='article';
  $('url').blur();
  // Only a landing page that is still waiting on this load takes the url line back; a newer load owns focus.
  run('load',{url}).then(loaded=>{if(!loaded&&!state?.current&&(!loading||loading===operation))$('url').focus()}).finally(()=>{if(loading===operation){loading=null;render()}});
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
$('url').addEventListener('input',event=>{if(event.inputType==='insertReplacementText')reopenSaved();placeFieldCursor($('url'))});
// Not every engine marks a datalist pick as insertReplacementText; change is the backstop, and
// loadArticle ignores the repeat when the two fire for one pick.
$('url').addEventListener('change',reopenSaved);
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
for(const control of [$('url'),$('question')]){for(const event of ['focus','click','keyup','select','scroll'])control.addEventListener(event,()=>placeFieldCursor(control));control.addEventListener('blur',()=>placeFieldCursor(control))}
// Answers read like the source: a passage within one answer can be explained or asked about too.
function readable(node){
  if($('article').contains(node))return true;
  const element=node.nodeType===1?node:node.parentElement;
  return !!element?.closest('#thread .a');
}
function articleSelection(){
  const selection=getSelection();
  if(!selection||selection.isCollapsed||!selection.rangeCount)return;
  const range=selection.getRangeAt(0);
  if(!readable(range.commonAncestorContainer))return;
  return {selection,range};
}
function selectionText(){
  const current=articleSelection();
  return current?current.selection.toString().replace(/\s+/g,' ').trim().slice(0,20000):'';
}
// Attaches the live selection as the quote, noting where it starts so Escape can return to it.
function holdSelection(){
  const current=articleSelection();
  const text=selectionText();
  if(!text)return false;
  selected=text;
  quoteAt=quoteOffset(current.range);
  showQuote();
  return true;
}
function captureSelection(){
  if(holdSelection())api('select',{selection:selected}).catch(fail);
}
// The article is rebuilt whenever it changes, so a quote is found again by its text rather than
// a held Range. Whitespace is dropped on both sides: a selection's line breaks between
// paragraphs are not in the text nodes.
let quoteAt=-1;
function squash(text){return text.replace(/\s+/g,'')}
function quoteOffset(range){
  const before=document.createRange();
  before.setStart($('article'),0);
  before.setEnd(range.startContainer,range.startOffset);
  return squash(before.toString()).length;
}
// After Escape clears a quote, scroll back to its passage unless it is already in view. Where
// it was selected wins over an earlier repeat of the same words; a quote restored from another
// tab has no such position and falls back to the first match.
function revealQuote(quote){
  const needle=squash(quote);
  if(mode!=='article'||!needle)return;
  const walker=document.createTreeWalker($('article'),NodeFilter.SHOW_TEXT);
  const nodes=[];
  let flat='';
  for(let node=walker.nextNode();node;node=walker.nextNode()){
    const text=squash(node.data);
    nodes.push({node,start:flat.length,length:text.length});
    flat+=text;
  }
  const at=quoteAt>=0&&flat.startsWith(needle,quoteAt)?quoteAt:flat.indexOf(needle);
  const hit=at<0?null:nodes.find(item=>item.start<=at&&at<item.start+item.length);
  if(!hit)return;
  let offset=0;
  for(let seen=0;;offset++){
    if(/\s/.test(hit.node.data[offset]))continue;
    if(seen===at-hit.start)break;
    seen++;
  }
  const range=document.createRange();
  range.setStart(hit.node,offset);
  range.setEnd(hit.node,offset+1);
  const rect=range.getBoundingClientRect();
  if(rect.top>=0&&rect.bottom<=innerHeight-$('dock').offsetHeight)return;
  scrollTo({top:scrollY+rect.top-innerHeight/3,behavior:'smooth'});
}
function placeHint(){
  const hint=$('hint');
  const current=articleSelection();
  const rects=current?.range.getClientRects();
  const rect=rects?.[rects.length-1];
  hint.hidden=!rect;
  if(rect)hint.style.transform='translate('+Math.round(Math.max(4,Math.min(rect.right+10,innerWidth-96)))+'px,'+Math.round(Math.max(4,rect.top))+'px)';
}
for(const pane of [$('article'),$('thread')]){pane.addEventListener('mouseup',captureSelection);pane.addEventListener('keyup',captureSelection)}
// The hint is a button: pressing it must not collapse the selection it is about to explain.
$('hint').addEventListener('mousedown',event=>event.preventDefault());
$('hint').addEventListener('click',()=>{explain().catch(fail)});
document.addEventListener('selectionchange',()=>{placeHint();const active=document.activeElement;if(active===$('url')||active===$('question'))placeFieldCursor(active)});addEventListener('scroll',placeHint,{passive:true});addEventListener('resize',()=>{placeHint();dockSpace();placeFieldCursor($('url'));placeFieldCursor($('question'))});
// Apart from the hint, every action is a keystroke: enter explains a selection, esc unwinds, any letter starts a question.
addEventListener('keydown',event=>{const typing=event.target===$('question')||event.target===$('url');
if(event.key==='Escape'){event.preventDefault();escape().catch(fail);return}
if(typing||event.metaKey||event.ctrlKey||event.altKey)return;
if(event.key==='Enter'){if(selected){event.preventDefault();explain().catch(fail)}return}
if(event.key.length===1&&event.key!==' '){event.preventDefault();if(!state?.current){const url=$('url');url.focus();url.value+=event.key;placeFieldCursor(url);return}const question=$('question');question.focus();question.value+=event.key;saveDraft();grow()}});
dockSpace();
refresh().catch(fail);
`;

export function browserClient(): string {
  return browserUrl() + browserMarkdown() + browserHtml() + client;
}
