// Map Unicode box-drawing characters onto the table grammar's ASCII tokens
// before parsing. The single-vs-double distinction is SEMANTIC, not cosmetic:
// double-line glyphs become `||` (colgroup boundaries) while single-line glyphs
// become `|` (ordinary column separators); horizontals become `-`/`=`; and
// purely decorative corners/T-junctions are stripped (a pure border line then
// becomes empty and is dropped downstream).
//
// Order matters: the double-line `╬` must be replaced (-> `||`) before the
// single-line class would touch it, and DECORATIVE stripping runs LAST so it
// cannot eat a glyph an earlier rule needed. Do not merge or reorder these.
const DECORATIVE = /[┌┐└┘┬┴╔╗╚╝╦╩]/g;

module.exports = function normalize(text) {
  return text
    .replace(/[╠╣╬]/g, '||') // double-line junctions -> colgroup boundary
    .replace(/║/g, '||') // double vertical -> colgroup boundary
    .replace(/[├┤┼]/g, '|') // single-line junctions -> column separator
    .replace(/│/g, '|') // single vertical -> column separator
    .replace(/─/g, '-') // light horizontal -> dash
    .replace(/═/g, '=') // double horizontal -> equals
    .replace(DECORATIVE, ''); // corners/T-junctions are decorative
};
