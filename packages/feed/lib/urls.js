const htmlparser2 = require('htmlparser2');
const DomUtils = htmlparser2.DomUtils;

const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const URL_ATTRS = Object.assign(Object.create(null), {
  a: ['href'],
  img: ['src', 'poster'],
  source: ['src', 'poster'],
  video: ['src', 'poster'],
  audio: ['src', 'poster'],
  iframe: ['src'],
});
const SRCSET_TAGS = Object.assign(Object.create(null), {
  img: true,
  source: true,
});

// String-level convenience used by focused tests and callers inside this
// package. Article extraction uses rewriteRelativeUrls directly so the source
// document is parsed and serialized only once.
function resolveRelativeUrls(html, baseUrl) {
  const dom = htmlparser2.parseDocument(html);
  rewriteRelativeUrls(dom, baseUrl);
  return DomUtils.getOuterHTML(dom.children, {encodeEntities: 'utf8'});
}

// Mutate URL-bearing attributes in one parsed subtree. Moving article markup
// into a feed removes its document base, so every fetchable relative reference
// is made absolute while fragment-only, authority-relative, and explicit-scheme
// references retain their authored semantics.
function rewriteRelativeUrls(root, baseUrl) {
  const pending = Array.isArray(root) ? root.slice() : [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node.attribs) rewriteElementUrls(node, baseUrl);
    if (node.children) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        pending.push(node.children[i]);
      }
    }
  }
}

function rewriteElementUrls(element, baseUrl) {
  const names = URL_ATTRS[element.name];
  if (names) {
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const value = element.attribs[name];
      if (shouldResolve(value)) {
        element.attribs[name] = resolveAgainst(value, baseUrl);
      }
    }
  }
  if (SRCSET_TAGS[element.name] && element.attribs.srcset) {
    element.attribs.srcset = resolveSrcset(element.attribs.srcset, baseUrl);
  }
}

function shouldResolve(value) {
  if (typeof value !== 'string') return false;
  const trimmed = trimAsciiWhitespace(value);
  return (
    trimmed !== '' &&
    trimmed[0] !== '#' &&
    !trimmed.startsWith('//') &&
    !URL_SCHEME.test(trimmed)
  );
}

function trimAsciiWhitespace(value) {
  return value.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '');
}

function resolveAgainst(value, baseUrl) {
  try {
    return new URL(value, baseUrl).href;
  } catch (error) {
    return value;
  }
}

// Use the first authored <base href> when it can itself support relative URL
// resolution. Invalid and non-hierarchical bases follow the HTML fallback and
// leave the article URL as the effective document base.
function resolveDocumentBase(baseHref, articleUrl) {
  if (!baseHref) return articleUrl;
  try {
    const baseUrl = new URL(baseHref, articleUrl);
    new URL('.', baseUrl);
    return baseUrl.href;
  } catch (error) {
    return articleUrl;
  }
}

// Follow srcset's URL-token and descriptor-state boundaries rather than treating
// every comma as a separator. URL tokens may contain commas (notably data URLs),
// while a descriptor-list comma separates candidates unless it is parenthesized.
// Preserve every byte outside a relative URL token.
function resolveSrcset(value, baseUrl) {
  const output = [];
  let position = 0;

  while (position < value.length) {
    const prefixStart = position;
    while (
      position < value.length &&
      (isAsciiWhitespace(value[position]) || value[position] === ',')
    ) {
      position++;
    }
    output.push(value.slice(prefixStart, position));
    if (position === value.length) break;

    const urlStart = position;
    while (position < value.length && !isAsciiWhitespace(value[position])) {
      position++;
    }

    // A trailing comma belongs to candidate separation, not the URL token.
    let urlEnd = position;
    while (urlEnd > urlStart && value[urlEnd - 1] === ',') urlEnd--;
    const urlToken = value.slice(urlStart, urlEnd);
    output.push(
      shouldResolve(urlToken) ? resolveAgainst(urlToken, baseUrl) : urlToken,
      value.slice(urlEnd, position),
    );

    // Trailing URL commas already ended this candidate. Otherwise consume the
    // descriptor list through its first non-parenthesized comma.
    if (urlEnd !== position) continue;
    const descriptorStart = position;
    let parentheses = 0;
    while (position < value.length) {
      const character = value[position++];
      if (character === '(') {
        parentheses++;
      } else if (character === ')' && parentheses > 0) {
        parentheses--;
      } else if (character === ',' && parentheses === 0) {
        break;
      }
    }
    output.push(value.slice(descriptorStart, position));
  }

  return output.join('');
}

function isAsciiWhitespace(character) {
  return (
    character === '\t' ||
    character === '\n' ||
    character === '\f' ||
    character === '\r' ||
    character === ' '
  );
}

exports.resolveDocumentBase = resolveDocumentBase;
exports.resolveRelativeUrls = resolveRelativeUrls;
exports.rewriteRelativeUrls = rewriteRelativeUrls;
