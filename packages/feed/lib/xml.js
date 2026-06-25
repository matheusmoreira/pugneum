// XML 1.0 §2.2: Char ::= #x9 | #xA | #xD | [#x20-#xD7FF] | [#xE000-#xFFFD] |
//   [#x10000-#x10FFFF]. Everything else is illegal in XML text.
//
// ILLEGAL_XML strips the always-illegal scalar code points:
//   \x00-\x08, \x0B, \x0C, \x0E-\x1F  C0 controls except tab/LF/CR
//   ￾, ￿                    BMP noncharacters U+FFFE/U+FFFF
const ILLEGAL_XML = /[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]/g;

// Lone surrogates are also illegal (the §2.2 ranges deliberately exclude
// U+D800-U+DFFF). They cannot be matched in a single character class with
// String.replace, because a valid surrogate PAIR is two code units and each
// half would match individually, destroying legal astral characters (emoji
// etc.). So match a high surrogate not followed by a low surrogate, and a low
// surrogate not preceded by a high surrogate — i.e. only unpaired ones. On a
// UTF-8 write a lone surrogate would otherwise be silently transcoded to
// U+FFFD, corrupting the byte stream.
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function stripIllegalXml(str) {
  if (str == null) return '';
  return String(str).replace(ILLEGAL_XML, '').replace(LONE_SURROGATE, '');
}

exports.escapeXml = function escapeXml(str) {
  return stripIllegalXml(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
};

exports.escapeCdata = function escapeCdata(str) {
  return stripIllegalXml(str).replace(/]]>/g, ']]]]><![CDATA[>');
};
