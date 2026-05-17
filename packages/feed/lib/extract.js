const fs = require('fs');
const htmlparser2 = require('htmlparser2');
const DomUtils = htmlparser2.DomUtils;

exports.indexPage = function indexPage(indexPath) {
  const html = fs.readFileSync(indexPath, 'utf8');
  const dom = htmlparser2.parseDocument(html);

  const url = extractBaseHref(dom);
  const title = extractTitle(dom);
  const description = extractMeta(dom, 'description');
  const author = extractMeta(dom, 'author');
  const language = extractLanguage(dom);
  const entries = extractEntries(dom);

  return {url, title, description, author, language, entries};
};

exports.articlePage = function articlePage(filePath, tagName) {
  const html = fs.readFileSync(filePath, 'utf8');
  const dom = htmlparser2.parseDocument(html);

  const title = extractTitle(dom);
  const description = extractMeta(dom, 'description');
  const author = extractMeta(dom, 'author');
  const keywords = extractKeywords(dom);
  const content = extractContent(dom, tagName);

  return {title, description, author, keywords, content};
};

function extractBaseHref(dom) {
  const bases = DomUtils.getElementsByTagName('base', dom);
  if (bases.length > 0 && bases[0].attribs.href) {
    return bases[0].attribs.href;
  }
  return null;
}

function extractTitle(dom) {
  const titles = DomUtils.getElementsByTagName('title', dom);
  if (titles.length > 0) {
    return DomUtils.textContent(titles[0]);
  }
  return null;
}

function extractMeta(dom, name) {
  const metas = DomUtils.getElementsByTagName('meta', dom);
  for (let i = 0; i < metas.length; i++) {
    if (metas[i].attribs.name === name) {
      return metas[i].attribs.content || null;
    }
  }
  return null;
}

function extractLanguage(dom) {
  const htmlTags = DomUtils.getElementsByTagName('html', dom);
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

  for (let i = 0; i < elements.length; i++) {
    const published = elements[i].attribs['data-published-at'];
    const links = DomUtils.getElementsByTagName('a', elements[i]);
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
  const raw = extractMeta(dom, 'keywords');
  if (!raw) {
    return [];
  }
  return raw.split(',').map((k) => k.trim());
}

function extractContent(dom, tagName) {
  const elements = DomUtils.getElementsByTagName(tagName, dom);
  if (elements.length > 0) {
    return DomUtils.getInnerHTML(elements[0]);
  }
  return '';
}
