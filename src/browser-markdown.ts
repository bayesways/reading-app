import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// Embed the installed browser build so the reader remains self-contained and
// works under its nonce-only CSP without fetching scripts from a CDN.
const require = createRequire(import.meta.url);
const parser = readFileSync(require.resolve("markdown-it/browser"), "utf8")
  .replace(/<\/script/gi, "<\\/script");

export const browserMarkdown = parser + String.raw`
const markdownParser = window.markdownit({ html: false, linkify: false, typographer: false });
const markdownTags = new Set(['p','blockquote','ul','ol','li','h1','h2','h3','h4','h5','h6',
  'strong','em','s','a','table','thead','tbody','tr','th','td']);

function markdownUrl(value, sourceUrl) {
  try {
    const url = new URL(value, sourceUrl);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

// Consume parser tokens through DOM APIs only. Raw HTML is plain text, images
// keep their descriptions, and only explicitly allowed tags/attributes exist.
function markdownTokens(tokens, root, sourceUrl) {
  let parent = root;
  const parents = [];
  for (const token of tokens) {
    if (token.nesting === -1) {
      parent = parents.pop() || root;
      continue;
    }
    if (token.nesting === 1) {
      parents.push(parent);
      if (token.hidden || !markdownTags.has(token.tag)) continue;
      // The page already owns h1. Preserve h2-h6 rather than shifting all headings.
      let tag = token.tag === 'h1' ? 'h2' : token.tag;
      const href = tag === 'a' ? markdownUrl(token.attrGet('href'), sourceUrl) : null;
      if (tag === 'a' && !href) tag = 'span';
      const node = document.createElement(tag);
      if (href) {
        node.href = href;
        node.target = '_blank';
        node.rel = 'noopener noreferrer';
        const title = token.attrGet('title');
        if (title) node.title = title;
      }
      if (tag === 'ol') {
        const start = token.attrGet('start');
        if (start && /^\d+$/.test(start)) node.setAttribute('start', start);
      }
      if (tag === 'th' || tag === 'td') {
        const align = token.attrGet('style')?.match(/^text-align:(left|center|right)$/)?.[1];
        if (align) node.style.textAlign = align;
      }
      parent.append(node);
      parent = node;
      continue;
    }
    if (token.type === 'inline') {
      markdownTokens(token.children || [], parent, sourceUrl);
    } else if (token.type === 'fence' || token.type === 'code_block') {
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = token.content;
      pre.append(code);
      parent.append(pre);
    } else if (token.type === 'code_inline') {
      const code = document.createElement('code');
      code.textContent = token.content;
      parent.append(code);
    } else if (token.type === 'hardbreak' || token.type === 'hr') {
      parent.append(document.createElement(token.type === 'hr' ? 'hr' : 'br'));
    } else if (token.type === 'softbreak') {
      parent.append(document.createTextNode('\n'));
    } else if (token.type === 'image') {
      const description = document.createDocumentFragment();
      markdownTokens(token.children || [], description, sourceUrl);
      parent.append(document.createTextNode(description.textContent ? '[Image: ' + description.textContent + ']' : ''));
    } else {
      parent.append(document.createTextNode(token.content || ''));
    }
  }
}

function markdown(text, root, sourceUrl) {
  root.replaceChildren();
  markdownTokens(markdownParser.parse(text || '', {}), root, sourceUrl);
}
`;
