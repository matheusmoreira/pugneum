'use strict';

var CORNERS_AND_JUNCTIONS = /[┌┐└┘├┤┬┴┼╔╗╚╝╠╣╦╩╬]/g;

module.exports = function normalize(text) {
  return text
    .replace(/║/g, '||')
    .replace(/│/g, '|')
    .replace(/─/g, '-')
    .replace(/═/g, '=')
    .replace(CORNERS_AND_JUNCTIONS, '');
};
