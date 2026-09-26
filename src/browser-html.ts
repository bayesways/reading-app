import { browserUrl } from "./browser-url.ts";

// Renders the reader-view HTML Readability extracted, the way Firefox's Reader View
// shows it: the page's own structure, figures and images, in the reader's styles.
// It shares the browser's URL policy with the Markdown renderer.
const renderer = String.raw`
const htmlTags = new Set(['p','br','hr','h1','h2','h3','h4','h5','h6','blockquote','pre','ul','ol','li','dl','dt','dd',
  'div','figure','figcaption','table','caption','thead','tbody','tfoot','tr','th','td',
  'a','strong','b','em','i','u','s','del','ins','mark','small','sub','sup','code','kbd','samp','var','abbr','cite','q']);
// Sectioning keeps its line break as a plain div. Other unknown elements are unwrapped.
const htmlBlocks = new Set(['section','article','aside','header','footer','main','nav','address','center','details',
  'summary','hgroup']);
// Active, embedded or invisible content, and the source text of rendered formulas, go with everything inside.
const htmlDropped = new Set(['script','style','template','noscript','iframe','frame','frameset','object','embed',
  'applet','portal','svg','canvas','video','audio','source','track','map','area','form','input','button','select',
  'option','textarea','dialog','head','title','meta','link','base','annotation','annotation-xml']);

function imageUrl(value, sourceUrl) {
  if (!value) return null;
  if (/^data:image\/(?:png|gif|jpeg|webp|avif|svg\+xml)[;,]/i.test(value)) return value;
  return safeUrl(value, sourceUrl);
}

// srcset candidates are a URL (which may itself contain commas) and an optional width or density.
// One unsafe candidate drops the attribute; src is still there to fall back on.
function imageSrcset(value, sourceUrl) {
  const candidates = [];
  let rest = value || '';
  for (let match = rest.match(/^[\s,]*(\S+)/); match; match = rest.match(/^[\s,]*(\S+)/)) {
    rest = rest.slice(match[0].length);
    let url = match[1];
    let descriptor = '';
    if (url.endsWith(',')) url = url.replace(/,+$/, '');
    else {
      const tail = rest.match(/^([^,]*),?/);
      descriptor = tail[1].trim();
      rest = rest.slice(tail[0].length);
    }
    const safe = imageUrl(url, sourceUrl);
    if (!safe || /\s|,$/.test(safe) || !/^(?:\d+w|\d+(?:\.\d+)?x)?$/.test(descriptor)) return '';
    candidates.push(descriptor ? safe + ' ' + descriptor : safe);
  }
  return candidates.join(', ');
}

function dimension(value) {
  return /^\s*\d{1,5}\s*$/.test(value || '') ? Number(value) : null;
}

function firstImageUrl(source, names, sourceUrl) {
  for (const name of names) {
    const value = imageUrl(source.getAttribute(name), sourceUrl);
    if (value) return value;
  }
  return null;
}

function firstImageSrcset(source, names, sourceUrl) {
  for (const name of names) {
    const value = imageSrcset(source.getAttribute(name), sourceUrl);
    if (value) return value;
  }
  return '';
}

function htmlImage(source, parent, sourceUrl) {
  const width = dimension(source.getAttribute('width'));
  const height = dimension(source.getAttribute('height'));
  const alt = (source.getAttribute('alt') || '').replace(/\s+/g, ' ').trim();
  // Readability repairs many lazy loaders, but it deliberately recognizes only
  // image-looking filenames. CDNs often use extensionless query URLs, so keep the
  // common lazy attributes as a browser-side fallback.
  const lazySrc = firstImageUrl(source,
    ['data-src', 'data-lazy-src', 'data-original', 'data-cfsrc', 'data-flickity-lazyload'], sourceUrl);
  const lazySrcset = firstImageSrcset(source, ['data-srcset', 'data-lazy-srcset'], sourceUrl);
  const src = lazySrc || imageUrl(source.getAttribute('src'), sourceUrl);
  const srcset = lazySrcset || imageSrcset(source.getAttribute('srcset'), sourceUrl);
  // A pixel-sized image is a tracker or spacer. Tiny declared dimensions on a
  // lazy placeholder do not describe the replacement image.
  const tiny = width !== null && height !== null && width <= 2 && height <= 2;
  if (tiny && !lazySrc && !lazySrcset) return;
  if (!src && !srcset) {
    // Local files, and anything else the page cannot load, keep their description.
    parent.append(document.createTextNode(alt ? '[Image: ' + alt + ']' : '[Image]'));
    return;
  }
  const img = document.createElement('img');
  img.setAttribute('loading', 'lazy');
  img.setAttribute('decoding', 'async');
  img.setAttribute('referrerpolicy', 'no-referrer');
  if (srcset) img.setAttribute('srcset', srcset);
  // Width candidates are chosen for the reading column, not the whole window.
  if (/ \d+w(?:,|$)/.test(srcset)) img.setAttribute('sizes', '(max-width: 720px) 100vw, 680px');
  if (src) img.setAttribute('src', src);
  img.setAttribute('alt', alt);
  const title = source.getAttribute('title');
  if (title) img.setAttribute('title', title);
  // Declared dimensions reserve the space, so the text does not jump as images arrive.
  if (width && !tiny) img.setAttribute('width', String(width));
  if (height && !tiny) img.setAttribute('height', String(height));
  // Formula images (Wikipedia's math, for one) are black glyphs on nothing: invisible on a dark page.
  if (/\\[a-z]{2,}/i.test(alt)) img.className = 'formula';
  parent.append(img);
}

function htmlElement(source, tag, sourceUrl) {
  if (tag === 'a') {
    const href = safeUrl(source.getAttribute('href'), sourceUrl);
    if (!href) return document.createElement('span');
    const link = document.createElement('a');
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const title = source.getAttribute('title');
    if (title) link.title = title;
    return link;
  }
  // The page already owns h1. Preserve h2-h6 rather than shifting all headings.
  const node = document.createElement(tag === 'h1' ? 'h2' : tag);
  if (tag === 'ol') {
    const start = source.getAttribute('start');
    if (start && /^\d{1,9}$/.test(start)) node.setAttribute('start', start);
  }
  if (tag === 'td' || tag === 'th') {
    for (const name of ['colspan', 'rowspan']) {
      const span = source.getAttribute(name);
      if (span && /^\d{1,3}$/.test(span)) node.setAttribute(name, span);
    }
  }
  if (tag === 'abbr') {
    const title = source.getAttribute('title');
    if (title) node.title = title;
  }
  return node;
}

// Rebuilds the parsed tree with DOM APIs only: no markup is ever assigned, only allowed
// tags are created, and the only attributes are the ones set above. No id survives either,
// so the article cannot shadow the page's own elements.
function htmlNodes(source, parent, sourceUrl) {
  for (const child of source.childNodes) {
    if (child.nodeType === 3) {
      parent.append(document.createTextNode(child.data));
      continue;
    }
    if (child.nodeType !== 1) continue;
    const tag = child.localName;
    if (htmlDropped.has(tag)) continue;
    if (tag === 'img') { htmlImage(child, parent, sourceUrl); continue; }
    if (!htmlTags.has(tag) && !htmlBlocks.has(tag)) { htmlNodes(child, parent, sourceUrl); continue; }
    const node = htmlBlocks.has(tag) ? document.createElement('div') : htmlElement(child, tag, sourceUrl);
    parent.append(node);
    htmlNodes(child, node, sourceUrl);
  }
}

function readerHtml(html, root, sourceUrl) {
  root.replaceChildren();
  // A parsed document is inert: its scripts never run and its images never load.
  const parsed = new DOMParser().parseFromString(html || '', 'text/html');
  htmlNodes(parsed.body, root, sourceUrl);
}
`;

export function browserHtmlRenderer(): string {
  return renderer;
}

/** A standalone HTML renderer, including the URL policy it depends on. */
export function browserHtml(): string {
  return browserUrl() + browserHtmlRenderer();
}
