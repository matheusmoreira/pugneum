const DECORATIVE = /[┌┐└┘┬┴╔╗╚╝╦╩]/g;

module.exports = function normalize(text) {
  return text
    .replace(/[╠╣╬]/g, '||')
    .replace(/║/g, '||')
    .replace(/[├┤┼]/g, '|')
    .replace(/│/g, '|')
    .replace(/─/g, '-')
    .replace(/═/g, '=')
    .replace(DECORATIVE, '');
};
