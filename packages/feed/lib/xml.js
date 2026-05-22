// XML 1.0 §2.2: legal characters are #x9 | #xA | #xD | [#x20-#xD7FF] | ...
// Strip control characters that are illegal in XML before escaping.
const ILLEGAL_XML = /[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]/g;

function stripIllegalXml(str) {
  if (str == null) return '';
  return String(str).replace(ILLEGAL_XML, '');
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
