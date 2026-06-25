const fs = require('fs');
const htmlparser2 = require('htmlparser2');
const DomUtils = htmlparser2.DomUtils;

exports.indexPage = function indexPage(indexPath) {
  const html = fs.readFileSync(indexPath, 'utf8');
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

exports.articlePage = function articlePage(filePath, tagName) {
  const html = fs.readFileSync(filePath, 'utf8');
  const dom = htmlparser2.parseDocument(html);
  const metaMap = extractMetaMap(dom);

  const title = extractTitle(dom);
  const description = metaValue(metaMap, 'description');
  const author = metaValue(metaMap, 'author');
  const keywords = extractKeywords(metaMap);
  const content = extractContent(dom, tagName);

  return {title, description, author, keywords, content};
};

// These singletons live in <head>, so stop at the first match (limit=1) instead
// of walking the whole document — extractTitle runs once per article.
function extractBaseHref(dom) {
  const bases = DomUtils.getElementsByTagName('base', dom, true, 1);
  if (bases.length > 0 && bases[0].attribs.href) {
    return bases[0].attribs.href;
  }
  return null;
}

function extractTitle(dom) {
  const titles = DomUtils.getElementsByTagName('title', dom, true, 1);
  if (titles.length > 0) {
    return DomUtils.textContent(titles[0]);
  }
  return null;
}

// Collect every <meta name=...> content once per page into a name->content map,
// so description/author/keywords are read from a single document walk instead of
// one full scan each. A null-prototype map keeps a <meta name="__proto__"> from
// colliding with inherited object keys.
function extractMetaMap(dom) {
  const metas = DomUtils.getElementsByTagName('meta', dom);
  const map = Object.create(null);
  for (let i = 0; i < metas.length; i++) {
    const name = metas[i].attribs.name;
    if (name && map[name] === undefined) {
      map[name] = metas[i].attribs.content || null;
    }
  }
  return map;
}

function metaValue(metaMap, name) {
  return metaMap[name] !== undefined ? metaMap[name] : null;
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
      entries.push({
        href: link.attribs.href,
        title: DomUtils.textContent(link),
        published: published || '',
      });
    }
  }

  // data-published-at values are ISO-8601 strings, for which a plain lexical
  // comparison is chronological, locale-independent, and cheaper than
  // localeCompare. entries[0] is therefore the newest entry (relied on by the
  // feed-level <updated>/<lastBuildDate>).
  entries.sort((a, b) => compareDesc(a.published || '', b.published || ''));
  return entries;
}

function compareDesc(a, b) {
  if (a < b) return 1;
  if (a > b) return -1;
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

function extractContent(dom, tagName) {
  const elements = DomUtils.getElementsByTagName(tagName, dom, true, 1);
  if (elements.length > 0) {
    return DomUtils.getInnerHTML(elements[0]);
  }
  return '';
}
