// HTML sanitizer for message bodies — ported from PipelinePulse's audited version.
//
// Email replies arrive as HTML (often full documents with <style>, templates, trackers). We need to
// (a) show the readable text in chat bubbles and (b) render the real email safely in an isolated frame.
// This module provides both: `htmlToText` (clean text) and `sanitizeHtml` (allow-listed safe HTML).
//
// ALLOW-LIST, not deny-list: we keep only known-safe tags/attrs; anything unknown fails closed.

const ALLOWED = new Set([
  'P', 'BR', 'DIV', 'SPAN',
  'STRONG', 'B', 'EM', 'I', 'U', 'S', 'STRIKE', 'DEL',
  'UL', 'OL', 'LI', 'A',
  'H1', 'H2', 'H3', 'H4',
  'BLOCKQUOTE', 'CODE', 'PRE', 'IMG',
  'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH'
]);

// Tags whose CONTENT is dangerous — removed entirely (unwrapping a <script> would paste its source).
const DROP_CONTENT = new Set([
  'SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META',
  'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'NOSCRIPT',
  'SVG', 'MATH', 'TEMPLATE', 'HEAD', 'TITLE'
]);

const ATTRS = {
  A: new Set(['href', 'title']),
  P: new Set(['style']), DIV: new Set(['style']), SPAN: new Set(['style']),
  LI: new Set(['style']), UL: new Set(['style']), OL: new Set(['style']),
  H1: new Set(['style']), H2: new Set(['style']), H3: new Set(['style']), H4: new Set(['style']),
  IMG: new Set(['src', 'alt', 'width', 'height', 'style']),
  TABLE: new Set(['style', 'cellpadding', 'cellspacing', 'border', 'width']),
  THEAD: new Set(['style']), TBODY: new Set(['style']), TR: new Set(['style']),
  TD: new Set(['style', 'colspan', 'rowspan', 'align', 'valign', 'width']),
  TH: new Set(['style', 'colspan', 'rowspan', 'align', 'valign', 'width'])
};

const CSS_PROPS = new Set([
  'color', 'background-color', 'font-weight', 'font-style', 'text-decoration', 'text-align',
  'margin', 'margin-left', 'margin-right', 'margin-top', 'margin-bottom',
  'padding', 'padding-left', 'padding-right', 'padding-top', 'padding-bottom',
  'font-size', 'font-family', 'line-height',
  'border', 'border-top', 'border-bottom', 'border-left', 'border-right',
  'border-color', 'border-width', 'border-style', 'border-collapse', 'border-spacing',
  'width', 'max-width', 'height', 'vertical-align', 'display'
]);

function safeStyle(value) {
  const out = [];
  for (const decl of String(value).split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const val = decl.slice(i + 1).trim();
    if (!CSS_PROPS.has(prop)) continue;
    if (prop === 'display' && /none/i.test(val)) continue; // a whole message saved invisible is bad
    if (/url\s*\(|expression\s*\(|\\|@import/i.test(val)) continue; // no url()/expression()/escapes
    out.push(`${prop}: ${val}`);
  }
  return out.join('; ');
}

function safeImgSrc(value) {
  const v = String(value).trim();
  if (/^https:\/\//i.test(v)) return v;
  if (/^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(v)) return v;
  return '';
}

function safeHref(value) {
  const v = String(value).trim();
  const bare = v.replace(/[\u0000- ]/g, '').toLowerCase(); // "java\tscript:" → javascript:
  if (/^(https?:|mailto:|tel:)/.test(bare)) return v;
  if (/^[/#?]/.test(v)) return v; // relative links are fine
  return null;
}

/** Sanitize an HTML fragment for safe rendering. Returns a string; never throws (bad input → ''). */
export function sanitizeHtml(input) {
  if (typeof input !== 'string' || input === '') return '';
  if (typeof window === 'undefined' || typeof window.DOMParser === 'undefined') {
    return input.replace(/<[^>]*>/g, ''); // fail closed when we can't parse
  }
  let doc;
  try { doc = new window.DOMParser().parseFromString(`<body>${input}</body>`, 'text/html'); }
  catch { return ''; }
  const body = doc.body;
  if (!body) return '';

  const walk = (node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) continue;                      // text — always fine
      if (child.nodeType !== 1) { child.remove(); continue; }  // comments / CDATA
      const tag = child.tagName.toUpperCase();
      if (DROP_CONTENT.has(tag)) { child.remove(); continue; }
      if (!ALLOWED.has(tag)) {                                 // unknown tag → unwrap (keep text)
        walk(child);
        while (child.firstChild) node.insertBefore(child.firstChild, child);
        child.remove();
        continue;
      }
      const permitted = ATTRS[tag] || new Set();
      let dropped = false;
      for (const attr of Array.from(child.attributes)) {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on') || !permitted.has(name)) { child.removeAttribute(attr.name); continue; }
        if (name === 'style') { const s = safeStyle(attr.value); if (s) child.setAttribute('style', s); else child.removeAttribute('style'); }
        if (name === 'href') { const s = safeHref(attr.value); if (s) child.setAttribute('href', s); else child.removeAttribute('href'); }
        if (name === 'src') { const s = safeImgSrc(attr.value); if (s) child.setAttribute('src', s); else { child.remove(); dropped = true; break; } }
      }
      if (dropped) continue;
      if (tag === 'A' && child.hasAttribute('href')) {
        child.setAttribute('target', '_blank');
        child.setAttribute('rel', 'noopener noreferrer nofollow');
      }
      walk(child);
    }
  };
  walk(body);
  return body.innerHTML;
}

/** Plain, readable text from HTML — for chat bubbles and previews. Block tags become line breaks. */
export function htmlToText(input) {
  if (typeof input !== 'string' || input === '') return '';
  if (!/<[a-z!][\s\S]*>/i.test(input)) return input.trim(); // already plain text
  if (typeof window === 'undefined' || typeof window.DOMParser === 'undefined') {
    return input.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  try {
    const doc = new window.DOMParser().parseFromString(`<body>${input}</body>`, 'text/html');
    doc.body.querySelectorAll('style, script, head, title').forEach((n) => n.remove());
    doc.body.querySelectorAll('br').forEach((n) => n.replaceWith('\n'));
    doc.body.querySelectorAll('p, div, tr, li, h1, h2, h3, h4, blockquote').forEach((n) => n.append('\n'));
    return (doc.body.textContent || '').replace(/ /g, ' ')
      .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  } catch {
    return input.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
}

/** Does this HTML contain any real text? "<p></p>" is empty. */
export function isHtmlEmpty(input) {
  return htmlToText(input) === '';
}

/** Heuristic: does this body look like HTML (vs plain text)? */
export function looksLikeHtml(input) {
  return typeof input === 'string' && /<[a-z!][\s\S]*>/i.test(input);
}
