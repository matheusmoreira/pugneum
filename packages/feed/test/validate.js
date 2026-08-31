'use strict';

const assert = require('node:assert/strict');
const {DomUtils, Parser, parseDocument, parseFeed} = require('htmlparser2');

function assertValidAtom(xml, expected) {
  const root = parseXml(xml, 'Atom');
  assert.strictEqual(root.name, 'feed', 'Atom root element');
  assert.strictEqual(
    root.attribs.xmlns,
    'http://www.w3.org/2005/Atom',
    'Atom namespace',
  );

  requiredText(root, 'title', 'Atom feed title');
  const feedId = requiredText(root, 'id', 'Atom feed id');
  assertUrl(feedId, 'Atom feed id');
  assertIsoTimestamp(requiredText(root, 'updated', 'Atom feed updated'));
  requiredText(one(root, 'author', 'Atom feed author'), 'name', 'Atom author');

  const alternate = links(root, 'alternate');
  assert.strictEqual(alternate.length, 1, 'Atom alternate link count');
  assertUrl(alternate[0].attribs.href, 'Atom alternate href');
  assert.strictEqual(alternate[0].attribs.href, feedId, 'Atom alternate/id');

  const self = links(root, 'self');
  assert.strictEqual(self.length, 1, 'Atom self link count');
  assertUrl(self[0].attribs.href, 'Atom self href');
  if (expected && expected.selfUrl) {
    assert.strictEqual(
      self[0].attribs.href,
      expected.selfUrl,
      'Atom self href',
    );
  }

  const entries = children(root, 'entry');
  const ids = new Set();
  for (const entry of entries) {
    requiredText(entry, 'title', 'Atom entry title');
    const id = requiredText(entry, 'id', 'Atom entry id');
    assertUrl(id, 'Atom entry id');
    assert.ok(!ids.has(id), 'Atom entry ids must be unique');
    ids.add(id);
    assertIsoTimestamp(
      requiredText(entry, 'published', 'Atom entry published'),
    );
    assertIsoTimestamp(requiredText(entry, 'updated', 'Atom entry updated'));
    requiredText(
      one(entry, 'author', 'Atom entry author'),
      'name',
      'Atom entry author',
    );
    const content = one(entry, 'content', 'Atom entry content');
    assert.strictEqual(content.attribs.type, 'html', 'Atom content type');

    const entryLinks = links(entry, 'alternate');
    assert.strictEqual(entryLinks.length, 1, 'Atom entry link count');
    assert.strictEqual(entryLinks[0].attribs.href, id, 'Atom entry link/id');
    for (const category of children(entry, 'category')) {
      assert.ok(category.attribs.term, 'Atom category term');
    }
  }

  const parsed = parseFeed(xml);
  assert.strictEqual(parsed.type, 'atom');
  assert.strictEqual(
    parsed.items.length,
    entries.length,
    'Atom parsed entries',
  );
  return parsed;
}

