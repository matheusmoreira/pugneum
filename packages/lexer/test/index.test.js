'use strict';

var fs = require('fs');
var {test} = require('node:test');
var lex = require('../');

var dir = __dirname + '/../../../test-cases/';
fs.readdirSync(dir).forEach(function (testCase) {
  if (/\.pg$/.test(testCase)) {
    test(testCase, (t) => {
      var result = lex(fs.readFileSync(dir + testCase, 'utf8'), {
        filename: testCase,
      });
      t.assert.snapshot(result);
    });
  }
});

var edir = __dirname + '/errors/';
fs.readdirSync(edir).forEach(function (testCase) {
  if (/\.pg$/.test(testCase)) {
    test(testCase, (t) => {
      var actual;
      try {
        lex(fs.readFileSync(edir + testCase, 'utf8'), {
          filename: testCase,
        });
        throw new Error('Expected ' + testCase + ' to throw an exception.');
      } catch (ex) {
        if (!ex || !ex.code || ex.code.indexOf('PUGNEUM:') !== 0) throw ex;
        actual = {
          msg: ex.msg,
          code: ex.code,
          line: ex.line,
          column: ex.column,
        };
      }
      t.assert.snapshot(actual);
    });
  }
});
