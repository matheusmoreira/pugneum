exports.escapeXml = function escapeXml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
};

exports.escapeCdata = function escapeCdata(str) {
  if (str == null) return '';
  return String(str).replace(/]]>/g, ']]]]><![CDATA[>');
};
