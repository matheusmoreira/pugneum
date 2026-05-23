'use strict';

// Characters with vertical components at pipe positions → |
// Characters with double-vertical components → ||
// Corners and top/bottom T-junctions → stripped (decorative border lines)
var DECORATIVE = /[┌┐└┘┬┴╔╗╚╝╦╩]/g;

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
