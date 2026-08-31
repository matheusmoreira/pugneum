const fs = require('fs');
const htmlparser2 = require('htmlparser2');
const DomUtils = htmlparser2.DomUtils;
const {parseAuthoredDate} = require('./date');
const {resolveDocumentBase, rewriteRelativeUrls} = require('./urls');

exports.indexPage = function indexPage(indexPath, readFile) {
  const html = (readFile || fs.readFileSync)(indexPath, 'utf8');
  const dom = htmlparser2.parseDocument(html);
  const metaMap = extractMetaMap(dom);

  const url = extractBaseHref(dom);
  const title = extractTitle(dom);
  const description = metaValue(metaMap, 'description');
  const author = metaValue(metaMap, 'author');
  const language = extractLanguage(dom);
  const entries = extractEntries(dom);

  return {url, title, description, author, language, entries};
};

exports.articlePage = function articlePage(
  filePath,
  tagName,
  readFile,
  articleUrl,
) {
  const html = (readFile || fs.readFileSync)(filePath, 'utf8');
  const dom = htmlparser2.parseDocument(html);
  const metaMap = extractMetaMap(dom);

  const title = extractTitle(dom);
  const description = metaValue(metaMap, 'description');
  const author = metaValue(metaMap, 'author');
  const keywords = extractKeywords(metaMap);
  const contentBase = articleUrl
    ? resolveDocumentBase(extractBaseHref(dom), articleUrl)
    : null;
  const content = extractContent(dom, tagName, contentBase);

  return {title, description, author, keywords, content};
};

// The first base element carrying href establishes the document base; a prior
// target-only base does not suppress it.
function extractBaseHref(dom) {
  const base = DomUtils.findOne(
    (element) => element.name === 'base' && element.attribs.href !== undefined,
    dom,
  );
  return base ? base.attribs.href : null;
}

// Titles are singletons in <head>, so stop at the first match (limit=1) instead
// of walking the whole document — extractTitle runs once per article.
function extractTitle(dom) {
  const titles = DomUtils.getElementsByTagName('title', dom, true, 1);
  if (titles.length > 0) {
    return DomUtils.textContent(titles[0]);
  }
  return null;
}

// Collect every <meta name=...> content once per page into an ASCII-folded
// name->content map, so description/author/keywords are read from a single
// document walk instead of one full scan each. A null-prototype map keeps a
// <meta name="__proto__"> from colliding with inherited object keys.
function extractMetaMap(dom) {
  const metas = DomUtils.getElementsByTagName('meta', dom);
  const map = Object.create(null);
  for (let i = 0; i < metas.length; i++) {
    const rawName = metas[i].attribs.name;
    const name = rawName && asciiLowerCase(rawName);
    if (name && map[name] === undefined) {
      map[name] = metas[i].attribs.content || null;
    }
  }
  return map;
}

function metaValue(metaMap, name) {
  return metaMap[name] !== undefined ? metaMap[name] : null;
}

function asciiLowerCase(value) {
  return value.replace(/[A-Z]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) + 32),
  );
}

function extractLanguage(dom) {
  const htmlTags = DomUtils.getElementsByTagName('html', dom, true, 1);
  if (htmlTags.length > 0 && htmlTags[0].attribs.lang) {
    return htmlTags[0].attribs.lang;
  }
  return null;
}

function extractEntries(dom) {
  const entries = [];
  const elements = DomUtils.findAll(
    (el) => el.attribs && el.attribs['data-published-at'],
    dom,
  );

  // Skip elements that are descendants of other matched elements. An element is
  // top-level iff none of its ancestors is itself a match, so walk each match's
  // parent chain once against a Set of matches — O(N*depth) instead of the O(N^2)
  // pairwise filter+some this replaces.
  const matched = new Set(elements);
  const topLevel = elements.filter((el) => {
    let current = el.parent;
    while (current) {
      if (matched.has(current)) return false;
      current = current.parent;
    }
    return true;
  });

  for (let i = 0; i < topLevel.length; i++) {
    const published = topLevel[i].attribs['data-published-at'];
    const links = DomUtils.getElementsByTagName('a', topLevel[i]);
    // Use the first anchor that actually has an href, not links[0]: a leading
    // <a id>/<a name> or icon anchor must not drop the whole entry.
    const link = links.find((l) => l.attribs && l.attribs.href);
    if (link) {
      const publishedDate = parseAuthoredDate(published);
      entries.push({
        href: link.attribs.href,
        title: DomUtils.textContent(link),
        published: published || '',
        publishedEpoch: publishedDate ? publishedDate.getTime() : null,
      });
    }
  }

  // Compare parsed instants, not their differently-offset source spellings.
  // Invalid values sort after valid entries, while equal instants and invalid
  // peers return 0 so the runtime's stable sort preserves document order.
  entries.sort(comparePublishedDesc);
  return entries;
}

function comparePublishedDesc(a, b) {
  const aValid = Number.isFinite(a.publishedEpoch);
  const bValid = Number.isFinite(b.publishedEpoch);
  if (aValid && bValid) return b.publishedEpoch - a.publishedEpoch;
  if (aValid) return -1;
  if (bValid) return 1;
  return 0;
}

function extractKeywords(metaMap) {
  const raw = metaValue(metaMap, 'keywords');
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k !== '');
}

function extractContent(dom, tagName, contentBase) {
  const elements = DomUtils.getElementsByTagName(tagName, dom, true, 1);
  if (elements.length > 0) {
    if (contentBase) rewriteRelativeUrls(elements[0], contentBase);
    return DomUtils.getInnerHTML(elements[0]);
  }
  return '';
}