function assertValidRss(xml, expected) {
  const root = parseXml(xml, 'RSS');
  assert.strictEqual(root.name, 'rss', 'RSS root element');
  assert.strictEqual(root.attribs.version, '2.0', 'RSS version');
  assert.strictEqual(
    root.attribs['xmlns:content'],
    'http://purl.org/rss/1.0/modules/content/',
    'RSS content namespace',
  );
  assert.strictEqual(
    root.attribs['xmlns:dc'],
    'http://purl.org/dc/elements/1.1/',
    'RSS Dublin Core namespace',
  );
  assert.strictEqual(
    root.attribs['xmlns:atom'],
    'http://www.w3.org/2005/Atom',
    'RSS Atom namespace',
  );
  const channel = one(root, 'channel', 'RSS channel');

  requiredText(channel, 'title', 'RSS channel title');
  assertUrl(requiredText(channel, 'link', 'RSS channel link'), 'RSS link');
  requiredText(channel, 'description', 'RSS channel description');
  assertRfcTimestamp(
    requiredText(channel, 'lastBuildDate', 'RSS lastBuildDate'),
  );

  const self = children(channel, 'atom:link').filter(
    (element) => element.attribs.rel === 'self',
  );
  assert.strictEqual(self.length, 1, 'RSS self link count');
  assert.strictEqual(
    self[0].attribs.type,
    'application/rss+xml',
    'RSS self link type',
  );
  assertUrl(self[0].attribs.href, 'RSS self href');
  if (expected && expected.selfUrl) {
    assert.strictEqual(self[0].attribs.href, expected.selfUrl, 'RSS self href');
  }

  const items = children(channel, 'item');
  const ids = new Set();
  for (const item of items) {
    requiredText(item, 'title', 'RSS item title');
    const link = requiredText(item, 'link', 'RSS item link');
    assertUrl(link, 'RSS item link');
    const guidElement = one(item, 'guid', 'RSS item guid');
    const guid = nonEmptyText(guidElement, 'RSS item guid');
    assert.strictEqual(
      guidElement.attribs.isPermaLink,
      'true',
      'RSS guid type',
    );
    assert.strictEqual(guid, link, 'RSS item guid/link');
    assert.ok(!ids.has(guid), 'RSS item guids must be unique');
    ids.add(guid);
    assertRfcTimestamp(requiredText(item, 'pubDate', 'RSS item pubDate'));
    requiredText(item, 'dc:creator', 'RSS item creator');
    one(item, 'content:encoded', 'RSS encoded content');
    for (const category of children(item, 'category')) {
      nonEmptyText(category, 'RSS category');
    }
  }

  const parsed = parseFeed(xml);
  assert.strictEqual(parsed.type, 'rss');
  assert.strictEqual(parsed.items.length, items.length, 'RSS parsed items');
  return parsed;
}

function parseXml(xml, label) {
  assert.strictEqual(typeof xml, 'string', label + ' XML input');
  assert.match(
    xml,
    /^<\?xml version="1\.0" encoding="utf-8"\?>\n/,
    label + ' XML declaration',
  );

  const malformedClosures = [];
  const malformedAttributes = [];
  let attributeNames = new Set();
  let parser;
  parser = new Parser(
    {
      onopentagname() {
        attributeNames = new Set();
      },
      onattribute(name, value, quote) {
        if (attributeNames.has(name)) malformedAttributes.push(name);
        attributeNames.add(name);
        if (quote !== '"' && quote !== "'") malformedAttributes.push(name);
      },
      onclosetag(name, implied) {
        if (!implied) return;
        const raw = xml.slice(parser.startIndex, parser.endIndex + 1);
        if (!raw.endsWith('/>')) malformedClosures.push(name);
      },
    },
    {xmlMode: true, decodeEntities: true},
  );
  parser.end(xml);
  assert.deepStrictEqual(malformedClosures, [], label + ' close tags');
  assert.deepStrictEqual(malformedAttributes, [], label + ' attributes');

  const outsideCdata = xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  assert.doesNotMatch(
    outsideCdata,
    /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\dA-Fa-f]+);)/,
    label + ' XML entities',
  );

  const document = parseDocument(xml, {xmlMode: true});
  for (const node of document.children) {
    if (node.type === 'text') {
      assert.strictEqual(node.data.trim(), '', label + ' text outside root');
    }
  }
  const roots = document.children.filter((node) => node.type === 'tag');
  assert.strictEqual(roots.length, 1, label + ' root count');
  return roots[0];
}

function children(parent, name) {
  return parent.children.filter(
    (node) => node.type === 'tag' && node.name === name,
  );
}

function one(parent, name, label) {
  const matches = children(parent, name);
  assert.strictEqual(matches.length, 1, label + ' count');
  return matches[0];
}

function requiredText(parent, name, label) {
  return nonEmptyText(one(parent, name, label), label);
}

function nonEmptyText(element, label) {
  const value = DomUtils.textContent(element);
  assert.ok(value.trim(), label + ' must not be empty');
  return value;
}

function links(parent, relationship) {
  return children(parent, 'link').filter(
    (element) => element.attribs.rel === relationship,
  );
}

function assertUrl(value, label) {
  assert.doesNotThrow(() => new URL(value), label + ' must be an absolute URL');
}

function assertIsoTimestamp(value) {
  assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.strictEqual(new Date(value).toISOString(), value);
}

function assertRfcTimestamp(value) {
  assert.match(value, /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), /);
  assert.strictEqual(new Date(value).toUTCString(), value);
}

module.exports = {assertValidAtom, assertValidRss};
