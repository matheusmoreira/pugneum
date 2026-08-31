exports.type = 'html';

// https://www.npmjs.com/package/prismjs
// https://prismjs.com/docs/
// https://github.com/PrismJS/prism
// https://github.com/PrismJS/prism/blob/master/prism.js

const error = require('pugneum-error');
const escapeHtml = require('pugneum-filterer/escape-text');

const optionNames = new Set(['filename', 'language']);
const loadedComponents = new Set();
let Prism;
let languageNames;

function optionError(message, context) {
  return error(
    'INVALID_HIGHLIGHT_OPTION',
    message,
    context && context.invocation,
  );
}

function normalizeAttributes(attributes, context) {
  if (attributes === undefined) return Object.create(null);
  if (
    attributes === null ||
    typeof attributes !== 'object' ||
    Array.isArray(attributes)
  ) {
    throw optionError('highlight attributes must be an object', context);
  }
  const normalized = Object.create(null);
  for (const name of Object.keys(attributes)) {
    if (!optionNames.has(name)) {
      throw optionError('unknown highlight option: ' + name, context);
    }
    normalized[name] = attributes[name];
  }
  return normalized;
}

function getLanguageNames() {
  if (languageNames !== undefined) return languageNames;

  const components = require('prismjs/components.json').languages;
  const names = new Map();
  for (const name of Object.keys(components)) {
    if (name !== 'meta') names.set(name, name);
  }
  for (const name of Object.keys(components)) {
    if (name === 'meta') continue;
    const aliases = components[name].alias;
    for (const alias of aliases === undefined
      ? []
      : Array.isArray(aliases)
      ? aliases
      : [aliases]) {
      if (!names.has(alias)) names.set(alias, name);
    }
  }
  languageNames = names;
  return names;
}

function loadLanguage(language, context) {
  const canonicalName = getLanguageNames().get(language);
  if (canonicalName === undefined) {
    throw optionError(`Unknown language: "${language}"`, context);
  }

  if (Prism === undefined) Prism = require('prismjs');
  const componentsToLoad = [];
  if (
    (canonicalName === 'javascript' || canonicalName === 'typescript') &&
    !loadedComponents.has('js-extras')
  ) {
    // The retired all-language bundle applied Prism's JavaScript extras.
    // Preserve that public token detail while loading only the relevant
    // modifier and its declared dependencies.
    componentsToLoad.push('js-extras');
  }
  if (!Object.prototype.hasOwnProperty.call(Prism.languages, canonicalName)) {
    componentsToLoad.push(canonicalName);
  }
  if (componentsToLoad.length > 0) {
    const loadLanguages = require('prismjs/components/');
    loadLanguages(componentsToLoad);
    for (const name of componentsToLoad) loadedComponents.add(name);
  }
  const grammar = Prism.languages[canonicalName];
  if (!grammar || typeof grammar !== 'object') {
    throw new Error(`Prism failed to load language: "${canonicalName}"`);
  }
  return {canonicalName, grammar};
}

exports.filter = function pugneum_filter_prismjs(text, attributes, context) {
  attributes = normalizeAttributes(attributes, context);
  const {language} = attributes;
  if (language === undefined) {
    return escapeHtml(text);
  }
  if (typeof language !== 'string' || language.trim() === '') {
    throw optionError('language must be a nonempty string', context);
  }
  const normalizedLanguage = language.trim().toLowerCase();
  const {canonicalName, grammar} = loadLanguage(normalizedLanguage, context);
  return Prism.highlight(text, grammar, canonicalName);
};
