var fs = require('fs');
var htmlparser2 = require('htmlparser2');
var DomUtils = htmlparser2.DomUtils;

exports.indexPage = function indexPage(indexPath) {
  var html = fs.readFileSync(indexPath, 'utf8');
  var dom = htmlparser2.parseDocument(html);

  var url = extractBaseHref(dom);
  var title = extractTitle(dom);
  var description = extractMeta(dom, 'description');
  var author = extractMeta(dom, 'author');
  var language = extractLanguage(dom);
  var entries = extractEntries(dom);

  return {url, title, description, author, language, entries};
};

exports.articlePage = function articlePage(filePath, selector) {
  var html = fs.readFileSync(filePath, 'utf8');
  var dom = htmlparser2.parseDocument(html);

  var title = extractTitle(dom);
  var description = extractMeta(dom, 'description');
  var author = extractMeta(dom, 'author');
  var keywords = extractKeywords(dom);
  var content = extractContent(dom, selector);

  return {title, description, author, keywords, content};
};

function extractBaseHref(dom) {
  var bases = DomUtils.getElementsByTagName('base', dom);
  if (bases.length > 0 && bases[0].attribs.href) {
    return bases[0].attribs.href;
  }
  return null;
}

function extractTitle(dom) {
  var titles = DomUtils.getElementsByTagName('title', dom);
  if (titles.length > 0) {
    return DomUtils.textContent(titles[0]);
  }
  return null;
}

function extractMeta(dom, name) {
  var metas = DomUtils.getElementsByTagName('meta', dom);
  for (var i = 0; i < metas.length; i++) {
    if (metas[i].attribs.name === name) {
      return metas[i].attribs.content || null;
    }
  }
  return null;
}

function extractLanguage(dom) {
  var htmlTags = DomUtils.getElementsByTagName('html', dom);
  if (htmlTags.length > 0 && htmlTags[0].attribs.lang) {
    return htmlTags[0].attribs.lang;
  }
  return null;
}

function extractEntries(dom) {
  var entries = [];
  var elements = DomUtils.findAll(
    (el) => el.attribs && el.attribs['data-published-at'],
    dom,
  );

  for (var i = 0; i < elements.length; i++) {
    var published = elements[i].attribs['data-published-at'];
    var links = DomUtils.getElementsByTagName('a', elements[i]);
    if (links.length > 0 && links[0].attribs && links[0].attribs.href) {
      entries.push({
        href: links[0].attribs.href,
        title: DomUtils.textContent(links[0]),
        published: published || '',
      });
    }
  }

  entries.sort((a, b) => (b.published || '').localeCompare(a.published || ''));
  return entries;
}

function extractKeywords(dom) {
  var raw = extractMeta(dom, 'keywords');
  if (!raw) {
    return [];
  }
  return raw.split(',').map((k) => k.trim());
}

function extractContent(dom, selector) {
  var elements = DomUtils.getElementsByTagName(selector, dom);
  if (elements.length > 0) {
    return DomUtils.getInnerHTML(elements[0]);
  }
  return '';
}
